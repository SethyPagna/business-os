import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

type Row = Record<string, any>
const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const ownerA = { version: 1, actor_id: 71, organization_id: null, authority: 'https://shop.example', runtime: 'cloudflare-workers' }
const ownerB = { ...ownerA, actor_id: 72 }
let currentOwner: Row = ownerA
let generation = 0
let posts = 0
let postHook: (() => void) | undefined
let failPost = false
let missingAck = false
let serverOwnerOverride: Row | undefined
const queues = new Map<number, Row>()
const mirrors = new Map<number, Row>()
const copy = <T,>(value: T): T => structuredClone(value)
const table = (rows: Map<number, Row>) => ({
  where: () => ({ equals: () => ({ toArray: async () => [...rows.values()].map(copy) }) }),
  get: async (key: number) => copy(rows.get(key)),
  put: async (row: Row) => { const next = copy(row); const key = rows === queues ? (next._seq ?? 1) : next.id; if (rows === queues) next._seq = key; rows.set(key, next); return key },
  delete: async (key: number) => { rows.delete(key) },
})
const db = { table: (name: string) => table(name === 'sales' ? mirrors : queues), transaction: async (...args: any[]) => args.at(-1)() }
function load(sourceText: string, dependencies: Record<string, unknown>, extra = ''): Row {
  const output = ts.transpileModule(sourceText + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => { if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name] }, module, module.exports)
  return module.exports
}
// Real shared owner code, with only authenticated bootstrap storage mocked.
const authStore = { getItem: () => JSON.stringify({ id: currentOwner.actor_id, organization_id: currentOwner.organization_id }) }
Object.assign(globalThis, { window: { location: { origin: ownerA.authority }, sessionStorage: authStore, localStorage: authStore, dispatchEvent() {} }, CustomEvent: class {} })
const ownership = load(source('api/offlineQueueOwnership.ts'), {
  '../constants.ts': { STORAGE_KEYS: { USER: 'user' } },
  './httpState.ts': { getSyncServerUrl: () => currentOwner.authority },
})
for (const user of [{ organization_id: 7 }, { organizationId: 7 }, { organization_id: 7, organizationId: 7 }]) {
  assert.equal(ownership.authenticatedOrganizationId(user), 7)
}
for (const user of [{}, { organization_id: null }, { organizationId: null }]) assert.equal(ownership.authenticatedOrganizationId(user), null)
for (const user of [{ organization_id: null, organizationId: 7 }, { organization_id: 8, organizationId: 7 }, { organizationId: '7' }, { organization_id: undefined }]) {
  assert.throws(() => ownership.authenticatedOrganizationId(user), /Keep this pending sale/)
}
const originalAuthRead = authStore.getItem
authStore.getItem = () => JSON.stringify({ id: 71, organizationId: 7 })
assert.equal(ownership.captureOfflineSaleOwner().organization_id, 7, 'login/OTP/OAuth trusted camel shape retains positive organization')
authStore.getItem = () => JSON.stringify({ id: 71, organization_id: null, organizationId: 7 })
assert.throws(() => ownership.captureOfflineSaleOwner(), /Keep this pending sale/)
authStore.getItem = originalAuthRead
const scope = { captureActorReadScope: () => generation, isActorReadScopeCurrent: (value: number) => value === generation }
const http = {
  route: (_name: string, run: () => unknown) => run(),
  apiFetch: async (method: string, path: string, payload: Row) => {
    if (method === 'GET' && path.startsWith('/api/sync/owner')) return { owner: copy(serverOwnerOverride || currentOwner) }
    posts++
    postHook?.()
    if (failPost) throw Object.assign(Error('server is offline'), { status: 503 })
    return missingAck ? {} : { id: 100, client_request_id: payload.client_request_id, offline_owner: copy(payload.offline_owner) }
  },
  isNetErr: () => false, isTransientGatewayError: (status: number) => status === 503,
  isWriteBlockedError: () => false, isWriteConflictError: (error: Row) => error.status === 409,
}
const baseline = process.argv.includes('--baseline')
const transportSource = baseline ? execFileSync('git', ['show', '1fe5a392:frontend/src/api/saleWriteTransport.ts'], { encoding: 'utf8' }) : source('api/saleWriteTransport.ts')
const transport = load(transportSource, {
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
  '../utils/timestampId.ts': { businessDateTimeId: () => '20260920-120000', isBusinessReceiptNumber: () => true },
  './http.ts': http, './lazyLocalDb.ts': { getLocalDb: async () => db }, './actorReadScope.ts': scope,
  './offlineQueueOwnership.ts': ownership,
  './syncRuntime.ts': { OFFLINE_SALE_SYNC_UPDATE_CHANNELS: [], dispatchSyncUpdates() {}, emitSyncQueueChanged() {}, registerOutboxBackgroundSync() {}, requestPersistentAppStorage() {} },
}, '\nexport { runPendingSalesQueueSync, updateQueuedRow, completeQueuedSale };')
function row(owner: unknown = ownerA): Row {
  return { _seq: 1, id: 'sale-A', channel: 'sales:create', status: 'pending', updated_at: '2026-01-01', created_at: '2026-01-01', entity_id: -10, payload: { client_request_id: 'sale-A', money_precision_version: 1, offline_owner: owner } }
}
function reset(owner: Row = ownerA) { queues.clear(); mirrors.clear(); currentOwner = owner; generation++; posts = 0; postHook = undefined; failPost = false; missingAck = false; serverOwnerOverride = undefined }

