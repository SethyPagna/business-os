'use strict'
// Pins migration 0267 (fees datetime(created_at) expression index, supplier-credit partial index) on the
// REAL migration chain: schema only, the real expense-window and supplier-credit statements switch from a
// full scan to an index search without changing a single result, and controls that must NOT use the indexes
// still do not. Also pins the statement text in src/ the indexes were designed against, so a changed query
// fails here instead of silently losing its index.
//
// Run: node scripts/test-migration-0267-fees-credit-indexes-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const directory = path.join(__dirname, '../migrations')
const migration = '0267_fees_created_dt_and_credit_due_indexes.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const plan = (db, statement, params = {}) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(params).map(row => row.detail).join(' | ')
const source = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')

// The statements as the Worker issues them (clause text pinned against src/ in the drift check below).
const FEE_WINDOW = `SELECT COALESCE(NULLIF(TRIM(label), ''), fee_type, 'Expense') AS label,
  COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr
  FROM fees WHERE datetime(fees.created_at) >= @createdFrom AND datetime(fees.created_at) < @createdTo
  AND (fees.branch_id = @branchId OR fees.branch_id IS NULL) AND fees.created_by = @createdBy
  GROUP BY 1 ORDER BY usd DESC, khr DESC, label LIMIT 9`
const FEE_WINDOW_SHOP_WIDE = `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM fees
  WHERE datetime(fees.created_at) >= @createdFrom AND datetime(fees.created_at) < @createdTo`
const WINDOW = { createdFrom: '2026-10-21 00:00:00', createdTo: '2026-10-22 00:00:00' }
const FEE_PARAMS = { ...WINDOW, branchId: 1, createdBy: 7 }
const SUPPLIER_CREDIT = `SELECT pb.id, pb.credit_due_date,
  CAST(julianday(pb.credit_due_date) - julianday('now') AS INTEGER) AS days_until_due
  FROM product_batches pb JOIN products p ON p.id = pb.variant_product_id
  WHERE pb.is_active = 1
    AND pb.payment_status = 'credit'
    AND (pb.received_quantity IS NULL OR pb.received_quantity > 0 OR COALESCE(pb.received_cost_usd, 0) > 0)
    AND pb.credit_due_date IS NOT NULL AND trim(pb.credit_due_date) != ''
    AND julianday(pb.credit_due_date) - julianday('now') <= @days
  ORDER BY pb.credit_due_date ASC
  LIMIT 50`

