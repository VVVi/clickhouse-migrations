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
  command: jest.fn(() => Promise.resolve({})),
  insert: jest.fn(() => Promise.resolve({})),
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