if (baseline) {
  reset(); failPost = true; postHook = () => { currentOwner = ownerB; generation++ }
  // This exact behavioral assertion fails on the old transport: the switched
  // account receives a successful unowned queue admission instead of a fence.
  await assert.rejects(transport.createSale({ client_request_id: 'sale-A' }), /Keep this pending sale/)
  assert.deepEqual(queues.get(1)?.payload.offline_owner, ownerA)
  process.exit(0)
}

// Extract actual standalone SW functions (not test reimplementations).
const swText = source('public-runtime/service-worker.ts')
const parsed = ts.createSourceFile('sw.ts', swText, ts.ScriptTarget.Latest, true)
const names = ['normalizeOfflineSaleOwner', 'offlineSaleOwnersMatch', 'sameQueuedSaleRevision', 'currentSaleReplayOwner', 'saleReplayAuthorityUnchanged', 'putQueueRow', 'deleteQueueRow', 'replayQueuedSale', 'markQueueFailure', 'nextRetryAt', 'txDone']
const swFunctions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || '')).map((node) => node.getText(parsed)).join('\n')
let swBase = ownerA.authority
// Minimal asynchronous IDB implementation preserves transactional get→put/delete
// callbacks, which exercises actual SW CAS code rather than stubbing it away.
const swDb = {
  objectStoreNames: { contains: () => true },
  transaction: () => {
    const tx: Row = {}
    tx.objectStore = () => ({
      get: (key: number) => { const req: Row = {}; setImmediate(() => { req.result = copy(queues.get(key)); req.onsuccess?.(); setImmediate(() => tx.oncomplete?.()) }); return req },
      put: (value: Row) => { queues.set(value._seq, copy(value)) },
      delete: (key: number) => { queues.delete(key) },
    })
    return tx
  },
}
let swResponse: 'normal' | 'bare200' | 'wrongReceipt' | 'denied' = 'normal'
const sw = new Function('fetch', 'readSetting', 'self', 'sha256', 'broadcastSyncEvent', `${swFunctions}
const RETRY_DELAY_MS=30000; const OFFLINE_OWNER_REVIEW_MESSAGE=${JSON.stringify(ownership.OFFLINE_OWNER_REVIEW_MESSAGE)};
return { ${names.join(',')} };`)(
  async (url: string, options: Row) => {
    if (url.endsWith('/api/sync/owner')) { assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ owner: copy(currentOwner) }) } }
    posts++; postHook?.()
    const operation = JSON.parse(options.body).operations[0]
    const response = { client_request_id: swResponse === 'wrongReceipt' ? 'another-sale' : operation.client_request_id, offline_owner: operation.payload.offline_owner }
    const body = swResponse === 'bare200' ? { success: true } : { results: [{ client_request_id: operation.client_request_id, operation_id: 'sales.create', status: 'applied', response }] }
    return { ok: swResponse !== 'denied', status: swResponse === 'denied' ? 403 : 200, text: async () => JSON.stringify(body) }
  }, async () => swBase, { location: { origin: ownerA.authority } }, async () => 'digest', () => {},
)

