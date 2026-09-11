import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { deriveProductSheetState } from '../src/components/pos/productSheetState.ts'

function compile(source: string, dependencies: Record<string, unknown>, result: string): any {
  const code = transformSync(source, { loader: 'tsx', format: 'cjs' }).code
  return new Function(...Object.keys(dependencies), `${code}; return ${result}`)(...Object.values(dependencies))
}
const requests: any[][] = []
const module = { exports: {} as any }
compile(readFileSync(new URL('../src/utils/pickerLotFreshness.ts', import.meta.url), 'utf8'), {
  module, exports: module.exports,
  require: () => ({ apiFetch: async (...args: any[]) => { requests.push(args); return { batches: [] } } }),
}, 'module.exports')
const { readFreshPickerLots, startPickerLotRead } = module.exports
const ctrl = new AbortController()
await readFreshPickerLots(3263, '2', ctrl.signal)
await readFreshPickerLots(3263, '2', ctrl.signal)
assert.equal(requests[0][0], 'GET')
assert.match(requests[0][1], /productId=3263&branchId=2&_picker=/)
assert.notEqual(requests[0][1], requests[1][1], 'fresh reads never use a stale route key')
assert.equal(requests[0][3], 8000)
assert.equal(requests[0][4].signal, ctrl.signal)

const source = readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const deriveCode = source.slice(source.indexOf('const requireFreshLots ='), source.indexOf('  const branchOptions = sheetState.branchOptions'))
const product = { id: 3263, name: 'Kerastase Conditioner Genesis75ml', barcode: '03474637319687', stock_quantity: 3, branch_stock: [{ branch_id: 2, branch_name: 'Shop', quantity: 3 }] }
const lot = { id: 56957, is_active: 1, quantity: 3, received_at: '2026-09-02T15:30:00.000Z', lot_code: 'ADJ09/02/2026' }
const base = {
  product, variants: [], groupProduct: false, selectedBranchId: null, activeBranchId: 2, selectedVariantId: null,
  trackedBatchProductIds: new Set(), trackedBatchLookupUnavailable: false,
  hideReceivedDates: false, intent: 'sell', batches: [], knownPositiveQuantityByProduct: {}, selectedBatchId: null,
  selectedUnlottedProductId: null, damagedLots: [], selectedDamagedLotId: null, loadedLotScope: '',
  getDisplayStock: (row: any) => row?.stock_quantity || 0,
  buildVariantOptionLabels: () => ({ stepTitle: 'Option' }), fmtUSD: String, deriveProductSheetState,
}
const state = (patch = {}) => compile(deriveCode, { ...base, ...patch }, '({sheetState,currentLotScope,requireFreshLots})')
const pending = state()
assert.equal(pending.requireFreshLots, true)
assert.equal(pending.sheetState.isBatchTracked, true, 'stale empty global IDs cannot suppress point lookup')
assert.equal(pending.sheetState.displayedStock, 3)
assert.equal(pending.sheetState.pickAllowed, false)
const loaded = { batches: [lot], knownPositiveQuantityByProduct: { 3263: 3 }, loadedLotScope: pending.currentLotScope }
assert.equal(state(loaded).sheetState.pickAllowed, false, 'successful lookup still requires a deliberate lot choice')
assert.equal(state({ ...loaded, selectedBatchId: 56957 }).sheetState.pickAllowed, true)
assert.equal(state({ ...loaded, batches: [{ ...lot, quantity: 0 }], selectedBatchId: 56957 }).sheetState.pickAllowed, false)
assert.equal(state({ ...loaded, selectedBatchId: 56957, product: { ...product, id: 999 } }).sheetState.pickAllowed, false, 'old lot cannot enable a new product before effects clean up')
assert.equal(state({ ...loaded, selectedBatchId: 56957, activeBranchId: 3, product: { ...product, branch_stock: [{ branch_id: 3, branch_name: 'Shop', quantity: 3 }] } }).sheetState.pickAllowed, false)
assert.equal(state({ intent: 'stock', product: { ...product, stock_quantity: 0, branch_stock: [] } }).sheetState.pickAllowed, true, 'untracked stock-creation selectors remain usable')
assert.equal(state({ hideReceivedDates: true }).sheetState.batchSelectionRequired, false, 'replacement hosts that cannot carry a lot keep their explicit exemption')
for (let id = 1; id <= 100; id++) {
  const candidate = { ...product, id }
  const first = state({ product: candidate })
  assert.equal(first.sheetState.pickAllowed, false)
  const ready = state({ product: candidate, batches: [{ ...lot, id: id + 100000 }],
    loadedLotScope: first.currentLotScope, knownPositiveQuantityByProduct: { [id]: 3 }, selectedBatchId: id + 100000 })
  assert.equal(ready.sheetState.pickAllowed, true, `stocked product ${id} reaches its own positive lot without global-index membership`)
}

// Execute the production effect body and its real cancellation helper.
const marker = '  useEffect(() => {\n    if (!isBatchTracked'
const begin = source.indexOf(marker) + '  useEffect('.length
const end = source.indexOf(', [isBatchTracked', begin)
const effectSource = `const effect = ${source.slice(begin, end)}`
let batches: any[] = [], scope = '', failed = '', loading = false
let finish!: (value: any) => void
let signal!: AbortSignal
const deps = {
  isBatchTracked: true, lotSourceProductIds: [3263], resolvedBranchId: '2', requireFreshLots: true,
  currentLotScope: pending.currentLotScope,
  startPickerLotRead,
  readFreshPickerLots: (_id: number, _branch: string, abort: AbortSignal) => { signal = abort; return new Promise((resolve) => { finish = resolve }) },
  getProductBatches: () => { throw new Error('sell lookup must not use route cache') },
  setLoadedLotScope: (value: string) => { scope = value },
  setBatches: (value: any[]) => { batches = value },
  setKnownPositiveQuantityByProduct: () => {}, setBatchesLoading: (value: boolean) => { loading = value },
  setBatchesError: (value: string) => { failed = value },
}
const effect = compile(effectSource, deps, 'effect')
const cleanup = effect()
assert.equal(loading, true)
cleanup()
assert.equal(signal.aborted, true)
finish({ batches: [lot], known_positive_quantity: 3 })
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(batches, [], 'late response from closed or replaced effect never publishes')
effect()
finish({ batches: [lot, { ...lot, id: 9, is_active: 0 }], known_positive_quantity: 6 })
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(batches.map((row: { id: number }) => row.id), [56957], 'inactive rows never enter selectable list')
assert.equal(scope, pending.currentLotScope)
assert.equal(loading, false)
const badEffect = compile(effectSource, { ...deps, readFreshPickerLots: async () => { throw new Error('network failed') } }, 'effect')
badEffect()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(scope, '')
assert.deepEqual(batches, [])
assert.equal(failed, 'network failed')
assert.equal(loading, false)
let partialPublished = false, partialFailure = false
startPickerLotRead([1, 2], async (id: number) => {
  if (id === 2) throw new Error('second family member failed')
  return [lot]
}, () => { partialPublished = true }, () => { partialFailure = true })
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(partialPublished, false)
assert.equal(partialFailure, true, 'a partial family cannot masquerade as the complete lot list')
console.log('PASS actual picker derivation/effect: fresh point probe, stale-index target3263, explicit selection, zero/inactive refusal, race cancellation and creation-selector parity')
