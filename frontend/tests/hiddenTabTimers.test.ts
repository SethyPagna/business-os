// U-sync phase 1, task 6: the 30 s server health probe and the 20 s
// pending-sync poll do nothing while the tab is hidden, and run once when it
// becomes visible again.
//
// The health probe's "once on becoming visible" is web-api.ts's existing
// visibilitychange recovery (recoverForegroundSession -> pingServerHealth);
// http.ts must not register a second listener for it
// (performanceLoadingUx.test.ts pins that), so this file checks the hand-off
// in web-api.ts's source and that http.ts's own ticks resume when visible.
//
// Both drive the real code: the health check through the real api/http.ts
// module, the poll by executing App.tsx's own scheduleDeferredPendingSyncPolling
// source (App.tsx is .tsx and pulls in the whole shell, so the one function is
// transpiled on its own, the way permissionRefreshAccumulator.test.ts does).
//
// Red on the old code: both ticks ran unconditionally, so the hidden-tab
// assertions see a fetch / a refresh.
// The offline snapshot schedule is deliberately NOT covered: pausing it needs
// the owner's freshness decision (I7 audit #3).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Listener = () => void
function fakeDocument() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener(type: string, fn: Listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn) },
    removeEventListener(type: string, fn: Listener) { listeners.get(type)?.delete(fn) },
    fire(type: string) { for (const fn of [...(listeners.get(type) || [])]) fn() },
    count(type: string) { return listeners.get(type)?.size || 0 },
  }
}

const doc = fakeDocument()
Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  writable: true,
  value: { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true },
})

const http = await import('../src/api/http.ts')
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

// Captures the callbacks startHealthCheck schedules instead of waiting 30 s.
function startHealthCheckCapturing(): { interval: () => unknown; initial: () => unknown } {
  const realSetInterval = globalThis.setInterval
  const realSetTimeout = globalThis.setTimeout
  // A holder object, not two lets: TS narrows a closure-assigned let to null.
  const captured: { interval: (() => unknown) | null; initial: (() => unknown) | null } = { interval: null, initial: null }
  globalThis.setInterval = ((fn: () => unknown) => { captured.interval = fn; return 1 }) as unknown as typeof setInterval
  globalThis.setTimeout = ((fn: () => unknown) => { captured.initial = fn; return 2 }) as unknown as typeof setTimeout
  try {
    http.startHealthCheck()
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.setTimeout = realSetTimeout
  }
  const { interval, initial } = captured
  assert.ok(interval && initial, 'startHealthCheck must schedule an interval and an initial probe')
  return { interval, initial }
}

await runTest('health check: probes while visible, skips while hidden, and the next visible tick probes again', async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = (async () => { fetches += 1; return new Response(JSON.stringify({ status: 'ok' }), { status: 200 }) }) as typeof fetch
  try {
    http.__resetApiHealthForTests()
    http.setSyncServerUrl('https://sync.example.test')

    // Positive control: a visible tick really probes, so a zero below means "skipped".
    doc.visibilityState = 'visible'
    const visible = startHealthCheckCapturing()
    visible.interval()
    await flush()
    assert.equal(fetches, 1, 'a visible tick probes the server')

    http.__resetApiHealthForTests()
    http.setSyncServerUrl('https://sync.example.test')
    doc.visibilityState = 'hidden'
    const hidden = startHealthCheckCapturing()
    hidden.initial()
    hidden.interval()
    hidden.interval()
    await flush()
    assert.equal(fetches, 1, 'no probe while the tab is hidden')

    assert.equal(doc.count('visibilitychange'), 0, 'http.ts adds no visibility listener; web-api.ts owns the resume probe')

    doc.visibilityState = 'visible'
    hidden.interval()
    await flush()
    assert.equal(fetches, 2, 'the same interval probes again once the tab is visible')
  } finally {
    globalThis.fetch = originalFetch
    http.__resetApiHealthForTests()
    http.setSyncServerUrl('')
  }
})

await runTest('becoming visible probes health through web-api.ts foreground recovery', () => {
  const webApi = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(webApi, /document\.addEventListener\('visibilitychange', \(\) => \{\n\s*if \(document\.visibilityState === 'hidden'\) \{[\s\S]{0,120}\}\n\s*recoverAfterBackground\('visibility-resume'\)/)
  assert.match(webApi, /const recoverAfterBackground = [\s\S]{0,300}recoverForegroundSession\(/)
  assert.match(webApi, /const recoverForegroundSession = [\s\S]{0,1400}pingServerHealth\(force\)/)
})

// App.tsx's own function, compiled alone and run against fake timers.
function loadPendingSyncPolling() {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'scheduleDeferredPendingSyncPolling')
  assert.ok(fn, 'scheduleDeferredPendingSyncPolling not found in App.tsx')
  const compiled = ts.transpileModule(`${fn.getText(parsed)}\nreturn scheduleDeferredPendingSyncPolling`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return (windowStub: unknown, documentStub: unknown) => new Function(
    'window', 'document', 'PENDING_SYNC_POLL_INTERVAL_MS', 'PENDING_SYNC_INITIAL_REFRESH_DELAY_MS', compiled,
  )(windowStub, documentStub, 20_000, 1_000) as (refresh: () => void) => () => void
}

await runTest('pending-sync poll: refreshes while visible, skips while hidden, refreshes once on becoming visible, and cleans up', () => {
  const pollDoc = fakeDocument()
  const timers: { interval: (() => void) | null; timeout: (() => void) | null; cleared: number } = { interval: null, timeout: null, cleared: 0 }
  const windowStub = {
    setTimeout: (fn: () => void) => { timers.timeout = fn; return 1 },
    setInterval: (fn: () => void) => { timers.interval = fn; return 2 },
    clearTimeout: () => { timers.cleared += 1 },
    clearInterval: () => { timers.cleared += 1 },
  }
  const schedule = loadPendingSyncPolling()(windowStub, pollDoc)
  let refreshes = 0
  const cancel = schedule(() => { refreshes += 1 })
  assert.ok(timers.timeout)
  timers.timeout()
  const intervalFn = timers.interval
  assert.ok(intervalFn, 'the poll interval starts after the initial delay')

  intervalFn()
  assert.equal(refreshes, 1, 'positive control: a visible tick refreshes')

  pollDoc.visibilityState = 'hidden'
  intervalFn()
  intervalFn()
  assert.equal(refreshes, 1, 'no refresh while hidden')

  pollDoc.visibilityState = 'visible'
  pollDoc.fire('visibilitychange')
  assert.equal(refreshes, 2, 'one refresh on becoming visible')
  pollDoc.fire('visibilitychange')
  assert.equal(refreshes, 2, 'not repeated without a missed tick')

  assert.equal(pollDoc.count('visibilitychange'), 1)
  cancel()
  assert.equal(pollDoc.count('visibilitychange'), 0, 'cancel removes the visibility listener')
  assert.equal(timers.cleared, 2, 'cancel clears both timers')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('All hiddenTabTimers tests passed')
