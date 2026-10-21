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
  './syncRuntime.ts': { OFFLINE_SALE_SYNC_UPDATE_CHANNELS: [], dispatchSyncUpdates() {}, requestPersistentAppStorage() {} },
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

let passed = 0
async function test(name: string, run: () => unknown) { await run(); passed++; console.log(`PASS ${name}`) }
// 6.0.880: the service worker's replay copy of this owner code is gone, so
// the foreground transport below is the only path that can move a queued sale.
await test('the service worker carries no second owner/replay implementation', () => {
  const swText = source('public-runtime/service-worker.ts')
  assert.doesNotMatch(swText, /normalizeOfflineSaleOwner|offlineSaleOwnersMatch|replayQueuedSale|putQueueRow|\/api\/sync\//)
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
await test('legacy generic foreground sale is retained: web-api.ts has no decrypt, dispatch or queue mutation path for it', async () => {
  const text = source('web-api.ts')
  assert.doesNotMatch(text, /\bsyncUnlockedOfflineOutbox\b|\bqueueBusinessOutboxOperation\b|decryptOfflineVaultValue|sync_outbox\.(?:put|update|delete)\(/)
  assert.doesNotMatch(text, /apiFetch\('POST', '\/api\/sync\//)
})
console.log(`${passed} offline ownership behavioral checks passed`)
