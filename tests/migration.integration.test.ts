import { describe, it, expect, jest } from '@jest/globals';

import { migration } from '../src/migrate';

jest.mock('@clickhouse/client', () => ({ createClient: () => createClient1 }));

const createClient1 = {
  query: jest.fn(() => Promise.resolve({ json: () => [] })),
  exec: jest.fn(() => Promise.resolve({})),
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
    const execSpy = jest.spyOn(createClient1, 'exec') as jest.MockedFunction<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertSpy = jest.spyOn(createClient1, 'insert') as jest.MockedFunction<any>;

    await migration('tests/migrations/one', 'http://sometesthost:8123', 'default', '', 'analytics');

    expect(execSpy).toHaveBeenCalledTimes(3);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);

    expect(execSpy).toHaveBeenNthCalledWith(1, {
      query: 'CREATE DATABASE IF NOT EXISTS "analytics"',
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    expect(execSpy).toHaveBeenNthCalledWith(2, {
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
    expect(execSpy).toHaveBeenNthCalledWith(3, {
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
    const execSpy = jest.spyOn(createClient1, 'exec') as jest.MockedFunction<any>;
    const querySpy = jest.spyOn(createClient1, 'query') as jest.MockedFunction<any>;
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
      true,
    );

    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);

    expect(execSpy).toHaveBeenNthCalledWith(1, {
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
    expect(execSpy).toHaveBeenNthCalledWith(2, {
      clickhouse_settings: { allow_experimental_json_type: '1' },
      query:
        'CREATE TABLE IF NOT EXISTS `events` ( `event_id` UInt64, `event_data` JSON ) ENGINE=MergeTree() ORDER BY (`event_id`) SETTINGS index_granularity = 8192',
    });
  });
});
