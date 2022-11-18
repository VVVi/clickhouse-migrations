/// <reference types="node" />

type ClickhouseDbParams = {
  url: String;
  port: Number;
  database?: String;
  debug: Boolean;
  basicAuth: {
    username: String;
    password: String;
  };
  isUseGzip: Boolean;
  format: 'json';
  raw: Boolean;
  config: {
    session_timeout: Number;
    output_format_json_quote_64bit_integers: Number;
    enable_http_compression: Number;
  };
};

type MigrationBase = {
  version: number;
  file: string;
};

type CliParameters = {
  migrationsHome: string;
  host: string;
  port: string;
  user: string;
  pass: string;
  dbName: string;
};
