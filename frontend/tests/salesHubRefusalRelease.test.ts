import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { directMutationRefusedBeforeWrite } from '../src/utils/directMutationRequest.ts'
import { createFee, getPendingFeeCreate, type FeePayload } from '../src/api/feesTransport.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, getSyncServerUrl, setSyncServerUrl } from '../src/api/http.ts'

for (const [error, expected] of [
  [{ status: 409 }, true], [{ status: 403 }, true], [{ status: 400, code: 'invalid_fee_money' }, true], [{ status: 404 }, true],
  [{ status: 409, code: 'idempotency_conflict' }, false], [{ status: 408 }, false], [{ status: 425 }, false], [{ status: 429 }, false],
  [{ status: 500 }, false], [{ status: 503 }, false], [{ code: 'loader_timeout' }, false], [new TypeError('Failed to fetch'), false], [null, false],
] as const) assert.equal(directMutationRefusedBeforeWrite(error), expected, JSON.stringify(error))
console.log('PASS only a definite handler refusal counts as refused before the write')

const rows = new Map<string, string>()
const storage = { get length() { return rows.size }, key: (index: number) => [...rows.keys()][index] ?? null,
  getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) }, clear: () => rows.clear() }
const oldWindow = globalThis.window, oldFetch = globalThis.fetch, oldUrl = getSyncServerUrl()
const fixture = Object.assign(new EventTarget(), { sessionStorage: storage, localStorage: storage, location: { origin: 'https://hub-refusal.test', hostname: 'hub-refusal.test' }, setTimeout })
const payload: FeePayload = { fee_money_version: 1, fee_type: 'expense', label: 'Fuel', amount_usd: 2, amount_khr: 0, fee_date: '2026-10-05', branch_id: 1, sale_id: null, delivery_contact_id: null, notes: null }
const reply = (status: number, body: Record<string, unknown>) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: fixture })
  setSyncServerUrl('https://hub-refusal.test')
  for (const [status, body] of [[403, { error: 'You do not have permission to perform this action' }], [400, { error: 'Every expense must use the active Shop branch.' }]] as const) {
    __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
    globalThis.fetch = reply(status, body)
    await assert.rejects(createFee(payload, 7), (error: { status?: number }) => error.status === status)
    assert.equal(getPendingFeeCreate(7), null, `a first create refused with ${status} leaves the form editable instead of locked behind a retry`)
  }
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch after the server may have committed') }
  await assert.rejects(createFee(payload, 7))
  const frozen = getPendingFeeCreate(7)
  assert.ok(frozen, 'a lost acknowledgement keeps the create frozen')
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  globalThis.fetch = reply(400, { error: 'Every expense must use the active Shop branch.' })
  await assert.rejects(createFee(frozen.body, 7))
  assert.equal(getPendingFeeCreate(7)?.client_request_id, frozen.client_request_id, 'a refused retry proves nothing about the earlier send, so it stays frozen')
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  globalThis.fetch = reply(409, { error: 'client_request_id was already used with different expense data.', code: 'idempotency_conflict' })
  rows.clear()
  await assert.rejects(createFee(payload, 7))
  assert.ok(getPendingFeeCreate(7), 'an idempotency conflict is not a release')
} finally {
  globalThis.fetch = oldFetch
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: oldWindow })
  setSyncServerUrl(oldUrl)
}
console.log('PASS expense create releases a first send the Worker refused, and keeps lost or retried sends frozen')

