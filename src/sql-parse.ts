// Extract sql queries from migrations.
const sql_queries = (content: string): string[] => {
  const queries = content
    .replace(/^(--|#!|#\s|SET\s).*(\n|\r\n|\r|$)/gm, '')
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
    .replace(/^(?!SET\s).*(\n|\r\n|\r|$)/gm, '')
    .replace(/^(SET\s)/gm, '')
    .replace(/(\n|\r\n|\r)/gm, ' ')
    .replace(/\s+/g, '')
    .split(';');

  sets_arr.forEach((set_full) => {
    const set = set_full.split('=');
    sets[set[0]] = set[1];
  });

  return sets;
};

export { sql_queries, sql_sets };