function seed(db) {
  db.prepare("INSERT INTO branches(id,name) VALUES(1,'Shop')").run()
  const fee = db.prepare('INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,branch_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
  for (let index = 0; index < 400; index++) {
    const day = String(1 + (index % 28)).padStart(2, '0')
    fee.run(index % 3 ? 'other' : 'delivery', index % 5 ? 'Tape' : null, 1 + (index % 7) * 0.5, 0, `2026-09-${day}`, index % 4 ? 1 : null, 7, `2026-09-${day} 05:00:00`)
  }
  fee.run('other', 'Gas', 3.5, 0, '2026-10-21', 1, 7, '2026-10-21 03:30:00')
  fee.run('other', 'Gas', 1.5, 0, '2026-10-21', null, 7, '2026-10-21T04:00:00Z')
  fee.run('other', 'Late', 9, 0, '2026-10-21', 1, 7, '2026-10-22 00:00:00')
  fee.run('other', 'Other cashier', 2, 0, '2026-10-21', 1, 8, '2026-10-21 05:00:00')
  seedStockFixture(db, () => {
    db.prepare("INSERT INTO products(id,name,barcode,unit,is_active) VALUES(1,'Serum','1001','pcs',1)").run()
    const lot = db.prepare(`INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,is_active,supplier_name,payment_status,credit_due_date,unit_cost_usd,received_cost_usd,received_quantity)
      VALUES(1,?,?,'2026-09-01',?,?,?,?,5,?,?)`)
    for (let index = 0; index < 300; index++) {
      const credit = index % 10 === 0
      lot.run(`k${index}`, `L${index}`, 1, 'Bong', credit ? 'credit' : 'paid', credit ? `2026-10-${String(1 + (index / 10) % 28).padStart(2, '0')}` : null, 5, 1)
    }
    lot.run('inactive', 'LI', 0, 'Bong', 'credit', '2026-10-02', 5, 1)
    lot.run('reverted', 'LR', 1, 'Bong', 'credit', '2026-10-03', 0, 0)
    lot.run('far', 'LF', 1, 'Bong', 'credit', '2031-01-01', 5, 1)
  })
}
const results = db => ({
  window: db.prepare(FEE_WINDOW).all(FEE_PARAMS),
  shopWide: db.prepare(FEE_WINDOW_SHOP_WIDE).all(WINDOW),
  credit: db.prepare(SUPPLIER_CREDIT).all({ days: 7 }).map(({ id, credit_due_date }) => ({ id, credit_due_date })),
})
const counts = db => ({ fees: db.prepare('SELECT COUNT(*) n FROM fees').get().n, lots: db.prepare('SELECT COUNT(*) n FROM product_batches').get().n })
const indexCount = db => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('idx_fees_created_dt','idx_fees_branch_created_dt','idx_product_batches_credit_due')").get().n

check('the file is LF-only and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})

check('drift guard: the statements the indexes serve still have the exact predicate text in src/', () => {
  const analytics = source('lib/salesAnalytics.ts')
  assert.ok(analytics.includes('`datetime(${alias}.created_at) >= @createdFrom`') && analytics.includes('`datetime(${alias}.created_at) < @createdTo`'))
  assert.ok(analytics.includes("'datetime(f.created_at) >= @feeCreatedFrom'") && analytics.includes("'datetime(fees.created_at) < @feeCreatedTo'"))
  assert.ok(source('routes/fees.ts').includes("'datetime(f.created_at) >= @createdFrom AND datetime(f.created_at) < @createdTo'"))
  const bell = source('routes/notifications.ts')
  for (const text of ['pb.is_active = 1', "pb.payment_status = 'credit'", "pb.credit_due_date IS NOT NULL AND trim(pb.credit_due_date) != ''", 'ORDER BY pb.credit_due_date ASC', 'LIMIT 50']) assert.ok(bell.includes(text), text)
})

check('PRE/POST: both indexes absent before and present after; no table row changes; every result identical', () => {
  const db = new Database(schema)
  seed(db)
  assert.equal(indexCount(db), 0)
  const before = { counts: counts(db), results: results(db) }
  assert.ok(before.results.window.length > 0 && before.results.credit.length > 0, 'the fixture reaches both statements')
  db.exec(sql)
  assert.equal(indexCount(db), 3)
  assert.deepEqual(counts(db), before.counts)
  assert.deepEqual(results(db), before.results)
  db.close()
})

check('the fee windows search the new indexes after; before, the branch drawer reads its whole branch and the others scan the table', () => {
  const db = new Database(schema)
  seed(db)
  const FEE_WINDOW_CREATOR = FEE_WINDOW_SHOP_WIDE + ' AND fees.created_by = @createdBy'
  const before = { branch: plan(db, FEE_WINDOW, FEE_PARAMS), shop: plan(db, FEE_WINDOW_SHOP_WIDE, WINDOW), creator: plan(db, FEE_WINDOW_CREATOR, FEE_PARAMS) }
  assert.match(before.branch, /idx_fees_branch_id/, 'control: before 0267 each OR term walks the whole branch through idx_fees_branch_id')
  assert.match(before.shop, /SCAN fees/, 'control: no index before 0267')
  assert.match(before.creator, /SCAN fees/, 'control: no index before 0267')
  for (const text of Object.values(before)) assert.doesNotMatch(text, /idx_fees_created_dt|idx_fees_branch_created_dt/)
  db.exec(sql)
  const branch = plan(db, FEE_WINDOW, FEE_PARAMS)
  assert.ok(branch.includes('SEARCH fees USING INDEX idx_fees_branch_created_dt (branch_id=? AND <expr>>? AND <expr><?)'), branch)
  assert.equal(branch.match(/idx_fees_branch_created_dt/g).length, 2, 'both OR terms (branch and no branch) use the date range')
  assert.match(plan(db, FEE_WINDOW_SHOP_WIDE, WINDOW), /SEARCH fees USING INDEX idx_fees_created_dt/)
  assert.match(plan(db, FEE_WINDOW_CREATOR, FEE_PARAMS), /SEARCH fees USING INDEX idx_fees_created_dt/)
  db.close()
})

check('control: a predicate on the raw column (not the expression) does not use the new index', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.doesNotMatch(plan(db, 'SELECT id FROM fees WHERE created_at >= @createdFrom', WINDOW), /idx_fees_created_dt/)
  db.close()
})

check('the supplier-credit statement searches the partial index with the ORDER BY satisfied after, and scans lots before', () => {
  const db = new Database(schema)
  seed(db)
  assert.match(plan(db, SUPPLIER_CREDIT, { days: 7 }), /SCAN pb/, 'control: full lot scan before 0267')
  db.exec(sql)
  const after = plan(db, SUPPLIER_CREDIT, { days: 7 })
  assert.match(after, /SEARCH pb USING INDEX idx_product_batches_credit_due/)
  assert.doesNotMatch(after, /TEMP B-TREE/, 'the due-date order comes from the index, no sort')
  db.close()
})

check('control: lots that are not active credit lots cannot use the partial index', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.doesNotMatch(plan(db, "SELECT id FROM product_batches WHERE payment_status = 'paid' AND credit_due_date > '2026-01-01'"), /idx_product_batches_credit_due/)
  assert.doesNotMatch(plan(db, "SELECT id FROM product_batches WHERE is_active = 0 AND payment_status = 'credit' AND credit_due_date > '2026-01-01'"), /idx_product_batches_credit_due/)
  db.close()
})

check('idempotent: applying the file twice leaves one of each of the three indexes and the same results', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  const once = results(db)
  db.exec(sql)
  assert.equal(indexCount(db), 3)
  assert.deepEqual(results(db), once)
  db.close()
})

check('the documented recovery removes exactly the three indexes and the statements still return the same rows', () => {
  const db = new Database(schema)
  seed(db)
  const before = results(db)
  db.exec(sql)
  db.exec('DROP INDEX IF EXISTS idx_fees_created_dt; DROP INDEX IF EXISTS idx_fees_branch_created_dt; DROP INDEX IF EXISTS idx_product_batches_credit_due;')
  assert.equal(indexCount(db), 0)
  assert.deepEqual(results(db), before)
  db.close()
})

check('the PRE assertion aborts the file when the schema lacks the column (control: the guard fires)', () => {
  const db = new Database(schema)
  db.exec('DROP INDEX IF EXISTS idx_fees_fee_date; ALTER TABLE fees DROP COLUMN created_at;')
  assert.throws(() => db.exec(sql), /(bad|malformed) JSON path/)
  assert.equal(indexCount(db), 0)
  db.close()
})

console.log(`${passed} passed`)
