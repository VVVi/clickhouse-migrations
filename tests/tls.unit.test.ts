import { describe, it, expect, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock the ClickHouse client to capture the connection parameters
const mockCreateClient = jest.fn();
const mockClickHouseClient = {
  query: jest.fn(() => Promise.resolve({ json: () => [] })),
  exec: jest.fn(() => Promise.resolve({})),
  insert: jest.fn(() => Promise.resolve({})),
  close: jest.fn(() => Promise.resolve()),
  ping: jest.fn(() => Promise.resolve()),
};

jest.mock('@clickhouse/client', () => ({
  createClient: mockCreateClient.mockReturnValue(mockClickHouseClient),
}));

import { migration } from '../src/migrate';

describe('TLS Configuration Unit Tests', () => {
  const certFixturesPath = path.join(__dirname, '..', '.docker', 'clickhouse_tls', 'certificates');
  const caCertPath = path.join(certFixturesPath, 'ca.crt');
  const clientCertPath = path.join(certFixturesPath, 'client.crt');
  const clientKeyPath = path.join(certFixturesPath, 'client.key');

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockReturnValue(mockClickHouseClient);
  });

  describe('TLS configuration building', () => {
    it('should create ClickHouse client without TLS when no certificates provided', async () => {
      await migration('tests/migrations/one', 'http://clickhouse:8123', 'default', '', 'analytics');

      // Verify createClient was called without TLS configuration
      const calls = mockCreateClient.mock.calls as Array<[Record<string, unknown>]>;
      expect(calls.length).toBeGreaterThan(0);

      // Check that none of the calls include TLS configuration
      calls.forEach((call) => {
        expect(call[0]).not.toHaveProperty('tls');
      });
    });

    it('should create ClickHouse client with CA certificate only', async () => {
      await migration(
        'tests/migrations/one',
        'https://secure-clickhouse:8443',
        'default',
        'password',
        'analytics',
        'ENGINE=Atomic',
        'MergeTree',
        '30000',
        caCertPath,
      );

      // Verify createClient was called with TLS configuration containing only CA cert
      const calls = mockCreateClient.mock.calls as Array<[Record<string, unknown>]>;
      expect(calls.length).toBeGreaterThan(0);

      const tlsCalls = calls.filter((call) => call[0].tls);
      expect(tlsCalls.length).toBeGreaterThan(0);

      tlsCalls.forEach((call) => {
        const tlsConfig = call[0].tls as Record<string, unknown>;
        expect(tlsConfig).toHaveProperty('ca_cert');
        expect(tlsConfig.ca_cert).toBeInstanceOf(Buffer);
        // Should not have client cert/key when only CA is provided
        expect(tlsConfig).not.toHaveProperty('cert');
        expect(tlsConfig).not.toHaveProperty('key');
      });
    });

    it('should create ClickHouse client with full TLS configuration', async () => {
      await migration(
        'tests/migrations/one',
        'https://secure-clickhouse:8443',
        'default',
        'password',
        'analytics',
        'ENGINE=Atomic',
        'MergeTree',
        '30000',
        caCertPath,
        clientCertPath,
        clientKeyPath,
      );

      // Verify createClient was called with complete TLS configuration
      const calls = mockCreateClient.mock.calls as Array<[Record<string, unknown>]>;
      expect(calls.length).toBeGreaterThan(0);

      const tlsCalls = calls.filter((call) => call[0].tls);
      expect(tlsCalls.length).toBeGreaterThan(0);

      tlsCalls.forEach((call) => {
        const tlsConfig = call[0].tls as Record<string, Buffer>;
        expect(tlsConfig).toHaveProperty('ca_cert');
        expect(tlsConfig).toHaveProperty('cert');
        expect(tlsConfig).toHaveProperty('key');

        expect(tlsConfig.ca_cert).toBeInstanceOf(Buffer);
        expect(tlsConfig.cert).toBeInstanceOf(Buffer);
        expect(tlsConfig.key).toBeInstanceOf(Buffer);
      });
    });

    it('should combine TLS configuration with other connection options', async () => {
      await migration(
        'tests/migrations/one',
        'https://secure-clickhouse:8443',
        'default',
        'password',
        'analytics',
        'ON CLUSTER production ENGINE=Replicated',
        'MergeTree',
        '60000',
        caCertPath,
        clientCertPath,
        clientKeyPath,
      );

      const calls = mockCreateClient.mock.calls as Array<[Record<string, unknown>]>;
      const dbCreationCall = calls.find((call) => !call[0].database);
      const migrationCall = calls.find((call) => call[0].database);

      // Verify database creation call
      expect(dbCreationCall).toBeDefined();
      expect(dbCreationCall![0]).toMatchObject({
        url: 'https://secure-clickhouse:8443',
        username: 'default',
        password: 'password',
        application: 'clickhouse-migrations',
        request_timeout: 60000,
      });
      expect(dbCreationCall![0]).toHaveProperty('tls');

      // Verify migration call
      expect(migrationCall).toBeDefined();
      expect(migrationCall![0]).toMatchObject({
        url: 'https://secure-clickhouse:8443',
        username: 'default',
        password: 'password',
        database: 'analytics',
        application: 'clickhouse-migrations',
        request_timeout: 60000,
      });
      expect(migrationCall![0]).toHaveProperty('tls');
    });
  });

  describe('Certificate content validation', () => {
    it('should read actual certificate content from files', async () => {
      await migration(
        'tests/migrations/one',
        'https://secure-clickhouse:8443',
        'default',
        'password',
        'analytics',
        'ENGINE=Atomic',
        'MergeTree',
        '30000',
        caCertPath,
        clientCertPath,
        clientKeyPath,
      );

      const calls = mockCreateClient.mock.calls as Array<[Record<string, unknown>]>;
      const tlsCall = calls.find((call) => call[0].tls);

      expect(tlsCall).toBeDefined();
      const tlsConfig = tlsCall![0].tls as Record<string, Buffer>;

      // Read expected certificate content
      const expectedCaCert = fs.readFileSync(caCertPath);
      const expectedClientCert = fs.readFileSync(clientCertPath);
      const expectedClientKey = fs.readFileSync(clientKeyPath);

      // Verify the content matches what was read from files
      expect(tlsConfig.ca_cert).toEqual(expectedCaCert);
      expect(tlsConfig.cert).toEqual(expectedClientCert);
      expect(tlsConfig.key).toEqual(expectedClientKey);
    });
  });

  describe('Database creation with TLS', () => {
    it('should use TLS for both database creation and migration operations', async () => {
      await migration(
        'tests/migrations/one',
        'https://secure-clickhouse:8443',
        'default',
        'password',
        'analytics',
        'ENGINE=Atomic',
        'MergeTree',
        '30000',
        caCertPath,
      );

      // Should have exactly 2 calls: one for DB creation, one for migrations
      expect(mockCreateClient).toHaveBeenCalledTimes(2);

      const calls = mockCreateClient.mock.calls as Array<[Record<string, unknown>]>;

      // Both calls should have TLS configuration
      calls.forEach((call) => {
        expect(call[0]).toHaveProperty('tls');
        const tlsConfig = call[0].tls as Record<string, Buffer>;
        expect(tlsConfig).toHaveProperty('ca_cert');
        expect(tlsConfig.ca_cert).toBeInstanceOf(Buffer);
      });

      // First call should be for database creation (no database specified)
      expect(calls[0][0]).not.toHaveProperty('database');

      // Second call should be for migrations (with database specified)
      expect(calls[1][0]).toHaveProperty('database', 'analytics');
    });
  });
});