let passed = 0
async function test(name: string, run: () => unknown) { await run(); passed++; console.log(`PASS ${name}`) }
await test('standalone SW owner parser and matcher parity, including malformed and changed identities', () => {
  const values = [null, {}, ownerA, ownerB, { ...ownerA, actor_id: '71' }, { ...ownerA, organization_id: 2 }, { ...ownerA, organization_id: undefined }, { ...ownerA, runtime: 'legacy' }, { ...ownerA, authority: 'https://shop.example/path' }, { ...ownerA, authority: 'javascript:alert(1)' }]
  for (const a of values) { assert.deepEqual(sw.normalizeOfflineSaleOwner(a), ownership.normalizeOfflineSaleOwner(a)); for (const b of values) assert.equal(sw.offlineSaleOwnersMatch(a, b), ownership.offlineSaleOwnersMatch(a, b)) }
})
await test('online-only failure during account switch cannot admit or relabel a sale', async () => {
  reset(); failPost = true; postHook = () => { currentOwner = ownerB; generation++ }
  await assert.rejects(transport.createSale({ client_request_id: 'sale-A' }), /Keep this pending sale/)
  assert.equal(queues.size, 0)
  assert.equal(mirrors.size, 0)
})
await test('admission without an authenticated identity or with a supplied foreign owner fails closed', async () => {
  reset({ ...ownerA, actor_id: undefined }); await assert.rejects(transport.createSale({}), /Keep this pending sale/); assert.equal(posts, 0); assert.equal(queues.size, 0)
  reset(ownerB); await assert.rejects(transport.createSale({ offline_owner: ownerA }), /Keep this pending sale/); assert.equal(posts, 0)
})
await test('foreground B and ownerless legacy queues are retained without dispatch or mutation', async () => {
  for (const owner of [ownerA, null]) { reset(ownerB); queues.set(1, row(owner)); const result = await transport.runPendingSalesQueueSync({ force: true }); assert.equal(posts, 0); assert.equal(result.synced, 0); assert.equal(queues.get(1)?.status, 'pending') }
})
await test('foreground trusts live authenticated owner over stale UI identity', async () => {
  for (const changed of [ownerB, { ...ownerA, organization_id: 2 }, { ...ownerA, authority: 'https://other.example' }, { ...ownerA, runtime: 'legacy' }]) {
    reset(); serverOwnerOverride = changed; queues.set(1, row()); await transport.runPendingSalesQueueSync({ force: true }); assert.equal(posts, 0); assert.equal(queues.get(1)?.status, 'quarantined')
  }
})
await test('same account new session replays unchanged request and removes exact own mirror', async () => {
  reset(); const original = row(); original.status = 'quarantined'; queues.set(1, original); mirrors.set(-10, { id: -10, client_request_id: 'sale-A', offline_owner: ownerA }); generation++
  const result = await transport.runPendingSalesQueueSync({ force: true }); assert.equal(result.synced, 1); assert.equal(queues.size, 0); assert.equal(mirrors.size, 0)
})
await test('foreground account switch while request is in flight retains claimed payload', async () => {
  reset(); queues.set(1, row()); postHook = () => { currentOwner = ownerB; generation++ }; const result = await transport.runPendingSalesQueueSync({ force: true }); assert.equal(result.synced, 0); assert.deepEqual(queues.get(1)?.payload.offline_owner, ownerA)
})
await test('foreground exact ack required and mirror collision never deletes another sale', async () => {
  reset(); queues.set(1, row()); missingAck = true; await transport.runPendingSalesQueueSync({ force: true }); assert.equal(queues.size, 1)
  reset(); queues.set(1, row()); mirrors.set(-10, { id: -10, client_request_id: 'other-sale', offline_owner: ownerB }); await transport.runPendingSalesQueueSync({ force: true }); assert.equal(mirrors.size, 1)
})
await test('foreground stale failure/completion cannot resurrect or delete another revision', async () => {
  reset(); const old = row(); assert.equal(await transport.updateQueuedRow(old, { status: 'failed' }), null); assert.equal(queues.size, 0)
  queues.set(1, { ...old, sync_lease: 'new-owner' }); assert.equal(await transport.completeQueuedSale(old, {}), false); assert.equal(queues.get(1)?.sync_lease, 'new-owner')
})
await test('SW B, ownerless, wrong runtime and wrong authority never dispatch sale', async () => {
  for (const owner of [ownerA, null, { ...ownerB, runtime: 'legacy' }, { ...ownerB, authority: 'https://other.example' }]) { reset(ownerB); queues.set(1, row(owner)); swBase = ownerA.authority; assert.equal(await sw.replayQueuedSale(swDb, copy(queues.get(1)), swBase), false); assert.equal(posts, 0); assert.equal(queues.get(1)?.status, 'quarantined') }
})
await test('SW exact own applied receipt required; bare200, wrong receipt, 403 all retained', async () => {
  for (const variant of ['normal', 'bare200', 'wrongReceipt', 'denied'] as const) { reset(); swResponse = variant; queues.set(1, row()); const ok = await sw.replayQueuedSale(swDb, copy(queues.get(1)), swBase); assert.equal(ok, variant === 'normal'); assert.equal(queues.size, variant === 'normal' ? 0 : 1) }
})
await test('SW in-flight account/runtime switches and replacement revisions retain work', async () => {
  for (const change of ['actor', 'runtime', 'revision']) { reset(); swResponse = 'normal'; swBase = ownerA.authority; queues.set(1, row()); postHook = () => { if (change === 'actor') currentOwner = ownerB; if (change === 'runtime') swBase = 'https://another.example'; if (change === 'revision') queues.set(1, { ...row(), sync_lease: 'replacement' }) }; assert.equal(await sw.replayQueuedSale(swDb, copy(queues.get(1)), ownerA.authority), false); assert.equal(queues.size, 1) }
})
await test('SW stale failure cannot resurrect a completed queue row', async () => { reset(); await sw.markQueueFailure(swDb, row(), Error('late')); assert.equal(queues.size, 0) })
await test('SW two concurrent claims accept only one exact revision', async () => {
  reset(); const original = row(); queues.set(1, original)
  const claims = await Promise.all([sw.putQueueRow(swDb, copy(original), { status: 'syncing', sync_lease: 'first' }), sw.putQueueRow(swDb, copy(original), { status: 'syncing', sync_lease: 'second' })])
  assert.equal(claims.filter(Boolean).length, 1)
  assert.equal(queues.get(1)?.sync_lease, 'first')
})
await test('legacy generic foreground sale is retained without decrypt, dispatch or any revision mutation', async () => {
  const text = source('web-api.ts')
  const parsed = ts.createSourceFile('web-api.ts', text, ts.ScriptTarget.Latest, true)
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && ['syncUnlockedOfflineOutbox', 'getSyncOutboxKey'].includes(node.name?.text || '')).map((node) => node.getText(parsed)).join('\n')
  for (const removedDuringRead of [false, true]) {
    reset(); const original = { ...row(), operation_id: 'sales.create', encrypted_payload: 'original ciphertext', iv: 'original iv' }; queues.set(1, original)
    const syncOutbox = {
      toArray: async () => { const result = [...queues.values()].map(copy); if (removedDuringRead) queues.clear(); return result },
      get: async (key: number) => copy(queues.get(key)),
      update: async (key: number, values: Row) => { assert.ok(queues.has(key), 'must not resurrect missing work'); queues.set(key, { ...queues.get(key), ...values }) },
    }
    const dependencies = {
      offlineVaultKey: {}, scheduleOfflineVaultIdleLock() {}, OFFLINE_OUTBOX_SYNC_LEASE_MS: 60000,
      getOfflineDb: async () => ({ sync_outbox: syncOutbox, transaction: async (...args: any[]) => args.at(-1)() }),
      decryptOfflineVaultValue: () => { throw Error('legacy sale must not be decrypted for replay') },
      apiFetch: () => { throw Error('legacy sale must not dispatch') },
    }
    const compiled = ts.transpileModule(functions + '\nreturn syncUnlockedOfflineOutbox;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const run = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))
    await assert.rejects(run({ force: true }), (error: any) => error.code === 'legacy_recovery_required')
    // A disabled replay must not even read the queue, hence the simulated
    // concurrent read hook never runs; ciphertext and status remain exact.
    assert.equal(queues.size, 1)
    assert.deepEqual(queues.get(1), original)
  }
})
console.log(`${passed} offline ownership behavioral checks passed`)
