// Lane 6.0.1042 (P0.4): the read-budget governor refuses a class of request with 429 { code: 'read_budget_shed' | 'read_budget_reserved' }
// before it reads anything. The transport must treat that as a notice and not an outage: one banner, a typed "paused until HH:MM" error,
// no health probe, no cache clear, no refresh event, the identical GET not sent again before Retry-After, and selling untouched. A plain
// 503 keeps today's behaviour. Runs the real api/http.ts against a stubbed fetch and a recording window.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  apiFetch,
  cacheClearAll,
  cacheGet,
  cacheSet,
  route,
  setSyncServerUrl,
} from '../src/api/http.ts'
import {
  READ_BUDGET_EVENT,
  __resetReadBudgetForTests,
  businessClockText,
  getReadBudgetPause,
  retryAfterSeconds,
} from '../src/api/readBudgetShed.ts'
import { __resetServerSignalsForTests } from '../src/api/serverSignals.ts'

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
// The next 00:00 UTC, which is 07:00 in Cambodia: what the Worker names as the end of the day's allowance.
const DAY_MS = 86_400_000
const RESETS_MS = (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS
const RESETS_AT = new Date(RESETS_MS).toISOString()
const MORNING = RESETS_MS - 14 * 3_600_000
const SHED = { success: false, error: 'Big reports are paused.', code: 'read_budget_shed', zone: 'red', resetsAt: RESETS_AT }
const RESERVED = { success: false, error: 'Only selling works.', code: 'read_budget_reserved', zone: 'black', resetsAt: RESETS_AT }
const LOUD = ['server:health', 'server:probe', 'sync:update', 'sync:reconnected', 'sync:transient-outage', 'sync:write-blocked']

type Answer = { status: number; body: unknown; headers?: Record<string, string> }
type Page = { events: Array<{ type: string; detail: any }>; sent: string[]; answer: (where: string, method: string) => Answer }

async function onPage(run: (page: Page) => Promise<void>): Promise<void> {
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalFetch = globalThis.fetch
  const target = new EventTarget()
  const page: Page = { events: [], sent: [], answer: () => ({ status: 200, body: { ok: true } }) }
  for (const type of [READ_BUDGET_EVENT, ...LOUD]) target.addEventListener(type, (event) => page.events.push({ type, detail: (event as CustomEvent).detail }))
  ;(globalThis as { window?: unknown }).window = Object.assign(target, {
    location: { origin: 'https://sync.example.test', hostname: 'sync.example.test' },
    localStorage: pageStorage, sessionStorage: readableStorage(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    const where = String(url).replace('https://sync.example.test', '')
    const method = String(init?.method || 'GET').toUpperCase()
    page.sent.push(`${method} ${where}`)
    if (where === '/health') return new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    const { status, body, headers } = page.answer(where, method)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  }) as typeof fetch
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); __resetReadBudgetForTests(); __resetServerSignalsForTests(); cacheClearAll(); setSyncServerUrl('https://sync.example.test')
  page.events.length = 0
  try { await run(page) } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    __resetApiHealthForTests(); __resetReadBudgetForTests(); __resetServerSignalsForTests(); cacheClearAll(); setSyncServerUrl('')
  }
}
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve)) }
const shedEvents = (page: Page) => page.events.filter((event) => event.type === READ_BUDGET_EVENT).map((event) => event.detail.active)
const loudEvents = (page: Page) => page.events.filter((event) => LOUD.includes(event.type))
const reply = (page: Page, status: number, body: unknown, headers?: Record<string, string>) => { page.answer = () => ({ status, body, headers }) }
async function withClock<T>(start: number, run: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now
  let now = start
  Date.now = () => now
  try { return await run((ms) => { now += ms }) } finally { Date.now = realNow }
}

