import { describe, it, expect } from '@jest/globals';

import { sql_queries, sql_sets } from '../src/sql-parse';

describe('Sql query parse', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('1 query test', async () => {
    const input = '-- any\n\n# other comment\n\n#! also comment\n  SELECT * \nFROM events;\n';

    const output = ['SELECT * FROM events'];

    expect(sql_queries(input)).toEqual(output);
  });
});

describe('Sql settings parse', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('one set and comments with no end of lines', async () => {
    const input = '-- any\nSET allow_experimental_object_type = 1;\n\n --set option\nSELECT * FROM events';

    const output = { allow_experimental_object_type: '1' };

    expect(sql_sets(input)).toEqual(output);
  });

  it('two sets and comments', async () => {
    const input =
      '-- any\nSET allow_experimental_object_type = 1; --set option\nSET allow_experimental_object_new = 1;\nSELECT * \n  --comment\n  FROM events\n';

    const output = { allow_experimental_object_type: '1', allow_experimental_object_new: '1' };

    expect(sql_sets(input)).toEqual(output);
  });
});
