import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import ts from 'typescript'
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
  releasePendingSaleLineMutation,
  withSaleLineMutationLock,
  runSaleLineMutation,
  replaceReviewedSaleLineHeader,
} from '../src/utils/directMutationRequest.ts'

const require = createRequire(import.meta.url)

function loadTransport(relative: string, mocks: Record<string, unknown>): Record<string, (...args: any[]) => any> {
  const sourceUrl = new URL(relative, import.meta.url)
  const source = readFileSync(sourceUrl, 'utf8')
  const sourceRequire = createRequire(sourceUrl)
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, (...args: any[]) => any> }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value
    return sourceRequire(id)
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

await test('new sale attempts preserve corrupt evidence and cannot overwrite unresolved requests', () => {
  const storage = new MemoryStorage(), actor = 'origin-runtime:user7', entity = '17'
  const body = { client_request_id: 'request-a', money_precision_version: 1, expected_updated_at: 'before', expected_exchange_rate: 4000,
    kind: 'line_removed', sale_item_id: 70, expected_header_quote: { version: 1 } }
  savePendingDirectMutation('sale-amendment', actor, entity, body, storage)
  assert.deepEqual(loadPendingDirectMutation('sale-amendment', actor, entity, storage)!.body, body)
  assert.equal(loadPendingDirectMutation('sale-amendment', 'origin-runtime:user8', entity, storage), null)
  assert.equal(loadPendingDirectMutation('sale-amendment', 'other-runtime:user7', entity, storage), null)
  assert.throws(() => savePendingDirectMutation('sale-amendment', actor, entity, { ...body, client_request_id: 'request-b' }, storage))
  assert.throws(() => savePendingDirectMutation('sale-amendment', actor, entity, null, storage))
  assert.throws(() => releasePendingSaleLineMutation('sale-amendment', actor, entity, { ...body, client_request_id: 'request-b' }, storage))
  assert.throws(() => replaceReviewedSaleLineHeader('sale-amendment', actor, entity, body, { ...body, client_request_id: 'request-b', sale_item_id: 71 }, storage))
  storage.failWrites = true
  assert.throws(() => replaceReviewedSaleLineHeader('sale-amendment', actor, entity, body, { ...body, client_request_id: 'request-b' }, storage))
  assert.deepEqual(loadPendingDirectMutation('sale-amendment', actor, entity, storage)!.body, body)
  storage.failWrites = false
  releasePendingSaleLineMutation('sale-amendment', actor, entity, body, storage)
  const key = directMutationStorageKey('sale-amendment', actor, entity)
  for (const invalid of ['{broken', JSON.stringify({ version: 2, kind: 'sale-amendment', actorId: actor, entityId: entity, createdAt: 1, reconcileAfter: 2, body: { client_request_id: 'orphan' } })]) {
    storage.setItem(key, invalid)
    assert.throws(() => loadPendingDirectMutation('sale-amendment', actor, entity, storage))
    assert.throws(() => savePendingDirectMutation('sale-amendment', actor, entity, body, storage))
    assert.equal(storage.getItem(key), invalid)
  }
  const quota = new MemoryStorage(); quota.failWrites = true
  assert.throws(() => savePendingDirectMutation('sale-amendment', actor, entity, body, quota))
  assert.throws(() => savePendingDirectMutation('sale-add-items', actor, entity, { client_request_id: 'id-only' }, new MemoryStorage()))
})

await test('sale-line lock serializes competing reservation and rechecks actor after admission', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let tail = Promise.resolve()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name: string, _options: unknown, action: () => unknown) => {
    const next = tail.then(action); tail = next.then(() => undefined, () => undefined); return next
  } } } })
  try {
    const storage = new MemoryStorage(), body = { client_request_id: 'one', money_precision_version: 1, expected_updated_at: 'before', expected_exchange_rate: 4000, kind: 'line_removed', expected_header_quote: {} }
    const results = await Promise.allSettled(['one', 'two'].map(id => withSaleLineMutationLock('runtime:user7', 17, () => true,
      () => savePendingDirectMutation('sale-amendment', 'runtime:user7', 17, { ...body, client_request_id: id }, storage))))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(loadPendingDirectMutation('sale-amendment', 'runtime:user7', 17, storage)!.body.client_request_id, 'one')
    let wrote = false
    await assert.rejects(withSaleLineMutationLock('runtime:user7', 17, () => false, () => { wrote = true }))
    assert.equal(wrote, false)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    await assert.rejects(withSaleLineMutationLock('runtime:user7', 17, () => true, () => { wrote = true }))
    assert.equal(wrote, false)
  } finally { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else Reflect.deleteProperty(globalThis, 'navigator') }
})

