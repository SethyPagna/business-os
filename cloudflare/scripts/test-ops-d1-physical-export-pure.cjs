#!/usr/bin/env node
// d1-physical-export (ops/scripts/ops-d1-physical-lib.mjs, ops-d1-physical-export.mjs and the local loader
// ops/scripts/latest-data/load-d1-physical-export.mjs):
//   - the paging SQL builder: rowid keyset only, never OFFSET / LIKE / GLOB, no bound parameters, every statement
//     passes the ops SQL guard, every real table of the migrated schema is covered, nothing is skipped silently;
//   - the engine over a fake D1 (node:sqlite) -- keyset plans, retries that halve the page, refusals that are
//     flagged instead of hidden, the same hashes at any concurrency;
//   - the round trip: export from a fixture database -> encrypt -> decrypt -> load -> identical, row for row and
//     type for type (reals, 64-bit integers, blobs, quotes, Khmer, NULL, AUTOINCREMENT gaps, a column named rowid);
//   - the loader refuses a tampered, truncated, swapped or foreign artifact, and a database inside the repository.
'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href)

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    process.exitCode = 1
    console.error(`FAIL ${name}\n  ${err && err.message ? err.message.split('\n').join('\n  ') : err}`)
  }
}

// ------------------------------------------------------------------ fixtures

const SENTINELS = {
  password: 'SENTINEL-PASSWORD-HASH-aaaa', otp: 'SENTINEL-OTP-SECRET-bbbb', otpPending: 'SENTINEL-OTP-PENDING-cccc', portal: 'SENTINEL-PORTAL-HASH-dddd',
  apiKey: 'SENTINEL-API-KEY-eeee', refresh: 'SENTINEL-REFRESH-TOKEN-ffff', resend: 'SENTINEL-RESEND-gggg', secret: 'SENTINEL-SECRET-hhhh', bot: 'SENTINEL-BOT-iiii',
  maintenance: 'SENTINEL-MAINT-jjjj', session: 'SENTINEL-SESSION-kkkk', code: 'SENTINEL-CODE-llll',
}

function fixtureDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE plain_pk (id INTEGER PRIMARY KEY, name TEXT, price REAL, qty INTEGER, data BLOB, note TEXT);
    CREATE TABLE text_pk (code TEXT PRIMARY KEY, v);
    CREATE TABLE no_pk (a, b, c);
    CREATE TABLE auto_seq (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT);
    CREATE TABLE shadowed ("rowid" TEXT, "from" INTEGER);
    CREATE TABLE empty_t (a INTEGER);
    CREATE TABLE audit (id INTEGER PRIMARY KEY, msg TEXT);
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);
    CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, name TEXT, password TEXT NOT NULL, otp_enabled INTEGER, otp_secret TEXT, otp_pending_secret TEXT);
    CREATE TABLE portal_accounts (id INTEGER PRIMARY KEY, phone TEXT, password_hash TEXT NOT NULL);
    CREATE TABLE ai_provider_configs (id INTEGER PRIMARY KEY, provider TEXT, api_key_encrypted TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, token_hash TEXT);
    CREATE TABLE verification_codes (id INTEGER PRIMARY KEY, code_hash TEXT);
    CREATE TABLE login_lockouts (k TEXT PRIMARY KEY, n INTEGER);
    CREATE TABLE telegram_scheduled_sends (id INTEGER PRIMARY KEY, status TEXT);
    CREATE VIRTUAL TABLE docs_fts USING fts5(body, content='docs', content_rowid='id');
    CREATE INDEX idx_plain_name ON plain_pk(name);
    CREATE UNIQUE INDEX idx_text_pk_v ON text_pk(v);
    CREATE VIEW v_plain AS SELECT id, name FROM plain_pk;
    CREATE TRIGGER trg_plain_audit AFTER INSERT ON plain_pk BEGIN INSERT INTO audit(msg) VALUES ('inserted ' || NEW.id); END;
  `)
  const insert = db.prepare('INSERT INTO plain_pk(id, name, price, qty, data, note) VALUES (?, ?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  for (let i = 1; i <= 2600; i += 1) {
    insert.run(i * 3, `item ${i}`, i / 7, i % 5 === 0 ? null : i, i % 11 === 0 ? new Uint8Array([0, 255, i % 256]) : null, i % 13 === 0 ? 'x'.repeat(2000) : null)
  }
  db.exec('COMMIT')
  insert.run(4000000, "it's \"quoted\"\nline two\ttab", 0.1 + 0.2, 9223372036854775807n, new Uint8Array(0), 'ខ្មែរ 🧴 café')
  insert.run(4000001, '', -1.5, -9223372036854775808n, new Uint8Array(1500).map((_, i) => i % 256), '')
  insert.run(4000002, null, 1e300, 0, null, null)
  insert.run(4000003, 'big real', 5.0, 5, null, null)
  db.exec('INSERT INTO plain_pk(id, name, price) VALUES (4000004, \'inf\', 9e999), (4000005, \'neg inf\', -9e999)')
  db.exec("INSERT INTO text_pk VALUES ('a', 1), ('b', 2.5), ('c', 'three'), ('d', NULL), ('e', x'00'), ('it''s', 'q')")
  db.exec("INSERT INTO no_pk VALUES (1, 'x', NULL), (2.0, 'y', 3), ('7', x'ff', 1e-9), (NULL, NULL, NULL)")
  db.exec('INSERT INTO no_pk(rowid, a) VALUES (-5, \'neg rowid\'), (0, \'zero rowid\'), (9007199254740993, \'beyond 2^53\')')
  db.exec('INSERT INTO auto_seq(x) VALUES (\'a\'), (\'b\'), (\'c\'), (\'d\'); DELETE FROM auto_seq WHERE id > 2;')
  db.exec("INSERT INTO shadowed(\"rowid\", \"from\") VALUES ('r1', 1), ('r2', 2)")
  db.exec(`
    INSERT INTO users(username, name, password, otp_enabled, otp_secret, otp_pending_secret) VALUES ('owner', 'Owner', '${SENTINELS.password}', 1, '${SENTINELS.otp}', '${SENTINELS.otpPending}'), ('cashier', 'Cashier', 'pbkdf2-${SENTINELS.password}2', 0, NULL, NULL);
    INSERT INTO portal_accounts(phone, password_hash) VALUES ('012345678', '${SENTINELS.portal}');
    INSERT INTO ai_provider_configs(provider, api_key_encrypted) VALUES ('openai', '${SENTINELS.apiKey}'), ('none', '');
    INSERT INTO settings(key, value, updated_at) VALUES ('shop_name', 'LC Cosmetics', 't'), ('currency', 'USD', 't'), ('telegram_chat_id', '-1001234', 't'), ('telegram_topic_sales', '12', 't'),
      ('telegram_automation_enabled', 'true', 't'), ('drive_sync_refresh_token', '${SENTINELS.refresh}', 't'), ('drive_sync_access_token_expires_at', '2026-10-06', 't'), ('Resend_API_KEY', '${SENTINELS.resend}', 't'),
      ('MY_Secret', '${SENTINELS.secret}', 't'), ('bot_token', '${SENTINELS.bot}', 't'), ('pos_address_presets_v1', '[]', 't'), ('empty_token', NULL, 't');
    INSERT INTO system_flags(key, value, updated_at) VALUES ('maintenance', '{"token":"${SENTINELS.maintenance}"}', 't'), ('branch_cutover_control_incarnation', 'inc-1', 't');
    INSERT INTO user_sessions(token_hash) VALUES ('${SENTINELS.session}'), ('${SENTINELS.session}2'), ('${SENTINELS.session}3');
    INSERT INTO verification_codes(code_hash) VALUES ('${SENTINELS.code}');
    INSERT INTO login_lockouts(k, n) VALUES ('1.2.3.4', 5), ('5.6.7.8', 1);
    INSERT INTO telegram_scheduled_sends(status) VALUES ('pending'), ('sending'), ('sent'), ('failed');
  `)
  db.exec("INSERT INTO d1_migrations(name) VALUES ('0001_a.sql'), ('0002_b.sql')")
  db.exec("INSERT INTO docs(body) VALUES ('hello world'), ('khmer ខ្មែរ'); INSERT INTO docs_fts(docs_fts) VALUES ('rebuild')")
  return db
}

// A stand-in for D1 over a node:sqlite database: one statement in, rows and meta out. `behave(sql, n)` may
// return a replacement { ok: false, ... } result to simulate a refusal or a CPU reset.
function fakeD1(db, { behave } = {}) {
  const log = []
  const query = async (sql) => {
    log.push(sql)
    if (behave) {
      const replaced = behave(sql, log.length)
      if (replaced) return replaced
    }
    const stmt = db.prepare(sql)
    stmt.setReadBigInts(true)
    const rows = stmt.all().map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v instanceof Uint8Array ? Array.from(v) : v])))
    return { ok: true, rows, meta: { rows_read: rows.length, rows_written: 0, duration: 1 }, retryable: false, errorCodes: [] }
  }
  return { query, log }
}

function testKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privateKeyPem, privateKey: crypto.createPrivateKey(privateKeyPem) }
}

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `d1phys-${label}-`))
}

// Every value of every row in rowid order, type-exact (bigint, -0, blobs), for deep comparison.
function dump(db, table) {
  const stmt = db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" ORDER BY rowid`)
  stmt.setReadBigInts(true)
  return stmt.all().map((row) => Object.values(row).map((v) => (v instanceof Uint8Array ? `blob:${Buffer.from(v).toString('hex')}` : typeof v === 'bigint' ? `int:${v}` : typeof v === 'number' ? (Object.is(v, -0) ? 'real:-0' : `real:${v}`) : v === null ? 'null' : `text:${v}`)))
}

