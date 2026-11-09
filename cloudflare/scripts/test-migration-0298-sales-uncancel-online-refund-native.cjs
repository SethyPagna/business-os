'use strict'
// Pins migration 0298 on the REAL chain: LF-only; PRE and POST are real (mutated file); a second apply aborts; no row changes; a cancelled sale of an order with a
// refund_noted Record cannot leave 'cancelled'; every other update (and an un-cancel of a sale with no such Record) still works.
// Run: node scripts/test-migration-0298-sales-uncancel-online-refund-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const directory = path.join(__dirname, '../migrations')
const migration = '0298_sales_uncancel_after_online_refund.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize(); base.close()
let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }
const fresh = () => new Database(schema)
const abortName = (error) => (String(error.message).match(/sales_uncancel_online_refund_0298_[a-z]+/) || [''])[0]

function seeded() {
  const db = fresh(); db.exec(sql)
  db.exec("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  const sale = (id, status) => db.exec(`INSERT INTO sales (id, receipt_number, branch_id, sale_status, total_usd, exchange_rate, created_at, updated_at) VALUES (${id}, 'R${id}', 1, '${status}', 25, 4000, '2026-11-01 00:00:00', '2026-11-01 00:00:00')`)
  sale(1, 'cancelled'); sale(2, 'cancelled'); sale(3, 'completed')
  const order = (id, saleId) => db.exec(`INSERT INTO online_orders (id, order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, sale_id)
    VALUES (${id}, 'LB-${id}', 'h${id}', 'fulfilled', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, ${saleId})`)
  order(1, 1); order(2, 2)
  db.exec("INSERT INTO online_order_events (order_id, event, source) VALUES (1, 'refund_noted', 'staff'), (2, 'note', 'staff')")
  return db
}
check('the file is LF-only', () => assert.ok(!sql.includes('\r')))
check('applies on the real chain; one trigger on sales; no row changes', () => {
  const db = fresh(); const before = db.prepare('SELECT COUNT(*) n FROM sales').get().n
  db.exec(sql)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n, before)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger' AND name = 'sales_uncancel_after_online_refund'").get().n, 1)
})
check('a second apply aborts at PRE; PRE and POST are real (mutated file)', () => {
  const db = fresh(); db.exec(sql)
  assert.throws(() => db.exec(sql), (error) => abortName(error) === 'sales_uncancel_online_refund_0298_pre')
  const noCreate = sql.replace(/CREATE TRIGGER sales_uncancel_after_online_refund[\s\S]*?\nEND;\n/, '')
  assert.notEqual(noCreate, sql)
  assert.throws(() => fresh().exec(noCreate), (error) => abortName(error) === 'sales_uncancel_online_refund_0298_post')
})
check('a cancelled sale whose order has a refund_noted Record cannot be reopened (any target status)', () => {
  const db = seeded()
  for (const target of ['completed', 'awaiting_payment', 'awaiting_delivery']) {
    assert.throws(() => db.exec(`UPDATE sales SET sale_status = '${target}' WHERE id = 1`), /online_refund_noted/)
  }
  assert.equal(db.prepare('SELECT sale_status FROM sales WHERE id = 1').get().sale_status, 'cancelled')
})
check('discriminating controls: a linked sale with no refund Record reopens; a plain cancelled sale reopens; other updates on the blocked sale still work; cancelling is free', () => {
  const db = seeded()
  db.exec("UPDATE sales SET sale_status = 'completed' WHERE id = 2")
  assert.equal(db.prepare('SELECT sale_status FROM sales WHERE id = 2').get().sale_status, 'completed')
  db.exec("UPDATE sales SET sale_status = 'cancelled' WHERE id = 3"); db.exec("UPDATE sales SET sale_status = 'completed' WHERE id = 3")
  db.exec("UPDATE sales SET notes = 'kept cancelled' WHERE id = 1"); db.exec("UPDATE sales SET sale_status = 'cancelled' WHERE id = 1")
  db.exec("UPDATE sales SET sale_status = 'completed' WHERE id = 2"); db.exec("UPDATE sales SET sale_status = 'cancelled' WHERE id = 2")
})
console.log(`${passed} passed`)
