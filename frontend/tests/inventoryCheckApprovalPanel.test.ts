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
  ['Approve and Reject appear only for someone who may decide, only while pending, and fire their own handlers', async () => {
    const panel = await mount()
    assert.ok(action(panel, 'approve') && action(panel, 'reject'))
    assert.equal(text(action(panel, 'approve')), 'Approve'); assert.equal(action(panel, 'reject').getAttribute('aria-label'), 'Reject', 'the secondary action is icon-only with its name')
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
