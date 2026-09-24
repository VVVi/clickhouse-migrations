// Replace ${NAME} in migration content with env vars. Opt-in via
// CH_MIGRATIONS_SUBSTITUTE_ENV=true; otherwise returns content unchanged.
// Use $${NAME} to keep a literal ${NAME}. Throws on an unset variable or a
// malformed/unterminated placeholder, so nothing is ever silently left as-is.
// Note: the caller checksums the raw file, so substitution only affects the
// SQL sent to ClickHouse, not what's stored in _migrations.
const substitute_env = (content: string): string => {
  if (process.env.CH_MIGRATIONS_SUBSTITUTE_ENV !== 'true') {
    return content;
  }

  const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

  let result = '';
  let position = 0;

  while (position < content.length) {
    // Escaped placeholder: $${NAME} -> ${NAME} (kept literal, not substituted).
    if (content.startsWith('$${', position)) {
      const end = content.indexOf('}', position + 3);
      if (end === -1) {
        throw new Error(`unterminated escaped placeholder at position ${position}`);
      }

      // Drop only the leading "$" and keep the rest as a literal.
      result += content.slice(position + 1, end + 1);
      position = end + 1;
      continue;
    }

    // Environment placeholder: ${NAME}.
    if (content.startsWith('${', position)) {
      const end = content.indexOf('}', position + 2);
      if (end === -1) {
        throw new Error(`unterminated environment placeholder at position ${position}`);
      }

      const placeholder = content.slice(position, end + 1);
      const name = content.slice(position + 2, end);
      if (!ENV_NAME.test(name)) {
        throw new Error(
          `invalid environment placeholder "${placeholder}"; expected \${NAME} or escape it as $${placeholder}`,
        );
      }

      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`migration references ${placeholder}, but environment variable ${name} is not set`);
      }

      result += value;
      position = end + 1;
      continue;
    }

    result += content[position];
    position += 1;
  }

  return result;
};

// "line 12, column 7" for error messages.
const describe_position = (content: string, index: number): string => {
  const before = content.slice(0, index);
  const line = before.split(/\r\n|\r|\n/).length;
  const column = index - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  return `line ${line}, column ${column}`;
};

const isSpace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';