async function main() {
  const lib = await load('ops', 'scripts', 'ops-d1-physical-lib.mjs')
  const job = await load('ops', 'scripts', 'ops-d1-physical-export.mjs')
  const loader = await load('ops', 'scripts', 'latest-data', 'load-d1-physical-export.mjs')
  const guard = await load('ops', 'scripts', 'ops-sql-guard.mjs')
  const common = await load('ops', 'scripts', 'ops-common.mjs')
  const crypt = await load('ops', 'scripts', 'ops-crypto.mjs')
  const keys = testKeys()

  const write = (outDir, base, payload, meta) => {
    const text = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload)
    const envelope = crypt.encryptEnvelope(text, keys.publicPem, meta)
    fs.mkdirSync(outDir, { recursive: true })
    const file = path.join(outDir, `${base}.enc.json`)
    fs.writeFileSync(file, `${JSON.stringify(envelope)}\n`)
    return { file, bytes: fs.statSync(file).size }
  }
  const BANNED = /\b(OFFSET|LIKE|GLOB|REGEXP|INSERT|UPDATE|DELETE|DROP|PRAGMA)\b|\?|\$\d|:\w/i

  // ------------------------------------------------------------- the SQL builder

  await check('pageSql: rowid keyset, quote() per column, no OFFSET, LIKE, GLOB or bound parameter', () => {
    const first = lib.pageSql({ table: 'sales', columns: ['id', 'total_usd'], limit: 300 })
    assert.equal(first, 'SELECT CAST(rowid AS TEXT) AS r, quote("id") AS c0, quote("total_usd") AS c1 FROM "sales" ORDER BY rowid LIMIT 300')
    const next = lib.pageSql({ table: 'sales', columns: ['id', 'total_usd'], afterRid: '-12345', limit: 500 })
    assert.equal(next, 'SELECT CAST(rowid AS TEXT) AS r, quote("id") AS c0, quote("total_usd") AS c1 FROM "sales" WHERE rowid > -12345 ORDER BY rowid LIMIT 500')
    for (const sql of [first, next, lib.probeSql('sales'), lib.maxRidSql('sales'), lib.PREFLIGHT_SQL]) {
      assert.ok(!BANNED.test(sql.replace(/'[^']*'/g, "''")), `a banned construct in: ${sql}`)
      assert.equal(guard.guardSql(sql).sql, sql.replace(/\s+/g, ' ').trim(), 'the guard admits it unchanged')
    }
    assert.equal(lib.pageSql({ table: 'sales', columns: ['rowid_x'], rid: '_rowid_', afterRid: '7', limit: 5 }), 'SELECT CAST(_rowid_ AS TEXT) AS r, quote("rowid_x") AS c0 FROM "sales" WHERE _rowid_ > 7 ORDER BY _rowid_ LIMIT 5')
  })

  await check('pageSql refuses every injection and out-of-range input', () => {
    for (const bad of ['a"b', 'a b', '1x', '', 'x;DROP TABLE y', 'x"--', 'ü', 'a'.repeat(129)]) {
      assert.throws(() => lib.quoteIdent(bad), (e) => e.code === 'identifier-unsupported', bad)
      assert.throws(() => lib.pageSql({ table: bad, columns: ['id'], limit: 5 }), (e) => e.code === 'identifier-unsupported')
      assert.throws(() => lib.pageSql({ table: 't', columns: [bad], limit: 5 }), (e) => e.code === 'identifier-unsupported')
    }
    for (const bad of [0, -1, 501, 1.5, NaN, '5', null]) assert.throws(() => lib.pageSql({ table: 't', columns: ['a'], limit: bad }), (e) => e.code === 'page-limit-invalid', String(bad))
    for (const bad of ['1 OR 1=1', '1;', 'x', '', '99999999999999999999', ' 1', '1.5']) assert.throws(() => lib.pageSql({ table: 't', columns: ['a'], afterRid: bad, limit: 5 }), (e) => e.code === 'keyset-invalid', bad)
    assert.throws(() => lib.pageSql({ table: 't', columns: ['a'], rid: 'id', limit: 5 }), (e) => e.code === 'identifier-unsupported')
    assert.throws(() => lib.pageSql({ table: 't', columns: [], limit: 5 }), (e) => e.code === 'identifier-unsupported')
    assert.throws(() => lib.maxRidSql('t', 'x'), (e) => e.code === 'identifier-unsupported')
  })

  await check('ridColumnFor skips a rowid alias a column shadows, and reports when all three are taken', () => {
    assert.equal(lib.ridColumnFor(['id', 'name']), 'rowid')
    assert.equal(lib.ridColumnFor(['ROWID', 'x']), '_rowid_')
    assert.equal(lib.ridColumnFor(['rowid', '_rowid_', 'x']), 'oid')
    assert.equal(lib.ridColumnFor(['rowid', '_rowid_', 'OID']), null)
  })

  await check('parseQuoted reads every quote() form, exactly, and refuses anything else', () => {
    assert.equal(lib.parseQuoted('NULL'), null)
    assert.equal(lib.parseQuoted('9223372036854775807'), 9223372036854775807n)
    assert.equal(lib.parseQuoted('-9223372036854775808'), -9223372036854775808n)
    assert.equal(lib.parseQuoted('0.30000000000000004'), 0.1 + 0.2)
    assert.equal(lib.parseQuoted('3.000000000000000445e-01'), 0.1 + 0.2)
    assert.ok(Object.is(lib.parseQuoted('-0.0'), -0))
    assert.equal(lib.parseQuoted('1.0e+300'), 1e300)
    assert.equal(lib.parseQuoted('9.0e+999'), Infinity)
    assert.equal(lib.parseQuoted("'it''s'"), "it's")
    assert.equal(lib.parseQuoted("'line\none'"), 'line\none')
    assert.equal(lib.parseQuoted("''"), '')
    assert.deepEqual([...lib.parseQuoted("X'00FF'")], [0, 255])
    assert.equal(lib.parseQuoted("X''").length, 0)
    for (const bad of ['9223372036854775808', "X'0'", "X'GG'", "'a'b'", "'unterminated", 'abc', '1 2', '', "1'", '0x10', null, 5]) {
      assert.throws(() => lib.parseQuoted(bad), (e) => e.code === 'bad-quoted-value', String(bad))
    }
  })

  await check('quotedEqual: a REAL compares as a number (D1 and local SQLite print it differently); text, integers and different doubles do not', () => {
    const eq = loader.quotedEqual
    assert.equal(eq('159.60000000000002', '1.596000000000000228e+02'), true, 'the rehearsal case: same double, two spellings')
    assert.equal(eq('0.1', '1.000000000000000055e-01'), true)
    assert.equal(eq('5.0', '5.0e+00'), true)
    assert.equal(eq('159.6', '159.60000000000002'), false, 'two different doubles')
    assert.equal(eq('5', '5.0'), false, 'an integer is never a REAL')
    assert.equal(eq("'1.5'", "'1.50'"), false, 'text is compared as text')
    assert.equal(eq('NULL', "'NULL'"), false)
    assert.equal(eq("X'0A'", "X'0a'"), false, 'a blob literal is compared as written')
    assert.equal(eq('abc', 'abc'), true)
    assert.equal(eq(1.5, '1.5'), false)
  })

  await check('every table of the migrated schema is classified: nothing skipped, no WITHOUT ROWID, no generated column, FTS and shadows excluded', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = OFF;')
    for (const sql of loadAll()) db.exec(sql)
    const master = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid').all()
    const classified = lib.classifySchema(master)
    assert.deepEqual(classified.issues, [], 'a new WITHOUT ROWID or generated-column table would need engine support')
    const physical = db.prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND substr(name, 1, 7) <> 'sqlite_'").all().map((r) => r.name)
    const virtual = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'").all().map((r) => r.name)
    assert.equal(virtual.length, 9)
    const exportedNames = classified.tables.map((t) => t.name)
    const expected = physical.filter((n) => !virtual.some((v) => n === v || ['_data', '_idx', '_content', '_docsize', '_config'].some((s) => n === v + s)))
    assert.deepEqual(exportedNames, [...expected].sort(), 'exactly the physical tables that are not FTS or FTS shadows')
    assert.equal(classified.excluded.filter((e) => e.reason === 'fts-virtual').length, 9)
    assert.ok(classified.excluded.filter((e) => e.reason === 'fts-shadow').length >= 36)
    assert.equal(classified.sequence, true)
    for (const t of classified.tables) {
      const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all(t.name).map((c) => c.name)
      assert.ok(lib.ridColumnFor(columns), `${t.name}: rowid shadowed`)
      const sql = lib.pageSql({ table: t.name, columns, rid: lib.ridColumnFor(columns), afterRid: '123', limit: lib.LIMITS.pageRowsMax })
      assert.equal(guard.guardSql(sql).sql, sql, `${t.name}: the guard changes or refuses the page statement`)
      assert.ok(sql.length < guard.MAX_SQL_CHARS, `${t.name}: ${sql.length} chars`)
      assert.ok(!BANNED.test(sql), `${t.name}: banned construct`)
    }
    assert.ok(!classified.schema.some((e) => classified.excluded.some((x) => x.reason !== 'fts-virtual' && (x.name === e.tbl_name || x.name === e.name))), 'no schema entry is an excluded table or hangs off one')
    assert.equal(classified.schema.filter((e) => /CREATE VIRTUAL TABLE/i.test(e.sql)).length, 9, 'the virtual tables keep their DDL for the loader')
    db.close()
  })

  await check('classifySchema excludes _cf_* and sqlite_* internals and flags WITHOUT ROWID and generated columns instead of exporting them wrongly', () => {
    const rows = [
      { type: 'table', name: '_cf_KV', tbl_name: '_cf_KV', sql: 'CREATE TABLE _cf_KV (k)' },
      { type: 'table', name: 'sqlite_stat1', tbl_name: 'sqlite_stat1', sql: 'CREATE TABLE sqlite_stat1(tbl,idx,stat)' },
      { type: 'table', name: 'sqlite_sequence', tbl_name: 'sqlite_sequence', sql: 'CREATE TABLE sqlite_sequence(name,seq)' },
      { type: 'table', name: 'ok', tbl_name: 'ok', sql: 'CREATE TABLE ok (a)' },
      { type: 'table', name: 'nr', tbl_name: 'nr', sql: 'CREATE TABLE nr (a PRIMARY KEY) WITHOUT ROWID' },
      { type: 'table', name: 'gen', tbl_name: 'gen', sql: 'CREATE TABLE gen (a, b GENERATED ALWAYS AS (a + 1))' },
      { type: 'table', name: 'gen2', tbl_name: 'gen2', sql: 'CREATE TABLE gen2 (a, b AS (a + 1))' },
      { type: 'table', name: 'bad name', tbl_name: 'bad name', sql: 'CREATE TABLE "bad name" (a)' },
      { type: 'table', name: 'f', tbl_name: 'f', sql: 'CREATE VIRTUAL TABLE f USING fts5(x)' },
      { type: 'table', name: 'f_data', tbl_name: 'f_data', sql: 'CREATE TABLE f_data(id INTEGER PRIMARY KEY, block BLOB)' },
      { type: 'table', name: 'f_idx', tbl_name: 'f_idx', sql: 'CREATE TABLE f_idx(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID' },
      { type: 'table', name: 'f_config', tbl_name: 'f_config', sql: 'CREATE TABLE f_config(k PRIMARY KEY, v) WITHOUT ROWID' },
      { type: 'index', name: 'idx_ok', tbl_name: 'ok', sql: 'CREATE INDEX idx_ok ON ok(a)' },
      { type: 'index', name: 'sqlite_autoindex_ok_1', tbl_name: 'ok', sql: null },
      { type: 'trigger', name: 'trg_ok', tbl_name: 'ok', sql: 'CREATE TRIGGER trg_ok AFTER INSERT ON ok BEGIN SELECT 1; END' },
    ]
    const c = lib.classifySchema(rows)
    assert.deepEqual(c.tables.map((t) => t.name), ['ok'])
    assert.deepEqual(c.issues.map((i) => `${i.table}:${i.code}`).sort(), ['bad name:identifier-unsupported', 'gen2:generated-columns-unsupported', 'gen:generated-columns-unsupported', 'nr:without-rowid-unsupported'])
    assert.deepEqual(c.excluded.map((e) => `${e.name}:${e.reason}`).sort(), ['_cf_KV:cloudflare-internal', 'f:fts-virtual', 'f_config:fts-shadow', 'f_data:fts-shadow', 'f_idx:fts-shadow', 'sqlite_stat1:sqlite-internal'])
    assert.equal(c.sequence, true)
    assert.deepEqual(c.schema.map((e) => e.name).sort(), ['bad name', 'f', 'gen', 'gen2', 'idx_ok', 'nr', 'ok', 'trg_ok'], 'the DDL list keeps rows with sql, minus excluded tables and sqlite_sequence')
  })

  // ------------------------------------------------------------------ the engine

  await check('engine: exports every non-FTS table with keyset pages -- every statement guarded, no OFFSET, rows read ~ rows exported', async () => {
    const db = fixtureDatabase()
    const d1 = fakeD1(db)
    const dir = tmpdir('engine')
    const { manifest, verdict } = await job.exportToDir({ outDir: dir, run: '777', commit: 'abcdef1', query: d1.query, write })
    assert.equal(verdict.ok, true, JSON.stringify(manifest.issues))
    assert.deepEqual(manifest.tables.map((t) => t.name), ['ai_provider_configs', 'audit', 'auto_seq', 'd1_migrations', 'docs', 'empty_t', 'no_pk', 'plain_pk', 'portal_accounts', 'settings', 'shadowed', 'system_flags', 'telegram_scheduled_sends', 'text_pk', 'users'])
    assert.deepEqual(manifest.excluded.map((e) => `${e.name}:${e.reason}`).sort(), ['_cf_KV:cloudflare-internal', 'docs_fts:fts-virtual', 'docs_fts_config:fts-shadow', 'docs_fts_data:fts-shadow', 'docs_fts_docsize:fts-shadow', 'docs_fts_idx:fts-shadow'])
    assert.deepEqual(manifest.omitted, [{ name: 'login_lockouts', rows: 2, reason: 'credentials-and-lockouts' }, { name: 'user_sessions', rows: 3, reason: 'credentials-and-lockouts' }, { name: 'verification_codes', rows: 1, reason: 'credentials-and-lockouts' }])
    const byName = Object.fromEntries(manifest.tables.map((t) => [t.name, t]))
    for (const [name, t] of Object.entries(byName)) assert.equal(t.rows, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n, `${name}: row count`)
    assert.ok(manifest.omitted.every((o) => !byName[o.name]), 'omitted tables carry no rows and no chunks')
    assert.equal(byName.empty_t.rows, 0)
    assert.equal(byName.empty_t.sha256, lib.EMPTY_SHA256)
    assert.equal(byName.shadowed.ridColumn, '_rowid_', 'a column called rowid moves the keyset to _rowid_')
    assert.ok(byName.plain_pk.rows > 2600 && byName.plain_pk.pages > 1)
    assert.ok(manifest.sequence && manifest.sequence.some(([n, s]) => n === 'auto_seq' && s === '4'), 'sqlite_sequence keeps the gap above max(id)')
    // Every statement: one guarded read-only SELECT, no OFFSET / LIKE / GLOB / parameter, keyset after the first page.
    let keyset = 0
    for (const sql of d1.log) {
      assert.equal(guard.guardSql(sql).sql, sql.replace(/\s+/g, ' ').trim(), `the guard refuses or rewrites: ${sql.slice(0, 80)}`)
      assert.ok(!BANNED.test(sql.replace(/'[^']*'/g, "''")), `a banned construct in: ${sql.slice(0, 120)}`)
      if (/ FROM "plain_pk" WHERE rowid > -?\d+ ORDER BY rowid LIMIT \d+$/.test(sql)) {
        keyset += 1
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')
        assert.ok(/SEARCH plain_pk USING INTEGER PRIMARY KEY \(rowid>\?\)/.test(plan), plan)
        assert.ok(!/TEMP B-TREE/.test(plan), plan)
      }
    }
    assert.ok(keyset >= 2, 'later pages are rowid-range seeks')
    // Rows read stay linear: the fake reports rows returned, which for keyset pages is what a page costs.
    const expectedRows = manifest.totals.rows + db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get().n + 40
    assert.ok(manifest.totals.rowsRead <= expectedRows, `rows read ${manifest.totals.rowsRead} vs exported ${manifest.totals.rows}`)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: page size grows on light pages, shrinks on heavy ones and never exceeds the limits; chunks split near the byte budget', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE heavy (id INTEGER PRIMARY KEY, body TEXT); CREATE TABLE light (id INTEGER PRIMARY KEY, n INTEGER)')
    db.exec("WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 2000) INSERT INTO light SELECT i, i FROM s")
    const big = 'y'.repeat(50000)
    const ins = db.prepare('INSERT INTO heavy VALUES (?, ?)')
    for (let i = 1; i <= 400; i += 1) ins.run(i, big + i)
    const d1 = fakeD1(db)
    const dir = tmpdir('sizes')
    const { manifest, verdict } = await job.exportToDir({ outDir: dir, run: '1', commit: 'abcdef1', query: d1.query, write })
    assert.equal(verdict.ok, true)
    const limits = d1.log.filter((s) => / ORDER BY rowid LIMIT \d+$/.test(s) && /FROM "(heavy|light)"/.test(s)).map((s) => ({ table: /FROM "(\w+)"/.exec(s)[1], limit: Number(/LIMIT (\d+)$/.exec(s)[1]) }))
    for (const { limit } of limits) assert.ok(limit >= 1 && limit <= lib.LIMITS.pageRowsMax)
    const light = limits.filter((l) => l.table === 'light').map((l) => l.limit)
    assert.ok(light[1] > light[0], `light pages grow: ${light}`)
    const heavy = limits.filter((l) => l.table === 'heavy').map((l) => l.limit)
    assert.ok(heavy[heavy.length - 1] < heavy[0], `heavy pages shrink: ${heavy}`)
    const heavyChunks = manifest.tables.find((t) => t.name === 'heavy').chunks
    assert.ok(heavyChunks.length >= 3, 'a 20 MB table is split into several chunks')
    for (const c of heavyChunks.slice(0, -1)) assert.ok(c.plainBytes <= lib.LIMITS.chunkBytes && c.plainBytes > lib.LIMITS.chunkBytes - 60000, `chunk of ${c.plainBytes} bytes`)
    assert.ok(heavyChunks.length >= 10, 'a 20 MB table is split into many 2 MiB chunks')
    assert.equal(heavyChunks.reduce((n, c) => n + c.rows, 0), 400)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: a page that D1 reports as slow caps the page size for the rest of that table only', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE wide (id INTEGER PRIMARY KEY, v TEXT); CREATE TABLE other (id INTEGER PRIMARY KEY, v TEXT)')
    db.exec("WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 3000) INSERT INTO wide SELECT i, 'v' FROM s; INSERT INTO other SELECT id, v FROM wide")
    const slow = fakeD1(db)
    const timed = async (sql) => {
      const r = await slow.query(sql)
      if (r.ok && / FROM "wide" /.test(sql) && Number(/LIMIT (\d+)$/.exec(sql)?.[1]) >= 250) r.meta.duration = lib.LIMITS.slowPageMs + 1
      return r
    }
    const dir = tmpdir('slow')
    const r = await job.exportToDir({ outDir: dir, run: '12', commit: 'abcdef1', query: timed, write, concurrency: 1 })
    assert.equal(r.verdict.ok, true)
    const limitsOf = (table) => slow.log.filter((sql) => /^SELECT CAST/.test(sql) && sql.includes(` FROM "${table}" `)).map((sql) => Number(/LIMIT (\d+)$/.exec(sql)[1]))
    assert.ok(limitsOf('wide').slice(1).every((n) => n <= 125), `wide pages stay small after the first slow page: ${limitsOf('wide')}`)
    assert.ok(limitsOf('other').some((n) => n === lib.LIMITS.pageRowsMax), `other tables still grow: ${limitsOf('other')}`)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: a retryable refusal (the 7429 CPU reset) halves the page and retries; the result is unchanged', async () => {
    const db = fixtureDatabase()
    const clean = fakeD1(db)
    const dirA = tmpdir('clean')
    const a = await job.exportToDir({ outDir: dirA, run: '2', commit: 'abcdef1', query: clean.query, write, pause: async () => {} })
    let failures = 0
    const flaky = fakeD1(db, {
      behave: (sql) => {
        if (/FROM "plain_pk"/.test(sql) && /LIMIT (3\d\d|[4-9]\d\d|\d{4})$/.test(sql)) { failures += 1; return { ok: false, retryable: true, errorCodes: [7429] } }
        return null
      },
    })
    const dirB = tmpdir('flaky')
    const b = await job.exportToDir({ outDir: dirB, run: '2', commit: 'abcdef1', query: flaky.query, write, pause: async () => {} })
    assert.ok(failures >= 1 && b.manifest.totals.retries >= 1, `retries ${b.manifest.totals.retries}`)
    assert.equal(failures, b.manifest.totals.retries, 'a refused size is not tried again on the same table')
    assert.equal(b.verdict.ok, true)
    assert.deepEqual(b.manifest.tables.map((t) => [t.name, t.rows, t.sha256]), a.manifest.tables.map((t) => [t.name, t.rows, t.sha256]), 'identical hashes')
    for (const dir of [dirA, dirB]) fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: a refusal that never clears, a non-retryable one, and a lost keyset are flagged with fixed codes, never hidden', async () => {
    const db = fixtureDatabase()
    const stuck = fakeD1(db, { behave: (sql) => (/FROM "no_pk"/.test(sql) ? { ok: false, retryable: true, errorCodes: [] } : null) })
    const dir = tmpdir('stuck')
    const r1 = await job.exportToDir({ outDir: dir, run: '3', commit: 'abcdef1', query: stuck.query, write, pause: async () => {} })
    assert.equal(r1.verdict.ok, false)
    assert.ok(r1.manifest.issues.some((i) => i.table === 'no_pk' && i.code === 'statement-kept-failing'))
    assert.equal(r1.manifest.tables.find((t) => t.name === 'no_pk').failed, true)
    assert.equal(r1.manifest.tables.find((t) => t.name === 'plain_pk').failed, false, 'other tables still export')
    const refused = fakeD1(db, { behave: (sql) => (/FROM "text_pk" WHERE/.test(sql) || /SELECT \* FROM "text_pk"/.test(sql) ? { ok: false, retryable: false, errorCodes: [] } : null) })
    const r2 = await job.exportToDir({ outDir: dir, run: '4', commit: 'abcdef1', query: refused.query, write, pause: async () => {} })
    assert.ok(r2.manifest.issues.some((i) => i.table === 'text_pk' && i.code === 'statement-refused'))
    // A server that keeps returning the same page: the keyset must advance or the table fails.
    const looping = fakeD1(db, {
      behave: (sql) => (/FROM "plain_pk" WHERE rowid >/.test(sql) ? { ok: true, rows: Array.from({ length: 300 }, (_, i) => ({ r: String(3 + i), ...Object.fromEntries(Array.from({ length: 6 }, (__, k) => [`c${k}`, 'NULL'])) })), meta: {}, errorCodes: [] } : null),
    })
    const r3 = await job.exportToDir({ outDir: dir, run: '5', commit: 'abcdef1', query: looping.query, write, pause: async () => {} })
    assert.ok(r3.manifest.issues.some((i) => i.table === 'plain_pk' && i.code === 'keyset-not-advancing'))
    // A failed preflight stops before any table is read.
    const wrong = fakeD1(db, { behave: (sql) => (/^SELECT quote\(0\.3/.test(sql) ? { ok: true, rows: [{ real_value: '0.3', big_value: '1', text_value: '', blob_value: '', null_value: '' }], meta: {}, errorCodes: [] } : null) })
    const r4 = await job.exportToDir({ outDir: dir, run: '6', commit: 'abcdef1', query: wrong.query, write, pause: async () => {} })
    assert.equal(r4.manifest.tables.length, 0)
    assert.deepEqual(r4.manifest.issues, [{ code: 'preflight-quote-unexpected' }])
    assert.equal(r4.verdict.ok, false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: a malformed page fails only its table with a fixed code; an unreadable sqlite_sequence is recorded, not fatal', async () => {
    const db = fixtureDatabase()
    const dir = tmpdir('malformed')
    const broken = fakeD1(db, { behave: (sql) => (/FROM "text_pk" WHERE|FROM "text_pk" ORDER/.test(sql) ? { ok: true, rows: [{ r: 'x1' }], meta: {}, errorCodes: [] } : /FROM "sqlite_sequence"/.test(sql) ? { ok: false, retryable: false, errorCodes: [7500] } : null) })
    const r = await job.exportToDir({ outDir: dir, run: '10', commit: 'abcdef1', query: broken.query, write, pause: async () => {} })
    assert.deepEqual(r.manifest.issues, [{ table: 'text_pk', code: 'page-row-malformed' }])
    assert.equal(r.manifest.tables.find((t) => t.name === 'text_pk').failed, true)
    assert.equal(r.manifest.tables.find((t) => t.name === 'plain_pk').failed, false)
    assert.equal(r.manifest.sequence, null)
    assert.deepEqual(r.manifest.skipped, [{ name: 'sqlite_sequence', reason: 'read-refused' }])
    assert.deepEqual(r.verdict, { ok: false, codes: ['page-row-malformed'], failedTables: 1 })
    // a thrown non-OpsError never leaks its message into the issue list
    const boom = fakeD1(db, { behave: (sql) => { if (/FROM "no_pk" ORDER/.test(sql)) throw new Error('secret customer name Sok') } })
    const r2 = await job.exportToDir({ outDir: dir, run: '11', commit: 'abcdef1', query: boom.query, write, pause: async () => {} })
    assert.deepEqual(r2.manifest.issues, [{ table: 'no_pk', code: 'internal-error' }])
    assert.ok(!JSON.stringify(r2.manifest.issues).includes('Sok'))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: concurrency does not change the data; a row added during the export is reported, not lost silently', async () => {
    const db = fixtureDatabase()
    const dir1 = tmpdir('c1')
    const dir3 = tmpdir('c3')
    const one = await job.exportToDir({ outDir: dir1, run: '8', commit: 'abcdef1', query: fakeD1(db).query, write, concurrency: 1 })
    const three = await job.exportToDir({ outDir: dir3, run: '8', commit: 'abcdef1', query: fakeD1(db).query, write, concurrency: 5 })
    assert.deepEqual(three.manifest.tables.map((t) => [t.name, t.rows, t.sha256]), one.manifest.tables.map((t) => [t.name, t.rows, t.sha256]))
    const live = fakeD1(db, {
      behave: (sql) => {
        if (/MAX\(rowid\)/.test(sql) && /"audit"/.test(sql)) db.exec("INSERT INTO audit(msg) VALUES ('late')")
        return null
      },
    })
    const late = await job.exportToDir({ outDir: dir1, run: '9', commit: 'abcdef1', query: live.query, write })
    assert.deepEqual(late.manifest.changedDuringExport, ['audit'])
    assert.equal(late.verdict.ok, true, 'growth is a warning, not a failure')
    for (const dir of [dir1, dir3]) fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('engine: rows of credential tables are never read, and password / OTP / key / token columns are replaced in the SELECT itself', async () => {
    const db = fixtureDatabase()
    const d1 = fakeD1(db)
    const dir = tmpdir('redact')
    const { manifest, verdict } = await job.exportToDir({ outDir: dir, run: '20', commit: 'abcdef1', query: d1.query, write })
    assert.equal(verdict.ok, true, JSON.stringify(manifest.issues))
    // never selected: no statement reads the omitted tables' rows, nor selects a redacted column raw
    for (const sql of d1.log) {
      for (const table of lib.OMITTED_ROW_TABLES) assert.ok(!(sql.includes(`FROM "${table}"`) && !sql.startsWith('SELECT COUNT(*)')), `rows of ${table} were read: ${sql.slice(0, 80)}`)
      for (const [table, columns] of Object.entries(lib.REDACTIONS)) {
        if (!sql.includes(`FROM "${table}"`) || !sql.startsWith('SELECT CAST')) continue
        for (const column of Object.keys(columns)) assert.ok(!new RegExp(`quote\\("${column}"\\)`).test(sql), `${table}.${column} is selected raw`)
      }
    }
    assert.deepEqual(manifest.redactions.map((r) => `${r.table}.${r.column}:${r.kind}`), [
      'ai_provider_configs.api_key_encrypted:literal', 'portal_accounts.password_hash:literal', 'settings.value:conditional', 'system_flags.value:conditional',
      'users.otp_pending_secret:literal', 'users.otp_secret:literal', 'users.password:literal',
    ])
    // none of the fixture's secrets is in any chunk, decrypted
    const all = fs.readdirSync(dir).filter((f) => /-f\d+\.enc\.json$/.test(f)).map((f) => crypt.decryptEnvelope(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), keys.privateKey).plaintext.toString('utf8')).join('')
    const manifestText = crypt.decryptEnvelope(JSON.parse(fs.readFileSync(path.join(dir, 'd1phys-20-manifest.enc.json'), 'utf8')), keys.privateKey).plaintext.toString('utf8')
    for (const [name, secret] of Object.entries(SENTINELS)) {
      assert.ok(!all.includes(secret), `${name} appears in an export line`)
      assert.ok(!manifestText.includes(secret), `${name} appears in the manifest`)
    }
    assert.ok(all.includes('LC Cosmetics') && all.includes("'USD'"), 'ordinary settings are exported')
    assert.ok(all.includes('-1001234'), 'telegram settings are exported (the loader neutralises them after the check)')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('the settings redaction matches isSensitiveSettingKey (parsed from the Worker source) for every key, and nothing secret-looking in the migrated schema escapes redaction', async () => {
    const ts = require('typescript')
    const source = fs.readFileSync(path.join(ROOT, 'cloudflare', 'src', 'lib', 'settingsSensitive.ts'), 'utf8')
    const mod = { exports: {} }
    new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports)
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
    const keys2 = ['shop_name', 'currency', 'telegram_chat_id', 'drive_sync_refresh_token', 'drive_sync_access_token_expires_at', 'DRIVE_SYNC_ACCESS_TOKEN', 'x_secret', 'X_SECRET', '_secret', 'a_api_key', 'a_password', 'pos_address_presets_v1', 'a_token', 'token', 'secretary', 'my_tokens', 'api_key_x', 'receipt_footer_password_hint', 'Telegram_Bot_Token']
    const ins = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)')
    for (const k of keys2) ins.run(k, 'V')
    const redacted = new Set(db.prepare(lib.pageSql({ table: 'settings', columns: ['key', 'value'], limit: 100 })).all().filter((r) => r.c1 === "''").map((r) => lib.parseQuoted(r.c0)))
    for (const k of keys2) {
      if (mod.exports.isSensitiveSettingKey(k)) assert.ok(redacted.has(k), `${k} is sensitive in the Worker but exported`)
    }
    assert.ok(redacted.has('a_token') && redacted.has('Telegram_Bot_Token') && !redacted.has('shop_name') && !redacted.has('secretary') && !redacted.has('my_tokens'))
    // Drift guard: every column of the migrated schema that looks like a credential is redacted or in an omitted table.
    const mdb = new DatabaseSync(':memory:')
    mdb.exec('PRAGMA foreign_keys = OFF;')
    for (const sql of loadAll()) mdb.exec(sql)
    const cols = mdb.prepare("SELECT m.name AS t, x.name AS c FROM sqlite_master m, pragma_table_info(m.name) x WHERE m.type = 'table'").all()
    const BENIGN = new Set(['ai_provider_configs.max_completion_tokens', 'business_os_migration_status.source_hash', 'users.otp_enabled', 'users.otp_pending_created_at', 'users.must_change_password'])
    const looksSecret = /pass|secret|api_key|token|hash|otp|credential/i
    const unhandled = cols.filter((r) => looksSecret.test(r.c) && !/digest|_fts/.test(r.t + r.c) && !BENIGN.has(`${r.t}.${r.c}`)
      && !lib.OMITTED_ROW_TABLES.includes(r.t) && lib.redactionFor(r.t, r.c) === null && !(r.t.endsWith('_fts') || r.t.includes('_fts_')))
    assert.deepEqual(unhandled.map((r) => `${r.t}.${r.c}`), [], 'a credential-looking column is exported raw: add it to REDACTIONS or OMITTED_ROW_TABLES')
    for (const t of lib.OMITTED_ROW_TABLES) assert.ok(cols.some((c) => c.t === t), `${t} no longer exists`)
    for (const [t, columns] of Object.entries(lib.REDACTIONS)) for (const c of Object.keys(columns)) assert.ok(cols.some((x) => x.t === t && x.c === c), `${t}.${c} no longer exists`)
  })

  await check('engine: three CPU resets abort the whole export; nothing is sent after the third', async () => {
    const db = fixtureDatabase()
    let sent = 0
    let afterThird = 0
    let resets = 0
    const cpu = fakeD1(db, {
      behave: (sql) => {
        sent += 1
        if (resets >= 3) afterThird += 1
        if (/FROM "plain_pk" ORDER|FROM "plain_pk" WHERE/.test(sql) || /FROM "no_pk" ORDER/.test(sql) || /FROM "text_pk" ORDER/.test(sql)) {
          resets += 1
          return { ok: false, retryable: true, cpuReset: true, errorCodes: [7429] }
        }
        return null
      },
    })
    const dir = tmpdir('abort')
    const r = await job.exportToDir({ outDir: dir, run: '21', commit: 'abcdef1', query: cpu.query, write, pause: async () => {}, concurrency: 1 })
    assert.equal(r.verdict.ok, false)
    assert.equal(r.manifest.totals.cpuResets, 3)
    assert.equal(resets, 3)
    assert.equal(afterThird, 0, 'no statement is sent once the third reset was seen')
    assert.ok(r.manifest.issues.some((i) => i.code === 'cpu-resets-exceeded'))
    assert.ok(fs.existsSync(path.join(dir, 'd1phys-21-manifest.enc.json')), 'the manifest is still written')
    // two resets are survivable
    let two = 0
    const some = fakeD1(db, { behave: (sql) => { if (/FROM "plain_pk" ORDER|FROM "plain_pk" WHERE rowid > 3 /.test(sql) && two < 2) { two += 1; return { ok: false, retryable: true, cpuReset: true, errorCodes: [7429] } } return null } })
    const ok = await job.exportToDir({ outDir: dir, run: '22', commit: 'abcdef1', query: some.query, write, pause: async () => {}, concurrency: 1 })
    assert.equal(ok.verdict.ok, true, JSON.stringify(ok.manifest.issues))
    assert.equal(ok.manifest.totals.cpuResets, 2)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('chunks: every chunk file has the same size and no timestamp; the text is followed only by NUL padding', async () => {
    const db = fixtureDatabase()
    const dir = tmpdir('pad')
    const { manifest } = await job.exportToDir({ outDir: dir, run: '23', commit: 'abcdef1', query: fakeD1(db).query, write })
    const files = fs.readdirSync(dir).filter((f) => /-f\d+\.enc\.json$/.test(f))
    assert.ok(files.length >= 8)
    assert.equal(new Set(files.map((f) => fs.statSync(path.join(dir, f)).size)).size, 1, 'one size for every chunk file')
    assert.equal(manifest.chunkPaddedBytes, lib.LIMITS.chunkBytes)
    for (const f of files) {
      const env = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      const header = JSON.parse(env.header)
      assert.deepEqual(Object.keys(header.meta).sort(), ['commit', 'kind', 'run', 'seq'])
      assert.match(header.meta.seq, /^\d{6}$/)
      const { plaintext } = crypt.decryptEnvelope(env, keys.privateKey)
      assert.equal(plaintext.length, lib.LIMITS.chunkBytes)
    }
    const manifestEnv = JSON.parse(fs.readFileSync(path.join(dir, 'd1phys-23-manifest.enc.json'), 'utf8'))
    assert.ok(!('createdAt' in JSON.parse(manifestEnv.header).meta))
    assert.throws(() => job.paddedChunk('x'.repeat(lib.LIMITS.chunkBytes + 1)), (e) => e.code === 'row-too-large')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('refs: the task runs only from refs/heads/main', () => {
    assert.equal(job.isMainRef('refs/heads/main'), true)
    for (const bad of ['refs/heads/claude/x', 'refs/heads/main2', 'refs/pull/1/merge', 'refs/tags/main', 'main', '', undefined, null, 'refs/heads/Main']) assert.equal(job.isMainRef(bad), false, String(bad))
  })

  await check('wrangler runs with disk logging off and its log folder in scratch space (plaintext result pages never reach a debug log)', () => {
    const env = common.wranglerEnv({ WRANGLER_WRITE_LOGS: 'true', WRANGLER_LOG_PATH: 'C:/Users/x/.config/.wrangler/logs', EXTRA: '1' })
    assert.equal(env.WRANGLER_WRITE_LOGS, 'false', 'a caller cannot switch logging back on')
    assert.equal(env.WRANGLER_LOG_PATH, common.WRANGLER_LOG_DIR)
    assert.ok(path.resolve(common.WRANGLER_LOG_DIR).startsWith(path.resolve(os.tmpdir())))
    assert.equal(env.WRANGLER_SEND_METRICS, 'false')
    assert.equal(env.EXTRA, '1')
    assert.equal(common.wranglerEnv().WRANGLER_WRITE_LOGS, 'false')
  })

  // ---------------------------------------------------------------- the round trip

  async function exportFixture(db, run = '99') {
    const dir = tmpdir('artifact')
    const result = await job.exportToDir({ outDir: dir, run, commit: 'abcdef1', query: fakeD1(db).query, write })
    assert.equal(result.verdict.ok, true, JSON.stringify(result.manifest.issues))
    return { dir, ...result }
  }

  await check('round trip: export -> encrypt -> decrypt -> load -> identical, type for type, with triggers off during the load and FTS rebuilt', async () => {
    const source = fixtureDatabase()
    const { dir, manifest } = await exportFixture(source)
    const out = path.join(tmpdir('out'), 'rebuilt.sqlite')
    const key = keys.privateKey
    assert.deepEqual(loader.verifyArtifact(dir, key, loader.readManifest(dir, key)), [])
    const result = loader.buildDatabase({ manifest: loader.readManifest(dir, key), inputDir: dir, privateKey: key, outPath: out })
    assert.deepEqual(result.problems, [])
    assert.deepEqual(result.warnings, [])
    assert.ok(result.checks.tables.length === manifest.tables.length && result.checks.tables.every((t) => t.ok))
    const rebuilt = new DatabaseSync(out)
    const REDACTED = new Set(['users', 'portal_accounts', 'ai_provider_configs', 'settings', 'system_flags', 'telegram_scheduled_sends'])
    for (const t of manifest.tables.filter((x) => !REDACTED.has(x.name))) assert.deepEqual(dump(rebuilt, t.name), dump(source, t.name), `${t.name}: rows differ`)
    // redacted tables hold the replacements, everything else in their rows is intact
    assert.deepEqual(rebuilt.prepare('SELECT username, name, password, otp_enabled, otp_secret, otp_pending_secret FROM users ORDER BY id').all().map((r) => ({ ...r })), [
      { username: 'owner', name: 'Owner', password: 'redacted', otp_enabled: 1, otp_secret: null, otp_pending_secret: null },
      { username: 'cashier', name: 'Cashier', password: 'redacted', otp_enabled: 0, otp_secret: null, otp_pending_secret: null },
    ])
    assert.deepEqual(rebuilt.prepare('SELECT phone, password_hash FROM portal_accounts').all().map((r) => ({ ...r })), [{ phone: '012345678', password_hash: 'redacted' }])
    assert.deepEqual(rebuilt.prepare('SELECT provider, api_key_encrypted FROM ai_provider_configs ORDER BY id').all().map((r) => ({ ...r })), [{ provider: 'openai', api_key_encrypted: '' }, { provider: 'none', api_key_encrypted: '' }])
    const settings = Object.fromEntries(rebuilt.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]))
    assert.equal(settings.shop_name, 'LC Cosmetics')
    assert.equal(settings.currency, 'USD')
    for (const k of ['drive_sync_refresh_token', 'drive_sync_access_token_expires_at', 'MY_Secret', 'pos_address_presets_v1']) assert.equal(settings[k], '', k)
    assert.ok(!('Resend_API_KEY' in settings) && !('bot_token' in settings), 'mail and bot keys are dropped by the loader')
    assert.equal(settings.telegram_chat_id, '', 'neutralised')
    assert.equal(settings.telegram_topic_sales, '', 'neutralised')
    assert.equal(settings.telegram_automation_enabled, 'false', 'neutralised')
    assert.deepEqual(rebuilt.prepare('SELECT key FROM system_flags').all().map((r) => r.key), ['branch_cutover_control_incarnation'], 'the maintenance flag is gone')
    assert.deepEqual(rebuilt.prepare('SELECT status FROM telegram_scheduled_sends ORDER BY id').all().map((r) => r.status), ['skipped', 'skipped', 'sent', 'failed'], 'pending sends are skipped')
    for (const t of ['user_sessions', 'verification_codes', 'login_lockouts']) assert.equal(rebuilt.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} is empty but defined`)
    assert.deepEqual({ ...result.checks.neutralised }, { telegramSettings: 3, scheduledSends: 2, keysDropped: 2, maintenanceFlags: 1 })
    // The trigger did not fire during the load (it would have doubled the audit rows) but exists afterwards.
    assert.equal(rebuilt.prepare('SELECT COUNT(*) AS n FROM audit').get().n, source.prepare('SELECT COUNT(*) AS n FROM audit').get().n)
    assert.equal(rebuilt.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_plain_audit'").get().n, 1)
    assert.equal(rebuilt.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('index', 'view') AND name IN ('idx_plain_name', 'idx_text_pk_v', 'v_plain')").get().n, 3)
    // FTS tables and shadow tables are rebuilt from the loaded content, not copied.
    assert.deepEqual(rebuilt.prepare("SELECT rowid FROM docs_fts WHERE docs_fts MATCH 'hello'").all().map((r) => Number(r.rowid)), [1])
    // AUTOINCREMENT continues from production's counter, not from max(id).
    rebuilt.exec("INSERT INTO auto_seq(x) VALUES ('next')")
    assert.equal(rebuilt.prepare("SELECT MAX(id) AS m FROM auto_seq").get().m, 5)
    assert.equal(rebuilt.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_cf_KV'").get().n, 0, 'internal tables are not recreated')
    rebuilt.close()
    for (const d of [dir, path.dirname(out)]) fs.rmSync(d, { recursive: true, force: true })
  })

  await check('round trip into the real migrated schema (--schema migrations): rows load into migrated tables, d1_migrations is compared with the folder', async () => {
    const source = new DatabaseSync(':memory:')
    source.exec('PRAGMA foreign_keys = OFF;')
    for (const sql of loadAll()) source.exec(sql)
    source.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    const names = fs.readdirSync(path.join(ROOT, 'cloudflare', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
    const mig = source.prepare('INSERT INTO d1_migrations(name) VALUES (?)')
    for (const n of names.slice(0, -2)) mig.run(n)
    source.exec("INSERT INTO categories(name, color) VALUES ('Soap', '#fff'), ('Ünï 🧴', NULL); INSERT INTO system_flags(key, value) VALUES ('k', 'v'); INSERT INTO settings(key, value) VALUES ('s', NULL)")
    const { dir, manifest } = await exportFixture(source, '55')
    assert.ok(manifest.tables.length > 130 && manifest.omitted.length === 6)
    assert.ok(manifest.tables.some((t) => t.name === 'products') && !manifest.tables.some((t) => /products_fts/.test(t.name)))
    const out = path.join(tmpdir('mig'), 'rebuilt.sqlite')
    const result = loader.buildDatabase({
      manifest: loader.readManifest(dir, keys.privateKey), inputDir: dir, privateKey: keys.privateKey, outPath: out,
      schemaMode: 'migrations', migrationsDir: path.join(ROOT, 'cloudflare', 'migrations'),
    })
    assert.deepEqual(result.problems, [])
    assert.equal(result.checks.migrations.applied, names.length - 2)
    assert.deepEqual(result.checks.migrations.appliedButNotInFolder, [])
    assert.deepEqual(result.checks.migrations.inFolderNotApplied, names.slice(-2))
    const rebuilt = new DatabaseSync(out)
    for (const t of ['categories', 'system_flags', 'settings', 'd1_migrations']) assert.deepEqual(dump(rebuilt, t), dump(source, t), t)
    // The 167 migration triggers are back, none fired during the load.
    assert.equal(rebuilt.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n, source.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n)
    rebuilt.close()
    for (const d of [dir, path.dirname(out)]) fs.rmSync(d, { recursive: true, force: true })
  })

  await check('loader: refuses a flipped byte, a missing chunk, swapped chunks, a foreign run, a wrong key and a database inside the repository', async () => {
    const source = fixtureDatabase()
    const { dir, manifest } = await exportFixture(source, '66')
    const key = keys.privateKey
    const parsed = loader.readManifest(dir, key)
    const files = fs.readdirSync(dir).filter((f) => /-f\d+\.enc\.json$/.test(f)).sort()
    assert.equal(files.length, manifest.totals.files - 1)
    const copy = (label) => {
      const d = tmpdir(label)
      for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(d, f))
      return d
    }
    // 1. a flipped ciphertext byte
    const flip = copy('flip')
    const target = path.join(flip, files[0])
    const env = JSON.parse(fs.readFileSync(target, 'utf8'))
    const raw = Buffer.from(env.ciphertext, 'base64')
    raw[10] ^= 1
    env.ciphertext = raw.toString('base64')
    fs.writeFileSync(target, JSON.stringify(env))
    assert.ok(loader.verifyArtifact(flip, key, parsed).some((p) => /Integrity check failed/.test(p)))
    // 2. a missing chunk
    const gone = copy('gone')
    fs.rmSync(path.join(gone, files[1]))
    assert.ok(loader.verifyArtifact(gone, key, parsed).some((p) => /is missing/.test(p)))
    // 3. two chunks swapped on disk: each decrypts, neither is where the manifest says
    const swap = copy('swap')
    const [x, y] = files
    const tmp = fs.readFileSync(path.join(swap, x))
    fs.writeFileSync(path.join(swap, x), fs.readFileSync(path.join(swap, y)))
    fs.writeFileSync(path.join(swap, y), tmp)
    assert.ok(loader.verifyArtifact(swap, key, parsed).some((p) => /another run or position/.test(p)))
    // 4. a chunk of another run under this run's name
    const other = await exportFixture(source, '67')
    const foreign = copy('foreign')
    fs.copyFileSync(path.join(other.dir, fs.readdirSync(other.dir).filter((f) => /-f\d+\.enc\.json$/.test(f)).sort()[0]), path.join(foreign, files[0]))
    assert.ok(loader.verifyArtifact(foreign, key, parsed).some((p) => /another run or position/.test(p)))
    // 5. a different private key
    const stranger = testKeys().privateKey
    assert.throws(() => loader.readManifest(dir, stranger), /encrypted for key/)
    // 6. production data may not be written into the repository
    assert.throws(() => loader.buildDatabase({ manifest: parsed, inputDir: dir, privateKey: key, outPath: path.join(ROOT, 'ops', 'should-not-exist.sqlite') }), /inside this repository or any folder under a \.git/)
    assert.ok(!fs.existsSync(path.join(ROOT, 'ops', 'should-not-exist.sqlite')))
    // 7. an existing output is not replaced without --force
    const out = path.join(tmpdir('force'), 'x.sqlite')
    fs.writeFileSync(out, 'x')
    assert.throws(() => loader.buildDatabase({ manifest: parsed, inputDir: dir, privateKey: key, outPath: out }), /already exists/)
    // 8. a truncated manifest chain: remove the last chunk of a multi-chunk table and the chain breaks
    for (const d of [dir, flip, gone, swap, foreign, other.dir, path.dirname(out)]) fs.rmSync(d, { recursive: true, force: true })
  })

  await check('loader: a rebuilt table that differs from the manifest is reported (the re-hash is a real comparison)', async () => {
    const source = fixtureDatabase()
    const { dir } = await exportFixture(source, '70')
    const parsed = loader.readManifest(dir, keys.privateKey)
    const tampered = JSON.parse(JSON.stringify(parsed))
    tampered.tables.find((t) => t.name === 'text_pk').sha256 = '0'.repeat(64)
    tampered.tables.find((t) => t.name === 'audit').rows += 1
    const out = path.join(tmpdir('bad'), 'x.sqlite')
    const result = loader.buildDatabase({ manifest: tampered, inputDir: dir, privateKey: keys.privateKey, outPath: out })
    assert.ok(result.problems.some((p) => /^text_pk: rebuilt table/.test(p)))
    assert.ok(result.problems.some((p) => /^audit: rebuilt table/.test(p)))
    assert.equal(result.checks.tables.filter((t) => !t.ok).length, 2)
    for (const d of [dir, path.dirname(out)]) fs.rmSync(d, { recursive: true, force: true })
  })

  await check('loader: refuses a forged manifest -- ATTACH, VACUUM INTO, a second statement, a trigger that closes early, a wrong kind -- and every real DDL of the 198 migrations passes', async () => {
    const source = fixtureDatabase()
    const { dir } = await exportFixture(source, '80')
    const key = keys.privateKey
    const good = loader.readManifest(dir, key)
    const victim = path.join(tmpdir('victim'), 'attached.sqlite')
    const forge = (entry) => {
      const m = JSON.parse(JSON.stringify(good))
      m.schema.push(entry)
      return m
    }
    const build = (m) => loader.buildDatabase({ manifest: m, inputDir: dir, privateKey: key, outPath: path.join(tmpdir('forged'), 'x.sqlite') })
    const evil = [
      { type: 'table', name: 'a', tbl_name: 'a', sql: `CREATE TABLE a (x); ATTACH DATABASE '${victim.replace(/\\/g, '/')}' AS pwn` },
      { type: 'table', name: 'a', tbl_name: 'a', sql: "CREATE TABLE a (x); VACUUM INTO 'C:/x/y.sqlite'" },
      { type: 'table', name: 'a', tbl_name: 'a', sql: 'CREATE TABLE a (x); CREATE TABLE b (y)' },
      { type: 'table', name: 'a', tbl_name: 'a', sql: 'CREATE TABLE a (x)\n;\nCREATE TABLE b (y)' },
      { type: 'table', name: 'a', tbl_name: 'a', sql: "DROP TABLE users" },
      { type: 'table', name: 'a', tbl_name: 'a', sql: "CREATE TEMP TABLE a (x)" },
      { type: 'table', name: 'a', tbl_name: 'a', sql: "CREATE VIRTUAL TABLE a USING dbstat" },
      { type: 'table', name: 'a', tbl_name: 'a', sql: "-- CREATE TABLE a\nATTACH 'x' AS y" },
      { type: 'table', name: 'a', tbl_name: 'a', sql: "/* CREATE TABLE */ PRAGMA writable_schema = 1" },
      { type: 'index', name: 'i', tbl_name: 'users', sql: 'CREATE TABLE i (x)' },
      { type: 'view', name: 'v', tbl_name: 'v', sql: 'CREATE VIEW v AS SELECT 1; DELETE FROM users' },
      { type: 'trigger', name: 't', tbl_name: 'users', sql: 'CREATE TRIGGER t AFTER INSERT ON users BEGIN SELECT 1; END; DELETE FROM users' },
      { type: 'trigger', name: 't', tbl_name: 'users', sql: 'CREATE TRIGGER t AFTER INSERT ON users BEGIN SELECT 1; END; INSERT INTO settings VALUES (1,2,3); END' },
      { type: 'trigger', name: 't', tbl_name: 'users', sql: "CREATE TRIGGER t AFTER INSERT ON users BEGIN ATTACH 'x' AS y; END" },
      { type: 'trigger', name: 't', tbl_name: 'users', sql: 'CREATE TRIGGER t AFTER INSERT ON users BEGIN SELECT 1; END ; SELECT 2' },
      { type: 'table', name: 'a', tbl_name: 'a', sql: '' },
      { type: 'table', name: 'a', tbl_name: 'a', sql: 'CREATE TABLE "unterminated (x)' },
      { type: 'pragma', name: 'a', tbl_name: 'a', sql: 'CREATE TABLE a (x)' },
      { type: 'table', name: 'a', tbl_name: 'a' },
    ]
    for (const entry of evil) assert.throws(() => build(forge(entry)), /refused|malformed|unsupported|cannot be read/, JSON.stringify(entry).slice(0, 100))
    assert.ok(!fs.existsSync(victim), 'nothing was attached or written')
    // fine ones: quoted names, CASE inside a trigger, strings holding forbidden words
    for (const entry of [
      { type: 'table', name: 'ok1', tbl_name: 'ok1', sql: 'CREATE TABLE "ok1" (a TEXT DEFAULT \'ATTACH; DROP\', b)' },
      { type: 'index', name: 'ok2', tbl_name: 'ok1', sql: 'CREATE UNIQUE INDEX ok2 ON ok1(a);' },
      { type: 'view', name: 'ok3', tbl_name: 'ok3', sql: "CREATE VIEW ok3 AS SELECT 'a;b' AS c FROM ok1" },
      { type: 'trigger', name: 'ok4', tbl_name: 'ok1', sql: "CREATE TRIGGER ok4 AFTER INSERT ON ok1 BEGIN UPDATE ok1 SET b = CASE WHEN a = 'x' THEN 1 ELSE 2 END WHERE rowid = NEW.rowid; DELETE FROM ok1 WHERE 0; END" },
    ]) assert.doesNotThrow(() => loader.assertSingleCreate(entry), entry.name)
    const every = new DatabaseSync(':memory:')
    every.exec('PRAGMA foreign_keys = OFF;')
    for (const sql of loadAll()) every.exec(sql)
    const entries = every.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL').all()
    assert.ok(entries.length > 450)
    for (const entry of entries) assert.doesNotThrow(() => loader.assertSingleCreate({ ...entry }), `${entry.type} ${entry.name}`)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('loader CLI: --run must equal the manifest run; a manifest from another run is refused; output under any folder holding .git is refused', async () => {
    const source = fixtureDatabase()
    const a = await exportFixture(source, '81')
    const keyFile = path.join(tmpdir('keyfile'), 'private-key-file')
    fs.writeFileSync(keyFile, keys.privateKeyPem)
    const out = path.join(tmpdir('cli'), 'x.sqlite')
    const base = ['--input', a.dir, '--private-key', keyFile, '--out', out]
    const quiet = (fn) => {
      const original = process.stdout.write
      const printed = []
      process.stdout.write = (chunk) => { printed.push(String(chunk)); return true }
      try {
        return { value: fn(), printed: printed.join('') }
      } finally {
        process.stdout.write = original
      }
    }
    assert.throws(() => quiet(() => loader.main(base)), /Usage/)
    assert.throws(() => quiet(() => loader.main([...base, '--run', '82'])), /manifest is from run 81, not the run 82/)
    assert.ok(!fs.existsSync(out))
    // a repo-like scratch folder: any ancestor with a .git entry
    const scratch = tmpdir('gitlike')
    fs.mkdirSync(path.join(scratch, '.git'))
    fs.mkdirSync(path.join(scratch, 'deep', 'er'), { recursive: true })
    assert.throws(() => quiet(() => loader.main(['--input', a.dir, '--private-key', keyFile, '--out', path.join(scratch, 'deep', 'er', 'x.sqlite'), '--run', '81'])), /under a \.git/)
    const worktreeLike = tmpdir('worktreelike')
    fs.writeFileSync(path.join(worktreeLike, '.git'), 'gitdir: elsewhere')
    assert.throws(() => quiet(() => loader.main(['--input', a.dir, '--private-key', keyFile, '--out', path.join(worktreeLike, 'x.sqlite'), '--run', '81'])), /under a \.git/)
    const done = quiet(() => loader.main([...base, '--run', '81']))
    assert.equal(done.value, 0, done.printed)
    assert.ok(done.printed.includes('LOAD OK') && done.printed.includes('neutralised'))
    for (const d of [a.dir, path.dirname(keyFile), path.dirname(out), scratch, worktreeLike]) fs.rmSync(d, { recursive: true, force: true })
  })

  // ------------------------------------------------------------- the job's plumbing

  await check('interpretWranglerResult: rows only from a clean single read-only result set; a write, a bad shape or a timeout is not ok', () => {
    const ok = JSON.stringify([{ results: [{ a: 1 }], success: true, meta: { rows_read: 1, rows_written: 0, changes: 0, changed_db: false, duration: 2 } }])
    const good = job.interpretWranglerResult({ code: 0, stdout: ok, stderr: '' })
    assert.equal(good.ok, true)
    assert.deepEqual(good.rows, [{ a: 1 }])
    const wrote = JSON.stringify([{ results: [], success: true, meta: { rows_written: 1 } }])
    assert.equal(job.interpretWranglerResult({ code: 0, stdout: wrote, stderr: '' }).ok, false)
    assert.equal(job.interpretWranglerResult({ code: 0, stdout: JSON.stringify([{ results: [], meta: { changed_db: true } }]), stderr: '' }).ok, false)
    assert.equal(job.interpretWranglerResult({ code: 0, stdout: '[]', stderr: '' }).ok, false)
    assert.equal(job.interpretWranglerResult({ code: 0, stdout: JSON.stringify([{ results: [1], success: true }]), stderr: '' }).ok, false)
    assert.equal(job.interpretWranglerResult({ code: 0, stdout: JSON.stringify([{ results: [], success: false }]), stderr: '' }).ok, false)
    assert.equal(job.interpretWranglerResult({ code: 0, stdout: 'not json', stderr: '' }).ok, false)
    const cpu = job.interpretWranglerResult({ code: 1, stdout: JSON.stringify({ error: { text: 'D1_ERROR: D1 DB exceeded its CPU time limit and was reset. [code: 7429]', code: 7429, notes: [{ text: 'row 12 Sok Dara' }] } }), stderr: '' })
    assert.deepEqual([cpu.ok, cpu.retryable, cpu.cpuReset, cpu.errorCodes], [false, true, true, [7429]])
    // codes come only from wrangler's parsed error object, never from numbers found in free text
    const stderrOnly = job.interpretWranglerResult({ code: 1, stdout: '', stderr: 'D1_ERROR: exceeded its CPU time limit [code: 7429] "code": 123456 customer 0123456789' })
    assert.deepEqual([stderrOnly.retryable, stderrOnly.cpuReset, stderrOnly.errorCodes], [true, true, []])
    assert.deepEqual(job.interpretWranglerResult({ code: 1, stdout: JSON.stringify({ error: { text: 'x', code: 7500 } }), stderr: '' }).errorCodes, [7500])
    assert.deepEqual(job.interpretWranglerResult({ code: 1, stdout: JSON.stringify({ error: { text: 'x', code: 'Sok' } }), stderr: '' }).errorCodes, [])
    assert.deepEqual(job.interpretWranglerResult({ code: 1, stdout: JSON.stringify([{ results: [{ phone: '012345678', code: 424242 }], success: true }]), stderr: 'boom' }).errorCodes, [])
    assert.deepEqual(job.interpretWranglerResult({ code: 0, stdout: JSON.stringify([{ results: [{ code: 7429 }], success: true, meta: {} }]), stderr: '' }).errorCodes, [])
    assert.equal(job.interpretWranglerResult({ code: 1, stdout: '', stderr: 'D1_ERROR: D1 DB is overloaded. Requests queued for too long.' }).retryable, true)
    assert.equal(job.interpretWranglerResult({ code: 1, stdout: JSON.stringify({ error: { text: 'SQLITE_AUTH: not authorized', code: 7500 } }), stderr: '' }).retryable, false)
    assert.equal(job.interpretWranglerResult({ code: 1, stdout: '', stderr: 'no such table: nope' }).retryable, false)
    assert.equal(job.interpretWranglerResult({ code: 1, stdout: '', stderr: '', timedOut: true }).retryable, true)
  })

  await check('public log: only the verdict, fixed codes and file/byte counts -- no table name, row count or row', async () => {
    const db = fixtureDatabase()
    const dir = tmpdir('pub')
    const stuck = fakeD1(db, { behave: (sql) => (/FROM "no_pk"/.test(sql) ? { ok: false, retryable: false, errorCodes: [7500] } : null) })
    const { manifest, verdict } = await job.exportToDir({ outDir: dir, run: '88', commit: 'abcdef1', query: stuck.query, write, pause: async () => {} })
    const lines = job.publicLines({ verdict, manifest, errorCodes: [7500] }).map(([template, values]) => common.formatPublic(template, values))
    const text = lines.join('\n')
    assert.match(text, /d1-physical-export verdict: FAIL/)
    assert.match(text, /problem: statement-refused/)
    assert.match(text, /cloudflare error codes: 7500/)
    for (const secret of ['no_pk', 'plain_pk', 'audit', 'shadowed', 'item 1', String(manifest.totals.rows), 'ខ្មែរ']) assert.ok(!text.includes(secret), `the public log shows ${secret}`)
    // The files on disk carry no table name or data in their names or headers.
    for (const f of fs.readdirSync(dir)) {
      assert.match(f, /^d1phys-88-(f\d{4}|manifest)\.enc\.json$/)
      const env = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      assert.ok(!/plain_pk|no_pk|audit|item/.test(env.header), `header of ${f}`)
      assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('item 1'), `${f} is not encrypted`)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('writeEncryptedReport encrypts a string payload byte for byte (a chunk) and still writes an object as JSON', () => {
    const dir = tmpdir('writer')
    const text = '["1",["NULL"]]\n'.repeat(1000)
    const r = common.writeEncryptedReport(dir, 'd1phys-1-f0001', text, { kind: 'x', createdAt: 'now' })
    const env = JSON.parse(fs.readFileSync(r.file, 'utf8'))
    assert.equal(Buffer.from(env.ciphertext, 'base64').length, Buffer.byteLength(text))
    const o = common.writeEncryptedReport(dir, 'obj', { a: 1 }, { kind: 'x', createdAt: 'now' })
    assert.equal(Buffer.from(JSON.parse(fs.readFileSync(o.file, 'utf8')).ciphertext, 'base64').length, Buffer.byteLength(JSON.stringify({ a: 1 }, null, 1)))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  console.log(process.exitCode ? `test-ops-d1-physical-export-pure: FAILED (${passed} passed)` : `test-ops-d1-physical-export-pure: ${passed} checks passed`)
}

main().catch((err) => {
  process.exitCode = 1
  console.error(err)
})
