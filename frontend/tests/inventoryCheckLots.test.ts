import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { countTextFromLots, lotCountOf, lotSubmissionLine, lotTotals, rowSetPlan, staleLotFigures, type LotDraft } from '../src/components/inventory/inventoryCheckLots.ts'
import { patchWiredRaw, setToAmount, wiredResult, type WiredList } from '../src/components/inventory/inventoryWired.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// INV-B S5: counts typed per received date and the direct Set from a row (INVENTORY-REPLAN rev. 2 sections 2.6, 2.7).
// Pure rules first (the 05a red case among them), then the wired page's patch (a Set reads no page), then the mounted row.

// ---- typed text and totals ----------------------------------------------------------------------------------------------------------------------------------
assert.deepEqual(lotCountOf(''), { kind: 'empty' })
assert.deepEqual(lotCountOf(' 4.5 '), { kind: 'valid', value: 4.5 })
assert.deepEqual(lotCountOf('0'), { kind: 'valid', value: 0 }, 'zero is a count a person makes')
assert.deepEqual(lotCountOf('-1'), { kind: 'invalid' })
assert.deepEqual(lotCountOf('1e3'), { kind: 'invalid' })
const typed: LotDraft = { '7': { count: '4', seen: 5 }, '8': { count: '', seen: 3 }, '9': { count: '2', seen: 2 } }
assert.deepEqual(lotTotals(typed), { dates: 2, counted: 6, seen: 7, valid: true }, 'a blank date is not counted; the others add up with what they showed')
assert.equal(countTextFromLots(typed), '6')
assert.equal(lotTotals({ '7': { count: 'x', seen: 5 } }).valid, false)
assert.equal(countTextFromLots({ '7': { count: 'x', seen: 5 }, '9': { count: '2', seen: 2 } }), '', 'a figure that is not a number blanks the sum, so the page asks for a number')
assert.equal(countTextFromLots({}), '')
assert.equal(lotTotals({ '1': { count: '0.1', seen: 0.2 }, '2': { count: '0.2', seen: 0.1 } }).counted, 0.3, 'sums are rounded to four decimals, not 0.30000000000000004')

// ---- the submission line: only typed dates, each with the figure it showed ------------------------------------------------------------------------------------
assert.deepEqual(lotSubmissionLine(5, typed, { checked: false, note: 'two crushed' }), { productId: 5, lots: [{ batchId: 7, scope: 'lot', counted: 4, seen: 5 }, { batchId: 9, scope: 'lot', counted: 2, seen: 2 }], checked: false, note: 'two crushed' })
assert.equal(lotSubmissionLine(5, { '8': { count: '', seen: 3 } }, { checked: false }), null, 'nothing typed: no line')
assert.equal(lotSubmissionLine(5, { '0': { count: '1', seen: 3 } }, { checked: false }), null, 'batch 0 is the branch total, never a date line from this screen')

// ---- the Set-to rule, and the 05a red case ----------------------------------------------------------------------------------------------------------------------
// 05a wrote the counted figure as it was (10). The count of 10 was typed against a screen that showed 11 and one sale has since taken stock to 10:
// the Set-to keeps that sale, so it is 9, not 10.
assert.equal(setToAmount(10, 11, 10), 9, '05a red case: now 10, counted 10 against a seen 11 -> Set to 9')
assert.notEqual(setToAmount(10, 11, 10), 10)
assert.equal(setToAmount(10, 11, 11), 10, 'nothing sold since: the counted figure')
assert.equal(setToAmount(2, 11, 3), 0, 'never below zero')

// ---- a direct Set from a date --------------------------------------------------------------------------------------------------------------------------------
assert.deepEqual(rowSetPlan({ batchId: 7, quantity: 5 }, '4'), { batchId: 7, before: 5, after: 4 })
assert.equal(rowSetPlan({ batchId: 7, quantity: 5 }, '5'), null, 'the same figure changes nothing, so there is nothing to confirm')
assert.equal(rowSetPlan({ batchId: 7, quantity: 5 }, ''), null)
assert.equal(rowSetPlan({ batchId: 7, quantity: 5 }, 'abc'), null)

