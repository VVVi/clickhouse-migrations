import { describe, it, expect } from '@jest/globals';
var exec = require('child_process').exec;

describe('Parameter tests', () => {
  it('No parameters provided', async () => {
    let result: any = await new Promise((resolve) => {
      exec('node lib/cli.js migrate', '.', (error: any, stdout: any, stderr: any) => {
        resolve({
          error,
          stdout,
          stderr,
        });
      });
    });

    expect(result.stderr).toBe("error: required option '--host <name>' not specified\n");
  });

  it('No migration directory', async () => {
    let result: any = await new Promise((resolve) => {
      const command =
        "node ./lib/cli.js  migrate --host http://localhost --port 8123 --user default --pass '' --db-name analytics --migrations-home /app/clickhouse/migrations";

      exec(command, '.', (error: any, stdout: any, stderr: any) => {
        resolve({
          error,
          stdout,
          stderr,
        });
      });
    });

    expect(result.stderr).toBe(
      '\x1B[36m clickhouse-migrations : \x1B[31m Error: no migration directory /app/clickhouse/migrations. Please create it. \n',
    );
  });
});
