'use strict'
// Oracle for the supplier-credit reminder query in routes/notifications.ts (buildSupplierCreditSection), on the REAL migration chain.
//   (a) on data with NO merged lot the current query returns exactly what the base query (1ae9f2041, "WHERE pb.is_active = 1") returned,
//       row for row and in the same order, so nothing changed for shops that never merged;
//   (b) a lot a merge deactivated (merge_deactivated_at set) reminds once, in due-date order, beside the active lots; a lot deactivated
//       any other way (no marker) still does not; a marked lot that is active again is counted once, not twice;
//   (c) the query is an INDEX SEARCH (idx_product_batches_credit_open), never a scan of product_batches: the bell's rows-read budget.
//
// Run (from cloudflare/): node scripts/test-credit-reminder-oracle-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migrations = fs.readdirSync(directory).filter((f) => f.endsWith('.sql')).sort()
function freshDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of migrations) db.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
  return db
}

// The query as it stands in the source: the template literal passed to db.prepare in buildSupplierCreditSection.
const source = fs.readFileSync(path.join(__dirname, '../src/routes/notifications.ts'), 'utf8')
const fn = source.slice(source.indexOf('async function buildSupplierCreditSection'))
const currentSql = /db\.prepare\(`([\s\S]*?)`\)\.all</.exec(fn)[1]
// The base query, verbatim from 1ae9f2041 (only the WHERE head differs from the current one).
const baseSql = `
    SELECT pb.id, pb.credit_due_date, pb.supplier_name, pb.lot_code, pb.unit_cost_usd,
      p.name AS product_name,
      CAST(julianday(pb.credit_due_date) - julianday('now') AS INTEGER) AS days_until_due
    FROM product_batches pb
    JOIN products p ON p.id = pb.variant_product_id
    WHERE pb.is_active = 1
      AND pb.payment_status = 'credit'
      AND (pb.received_quantity IS NULL OR pb.received_quantity > 0 OR COALESCE(pb.received_cost_usd, 0) > 0)
      AND pb.credit_due_date IS NOT NULL AND trim(pb.credit_due_date) != ''
      AND julianday(pb.credit_due_date) - julianday('now') <= @days
    ORDER BY pb.credit_due_date ASC
    LIMIT 50
  `
assert.ok(/pb\.merge_deactivated_at IS NOT NULL/.test(currentSql), 'the current query counts merge-deactivated lots')
assert.ok(!/merge_deactivated_at/.test(baseSql))

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

function seed(db, lots) {
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  db.exec("INSERT INTO products(id,name,is_active) VALUES(1,'P1',1),(2,'P2',1)")
  const insert = db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,payment_status,credit_due_date,supplier_name,lot_code,
    received_quantity,received_cost_usd,merge_deactivated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
  for (const l of lots) insert.run(l.id, l.product ?? 1, `k${l.id}`, l.active, l.pay ?? 'credit', l.due === undefined ? null : l.due, l.supplier ?? 'S', `L${l.id}`,
    l.qty === undefined ? 5 : l.qty, l.cost === undefined ? 10 : l.cost, l.marked ? '2026-11-01 00:00:00' : null)
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
}
const day = (n) => `date('now','${n >= 0 ? '+' : ''}${n} day')`
const dueOf = (db, n) => db.prepare(`SELECT ${day(n)} AS d`).get().d
const run = (db, sql, days = 7) => db.prepare(sql.replace(/@days/g, String(days))).all().map((r) => ({ ...r }))
const ids = (rows) => rows.map((r) => r.id)

// A spread of ordinary lots: overdue, due soon, outside the window, paid, nothing received, no date, an empty date, inactive (not merged).
function ordinary(db) {
  return [
    { id: 1, active: 1, due: dueOf(db, -3) }, { id: 2, active: 1, due: dueOf(db, 2) }, { id: 3, active: 1, due: dueOf(db, 30) },
    { id: 4, active: 1, due: dueOf(db, 1), pay: 'paid' }, { id: 5, active: 1, due: dueOf(db, 1), qty: 0, cost: 0 },
    { id: 6, active: 1, due: dueOf(db, 1), qty: null, cost: null }, { id: 7, active: 1, due: null }, { id: 8, active: 1, due: '  ' },
    { id: 9, active: 0, due: dueOf(db, 1) }, { id: 10, active: 1, due: dueOf(db, 2), product: 2 }, { id: 11, active: 1, due: dueOf(db, 2), supplier: null },
    { id: 12, active: 1, due: dueOf(db, -9), qty: 0, cost: 4 },
  ]
}

