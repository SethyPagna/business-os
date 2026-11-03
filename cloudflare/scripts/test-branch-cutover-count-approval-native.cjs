'use strict'
// A count waiting for approval (0286, ic_fix_stock) is decided before a branch cutover starts: after the cutover the count's stock lines would be
// applied to the successor branch's stock. Runs the LIVE cutover source (the shared harness reads a frozen copy unless PARENT_CONTROL_SOURCE names a
// source directory) on the current schema. The refusal is a plan capability and a begin refusal; only a PENDING approval at the SOURCE branch refuses.
//
// Run: node scripts/test-branch-cutover-count-approval-native.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
process.env.PARENT_CONTROL_SOURCE = path.resolve(__dirname, '../src')
const { world, inspect, begin } = require('./test-branch-cutover-parent-native.cjs')

const waiting = capabilities => capabilities.filter(item => item.code === 'inventory_check_approvals_pending')
const insert = (raw, session, branch, status = 'pending') => raw.prepare(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,decided_by,decided_by_name,decided_at,decision_request_id)
  VALUES(?,1,?,?,1,7,'2026-11-03T01:00:00.000Z',?,?,?,?)`).run(session, branch, status, status === 'pending' ? null : 7, status === 'pending' ? null : 'operator', status === 'pending' ? null : '2026-11-03T02:00:00.000Z', status === 'pending' ? null : 'decision-request-1')

async function main() {
  const w = world(true, { currentSchema: true })
  try {
    const plain = await inspect(w)
    assert.deepEqual(waiting(plain.capabilities), [], 'nothing waits: no approval capability')
    assert.ok(plain.capabilities.some(item => item.code === 'historical_scalar_reference_restricted' && item.detail === 'inventory_check_approvals.branch_id'), 'the new table is classified as a restricted historical reference')
    assert.ok(!plain.capabilities.some(item => item.code === 'unclassified_scalar_reference'), 'and nothing is unclassified')
    insert(w.raw, 'at-the-target', 1)
    assert.deepEqual(waiting((await inspect(w)).capabilities), [], 'a pending approval at the TARGET branch does not block')

    insert(w.raw, 'at-the-source', 2)
    const planned = await inspect(w)
    assert.deepEqual(waiting(planned.capabilities), [{ code: 'inventory_check_approvals_pending', detail: '1' }], 'the plan lists the waiting count')
    assert.equal(planned.activationReady, false)
    const before = w.raw.prepare('SELECT COUNT(*) AS n FROM branch_cutovers').get().n
    await assert.rejects(begin(w), error => error.code === 'branch_cutover_parent_capability' && /inventory_check_approvals_pending:1/.test(error.message), 'begin refuses while it waits')
    assert.equal(w.raw.prepare('SELECT COUNT(*) AS n FROM branch_cutovers').get().n, before, 'and writes no journal')

    w.raw.prepare("UPDATE inventory_check_approvals SET status='rejected',decided_by=7,decided_by_name='operator',decided_at='2026-11-03T02:00:00.000Z',decision_request_id='decision-request-1' WHERE session_id='at-the-source'").run()
    assert.deepEqual(waiting((await inspect(w)).capabilities), [], 'a decided approval does not block')
    try { await begin(w, 'parent_request_002') } catch (error) { assert.ok(!/inventory_check_approvals_pending/.test(String(error.message)), 'whatever else refuses, it is not the count approval: ' + error.message) }
    insert(w.raw, 'decided-earlier', 2, 'approved')
    assert.deepEqual(waiting((await inspect(w)).capabilities), [])
    console.log('PASS a branch cutover waits for pending count approvals at its source branch (plan and begin), and nothing else')
  } finally { w.raw.close() }
}
main().catch(error => { console.error(error); process.exit(1) })
