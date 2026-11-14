import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { isDraftKind, ROW_STATUS_WORDS, rowStatusKind } from '../src/components/inventory/inventoryCheckStatus.ts'
import type { InventoryCheckLotRow, InventoryCheckLotsAnswer, InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// 14 Nov: the row's status ICON opens a compact count popover. Counting is per received date (batch) and primary when ic_lot_counts is on: the product's batches are read ONCE when the
// popover opens (never for the page), a count box on each, the row total is their sum; a product with no batch counts one total. Nothing is ticked by default. No cost anywhere.

// ---- the status icon decides from the recorded status, a pending approval and the unsubmitted draft -------------------------------------------------------------------------------
const kinds = (input: Parameters<typeof rowStatusKind>[0]) => rowStatusKind(input)
assert.equal(kinds({ recorded: 'not_checked' }), 'not_checked')
assert.equal(kinds({ recorded: 'in_check' }), 'in_check')
assert.equal(kinds({ recorded: 'ok' }), 'ok')
assert.equal(kinds({ recorded: 'issue' }), 'issue')
assert.equal(kinds({ recorded: 'issue', pending: true }), 'pending', 'a count waiting for an approver wears the pending icon')
assert.equal(kinds({ recorded: undefined }), null, 'no recorded status (a heading, no branch): no icon at all')
assert.equal(kinds({ recorded: 'garbage' }), null)
assert.equal(kinds({ recorded: 'ok', draft: undefined }), 'ok', 'no draft: nothing is ticked, the recorded status shows')
assert.equal(kinds({ recorded: 'ok', draft: { selected: false, count: '5' }, stock: 5 }), 'ok', 'an unpicked draft is not an answer')
assert.equal(kinds({ recorded: 'not_checked', draft: { selected: true, count: '5' }, stock: 5 }), 'draft_ok', 'typed = stock: matches')
assert.equal(kinds({ recorded: 'not_checked', draft: { selected: true, count: '4' }, stock: 5 }), 'draft_issue', 'typed ≠ stock: differs')
assert.equal(kinds({ recorded: 'not_checked', draft: { selected: true, count: '' }, stock: 5 }), 'draft_empty', '"does not match" answered, count still to enter')
assert.equal(kinds({ recorded: 'not_checked', draft: { selected: true, count: '4' }, stock: undefined }), 'draft_counted', 'a viewer without stock has nothing to compare: counted')
assert.equal(kinds({ recorded: 'issue', pending: true, draft: { selected: true, count: '5' }, stock: 5 }), 'draft_ok', 'a draft is the newest word')
assert.equal(kinds({ recorded: 'ok', draft: { selected: true, count: '', lots: { 7: { count: '3', seen: 3 }, 8: { count: '2', seen: 4 } } }, stock: 7 }), 'draft_issue', 'per batch: measured on the batches typed (3+2 against 3+4), not the branch total')
assert.equal(kinds({ recorded: 'ok', draft: { selected: true, count: '', lots: { 7: { count: '3', seen: 3 } } }, stock: 7 }), 'draft_ok', 'counting one of two batches, correctly, is not a shortage')
assert.equal(kinds({ recorded: 'ok', draft: { selected: true, count: '', lots: { 7: { count: 'x', seen: 3 } } }, stock: 3 }), 'draft_empty', 'an invalid figure is still to be entered')
assert.deepEqual(Object.keys(ROW_STATUS_WORDS).sort(), ['draft_counted', 'draft_empty', 'draft_issue', 'draft_ok', 'in_check', 'issue', 'not_checked', 'ok', 'pending'], 'every kind has words')
assert.ok(isDraftKind('draft_ok') && !isDraftKind('ok') && !isDraftKind('pending'))
// Both language packs name every kind and every popover word (no English in km.json).
const pack = (name: string) => JSON.parse(readFileSync(new URL(`../src/lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>
const en = pack('en'), km = pack('km')
const keys = [...Object.values(ROW_STATUS_WORDS).map(entry => entry.key), 'inventory_check_open_count', 'inventory_check_popover_total', 'inventory_check_popover_matches', 'inventory_check_popover_differs', 'inventory_check_popover_clear',
  'inventory_check_popover_loading', 'inventory_check_popover_failed', 'inventory_check_popover_more', 'inventory_check_lot_dates', 'inventory_check_counted_rows', 'inventory_check_mark_page_checked']
for (const key of keys) {
  assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en has ${key}`)
  assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km has ${key}`)
  assert.ok(km[key] !== en[key] || /^[\d{}\s]*$/.test(en[key]), `km ${key} is not the English text`)
  assert.equal(/\{name\}/.test(en[key]), /\{name\}/.test(km[key]), `${key}: the same placeholders in both`)
  assert.equal(/\{count\}/.test(en[key]), /\{count\}/.test(km[key]), `${key}: the same placeholders in both`)
}
for (const [key, fallback] of Object.values(ROW_STATUS_WORDS).map(entry => [entry.key, entry.fallback])) assert.equal(en[key], fallback, `the code's fallback is the English pack's text (${key})`)

// ---- the mounted row and its popover ----------------------------------------------------------------------------------------------------------------------------------------
const product: InventoryCheckProduct = { id: 701, name: 'Rose serum', quantity: 9, unit: 'pcs', check_status: 'not_checked' }
const other: InventoryCheckProduct = { id: 702, name: 'Plain soap', quantity: 4, check_status: 'ok', check_counted_quantity: 4, check_at: '2026-10-30T08:15:00.000Z', check_by: 'amy' }
const lotsOf = (id: number): InventoryCheckLotRow[] => id === 701
  ? [{ batchId: 91, receivedAt: '2026-09-02', expiry: '2027-03-01', quantity: 6, lotCode: 'LC-77', batchNumber: 3 }, { batchId: 92, receivedAt: '2026-10-11', expiry: null, quantity: 3 }]
  : []
type Call = [string, ...unknown[]]
const calls: Call[] = []
const loads: Array<{ productId: number | string; signalAborted: boolean }> = []
let failLoads = false
const loadLots = async (item: InventoryCheckProduct, signal: AbortSignal): Promise<InventoryCheckLotsAnswer> => {
  loads.push({ productId: item.id, signalAborted: signal.aborted })
  if (failLoads) throw new Error('offline')
  return { productId: Number(item.id), branchId: 1, lots: lotsOf(Number(item.id)) }
}
const base = {
  products: [product, other], drafts: {}, selecting: true, canViewStock: true, canViewCounts: true, lotCounts: true, loadLots, t: (key: string) => key,
  onOpenProduct: (item: InventoryCheckProduct) => { calls.push(['open', item.id]) },
  onCount: (item: InventoryCheckProduct, value: string) => { calls.push(['count', item.id, value]) },
  onNote: (item: InventoryCheckProduct, value: string) => { calls.push(['note', item.id, value]) },
  onLotCount: (item: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => { calls.push(['lot', item.id, row.batchId, value]) },
  onMatches: (item: InventoryCheckProduct, rows?: InventoryCheckLotRow[]) => { calls.push(['matches', item.id, rows?.map(row => row.batchId)]) },
  onDiffers: (item: InventoryCheckProduct) => { calls.push(['differs', item.id]) },
  onClear: (item: InventoryCheckProduct) => { calls.push(['clear', item.id]) },
}
const harness = await createHarness({})
const live: MountedSurface[] = []
const mount = async (props: Record<string, unknown> = {}) => { const mounted = await harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx', props: { ...base, ...props }, app: {}, doubles: {} }); live.push(mounted); return mounted }
const row = (s: MountedSurface, id: number) => s.find(node => node.getAttribute('data-inventory-check-row') === String(id), `row ${id}`)
const statusButton = (s: MountedSurface, id: number) => s.find(node => node.getAttribute('data-check-action') === 'status' && row(s, id).contains(node), `status button ${id}`)
const popover = (s: MountedSurface) => s.find(node => node.getAttribute('data-inventory-check-popover') !== null, 'popover')
const popoverOpen = (s: MountedSurface) => s.findAll(node => node.getAttribute('data-inventory-check-popover') !== null).length > 0
const inPopover = (s: MountedSurface, attribute: string) => s.findAll(node => node.getAttribute(attribute) !== null && popover(s).contains(node))
const action = (s: MountedSurface, name: string) => s.find(node => node.getAttribute('data-popover-action') === name && popover(s).contains(node), `popover action ${name}`)
const flat = (node: MemoryNode) => node.textContent.replace(/\s+/g, ' ').trim()
const isDisabled = (node: MemoryNode) => node.getAttribute('disabled') !== null || (node as unknown as { disabled?: boolean }).disabled === true
const open = async (s: MountedSurface, id = 701) => { await s.click(statusButton(s, id)); await s.settle?.() }

const cases: Array<[string, () => Promise<void>]> = [
  ['nothing is read for the page: with batch counting on, no batch request is made by drawing rows, and nothing is open or ticked', async () => {
    loads.length = 0
    const s = await mount()
    assert.equal(loads.length, 0, 'no batch is loaded for any row of the page')
    assert.equal(popoverOpen(s), false)
    assert.equal(s.findAll(node => node.getAttribute('data-selected') !== null).length, 0, 'nothing is ticked by default')
    assert.equal(statusButton(s, 701).getAttribute('data-check-status-kind'), 'not_checked', 'the grey dotted circle')
    assert.equal(statusButton(s, 702).getAttribute('data-check-status-kind'), 'ok', 'the green check')
  }],
  ['opening the status icon reads that one product’s batches in ONE request, and shows them from the first paint: received date, identity, stock now, a count box each', async () => {
    loads.length = 0
    const s = await mount()
    await open(s)
    assert.deepEqual(loads.map(load => load.productId), [701], 'one request, for the one product opened')
    assert.equal(popoverOpen(s), true)
    const lots = inPopover(s, 'data-popover-lot')
    assert.deepEqual(lots.map(node => node.getAttribute('data-popover-lot')), ['91', '92'], 'a line per batch')
    assert.ok(flat(lots[0]).includes('LC-77') && flat(lots[0]).includes('#3'), 'the identity printed on the batch (lot code, batch number)')
    assert.ok(flat(lots[0]).includes('02/09/2026'), 'the received date')
    assert.ok(flat(lots[0]).includes('6'), 'the stock of the batch now')
    assert.equal(inPopover(s, 'data-popover-lot-count').length, 2, 'a count box on each batch')
    assert.ok(!/cost|price/i.test(popover(s).textContent), 'no cost or price in it')
    await s.click(action(s, 'close'))
    assert.equal(popoverOpen(s), false, 'closed with its X')
    await open(s)
    assert.deepEqual(loads.map(load => load.productId), [701, 701], 'opening again reads again (fresh figures), one request each time')
  }],
  ['typing a batch count reaches the page per batch; the row total is the sum of the batches typed and the difference is measured on them', async () => {
    const s = await mount({ drafts: { 701: { selected: true, count: '8', checked: false, note: '', lots: { 91: { count: '5', seen: 6 }, 92: { count: '3', seen: 3 } } } } })
    await open(s)
    const box = (id: number) => inPopover(s, 'data-popover-lot-count').find(node => node.getAttribute('data-popover-lot-count') === String(id)) as MemoryNode
    assert.equal((box(91) as unknown as { value?: string }).value, '5'); assert.equal((box(92) as unknown as { value?: string }).value, '3')
    assert.equal(flat(inPopover(s, 'data-popover-sum')[0]), '8', 'the total is the sum of the batches')
    assert.equal(flat(inPopover(s, 'data-popover-delta')[0]), '−1', 'one short on one batch, against what that batch showed')
    await s.type(box(91), '6')
    assert.deepEqual(calls.at(-1), ['lot', 701, 91, '6'], 'the count goes to the page with the batch it belongs to')
    assert.equal(statusButton(s, 701).getAttribute('data-check-status-kind'), 'draft_issue', 'the row’s icon already shows the draft: differs')
  }],
  ['the row’s own count box shows the sum, is read-only while batches are counted, and touching it opens the same popover', async () => {
    loads.length = 0
    const s = await mount({ drafts: { 701: { selected: true, count: '8', checked: false, note: '', lots: { 91: { count: '5', seen: 6 }, 92: { count: '3', seen: 3 } } } } })
    const input = s.find(node => node.getAttribute('data-check-count') !== null && row(s, 701).contains(node), 'row count')
    assert.equal((input as unknown as { value?: string }).value, '8')
    assert.ok(input.getAttribute('readonly') !== null || (input as unknown as { readOnly?: boolean }).readOnly === true, 'the sum is read-only: batches are counted in the popover')
    // The harness's DOM has no native click(); the row calls click() on its own status button (a real browser dispatches the click the menu listens to), so the stub forwards it as that click.
    const trigger = statusButton(s, 701); let forwarded = 0
    ;(trigger as unknown as { click: () => void }).click = () => { forwarded++ }
    await s.click(input)
    assert.equal(forwarded, 1, 'touching the sum clicks the row’s status button')
    await s.click(trigger) // what the browser does with that click()
    assert.equal(popoverOpen(s), true, 'touching it opens the popover')
    assert.deepEqual(loads.map(load => load.productId), [701])
  }],
  ['a product with no batch counts one total: the popover shows a single Total box; the switch off (or a viewer without stock) reads no batch at all', async () => {
    loads.length = 0
    let s = await mount()
    await open(s, 702)
    assert.deepEqual(loads.map(load => load.productId), [702], 'the batch list was asked for, and it was empty')
    assert.equal(inPopover(s, 'data-popover-single').length, 1, 'a single total')
    assert.equal(inPopover(s, 'data-popover-lot').length, 0)
    await s.type(inPopover(s, 'data-popover-total')[0], '3')
    assert.deepEqual(calls.at(-1), ['count', 702, '3'])
    await s.unmount(); live.pop(); loads.length = 0
    s = await mount({ lotCounts: false })
    await open(s)
    assert.equal(loads.length, 0, 'ic_lot_counts off: no batch is ever read')
    assert.equal(inPopover(s, 'data-popover-single').length, 1, 'the popover still opens and counts one total, as the page always did')
    assert.equal(inPopover(s, 'data-popover-lot').length, 0)
    const direct = s.find(node => node.getAttribute('data-check-count') !== null && row(s, 701).contains(node), 'row count')
    assert.ok(!(direct.getAttribute('readonly') !== null || (direct as unknown as { readOnly?: boolean }).readOnly === true), 'with the switch off the row’s box is a plain input')
    await s.unmount(); live.pop(); loads.length = 0
    s = await mount({ canViewStock: false, canViewCounts: false })
    await open(s)
    assert.equal(loads.length, 0, 'a viewer who sees no stock reads no batches')
    assert.equal(s.findAll(node => node.getAttribute('data-popover-action') === 'matches' && popover(s).contains(node)).length, 0, 'and has no "matches stock"')
    assert.equal(s.findAll(node => node.getAttribute('data-popover-now') !== null).length, 0, 'nor a stock figure')
  }],
  ['the options: matches stock (tick), does not match (x) and clear; matches fills every batch it is showing, and clear needs something to clear', async () => {
    const s = await mount()
    await open(s)
    assert.equal(isDisabled(action(s, 'clear')), true, 'nothing to clear yet')
    await s.click(action(s, 'matches'))
    assert.deepEqual(calls.at(-1), ['matches', 701, [91, 92]], 'the tick fills each batch with its own stock')
    await s.click(action(s, 'differs'))
    assert.deepEqual(calls.at(-1), ['differs', 701])
    for (const name of ['matches', 'differs', 'clear', 'close']) {
      const button = action(s, name)
      assert.equal(button.textContent.trim(), '', `${name} is an icon`)
      assert.ok((button.getAttribute('aria-label') || '').length > 0 && button.getAttribute('title'), `${name} has a name and a tooltip`)
    }
    await s.render({ ...base, drafts: { 701: { selected: true, count: '9', checked: true, note: '' } } })
    assert.equal(isDisabled(action(s, 'clear')), false, 'a draft can be cleared')
    await s.click(action(s, 'clear'))
    assert.deepEqual(calls.at(-1), ['clear', 701])
  }],
  ['a product with no batch: matches stock sends no batches, so the page fills the total', async () => {
    const s = await mount()
    await open(s, 702)
    await s.click(action(s, 'matches'))
    assert.deepEqual(calls.at(-1), ['matches', 702, undefined])
  }],
  ['a failed batch read is said in words and nothing can be counted until it is opened again; a locked list changes nothing', async () => {
    failLoads = true
    let s = await mount()
    await open(s)
    assert.equal(inPopover(s, 'data-popover-failed').length, 1, 'the failure is shown, not an empty list')
    assert.equal(inPopover(s, 'data-popover-lot').length + inPopover(s, 'data-popover-single').length, 0, 'no entries to fill in')
    assert.equal(isDisabled(action(s, 'matches')), true, 'and no answer to give')
    failLoads = false
    await s.unmount(); live.pop()
    s = await mount({ locked: true })
    await open(s)
    assert.ok(inPopover(s, 'data-popover-lot-count').every(node => node.getAttribute('readonly') !== null || (node as unknown as { readOnly?: boolean }).readOnly === true), 'a submission is on its way: every box is read-only')
    assert.equal(isDisabled(action(s, 'matches')) && isDisabled(action(s, 'differs')), true)
  }],
  ['Full stock adjusters get a Set button beside a typed batch count that differs; others never do', async () => {
    const drafts = { 701: { selected: true, count: '4', checked: false, note: '', lots: { 91: { count: '4', seen: 6 }, 92: { count: '3', seen: 3 } } } }
    let s = await mount({ drafts })
    await open(s)
    assert.equal(inPopover(s, 'data-popover-lot').length, 2)
    assert.equal(s.findAll(node => node.getAttribute('data-popover-action') === 'set-lot').length, 0, 'no direct Set without the grant')
    await s.unmount(); live.pop()
    const sets: Call[] = []
    s = await mount({ drafts, onLotSet: async (item: InventoryCheckProduct, lot: InventoryCheckLotRow, value: string) => { sets.push(['set', item.id, lot.batchId, value]); return true } })
    await open(s)
    const buttons = s.findAll(node => node.getAttribute('data-popover-action') === 'set-lot')
    assert.equal(buttons.length, 1, 'only the batch whose typed figure differs from its stock')
    assert.ok((buttons[0].getAttribute('aria-label') || '').includes('lot_set') || (buttons[0].getAttribute('aria-label') || '').includes('Set to 4'), 'named with the figure it sets')
    await s.click(buttons[0])
    assert.deepEqual(sets, [['set', 701, 91, '4']], 'the page is asked to set that batch to that figure (it confirms before and after itself)')
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) } finally { for (const surface of live.splice(0)) await surface.unmount(); failLoads = false }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} count-popover cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS Inventory check count popover: ${cases.length} mounted cases + status icon mapping + both language packs`)
