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

function rig(options: { approval?: InventoryCheckApproval; sessionId?: string; confirm?: boolean; firstId?: number } = {}) {
  const log = { approvals: [] as Array<Record<string, unknown>>, lines: [] as Array<Record<string, unknown>>, confirms: [] as Array<Parameters<ApprovalDeps['askToConfirm']>[0]>, reloads: 0, notices: [] as string[],
    approvalStates: [] as InventoryCheckApproval[], applied: [] as Array<Record<string, number>>, appliedArity: [] as number[], refused: [] as Array<Record<string, string>>, lineErrors: {} as Record<string, string | null>, writeErrors: [] as string[], busy: [] as boolean[] }
  const script = { approval: [] as Array<InventoryCheckApprovalDecision | Error>, line: [] as Array<InventoryCheckLineAnswer | Error> }
  const state = { approval: options.approval ?? pending, current: true, confirm: options.confirm ?? true, sessionId: options.sessionId ?? 'sub-1' }
  const attempts = { approvalAttempt: { current: null as ApprovalAttempt | null }, lineAttempt: { current: null as ApprovalAttempt | null } }
  const inFlight = { current: false }
  let counter = options.firstId ?? 0
  const knownRefusal = async (cause: unknown) => { const code = (cause as { code?: string })?.code; return typeof code === 'string' && Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined }
  const actions = () => createApprovalActions({
    sessionId: state.sessionId, approval: state.approval, items, capabilities: null, current: () => state.current, inFlight, setBusy: value => { log.busy.push(value) },
    setApproval: approval => { state.approval = approval; log.approvalStates.push(approval) }, setApplied: (...args: unknown[]) => { log.applied.push(args[0] as Record<string, number>); log.appliedArity.push(args.length) }, setWriteError: text => { log.writeErrors.push(text) }, setRefused: map => { log.refused.push(map) },
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

type Step = { applied: number; remaining: number; done: boolean; afters: Record<string, number> }
type Row = [number, number, number]
type Real = { label: string; productIds?: number[]; normal?: boolean; reads: number; pageRows: Row[]; steps: Step[]; fresh: Row[] }
// Rows are [product id, quantity shown, damaged units]: the quantity is the ordinary stock plus the damaged units. `fresh` is the session's rows read after the last answer; `reads` is how many times the page must read.
const REAL_ANSWERS: Real[] = [
  { label: 'Paid, stale: line 3 accepted elsewhere then a sale, this page accepts one-date line 2', productIds: [2], reads: 1, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 1, remaining: 0, done: true, afters: { 2: 3, 3: 2 } }], fresh: [[3, 1, 0], [1, 9, 0], [2, 3, 0]] },
  { label: 'Paid, stale, two-date line 1: applied 2, applied_lines {1:5, 3:2}', productIds: [1], reads: 1, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 2, remaining: 0, done: true, afters: { 1: 5, 3: 2 } }], fresh: [[3, 1, 0], [1, 5, 0], [2, 5, 0]] },
  { label: 'Free, stale, two-date line 1: one date per request, applied_lines {3:2} then {1:5, 3:2}', productIds: [1], reads: 1, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 1, remaining: 1, done: false, afters: { 3: 2 } }, { applied: 1, remaining: 0, done: true, afters: { 1: 5, 3: 2 } }], fresh: [[3, 1, 0], [1, 5, 0], [2, 5, 0]] },
  { label: 'Free, stale, line 3 with 2 damaged units', productIds: [1], reads: 1, pageRows: [[3, 7, 2], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 1, remaining: 1, done: false, afters: { 3: 2 } }, { applied: 1, remaining: 0, done: true, afters: { 1: 5, 3: 2 } }], fresh: [[3, 3, 2], [1, 5, 0], [2, 5, 0]] },
  { label: 'Paid, single accept of plain line 3', normal: true, productIds: [3], reads: 0, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 1, remaining: 0, done: true, afters: { 3: 2 } }], fresh: [[3, 2, 0], [1, 9, 0], [2, 5, 0]] },
  { label: 'Paid, single accept of two-date line 1', normal: true, productIds: [1], reads: 0, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 2, remaining: 0, done: true, afters: { 1: 5 } }], fresh: [[3, 5, 0], [1, 5, 0], [2, 5, 0]] },
  { label: 'Free, single accept of two-date line 1', normal: true, productIds: [1], reads: 0, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 1, remaining: 1, done: false, afters: {} }, { applied: 1, remaining: 0, done: true, afters: { 1: 5 } }], fresh: [[3, 5, 0], [1, 5, 0], [2, 5, 0]] },
  { label: 'Free, Approve all', normal: true, reads: 1, pageRows: [[3, 5, 0], [1, 9, 0], [2, 5, 0]], steps: [{ applied: 1, remaining: 3, done: false, afters: {} }, { applied: 1, remaining: 2, done: false, afters: { 1: 5 } }, { applied: 1, remaining: 1, done: false, afters: { 1: 5, 2: 3 } }, { applied: 1, remaining: 0, done: true, afters: { 1: 5, 2: 3, 3: 2 } }], fresh: [[3, 2, 0], [1, 5, 0], [2, 3, 0]] },
]
const answerOf = (step: Step) => answer({ ...pending, applied: Object.keys(step.afters).length, applying: !step.done, applied_lines: Object.fromEntries(Object.entries(step.afters).map(([id, after]) => [id, { before: 0, target: after, after, at: 'x' }])) }, step.applied, step.remaining, { done: step.done })
/** The rows the page ends with: each patch the controller made (the ordinary stock written plus the row's damaged units), replaced by the fresh read when the controller read the session. */
const pageRows = (scenario: Real, log: { applied: Array<Record<string, number>>; reloads: number }): Row[] => {
  const rows = scenario.pageRows.map(row => [...row] as Row)
  for (const patch of log.applied) for (const [id, after] of Object.entries(patch)) { const row = rows.find(entry => entry[0] === Number(id)); if (row) row[1] = after + row[2] }
  return log.reloads > 0 ? scenario.fresh : rows
}

