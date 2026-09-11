import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as scopes from '../src/api/actorReadScope.ts'
import * as http from '../src/api/http.ts'
import * as query from '../src/api/query.ts'
import { mirrorTable, shouldPersistLocalMirror } from '../src/api/localMirrors.ts'

const storage = new Map<string, string>()
const browserStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
}
const delayed: Array<() => void> = []
Object.assign(globalThis, { window: {
  location: { origin: 'https://fixture.test' }, localStorage: browserStorage,
  sessionStorage: { getItem: () => null },
  setTimeout: (fn: () => void, ms: number) => ms === 10000 ? (delayed.push(fn), 1) : setTimeout(fn, ms),
  clearTimeout, dispatchEvent: () => true, addEventListener: () => {},
} })
http.setSyncServerUrl('https://fixture.test')
function actor(id: number) { storage.set('businessos_user', JSON.stringify({ id })); scopes.resetActorReadSession(); http.cacheClearAll() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
function loadModule(path: string, dependencies: Record<string, unknown>, suffix = ''): any {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8') + suffix, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  new Function('exports', 'require', code)(exports, (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  })
  return exports
}
const rows = new Map<string, any>()
let beforeDb: Promise<unknown> | null = null
let beforePut: Promise<unknown> | null = null
let beforeGet: Promise<unknown> | null = null
const db = { settings: {
  get: async (key: string) => { if (beforeGet) await beforeGet; return rows.get(key) },
  put: async (row: any) => { if (beforePut) await beforePut; rows.set(row.key, row) },
  delete: async (key: string) => { rows.delete(key) },
  toArray: async () => [...rows.values()],
  bulkDelete: async (keys: string[]) => { keys.forEach((key) => rows.delete(key)) },
} }
const queryCache = loadModule('../src/api/queryCache.ts', {
  './actorReadScope.ts': scopes,
  './lazyLocalDb.ts': { getLocalDb: async () => { if (beforeDb) await beforeDb; return db } },
})
const transport = loadModule('../src/api/productReadTransport.ts', {
  './actorReadScope.ts': scopes, './http.ts': http, './query.ts': query, './queryCache.ts': queryCache,
}, '\nexport { scheduleProductCacheWrite }')
const key = 'products:bootstrap:branch=2'
const payload = { items: [{ id: 3263, branch_stock: [{ branch_id: 2, quantity: 3 }], cost_price: 91 }] }
actor(1)
rows.set('read_cache:' + key, { value: JSON.stringify({ savedAt: new Date().toISOString(), data: payload }) })
assert.equal(await queryCache.readCachedQueryResult(key), null, 'legacy unscoped data is never accepted')
transport.scheduleProductCacheWrite(key, payload, scopes.captureActorReadScope(key))
rows.clear(); actor(2)
delayed.shift()!(); await flush()
assert.equal(rows.size, 0, 'old actor delayed timer cannot refill cleared persistent cache')

actor(1)
transport.scheduleProductCacheWrite(key, payload, scopes.captureActorReadScope(key))
delayed.shift()!()
actor(2) // after timer but before dynamic import continuation
await flush()
assert.equal(rows.size, 0, 'late import cannot adopt the next actor')
actor(1)
const delayedGenericResult = scopes.markActorReadResult({ items: [{ id: 1 }] }, scopes.captureActorReadScope(key))
actor(2)
await queryCache.writeCachedQueryResult(key, delayedGenericResult)
assert.equal(rows.size, 0, 'generic callback importing writer late preserves original payload provenance')

actor(1)
const importGate = deferred<void>(); beforeDb = importGate.promise
const writeBeforeImport = queryCache.writeCachedQueryResult(key, payload)
actor(2); importGate.resolve(); await writeBeforeImport; beforeDb = null
assert.equal(rows.size, 0, 'late DB module resolution cannot write')
actor(1)
const putGate = deferred<void>(); beforePut = putGate.promise
const writeDuringIo = queryCache.writeCachedQueryResult(key, payload)
await flush(); actor(2); putGate.resolve(); await writeDuringIo; beforePut = null
assert.equal(rows.size, 0, 'already-issued old-key put is retired after I/O')

actor(1)
await queryCache.writeCachedQueryResult(key, payload)
assert.deepEqual(await queryCache.readCachedQueryResult(key), payload)
const getGate = deferred<void>(); beforeGet = getGate.promise
const readDuringIo = queryCache.readCachedQueryResult(key)
await flush(); actor(2); getGate.resolve()
assert.equal(await readDuringIo, null); beforeGet = null
actor(1)
assert.equal(await queryCache.readCachedQueryResult(key), null, 'return to same actor is a new session')
await queryCache.writeCachedQueryResult(key, payload)
http.cacheInvalidate('products')
assert.equal(await queryCache.readCachedQueryResult(key), null, 'product invalidation includes bootstrap')
const byIds = 'products:byIds:v2:ids=3263'
await queryCache.writeCachedQueryResult(byIds, payload)
http.cacheInvalidate('products')
assert.equal(await queryCache.readCachedQueryResult(byIds), null, 'product invalidation includes byIds')

for (const status of [401, 403]) for (const raceLocalFallback of [false, true]) {
  http.cacheClearAll()
  let localCalls = 0
  await assert.rejects(http.route('products:denied', async () => { throw Object.assign(new Error('Denied'), { status }) },
    async () => { localCalls++; return payload }, { raceLocalFallback, retryTimedOutRead: false }), (e: any) => e.status === status)
  assert.equal(localCalls, 0, 'denial never falls through to mirror')
  assert.equal(http.cacheGet('products:denied'), null)
}
actor(1)
const pending = deferred<unknown>()
const oldRead = http.route('products:pending', () => pending.promise, null, { raceLocalFallback: false })
actor(2)
const employeeRead = http.route('products:pending', async () => ({ items: [{ id: 2 }] }), null, { raceLocalFallback: false })
pending.resolve(payload)
await assert.rejects(oldRead, (e: any) => e.code === 'stale_read_scope')
assert.deepEqual(await employeeRead, { items: [{ id: 2 }] }, 'new actor never dedupes old request')
const ownScope = scopes.captureActorReadScope(key)
storage.set('businessos_read_session', 'another-tab-auth-boundary')
assert.equal(scopes.isActorReadScopeCurrent(ownScope), false, 'other-tab session marker invalidates work without waiting for event')
const sameActor = scopes.captureActorReadScope(key)
scopes.resetActorReadSession()
assert.equal(scopes.isActorReadScopeCurrent(sameActor), false, 'same actor reauthentication fences old reads')
assert.ok(!queryCache.buildQueryCacheStorageKey(key).includes('businessos_user'), 'opaque key does not contain auth storage')
assert.equal(shouldPersistLocalMirror('branches'), false, 'live read cannot write legacy unscoped lookup mirror')
assert.deepEqual(await mirrorTable('branches')([{ id: 2 }]), [], 'suppressed mirror does not import/write/clear IndexedDB')

http.cacheClearAll()
const deniedLater = deferred<unknown>()
let racedLocal = 0
const slowDenied = http.route('products:slow-denied', () => deniedLater.promise, async () => { racedLocal++; return payload }, { raceLocalFallback: true })
await new Promise((r) => setTimeout(r, 400))
assert.equal(racedLocal, 0, 'authenticated mirror cannot win before delayed permission decision')
deniedLater.resolve(Promise.reject(Object.assign(new Error('Denied'), { status: 403 })))
await assert.rejects(slowDenied, (e: any) => e.status === 403)
const realNow = Date.now
Date.now = () => realNow() - 30000
http.cacheSet('products:stale-denied', payload)
Date.now = realNow
let staleFallbackCalls = 0
await assert.rejects(http.route('products:stale-denied', async () => { throw Object.assign(new Error('Denied'), { status: 403 }) },
  async () => { staleFallbackCalls++; return payload }), (e: any) => e.status === 403)
assert.equal(staleFallbackCalls, 0, 'authenticated SWR cannot reveal cached data ahead of denial')
assert.equal(http.cacheGetStale('products:stale-denied').data, null, 'denied cached read is retired')

const oldFetch = globalThis.fetch
try {
  const reply = deferred<Response>()
  globalThis.fetch = (() => reply.promise) as typeof fetch
  const late401 = http.apiFetch('GET', '/api/products')
  actor(2)
  reply.resolve(new Response(JSON.stringify({ error: 'Not authenticated', code: 'invalid_session' }), { status: 401 }))
  await assert.rejects(late401, (e: any) => e.code === 'stale_read_scope', 'old401 cannot log out the next actor')
  const mutationReply = deferred<Response>()
  globalThis.fetch = (() => mutationReply.promise) as typeof fetch
  const mutation = http.apiFetch('POST', '/api/synthetic-write', { client_request_id: 'fixture' })
  scopes.resetActorReadSession()
  mutationReply.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
  assert.deepEqual(await mutation, { success: true }, 'write receipt remains observable; read fence does not discard write outcomes')
} finally { globalThis.fetch = oldFetch }
console.log('PASS actual transport timer/import, persistent read/write I/O, actor/session/tab invalidation, bootstrap/byIds, denial and inflight ownership')
