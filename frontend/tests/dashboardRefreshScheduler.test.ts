import assert from 'node:assert/strict'

// Browser stand-in: window is an EventTarget so the real adapter and the real
// resume dispatcher run unchanged.
const windowEvents = new EventTarget()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: Event) => windowEvents.dispatchEvent(event),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => windowEvents.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => windowEvents.removeEventListener(type, listener),
  },
})

const { subscribeSyncSignals } = await import('../src/utils/syncSignals.ts')
const { dispatchSyncUpdates, FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS } = await import('../src/api/syncRuntime.ts')
const {
  createDashboardRefreshScheduler,
  DASHBOARD_REFRESH_CHANNELS,
  isStaleReadScopeError,
  isTransientLoadError,
  nextRetryDelayMs,
  DASHBOARD_SYNC_DEBOUNCE_MS,
  DASHBOARD_SYNC_MIN_INTERVAL_MS,
} = await import('../src/components/dashboard/dashboardRefresh.ts')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// A manual clock: timers fire only when the test advances time.
function createClock() {
  let now = 1_000_000
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    host: {
      now: () => now,
      setTimeout: (callback: () => void, delayMs: number) => { const id = nextId++; timers.set(id, { at: now + delayMs, callback }); return id },
      clearTimeout: (id: unknown) => { timers.delete(id as number) },
    },
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
      }
      now = target
    },
  }
}

function setup() {
  const clock = createClock()
  let runs = 0
  const scheduler = createDashboardRefreshScheduler(() => { runs += 1 }, clock.host)
  const stop = subscribeSyncSignals(DASHBOARD_REFRESH_CHANNELS, (signal) => scheduler.signal(signal))
  return { clock, scheduler, stop, runs: () => runs }
}

runTest('one tab resume (22 channels, last is pendingActions) is exactly one refetch', () => {
  const { clock, stop, runs } = setup()
  assert.equal(FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS.at(-1), 'pendingActions', 'the case the single syncChannel slot lost')
  dispatchSyncUpdates(FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS, 'foreground-resume-gap')
  assert.equal(runs(), 0, 'nothing runs before the burst settles')
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS - 1)
  assert.equal(runs(), 0)
  clock.advance(1)
  assert.equal(runs(), 1)
  clock.advance(60_000)
  assert.equal(runs(), 1, 'and never again for the same resume')
  stop()
})

runTest('a reconnect burst (17 channels, then the reconnected event) is one refetch', () => {
  const { clock, stop, runs } = setup()
  dispatchSyncUpdates(['settings', 'products', 'inventory', 'sales', 'returns', 'dashboard', 'notifications', 'pendingActions'])
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS)
  windowEvents.dispatchEvent(new CustomEvent('sync:reconnected'))
  clock.advance(30_000)
  assert.equal(runs(), 1)
  stop()
})

runTest('a burst of sale pushes is one read per 5 s with a single trailing read', () => {
  const { clock, stop, runs } = setup()
  dispatchSyncUpdates(['sales'])
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS)
  assert.equal(runs(), 1)
  // Ten more sales in the next three seconds.
  for (let i = 0; i < 10; i += 1) { clock.advance(300); dispatchSyncUpdates(['sales']); dispatchSyncUpdates(['inventory']) }
  assert.equal(runs(), 1, 'throttled while inside the interval')
  clock.advance(DASHBOARD_SYNC_MIN_INTERVAL_MS)
  assert.equal(runs(), 2, 'exactly one trailing read')
  clock.advance(60_000)
  assert.equal(runs(), 2)
  stop()
})

runTest('a later event after the interval reads again', () => {
  const { clock, stop, runs } = setup()
  dispatchSyncUpdates(['sales'])
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS)
  clock.advance(DASHBOARD_SYNC_MIN_INTERVAL_MS)
  dispatchSyncUpdates(['sales'])
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS)
  assert.equal(runs(), 2)
  stop()
})

runTest('a load started elsewhere (first open, retry) counts toward the interval', () => {
  const { clock, scheduler, stop, runs } = setup()
  scheduler.noteLoad()
  dispatchSyncUpdates(['sales'])
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS)
  assert.equal(runs(), 0, 'held back, not dropped')
  clock.advance(DASHBOARD_SYNC_MIN_INTERVAL_MS)
  assert.equal(runs(), 1)
  stop()
})

runTest('a reconnect right after a read adds nothing; one long after reads', () => {
  const { clock, scheduler, stop, runs } = setup()
  scheduler.noteLoad()
  clock.advance(1_000)
  windowEvents.dispatchEvent(new CustomEvent('sync:reconnected'))
  clock.advance(DASHBOARD_SYNC_MIN_INTERVAL_MS * 3)
  assert.equal(runs(), 0)
  windowEvents.dispatchEvent(new CustomEvent('sync:reconnected'))
  clock.advance(DASHBOARD_SYNC_DEBOUNCE_MS)
  assert.equal(runs(), 1)
  stop()
})

runTest('channels the Dashboard does not show and cache-refresh echoes never read', () => {
  const { clock, stop, runs } = setup()
  dispatchSyncUpdates(['customers', 'suppliers', 'notifications', 'pendingActions', 'users'])
  windowEvents.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'dashboard', reason: 'cache-refresh' } }))
  clock.advance(60_000)
  assert.equal(runs(), 0)
  stop()
})

runTest('dispose cancels a pending read', () => {
  const { clock, scheduler, stop, runs } = setup()
  dispatchSyncUpdates(['sales'])
  scheduler.dispose()
  clock.advance(60_000)
  assert.equal(runs(), 0)
  stop()
})

runTest('a read rejected by the post-login scope reset is recognised, and is not a generic transient failure', () => {
  const stale = Object.assign(new Error('Read belongs to an earlier account or refresh. Please try again.'), { name: 'AbortError', code: 'stale_read_scope' })
  assert.equal(isStaleReadScopeError(stale), true)
  assert.equal(isStaleReadScopeError(new Error('x')), false)
  assert.equal(isTransientLoadError(stale), false, 'it gets its own single silent retry, not the 2 s / 6 s schedule')
})

runTest('retry waits are 2 s then 6 s, then the person decides', () => {
  assert.equal(nextRetryDelayMs(0), 2000)
  assert.equal(nextRetryDelayMs(1), 6000)
  assert.equal(nextRetryDelayMs(2), null)
})

runTest('only failures that can pass on their own are retried', () => {
  const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })
  for (const status of [409, 408, 429, 500, 502, 503, 504, 522]) assert.equal(isTransientLoadError(withStatus(status)), true, `HTTP ${status}`)
  for (const status of [400, 401, 403, 404, 413, 422]) assert.equal(isTransientLoadError(withStatus(status)), false, `HTTP ${status}`)
  assert.equal(isTransientLoadError(Object.assign(new Error('Dashboard took longer than 30s'), { code: 'loader_timeout' })), true)
  assert.equal(isTransientLoadError(new TypeError('Load failed')), true)
  assert.equal(isTransientLoadError(new TypeError('Failed to fetch')), true)
  assert.equal(isTransientLoadError(Object.assign(new Error('x'), { transientGateway: true })), true)
  assert.equal(isTransientLoadError(new Error('Dashboard startup returned incomplete summary data.')), false)
  assert.equal(isTransientLoadError(Object.assign(new Error('sign in'), { code: 'invalid_session', status: 401 })), false)
  assert.equal(isTransientLoadError(null), false)
})

if (failed) process.exit(1)
console.log('PASS dashboard refresh scheduler')