await runTest('a read_budget_shed answer is a typed "paused until 07:00" error and raises one banner however many calls it refuses', () => onPage(async (page) => {
  reply(page, 429, SHED, { 'Retry-After': '90' })
  const first: any = await apiFetch('GET', '/api/reports/profit', undefined, 2000).then(() => null, (e) => e)
  const second: any = await apiFetch('GET', '/api/inventory-checks/products', undefined, 2000).then(() => null, (e) => e)
  for (const error of [first, second]) {
    assert.equal(error.status, 429)
    assert.equal(error.code, 'read_budget_shed')
    assert.equal(error.message, 'Paused until 07:00 to keep selling running.')
    assert.equal(error.pausedUntilText, '07:00')
    assert.equal(error.retryAfterSeconds, 90)
    assert.equal(error.transientGateway, false)
    assert.equal(error.outcome, 'not_dispatched', 'refused before it read or wrote anything')
    assert.equal(error.messageKey, 'read_budget_paused')
  }
  assert.deepEqual(shedEvents(page), [true], 'one banner')
  assert.equal(getReadBudgetPause()?.code, 'read_budget_shed')
}))

await runTest('it is not an outage: no health probe, no health, refresh, reconnect or write-blocked event, and the cache stays', () => onPage(async (page) => {
  cacheSet('reports:profit', { rows: [1, 2, 3] })
  reply(page, 429, SHED, { 'Retry-After': '90' })
  const error: any = await route('reports:profit:x', () => apiFetch('GET', '/api/reports/profit', undefined, 2000)).then(() => null, (e) => e)
  await route('inventory-checks:x', () => apiFetch('GET', '/api/inventory-checks/products', undefined, 2000)).catch(() => {})
  await tick()
  assert.equal(error.code, 'read_budget_shed')
  assert.equal(page.sent.includes('GET /health'), false, 'no /health probe')
  assert.deepEqual(loudEvents(page), [])
  assert.deepEqual(cacheGet('reports:profit'), { rows: [1, 2, 3] }, 'nothing was cleared')
}))

await runTest('the identical GET is not sent again before Retry-After; another URL is; after Retry-After it goes out again', () => onPage(async (page) => {
  await withClock(MORNING, async (advance) => {
    reply(page, 429, SHED, { 'Retry-After': '90' })
    await apiFetch('GET', '/api/reports/profit?from=2026-11-01', undefined, 2000).catch(() => {})
    assert.equal(page.sent.filter((line) => line === 'GET /api/reports/profit?from=2026-11-01').length, 1)
    advance(30_000)
    const held: any = await apiFetch('GET', '/api/reports/profit?from=2026-11-01', undefined, 2000).then(() => null, (e) => e)
    await apiFetch('GET', '/api/reports/profit?from=2026-11-01', undefined, 2000).catch(() => {})
    assert.equal(page.sent.filter((line) => line === 'GET /api/reports/profit?from=2026-11-01').length, 1, 'held: nothing left the tab')
    assert.equal(held.code, 'read_budget_shed')
    assert.equal(held.status, 429)
    assert.equal(held.retryAfterSeconds, 60, 'the wait left, not the first answer')
    assert.equal(held.message, 'Paused until 07:00 to keep selling running.')
    reply(page, 200, { ok: true })
    assert.deepEqual(await apiFetch('GET', '/api/reports/profit?from=2026-10-01', undefined, 2000), { ok: true }, 'another query is its own request')
    advance(61_000)
    assert.deepEqual(await apiFetch('GET', '/api/reports/profit?from=2026-11-01', undefined, 2000), { ok: true })
    assert.equal(page.sent.filter((line) => line === 'GET /api/reports/profit?from=2026-11-01').length, 2, 'sent again after the wait')
  })
}))

await runTest('selling is untouched: a POS sale goes out while reads are paused, and a write is never held', () => onPage(async (page) => {
  reply(page, 429, SHED, { 'Retry-After': '90' })
  await apiFetch('GET', '/api/reports/profit', undefined, 2000).catch(() => {})
  page.answer = (where, method) => method === 'POST' ? { status: 200, body: { id: 7 } } : { status: 429, body: SHED, headers: { 'Retry-After': '90' } }
  assert.deepEqual(await route('sales:create', () => apiFetch('POST', '/api/sales', { total: 5, client_request_id: 'a' }, 2000), null, true), { id: 7 })
  assert.deepEqual(await apiFetch('POST', '/api/sales', { total: 6, client_request_id: 'b' }, 2000), { id: 7 })
  assert.deepEqual(page.sent.filter((line) => line.startsWith('POST')), ['POST /api/sales', 'POST /api/sales'])
  assert.deepEqual(loudEvents(page), [])
}))

