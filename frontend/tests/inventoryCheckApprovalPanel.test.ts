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
    await seen.render({ ...base, items: [item(2, 'Cream B', 3, 5, { current_quantity: undefined })] })
    assert.equal(seen.findAll(node => node.getAttribute('data-approval-target') !== null).length, 0, 'no stock now: no invented figure')
    assert.ok(lineOf(seen, 2), 'the line itself is still listed')
  }],
  ['a claimed approval has no Reject; the approver who started it can finish it, anyone else sees who has it', async () => {
    const mine = await mount({ approval: { ...pending, applying: true, applying_request_id: 'inventory_check_approval_claimed' } })
    assert.ok(action(mine, 'approve'), 'finishing it stays possible'); assert.equal(action(mine, 'reject'), undefined, 'stock may already have moved: it cannot be rejected')
    await mine.render({ ...base, approval: { ...pending, applying: true } })
    assert.equal(action(mine, 'approve'), undefined, 'another approver cannot continue'); assert.equal(action(mine, 'reject'), undefined)
    assert.match(text(mine.find(node => node.getAttribute('data-approval-in-progress') !== null, 'who has it')), /Being applied by another approver/)
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
  ['approved and rejected counts say so, who decided and when, and keep their lines', async () => {
    const approved = await mount({ approval: { ...pending, status: 'approved', applied: 2, decided_at: '2026-11-02T03:00:00Z', decided_by_name: 'boss',
      applied_lines: { 1: { before: 5, target: 10, after: 10, at: 'x' }, 2: { before: 4, target: 3, after: 3, at: 'x' } } } })
    assert.equal(approved.find(node => node.getAttribute('data-approval-status') !== null, 'chip').getAttribute('data-approval-status'), 'approved')
    assert.match(text(approved.find(node => node.getAttribute('data-approval-decided') !== null, 'who and when')), /@boss/)
    assert.match(text(lineOf(approved, 1)), /Set to 10/)
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
