/// <reference types="node" />

type ClickhouseDbParams = {
  host: string;
  connect_timeout?: number;
  request_timeout?: number;
  max_open_connections?: number;
  compression?: { response?: boolean; request?: boolean };
  username: string;
  password: string;
  application?: string;
  database?: string;
  clickhouse_settings?: ClickHouseSettings;
  log?: { enable?: boolean; LoggerClass?: Logger };
  tls?: { ca_cert: Buffer; cert?: Buffer; key?: Buffer };
  session_id?: string;
};

type MigrationBase = {
  version: number;
  file: string;
};

type MigrationsRowData = {
  version: number;
  checksum: string;
  migration_name: string;
};

type CliParameters = {
  migrationsHome: string;
  host: string;
  user: string;
  password: string;
  db: string;
  ca_cert?: string;
};

type QueryError = {
  message: string;
};
