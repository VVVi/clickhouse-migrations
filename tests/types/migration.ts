// Compile against the package entry point, as a consuming application would.
import { migration, type MigrationOptions } from '../..';

const options: MigrationOptions = {
  migrations_home: './migrations',
  host: 'http://localhost:8123',
  username: 'default',
  password: '',
  db_name: 'analytics',
};

const result: Promise<void> = migration(options);
void result;
void migration({ ...options, timeout: '60000', table_engine: 'MergeTree', skip_db_creation: true });
void migration({ ...options, timeout: '60000' });
void migration('./migrations', options.host, 'default', '', 'analytics');
void migration('./migrations', options.host, 'default', '', 'analytics', undefined, undefined, '60000');
const legacyArgs: Parameters<typeof migration> = [
  './migrations',
  options.host,
  'default',
  '',
  'analytics',
  'ENGINE=Atomic',
  'MergeTree',
  '60000',
  'ca.pem',
  'client.pem',
  'key.pem',
  true,
];
void migration(...legacyArgs);
const legacyResult: Promise<void> = migration.call(undefined, ...legacyArgs);
void legacyResult;

// @ts-expect-error Required connection options cannot be omitted.
void migration({ migrations_home: './migrations' });
// @ts-expect-error Misspelled object options should fail at compile time.
void migration({ ...options, tableEngine: 'MergeTree' });
// @ts-expect-error Database creation is a boolean option.
void migration({ ...options, skip_db_creation: 'true' });
// @ts-expect-error Invalid timeout types should fail at compile time.
void migration({ ...options, timeout: false });
// @ts-expect-error Host must be a string.
void migration({ ...options, host: 8123 });
// @ts-expect-error Positional calls still require all five connection arguments.
void migration('./migrations', options.host);
// @ts-expect-error Named and positional forms cannot be mixed.
void migration(options, options.host);
