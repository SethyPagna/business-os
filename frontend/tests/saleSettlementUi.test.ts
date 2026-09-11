import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import {
  advanceSettlementReviewVersion,
  buildSettlementPayload,
  configuredSettlementMethods,
  initialSettlementRows,
  recordedSettlementIssue,
  settlementRowsIssue,
  settlementTotals,
  type SettlementRow,
} from '../src/components/sales/saleSettlement.ts'
import { createSingleUseResult } from '../src/components/sales/saleStatusConfirmation.ts'
import { directMutationOutcomeIsUnknown, freezeDirectMutationBody, loadPendingDirectMutationSlot, mutationVersionAtLeast, reconcileDirectMutationReceipt, readCommittedMutationState, savePendingDirectMutationSlot } from '../src/utils/directMutationRequest.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const modalSource = read('../src/components/sales/SaleDetailModal.tsx')
const editorSource = read('../src/components/sales/SaleSettlementEditor.tsx')
const salesSource = read('../src/components/sales/Sales.tsx')
const historySource = read('../src/utils/actionHistory.ts')
const workflowSource = read('../src/components/sales/SaleStatusWorkflow.tsx')
const paymentSettlementSource = read('../../cloudflare/src/lib/paymentSettlement.ts')

// Screenshot: sale 20260910-171258, Not Paid -> Completed, ABA $7.
const storageRows = new Map<string, string>()
const storage = { get length() { return storageRows.size }, key: (index: number) => [...storageRows.keys()][index] ?? null, getItem: (key: string) => storageRows.get(key) ?? null, setItem: (key: string, value: string) => { storageRows.set(key, value) }, removeItem: (key: string) => { storageRows.delete(key) } }
const frozen = freezeDirectMutationBody({ client_request_id: 'screenshot-aba-seven', sale_status: 'completed', expected_updated_at: '2026-09-10 10:12:58', expected_exchange_rate: 4100, payment_details: [{ method: 'ABA', amount_usd: 7, amount_khr: 0 }] })
savePendingDirectMutationSlot('sale-status', 7, 171258, frozen, storage)
assert.equal(loadPendingDirectMutationSlot('sale-status', 8, storage), null, 'another actor cannot inherit the request')
let probes = 0
const committed = await reconcileDirectMutationReceipt(async () => {
  probes++
  return probes < 3 ? { committed: false } : { committed: true, response: { id: 171258, updated_at: '2026-09-10 10:13:00' } }
})
assert.equal(probes, 3, 'a stale/missing receipt must not stop the bounded probes')
assert.equal(committed?.id, 171258)
assert.equal(mutationVersionAtLeast('2026-09-10 10:12:58', committed?.updated_at), false)
assert.equal(mutationVersionAtLeast('2026-09-10T10:13:00.000Z', committed?.updated_at), true)
let rowProbes = 0
const authoritativeRow = await readCommittedMutationState(async () => {
  rowProbes += 1
  return rowProbes < 3
    ? { id: 7, sale_status: 'awaiting_payment', updated_at: '2026-09-10 10:12:58' }
    : { id: 7, sale_status: 'completed', updated_at: '2026-09-10T10:13:00.000Z' }
}, (row) => mutationVersionAtLeast(row.updated_at, committed?.updated_at))
assert.equal(rowProbes, 3, 'an existing stale row must not terminate reconciliation')
assert.equal(authoritativeRow?.sale_status, 'completed', 'list and detail consume the same authoritative committed row')
assert.equal(await readCommittedMutationState(async () => ({ updated_at: '2026-09-10 10:12:58' }), (row) => mutationVersionAtLeast(row.updated_at, committed?.updated_at)), null, 'persistent stale reads never fabricate convergence')
assert.equal(await reconcileDirectMutationReceipt(async () => ({ committed: false })), null, 'uncommitted lost response stays unresolved')
assert.deepEqual(loadPendingDirectMutationSlot('sale-status', 7, storage)?.body, frozen, 'read-only reconciliation never changes the frozen tender')
assert.equal(await reconcileDirectMutationReceipt(async () => { throw { status: 409, code: 'idempotency_conflict' } }), null, 'same ID with changed content is not a receipt')
assert.equal(await reconcileDirectMutationReceipt(async () => { throw { status: 403 } }), null, 'revoked permission never acknowledges the write')
assert.equal(directMutationOutcomeIsUnknown({ status: 409, code: 'exchange_rate_changed' }), false)
assert.equal(directMutationOutcomeIsUnknown({ code: 'request_timeout' }), true)
savePendingDirectMutationSlot('sale-status', 7, 171258, null, storage)
assert.equal(loadPendingDirectMutationSlot('sale-status', 7, storage), null)
const statusCatch = salesSource.slice(salesSource.indexOf('const problem = error as { syncErrorId'))
assert.ok(statusCatch.indexOf('savePendingDirectStatus(saleId, null)') < statusCatch.indexOf("code === 'exchange_rate_changed'"), 'known rejection clears the original pending body before the rate-review early return')
assert.doesNotMatch(salesSource, /clearSyncError\?\.\(/, 'unrelated sync errors must survive recovery/discard')

// Execute the production callbacks, not a second implementation of their
// pending-state decisions. The fake server retains one actor/request receipt.
function salesCallback(name: string, endMarker: string, dependencies: Record<string, unknown>, hook = false): (...args: any[]) => Promise<any> {
  const source = salesSource.replace(/\r\n/g, '\n')
  const marker = `const ${name} = ${hook ? 'useCallback(' : ''}`
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= marker.length && end > start)
  const callback = source.slice(start, end) + (hook ? '\n  }' : '')
  const compiled = transformSync(`const callback = ${callback}`, { loader: 'ts', format: 'cjs' }).code
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn callback`)(...Object.values(dependencies))
}

for (const unreadable of ['stale', 'null'] as const) {
  let readMode: string = unreadable
  const before = { id: 171258, receipt_number: '20260910-171258', sale_status: 'awaiting_payment', updated_at: frozen.expected_updated_at, amount_paid_usd: 0 }
  let server = { ...before }
  const receipts = new Map<string, Record<string, unknown>>()
  let stock = 11, recognizedRevenue = 7, auditRows = 0, moneyEffects = 0, sends = 0, resolvedErrors = 0
  const requests: unknown[] = []
  let detail = { ...before }
  const rows = { current: [{ ...before }] }
  savePendingDirectMutationSlot('sale-status', 7, 171258, frozen, storage)
  const readSale = async (_id: number, accept = (_row: typeof before) => true) => readCommittedMutationState(async () => readMode === 'null' ? null : readMode === 'stale' ? { ...before } : { ...server }, accept)
  const deps: Record<string, unknown> = {
    canChangeSaleStatus: true,
    currentPendingDirectStatus: () => loadPendingDirectMutationSlot('sale-status', 7, storage),
    salesRef: rows, pendingStatusProblemRef: { current: null }, statusActionRef: { current: new Set() },
    beginKeyedAction: () => true, finishKeyedAction: () => {}, setDirectStatusSaving: () => {},
    savePendingDirectStatus: (id: number, body: typeof frozen | null) => savePendingDirectMutationSlot('sale-status', 7, id, body, storage),
    runSaleStatusMutation: async (_id: number, body: typeof frozen) => {
      sends += 1
      requests.push(freezeDirectMutationBody(body))
      const key = `actor:7:request:${body.client_request_id}`
      if (!receipts.has(key)) {
        server = { ...server, sale_status: 'completed', updated_at: '2026-09-10 10:13:00', amount_paid_usd: 7 }
        receipts.set(key, { id: server.id, sale_status: server.sale_status, updated_at: server.updated_at, actionKind: 'sale.settlement', actionHistoryId: 1 })
        auditRows += 1; moneyEffects += 1
        throw { code: 'request_timeout', syncErrorId: 'aba-seven-lost', syncErrorChannel: 'sales:updateStatus' }
      }
      return receipts.get(key)
    },
    getSaleStatusReceipt: async (_id: number, body: typeof frozen) => ({ committed: true, response: receipts.get(`actor:7:request:${body.client_request_id}`) }),
    reconcileDirectMutationReceipt, mutationVersionAtLeast, readAuthoritativeSale: readSale,
    directMutationOutcomeIsUnknown, freezeDirectMutationBody,
    dispatchResolvedSyncError: () => { resolvedErrors += 1 },
    loadSales: async () => { rows.current = [{ ...before }] },
    setSales: (next: typeof rows.current) => { rows.current = next },
    setDetailSale: (update: (row: typeof detail) => typeof detail) => { detail = update(detail) },
    loadSalesStats: async () => {}, actionHistory: { refreshServerItems: async () => {}, pushAction: () => { throw new Error('settlement must not add duplicate local history') } },
    window: { setTimeout: (callback: () => void) => callback(), dispatchEvent: () => {} },
    notify: () => {}, t: (key: string) => key, translateOr: (_key: string, fallback: string) => fallback,
    getStatusLabel: (value: string) => value, getErrorMessage: (error: unknown) => String(error), isWriteConflict: () => false,
  }
  deps.resolveUnknownSaleWrite = salesCallback('resolveUnknownSaleWrite', '\n  }, [actionHistory', deps, true)
  const handle = salesCallback('handleStatusChange', '\n  const replaySaleStatusHistory', deps)
  const result = await handle(171258, 'completed', '', true, frozen, true, frozen)
  assert.ok(result.settlementError, `${unreadable}: exact receipt alone keeps recovery open`)
  assert.equal(resolvedErrors, 0, 'no global error resolution before visible state converges')
  assert.deepEqual(loadPendingDirectMutationSlot('sale-status', 7, storage)?.body, frozen)
  assert.equal(detail.sale_status, 'awaiting_payment')
  assert.equal(await handle(171258, 'completed', '', true, frozen, true), false, 'new work is blocked while original recovery is pending')
  assert.equal(sends, 1)
  const replayWhileStale = await handle(171258, 'completed', '', true, frozen, true, frozen)
  assert.ok(replayWhileStale.settlementError, 'even a successful idempotent replay retains the convergence guard')
  assert.ok(loadPendingDirectMutationSlot('sale-status', 7, storage))
  readMode = 'fresh'
  const recovered = await handle(171258, 'completed', '', true, frozen, true, frozen)
  assert.equal(recovered.statusUpdatedAt, server.updated_at)
  assert.equal(loadPendingDirectMutationSlot('sale-status', 7, storage), null)
  assert.deepEqual(rows.current[0], server)
  assert.deepEqual(detail, server)
  assert.equal(server.amount_paid_usd, 7)
  assert.equal(stock, 11); assert.equal(recognizedRevenue, 7)
  assert.equal(auditRows, 1); assert.equal(moneyEffects, 1)
  assert.ok(requests.every((body) => JSON.stringify(body) === JSON.stringify(frozen)), 'every retry retains exact tender, request and expected version')
}
console.log('PASS production Sales callbacks retain exact ABA $7 recovery across stale/null reads and idempotent replay until list/detail converge')

const confirmedResult = createSingleUseResult<{ statusUpdatedAt: string } | false>()
assert.equal(confirmedResult.isPending(), true)
assert.equal(confirmedResult.settle({ statusUpdatedAt: 'confirmed-version' }), true)
assert.equal(confirmedResult.settle(false), false, 'a late cancel cannot replace a confirmed mutation result')
assert.deepEqual(await confirmedResult.promise, { statusUpdatedAt: 'confirmed-version' })
assert.equal(confirmedResult.isPending(), false)

const unmountedResult = createSingleUseResult<boolean>()
assert.equal(unmountedResult.settle(false), true, 'unmount cleanup releases an open confirmation request')
assert.equal(await unmountedResult.promise, false)

const replacedResult = createSingleUseResult<boolean>()
const replacementResult = createSingleUseResult<{ statusUpdatedAt: string }>()
assert.equal(replacedResult.settle(false), true, 'opening a newer confirmation releases the replaced caller')
assert.equal(await replacedResult.promise, false)
assert.equal(replacementResult.isPending(), true, 'settling the replaced request does not settle the replacement')
assert.equal(replacementResult.settle({ statusUpdatedAt: 'replacement-version' }), true)
assert.deepEqual(await replacementResult.promise, { statusUpdatedAt: 'replacement-version' })

// MAX_SETTLEMENT_ROWS gates what the editor will let a review submit;
// MAX_SETTLEMENT_TENDER_ROWS (paymentSettlement.ts, enforced at
// input.paymentDetailsRaw.length > MAX_SETTLEMENT_TENDER_ROWS) is what the
// Worker actually rejects. Nothing compared the two constants, so either
// file could drift its cap alone -- the editor blocking a review the server
// would in fact accept, or letting through one the server refuses -- with
// no test noticing. Same extract-and-assert-equal pattern as
// feeLabelClamp.test.ts:62-63.
function extractNumericConst(source: string, name: string): number {
  const re = new RegExp(`const ${name} = (\\d+)`)
  const match = source.match(re)
  assert.ok(match, `${name} not found -- source may have changed`)
  return Number(match![1])
}

assert.equal(
  extractNumericConst(editorSource, 'MAX_SETTLEMENT_ROWS'),
  extractNumericConst(paymentSettlementSource, 'MAX_SETTLEMENT_TENDER_ROWS'),
  'the editor review cap and the server enforcement cap must be the same number',
)

const preStatusReview = {
  expectedUpdatedAt: 'sale-before-status',
  rows: [{ id: 'typed', method: 'ABA Bank', usd: '300', khr: '' }],
}
const postStatusReview = advanceSettlementReviewVersion(preStatusReview, {
  statusUpdatedAt: 'sale-after-credit',
})
assert.equal(postStatusReview.expectedUpdatedAt, 'sale-after-credit', 'the next payment review uses the status write version')
assert.strictEqual(postStatusReview.rows, preStatusReview.rows, 'refreshing the version does not replace entered tender rows')
assert.strictEqual(
  advanceSettlementReviewVersion(postStatusReview, { settlementError: 'This sale changed on another device' }),
  postStatusReview,
  'a real conflict keeps the reviewed version and entered tender state intact',
)

assert.deepEqual(
  configuredSettlementMethods([' Cash ', 'ABA Bank', 'aba bank', 'Pi Pay', 'Transfer', 'Wing']),
  ['Cash', 'ABA Bank', 'Wing'],
  'configured selector options use canonical spelling, casefold dedupe, and exclude retired methods',
)
assert.deepEqual(configuredSettlementMethods([]), [], 'an explicit empty configuration must block settlement')
assert.deepEqual(configuredSettlementMethods('not-json'), [], 'a malformed configuration must not invent active tenders')
assert.deepEqual(configuredSettlementMethods(undefined), [], 'a missing configuration must not invent active tenders')

const partial = initialSettlementRows({
  paymentDetails: [
    { method: 'cash', amount_usd: 3, amount_khr: 0 },
    { method: 'ABA Bank', amount_usd: 0, amount_khr: 12600 },
  ],
  paymentMethod: 'Cash + ABA Bank',
  amountPaidUsd: 3,
  amountPaidKhr: 12600,
  totalUsd: 10,
  exchangeRate: 4200,
  configuredMethods: ['Cash', 'ABA Bank'],
})
assert.deepEqual(partial.slice(0, 2).map(({ method, usd, khr }) => ({ method, usd, khr })), [
  { method: 'Cash', usd: '3', khr: '' },
  { method: 'ABA Bank', usd: '', khr: '12600' },
])
assert.equal(partial[2]?.usd, '4.00', 'latest reviewed settings rate calculates a cent-precision outstanding row')
assert.deepEqual(settlementTotals([
  { id: 'precision', method: 'Cash', usd: '1.005', khr: '' },
], 4100), { amountPaidUsd: 1.005, amountPaidKhr: 0, paidEquivalentUsd: 1.005 })

const repeated: SettlementRow[] = [
  { id: 'recorded-a', method: 'cash', usd: '1.005', khr: '' },
  { id: 'b', method: 'Cash', usd: '', khr: '500' },
]
assert.equal(settlementRowsIssue(repeated, ['Cash']), null, 'POS tender rows may repeat the same configured method')
assert.deepEqual(buildSettlementPayload(repeated, ['Cash']), {
  payment_details: [
    { method: 'Cash', amount_usd: 1.005, amount_khr: 0 },
    { method: 'Cash', amount_usd: 0, amount_khr: 500 },
  ],
}, 'the full ordered native tender snapshot is submitted without aggregate fields')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Cash', usd: '-1', khr: '' }], ['Cash']), 'amount')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Cash', usd: '1.005', khr: '' }], ['Cash']), 'amount', 'new USD tender must use cents')
assert.equal(settlementRowsIssue([{ id: 'recorded-x', method: 'Retired', usd: '1.005', khr: '' }], ['Cash']), null, 'an existing legacy 4dp inactive tender remains unchanged')
assert.equal(settlementRowsIssue([{ id: 'recorded-khr', method: 'Retired', usd: '', khr: '4100.1234' }], ['Cash']), null, 'an existing legacy 4dp KHR tender remains unchanged')
assert.equal(settlementRowsIssue([{ id: 'recorded-khr', method: 'Retired', usd: '', khr: '4100.12345' }], ['Cash']), 'amount', 'recorded KHR beyond legacy 4dp is invalid')
assert.equal(settlementRowsIssue([{ id: 'recorded-x', method: 'Retired', usd: '1.005', khr: '' }], ['Cash'], true), 'method', 'a correction must replace retired tender methods')
assert.equal(settlementRowsIssue([{ id: 'recorded-x', method: 'Cash', usd: '1.005', khr: '' }], ['Cash'], true), 'amount', 'a corrected USD tender must use cents')
assert.deepEqual(buildSettlementPayload([{ id: 'recorded-x', method: 'Cash', usd: '1.235', khr: '4100.4' }], ['Cash'], true), {
  payment_details: [{ method: 'Cash', amount_usd: 1.24, amount_khr: 4100 }],
}, 'payment correction submits a new cent/integer tender snapshot rather than preserving malformed legacy precision')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Cash', usd: '', khr: '1.5' }], ['Cash']), 'amount')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Unknown', usd: '1', khr: '' }], ['Cash']), 'method')

assert.equal(recordedSettlementIssue({ paymentDetails: '{bad', amountPaidUsd: 0, amountPaidKhr: 0 }), 'malformed')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 'oops' }], amountPaidUsd: 0, amountPaidKhr: 0 }), 'malformed')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 3 }], amountPaidUsd: 2, amountPaidKhr: 0 }), 'mismatch')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 3 }], amountPaidUsd: 3, amountPaidKhr: 0 }), null)
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 1.2349 }], amountPaidUsd: 1.23, amountPaidKhr: 0 }), 'mismatch', 'header and lines compare at exact 4dp precision')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 2.1234, amount_khr: 4100.1234 }], amountPaidUsd: 2.1234, amountPaidKhr: 4100.1234 }), null, 'legacy USD and KHR components compare at exact 4dp precision')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_khr: 4100.12345 }], amountPaidUsd: 0, amountPaidKhr: 4100.12345 }), 'malformed', 'recorded KHR beyond legacy 4dp requires repair')
assert.equal(recordedSettlementIssue({ paymentDetails: null, paymentMethod: 'Cash + ABA Bank', amountPaidUsd: 3, amountPaidKhr: 0 }), 'allocation')

const legacyNative = initialSettlementRows({
  paymentDetails: [{ method: 'Retired', amount_usd: 2.1234, amount_khr: 4100.1234 }],
  paymentMethod: 'Retired',
  amountPaidUsd: 2.1234,
  amountPaidKhr: 4100.1234,
  totalUsd: 5,
  exchangeRate: 4100,
  configuredMethods: ['Cash'],
})
assert.deepEqual(legacyNative[0], { id: 'recorded-0', method: 'Retired', usd: '2.1234', khr: '4100.1234' })
assert.deepEqual(settlementTotals([legacyNative[0]], 4100), {
  amountPaidUsd: 2.1234,
  amountPaidKhr: 4100.1234,
  paidEquivalentUsd: 2.1234 + 4100.1234 / 4100,
})
assert.deepEqual(buildSettlementPayload([
  legacyNative[0],
  { id: 'new-usd', method: 'Cash', usd: '1.88', khr: '' },
  { id: 'new-khr', method: 'Cash', usd: '', khr: '25' },
], ['Cash']), {
  payment_details: [
    { method: 'Retired', amount_usd: 2.1234, amount_khr: 4100.1234 },
    { method: 'Cash', amount_usd: 1.88, amount_khr: 0 },
    { method: 'Cash', amount_usd: 0, amount_khr: 25 },
  ],
}, 'recorded native precision survives while new components keep 2/0 precision')

assert.doesNotMatch(editorSource, /<select[\s>]/, 'settlement editor must not add a native select')
assert.match(editorSource, /min-h-11/, 'method targets remain at least 44px tall')
assert.match(editorSource, /h-11 w-11/, 'row removal remains a 44px touch target')
assert.match(editorSource, /grid-cols-1[\s\S]*sm:grid-cols-2/, 'USD and KHR controls stay legible at 320px')
assert.match(editorSource, /disabled=\{saving \|\|/, 'editor controls lock while the settlement request runs')
assert.match(editorSource, /!allowRecordedEdits && \(rows\.length === 1 \|\| row\.id\.startsWith\('recorded-'\)\)/, 'ordinary recorded tender rows remain protected from deletion')
assert.match(editorSource, /row\.id\.startsWith\('recorded-'\) && !allowRecordedEdits/, 'ordinary recorded amounts remain read-only while correction mode enables them')
assert.match(editorSource, /sale_payment_correction_hint/, 'correction mode explains that it creates an audited correction receipt')
assert.doesNotMatch(editorSource, /Math\.round\(exchangeRate\)/, 'the reviewed quote display must not drop a noninteger server rate')
assert.match(editorSource, /exchangeRate\.toLocaleString\(undefined, \{ maximumFractionDigits: 4 \}\)/, 'the normalized server rate remains visible to four decimal places')
assert.match(editorSource, /sale_settlement_rows_limit/, 'legacy records above the server row limit have a localized review message')
assert.match(editorSource, /rows\.length > MAX_SETTLEMENT_ROWS\s*\? rowsLimitMessage/, 'the row-limit message becomes the blocking review error')
assert.doesNotMatch(editorSource, /rows\.(?:slice|splice)\(/, 'legacy payment rows must never be truncated to fit the limit')
assert.match(modalSource, /confirmDisabled=\{pendingStatus \|\| \(needsPaymentEntry && \(!paymentConfigReady \|\| settlementRows\.length > MAX_SETTLEMENT_ROWS\)\)\}/, 'unknown outcomes, unverified configuration and legacy records above the backend limit cannot submit a new review')
assert.match(workflowSource, /disabled=\{saving \|\| confirmDisabled \|\| selectedStatus === currentStatus\}/, 'the workflow disables a blocked settlement confirmation')
assert.match(modalSource, /client_request_id:\s*settlementRequestIdRef\.current/, 'retries reuse one reviewed request id')
assert.match(modalSource, /expected_exchange_rate:\s*settlementSession\.exchangeRate/, 'the server guards the reviewed exchange-rate quote')
assert.match(modalSource, /expected_updated_at:\s*settlementSession\.expectedUpdatedAt/, 'the reviewed sale revision is frozen with the tender')
assert.match(modalSource, /replace_existing_payment:\s*paymentCorrection/, 'the Worker receives an explicit replacement flag only for a reopened completed sale')
assert.match(modalSource, /allowRecordedEdits=\{paymentCorrection\}/, 'recorded tender editing is scoped to server-authorized correction mode')
assert.match(modalSource, /payment_correction_allowed/, 'the list response controls correction eligibility; the client does not infer it from history')
assert.match(modalSource, /exchangeRateChanged[\s\S]*?sale_settlement_rate_changed/, 'a stale quote refreshes the preview and requires another confirmation')
assert.match(modalSource, /showNotes=\{!needsPaymentEntry\}/, 'settlement hides the unsupported notes control while normal status reviews retain it')
assert.match(workflowSource, /showNotes \? <div>[\s\S]*?sale-status-notes/, 'the workflow conditionally renders its existing notes draft')
assert.match(modalSource, /settlementError[\s\S]*?setPayError\(settlementError\)/, 'a failed settlement remains visible inside its review')
assert.match(salesSource, /mutationResult\?\.updated_at[\s\S]*?\{ statusUpdatedAt \}/, 'a successful status write returns its authoritative sale version to the open detail')
const singleStatusPromptBranch = salesSource.slice(
  salesSource.indexOf('if (recordHistory && !extra && !confirmed)'),
  salesSource.indexOf('const actionKey = String(numericId)'),
)
assert.match(singleStatusPromptBranch, /pendingStatusResultRef\.current = pendingResult[\s\S]*?replacedResult\?\.settle\(false\)/, 'a newer confirmation owns the ref and releases the replaced detail request')
assert.match(singleStatusPromptBranch, /setStatusPrompt\([\s\S]*?pendingResult,[\s\S]*?return await pendingResult\.promise/, 'the original detail request remains pending on the prompt result until confirmation')
const statusConfirmSurface = salesSource.slice(
  salesSource.indexOf('{statusPrompt ? ('),
  salesSource.indexOf('{pendingBulkFieldRequest ? ('),
)
assert.match(statusConfirmSurface, /const result = await handleStatusChange\([\s\S]*?true\)[\s\S]*?pendingStatusResultRef\.current === prompt\.pendingResult[\s\S]*?prompt\.pendingResult\.settle\(result\)/, 'the confirmed parent write returns its authoritative result only to the matching detail flow')
assert.match(statusConfirmSurface, /pendingStatusResultRef\.current === prompt\.pendingResult[\s\S]*?prompt\.pendingResult\.settle\(false\)/, 'cancelling the parent confirmation releases only the matching detail request without a mutation')
assert.doesNotMatch(statusConfirmSurface, /if \(statusPrompt\.mode === 'single'\) \{\s*await handleStatusChange/, 'the confirmed single-sale result must never be discarded')
assert.match(salesSource, /useEffect\(\(\) => \(\) => \{\s*pendingStatusResultRef\.current\?\.settle\(false\)\s*pendingStatusResultRef\.current = null/, 'Sales unmount releases an open confirmation request before clearing page state')
assert.match(modalSource, /setSettlementSession\(\(current\) => advanceSettlementReviewVersion\(current, result\)\)/, 'the next same-modal payment review advances to the committed status version')
assert.match(modalSource, /settlementSession\.exchangeRate/, 'the editor and coverage preview use the frozen settings rate')
assert.match(modalSource, /useCloseGuard\(\{ dirty: settlementDirty \|\| addLines.length > 0/, 'edited tender, item and amendment rows are protected by the standard close guard')
assert.match(modalSource, /setStatusReviewRequestId\(\(requestId\) => requestId \+ 1\)/, 'Record payment explicitly opens the status review step')
assert.match(workflowSource, /reviewRequestId > 0\) setStep\('review'\)/, 'the workflow honors an external review request without changing its normal destination flow')
assert.doesNotMatch(modalSource, /payment_method:\s*method[\s\S]{0,120}amount_paid_usd/, 'settlement no longer sends derived payment aggregates')
assert.match(salesSource, /hasServerSettlementHistory[\s\S]*?refreshServerItems/, 'server settlement history replaces the local status-only history entry')
assert.match(salesSource, /code\?: unknown \}\)\.code === 'exchange_rate_changed'[\s\S]*?exchangeRateChanged/, 'Sales returns the server current rate to the open review')
assert.match(salesSource, /isSettlementRequest \? undefined : notes/, 'settlement payloads omit the empty notes field required by the server contract')
assert.match(salesSource, /if \(isSettlementRequest\) \{[\s\S]*?return \{ settlementError: detail \}/, 'settlement request failures return to the open modal with localized retry guidance')
assert.match(salesSource, /const isSettlementRequest = Array\.isArray\(\(extra as \{ payment_details\?: unknown \} \| null\)\?\.payment_details\)\s*\n\s*\|\| Array\.isArray\(\(preparedRetry as \{ payment_details\?: unknown \} \| null\)\?\.payment_details\)/, 'a retry keeps settlement semantics when it comes from the frozen request body')
assert.match(salesSource, /if \(!preparedRetry\) savePendingDirectStatus\(saleId, preparedRequest, historyContext\)/, 'the exact settlement body is persisted before its network write')
assert.match(salesSource, /const mutationResult = await runSaleStatusMutation[\s\S]*?savePendingDirectStatus\(saleId, null\)/, 'a confirmed response clears the pending settlement retry')
assert.match(salesSource, /directMutationOutcomeIsUnknown\(error\)[\s\S]*?savePendingDirectStatus\(saleId, null\)/, 'known settlement failures clear safely while unknown outcomes retain the retry')
assert.match(salesSource, /await handleStatusChange\([\s\S]*?pending\.body,\s*history,\s*\)/, 'retry submits the exact frozen settlement payload including payment details')
assert.match(historySource, /applier === 'sale\.settlement'/, 'settlement undo and redo include optimistic generation checks')

console.log('PASS awaiting-payment multi-tender settlement UI contract')
