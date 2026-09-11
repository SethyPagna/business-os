import assert from 'node:assert/strict'
import fs from 'node:fs'
import { apiFetch, cacheClearAll, cacheGet, cacheSet, route, setSyncServerUrl } from '../src/api/http.ts'
import { getSales } from '../src/api/salesTransport.ts'
import { withLoaderTimeout } from '../src/utils/loaders.ts'

type TestCallback = () => void | Promise<void>
type FetchCall = Parameters<typeof fetch>

let failed = 0

const windowEvents = new EventTarget()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: Event) => windowEvents.dispatchEvent(event),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => windowEvents.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => windowEvents.removeEventListener(type, listener),
  },
})

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function resetReadState(): void {
  cacheClearAll()
  setSyncServerUrl('https://sync.example.test')
}

await runTest('Sales page owns and cancels the transport signal at timeout and inactivity boundaries', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  assert.match(source, /const loadAbortRef = useRef<AbortController \| null>\(null\)/)
  assert.match(source, /const controller = new AbortController\(\)[\s\S]*fetchSales\(params, \{ signal: controller\.signal \}\)/)
  assert.match(source, /finally \{[\s\S]{0,420}controller\.abort\(\)[\s\S]{0,220}loadAbortRef\.current === controller/)
  assert.match(source, /if \(!isActive\) \{[\s\S]{0,220}loadAbortRef\.current\?\.abort\(\)[\s\S]{0,160}invalidateTrackedRequest\(loadRequestRef\)/)
  assert.match(source, /aliveRef\.current = true\s+\/\/[\s\S]{0,260}loadSales\(false\)/)
  assert.match(source, /else if \(!silent\) \{\s+setLoadError\(translateOr\('sales_refresh_failed'/)
  assert.match(source, /useEffect\(\(\) => \(\) => \{[\s\S]{0,220}loadAbortRef\.current\?\.abort\(\)[\s\S]{0,180}invalidateTrackedRequest\(loadRequestRef\)/)
})

await runTest('Sales only replays a queued filter refresh after the active request succeeds', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  const helperMatch = source.match(/function resolvePendingSalesLoad\([\s\S]*?\n\}/)
  assert.ok(helperMatch, 'queued-load settlement policy must stay explicit and testable')
  const runnableHelper = helperMatch[0]
    .replace('pending: PendingSalesLoad | null', 'pending')
    .replace('completedSuccessfully: boolean', 'completedSuccessfully')
    .replace('): PendingSalesLoad | null', ')')
  const resolvePendingSalesLoad = new Function(`${runnableHelper}; return resolvePendingSalesLoad`)() as (
    pending: { silent: boolean } | null,
    completedSuccessfully: boolean,
  ) => { silent: boolean } | null

  const pendingForeground = { silent: false }
  const pendingBackground = { silent: true }
  assert.equal(resolvePendingSalesLoad(pendingForeground, false), null, 'a failed foreground request must consume its queued foreground retry')
  assert.equal(resolvePendingSalesLoad(pendingBackground, false), null, 'a failed background request must not start another automatic request')
  assert.equal(resolvePendingSalesLoad(pendingForeground, true), pendingForeground, 'a successful stale query still needs the newest foreground filters')
  assert.equal(resolvePendingSalesLoad(pendingBackground, true), pendingBackground, 'a successful request still coalesces one pending sync refresh')

  assert.match(source, /let completedSuccessfully = false[\s\S]*setSales\(rows\)[\s\S]{0,180}completedSuccessfully = true/)
  const settlement = source.slice(source.indexOf('const wrappedPromise = promise.finally'), source.indexOf('loadPromiseRef.current = wrappedPromise'))
  assert.ok(settlement.includes('if (loadPromiseRef.current !== wrappedPromise) return'), 'only the active request may consume this scope\'s queued load')
  assert.ok(settlement.indexOf('const pending = resolvePendingSalesLoad(pendingLoadRef.current, completedSuccessfully)') < settlement.indexOf('pendingLoadRef.current = null'), 'settlement resolves the queued intent before consuming its slot')
  assert.ok(settlement.includes('if (pending && requestSecurity === statusSecurityRef.current)'), 'a queued replay is limited to the request security scope that created it')
  assert.match(settlement, /queueMicrotask\(\(\) => \{\s*if \(requestSecurity !== statusSecurityRef\.current\) return\s*const nextLoad = latestLoadRef\.current \|\| loadSales\s*nextLoad\(Boolean\(pending\.silent\)\)/, 'the deferred replay rechecks scope immediately before invoking the latest loader')
  assert.match(source, /\{loadError && !loading \? \([\s\S]{0,500}role="alert"[\s\S]{0,500}onClick=\{\(\) => loadSales\(false\)\}/, 'a failed refresh with retained rows must expose the manual Retry action')
})

await runTest('Sales retries an immediate network failure and accepts the successful retry', async () => {
  resetReadState()
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    if (calls.length === 1) return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve(jsonResponse([{ id: 17 }]))
  }) as typeof fetch

  try {
    const result = await getSales({ page: 1, limit: 20 }, { timeoutMs: 1000 })
    assert.deepEqual(result, [{ id: 17 }])
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    cacheClearAll()
    setSyncServerUrl('')
  }
})

await runTest('aborting an active Sales retry stops the fetch and prevents a late cache write', async () => {
  resetReadState()
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const calls: FetchCall[] = []
  let secondStarted!: () => void
  const secondStartedPromise = new Promise<void>((resolve) => { secondStarted = resolve })

  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    if (calls.length === 1) return Promise.reject(new TypeError('Failed to fetch'))
    secondStarted()
    const signal = args[1]?.signal
    return new Promise<Response>((resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (signal?.aborted) rejectAbort()
      else signal?.addEventListener('abort', rejectAbort, { once: true })
      // A server response arriving after cancellation must never become cache.
      setTimeout(() => resolve(jsonResponse([{ id: 99 }])), 100)
    })
  }) as typeof fetch

  const channel = 'sales:get:page=1&limit=20'
  try {
    const request = getSales({ page: 1, limit: 20 }, { signal: controller.signal, timeoutMs: 1000 })
    await secondStartedPromise
    controller.abort()
    await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === 'AbortError')
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(calls.length, 2)
    assert.equal(cacheGet(channel), null)
  } finally {
    globalThis.fetch = originalFetch
    cacheClearAll()
    setSyncServerUrl('')
  }
})

await runTest('the Sales route policy lets a timed-out read consume one attempt', async () => {
  resetReadState()
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1
    return new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (init?.signal?.aborted) rejectAbort()
      else init?.signal?.addEventListener('abort', rejectAbort, { once: true })
    })
  }) as typeof fetch

  try {
    await assert.rejects(
      () => route(
        'sales:get:deadline-test',
        () => apiFetch('GET', '/api/sales?page=2&limit=20', undefined, 20),
        null,
        { retryTimedOutRead: false },
      ),
      (error: unknown) => error instanceof Error && /timed out after/i.test(error.message),
    )
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
    cacheClearAll()
    setSyncServerUrl('')
  }
})

