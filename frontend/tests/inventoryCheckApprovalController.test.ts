import assert from 'node:assert/strict'
import { createApprovalActions, type ApprovalAttempt, type ApprovalDeps } from '../src/components/inventory/inventoryCheckApprovalController.ts'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'
import type { InventoryCheckApproval, InventoryCheckApprovalDecision, InventoryCheckLineAnswer, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'

// The decisions behind the approval panel, with no React: what each action sends, when it asks first, which request id it carries and when that id is reused, what it shows for a refusal,
// and that a line decision reads nothing again. (The page's hook only gives this its state and the transport.)

const pending: InventoryCheckApproval = { status: 'pending', lines: 3, applied: 0, submitted_at: '2026-11-02T01:00:00Z', can_approve: true, applied_lines: {}, line_ids: [1, 2, 4] }
const item = (id: number, name: string, counted: number, baseline: number, extra: Partial<InventoryCheckSessionItem> = {}): InventoryCheckSessionItem => ({
  product_id: id, state: 'issue', counted_quantity: counted, reason: null, revision: 1, baseline_quantity: baseline, current_quantity: baseline, product_snapshot: { id, name }, ...extra })
const items = [item(1, 'Serum A', 12, 7), item(2, 'Cream B', 3, 5, { current_quantity: 4 }),
  item(4, 'Dated D', 9, 9, { lot_lines: [{ batch_id: 7, scope: 'lot', counted: 6, seen: 5, received_at: '2026-10-01' }, { batch_id: 9, scope: 'lot', counted: 3, seen: 4, received_at: '2026-10-09' }] })]
const refusal = (code: string, status = 409) => Object.assign(new Error(code), { code, status })

function rig(options: { approval?: InventoryCheckApproval; sessionId?: string; confirm?: boolean } = {}) {
  const log = { approvals: [] as Array<Record<string, unknown>>, lines: [] as Array<Record<string, unknown>>, confirms: [] as Array<Parameters<ApprovalDeps['askToConfirm']>[0]>, reloads: 0, notices: [] as string[],
    approvalStates: [] as InventoryCheckApproval[], refused: [] as Array<Record<string, string>>, lineErrors: {} as Record<string, string | null>, writeErrors: [] as string[], busy: [] as boolean[] }
  const script = { approval: [] as Array<InventoryCheckApprovalDecision | Error>, line: [] as Array<InventoryCheckLineAnswer | Error> }
  const state = { approval: options.approval ?? pending, current: true, confirm: options.confirm ?? true, sessionId: options.sessionId ?? 'sub-1' }
  const attempts = { approvalAttempt: { current: null as ApprovalAttempt | null }, lineAttempt: { current: null as ApprovalAttempt | null } }
  const inFlight = { current: false }
  let counter = 0
  const knownRefusal = async (cause: unknown) => { const code = (cause as { code?: string })?.code; return typeof code === 'string' && Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined }
  const actions = () => createApprovalActions({
    sessionId: state.sessionId, approval: state.approval, items, capabilities: null, current: () => state.current, inFlight, setBusy: value => { log.busy.push(value) },
    setApproval: approval => { state.approval = approval; log.approvalStates.push(approval) }, setWriteError: text => { log.writeErrors.push(text) }, setRefused: map => { log.refused.push(map) },
    setLineError: (id, text) => { log.lineErrors[id] = text }, askToConfirm: async request => { log.confirms.push(request); return state.confirm }, tr: (_key, fallback) => fallback, notify: message => { log.notices.push(message) },
    knownRefusal, unknownSaveKey: () => 'inventory_check_save_unknown', reload: () => { log.reloads += 1 }, ...attempts, newRequestId: prefix => `${prefix}_${++counter}`,
    send: {
      approval: async input => { log.approvals.push(input); const next = script.approval.shift(); if (!next) throw new Error('no scripted approval answer'); if (next instanceof Error) throw next; return next },
      line: async input => { log.lines.push(input); const next = script.line.shift(); if (!next) throw new Error('no scripted line answer'); if (next instanceof Error) throw next; return next },
    },
  })
  return { log, script, state, attempts, inFlight, actions }
}
const answer = (approval: InventoryCheckApproval, applied: number, remaining: number, extra: Partial<InventoryCheckApprovalDecision> = {}): InventoryCheckApprovalDecision => ({ approval, applied, remaining, done: remaining === 0, ...extra })
const lineAnswer = (approval: InventoryCheckApproval, action: 'reject' | 'modify' | 'reopen', productId: number, extra: Partial<InventoryCheckLineAnswer> = {}): InventoryCheckLineAnswer => ({ approval, applied: 0, remaining: 2, done: false, line: { productId, action }, ...extra })
const rejected = (id: number, extra: Partial<InventoryCheckApproval> = {}): InventoryCheckApproval => ({ ...pending, line_decisions: { [id]: { decision: 'reject', at: '2026-11-02T02:00:00Z', by_name: 'boss' } }, ...extra })

const cases: Array<[string, () => Promise<void>]> = [
  ['accept one line: one tap, no dialog, the approval request carries productIds, every repeat the same request id, and nothing is read again when it is done', async () => {
    const r = rig()
    const accepted = { ...pending, applied: 1, applied_lines: { 1: { before: 7, target: 12, after: 12, at: 'x' } } }
    r.script.approval.push(answer(accepted, 1, 1), answer(accepted, 1, 0))
    await r.actions().decideApproval('approve', [1])
    assert.equal(r.log.confirms.length, 0, 'one line is accepted without a dialog')
    assert.equal(r.log.approvals.length, 2, 'one stock line per request on the Free plan: the same request repeats until done')
    assert.deepEqual(r.log.approvals.map(call => call.productIds), [[1], [1]]); assert.deepEqual(r.log.approvals.map(call => call.decision), ['approve', 'approve'])
    assert.equal(r.log.approvals[0].requestId, r.log.approvals[1].requestId); assert.match(String(r.log.approvals[0].requestId), /^inventory_check_approval_/)
    assert.equal(r.log.reloads, 0, 'the answer carries the approval: no read follows')
    assert.equal(r.log.notices.length, 0, 'the approval is still pending, so nothing is announced'); assert.equal(r.attempts.approvalAttempt.current, null)
    assert.equal(r.state.approval.applied, 1, 'the panel took the answer')
  }],
  ['accepting the last open line ends the approval: it says so', async () => {
    const r = rig()
    r.script.approval.push(answer({ ...pending, status: 'approved', applied: 3 }, 1, 0))
    await r.actions().decideApproval('approve', [2])
    assert.deepEqual(r.log.notices, ['Counts approved. Stock updated.'])
  }],
  ['Approve all shows the review first with the figures before and after, cancel sends nothing, confirm sends no productIds, and the session is read again as it always was', async () => {
    const declined = rig({ confirm: false })
    await declined.actions().decideApproval('approve')
    assert.equal(declined.log.approvals.length, 0, 'cancel sends nothing'); assert.equal(declined.attempts.approvalAttempt.current, null)
    const r = rig()
    r.script.approval.push(answer({ ...pending, status: 'approved', applied: 3 }, 3, 0))
    await r.actions().decideApproval('approve')
    assert.equal(r.log.confirms.length, 1)
    const review = r.log.confirms[0], rows = (review.items ?? []).map(entry => [String(entry.label), String(entry.value)])
    assert.deepEqual(rows[0], ['Open lines', '3 → 0'], 'how many lines it applies')
    assert.deepEqual(rows[1], ['Serum A', '7 → 12']); assert.deepEqual(rows[2], ['Cream B', '4 → 2'], 'stock now, and what it will be: 4 + 3 - 5')
    assert.equal(review.confirmLabel, 'Approve all'); assert.notEqual(review.danger, true)
    assert.equal(Object.hasOwn(r.log.approvals[0], 'productIds'), false); assert.equal(r.log.reloads, 1)
  }],
  ['Approve all leaves rejected lines out of its review and says how many are left', async () => {
    const r = rig({ approval: rejected(1) })
    r.script.approval.push(answer(pending, 2, 0))
    await r.actions().decideApproval('approve')
    assert.equal(r.log.confirms[0].items?.[0].value, '2 → 0'); assert.ok(!(r.log.confirms[0].items ?? []).some(entry => entry.label === 'Serum A'), 'a rejected line is not applied, so it is not in the review')
  }],
  ['rejecting or closing the whole count asks first, as danger, with the open lines', async () => {
    for (const decision of ['reject', 'close'] as const) {
      const r = rig(); r.script.approval.push(answer({ ...pending, status: 'rejected' }, 0, 0))
      await r.actions().decideApproval(decision)
      assert.equal(r.log.confirms.length, 1); assert.equal(r.log.confirms[0].danger, true); assert.equal(r.log.confirms[0].items?.[0].value, 3)
      assert.equal(r.log.approvals[0].decision, decision)
    }
  }],
  ['a retry of a lost answer repeats the SAME request id (and does not ask again); a definite refusal drops it, so the corrected decision is a fresh one', async () => {
    const r = rig()
    r.script.approval.push(Object.assign(new Error('lost'), { outcome: 'unknown' }), answer(pending, 1, 0))
    await r.actions().decideApproval('approve', [1])
    assert.ok(r.attempts.approvalAttempt.current, 'an unknown outcome keeps the id'); assert.equal(r.log.lineErrors['1'], 'Save not confirmed. Retry the same operation or reload.')
    const first = r.log.approvals[0].requestId
    await r.actions().decideApproval('approve', [1])
    assert.equal(r.log.approvals[1].requestId, first, 'the retry carries the same request id')
    r.script.approval.push(refusal('inventory_check_line_rejected'), answer(pending, 1, 0))
    await r.actions().decideApproval('approve', [2])
    assert.equal(r.attempts.approvalAttempt.current, null, 'a definite refusal drops the id')
    await r.actions().decideApproval('approve', [2])
    assert.notEqual(r.log.approvals[3].requestId, r.log.approvals[2].requestId, 'the retry after a refusal is a new decision')
    const other = rig({ sessionId: 'sub-2' }); other.attempts.approvalAttempt.current = { key: 'sub-1:approve:1', requestId: 'inventory_check_approval_old' }
    other.script.approval.push(answer(pending, 1, 0)); await other.actions().decideApproval('approve', [1])
    assert.notEqual(other.log.approvals[0].requestId, 'inventory_check_approval_old', 'an id never crosses to another session')
  }],
  ['a refused accept says why on the line itself (its own sentence), shows the real state (one read) and is never the generic "not saved"', async () => {
    const r = rig()
    r.script.approval.push(refusal('inventory_check_line_rejected'))
    await r.actions().decideApproval('approve', [1])
    assert.equal(r.log.lineErrors['1'], 'This line was rejected. Reopen it first.'); assert.equal(r.log.reloads, 1); assert.equal(r.log.writeErrors.at(-1), '', 'nothing is said above the panel')
    const self = rig(); self.script.approval.push(refusal('inventory_check_self_approval', 403))
    await self.actions().decideApproval('approve', [2])
    assert.equal(self.log.lineErrors['2'], 'You submitted this count, so another approver must approve it.')
    const odd = rig(); odd.script.approval.push(refusal('something_new', 500))
    await odd.actions().decideApproval('approve', [2])
    assert.equal(odd.log.lineErrors['2'], 'Check not saved. Try again.', 'only an unknown failure is the generic sentence')
  }],
  ['lines the approval cannot apply stop the flow with each reason handed to the panel', async () => {
    const r = rig()
    r.script.approval.push(answer(pending, 1, 1, { refused: [{ productId: 2, code: 'inventory_check_count_below_damaged' }] }))
    await r.actions().decideApproval('approve')
    assert.deepEqual(r.log.refused.at(-1), { 2: 'inventory_check_count_below_damaged' })
    assert.match(r.log.writeErrors.at(-1) ?? '', /Some lines cannot be applied/)
  }],

  ['reject one line: asks first with the line before and after (open to rejected, stock now unchanged), sends ONE request, the answer replaces the approval, nothing is read again', async () => {
    const r = rig()
    r.script.line.push(lineAnswer(rejected(2), 'reject', 2))
    assert.equal(await r.actions().decideLine({ productId: 2, action: 'reject' }), true)
    assert.equal(r.log.confirms.length, 1); const rows = (r.log.confirms[0].items ?? []).map(entry => [String(entry.label), String(entry.value)])
    assert.deepEqual(rows, [['Cream B', 'Open → Rejected'], ['Now', '4 → 4']]); assert.equal(r.log.confirms[0].danger, true)
    assert.equal(r.log.lines.length, 1); assert.equal(r.log.approvals.length, 0)
    assert.deepEqual({ ...r.log.lines[0], requestId: undefined }, { productId: 2, action: 'reject', requestId: undefined }); assert.match(String(r.log.lines[0].requestId), /^inventory_check_line_/)
    assert.equal(r.state.approval.line_decisions?.['2']?.decision, 'reject', 'the panel took the answer'); assert.equal(r.log.reloads, 0)
    const cancelled = rig({ confirm: false }); assert.equal(await cancelled.actions().decideLine({ productId: 2, action: 'reject' }), false); assert.equal(cancelled.log.lines.length, 0)
  }],
  ['the request id of a line decision is reused when the same decision is retried after a lost answer (no second dialog), and is new after a refusal or for another figure', async () => {
    const r = rig()
    r.script.line.push(Object.assign(new Error('lost'), { outcome: 'unknown' }), lineAnswer(rejected(2), 'reject', 2))
    assert.equal(await r.actions().decideLine({ productId: 2, action: 'reject' }), false)
    assert.equal(r.log.lineErrors['2'], 'Save not confirmed. Retry the same operation or reload.'); assert.equal(r.log.reloads, 0, 'an unknown outcome reads nothing: the retry carries the answer')
    assert.equal(await r.actions().decideLine({ productId: 2, action: 'reject' }), true)
    assert.equal(r.log.lines[1].requestId, r.log.lines[0].requestId, 'the same id'); assert.equal(r.log.confirms.length, 1, 'asked once')
    const m = rig()
    m.script.line.push(refusal('inventory_check_conflict'), lineAnswer(pending, 'modify', 1), lineAnswer(pending, 'modify', 1))
    await m.actions().decideLine({ productId: 1, action: 'modify', counted: 9 })
    assert.equal(m.attempts.lineAttempt.current, null, 'a definite refusal drops the id'); assert.equal(m.log.reloads, 1, 'a conflict reads the approval again to show the line as it is')
    assert.equal(m.log.lineErrors['1'], 'This count changed while you were working. The page was reloaded: check the line and try again.')
    await m.actions().decideLine({ productId: 1, action: 'modify', counted: 9 }); await m.actions().decideLine({ productId: 1, action: 'modify', counted: 10 })
    assert.notEqual(m.log.lines[1].requestId, m.log.lines[0].requestId, 'after a refusal the same input is a new request'); assert.notEqual(m.log.lines[2].requestId, m.log.lines[1].requestId)
    const unknown = rig(); unknown.script.line.push(Object.assign(refusal('inventory_check_outcome_unknown', 503)), lineAnswer(pending, 'reopen', 1))
    await unknown.actions().decideLine({ productId: 1, action: 'reopen' })
    assert.ok(unknown.attempts.lineAttempt.current, 'outcome_unknown (503) is an unknown result: the id is kept'); await unknown.actions().decideLine({ productId: 1, action: 'reopen' })
    assert.equal(unknown.log.lines[1].requestId, unknown.log.lines[0].requestId)
  }],
  ['modify validation: a figure the Worker would refuse never leaves the page, and the line says why in its own words', async () => {
    const table: Array<[string, { productId: number; action: 'modify'; counted?: number; lots?: Array<{ batchId: number; counted: number }> }, string]> = [
      ['negative', { productId: 1, action: 'modify', counted: -1 }, 'Enter a whole number from 0 to 1,000,000,000.'],
      ['fraction', { productId: 1, action: 'modify', counted: 2.5 }, 'A counted number is not a whole number. Reject this count and recount.'],
      ['too large', { productId: 1, action: 'modify', counted: 1_000_000_001 }, 'Enter a whole number from 0 to 1,000,000,000.'],
      ['dates for a total', { productId: 1, action: 'modify', lots: [{ batchId: 7, counted: 1 }] }, 'This line was counted as one total. Enter one figure.'],
      ['a total for a dated line', { productId: 4, action: 'modify', counted: 4 }, 'This line was counted by received date. Enter a figure for each date.'],
      ['a date the count does not hold', { productId: 4, action: 'modify', lots: [{ batchId: 8, counted: 1 }] }, 'That received date was not part of the count.'],
    ]
    for (const [name, change, sentence] of table) {
      const r = rig(); assert.equal(await r.actions().decideLine(change), false, name)
      assert.equal(r.log.lines.length, 0, `${name}: nothing sent`); assert.equal(r.log.lineErrors[String(change.productId)], sentence, name); assert.equal(r.log.reloads, 0)
    }
    const ok = rig(); ok.script.line.push(lineAnswer(pending, 'modify', 4))
    assert.equal(await ok.actions().decideLine({ productId: 4, action: 'modify', lots: [{ batchId: 9, counted: 4 }, { batchId: 7, counted: 6 }] }), true)
    assert.deepEqual(ok.log.lines[0].lots, [{ batchId: 9, counted: 4 }, { batchId: 7, counted: 6 }], 'a dated line sends only dates it holds'); assert.equal(Object.hasOwn(ok.log.lines[0], 'counted'), false)
  }],
  ['reopen sends no figures, takes the answer and reads nothing; the approval ending with a decision announces it once', async () => {
    const r = rig({ approval: rejected(2) })
    r.script.line.push(lineAnswer(pending, 'reopen', 2))
    assert.equal(await r.actions().decideLine({ productId: 2, action: 'reopen' }), true)
    assert.equal(r.log.confirms.length, 0, 'reopening asks nothing'); assert.deepEqual({ ...r.log.lines[0], requestId: 0 }, { productId: 2, action: 'reopen', requestId: 0 })
    assert.equal(r.state.approval.line_decisions, undefined); assert.equal(r.log.reloads, 0)
    const last = rig(); last.script.line.push(lineAnswer({ ...pending, status: 'rejected', decided_by_name: 'boss' }, 'reject', 1, { done: true, remaining: 0 }))
    await last.actions().decideLine({ productId: 1, action: 'reject' })
    assert.deepEqual(last.log.notices, ['Counts rejected. Stock unchanged.'])
  }],
  ['one write at a time, and nothing once the approval is no longer pending or the page moved on', async () => {
    const r = rig(); r.inFlight.current = true
    assert.equal(await r.actions().decideLine({ productId: 1, action: 'reopen' }), false); await r.actions().decideApproval('approve', [1])
    assert.equal(r.log.lines.length + r.log.approvals.length, 0)
    const done = rig({ approval: { ...pending, status: 'approved' } }); assert.equal(await done.actions().decideLine({ productId: 1, action: 'reopen' }), false)
    const gone = rig(); gone.state.current = false; assert.equal(await gone.actions().decideLine({ productId: 1, action: 'reopen' }), false)
    const busyOnce = rig(); busyOnce.script.line.push(lineAnswer(pending, 'reopen', 1)); await busyOnce.actions().decideLine({ productId: 1, action: 'reopen' })
    assert.deepEqual(busyOnce.log.busy, [true, false], 'busy while it runs'); assert.equal(busyOnce.inFlight.current, false)
  }],
]

const failures: string[] = []
for (const [name, run] of cases) {
  try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').filter(Boolean).slice(0, 4).join(' | ')}`) }
}
if (failures.length) throw new Error(`${failures.length} of ${cases.length} approval controller cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS Inventory check approval decisions: ${cases.length} cases (accept lines, Approve all review, request id reuse, refusals on the line, line decisions, modify validation, reopen)`)
