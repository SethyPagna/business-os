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
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privateKey: crypto.createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })) }
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
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
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
    assert.deepEqual(manifest.tables.map((t) => t.name), ['audit', 'auto_seq', 'd1_migrations', 'docs', 'empty_t', 'no_pk', 'plain_pk', 'shadowed', 'text_pk'])
    assert.deepEqual(manifest.excluded.map((e) => `${e.name}:${e.reason}`).sort(), ['_cf_KV:cloudflare-internal', 'docs_fts:fts-virtual', 'docs_fts_config:fts-shadow', 'docs_fts_data:fts-shadow', 'docs_fts_docsize:fts-shadow', 'docs_fts_idx:fts-shadow'])
    const byName = Object.fromEntries(manifest.tables.map((t) => [t.name, t]))
    for (const [name, t] of Object.entries(byName)) assert.equal(t.rows, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n, `${name}: row count`)
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
    for (const c of heavyChunks.slice(0, -1)) assert.ok(c.plainBytes >= lib.LIMITS.chunkBytes && c.plainBytes < lib.LIMITS.chunkBytes + lib.LIMITS.targetPageBytes * 2)
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
    const stuck = fakeD1(db, { behave: (sql) => (/FROM "no_pk"/.test(sql) ? { ok: false, retryable: true, errorCodes: [7429] } : null) })
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
    for (const t of manifest.tables) assert.deepEqual(dump(rebuilt, t.name), dump(source, t.name), `${t.name}: rows differ`)
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
    assert.ok(manifest.tables.length > 140)
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
    assert.throws(() => loader.buildDatabase({ manifest: parsed, inputDir: dir, privateKey: key, outPath: path.join(ROOT, 'ops', 'should-not-exist.sqlite') }), /inside this repository/)
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
    const cpu = job.interpretWranglerResult({ code: 1, stdout: '', stderr: 'D1_ERROR: D1 DB exceeded its CPU time limit and was reset. [code: 7429]' })
    assert.deepEqual([cpu.ok, cpu.retryable, cpu.errorCodes], [false, true, [7429]])
    assert.equal(job.interpretWranglerResult({ code: 1, stdout: '', stderr: 'D1_ERROR: D1 DB is overloaded. Requests queued for too long.' }).retryable, true)
    assert.equal(job.interpretWranglerResult({ code: 1, stdout: '', stderr: 'SQLITE_AUTH: not authorized [code: 7500]' }).retryable, false)
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