await runTest('a refused write (black zone, not selling) says it was not saved, raises the notice, and does not mark the server offline', () => onPage(async (page) => {
  reply(page, 429, RESERVED, { 'Retry-After': '120' })
  const error: any = await route('products:edit', () => apiFetch('PUT', '/api/products/1', { name: 'x' }, 2000), null, true).then(() => null, (e) => e)
  assert.equal(error.code, 'read_budget_reserved')
  assert.equal(error.outcome, 'not_dispatched')
  assert.equal(error.message, 'Paused until 07:00 to keep selling running.')
  assert.equal(page.sent.includes('GET /health'), false)
  assert.deepEqual(shedEvents(page), [true])
  assert.deepEqual(loudEvents(page).filter((event) => event.type !== 'sync:error'), [])
  assert.equal(getReadBudgetPause()?.code, 'read_budget_reserved')
}))

await runTest('a plain 503 keeps today\'s behaviour: a gateway failure that asks the health probe, and no budget notice', () => onPage(async (page) => {
  reply(page, 503, { success: false, error: 'Service unavailable' })
  const error: any = await route('sales:get:y', () => apiFetch('GET', '/api/sales', undefined, 2000)).then(() => null, (e) => e)
  await tick()
  assert.equal(error.status, 503)
  assert.equal(error.transientGateway, true)
  assert.notEqual(error.code, 'read_budget_shed')
  assert.equal(page.sent.includes('GET /health'), true, 'a failed read still asks whether the server is up')
  assert.deepEqual(shedEvents(page), [])
  assert.equal(getReadBudgetPause(), null)
  reply(page, 503, { success: false, error: 'Service unavailable' })
  await apiFetch('GET', '/api/sales', undefined, 2000).catch(() => {})
  assert.equal(page.sent.filter((line) => line === 'GET /api/sales').length, 2, 'a plain 503 is not held: it may be retried at once')
}))

await runTest('a 429 without a budget code is not a pause: no banner, no hold', () => onPage(async (page) => {
  reply(page, 429, { success: false, error: 'Too many requests', code: 'rate_limited' })
  const error: any = await apiFetch('GET', '/api/auth/me', undefined, 2000).then(() => null, (e) => e)
  await apiFetch('GET', '/api/auth/me', undefined, 2000).catch(() => {})
  assert.equal(error.status, 429)
  assert.equal(error.code, 'rate_limited')
  assert.equal(page.sent.filter((line) => line === 'GET /api/auth/me').length, 2)
  assert.deepEqual(shedEvents(page), [])
}))

await runTest('the pause ends at the Worker\'s reset time, when a response says the zone is green or amber, and not before', () => onPage(async (page) => {
  await withClock(MORNING, async (advance) => {
    reply(page, 429, SHED, { 'Retry-After': '1' })
    await apiFetch('GET', '/api/reports/profit', undefined, 2000).catch(() => {})
    assert.notEqual(getReadBudgetPause(), null)
    advance(2_000)
    page.answer = () => ({ status: 200, body: { ok: true } })
    await apiFetch('GET', '/api/branches', undefined, 2000)
    assert.notEqual(getReadBudgetPause(), null, 'an ordinary read that succeeds does not end it')
    page.answer = () => ({ status: 200, body: { ok: true }, headers: { 'X-BOS-Budget': 'z=red;p=88;r=2026-11-03T00:00:00Z' } })
    await apiFetch('GET', '/api/branches', undefined, 2000)
    assert.notEqual(getReadBudgetPause(), null, 'still red')
    page.answer = () => ({ status: 200, body: { ok: true }, headers: { 'X-BOS-Budget': 'z=amber;p=72;r=2026-11-03T00:00:00Z' } })
    await apiFetch('GET', '/api/branches', undefined, 2000)
    assert.equal(getReadBudgetPause(), null, 'the zone dropped')
    assert.deepEqual(shedEvents(page), [true, false])
    assert.equal(loudEvents(page).length, 0, 'lifting it starts no refresh')
  })
}))

await runTest('without a header the pause still ends by itself at resetsAt', () => onPage(async (page) => {
  await withClock(MORNING, async (advance) => {
    reply(page, 429, SHED, { 'Retry-After': '60' })
    await apiFetch('GET', '/api/reports/profit', undefined, 2000).catch(() => {})
    assert.notEqual(getReadBudgetPause(), null)
    advance(15 * 3_600_000)
    assert.equal(getReadBudgetPause(), null, 'past 00:00 UTC the day has turned over')
  })
}))

