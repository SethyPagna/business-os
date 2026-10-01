import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStockLineRequest, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

// The Stock Session's line writer lives in utils/stockSessionDraft.ts since
// UI-STOCK-2; it is executed here directly. Remove and Set never carry an
// acquisition cost, whatever a stale draft holds.
const read = (path: string) => readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8')

const line = {
  key: '1', requestId: 'req-1', product: { id: 7, name: 'Serum' }, productName: 'Serum', quantity: 0, freeQuantity: 0,
  unitCost: '88', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 4, batchLabel: '20/09/2026',
  reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '',
} as unknown as StockSessionLine
const context = {
  branchId: '1', receivedDate: '2026-09-20', supplier: { supplierId: 3, supplierName: 'Supplier' },
  paymentStatus: 'paid' as const, creditDueDate: '', sessionId: 42, canEditPrice: false, reasonFor: () => 'Correction',
}
const bodyOf = (request: { body: unknown }): Record<string, unknown> => request.body as Record<string, unknown>
const removal = buildStockLineRequest({ ...line, mode: 'remove' }, context)
assert.equal(bodyOf(removal).type, 'remove')
assert.equal(Object.hasOwn(bodyOf(removal), 'unitCostUsd'), false, 'removal never writes acquisition cost')
const correction = buildStockLineRequest({ ...line, mode: 'set' }, context)
assert.equal(bodyOf(correction).type, 'set')
assert.equal(bodyOf(correction).quantity, 0, 'zero set remains a valid stock correction')
// A scoped Set is a count correction on an existing lot (owner, 24 Sep): it
// keeps that lot's cost, so it never writes one.
assert.equal(Object.hasOwn(bodyOf(correction), 'unitCostUsd'), false, 'a scoped Set never writes acquisition cost, even from a stale draft')
assert.equal(bodyOf(correction).setScope, 'lot', 'the selected received date is the default scope')
assert.equal(bodyOf(correction).batchId, 4, 'the Set names its existing received date')
const receipt = buildStockLineRequest({ ...line, mode: 'add', quantity: 2, batchChoice: 'new' }, context)
assert.equal(receipt.wire, 'receive')
assert.equal(bodyOf(receipt).unitCostUsd, 88, 'a receipt carries the typed cost (the Worker checks cost edit)')

// Cost redaction must remove the UI element, not render a numeric fallback.
for (const path of ['products/StockChangeSection.tsx', 'products/StockInSessionsSection.tsx', 'inventory/FastStockInModal.tsx']) {
  const text = read(path)
  assert.match(text, /canViewAcquisitionCosts\(/)
  assert.match(text, /canViewCosts \?/)
}
// Receipts need cost edit: the session refuses before composing any request.
const float = read('inventory/FastStockInModal.tsx')
assert.match(float, /if \(!canEditCosts && pending\.some\(\(line\) => line\.mode === 'add' && line\.quantity \+ line\.freeQuantity > 0\)\) \{\s*notify\(tr\('product_cost_edit_required'/,
  'the Stock Session refuses receipts requiring unauthorized cost input')
console.log('PASS stock corrections omit unauthorized cost keys while permitted receipt inputs and cost-view guards remain separate')
