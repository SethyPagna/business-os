// Owner, 30 Sep 2026: a Revert is a NEW compensating record dated now. It
// moves the stock back and changes no past report: the purchase (lot received
// quantity/cost/date, invoice line, supplier total, credit, paid spend) stays
// exactly as recorded. Real applyMovementRevert on the real migration chain,
// with the stock-in invoice report's own SQL read out of routes/contacts.ts.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
const { getDb } = loadStockSession('lib/db.ts')

const actor = { userId: user.id, userName: user.name }
const contacts = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
const STOCK_IN_REPORT_SOURCE = contacts.match(/const STOCK_IN_REPORT_SOURCE = `([\s\S]*?)`/)[1]

function seedPurchases(f) {
  f.sql.exec(`
    UPDATE products SET stock_quantity=17 WHERE id=1; UPDATE branch_stock SET quantity=17 WHERE product_id=1 AND branch_id=1;
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,payment_status,received_quantity,received_branch_id,received_cost_usd,supplier_name)
      VALUES(9001,1,'20260915-p','09152026','2026-09-15',1,1,2,'credit',10,1,20,'Probe Supplier'),
            (9002,1,'20260901-o','09012026','2026-09-01',1,2,3,'paid',10,1,30,'Other Supplier');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9001,1,10),(9002,1,7);`)
  const receipt = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,batch_id,created_at)
    VALUES(1,1,'add',10,2,20,'Probe receipt',9001,'2026-09-15 03:00:00')`).run().lastInsertRowid)
  const removal = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,batch_id,created_at)
    VALUES(1,1,'remove',3,3,9,'Probe damage',9002,'2026-09-20 03:00:00')`).run().lastInsertRowid)
  return { receipt, removal }
}

// Every purchase reader (invoice report, supplier purchases, open credit,
// credit reminder) reads these lot columns, so the whole table must hold.
const purchaseRecord = (f) => JSON.stringify({
  invoice: f.sql.prepare(`SELECT * FROM (${STOCK_IN_REPORT_SOURCE}) t
    WHERE t.received_day >= '2026-09-01' AND t.received_day <= '2026-09-30' ORDER BY t.received_day, t.id`).all(),
  lots: f.sql.prepare(`SELECT id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd, payment_status,
      credit_due_date, received_quantity, received_branch_id, received_cost_usd, supplier_id, supplier_name FROM product_batches ORDER BY id`).all(),
})

function stock(f) {
  const branch = f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity
  const product = f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity
  const lots = Object.fromEntries(f.sql.prepare('SELECT batch_id, quantity FROM branch_batch_stock WHERE branch_id=1 ORDER BY batch_id').all().map((r) => [r.batch_id, r.quantity]))
  const lotTotal = Object.values(lots).reduce((sum, q) => sum + q, 0)
  return { branch, product, lots, lotTotal }
}

const latest = (f) => f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id DESC LIMIT 1').get()
const movement = (f, id) => f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(id)

async function receiptRevertKeepsPurchase() {
  const f = fixture()
  try {
    const { receipt } = seedPurchases(f)
    const record = purchaseRecord(f)
    const db = getDb(f.env)
    const expected = [{ branch: 17, lot: 10 }, { branch: 7, lot: 0 }, { branch: 17, lot: 10 }, { branch: 7, lot: 0 }]
    for (let generation = 0; generation < expected.length; generation++) {
      const now = stock(f)
      assert.equal(now.branch, expected[generation].branch, `generation ${generation}: branch stock`)
      assert.equal(now.product, now.branch, `generation ${generation}: product total follows its branch`)
      assert.equal(now.lots[9001], expected[generation].lot, `generation ${generation}: the receipt's own lot moves, no other`)
      assert.equal(now.lots[9002], 7, `generation ${generation}: another supplier's lot is never drained`)
      assert.equal(now.lotTotal, now.branch, `generation ${generation}: the lot ledger and branch_stock agree`)
      assert.equal(purchaseRecord(f), record, `generation ${generation}: the 15 Sep purchase, supplier total and open credit are byte-identical`)
      if (generation === expected.length - 1) break
      const target = generation === 0 ? movement(f, receipt) : latest(f)
      const result = await applyMovementRevert(db, target, actor)
      assert.equal(result.ok, true, JSON.stringify(result))
    }
    const counters = f.sql.prepare("SELECT movement_type, batch_id, reference_id FROM inventory_movements WHERE reference_id LIKE 'revert:%' ORDER BY id").all()
    assert.deepEqual(counters.map((row) => [row.movement_type, row.batch_id]), [['remove', 9001], ['add', 9001], ['remove', 9001]])
    console.log('PASS receipt revert chain moves stock on its own lot only; the past purchase, supplier total and credit never change')
  } finally { f.sql.close() }
}

