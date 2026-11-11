'use strict'
// Pins migration 0303 (three index changes of the 11 Nov D1 audit) on the REAL migration chain:
//   S8   idx_customers_sales_picker: the empty customer-picker search walks the partial index instead of scanning and sorting every customer, with identical rows
//        in identical order; the EXPLAIN pin fails on a differently spelled predicate (IFNULL, IS NOT 1) and on the unmigrated schema.
//   S13  idx_audit_logs_retention_deletable: the daily audit sweep uses it and deletes exactly the same ids as before; the pin fails when the sweep's predicate drifts.
//   W4   idx_settings_key_unique (the duplicate of settings' primary key) is dropped: same column, collation and uniqueness proven first, duplicates are still
//        refused and ON CONFLICT(key) / INSERT OR REPLACE upserts still work; PRE aborts when the duplicate is not an exact duplicate.
// Also: the file is LF-only, applies cleanly on a fresh chain, adds exactly two indexes and removes exactly one, and changes no row.
//
// Run (from cloudflare/): node scripts/test-migration-0303-d1-queries-indexes-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0303_d1_query_indexes.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'migration SQL is LF-only')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); return db }
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all().map((r) => ({ ...r }))
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r }))
const plan = (db, statement, ...params) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(...params).map((r) => r.detail).join(' | ')

const load = (file) => {
  const out = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('exports', 'require', 'module', out)(m.exports, (r) => (r === './db' ? { getDb() {} } : r === './actorSnapshot' ? { ACTOR_USERNAME_SQL: '', resolveActorUsername() {} } : require(r)), m)
  return m.exports
}
const { buildSalesCustomerPickerSql } = load('contactPicker.ts')
const audit = load('audit.ts')

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const pre = chain()
const post = chain()

// ---- fixtures, inserted into both databases before the migration so rows are compared across it ------------------------------------------------------------
const customers = [
  ['alice', 0], ['Alice', 0], ['  Bob', 0], ['', 0], ['Ångström', 0], ['សុខា', 0], ['Zed', 0], ['anon walk-in', 1], ['Mia', 0], ['mia', 0], ['Lee Ann', 0], ['Lee', 0],
]
const AUDIT_BASE = 100000
for (const db of [pre, post]) {
  const insert = db.prepare('INSERT INTO customers(id,name,phone,is_anonymous) VALUES(?,?,?,?)')
  customers.forEach(([name, anon], i) => insert.run(i + 1, name, `0${100000 + i}`, anon))
  db.exec("INSERT INTO settings(key,value,updated_at) VALUES('a','1','t'),('b','2','t')")
  const auditInsert = db.prepare('INSERT INTO audit_logs(id,action,entity,table_name,details,created_at) VALUES(?,?,?,?,?,?)')
  const rows = [
    ['create', 'sale', null, null], ['login', 'user', null, null], ['update', 'user', null, null], ['settings_update', 'settings', null, null], ['stock_add', 'product', null, null],
    ['approve', 'pending_action', null, '{"section":"products"}'], ['approve', 'pending_action', null, '{"section":"brands"}'], ['reject', 'pending_action', null, '{"section":"fees"}'],
    ['login', null, 'sessions', null], ['x_undo', 'brand', null, null], ['y_undo', 'product', null, null], ['whatever', null, null, null], ['update', 'Role ', null, null],
  ]
  rows.forEach(([action, entity, table, details], i) => auditInsert.run(AUDIT_BASE + i + 1, action, entity, table, details, i < 11 ? '2026-01-01 00:00:00' : '2026-10-30 00:00:00'))
}
const before = objects(post)
const rowsBefore = JSON.stringify(['customers', 'settings', 'audit_logs'].map((t) => dump(post, t)))

const pickerSqls = {
  empty8: [buildSalesCustomerPickerSql(), { limit: 8 }],
  empty50: [buildSalesCustomerPickerSql(), { limit: 50 }],
  empty6000: [buildSalesCustomerPickerSql(), { limit: 6000 }],
  named: [buildSalesCustomerPickerSql(["lower(name) LIKE '%li%'"]), { limit: 50 }],
  ranked: [buildSalesCustomerPickerSql([], true), { limit: 50, picker_rank: 'mia' }],
  ids: [buildSalesCustomerPickerSql(['id IN (1,2,3,8,9)']), { limit: 50 }],
}
const pickerRows = (db) => Object.fromEntries(Object.entries(pickerSqls).map(([k, [q, p]]) => [k, db.prepare(q).all(p).map((r) => ({ ...r }))]))
const pickerBefore = pickerRows(pre)

const auditDelete = audit.buildAuditLogRetentionDeleteSql()
const runAuditDelete = (db) => { db.prepare(auditDelete).run({ cutoff: '2026-09-01 00:00:00' }); return db.prepare('SELECT id FROM audit_logs ORDER BY id').all().map((r) => r.id) }
const fixtureIds = (ids) => ids.filter((id) => id > AUDIT_BASE).map((id) => id - AUDIT_BASE)

