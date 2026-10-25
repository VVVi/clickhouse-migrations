import { createClient } from '@clickhouse/client';
import type { ClickHouseClient, ClickHouseClientConfigOptions } from '@clickhouse/client';
import { Command } from 'commander';
import fs from 'fs';
import crypto from 'crypto';

import { parse_migration_sql, substitute_env } from './sql-parse';
import { VERSION } from './version';

const log = (type: 'info' | 'error' = 'info', message: string, error?: string) => {
  if (type === 'info') {
    console.log('\x1b[36m', `clickhouse-migrations :`, '\x1b[0m', message);
  } else {
    console.error('\x1b[36m', `clickhouse-migrations :`, '\x1b[31m', `Error: ${message}`, error ? `\n\n ${error}` : '');
  }
};

const connect = (
  url: string,
  username: string,
  password: string,
  db_name?: string,
  timeout?: string,
  ca_cert?: string,
  cert?: string,
  key?: string,
): ClickHouseClient => {
  const db_params: ClickHouseClientConfigOptions = {
    url,
    username,
    password,
    application: 'clickhouse-migrations',
  };

  if (db_name) {
    db_params.database = db_name;
  }

  if (timeout) {
    db_params.request_timeout = Number(timeout);
  }

  if (ca_cert) {
    try {
      if (cert && key) {
        db_params.tls = {
          ca_cert: fs.readFileSync(ca_cert),
          cert: fs.readFileSync(cert),
          key: fs.readFileSync(key),
        };
      } else {
        db_params.tls = {
          ca_cert: fs.readFileSync(ca_cert),
        };
      }
    } catch (e: unknown) {
      throw new Error('Failed to read CA certificate file for TLS connection.', { cause: e });
    }
  }
  return createClient(db_params);
};

const create_db = async (
  host: string,
  username: string,
  password: string,
  db_name: string,
  db_engine?: string,
  timeout?: string,
  ca_cert?: string,
  cert?: string,
  key?: string,
  skip_db_creation?: boolean,
): Promise<void> => {
  // Don't specify database name when creating it - connect to default database
  const client = connect(host, username, password, undefined, timeout, ca_cert, cert, key);

  try {
    try {
      await client.ping();
    } catch (e: unknown) {
      throw new Error(`Failed to connect to ClickHouse`, { cause: e });
    }

    if (skip_db_creation) {
      // Database creation is disabled - verify the database already exists.
      let exists = false;
      try {
        const resultSet = await client.query({
          query: `SELECT 1 AS ok FROM system.databases WHERE name = {db_name:String}`,
          query_params: { db_name },
          format: 'JSONEachRow',
        });
        const rows = (await resultSet.json()) as { ok: number }[];
        exists = rows.length > 0;
      } catch (e: unknown) {
        throw new Error(`can't verify that the database ${db_name} exists.`, { cause: e });
      }

      if (!exists) {
        throw new Error(
          `the database ${db_name} doesn't exist and --skip-db-creation is set. Please create the database manually or remove --skip-db-creation.`,
        );
      }
    } else {
      // In open source ClickHouse - default DB engine is "Atomic", for Cloud - "Shared". If not set, appropriate default is used.
      const q = db_engine
        ? `CREATE DATABASE IF NOT EXISTS "${db_name}" ${db_engine}`
        : `CREATE DATABASE IF NOT EXISTS "${db_name}"`;

      try {
        await client.command({
          query: q,
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        });
      } catch (e: unknown) {
        throw new Error(`can't create the database ${db_name}.`, { cause: e });
      }
    }
  } catch (error: unknown) {
    // Preserve the original failure if closing the connection also fails.
    await client.close().catch(() => undefined);
    throw error;
  }

  await client.close();
};

