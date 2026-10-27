// Lane 6.0.1002 (perf-transport): an admin screen can show its last answer, flagged as refreshing, while the fresh read
// runs (no spinner for the whole D1 time), without ever passing it off as current. Runs the real api/http.ts route().
import assert from 'node:assert/strict'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  cacheClearAll,
  cacheInvalidateWithDerived,
  isRefreshingRead,
  route,
  setSyncServerUrl,
  type LastKnownOutcome,
} from '../src/api/http.ts'
import { resetActorReadSession } from '../src/api/actorReadScope.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

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
const storage = readableStorage()
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve)) }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const PENDING = Symbol('pending')
const now = (promise: Promise<unknown>) => Promise.race([promise, settle().then(() => PENDING)])

async function onPage(run: () => Promise<void>): Promise<void> {
  const originalWindow = (globalThis as { window?: unknown }).window
  storage.setItem('businessos_user', JSON.stringify({ id: 1 }))
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://admin.example.test' }, localStorage: storage, sessionStorage: readableStorage() }
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl('https://admin.example.test')
  try { await run() } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
    cacheClearAll(); setSyncServerUrl('')
  }
}

let channelSeq = 0
const newChannel = () => `dashboard:startup:t${++channelSeq}`

await runTest('after an invalidation the last answer is shown at once, flagged; the fresh one arrives by callback, unflagged', () => onPage(async () => {
  const channel = newChannel()
  const outcomes: LastKnownOutcome[] = []
  const options = { onLastKnownRefreshed: (outcome: LastKnownOutcome) => outcomes.push(outcome) }
  const first = await route(channel, async () => ({ total: 10 }), null, options)
  assert.deepEqual(first, { total: 10 })
  assert.equal(isRefreshingRead(first), false, 'a fresh answer is not flagged')
  assert.equal(outcomes.length, 0)

  cacheInvalidateWithDerived('sales')
  const fresh = deferred<{ total: number }>()
  let reads = 0
  const second = route(channel, () => { reads++; return fresh.promise }, null, options)
  const shown = await now(second)
  assert.deepEqual(shown, { total: 10 }, 'the last answer, without waiting for the server')
  assert.equal(isRefreshingRead(shown), true)
  assert.equal(outcomes.length, 0)
  fresh.resolve({ total: 11 })
  await settle()
  assert.equal(reads, 1)
  assert.equal(outcomes.length, 1)
  assert.deepEqual(outcomes[0], { ok: true, data: { total: 11 } })
  assert.equal(isRefreshingRead((outcomes[0] as { data: object }).data), false)
  assert.equal(isRefreshingRead(shown), true, 'the old object stays flagged: it is still old')
}))

await runTest('a failed refresh reports the error and leaves the shown data flagged', () => onPage(async () => {
  const channel = newChannel()
  const outcomes: LastKnownOutcome[] = []
  const options = { onLastKnownRefreshed: (outcome: LastKnownOutcome) => outcomes.push(outcome) }
  await route(channel, async () => ({ total: 1 }), null, options)
  cacheInvalidateWithDerived('sales')
  const shown = await route(channel, async () => { throw Object.assign(new Error('Server unavailable'), { status: 503 }) }, null, options)
  await settle()
  assert.equal(isRefreshingRead(shown), true)
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].ok, false)
}))

await runTest('a call without the option waits for the server like before, and never receives a flagged answer', () => onPage(async () => {
  const channel = newChannel()
  await route(channel, async () => ({ total: 1 }), null, { onLastKnownRefreshed: () => {} })
  cacheInvalidateWithDerived('sales')
  const fresh = deferred<{ total: number }>()
  const plain = route(channel, () => fresh.promise)
  assert.equal(await now(plain), PENDING)
  fresh.resolve({ total: 2 })
  assert.deepEqual(await plain, { total: 2 })
}))

await runTest('a sign-in by another account, a clear-all and a 401 each drop the last answer', () => onPage(async () => {
  for (const drop of ['account', 'clear', 'denied'] as const) {
    const channel = newChannel()
    const options = { onLastKnownRefreshed: () => {} }
    await route(channel, async () => ({ total: 1 }), null, options)
    cacheInvalidateWithDerived('sales')
    if (drop === 'denied') {
      const denied = route(channel, async () => { throw Object.assign(new Error('Not authenticated'), { status: 401, code: 'invalid_session' }) }, null, options)
      assert.deepEqual(await denied, { total: 1 }, 'shown once, while the answer was still on its way')
      await settle()
    } else if (drop === 'account') {
      storage.setItem('businessos_user', JSON.stringify({ id: 2 }))
      resetActorReadSession()
    } else cacheClearAll()
    const fresh = deferred<{ total: number }>()
    const next = route(channel, () => fresh.promise, null, options)
    assert.equal(await now(next), PENDING, drop)
    fresh.resolve({ total: 9 })
    assert.deepEqual(await next, { total: 9 })
    storage.setItem('businessos_user', JSON.stringify({ id: 1 }))
    resetActorReadSession()
  }
}))

await runTest('an answer older than 15 minutes is not shown', () => onPage(async () => {
  const channel = newChannel()
  const options = { onLastKnownRefreshed: () => {} }
  await route(channel, async () => ({ total: 1 }), null, options)
  cacheInvalidateWithDerived('sales')
  const realNow = Date.now
  Date.now = () => realNow() + 16 * 60_000
  try {
    const fresh = deferred<{ total: number }>()
    const next = route(channel, () => fresh.promise, null, options)
    assert.equal(await now(next), PENDING)
    fresh.resolve({ total: 2 }); await next
  } finally { Date.now = realNow }
}))

await runTest('two calls in a row: only the latest one reports back', () => onPage(async () => {
  const channel = newChannel()
  const outcomes: Array<[string, LastKnownOutcome]> = []
  await route(channel, async () => ({ total: 1 }), null, { onLastKnownRefreshed: () => {} })
  cacheInvalidateWithDerived('sales')
  const slow = deferred<{ total: number }>()
  const quick = deferred<{ total: number }>()
  await route(channel, () => slow.promise, null, { onLastKnownRefreshed: (o) => outcomes.push(['first', o]) })
  cacheInvalidateWithDerived('sales')
  await route(channel, () => quick.promise, null, { onLastKnownRefreshed: (o) => outcomes.push(['second', o]) })
  quick.resolve({ total: 3 }); await settle()
  slow.resolve({ total: 2 }); await settle()
  assert.deepEqual(outcomes.map(([who]) => who), ['second'], 'the older answer must not be reported after the newer one')
}))

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('lastKnownRefresh: all passed')
