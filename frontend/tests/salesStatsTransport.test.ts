import assert from 'node:assert/strict'
import {
  __resetApiHealthForTests, __resetApiWriteDedupeForTests,
  cacheClearAll, cacheGet, cacheInvalidate, cacheSet, isApiVersionMismatchError, isD1DailyLimitActive,
  route, setSyncServerUrl, setSyncToken,
} from '../src/api/http.ts'
import { getSalesStats } from '../src/api/salesTransport.ts'
import { buildQueryString, type QueryParams } from '../src/api/query.ts'
import {
  actorReadResultScope, captureActorReadScope, isActorReadScopeCurrent,
  resetActorReadSession,
} from '../src/api/actorReadScope.ts'

type Stats = {
  total_count: number; revenue_count: number; revenue_usd: number
  pending_revenue_usd: number; revenue_without_not_paid_usd?: number | null
  not_paid_owed_usd: number; truncated_in_list: boolean
}
type FetchCall = { url: URL; init?: RequestInit }
type ApiError = Error & { code?: string; status?: number; timeoutMs?: number }

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size }, clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)) },
    removeItem: (key) => { values.delete(String(key)) },
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent')
const originalFetch = globalThis.fetch
const originalNow = Date.now
const localStorage = storage()
const sessionStorage = storage()
const events: Event[] = []
const browser = {
  localStorage, sessionStorage, setTimeout, clearTimeout,
  dispatchEvent: (event: Event) => { events.push(event); return true },
  addEventListener: () => {}, removeEventListener: () => {},
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: browser })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
if (typeof globalThis.CustomEvent === 'undefined') {
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, writable: true, value: class<T> extends Event {
    detail: T | undefined
    constructor(type: string, init?: CustomEventInit<T>) { super(type, init); this.detail = init?.detail }
  } })
}

