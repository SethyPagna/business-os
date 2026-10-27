// Lane 6.0.1002 (perf-transport): identical concurrent GETs share one network call (sign-in fired
// /api/auth/bootstrap three times), and an invalidation keeps a shared read only when it claims no data change.
// Runs the real api/http.ts against a counting fetch.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  apiFetch,
  cacheClearAll,
  cacheInvalidate,
  cacheInvalidateWithDerived,
  currentReadEpoch,
  route,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.ts'
import { resetActorReadSession } from '../src/api/actorReadScope.ts'

let failed = 0
function readableStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

type Deferred = { promise: Promise<Response>; resolve: (payload?: unknown) => void }
function deferredResponse(): Deferred {
  let resolve!: (payload?: unknown) => void
  const promise = new Promise<Response>((done) => {
    resolve = (payload: unknown = { ok: true }) => done(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
  return { promise, resolve }
}

async function withFetch(run: (calls: string[], pending: Deferred[]) => Promise<void>): Promise<void> {
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll()
  setSyncServerUrl('https://sync.example.test'); setSyncToken('')
  const original = globalThis.fetch
  const calls: string[] = []
  const pending: Deferred[] = []
  globalThis.fetch = ((url: string) => {
    calls.push(String(url))
    const next = deferredResponse()
    pending.push(next)
    return next.promise
  }) as typeof fetch
  try { await run(calls, pending) } finally {
    globalThis.fetch = original
    __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl('')
  }
}

await runTest('three concurrent bootstrap reads make one request and each caller gets its own copy', () => withFetch(async (calls, pending) => {
  const reads = [1, 2, 3].map(() => apiFetch('GET', '/api/auth/bootstrap', undefined, 8000))
  assert.equal(calls.length, 1, 'one network call')
  pending[0].resolve({ user: { id: 7 }, settings: { a: 1 } })
  const [first, second, third] = await Promise.all(reads)
  assert.deepEqual(second, first)
  assert.deepEqual(third, first)
  assert.notEqual(second, first, 'joiners get a copy, not the first caller\'s object')
  ;(first as { user: { id: number } }).user.id = 99
  assert.equal((second as { user: { id: number } }).user.id, 7, 'mutating one answer leaves the others alone')
}))

await runTest('a GET after the first settled is a new request (no result cache)', () => withFetch(async (calls, pending) => {
  const first = apiFetch('GET', '/api/branches', undefined, 8000)
  pending[0].resolve({ n: 1 })
  await first
  const second = apiFetch('GET', '/api/branches', undefined, 8000)
  assert.equal(calls.length, 2)
  pending[1].resolve({ n: 2 })
  assert.deepEqual(await second, { n: 2 })
}))

await runTest('different paths and a read with an abort signal are never merged', () => withFetch(async (calls, pending) => {
  const a = apiFetch('GET', '/api/branches', undefined, 8000)
  const b = apiFetch('GET', '/api/branches?x=1', undefined, 8000)
  const signalled = apiFetch('GET', '/api/branches', undefined, 8000, { signal: new AbortController().signal })
  assert.equal(calls.length, 3)
  pending.forEach((entry) => entry.resolve({}))
  await Promise.all([a, b, signalled])
}))

await runTest('the account-proof probe /api/sync/owner is never shared: each ask is its own request', () => withFetch(async (calls, pending) => {
  const reads = [apiFetch('GET', '/api/sync/owner', undefined, 8000), apiFetch('GET', '/api/sync/owner', undefined, 8000), apiFetch('GET', '/api/sync/owner?x=1', undefined, 8000)]
  assert.equal(calls.length, 3, 'a probe taken after a dispatch must not be answered by one that began before it')
  pending.forEach((entry) => entry.resolve({ owner: { actor_id: 1 } }))
  await Promise.all(reads)
}))

await runTest('a data-change invalidation while a GET is in flight: the next identical GET starts fresh', () => withFetch(async (calls, pending) => {
  const before = apiFetch('GET', '/api/dashboard/startup', undefined, 8000)
  const epoch = currentReadEpoch()
  cacheInvalidateWithDerived('sales')
  assert.ok(currentReadEpoch() > epoch)
  const after = apiFetch('GET', '/api/dashboard/startup', undefined, 8000)
  assert.equal(calls.length, 2, 'a request begun before the sale may predate it, so it is not shared past the invalidation')
  const during = apiFetch('GET', '/api/dashboard/startup', undefined, 8000)
  assert.equal(calls.length, 2, 'but callers after the invalidation share the fresh one')
  pending.forEach((entry) => entry.resolve({}))
  await Promise.all([before, after, during])
}))

await runTest('a precaution invalidation (socket opened) keeps a lookup read in flight shared; a data change does not', () => withFetch(async (calls, pending) => {
  const epoch = currentReadEpoch()
  let serverFnRuns = 0
  const read = (channel: string, path: string) => route(channel, () => { serverFnRuns++; return apiFetch('GET', path, undefined, 8000) })
  const first = read('branches:get', '/api/branches')
  cacheInvalidate('branches:get', { precaution: true })
  assert.equal(currentReadEpoch(), epoch, 'a precaution is not a data change')
  const second = read('branches:get', '/api/branches')
  assert.equal(serverFnRuns, 1, 'the second caller joined the read already in flight (route level)')
  assert.equal(calls.length, 1)
  pending[0].resolve([{ id: 1 }])
  assert.deepEqual(await first, [{ id: 1 }])
  assert.deepEqual(await second, [{ id: 1 }])

  serverFnRuns = 0
  const third = read('branches:get2', '/api/branches?v=2')
  cacheInvalidate('branches:get2')
  const fourth = read('branches:get2', '/api/branches?v=2')
  assert.equal(serverFnRuns, 2, 'a data change retires the read in flight (route level)')
  assert.equal(calls.length, 3)
  pending[1].resolve([]); pending[2].resolve([])
  await Promise.all([third, fourth])
}))

// Sign-in resets the read scope while the first screen reads are on the wire; they used to die with stale_read_scope.
// One storage for the whole file: the read-session marker lives in it, and a fresh one reads as another tab having changed the session.
const pageStorage = readableStorage()
async function withSignedInPage(userId: number, run: (storage: Storage) => Promise<void>): Promise<void> {
  const originalWindow = (globalThis as { window?: unknown }).window
  const storage = pageStorage
  storage.setItem('businessos_user', JSON.stringify({ id: userId }))
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://admin.example.test' }, localStorage: storage, sessionStorage: readableStorage() }
  __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl('https://admin.example.test')
  try { await run(storage) } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
    cacheClearAll(); setSyncServerUrl('')
  }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
const gate = () => { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve }); return { promise, open } }

await runTest('a read caught by the sign-in scope reset is re-issued once under the settled scope', () => withSignedInPage(1, async () => {
  let runs = 0
  const g = gate()
  const read = route('dashboard:startup:x', async () => { runs++; if (runs === 1) await g.promise; return { run: runs } })
  await settle()
  resetActorReadSession()
  g.open()
  assert.deepEqual(await read, { run: 2 })
  assert.equal(runs, 2)
}))

await runTest('the re-issue happens once: a second stale read surfaces the error', () => withSignedInPage(1, async () => {
  let runs = 0
  const g1 = gate(); const g2 = gate()
  const read = route('dashboard:startup:y', async () => { runs++; await (runs === 1 ? g1 : g2).promise; return runs })
  const failure = assert.rejects(read, (e: any) => e.code === 'stale_read_scope')
  await settle()
  resetActorReadSession(); g1.open()
  await settle()
  resetActorReadSession(); g2.open()
  await failure
  assert.equal(runs, 2)
}))

await runTest('a sign-in by another account is not papered over: the stale read is refused, not re-issued', () => withSignedInPage(1, async (storage) => {
  let runs = 0
  const g = gate()
  const read = route('dashboard:startup:z', async () => { runs++; await g.promise; return runs })
  const failure = assert.rejects(read, (e: any) => e.code === 'stale_read_scope')
  await settle()
  storage.setItem('businessos_user', JSON.stringify({ id: 2 }))
  resetActorReadSession()
  g.open()
  await failure
  assert.equal(runs, 1)
}))

await runTest('a write caught by the reset is never re-issued', () => withSignedInPage(1, async () => {
  let runs = 0
  const g = gate()
  const write = route('sales:create', async () => { runs++; await g.promise; return runs }, null, true)
  await settle()
  resetActorReadSession()
  g.open()
  await write.catch(() => {})
  assert.equal(runs, 1)
}))

// getAppBootstrap imports extension-less modules, so it is bundled with its own copy of http.ts (its module
// state, fetch and window are the test's); that copy is returned as `http` so the test can invalidate through it.
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundled = buildSync({
  stdin: { contents: "export * from './src/api/appBootstrapTransport.ts'; export * as http from './src/api/http.ts'", resolveDir: FRONTEND, loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
}).outputFiles[0].text
const bundleModule = { exports: {} as Record<string, any> }
new Function('module', 'exports', 'require', bundled)(bundleModule, bundleModule.exports, (name: string) => { throw new Error(`unexpected require ${name}`) })
const { getAppBootstrap, http: bundledHttp } = bundleModule.exports as { getAppBootstrap: () => Promise<any>; http: typeof import('../src/api/http.ts') }

async function withBundledPage(early: Promise<unknown> | null, run: (calls: string[], pending: Deferred[]) => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch
  const originalWindow = (globalThis as { window?: unknown }).window
  const calls: string[] = []
  const pending: Deferred[] = []
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://admin.example.test', hostname: 'admin.example.test' }, localStorage: readableStorage(), sessionStorage: readableStorage(), __businessOsAuthBootstrapPromise: early }
  bundledHttp.setSyncServerUrl('https://admin.example.test')
  bundledHttp.cacheClearAll()
  globalThis.fetch = ((url: string) => { calls.push(String(url)); const next = deferredResponse(); pending.push(next); return next.promise }) as typeof fetch
  try { await run(calls, pending) } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    bundledHttp.setSyncServerUrl(''); bundledHttp.cacheClearAll()
  }
}

await runTest('sign-in asks for the bootstrap three times at once: one request, one answer for all', () => withBundledPage(null, async (calls, pending) => {
  const asks = [getAppBootstrap(), getAppBootstrap(), getAppBootstrap()]
  await Promise.resolve()
  assert.equal(calls.length, 1)
  pending[0].resolve({ user: { id: 3 }, settings: {} })
  const answers = await Promise.all(asks)
  assert.deepEqual(answers.map((a) => a.user.id), [3, 3, 3])
  const next = getAppBootstrap()
  await Promise.resolve()
  assert.equal(calls.length, 2, 'a later ask is a new read, not a stored answer')
  pending[1].resolve({ user: { id: 3 } }); await next
}))

await runTest('the early bootstrap copy of the page serves every overlapping ask (taken only once) with no request at all', () => withBundledPage(Promise.resolve({ user: { id: 5 }, settings: {} }), async (calls) => {
  const answers = await Promise.all([getAppBootstrap(), getAppBootstrap()])
  assert.deepEqual(answers.map((a) => a.user.id), [5, 5])
  assert.equal(calls.length, 0)
}))

await runTest('an ask after a users/roles push is not served by the read begun before it', () => withBundledPage(null, async (calls, pending) => {
  const before = getAppBootstrap()
  await Promise.resolve()
  bundledHttp.cacheInvalidateWithDerived('users')
  const after = getAppBootstrap()
  await Promise.resolve()
  assert.equal(calls.length, 2, 'a permission change must not be answered by a read that predates it')
  pending.forEach((entry) => entry.resolve({ user: { id: 1 } }))
  await Promise.all([before, after])
}))

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('transportReadDedupe: all passed')
