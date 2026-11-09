'use strict'
// INV S6 verify gap 2 and 9: EVERY direct Set is held while a count of that product at that branch waits -- the older branch-total Set with no setScope (which the writer converts to an
// add or a remove; lot-less Set-session lines and fast stock-in lines arrive that way) as much as the scoped one -- and a raising Set made while no hold applied is SEEN by the approval's
// "adjusted since the count" check (it lands as an `add` movement whose reason ends "(Set to N)"), so the approval refuses that line instead of adding its surplus on top.
// Real routes, real writers, every migration.
// Run: node scripts/test-inventory-check-unscoped-set-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const w = createLotSetWorld({ admin: true })
const planTier = w.load('lib/planTier.ts')
const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on' }
const unscoped = (body = {}) => ({ type: 'set', productId: 1, branchId: 1, quantity: 8, reason: 'Physical count', client_request_id: 'inventory_set_u1234567', ...body })
const adjust = (f, body) => w.call(f, 'POST', '/api/inventory/adjust', unscoped(body))
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }
const approve = (f) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', '/api/inventory-checks/sessions/dated-session-1/approval', { decision: 'approve', requestId: 'approve-request-01' }) }
const stock = f => ({ A: f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10 AND branch_id=1').get().quantity, B: f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=11 AND branch_id=1').get().quantity,
  branch: f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity })
const otherProduct = f => w.seed(f, `INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON',2,0,5,1);
  INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,5);
  INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(20,2,'T','T','2026-09-02',1,3,1);
  INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,5);`)

async function main() {
  await check('a waiting count holds the unscoped Set (lowering and raising, any request id, no branch given): 409, nothing written', async () => {
    for (const body of [{ quantity: 8 }, { quantity: 12, supplierName: 'Acme', unitCostUsd: 2 }, { quantity: 8, client_request_id: 'plain-client-id-0001' }, { quantity: 8, branchId: undefined }]) {
      const f = w.world({ switches: ON }); w.dateCount(f, { lines: [[10, 3, 3], [11, 5, 7]] })
      const before = w.snapshot(f)
      const held = await adjust(f, body)
      assert.equal(held.status, 409, JSON.stringify(body) + ' ' + JSON.stringify(held.body)); assert.equal(held.body.code, 'inventory_check_count_pending')
      assert.equal(w.snapshot(f), before, 'nothing was written, not even a receipt')
    }
  })

  await check('a fast stock-in Set line is held the same way; another product and the queue OFF are not held', async () => {
    const f = w.world({ switches: ON }); w.dateCount(f, { lines: [[10, 3, 3], [11, 5, 7]] }); otherProduct(f)
    const before = w.snapshot(f)
    const commit = await w.call(f, 'POST', '/api/fast-stock-in/commit', { lines: [{ key: 'k1', wire: 'adjust', body: unscoped({ client_request_id: 'fastset_line_000001' }) }] })
    assert.equal(commit.status, 200, JSON.stringify(commit.body)); assert.equal(commit.body.results[0].ok, false); assert.equal(commit.body.results[0].code, 'inventory_check_count_pending')
    assert.equal(w.snapshot(f), before)
    const other = await adjust(f, { productId: 2, quantity: 4, client_request_id: 'inventory_set_other001' })
    assert.equal(other.status, 200, JSON.stringify(other.body))
    const off = w.world({ switches: { ic_simple: 'on', ic_lot_counts: 'on' } }); w.dateCount(off, { lines: [[10, 3, 3], [11, 5, 7]] })
    assert.equal((await adjust(off)).status, 200, 'with the counts queue OFF nothing can be approved, so nothing is held for one')
  })

  await check('a raising unscoped Set made where no hold applied is seen by the approval: the line is refused, the approval does not add its surplus on top', async () => {
    // Count A=5 -> 3 (a shortage of 2). The queue was OFF when the hand correction raised stock; it is ON when the count is approved.
    const f = w.world({ switches: { ic_simple: 'on', ic_lot_counts: 'on' } })
    w.seed(f, 'UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=9 WHERE product_id=1; UPDATE products SET stock_quantity=9 WHERE id=1')
    w.dateCount(f, { lines: [[10, 3, 5]] })
    const raised = await adjust(f, { quantity: 12, supplierName: 'Acme', unitCostUsd: 2 })
    assert.equal(raised.status, 200, JSON.stringify(raised.body))
    const moved = f.raw.prepare('SELECT movement_type,reason FROM inventory_movements ORDER BY id DESC LIMIT 1').get()
    assert.equal(moved.movement_type, 'add'); assert.match(moved.reason, /\(Set to 12\)$/)
    w.setSwitches(f, ON)
    const afterSet = stock(f)
    const done = await approve(f)
    assert.equal(done.status, 409, JSON.stringify(done.body)); assert.equal(done.body.code, 'inventory_check_stock_adjusted'); assert.deepEqual(done.body.refused, [{ productId: 1, code: 'inventory_check_stock_adjusted' }])
    assert.deepEqual(stock(f), afterSet, 'the approval wrote nothing on top of the correction'); assert.equal(f.raw.prepare('SELECT status FROM inventory_check_approvals').get().status, 'pending', 'the count still waits for a person to recount')
  })

  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-unscoped-set-native')
}
main().catch(error => { console.error(error); process.exit(1) })
