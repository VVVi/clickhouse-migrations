/// <reference types="node" />

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
  dbEngine?: string;
  timeout?: string;
  caCert?: string;
  cert?: string;
  key?: string;
  skipDbCreation?: boolean;
};

type QueryError = {
  message: string;
};