// Split migration content into statements the way ClickHouse's own lexer reads it.
//
// A single pass over the text tracks what the current character belongs to:
//   - a single-quoted string ('...', with '' and backslash escapes),
//   - a double-quoted or backtick-quoted identifier ("..." / `...`, with doubled
//     quotes and backslash escapes),
//   - a dollar-quoted string ($tag$ ... $tag$),
//   - a line comment (-- ..., #! ..., or # followed by whitespace, to end of line),
//   - a block comment (/* ... */, nested as ClickHouse allows),
//   - or plain SQL.
// Only a ';' in plain SQL ends a statement. Comments are dropped. Text inside
// quotes is kept exactly as written; whitespace outside quotes is collapsed to a
// single space, which keeps the statements ClickHouse receives stable and
// readable in logs.
//
// An unterminated string, identifier, dollar-quote or block comment is an error:
// silently reading to the end of the file would glue every following statement
// into one and drop any SET among them, and the failure would surface only as an
// opaque ClickHouse error much later.
//
// The previous implementation was a chain of regular expressions that split on
// every ';' and stripped "comments" without knowing about quoting, so a ';' or
// '--' inside a string literal broke the statement (issue #52).
const split_statements = (content: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let pendingSpace = false; // whitespace seen in plain SQL, emitted lazily as one space

  const emitPlain = (text: string): void => {
    if (pendingSpace && current.length > 0) {
      current += ' ';
    }
    pendingSpace = false;
    current += text;
  };

  const flush = (): void => {
    const statement = current.trim();
    if (statement.length > 0) {
      statements.push(statement);
    }
    current = '';
    pendingSpace = false;
  };

  const n = content.length;
  let i = 0;

  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    // ---- line comments: -- ..., #! ..., # followed by whitespace (or end of text)
    if ((ch === '-' && next === '-') || (ch === '#' && (next === '!' || next === '' || isSpace(next)))) {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') {
        i += 1;
      }
      pendingSpace = true; // the comment stood between tokens; keep them apart
      continue;
    }

    // ---- block comments, nested
    if (ch === '/' && next === '*') {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (content[i] === '/' && content[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (content[i] === '*' && content[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) {
        throw new Error(`unterminated block comment starting at ${describe_position(content, start)}`);
      }
      pendingSpace = true;
      continue;
    }

    // ---- quoted strings and identifiers: copied verbatim, including the quotes
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        const c = content[j];
        if (c === '\\' && j + 1 < n) {
          j += 2; // backslash escape: skip the escaped character whatever it is
          continue;
        }
        if (c === quote) {
          if (content[j + 1] === quote) {
            j += 2; // doubled quote inside the literal
            continue;
          }
          break; // closing quote
        }
        j += 1;
      }
      if (j >= n) {
        const what = quote === "'" ? 'string literal' : 'quoted identifier';
        throw new Error(`unterminated ${what} starting at ${describe_position(content, i)}`);
      }
      const end = j + 1; // include the closing quote
      emitPlain(content.slice(i, end));
      i = end;
      continue;
    }

    // ---- dollar-quoted strings: $tag$ ... $tag$ (tag may be empty)
    if (ch === '$') {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(content.slice(i));
      if (tagMatch) {
        const opener = tagMatch[0];
        const close = content.indexOf(opener, i + opener.length);
        if (close === -1) {
          throw new Error(`unterminated dollar-quoted string ${opener} starting at ${describe_position(content, i)}`);
        }
        const end = close + opener.length;
        emitPlain(content.slice(i, end));
        i = end;
        continue;
      }
    }

    // ---- statement terminator
    if (ch === ';') {
      flush();
      i += 1;
      continue;
    }

    // ---- plain SQL
    if (isSpace(ch)) {
      pendingSpace = true;
      i += 1;
      continue;
    }
    emitPlain(ch);
    i += 1;
  }

  flush();
  return statements;
};

// A settings statement: `SET name = value[, ...]`. `SET ROLE`, `SET DEFAULT ROLE`
// and `SET TRANSACTION SNAPSHOT` are ordinary statements and are sent to ClickHouse.
const SET_STATEMENT = /^SET\s+(?!ROLE\b|DEFAULT\s+ROLE\b|TRANSACTION\b)/i;

// Extract sql queries from migrations (everything that is not a SET statement).
const sql_queries = (content: string): string[] => {
  return split_statements(content).filter((statement) => !SET_STATEMENT.test(statement));
};

// Split "a = 1, b = 'x, y'" on the commas that are not inside quotes.
const split_top_level_commas = (text: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
};

// A setting value as ClickHouse would read it: quotes removed from a quoted
// value (with '' and \' unescaped), anything else as written.
const setting_value = (raw: string): string => {
  const value = raw.trim();
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
    return value.slice(1, -1).replace(/''/g, "'").replace(/\\(.)/g, '$1');
  }
  return value;
};

// Extract query settings from migrations: every `SET name = value[, name = value...]`
// statement, in file order (a later SET of the same name wins).
const sql_sets = (content: string) => {
  const sets: { [key: string]: string } = {};

  for (const statement of split_statements(content)) {
    if (!SET_STATEMENT.test(statement)) {
      continue;
    }
    const body = statement.replace(SET_STATEMENT, '');
    for (const assignment of split_top_level_commas(body)) {
      const eq = assignment.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const name = assignment.slice(0, eq).trim();
      if (name.length === 0) {
        continue;
      }
      sets[name] = setting_value(assignment.slice(eq + 1));
    }
  }

  return sets;
};

export { split_statements, sql_queries, sql_sets, substitute_env };
