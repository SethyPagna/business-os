// Owner, 1 Oct 2026: "revert is the same logic as cancelling a sale or changing
// its status: everything returns with no loss, through the official process;
// just that the report and so on removes." A Revert is a new record, dated now
// and linked to its original, and the reverted effect leaves every report:
// a reverted receipt leaves its own month's invoice report, the supplier total,
// the open credit and the paid spend (the lot is un-received); a reverted
// removal leaves its original period's losses. Reverting the Revert brings it
// back exactly. The original row stays in the ledger as history. Real
// applyMovementRevert on the real migration chain, with the stock-in invoice
// report's own SQL read out of routes/contacts.ts.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
const losses = loadStockSession('lib/removalLosses.ts')
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

// The September stock-in invoice report as its readers see it: one line per
// lot with what was bought, from whom, for how much, and whether it is owed.
const invoice = (f) => f.sql.prepare(`SELECT id, supplier_key, received_day, received_quantity, received_cost_usd, payment_status
  FROM (${STOCK_IN_REPORT_SOURCE}) t
  WHERE t.received_day >= '2026-09-01' AND t.received_day <= '2026-09-30' ORDER BY t.received_day, t.id`).all().map((row) => ({ ...row }))
const supplierTotal = (f, key) => invoice(f).filter((line) => line.supplier_key === key)
  .reduce((sum, line) => ({ units: sum.units + line.received_quantity, usd: sum.usd + line.received_cost_usd }), { units: 0, usd: 0 })
const openCredit = (f) => invoice(f).filter((line) => line.payment_status === 'credit').reduce((sum, line) => sum + line.received_cost_usd, 0)

function stock(f) {
  const branch = f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity
  const product = f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity
  const lots = Object.fromEntries(f.sql.prepare('SELECT batch_id, quantity FROM branch_batch_stock WHERE branch_id=1 ORDER BY batch_id').all().map((r) => [r.batch_id, r.quantity]))
  const lotTotal = Object.values(lots).reduce((sum, q) => sum + q, 0)
  return { branch, product, lots, lotTotal }
}

const latest = (f) => f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id DESC LIMIT 1').get()
const movement = (f, id) => f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(id)

async function receiptRevertRemovesPurchase() {
  const f = fixture()
  try {
    const { receipt } = seedPurchases(f)
    const db = getDb(f.env)
    const bought = invoice(f)
    const other = bought.filter((line) => line.id === 9002)
    assert.deepEqual(bought.map((line) => [line.id, line.received_quantity, line.received_cost_usd, line.payment_status]),
      [[9002, 10, 30, 'paid'], [9001, 10, 20, 'credit']], 'precondition: the 15 Sep receipt is on the September invoice report, on credit')
    const originalRow = JSON.stringify(movement(f, receipt))
    // Reverted -> gone from the report; reverted again -> back exactly; and again -> gone.
    const expected = [{ branch: 7, lot: 0, live: false }, { branch: 17, lot: 10, live: true }, { branch: 7, lot: 0, live: false }]
    let target = movement(f, receipt)
    for (const [depth, want] of expected.entries()) {
      const result = await applyMovementRevert(db, target, actor)
      assert.equal(result.ok, true, JSON.stringify(result))
      target = latest(f)
      assert.equal(target.reference_id, `revert:${depth === 0 ? receipt : target.id - 1}`, `depth ${depth + 1}: the Revert names the row it reverts`)
      const now = stock(f)
      assert.deepEqual([now.branch, now.product, now.lots[9001], now.lots[9002], now.lotTotal], [want.branch, want.branch, want.lot, 7, want.branch],
        `depth ${depth + 1}: stock moves on the receipt's own lot; lots and branch_stock agree; the other supplier's lot is never drained`)
      assert.deepEqual(invoice(f), want.live ? bought : other, `depth ${depth + 1}: the 15 Sep purchase is ${want.live ? 'back on' : 'gone from'} its month's invoice report`)
      assert.deepEqual(supplierTotal(f, 'name:probe supplier'), want.live ? { units: 10, usd: 20 } : { units: 0, usd: 0 }, `depth ${depth + 1}: supplier total`)
      assert.equal(openCredit(f), want.live ? 20 : 0, `depth ${depth + 1}: open credit follows`)
      assert.equal(JSON.stringify(movement(f, receipt)), originalRow, `depth ${depth + 1}: the original row stays in the ledger as history`)
    }
    console.log('PASS a reverted receipt leaves its month\'s invoice report, supplier total and credit; its Revert brings it back; the row stays as history')
  } finally { f.sql.close() }
}

