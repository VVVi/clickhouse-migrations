import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { exec, ExecOptions, ExecException } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { createClient } from '@clickhouse/client';

const execAsync = promisify(exec);

// Real ClickHouse connection for testing
const clickhouseHost = 'http://localhost:8123';
const testMigrationsDir = path.join(__dirname, 'migrations', 'few');
const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');

const createClickHouseClient = () => {
  return createClient({
    url: clickhouseHost,
    username: 'default',
    password: '',
  });
};

const execute = async (script: string, options: ExecOptions = {}) => {
  return new Promise<{ error: ExecException | null; stdout: string; stderr: string }>((resolve) => {
    exec(script, options, (error: ExecException | null, stdout: string, stderr: string) => {
      resolve({ error, stdout, stderr });
    });
  });
};

const checkDatabaseExists = async (dbName: string): Promise<boolean> => {
  const client = createClickHouseClient();
  try {
    const result = await client.query({
      query: `SELECT name FROM system.databases WHERE name = '${dbName}'`,
      format: 'JSONEachRow',
    });
    const databases = await result.json();
    return databases.length > 0;
  } finally {
    await client.close();
  }
};

const checkDatabaseEngine = async (dbName: string): Promise<string> => {
  const client = createClickHouseClient();
  try {
    const result = await client.query({
      query: `SELECT engine FROM system.databases WHERE name = '${dbName}'`,
      format: 'JSONEachRow',
    });
    const databases = (await result.json()) as Array<{ engine: string }>;
    return databases.length > 0 ? databases[0].engine : '';
  } finally {
    await client.close();
  }
};

const dropDatabaseIfExists = async (dbName: string): Promise<void> => {
  const client = createClickHouseClient();
  try {
    await client.exec({
      query: `DROP DATABASE IF EXISTS "${dbName}"`,
    });
  } finally {
    await client.close();
  }
};

const envVars = {
  CH_MIGRATIONS_HOST: clickhouseHost,
  CH_MIGRATIONS_USER: 'default',
  CH_MIGRATIONS_PASSWORD: '',
  CH_MIGRATIONS_DB: 'test_analytics',
  CH_MIGRATIONS_HOME: testMigrationsDir,
};

const envVarsWithEngines = {
  ...envVars,
  CH_MIGRATIONS_DB_ENGINE: 'ENGINE=Atomic',
};

