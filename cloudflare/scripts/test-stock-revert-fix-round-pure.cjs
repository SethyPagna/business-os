// REVERT-FIX fix round (Opus refuter R-REVERT-FIX, 1 Oct 2026). Owner rule: a
// Revert works like cancelling a sale -- everything returns with no loss, the
// reverted effect leaves the reports, a Revert of a Revert restores. Each case
// drives the REAL kernels on the real migration chain and keys on the actual
// defect shape, not on the movement type alone:
//   RF1  the receipt of an UNDONE stock-in session is not revertible (it would
//        be reversed twice), and is again once the session is redone
//   RF7  a stock-in line Edit that commits between the Revert's read and its
//        write aborts the Revert's batch instead of being reversed twice
//   RF3  a receipt written as type 'in' by the Inventory import leaves the
//        purchase reports when reverted, and comes back with the Revert of it
//   RF5  a receipt that was immediately held as tagged is refused (the units
//        are already out of sellable stock)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

const { commitStockSession, replayStockSession } = loadStockSession()
const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
const { applyStockInLineEdit } = loadStockSession('lib/stockInLineEdit.ts')
const { getDb } = loadStockSession('lib/db.ts')
const pb = loadStockSession('lib/productBatches.ts')
const damagedLots = loadStockSession('lib/damagedLotActions.ts')

const actor = { userId: user.id, userName: user.name }
const contacts = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
const STOCK_IN_REPORT_SOURCE = contacts.match(/const STOCK_IN_REPORT_SOURCE = `([\s\S]*?)`/)[1]

const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}

function state(f) {
  return JSON.stringify({
    branch: f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,
    product: f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,
    lots: f.sql.prepare('SELECT b.id, s.quantity, b.received_quantity, b.received_cost_usd, b.is_active FROM product_batches b LEFT JOIN branch_batch_stock s ON s.batch_id=b.id ORDER BY b.id').all(),
    movements: f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
  })
}
const revertOf = (f, movementId) => applyMovementRevert(getDb(f.env), f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(movementId), actor)
const memberMovement = (f, operationId) => f.sql.prepare('SELECT movement_id id FROM stock_session_members WHERE operation_id=?').get(operationId).id

// Two sessions receive onto the same lot (10 and 5 at $2).
async function twoSessions(f) {
  const a = await commitStockSession(f.env, user, receiveRequest('stock-request-sessa1', 10))
  const b = await commitStockSession(f.env, user, receiveRequest('stock-request-sessb1', 5))
  return { a, b, bRow: memberMovement(f, b.operationId) }
}
const history = (f, id) => f.sql.prepare('SELECT undo_payload, redo_payload FROM action_history WHERE id=?').get(id)

