'use strict'
// Pins migration 0299 (the staff phone-search index) on the REAL chain: LF-only; PRE/POST real (mutated file); a second apply aborts; no row changes; the prefix search plans
// through the index (no scan of the table); RECOVERY removes it and nothing else.
// Run: node scripts/test-migration-0299-online-orders-phone-index-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const directory = path.join(__dirname, '../migrations')
const migration = '0299_online_orders_phone_index.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize(); base.close()
let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }
const fresh = () => new Database(schema)
const abortName = (error) => (String(error.message).match(/online_orders_phone_index_0299_[a-z]+/) || [''])[0]
check('the file is LF-only', () => assert.ok(!sql.includes('\r')))
check('applies on the real chain; the index exists; no row changes', () => {
  const db = fresh(); const before = db.prepare('SELECT COUNT(*) n FROM online_orders').get().n
  db.exec(sql)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM online_orders').get().n, before)
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_online_orders_phone'").get().sql, /ON online_orders \(customer_phone, created_at, id\)/)
})
check('a second apply aborts at PRE; PRE and POST are real (mutated file)', () => {
  const db = fresh(); db.exec(sql)
  assert.throws(() => db.exec(sql), (error) => abortName(error) === 'online_orders_phone_index_0299_pre')
  const noCreate = sql.replace(/CREATE INDEX idx_online_order_events_refund[^\n]*\n/, '')
  assert.notEqual(noCreate, sql)
  assert.throws(() => fresh().exec(noCreate), (error) => abortName(error) === 'online_orders_phone_index_0299_post')
})
check('a phone prefix search plans through the index, never a scan of the table', () => {
  const db = fresh(); db.exec(sql)
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM online_orders WHERE customer_phone >= '01234' AND customer_phone < '01234~' ORDER BY created_at DESC, id DESC LIMIT 51").all().map((r) => r.detail).join(' | ')
  assert.match(plan, /idx_online_orders_phone/); assert.doesNotMatch(plan, /SCAN online_orders(?! USING)/)
})
check('the refund report plans through idx_online_order_events_refund, never a scan of the Records', () => {
  const db = fresh(); db.exec(sql)
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*), SUM(amount_usd) FROM online_order_events e WHERE e.event = 'refund_noted' AND e.created_at >= '2026-11-01'").all().map((r) => r.detail).join(' | ')
  assert.match(plan, /idx_online_order_events_refund/); assert.doesNotMatch(plan, /SCAN online_order_events(?! USING)/)
})

check('RECOVERY removes both indexes and nothing else', () => {
  const db = fresh(); db.exec(sql)
  const names = () => db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name)
  const after = names(); db.exec('DROP INDEX IF EXISTS idx_online_orders_phone; DROP INDEX IF EXISTS idx_online_order_events_refund;')
  assert.deepEqual(after.filter((n) => !names().includes(n)), ['idx_online_order_events_refund', 'idx_online_orders_phone'])
})
console.log(`${passed} passed`)
