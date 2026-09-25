import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

import { describe, it, expect, jest } from '@jest/globals';

import { migration } from '../src/migrate';

jest.mock('@clickhouse/client', () => ({ createClient: () => createClient1 }));

const createClient1 = {
  query: jest.fn((params: { query: string }) => {
    if (params && params.query && params.query.includes('system.databases')) {
      return Promise.resolve({ json: () => [{ ok: 1 }] });
    }
    return Promise.resolve({ json: () => [] });
  }),
  command: jest.fn<(params: unknown) => Promise<object>>(() => Promise.resolve({})),
  insert: jest.fn<(params: unknown) => Promise<object>>(() => Promise.resolve({})),
  close: jest.fn(() => Promise.resolve()),
  ping: jest.fn(() => Promise.resolve()),
};

describe('Migration tests', () => {
  // beforeEach(() => {
  //   jest.clearAllMocks();
  //   jest.resetAllMocks();
  //   jest.resetModules();
  // });

  it('First migration', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const querySpy = jest.spyOn(createClient1, 'query') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandSpy = jest.spyOn(createClient1, 'command') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertSpy = jest.spyOn(createClient1, 'insert') as jest.MockedFunction<any>;

    await migration('tests/migrations/one', 'http://sometesthost:8123', 'default', '', 'analytics');

    expect(commandSpy).toHaveBeenCalledTimes(3);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);

    expect(commandSpy).toHaveBeenNthCalledWith(1, {
      query: 'CREATE DATABASE IF NOT EXISTS "analytics"',
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    expect(commandSpy).toHaveBeenNthCalledWith(2, {
      query: `CREATE TABLE IF NOT EXISTS _migrations (
      uid UUID DEFAULT generateUUIDv4(),
      version UInt32,
      checksum String,
      migration_name String,
      applied_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree
    ORDER BY tuple(applied_at)`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    expect(commandSpy).toHaveBeenNthCalledWith(3, {
      clickhouse_settings: { allow_experimental_json_type: '1' },
      query:
        'CREATE TABLE IF NOT EXISTS `events` ( `event_id` UInt64, `event_data` JSON ) ENGINE=MergeTree() ORDER BY (`event_id`) SETTINGS index_granularity = 8192',
    });

    expect(querySpy).toHaveBeenNthCalledWith(1, {
      format: 'JSONEachRow',
      query: 'SELECT version, checksum, migration_name FROM _migrations ORDER BY version',
    });

    expect(insertSpy).toHaveBeenNthCalledWith(1, {
      format: 'JSONEachRow',
      table: '_migrations',
      values: [{ checksum: '2f66edf1a8c3fa2e29835ad9ac8140a7', migration_name: '1_init.sql', version: 1 }],
    });
  });

  it('Skip database creation', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandSpy = jest.spyOn(createClient1, 'command') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const querySpy = jest.spyOn(createClient1, 'query') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertSpy = jest.spyOn(createClient1, 'insert') as jest.MockedFunction<any>;

    jest.clearAllMocks();

    await migration(
      'tests/migrations/one',
      'http://sometesthost:8123',
      'default',
      '',
      'analytics',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(commandSpy).toHaveBeenCalledTimes(2);
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(insertSpy).toHaveBeenCalledTimes(1);

    // First query verifies the database exists when --skip-db-creation is set.
    expect(querySpy).toHaveBeenNthCalledWith(1, {
      query: `SELECT 1 AS ok FROM system.databases WHERE name = {db_name:String}`,
      query_params: { db_name: 'analytics' },
      format: 'JSONEachRow',
    });

    expect(commandSpy).toHaveBeenNthCalledWith(1, {
      query: `CREATE TABLE IF NOT EXISTS _migrations (
      uid UUID DEFAULT generateUUIDv4(),
      version UInt32,
      checksum String,
      migration_name String,
      applied_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree
    ORDER BY tuple(applied_at)`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });

    expect(commandSpy).toHaveBeenNthCalledWith(2, {
      clickhouse_settings: { allow_experimental_json_type: '1' },
      query:
        'CREATE TABLE IF NOT EXISTS `events` ( `event_id` UInt64, `event_data` JSON ) ENGINE=MergeTree() ORDER BY (`event_id`) SETTINGS index_granularity = 8192',
    });
  });

  it('Skip database creation but database does not exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const querySpy = jest.spyOn(createClient1, 'query') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandSpy = jest.spyOn(createClient1, 'command') as jest.MockedFunction<any>;

    jest.clearAllMocks();

    // Override query mock so the system.databases lookup returns no rows.
    querySpy.mockImplementationOnce(() => Promise.resolve({ json: () => [] }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      migration(
        'tests/migrations/one',
        'http://sometesthost:8123',
        'default',
        '',
        'missing_db',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    const errorMessage = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(errorMessage).toMatch(/missing_db/);
    expect(errorMessage).toMatch(/--skip-db-creation/);

    // Should not have attempted to create _migrations table or run any migrations.
    expect(commandSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('Env var substitution at migration level', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('applies substituted SQL but stores the raw-file checksum', async () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    process.env.PG_HOST = 'pg.internal';
    process.env.PG_PORT = '5432';
    process.env.PG_DB = 'analytics';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandSpy = jest.spyOn(createClient1, 'command') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertSpy = jest.spyOn(createClient1, 'insert') as jest.MockedFunction<any>;

    await migration('tests/migrations/env', 'http://sometesthost:8123', 'default', '', 'analytics');

    // client.command() receives the substituted SQL (placeholders -> env values).
    expect(commandSpy).toHaveBeenNthCalledWith(3, {
      clickhouse_settings: {},
      query:
        "CREATE OR REPLACE DICTIONARY dict_offers ( `id` UUID, `name` String DEFAULT '' ) PRIMARY KEY id SOURCE(POSTGRESQL(HOST 'pg.internal' PORT 5432 DB 'analytics' TABLE 'offers')) LIFETIME(MIN 0 MAX 300) LAYOUT(COMPLEX_KEY_HASHED())",
    });

    // _migrations receives the checksum of the original, unsubstituted file.
    const raw = fs.readFileSync('tests/migrations/env/1_env.sql').toString();
    const rawChecksum = crypto.createHash('md5').update(raw).digest('hex');

    expect(insertSpy).toHaveBeenNthCalledWith(1, {
      format: 'JSONEachRow',
      table: '_migrations',
      values: [{ checksum: rawChecksum, migration_name: '1_env.sql', version: 1 }],
    });
  });

  it('preserves the original SQL when substitution is disabled', async () => {
    delete process.env.CH_MIGRATIONS_SUBSTITUTE_ENV;
    process.env.PG_HOST = 'pg.internal';
    process.env.PG_PORT = '5432';
    process.env.PG_DB = 'analytics';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandSpy = jest.spyOn(createClient1, 'command') as jest.MockedFunction<any>;

    await migration('tests/migrations/env', 'http://sometesthost:8123', 'default', '', 'analytics');

    // The placeholders are left untouched - executed SQL matches the raw file.
    expect(commandSpy).toHaveBeenNthCalledWith(3, {
      clickhouse_settings: {},
      query:
        "CREATE OR REPLACE DICTIONARY dict_offers ( `id` UUID, `name` String DEFAULT '' ) PRIMARY KEY id SOURCE(POSTGRESQL(HOST '${PG_HOST}' PORT ${PG_PORT} DB '${PG_DB}' TABLE 'offers')) LIFETIME(MIN 0 MAX 300) LAYOUT(COMPLEX_KEY_HASHED())",
    });
  });
});

describe('SQL parsing at migration level', () => {
  const originalEnv = process.env;
  let migrationsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickhouse-migrations-parse-'));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('attaches file-wide settings to every query and records the original checksum', async () => {
    const content =
      "SELECT 'line1; -- comment\n  line2';\nSET max_threads = 1,\n log_comment = 'ticket; -- # 42';\nSELECT 2;";
    fs.writeFileSync(path.join(migrationsDir, '1_parse.sql'), content);

    await migration(migrationsDir, 'http://sometesthost:8123', 'default', '', 'analytics');

    const settings = { max_threads: '1', log_comment: 'ticket; -- # 42' };
    expect(createClient1.command).toHaveBeenCalledTimes(4);
    expect(createClient1.command).toHaveBeenNthCalledWith(3, {
      query: "SELECT 'line1; -- comment\n  line2'",
      clickhouse_settings: settings,
    });
    expect(createClient1.command).toHaveBeenNthCalledWith(4, {
      query: 'SELECT 2',
      clickhouse_settings: settings,
    });
    expect(createClient1.insert).toHaveBeenCalledWith({
      table: '_migrations',
      values: [
        { version: 1, checksum: crypto.createHash('md5').update(content).digest('hex'), migration_name: '1_parse.sql' },
      ],
      format: 'JSONEachRow',
    });
  });

  it('uses the last setting for the entire file without leaking it into the next file', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_first.sql'),
      'SELECT 1; SET max_threads = 1; SELECT 2; SET max_threads = 2, wait_end_of_query = 1;',
    );
    fs.writeFileSync(path.join(migrationsDir, '2_second.sql'), 'SELECT 3;');

    await migration(migrationsDir, 'http://sometesthost:8123', 'default', '', 'analytics');

    expect(createClient1.command.mock.calls.slice(2).map(([command]) => command)).toEqual([
      { query: 'SELECT 1', clickhouse_settings: { max_threads: '2', wait_end_of_query: '1' } },
      { query: 'SELECT 2', clickhouse_settings: { max_threads: '2', wait_end_of_query: '1' } },
      { query: 'SELECT 3', clickhouse_settings: {} },
    ]);
    expect(createClient1.insert).toHaveBeenCalledTimes(2);
  });

  it('preserves separators and comments introduced into quoted SQL by environment substitution', async () => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    process.env.SQL_PARSE_TEST_VALUE = 'first; -- # /* literal */\n  second';
    const content = "SET log_comment = '${SQL_PARSE_TEST_VALUE}'; SELECT '${SQL_PARSE_TEST_VALUE}';";
    fs.writeFileSync(path.join(migrationsDir, '1_parse.sql'), content);

    await migration(migrationsDir, 'http://sometesthost:8123', 'default', '', 'analytics');

    expect(createClient1.command).toHaveBeenCalledTimes(3);
    expect(createClient1.command).toHaveBeenNthCalledWith(3, {
      query: "SELECT 'first; -- # /* literal */\n  second'",
      clickhouse_settings: { log_comment: 'first; -- # /* literal */\n  second' },
    });
    expect(createClient1.insert).toHaveBeenCalledWith({
      table: '_migrations',
      values: [
        { version: 1, checksum: crypto.createHash('md5').update(content).digest('hex'), migration_name: '1_parse.sql' },
      ],
      format: 'JSONEachRow',
    });
  });

  it('stops after a server error without recording the failed file or executing later statements', async () => {
    fs.writeFileSync(path.join(migrationsDir, '1_parse.sql'), 'SELECT 1; SELECT 2; SELECT 3;');
    createClient1.command
      .mockResolvedValueOnce({}) // Create the database.
      .mockResolvedValueOnce({}) // Create the migration table.
      .mockResolvedValueOnce({}) // Execute SELECT 1.
      .mockRejectedValueOnce(new Error('query failed')); // Fail SELECT 2.
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(migration(migrationsDir, 'http://sometesthost:8123', 'default', '', 'analytics')).rejects.toThrow(
        'process.exit',
      );
      expect(createClient1.command).toHaveBeenCalledTimes(4);
      expect(createClient1.command).toHaveBeenLastCalledWith({ query: 'SELECT 2', clickhouse_settings: {} });
      expect(createClient1.insert).not.toHaveBeenCalled();
      const message = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(message).toContain('1_parse.sql');
      expect(message).toContain('query failed');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it.each([
    ["SELECT 1; SELECT 'unclosed", 'unterminated string literal'],
    ['SELECT 1; SELECT "unclosed', 'unterminated quoted identifier'],
    ['SELECT 1; SELECT `unclosed', 'unterminated quoted identifier'],
    ['SELECT 1; /* unclosed', 'unterminated block comment'],
    ['SELECT 1; SELECT $tag$unclosed', 'unterminated dollar-quoted string'],
    ['SELECT 1; SET max_threads = 1, invalid;', 'invalid SET assignment'],
    ["SELECT 1; SELECT '${SQL_PARSE_TEST_MISSING}';", 'environment variable SQL_PARSE_TEST_MISSING is not set'],
    ["SELECT 1; SELECT '${SQL_PARSE_TEST_VALUE}';", 'unterminated string literal'],
  ])('stops before executing any statement from a malformed file: %s', async (content, error) => {
    process.env.CH_MIGRATIONS_SUBSTITUTE_ENV = 'true';
    delete process.env.SQL_PARSE_TEST_MISSING;
    process.env.SQL_PARSE_TEST_VALUE = "'";
    fs.writeFileSync(path.join(migrationsDir, '1_parse.sql'), content);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(migration(migrationsDir, 'http://sometesthost:8123', 'default', '', 'analytics')).rejects.toThrow(
        'process.exit',
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      const message = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(message).toContain('1_parse.sql');
      expect(message).toContain(error);
      // Database/table initialization happens first, but no SQL from this file runs.
      expect(createClient1.command).toHaveBeenCalledTimes(2);
      expect(createClient1.insert).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
