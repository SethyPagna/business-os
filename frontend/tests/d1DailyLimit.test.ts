// Lane 6.0.1002 (perf-transport), round 2: on the Free plan, past D1's daily row cap every query fails until 07:00 in
// Cambodia and the Worker answers 503 { code: 'd1_daily_limit' } (lane perf-middleware). The transport must raise one
// banner, block saving with the same sentence, not treat it as an outage (no probe, no refresh events), and lift at the
// first API request that succeeds. Runs the real api/http.ts against a stubbed fetch and a recording window.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  apiFetch,
  cacheClearAll,
  D1_DAILY_LIMIT_EVENT,
  D1_DAILY_LIMIT_MESSAGE,
  isD1DailyLimitActive,
  route,
  setSyncServerUrl,
} from '../src/api/http.ts'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EN = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
const KM = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>

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
const LIMIT_BODY = { error: "Your account has exceeded D1's free tier daily row read limit.", code: 'd1_daily_limit' }

type Page = { events: Array<{ type: string; detail: any }>; urls: string[]; answer: (url: string) => { status: number; body: unknown } }

async function onPage(run: (page: Page) => Promise<void>): Promise<void> {
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalFetch = globalThis.fetch
  const target = new EventTarget()
  const page: Page = { events: [], urls: [], answer: () => ({ status: 503, body: LIMIT_BODY }) }
  for (const type of [D1_DAILY_LIMIT_EVENT, 'server:health', 'server:probe', 'sync:update', 'sync:reconnected', 'sync:transient-outage', 'sync:write-blocked']) {
    target.addEventListener(type, (event) => page.events.push({ type, detail: (event as CustomEvent).detail }))
  }
  ;(globalThis as { window?: unknown }).window = Object.assign(target, {
    location: { origin: 'https://sync.example.test', hostname: 'sync.example.test' },
    localStorage: pageStorage, sessionStorage: readableStorage(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
  globalThis.fetch = (async (url: string) => {
    const where = String(url).replace('https://sync.example.test', '')
    page.urls.push(where)
    if (where === '/health') return new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    const { status, body } = page.answer(where)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl('https://sync.example.test')
  page.events.length = 0
  try { await run(page) } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl('')
  }
}
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve)) }
const limitEvents = (page: Page) => page.events.filter((event) => event.type === D1_DAILY_LIMIT_EVENT).map((event) => event.detail.active)

await runTest('a d1_daily_limit answer becomes the banner sentence, not transient, and raises the banner once', () => onPage(async (page) => {
  const first = await apiFetch('GET', '/api/sales', undefined, 2000).then(() => null, (e) => e)
  const second = await apiFetch('GET', '/api/products', undefined, 2000).then(() => null, (e) => e)
  for (const error of [first, second]) {
    assert.equal(error.code, 'd1_daily_limit')
    assert.equal(error.message, D1_DAILY_LIMIT_MESSAGE)
    assert.equal(error.status, 503)
    assert.equal(error.transientGateway, false)
  }
  assert.equal(isD1DailyLimitActive(), true)
  assert.deepEqual(limitEvents(page), [true], 'one banner, however many requests fail')
}))

await runTest('it is not an outage: a failed read asks no probe and fires no health, refresh, reconnect or write-blocked event', () => onPage(async (page) => {
  await route('sales:get:x', () => apiFetch('GET', '/api/sales', undefined, 2000)).catch(() => {})
  await route('dashboard:startup:x', () => apiFetch('GET', '/api/dashboard/startup', undefined, 2000)).catch(() => {})
  await tick()
  assert.equal(page.urls.includes('/health'), false, 'no /health probe')
  const loud = page.events.filter((event) => ['server:health', 'sync:update', 'sync:reconnected', 'sync:transient-outage', 'sync:write-blocked'].includes(event.type))
  assert.deepEqual(loud, [])
  assert.equal(isD1DailyLimitActive(), true)
}))

await runTest('saving is blocked with the same sentence, nothing is sent, and reads still go out', () => onPage(async (page) => {
  await apiFetch('GET', '/api/sales', undefined, 2000).catch(() => {})
  const sent = page.urls.length
  let writes = 0
  const error: any = await route('sales:create', async () => { writes++; return { id: 1 } }, null, true).then(() => null, (e) => e)
  assert.equal(writes, 0)
  assert.equal(error.code, 'd1_daily_limit')
  assert.equal(error.message, D1_DAILY_LIMIT_MESSAGE)
  assert.equal(error.outcome, 'not_dispatched', 'definitely not saved')
  assert.equal(page.urls.length, sent, 'no request left the tab')
  assert.equal(page.events.some((event) => event.type === 'sync:write-blocked'), false, 'the connection banner does not claim an outage')
  await apiFetch('GET', '/api/sales', undefined, 2000).catch(() => {})
  assert.equal(page.urls.length, sent + 1, 'a read is still attempted, which is how the limit lifts')
}))

await runTest('the first API request that succeeds lifts the banner and saving works again', () => onPage(async (page) => {
  await apiFetch('GET', '/api/sales', undefined, 2000).catch(() => {})
  assert.equal(isD1DailyLimitActive(), true)
  page.answer = () => ({ status: 200, body: { ok: true } })
  await apiFetch('GET', '/api/branches', undefined, 2000)
  assert.equal(isD1DailyLimitActive(), false)
  assert.deepEqual(limitEvents(page), [true, false])
  assert.equal(page.events.filter((event) => event.type === 'sync:update').length, 0, 'lifting it starts no refresh storm')
  assert.deepEqual(await route('sales:create', async () => ({ id: 7 }), null, true), { id: 7 })
}))

await runTest('while the limit holds, one cheap read a minute checks whether the day turned over', () => onPage(async (page) => {
  const realSetTimeout = globalThis.setTimeout
  const scheduled: Array<{ fn: () => void; ms: number }> = []
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === 60_000) { scheduled.push({ fn, ms }); return 0 as unknown as ReturnType<typeof setTimeout> }
    return realSetTimeout(fn, ms, ...rest)
  }) as typeof setTimeout
  try {
    await apiFetch('GET', '/api/sales', undefined, 2000).catch(() => {})
    assert.equal(scheduled.length, 1)
    const before = page.urls.length
    scheduled[0].fn()
    await tick()
    assert.deepEqual(page.urls.slice(before), ['/api/branches'])
    assert.equal(scheduled.length, 2, 'still limited: checks again in a minute')
    page.answer = () => ({ status: 200, body: [] })
    scheduled[1].fn()
    await tick()
    assert.equal(isD1DailyLimitActive(), false, 'the check succeeded')
    assert.equal(scheduled.length, 2, 'and stops checking')
  } finally { globalThis.setTimeout = realSetTimeout }
}))

