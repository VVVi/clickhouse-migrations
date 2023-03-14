import { describe, it, expect } from '@jest/globals';

import { sql_queries, sql_sets } from '../src/sql-parse';

describe('Sql query parse', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('1 query test', async () => {
    const input = '-- any\n\n# other comment\n\n#! also comment\nSELECT * \nFROM events;\n';

    const output = ['SELECT * FROM events'];

    expect(sql_queries(input)).toEqual(output);
  });
});

describe('Sql settings parse', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('one comment and one settings with end of lines', async () => {
    const input = '-- any\nSET allow_experimental_object_type = 1;\n';

    const output = { allow_experimental_object_type: '1' };

    expect(sql_sets(input)).toEqual(output);
  });

  it('no end of line at the end of last line', async () => {
    const input = '-- any\nSET allow_experimental_object_type = 1;';

    const output = { allow_experimental_object_type: '1' };

    expect(sql_sets(input)).toEqual(output);
  });
});