function actor(id: number, permissions: Record<string, unknown> = { sales: 'full' }): void {
  localStorage.setItem('businessos_user', JSON.stringify({ id, organization_id: 1, role_code: 'staff', permissions }))
  resetActorReadSession()
}
function reset(): void {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  cacheClearAll()
  localStorage.clear(); sessionStorage.clear(); events.length = 0
  setSyncToken(''); setSyncServerUrl('https://sales-stats.example.test')
  Date.now = originalNow
  actor(1)
}
function payload(overrides: Partial<Stats> = {}): Stats {
  return {
    total_count: 3, revenue_count: 2, revenue_usd: 17.25,
    pending_revenue_usd: 5.5, revenue_without_not_paid_usd: 11.75,
    not_paid_owed_usd: 4.25, truncated_in_list: false, ...overrides,
  }
}
function zero(): Stats {
  return payload({ total_count: 0, revenue_count: 0, revenue_usd: 0, pending_revenue_usd: 0,
    revenue_without_not_paid_usd: 0, not_paid_owed_usd: 0 })
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function key(params: QueryParams = {}): string {
  return `sales:stats:${buildQueryString(params, { skipEmpty: false })}`
}
function installFetch(handler: (call: FetchCall, index: number) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: new URL(String(input)), init }
    calls.push(call)
    assert.ok(call.url.pathname === '/api/sales/stats' || call.url.pathname === '/health', `this endpoint must not issue unrelated data requests (${call.url.pathname}); only the health probe a failed read asks for is allowed`)
    return Promise.resolve(handler(call, calls.length - 1))
  }) as typeof fetch
  return calls
}
const statsCalls = (calls: FetchCall[]) => calls.filter((call) => call.url.pathname === '/api/sales/stats')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`fixture did not reach ${label}`)), 2000)
    })])
  } finally { clearTimeout(timer) }
}
const invalid = (error: unknown) => (error as ApiError)?.code === 'invalid_sales_stats_response'
const stale = (error: unknown) => (error as ApiError)?.code === 'stale_read_scope'
const aborted = (error: unknown) => (error as Error)?.name === 'AbortError'
function assertRecoveryEvents(since: number): void {
  const recovery = events.slice(since)
  assert.ok(recovery.some((event) => event.type === 'server:health' && (event as CustomEvent).detail?.online === true))
  assert.ok(recovery.some((event) => event.type === 'sync:update' && (event as CustomEvent).detail?.channel === 'sales'), 'existing Sales sync effect must receive a fresh-read trigger')
  assert.ok(recovery.some((event) => event.type === 'sync:reconnected'))
}
let passed = 0
let failed = 0
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  reset()
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}`, error) }
  finally {
    __resetApiHealthForTests(); cacheClearAll(); Date.now = originalNow
    globalThis.fetch = originalFetch
  }
}

try {
  for (const [label, body] of [['positive', payload()], ['genuine empty zero', zero()]] as const) {
    await test(`${label} server response is cached intact with actor provenance`, async () => {
      const params = { startDate: '2026-10-28', endDate: '2026-10-29', status: 'completed' }
      const calls = installFetch(() => json(body))
      const expectedScope = captureActorReadScope(key(params))
      const first = await getSalesStats(params)
      assert.deepEqual(first, body)
      assert.strictEqual(cacheGet(key(params)), first, 'cache retains the validated server object')
      const fallback = { authority: 'unmarked', channel: key(params), revision: 'unmarked' }
      assert.deepEqual(actorReadResultScope(first, fallback), expectedScope, 'post-route validation must not lose WeakMap provenance')
      assert.strictEqual(await getSalesStats(params), first, 'same scoped fresh cache remains first-class data')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].init?.credentials, 'include')
      assert.equal(calls[0].url.searchParams.get('status'), 'completed')
    })
  }

  for (const legacy of ['missing', 'null'] as const) {
    await test(`legacy paid-only ${legacy} is unavailable without inventing a zero`, async () => {
      const body = payload()
      if (legacy === 'missing') delete body.revenue_without_not_paid_usd
      else body.revenue_without_not_paid_usd = null
      const calls = installFetch(() => json(body))
      const result = await getSalesStats()
      assert.deepEqual(result, body)
      assert.equal((result as Stats).revenue_without_not_paid_usd, legacy === 'missing' ? undefined : null)
      assert.strictEqual(cacheGet(key()), result)
      assert.equal(calls.length, 1)
    })
  }

  await test('period, explicit alltime, status, user and search are separate exact cohorts', async () => {
    const queries: QueryParams[] = [
      { startDate: '', endDate: '', status: 'awaiting_payment' },
      { startDate: '2026-10-28', endDate: '2026-10-29', startTime: '09:00', endTime: '17:00', status: 'completed' },
      { startDate: '2026-10-28', endDate: '2026-10-29', userId: '7', status: 'cancelled', search: 'KH % receipt' },
    ]
    const bodies = queries.map((_, index) => payload({ revenue_usd: 10 + index, truncated_in_list: index === 2 }))
    const calls = installFetch((_call, index) => json(bodies[index]))
    for (let index = 0; index < queries.length; index++) {
      assert.deepEqual(await getSalesStats(queries[index]), bodies[index])
      assert.equal(calls[index].url.search.slice(1), buildQueryString(queries[index], { skipEmpty: false }))
    }
    for (let index = 0; index < queries.length; index++) assert.deepEqual(await getSalesStats(queries[index]), bodies[index])
    assert.equal(calls.length, queries.length)
  })

  const malformed: Array<[string, unknown]> = [
    ['null', null], ['array', []], ['empty object', {}],
    ['old synthetic fallback', { total_count: 0, revenue_usd: 0, pending_revenue_usd: 0, truncated_in_list: false }],
    ['failed envelope', { ...payload(), success: false }],
    ['missing count', { ...payload(), revenue_count: undefined }],
    ['string count', { ...payload(), total_count: '3' }],
    ['fractional count', { ...payload(), total_count: 3.5 }],
    ['negative count', { ...payload(), revenue_count: -1 }],
    ['unsafe count', { ...payload(), total_count: Number.MAX_SAFE_INTEGER + 1 }],
    ['null revenue', { ...payload(), revenue_usd: null }],
    ['string revenue', { ...payload(), revenue_usd: '17.25' }],
    ['missing pending', { ...payload(), pending_revenue_usd: undefined }],
    ['bad paid-only', { ...payload(), revenue_without_not_paid_usd: '11.75' }],
    ['bad owed', { ...payload(), not_paid_owed_usd: '4.25' }],
    ['bad truncation', { ...payload(), truncated_in_list: 'false' }],
  ]
  for (const [label, bad] of malformed) {
    await test(`malformed HTTP200 ${label} never enters cache and next retry fetches truth`, async () => {
      const good = payload({ revenue_usd: 99.125 })
      const calls = installFetch((_call, index) => json(index === 0 ? bad : good))
      await assert.rejects(getSalesStats(), invalid)
      assert.equal(cacheGet(key()), null)
      assert.equal(calls.length, 1)
      assert.deepEqual(await getSalesStats(), good)
      assert.equal(calls.length, 2, 'a failed read cannot create a successful zero cache hit')
    })
  }

  for (const [label, bad] of [
    ['synthetic object', malformed[3][1]], ['NaN', { ...payload(), revenue_usd: NaN }],
    ['Infinity', { ...payload(), pending_revenue_usd: Infinity }],
  ] as Array<[string, unknown]>) {
    await test(`poisoned fresh cache ${label} is rejected and retired`, async () => {
      cacheSet(key(), bad)
      const readScope = captureActorReadScope(key())
      const calls = installFetch(() => { throw Error('fresh-cache validation must not silently fetch or replace the refusal') })
      await assert.rejects(getSalesStats(), invalid)
      assert.equal(cacheGet(key()), null)
      assert.equal(isActorReadScopeCurrent(readScope), true, 'value eviction must not invalidate the component catch that displays this error')
      assert.equal(calls.length, 0)
      installFetch(() => json(payload()))
      assert.deepEqual(await getSalesStats(), payload())
    })
  }

  await test('finite server money is preserved without new rounding or arithmetic policy', async () => {
    const body = payload({ revenue_usd: -1.23456789, pending_revenue_usd: 0.123456789, revenue_without_not_paid_usd: null })
    installFetch(() => json(body))
    assert.deepEqual(await getSalesStats(), body)
  })

  for (const [status, code] of [[413, 'report_too_many_rows'], [422, 'invalid_saved_money4'],
    [500, 'internal_error'], [503, 'd1_daily_limit']] as const) {
    await test(`HTTP${status}/${code} is a refusal, never cached financial zero`, async () => {
      const body = payload({ revenue_usd: 42 })
      const calls = installFetch((_call, index) => index === 0 ? json({ success: false, error: 'Synthetic refusal', code }, status) : json(body))
      await assert.rejects(getSalesStats(), (error: unknown) => (error as ApiError)?.status === status && (error as ApiError)?.code === code)
      assert.equal(cacheGet(key()), null)
      assert.equal(calls.length, 1)
      if (status === 503) {
        // The Worker's daily-cap answer is not an outage (api/http.ts D1_DAILY_LIMIT_CODE): the banner is raised, no health probe, reconnect or
        // refresh event follows, and the first API answer that succeeds lifts the banner and is cached as true data.
        assert.equal(isD1DailyLimitActive(), true, 'the refusal raises the daily-limit banner')
        assert.equal(events.some((event) => event.type === 'server:health' || event.type === 'sync:reconnected'), false, 'a cap is not an outage')
        assert.equal(calls.length, 1)
        const fresh = await getSalesStats()
        assert.deepEqual(fresh, body)
        assert.strictEqual(cacheGet(key()), fresh, 'the next answer is cached as the truth, never the refusal')
        assert.equal(isD1DailyLimitActive(), false, 'the first successful API answer lifts the banner')
        assert.equal(calls.length, 2)
      } else {
        assert.deepEqual(await getSalesStats(), body)
        assert.equal(calls.length, 2)
      }
    })
  }

  await test('invalid JSONHTTP200 is not rewritten as a successful empty report', async () => {
    const calls = installFetch(() => new Response('{broken', { status: 200 }))
    await assert.rejects(getSalesStats())
    assert.equal(cacheGet(key()), null)
    assert.equal(calls.length, 1)
  })

  await test('connectivity failure remains failed and manual recovery does not reuse zero', async () => {
    let failing = true
    const calls = installFetch(() => {
      if (failing) throw new TypeError('Failed to fetch')
      return json(payload())
    })
    await assert.rejects(getSalesStats())
    assert.equal(cacheGet(key()), null)
    const failedAttempts = statsCalls(calls).length
    assert.ok(failedAttempts >= 1, 'failed attempts must actually reach native fetch')
    failing = false
    const beforeRecovery = events.length
    const recovered = await getSalesStats()
    assert.deepEqual(recovered, payload(), 'the recovery call returns what the server said now, never a zero')
    // Recovery announces itself through the refresh events (api/syncRuntime.ts delivers them to the pages); it no longer clears every cache,
    // so the scope is not invalidated here and a page's own sales effect is what asks again.
    assertRecoveryEvents(beforeRecovery)
    const fresh = await getSalesStats()
    assert.deepEqual(fresh, payload())
    assert.strictEqual(cacheGet(key()), fresh)
    assert.ok(statsCalls(calls).length >= failedAttempts + 1, 'recovery reads from the server, it does not reuse the failed attempt')
  })

  await test('configured timeout reaches the actual fetch signal and never caches zero', async () => {
    let abortedAttempts = 0
    const calls = installFetch(({ init }) => new Promise<Response>((_resolve, reject) => {
      const safety = setTimeout(() => reject(new Error('fixture: configured timeout did not reach fetch')), 750)
      const abort = () => {
        clearTimeout(safety); abortedAttempts++
        reject(Object.assign(new Error('native fetch aborted'), { name: 'AbortError' }))
      }
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    }))
    await assert.rejects(getSalesStats({}, { timeoutMs: 25 }), (error: unknown) =>
      (error as ApiError)?.code === 'request_timeout' && (error as ApiError)?.timeoutMs === 25)
    assert.equal(cacheGet(key()), null)
    assert.ok(statsCalls(calls).length >= 1)
    assert.equal(abortedAttempts, statsCalls(calls).length, 'every stats request received the abort')
  })

  await test('no configured endpoint and no snapshot is unavailable, not a local zero', async () => {
    setSyncServerUrl('')
    const calls = installFetch(() => { throw Error('no endpoint must not dispatch fetch') })
    await assert.rejects(getSalesStats(), invalid)
    assert.equal(cacheGet(key()), null)
    assert.equal(calls.length, 0)
  })

  for (const status of [401, 403]) {
    await test(`HTTP${status} cannot adopt fallback or stale private aggregate`, async () => {
      const calls = installFetch((_call, index) => index === 0 ? json(payload()) : json({ error: 'Denied', code: status === 401 ? 'invalid_session' : 'forbidden' }, status))
      await getSalesStats()
      Date.now = () => originalNow() + 21_000
      await assert.rejects(getSalesStats(), (error: unknown) => (error as ApiError)?.status === status)
      assert.equal(cacheGet(key()), null)
      assert.equal(calls.length, 2, 'private stale data must not beat the live permission decision')
    })
  }

  await test('explicit version mismatch remains version mismatch without a fabricated aggregate', async () => {
    const calls = installFetch(() => json({ code: 'api_version_mismatch', error: 'Synthetic version mismatch', reason: 'missing_required_api' }, 409))
    await assert.rejects(getSalesStats(), isApiVersionMismatchError)
    assert.equal(cacheGet(key()), null)
    assert.equal(calls.length, 1)
  })

  await test('fresh cached actorA aggregate is not a hit for actorB', async () => {
    const bodies = [payload({ revenue_usd: 11 }), payload({ revenue_usd: 22 })]
    const calls = installFetch((_call, index) => json(bodies[index]))
    await getSalesStats()
    actor(2)
    assert.equal(cacheGet(key()), null)
    assert.deepEqual(await getSalesStats(), bodies[1])
    assert.equal(calls.length, 2)
  })

  for (const change of ['account', 'same-user-grants'] as const) {
    await test(`late server result cannot publish/cache after ${change} changes`, async () => {
      const started = deferred<void>()
      const response = deferred<Response>()
      const calls = installFetch((_call, index) => {
        if (index === 0) { started.resolve(); return response.promise }
        return json({ error: 'Denied', code: 'forbidden' }, 403)
      })
      const old = getSalesStats()
      const checked = change === 'account' ? assert.rejects(old, stale) : assert.rejects(old, (error: unknown) => (error as ApiError)?.status === 403)
      await within(started.promise, 'late-result fetch')
      if (change === 'account') actor(2)
      else localStorage.setItem('businessos_user', JSON.stringify({ id: 1, organization_id: 1, role_code: 'staff', permissions: { sales: 'none' } }))
      response.resolve(json(payload({ revenue_usd: 999 })))
      await checked
      assert.equal(cacheGet(key()), null, 'the late body is neither returned nor cached')
      assert.equal(calls.length, change === 'account' ? 1 : 2, 'a changed account is not re-issued; the same user is re-issued once, as a new request')
    })
  }

  for (const oldFirst of [true, false]) {
    await test(`invalidation fences old response and preserves new cache (oldFirst=${oldFirst})`, async () => {
      const oldStarted = deferred<void>()
      const freshStarted = deferred<void>()
      const oldResponse = deferred<Response>()
      const freshResponse = deferred<Response>()
      const calls = installFetch((_call, index) => {
        if (index === 0) { oldStarted.resolve(); return oldResponse.promise }
        freshStarted.resolve(); return freshResponse.promise
      })
      const oldCheck = assert.rejects(getSalesStats(), stale)
      await within(oldStarted.promise, 'old invalidated fetch')
      cacheInvalidate('sales')
      const fresh = getSalesStats()
      await within(freshStarted.promise, 'fresh invalidated fetch')
      if (oldFirst) { oldResponse.resolve(json(payload({ revenue_usd: 1 }))); await oldCheck }
      freshResponse.resolve(json(payload({ revenue_usd: 2 })))
      const good = await fresh
      if (!oldFirst) { oldResponse.resolve(json(payload({ revenue_usd: 1 }))); await oldCheck }
      assert.equal((good as Stats).revenue_usd, 2)
      assert.strictEqual(cacheGet(key()), good)
      assert.strictEqual(await getSalesStats(), good)
      assert.equal(calls.length, 2)
    })
  }

  await test('caller abort is forwarded to actual pending fetch', async () => {
    const started = deferred<void>()
    let sawAbort = false
    const calls = installFetch(({ init }) => new Promise<Response>((_resolve, reject) => {
      const safety = setTimeout(() => reject(new Error('fixture: caller abort did not reach fetch')), 750)
      const abort = () => { clearTimeout(safety); sawAbort = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
      started.resolve()
    }))
    const controller = new AbortController()
    const checked = assert.rejects(getSalesStats({}, { signal: controller.signal }), aborted)
    await within(started.promise, 'abortable fetch')
    controller.abort()
    await checked
    assert.equal(sawAbort, true)
    assert.equal(calls.length, 1)
    assert.equal(cacheGet(key()), null)
  })

  await test('abort after fresh-cache resolution is fenced at the service final await boundary', async () => {
    const calls = installFetch(() => json(payload()))
    const good = await getSalesStats()
    const controller = new AbortController()
    const pending = getSalesStats({}, { signal: controller.signal })
    const checked = assert.rejects(pending, aborted)
    controller.abort()
    await checked
    assert.equal(calls.length, 1)
    assert.strictEqual(cacheGet(key()), good, 'abort must not retire a valid cache entry')
  })

  await test('actor switch during fresh-cache final await cannot return actorA result', async () => {
    const calls = installFetch(() => json(payload()))
    await getSalesStats()
    const scopeA = captureActorReadScope(key())
    const checked = assert.rejects(getSalesStats(), stale)
    actor(2)
    await checked
    assert.equal(isActorReadScopeCurrent(scopeA), false)
    assert.equal(cacheGet(key()), null)
    assert.equal(calls.length, 1)
  })

  await test('endpoint-specific refusal does not disable genuine generic local mirrors', async () => {
    const mirror = [{ id: 7, name: 'synthetic mirrored record' }]
    const result = await route('mirror:stats-control', () => Promise.reject(Object.assign(new Error('Gateway'), { status: 530 })), () => mirror)
    assert.strictEqual(result, mirror)
    assert.strictEqual(cacheGet('mirror:stats-control'), mirror)
  })
} finally {
  __resetApiHealthForTests(); cacheClearAll(); setSyncServerUrl(''); setSyncToken('')
  Date.now = originalNow; globalThis.fetch = originalFetch
  for (const [name, descriptor] of [['window', originalWindow], ['navigator', originalNavigator], ['CustomEvent', originalCustomEvent]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
}

if (failed) {
  console.error(`${failed} sales stats transport test(s) failed; ${passed} passed`)
  process.exitCode = 1
} else console.log(`All ${passed} actual sales stats transport tests passed`)
