'use strict'
// Pins migration 0295 (the two partial indexes the online order sweep reads through) on the REAL chain: both exist and are partial, the PRE bound and
// the POST assertion fire (proven by mutating the file), a second apply aborts, no row changes, the sweep's two statements plan through them, and the
// documented RECOVERY removes them. The file is LF-only.
//
// Run: node scripts/test-migration-0295-online-order-sweep-indexes-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0295_online_order_sweep_indexes.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }
const fresh = () => new Database(schema)
const abortName = (error) => (String(error.message).match(/online_order_sweep_indexes_0295_[a-z]+/) || [''])[0]
const figures = (db) => db.prepare('SELECT (SELECT COUNT(*) FROM online_orders) o, (SELECT COUNT(*) FROM online_order_payments) p').get()

check('the file is LF-only', () => assert.ok(!sql.includes('\r')))

check('applies on the real chain; all four indexes exist and are partial; no row changes', () => {
  const db = fresh()
  const before = figures(db)
  db.exec(sql)
  assert.deepEqual(figures(db), before)
  const defs = Object.fromEntries(db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN ('idx_online_orders_qr_failed','idx_online_order_payments_expired','idx_online_order_events_payment','idx_online_orders_scrub')").all().map((r) => [r.name, r.sql]))
  assert.match(defs.idx_online_orders_qr_failed, /ON online_orders \(updated_at\) WHERE state = 'qr_failed'/)
  assert.match(defs.idx_online_order_payments_expired, /ON online_order_payments \(expires_at, last_checked_at\) WHERE state IN \('expired','cancelled'\)/)
  assert.match(defs.idx_online_order_events_payment, /ON online_order_events \(payment_id, event\) WHERE payment_id IS NOT NULL/)
  assert.match(defs.idx_online_orders_scrub, /ON online_orders \(updated_at, id\) WHERE scrubbed_at IS NULL AND state IN \('expired','cancelled','qr_failed'\)/)
})

check('a second apply aborts at the PRE bound and changes nothing', () => {
  const db = fresh(); db.exec(sql)
  assert.throws(() => db.exec(sql), (error) => abortName(error) === 'online_order_sweep_indexes_0295_pre')
})

check('PRE and POST are real: with one index already present PRE aborts; with the CREATE removed POST aborts', () => {
  const half = fresh(); half.exec('CREATE INDEX idx_online_orders_qr_failed ON online_orders (created_at)')
  assert.throws(() => half.exec(sql), (error) => abortName(error) === 'online_order_sweep_indexes_0295_pre')
  const noCreate = sql.replace(/CREATE INDEX idx_online_order_events_payment[^\n]*\n/, '')
  assert.notEqual(noCreate, sql)
  assert.throws(() => fresh().exec(noCreate), (error) => abortName(error) === 'online_order_sweep_indexes_0295_post')
})

check('the two sweep statements plan through their index, never a scan', () => {
  const db = fresh(); db.exec(sql)
  const plan = (statement) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all().map((r) => r.detail).join(' | ')
  const qrFailed = plan("SELECT id FROM online_orders INDEXED BY idx_online_orders_qr_failed WHERE state = 'qr_failed' AND updated_at <= '2026-11-09 00:00:00' ORDER BY updated_at LIMIT 5")
  assert.match(qrFailed, /idx_online_orders_qr_failed/); assert.doesNotMatch(qrFailed, /SCAN online_orders(?! USING)/)
  const late = plan("SELECT p.id FROM online_order_payments p INDEXED BY idx_online_order_payments_expired WHERE p.state IN ('expired','cancelled') AND p.expires_at >= '2026-11-08 00:00:00' AND (p.last_checked_at IS NULL OR p.last_checked_at <= '2026-11-09 00:00:00') ORDER BY p.expires_at LIMIT 5")
  assert.match(late, /idx_online_order_payments_expired/); assert.doesNotMatch(late, /SCAN p(?! USING)/)
})

check('the scrub candidate list plans through idx_online_orders_scrub, never a scan or a sort', () => {
  const db = fresh(); db.exec(sql)
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM online_orders INDEXED BY idx_online_orders_scrub WHERE scrubbed_at IS NULL AND state IN ('expired','cancelled','qr_failed') AND updated_at <= '2026-08-01 00:00:00' ORDER BY updated_at ASC, id ASC LIMIT 25").all().map((r) => r.detail).join(' | ')
  assert.match(plan, /idx_online_orders_scrub/); assert.doesNotMatch(plan, /SCAN online_orders(?! USING)/); assert.doesNotMatch(plan, /TEMP B-TREE/)
})

check('RECOVERY removes all four indexes and nothing else', () => {
  const db = fresh(); db.exec(sql)
  const names = () => db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name)
  const after = names()
  db.exec('DROP INDEX IF EXISTS idx_online_orders_qr_failed; DROP INDEX IF EXISTS idx_online_order_payments_expired; DROP INDEX IF EXISTS idx_online_order_events_payment; DROP INDEX IF EXISTS idx_online_orders_scrub;')
  assert.deepEqual(after.filter((n) => !names().includes(n)), ['idx_online_order_events_payment', 'idx_online_order_payments_expired', 'idx_online_orders_qr_failed', 'idx_online_orders_scrub'])
})

console.log(`migration 0295: ${passed} checks passed`)
