// UI-STOCK S12 + S14: Free is a per-line QUANTITY on Add (stock in = qty + free,
// the supplier is paid for qty), and an Add line may carry a new selling price
// for the same product row (latest entered wins, rounded up to the cent).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockReceiptGateCode } from '../src/utils/stockReceiptFields.ts'
import {
  buildStockLineRequest,
  lineDeclaresFree,
  linePaidTotal,
  lineSellingPriceChange,
  lineWireUnitCost,
  reviewStockLine,
  sessionItemsTotal,
  type LineRequestContext,
  type StockSessionLine,
} from '../src/utils/stockSessionDraft.ts'
import { receiveBatchWireBody } from '../src/api/batchesTransport.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const src = (relative: string): string => readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

function line(overrides: Partial<StockSessionLine> = {}): StockSessionLine {
  return {
    key: 'k1',
    requestId: 'stockline_1',
    product: { id: 7, name: 'SK-II Cleanser', selling_price_usd: 5, cost_price_usd: 3.2, stock_quantity: 0, branch_stock: [{ branch_id: 1, quantity: 0 }] },
    productName: 'SK-II Cleanser',
    mode: 'add',
    quantity: 10,
    freeQuantity: 0,
    unitCost: '3.5',
    sellingPrice: '5',
    freeGoods: false,
    expiryDate: '',
    batchChoice: 'new',
    batchLabel: 'New',
    reason: '',
    conditionTag: '',
    createdProduct: false,
    status: 'queued',
    detail: '',
    ...overrides,
  }
}

const ctx: LineRequestContext = {
  branchId: '1',
  receivedDate: '2026-09-30',
  supplier: { supplierId: 4, supplierName: 'Bong Long' },
  paymentStatus: 'paid',
  creditDueDate: '',
  sessionId: 1700000000000,
  canEditPrice: true,
  reasonFor: (entry) => entry.reason || 'Stock-in session',
}

runTest('gate mirror: qty 0 + free n is the declared-free receipt; a $0 cost with paid units still needs the declaration', () => {
  assert.equal(stockReceiptGateCode({ isStockIn: true, supplierName: 'Bong Long', unitCostUsd: 0, quantity: 0, freeQuantity: 2 }), '')
  assert.equal(stockReceiptGateCode({ isStockIn: true, supplierName: 'Bong Long', unitCostUsd: 0, quantity: 3, freeQuantity: 2 }), 'free_goods_required')
  assert.equal(stockReceiptGateCode({ isStockIn: true, supplierName: 'Bong Long', unitCostUsd: 0, quantity: 0, freeQuantity: 0 }), 'free_goods_required')
  // Free units never waive the supplier.
  assert.equal(stockReceiptGateCode({ isStockIn: true, supplierName: '', unitCostUsd: 0, quantity: 0, freeQuantity: 2 }), 'supplier_required')
  assert.equal(lineDeclaresFree(line({ quantity: 0, freeQuantity: 2 })), true)
  assert.equal(lineDeclaresFree(line({ quantity: 3, freeQuantity: 2 })), false)
})

runTest('the supplier is paid for qty only; free units dilute the lot cost (10 at $3.50 + 2 free = 12 at $2.9167)', () => {
  const buyTenGetTwo = line({ quantity: 10, freeQuantity: 2, unitCost: '3.5' })
  assert.equal(linePaidTotal(buyTenGetTwo), 35)
  assert.equal(sessionItemsTotal([buyTenGetTwo, line({ key: 'k2', quantity: 6, unitCost: '12.09' })]), 107.54)
  const review = reviewStockLine(buyTenGetTwo, '1')
  assert.equal(review.stockBefore, 0)
  assert.equal(review.stockAfter, 12, 'stock in = qty + free')
  assert.equal(review.costAfter, 2.9167, 'the free units lower the cost estimate; 3.5 would mean they were ignored')
  assert.equal(lineWireUnitCost(line({ quantity: 0, freeQuantity: 5, unitCost: '3.5' })), 0, 'a fully free line carries cost 0')
  assert.equal(lineWireUnitCost(line({ unitCost: '' })), null, 'a blank cost is never zero')
})

