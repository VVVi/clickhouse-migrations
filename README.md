# @gentrace/clickhouse-migrations

> ClickHouse Migrations CLI

## Install

```sh
npm install @gentrace/clickhouse-migrations
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

  Environment variables
      Instead of options can be used environment variables.
      CH_MIGRATIONS_HOST        Clickhouse hostname (--host)
      CH_MIGRATIONS_USER        Username (--user)
      CH_MIGRATIONS_PASSWORD    Password (--password)
      CH_MIGRATIONS_DB          Database name (--db)
      CH_MIGRATIONS_HOME        Migrations' directory (--migrations-home)

  CLI examples
      clickhouse-migrations migrate --host=http://localhost:8123 
      --user=default --password='' --db=analytics 
      --migrations-home=/app/clickhouse/migrations

      clickhouse-migrations migrate 
```

Migration file example:
```
-- an example of migration file 1_init.sql

SET allow_experimental_object_type = 1;

CREATE TABLE IF NOT EXISTS events (
  event JSON
);
```      