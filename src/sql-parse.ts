// Substitute ${VAR} placeholders in migration content from environment variables.
//
// Opt-in via CH_MIGRATIONS_SUBSTITUTE_ENV=true, so existing migrations are
// unaffected by default. Substitution happens at apply time only; callers
// checksum the raw (pre-substitution) content, so a committed migration stays
// stable across environments and secret rotations, and the substituted SQL is
// never persisted. Useful for environment-specific, idempotent DDL such as a
// dictionary whose SOURCE(...) points at a per-environment database.
//
// A referenced-but-unset variable throws (fail loud) rather than emitting a
// literal ${...} into the SQL.
const substitute_env = (content: string): string => {
  if (process.env.CH_MIGRATIONS_SUBSTITUTE_ENV !== 'true') {
    return content;
  }

  return content.replace(/\$\{(\w+)\}/g, (_match: string, name: string): string => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`migration references \${${name}} but the environment variable ${name} is not set.`);
    }
    return value;
  });
};

// Extract sql queries from migrations.
const sql_queries = (content: string): string[] => {
  const queries = content
    .replace(/(--|#!|#\s).*(\n|\r\n|\r|$)/gm, '\n')
    .replace(/^\s*(SET\s).*(\n|\r\n|\r|$)/gm, '')
    .replace(/(\n|\r\n|\r)/gm, ' ')
    .replace(/\s+/g, ' ')
    .split(';')
    .map((el: string) => el.trim())
    .filter((el: string) => el.length != 0);

  return queries;
};

// Extract query settings from migrations.
const sql_sets = (content: string) => {
  const sets: { [key: string]: string } = {};

  const sets_arr = content
    .replace(/(--|#!|#\s).*(\n|\r\n|\r|$)/gm, '\n')
    .replace(/^\s*(?!SET\s).*(\n|\r\n|\r|$)/gm, '')
    .replace(/^\s*(SET\s)/gm, '')
    .replace(/(\n|\r\n|\r)/gm, ' ')
    .replace(/\s+/g, '')
    .split(';');

  sets_arr.forEach((set_full) => {
    const set = set_full.split('=');
    if (set[0]) {
      sets[set[0]] = set[1];
    }
  });

  return sets;
};

export { sql_queries, sql_sets, substitute_env };
