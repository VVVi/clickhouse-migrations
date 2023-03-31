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

export { sql_queries, sql_sets };

// -- any
// SET allow_experimental_object_type = 1; --set option
// SET allow_experimental_object_new = 1;
// SELECT * FROM events

// sdfsfdsd
// -- asssss
//  --asdf
// sdfsdf
//   sdfsfs
// SET a=1
//   asdf
//   SET f=22

//   sdf
