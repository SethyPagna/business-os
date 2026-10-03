import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { activeReceivingDestination, captureReceivingRequest, lineReceivesStock, productCreationRefusal, receivingDestinationRefusal, receivingDetailsLocked, restoreReceivingSubmissions, retainReceivingSubmissions } from '../src/utils/receivingDestination.ts'
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
assert.equal(receivingDestinationRefusal('2', active, [held], productState), 'product_create_outcome_unknown')
assert.equal(receivingDestinationRefusal('1', active, [held], productState), 'product_create_outcome_unknown')
productState.productOutcomes[held.key] = 'not_sent'
assert.equal(receivingDetailsLocked(productState, [held]), false)
assert.equal(receivingDestinationRefusal('1', active, [held], productState), null)
assert.equal(receivingDestinationRefusal('2', active, [held], productState), 'receiving_branch_inactive')
productState.productOutcomes[held.key] = 'pending'
assert.equal(receivingDestinationRefusal('1', active, [held], productState), 'product_pending_review')
assert.equal(receivingDestinationRefusal('2', active, [{ ...held, product: { id: 42 } }], productState), 'receiving_branch_inactive')
assert.equal(stockFailureText({ code: 'receiving_branch_inactive', status: 409 }, key => `translated:${key}`, 'fallback'), 'translated:receiving_branch_inactive')
assert.equal(stockLineNeedsRemoval({ code: 'receiving_branch_inactive', status: 409 }), false)
assert.equal(receivingDetailsLocked(state, [original]), true)
const saved = line({ key: 'saved', requestId: 'saved-request', status: 'saved' })
assert.equal(commitSessionBlock({ lines: [saved, original], paidAmount: '13', paymentStatus: 'credit', creditDueDate: context.creditDueDate, canViewCosts: true })?.supplierTotalUsd, 6.5)
assert.equal(stockFailureText({ code: 'product_create_outcome_unknown', status: 503 }, key => `translated:${key}`, 'fallback'), 'translated:product_create_outcome_unknown')
assert.equal(stockFailureText({ code: 'product_pending_review' }, key => `translated:${key}`, 'fallback'), 'translated:product_creation_pending_review')
for (const outcome of ['not_sent', 'unknown', 'pending'] as const) {
  const reopened = restoreReceivingSubmissions({ lines: [{ ...held, status: 'error' }], receivingSubmissions: { ...productState, productOutcomes: { [held.key]: outcome } } }, [{ ...held, status: 'error' }])
  assert.equal(reopened.productOutcomes[held.key], outcome)
  assert.equal(receivingDetailsLocked(reopened, [held]), outcome !== 'not_sent')
}
assert.equal(Object.keys(retainReceivingSubmissions(productState, []).productOutcomes).length, 0)
console.log('PASS product uncertainty and pending approval stay distinct; only proven unsent creation unlocks; stock409 and partial receipt accounting remain intact')

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

const createStart = modal.indexOf('  const createHeldProduct = ')
const createEnd = modal.indexOf('  // ---- commit ----', createStart)
assert(createStart > 0 && createEnd > createStart)
const createSource = modal.slice(createStart, createEnd)
const controller = (source: string, response: (payload: Record<string, unknown>, calls: number) => Promise<unknown>) => {
  const entry = line({ ...held, key: 'create-controller' })
  const submissionsRef = { current: empty() }
  let calls = 0, storageFails = false, options = active, persisted: unknown
  const deps = {
    submissionsRef, productCreationRefusal, branchId: '1', user: { id: 7, name: 'Actor' },
    require: () => ({ createProduct: async (payload: Record<string, unknown>) => {
      calls++
      assert.equal((persisted as { productOutcomes: Record<string, string> }).productOutcomes[entry.key], 'unknown')
      return response(payload, calls)
    } }),
    destinationError: (lines: StockSessionLine[]) => receivingDestinationRefusal('1', options, lines, submissionsRef.current),
    persistSubmissionDraft: () => {
      if (storageFails) throw Object.assign(new Error('storage failed'), { code: 'receiving_submission_not_saved' })
      persisted = JSON.parse(JSON.stringify(submissionsRef.current))
    },
    stockFailureText, tr: (key: string) => key,
    extractHistoryResultId: (result: { id?: number }) => result?.id,
  }
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const create = new Function(...Object.keys(deps), js + 'return createHeldProduct;')(...Object.values(deps)) as (entry: StockSessionLine) => Promise<number>
  return { entry, submissionsRef, create, calls: () => calls, retire: () => { options = [] }, failStorage: (fail: boolean) => { storageFails = fail }, reload: () => {
    submissionsRef.current = restoreReceivingSubmissions({ lines: [{ ...entry, status: 'error' }], receivingSubmissions: persisted }, [{ ...entry, status: 'error' }])
  } }
}
for (const retired of [false, true]) {
  const subject = controller(createSource, async () => { throw new TypeError('Failed to fetch after commit') })
  await assert.rejects(subject.create(subject.entry), (error: { code?: string }) => error.code === 'product_create_outcome_unknown')
  if (retired) subject.retire()
  await assert.rejects(subject.create(subject.entry), (error: { code?: string }) => error.code === 'product_create_outcome_unknown')
  subject.reload()
  await assert.rejects(subject.create(subject.entry), (error: { code?: string }) => error.code === 'product_create_outcome_unknown')
  assert.equal(subject.calls(), 1)
}
for (const failure of [Object.assign(new Error('unknown'), { status: 503, code: 'product_create_outcome_unknown', outcome: 'unknown' }), Object.assign(new Error('unknown offline'), { code: 'write_requires_live_server', outcome: 'unknown' }), Object.assign(new Error('refused'), { status: 400 })]) {
  const subject = controller(createSource, async () => { throw failure })
  await assert.rejects(subject.create(subject.entry))
  await assert.rejects(subject.create(subject.entry))
  assert.equal(subject.calls(), 1)
}
const unsent = controller(createSource, async () => ({ id: 72 }))
unsent.failStorage(true)
await assert.rejects(unsent.create(unsent.entry), (error: { code?: string }) => error.code === 'receiving_submission_not_saved')
assert.equal(unsent.calls(), 0)
assert.equal(receivingDetailsLocked(unsent.submissionsRef.current, [unsent.entry]), false)
unsent.failStorage(false)
assert.equal(await unsent.create(unsent.entry), 72)
const offline = controller(createSource, async (_payload, calls) => {
  if (calls === 1) throw Object.assign(new Error('offline before dispatch'), { code: 'write_requires_live_server' })
  return { id: 73 }
})
await assert.rejects(offline.create(offline.entry), (error: { code?: string }) => error.code === 'write_requires_live_server')
assert.equal(receivingDetailsLocked(offline.submissionsRef.current, [offline.entry]), false)
assert.equal(await offline.create(offline.entry), 73)
const pending = controller(createSource, async () => ({ pending: true }))
await assert.rejects(pending.create(pending.entry), (error: { code?: string }) => error.code === 'product_pending_review')
await assert.rejects(pending.create(pending.entry), (error: { code?: string }) => error.code === 'product_pending_review')
assert.equal(pending.calls(), 1)
console.log('PASS actual create controller preserves unknown/pending outcomes and never resends them; proven no-dispatch failures recover')
