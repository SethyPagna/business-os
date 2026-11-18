'use strict'
// R1: a count typed per received date whose per-date errors cancel out (A counted 6 of 5, B counted 3 of 4: the sums agree) is an Issue and creates an approval. The engine must see the
// same lines the creation counted, or approve, reject and close all refuse that approval for ever (409 inventory_check_approval_lines_changed). One rule (countDiffersSql) decides both.
// Run: node scripts/test-inventory-check-offsetting-dates-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const w = createLotSetWorld({ admin: true })
const planTier = w.load('lib/planTier.ts')
const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', ic_wired: 'on' }
const lot = (f, batch) => f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch)?.quantity
const dates = f => w.seed(f, 'UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=9 WHERE product_id=1; UPDATE products SET stock_quantity=9 WHERE id=1')
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }
const decide = (f, id, body) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval`, { requestId: 'decide-request-01', ...body }) }

/** A real submission: A counted 6 of 5, B counted 3 of 4. The only other administrator is switched off, so the sole approver may decide the count he submitted. */
async function offsetting() {
  const f = w.world({ switches: ON }); dates(f)
  f.raw.exec('UPDATE users SET is_active=0 WHERE id=8')
  const made = await w.call(f, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: 'offset-submit-01', lines: [{ productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 6, seen: 5 }, { batchId: 11, scope: 'lot', counted: 3, seen: 4 }] }] })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const approval = f.raw.prepare('SELECT session_id,lines,status FROM inventory_check_approvals').get()
  assert.equal(approval.lines, 1, 'the creation rule counts the product: its dates differ'); assert.equal(approval.status, 'pending')
  return { f, id: approval.session_id }
}

async function main() {
  await check('approve: the offsetting count is applied date by date (A 5 to 6, B 4 to 3), not refused as changed', async () => {
    const { f, id } = await offsetting()
    const done = await decide(f, id, { decision: 'approve' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true)
    assert.deepEqual({ A: lot(f, 10), B: lot(f, 11) }, { A: 6, B: 3 }); assert.equal(f.raw.prepare('SELECT status FROM inventory_check_approvals').get().status, 'approved')
  })
  await check('reject: the offsetting count can be rejected', async () => {
    const { f, id } = await offsetting()
    const done = await decide(f, id, { decision: 'reject', note: 'recount' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.approval.status, 'rejected')
    assert.deepEqual({ A: lot(f, 10), B: lot(f, 11) }, { A: 5, B: 4 })
  })
  await check('close: the offsetting count can be closed; nothing applied reads as rejected and moves no stock', async () => {
    const { f, id } = await offsetting()
    const done = await decide(f, id, { decision: 'close' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.approval.status, 'rejected')
    assert.deepEqual(done.body.approval.closed, { lines: { 1: 'inventory_check_not_applied' } })
    assert.deepEqual({ A: lot(f, 10), B: lot(f, 11) }, { A: 5, B: 4 })
  })
  await check('control: a count whose dates all agree creates no approval; a plain item-level difference still counts one line', async () => {
    const f = w.world({ switches: ON }); dates(f)
    const same = await w.call(f, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: 'offset-same-001', lines: [{ productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 5, seen: 5 }, { batchId: 11, scope: 'lot', counted: 4, seen: 4 }] }] })
    assert.equal(same.status, 201, JSON.stringify(same.body)); assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 0)
    const g = w.world({ switches: ON }); dates(g); w.dateCount(g, { lines: [[10, 5, 5], [11, 2, 4]] })
    const done = await decide(g, 'dated-session-1', { decision: 'approve' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(lot(g, 11), 2)
  })
  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-offsetting-dates-native')
}
main().catch(error => { console.error(error); process.exit(1) })
