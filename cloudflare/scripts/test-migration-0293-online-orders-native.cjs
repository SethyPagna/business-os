'use strict'
// Pins migration 0293 (online orders, KHQR lane slice S2) on the REAL chain of every earlier migration: schema only
// (returns count and sums identical, every refund_channel NULL), the four tables refuse malformed rows, the order and
// payment invariants hold in the database (delivery needs an address, fulfilled <=> sale_id, one order per sale, paid
// needs its proof), requests and events are append-only (UPDATE aborts; DELETE aborts outside the restore flag and the
// reset guard), the decision/apply/record uniqueness holds, the PRE bound and POST assertion fire (proven by mutating
// the file), a second apply aborts, and the documented RECOVERY restores the old schema.
//
// Run: node scripts/test-migration-0293-online-orders-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0293_online_orders.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const abortName = error => (String(error.message).match(/online_orders_0293_[a-z]+/) || [''])[0]
const TABLES = ['online_orders', 'online_order_payments', 'online_order_requests', 'online_order_events']

const returnsFigures = db => db.prepare('SELECT COUNT(*) n, ROUND(SUM(total_refund_usd),4) usd, SUM(total_refund_khr) khr FROM returns').get()
function seedReturns(db) {
  db.prepare("INSERT INTO branches(id,name) VALUES(1,'Shop')").run()
  for (const [number, usd, khr] of [['RET-1', 4.25, 17425], ['RET-2', 1.5, 6150], ['RET-3', 9, 36900]]) {
    db.prepare('INSERT INTO returns(return_number,total_refund_usd,total_refund_khr) VALUES(?,?,?)').run(number, usd, khr)
  }
}
function insert(db, table, row) {
  const cols = Object.keys(row)
  return db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c]))
}
let counter = 0
const order = (o = {}) => { counter += 1; return {
  order_no: `W${counter}`, token_hash: `hash-${counter}`, state: 'awaiting_payment', fulfilment: 'delivery', branch_id: 1,
  customer_name: 'Test Customer', customer_phone: '012000111', customer_address: 'House 1, Street 2', currency: 'USD',
  goods_total_usd: 24.5, items_json: '[{"product_id":1,"quantity":2}]', pricing_version: 1, ...o,
} }
const payment = (o = {}) => { counter += 1; return { order_id: 1, tran_id: `TRAN${counter}`, purpose: 'order', amount: 24.5, currency: 'USD', ...o } }
const request = (o = {}) => ({ order_id: 1, kind: 'items', stage: 'paid', before_json: '[]', after_json: '[]', ...o })
const event = (o = {}) => ({ order_id: 1, event: 'created', source: 'customer', ...o })
function setMode(db, mode) {
  db.exec("INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
  if (mode) db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode }))
  db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
}
function setReset(db, open, token = 't-1') {
  db.exec("INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  db.prepare("DELETE FROM system_flags WHERE key='sale_record_events_reset_guard'").run()
  if (open) db.prepare("INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard',?)").run(JSON.stringify({ mode: 'reset', token }))
  db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
}
const fresh = () => { const db = new Database(schema); seedReturns(db); db.exec(sql); return db }

check('the file is LF-only, carries PRE, POST and RECOVERY, and no table is WITHOUT ROWID', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
  const db = fresh()
  for (const table of TABLES) {
    const ddl = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql
    assert.ok(!/WITHOUT\s+ROWID/i.test(ddl), table)
  }
  db.close()
})

check('PRE/POST: returns count and sums are identical, every refund_channel is NULL, all four tables are empty', () => {
  const db = new Database(schema)
  seedReturns(db)
  const before = returnsFigures(db)
  const rowsBefore = db.prepare('SELECT * FROM returns ORDER BY id').all().map(({ refund_channel, ...row }) => row)
  db.exec(sql)
  assert.equal(before.n, 3, 'control: the fixture really has returns to compare')
  assert.deepEqual(returnsFigures(db), before)
  assert.deepEqual(db.prepare('SELECT * FROM returns ORDER BY id').all().map(({ refund_channel, ...row }) => row), rowsBefore)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM returns WHERE refund_channel IS NOT NULL').get().n, 0)
  for (const table of TABLES) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table)
  db.close()
})

