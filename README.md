
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
      --timeout=<value>         Client request timeout 
                                  (milliseconds, default: 30000)

  Environment variables
      Instead of options can be used environment variables.
      CH_MIGRATIONS_HOST        Clickhouse hostname (--host)
      CH_MIGRATIONS_USER        Username (--user)
      CH_MIGRATIONS_PASSWORD    Password (--password)
      CH_MIGRATIONS_DB          Database name (--db)
      CH_MIGRATIONS_HOME        Migrations' directory (--migrations-home)

      CH_MIGRATIONS_DB_ENGINE   (optional) DB engine (--db-engine)
      CH_MIGRATIONS_TIMEOUT     (optional) Client request timeout 
                                  (--timeout)

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

    settings provided as environment variables
      clickhouse-migrations migrate

    settings provided partially through options and environment variables
      clickhouse-migrations migrate --timeout=60000
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

## Status command

The `status` command provides an overview of the migration status, including the total number of migrations, applied migrations, and pending migrations. It accepts the same options as the `migrate` command.

```
  Usage
    $ clickhouse-migrations status <options>

  CLI executions examples
    settings are passed as command-line options
      clickhouse-migrations status --host=http://localhost:8123
      --user=default --password='' --db=analytics 
      --migrations-home=/app/clickhouse/migrations

    settings provided as environment variables
      clickhouse-migrations status

    settings provided partially through options and environment variables
      clickhouse-migrations status --timeout=60000
```