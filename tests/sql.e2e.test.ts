import { createClient } from '@clickhouse/client';
import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const url = process.env.CH_MIGRATIONS_TEST_URL;
const describeClickHouse = url ? describe : describe.skip;

// Opt in with CH_MIGRATIONS_TEST_URL; fail normally if that server is unavailable.
describeClickHouse('SQL compatibility with ClickHouse', () => {
  const client = createClient({ url });
  let database: string;
  let migrationsDir: string;

  beforeEach(() => {
    database = `migration_sql_test_${crypto.randomUUID().replace(/-/g, '')}`;
    migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickhouse-sql-e2e-'));
  });

  afterEach(async () => {
    fs.rmSync(migrationsDir, { recursive: true, force: true });
    await client.command({ query: `DROP DATABASE IF EXISTS ${database} SYNC` });
  });

  afterAll(async () => {
    await client.close();
  });

  const runMigration = () =>
    execFileAsync(
      process.execPath,
      [
        path.join(__dirname, '..', 'lib', 'cli.js'),
        'migrate',
        '--host',
        url!,
        '--user',
        'default',
        '--password',
        '',
        '--db',
        database,
        '--migrations-home',
        migrationsDir,
      ],
      { env: { ...process.env, CH_MIGRATIONS_SUBSTITUTE_ENV: 'false' } },
    );

  const rows = async <T>(query: string): Promise<T[]> => {
    const result = await client.query({ query, format: 'JSONEachRow' });
    return result.json<T>();
  };

  it('uses SET values and parameters in statement order, isolated by file', async () => {
    const [defaults] = await rows<{ threads: string; timezone: string; note: string }>(
      "SELECT toString(getSetting('max_threads')) AS threads, getSetting('session_timezone') AS timezone, getSetting('log_comment') AS note",
    );
    const first = String.raw`
      CREATE TABLE observations (
        stage UInt8, threads String, timezone String, note String,
        data Map(String, Array(UInt8))
      ) ENGINE = Memory;
      SET max_threads = 1,
          log_comment = 'a b';
      SET session_timezone = 'UTC';
      INSERT INTO observations SELECT 1, toString(getSetting('max_threads')), getSetting('session_timezone'), getSetting('log_comment'), map();
      SET max_threads = 2;
      SET session_timezone = 'Europe/Amsterdam';
      SET force_index_by_date = 1;
      SELECT throwIf(getSetting('force_index_by_date') != 1, 'boolean SET failed');
      SET force_index_by_date = 0;
      SET log_comment = 'a; -- # /* x */\n\tit''s \x41\\n\%';
      SET param_d = {'10': [11, 12], '13': [14, 15]}, param_tuple = (1, [2, 3]);
      SELECT throwIf({tuple:Tuple(UInt8, Array(UInt8))} != tuple(1, [2, 3]), 'tuple parameter failed');
      INSERT INTO observations SELECT 2, toString(getSetting('max_threads')), getSetting('session_timezone'), getSetting('log_comment'), {d:Map(String, Array(UInt8))};
    `;
    fs.writeFileSync(path.join(migrationsDir, '1_settings.sql'), first);
    fs.writeFileSync(
      path.join(migrationsDir, '2_fresh_session.sql'),
      "INSERT INTO observations SELECT 3, toString(getSetting('max_threads')), getSetting('session_timezone'), getSetting('log_comment'), map();",
    );

    await runMigration();

    expect(await rows(`SELECT * FROM ${database}.observations ORDER BY stage`)).toEqual([
      { stage: 1, threads: '1', timezone: 'UTC', note: 'a b', data: {} },
      {
        stage: 2,
        threads: '2',
        timezone: 'Europe/Amsterdam',
        note: "a; -- # /* x */\n\tit's A\\n\\%",
        data: { '10': [11, 12], '13': [14, 15] },
      },
      { stage: 3, ...defaults, data: {} },
    ]);
    expect(await rows(`SELECT version, checksum FROM ${database}._migrations ORDER BY version`)).toEqual([
      { version: 1, checksum: crypto.createHash('md5').update(first).digest('hex') },
      { version: 2, checksum: expect.any(String) },
    ]);
    await runMigration();
    expect(await rows(`SELECT toUInt32(count()) AS count FROM ${database}.observations`)).toEqual([{ count: 3 }]);
  });

  it('supports modern boolean shorthand and SET TIME ZONE syntax', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_modern_settings.sql'),
      `
      SET force_index_by_date;
      SELECT throwIf(getSetting('force_index_by_date') != 1, 'boolean SET shorthand failed');
      SET TIME ZONE 'UTC';
      SELECT throwIf(getSetting('session_timezone') != 'UTC', 'SET TIME ZONE failed');
      SET TIME ZONE = 'Europe/Amsterdam';
      SELECT throwIf(getSetting('session_timezone') != 'Europe/Amsterdam', 'SET TIME ZONE assignment failed');
    `,
    );

    await runMigration();
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([{ version: 1 }]);
  });

  it('preserves quoted identifiers, literals and dollar-quoted data while removing nested comments', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_quotes.sql'),
      `
      /* outer; /* inner */ SET max_threads = 99; */
      CREATE TABLE quoted (\`a;b\` String, "c;d" String) ENGINE = Memory;
      INSERT INTO quoted VALUES ('it''s; -- #! /* literal */', $tag$first; -- comment\n  second$tag$);
      INSERT INTO quoted VALUES ('ticket # 42', 'line1\n  line2   end');
      SELECT throwIf(count() != 2, 'not stopped; -- see header') FROM quoted;
      CREATE TABLE format (note String) ENGINE = Memory;
      INSERT INTO TABLE format VALUES ('ok');
    `,
    );

    await runMigration();

    expect(await rows(`SELECT * FROM ${database}.quoted ORDER BY \`a;b\``)).toEqual([
      { 'a;b': "it's; -- #! /* literal */", 'c;d': 'first; -- comment\n  second' },
      { 'a;b': 'ticket # 42', 'c;d': 'line1\n  line2   end' },
    ]);
    expect(await rows(`SELECT * FROM ${database}.format`)).toEqual([{ note: 'ok' }]);
  });

  it.each([
    'INSERT INTO raw FORMAT CSV\n1,hello;world\n',
    "INSERT INTO raw SELECT * FROM input('id UInt8, note String') FORMAT CSV\n1,hello;world\n",
    "INSERT INTO raw SELECT * FROM (SELECT * FROM input('id UInt8, note String')) FORMAT CSV\n1,hello;world\n",
  ])('rejects inline formatted data before running earlier statements: %s', async (insert) => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_raw.sql'),
      `CREATE TABLE raw (id UInt8, note String) ENGINE = Memory; ${insert}`,
    );

    await expect(runMigration()).rejects.toMatchObject({
      stderr: expect.stringContaining('inline INSERT FORMAT data is not supported'),
    });
    expect(await rows(`EXISTS TABLE ${database}.raw`)).toEqual([{ result: 0 }]);
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([]);
  });

  it('rejects an unterminated literal before executing any statement from the file', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_unclosed.sql'),
      "CREATE TABLE before_error (id UInt8) ENGINE = Memory; SELECT 'unfinished",
    );

    await expect(runMigration()).rejects.toMatchObject({
      stderr: expect.stringContaining('unterminated string literal'),
    });
    expect(await rows(`EXISTS TABLE ${database}.before_error`)).toEqual([{ result: 0 }]);
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([]);
  });

  it('does not record a failed migration or run statements after a server-side SET error', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_invalid_setting.sql'),
      `
      CREATE TABLE before_error (id UInt8) ENGINE = Memory;
      SET not_a_real_clickhouse_setting = 1;
      CREATE TABLE after_error (id UInt8) ENGINE = Memory;
    `,
    );

    await expect(runMigration()).rejects.toMatchObject({
      stderr: expect.stringContaining('not_a_real_clickhouse_setting'),
    });
    expect(await rows(`EXISTS TABLE ${database}.before_error`)).toEqual([{ result: 1 }]);
    expect(await rows(`EXISTS TABLE ${database}.after_error`)).toEqual([{ result: 0 }]);
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([]);
  });
});