check('refund_channel accepts NULL, drawer and aba only; an old writer that omits it stores NULL', () => {
  const db = fresh()
  db.prepare("INSERT INTO returns(return_number,total_refund_usd) VALUES('RET-OLD',2)").run()
  assert.equal(db.prepare("SELECT refund_channel v FROM returns WHERE return_number='RET-OLD'").get().v, null)
  for (const value of ['drawer', 'aba', null]) db.prepare("UPDATE returns SET refund_channel = ? WHERE return_number = 'RET-OLD'").run(value)
  assert.throws(() => db.prepare("UPDATE returns SET refund_channel = 'cash' WHERE return_number = 'RET-OLD'").run(), /CHECK/)
  assert.throws(() => db.prepare("UPDATE returns SET refund_channel = '' WHERE return_number = 'RET-OLD'").run(), /CHECK/)
  db.close()
})

check('online_orders refuses each malformed row and accepts a good delivery and a pickup without an address', () => {
  const db = fresh()
  insert(db, 'online_orders', order())
  insert(db, 'online_orders', order({ fulfilment: 'pickup', customer_address: null }))
  const refused = (overrides, pattern) => assert.throws(() => insert(db, 'online_orders', order(overrides)), pattern)
  refused({ state: 'refunded' }, /CHECK/)
  refused({ fulfilment: 'courier' }, /CHECK/)
  refused({ currency: 'EUR' }, /CHECK/)
  refused({ goods_total_usd: 0 }, /CHECK/)
  refused({ goods_total_usd: -1 }, /CHECK/)
  refused({ items_json: 'nope' }, /CHECK/)
  refused({ items_json: '{"a":1}' }, /CHECK/)
  refused({ customer_name: '   ' }, /CHECK/)
  refused({ customer_name: 'x'.repeat(61) }, /CHECK/)
  refused({ customer_phone: '' }, /CHECK/)
  refused({ customer_address: null }, /CHECK/)
  refused({ customer_address: '   ' }, /CHECK/)
  refused({ customer_address: 'x'.repeat(301) }, /CHECK/)
  refused({ note: 'x'.repeat(301) }, /CHECK/)
  refused({ contact_telegram: 'x'.repeat(101) }, /CHECK/)
  refused({ exchange_rate: 0 }, /CHECK/)
  refused({ branch_id: null }, /NOT NULL/)
  refused({ customer_name: null }, /NOT NULL/)
  const dup = order()
  insert(db, 'online_orders', dup)
  assert.throws(() => insert(db, 'online_orders', { ...order(), order_no: dup.order_no }), /UNIQUE/)
  assert.throws(() => insert(db, 'online_orders', { ...order(), token_hash: dup.token_hash }), /UNIQUE/)
  insert(db, 'online_orders', order({ client_request_id: 'req-1' }))
  assert.throws(() => insert(db, 'online_orders', order({ client_request_id: 'req-1' })), /UNIQUE/)
  for (const field of ['telegram', 'instagram', 'facebook', 'tiktok', 'whatsapp', 'other']) insert(db, 'online_orders', order({ [`contact_${field}`]: '@handle' }))
  db.close()
})

check('fulfilled and sale_id travel together, and one sale has at most one order', () => {
  const db = fresh()
  assert.throws(() => insert(db, 'online_orders', order({ state: 'fulfilled' })), /CHECK/, 'fulfilled without a sale')
  assert.throws(() => insert(db, 'online_orders', order({ state: 'paid', sale_id: 7 })), /CHECK/, 'a sale without fulfilled')
  insert(db, 'online_orders', order({ state: 'fulfilled', sale_id: 7 }))
  assert.throws(() => insert(db, 'online_orders', order({ state: 'fulfilled', sale_id: 7 })), /UNIQUE/, 'a second order on the same sale')
  insert(db, 'online_orders', order({ state: 'fulfilled', sale_id: 8 }))
  insert(db, 'online_orders', order({ state: 'paid' }))
  insert(db, 'online_orders', order({ state: 'paid' }))
  assert.throws(() => db.prepare("UPDATE online_orders SET state = 'paid' WHERE sale_id = 7").run(), /CHECK/, 'an unlink without clearing the link')
  assert.throws(() => db.prepare('UPDATE online_orders SET sale_id = 9 WHERE id = 3').run(), /CHECK/, 'a link without fulfilling')
  db.prepare("UPDATE online_orders SET state = 'fulfilled', sale_id = 9 WHERE id = 3").run()
  db.close()
})

