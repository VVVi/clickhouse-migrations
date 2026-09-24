// Return a location for error messages, for example: "line 12, column 7".
const describe_position = (content: string, index: number): string => {
  const before = content.slice(0, index);
  const line = before.split(/\r\n|\r|\n/).length;
  const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1;
  // Count code points, not UTF-16 units, so supplementary characters do not shift the column.
  const column = Array.from(before.slice(lineStart)).length + 1;
  return `line ${line}, column ${column}`;
};

const isSpace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';

// Split only outside quoted text and comments. ClickHouse parses the SQL itself.
const split_statements = (content: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let pendingSpace = false; // whitespace seen in plain SQL, emitted lazily as one space
  let bracketDepth = 0;
  let insertStatement = false;
  let insertHeader = false;
  let inputSource = false;
  let inputFunctionExpected = false;
  let formatExpected = false;
  let previousToken = '';

  const rememberToken = (token: string, quoted = false): void => {
    inputFunctionExpected = insertStatement && token === 'INPUT' && ['FROM', 'JOIN'].includes(previousToken);
    previousToken = quoted ? 'quoted' : token;
  };

  const emitPlain = (text: string): void => {
    if (pendingSpace && current.length > 0) {
      current += ' ';
    }
    pendingSpace = false;
    current += text;
  };

  const flush = (): void => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = '';
    pendingSpace = false;
    bracketDepth = 0;
    insertStatement = false;
    insertHeader = false;
    inputSource = false;
    inputFunctionExpected = false;
    formatExpected = false;
    previousToken = '';
  };

  const n = content.length;
  let i = 0;

  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    // Line comments end at the next newline; markers inside quotes are copied below.
    if (
      (ch === '-' && next === '-') ||
      (ch === '/' && next === '/') ||
      (ch === '#' && (next === '!' || next === '' || isSpace(next)))
    ) {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') {
        i += 1;
      }
      pendingSpace = true; // the comment stood between tokens; keep them apart
      continue;
    }

    // block comments, nested
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

    if (formatExpected && /[A-Za-z_'"`]/.test(ch)) {
      throw new Error('inline INSERT FORMAT data is not supported in migrations; use INSERT VALUES or INSERT SELECT');
    }

    // quoted strings and identifiers: copied verbatim, including the quotes
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
      rememberToken(quote === "'" ? 'quoted' : content.slice(i + 1, j).toUpperCase(), true);
      formatExpected = false;
      i = end;
      continue;
    }

    // dollar-quoted strings: $tag$ ... $tag$ (tag may be empty)
    if (ch === '$' && (i === 0 || !/[A-Za-z0-9_$]/.test(content[i - 1]))) {
      const tagMatch = /^\$[A-Za-z0-9_]*\$/.exec(content.slice(i));
      if (tagMatch) {
        const opener = tagMatch[0];
        const close = content.indexOf(opener, i + opener.length);
        if (close === -1) {
          throw new Error(`unterminated dollar-quoted string ${opener} starting at ${describe_position(content, i)}`);
        }
        const end = close + opener.length;
        emitPlain(content.slice(i, end));
        rememberToken('quoted');
        formatExpected = false;
        i = end;
        continue;
      }
    }

    // statement terminator
    if (ch === ';') {
      flush();
      i += 1;
      continue;
    }

    // plain SQL
    if (isSpace(ch)) {
      pendingSpace = true;
      i += 1;
      continue;
    }

    // Recognize an INSERT data clause before scanning its non-SQL payload.
    // Ignore nested expressions and qualified names; input() is tracked separately.
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(content.slice(i));
    if (word) {
      const keyword = word[0].toUpperCase();
      if (bracketDepth === 0) {
        const identifier = ['INTO', 'TABLE', 'FUNCTION', '.'].includes(previousToken);
        if (!identifier) {
          if (keyword === 'INSERT' && (!current || /^WITH\b/i.test(current))) {
            insertStatement = true;
            insertHeader = true;
          }
          if (keyword === 'SELECT' || keyword === 'VALUES') insertHeader = false;
          formatExpected = (insertHeader || inputSource) && keyword === 'FORMAT';
        }
      }
      rememberToken(keyword);
      emitPlain(word[0]);
      i += word[0].length;
      continue;
    }
    // input() also accepts raw FORMAT data after an INSERT SELECT, even in a subquery.
    if (ch === '(' && inputFunctionExpected) inputSource = true;
    inputFunctionExpected = false;
    if ('([{'.includes(ch)) bracketDepth += 1;
    if (')]}'.includes(ch)) bracketDepth -= 1;
    previousToken = ch;
    formatExpected = false;
    emitPlain(ch);
    i += 1;
  }

  flush();
  return statements;
};

export { split_statements };