check('(a) no merged lot: the reminder equals the base query row for row, in the same order, for several windows', () => {
  const db = freshDb()
  seed(db, ordinary(db))
  for (const days of [0, 7, 14, 60]) {
    const now = run(db, currentSql, days)
    assert.deepEqual(now, run(db, baseSql, days), `window ${days}`)
  }
  assert.deepEqual(ids(run(db, currentSql, 7)), [12, 1, 6, 2, 10, 11], 'control: the oracle itself selects the expected lots (inactive 9, paid 4, empty 5, undated 7/8, far 3 are out)')
})

check('(a) many lots: the 50 row limit and the due-date order match the base query', () => {
  const db = freshDb()
  const lots = []
  for (let i = 1; i <= 80; i += 1) lots.push({ id: i, active: 1, due: dueOf(db, (i * 7) % 11 - 5) })
  seed(db, lots)
  const now = run(db, currentSql, 5)
  assert.equal(now.length, 50)
  assert.deepEqual(now, run(db, baseSql, 5))
})

check('(b) a merge-deactivated credit lot reminds once, in order; a lot deactivated another way still does not', () => {
  const db = freshDb()
  const lots = ordinary(db)
  seed(db, lots)
  const base = ids(run(db, baseSql, 7))
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  // 9 was deactivated by something else (no marker): stays out. 13 and 14 were deactivated by a merge: both come in.
  db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,payment_status,credit_due_date,supplier_name,received_quantity,received_cost_usd,merge_deactivated_at) VALUES(13,1,'k13',0,'credit',?,'S',3,9,'2026-11-01 00:00:00'),(14,2,'k14',0,'credit',?,'S',0,6,'2026-11-01 00:00:00')").run(dueOf(db, -1), dueOf(db, 4))
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  const now = ids(run(db, currentSql, 7))
  assert.deepEqual(now, [12, 1, 13, 6, 2, 10, 11, 14], 'overdue first, then by due date, merged lots 13 and 14 in their places')
  assert.equal(now.filter((id) => id === 13).length, 1, 'counted once')
  assert.equal(now.filter((id) => id === 14).length, 1, 'counted once (nothing received but money still owed)')
  assert.ok(!now.includes(9), 'an unmarked deactivated lot stays out')
  assert.deepEqual(now.filter((id) => base.includes(id)), base, 'every base reminder is still there, in its place')
  assert.deepEqual(now.filter((id) => !base.includes(id)).sort((a, b) => a - b), [13, 14])
  const dues = run(db, currentSql, 7).map((r) => r.credit_due_date)
  assert.deepEqual(dues, [...dues].sort(), 'due-date order')
})

check('(b) a marked lot that is active again, and a marked lot already paid, are not counted twice or at all', () => {
  const db = freshDb()
  seed(db, [{ id: 1, active: 1, due: dueOf(db, 1), marked: true }, { id: 2, active: 0, due: dueOf(db, 1), marked: true, pay: 'paid' }, { id: 3, active: 0, due: dueOf(db, 1), marked: true }])
  assert.deepEqual(ids(run(db, currentSql)), [1, 3])
})

check('(c) the reminder is an index search on idx_product_batches_credit_open, never a scan of product_batches', () => {
  const db = freshDb()
  seed(db, ordinary(db))
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + currentSql.replace(/@days/g, '7')).all().map((r) => r.detail)
  assert.ok(plan.some((d) => /SEARCH pb USING INDEX idx_product_batches_credit_open/.test(d)), JSON.stringify(plan))
  assert.ok(!plan.some((d) => /SCAN pb/.test(d)), JSON.stringify(plan))
  // And on a world with no merged lot the new index holds exactly what the base partial index holds (the same rows to read).
  const open = db.prepare("SELECT COUNT(*) AS n FROM product_batches WHERE payment_status = 'credit' AND (is_active = 1 OR merge_deactivated_at IS NOT NULL)").get().n
  const base = db.prepare("SELECT COUNT(*) AS n FROM product_batches WHERE payment_status = 'credit' AND is_active = 1").get().n
  assert.equal(open, base)
})

console.log(`${passed} passed`)
