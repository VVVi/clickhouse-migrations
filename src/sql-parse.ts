import { split_statements } from './sql-split';

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

// Keep SET commands in order; ClickHouse interprets them in the migration session.
const sql_queries = split_statements;

export { sql_queries, substitute_env };