check('before the migration the empty picker SCANs customers and sorts (the cost this fixes); the sweep walks idx_audit_logs_created', () => {
  const p = plan(pre, pickerSqls.empty8[0], pickerSqls.empty8[1])
  assert.match(p, /SCAN customers/)
  assert.match(p, /USE TEMP B-TREE FOR ORDER BY/)
  assert.match(plan(pre, auditDelete, { cutoff: '2026-09-01' }), /idx_audit_logs_created/)
})

check('applies on a fresh chain: adds exactly two indexes, drops exactly one, changes no row', () => {
  post.exec(sql)
  const now = objects(post)
  const added = now.filter((r) => !before.some((b) => b.name === r.name))
  const removed = before.filter((b) => !now.some((r) => r.name === b.name))
  assert.deepEqual(added, [{ type: 'index', name: 'idx_audit_logs_retention_deletable' }, { type: 'index', name: 'idx_customers_sales_picker' }])
  assert.deepEqual(removed, [{ type: 'index', name: 'idx_settings_key_unique' }])
  assert.equal(JSON.stringify(['customers', 'settings', 'audit_logs'].map((t) => dump(post, t))), rowsBefore)
})

// ---- S8 -----------------------------------------------------------------------------------------------------------------------------------------------------
const usesPickerIndex = (db, statement, params) => {
  const p = plan(db, statement, params)
  return /idx_customers_sales_picker/.test(p) && !/USE TEMP B-TREE FOR ORDER BY/.test(p)
}
check('S8 pin: buildSalesCustomerPickerSql() walks idx_customers_sales_picker in its own order, no temp b-tree', () => {
  assert.ok(usesPickerIndex(post, pickerSqls.empty8[0], pickerSqls.empty8[1]), plan(post, pickerSqls.empty8[0], pickerSqls.empty8[1]))
  assert.ok(usesPickerIndex(post, pickerSqls.empty6000[0], pickerSqls.empty6000[1]))
})
check('S8 pin is discriminating: IFNULL(...), IS NOT 1 and = 0 spellings do not use the index, so the pin would go red', () => {
  const base = pickerSqls.empty8[0]
  assert.match(base, /COALESCE\(is_anonymous, 0\) = 0/)
  for (const wrong of [base.replace('COALESCE(is_anonymous, 0) = 0', 'IFNULL(is_anonymous, 0) = 0'), base.replace('COALESCE(is_anonymous, 0) = 0', 'is_anonymous IS NOT 1'), base.replace('COALESCE(is_anonymous, 0) = 0', 'is_anonymous = 0')]) {
    assert.notEqual(wrong, base)
    assert.equal(usesPickerIndex(post, wrong, { limit: 8 }), false, wrong)
  }
})
check('S8 differential: empty LIMIT 8 / 50 / 6000, a LIKE search, the ranked search and an id filter return identical rows in identical order before and after', () => {
  const after = pickerRows(post)
  assert.deepEqual(after, pickerBefore)
  assert.equal(after.empty8.length, 8)
  assert.equal(after.empty6000.length, 11, 'the anonymous customer is excluded')
  assert.ok(after.empty6000.every((r) => r.is_anonymous === 0))
})
check('S8: a renamed or newly anonymous customer moves in or out of the index and the answer follows', () => {
  post.exec("UPDATE customers SET name = 'AAA first' WHERE id = 7")
  const first = post.prepare(pickerSqls.empty8[0]).all({ limit: 8 }).map((r) => r.name)
  assert.deepEqual(first.slice(0, 3), ['', '  Bob', 'AAA first'])
  post.exec('UPDATE customers SET is_anonymous = 1 WHERE id = 7')
  assert.equal(post.prepare(pickerSqls.empty6000[0]).all({ limit: 6000 }).some((r) => r.name === 'AAA first'), false)
  post.exec("UPDATE customers SET is_anonymous = 0, name = 'Zed' WHERE id = 7")
  assert.deepEqual(pickerRows(post), pickerBefore)
})

