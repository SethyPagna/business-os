// F2 (idle efficiency): what an open tab costs the network while nobody is
// using it, and that the health signal still follows a dropped network.
//
// What the pre-F2 code did that this file rejects:
//   - the 30 s /health interval probed while the tab was hidden, and while
//     the sync socket was already proving liveness;
//   - nothing reacted to the socket dropping until the next 30 s tick;
//   - AppContext polled isWSConnected() every 500 ms / 3 s for the session.
// The positive controls (a visible tab with no socket still probes every
// tick; an offline server is re-probed every tick; the browser 'offline'
// event flips health at once) pass before and after -- they are what keeps
// the budget cut from being a disabled health check.
// Sibling files: websocketStaleSocket.test.ts, pendingSyncPolling.test.ts,
// cloudflare/scripts/test-broadcast-hub-autopong-pure.cjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type Listener = (event: { type: string; detail?: unknown }) => void

let now = 5_000_000
let visibilityState = 'visible'
const listeners = new Map<string, Set<Listener>>()
const dispatched: Array<{ type: string; detail?: unknown }> = []
const intervals: Array<{ id: number; ms: number; callback: () => void }> = []
let nextTimerId = 1

const originalDateNow = Date.now
const originalSetInterval = globalThis.setInterval
const originalSetTimeout = globalThis.setTimeout
const originalFetch = globalThis.fetch

Date.now = () => now
globalThis.setInterval = ((callback: () => void, ms = 0) => {
  const id = nextTimerId++
  intervals.push({ id, ms: Number(ms), callback })
  return id
}) as unknown as typeof setInterval
// Initial-delay timers are not under test; never fire them.
globalThis.setTimeout = ((() => nextTimerId++) as unknown) as typeof setTimeout

function storage(): Storage {
  const values = new Map<string, string>([['businessos_user', '{"id":1}']])
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v) },
    removeItem: (k: string) => { values.delete(k) },
  }
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    sessionStorage: storage(),
    localStorage: storage(),
    location: { hostname: 'admin.example.test', origin: 'https://admin.example.test' },
    addEventListener(type: string, listener: Listener) {
      const group = listeners.get(type) || new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener(type: string, listener: Listener) { listeners.get(type)?.delete(listener) },
    dispatchEvent(event: { type: string; detail?: unknown }) {
      dispatched.push(event)
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
    setInterval: (cb: () => void, ms: number) => globalThis.setInterval(cb, ms),
    clearInterval: () => {},
  },
})
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { get visibilityState() { return visibilityState } },
})
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class CustomEvent {
    type: string
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail }
  },
})

const fetchCalls: string[] = []
let networkUp = true
globalThis.fetch = ((url: string) => {
  fetchCalls.push(String(url))
  if (!networkUp) return Promise.reject(new TypeError('Failed to fetch'))
  return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
}) as typeof fetch

const flush = () => new Promise((resolve) => originalSetTimeout(resolve, 0))
function emit(type: string, detail?: unknown) {
  ;(globalThis.window as unknown as { dispatchEvent: (e: unknown) => void }).dispatchEvent({ type, detail })
}

let failures = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    failures += 1
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}

try {
  const http = await import('../src/api/http.ts')
  http.setSyncServerUrl('https://admin.example.test')
  http.startHealthCheck()
  const healthTick = intervals.find((timer) => timer.ms === 30_000)

  // Each tick is 30 s of wall clock; probes older than the 8 s reuse window
  // are never served from cache, so every allowed tick is a real request.
  const tick = async () => { now += 30_000; healthTick!.callback(); await flush(); await flush() }

  await runTest('the 30 s health interval exists and probes a visible tab with no socket', async () => {
    assert.ok(healthTick, 'startHealthCheck must register the 30 s interval')
    fetchCalls.length = 0
    await tick()
    assert.equal(fetchCalls.length, 1, 'a visible tab without a live socket still probes every tick')
  })

  await runTest('a hidden tab never probes /health', async () => {
    visibilityState = 'hidden'
    fetchCalls.length = 0
    for (let i = 0; i < 120; i += 1) await tick() // one hour
    assert.equal(fetchCalls.length, 0, 'hidden-tab ticks must not reach the network')
    visibilityState = 'visible'
  })

  await runTest('an open sync socket counts as liveness: one probe per 5 minutes', async () => {
    emit('sync:status', { connected: true })
    await flush(); await flush()
    fetchCalls.length = 0
    for (let i = 0; i < 120; i += 1) await tick() // one hour
    assert.equal(fetchCalls.length, 12, 'only the 5-minute runtime-version probe should run while the socket is live')
  })

  await runTest('the socket dropping probes at once and the health signal follows', async () => {
    networkUp = false
    fetchCalls.length = 0
    const before = dispatched.length
    emit('sync:status', { connected: false })
    await flush(); await flush()
    assert.equal(fetchCalls.length, 1, 'a dropped socket must trigger an immediate probe, not wait for the tick')
    const health = dispatched.slice(before).find((e) => e.type === 'server:health')
    assert.deepEqual(health?.detail, { online: false }, 'the failed probe must announce the server offline')
    assert.equal(http.isServerOnline(), false)
  })

  await runTest('while offline every visible tick probes, and recovery is announced', async () => {
    fetchCalls.length = 0
    await tick()
    assert.equal(fetchCalls.length, 1, 'an offline server is re-probed every tick even though the socket was the liveness source')
    networkUp = true
    const before = dispatched.length
    await tick()
    assert.deepEqual(dispatched.slice(before).find((e) => e.type === 'server:health')?.detail, { online: true })
  })

  await runTest("the browser 'offline' event flips health immediately (no probe needed)", async () => {
    const before = dispatched.length
    emit('offline')
    assert.deepEqual(dispatched.slice(before).find((e) => e.type === 'server:health')?.detail, { online: false })
  })

  await runTest('AppContext no longer polls the socket state', () => {
    const appContext = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
    assert.doesNotMatch(appContext, /setInterval\(poll/, 'no isWSConnected() polling interval')
    assert.doesNotMatch(appContext, /pollRate/, 'no poll cadence state')
    assert.match(appContext, /const connectedAtRegistration = isWSConnected\(\)\s*setSyncConnected\(connectedAtRegistration\)/, 'one read at registration covers a socket that opened first')
  })
} finally {
  Date.now = originalDateNow
  globalThis.setInterval = originalSetInterval
  globalThis.setTimeout = originalSetTimeout
  globalThis.fetch = originalFetch
}

if (failures > 0) {
  console.error(`${failures} idle network budget test(s) failed`)
  process.exit(1)
}
console.log('idle network budget tests passed')