const cases: Array<[string, () => Promise<void>]> = [
  ['accept one line: it moves stock, so the shared review shows the line before and after first; cancel sends nothing; then the request carries productIds, every repeat the same request id, and nothing is read again when it is done', async () => {
    const declined = rig({ confirm: false })
    await declined.actions().decideApproval('approve', [1])
    assert.equal(declined.log.approvals.length, 0, 'cancel sends nothing'); assert.equal(declined.attempts.approvalAttempt.current, null)
    const r = rig()
    const accepted = { ...pending, applied: 1, applied_lines: { 1: { before: 7, target: 12, after: 12, at: 'x' } } }
    r.script.approval.push(answer(accepted, 1, 1), answer(accepted, 1, 0))
    await r.actions().decideApproval('approve', [1])
    assert.equal(r.log.confirms.length, 1, 'asked once, not again for the repeat of the same request')
    assert.deepEqual((r.log.confirms[0].items ?? []).map(entry => [String(entry.label), String(entry.value)]), [['Serum A', 'Now 7 → Set to 12']], 'the line, the stock now and what it will be set to')
    assert.equal(r.log.confirms[0].confirmLabel, 'Approve'); assert.notEqual(r.log.confirms[0].danger, true)
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
    assert.deepEqual(rows[1], ['Serum A', 'Now 7 → Set to 12']); assert.deepEqual(rows[2], ['Cream B', 'Now 4 → Set to 2'], 'stock now, and what it will be: 4 + 3 - 5')
    assert.equal(review.confirmLabel, 'Approve', 'one word on the confirm button'); assert.notEqual(review.danger, true)
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
    assert.ok(r.attempts.approvalAttempt.current, 'an unknown outcome keeps the id'); assert.equal(r.log.lineErrors['1'], 'Save result unknown. Check the session before retrying.')
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
    assert.equal(r.log.lineErrors['2'], 'Save result unknown. Check the session before retrying.'); assert.equal(r.log.reloads, 0, 'an unknown outcome reads nothing: the retry carries the answer')
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
      ['fraction', { productId: 1, action: 'modify', counted: 2.5 }, 'Enter a whole number from 0 to 1,000,000,000.'],
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
  // ---- C2 round 2 ----
  ['a line request id never crosses sessions: the key holds the session, so the same decision on the same product in another session is a new request (mutant M7)', async () => {
    const first = rig({ sessionId: 'sub-1' })
    first.script.line.push(Object.assign(new Error('lost'), { outcome: 'unknown' }))
    assert.equal(await first.actions().decideLine({ productId: 1, action: 'modify', counted: 9 }), false)
    const kept = first.attempts.lineAttempt.current; assert.ok(kept, 'an unknown outcome keeps the id')
    const second = rig({ sessionId: 'sub-2', firstId: 50 }); second.attempts.lineAttempt.current = kept
    second.script.line.push(lineAnswer(pending, 'modify', 1))
    assert.equal(await second.actions().decideLine({ productId: 1, action: 'modify', counted: 9 }), true)
    assert.notEqual(second.log.lines[0].requestId, kept!.requestId, 'the id of session 1 is not sent for session 2')
    const same = rig({ sessionId: 'sub-1' }); same.attempts.lineAttempt.current = kept; same.script.line.push(lineAnswer(pending, 'modify', 1))
    await same.actions().decideLine({ productId: 1, action: 'modify', counted: 9 })
    assert.equal(same.log.lines[0].requestId, kept!.requestId, 'the control: the same session does reuse it')
  }],
  ['the Reject and Close dialogs count only the lines they end: a line the approver rejected is not a Difference (a count of 3 with one rejected says 2)', async () => {
    for (const decision of ['reject', 'close'] as const) {
      const r = rig({ approval: rejected(1) }); r.script.approval.push(answer({ ...pending, status: 'rejected' }, 0, 0))
      await r.actions().decideApproval(decision)
      assert.equal(r.log.confirms[0].items?.[0].value, 2, decision)
    }
  }],
  ['Approve all quotes the approver figure for a modified plain line, and each modified date of a dated line (mutant M9: a dialog that ignores the modification)', async () => {
    const modified: InventoryCheckApproval = { ...pending, line_decisions: {
      2: { decision: 'modify', counted: 4, at: '2026-11-02T02:00:00Z', by_name: 'boss' },
      4: { decision: 'modify', lots: [{ batchId: 7, counted: 5 }, { batchId: 9, counted: 2 }], at: '2026-11-02T02:00:00Z', by_name: 'boss' } } }
    const r = rig({ approval: modified }); r.script.approval.push(answer({ ...pending, status: 'approved', applied: 3 }, 3, 0))
    await r.actions().decideApproval('approve')
    const rows = (r.log.confirms[0].items ?? []).map(entry => [String(entry.label), String(entry.value)])
    assert.deepEqual(rows[2], ['Cream B', 'Now 4 → Set to 3'], 'modified to 4, not what the counter typed (3): 4 + 4 - 5')
    assert.deepEqual(rows.slice(3), [['Dated D · Received 01/10/2026', '5 → 5'], ['Dated D · Received 09/10/2026', '4 → 2']], 'a dated line is shown date by date: what the counter saw, then the approver figure (the counter typed 6 and 3)')
    const plain = rig(); plain.script.approval.push(answer({ ...pending, status: 'approved', applied: 3 }, 3, 0)); await plain.actions().decideApproval('approve')
    assert.deepEqual((plain.log.confirms[0].items ?? []).slice(3).map(entry => String(entry.value)), ['5 → 6', '4 → 3'], 'the control: unmodified dates show the counter figures')
  }],
  ['rejecting a modified line names its state ("Modified to 4 → Rejected", each modified date for a dated line), not "Open" (round-2 review, finding 3)', async () => {
    const decisions = { 2: { decision: 'modify' as const, counted: 4, at: '2026-11-02T02:00:00Z', by_name: 'boss' },
      4: { decision: 'modify' as const, lots: [{ batchId: 7, counted: 5 }, { batchId: 9, counted: 3 }], at: '2026-11-02T02:00:00Z', by_name: 'boss' } }
    const modified: InventoryCheckApproval = { ...pending, line_decisions: decisions }
    const ask = async (productId: number, approval: InventoryCheckApproval) => {
      const r = rig({ approval }); r.script.line.push(lineAnswer(rejected(productId), 'reject', productId))
      await r.actions().decideLine({ productId, action: 'reject' })
      return (r.log.confirms[0].items ?? []).map(entry => [String(entry.label), String(entry.value)])
    }
    assert.deepEqual((await ask(2, modified)).slice(0, 1), [['Cream B', 'Modified to 4 → Rejected']], 'a plain line modified to 4')
    assert.deepEqual((await ask(4, modified)).filter(row => row[0].startsWith('Dated D')), [['Dated D · Received 01/10/2026', 'Modified to 5 → Rejected'], ['Dated D · Received 09/10/2026', 'Modified to 3 → Rejected']], 'a dated line lists every date, as the accept dialog does (the counter typed 6 on the first)')
    const both: InventoryCheckApproval = { ...pending, line_decisions: { 4: { decision: 'modify', lots: [{ batchId: 7, counted: 5 }, { batchId: 9, counted: 2 }], at: '2026-11-02T02:00:00Z', by_name: 'boss' } } }
    assert.deepEqual((await ask(4, both)).filter(row => row[0].startsWith('Dated D')), [['Dated D · Received 01/10/2026', 'Modified to 5 → Rejected'], ['Dated D · Received 09/10/2026', 'Modified to 2 → Rejected']], 'both dates changed: both listed')
    assert.deepEqual((await ask(1, modified)).slice(0, 1), [['Serum A', 'Open → Rejected']], 'an open line still reads Open')
    assert.deepEqual((await ask(4, pending)).filter(row => row[0].startsWith('Dated D')), [['Dated D · Received 01/10/2026', 'Open → Rejected'], ['Dated D · Received 09/10/2026', 'Open → Rejected']], 'an open dated line: every date reads Open')
    const own: InventoryCheckApproval = { ...pending, line_decisions: { 4: { decision: 'modify', lots: [{ batchId: 7, counted: 6 }, { batchId: 9, counted: 3 }], at: '2026-11-02T02:00:00Z', by_name: 'boss' } } }
    assert.deepEqual((await ask(4, own)).filter(row => row[0].startsWith('Dated D')), [['Dated D · Received 01/10/2026', 'Modified to 6 → Rejected'], ['Dated D · Received 09/10/2026', 'Modified to 3 → Rejected']], 'a line modified to the counter figures is still a modified line, not Open')
  }],
  ['an accepted line puts the stock it wrote on the session rows with no read: setApplied carries each newly applied line (ordinary stock after), once', async () => {
    const r = rig()
    const accepted = { ...pending, applied: 1, applying: true, applying_request_id: 'inventory_check_approval_1', planned_lines: [], applied_lines: { 1: { before: 7, target: 12, after: 12, at: 'x' } } }
    r.script.approval.push(answer(accepted, 1, 0))
    await r.actions().decideApproval('approve', [1])
    assert.deepEqual(r.log.applied, [{ '1': 12 }]); assert.equal(r.log.reloads, 0)
    assert.deepEqual(r.log.appliedArity, [1], 'and only the stock figures: the session rows need nothing else')
    const again = rig({ approval: accepted }); again.script.approval.push(answer({ ...accepted, applied: 2, applied_lines: { ...accepted.applied_lines, 2: { before: 4, target: 2, after: 2, at: 'x' } } }, 1, 0))
    await again.actions().decideApproval('approve', [2])
    assert.deepEqual(again.log.applied, [{ '2': 2 }], 'a line applied before is not patched again')
  }],
  ['a line another tab applied (this page had not seen it) is not put on any row from this answer: the session is read once instead, and a normal accept or Approve all reads nothing (round-3 review, finding 4)', async () => {
    const line = (before: number, after: number) => ({ before, target: after, after, at: 'x' })
    // line 4 was accepted in another tab, then this page accepts line 2: the answer lists both, but this request applied one
    const elsewhere = { ...pending, applied: 2, applying: true, applying_request_id: 'inventory_check_approval_1', planned_lines: [], applied_lines: { 4: line(6, 2), 2: line(4, 3) } }
    const r = rig(); r.script.approval.push(answer(elsewhere, 1, 0))
    await r.actions().decideApproval('approve', [2])
    assert.deepEqual(r.log.applied, [], 'the older figure of line 4 reaches no row'); assert.equal(r.log.reloads, 1, 'the session is read once')
    // a dated line writes two stock lines in one request: the count alone (2 new products, 2 writes) cannot tell, but line 4 is a line this request was not asked for
    const dated = rig(); dated.script.approval.push(answer(elsewhere, 2, 0))
    await dated.actions().decideApproval('approve', [2])
    assert.deepEqual(dated.log.applied, [], 'a product the request did not name is applied elsewhere'); assert.equal(dated.log.reloads, 1)
    // Approve all (no ids) is judged the same way: two new products from a request that wrote one
    const all = rig(); all.script.approval.push(answer(elsewhere, 1, 0))
    await all.actions().decideApproval('approve')
    assert.deepEqual(all.log.applied, []); assert.equal(all.log.reloads, 1)
    // the normal cases read nothing after a 200
    const one = rig(); one.script.approval.push(answer({ ...pending, applied: 1, applying: true, applying_request_id: 'inventory_check_approval_1', planned_lines: [], applied_lines: { 2: line(4, 3) } }, 1, 0))
    await one.actions().decideApproval('approve', [2])
    assert.deepEqual(one.log.applied, [{ '2': 3 }]); assert.equal(one.log.reloads, 0, 'a single accept reads nothing')
  }],
  // ---- round 5: the Worker's own answers (recorded from a run of its routes in the lot-set test world: three lines, 1 counted on two received dates, 2 on one, 3 as one total; another tab accepts line 3, a sale takes 1) ----
  ['a stale page and a line counted on several dates: over the Worker\'s real answers on both plans, every row equals a fresh read of the session (round-4 review, finding 1)', async () => {
    for (const scenario of REAL_ANSWERS) {
      const r = rig(); r.script.approval.push(...scenario.steps.map(answerOf))
      await r.actions().decideApproval('approve', scenario.productIds)
      assert.deepEqual(pageRows(scenario, r.log), scenario.fresh, `${scenario.label}: the rows equal a fresh read`)
      assert.equal(r.log.reloads, scenario.reads, `${scenario.label}: reads`)
    }
    // the rows are judged by the answer, not rescued by the read: a stale answer puts nothing on any row
    const paid = REAL_ANSWERS[1], r = rig(); r.script.approval.push(answerOf(paid.steps[0]))
    await r.actions().decideApproval('approve', paid.productIds)
    assert.deepEqual(r.log.applied, [], 'no row takes a figure from a stale answer')
  }],
  ['a takeover answer carries the old approver\'s write: no row takes it and the session is read once; a takeover that wrote nothing, then the repeat of the same accept, patches line 2 only', async () => {
    const line = (after: number) => ({ before: 0, target: after, after, at: 'x' })
    const landed = rig(); landed.script.approval.push(answer({ ...pending, applied: 1, applying: true, applied_lines: { 4: line(2) } }, 1, 2, { takeover: true }), answer({ ...pending, applied: 2, applying: true, applied_lines: { 4: line(2), 2: line(3) } }, 1, 0))
    await landed.actions().decideApproval('approve', [2])
    assert.equal(landed.log.approvals.length, 2); assert.equal(landed.log.approvals[0].requestId, landed.log.approvals[1].requestId)
    assert.deepEqual(landed.log.applied, [], 'line 4 was written by the approver who is gone, and sales may have moved it since: no row takes it'); assert.equal(landed.log.reloads, 1)
    // the write the old approver landed is the very line being accepted: it is in productIds and the counts agree, but the figure is theirs, from before any later sale
    const same = rig(); same.script.approval.push(answer({ ...pending, applied: 1, applying: true, applied_lines: { 2: line(3) } }, 1, 1, { takeover: true }), answer({ ...pending, applied: 1, applying: true, applied_lines: { 2: line(3) } }, 0, 0))
    await same.actions().decideApproval('approve', [2])
    assert.deepEqual(same.log.applied, [], 'a takeover answer is never put on a row'); assert.equal(same.log.reloads, 1)
    const plain = rig(); plain.script.approval.push(answer({ ...pending, applying: true }, 0, 3, { takeover: true }), answer({ ...pending, applied: 1, applying: true, applied_lines: { 2: line(3) } }, 1, 0))
    await plain.actions().decideApproval('approve', [2])
    assert.deepEqual(plain.log.applied, [{ '2': 3 }], 'a takeover that wrote nothing, then the repeat: line 2 is patched'); assert.equal(plain.log.reloads, 0)
  }],
  ['the normal cases read as before on the Worker\'s real answers: a single accept 0 reads, Approve all 1 read, a 409 one read', async () => {
    for (const scenario of REAL_ANSWERS.filter(entry => entry.normal)) {
      const r = rig(); r.script.approval.push(...scenario.steps.map(answerOf))
      await r.actions().decideApproval('approve', scenario.productIds)
      assert.equal(r.log.reloads, scenario.productIds ? 0 : 1, scenario.label); assert.deepEqual(pageRows(scenario, r.log), scenario.fresh, scenario.label)
    }
    for (const first of [true, false]) {
      const r = rig(); const ok = answer({ ...pending, applied: 1, applied_lines: { 1: { before: 7, target: 12, after: 12, at: 'x' } } }, 1, 1)
      r.script.approval.push(...(first ? [refusal('inventory_check_conflict')] : [ok, refusal('inventory_check_conflict')]))
      await r.actions().decideApproval('approve', [1])
      assert.equal(r.log.reloads, 1, first ? 'a 409 on the first request reads once' : 'a 409 on a later request reads once')
    }
  }],
  ['an answer that showed another tab\'s line stays stale across a lost answer and the retry: the session is read on the unknown path and again at the end, and no row takes the retry\'s figures (round-4 review, finding 4)', async () => {
    const free = REAL_ANSWERS[2]
    const lost = () => Object.assign(new Error('lost'), { outcome: 'unknown', code: 'inventory_check_outcome_unknown' })
    const r = rig(); r.script.approval.push(answerOf(free.steps[0]), lost())
    await r.actions().decideApproval('approve', free.productIds)
    assert.equal(r.log.reloads, 1, 'the page showed a stale answer, then lost one: it reads the session')
    assert.ok(r.attempts.approvalAttempt.current, 'the decision is kept for the retry'); assert.equal(r.attempts.approvalAttempt.current?.stale, true, 'and remembers that it is stale')
    r.script.approval.push(answerOf(free.steps[1]))
    await r.actions().decideApproval('approve', free.productIds)
    assert.equal(r.log.confirms.length, 1, 'the retry is not asked again'); assert.equal(r.log.approvals[0].requestId, r.log.approvals[2].requestId, 'under the same request id')
    assert.deepEqual(r.log.applied, [], 'no row took a figure from any answer of the stale decision'); assert.equal(r.log.reloads, 2, 'and the retry reads the session once more at the end')
    // the control: a decision that was never stale and then lost an answer does not read on the unknown path
    const clean = rig(); clean.script.approval.push(lost())
    await clean.actions().decideApproval('approve', [1]); assert.equal(clean.log.reloads, 0); assert.equal(clean.attempts.approvalAttempt.current?.stale, undefined)
  }],
  ['Approve all puts the lines each request newly applied on the rows as it goes: step one carries line 1, step two only line 2', async () => {
    const r = rig()
    const one = { ...pending, applied: 1, applying: true, applying_request_id: 'inventory_check_approval_1', applied_lines: { 1: { before: 7, target: 12, after: 12, at: 'x' } } }
    const two = { ...pending, status: 'approved' as const, applied: 2, applied_lines: { ...one.applied_lines, 2: { before: 4, target: 2, after: 2, at: 'x' } } }
    r.script.approval.push(answer(one, 1, 1), answer(two, 1, 0))
    await r.actions().decideApproval('approve')
    assert.deepEqual(r.log.applied, [{ '1': 12 }, { '2': 2 }]); assert.equal(r.log.reloads, 1, 'and the session is read once at the end')
  }],
]

const failures: string[] = []
for (const [name, run] of cases) {
  try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').filter(Boolean).slice(0, 4).join(' | ')}`) }
}
if (failures.length) throw new Error(`${failures.length} of ${cases.length} approval controller cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS Inventory check approval decisions: ${cases.length} cases (accept lines, Approve all review, request id reuse, refusals on the line, line decisions, modify validation, reopen)`)
