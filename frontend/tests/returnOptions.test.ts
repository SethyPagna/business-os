import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STOCK_ACTION_OPTIONS, normalizeStockAction, stockActionOption,
  computeSettlementPreview, formatBatchDate, describeBatchOption,
} from '../src/components/returns/helpers/returnOptions.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('K2: normalizeStockAction mirrors the backend kernel exactly', () => {
  assert.equal(normalizeStockAction({ stock_action: 'damaged', return_to_stock: true }), 'damaged')
  assert.equal(normalizeStockAction({ stock_action: 'NONE' }), 'none')
  // the pre-0074 wire shape keeps its exact meaning
  assert.equal(normalizeStockAction({}), 'restock')
  assert.equal(normalizeStockAction({ return_to_stock: false }), 'none')
  assert.equal(normalizeStockAction({ stock_action: 'garbage', return_to_stock: false }), 'none')
})

runTest('K2: the chooser offers exactly the three stock actions', () => {
  assert.deepEqual(STOCK_ACTION_OPTIONS.map((option) => option.value), ['restock', 'damaged', 'none'])
  assert.equal(stockActionOption('damaged').icon, '🟠')
  // unknown input falls back to the no-stock-change option, never a crash
  assert.equal(stockActionOption('mystery' as never).value, 'none')
})

runTest('K2: settlement preview matches the backend thresholds (half cent / half riel)', () => {
  assert.equal(computeSettlementPreview({ returnedTotalUsd: 20, returnedTotalKhr: 82000, replacementTotalUsd: 20, replacementTotalKhr: 82000 }).isEven, true)
  const uneven = computeSettlementPreview({ returnedTotalUsd: 20, returnedTotalKhr: 0, replacementTotalUsd: 25.5, replacementTotalKhr: 0 })
  assert.equal(uneven.isEven, false)
  assert.equal(uneven.diffUsd, 5.5) // positive = customer owes
  assert.equal(computeSettlementPreview({ returnedTotalUsd: 30, returnedTotalKhr: 0, replacementTotalUsd: 25, replacementTotalKhr: 0 }).diffUsd, -5)
  // a KHR-only gap alone breaks evenness too
  assert.equal(computeSettlementPreview({ returnedTotalUsd: 10, returnedTotalKhr: 41000, replacementTotalUsd: 10, replacementTotalKhr: 45000 }).isEven, false)
})

runTest('K2: batch option lines read mm/dd/yyyy and never carry cost', () => {
  assert.equal(formatBatchDate('2026-09-15'), '09/15/2026')
  assert.equal(formatBatchDate(''), '')
  const label = describeBatchOption({ lot_code: '08152026', expiry_date: '2027-01-31', quantity: 6, batch_number: 2 })
  assert.equal(label, '08152026 · exp 01/31/2027 · 6 in stock')
  assert.equal(describeBatchOption({ lot_code: null, expiry_date: null, quantity: 3, batch_number: 4 }), '#4 · 3 in stock')
  assert.doesNotMatch(label, /cost/i)
})

const newReturnSource = readFileSync(new URL('../src/components/returns/NewReturnModal.tsx', import.meta.url), 'utf8')
const editReturnSource = readFileSync(new URL('../src/components/returns/EditReturnModal.tsx', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/components/returns/ReturnDetailModal.tsx', import.meta.url), 'utf8')
const backendKernelSource = readFileSync(new URL('../../cloudflare/src/lib/returnsStock.ts', import.meta.url), 'utf8')

runTest('K2: NewReturnModal wires the chooser, Replace, and the settlement gate', () => {
  // the ONE chooser renders per item and writes stock_action (boolean kept in step)
  assert.match(newReturnSource, /STOCK_ACTION_OPTIONS\.map\(\(option\)/)
  assert.match(newReturnSource, /const updateItemAction = \(idx: number, action: ReturnStockAction\)/)
  assert.match(newReturnSource, /stock_action: action, return_to_stock: action === 'restock'/)
  // Replace: same-name candidates only, POS-way lot picker, payload keys
  assert.match(newReturnSource, /normName\(row\.name\) === normName\(name\)/)
  assert.match(newReturnSource, /getProductBatches\(productId, branchId, true\)/)
  assert.match(newReturnSource, /replacement_items: replacements\.map/)
  assert.match(newReturnSource, /settlement_mode: settlementPreview\.isEven \? 'even_exchange' : 'price_difference'/)
  // the explicit preview: an uneven swap can't submit without the full-access tick
  assert.match(newReturnSource, /replacements\.length && !settlementPreview\.isEven && !settleDifference/)
  assert.match(newReturnSource, /getPermissionTier\?\.\('returns'\) === 'full'/)
  // 5.3: the overlay portals to document.body like the other returns modals
  assert.match(newReturnSource, /return createPortal\(/)
})

runTest('K2: EditReturnModal edits with the same chooser and sends stock_action', () => {
  assert.match(editReturnSource, /normalizeStockAction\(item as/)
  assert.match(editReturnSource, /STOCK_ACTION_OPTIONS\.map\(\(option\)/)
  assert.match(editReturnSource, /stock_action:\s+it\.stock_action \|\| 'restock'/)
})

runTest('K2: ReturnDetailModal shows the per-item action and the replacement lines', () => {
  assert.match(detailSource, /stockActionOption\(normalizeStockAction\(/)
  assert.match(detailSource, /replacement_items/)
  assert.match(detailSource, /settlement_mode === 'price_difference'/)
})

runTest('K2: the frontend mirror cannot drift from the backend kernel silently', () => {
  // same normalization branches...
  for (const pin of ["=== 'none' || explicit === 'restock' || explicit === 'damaged'", "return_to_stock !== false ? 'restock' : 'none'"]) {
    assert.ok(backendKernelSource.includes(pin), `backend kernel lost: ${pin}`)
    const frontendHelper = readFileSync(new URL('../src/components/returns/helpers/returnOptions.ts', import.meta.url), 'utf8')
    assert.ok(frontendHelper.includes(pin), `frontend helper lost: ${pin}`)
  }
  // ...and the same settlement thresholds on both sides
  for (const source of [backendKernelSource, readFileSync(new URL('../src/components/returns/helpers/returnOptions.ts', import.meta.url), 'utf8')]) {
    assert.match(source, /toFixed\(2\)/)
    assert.match(source, /0\.005/)
    assert.match(source, /Math\.abs\(diffKhr\) >= 1|Math\.abs\(diffKhr\) < 1/)
  }
})

if (failed > 0) {
  process.exitCode = 1
}