runTest('receive wire: free units and the new price ride the line only when they apply', () => {
  const request = buildStockLineRequest(line({ quantity: 10, freeQuantity: 2, sellingPrice: '5.501' }), ctx)
  assert.equal(request.wire, 'receive')
  const body = request.body as Record<string, unknown>
  assert.equal(body.quantity, 10)
  assert.equal(body.freeQuantity, 2)
  assert.equal(body.unitCostUsd, 3.5, 'the PAID unit cost goes on the wire; the Worker divides')
  assert.equal(body.sellingPriceUsd, 5.51, 'selling prices round UP to the cent')
  assert.equal(body.clientRequestId, 'stockline_1')
  const wire = receiveBatchWireBody(body as never)
  assert.equal(wire.free_quantity, 2)
  assert.equal(wire.selling_price_usd, 5.51)
  // Absent, not 0/null, so an older line's retry keeps its 0192 fingerprint.
  const plain = receiveBatchWireBody(buildStockLineRequest(line(), ctx).body as never)
  assert.equal('free_quantity' in plain, false)
  assert.equal('selling_price_usd' in plain, false)
  assert.equal('freeQuantity' in buildStockLineRequest(line(), ctx).body, false)
})

runTest('selling price: unchanged sends nothing, lower is allowed (latest wins), no price-edit permission sends nothing', () => {
  assert.equal(lineSellingPriceChange(line({ sellingPrice: '5' })), null)
  assert.equal(lineSellingPriceChange(line({ sellingPrice: '5.00' })), null)
  assert.equal(lineSellingPriceChange(line({ sellingPrice: '4.5' })), 4.5)
  assert.equal(lineSellingPriceChange(line({ sellingPrice: '' })), null)
  assert.equal(lineSellingPriceChange(line({ mode: 'remove', sellingPrice: '9' })), null)
  const denied = buildStockLineRequest(line({ sellingPrice: '9' }), { ...ctx, canEditPrice: false }).body as Record<string, unknown>
  assert.equal('sellingPriceUsd' in denied, false)
  const review = reviewStockLine(line({ sellingPrice: '5.5' }), '1')
  assert.equal(review.priceBefore, 5)
  assert.equal(review.priceAfter, 5.5)
  assert.equal(reviewStockLine(line(), '1').priceAfter, null, 'an unchanged price is not shown as a change')
})

runTest('a tagged Add goes through /adjust with the same free and price fields', () => {
  const request = buildStockLineRequest(line({ conditionTag: 'damaged', freeQuantity: 1, sellingPrice: '6' }), ctx)
  assert.equal(request.wire, 'adjust')
  const body = request.body as Record<string, unknown>
  assert.equal(body.type, 'add')
  assert.equal(body.conditionTag, 'damaged')
  assert.equal(body.freeQuantity, 1)
  assert.equal(body.sellingPriceUsd, 6)
  assert.equal(body.client_request_id, 'stockline_1')
})

runTest('Free and price are Add-only: Remove and Set bodies never carry them', () => {
  for (const mode of ['remove', 'set'] as const) {
    const body = buildStockLineRequest(line({ mode, freeQuantity: 3, sellingPrice: '9', batchChoice: 12, expectedLotQuantity: 30 }), ctx).body as Record<string, unknown>
    assert.equal('freeQuantity' in body, false, `${mode} must not carry free units`)
    assert.equal('sellingPriceUsd' in body, false, `${mode} must not carry a price`)
    assert.equal('unitCostUsd' in body, false, `${mode} is not a receipt`)
  }
})

runTest('the entry row: Free and Price are per line cells, Price is disabled without products edit, Cost without cost access', () => {
  const entry = src('components/stock-session/StockSessionLineEntry.tsx')
  assert.match(entry, /stock_receipt_free_goods/, 'the Free cell')
  assert.match(entry, /disabled=\{[^}]*!canEditPrice/, 'Price is inert without products edit')
  assert.match(entry, /canViewCosts \|\| canEditCosts \? \(/, 'the Cost input renders only for users who may see or enter costs')
  assert.match(entry, /<\/span>—/, 'everyone else sees an inert "—" cell in its place')
  const modal = src('components/inventory/FastStockInModal.tsx')
  assert.match(modal, /getPermissionTier\('products'\) === 'full' && [a-zA-Z.]+\.can\('products', 'edit'\)/, 'price edit = full products tier + edit')
  const shared = src('components/stock-session/StockSessionSharedDetails.tsx')
  assert.doesNotMatch(shared, /stock_receipt_free_goods/, 'Free is never a shared detail')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock session free/price test(s) failed`)
} else {
  console.log('\nAll stock session free/price tests passed')
}
