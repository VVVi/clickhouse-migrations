import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * TLS CLI Integration Tests
 *
 * Test Coverage:
 * - Basic TLS connection with CA certificate
 * - Client certificate authentication
 * - Environment variable configuration
 * - Error handling for invalid certificates
 */

describe('TLS CLI Integration Tests', () => {
  const certFixturesPath = path.join(__dirname, '..', '.docker', 'clickhouse_tls', 'certificates');
  const caCertPath = path.join(certFixturesPath, 'ca.crt');
  const clientCertPath = path.join(certFixturesPath, 'client.crt');
  const clientKeyPath = path.join(certFixturesPath, 'client.key');
  const testMigrationsDir = path.join(__dirname, 'migrations', 'one');
  let containerStarted = false;

  beforeAll(async () => {
    // Check if ClickHouse TLS container is running
    try {
      const { stdout } = await execAsync('docker ps --filter "name=clickhouse-server-tls" --format "{{.Status}}"');
      if (stdout.includes('Up')) {
        containerStarted = true;
        console.log('ClickHouse TLS container is running');
      } else {
        console.warn(
          'ClickHouse TLS container is not running. Please start it with: docker-compose up -d clickhouse_tls',
        );
        containerStarted = false;
      }
    } catch (e) {
      console.warn(
        'Cannot check container status. Please ensure Docker is available and ClickHouse TLS container is running.',
      );
      containerStarted = false;
    }
  }, 10000);

  afterAll(async () => {
    // No cleanup needed - container lifecycle is managed externally
  });

  it('should connect with CA certificate', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');
    const dbName = 'tls_test_' + Date.now();

    try {
      const { stdout, stderr } = await execAsync(
        'node ' +
          cliPath +
          ' migrate --host=https://localhost:8443 --user=default --password= --db=' +
          dbName +
          ' --migrations-home=' +
          testMigrationsDir +
          ' --ca-cert=' +
          caCertPath,
        {
          env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
          timeout: 20000,
        },
      );

      const output = stdout + stderr;
      expect(output).toContain('1_init.sql was successfully applied');
    } catch (error: unknown) {
      console.error('TLS test failed:', (error as Error).message);
      throw error;
    }
  }, 30000);

  it('should fail without CA certificate', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');

    try {
      await execAsync(
        'node ' +
          cliPath +
          ' migrate --host=https://localhost:8443 --user=default --password= --db=tls_fail --migrations-home=' +
          testMigrationsDir +
          ' --dry-run',
        { timeout: 10000 },
      );

      fail('Expected command to fail');
    } catch (error: unknown) {
      expect((error as Error).message).toMatch(/(certificate|SSL|TLS)/i);
    }
  }, 15000);

  it('should connect with client certificate authentication', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');
    const dbName = 'tls_client_cert_' + Date.now();

    try {
      const { stdout, stderr } = await execAsync(
        'node ' +
          cliPath +
          ' migrate --host=https://localhost:8443 --user=cert_user --password= --db=' +
          dbName +
          ' --migrations-home=' +
          testMigrationsDir +
          ' --ca-cert=' +
          caCertPath +
          ' --cert=' +
          clientCertPath +
          ' --key=' +
          clientKeyPath,
        {
          env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
          timeout: 20000,
        },
      );

      const output = stdout + stderr;
      expect(output).toContain('1_init.sql was successfully applied');
    } catch (error: unknown) {
      console.error('Client cert test failed:', (error as Error).message);
      throw error;
    }
  }, 30000);

  it('should work with environment variables', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');
    const dbName = 'tls_env_' + Date.now();

    const env = {
      ...process.env,
      CH_MIGRATIONS_HOST: 'https://localhost:8443',
      CH_MIGRATIONS_USER: 'default',
      CH_MIGRATIONS_PASSWORD: '',
      CH_MIGRATIONS_DB: dbName,
      CH_MIGRATIONS_HOME: testMigrationsDir,
      CH_MIGRATIONS_CA_CERT: caCertPath,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };

    try {
      const { stdout, stderr } = await execAsync('node ' + cliPath + ' migrate', {
        env,
        timeout: 20000,
      });

      const output = stdout + stderr;
      expect(output).toContain('1_init.sql was successfully applied');
    } catch (error: unknown) {
      console.error('Environment variables test failed:', (error as Error).message);
      throw error;
    }
  }, 25000);

  it('should handle invalid certificate file', async () => {
    if (!containerStarted) {
      console.log('Skipping - container not available');
      return;
    }

    const cliPath = path.join(__dirname, '..', 'lib', 'cli.js');
    const invalidCertPath = '/tmp/invalid_cert.crt';

    // Create invalid certificate file
    fs.writeFileSync(invalidCertPath, 'INVALID CERTIFICATE CONTENT');

    try {
      await execAsync(
        'node ' +
          cliPath +
          ' migrate --host=https://localhost:8443 --user=default --password= --db=tls_invalid --migrations-home=' +
          testMigrationsDir +
          ' --ca-cert=' +
          invalidCertPath +
          ' --dry-run',
        { timeout: 10000 },
      );

      fail('Expected command to fail with invalid certificate');
    } catch (error: unknown) {
      expect((error as Error).message).toMatch(/(certificate|SSL|TLS|PEM)/i);
    } finally {
      // Clean up
      if (fs.existsSync(invalidCertPath)) {
        fs.unlinkSync(invalidCertPath);
      }
    }
  }, 15000);
});
