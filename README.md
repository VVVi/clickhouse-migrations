
# clickhouse-migrations

> ClickHouse Migrations CLI

## Install

```sh
npm install --global clickhouse-migrations
```

## Usage

Create a directory, where migrations will be stored. It will be used as the value for the `--migrations-home` option.

In the directory, create migrations files - which should be named like: `1_`some_text`.sql`, `2_`other_text`.sql`, ... `10_`more_test`.sql`. What is important here: migration versions followed by underscore - `1_`, `2_`, ...`10_`..., and file extension `.sql`. Any text can follow by version number. The version number should increase for every next migration. 

For migrations' content should be used correct SQL ClickHouse queries. A few queries can be used in one migration file. Every query should end with `;`. The queries could be idempotent - for example: `CREATE TABLE IF NOT EXISTS table ...;` For adding comments should be used `--`, `# `, `#!` at the beginning of the line. Can be used ClickHouse settings - that can be applied on query level, in the format: `SET allow_experimental_object_type = 1;` A migration file can't be changed or removed after applying.

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
  
  Migration file example (could be named 'init-1.sql' and stored in the
  directory provided in --migrations-home)

      SET allow_experimental_object_type = 1;

      CREATE TABLE IF NOT EXISTS events (
        event JSON
      );
```      