await test('actual sale runner retains lost acknowledgement, reopens read-only, retries exact and fences late actors', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, _options: unknown, action: () => unknown) => action() } } })
  try {
    const storage = new MemoryStorage(), sent: unknown[] = []
    const body = { client_request_id: 'lost-ack', money_precision_version: 1, expected_updated_at: 'original', expected_exchange_rate: 4000, kind: 'line_removed', sale_item_id: 1, expected_header_quote: {} }
    let current = true
    const options = { kind: 'sale-amendment' as const, actorId: 'runtime:actor7', entityId: '17', storage, isCurrent: () => current,
      readReceipt: async () => ({ committed: false }), send: async (payload: Record<string, unknown>) => { sent.push(payload); throw new Error('lost acknowledgement') }, isCommitted: (result: unknown) => result === true }
    await assert.rejects(runSaleLineMutation({ ...options, body }))
    assert.deepEqual(loadPendingDirectMutation('sale-amendment', options.actorId, '17', storage)!.body, body)
    assert.equal((await runSaleLineMutation({ ...options, readOnly: true })).committed, false)
    assert.equal(sent.length, 1, 'reopen probe must be read-only')
    await assert.rejects(runSaleLineMutation({ ...options, readReceipt: async () => { throw new Error('403') } }))
    assert.equal(sent.length, 1, 'denied proof never falls through to write')
    await assert.rejects(runSaleLineMutation({ ...options, body: { ...body, expected_updated_at: 'new' } }))
    const result = await runSaleLineMutation({ ...options, send: async payload => { sent.push(payload); return true } })
    assert.equal(result.committed, true); assert.deepEqual(sent[1], body)
    assert.equal(loadPendingDirectMutation('sale-amendment', options.actorId, '17', storage), null)
    await assert.rejects(runSaleLineMutation({ ...options, body, send: async () => { current = false; return true } }))
    assert.ok(loadPendingDirectMutation('sale-amendment', options.actorId, '17', storage), 'late actor success cannot erase original owner recovery')
    current = true
    const recovered = await runSaleLineMutation({ ...options, readOnly: true, readReceipt: async () => ({ committed: true, response: { totalUsd: 29 } }) })
    assert.deepEqual(recovered.response, { totalUsd: 29 }); assert.equal(sent.length, 2)
  } finally { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else Reflect.deleteProperty(globalThis, 'navigator') }
})

await test('actual full runtime reset preserves exact sale/return-create evidence across logout and account changes', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const runtime = { exports: {} as { resetClientRuntimeState: (options: Record<string, unknown>) => Promise<void> } }
  let cleanup: () => Promise<void> = async () => {}
  const source = readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === '../../constants.ts') return require('../src/constants.ts')
    if (id === '../../api/localDb.ts') return { resetLocalMirrorDb: () => cleanup(), resetLocalMirrorDbPreservingOfflineWork: () => cleanup(), clearLocalMirrorTables: () => cleanup() }
    throw new Error(`unexpected runtime dependency ${id}`)
  }, runtime, runtime.exports)
  try {
    for (const options of [{ clearAuth: true, preserveOfflineWork: true, preserveUiDrafts: true }, {}, { preserveOfflineWork: true }]) {
      const localStorage = new MemoryStorage(), sessionStorage = new MemoryStorage()
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage, sessionStorage } })
      const protectedKeys = ['businessos_pending_sale-add-items_v2:origin:7:17', 'businessos_pending_sale-amendment_v2:origin:8:17', 'businessos_pending_return_create_v1:origin:7']
      for (const store of [localStorage, sessionStorage]) {
        for (const key of protectedKeys) store.setItem(key, '{malformed-but-preserved')
        store.setItem('businessos_private_cache', 'private')
      }
      let finish!: () => void, entered!: () => void
      const enteredPromise = new Promise<void>(resolve => { entered = resolve })
      cleanup = async () => { entered(); await new Promise<void>(resolve => { finish = resolve }) }
      const reset = runtime.exports.resetClientRuntimeState({ ...options, preserveServiceWorker: true })
      await enteredPromise
      localStorage.setItem(protectedKeys[0], 'newer-cross-tab-evidence')
      finish(); await reset
      assert.equal(localStorage.getItem(protectedKeys[0]), 'newer-cross-tab-evidence', 'async cleanup must not resurrect a snapshot')
      for (const key of protectedKeys.slice(1)) assert.equal(localStorage.getItem(key), '{malformed-but-preserved')
      for (const key of protectedKeys) assert.equal(sessionStorage.getItem(key), '{malformed-but-preserved')
      assert.equal(localStorage.getItem('businessos_private_cache'), null)
      assert.equal(sessionStorage.getItem('businessos_private_cache'), null)
    }
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window') }
})

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
    'http.ts': { apiFetch: async (method: string, path: string, body: unknown) => { requests.push(freezeDirectMutationBody({ method, path, body })); return { id: 31, sale_status: 'cancelled', updated_at: 'sale-rev-2' } }, route: async (_channel: string, fn: () => unknown) => fn(), cacheInvalidate: () => {} },
    'lazyLocalDb.ts': { getLocalDb: async () => ({ table: () => ({ update: async () => 1, orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }) }) },
    'localMirrors.ts': { mirrorReadResult: (_mirror: unknown, value: unknown) => value, mirrorTable: () => null },
    'query.ts': { appendQuery: (path: string) => path, buildQueryString: () => '' },
    'requestIds.ts': { ensureClientRequestId: (body: Record<string, unknown>) => ({ ...body, client_request_id: body.client_request_id || 'sale-status-fixed' }) },
    'contactOptionUtils.ts': { contactDisplayAddress: () => '' },
  })
  // The caller passes the version its screen holds (Sales.tsx: previousSale.updated_at).
  const body = await sales.prepareSaleStatusRequest(31, 'cancelled', 'note', { cancel_reason: 'mistake', expected_updated_at: 'sale-rev-1' })
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
    'http.ts': { apiFetch: async (method: string, path: string, body: unknown) => { requests.push(freezeDirectMutationBody({ method, path, body })); return { id: 44, updated_at: 'return-rev-2' } }, route: async (_channel: string, fn: () => unknown) => fn() },
    'lazyLocalDb.ts': { getLocalDb: async () => ({ table: () => ({ update: async () => 1 }) }) },
    'requestIds.ts': { ensureClientRequestId: (body: Record<string, unknown>) => ({ ...body, client_request_id: body.client_request_id || 'return-edit-fixed' }) },
    'returnsReadTransport.ts': { getReturn: async () => null, getReturns: async () => [] },
  })
  const body = await returns.prepareReturnUpdateRequest(44, { reason: 'Damaged', items: [{ product_id: 9, quantity: 1 }], expected_updated_at: 'return-rev-1' })
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
