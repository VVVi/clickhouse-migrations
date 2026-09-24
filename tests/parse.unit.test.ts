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

describe('Sql query parse: quoting and comments (issue #52)', () => {
  it("does not split on ';' inside a single-quoted string", () => {
    const input = "SELECT throwIf(count() > 0, 'view not stopped; see header') FROM system.view_refreshes;";

    expect(sql_queries(input)).toEqual([
      "SELECT throwIf(count() > 0, 'view not stopped; see header') FROM system.view_refreshes",
    ]);
  });

  it("does not split on ';' inside quoted identifiers", () => {
    const input = 'CREATE TABLE t (`a;b` String, "c;d" String) ENGINE = Memory;';

    expect(sql_queries(input)).toEqual(['CREATE TABLE t (`a;b` String, "c;d" String) ENGINE = Memory']);
  });

  it('keeps comment markers that sit inside a string literal', () => {
    const input =
      "SELECT throwIf(count() > 0, 'not stopped -- see header') FROM t;\nINSERT INTO t (id, note) VALUES (1, 'ticket # 42'), (2, 'shebang #! here');";

    expect(sql_queries(input)).toEqual([
      "SELECT throwIf(count() > 0, 'not stopped -- see header') FROM t",
      "INSERT INTO t (id, note) VALUES (1, 'ticket # 42'), (2, 'shebang #! here')",
    ]);
  });

  it('keeps escaped and doubled quotes inside a string literal', () => {
    const input = "INSERT INTO t (s) VALUES ('it''s; fine'), ('back\\'slash; too');";

    expect(sql_queries(input)).toEqual(["INSERT INTO t (s) VALUES ('it''s; fine'), ('back\\'slash; too')"]);
  });

  it('preserves whitespace and newlines inside a string literal', () => {
    const input = "INSERT INTO t (s) VALUES ('line1\n  line2   end');";

    expect(sql_queries(input)).toEqual(["INSERT INTO t (s) VALUES ('line1\n  line2   end')"]);
  });

  it('removes block comments, including nested ones and ones containing ;', () => {
    const input =
      '/* step 1; stop the view */\nSYSTEM STOP REPLICATED VIEW db.mv; /* outer /* inner; */ still outer */ SELECT 1;';

    expect(sql_queries(input)).toEqual(['SYSTEM STOP REPLICATED VIEW db.mv', 'SELECT 1']);
  });

  it('keeps a block comment that is inside a string literal', () => {
    const input = "SELECT '/* not a comment; */';";

    expect(sql_queries(input)).toEqual(["SELECT '/* not a comment; */'"]);
  });

  it('treats # as a comment only when followed by ! or whitespace', () => {
    const input = 'SELECT 1 AS a#b;\n# real comment; with semicolon\nSELECT 2;';

    expect(sql_queries(input)).toEqual(['SELECT 1 AS a#b', 'SELECT 2']);
  });

  it('handles CRLF line endings and a trailing statement without ;', () => {
    const input = '-- header\r\nSELECT 1;\r\nSELECT 2';

    expect(sql_queries(input)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('keeps dollar-quoted strings intact', () => {
    const input = "SELECT $$a; 'b' -- c$$;\nSELECT $tag$x; y$tag$;";

    expect(sql_queries(input)).toEqual(["SELECT $$a; 'b' -- c$$", 'SELECT $tag$x; y$tag$']);
  });

  it('does not treat SET inside a string literal as a settings statement', () => {
    const input = "INSERT INTO t (s) VALUES ('SET a = 1');";

    expect(sql_queries(input)).toEqual(["INSERT INTO t (s) VALUES ('SET a = 1')"]);
    expect(sql_sets(input)).toEqual({});
  });

  it('rejects an unterminated string, identifier, dollar-quote or block comment instead of swallowing the file', () => {
    expect(() => sql_queries("SELECT 1; SELECT 'oops; SET a = 1; SELECT 2;")).toThrow(
      /unterminated string literal starting at line 1, column 18/,
    );
    expect(() => sql_queries('SELECT `a;')).toThrow(/unterminated quoted identifier/);
    expect(() => sql_queries('SELECT 1; SELECT $tag$oops; SET a=1; SELECT 2;')).toThrow(
      /unterminated dollar-quoted string \$tag\$/,
    );
    expect(() => sql_queries('SELECT 1;\n/* never closed; SELECT 2;')).toThrow(
      /unterminated block comment starting at line 2, column 1/,
    );
  });

  it('sends SET ROLE / SET DEFAULT ROLE / SET TRANSACTION SNAPSHOT as statements, not settings', () => {
    const input = 'SET ROLE writer;\nSET DEFAULT ROLE ALL TO user1;\nSET max_threads = 2;\nSELECT 1;';

    expect(sql_queries(input)).toEqual(['SET ROLE writer', 'SET DEFAULT ROLE ALL TO user1', 'SELECT 1']);
    expect(sql_sets(input)).toEqual({ max_threads: '2' });
  });

  it('excludes SET statements from the queries regardless of case and line layout', () => {
    const input = 'set a = 1;\nSET b = 2,\n    c = 3;\nSELECT 1;';

    expect(sql_queries(input)).toEqual(['SELECT 1']);
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

  it('reads a multi-line SET with several settings (issue #52)', () => {
    const input = 'SET a = 1,\n    b = 2;\nSELECT 1;';

    expect(sql_sets(input)).toEqual({ a: '1', b: '2' });
  });

  it('keeps whitespace inside a quoted setting value and removes the quotes', () => {
    const input = "SET some_string_setting = 'a b';\nSET other = 'it''s';\nSELECT 1;";

    expect(sql_sets(input)).toEqual({ some_string_setting: 'a b', other: "it's" });
  });

  it("does not split a quoted value on ',' or '='", () => {
    const input = "SET fmt = 'a, b = c', n = 5;";

    expect(sql_sets(input)).toEqual({ fmt: 'a, b = c', n: '5' });
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