// ---- W4: settings --------------------------------------------------------------------------------------------------------------------------------------------
const facts = (db, index) => db.prepare('SELECT name, coll, desc FROM pragma_index_xinfo(?) WHERE key = 1').all(index).map((r) => ({ ...r }))
check('W4: before the drop the two settings indexes are the same column, collation, direction and uniqueness', () => {
  const dupe = pre.prepare("SELECT \"unique\" AS u, partial FROM pragma_index_list('settings') WHERE name = ?")
  assert.deepEqual({ ...dupe.get('idx_settings_key_unique') }, { u: 1, partial: 0 })
  assert.deepEqual({ ...dupe.get('sqlite_autoindex_settings_1') }, { u: 1, partial: 0 })
  assert.deepEqual(facts(pre, 'idx_settings_key_unique'), [{ name: 'key', coll: 'BINARY', desc: 0 }])
  assert.deepEqual(facts(pre, 'sqlite_autoindex_settings_1'), [{ name: 'key', coll: 'BINARY', desc: 0 }])
})
check('W4: after the drop duplicates are still refused, upserts still work and reads still seek by the primary key', () => {
  assert.equal(post.prepare("SELECT COUNT(*) AS n FROM pragma_index_list('settings')").get().n, 1)
  assert.throws(() => post.exec("INSERT INTO settings(key,value) VALUES('a','dup')"), /UNIQUE constraint failed: settings\.key/)
  post.exec("INSERT INTO settings(key,value,updated_at) VALUES('a','9','t2') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
  post.exec("INSERT INTO settings(key,value,updated_at) VALUES('new','1','t') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  post.exec("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('b','replaced','t3')")
  assert.deepEqual(post.prepare("SELECT key,value FROM settings WHERE key IN ('a','b','new') ORDER BY key").all().map((r) => ({ ...r })), [{ key: 'a', value: '9' }, { key: 'b', value: 'replaced' }, { key: 'new', value: '1' }])
  assert.match(plan(post, 'SELECT value FROM settings WHERE key = ?', 'a'), /SEARCH settings USING (COVERING )?INDEX sqlite_autoindex_settings_1 \(key=\?\)/)
  assert.match(plan(post, "SELECT value FROM settings WHERE key IN ('a','b')"), /sqlite_autoindex_settings_1/)
})
check('W4: settings keeps one index (the primary key) instead of two, so a write maintains one index row less', () => {
  const indexCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM pragma_index_list('settings')").get().n
  assert.equal(indexCount(pre), 2)
  assert.equal(indexCount(post), 1)
})

// ---- PRE / POST --------------------------------------------------------------------------------------------------------------------------------------------
const abort = /0303_pre|0303_post|malformed JSON|JSON path/i
check('PRE aborts on a second run, when the settings duplicate is not an exact duplicate, or when a table is missing', () => {
  assert.throws(() => post.exec(sql), abort)
  const nocase = chain()
  nocase.exec('DROP INDEX idx_settings_key_unique; CREATE UNIQUE INDEX idx_settings_key_unique ON settings (key COLLATE NOCASE)')
  assert.throws(() => nocase.exec(sql), abort)
  const plain = chain()
  plain.exec('DROP INDEX idx_settings_key_unique; CREATE INDEX idx_settings_key_unique ON settings (key)')
  assert.throws(() => plain.exec(sql), abort)
  const partial = chain()
  partial.exec("DROP INDEX idx_settings_key_unique; CREATE UNIQUE INDEX idx_settings_key_unique ON settings (key) WHERE key <> ''")
  assert.throws(() => partial.exec(sql), abort)
  const bare = new DatabaseSync(':memory:')
  bare.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY)')
  assert.throws(() => bare.exec(sql), abort)
})
check('POST aborts when an index is not the partial one', () => {
  const mutated = sql.replace(' WHERE COALESCE(is_anonymous, 0) = 0;', ';')
  assert.notEqual(mutated, sql)
  assert.throws(() => chain().exec(mutated), abort)
  const noAudit = sql.replace(/CREATE INDEX idx_audit_logs_retention_deletable ON audit_logs \(created_at\) WHERE [^\n]*;/, 'CREATE INDEX idx_audit_logs_retention_deletable ON audit_logs (created_at);')
  assert.notEqual(noAudit, sql)
  assert.throws(() => chain().exec(noAudit), abort)
})

// ---- S13 ----------------------------------------------------------------------------------------------------------------------------------------------------
const normalize = (text) => text.replace(/\s+/g, ' ').trim()
check('S13 drift: the index WHERE in the migration is AUDIT_RETENTION_DELETABLE_SQL, whitespace aside, and the delete embeds the same constant', () => {
  const where = /CREATE INDEX idx_audit_logs_retention_deletable ON audit_logs \(created_at\) WHERE ([^\n]*);/.exec(sql)[1]
  assert.equal(normalize(where), normalize(audit.AUDIT_RETENTION_DELETABLE_SQL))
  assert.ok(normalize(auditDelete).includes(normalize(audit.AUDIT_RETENTION_DELETABLE_SQL)))
})
check('S13: the sweep plans through idx_audit_logs_retention_deletable', () => {
  const p = plan(post, auditDelete, { cutoff: '2026-09-01' })
  assert.match(p, /idx_audit_logs_retention_deletable/)
  assert.doesNotMatch(p, /idx_audit_logs_created\b/)
})
check('S13 pin is discriminating: a sweep predicate that drifted from the index text falls back to idx_audit_logs_created', () => {
  const drifted = auditDelete.replace("'shift_session'", "'shift_session_x'")
  assert.notEqual(drifted, auditDelete)
  const p = plan(post, drifted, { cutoff: '2026-09-01' })
  assert.doesNotMatch(p, /idx_audit_logs_retention_deletable/)
})
check('S13 differential: the sweep deletes exactly the same ids with and without the index', () => {
  const withoutIndex = runAuditDelete(pre)
  const withIndex = runAuditDelete(post)
  assert.deepEqual(withIndex, withoutIndex)
  const kept = fixtureIds(withIndex)
  assert.deepEqual(kept, [1, 3, 5, 6, 8, 11, 12, 13], 'sale, user create/update, stock_add, approved products review, fees review, product undo, legacy-old and recent rows stay; login, settings, brand undo, rejected review go')
})
console.log(`${passed} checks passed.`)