await runTest('the bootstrap is not turned into "offline" by the limit', async () => {
  const bundled = buildSync({
    stdin: { contents: "export * from './src/api/appBootstrapTransport.ts'; export * as http from './src/api/http.ts'", resolveDir: FRONTEND, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  }).outputFiles[0].text
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', bundled)(mod, mod.exports, (name: string) => { throw new Error(`unexpected require ${name}`) })
  await onPage(async () => {
    ;(globalThis as { window?: any }).window.__businessOsAuthBootstrapPromise = null
    ;(globalThis as { document?: unknown }).document = { getElementById: () => null, documentElement: { getAttribute: () => 'en' } }
    mod.exports.http.setSyncServerUrl('https://sync.example.test')
    const error: any = await mod.exports.getAppBootstrap().then(() => null, (e: unknown) => e)
    assert.equal(error?.code, 'd1_daily_limit', 'it rejects with the limit instead of resolving as an offline shell')
    delete (globalThis as { document?: unknown }).document
    mod.exports.http.__resetApiHealthForTests()
  })
})

await runTest('the banner sentence is in both packs word for word, Khmer is short and has no English', () => {
  assert.equal(EN.d1_daily_limit_banner, D1_DAILY_LIMIT_MESSAGE)
  assert.ok(KM.d1_daily_limit_banner && KM.d1_daily_limit_banner !== EN.d1_daily_limit_banner)
  assert.doesNotMatch(KM.d1_daily_limit_banner, /[A-Za-z]/)
  // Khmer needs more code units for the same words (combining marks); short means about the English length.
  assert.ok(KM.d1_daily_limit_banner.length <= EN.d1_daily_limit_banner.length * 1.25)
})

await runTest('App mounts one full-width banner that follows the transport event', () => {
  const app = fs.readFileSync(path.join(FRONTEND, 'src', 'App.tsx'), 'utf8')
  assert.equal((app.match(/<D1LimitBanner \/>/g) || []).length, 1)
  const banner = fs.readFileSync(path.join(FRONTEND, 'src', 'components', 'server', 'D1LimitBanner.tsx'), 'utf8')
  assert.match(banner, /D1_DAILY_LIMIT_EVENT/)
  assert.match(banner, /role="alert"/)
  assert.match(banner, /w-full/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('d1DailyLimit: all passed')