check('online_order_payments refuses malformed rows; paid needs its proof; a top-up needs its request', () => {
  const db = fresh()
  insert(db, 'online_order_payments', payment())
  const refused = (overrides, pattern) => assert.throws(() => insert(db, 'online_order_payments', payment(overrides)), pattern)
  refused({ tran_id: 'T'.repeat(21) }, /CHECK/)
  refused({ purpose: 'tip' }, /CHECK/)
  refused({ amount: 0 }, /CHECK/)
  refused({ currency: 'THB' }, /CHECK/)
  refused({ state: 'refunded' }, /CHECK/)
  refused({ state: 'paid' }, /CHECK/)
  refused({ state: 'paid', paid_at: '2026-11-09 08:00:00' }, /CHECK/)
  refused({ purpose: 'top_up' }, /CHECK/)
  refused({ order_id: null }, /NOT NULL/)
  const first = payment()
  insert(db, 'online_order_payments', first)
  assert.throws(() => insert(db, 'online_order_payments', payment({ tran_id: first.tran_id })), /UNIQUE/)
  insert(db, 'online_order_payments', payment({ state: 'paid', paid_at: '2026-11-09 08:00:00', paid_amount: 24.5 }))
  insert(db, 'online_order_payments', payment({ purpose: 'top_up', request_id: 1 }))
  assert.equal(db.prepare('SELECT state, revision FROM online_order_payments ORDER BY id').get().state, 'awaiting', 'default state')
  db.prepare("UPDATE online_order_payments SET state = 'expired' WHERE id = 1").run()
  db.close()
})

check('requests and events: malformed rows are refused', () => {
  const db = fresh()
  insert(db, 'online_order_requests', request())
  const refused = (table, row, pattern) => assert.throws(() => insert(db, table, row), pattern)
  refused('online_order_requests', request({ kind: 'refund' }), /CHECK/)
  refused('online_order_requests', request({ stage: 'sale' }), /CHECK/)
  refused('online_order_requests', request({ before_json: 'x' }), /CHECK/)
  refused('online_order_requests', request({ after_json: null }), /NOT NULL/)
  refused('online_order_requests', request({ customer_comment: 'x'.repeat(301) }), /CHECK/)
  refused('online_order_requests', request({ attachments_json: 'nope' }), /CHECK/)
  refused('online_order_requests', request({ attachments_json: '{"a":1}' }), /CHECK/)
  refused('online_order_requests', request({ attachments_json: JSON.stringify(['x'.repeat(4000)]) }), /CHECK/)
  insert(db, 'online_order_requests', request({ kind: 'return', stage: 'after_sale', attachments_json: '["uploads/online-orders/a.jpg","uploads/online-orders/b.jpg"]' }))
  insert(db, 'online_order_requests', request({ attachments_json: '[]' }))
  insert(db, 'online_order_events', event())
  refused('online_order_events', event({ event: 'paid' }), /CHECK/)
  refused('online_order_events', event({ source: 'robot' }), /CHECK/)
  refused('online_order_events', event({ detail_json: 'not json' }), /CHECK/)
  refused('online_order_events', event({ public_comment: 'x'.repeat(301) }), /CHECK/)
  refused('online_order_events', event({ internal_note: 'x'.repeat(501) }), /CHECK/)
  refused('online_order_events', event({ reference: 'x'.repeat(61) }), /CHECK/)
  refused('online_order_events', event({ attachments_json: 'nope' }), /CHECK/)
  refused('online_order_events', event({ attachments_json: '{"a":1}' }), /CHECK/)
  refused('online_order_events', event({ attachments_json: JSON.stringify(['x'.repeat(4000)]) }), /CHECK/)
  insert(db, 'online_order_events', event({ event: 'request_rejected', request_id: 9, source: 'staff', public_comment: 'Opened item', attachments_json: '["uploads/online-orders/c.jpg"]' }))
  refused('online_order_events', event({ order_id: null }), /NOT NULL/)
  for (const name of ['created', 'edited', 'qr_issued', 'qr_failed', 'callback', 'verified_paid', 'late_paid', 'mismatch', 'expired', 'cancelled', 'resolved',
    'fulfilled', 'refund_noted', 'request_submitted', 'request_applied', 'order_edited', 'note', 'scrubbed']) {
    insert(db, 'online_order_events', event({ event: name, request_id: name === 'request_applied' ? 1 : null, detail_json: '{"ok":true}' }))
  }
  for (const source of ['customer', 'payway', 'sweep', 'staff']) insert(db, 'online_order_events', event({ source }))
  db.close()
})

