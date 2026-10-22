'use strict'
// The schema baseline for a NEW client database, and the proof that it equals
// the shared migration chain minus the chain's data.
//
//   replayChain       apply migrations <= `through` to an in-memory SQLite, the engine D1 runs
//   readSchema        sqlite_master as (type, name, tbl_name, sql), FTS shadow tables left out
//   fingerprint       sha256 over that list: two databases with the same fingerprint have the same schema
//   renderBaseline    cloudflare/baseline/schema-<NNNN>.sql
//   provision         baseline + seeds + d1_migrations stamp, refusing a database that is not empty
//   applyPending      what `wrangler d1 migrations apply` does, for the local proofs
//
// docs/setup/migrations-multi-client.md explains why a new client uses this and
// not the chain. Used by ops/scripts/client/*.mjs and the baseline tests.

const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { MIGRATIONS_DIR, migrationFiles, migrationNumber, sha256, splitStatements } = require('./migration_sql.cjs')

const CLOUDFLARE_DIR = path.join(__dirname, '..', '..')
const BASELINE_DIR = path.join(CLOUDFLARE_DIR, 'baseline')
const MANIFEST_PATH = path.join(CLOUDFLARE_DIR, 'migrations-manifest.json')
const DEFAULT_THROUGH = 269

// wrangler's own ledger table, byte for byte what `d1 migrations apply` creates.
const D1_MIGRATIONS_DDL = 'CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'

/**
 * The ONLY rows a new client database holds before its first user writes. Each
 * is a constant the chain installs on any empty database and the triggers need:
 * with no stock_schema_epoch row every branch_stock / product cost write aborts
 * with stock_transaction_required (0243, 0258). Nothing here is one client's data.
 * Everything else the chain leaves behind (see test-migration-fresh-chain-rows-pure.cjs)
 * belongs to the first client and is NOT seeded.
 */
const SEED_ROWS = [
  { table: 'system_flags', key: 'stock_schema_epoch', value: 'legacy-separate-pool-v1', from: '0243', why: 'the stock triggers refuse every stock write without it' },
  { table: 'system_flags', key: 'stock_schema_receipt_boundary', value: '0', from: '0243', why: 'MAX(stock_mutation_receipts.id) on an empty database' },
  { table: 'system_flags', key: 'multilot_revert_watermark', value: '0', from: '0250', why: 'MAX(inventory_movements.id) on an empty database' },
]

const q = (v) => `'${String(v).replace(/'/g, "''")}'`

function chainFiles({ through = Infinity, dir = MIGRATIONS_DIR } = {}) {
  return migrationFiles(dir).filter((f) => migrationNumber(f) <= through)
}

function replayChain({ through = Infinity, dir = MIGRATIONS_DIR, extra = [] } = {}) {
  const db = new Database(':memory:')
  for (const file of chainFiles({ through, dir })) {
    try { db.exec(fs.readFileSync(path.join(dir, file), 'utf8')) } catch (error) { throw new Error(`${file} failed on an empty database: ${error.message}`) }
  }
  for (const { name, sql } of extra) {
    try { db.exec(sql) } catch (error) { throw new Error(`${name} failed on an empty database: ${error.message}`) }
  }
  return db
}

/**
 * The one query that defines "the schema" for a fingerprint, local or remote.
 * No pragma, so a read-only D1 `--command` can run the very same text. FTS5
 * shadow tables (<fts>_data / _idx / _content / _docsize / _config) belong to
 * their CREATE VIRTUAL TABLE and are left out.
 */
const SCHEMA_SELECT_SQL = "SELECT type, name, tbl_name, sql FROM sqlite_master m WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations' "
  + "AND NOT EXISTS (SELECT 1 FROM sqlite_master v WHERE v.sql LIKE 'CREATE VIRTUAL TABLE%' AND m.name IN (v.name || '_data', v.name || '_idx', v.name || '_content', v.name || '_docsize', v.name || '_config')) "
  + 'ORDER BY type, name'

function readSchema(db) { return db.prepare(SCHEMA_SELECT_SQL).all() }

function fingerprint(objects) {
  return sha256(JSON.stringify(objects.map((o) => [o.type, o.name, o.tbl_name, o.sql])))
}

function schemaCounts(objects) {
  const out = { table: 0, index: 0, view: 0, trigger: 0 }
  for (const o of objects) out[o.type] += 1
  return out
}

function manifestDigest(through) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const rows = manifest.migrations.filter((m) => migrationNumber(m.name) <= through).map((m) => `${m.name}:${m.sha256}`)
  return sha256(rows.join('\n'))
}

