'use strict'
// INV S6, G3: a direct Set is held while a count of that product at that branch waits for approval, whatever the client's request id is. Real routes
// (POST /api/inventory/adjust with setScope, PATCH /api/batches/:id/branches/:branchId), the real stock writers and the real hold over every migration.
// Run: node scripts/test-inventory-check-set-hold-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const w = createLotSetWorld()
const ON = { ic_fix_stock: 'on' }
const set = (body = {}) => ({ type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 11, quantity: 6, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'inventory_set_x1234567', ...body })
const adjust = (f, body) => w.call(f, 'POST', '/api/inventory/adjust', set(body))
const patch = (f, body = {}) => w.call(f, 'PATCH', '/api/batches/11/branches/1', { quantity: 6, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'batches_set_x1234567', ...body })
const lotQuantity = (f, batch = 11) => f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch).quantity
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }

async function main() {
  await check('a waiting count holds a lot Set whatever the request id is, on both routes, and nothing is written', async () => {
    for (const id of ['inventory_set_x1234567', 'plain-client-id-0001', 'icfix_other-session_1_abcdef12']) {
      const f = w.world({ switches: ON }); w.waitingCount(f)
      const before = w.snapshot(f)
      const held = await adjust(f, { client_request_id: id })
      assert.equal(held.status, 409, id); assert.equal(held.body.code, 'inventory_check_count_pending', id)
      assert.equal(w.snapshot(f), before, 'nothing was written, not even a receipt')
    }
    const f = w.world({ switches: ON }); w.waitingCount(f)
    const before = w.snapshot(f)
    const viaBatches = await patch(f)
    assert.equal(viaBatches.status, 409); assert.equal(viaBatches.body.code, 'inventory_check_count_pending')
    assert.equal(w.snapshot(f), before)
    const noId = await patch(f, { client_request_id: undefined })
    assert.equal(noId.status, 409, 'a request with no id at all is held too'); assert.equal(w.snapshot(f), before)
  })

  await check('a branch-total Set is held the same way', async () => {
    const f = w.world({ switches: ON }); w.waitingCount(f)
    const before = w.snapshot(f)
    const held = await adjust(f, { setScope: 'branch', quantity: 9, expectedLotQuantity: undefined, expectedBranchQuantity: 10 })
    assert.equal(held.status, 409); assert.equal(held.body.code, 'inventory_check_count_pending'); assert.equal(w.snapshot(f), before)
  })

  await check('the hold is scoped: another product, another branch, a decided count and the switch OFF are not held', async () => {
    const f = w.world({ switches: ON }); w.waitingCount(f)
    w.seed(f, `INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON',2,0,5,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,5);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(20,2,'T','T','2026-09-02',1,3,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,5);`)
    const other = await adjust(f, { productId: 2, batchId: 20, quantity: 4, expectedLotQuantity: 5, client_request_id: 'inventory_set_other001' })
    assert.equal(other.status, 200, JSON.stringify(other.body)); assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=20').get().quantity, 4)
    const otherBranch = w.world({ switches: ON }); w.waitingCount(otherBranch, { branchId: 2 })
    assert.equal((await adjust(otherBranch)).status, 200, 'a count at another branch does not hold this branch')
    const decided = w.world({ switches: ON }); w.waitingCount(decided)
    decided.raw.exec("UPDATE inventory_check_approvals SET status='rejected',decided_by=7,decided_by_name='Lead',decided_at='2026-11-09T02:00:00.000Z',decision_request_id='decided-0001',decision_note='no'")
    assert.equal((await adjust(decided)).status, 200, 'a rejected count holds nothing'); assert.equal(lotQuantity(decided), 6)
    const off = w.world({ switches: {} }); w.waitingCount(off)
    assert.equal((await adjust(off)).status, 200, 'with the counts queue OFF nothing can be approved, so nothing is held for one')
    const offPatch = w.world({ switches: {} }); w.waitingCount(offPatch)
    assert.equal((await patch(offPatch)).status, 200)
  })

  await check('a count a newer count has replaced holds nothing; an applied line holds nothing', async () => {
    const f = w.world({ switches: ON }); w.waitingCount(f)
    f.raw.exec(`UPDATE inventory_check_approvals SET superseded_json='{"1":"newer-session"}'`)
    assert.equal((await adjust(f)).status, 200)
    const g = w.world({ switches: ON }); w.waitingCount(g)
    g.raw.exec(`UPDATE inventory_check_approvals SET applied_json='{"lines":{"1":{"before":10,"target":8,"after":8,"at":"2026-11-09T02:00:00.000Z"}}}'`)
    assert.equal((await patch(g)).status, 200)
  })

  await check('an approval write steps over its own approval only: a claim naming another session is still held', async () => {
    const f = w.world({ switches: ON }); w.waitingCount(f)
    const before = w.snapshot(f)
    // A claim that names a session which does not wait for this product buys nothing.
    const foreign = await adjust(f, { client_request_id: 'approval-write-0001', approvalClaim: { sessionId: 'some-other-session', key: 'approval-key-0001' } })
    assert.equal(foreign.status, 409); assert.equal(foreign.body.code, 'inventory_check_count_pending'); assert.equal(w.snapshot(f), before)
    // The claim of the waiting approval itself is not held by the hold; whether it may write is the claim's own in-batch check (nobody holds it here, so nothing is written).
    const own = await adjust(f, { client_request_id: 'approval-write-0002', approvalClaim: { sessionId: 'waiting-session-1', key: 'approval-key-0001' } })
    assert.notEqual(own.body.code, 'inventory_check_count_pending')
    assert.equal(lotQuantity(f), 7, 'a claim nobody holds writes nothing')
  })

  await check('the hold reads the LANDING branch: a Set addressed to a disabled branch that lands on a branch where a count waits is held, on both routes', async () => {
    const REDIRECT = { 'X-Branch-Redirect': '1' }
    const disabled = f => w.seed(f, 'UPDATE branches SET is_active=0 WHERE id=2')
    const viaAdjust = (f, extra = {}) => w.call(f, 'POST', '/api/inventory/adjust', set({ branchId: 2, ...extra }), {}, REDIRECT)
    const control = w.world({ switches: ON }); disabled(control)
    assert.equal((await viaAdjust(control)).status, 200, 'with nothing waiting, the confirmed redirect lands the Set at branch 1')
    assert.equal(lotQuantity(control), 6)
    const f = w.world({ switches: ON }); disabled(f); w.waitingCount(f)
    const before = w.snapshot(f)
    const held = await viaAdjust(f)
    assert.equal(held.status, 409, JSON.stringify(held.body)); assert.equal(held.body.code, 'inventory_check_count_pending'); assert.equal(w.snapshot(f), before)
    const heldPatch = await w.call(f, 'PATCH', '/api/batches/11/branches/2', { quantity: 6, reason: 'Physical count', client_request_id: 'batches_set_land001' }, {}, REDIRECT)
    assert.equal(heldPatch.status, 409, JSON.stringify(heldPatch.body)); assert.equal(heldPatch.body.code, 'inventory_check_count_pending'); assert.equal(w.snapshot(f), before)
  })

  await check('the hold asks the counts tables directly: no schema scan; a database without them is not held (200); an approval line under its claim asks nothing', async () => {
    const watch = f => { const seen = []; const real = f.env.DB.prepare; f.env.DB.prepare = (sql, values) => { seen.push(sql); return real(sql, values) }; return seen }
    // No schema scan ahead of the hold, and the waiting query is the only count read.
    const f = w.world({ switches: ON }); const seen = watch(f)
    assert.equal((await adjust(f)).status, 200)
    assert.ok(!seen.some(sql => /sqlite_master/i.test(sql) && /inventory_check/i.test(sql)), 'no sqlite_master probe for the counts tables')
    assert.equal(seen.filter(sql => /FROM inventory_check_items i JOIN inventory_check_approvals a/.test(sql)).length, 1, 'one hold query')
    // A database that never had the tables (before 0259/0286): nothing waits, so nothing is held.
    const bare = w.world({ switches: ON }); bare.raw.exec('PRAGMA foreign_keys=OFF; DROP TABLE inventory_check_approvals; DROP TABLE inventory_check_items;')
    assert.equal((await adjust(bare)).status, 200); assert.equal(lotQuantity(bare), 6)
    const named = w.world({ switches: ON }); named.raw.exec('PRAGMA foreign_keys=OFF; DROP TABLE inventory_check_approvals; DROP TABLE inventory_check_items;')
    assert.equal((await adjust(named, { client_request_id: 'icfix_some-session_1_abcdef12' })).status, 200, 'a named Fix stock request is not held for a table that is not there')
    // An approval's variance line (a claim) is not asked at all: one hold query fewer for every line of every approval.
    const g = w.world({ switches: ON }); w.waitingCount(g); const gseen = watch(g)
    await adjust(g, { quantity: undefined, expectedLotQuantity: undefined, variance: { counted: 5, seen: 7 }, client_request_id: 'approval-line-0001', approvalClaim: { sessionId: 'waiting-session-1', key: 'approval-key-0001' } })
    assert.equal(gseen.filter(sql => /FROM inventory_check_items i JOIN inventory_check_approvals a/.test(sql)).length, 0, 'the hold query was not run for a claimed variance line')
  })

  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-set-hold-native')
}
main().catch(error => { console.error(error); process.exit(1) })