check('one decision and one apply per request, and one recorded event per payment', () => {
  const db = fresh()
  insert(db, 'online_order_events', event({ event: 'request_submitted', request_id: 1 }))
  insert(db, 'online_order_events', event({ event: 'request_submitted', request_id: 1 }))
  insert(db, 'online_order_events', event({ event: 'request_accepted', request_id: 1, source: 'staff' }))
  for (const second of ['request_accepted', 'request_rejected', 'request_withdrawn']) {
    assert.throws(() => insert(db, 'online_order_events', event({ event: second, request_id: 1, source: 'staff' })), /UNIQUE/, second)
  }
  insert(db, 'online_order_events', event({ event: 'request_rejected', request_id: 2, source: 'staff' }))
  insert(db, 'online_order_events', event({ event: 'request_applied', request_id: 1, source: 'staff' }))
  assert.throws(() => insert(db, 'online_order_events', event({ event: 'request_applied', request_id: 1, source: 'staff' })), /UNIQUE/)
  insert(db, 'online_order_events', event({ event: 'request_applied', request_id: 2, source: 'staff' }))
  insert(db, 'online_order_events', event({ event: 'payment_recorded_on_sale', payment_id: 5, source: 'staff', sale_id: 7 }))
  assert.throws(() => insert(db, 'online_order_events', event({ event: 'payment_recorded_on_sale', payment_id: 5, source: 'staff', sale_id: 7 })), /UNIQUE/)
  insert(db, 'online_order_events', event({ event: 'payment_recorded_on_sale', payment_id: 6, source: 'staff', sale_id: 7 }))
  insert(db, 'online_order_events', event({ event: 'verified_paid', payment_id: 5 }))
  insert(db, 'online_order_events', event({ event: 'verified_paid', payment_id: 5 }))
  db.close()
})

check('append-only: UPDATE always aborts; DELETE aborts outside restore and the reset guard and passes inside either', () => {
  for (const [table, row] of [['online_order_requests', request()], ['online_order_events', event()]]) {
    const db = fresh()
    insert(db, table, row)
    const column = table === 'online_order_requests' ? 'customer_comment' : 'internal_note'
    assert.throws(() => db.prepare(`UPDATE ${table} SET ${column} = 'x'`).run(), /append-only/, table)
    assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /immutable/, table)
    setMode(db, 'other')
    assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /immutable/, 'a different maintenance mode is not a restore')
    setMode(db, 'restore')
    assert.throws(() => db.prepare(`UPDATE ${table} SET ${column} = 'x'`).run(), /append-only/, 'even a restore never rewrites')
    db.prepare(`DELETE FROM ${table}`).run()
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0)
    setMode(db, null)
    insert(db, table, row)
    setReset(db, true)
    db.prepare(`DELETE FROM ${table}`).run()
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, 'the factory reset guard may clear personal data')
    db.close()
  }
  const db = fresh()
  insert(db, 'online_order_events', event())
  setReset(db, true, '')
  assert.throws(() => db.prepare('DELETE FROM online_order_events').run(), /immutable/, 'a guard without a token opens nothing')
  db.close()
})

check('orders and payments stay editable (state moves are updates), and none of the tables has a foreign key', () => {
  const db = fresh()
  insert(db, 'online_orders', order())
  insert(db, 'online_order_payments', payment())
  db.prepare("UPDATE online_orders SET state = 'paid', revision = revision + 1, paid_at = '2026-11-09 08:00:00' WHERE id = 1").run()
  db.prepare("UPDATE online_order_payments SET state = 'paid', paid_at = '2026-11-09 08:00:00', paid_amount = 24.5 WHERE id = 1").run()
  db.prepare('DELETE FROM online_order_payments').run()
  db.prepare('DELETE FROM online_orders').run()
  for (const table of TABLES) assert.equal(db.prepare(`SELECT COUNT(*) n FROM pragma_foreign_key_list('${table}')`).get().n, 0, table)
  db.close()
})

