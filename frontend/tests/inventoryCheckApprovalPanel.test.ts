import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import type { InventoryCheckApproval, InventoryCheckSessionItem, InventoryCheckSession } from '../src/api/inventoryChecksTransport.ts'

// Lane 6.0.1045 (P1.7): the decision on a submitted count. Where it stands, what approving will leave per product (the stock of now moved by what the
// count found against what the counter saw, never below zero), and Approve / Reject only for someone who may decide and only while it is pending.
// Once stock may have moved for it (claimed) there is no Reject, and only the approver who started it can finish it.

const pending: InventoryCheckApproval = { status: 'pending', lines: 2, applied: 0, submitted_at: '2026-11-02T01:00:00Z', can_approve: true, applied_lines: {} }
const item = (id: number, name: string, counted: number, baseline: number, extra: Partial<InventoryCheckSessionItem> = {}): InventoryCheckSessionItem => ({
  product_id: id, state: counted === baseline ? 'done' : 'issue', counted_quantity: counted, reason: counted === baseline ? null : 'Count differs from stock', revision: 1,
  baseline_quantity: baseline, current_quantity: baseline, product_snapshot: { id, name }, ...extra })
const items = [
  item(1, 'Serum A', 12, 7, { current_stock: { recorded_damaged_quantity: 2 }, current_quantity: 7 }),
  item(2, 'Cream B', 3, 5, { current_quantity: 4 }),
  item(3, 'Soap C', 5, 5),
]