async function paidReceiptRevertLowersPaidSpend() {
  const f = fixture()
  try {
    seedPurchases(f)
    f.sql.exec('UPDATE product_batches SET received_quantity=17, received_cost_usd=51 WHERE id=9002; UPDATE branch_batch_stock SET quantity=14 WHERE batch_id=9002; UPDATE branch_stock SET quantity=24 WHERE product_id=1; UPDATE products SET stock_quantity=24 WHERE id=1')
    const paid = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,batch_id,created_at)
      VALUES(1,1,'add',7,3,21,'Paid receipt',9002,'2026-09-01 03:00:00')`).run().lastInsertRowid)
    assert.deepEqual(supplierTotal(f, 'name:other supplier'), { units: 17, usd: 51 })
    const result = await applyMovementRevert(getDb(f.env), movement(f, paid), actor)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(supplierTotal(f, 'name:other supplier'), { units: 10, usd: 30 }, 'the paid spend drops by exactly the reverted $21')
    assert.equal(invoice(f).find((line) => line.id === 9002).payment_status, 'paid', 'the lot\'s other purchase stays paid')
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id LIKE 'revert:%'").get().n, 1, 'one Revert row; no refund record is invented')
    assert.deepEqual(stock(f).lots, { 9001: 10, 9002: 7 })
    console.log('PASS paid receipt revert takes its own units and money out of the paid spend')
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
    const record = JSON.stringify(invoice(f))
    const result = await applyMovementRevert(getDb(f.env), movement(f, legacy), actor)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.usedBatchId, null)
    assert.deepEqual(stock(f), { branch: 10, product: 10, lots: { 9101: 10 }, lotTotal: 10 }, 'the units with no received date go; the dated lot stays whole')
    assert.equal(JSON.stringify(invoice(f)), record, 'Sup X\'s purchase is not un-received for Sup Y\'s legacy receipt')
    assert.equal(latest(f).batch_id, null, 'the Revert names no lot it did not take from')
    console.log('PASS legacy receipt without a lot takes back the undated units only')
  } finally { f.sql.close() }

  f = fixture()
  try {
    const legacy = seed(f, 0)
    const before = JSON.stringify([stock(f), invoice(f), f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get()])
    const result = await applyMovementRevert(getDb(f.env), movement(f, legacy), actor)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'revert_no_received_date', JSON.stringify(result))
    assert.equal(JSON.stringify([stock(f), invoice(f), f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get()]), before, 'refused whole: no lot is guessed')
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

// Owner, 1 Oct 2026: "make it consistent with what I am doing, easy to revert".
// A dated stock count that found MORE than the ledger held recorded the extra
// as received onto its lots (lib/datedStockCountApply.ts). One Revert takes
// the stock back off exactly those lots and un-receives them; its Revert
// receives them again. Two lots (no batch stamp, provenance only) and one.
async function countIncreaseRevertUnreceives() {
  for (const shape of ['two lots', 'one lot']) {
    const f = fixture()
    try {
      const twoLots = shape === 'two lots'
      f.sql.exec(`
        UPDATE products SET stock_quantity=${twoLots ? 9 : 4} WHERE id=1; UPDATE branch_stock SET quantity=${twoLots ? 9 : 4} WHERE product_id=1 AND branch_id=1;
        INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,received_quantity,received_branch_id)
          VALUES(9201,1,'09102026','09102026','2026-09-10',1,1,4,1)${twoLots ? ",(9202,1,'09122026','09122026','2026-09-12',1,2,5,1)" : ''};
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9201,1,4)${twoLots ? ',(9202,1,5)' : ''};`)
      const count = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,batch_id,created_at)
        VALUES(1,1,'add',${twoLots ? 9 : 4},'Dated stock count import',${twoLots ? 'NULL' : 9201},'2026-09-12 00:00:00')`).run().lastInsertRowid)
      f.sql.exec(`INSERT INTO dated_stock_count_batch_actions(movement_id,batch_id,quantity) VALUES(${count},9201,4)${twoLots ? `,(${count},9202,5)` : ''}`)
      const counted = invoice(f)
      assert.equal(counted.length, twoLots ? 2 : 1, 'precondition: the counted units show as received')
      const db = getDb(f.env)
      const r1 = await applyMovementRevert(db, movement(f, count), actor)
      assert.equal(r1.ok, true, JSON.stringify(r1))
      assert.deepEqual(stock(f), { branch: 0, product: 0, lots: twoLots ? { 9201: 0, 9202: 0 } : { 9201: 0 }, lotTotal: 0 }, `${shape}: one Revert takes the count back off its lots`)
      assert.deepEqual(invoice(f), [], `${shape}: nothing counted is left as received`)
      assert.deepEqual(f.sql.prepare('SELECT id, received_quantity, is_active FROM product_batches ORDER BY id').all().map((row) => ({ ...row })),
        (twoLots ? [9201, 9202] : [9201]).map((id) => ({ id, received_quantity: 0, is_active: 0 })), `${shape}: the lots are un-received and leave the pickers`)
      const r2 = await applyMovementRevert(db, latest(f), actor)
      assert.equal(r2.ok, true, JSON.stringify(r2))
      assert.deepEqual(stock(f).lotTotal, twoLots ? 9 : 4)
      assert.deepEqual(stock(f).branch, twoLots ? 9 : 4)
      assert.deepEqual(invoice(f), counted, `${shape}: reverting the Revert receives the count again, exactly`)
    } finally { f.sql.close() }
  }
  console.log('PASS a dated count increase reverts in one action, un-receiving its lots; its Revert receives them again')
}

