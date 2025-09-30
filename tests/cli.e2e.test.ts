import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * CLI E2E Tests
 *
 * Test for open source ClickHouse
 * - Database creation with default engine (no --db-engine specified)
 * - Database creation with custom engine (--db-engine specified)
 */

describe('CLI E2E Tests', () => {
  const testMigrationsDir = path.join(__dirname, 'migrations', 'one');
  let containerStarted = false;

  beforeAll(async () => {
    // Check if ClickHouse container is running
    try {
      const { stdout } = await execAsync('docker ps --filter "name=clickhouse-server" --format "{{.Status}}"');
      if (stdout.includes('Up')) {
        containerStarted = true;
        console.log('ClickHouse container is running');
      } else {
        console.warn('ClickHouse container is not running. Please start it with: docker-compose up -d clickhouse');
        containerStarted = false;
      }
    } catch (e) {
      console.warn(
        'Cannot check container status. Please ensure Docker is available and ClickHouse container is running.',
      );
      containerStarted = false;
    }
  }, 10000);

  afterAll(async () => {
    // No cleanup needed - container lifecycle is managed externally
  });

  it('should create database with default engine when no --db-engine specified', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');
    const dbName = 'default_engine_test_' + Date.now();

    try {
      const { stdout, stderr } = await execAsync(
        'node ' +
          cliPath +
          ' migrate --host=http://localhost:8123 --user=default --password= --db=' +
          dbName +
          ' --migrations-home=' +
          testMigrationsDir,
        { timeout: 20000 },
      );

      const output = stdout + stderr;
      expect(output).toContain('1_init.sql was successfully applied');
    } catch (error: unknown) {
      console.error('Default engine test failed:', (error as Error).message);
      throw error;
    }
  }, 30000);

  it('should create database with custom engine when --db-engine specified', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');
    const dbName = 'custom_engine_test_' + Date.now();

    try {
      const { stdout, stderr } = await execAsync(
        'node ' +
          cliPath +
          ' migrate --host=http://localhost:8123 --user=default --password= --db=' +
          dbName +
          ' --migrations-home=' +
          testMigrationsDir +
          ' --db-engine="ENGINE=Atomic"',
        { timeout: 20000 },
      );

      const output = stdout + stderr;
      expect(output).toContain('1_init.sql was successfully applied');
    } catch (error: unknown) {
      console.error('Custom engine test failed:', (error as Error).message);
      throw error;
    }
  }, 30000);

  // TODO: add test for creating database with Cloud-specific engine when --db-engine="ENGINE=Shared" is specified
});