type Call = string
const calls: Call[] = []
const base = { approval: pending, items, canDecide: true, busy: false, t: (key: string) => key, onApprove: () => { calls.push('approve') }, onReject: () => { calls.push('reject') } }
const harness = await createHarness({})
const live: MountedSurface[] = []
const mount = async (props: Record<string, unknown> = {}) => { const surface = await harness.mount({ component: 'components/inventory/InventoryCheckApprovalPanel.tsx', props: { ...base, ...props }, app: {}, doubles: {} }); live.push(surface); return surface }
const action = (surface: MountedSurface, name: string) => surface.findAll(node => node.getAttribute('data-approval-action') === name)[0]
const lineOf = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-approval-line') === String(id), `line ${id}`)
const disabled = (node: MemoryNode) => node.getAttribute('disabled') !== null || (node as unknown as { disabled?: boolean }).disabled === true
const text = (node: MemoryNode | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

const cases: Array<[string, () => Promise<void>]> = [
  ['a pending count shows its tag, the differences, and one line per differing product only', async () => {
    const panel = await mount()
    const root = panel.find(node => node.getAttribute('data-inventory-check-approval') !== null, 'panel')
    assert.equal(root.getAttribute('data-inventory-check-approval'), 'pending')
    const chip = panel.find(node => node.getAttribute('data-approval-status') !== null, 'status chip')
    assert.equal(chip.getAttribute('data-approval-status'), 'pending'); assert.match(text(chip), /Waiting for approval/)
    assert.match(text(root), /Differences 2/)
    assert.deepEqual(panel.findAll(node => node.getAttribute('data-approval-line') !== null).map(node => node.getAttribute('data-approval-line')), ['1', '2'], 'the matching product is not a line')
  }],
  ['each line shows counted, the system figure at count time, the figure now and what Set will leave: count 12 with 2 damaged sets 10, and a sale since the count is kept', async () => {
    const panel = await mount()
    const serum = text(lineOf(panel, 1))
    assert.match(serum, /Serum A/); assert.match(serum, /Counted 12/); assert.match(serum, /System 7/); assert.match(serum, /Now 7/); assert.match(serum, /Set to 10/)
    const cream = text(lineOf(panel, 2))
    assert.match(cream, /Counted 3/); assert.match(cream, /System 5/); assert.match(cream, /Now 4/); assert.match(cream, /Set to 2/, 'saw 5, one sold (now 4), counted 3: 4 + 3 - 5 = 2, not 3')
    const target = (id: number) => panel.find(node => node.getAttribute('data-approval-target') === String(id), `target ${id}`)
    assert.equal(text(target(1)), 'Set to 10')
  }],
  ['System is the baseline the approval holds, the figure the count is measured against, not a figure read from the stock now', async () => {
    const panel = await mount({ approval: { ...pending, baselines: { '2': 6 } } })
    const baseline = panel.find(node => node.getAttribute('data-approval-baseline') === '2', 'baseline of 2')
    assert.equal(text(baseline), 'System 6', 'the recorded baseline wins over the item figure (5)')
    assert.match(text(lineOf(panel, 2)), /Set to 1/, 'and the result is measured from it: 4 + 3 - 6')
    assert.match(text(lineOf(panel, 1)), /System 7/, 'a line without a recorded baseline shows the item figure')
  }],
  ['G4/S6: a product counted per received date is one line listing its dates (saw -> counted); two wrong dates whose sums agree still need a decision; no product-level result is invented', async () => {
    const dated = item(4, 'Dated D', 9, 9, { lot_lines: [{ batch_id: 7, scope: 'lot', counted: 6, seen: 5, received_at: '2026-10-01' }, { batch_id: 9, scope: 'lot', counted: 3, seen: 4, received_at: '2026-10-09' }] })
    const panel = await mount({ items: [...items, dated] })
    assert.deepEqual(panel.findAll(node => node.getAttribute('data-approval-line') !== null).map(node => node.getAttribute('data-approval-line')), ['1', '2', '4'], 'counted 9 of 9 by the sums, yet the dates differ: it is a line')
    const lines = panel.findAll(node => node.getAttribute('data-approval-lot-lines') === '4')
    assert.equal(lines.length, 1)
    assert.match(text(lines[0]), /Received.*: 5 → 6/); assert.match(text(lines[0]), /Received.*: 4 → 3/)
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-target') === '4').length, 0, 'the date-by-date result is the writer facts, not a guess on this page')
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-target') === '2').length, 1, 'the control: an undated line still shows its result')
  }],
  ['Approve and Reject appear only for someone who may decide, only while pending, and fire their own handlers', async () => {
    const panel = await mount()
    assert.ok(action(panel, 'approve') && action(panel, 'reject'))
    assert.equal(text(action(panel, 'approve')), 'Approve', 'one word on the main button'); assert.equal(action(panel, 'approve').getAttribute('aria-label'), 'Approve all', 'and the whole name for the tooltip and the screen reader'); assert.equal(action(panel, 'approve').getAttribute('title'), 'Approve all')
    assert.equal(action(panel, 'reject').getAttribute('aria-label'), 'Reject', 'the secondary action is icon-only with its name')
    calls.length = 0
    await panel.click(action(panel, 'approve')); await panel.click(action(panel, 'reject'))
    assert.deepEqual(calls, ['approve', 'reject'])
    await panel.render({ ...base, canDecide: false })
    assert.equal(action(panel, 'approve'), undefined, 'no right, no buttons'); assert.equal(action(panel, 'reject'), undefined)
    await panel.render({ ...base, approval: { ...pending, status: 'approved', decided_at: '2026-11-02T03:00:00Z', decided_by_name: 'boss' } })
    assert.equal(action(panel, 'approve'), undefined, 'a decided count has no buttons')
    await panel.render({ ...base, busy: true })
    assert.equal(action(panel, 'approve').getAttribute('disabled') !== null || (action(panel, 'approve') as unknown as { disabled?: boolean }).disabled === true, true, 'a request in flight disables both')
    assert.equal((action(panel, 'reject') as unknown as { disabled?: boolean }).disabled === true || action(panel, 'reject').getAttribute('disabled') !== null, true)
  }],
  ['the result follows what the counter saw when the server recorded it, never goes below zero, and is left out when a figure is missing', async () => {
    const seen = await mount({ approval: { ...pending, baselines: { 1: 9, 2: 5 } } })
    assert.equal(text(seen.find(node => node.getAttribute('data-approval-target') === '1', 'target 1')), 'Set to 8', 'counted 12 over the 9 seen, ordinary now 5: 5 + 12 - 9')
    await seen.render({ ...base, items: [item(2, 'Cream B', 0, 5, { current_quantity: 3 })], approval: { ...pending, baselines: { 2: 5 } } })
    assert.equal(text(seen.find(node => node.getAttribute('data-approval-target') === '2', 'floored')), 'Set to 0', 'max(0, 3 + 0 - 5)')
    assert.match(text(lineOf(seen, 2)), /Stock ran out, short by 2/, 'the shortage the stock could not take is stated on the line: wanted 3 + 0 - 5 = -2')
    await seen.render({ ...base, items: [item(2, 'Cream B', 3, 5, { current_quantity: undefined })] })
    assert.equal(seen.findAll(node => node.getAttribute('data-approval-target') !== null).length, 0, 'no stock now: no invented figure')
    assert.ok(lineOf(seen, 2), 'the line itself is still listed')
  }],
  ['a claimed approval has no Reject; the approver who started it can finish it, another approver sees who has it and may take it over or close it', async () => {
    const mine = await mount({ approval: { ...pending, applying: true, applying_request_id: 'inventory_check_approval_claimed' }, onClose: () => { calls.push('close') } })
    assert.ok(action(mine, 'approve'), 'finishing it stays possible'); assert.equal(action(mine, 'reject'), undefined, 'stock may already have moved: it cannot be rejected')
    assert.ok(action(mine, 'close'), 'and it can be closed'); assert.equal(action(mine, 'close').getAttribute('aria-label'), 'Close', 'the secondary action is icon-only with its name')
    calls.length = 0; await mine.click(action(mine, 'close')); assert.deepEqual(calls, ['close'])
    await mine.render({ ...base, onClose: () => { calls.push('close') }, approval: { ...pending, applying: true } })
    assert.ok(action(mine, 'approve'), 'another approver may try: the server takes the approval over when its approver is gone and says so when not'); assert.equal(action(mine, 'reject'), undefined); assert.ok(action(mine, 'close'))
    assert.match(text(mine.find(node => node.getAttribute('data-approval-in-progress') !== null, 'who has it')), /Being applied by another approver/)
    // Closing moves no stock, so the right to approve is enough; it is offered only once Reject is gone (something was applied or claimed).
    await mine.render({ ...base, canDecide: false, canClose: true, onClose: () => { calls.push('close') }, approval: { ...pending, applying: true } })
    assert.equal(action(mine, 'approve'), undefined); assert.ok(action(mine, 'close'), 'without the right to adjust stock a person can still close')
    await mine.render({ ...base, canDecide: false, canClose: false, onClose: () => { calls.push('close') }, approval: { ...pending, applying: true } })
    assert.equal(action(mine, 'close'), undefined, 'and not without the right to approve')
    await mine.render({ ...base, onClose: () => { calls.push('close') }, approval: { ...pending, applied: 1 } })
    assert.ok(action(mine, 'close'), 'a partly applied count is closable'); await mine.render({ ...base, onClose: () => { calls.push('close') }, approval: pending })
    assert.equal(action(mine, 'close'), undefined, 'an untouched count is rejected, not closed')
    await mine.render({ ...base, approval: pending })
    assert.equal(mine.findAll(node => node.getAttribute('data-approval-in-progress') !== null).length, 0, 'an unclaimed approval carries no note')
  }],
  ['a partly applied approval shows its progress and what each applied line wrote', async () => {
    const partly: InventoryCheckApproval = { ...pending, applied: 1, applied_lines: { 1: { before: 5, target: 10, after: 10, at: '2026-11-02T02:00:00Z' } } }
    const panel = await mount({ approval: partly })
    assert.equal(text(panel.find(node => node.getAttribute('data-approval-progress') !== null, 'progress')), '1/2')
    assert.equal(text(panel.find(node => node.getAttribute('data-approval-target') === '1', 'applied target')), 'Set to 10')
    assert.ok(action(panel, 'approve'), 'the rest can still be approved')
  }],
  ['a closed count says what was not applied and why; a refusal shows its reason on the line it belongs to', async () => {
    const closed: InventoryCheckApproval = { ...pending, status: 'approved', applied: 1, decided_at: '2026-11-02T03:00:00Z', decided_by_name: 'boss', applied_lines: { 2: { before: 4, target: 2, after: 2, at: 'x' } },
      closed: { lines: { 1: 'inventory_check_count_below_damaged' } } }
    const panel = await mount({ approval: closed })
    assert.equal(panel.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'closed'); assert.match(text(panel.find(node => node.getAttribute('data-inventory-check-approval') !== null, 'panel')), /Closed/)
    assert.match(text(panel.find(node => node.getAttribute('data-approval-not-applied') === '1', 'not applied 1')), /Not applied: Count below damaged units/)
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-not-applied') === '2').length, 0, 'an applied line carries no such note')
    assert.equal(action(panel, 'approve'), undefined); assert.equal(action(panel, 'close'), undefined)
    await panel.render({ ...base, approval: { ...closed, closed: { lines: { 1: 'inventory_check_not_applied' } } } })
    assert.match(text(panel.find(node => node.getAttribute('data-approval-not-applied') === '1', 'plain')), /Not applied: Not applied/, 'a line nobody applied says only that')
    await panel.render({ ...base, approval: { ...pending, applying: true, applied: 1, applied_lines: { 2: { before: 4, target: 2, after: 2, at: 'x' } } }, refused: { 1: 'inventory_check_product_retired' }, onClose: () => {} })
    assert.match(text(panel.find(node => node.getAttribute('data-approval-refused') === '1', 'refused 1')), /Cannot apply: Product merged or removed/)
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-refused') === '2').length, 0)
    await panel.render({ ...base, approval: { ...pending, status: 'rejected' }, refused: { 1: 'inventory_check_product_retired' } })
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-refused') !== null).length, 0, 'a decided count shows no refusals')
  }],
  ['a line a newer count of the same product replaced says so, shows no result, and is not part of what is left to apply', async () => {
    const replaced: InventoryCheckApproval = { ...pending, applied: 1, applied_lines: { 2: { before: 4, target: 2, after: 2, at: 'x' } }, superseded: { 1: 'newer-session' } }
    const panel = await mount({ approval: replaced })
    assert.match(text(panel.find(node => node.getAttribute('data-approval-superseded') === '1', 'replaced line')), /Replaced by a newer count/)
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-target') === '1').length, 0, 'a replaced line is never set to anything')
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-superseded') === '2').length, 0, 'the other line is untouched')
    assert.equal(text(panel.find(node => node.getAttribute('data-approval-progress') !== null, 'progress')), '1/1', 'progress counts only the lines that can still be applied')
    await panel.render({ ...base, approval: { ...pending, status: 'rejected', decided_at: '2026-11-02T03:00:00Z', superseded: { 1: 'newer-session', 2: 'newer-session' } } })
    assert.equal(panel.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'rejected')
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-superseded') !== null).length, 2, 'an approval every line of which was replaced says so line by line')
  }],
  ['a count the system rejected because a newer count replaced all of it says Replaced with its note, never Rejected and never a person: also when it ended as a close', async () => {
    const replaced: InventoryCheckApproval = { ...pending, status: 'rejected', replaced: true, decided_at: '2026-11-02T03:00:00Z', decision_note: 'Replaced by a newer count', superseded: { 1: 'newer-session', 2: 'newer-session' } }
    const panel = await mount({ approval: replaced })
    assert.equal(panel.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'replaced')
    const shown = text(panel.find(node => node.getAttribute('data-inventory-check-approval') !== null, 'panel'))
    assert.match(shown, /Replaced/); assert.doesNotMatch(shown, /Rejected/); assert.doesNotMatch(shown, /@/, 'no counter is named as the decider')
    assert.match(text(panel.find(node => node.getAttribute('data-approval-replaced-note') !== null, 'note')), /Replaced by a newer count/)
    assert.equal(action(panel, 'approve'), undefined); assert.equal(action(panel, 'reject'), undefined); assert.equal(action(panel, 'close'), undefined)
    await panel.render({ ...base, approval: { ...replaced, closed: { lines: {} } } })
    assert.equal(panel.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'replaced', 'a claimed approval that ended replaced carries closed_json, and still reads Replaced')
    await panel.render({ ...base, approval: { ...pending, status: 'rejected', decided_at: '2026-11-02T03:00:00Z', decided_by_name: 'boss', decision_note: 'Recount' } })
    assert.equal(panel.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'rejected', 'a rejection by a person is unchanged')
    assert.match(text(panel.find(node => node.getAttribute('data-approval-decided') !== null, 'who')), /@boss/)
  }],
  ['approved and rejected counts say so, who decided and when, and keep their lines', async () => {
    const approved = await mount({ approval: { ...pending, status: 'approved', applied: 2, decided_at: '2026-11-02T03:00:00Z', decided_by_name: 'boss',
      applied_lines: { 1: { before: 5, target: 10, after: 10, at: 'x' }, 2: { before: 1, target: 0, after: 0, at: 'x', clamped: true, wanted: -4 } } } })
    assert.equal(approved.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'approved')
    assert.match(text(approved.find(node => node.getAttribute('data-approval-decided') !== null, 'who and when')), /@boss/)
    assert.match(text(lineOf(approved, 1)), /Set to 10/)
    assert.doesNotMatch(text(lineOf(approved, 1)), /short by/, 'a line the stock took fully carries no note')
    assert.match(text(lineOf(approved, 2)), /Stock ran out, short by 4/, 'a decided line says what the stock could not take'); assert.match(text(lineOf(approved, 2)), /Set to 0/)
    assert.equal(approved.findAll(node => node.getAttribute('data-approval-progress') !== null).length, 0, 'progress is for a count still being applied')
    await approved.render({ ...base, approval: { ...pending, status: 'rejected', decided_at: '2026-11-02T03:00:00Z', decided_by_name: 'boss' } })
    assert.equal(approved.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'rejected')
  }],
  ['the panel never invents a figure it was not given: no system figure, no line', async () => {
    const blind = await mount({ items: [{ ...item(1, 'Serum A', 12, 7), baseline_quantity: undefined, current_quantity: undefined }] })
    assert.equal(blind.findAll(node => node.getAttribute('data-approval-line') !== null).length, 0)
  }],
  // ---- slice C2: per-line accept / modify / reject / reopen ----
  ['the lines are the approval stored set (line_ids), not what the figures say: a product whose dates differ though its total agrees IS a line, and a product outside the set is not', async () => {
    const dated = item(4, 'Dated D', 9, 9, { lot_lines: [{ batch_id: 7, scope: 'lot', counted: 6, seen: 5, received_at: '2026-10-01' }, { batch_id: 9, scope: 'lot', counted: 3, seen: 4, received_at: '2026-10-09' }] })
    const panel = await mount({ items: [...items, dated], approval: { ...pending, lines: 2, line_ids: [3, 4] } })
    assert.deepEqual(panel.findAll(node => node.getAttribute('data-approval-line') !== null).map(node => node.getAttribute('data-approval-line')), ['3', '4'], 'the stored set, in its order; products 1 and 2 differ but are not in it')
    await panel.render({ ...base, items: [...items, dated], approval: { ...pending, line_ids: [] } })
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-line') !== null).length, 0, 'an empty stored set is not re-derived from the figures')
  }],
  ['every open line has accept, modify and reject (icon-only, translated tooltip); each fires its own handler with the product id; none while busy', async () => {
    const got: string[] = []
    const handlers = { onAccept: (id: number) => { got.push(`accept ${id}`) }, onRejectLine: (id: number) => { got.push(`reject ${id}`) }, onReopen: (id: number) => { got.push(`reopen ${id}`) }, onModify: async () => true }
    const panel = await mount({ ...handlers, canClose: true })
    const lineAction = (id: number, name: string) => panel.findAll(node => node.getAttribute('data-approval-line-action') === name && lineOf(panel, id).contains(node))[0]
    for (const name of ['accept', 'modify', 'reject']) {
      const button = lineAction(2, name)
      assert.ok(button, `${name} is offered`); assert.equal(button.getAttribute('aria-label'), button.getAttribute('title')); assert.ok(button.getAttribute('aria-label'), 'a tooltip'); assert.equal(text(button), '', 'icon-only')
    }
    await panel.click(lineAction(2, 'accept')); await panel.click(lineAction(1, 'reject'))
    assert.deepEqual(got, ['accept 2', 'reject 1'])
    await panel.render({ ...base, ...handlers, canClose: true, busy: true })
    for (const name of ['accept', 'modify', 'reject']) assert.equal(disabled(lineAction(2, name)), true, `${name} is disabled while a request runs`)
  }],
  ['per-line buttons follow the rights: accept and modify need canDecide (the extra, the approveCounts capability, online), reject and reopen need canClose; none with no right, none on a decided count, none without a handler', async () => {
    const handlers = { onAccept: () => {}, onRejectLine: () => {}, onReopen: () => {}, onModify: async () => true }
    const names = (panel: MountedSurface, id: number) => panel.findAll(node => node.getAttribute('data-approval-line-action') !== null && lineOf(panel, id).contains(node)).map(node => node.getAttribute('data-approval-line-action'))
    const both = await mount({ ...handlers, canDecide: true, canClose: true }); assert.deepEqual(names(both, 1), ['accept', 'modify', 'reject'])
    await both.render({ ...base, ...handlers, canDecide: false, canClose: true }); assert.deepEqual(names(both, 1), ['reject'], 'offline or without the capability: only what moves no stock')
    await both.render({ ...base, ...handlers, canDecide: false, canClose: false }); assert.deepEqual(names(both, 1), [], 'no right, no buttons')
    await both.render({ ...base, ...handlers, canDecide: true, canClose: true, approval: { ...pending, status: 'approved', decided_at: '2026-11-02T03:00:00Z' } }); assert.deepEqual(names(both, 1), [], 'a decided count has none')
    await both.render({ ...base, canDecide: true, canClose: true }); assert.deepEqual(names(both, 1), [], 'the page that gives no handler offers no button')
  }],
  ['a Worker that sends no planned_lines cannot say which lines the claim holds, so every undecided line of a claimed approval shows as applying or waiting (the Worker-faithful claim states are in inventoryCheckApprovalWorkerStates.test.ts)', async () => {
    const handlers = { onAccept: () => {}, onRejectLine: () => {}, onReopen: () => {}, onModify: async () => true }
    const names = (panel: MountedSurface, id: number) => panel.findAll(node => node.getAttribute('data-approval-line-action') !== null && lineOf(panel, id).contains(node)).map(node => node.getAttribute('data-approval-line-action'))
    const states = (panel: MountedSurface) => panel.findAll(node => node.getAttribute('data-approval-line-state') !== null).map(node => node.getAttribute('data-approval-line-state'))
    const applied = { ...pending, applied: 1, applied_lines: { 1: { before: 5, target: 10, after: 10, at: 'x' } }, superseded: { 2: 'newer' } }
    const panel = await mount({ ...handlers, canClose: true, approval: applied })
    assert.deepEqual(states(panel), ['applied', 'superseded']); assert.deepEqual([names(panel, 1), names(panel, 2)], [[], []])
    assert.match(text(lineOf(panel, 1)), /Applied/)
    await panel.render({ ...base, ...handlers, canClose: true, approval: { ...pending, applying: true, applying_request_id: 'inventory_check_approval_mine' } })
    assert.deepEqual(states(panel), ['applying', 'applying']); assert.deepEqual(names(panel, 1), ['accept'], 'the approver who holds the claim can finish a line it is applying: Accept again, nothing else'); assert.match(text(lineOf(panel, 1)), /Being applied/)
    await panel.render({ ...base, ...handlers, canClose: true, approval: { ...pending, applying: true } })
    assert.deepEqual(states(panel), ['waiting', 'waiting']); assert.deepEqual(names(panel, 2), []); assert.match(text(lineOf(panel, 2)), /Waiting for the approver/)
    await panel.render({ ...base, ...handlers, canClose: true, approval: pending })
    assert.deepEqual(states(panel), ['open', 'open']); assert.deepEqual(names(panel, 2), ['accept', 'modify', 'reject'])
  }],
  ['a rejected line shows a chip with who and when and no result, and reopen while the count is pending; a modified line shows the approver figure, its own Set to and what the counter typed', async () => {
    const got: number[] = []
    const decided = { ...pending, line_decisions: {
      1: { decision: 'reject' as const, at: '2026-11-02T02:00:00Z', by_name: 'boss' },
      2: { decision: 'modify' as const, counted: 4, at: '2026-11-02T02:30:00Z', by_name: 'boss' } } }
    const panel = await mount({ approval: decided, canClose: true, onReopen: (id: number) => { got.push(id) } })
    const chip = (id: number) => panel.find(node => node.getAttribute('data-approval-decision') === String(id), `chip ${id}`)
    assert.equal(chip(1).getAttribute('data-decision'), 'reject'); assert.match(text(chip(1)), /Rejected/); assert.match(text(chip(1)), /@boss/); assert.match(text(chip(1)), /2026/, 'and when')
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-target') === '1').length, 0, 'a rejected line is never set to anything')
    assert.equal(chip(2).getAttribute('data-decision'), 'modify'); assert.match(text(chip(2)), /Modified to 4/)
    assert.match(text(lineOf(panel, 2)), /Counted 3/, 'what the counter typed stays on the line'); assert.equal(text(panel.find(node => node.getAttribute('data-approval-target') === '2', 'target')), 'Set to 3', 'now 4 + modified 4 - seen 5')
    const reopens = panel.findAll(node => node.getAttribute('data-approval-line-action') === 'reopen'); assert.equal(reopens.length, 2)
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'accept').length, 0, 'no accept handler, no accept; a rejected line offers reopen only (the modified line offers more, see the Worker-state cases)')
    await panel.click(reopens[1]); assert.deepEqual(got, [2])
    await panel.render({ ...base, approval: { ...decided, status: 'approved', decided_at: '2026-11-02T03:00:00Z' }, canClose: true, onReopen: () => {} })
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'reopen').length, 0, 'no reopen once the approval ended'); assert.ok(chip(1), 'the chip stays as the record')
    await panel.render({ ...base, approval: { ...decided, line_decisions: { 1: { decision: 'reject', at: '2026-11-02T02:00:00Z' } } }, canClose: true, onReopen: () => {} })
    assert.doesNotMatch(text(chip(1)), /@/, 'a viewer who may not see staff names gets no name')
  }],
  ['modify: the box opens at the counter figure, Set to follows what is typed, a figure the Worker would refuse says why and cannot be saved, and a good figure saves with its product id', async () => {
    const saved: Array<[number, unknown]> = []
    const panel = await mount({ onModify: async (id: number, figures: unknown) => { saved.push([id, figures]); return true } })
    await panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'modify' && lineOf(panel, 2).contains(node))[0])
    const box = panel.find(node => node.getAttribute('data-approval-figure') === '2', 'figure box'); const confirm = () => panel.findAll(node => node.getAttribute('data-approval-line-action') === 'confirm')[0]
    const preview = () => text(panel.find(node => node.getAttribute('data-approval-preview') === '2', 'preview'))
    assert.equal((box as unknown as { value: string }).value, '3', 'starts at what the counter typed')
    await panel.type(box, '9'); assert.equal(preview(), 'Set to 8', 'now 4 + 9 - seen 5')
    await panel.type(box, '10'); assert.equal(preview(), 'Set to 9')
    for (const [typed, sentence] of [['-1', 'Enter a whole number'], ['2.5', 'Enter a whole number'], ['abc', 'Enter a whole number'], ['1000000001', 'Enter a whole number'], ['5', 'equals what the counter saw']] as const) {
      await panel.type(box, typed)
      assert.match(text(panel.find(node => node.getAttribute('data-approval-problem') === '2', `problem for ${typed}`)), new RegExp(sentence), typed)
      assert.equal(panel.findAll(node => node.getAttribute('data-approval-preview') === '2').length, 0, `${typed}: no preview for a figure that cannot be saved`)
      assert.equal(disabled(confirm()), true, `${typed}: cannot be confirmed`)
    }
    await panel.type(box, ''); assert.equal(disabled(confirm()), true, 'an empty box cannot be confirmed'); assert.equal(panel.findAll(node => node.getAttribute('data-approval-problem') === '2').length, 0, 'and says nothing yet')
    await panel.type(box, '0'); assert.equal(preview(), 'Set to 0', 'zero is a figure: max(0, 4 + 0 - 5)')
    await panel.click(confirm())
    assert.deepEqual(saved, [[2, { counted: 0 }]]); assert.equal(panel.findAll(node => node.getAttribute('data-approval-figure') === '2').length, 0, 'saved: the editor closes')
  }],
  ['modify cancel and refusal: cancel closes without saving; a save the page refuses keeps the editor open with the figure typed; the refusal is on the line', async () => {
    const saved: unknown[] = []
    const panel = await mount({ onModify: async (_id: number, figures: unknown) => { saved.push(figures); return false } })
    const open = () => panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'modify' && lineOf(panel, 1).contains(node))[0])
    await open(); await panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'cancel')[0])
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-figure') === '1').length, 0); assert.equal(saved.length, 0)
    await open(); await panel.type(panel.find(node => node.getAttribute('data-approval-figure') === '1', 'box'), '8'); await panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'confirm')[0])
    assert.deepEqual(saved, [{ counted: 8 }]); assert.equal((panel.find(node => node.getAttribute('data-approval-figure') === '1', 'box still open') as unknown as { value: string }).value, '8', 'a refused save keeps the figure')
    await panel.render({ ...base, onModify: async () => true, lineErrors: { 1: 'This count changed while you were working.' } })
    assert.match(text(panel.find(node => node.getAttribute('data-approval-line-error') === '1', 'line error')), /changed while you were working/, 'the refusal is on the line')
  }],
  ['a line counted by received date edits only its counted dates: one box per date, and the figures go out as lots; the chip shows the total and each date the approver figure beside the counter one', async () => {
    const dated = item(4, 'Dated D', 9, 9, { lot_lines: [{ batch_id: 7, scope: 'lot', counted: 6, seen: 5, received_at: '2026-10-01' }, { batch_id: 9, scope: 'lot', counted: 3, seen: 4, received_at: '2026-10-09' }] })
    const saved: unknown[] = []
    const panel = await mount({ items: [dated], approval: { ...pending, lines: 1, line_ids: [4] }, onModify: async (_id: number, figures: unknown) => { saved.push(figures); return true } })
    await panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'modify')[0])
    const boxes = panel.findAll(node => (node.getAttribute('data-approval-figure') ?? '').startsWith('4:')); assert.deepEqual(boxes.map(node => node.getAttribute('data-approval-figure')), ['4:7', '4:9'])
    assert.deepEqual(boxes.map(node => (node as unknown as { value: string }).value), ['6', '3'])
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-preview') === '4').length, 0, 'no product-level result is invented for a dated line')
    await panel.type(boxes[0], '5'); await panel.type(boxes[1], '4')
    assert.match(text(panel.find(node => node.getAttribute('data-approval-problem') === '4', 'matches seen')), /equals what the counter saw/, 'both dates at what the counter saw: nothing to apply')
    await panel.type(boxes[1], '2'); await panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'confirm')[0])
    assert.deepEqual(saved, [{ lots: [{ batchId: 7, counted: 5 }, { batchId: 9, counted: 2 }] }])
    await panel.render({ ...base, items: [dated], approval: { ...pending, lines: 1, line_ids: [4], line_decisions: { 4: { decision: 'modify', lots: [{ batchId: 7, counted: 5 }, { batchId: 9, counted: 2 }], at: '2026-11-02T02:00:00Z', by_name: 'boss' } } }, canClose: true, onReopen: () => {} })
    assert.match(text(panel.find(node => node.getAttribute('data-approval-decision') === '4', 'chip')), /Modified to 7/, 'the chip shows the total of the dates')
    assert.match(text(panel.find(node => node.getAttribute('data-approval-lot-lines') === '4', 'dates')), /5 → 5 \(6\)/, 'a date shows the approver figure and what the counter typed')
  }],
  ['the header: Approve keeps its icon and one word (Approve all is its tooltip), and reject-all and close stay icon-only with their names', async () => {
    const panel = await mount({ approval: { ...pending, applied: 1, applying: true, applying_request_id: 'inventory_check_approval_mine' }, onClose: () => {} })
    assert.equal(text(action(panel, 'approve')), 'Approve'); assert.ok(action(panel, 'approve').querySelector('svg'), 'with its icon')
    assert.equal(action(panel, 'reject'), undefined, 'a count being applied has no Reject')
    assert.equal(text(action(panel, 'close')), '', 'close is icon-only'); assert.ok(action(panel, 'close').getAttribute('aria-label'))
    await panel.render({ ...base, approval: pending })
    assert.equal(text(action(panel, 'reject')), '', 'reject is icon-only'); assert.ok(action(panel, 'reject').getAttribute('aria-label'))
  }],
  ['the header icons stay together on one row at 390 px, in English and Khmer: the actions are one non-wrapping group that does not shrink, and the facts wrap inside their own group (round-2 review, finding 7)', async () => {
    const claimed = { ...pending, applied: 1, applying: true, applying_request_id: 'inventory_check_approval_mine' }
    for (const approval of [claimed, pending]) {
      const panel = await mount({ approval, onClose: () => {} })
      const group = panel.find(node => node.getAttribute('data-approval-header-actions') !== null, 'the header actions')
      const classes = String(group.getAttribute('class')).split(/\s+/)
      assert.ok(classes.includes('inline-flex') && classes.includes('shrink-0') && !classes.includes('flex-wrap'), 'a group that neither wraps nor shrinks: ' + classes.join(' '))
      const names = panel.findAll(node => node.getAttribute('data-approval-action') !== null).map(node => node.getAttribute('data-approval-action'))
      assert.deepEqual(panel.findAll(node => node.getAttribute('data-approval-action') !== null && group.contains(node)).map(node => node.getAttribute('data-approval-action')), names, 'every header action is inside the group: ' + JSON.stringify(names))
      assert.ok(names.length >= 2, 'at least two icons are in it')
      const facts = panel.find(node => node.getAttribute('data-approval-status') !== null || node.getAttribute('data-approval-progress') !== null, 'a fact').parentNode as unknown as MemoryNode
      assert.ok(String(facts.getAttribute('class')).split(/\s+/).includes('flex-wrap'), 'the facts wrap in their own group, so the title text wraps instead of pushing an icon to a new row')
      live.pop(); await panel.unmount()
    }
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').filter(Boolean).slice(0, 3).join(' | ')}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
void (null as unknown as InventoryCheckSession)
if (failures.length) throw new Error(`${failures.length} of ${cases.length} approval panel cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS mounted Inventory check approval panel: ${cases.length} cases (tag, lines with Set figure, buttons by right and state, progress, decided, no invented figure)`)
