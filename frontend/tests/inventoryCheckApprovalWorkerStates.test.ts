import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { createApprovalActions, type ApprovalAttempt, type ApprovalDeps } from '../src/components/inventory/inventoryCheckApprovalController.ts'
import { lineStateOf, withAppliedStock } from '../src/components/inventory/inventoryCheckApprovalLines.ts'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'
import type { InventoryCheckApproval } from '../src/api/inventoryChecksTransport.ts'
import { workerState } from './inventoryApprovalStates.ts'

// The approval panel and its decisions over the Worker's OWN answers (tests/inventoryApprovalStates.ts: recorded by the Worker's test from the real routes, and proved equal to the live code there).
// The first round of this panel was tested over hand-written approvals that carried no claim after an accepted line, so a panel that showed every other line as "Being applied" passed everything.
// Each case below names the finding of the C2 review it holds; the Worker's rules these states show are held by cloudflare/scripts/test-inventory-check-line-decisions-native.cjs.

const harness = await createHarness({})
const live: MountedSurface[] = []
const handlers = { onApprove: () => {}, onReject: () => {}, onClose: () => {}, onAccept: () => {}, onRejectLine: () => {}, onReopen: () => {}, onModify: async () => true }
const mount = async (props: Record<string, unknown>) => {
  const surface = await harness.mount({ component: 'components/inventory/InventoryCheckApprovalPanel.tsx', props: { canDecide: true, canClose: true, busy: false, t: (key: string) => key, ...handlers, ...props }, app: {}, doubles: {} })
  live.push(surface); return surface
}
const lineOf = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-approval-line') === String(id), `line ${id}`)
const stateOf = (surface: MountedSurface, id: number) => lineOf(surface, id).getAttribute('data-approval-line-state')
const names = (surface: MountedSurface, id: number) => surface.findAll(node => node.getAttribute('data-approval-line-action') !== null && lineOf(surface, id).contains(node)).map(node => node.getAttribute('data-approval-line-action'))
const header = (surface: MountedSurface) => surface.findAll(node => node.getAttribute('data-approval-action') !== null).map(node => node.getAttribute('data-approval-action'))
const text = (node: MemoryNode | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

const cases: Array<[string, () => Promise<void>]> = [
  ['finding 2: after one accepted line the claim stays, and only the lines it planned are being applied: lines 2 and 3 are open and keep accept, modify and reject (mutants M8 and M8b)', async () => {
    const { items, approval } = workerState('accepted_one')
    assert.equal(approval.applying, true, 'the Worker keeps the claim after a partial accept'); assert.deepEqual(approval.planned_lines, [], 'and says nothing is planned')
    const panel = await mount({ items, approval })
    assert.deepEqual([1, 2, 3].map(id => stateOf(panel, id)), ['applied', 'open', 'open'])
    for (const id of [2, 3]) assert.deepEqual(names(panel, id), ['accept', 'modify', 'reject'], `line ${id} can still be decided`)
    assert.equal(panel.findAll(node => node.getAttribute('data-approval-line-note') === 'applying' || node.getAttribute('data-approval-line-note') === 'waiting').length, 0, 'no line says it is being applied')
    assert.deepEqual(header(panel), ['approve', 'close'], 'the claim holder finishes the rest or closes it; a claimed count has no whole-count Reject')
    assert.match(text(lineOf(panel, 1)), /Applied/)
    const legacy = { ...approval } as InventoryCheckApproval; delete legacy.planned_lines
    await panel.render({ items, approval: legacy, canDecide: true, canClose: true, busy: false, t: (key: string) => key, ...handlers })
    assert.deepEqual([2, 3].map(id => stateOf(panel, id)), ['applying', 'applying'], 'a Worker that sends no planned_lines cannot say which lines are planned, so none is offered')
  }],
  ['finding 2: a line the claim has planned is applying (this approver) or waiting (another); every other line keeps the actions the Worker allows, whoever holds the claim', async () => {
    const { items, approval } = workerState('claimed_by_other')
    assert.equal(approval.applying, true); assert.equal(approval.applying_request_id, undefined, 'another approver holds the key'); assert.deepEqual(approval.planned_lines, [3])
    const panel = await mount({ items, approval })
    assert.equal(stateOf(panel, 3), 'waiting', 'line 3 is planned (and was modified): in progress'); assert.deepEqual(names(panel, 3), [])
    assert.match(text(lineOf(panel, 3)), /Waiting for the approver/)
    assert.equal(stateOf(panel, 1), 'modified'); assert.deepEqual(names(panel, 1), ['accept', 'modify', 'reject', 'reopen'], 'a modified line is accepted, modified again, rejected or reopened directly')
    assert.equal(stateOf(panel, 2), 'rejected'); assert.deepEqual(names(panel, 2), ['reopen'], 'a rejected line is reopened first')
    // the same claim held by this approver
    const mine = { ...approval, applying_request_id: 'inventory_check_approval_mine' }
    await panel.render({ items, approval: mine, canDecide: true, canClose: true, busy: false, t: (key: string) => key, ...handlers })
    assert.equal(stateOf(panel, 3), 'applying')
    assert.equal(lineStateOf(items[2], mine), 'applying'); assert.equal(lineStateOf(items[0], { ...mine, planned_lines: [1] }), 'applying', 'a planned line that was modified is in progress, not modified')
  }],
  ['finding 7: a modified line offers accept, modify again, reject and reopen at once; a rejected line only reopen; whole-count Reject needs only the right to approve, as a line reject does', async () => {
    const { items, approval } = workerState('decided_dated')
    assert.equal(approval.applying, undefined)
    const panel = await mount({ items, approval })
    assert.deepEqual([stateOf(panel, 1), stateOf(panel, 2), stateOf(panel, 3)], ['modified', 'rejected', 'modified'])
    assert.deepEqual(names(panel, 1), ['accept', 'modify', 'reject', 'reopen']); assert.deepEqual(names(panel, 3), ['accept', 'modify', 'reject', 'reopen']); assert.deepEqual(names(panel, 2), ['reopen'])
    assert.deepEqual(header(panel), ['approve', 'reject'])
    await panel.render({ items, approval, canDecide: false, canClose: true, busy: false, t: (key: string) => key, ...handlers })
    assert.deepEqual(header(panel), ['reject'], 'without the right to adjust stock the whole count can still be rejected, as the Worker allows')
    assert.deepEqual(names(panel, 1), ['reject', 'reopen']); assert.deepEqual(names(panel, 2), ['reopen'])
    await panel.render({ items, approval, canDecide: false, canClose: false, busy: false, t: (key: string) => key, ...handlers })
    assert.deepEqual(header(panel), []); assert.deepEqual(names(panel, 1), [])
    // modifying a modified line opens the box at the approver figure, per date for a dated line
    await panel.render({ items, approval, canDecide: true, canClose: true, busy: false, t: (key: string) => key, ...handlers })
    await panel.click(panel.findAll(node => node.getAttribute('data-approval-line-action') === 'modify' && lineOf(panel, 1).contains(node))[0])
    const dated = items[0].lot_lines!.filter(line => line.scope === 'lot')
    const boxes = panel.findAll(node => (node.getAttribute('data-approval-figure') ?? '').startsWith('1:'))
    assert.equal(boxes.length, dated.length)
    const own = approval.line_decisions!['1'].lots!
    assert.deepEqual(boxes.map(node => (node as unknown as { value: string }).value), dated.map(line => String(own.find(entry => entry.batchId === line.batch_id)?.counted ?? line.counted)), 'the boxes hold the approver figures')
  }],
  ['finding 10: the line buttons are 44 px on a phone and 40 px on a desktop, like the Inventory rows beside them, with room between them', async () => {
    const { items, approval } = workerState('pending')
    const panel = await mount({ items, approval })
    const button = panel.findAll(node => node.getAttribute('data-approval-line-action') === 'accept')[0]
    const classes = String(button.getAttribute('class')).split(/\s+/)
    for (const name of ['h-11', 'w-11', 'min-h-11', 'lg:h-10', 'lg:w-10']) assert.ok(classes.includes(name), `${name} on a line button`)
    assert.ok(!classes.includes('h-9') && !classes.includes('lg:h-8'), 'not the 36 px and 32 px of the first round')
    const group = panel.findAll(node => node.getAttribute('data-approval-line-actions') === '1')[0]
    assert.ok(String(group.getAttribute('class')).split(/\s+/).includes('gap-2'), 'clear space between Accept and Modify')
  }],
]

// ---- the decisions over the same states ----
type Log = { approvals: Array<Record<string, unknown>>; confirms: Array<Parameters<ApprovalDeps['askToConfirm']>[0]>; applied: Array<Record<string, number>>; reloads: number }
function rig(stateName: 'pending' | 'decided_dated') {
  const state = workerState(stateName)
  const log: Log = { approvals: [], confirms: [], applied: [], reloads: 0 }
  const script: Array<unknown> = []
  const attempts = { approvalAttempt: { current: null as ApprovalAttempt | null }, lineAttempt: { current: null as ApprovalAttempt | null } }
  let counter = 0
  const actions = createApprovalActions({
    sessionId: 'session-1', approval: state.approval, items: state.items, capabilities: null, current: () => true, inFlight: { current: false }, setBusy: () => {}, setApproval: () => {}, setApplied: stock => { log.applied.push(stock) },
    setWriteError: () => {}, setRefused: () => {}, setLineError: () => {}, askToConfirm: async request => { log.confirms.push(request); return true }, tr: (_key, fallback) => fallback, notify: () => {},
    knownRefusal: async cause => { const code = (cause as { code?: string })?.code; return typeof code === 'string' && Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined },
    unknownSaveKey: () => 'inventory_check_save_unknown', reload: () => { log.reloads += 1 }, ...attempts, newRequestId: prefix => `${prefix}_${++counter}`,
    send: { approval: async input => { log.approvals.push(input); return script.shift() as never }, line: async () => { throw new Error('no line request expected') } },
  })
  return { state, log, script, actions }
}
const rows = (request: Parameters<ApprovalDeps['askToConfirm']>[0]) => (request.items ?? []).map(entry => [String(entry.label), String(entry.value)])
const datesOf = (item: { lot_lines?: Array<{ scope: string; seen?: number; counted: number }> }) => (item.lot_lines ?? []).map(line => line)

cases.push(
  ['finding 3: accepting line 1 puts the stock the Worker wrote on the session rows with no read (setApplied carries the figure after), and withAppliedStock keeps the damaged units', async () => {
    const r = rig('pending'); const accepted = workerState('accepted_one')
    assert.ok(accepted.answer, 'the recorded answer of the accept'); r.script.push({ approval: accepted.approval, ...accepted.answer })
    await r.actions.decideApproval('approve', [1])
    const after = accepted.approval.applied_lines!['1'].after
    assert.deepEqual(r.log.applied, [{ '1': after }]); assert.equal(r.log.reloads, 0, 'nothing is read again while the count stays pending')
    const patched = withAppliedStock(r.state.items, { '1': after })
    assert.equal(patched[0].current_quantity, after); assert.equal(patched[0].current_stock?.recorded_ordinary_quantity, after)
    assert.equal(patched[1], r.state.items[1], 'the other lines are the same objects')
    const withDamaged = withAppliedStock([{ ...r.state.items[0], current_stock: { ...r.state.items[0].current_stock, recorded_damaged_quantity: 2 } }], { '1': 7 })
    assert.equal(withDamaged[0].current_quantity, 9, 'ordinary 7 + damaged 2')
  }],
  ['finding 10: accepting a line shows the shared review first, per received date for a dated line, and only then sends productIds', async () => {
    const r = rig('pending'); const accepted = workerState('accepted_one'); r.script.push({ approval: accepted.approval, ...accepted.answer })
    await r.actions.decideApproval('approve', [1])
    assert.equal(r.log.confirms.length, 1); assert.equal(r.log.confirms[0].confirmLabel, 'Approve')
    const first = r.state.items[0], dates = datesOf(first).filter(line => line.scope === 'lot')
    assert.deepEqual(rows(r.log.confirms[0]).map(row => row[1]), datesOf(first).map(line => `${line.seen ?? '—'} → ${line.counted}`), 'what the counter saw and the figure applied, for each date')
    assert.ok(dates.length > 0 && rows(r.log.confirms[0]).every(row => row[0].startsWith(String((first.product_snapshot as { name: string }).name))), 'the rows carry the product name')
    assert.deepEqual(r.log.approvals[0].productIds, [1])
    const plain = rig('pending'); plain.script.push({ approval: accepted.approval, applied: 1, remaining: 2, done: true })
    await plain.actions.decideApproval('approve', [3])
    assert.deepEqual(rows(plain.log.confirms[0]), [[String((plain.state.items[2].product_snapshot as { name: string }).name), 'Now 5 → Set to 2']], 'a line counted as one figure reads Now → Set to')
  }],
  ['finding 4 (mutant M9): the Approve-all dialog quotes the approver figures of the Worker\'s modified lines, per date for the dated one, and leaves the rejected line out', async () => {
    const r = rig('decided_dated'); r.script.push({ approval: { ...r.state.approval, status: 'approved' }, applied: 2, remaining: 0, done: true })
    await r.actions.decideApproval('approve')
    const shown = rows(r.log.confirms[0]), first = r.state.items[0]
    assert.deepEqual(shown[0], ['Open lines', '2 → 0'], 'line 2 is rejected: not applied, so not an open line')
    const own = r.state.approval.line_decisions!['1'].lots!
    const dates = datesOf(first)
    assert.deepEqual(shown.slice(1, 1 + dates.length).map(row => row[1]), dates.map((line, index) => `${line.seen ?? '—'} → ${own.find(entry => entry.batchId === (first.lot_lines![index] as { batch_id: number }).batch_id)?.counted ?? line.counted}`), 'each date: seen → the approver figure (the counter figure where he did not list the date)')
    assert.notDeepEqual(shown.slice(1, 1 + dates.length).map(row => row[1]), dates.map(line => `${line.seen ?? '—'} → ${line.counted}`), 'and not what the counter typed')
    assert.deepEqual(shown.at(-1), [String((r.state.items[2].product_snapshot as { name: string }).name), 'Now 5 → Set to 4'], 'line 3 was modified to 4: 5 + 4 - 5, not the counter\'s 2')
    assert.ok(!shown.some(row => row[0].startsWith(String((r.state.items[1].product_snapshot as { name: string }).name))), 'the rejected line is not in the review')
  }],
  ['finding 13: the Reject and Close dialogs count the lines they end, not the rejected one (3 lines, 1 rejected: 2)', async () => {
    for (const decision of ['reject', 'close'] as const) {
      const r = rig('decided_dated'); r.script.push({ approval: { ...r.state.approval, status: 'rejected' }, applied: 0, remaining: 0, done: true })
      await r.actions.decideApproval(decision)
      assert.equal(r.log.confirms[0].items?.[0].value, 2, decision)
    }
  }],
)

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').filter(Boolean).slice(0, 3).join(' | ')}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} Worker-state cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS approval panel and decisions over the Worker's own states: ${cases.length} cases (claim after one accepted line, actions the Worker allows, stock after an accept, dialogs with modified figures)`)
