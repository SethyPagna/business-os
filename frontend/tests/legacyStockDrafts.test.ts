// UI-STOCK 5.9: a chip minimized from a retired stock surface (the one-by-one
// Adjust stock form, the Add/Create Products Session) restores into the Stock
// Session instead of being lost.
import assert from 'node:assert/strict'
import { convertLegacyStockDraft } from '../src/utils/legacyStockDrafts.ts'

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

let minted = 0
const mint = (): string => `stockline_test_${++minted}`

const adjustDraft = (form: Record<string, unknown>, initialType: 'add' | 'remove' | 'set') => ({
  version: 1,
  product: { id: 42, name: 'Head & Shoulders', barcode: '037000673743', selling_price_usd: 17, cost_price_usd: 12.09 },
  form: { product_id: 42, type: initialType, ...form },
  initialType,
  search: 'head',
  receiptSessionId: 1759200000000,
  attemptId: 'attempt_1',
  rows: [],
})

runTest('a one-by-one Add becomes the entry row of an Add session, nothing queued', () => {
  const result = convertLegacyStockDraft({ kind: 'stock_adjust', data: adjustDraft({
    quantity: 6, branch_id: 1, batch_id: '', reason: 'New arrival', unit_cost_usd: '12.09',
    supplier_id: 4, supplier_name: 'Bong Long', received_date: '2026-09-29', payment_status: 'credit', credit_due_date: '2026-10-15',
    condition_tag: '',
  }, 'add') }, mint)
  assert.ok(result.draft, 'readable')
  const draft = result.draft!
  assert.equal(draft.mode, 'add')
  assert.equal(draft.lines.length, 0, 'an entry-row pick, not a queued line')
  assert.equal(draft.picked?.id, 42)
  assert.equal(draft.quantity, '6')
  assert.equal(draft.unitCost, '12.09')
  assert.equal(draft.sellingPrice, '17', 'the current price is prefilled, never a separate row')
  assert.equal(draft.batchChoice, 'new')
  assert.equal(draft.branchId, '1')
  assert.equal(draft.reason, 'New arrival')
  assert.deepEqual(draft.supplier, { supplierId: 4, supplierName: 'Bong Long' })
  assert.equal(draft.paymentStatus, 'credit')
  assert.equal(draft.creditDueDate, '2026-10-15')
  assert.equal(draft.receivedDate, '2026-09-29')
})

runTest('a one-by-one Remove keeps its received date and tag', () => {
  const result = convertLegacyStockDraft({ kind: 'stock_adjust', data: adjustDraft({
    quantity: 2, branch_id: 1, batch_id: 88, reason: 'Damaged', condition_tag: 'damaged', unit_cost_usd: '9',
  }, 'remove') }, mint)
  const draft = result.draft!
  assert.equal(draft.mode, 'remove')
  assert.equal(draft.batchChoice, 88)
  assert.equal(draft.conditionTag, 'damaged')
  assert.equal(draft.unitCost, '', 'a Remove carries no cost')
})

runTest('an Add/Create Products Session becomes Add lines: receive -> add line, create_receive -> held create line', () => {
  const result = convertLegacyStockDraft({ kind: 'create_products_session', data: {
    sessionId: 1759200000001,
    clientRequestId: 'stockin_1759200000001',
    header: { brand: 'SK-II', supplierId: 4, supplierName: 'Bong Long', branchId: '2' },
    receivedDate: '2026-09-30',
    paymentStatus: 'paid',
    creditDueDate: '',
    reason: 'New arrival',
    step: 'items',
    submittedItems: null,
    lines: [
      { lineId: 'receive_7_1', kind: 'receive', productId: 7, product: null, name: 'SK-II Cleanser', barcode: '111', brand: 'SK-II', supplierId: 4, supplierName: 'Bong Long', branchId: '2', branchName: 'Warehouse', receivedDate: '2026-09-30', expiryDate: '2027-01-01', batchId: null, batchLabel: '', quantity: 10, unitCostUsd: 3.5, freeGoods: false, reason: 'New arrival', status: 'queued', detail: '' },
      { lineId: 'create_1', kind: 'create_receive', productId: null, product: { name: 'SK-II Toner', barcode: '222', selling_price_usd: 30, cost_price_usd: 20 }, name: 'SK-II Toner', barcode: '222', brand: 'SK-II', supplierId: 4, supplierName: 'Bong Long', branchId: '2', branchName: 'Warehouse', receivedDate: '2026-09-30', expiryDate: '', batchId: null, batchLabel: '', quantity: 4, unitCostUsd: 20, freeGoods: false, reason: '', status: 'queued', detail: '' },
      { lineId: 'receive_9_1', kind: 'receive', productId: 9, product: null, name: 'Done already', barcode: '', brand: '', supplierId: null, supplierName: '', branchId: '2', branchName: '', receivedDate: '', expiryDate: '', batchId: null, batchLabel: '', quantity: 1, unitCostUsd: 1, freeGoods: false, reason: '', status: 'saved', detail: '' },
    ],
  } }, mint)
  const draft = result.draft!
  assert.equal(draft.mode, 'add')
  assert.equal(draft.brand, 'SK-II')
  assert.equal(draft.branchId, '2')
  assert.equal(draft.lines.length, 2, 'the saved line was already written and is not re-queued')
  const [receive, create] = draft.lines
  assert.equal(receive.product.id, 7)
  assert.equal(receive.quantity, 10)
  assert.equal(receive.unitCost, '3.5')
  assert.equal(receive.expiryDate, '2027-01-01')
  assert.equal(receive.batchChoice, 'new')
  assert.equal(receive.status, 'queued')
  assert.ok(create.createPayload, 'the prepared product payload is held on the line')
  assert.equal(create.createPayload?.name, 'SK-II Toner')
  assert.ok(create.createRequestId, 'a create id so Complete Session creates it replay-safely')
  assert.ok(!(Number(create.product.id) > 0), 'not created yet')
  assert.equal(create.createdProduct, true)
  assert.notEqual(receive.requestId, create.requestId, 'each line mints its own 0192 id')
})

runTest('a session whose atomic request may already have applied is never re-sent as lines', () => {
  const result = convertLegacyStockDraft({ kind: 'create_products_session', data: {
    sessionId: 1, header: { brand: '', supplierId: null, supplierName: 'X', branchId: '1' },
    submittedItems: [{ line_id: 'a', kind: 'receive', product_id: 1, branch_id: 1, quantity: 1, received_date: '2026-09-30' }],
    lines: [{ lineId: 'a', kind: 'receive', productId: 1, name: 'A', quantity: 1, unitCostUsd: 1, status: 'queued' }],
  } }, mint)
  assert.equal(result.draft, null)
  assert.equal(result.blocked, 'submission_unknown')
})

runTest('unreadable legacy data restores nothing', () => {
  assert.equal(convertLegacyStockDraft({ kind: 'stock_adjust', data: { version: 2 } }, mint).blocked, 'unreadable')
  assert.equal(convertLegacyStockDraft({ kind: 'create_products_session', data: null }, mint).blocked, 'unreadable')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} legacy stock draft test(s) failed`)
} else {
  console.log('\nAll legacy stock draft tests passed')
}