async function paidReceiptRevertKeepsPaidSpend() {
  const f = fixture()
  try {
    seedPurchases(f)
    const paid = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,batch_id,created_at)
      VALUES(1,1,'add',7,3,21,'Paid receipt',9002,'2026-09-01 03:00:00')`).run().lastInsertRowid)
    const record = purchaseRecord(f)
    const result = await applyMovementRevert(getDb(f.env), movement(f, paid), actor)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(purchaseRecord(f), record, 'a paid receipt keeps its paid spend; no refund or payable is invented')
    assert.deepEqual(stock(f).lots, { 9001: 10, 9002: 0 })
    assert.equal(stock(f).branch, 10)
    console.log('PASS paid receipt revert leaves the paid spend as recorded')
  } finally { f.sql.close() }
}

async function legacyReceiptWithoutLot() {
  // Lot A (Sup X, 1 Sep, 10 on hand) plus 5 units held under no received date.
  const seed = (f, untracked) => {
    f.sql.exec(`
      UPDATE products SET stock_quantity=${10 + untracked} WHERE id=1; UPDATE branch_stock SET quantity=${10 + untracked} WHERE product_id=1 AND branch_id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,payment_status,received_quantity,received_branch_id,received_cost_usd,supplier_name)
        VALUES(9101,1,'20260901-a','09012026','2026-09-01',1,1,2,'paid',10,1,20,'Sup X');
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9101,1,10);`)
    return Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,created_at)
      VALUES(1,1,'add',5,4,20,'Legacy receipt from Sup Y','2025-01-10 03:00:00')`).run().lastInsertRowid)
  }
  let f = fixture()
  try {
    const legacy = seed(f, 5)
    const record = purchaseRecord(f)
    const result = await applyMovementRevert(getDb(f.env), movement(f, legacy), actor)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.usedBatchId, null)
    assert.deepEqual(stock(f), { branch: 10, product: 10, lots: { 9101: 10 }, lotTotal: 10 }, 'the units with no received date go; the dated lot stays whole')
    assert.equal(purchaseRecord(f), record)
    assert.equal(latest(f).batch_id, null, 'the Revert names no lot it did not take from')
    console.log('PASS legacy receipt without a lot takes back the undated units only')
  } finally { f.sql.close() }

  f = fixture()
  try {
    const legacy = seed(f, 0)
    const before = JSON.stringify([stock(f), purchaseRecord(f), f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get()])
    const result = await applyMovementRevert(getDb(f.env), movement(f, legacy), actor)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'revert_no_received_date', JSON.stringify(result))
    assert.equal(JSON.stringify([stock(f), purchaseRecord(f), f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get()]), before, 'refused whole: no lot is guessed')
    console.log('PASS legacy receipt without a lot is refused when only dated lots could cover it')
  } finally { f.sql.close() }

  f = fixture()
  try {
    const legacy = seed(f, 5)
    // A sale takes 3 of the undated units after the revert read the stock.
    f.beforeCommit((sql) => sql.exec('UPDATE branch_stock SET quantity=quantity-3 WHERE product_id=1 AND branch_id=1; UPDATE products SET stock_quantity=stock_quantity-3 WHERE id=1'))
    const result = await applyMovementRevert(getDb(f.env), movement(f, legacy), actor)
    assert.equal(result.code, 'stock_changed', JSON.stringify(result))
    assert.deepEqual(stock(f), { branch: 12, product: 12, lots: { 9101: 10 }, lotTotal: 10 }, 'branch_stock never drops below its dated lots')
    console.log('PASS a sale of the undated units mid-revert aborts it instead of forking the ledgers')
  } finally { f.sql.close() }
}

async function main() {
  await receiptRevertKeepsPurchase()
  await paidReceiptRevertKeepsPaidSpend()
  await legacyReceiptWithoutLot()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
