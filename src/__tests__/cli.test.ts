import { describe, it, expect } from '@jest/globals';
var exec = require('child_process').exec;

const execute = async (script: string, execOptions: {}) => {
  const result: { error: string; stdout: string; stderr: string } = await new Promise((resolve) => {
    exec(script, execOptions, (error: any, stdout: any, stderr: any) => {
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
  CH_MIGRATIONS_HOST: 'http://localhost:8123',
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
      "node ./lib/cli.js  migrate --host=http://localhost:8123 --user=default --password='' --db=analytics --migrations-home=/app/clickhouse/migrations";

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
});