check('the indexes serve their reads', () => {
  const db = fresh()
  const plan = query => db.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map(row => row.detail).join(' | ')
  assert.match(plan("SELECT id FROM online_order_events WHERE order_id = 1 ORDER BY id"), /idx_online_order_events_order/)
  assert.match(plan('SELECT id FROM online_order_requests WHERE order_id = 1 ORDER BY id'), /idx_online_order_requests_order/)
  assert.match(plan("SELECT id FROM online_order_requests WHERE created_at >= '2026-10-01' AND NOT EXISTS (SELECT 1 FROM online_order_events e WHERE e.request_id = online_order_requests.id AND e.event IN ('request_accepted','request_rejected','request_withdrawn')) ORDER BY created_at DESC LIMIT 50"), /idx_online_order_requests_created/, 'the bell reads pending requests through the created_at index')
  assert.match(plan('SELECT id FROM online_order_payments WHERE order_id = 1 ORDER BY id'), /idx_online_order_payments_order/)
  assert.match(plan("SELECT id FROM online_order_payments WHERE state = 'awaiting' AND expires_at < 'z'"), /idx_online_order_payments_open/)
  assert.match(plan("SELECT id FROM online_orders WHERE state IN ('paid','review') ORDER BY created_at"), /idx_online_orders_attention/)
  assert.match(plan('SELECT id FROM online_orders WHERE sale_id = 7'), /idx_online_orders_sale/)
  assert.match(plan('SELECT id FROM online_orders ORDER BY created_at DESC, id DESC LIMIT 50'), /idx_online_orders_created/)
  assert.match(plan("SELECT 1 FROM online_order_events WHERE request_id = 3 AND event IN ('request_accepted','request_rejected','request_withdrawn')"), /idx_online_order_events_(decision|request)/)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name LIKE 'online_order%'").get().n, 12)
  db.close()
})

check('a second apply aborts on the PRE bound, and the PRE bound fires for each of its conditions', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.throws(() => db.exec(sql), error => abortName(error) === 'online_orders_0293_pre')
  db.close()
  for (const table of TABLES) {
    const half = new Database(schema)
    half.exec(`CREATE TABLE ${table} (id INTEGER)`)
    assert.throws(() => half.exec(sql), error => abortName(error) === 'online_orders_0293_pre', table)
    half.close()
  }
  const column = new Database(schema)
  column.exec('ALTER TABLE returns ADD COLUMN refund_channel TEXT')
  assert.throws(() => column.exec(sql), error => abortName(error) === 'online_orders_0293_pre', 'refund_channel present')
  column.close()
})

check('the POST assertion fires when the file is mutated to leave a trigger, an index, or a refund_channel NULL out of line', () => {
  const noTrigger = sql.replace(/CREATE TRIGGER online_order_events_append_only_delete[\s\S]*?\nEND;\n/, '')
  const noIndex = sql.replace(/CREATE INDEX idx_online_order_requests_created[^\n]*\n/, '')
  const stamped = sql.replace(/(ALTER TABLE returns ADD COLUMN refund_channel[^\n]*\n)/, "$1UPDATE returns SET refund_channel = 'drawer';\n")
  for (const [label, mutated] of [['trigger', noTrigger], ['index', noIndex], ['refund_channel', stamped]]) {
    assert.notEqual(mutated, sql, label)
    const db = new Database(schema)
    seedReturns(db)
    assert.throws(() => db.exec(mutated), error => abortName(error) === 'online_orders_0293_post', label)
    db.close()
  }
})

check('the documented RECOVERY returns the schema to the pre-0293 shape (refund_channel stays, NULL)', () => {
  const db = new Database(schema)
  seedReturns(db)
  const before = returnsFigures(db)
  db.exec(sql)
  const recovery = sql.split('\n').filter(line => /^--   DROP/.test(line)).map(line => line.replace(/^--   /, '').trim()).join('\n')
  assert.match(recovery, /DROP TABLE IF EXISTS online_orders;/)
  db.exec(recovery)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'online_order%'").get().n, 0)
  assert.deepEqual(returnsFigures(db), before)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM returns WHERE refund_channel IS NOT NULL').get().n, 0)
  db.close()
})

console.log(`\n${passed} checks passed`)
