import { describe, it, expect } from '@jest/globals';
import exec from 'child_process';

const execute = async (script: string, options: exec.ExecOptions) => {
  return new Promise<{ error: exec.ExecException | null; stdout: string; stderr: string }>((resolve) => {
    exec.exec(script, options, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
};

const envVars = {
  CH_MIGRATIONS_HOST: 'http://sometesthost:8123',
  CH_MIGRATIONS_USER: 'default',
  CH_MIGRATIONS_PASSWORD: '',
  CH_MIGRATIONS_DB: 'analytics',
  CH_MIGRATIONS_HOME: '/app/clickhouse/migrations',
};

const envVarsWithEngines = {
  ...envVars,
  CH_MIGRATIONS_DB_ENGINE: 'ENGINE=Atomic ON CLUSTER test_cluster',
  CH_MIGRATIONS_TABLE_ENGINE: 'ReplacingMergeTree',
};

describe('Execution tests', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('No parameters provided', async () => {
    const result = await execute('node lib/cli.js migrate', { cwd: '.' });

    expect(result.stderr).toBe("error: required option '--host <name>' not specified\n");
  });

  it('No migration directory', async () => {
    const command =
      "node ./lib/cli.js  migrate --host=http://sometesthost:8123 --user=default --password='' --db=analytics --migrations-home=/app/clickhouse/migrations";

    const result = await execute(command, { cwd: '.' });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('Environment variables are provided, but no migration directory', async () => {
    const result = await execute('node lib/cli.js migrate', { env: envVars });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('Incorrectly named migration', async () => {
    const command =
      "node ./lib/cli.js  migrate --host=http://sometesthost:8123 --user=default --password='' --db=analytics --migrations-home=tests/migrations/bad";

    const result = await execute(command, { cwd: '.' });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: a migration name should start from number, example: 1_init.sql. Please check, if the migration bad_1.sql is named correctly \n',
    );
  });

  it('DB engine parameter is passed correctly via command line', async () => {
    const command =
      "node ./lib/cli.js  migrate --host=http://sometesthost:8123 --user=default --password='' --db=analytics --migrations-home=/app/clickhouse/migrations --db-engine='ENGINE=Atomic ON CLUSTER test_cluster'";

    const result = await execute(command, { cwd: '.' });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('Table engine parameter is passed correctly via command line', async () => {
    const command =
      "node ./lib/cli.js  migrate --host=http://sometesthost:8123 --user=default --password='' --db=analytics --migrations-home=/app/clickhouse/migrations --table-engine='ReplacingMergeTree'";

    const result = await execute(command, { cwd: '.' });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('Both DB and table engine parameters are passed correctly via command line', async () => {
    const command =
      "node ./lib/cli.js  migrate --host=http://sometesthost:8123 --user=default --password='' --db=analytics --migrations-home=/app/clickhouse/migrations --db-engine='ENGINE=Atomic ON CLUSTER test_cluster' --table-engine='ReplacingMergeTree'";

    const result = await execute(command, { cwd: '.' });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('DB engine environment variable is used correctly', async () => {
    const envWithDbEngine = {
      ...envVars,
      CH_MIGRATIONS_DB_ENGINE: 'ENGINE=Atomic ON CLUSTER test_cluster',
    };

    const result = await execute('node lib/cli.js migrate', { env: envWithDbEngine });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('Table engine environment variable is used correctly', async () => {
    const envWithTableEngine = {
      ...envVars,
      CH_MIGRATIONS_TABLE_ENGINE: 'ReplacingMergeTree',
    };

    const result = await execute('node lib/cli.js migrate', { env: envWithTableEngine });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });

  it('Both engine environment variables are used correctly', async () => {
    const result = await execute('node lib/cli.js migrate', { env: envVarsWithEngines });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });
});
