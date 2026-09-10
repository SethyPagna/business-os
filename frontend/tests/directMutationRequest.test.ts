import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import {
  DIRECT_MUTATION_MAX_PENDING,
  DIRECT_MUTATION_RECONCILE_AFTER_MS,
  directMutationOutcomeIsUnknown,
  directMutationStorageKey,
  freezeDirectMutationBody,
  loadPendingDirectMutation,
  loadPendingDirectMutationSlot,
  pendingDirectMutationForScope,
  savePendingDirectMutation,
  savePendingDirectMutationSlot,
} from '../src/utils/directMutationRequest.ts'

const require = createRequire(import.meta.url)

function loadTransport(relative: string, mocks: Record<string, unknown>): Record<string, (...args: any[]) => any> {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, (...args: any[]) => any> }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

class MemoryStorage {
  private rows = new Map<string, string>()
  failWrites = false
  get length() { return this.rows.size }
  key(index: number) { return [...this.rows.keys()][index] ?? null }
  getItem(key: string) { return this.rows.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('quota')
    this.rows.set(key, value)
  }
  removeItem(key: string) { this.rows.delete(key) }
}

let failed = 0
async function test(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await test('pending bodies are frozen and scoped by actor plus entity', () => {
  const storage = new MemoryStorage()
  const source = { expected_updated_at: 'rev-1', client_request_id: 'same-request', nested: [{ quantity: 2 }] }
  const pending = savePendingDirectMutation('return-edit', 7, 44, source, storage)
  source.nested[0].quantity = 99
  assert.deepEqual(pending?.body, { expected_updated_at: 'rev-1', client_request_id: 'same-request', nested: [{ quantity: 2 }] })
  assert.deepEqual(loadPendingDirectMutation('return-edit', 7, 44, storage)?.body, pending?.body)
  assert.equal(loadPendingDirectMutation('return-edit', 8, 44, storage), null)
  assert.equal(loadPendingDirectMutation('return-edit', 7, 45, storage), null)
  assert.notEqual(directMutationStorageKey('return-edit', 7, 44), directMutationStorageKey('sale-status', 7, 44))
})

await test('one actor-scoped status slot retains the exact target and body across reload', () => {
  const storage = new MemoryStorage()
  const body = { client_request_id: 'sale-status-1', expected_updated_at: 'sale-rev-1', sale_status: 'cancelled', cancel_reason: 'mistake' }
  const history = { entryId: 'history-31', direction: 'undo' as const }
  savePendingDirectMutationSlot('sale-status', 7, 31, body, storage, history, 1000)
  const restored = loadPendingDirectMutationSlot<typeof body>('sale-status', 7, storage, 1000 + DIRECT_MUTATION_RECONCILE_AFTER_MS + 1)
  assert.equal(restored?.entityId, '31')
  assert.deepEqual(restored?.body, body)
  assert.deepEqual(restored?.history, history)
  assert.equal(restored?.needsReconciliation, true)
  assert.equal(loadPendingDirectMutationSlot('sale-status', 8, storage), null)
  savePendingDirectMutationSlot('sale-status', 7, 31, null, storage)
  assert.equal(loadPendingDirectMutationSlot('sale-status', 7, storage), null)
})

await test('transition-window senders reject stale actor and target bodies synchronously', () => {
  const storage = new MemoryStorage()
  const body = { client_request_id: 'return-edit-44', expected_updated_at: 'return-rev-1', reason: 'Damaged' }
  const pending = savePendingDirectMutation('return-edit', 7, 44, body, storage)
  assert.ok(pending)

  const sent: unknown[] = []
  const invokeSender = (actorId: unknown, entityId: unknown) => {
    const active = pendingDirectMutationForScope(pending, actorId, entityId)
    if (active) sent.push(active.body)
  }

  invokeSender(8, 44)
  invokeSender(7, 45)
  assert.deepEqual(sent, [], 'a pre-effect actor or target transition cannot send the stale body')

  invokeSender('7', '44')
  assert.deepEqual(sent, [body], 'the matching scope retries the exact frozen body')
  assert.equal(pendingDirectMutationForScope(pending, '', 44), null, 'an unidentified actor never shares a pending scope')

  const currentActorBody = { client_request_id: 'return-edit-55', expected_updated_at: 'return-rev-2', reason: 'Wrong item' }
  savePendingDirectMutation('return-edit', 8, 55, currentActorBody, storage)
  const resolvedDuringTransition = pendingDirectMutationForScope(pending, 8, 55)
    || loadPendingDirectMutation<typeof currentActorBody>('return-edit', 8, 55, storage)
  assert.deepEqual(resolvedDuringTransition?.body, currentActorBody, 'the new actor/target storage slot is visible before an effect copies it into state')
})

await test('transition-window discard and new submit stay inside the current scope', () => {
  const storage = new MemoryStorage()
  const oldEdit = savePendingDirectMutation('return-edit', 7, 44, { client_request_id: 'old-edit' }, storage)
  assert.equal(pendingDirectMutationForScope(oldEdit, 7, 45), null, 'target 45 cannot expose target 44 retry controls')

  const freshEdit = savePendingDirectMutation('return-edit', 7, 45, { client_request_id: 'fresh-edit' }, storage)
  assert.equal(loadPendingDirectMutation('return-edit', 7, 44, storage)?.body.client_request_id, 'old-edit', 'new submit preserves the unresolved old target')
  assert.equal(loadPendingDirectMutation('return-edit', 7, 45, storage)?.body.client_request_id, 'fresh-edit')
  if (pendingDirectMutationForScope(freshEdit, 7, 45)) savePendingDirectMutation('return-edit', 7, 45, null, storage)
  assert.equal(loadPendingDirectMutation('return-edit', 7, 45, storage), null, 'discard clears the current target')
  assert.equal(loadPendingDirectMutation('return-edit', 7, 44, storage)?.body.client_request_id, 'old-edit', 'discard cannot erase another target')

  const oldStatus = savePendingDirectMutationSlot('sale-status', 7, 31, { client_request_id: 'old-status' }, storage)
  assert.equal(pendingDirectMutationForScope(oldStatus, 8), null, 'actor 8 cannot expose actor 7 retry controls')
  savePendingDirectMutationSlot('sale-status', 8, 32, { client_request_id: 'fresh-status' }, storage)
  assert.equal(loadPendingDirectMutationSlot('sale-status', 7, storage)?.body.client_request_id, 'old-status', 'new actor submit cannot overwrite the old actor slot')
  assert.equal(loadPendingDirectMutationSlot('sale-status', 8, storage)?.body.client_request_id, 'fresh-status')
})

await test('pending storage is actor-required, bounded, and fails closed before a write can start', () => {
  const storage = new MemoryStorage()
  assert.throws(() => savePendingDirectMutation('return-edit', null, 1, { client_request_id: 'missing-actor' }, storage), /signed-in user/)
  assert.throws(() => directMutationStorageKey('return-edit', '', 1), /signed-in user/)
  for (let id = 1; id <= DIRECT_MUTATION_MAX_PENDING; id += 1) {
    savePendingDirectMutation('return-edit', 7, id, { client_request_id: `request-${id}` }, storage, null, 1000)
  }
  assert.throws(
    () => savePendingDirectMutation('return-edit', 7, DIRECT_MUTATION_MAX_PENDING + 1, { client_request_id: 'overflow' }, storage),
    /too many earlier requests/,
  )
  assert.equal(loadPendingDirectMutation('return-edit', 7, 1, storage, 1000 + DIRECT_MUTATION_RECONCILE_AFTER_MS + 1)?.needsReconciliation, true)
  assert.equal(storage.length, DIRECT_MUTATION_MAX_PENDING, 'unresolved old entries remain visible and block fresh identities instead of being pruned')

  const quota = new MemoryStorage()
  quota.failWrites = true
  assert.throws(() => savePendingDirectMutation('return-edit', 7, 44, { client_request_id: 'quota-failure' }, quota), /request was not sent/)
  assert.equal(loadPendingDirectMutation('return-edit', 7, 44, quota), null)
})

await test('stored retry records without a prepared request id are ignored', () => {
  const storage = new MemoryStorage()
  storage.setItem(directMutationStorageKey('return-edit', 7, 44), JSON.stringify({
    version: 1,
    kind: 'return-edit',
    actorId: '7',
    entityId: '44',
    body: { expected_updated_at: 'return-rev-1' },
  }))
  assert.equal(loadPendingDirectMutation('return-edit', 7, 44, storage), null)
  const slotKey = 'businessos_pending_return-history_v2:7:active'
  storage.setItem(slotKey, JSON.stringify({ version: 1, kind: 'return-history', actorId: '7', entityId: '44', body: {} }))
  assert.equal(loadPendingDirectMutationSlot('return-history', 7, storage), null)
})

await test('unknown outcome classifier retains only responses that may have committed', () => {
  assert.equal(directMutationOutcomeIsUnknown({ code: 'loader_timeout' }), true)
  assert.equal(directMutationOutcomeIsUnknown({ code: 'request_timeout' }), true)
  assert.equal(directMutationOutcomeIsUnknown({ status: 503 }), true)
  assert.equal(directMutationOutcomeIsUnknown(new SyntaxError('Unreadable response')), true)
  assert.equal(directMutationOutcomeIsUnknown({ code: 'write_requires_live_server', reason: 'server_unreachable' }), true)
  assert.equal(directMutationOutcomeIsUnknown({ status: 409, code: 'write_conflict' }), false)
  assert.equal(directMutationOutcomeIsUnknown({ status: 400, code: 'invalid_request' }), false)
  assert.equal(directMutationOutcomeIsUnknown({ code: 'write_requires_live_server', reason: 'server_offline' }), false)
  assert.equal(directMutationOutcomeIsUnknown({ code: 'pending_request_persistence_failed' }), false)
  assert.equal(directMutationOutcomeIsUnknown({ name: 'AbortError' }), false)
})

await test('sale status retries send the exact prepared body and client request id', async () => {
  const requests: unknown[] = []
  const sales = loadTransport('../src/api/salesTransport.ts', {
    'constants.ts': { SYNC: { REQUEST_TIMEOUT_MS: 20000 } },
    'deviceInfo.ts': { getClientDeviceInfo: () => ({ client_id: 'device-1' }) },
    'expectedUpdatedAt.ts': { withExpectedUpdatedAt: async (_table: string, _id: unknown, body: Record<string, unknown>) => ({ expected_updated_at: body.expected_updated_at || 'sale-rev-1', ...body }) },
    'http.ts': { apiFetch: async (method: string, path: string, body: unknown) => { requests.push(freezeDirectMutationBody({ method, path, body })); return { id: 31, sale_status: 'cancelled', updated_at: 'sale-rev-2' } }, route: async (_channel: string, fn: () => unknown) => fn(), cacheInvalidate: () => {} },
    'lazyLocalDb.ts': { getLocalDb: async () => ({ table: () => ({ update: async () => 1, orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }) }) },
    'localMirrors.ts': { mirrorReadResult: (_mirror: unknown, value: unknown) => value, mirrorTable: () => null },
    'query.ts': { appendQuery: (path: string) => path, buildQueryString: () => '' },
    'requestIds.ts': { ensureClientRequestId: (body: Record<string, unknown>) => ({ ...body, client_request_id: body.client_request_id || 'sale-status-fixed' }) },
    'contactOptionUtils.ts': { contactDisplayAddress: () => '' },
  })
  const body = await sales.prepareSaleStatusRequest(31, 'cancelled', 'note', { cancel_reason: 'mistake' })
  await sales.submitSaleStatusRequest(31, body)
  await sales.submitSaleStatusRequest(31, body)
  assert.equal(body.client_request_id, 'sale-status-fixed')
  assert.equal(body.expected_updated_at, 'sale-rev-1')
  assert.deepEqual(requests[0], requests[1])
})

await test('return edit retries send the exact prepared body and client request id', async () => {
  const requests: unknown[] = []
  const returns = loadTransport('../src/api/returnsTransport.ts', {
    'deviceInfo.ts': { getClientDeviceInfo: () => ({ client_id: 'device-1' }) },
    'timestampId.ts': { businessDateTimeId: () => '20260908-150000' },
    'conflicts.ts': { buildAttemptedReturnItems: (items: unknown) => items },
    'expectedUpdatedAt.ts': { withExpectedUpdatedAt: async (_table: string, _id: unknown, body: Record<string, unknown>) => ({ expected_updated_at: body.expected_updated_at || 'return-rev-1', ...body }) },
    'http.ts': { apiFetch: async (method: string, path: string, body: unknown) => { requests.push(freezeDirectMutationBody({ method, path, body })); return { id: 44, updated_at: 'return-rev-2' } }, route: async (_channel: string, fn: () => unknown) => fn() },
    'lazyLocalDb.ts': { getLocalDb: async () => ({ table: () => ({ update: async () => 1 }) }) },
    'requestIds.ts': { ensureClientRequestId: (body: Record<string, unknown>) => ({ ...body, client_request_id: body.client_request_id || 'return-edit-fixed' }) },
    'returnsReadTransport.ts': { getReturn: async () => null, getReturns: async () => [] },
  })
  const body = await returns.prepareReturnUpdateRequest(44, { reason: 'Damaged', items: [{ product_id: 9, quantity: 1 }] })
  await returns.submitReturnUpdateRequest(44, body)
  await returns.submitReturnUpdateRequest(44, body)
  assert.equal(body.client_request_id, 'return-edit-fixed')
  assert.equal(body.expected_updated_at, 'return-rev-1')
  assert.deepEqual(requests[0], requests[1])
})

await test('prepared senders refuse a missing client request id before the API call', async () => {
  let calls = 0
  const common = {
    'deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
    'expectedUpdatedAt.ts': { withExpectedUpdatedAt: async (_table: string, _id: unknown, body: unknown) => body },
    'http.ts': { apiFetch: async () => { calls += 1 }, route: async (_channel: string, fn: () => unknown) => fn(), cacheInvalidate: () => {} },
    'lazyLocalDb.ts': { getLocalDb: async () => ({ table: () => ({ update: async () => 1 }) }) },
    'requestIds.ts': { ensureClientRequestId: (body: unknown) => body },
  }
  const returns = loadTransport('../src/api/returnsTransport.ts', { ...common, 'timestampId.ts': { businessDateTimeId: () => '' }, 'conflicts.ts': { buildAttemptedReturnItems: () => [] }, 'returnsReadTransport.ts': {} })
  await assert.rejects(() => returns.submitReturnUpdateRequest(1, {}), /prepared client_request_id/)
  assert.equal(calls, 0)
})

await test('direct-write UI exposes manual exact retry and freezes return edits after unknown outcome', () => {
  const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  const editReturn = readFileSync(new URL('../src/components/returns/EditReturnModal.tsx', import.meta.url), 'utf8')
  const returns = readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
  assert.match(sales, /const pending = currentPendingDirectStatus\(\)[\s\S]*await handleStatusChange\([\s\S]*pending\.body,/)
  assert.match(sales, /newStatus === 'cancelled'[\s\S]*!extra && !preparedRetry/)
  assert.match(sales, /statusReplayExtra\(preparedRetry\)/)
  assert.doesNotMatch(sales, /redo:[^\n]*preparedRetry\)/)
  assert.match(sales, /prepareSaleStatusRequest[\s\S]*savePendingDirectStatus\(saleId, preparedRequest, historyContext\)[\s\S]*runSaleStatusMutation\(saleId, preparedRequest\)/)
  assert.match(sales, /directMutationOutcomeIsUnknown\(error\)[\s\S]*savePendingDirectStatus\(saleId, null\)/)
  assert.match(editReturn, /activePendingRequest\?\.body \|\|[\s\S]*prepareReturnRequest[\s\S]*savePendingDirectMutation\('return-edit'/)
  assert.match(editReturn, /fieldset disabled=\{submitting \|\| !!activePendingRequest\}/)
  assert.match(editReturn, /retry_original_request[\s\S]*discard_retry/)
  assert.match(editReturn, /useEffect\(\(\) => \{\s*setPendingRequest\(loadPendingDirectMutation<PreparedReturnUpdateRequest>\('return-edit', user\?\.id, ret\.id\)\)[\s\S]*\}, \[ret\.id, user\?\.id\]\)/)
  assert.match(sales, /salesRef\.current\.find/)
  assert.match(sales, /const statusUpdatedAt = String\(mutationResult\?\.updated_at[\s\S]*if \(!committedSale\) return[\s\S]*setDetailSale[\s\S]*savePendingDirectStatus\(saleId, null\)/, 'a response alone cannot clear the pending guard before display convergence')
  assert.match(sales, /loadPendingDirectMutationSlot<PreparedSaleStatusRequest>\('sale-status', user\?\.id\)[\s\S]*pendingDirectStatusRef\.current = pending/)
  assert.match(sales, /const replaySaleStatusHistory[\s\S]*await handleStatusChange\([\s\S]*throw new Error/)
  assert.match(sales, /undo: \(\) => replaySaleStatusHistory[\s\S]*redo: \(\) => replaySaleStatusHistory/)
  assert.match(sales, /actionHistory\[history\.direction\]\(history\.entryId\)/)
  assert.match(returns, /expected_updated_at: currentUpdatedAt/)
  assert.match(returns, /loadPendingDirectMutationSlot<PreparedReturnUpdateRequest>\('return-history', user\?\.id\)[\s\S]*pendingHistoryRequestRef\.current = pending/)
  assert.match(returns, /actionHistory\[history\.direction\]\(history\.entryId\)/)
})

await test('production send and banner paths derive current actor and entity scope before passive reload', () => {
  const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  const returns = readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
  const editReturn = readFileSync(new URL('../src/components/returns/EditReturnModal.tsx', import.meta.url), 'utf8')

  assert.match(sales, /const currentPendingDirectStatus = useCallback\(\(\) => \([\s\S]*pendingDirectMutationForScope\(pendingDirectStatusRef\.current, user\?\.id\)[\s\S]*loadPendingDirectMutationSlot<PreparedSaleStatusRequest>\('sale-status', user\?\.id\)/)
  assert.ok((sales.match(/currentPendingDirectStatus\(\)/g) || []).length >= 3)
  assert.match(sales, /!directStatusSaving && activePendingDirectStatus && String\(detailSale\?\.id\) !== activePendingDirectStatus\.entityId \? \(/, 'the actor-scoped page recovery is visible only when the matching detail does not own it')
  assert.match(sales, /pendingStatus=\{!directStatusSaving && activePendingDirectStatus\?\.entityId === String\(detailSale\.id\)\}/, 'the matching modal receives the same actor-scoped pending guard')
  assert.doesNotMatch(sales, /\{pendingDirectStatus \? \(/)

  assert.match(returns, /const currentPendingHistoryRequest = useCallback\(\(\) => \([\s\S]*pendingDirectMutationForScope\(pendingHistoryRequestRef\.current, user\?\.id\)[\s\S]*loadPendingDirectMutationSlot<PreparedReturnUpdateRequest>\('return-history', user\?\.id\)/)
  assert.ok((returns.match(/currentPendingHistoryRequest\(\)/g) || []).length >= 3)
  assert.match(returns, /\{activePendingHistoryRequest \? \(/)
  assert.doesNotMatch(returns, /\{pendingHistoryRequest \? \(/)

  assert.match(editReturn, /const activePendingRequest = pendingDirectMutationForScope\(pendingRequest, user\?\.id, ret\.id\)[\s\S]*loadPendingDirectMutation<PreparedReturnUpdateRequest>\('return-edit', user\?\.id, ret\.id\)/)
  assert.match(editReturn, /const prepared = activePendingRequest\?\.body \|\|/)
  assert.match(editReturn, /fieldset disabled=\{submitting \|\| !!activePendingRequest\}/)
  assert.doesNotMatch(editReturn, /const prepared = pendingRequest\?\.body \|\|/)
})

if (failed) process.exit(1)
console.log('direct mutation requests: all cases pass')
