export type ParsedArgs = {
  host: string;
  user: string;
  password: string;
  db: string;
  migrationsHome: string;
  dbEngine?: string;
  tableEngine?: string;
  timeout?: string;
  caCert?: string;
  cert?: string;
  key?: string;
  skipDbCreation?: boolean;
};

type StringOption = Exclude<keyof ParsedArgs, 'skipDbCreation'>;

type CliOption = {
  name: string;
  key: StringOption;
  env: string;
  required?: boolean;
};

const STRING_OPTIONS: CliOption[] = [
  { name: 'host', key: 'host', env: 'CH_MIGRATIONS_HOST', required: true },
  { name: 'user', key: 'user', env: 'CH_MIGRATIONS_USER', required: true },
  { name: 'password', key: 'password', env: 'CH_MIGRATIONS_PASSWORD', required: true },
  { name: 'db', key: 'db', env: 'CH_MIGRATIONS_DB', required: true },
  { name: 'migrations-home', key: 'migrationsHome', env: 'CH_MIGRATIONS_HOME', required: true },
  { name: 'db-engine', key: 'dbEngine', env: 'CH_MIGRATIONS_DB_ENGINE' },
  { name: 'table-engine', key: 'tableEngine', env: 'CH_MIGRATIONS_TABLE_ENGINE' },
  { name: 'timeout', key: 'timeout', env: 'CH_MIGRATIONS_TIMEOUT' },
  { name: 'ca-cert', key: 'caCert', env: 'CH_MIGRATIONS_CA_CERT' },
  { name: 'cert', key: 'cert', env: 'CH_MIGRATIONS_CERT' },
  { name: 'key', key: 'key', env: 'CH_MIGRATIONS_KEY' },
];

const OPTION_BY_NAME = new Map(STRING_OPTIONS.map((option) => [option.name, option]));

const HELP_TEXT = `
Usage: clickhouse-migrations [command] [options]

Commands:
  migrate    Apply migrations

Options:
  --host <name>              ClickHouse hostname (ex: http://clickhouse:8123)
  --user <name>              Username
  --password <password>      Password
  --db <name>                Database name
  --migrations-home <dir>    Migrations' directory
  --db-engine <value>        ON CLUSTER and/or ENGINE clauses for database
  --table-engine <value>     Engine for the _migrations table (default: MergeTree)
  --timeout <value>          Client request timeout in milliseconds
  --ca-cert <path>           CA certificate file path
  --cert <path>              Client certificate file path
  --key <path>               Client key file path
  --skip-db-creation         Skip database creation
  --version                  Print version
  --help                     Show help
`;

export function parseArgs(argv: string[], version: string): ParsedArgs {
  const args = argv.slice(2); // skip "node" and script path

  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`clickhouse-migrations ${version}`);
    process.exit(0);
  }

  if (args[0] !== 'migrate') {
    console.error('Error: missing command migrate');
    process.exit(1);
  }

  const values: Partial<Record<StringOption, string>> = {};
  let skipDbCreation = process.env.CH_MIGRATIONS_SKIP_DB_CREATION === 'true';

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      console.error(`Error: unexpected argument ${arg}`);
      process.exit(1);
    }

    const rawOption = arg.slice(2);
    const separator = rawOption.indexOf('=');
    const name = separator === -1 ? rawOption : rawOption.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : rawOption.slice(separator + 1);

    if (name === 'skip-db-creation') {
      if (inlineValue !== undefined) {
        console.error('Error: option --skip-db-creation does not accept a value');
        process.exit(1);
      }

      skipDbCreation = true;
      continue;
    }

    const option = OPTION_BY_NAME.get(name);
    if (!option) {
      console.error(`Error: unknown option --${name}`);
      process.exit(1);
    }

    const next = args[i + 1];
    const value = inlineValue ?? next;

    if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
      console.error(`Error: option --${name} expects a value`);
      process.exit(1);
    }

    values[option.key] = value;

    if (inlineValue === undefined) {
      i++;
    }
  }

  for (const option of STRING_OPTIONS) {
    values[option.key] = values[option.key] ?? process.env[option.env];

    if (values[option.key] === undefined && option.required) {
      console.error(`Error: missing required option --${option.name}`);
      process.exit(1);
    }
  }

  return {
    host: values.host as string,
    user: values.user as string,
    password: values.password as string,
    db: values.db as string,
    migrationsHome: values.migrationsHome as string,
    dbEngine: values.dbEngine,
    tableEngine: values.tableEngine,
    timeout: values.timeout,
    caCert: values.caCert,
    cert: values.cert,
    key: values.key,
    skipDbCreation,
  };
}