// ---- a refused count carries the figures it found: the rows take them, nothing is read -------------------------------------------------------------------------
const product = { id: 5, name: 'Serum', quantity: 8, lot_rows: [{ batchId: 7, receivedAt: '2026-10-01', expiry: null, quantity: 5 }, { batchId: 9, receivedAt: '2026-10-09', expiry: null, quantity: 3 }] }
const stale = staleLotFigures({ status: 409, code: 'inventory_check_stock_changed', productIds: [5], current: [{ productId: 5, batchId: 7, scope: 'lot', quantity: 4 }] }, [product], 1)
assert.ok(stale)
assert.deepEqual(stale.conflicts, [{ productId: 5, branchId: 1, batchId: 7, current: { lotQuantity: 4, branchQuantity: 7 } }], 'the branch total moves by what the date moved')
assert.deepEqual(stale.changed, [{ productId: 5, name: 'Serum', batchId: 7, receivedAt: '2026-10-01', was: 5, now: 4 }], 'the message can say was and now')
assert.equal(staleLotFigures({ status: 409, code: 'inventory_check_stock_changed', productIds: [5] }, [product], 1), null, 'an older server sends no figures: the page reloads as before')
assert.equal(staleLotFigures({ body: { current: [{ productId: 77, batchId: 7, scope: 'lot', quantity: 1 }] } }, [product], 1), null, 'a product not on this page is not patched')
const twoDates = staleLotFigures({ current: [{ productId: 5, batchId: 7, scope: 'lot', quantity: 4 }, { productId: 5, batchId: 9, scope: 'lot', quantity: 6 }] }, [product], 1)
assert.deepEqual(twoDates?.conflicts.map(entry => entry.current.branchQuantity), [7, 10], 'two dates of one product move the total one after the other')
assert.deepEqual(staleLotFigures({ current: [{ productId: 5, batchId: 0, scope: 'branch', quantity: 2 }] }, [product], 1)?.conflicts, [{ productId: 5, branchId: 1, batchId: 0, current: { lotQuantity: 0, branchQuantity: 2 } }])

// ---- the wired page: a Set patches the row from the answer (the mounted page test counts the requests: none) ------------------------------------------------------------------------------
const list: WiredList = {
  items: [{ id: 5, name: 'Serum', stock_quantity: 8, branch_stock: [{ branch_id: 1, branch_name: 'Main', quantity: 8 }],
    lots: [{ id: 7, received_at: '2026-10-01', branches: [{ branch_id: 1, quantity: 5 }] }, { id: 9, received_at: '2026-10-09', branches: [{ branch_id: 1, quantity: 3 }] }, { id: 11, received_at: '2026-09-01', branches: [{ branch_id: 2, quantity: 4 }] }, { id: 12, received_at: '2026-08-01', branches: [{ branch_id: 1, quantity: 0 }] }] }],
  total: 1, page: 1, pageSize: 20, wired: true,
}
const raw = { list, overlay: new Map(), lots: new Map(), branches: [{ id: 1, name: 'Main' }], branchId: 1, extras: {} }
const before = wiredResult(raw)
assert.deepEqual(before.items[0].lot_rows?.map(row => [row.batchId, row.quantity]), [[7, 5], [9, 3]], 'the rows list the dates this branch holds, not another branch\'s lot')
const patched = patchWiredRaw(raw, { productId: 5, branchId: 1, batchId: 7, after: { lotQuantity: 4, branchQuantity: 7 } })
const after = wiredResult(patched)
assert.equal(after.items[0].quantity, 7, 'the branch figure takes the answer')
assert.deepEqual(after.items[0].lot_rows?.map(row => [row.batchId, row.quantity]), [[7, 4], [9, 3]], 'and so does the date')
assert.equal(wiredResult(raw).items[0].quantity, 8, 'the earlier raw is untouched')
const conflicted = patchWiredRaw(raw, { productId: 5, branchId: 1, batchId: 7, current: { lotQuantity: 2, branchQuantity: 5 } })
assert.deepEqual(wiredResult(conflicted).items[0].lot_rows?.map(row => row.quantity), [2, 3], 'a refusal shows the figures the writer found')
assert.equal(patchWiredRaw(raw, { productId: 99, branchId: 1, batchId: 7, after: { lotQuantity: 0, branchQuantity: 0 } }).list.items[0], raw.list.items[0], 'another product is not touched')