await runTest('Retry-After: seconds from the header, else the body, else a minute; never under one second or over a day', () => {
  assert.equal(retryAfterSeconds('90', 5), 90)
  assert.equal(retryAfterSeconds(null, 45), 45)
  assert.equal(retryAfterSeconds(undefined, null), 60)
  assert.equal(retryAfterSeconds('0', null), 60)
  assert.equal(retryAfterSeconds('-5', 'x'), 60)
  assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT', null), 60)
  assert.equal(retryAfterSeconds('9999999', null), 86_400)
})

await runTest('the time is the business clock: 00:00 UTC is 07:00 in Cambodia', () => {
  assert.equal(businessClockText(Date.parse(RESETS_AT)), '07:00')
  assert.equal(businessClockText(Date.parse('2026-11-02T18:05:00.000Z')), '01:05')
  assert.equal(businessClockText(Date.parse('2026-11-02T00:00:00.000Z')), '07:00')
})

await runTest('Khmer: the typed error is restated from the pack with the time kept', async () => {
  Object.assign(globalThis, { document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? 'km' : null) } } })
  try {
    const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'branchRefusalLanguage.ts'), 'utf8')
    const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
    const mod = { exports: {} as Record<string, any> }
    new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
      if (request.endsWith('/lang/km.json')) return KM
      throw new Error(`unexpected import ${request}`)
    })
    const restate = mod.exports.restateForeignBodyError as (error: Error) => Promise<Error>
    const error = await restate(Object.assign(new Error('Paused until 07:00 to keep selling running.'), { messageKey: 'read_budget_paused', pausedUntilText: '07:00' }))
    assert.equal(error.message, KM.read_budget_paused.split('{time}').join('07:00'))
    assert.doesNotMatch(error.message, /{time}/)
    const other = await restate(Object.assign(new Error('Server unavailable. Please try again.'), { messageKey: 'server_error_page' }))
    assert.equal(other.message, KM.server_error_page, 'a sentence without a time slot is unchanged by the restatement')
  } finally { delete (globalThis as { document?: unknown }).document }
})

await runTest('both packs carry the three sentences with the time slot; Khmer is short and has no English', () => {
  for (const key of ['read_budget_paused', 'read_budget_shed_banner', 'read_budget_reserved_banner']) {
    assert.match(EN[key], /\{time\}/, key)
    assert.match(KM[key], /\{time\}/, key)
    assert.notEqual(KM[key], EN[key], key)
    assert.doesNotMatch(KM[key].split('{time}').join(''), /[A-Za-z]/, key)
    assert.ok(KM[key].length <= EN[key].length * 1.6, `${key}: Khmer is about the English length`)
  }
  assert.equal(EN.read_budget_paused, 'Paused until {time} to keep selling running.')
})

await runTest('App mounts one banner that follows the transport event and gives way to the database-limit bar', () => {
  const app = fs.readFileSync(path.join(FRONTEND, 'src', 'App.tsx'), 'utf8')
  assert.equal((app.match(/<ReadBudgetBanner \/>/g) || []).length, 1)
  const banner = fs.readFileSync(path.join(FRONTEND, 'src', 'components', 'server', 'ReadBudgetBanner.tsx'), 'utf8')
  assert.match(banner, /READ_BUDGET_EVENT/)
  assert.match(banner, /D1_DAILY_LIMIT_EVENT/)
  assert.match(banner, /if \(!pause \|\| limited\) return null/)
  assert.match(banner, /w-full/)
})

await runTest('the transport never lets a budget refusal reach the outage path', () => {
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'http.ts'), 'utf8').replace(/\r\n/g, '\n')
  const note = source.slice(source.indexOf('function noteReadFailure'), source.indexOf('function throwIfRequestAborted'))
  assert.match(note, /isReadBudgetCode\(error\?\.code\)/)
  assert.ok(note.indexOf('isReadBudgetCode') < note.indexOf('suspectServerDown()'), 'the budget code returns before the probe is asked')
  const shed = source.slice(source.indexOf('function applyReadBudgetPause'), source.indexOf('async function restateInKhmer'))
  assert.doesNotMatch(shed, /setServerHealth|cacheClearAll|dispatchGlobalDataRefresh|pingServerHealth/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('readBudgetShed: all passed')
