
# clickhouse-migrations

> ClickHouse Migrations CLI

## Install

```sh
npm install clickhouse-migrations
```

## Usage

Create a directory, where migrations will be stored. It will be used as the value for the `--migrations-home` option (or for environment variable `CH_MIGRATIONS_HOME`).

In the directory, create migration files, which should be named like this: `1_some_text.sql`, `2_other_text.sql`, `10_more_test.sql`. What's important here is that the migration version number should come first, followed by an underscore (`_`), and then any text can follow. The version number should increase for every next migration. Please note that once a migration file has been applied to the database, it cannot be modified or removed. 

For migrations' content should be used correct SQL ClickHouse queries. Multiple queries can be used in a single migration file, and each query should be terminated with a semicolon (;). The queries could be idempotent - for example: `CREATE TABLE IF NOT EXISTS table ...;` Clickhouse settings, that can be included at the query level, can be added like `SET allow_experimental_object_type = 1;`. For adding comments should be used `--`, `# `, `#!`. 

If the database provided in the `--db` option (or in `CH_MIGRATIONS_DB`) doesn't exist, it will be created automatically.

For TLS/HTTPS connections, you can provide a custom CA certificate and optional client certificate/key via the `--ca-cert`, `--cert`, and `--key` options (or the `CH_MIGRATIONS_CA_CERT`, `CH_MIGRATIONS_CERT`, and `CH_MIGRATIONS_KEY` environment variables).

```
  Usage
    $ clickhouse-migrations migrate <options>

  Required options
      --host=<name>             Clickhouse hostname 
                                  (ex. https://clickhouse:8123)
      --user=<name>             Username
      --password=<password>     Password
      --db=<name>               Database name
      --migrations-home=<dir>   Migrations' directory

  Optional options
      --db-engine=<value>       ON CLUSTER and/or ENGINE for DB
                                  (default: 'ENGINE=Atomic')
      --table-engine=<value>    Engine for the _migrations table
                                  (default: 'MergeTree')
      --timeout=<value>         Client request timeout 
                                  (milliseconds, default: 30000)
      --ca-cert=<path>          CA certificate file path
      --cert=<path>             Client certificate file path
      --key=<path>              Client key file path                            

  Environment variables
      Instead of options can be used environment variables.
      CH_MIGRATIONS_HOST        Clickhouse hostname (--host)
      CH_MIGRATIONS_USER        Username (--user)
      CH_MIGRATIONS_PASSWORD    Password (--password)
      CH_MIGRATIONS_DB          Database name (--db)
      CH_MIGRATIONS_HOME        Migrations' directory (--migrations-home)

      CH_MIGRATIONS_DB_ENGINE   (optional) DB engine (--db-engine)
      CH_MIGRATIONS_TABLE_ENGINE  (optional) Migrations table engine (--table-engine)      
      CH_MIGRATIONS_TIMEOUT     (optional) Client request timeout 
                                  (--timeout)
      CH_MIGRATIONS_CA_CERT     (optional) CA certificate file path
      CH_MIGRATIONS_CERT        (optional) Client certificate file path
      CH_MIGRATIONS_KEY         (optional) Client key file path


  CLI executions examples
    settings are passed as command-line options
      clickhouse-migrations migrate --host=http://localhost:8123
      --user=default --password='' --db=analytics 
      --migrations-home=/app/clickhouse/migrations

    settings provided as options, including timeout and db-engine
      clickhouse-migrations migrate --host=http://localhost:8123 
      --user=default --password='' --db=analytics 
      --migrations-home=/app/clickhouse/migrations --timeout=60000 
      --db-engine="ON CLUSTER default ENGINE=Replicated('{replica}')"
      --table-engine="ReplicatedMergeTree('/clickhouse/tables/{database}/migrations', '{replica}')"    

    settings provided as environment variables
      clickhouse-migrations migrate

    settings provided partially through options and environment variables
      clickhouse-migrations migrate --timeout=60000

    settings provided as options with TLS certificates
      clickhouse-migrations migrate --host=https://localhost:8443
      --user=default --password='' --db=analytics
      --migrations-home=/app/clickhouse/migrations
      --ca-cert=/app/certs/ca.pem --cert=/app/certs/client.crt --key=/app/certs/client.key
```

Migration file example:
(e.g., located at /app/clickhouse/migrations/1_init.sql)
```
-- an example of migration file 1_init.sql

SET allow_experimental_json_type = 1;

CREATE TABLE IF NOT EXISTS events (
  timestamp DateTime('UTC'),
  session_id UInt64,
  event JSON
)
ENGINE=AggregatingMergeTree
PARTITION BY toYYYYMM(timestamp) 
SAMPLE BY session_id 
ORDER BY (session_id) 
SETTINGS index_granularity = 8192;
```      