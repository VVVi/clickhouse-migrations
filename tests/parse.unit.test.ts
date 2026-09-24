import { describe, it, expect } from '@jest/globals';

import { sql_queries, substitute_env } from '../src/sql-parse';

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
  it.each(['', ' \t\r\n ', ';;;', '-- SELECT 1;\n/* SET a = 1; */;'])(
    'returns no queries or settings for empty SQL: %j',
    (input) => {
      expect(sql_queries(input)).toEqual([]);
    },
  );

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

  it('accepts numeric dollar tags and does not mistake identifier suffixes for strings', () => {
    expect(sql_queries('SELECT $1$a;b$1$; SELECT metric$tag$;')).toEqual(['SELECT $1$a;b$1$', 'SELECT metric$tag$']);
  });

  it('keeps tokens separated when removing comments and skips empty statements', () => {
    expect(sql_queries('; /* header; */ ; SELECT/* gap */1; // comment;\nSELECT 2; -- end')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
    expect(sql_queries('/* only a comment */; -- end')).toEqual([]);
  });

  it.each(['"', '`'])('preserves escapes and comment markers inside %s identifiers', (quote) => {
    const query = `SELECT ${quote}a${quote}${quote}b; -- c\\${quote}d${quote} FROM t`;
    expect(sql_queries(`${query}; SELECT 2;`)).toEqual([query, 'SELECT 2']);
  });

  it.each(["'", '"', '`'])('distinguishes escaped backslashes from escaped %s quotes', (quote) => {
    const endingInBackslash = `SELECT ${quote}value\\\\${quote}`;
    const containingEscapedQuote = `SELECT ${quote}value\\\\\\${quote}; still quoted${quote}`;

    expect(sql_queries(`${endingInBackslash}; ${containingEscapedQuote}; SELECT 2;`)).toEqual([
      endingInBackslash,
      containingEscapedQuote,
      'SELECT 2',
    ]);
  });

  it.each(["'", '"', '`'])('rejects a trailing backslash inside an unclosed %s quote', (quote) => {
    expect(() => sql_queries(`SELECT ${quote}unfinished\\`)).toThrow(/unterminated .*line 1, column 8/);
  });

  it.each(['\n', '\r\n', '\r'])('ends line comments and reports error positions with %j line endings', (newline) => {
    const prefix = `-- ignore ' ;${newline}SELECT 1;${newline}`;
    expect(sql_queries(`${prefix}SELECT 2;`)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(() => sql_queries(`${prefix}  SELECT 'unfinished`)).toThrow(
      'unterminated string literal starting at line 3, column 10',
    );
  });

  it('ignores quotes and settings inside nested comments', () => {
    expect(sql_queries(`/* ' " \` $tag$; /* nested */ SET a = 1; */ SELECT 1;`)).toEqual(['SELECT 1']);
    expect(() => sql_queries('/* outer /* inner */ SELECT 1;')).toThrow(
      'unterminated block comment starting at line 1, column 1',
    );
  });

  it('closes dollar-quoted strings only at the matching, case-sensitive tag', () => {
    const query = "SELECT $tag$one; $TAG$ two; $$ three; ' /* $tag$";
    expect(sql_queries(`${query}; SELECT $$$$;`)).toEqual([query, 'SELECT $$$$']);
    expect(() => sql_queries('SELECT $tag$value$TAG$;')).toThrow(/unterminated dollar-quoted string/);
  });

  it('does not treat SET inside a string literal as a settings statement', () => {
    const input = "INSERT INTO t (s) VALUES ('SET a = 1');";

    expect(sql_queries(input)).toEqual(["INSERT INTO t (s) VALUES ('SET a = 1')"]);
  });

  it('rejects an unterminated string, identifier, dollar-quote or block comment instead of swallowing the file', () => {
    expect(() => sql_queries("SELECT 1; SELECT 'oops; SET a = 1; SELECT 2;")).toThrow(
      /unterminated string literal starting at line 1, column 18/,
    );
    expect(() => sql_queries('SELECT `a;')).toThrow(/unterminated quoted identifier/);
    expect(() => sql_queries("SELECT '\u{1D11E}abc', 'unterminated")).toThrow(/line 1, column 16/);
    expect(() => sql_queries('SELECT 1; SELECT $tag$oops; SET a=1; SELECT 2;')).toThrow(
      /unterminated dollar-quoted string \$tag\$/,
    );
    expect(() => sql_queries('SELECT 1;\n/* never closed; SELECT 2;')).toThrow(
      /unterminated block comment starting at line 2, column 1/,
    );
  });

  it('sends SET ROLE / SET DEFAULT ROLE / SET TRANSACTION SNAPSHOT as statements, not settings', () => {
    const input =
      'SET ROLE writer;\nSET DEFAULT ROLE ALL TO user1;\nSET TRANSACTION SNAPSHOT 123;\nSET max_threads = 2;\nSELECT 1;';

    expect(sql_queries(input)).toEqual([
      'SET ROLE writer',
      'SET DEFAULT ROLE ALL TO user1',
      'SET TRANSACTION SNAPSHOT 123',
      'SET max_threads = 2',
      'SELECT 1',
    ]);
  });

  it('keeps multiline SET statements in order regardless of case', () => {
    const input = 'set a = 1;\nSET b = 2,\n    c = 3;\nSELECT 1;';

    expect(sql_queries(input)).toEqual(['set a = 1', 'SET b = 2, c = 3', 'SELECT 1']);
  });
});