async function main() {
  await check('RF1 the receipt of an undone stock-in session is refused; redoing the session makes it revertible again', async () => {
    const f = fixture()
    try {
      const { b, bRow } = await twoSessions(f)
      await replayStockSession(f.env, user, 'undo', b.actionHistoryId, 0, JSON.parse(history(f, b.actionHistoryId).undo_payload))
      const undone = state(f)
      assert.match(undone, /"quantity":10,"received_quantity":10,"received_cost_usd":20/, 'session B undo leaves session A intact')
      const refused = await revertOf(f, bRow)
      assert.equal(refused.ok, false, 'reverting the receipt of an undone session must be refused')
      assert.equal(refused.code, 'revert_session_undone')
      assert.match(refused.error, /undone/i)
      assert.equal(state(f), undone, 'nothing moved')
      await replayStockSession(f.env, user, 'redo', b.actionHistoryId, 1, { ...JSON.parse(history(f, b.actionHistoryId).redo_payload), generation: 1 })
      const redone = await revertOf(f, bRow)
      assert.equal(redone.ok, true, JSON.stringify(redone))
      assert.match(state(f), /"quantity":10,"received_quantity":10,"received_cost_usd":20/, 'only session B left the lot')
    } finally { f.sql.close() }
  })

  await check('RF1 an undo, redo, undo again (generation 3) is refused again', async () => {
    const f = fixture()
    try {
      const { b, bRow } = await twoSessions(f)
      const h = () => history(f, b.actionHistoryId)
      await replayStockSession(f.env, user, 'undo', b.actionHistoryId, 0, JSON.parse(h().undo_payload))
      await replayStockSession(f.env, user, 'redo', b.actionHistoryId, 1, { ...JSON.parse(h().redo_payload), generation: 1 })
      await replayStockSession(f.env, user, 'undo', b.actionHistoryId, 2, JSON.parse(h().undo_payload))
      assert.equal((await revertOf(f, bRow)).code, 'revert_session_undone', 'generation 3 is undone again')
    } finally { f.sql.close() }
  })

  await check('RF7 a stock-in line Edit that commits between the Revert read and its write aborts the Revert', async () => {
    const f = fixture()
    try {
      await commitStockSession(f.env, user, receiveRequest('stock-request-race-a', 10))
      const b = await commitStockSession(f.env, user, receiveRequest('stock-request-race-b', 10))
      const bRow = memberMovement(f, b.operationId)
      const lotId = f.sql.prepare('SELECT batch_id id FROM inventory_movements WHERE id=?').get(bRow).id
      const revision = f.sql.prepare("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key=?),0) r").get(String(lotId)).r
      assert.match(state(f), /"quantity":20,"received_quantity":20,"received_cost_usd":40/)
      const original = f.env.DB.batch.bind(f.env.DB)
      let edit = null
      f.env.DB.batch = async (statements) => {
        if (!edit && statements.some((s) => JSON.stringify(s.params || []).includes(`revert:${bRow}`))) {
          f.env.DB.batch = original
          edit = await applyStockInLineEdit(getDb(f.env), user, bRow, {
            client_request_id: 'edit-between-read-and-write', quantity: 6, expected_quantity: 10, expected_batch_id: lotId, expected_batch_revision: revision,
          })
        }
        return original(statements)
      }
      const result = await revertOf(f, bRow)
      f.env.DB.batch = original
      assert.equal(edit && edit.status, 200, JSON.stringify(edit))
      const afterEdit = '"quantity":16,"received_quantity":16,"received_cost_usd":32'
      assert.equal(result.ok, false, `the Revert must not reverse the edited line again: ${JSON.stringify(result)}`)
      assert.equal(result.code, 'revert_stock_in_line_edited')
      assert.match(state(f), new RegExp(afterEdit), 'only the edit changed the lot (A 10 + B 6)')
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id LIKE 'revert:%'").get().n, 0, 'no Revert row')
    } finally { f.sql.close() }
  })

  await check('RF7 control: a Revert with no interleaved Edit goes through', async () => {
    const f = fixture()
    try {
      await commitStockSession(f.env, user, receiveRequest('stock-request-ctl-a', 10))
      const b = await commitStockSession(f.env, user, receiveRequest('stock-request-ctl-b', 10))
      assert.equal((await revertOf(f, memberMovement(f, b.operationId))).ok, true)
      assert.match(state(f), /"quantity":10,"received_quantity":10,"received_cost_usd":20/)
    } finally { f.sql.close() }
  })

  const invoiceLines = (f) => f.sql.prepare(`SELECT received_day, received_quantity, received_cost_usd FROM (${STOCK_IN_REPORT_SOURCE}) t ORDER BY received_day`).all().map((r) => ({ ...r }))

  await check("RF3 an Inventory-import receipt written as type 'in' leaves the purchase reports and comes back with the Revert of it", async () => {
    const f = fixture()
    try {
      const db = getDb(f.env)
      const plan = pb.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 6, receivedDate: '2026-09-12', notes: 'import', unitCostUsd: 2.5, receiptCostPreimage: { batchExists: false, receivedCostUsd: null } })
      await db.batch([...plan.statements, {
        sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,created_at,batch_id)
          VALUES(1,'Serum',1,'Shop','in',6,2.5,15,'import','2026-09-12T03:00:00.000Z',${plan.batchIdSql})`, params: plan.params,
      }])
      const purchased = [{ received_day: '2026-09-12', received_quantity: 6, received_cost_usd: 15 }]
      assert.deepEqual(invoiceLines(f), purchased)
      const receipt = f.sql.prepare("SELECT id FROM inventory_movements WHERE movement_type='in'").get().id
      const reverted = await revertOf(f, receipt)
      assert.equal(reverted.ok, true, JSON.stringify(reverted))
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 0)
      assert.ok(invoiceLines(f).every((line) => Number(line.received_quantity) === 0 && Number(line.received_cost_usd) === 0),
        `the reverted import receipt stays on the invoice report: ${JSON.stringify(invoiceLines(f))}`)
      const again = await revertOf(f, f.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id)
      assert.equal(again.ok, true, JSON.stringify(again))
      assert.deepEqual(invoiceLines(f), purchased, 'Revert of the Revert puts the purchase back')
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 6)
    } finally { f.sql.close() }
  })

  await check("RF3 controls: an 'in' row with no lot, or on a lot with no received figures, moves stock only", async () => {
    const f = fixture()
    try {
      f.sql.exec(`UPDATE products SET stock_quantity=8 WHERE id=1; UPDATE branch_stock SET quantity=8 WHERE product_id=1 AND branch_id=1;
        INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(9100,1,'legacy','09012026','2026-09-01',1,1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9100,1,4);`)
      const bare = Number(f.sql.prepare("INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,created_at) VALUES(1,1,'in',2,'legacy','2026-09-01 03:00:00')").run().lastInsertRowid)
      const legacyLot = Number(f.sql.prepare("INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,created_at,batch_id) VALUES(1,1,'in',3,'legacy','2026-09-01 03:00:00',9100)").run().lastInsertRowid)
      assert.equal((await revertOf(f, bare)).ok, true)
      assert.equal((await revertOf(f, legacyLot)).ok, true)
      const lot = f.sql.prepare('SELECT received_quantity, received_cost_usd FROM product_batches WHERE id=9100').get()
      assert.deepEqual({ ...lot }, { received_quantity: null, received_cost_usd: null }, 'no invented purchase figures')
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=9100').get().quantity, 1)
    } finally { f.sql.close() }
  })

  await check('RF5 a receipt that was immediately held as tagged is refused; an unrelated damage row beside a plain receipt is not', async () => {
    const receiveAndMaybeHold = async (f, { hold, unrelated }) => {
      const db = getDb(f.env)
      const plan = pb.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 4, receivedDate: '2026-09-05', notes: 'restock', unitCostUsd: 2, receiptCostPreimage: { batchExists: false, receivedCostUsd: null } })
      await db.batch([...plan.statements, {
        sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id,created_at,batch_id)
          VALUES(1,'Serum',1,'Shop','add',4,2,8,'box crushed','55','2026-09-05 03:00:00',${plan.batchIdSql})`, params: plan.params,
      }])
      const add = f.sql.prepare("SELECT * FROM inventory_movements WHERE movement_type='add'").get()
      const cost = { unitCostUsd: 2, unitCostKhr: null, totalCostUsd: 8, totalCostKhr: null }
      if (hold) {
        await db.batch([
          ...pb.planRemoveStockFromBatch({ batchId: add.batch_id, productId: 1, branchId: 1, quantity: 4 }).statements,
          ...damagedLots.planHoldAsTagged({ productId: 1, productName: 'Serum', branchId: 1, branchName: 'Shop', batchId: add.batch_id, quantity: 4, tag: 'damaged',
            source: 'restock', reason: 'box crushed', cost, referenceId: 55, actor: { userId: 7, userName: 'Stock User' } }),
        ])
      }
      if (unrelated) {
        f.sql.exec(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,reference_id,created_at,batch_id)
          VALUES(1,1,'damage_out',4,'damaged: customer return','9001','2026-09-05 04:00:00',${add.batch_id})`)
      }
      return add.id
    }
    for (const hold of [true, false]) {
      const f = fixture()
      try {
        const add = await receiveAndMaybeHold(f, { hold, unrelated: !hold })
        const before = state(f)
        const result = await revertOf(f, add)
        if (hold) {
          assert.equal(result.ok, false, 'held receipt must be refused')
          assert.equal(result.code, 'revert_tagged_row')
          assert.equal(state(f), before)
        } else {
          assert.equal(result.ok, true, JSON.stringify(result))
        }
      } finally { f.sql.close() }
    }
  })

  if (failures.length) { console.error(`\n${failures.length} FAILED: ${failures.join('; ')}`); process.exitCode = 1 } else console.log('\nAll revert fix-round checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
