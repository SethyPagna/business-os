// Real Hono POST /api/branches/transfer-bulk against production migrations:
// the Worker half of the 26 Sep 2026 TransferModal fix (a ticked row may now
// be submitted with no received date, like the single transfer).
//
// Fixture: product 1 at the source holds 10 in branch_stock but only 6 across
// its lots -- lot 50 dated 2026-08-01 (2), lot 1 dated 2026-09-01 (3), lot 51
// undated (1) -- so 4 units are branch stock the lot ledger never tracked.
//
// Transition table (source S=branch 1, destination D=branch 2):
//   forward  lot-less 4   S 10->6, D 0->4; lots 50:2->0, 1:3->1, 51:1 untouched
//   forward  lot-less 8   S 10->2, D 0->8; every lot drained; untracked 2
//   replay   same key     no second movement (applied once)
//   undo                  S back to 10, D to 0, every lot restored
//   over     lot-less 11  400, zero effects
//
// Run: node scripts/test-transfer-bulk-lotless-fifo-pure.cjs
const assert = require('node:assert/strict')
const h = require('./test-transfer-operation-receipt-pure.cjs')
h.apps.history = h.load('routes/actionHistory.ts').default
h.apps.history.onError((error, c) => c.json({ error: error.message }, 500))

const sql = () => h.getDb()
const lotQty = (lot, branch) => sql().prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?').get(lot, branch)?.quantity || 0
const branchQty = (branch) => sql().prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=?').get(branch)?.quantity || 0
function table(name) { return sql().prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() }
function snapshot() {
  return Object.fromEntries(['branch_stock', 'branch_batch_stock', 'product_batches', 'stock_transfers', 'inventory_movements', 'transfer_operation_receipts', 'action_history'].map((name) => [name, table(name)]))
}
function fixture() {
  h.fresh(1, 1)
  sql().exec(`
    UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=1 AND branch_id=1;
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES
      (50,1,'older','older','2026-08-01',1),
      (51,1,'undated','undated',NULL,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES (50,1,2),(51,1,1);
  `)
}
const body = (quantity, key) => ({ ...h.intent(1, 1, key), items: [{ productId: 1, quantity }] })

let checks = 0
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`) }

async function main() {
  await check('a lot-less bulk item is allocated FIFO (oldest dated lot first), applied once, and undo reverses it', async () => {
    fixture()
    const result = await h.request('branches', '/transfer-bulk', body(4, 'lotless_fifo_001'))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(branchQty(1), 6); assert.equal(branchQty(2), 4)
    assert.deepEqual([lotQty(50, 1), lotQty(1, 1), lotQty(51, 1)], [0, 1, 1], 'oldest dated lot drained first, then the next; undated untouched')
    const member = sql().prepare('SELECT quantity,untracked_quantity,allocations_json FROM transfer_operation_members').get()
    assert.equal(member.quantity, 4)
    assert.equal(member.untracked_quantity, 0)
    const allocations = JSON.parse(member.allocations_json).map((a) => [a.source_batch_id, a.quantity]).sort((a, b) => a[0] - b[0])
    assert.deepEqual(allocations, [[1, 2], [50, 2]])
    const destLots = JSON.parse(member.allocations_json).reduce((sum, a) => sum + lotQty(a.destination_batch_id, 2), 0)
    assert.equal(destLots, 4, 'the destination receives the same lots it drew')

    const afterForward = snapshot()
    const replay = await h.request('branches', '/transfer-bulk', body(4, 'lotless_fifo_001'))
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.replayed, true)
    assert.deepEqual(snapshot(), afterForward, 'the same request applied twice moves stock once')

    const undo = await h.request('history', `/${result.body.action_history_id}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(branchQty(1), 10); assert.equal(branchQty(2), 0)
    assert.deepEqual([lotQty(50, 1), lotQty(1, 1), lotQty(51, 1)], [2, 3, 1], 'undo restores every lot it drew')
    const afterUndo = snapshot()
    const again = await h.request('history', `/${result.body.action_history_id}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.deepEqual(snapshot(), afterUndo, 'a repeated undo of the same generation restores nothing twice')
  })

  await check('a lot-less item larger than its lots drains every lot (undated last) and moves the rest untracked', async () => {
    fixture()
    const result = await h.request('branches', '/transfer-bulk', body(8, 'lotless_untracked_001'))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(branchQty(1), 2); assert.equal(branchQty(2), 8)
    assert.deepEqual([lotQty(50, 1), lotQty(1, 1), lotQty(51, 1)], [0, 0, 0])
    assert.equal(sql().prepare('SELECT untracked_quantity FROM transfer_operation_members').get().untracked_quantity, 2)
  })

  await check('a lot-less item over the source branch quantity is refused with zero effects', async () => {
    fixture()
    const before = snapshot()
    const result = await h.request('branches', '/transfer-bulk', body(11, 'lotless_over_001'))
    assert.equal(result.status, 400, JSON.stringify(result.body))
    assert.match(result.body.error, /Insufficient stock for: Product 1 \(need 11, have 10\)/)
    assert.deepEqual(snapshot(), before)
  })

  await check('a lot-less item with no lot at all moves on branch_stock (the "No received dates with stock" product)', async () => {
    fixture()
    sql().exec('DELETE FROM branch_batch_stock')
    const result = await h.request('branches', '/transfer-bulk', body(10, 'lotless_nolot_001'))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(branchQty(1), 0); assert.equal(branchQty(2), 10)
    assert.equal(sql().prepare('SELECT untracked_quantity FROM transfer_operation_members').get().untracked_quantity, 10)
  })

  await check('a chosen lot is still bounded by that lot', async () => {
    fixture()
    const before = snapshot()
    const result = await h.request('branches', '/transfer-bulk', { ...h.intent(1, 1, 'lot_over_001'), items: [{ productId: 1, quantity: 4, batchId: 1 }] })
    assert.equal(result.status, 400, JSON.stringify(result.body))
    assert.deepEqual(snapshot(), before)
  })

  console.log(`${checks} lot-less bulk transfer checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
