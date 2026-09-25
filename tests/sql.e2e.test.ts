import { createClient } from '@clickhouse/client';
import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
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

  const runMigration = (host = url!) =>
    execFileAsync(
      process.execPath,
      [
        path.join(__dirname, '..', 'lib', 'cli.js'),
        'migrate',
        '--host',
        host,
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

  it('uses final SET values throughout a file, isolated from the next file', async () => {
    const [defaults] = await rows<{ threads: string; timezone: string; note: string }>(
      "SELECT toString(getSetting('max_threads')) AS threads, getSetting('session_timezone') AS timezone, getSetting('log_comment') AS note",
    );
    const first = String.raw`
      CREATE TABLE observations (
        stage UInt8, threads String, timezone String, note String,
        data Map(String, Array(UInt8))
      ) ENGINE = Memory;
      INSERT INTO observations SELECT 1, toString(getSetting('max_threads')), getSetting('session_timezone'), getSetting('log_comment'), map();
      SET max_threads = 1;
      INSERT INTO observations SELECT 2, toString(getSetting('max_threads')), getSetting('session_timezone'), getSetting('log_comment'), {d:Map(String, Array(UInt8))};
      SET max_threads = 2;
      SET session_timezone = 'Europe/Amsterdam';
      SET log_comment = 'a; -- # /* x */\n\tit''s \x41\\n\%';
      SET param_d = {'10': [11, 12], '13': [14, 15]}, param_tuple = (1, [2, 3]);
      SELECT throwIf({tuple:Tuple(UInt8, Array(UInt8))} != tuple(1, [2, 3]), 'tuple parameter failed');
    `;
    fs.writeFileSync(path.join(migrationsDir, '1_settings.sql'), first);
    fs.writeFileSync(
      path.join(migrationsDir, '2_default_settings.sql'),
      "INSERT INTO observations SELECT 3, toString(getSetting('max_threads')), getSetting('session_timezone'), getSetting('log_comment'), map();",
    );

    await runMigration();

    expect(await rows(`SELECT * FROM ${database}.observations ORDER BY stage`)).toEqual([
      {
        stage: 1,
        threads: '2',
        timezone: 'Europe/Amsterdam',
        note: "a; -- # /* x */\n\tit's A\\n\\%",
        data: {},
      },
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

  it('accepts HTTP settings and applies settings placed after the query that needs them', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_late_settings.sql'),
      `
      CREATE TABLE enabled_by_setting (value LowCardinality(UInt8)) ENGINE = Memory;
      SET allow_suspicious_low_cardinality_types = 1;
      SET wait_end_of_query = 1;
    `,
    );

    await runMigration();
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([{ version: 1 }]);
  });

  it('lets migration settings override host URL defaults', async () => {
    const host = new URL(url!);
    host.searchParams.set('ch_max_threads', '2');
    fs.writeFileSync(
      path.join(migrationsDir, '1_url_settings.sql'),
      `
      SET max_threads = 1;
      CREATE TABLE observed (value UInt64) ENGINE = Memory;
      INSERT INTO observed SELECT getSetting('max_threads');
    `,
    );

    await runMigration(host.toString());

    expect(await rows(`SELECT toUInt32(value) AS value FROM ${database}.observed`)).toEqual([{ value: 1 }]);
  });

  it('carries settings on every request without relying on shared session state', async () => {
    // Give each request a fresh server context, as when requests reach different
    // backend nodes. Session-based SET would be lost before the next query.
    const requests: URL[] = [];
    const proxy = http.createServer((request, response) => {
      const target = new URL(request.url!, url!);
      requests.push(new URL(target));
      target.searchParams.set('session_id', crypto.randomUUID());
      const transport = target.protocol === 'https:' ? https : http;
      const upstream = transport.request(target, { method: request.method, headers: request.headers }, (reply) => {
        response.writeHead(reply.statusCode!, reply.headers);
        reply.pipe(response);
      });
      upstream.on('error', (error) => {
        response.writeHead(502);
        response.end(error.message);
      });
      request.pipe(upstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));

    try {
      fs.writeFileSync(
        path.join(migrationsDir, '1_stateless.sql'),
        `
        SET max_threads = 1;
        SELECT throwIf(getSetting('max_threads') != 1, 'migration setting lost');
        SELECT throwIf(getSetting('max_threads') != 1, 'migration setting lost');
      `,
      );
      const address = proxy.address() as { port: number };
      await runMigration(`http://127.0.0.1:${address.port}`);

      expect(requests.every((request) => !request.searchParams.has('session_id'))).toBe(true);
      expect(requests.filter((request) => request.searchParams.get('max_threads') === '1')).toHaveLength(2);
      expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([{ version: 1 }]);
    } finally {
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
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
      INSERT INTO format WITH 'alias' AS format SELECT format;
      INSERT INTO format WITH format AS (SELECT 'cte') SELECT * FROM format;
    `,
    );

    await runMigration();

    expect(await rows(`SELECT * FROM ${database}.quoted ORDER BY \`a;b\``)).toEqual([
      { 'a;b': "it's; -- #! /* literal */", 'c;d': 'first; -- comment\n  second' },
      { 'a;b': 'ticket # 42', 'c;d': 'line1\n  line2   end' },
    ]);
    expect(await rows(`SELECT * FROM ${database}.format ORDER BY note`)).toEqual([
      { note: 'alias' },
      { note: 'cte' },
      { note: 'ok' },
    ]);
  });

  it.each([
    "INSERT INTO raw FORMAT CSV\n1,O'Reilly -- # /* literal */\n",
    "INSERT INTO raw FORMAT TabSeparated\n1\tO'Reilly -- # /* literal */\n",
    `INSERT INTO raw FORMAT JSONEachRow\n{"id":1,"note":"O'Reilly -- # /* literal */"}\n`,
    "INSERT INTO raw FORMAT Values (1, 'O''Reilly -- # /* literal */')",
    "INSERT INTO raw SELECT * FROM input('id UInt8, note String') FORMAT CSV\n1,O'Reilly -- # /* literal */\n",
    "INSERT INTO raw SELECT * FROM (SELECT * FROM input('id UInt8, note String')) FORMAT CSV\n1,O'Reilly -- # /* literal */\n",
  ])('preserves inline data and resumes SQL after its terminator: %s', async (insert) => {
    fs.writeFileSync(
      path.join(migrationsDir, '1_raw.sql'),
      `CREATE TABLE raw (id UInt8, note String) ENGINE = Memory; ${insert}; INSERT INTO raw VALUES (2, 'next statement');`,
    );

    await runMigration();
    expect(await rows(`SELECT * FROM ${database}.raw ORDER BY id`)).toEqual([
      { id: 1, note: "O'Reilly -- # /* literal */" },
      { id: 2, note: 'next statement' },
    ]);
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([{ version: 1 }]);
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

  it('does not record a migration when the server rejects a file-wide setting', async () => {
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
    expect(await rows(`EXISTS TABLE ${database}.before_error`)).toEqual([{ result: 0 }]);
    expect(await rows(`EXISTS TABLE ${database}.after_error`)).toEqual([{ result: 0 }]);
    expect(await rows(`SELECT version FROM ${database}._migrations`)).toEqual([]);
  });
});