function renderBaseline({ through = DEFAULT_THROUGH, objects, fingerprint: fp, digest }) {
  const counts = schemaCounts(objects)
  const out = []
  out.push(`-- Business OS schema baseline through migration ${String(through).padStart(4, '0')}. GENERATED, do not edit.`)
  out.push('-- Rebuild: node ops/scripts/client/build-baseline.mjs   Check: node ops/scripts/client/build-baseline.mjs --check')
  out.push('-- Use: ops/scripts/client/provision-database.mjs (empty database only), then the normal chain applies 0270+.')
  out.push(`-- schema-fingerprint: ${fp}`)
  out.push(`-- chain-digest: ${digest}   (sha256 of the manifest name:sha256 lines through ${String(through).padStart(4, '0')})`)
  out.push(`-- objects: ${counts.table} tables (FTS shadow tables are created by their CREATE VIRTUAL TABLE), ${counts.index} indexes, ${counts.view} views, ${counts.trigger} triggers`)
  out.push('-- Rows: only the seed block below. No organization, fee, alias, customer, product, sale or setting.')
  out.push('')
  const emit = (type) => { for (const o of objects.filter((x) => x.type === type)) out.push(`${o.sql};`, '') }
  emit('table')
  emit('index')
  out.push('-- SEED: constants the stock triggers require. See SEED_ROWS in cloudflare/scripts/harness/client_baseline.cjs.')
  for (const row of SEED_ROWS) out.push(`INSERT INTO ${row.table} (key, value, updated_at) VALUES (${q(row.key)}, ${q(row.value)}, CURRENT_TIMESTAMP);`)
  out.push('')
  emit('view')
  emit('trigger')
  const text = out.join('\n')
  if (text.includes('\r')) throw new Error('baseline text contains a CR; trigger SQL must stay LF')
  return text
}

/** Every user table's row count, FTS shadow tables and sqlite_* internals excluded. Zero-row tables omitted. */
function rowCensus(db) {
  const shadow = new Set(db.prepare("SELECT name FROM pragma_table_list WHERE type = 'shadow'").all().map((r) => r.name))
  const out = {}
  // sqlite_* and _cf_* (Cloudflare's own D1/Miniflare bookkeeping, e.g. _cf_METADATA) are the platform's, not the client's.
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name").all()) {
    if (shadow.has(name)) continue
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n
    if (n) out[name] = n
  }
  return out
}

function isEmptyDatabase(db) {
  const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND NOT (type = 'table' AND name = 'd1_migrations')").all()
  const ledger = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").get().n
    ? db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n
    : 0
  return { empty: objects.length === 0 && ledger === 0, objects, ledgerRows: ledger }
}

/**
 * Baseline + seed + stamp, in one transaction. Throws (and rolls back) on a
 * non-empty database or any mismatch; the database is then left empty.
 */
function provision(db, { baselineSql, stampNames, expectedFingerprint }) {
  const state = isEmptyDatabase(db)
  if (!state.empty) {
    const what = state.objects.length ? `${state.objects.length} schema object(s), first: ${state.objects[0].type} ${state.objects[0].name}` : `d1_migrations holds ${state.ledgerRows} row(s)`
    throw new Error(`refusing to provision: the database is not empty (${what})`)
  }
  db.exec('BEGIN')
  try {
    db.exec(baselineSql)
    db.exec(D1_MIGRATIONS_DDL)
    const stamp = db.prepare('INSERT INTO d1_migrations (name) VALUES (?)')
    for (const name of stampNames) stamp.run(name)
    const actual = fingerprint(readSchema(db))
    if (actual !== expectedFingerprint) throw new Error(`schema fingerprint mismatch: provisioned ${actual}, expected ${expectedFingerprint}`)
    const census = rowCensus(db)
    const expectedCensus = { d1_migrations: stampNames.length }
    for (const row of SEED_ROWS) expectedCensus[row.table] = (expectedCensus[row.table] || 0) + 1
    const want = JSON.stringify(Object.entries(expectedCensus).sort())
    const got = JSON.stringify(Object.entries(census).sort())
    if (want !== got) throw new Error(`provisioned rows differ from the seed allowlist: expected ${want}, found ${got}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Apply every file in `files` ([{name, sql}]) not yet in d1_migrations, each in its own transaction, as wrangler does. */
function applyPending(db, files) {
  db.exec(D1_MIGRATIONS_DDL)
  const applied = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name))
  const record = db.prepare('INSERT INTO d1_migrations (name) VALUES (?)')
  const ran = []
  for (const { name, sql } of files.slice().sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (applied.has(name)) continue
    db.exec('BEGIN')
    try { db.exec(sql); record.run(name); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw new Error(`${name} failed: ${error.message}`) }
    ran.push(name)
  }
  return ran
}

function baselinePath(through = DEFAULT_THROUGH) { return path.join(BASELINE_DIR, `schema-${String(through).padStart(4, '0')}.sql`) }

/** Build everything the baseline file and the provisioner need, from the current chain. */
function buildBaseline({ through = DEFAULT_THROUGH } = {}) {
  const db = replayChain({ through })
  const objects = readSchema(db)
  db.close()
  const fp = fingerprint(objects)
  const text = renderBaseline({ through, objects, fingerprint: fp, digest: manifestDigest(through) })
  return { text, fingerprint: fp, objects, stampNames: chainFiles({ through }) }
}

/** The baseline must split into exactly its objects + seeds under the statement splitter the lint uses. */
function statementCount(text) { return splitStatements(text).length }

module.exports = {
  BASELINE_DIR, MANIFEST_PATH, DEFAULT_THROUGH, SEED_ROWS, D1_MIGRATIONS_DDL, SCHEMA_SELECT_SQL,
  chainFiles, replayChain, readSchema, fingerprint, schemaCounts, manifestDigest, renderBaseline,
  rowCensus, isEmptyDatabase, provision, applyPending, baselinePath, buildBaseline, statementCount,
}