function actual(file: string, name: string, env: Record<string, unknown>) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('actual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) initializer = node.initializer; ts.forEachChild(node, visit) }
  visit(parsed)
  assert.ok(initializer, name)
  const code = ts.transpileModule('const actual = ' + initializer.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return new Function('env', 'with(env) { ' + code + '; return actual }')(env)
}
{
  const saved: unknown[] = [], reloads: unknown[] = []
  const memory: { current: { key: string; request: { client_request_id: string } | null } | null } = { current: null }
  const frozenRequest = (): { client_request_id: string } | null => memory.current?.request ?? null
  let fail: unknown = { status: 409, message: 'Return 9 changed.' }
  const env: Record<string, unknown> = {
    useCallback: (fn: unknown) => fn, canBulkReturns: true, tr: (_key: string, english: string) => english,
    beginSingleAction: () => true, finishSingleAction: () => {}, bulkActionInFlightRef: { current: false }, setBulkActionSaving: () => {},
    bulkRetryKey: 'returns.bulk.retry:7', bulkRetryMemory: memory,
    savePendingBulkRequest: (request: { client_request_id: string } | null) => { memory.current = { key: 'returns.bulk.retry:7', request }; saved.push(request) },
    loadReturnsWriteTransport: async () => ({ bulkUpdateReturns: async () => { throw fail } }), withLoaderTimeout: (run: () => unknown) => run(), RETURNS_HISTORY_RESTORE_TIMEOUT_MS: 1,
    loadReturns: async () => { reloads.push('returns') }, notify: () => {}, returnRefusalText: () => null, setSelectedIds: () => {}, actionHistory: { refreshServerItems: async () => {} },
    directMutationRefusedBeforeWrite,
  }
  const apply = actual('../src/components/returns/Returns.tsx', 'applyBulkAction', env)
  await assert.rejects(apply({ client_request_id: 'bulk-first' }))
  assert.equal(memory.current?.request, null, 'a first bulk send refused before the write unlocks Change selected')
  assert.deepEqual(reloads, ['returns'])
  fail = Object.assign(new Error('Bulk return action timed out'), { code: 'loader_timeout' })
  await assert.rejects(apply({ client_request_id: 'bulk-unknown' }))
  assert.equal(frozenRequest()?.client_request_id, 'bulk-unknown', 'an unknown outcome stays frozen')
  fail = { status: 409, message: 'Return 9 changed.' }
  await assert.rejects(apply({ client_request_id: 'bulk-unknown' }))
  assert.equal(frozenRequest()?.client_request_id, 'bulk-unknown', 'a refused Retry of a frozen body stays frozen')
  console.log('PASS actual Returns bulk action releases a refused first send and keeps unknown or retried sends')
}

const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
assert.match(sales, /unpaid \|\| \(!retryRequest && directMutationRefusedBeforeWrite\(error\)\)\) \{\s*savePendingBulkRequest\(null\)\s*void loadSales\(true\)/, 'bulk status releases a refused first send and reloads the rows it was built from')
assert.match(sales, /cancelled \|\| \(!retryRequest && directMutationRefusedBeforeWrite\(error\)\)\) \{\s*savePendingBulkFieldRequest\(null\)\s*void loadSales\(true\)/, 'driver, customer and payment-method group changes release a refused first send')
const modal = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
assert.match(modal, /if \(settlementVersionRef\.current === version \|\| paymentEntryOpen \|\| statusSaving \|\| pendingStatus\) return/, 'an opened, saving or pending payment keeps its reviewed version')
assert.match(modal, /setSettlementSession\(\(current\) => \(\{ \.\.\.next, configuredMethods: current\.configuredMethods, exchangeRate: current\.exchangeRate \}\)\)/, 'an unopened payment starts from the committed row')
const editReturn = fs.readFileSync(new URL('../src/components/returns/EditReturnModal.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(editReturn, /isWriteConflict\(error\)\) \{\s*clearPendingRequest\(\)\s*onSuccess\?\.\(\)/, 'a refused return edit must not record an Undo entry for an edit that never happened')
const fees = fs.readFileSync(new URL('../src/components/fees/FeesPage.tsx', import.meta.url), 'utf8')
assert.match(fees, /const fresh = fees\.find\(\(row\) => Number\(row\.id\) === Number\(selected\.id\)\)\s*if \(fresh && fresh\.updated_at !== selected\.updated_at\) setSelected\(fresh\)/, 'the open expense form follows the reloaded version')
console.log('PASS Sales bulk, payment review, return edit and expense edit wiring')
