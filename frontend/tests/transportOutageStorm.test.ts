// Lane 6.0.1002 (perf-transport): one 503 (a Cloudflare 1102 or a busy edge) must not mark the server offline,
// and coming back must not clear every cache and refresh every channel. Runs the real api/http.ts with a window
// that records every event, a /health that answers on demand and reads that fail on demand.
import assert from 'node:assert/strict'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  cacheClearAll,
  cacheGet,
  cacheSet,
  route,
  setSyncServerUrl,
} from '../src/api/http.ts'

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

const pageStorage = readableStorage()
const gatewayError = (status = 503) => Object.assign(new Error('<html><body>Error 1102</body></html>'), { status, transientGateway: true })

type Page = { events: Array<{ type: string; detail: any }>; healthCalls: number; health: { status: number } }

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalFetch = globalThis.fetch
  const target = new EventTarget()
  const page: Page = { events: [], healthCalls: 0, health: { status: 200 } }
  for (const type of ['server:health', 'sync:update', 'sync:reconnected', 'sync:transient-outage', 'server:probe']) {
    target.addEventListener(type, (event) => page.events.push({ type, detail: (event as CustomEvent).detail }))
  }
  ;(globalThis as { window?: unknown }).window = Object.assign(target, {
    location: { origin: 'https://sync.example.test', hostname: 'sync.example.test' },
    localStorage: pageStorage,
    sessionStorage: readableStorage(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('/health')) {
      page.healthCalls++
      return new Response(JSON.stringify({ status: 'ok' }), { status: page.health.status, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll()
  setSyncServerUrl('https://sync.example.test')
  page.events.length = 0
  try { await run(page) } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl('')
  }
}

let channelCounter = 0
const fail = (status = 503) => route(`stats:fail${++channelCounter}`, async () => { throw gatewayError(status) }).catch(() => 'failed')
const succeed = () => route(`stats:ok${++channelCounter}`, async () => ({ ok: true }))
const types = (page: Page) => page.events.map((event) => event.type)
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve)) }

await runTest('a single 503 read marks nothing offline: no server:health, no refresh, no reconnect, at most one /health probe', () => withPage(async (page) => {
  assert.equal(await fail(), 'failed')
  await tick()
  assert.deepEqual(types(page).filter((type) => type !== 'server:probe'), [], JSON.stringify(types(page)))
  assert.ok(page.healthCalls <= 1)
  await succeed()
  assert.deepEqual(types(page).filter((type) => type !== 'server:probe'), [], 'the next success has nothing to recover from')
}))

await runTest('a 1102, a 503 and a 504 at once share one probe, and a healthy /health keeps the server online through six failures', () => withPage(async (page) => {
  await Promise.all([fail(503), fail(504), fail(503)])
  await tick()
  assert.equal(page.healthCalls, 1, `${page.healthCalls} probes`)
  await fail(); await fail(); await fail(); await tick()
  assert.equal(types(page).includes('server:health'), false, 'six failures in a row with /health answering is still not an outage')
}))

await runTest('a failed health probe after a failed read does mark the server offline', () => withPage(async (page) => {
  page.health.status = 503
  await fail()
  await tick(); await tick()
  assert.deepEqual(page.events.filter((event) => event.type === 'server:health').map((event) => event.detail.online), [false])
}))

await runTest('the server is offline once a probe fails, announced once with the outage notice', () => withPage(async (page) => {
  page.health.status = 503
  await fail(); await fail(); await tick()
  assert.deepEqual(page.events.filter((event) => event.type === 'server:health').map((event) => event.detail.online), [false])
  const notices = page.events.filter((event) => event.type === 'sync:transient-outage')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].detail.active, true)
}))

await runTest('recovery refreshes the channels without clearing every cache, and clears the outage notice', () => withPage(async (page) => {
  page.health.status = 503
  await fail(); await tick()
  page.events.length = 0
  page.health.status = 200
  cacheSet('someoneselse:cached', { keep: true })
  await succeed()
  const online = page.events.filter((event) => event.type === 'server:health').map((event) => event.detail.online)
  assert.deepEqual(online, [true])
  assert.equal(page.events.filter((event) => event.type === 'sync:reconnected').length, 1)
  assert.equal(page.events.filter((event) => event.type === 'sync:transient-outage' && event.detail.active === false).length, 1)
  const refreshed = page.events.filter((event) => event.type === 'sync:update').map((event) => event.detail.channel)
  assert.ok(refreshed.length > 0 && refreshed.length <= 17, `${refreshed.length} refresh events (listeners coalesce them into one bulk sync:flush)`)
  assert.deepEqual(cacheGet('someoneselse:cached'), { keep: true }, 'a cache entry outside the refreshed channels is not thrown away')
}))

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('transportOutageStorm: all passed')
