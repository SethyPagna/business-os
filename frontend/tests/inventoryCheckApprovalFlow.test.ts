import assert from 'node:assert/strict'
import { MAX_APPROVAL_REQUESTS, runApprovalFlow } from '../src/components/inventory/inventoryCheckApprovalFlow.ts'
import type { InventoryCheckApproval, InventoryCheckApprovalDecision } from '../src/api/inventoryChecksTransport.ts'

// Lane 6.0.1045 (P1.7): approving can take many requests (the Free plan writes one stock line per request). The flow repeats the SAME decision until the
// server says done, never loops on a request that moved nothing, hands every refusal to the caller, and stops the moment the page is no longer current.

const approval = (status: InventoryCheckApproval['status'], applied: number): InventoryCheckApproval => ({ status, lines: 3, applied, submitted_at: '2026-11-02T01:00:00Z', can_approve: true })
const answer = (applied: number, remaining: number, extra: Partial<InventoryCheckApprovalDecision> = {}): InventoryCheckApprovalDecision =>
  ({ approval: approval(remaining === 0 ? 'approved' : 'pending', 3 - remaining), applied, remaining, done: remaining === 0, ...extra })
const refusal = (code: string) => Object.assign(new Error(code), { code, status: 409 })

async function run(script: Array<InventoryCheckApprovalDecision | Error>, options: { current?: () => boolean } = {}) {
  const sent: number[] = [], progress: number[] = []
  const queue = [...script]
  const result = await runApprovalFlow({
    send: async () => { sent.push(sent.length); const next = queue.shift(); if (!next) throw new Error('script exhausted'); if (next instanceof Error) throw next; return next },
    onProgress: value => { progress.push(value.applied) },
    isCurrent: options.current ?? (() => true),
  })
  return { result, sent, progress, left: queue.length }
}

const cases: Array<[string, () => Promise<void>]> = [
  ['repeats until the server says done, one line per request on the Free plan, reporting every answer', async () => {
    const { result, sent, progress, left } = await run([answer(1, 2), answer(1, 1), answer(1, 0)])
    assert.equal(result.outcome, 'done'); assert.equal(sent.length, 3); assert.deepEqual(progress, [1, 1, 1]); assert.equal(left, 0)
    assert.equal(result.last?.approval.status, 'approved')
  }],
  ['a plan that takes every line at once is one request', async () => {
    const { result, sent } = await run([answer(3, 0)])
    assert.equal(result.outcome, 'done'); assert.equal(sent.length, 1)
  }],
  ['there is no question to ask about moved stock any more: the count is a variance, so a sale since it is kept, and a refusal is final for the caller', async () => {
    await assert.rejects(run([refusal('inventory_check_stock_drifted')]), /inventory_check_stock_drifted/)
  }],
  ['every refusal and unknown outcome reaches the caller unchanged', async () => {
    for (const code of ['inventory_check_stock_inconsistent', 'inventory_check_approve_required', 'inventory_check_conflict', 'inventory_check_approval_in_progress', 'inventory_check_count_below_damaged']) await assert.rejects(run([answer(1, 2), refusal(code)]), new RegExp(code))
    await assert.rejects(run([Object.assign(new Error('unknown'), { outcome: 'unknown' })]), /unknown/)
  }],
  ['lines the stock writer refused stop the flow with what landed kept', async () => {
    const failed = [{ productId: 7, code: 'stock_changed', error: 'Stock changed while saving.' }]
    const { result, sent } = await run([answer(1, 2), answer(1, 1, { failed }), answer(1, 0)])
    assert.equal(result.outcome, 'stalled'); assert.equal(sent.length, 2, 'it does not keep asking after a refusal'); assert.deepEqual(result.last?.failed, failed)
  }],
  ['a request that moved nothing stops the flow instead of asking forever', async () => {
    const { result, sent } = await run([answer(0, 3), answer(1, 0)])
    assert.equal(result.outcome, 'stalled'); assert.equal(sent.length, 1)
  }],
  ['an endless server is bounded by the most requests a submission can need', async () => {
    const endless = Array.from({ length: MAX_APPROVAL_REQUESTS + 5 }, () => answer(1, 2))
    const { result, sent } = await run(endless)
    assert.equal(result.outcome, 'stalled'); assert.equal(sent.length, MAX_APPROVAL_REQUESTS)
  }],
  ['leaving the page mid-flow stops it at once and reports nothing further', async () => {
    let live = true
    const { result, sent, progress } = await run([answer(1, 2), answer(1, 1), answer(1, 0)], { current: () => { const now = live; live = false; return now } })
    assert.equal(result.outcome, 'cancelled'); assert.equal(sent.length, 2); assert.deepEqual(progress, [1])
    const gone = await run([answer(1, 2), answer(3, 0)], { current: () => false })
    assert.equal(gone.result.outcome, 'cancelled'); assert.equal(gone.sent.length, 1, 'a page that is gone does not send a repeat')
  }],
]

const failures: string[] = []
for (const [name, body] of cases) {
  try { await body() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) }
}
if (failures.length) throw new Error(`${failures.length} of ${cases.length} approval flow cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS Inventory check approval flow: ${cases.length} cases (repeat until done, refusals, stalls, bound, leaving)`)