// The loss view of one calendar day (or of all time), exactly as the Reports
// kernel builds it: the loss WHERE, the loss SELECT and the reducer.
function lossOn(f, day) {
  const rows = f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM}
    WHERE ${losses.removalLossMovementWhere('m')} ${day ? 'AND substr(m.created_at, 1, 10) = ?' : ''}`).all(...(day ? [day] : []))
  return losses.summarizeRemovalLosses(rows)
}

async function removalRevertRemovesTheLoss() {
  const f = fixture()
  try {
    const { receipt, removal } = seedPurchases(f)
    const db = getDb(f.env)
    const loss = { removal_loss_usd: 9, removal_loss_qty: 3, removal_loss_unvalued_rows: 0 }
    const none = { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 }
    assert.deepEqual(lossOn(f, '2026-09-20'), loss)
    // A receipt's Revert takes stock out, but nothing was lost.
    assert.equal((await applyMovementRevert(db, movement(f, receipt), actor)).ok, true)
    const counterDay = latest(f).created_at.slice(0, 10)
    assert.deepEqual(lossOn(f, counterDay), none, 'the Revert of a receipt is not a loss')
    // Reverted -> the 20 Sep loss is removed; reverted again -> back on 20 Sep; again -> removed.
    let target = movement(f, removal)
    for (const [depth, lost] of [false, true, false].entries()) {
      assert.equal((await applyMovementRevert(db, target, actor)).ok, true)
      target = latest(f)
      assert.deepEqual(lossOn(f, '2026-09-20'), lost ? loss : none, `depth ${depth + 1}: the 20 Sep loss is ${lost ? 'back' : 'removed'}`)
      assert.deepEqual(lossOn(f, target.created_at.slice(0, 10)), none, `depth ${depth + 1}: the Revert day books no loss and no recovery`)
      assert.deepEqual(lossOn(f), lost ? loss : none, `depth ${depth + 1}: all time`)
    }
    console.log('PASS a removal\'s Revert removes the loss from its own period; reverting the Revert restores it there')
  } finally { f.sql.close() }
}

async function main() {
  await removalRevertRemovesTheLoss()
  await receiptRevertRemovesPurchase()
  await paidReceiptRevertLowersPaidSpend()
  await legacyReceiptWithoutLot()
  await countIncreaseRevertUnreceives()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
