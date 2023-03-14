import { describe, it, expect } from '@jest/globals';
import exec from 'child_process';

const execute = async (script: string, execOptions: any) => {
  const result: { error: exec.ExecException | null; stdout: string; stderr: string } = await new Promise((resolve) => {
    exec.exec(script, execOptions, (error: exec.ExecException | null, stdout: string, stderr: string) => {
      resolve({
        error,
        stdout,
        stderr,
      });
    });
  });

  return result;
};

const envVars = {
  CH_MIGRATIONS_HOST: 'http://sometesthost:8123',
  CH_MIGRATIONS_USER: 'default',
  CH_MIGRATIONS_PASSWORD: '',
  CH_MIGRATIONS_DB: 'analytics',
  CH_MIGRATIONS_HOME: '/app/clickhouse/migrations',
};

describe('Execution tests', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('No parameters provided', async () => {
    const result = await execute('node lib/cli.js migrate', '.');

    expect(result.stderr).toBe("error: required option '--host <name>' not specified\n");
  });

  it('No migration directory', async () => {
    const command =
      "node ./lib/cli.js  migrate --host=http://sometesthost:8123 --user=default --password='' --db=analytics --migrations-home=/app/clickhouse/migrations";

    const result = await execute(command, '.');

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

    const result = await execute(command, '.');

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: a migration name should start from number, example: 1_init.sql. Please check, if the migration bad_1.sql is named correctly \n',
    );
  });
});