describe('SQL delegated to ClickHouse', () => {
  it.each([
    'SET force_index_by_date',
    "SET TIME ZONE 'UTC'",
    "SET TIME ZONE = 'Europe/Amsterdam'",
    "SET param_d = {'10': [11, 12], '13': [14, 15]}",
    'SET param_tuple = (1, [2, 3])',
    'SET max_threads = DEFAULT',
    'SET size = 18446744073709551615, ratio = -1.25e-3',
    String.raw`SET log_comment = 'a, b = c; \n\t\x41\%\\n\'it''s'`,
    String.raw`SET log_comment = $tag$a, b; -- c\n$tag$`,
    "SET log_comment = '  first\n\tsecond  '",
    'SET param_table = "events"',
  ])('preserves the statement for the server: %s', (statement) => {
    expect(sql_queries(`${statement}; SELECT 1;`)).toEqual([statement, 'SELECT 1']);
  });

  it('keeps repeated settings in their original positions', () => {
    expect(sql_queries('SELECT 1; SET max_threads = 1; SELECT 2; SET max_threads = 2; SELECT 3;')).toEqual([
      'SELECT 1',
      'SET max_threads = 1',
      'SELECT 2',
      'SET max_threads = 2',
      'SELECT 3',
    ]);
  });

  it('removes comments between setting tokens while preserving inline query settings', () => {
    expect(
      sql_queries(
        "SET/* options */max_threads/* name */=2,\nlog_comment='https://host'; SELECT 1 SETTINGS max_threads=3;",
      ),
    ).toEqual(["SET max_threads =2, log_comment='https://host'", 'SELECT 1 SETTINGS max_threads=3']);
  });
});

describe('Inline INSERT data', () => {
  it.each([
    'INSERT INTO t FORMAT CSV\n1,hello;world\n2,next',
    'INSERT INTO t (id, note) FORMAT TabSeparated\n1\ta\tb',
    'INSERT INTO `format` FORMAT JSONEachRow\n{"value": "unclosed',
    'insert into db.t format/* data */CSV\n1,value',
    "INSERT INTO FUNCTION remote('host', db, t) FORMAT CSV\n1,value",
    'SELECT 1; INSERT INTO t SETTINGS async_insert=0 FORMAT CSV\n1,value',
    'INSERT INTO t FORMAT `CSV`\n1,value',
    'WITH 1 AS n INSERT INTO t FORMAT CSV\n1,value',
    'INSERT INTO TABLE select FORMAT CSV\n1,value',
    'INSERT INTO TABLE values FORMAT CSV\n1,value',
    'INSERT INTO "TABLE" FORMAT CSV\n1,value',
    "INSERT INTO t SELECT * FROM input('id UInt8, note String') FORMAT CSV\n1,hello;world",
    "INSERT INTO t SELECT * FROM (SELECT * FROM input('id UInt8')) FORMAT CSV\n1",
    'INSERT INTO t SELECT * FROM "input"(\'id UInt8\') FORMAT CSV\n1',
    "INSERT INTO t SELECT * FROM `input`/* data */('id UInt8') FORMAT CSV\n1",
  ])('rejects non-SQL data before attempting to split it: %s', (input) => {
    expect(() => sql_queries(input)).toThrow(/inline INSERT FORMAT data is not supported.*INSERT VALUES/);
  });

  it.each([
    "INSERT INTO t VALUES (1, 'FORMAT CSV; -- literal')",
    'INSERT INTO format VALUES (1)',
    'INSERT INTO TABLE format VALUES (1)',
    'INSERT INTO TABLE select VALUES (1)',
    'INSERT INTO TABLE values VALUES (1)',
    'INSERT INTO db.format (format) VALUES (1)',
    'INSERT INTO t SELECT format FROM source',
    'INSERT INTO t SELECT * FROM input AS format WHERE format.id > 0',
    "INSERT INTO t SELECT format('{}', 1)",
    'SELECT 1 FORMAT JSONEachRow',
    "INSERT INTO t SETTINGS format='CSV' VALUES (1)",
    'INSERT INTO t SELECT 1 FORMAT CSV',
  ])('allows SQL queries with FORMAT-like identifiers or output formatting: %s', (query) => {
    expect(sql_queries(`${query};`)).toEqual([query]);
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
