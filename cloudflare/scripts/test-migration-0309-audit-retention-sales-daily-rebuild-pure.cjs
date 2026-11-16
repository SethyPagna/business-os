'use strict'
// Pins migration 0309 (lane/sales-daily-totals): the audit-retention partial index is rebuilt with the predicate that keeps system / sales_daily_rebuild forever.
//   - the file is LF-only, numbered once, keeps no WITHOUT ROWID, carries PRE / POST / RECOVERY, and holds exactly one DROP INDEX and one CREATE INDEX;
//   - on the REAL chain through 0308 it changes no row, leaves the same index name on audit_logs(created_at), and the new predicate (taken from the migration text) keeps a
//     system / sales_daily_rebuild row out of the deletable set while an unrelated old system row stays in it; the 0303 predicate (control) would have deleted it;
//   - PRE: on a database without the index it aborts; POST: a CREATE that lost the new action makes the assertion abort (so a bad edit cannot apply silently);
//   - PLAN: the sweep's own shape of statement is planned through the rebuilt index.
// The text equality of that predicate with lib/audit.ts is pinned by test-audit-retention-pure.cjs (DRIFT).
//
// Run (from cloudflare/): node scripts/test-migration-0309-audit-retention-sales-daily-rebuild-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0309_audit_retention_sales_daily_rebuild.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8').replace(/\r\n/g, '\n')
const raw = fs.readFileSync(path.join(directory, migration))
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); return db }
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }
const body = sql.replace(/^--.*$/gm, '')
const where = /CREATE INDEX idx_audit_logs_retention_deletable ON audit_logs \(created_at\) WHERE ([^\n]*);/.exec(sql)[1]
const indexSql = (db) => db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_audit_logs_retention_deletable'").get()?.sql

check('the file is LF-only, numbered 0309 once, keeps rowid, carries PRE / POST / RECOVERY and holds one DROP INDEX and one CREATE INDEX', () => {
  assert.equal(raw.includes(13), false, 'no CR byte')
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0309_')), [migration])
  assert.equal(/WITHOUT\s+ROWID/i.test(body), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
  assert.equal((body.match(/\bDROP INDEX\b/g) || []).length, 1)
  assert.equal((body.match(/\bCREATE INDEX\b/g) || []).length, 1)
  assert.equal(/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/im.test(body), false, 'a schema-only migration: no statement writes a row')
  assert.ok(where.includes("'sales_daily_rebuild'"))
})

const db = chain()
const oldIndex = indexSql(db)
const seed = (d) => {
  const add = d.prepare("INSERT INTO audit_logs(user_id,user_name,action,entity,details,created_at) VALUES (1,'a',?,?,'{}',?)")
  add.run('sales_daily_rebuild', 'system', '2020-01-01 00:00:00')
  add.run('some_other_system_action', 'system', '2020-01-01 00:00:00')
  add.run('reset_data', 'system', '2020-01-01 00:00:00')
  add.run('login', 'auth', '2020-01-01 00:00:00')
}
seed(db)
const rowsBefore = JSON.stringify(db.prepare('SELECT * FROM audit_logs ORDER BY id').all())
const deletable = (d, text) => d.prepare(`SELECT action FROM audit_logs WHERE ${text} ORDER BY id`).all().map((r) => r.action)

check('control: the 0303 index (before 0309) does not name the action, and its predicate would delete the rebuild record', () => {
  assert.ok(oldIndex && !oldIndex.includes('sales_daily_rebuild'))
  const oldWhere = /WHERE (.*)$/s.exec(oldIndex)[1]
  assert.deepEqual(deletable(db, oldWhere), ['sales_daily_rebuild', 'some_other_system_action', 'login'])
})

check('applied on the real chain: no row changes, the same index name stays on audit_logs(created_at), the new predicate keeps the rebuild record and still deletes unrelated rows', () => {
  db.exec(sql)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM audit_logs ORDER BY id').all()), rowsBefore)
  const row = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type='index' AND name='idx_audit_logs_retention_deletable'").get()
  assert.equal(row.tbl_name, 'audit_logs')
  assert.ok(row.sql.includes('sales_daily_rebuild') && /audit_logs \(created_at\) WHERE/.test(row.sql))
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_audit_logs_retention_deletable'").get().n, 1)
  assert.deepEqual(deletable(db, where), ['some_other_system_action', 'login'], 'sales_daily_rebuild and reset_data are kept')
})

check('PLAN: a retention-sweep shaped statement is planned through the rebuilt partial index', () => {
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM audit_logs WHERE created_at < '2021-01-01' AND ${where}`).all().map((r) => r.detail).join(' | ')
  assert.match(plan, /idx_audit_logs_retention_deletable/, plan)
})

check('PRE: on a database without the index the migration aborts; a second run on the rebuilt index still succeeds and keeps one index', () => {
  const bare = chain()
  bare.exec('DROP INDEX idx_audit_logs_retention_deletable')
  assert.throws(() => bare.exec(sql), /no such index/i)
  assert.doesNotThrow(() => db.exec(sql))
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_audit_logs_retention_deletable'").get().n, 1)
})

check('POST: a CREATE that lost the new action makes the closing assertion abort, so an edited migration cannot apply silently', () => {
  const broken = chain()
  // only the CREATE INDEX line loses the action; the closing SELECT still demands it
  const mutated = sql.split('\n').map((line) => (line.startsWith('CREATE INDEX') ? line.replace("'finalize_migration', 'sales_daily_rebuild'", "'finalize_migration'") : line)).join('\n')
  assert.notEqual(mutated, sql)
  assert.throws(() => broken.exec(mutated), /JSON path|malformed|audit_retention_0309_post/i)
  assert.doesNotThrow(() => chain().exec(sql), 'the unmodified file applies')
})

console.log(`${passed} checks passed`)
