import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeReceivingDestination, captureReceivingRequest, lineReceivesStock, receivingDestinationRefusal, receivingDetailsLocked, restoreReceivingSubmissions, retainReceivingSubmissions } from '../src/utils/receivingDestination.ts'
import { emptyStockSessionDraft, normalizeStockSessionDraft, buildStockLineRequest, commitSessionBlock, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'
import { stockFailureText, stockLineNeedsRemoval } from '../src/utils/stockAdjustOutcome.ts'

const active = [{ value: '1', label: 'LC Store' }, { value: '3', label: 'Other' }]
const line = (patch: Partial<StockSessionLine> = {}): StockSessionLine => ({
  key: 'line-1', requestId: 'request-original-1', product: { id: 10, name: 'Rice', stock_quantity: 5, branch_stock: [{ branch_id: 2, quantity: 5 }] },
  productName: 'Rice', mode: 'add', quantity: 2, freeQuantity: 1, unitCost: '3.25', sellingPrice: '5', freeGoods: false,
  expiryDate: '2027-01-01', batchChoice: 'new', batchLabel: '', reason: 'Delivery', conditionTag: '', createdProduct: false,
  status: 'queued', detail: '', ...patch,
})
const empty = () => restoreReceivingSubmissions(null, [])
const context = { branchId: '2', receivedDate: '2026-09-03', supplier: { supplierId: 7, supplierName: 'Supplier' }, paymentStatus: 'credit' as const, creditDueDate: '2026-10-10', sessionId: 456, canEditPrice: true, reasonFor: () => 'Delivery' }

assert.equal(activeReceivingDestination('2', active), false)
assert.equal(activeReceivingDestination('1', active), true)
assert.equal(activeReceivingDestination('3', active), true)
assert.equal(activeReceivingDestination('1', []), false)
assert.equal(activeReceivingDestination('1', [{ value: '1', label: 'Retired', disabled: true }]), false)
for (const id of ['', '0', '2bad', '1.5', '9007199254740992']) assert.equal(activeReceivingDestination(id, active), false)
assert.equal(receivingDestinationRefusal('2', active, [line()], empty()), 'receiving_branch_inactive')
assert.equal(receivingDestinationRefusal('1', active, [line()], empty()), null)
assert.equal(receivingDestinationRefusal('1', [], [line()], empty()), 'receiving_branch_inactive')
assert.equal(receivingDestinationRefusal('2', active, [line({ mode: 'remove' })], empty()), null)
assert.equal(lineReceivesStock(line({ mode: 'set', quantity: 3 }), '2'), false)
assert.equal(lineReceivesStock(line({ mode: 'set', quantity: 6 }), '2'), true)
assert.equal(receivingDestinationRefusal('2', active, [line({ mode: 'set', quantity: 3 })], empty()), null)
assert.equal(receivingDestinationRefusal('2', active, [line({ mode: 'set', quantity: 6 })], empty()), 'receiving_branch_inactive')
assert.equal(lineReceivesStock(line({ mode: 'set', batchChoice: 9, expectedLotQuantity: 1, quantity: 2 }), '2'), true)
assert.equal(receivingDestinationRefusal('2', active, [line({ quantity: 0, freeQuantity: 0, createPayload: { name: 'New' } })], empty()), 'receiving_branch_inactive')
console.log('PASS active membership, no default substitution, removal and positive/negative Set boundaries')

const original = line()
const request = buildStockLineRequest(original, context)
const state = empty()
const captured = captureReceivingRequest(state, original, request)
const expected = JSON.stringify(captured)
request.body.branchId = 1
assert.equal(JSON.stringify(state.requests[original.key]), expected)
assert.equal(receivingDetailsLocked(state, [original]), true)
assert.equal(receivingDestinationRefusal('2', active, [original], state), null)
assert.equal(receivingDestinationRefusal('1', active, [original], state), 'receiving_submission_locked')
const changed = buildStockLineRequest(line({ quantity: 99 }), { ...context, branchId: '1', receivedDate: '2026-10-01' })
assert.equal(JSON.stringify(captureReceivingRequest(state, original, changed)), expected)
assert.equal(state.requests[original.key].body.branchId, 2)
assert.equal(receivingDestinationRefusal('2', active, [original, line({ key: 'fresh', requestId: 'fresh-request' })], state), 'receiving_branch_inactive')
console.log('PASS captured payload and identity stay exact after branch retirement or edited retry inputs')

const draft = { ...emptyStockSessionDraft({ ...context, mode: 'add' }), ...context, version: 2 as const, mode: 'add' as const, lines: [line({ status: 'saving' })], receivingSubmissions: state }
const raw = JSON.parse(JSON.stringify(draft))
const normalized = normalizeStockSessionDraft(raw, () => { throw Error('must not mint an existing request identity') })!
const restored = restoreReceivingSubmissions(raw, normalized.lines)
assert.equal(JSON.stringify(restored.requests[original.key]), expected)
assert.equal(normalized.branchId, '2')
assert.equal(normalized.receivedDate, context.receivedDate)
assert.equal(normalized.lines[0].unitCost, '3.25')
assert.equal(normalized.creditDueDate, context.creditDueDate)
assert.equal(receivingDestinationRefusal('2', active, normalized.lines, restored), null)
for (const status of ['error', 'saving'] as const) {
  const old = { ...draft, receivingSubmissions: undefined, lines: [line({ status })] }
  const reopened = normalizeStockSessionDraft(old, () => 'unused')!
  const unknown = restoreReceivingSubmissions(old, reopened.lines)
  assert.equal(receivingDestinationRefusal('2', active, reopened.lines, unknown), 'receiving_submission_unavailable')
  assert.equal(receivingDetailsLocked(unknown, reopened.lines), true)
}
const corrupted = { ...raw, receivingSubmissions: { requests: { [original.key]: { ...captured, body: { ...captured.body, clientRequestId: 'different' } } } } }
assert.equal(receivingDestinationRefusal('2', active, normalized.lines, restoreReceivingSubmissions(corrupted, normalized.lines)), 'receiving_submission_unavailable')
assert.equal(receivingDetailsLocked(retainReceivingSubmissions(restored, []), []), false)
assert.equal(receivingDestinationRefusal('2', active, [line({ status: 'saved' })], restored), null)
console.log('PASS normalizer/reload retains exact wire, dates and money; legacy unknown requests cannot be reconstructed')

const held = line({ product: { id: '', name: 'New' }, createPayload: { name: 'New' }, createRequestId: 'new-product-request' })
const productState = empty()
productState.products[held.key] = { name: 'New', branch_id: '2', stock_quantity: 0, client_request_id: held.createRequestId }
assert.equal(receivingDestinationRefusal('2', active, [held], productState, true), null)
assert.equal(receivingDestinationRefusal('1', active, [held], productState, true), 'receiving_submission_locked')
assert.equal(receivingDestinationRefusal('2', active, [held], productState), 'receiving_branch_inactive')
assert.equal(receivingDestinationRefusal('2', active, [{ ...held, product: { id: 42 } }], productState, true), 'receiving_branch_inactive')
assert.equal(stockFailureText({ code: 'receiving_branch_inactive', status: 409 }, key => `translated:${key}`, 'fallback'), 'translated:receiving_branch_inactive')
assert.equal(stockLineNeedsRemoval({ code: 'receiving_branch_inactive', status: 409 }), false)
assert.equal(receivingDetailsLocked(state, [original]), true)
const saved = line({ key: 'saved', requestId: 'saved-request', status: 'saved' })
assert.equal(commitSessionBlock({ lines: [saved, original], paidAmount: '13', paymentStatus: 'credit', creditDueDate: context.creditDueDate, canViewCosts: true })?.supplierTotalUsd, 6.5)
console.log('PASS product replay cannot admit new stock; inactive409 preserves snapshot; partial replay retains supplier-total accounting')

const modal = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const persistStart = modal.indexOf('  const persistSubmissionDraft = ')
assert(persistStart >= 0)
const persistBodyStart = modal.indexOf('=> {', persistStart) + 4
const persistBody = modal.slice(persistBodyStart, modal.indexOf('\n  }', persistBodyStart))
const persist = new Function('lines', 'currentDraft', 'writeWorkDraft', 'readWorkDraft', 'fastStockInDraftKey', 'stockFailureText', 'tr', persistBody)
let stored: unknown
const retryDraft = { ...raw, receivingSubmissions: state }
persist([original], () => retryDraft, (_key: string, data: unknown) => { stored = JSON.parse(JSON.stringify(data)) }, () => ({ data: stored }), 'fixture', stockFailureText, (key: string) => key)
assert.equal(JSON.stringify(stored), JSON.stringify(retryDraft))
let dispatched = false
assert.throws(() => {
  persist([original], () => retryDraft, () => {}, () => null, 'fixture', stockFailureText, (key: string) => key)
  dispatched = true
}, (error: unknown) => (error as { code: string }).code === 'receiving_submission_not_saved')
assert.equal(dispatched, false)
console.log('PASS actual modal submission persistence reads back exact draft and blocks transport after storage failure')