await runTest('the Sales stale-cache policy awaits the refresh owned by its abort signal', async () => {
  resetReadState()
  const originalNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  cacheSet('sales:get:stale-deadline-test', [{ id: 'stale' }])
  now += 20_001
  let resolveFresh!: () => void
  const fresh = new Promise<Array<{ id: string }>>((resolve) => {
    resolveFresh = () => resolve([{ id: 'fresh' }])
  })

  try {
    let settled = false
    const request = route(
      'sales:get:stale-deadline-test',
      () => fresh,
      null,
      { staleWhileRevalidate: false },
    ).finally(() => { settled = true })
    await Promise.resolve()
    assert.equal(settled, false, 'stale data must not detach the refresh from the caller deadline')
    resolveFresh()
    assert.deepEqual(await request, [{ id: 'fresh' }])
  } finally {
    Date.now = originalNow
    cacheClearAll()
    setSyncServerUrl('')
  }
})

await runTest('a page deadline aborts an already-started local fallback before it can cache late data', async () => {
  resetReadState()
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1
    return new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (init?.signal?.aborted) rejectAbort()
      else init?.signal?.addEventListener('abort', rejectAbort, { once: true })
    })
  }) as typeof fetch

  const channel = 'sales:get:late-local-deadline-test'
  try {
    const request = withLoaderTimeout(
      () => route(
        channel,
        () => apiFetch('GET', '/api/sales?page=3&limit=20', undefined, 15, { signal: controller.signal }),
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return [{ id: 'local-late' }]
        },
        {
          raceLocalFallback: false,
          retryTimedOutRead: false,
          signal: controller.signal,
        },
      ),
      'Sales',
      20,
    ).finally(() => controller.abort())

    await assert.rejects(
      request,
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'loader_timeout',
    )
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(calls, 1)
    assert.equal(cacheGet(channel), null)
  } finally {
    controller.abort()
    globalThis.fetch = originalFetch
    cacheClearAll()
    setSyncServerUrl('')
  }
})

if (failed > 0) process.exitCode = 1
