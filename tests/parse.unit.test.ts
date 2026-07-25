import { describe, it, expect } from '@jest/globals';

import { sql_queries, sql_sets, substitute_env } from '../src/sql-parse';

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
    const input = '-- any\nSET allow_experimental_json_type = 1;\n\n --set option\nSELECT * FROM events';

    const output = { allow_experimental_json_type: '1' };

    expect(sql_sets(input)).toEqual(output);
  });

  it('two sets and comments', async () => {
    const input =
      '-- any\nSET allow_experimental_json_type = 1; --set option\nSET allow_experimental_object_new = 1;\nSELECT * \n  --comment\n  FROM events\n';

    const output = { allow_experimental_json_type: '1', allow_experimental_object_new: '1' };

    expect(sql_sets(input)).toEqual(output);
  });
});

describe('Env var substitution', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('is a no-op when CH_MIGRATIONS_SUBSTITUTE_ENV is not set (backward compatible)', () => {
    delete process.env.CH_MIGRATIONS_SUBSTITUTE_ENV;
    process.env.PG_HOST = 'postgres';

    const input = "SOURCE(POSTGRESQL(HOST '${PG_HOST}'))";

    expect(substitute_env(input)).toBe(input);
  });

  it('is a no-op when CH_MIGRATIONS_SUBSTITUTE_ENV is false (backward compatible)', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'false';
    process.env.PG_HOST = 'postgres';

    const input = "SOURCE(POSTGRESQL(HOST '${PG_HOST}'))";

    expect(substitute_env(input)).toBe(input);
  });

  it('does not throw on malformed/unterminated placeholders when disabled', () => {
    delete process.env.CH_MIGRATIONS_SUBSTITUTE_ENV;

    // Content that would fail when enabled must pass through untouched when off.
    const input = 'SELECT ${PG-HOST}, ${}, ${PG_HOST FROM t';

    expect(substitute_env(input)).toBe(input);
  });

  it('substitutes ${VAR} from the environment when enabled', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    process.env.PG_HOST = 'postgres';
    process.env.PG_PORT = '5432';

    const input = "SOURCE(POSTGRESQL(HOST '${PG_HOST}' PORT ${PG_PORT}))";
    const output = "SOURCE(POSTGRESQL(HOST 'postgres' PORT 5432))";

    expect(substitute_env(input)).toBe(output);
  });

  it('substitutes the same placeholder multiple times', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    process.env.X = 'a';

    expect(substitute_env('${X}-${X}')).toBe('a-a');
  });

  it('throws when a referenced variable is not set', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    delete process.env.MISSING;

    expect(() => substitute_env('${MISSING}')).toThrow(/MISSING/);
  });

  it('allows escaping a literal placeholder', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    process.env.FOO = 'bar';

    expect(substitute_env('$${FOO}')).toBe('${FOO}');
  });

  it('allows literal placeholders in SQL strings and comments', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';

    const input = "SELECT '$${NOT_A_VARIABLE}'; -- example: $${OTHER}";
    const output = "SELECT '${NOT_A_VARIABLE}'; -- example: ${OTHER}";

    expect(substitute_env(input)).toBe(output);
  });

  it('rejects malformed placeholders', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';

    expect(() => substitute_env('${PG-HOST}')).toThrow(/invalid environment placeholder/);
    expect(() => substitute_env('${}')).toThrow(/invalid environment placeholder/);
  });

  it('rejects unterminated placeholders', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';

    expect(() => substitute_env('${PG_HOST')).toThrow(/unterminated environment placeholder/);
  });

  it('accepts an empty environment value', () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    process.env.EMPTY_VALUE = '';

    expect(substitute_env('before-${EMPTY_VALUE}-after')).toBe('before--after');
  });
});