describe('Database Creation E2E tests', () => {
  let containerStarted = false;

  beforeAll(async () => {
    // Check if ClickHouse container is running
    try {
      const { stdout } = await execAsync('docker ps --filter "name=clickhouse-server" --format "{{.Status}}"');
      if (stdout.includes('Up')) {
        containerStarted = true;
        console.log('ClickHouse container is running');

        // Test connection
        const client = createClickHouseClient();
        await client.ping();
        await client.close();
      } else {
        console.warn('ClickHouse container is not running. Please start it with: docker-compose up -d clickhouse');
        containerStarted = false;
      }
    } catch (e) {
      console.warn(
        'Cannot check container status or connect to ClickHouse. Please ensure Docker is available and ClickHouse container is running.',
      );
      containerStarted = false;
    }
  }, 30000);

  beforeEach(() => {
    jest.resetModules();
  });

  afterAll(async () => {
    // Clean up any test databases that might still exist
    if (containerStarted) {
      const testDbs = [
        'e2e_test_atomic',
        'e2e_test_custom_engine',
        'e2e_test_empty_engine',
        'e2e_test_default',
        'e2e_test_env_atomic',
        'e2e_test_env_ordinary',
        'e2e_test_env_empty',
        'e2e_test_migrations_table',
        'e2e_test_existing_db',
        'e2e_test_no_engine_issue30',
      ];

      for (const dbName of testDbs) {
        try {
          await dropDatabaseIfExists(dbName);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  });

  it('should create database with ENGINE=Atomic via CLI', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_atomic';
    await dropDatabaseIfExists(dbName); // Clean up before test

    const command = `node ${cliPath} migrate --host=${clickhouseHost} --user=default --password= --db=${dbName} --migrations-home=${testMigrationsDir} --db-engine='ENGINE=Atomic'`;

    const result = await execute(command, { cwd: '.', timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created with correct engine
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    const engine = await checkDatabaseEngine(dbName);
    expect(engine).toBe('Atomic');

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should create database with ENGINE=Atomic via env var', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_env_atomic';
    await dropDatabaseIfExists(dbName); // Clean up before test

    const env = {
      ...envVars,
      CH_MIGRATIONS_DB: dbName,
      CH_MIGRATIONS_DB_ENGINE: 'ENGINE=Atomic',
    };

    const result = await execute(`node ${cliPath} migrate`, { env, timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created with correct engine
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    const engine = await checkDatabaseEngine(dbName);
    expect(engine).toBe('Atomic');

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should create database with empty DB engine (default to Atomic) via CLI', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_empty_engine';
    await dropDatabaseIfExists(dbName); // Clean up before test

    const command = `node ${cliPath} migrate --host=${clickhouseHost} --user=default --password= --db=${dbName} --migrations-home=${testMigrationsDir} --db-engine=''`;

    const result = await execute(command, { cwd: '.', timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should create database with empty DB engine via env var', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_env_empty';
    await dropDatabaseIfExists(dbName); // Clean up before test

    const env = {
      ...envVars,
      CH_MIGRATIONS_DB: dbName,
      CH_MIGRATIONS_DB_ENGINE: '',
    };

    const result = await execute(`node ${cliPath} migrate`, { env, timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should create database with default engine (no engine specified)', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_default';
    await dropDatabaseIfExists(dbName); // Clean up before test

    const command = `node ${cliPath} migrate --host=${clickhouseHost} --user=default --password= --db=${dbName} --migrations-home=${testMigrationsDir}`;

    const result = await execute(command, { cwd: '.', timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created with default engine (Atomic)
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    const engine = await checkDatabaseEngine(dbName);
    expect(engine).toBe('Atomic');

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should create database with custom engine clause via CLI', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_custom_engine';
    await dropDatabaseIfExists(dbName); // Clean up before test

    // Test with ENGINE=Memory (valid but not commonly used for databases)
    const command = `node ${cliPath} migrate --host=${clickhouseHost} --user=default --password= --db=${dbName} --migrations-home=${testMigrationsDir} --db-engine='ENGINE=Memory'`;

    const result = await execute(command, { cwd: '.', timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created with correct engine
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    const engine = await checkDatabaseEngine(dbName);
    expect(engine).toBe('Memory');

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should verify _migrations table always uses MergeTree engine', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_migrations_table';
    await dropDatabaseIfExists(dbName); // Clean up before test

    const command = `node ${cliPath} migrate --host=${clickhouseHost} --user=default --password= --db=${dbName} --migrations-home=${testMigrationsDir}`;

    const result = await execute(command, { cwd: '.', timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify _migrations table was created with hardcoded MergeTree engine
    const client = createClickHouseClient();
    try {
      await client.exec({ query: `USE "${dbName}"` });
      const result = await client.query({
        query: `SELECT engine FROM system.tables WHERE database = '${dbName}' AND name = '_migrations'`,
        format: 'JSONEachRow',
      });
      const tables = (await result.json()) as Array<{ engine: string }>;
      expect(tables.length).toBe(1);
      expect(tables[0].engine).toBe('MergeTree');
    } finally {
      await client.close();
    }

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should handle database creation with engine when database already exists', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_existing_db';
    await dropDatabaseIfExists(dbName); // Clean up before test

    // First, create the database manually
    const client = createClickHouseClient();
    try {
      await client.exec({
        query: `CREATE DATABASE "${dbName}" ENGINE=Atomic`,
      });
    } finally {
      await client.close();
    }

    // Now run migrations on the existing database
    const command = `node ${cliPath} migrate --host=${clickhouseHost} --user=default --password= --db=${dbName} --migrations-home=${testMigrationsDir} --db-engine='ENGINE=Atomic'`;

    const result = await execute(command, { cwd: '.', timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database exists and has correct engine
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    const engine = await checkDatabaseEngine(dbName);
    expect(engine).toBe('Atomic');

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);

  it('should create database without engine when no engine specified (issue #30)', async () => {
    if (!containerStarted) {
      console.log('Skipping - ClickHouse container not available');
      return;
    }

    const dbName = 'e2e_test_no_engine_issue30';
    await dropDatabaseIfExists(dbName); // Clean up before test

    // Test without db-engine parameter (should work)
    const env = {
      ...envVars,
      CH_MIGRATIONS_DB: dbName,
      // Deliberately not setting CH_MIGRATIONS_DB_ENGINE
    };

    const result = await execute(`node ${cliPath} migrate`, { env, timeout: 20000 });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain('1_init.sql, 2_more.sql was successfully applied');

    // Verify database was created
    const exists = await checkDatabaseExists(dbName);
    expect(exists).toBe(true);

    // Clean up
    await dropDatabaseIfExists(dbName);
  }, 30000);
});
