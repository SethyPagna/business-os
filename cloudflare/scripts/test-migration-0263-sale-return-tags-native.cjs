'use strict'
// Pins migration 0263 (sale return and delivery tags, lane 6.0.890) on the REAL migration chain
// (every file before it; 0262 is reserved by another lane and may be absent): schema only, every
// sales row and figure identical before and after, the tag columns refuse values outside their
// vocabulary, and the 0251 loyalty trigger does not treat a tag change as a first payment.
//
// Run: node scripts/test-migration-0263-sale-return-tags-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0263_sale_return_tags.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }

// Every shape a sales row has today, legacy return and delivery words included.
function seed(db) {
  db.prepare("INSERT INTO branches(id,name) VALUES(1,'Shop')").run()
  const rows = [
    ['completed', null, 10], ['awaiting_payment', null, 12.5], ['awaiting_delivery', null, 7],
    ['partial_return', 'awaiting_payment', 20], ['returned', 'completed', 4.25], ['returned', null, 3], ['cancelled', null, 9],
  ]
  for (const [index, [status, before, total]] of rows.entries()) {
    db.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,status_before_return,total_usd,loyalty_accrual)
      VALUES(?,?,1,?,?,?,1)`).run(`R-${index}`, `seed-${index}`, status, before, total)
  }
}
const figures = db => db.prepare(`SELECT COALESCE(sale_status,'') AS status, COUNT(*) AS n, ROUND(SUM(total_usd),4) AS usd FROM sales GROUP BY 1 ORDER BY 1`).all()
const salesRows = db => db.prepare('SELECT * FROM sales ORDER BY id').all()
  .map(({ return_state, return_review_state, return_reviewed_at, return_reviewed_by_id, return_reviewed_by_name, delivery_pending, ...row }) => row)

check('the file is LF-only and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})

check('PRE/POST: counts and totals by sale_status, and every existing column of every row, are identical', () => {
  const db = new Database(schema)
  seed(db)
  const before = { figures: figures(db), rows: salesRows(db) }
  db.exec(sql)
  assert.deepEqual(figures(db), before.figures)
  assert.deepEqual(salesRows(db), before.rows)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE return_state IS NOT NULL OR return_review_state IS NOT NULL OR delivery_pending <> 0').get().n, 0)
  db.close()
})

check('the columns, partial indexes and the empty ledger exist with the agreed names', () => {
  const db = new Database(schema)
  db.exec(sql)
  const columns = db.prepare("SELECT name FROM pragma_table_info('sales')").all().map(row => row.name)
  for (const name of ['return_state', 'return_review_state', 'return_reviewed_at', 'return_reviewed_by_id', 'return_reviewed_by_name', 'delivery_pending']) assert.ok(columns.includes(name), name)
  const ledger = db.prepare("SELECT name FROM pragma_table_info('sale_status_normalization_ledger')").all().map(row => row.name)
  assert.deepEqual(ledger, ['sale_id', 'sale_status_before', 'status_before_return_before', 'status_before_cancel_before', 'sale_status_after',
    'status_before_cancel_after', 'return_state_after', 'loyalty_accrual_before', 'migrated_at'])
  const plans = name => db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${name} ORDER BY created_at DESC, id DESC LIMIT 20`).all().map(row => row.detail).join(' | ')
  assert.match(plans("return_state = 'full'"), /idx_sales_return_state_created/)
  assert.match(plans('delivery_pending = 1'), /idx_sales_delivery_pending_created/)
  db.close()
})

check('the tags refuse values outside their vocabulary; a row written without them reads untagged', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  assert.throws(() => db.prepare("UPDATE sales SET return_state='returned' WHERE id=1").run(), /CHECK/)
  assert.throws(() => db.prepare("UPDATE sales SET return_review_state='done' WHERE id=1").run(), /CHECK/)
  assert.throws(() => db.prepare('UPDATE sales SET delivery_pending=2 WHERE id=1').run(), /CHECK/)
  assert.throws(() => db.prepare('UPDATE sales SET delivery_pending=NULL WHERE id=1').run(), /NOT NULL/)
  // The Worker before this lane: its sale insert and its return status write do not name the columns.
  db.prepare("INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,total_usd) VALUES('R-old','old',1,'awaiting_payment',5)").run()
  db.prepare("UPDATE sales SET status_before_return='awaiting_payment',sale_status='partial_return' WHERE receipt_number='R-old'").run()
  assert.deepEqual(db.prepare("SELECT sale_status,return_state,delivery_pending FROM sales WHERE receipt_number='R-old'").get(),
    { sale_status: 'partial_return', return_state: null, delivery_pending: 0 })
  db.close()
})

check('loyalty 0251: a tag change on a Not Paid sale is not a first payment; a real payment still is (control)', () => {
  const db = new Database(schema)
  db.exec(sql)
  db.prepare("INSERT INTO branches(id,name) VALUES(1,'Shop')").run()
  db.prepare("INSERT INTO settings(key,value) VALUES('loyalty_points_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  db.prepare("INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,total_usd,loyalty_accrual) VALUES('R-L','loyal-1',1,'awaiting_payment',10,1)").run()
  const id = db.prepare("SELECT id FROM sales WHERE receipt_number='R-L'").get().id
  const earning = () => db.prepare("SELECT value FROM system_flags WHERE key LIKE ?").all(`loyalty_sale_earning:${id}:%`).map(row => row.value)
  assert.deepEqual(earning(), [], 'a Not Paid sale has not earned')
  db.prepare("UPDATE sales SET return_state='full', return_review_state='pending', delivery_pending=1 WHERE id=?").run(id)
  db.prepare("UPDATE sales SET return_state='partial' WHERE id=?").run(id)
  assert.deepEqual(earning(), [], 'tags never move sale_status, so the trigger does not fire')
  assert.equal(db.prepare('SELECT loyalty_accrual FROM sales WHERE id=?').get(id).loyalty_accrual, 1)
  // The old writer replaced the payment state with a return word: that WAS read as a first payment.
  db.prepare("INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,total_usd,loyalty_accrual) VALUES('R-M','loyal-2',1,'awaiting_payment',10,1)").run()
  const legacy = db.prepare("SELECT id FROM sales WHERE receipt_number='R-M'").get().id
  db.prepare("UPDATE sales SET status_before_return='awaiting_payment', sale_status='partial_return' WHERE id=?").run(legacy)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM system_flags WHERE key LIKE ?').get(`loyalty_sale_earning:${legacy}:%`).n, 1, 'control: the retired relabel fires the trigger')
  db.prepare("UPDATE sales SET sale_status='completed' WHERE id=?").run(id)
  assert.deepEqual(earning(), ['earned'], 'control: settling it is the first payment')
  db.close()
})

check('applying it a second time fails before changing anything (D1 records it once)', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  const before = figures(db)
  assert.throws(() => db.exec(sql), /duplicate column/)
  assert.deepEqual(figures(db), before)
  db.close()
})

console.log(`GREEN migration 0263 sale return tags: ${passed} checks`)