// ---- the mounted row ----------------------------------------------------------------------------------------------------------------------------------------------
const rowProduct: InventoryCheckProduct = { id: 5, name: 'Serum', quantity: 8, check_status: 'not_checked', lot_rows: product.lot_rows }
type Call = [string, ...unknown[]]
const calls2: Call[] = []
const base = {
  products: [rowProduct], drafts: { '5': { selected: true, count: '', checked: false, note: '', lots: {} } }, selecting: true, canViewStock: true, canViewCounts: true, t: (key: string) => key,
  onOpenProduct: () => {}, onToggle: () => {}, onCount: () => {}, onChecked: () => {}, onNote: () => {},
  lotCounts: true,
  onLotCount: (p: InventoryCheckProduct, lot: { batchId: number }, value: string) => { calls2.push(['lot', p.id, lot.batchId, value]) },
  onLotSet: (p: InventoryCheckProduct, lot: { batchId: number }, value: string) => { calls2.push(['set', p.id, lot.batchId, value]) },
}
const harness = await createHarness({})
const live: MountedSurface[] = []
const mount = async (props: Record<string, unknown> = {}) => { for (const old of live.splice(0)) await old.unmount(); const s = await harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx', props: { ...base, ...props }, app: {}, doubles: {} }); live.push(s); return s }
const lots = (s: MountedSurface) => s.findAll(node => node.getAttribute('data-check-lot') !== null)
const flat = (node: MemoryNode | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
const readOnly = (node: MemoryNode) => ['readOnly', 'readonly'].some(name => { const value = node.getAttribute(name); return value !== null && value !== 'false' })
const failures: string[] = []
const cases: Array<[string, () => Promise<void>]> = [
  ['a picked row lists its received dates with a count box on each; nothing else is added', async () => {
    const s = await mount()
    const dates = lots(s)
    assert.deepEqual(dates.map(node => node.getAttribute('data-check-lot')), ['7', '9'])
    assert.ok(flat(dates[0]).includes('inventory_check_lot_received') || flat(dates[0]).includes('Received'), 'the date is named in words')
    assert.equal(s.findAll(node => node.getAttribute('data-check-action') === 'set-lot').length, 0, 'no Set button until a figure that differs is typed')
    const unpicked = await mount({ drafts: {} })
    assert.equal(lots(unpicked).length, 0, 'a row that is not picked stays a single line')
  }],
  ['typing on a date reports that date; with dates typed the row count is read only', async () => {
    const s = await mount()
    const input = s.find(node => node.getAttribute('data-check-lot-count') !== null && node.parentNode === lots(s)[0], 'date input')
    await s.call(input, 'onChange', [{ target: { value: '4' } }])
    assert.deepEqual(calls2.pop(), ['lot', 5, 7, '4'])
    const typedState = await mount({ drafts: { '5': { selected: true, count: '4', checked: false, note: '', lots: { '7': { count: '4', seen: 5 } } } } })
    const rowCount = typedState.find(node => node.getAttribute('data-check-count') !== null, 'row count')
    assert.equal(readOnly(rowCount), true, 'the sum is shown, not typed over')
  }],
  ['a differing figure offers Set only to someone allowed (onLotSet); a blind or non-adjusting viewer gets the count box alone', async () => {
    const draft = { '5': { selected: true, count: '4', checked: false, note: '', lots: { '7': { count: '4', seen: 5 } } } }
    const withSet = await mount({ drafts: draft })
    const button = withSet.find(node => node.getAttribute('data-check-action') === 'set-lot', 'Set button')
    await withSet.click(button)
    assert.deepEqual(calls2.pop(), ['set', 5, 7, '4'])
    const without = await mount({ drafts: draft, onLotSet: undefined })
    assert.equal(without.findAll(node => node.getAttribute('data-check-action') === 'set-lot').length, 0)
    const blind = await mount({ drafts: draft, canViewStock: false })
    assert.equal(lots(blind).length, 0, 'a viewer who may not see stock sees no dates')
  }],
  ['with the switch off the row is exactly the older row (no date list, no extra input)', async () => {
    const off = await mount({ lotCounts: false, onLotCount: undefined, onLotSet: undefined })
    assert.equal(lots(off).length, 0)
    const rowCount = off.find(node => node.getAttribute('data-check-count') !== null, 'row count')
    assert.equal(readOnly(rowCount), false, 'the count box is typed in as before')
  }],
]
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} lot-count cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS inventoryCheckLots: rules, 05a red case, stale figures, Set patch with no page read, ${cases.length} mounted row cases`)
