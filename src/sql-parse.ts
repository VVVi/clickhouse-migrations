import { split_assignments, split_statements } from './sql-split';

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

// HTTP settings take values, not SQL string-literal syntax. Decode quoted
// strings once; leave numbers and compound parameter values as text so large
// integers never lose precision through JavaScript Number conversion.
const setting_value = (raw: string): string => {
  const tag = /^\$[A-Za-z0-9_]*\$/.exec(raw)?.[0];
  if (tag && raw.endsWith(tag)) return raw.slice(tag.length, -tag.length);

  const quote = raw[0];
  if (!["'", '"', '`'].includes(quote) || !raw.endsWith(quote)) return raw;

  // Hex escapes represent bytes; decode UTF-8 after unescaping so \xC3\xA9 is é.
  const input = Buffer.from(raw.slice(1, -1));
  const bytes: number[] = [];
  const escapes: Record<string, number> = {
    '0': 0,
    a: 7,
    b: 8,
    e: 27,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
    "'": 39,
    '"': 34,
    '`': 96,
    '\\': 92,
    '/': 47,
    '=': 61,
  };
  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i];
    if (byte === quote.charCodeAt(0) && input[i + 1] === byte) {
      i += 1;
    } else if (byte === 92 && i + 1 < input.length) {
      const next = String.fromCharCode(input[i + 1]);
      const hex = input.subarray(i + 2, i + 4).toString();
      if (next === 'x' && /^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
      if (Object.hasOwn(escapes, next)) {
        bytes.push(escapes[next]);
        i += 1;
        continue;
      }
      if (next === 'N') {
        i += 1; // ClickHouse's \N escape is an empty string inside a literal.
        continue;
      }
    }
    bytes.push(byte);
  }
  return Buffer.from(bytes).toString('utf8');
};

const parse_migration_sql = (content: string): { queries: string[]; settings: Record<string, string> } => {
  const queries: string[] = [];
  const settings: Record<string, string> = {};

  for (const statement of split_statements(content)) {
    // Only assignment-style SET belongs to file-wide settings. Administrative
    // statements such as SET DEFAULT ROLE remain SQL for ClickHouse to execute.
    const setting = /^SET\s+([A-Za-z_][A-Za-z0-9_]*\s*=[\s\S]*)$/i.exec(statement);
    if (!setting) {
      queries.push(statement);
      continue;
    }
    for (const assignment of split_assignments(setting[1])) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(assignment);
      if (!match) throw new Error(`invalid SET assignment: ${assignment}`);
      settings[match[1]] = setting_value(match[2].trim());
    }
  }
  return { queries, settings };
};

// Preserve the existing helper exports for callers importing lib/sql-parse.
const sql_queries = (content: string): string[] => parse_migration_sql(content).queries;
const sql_sets = (content: string): Record<string, string> => parse_migration_sql(content).settings;

export { parse_migration_sql, sql_queries, sql_sets, substitute_env };