const init_migration_table = async (client: ClickHouseClient, table_engine: string = 'MergeTree'): Promise<void> => {
  const q = `CREATE TABLE IF NOT EXISTS _migrations (
      uid UUID DEFAULT generateUUIDv4(),
      version UInt32,
      checksum String,
      migration_name String,
      applied_at DateTime DEFAULT now()
    )
    ENGINE = ${table_engine}
    ORDER BY tuple(applied_at)`;

  try {
    await client.command({
      query: q,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
  } catch (e: unknown) {
    throw new Error(`can't create the _migrations table.`, { cause: e });
  }
};

const get_migrations = (migrations_home: string): { version: number; file: string }[] => {
  let files;
  try {
    files = fs.readdirSync(migrations_home);
  } catch {
    throw new Error(`no migration directory ${migrations_home}. Please create it.`);
  }

  const migrations: MigrationBase[] = [];
  files.forEach((file: string) => {
    // Manage only .sql files.
    if (!file.endsWith('.sql')) {
      return;
    }

    const version = Number(file.split('_')[0]);

    if (!version) {
      throw new Error(
        `a migration name should start from number, example: 1_init.sql. Please check, if the migration ${file} is named correctly`,
      );
    }

    migrations.push({
      version,
      file,
    });
  });

  if (!migrations) {
    log('error', `no migrations in the ${migrations_home} migrations directory`);
  }

  // Order by version.
  migrations.sort((m1, m2) => m1.version - m2.version);

  return migrations;
};

const apply_migrations = async (
  client: ClickHouseClient,
  migrations: MigrationBase[],
  migrations_home: string,
): Promise<void> => {
  let migration_query_result: MigrationsRowData[];
  try {
    const resultSet = await client.query({
      query: `SELECT version, checksum, migration_name FROM _migrations ORDER BY version`,
      format: 'JSONEachRow',
    });
    migration_query_result = await resultSet.json();
  } catch (e: unknown) {
    throw new Error(`can't select data from the _migrations table.`, { cause: e });
  }

  const migrations_applied: MigrationsRowData[] = [];
  migration_query_result.forEach((row: MigrationsRowData) => {
    migrations_applied[row.version] = {
      version: row.version,
      checksum: row.checksum,
      migration_name: row.migration_name,
    };

    // Check if migration file was not removed after apply.
    const migration_exist = migrations.find(({ version }) => version === row.version);
    if (!migration_exist) {
      throw new Error(
        `a migration file shouldn't be removed after apply. Please, restore the migration ${row.migration_name}.`,
      );
    }
  });

  let applied_migrations = '';

  for (const migration of migrations) {
    const content = fs.readFileSync(migrations_home + '/' + migration.file).toString();
    const checksum = crypto.createHash('md5').update(content).digest('hex');

    if (migrations_applied[migration.version]) {
      // Check if migration file was not changed after apply.
      if (migrations_applied[migration.version].checksum !== checksum) {
        throw new Error(
          `a migration file should't be changed after apply. Please, restore content of the ${
            migrations_applied[migration.version].migration_name
          } migrations.`,
        );
      }

      // Skip if a migration is already applied.
      continue;
    }

    // Parse the entire file before executing its statements. Substitution is
    // opt-in; the checksum above always uses the original file content.
    let queries: string[];
    let settings: Record<string, string>;
    try {
      ({ queries, settings } = parse_migration_sql(substitute_env(content)));
    } catch (e: unknown) {
      throw new Error(`the migration ${migration.file} has an error.`, { cause: e });
    }

    // Keep the established file-wide SET behavior: the last assignment wins,
    // including for queries earlier in the file. Send settings on every request
    // instead of using sessions, whose state is lost if a load balancer routes
    // the next query to another server. Per-query settings also override host
    // URL defaults and support HTTP parameters such as wait_end_of_query.
    for (const query of queries) {
      try {
        await client.command({
          query: query,
          clickhouse_settings: settings,
        });
      } catch (e: unknown) {
        if (applied_migrations) {
          log('info', `The migration(s) ${applied_migrations} was successfully applied!`);
        }

        throw new Error(
          `the migrations ${migration.file} has an error. Please, fix it (be sure that already executed parts of the migration would not be run second time) and re-run migration script.`,
          { cause: e },
        );
      }
    }

    try {
      await client.insert({
        table: '_migrations',
        values: [{ version: migration.version, checksum: checksum, migration_name: migration.file }],
        format: 'JSONEachRow',
      });
    } catch (e: unknown) {
      throw new Error(`can't insert a data into the table _migrations.`, { cause: e });
    }

    applied_migrations = applied_migrations ? applied_migrations + ', ' + migration.file : migration.file;
  }

  if (applied_migrations) {
    log('info', `The migration(s) ${applied_migrations} was successfully applied!`);
  } else {
    log('info', `No migrations to apply.`);
  }
};

/** Options object for applying migrations. */
export interface MigrationOptions {
  migrations_home: string;
  host: string;
  username: string;
  password: string;
  db_name: string;
  db_engine?: string;
  table_engine?: string;
  timeout?: string;
  ca_cert?: string;
  cert?: string;
  key?: string;
  skip_db_creation?: boolean;
}

const run_migration = async ({
  migrations_home,
  host,
  username,
  password,
  db_name,
  db_engine,
  table_engine,
  timeout,
  ca_cert,
  cert,
  key,
  skip_db_creation,
}: MigrationOptions): Promise<void> => {
  const migrations = get_migrations(migrations_home);

  await create_db(host, username, password, db_name, db_engine, timeout, ca_cert, cert, key, skip_db_creation);

  const client = connect(host, username, password, db_name, timeout, ca_cert, cert, key);

  try {
    await init_migration_table(client, table_engine);

    await apply_migrations(client, migrations, migrations_home);
  } catch (error: unknown) {
    await client.close().catch(() => undefined);
    throw error;
  }

  await client.close();
};

// Legacy positional adapter and will be removed in a future major release.
type LegacyMigrationArguments = [
  migrations_home: string,
  host: string,
  username: string,
  password: string,
  db_name: string,
  db_engine?: string,
  table_engine?: string,
  timeout?: string,
  ca_cert?: string,
  cert?: string,
  key?: string,
  skip_db_creation?: boolean,
];

/** Apply migrations, rejecting on failure without exiting the process. */
function migration(options: MigrationOptions): Promise<void>;
/** @deprecated Use migration(options). Positional calls log failures and exit with status 1. */
function migration(...args: LegacyMigrationArguments): Promise<void>;
async function migration(...args: [options: MigrationOptions] | LegacyMigrationArguments): Promise<void> {
  if (typeof args[0] !== 'string') {
    // If the first argument is not a string, assume it's the new options object.
    return run_migration(args[0]);
  }

  // Keep using legacy positional arguments for backward compatibility.
  const [
    migrations_home,
    host,
    username,
    password,
    db_name,
    db_engine,
    table_engine,
    timeout,
    ca_cert,
    cert,
    key,
    skip_db_creation,
  ] = args as LegacyMigrationArguments;
  try {
    await run_migration({
      migrations_home,
      host,
      username,
      password,
      db_name,
      db_engine,
      table_engine,
      timeout,
      ca_cert,
      cert,
      key,
      skip_db_creation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error.cause : undefined;
    let detail: string | undefined;
    if (cause !== undefined) {
      detail = cause instanceof Error ? cause.message : String(cause);
    }
    log('error', message, detail);
    process.exit(1);
  }
}

const migrate = () => {
  const program = new Command();

  program.name('clickhouse-migrations').description('ClickHouse migrations.').version(VERSION);

  program
    .command('migrate')
    .description('Apply migrations.')
    .requiredOption('--host <name>', 'Clickhouse hostname (ex: http://clickhouse:8123)', process.env.CH_MIGRATIONS_HOST)
    .requiredOption('--user <name>', 'Username', process.env.CH_MIGRATIONS_USER)
    .requiredOption('--password <password>', 'Password', process.env.CH_MIGRATIONS_PASSWORD)
    .requiredOption('--db <name>', 'Database name', process.env.CH_MIGRATIONS_DB)
    .requiredOption('--migrations-home <dir>', "Migrations' directory", process.env.CH_MIGRATIONS_HOME)
    .option(
      '--db-engine <value>',
      'ON CLUSTER and/or ENGINE clauses for database (default: "ENGINE=Atomic")',
      process.env.CH_MIGRATIONS_DB_ENGINE,
    )
    .option(
      '--table-engine <value>',
      'Engine for the _migrations table (default: "MergeTree")',
      process.env.CH_MIGRATIONS_TABLE_ENGINE,
    )
    .option(
      '--timeout <value>',
      'Client request timeout (milliseconds, default value 30000)',
      process.env.CH_MIGRATIONS_TIMEOUT,
    )
    .option('--ca-cert <path>', 'CA certificate file path', process.env.CH_MIGRATIONS_CA_CERT)
    .option('--cert <path>', 'Client certificate file path', process.env.CH_MIGRATIONS_CERT)
    .option('--key <path>', 'Client key file path', process.env.CH_MIGRATIONS_KEY)
    .option('--skip-db-creation', 'Skip database creation', process.env.CH_MIGRATIONS_SKIP_DB_CREATION === 'true')
    .action(async (options: CliParameters) => {
      try {
        await run_migration({
          migrations_home: options.migrationsHome,
          host: options.host,
          username: options.user,
          password: options.password,
          db_name: options.db,
          db_engine: options.dbEngine,
          table_engine: options.tableEngine,
          timeout: options.timeout,
          ca_cert: options.caCert,
          cert: options.cert,
          key: options.key,
          skip_db_creation: options.skipDbCreation,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error ? error.cause : undefined;
        let detail: string | undefined;
        if (cause !== undefined) {
          detail = cause instanceof Error ? cause.message : String(cause);
        }
        log('error', message, detail);
        process.exit(1);
      }
    });

  program.parse();
};

export { migrate, migration };
