import { createClient, type ClickHouseClient } from '@clickhouse/client';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migration, type MigrationOptions } from '../src/migrate';

jest.mock('@clickhouse/client', () => ({ createClient: jest.fn() }));

const makeClient = () => ({
  ping: jest.fn().mockResolvedValue({ success: true }),
  command: jest.fn().mockResolvedValue({}),
  query: jest.fn().mockResolvedValue({ json: async () => [] }),
  insert: jest.fn().mockResolvedValue({}),
  close: jest.fn().mockResolvedValue(undefined),
});

const mockCreateClient = jest.mocked(createClient);
const exitError = new Error('process.exit');
let setupClient: ReturnType<typeof makeClient>;
let migrationClient: ReturnType<typeof makeClient>;
let options: MigrationOptions;
let directory: string;

beforeEach(() => {
  jest.clearAllMocks();
  setupClient = makeClient();
  migrationClient = makeClient();
  mockCreateClient.mockImplementation(
    (config) => (config?.database ? migrationClient : setupClient) as unknown as ClickHouseClient,
  );
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clickhouse-library-'));
  fs.writeFileSync(path.join(directory, '1_init.sql'), 'SELECT 1;');
  options = {
    migrations_home: directory,
    host: 'http://clickhouse:8123',
    username: 'default',
    password: '',
    db_name: 'analytics',
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(process, 'exit').mockImplementation(() => {
    throw exitError;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

const run = (form: 'object' | 'positional') =>
  form === 'object'
    ? migration(options)
    : migration(
        options.migrations_home,
        options.host,
        options.username,
        options.password,
        options.db_name,
        options.db_engine,
        options.table_engine,
        options.timeout,
        options.ca_cert,
        options.cert,
        options.key,
        options.skip_db_creation,
      );

const calls = () => ({
  connections: mockCreateClient.mock.calls,
  setup: setupClient.command.mock.calls,
  verification: setupClient.query.mock.calls,
  commands: migrationClient.command.mock.calls,
  queries: migrationClient.query.mock.calls,
  inserts: migrationClient.insert.mock.calls,
  setupClose: setupClient.close.mock.calls,
  migrationClose: migrationClient.close.mock.calls,
});

it.each(['defaults', 'timeout only', 'all options', 'skip database creation'])(
  'runs the same operations for object and positional calls: %s',
  async (configuration) => {
    if (configuration === 'timeout only') options.timeout = '60000';
    if (configuration === 'all options') {
      const certificates = path.join(__dirname, '..', '.docker', 'clickhouse_tls', 'certificates');
      Object.assign(options, {
        host: 'https://clickhouse:8443',
        db_engine: 'ENGINE=Atomic',
        table_engine: 'ReplacingMergeTree',
        timeout: '45000',
        ca_cert: path.join(certificates, 'ca.crt'),
        cert: path.join(certificates, 'client.crt'),
        key: path.join(certificates, 'client.key'),
      });
    }
    if (configuration === 'skip database creation') {
      options.skip_db_creation = true;
      setupClient.query.mockResolvedValue({ json: async () => [{ ok: 1 }] });
    }

    await run('positional');
    const positionalCalls = calls();
    jest.clearAllMocks();
    await run('object');
    expect(calls()).toEqual(positionalCalls);
    expect(migrationClient.insert).toHaveBeenCalledTimes(1);
    expect(setupClient.close).toHaveBeenCalledTimes(1);
    expect(migrationClient.close).toHaveBeenCalledTimes(1);

    if (configuration === 'timeout only') {
      expect(mockCreateClient.mock.calls[1][0]).toMatchObject({ request_timeout: 60000 });
      expect(migrationClient.command.mock.calls[0][0].query).toContain('ENGINE = MergeTree');
    }
  },
);

it.each(['object', 'positional'] as const)('keeps log-and-exit behavior for %s calls', async (form) => {
  migrationClient.command.mockRejectedValueOnce(new Error('table creation failed'));
  await expect(run(form)).rejects.toBe(exitError);
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(console.error).toHaveBeenCalledWith(
    '\x1b[36m',
    'clickhouse-migrations :',
    '\x1b[31m',
    "Error: can't create the _migrations table.",
    '\n\n table creation failed',
  );
  expect(migrationClient.close).not.toHaveBeenCalled();
});

it.each(['object', 'positional'] as const)('keeps unhandled errors catchable for %s calls', async (form) => {
  const error = new Error('SQL file is unreadable');
  jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
    throw error;
  });
  await expect(run(form)).rejects.toBe(error);
  expect(process.exit).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  expect(migrationClient.close).not.toHaveBeenCalled();
});
