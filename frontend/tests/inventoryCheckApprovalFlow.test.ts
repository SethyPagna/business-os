import assert from 'node:assert/strict'
import { MAX_APPROVAL_REQUESTS, runApprovalFlow, STOCK_DRIFTED } from '../src/components/inventory/inventoryCheckApprovalFlow.ts'
import type { InventoryCheckApproval, InventoryCheckApprovalDecision } from '../src/api/inventoryChecksTransport.ts'

// Lane 6.0.1045 (P1.7): approving can take many requests (the Free plan writes one stock line per request). The flow repeats the SAME decision until the
// server says done, asks about moved stock at most once, never loops on a request that moved nothing, and stops the moment the page is no longer current.

const approval = (status: InventoryCheckApproval['status'], applied: number): InventoryCheckApproval => ({ status, lines: 3, applied, submitted_at: '2026-11-02T01:00:00Z', can_approve: true })
const answer = (applied: number, remaining: number, extra: Partial<InventoryCheckApprovalDecision> = {}): InventoryCheckApprovalDecision =>
  ({ approval: approval(remaining === 0 ? 'approved' : 'pending', 3 - remaining), applied, remaining, done: remaining === 0, ...extra })
const refusal = (code: string) => Object.assign(new Error(code), { code, status: 409 })

type Sent = { confirmDrift?: boolean }
async function run(script: Array<InventoryCheckApprovalDecision | Error>, options: { confirm?: boolean; current?: () => boolean } = {}) {
  const sent: Sent[] = [], progress: number[] = [], asked: number[] = []
  const queue = [...script]
  const result = await runApprovalFlow({
    send: async extra => { sent.push(extra); const next = queue.shift(); if (!next) throw new Error('script exhausted'); if (next instanceof Error) throw next; return next },
    confirmDrift: async () => { asked.push(sent.length); return options.confirm ?? true },
    onProgress: value => { progress.push(value.applied) },
    isCurrent: options.current ?? (() => true),
  })
  return { result, sent, progress, asked, left: queue.length }
}

const cases: Array<[string, () => Promise<void>]> = [
  ['repeats until the server says done, one line per request on the Free plan, reporting every answer', async () => {
    const { result, sent, progress, left } = await run([answer(1, 2), answer(1, 1), answer(1, 0)])
    assert.equal(result.outcome, 'done'); assert.equal(sent.length, 3); assert.deepEqual(progress, [1, 1, 1]); assert.equal(left, 0)
    assert.deepEqual(sent, [{}, {}, {}], 'nothing is added to the repeats')
    assert.equal(result.last?.approval.status, 'approved')
  }],
  ['a plan that takes every line at once is one request', async () => {
    const { result, sent } = await run([answer(3, 0)])
    assert.equal(result.outcome, 'done'); assert.equal(sent.length, 1)
  }],
  ['moved stock is asked about once; yes repeats with confirmDrift for the rest of the flow, no ends it untouched', async () => {
    const yes = await run([refusal(STOCK_DRIFTED), answer(1, 2), answer(1, 1), answer(1, 0)])
    assert.equal(yes.result.outcome, 'done'); assert.deepEqual(yes.asked, [1], 'asked once')
    assert.deepEqual(yes.sent, [{}, { confirmDrift: true }, { confirmDrift: true }, { confirmDrift: true }])
    const no = await run([refusal(STOCK_DRIFTED), answer(3, 0)], { confirm: false })
    assert.equal(no.result.outcome, 'cancelled'); assert.equal(no.sent.length, 1, 'declined: nothing is sent again'); assert.equal(no.left, 1)
    assert.equal(no.result.last, null)
  }],
  ['a second drift refusal after confirming is a real error, not another question', async () => {
    await assert.rejects(run([refusal(STOCK_DRIFTED), refusal(STOCK_DRIFTED)]), /inventory_check_stock_drifted/)
  }],
  ['every other refusal and unknown outcome reaches the caller unchanged', async () => {
    for (const code of ['inventory_check_stock_inconsistent', 'inventory_check_approve_required', 'inventory_check_conflict']) await assert.rejects(run([answer(1, 2), refusal(code)]), new RegExp(code))
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
    const gone = await run([refusal(STOCK_DRIFTED), answer(3, 0)], { current: () => false })
    assert.equal(gone.result.outcome, 'cancelled'); assert.equal(gone.sent.length, 1, 'a page that is gone does not send a confirmed repeat')
  }],
]

const failures: string[] = []
for (const [name, body] of cases) {
  try { await body() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) }
}
if (failures.length) throw new Error(`${failures.length} of ${cases.length} approval flow cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS Inventory check approval flow: ${cases.length} cases (repeat until done, drift asked once, refusals, stalls, bound, leaving)`)
