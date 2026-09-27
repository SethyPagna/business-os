import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

// F1 (27 Sep 2026). Offline selling is cancelled (owner, 26 Sep): queued
// sales drain once through the service worker, offline is a banner plus
// blocked saving, and the PWA stays installable caching app code only.
//
// F1 -- web-api.ts ran a background "offline maintenance" loop: every five
// minutes, and again on every online / focus / visibility / pageshow /
// sync:reconnected event, it scheduled refreshOfflineDeviceSnapshot (eleven
// serial GETs whose results localMirrors.ts throws away on any http(s)
// origin) and a SECOND service-worker update check alongside index.tsx's own.
// After F1 the recovery listeners still resume the socket, ping health and
// refresh screens, but load no snapshot and never touch the worker; index.tsx
// is the one update checker, and it must still fire on its interval, when a
// long-lived till tab becomes visible again, and on the app's own reconnect
// signal (R-F1F3 F-03/F-09: F1 first deleted that reaction instead of moving
// it) -- that is the only way the "Restart now" bar reaches the till.
//
// The web-api case runs the real listeners extracted from the source, so it is
// red against c5b28762, where a focus event loads the snapshot transport and
// asks navigator.serviceWorker for an update.

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

const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

function topLevelFunctions(fileName: string, text: string, names: string[]): string {
  const parsed = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return parsed.statements
    .filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''))
    .map((node) => node.getText(parsed))
    .join('\n')
}

function topLevelConstValue(text: string, name: string): number {
  const match = text.match(new RegExp(`^const ${name} = ([0-9_* ]+)$`, 'm'))
  assert.ok(match, `${name} must stay a named numeric constant`)
  return Number(Function(`return (${match[1].replace(/_/g, '')})`)())
}

function transpile(body: string): string {
  return ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

// A tiny deterministic browser: timers, idle callbacks and intervals are
// recorded, and drain() runs every queued timeout/idle task (including ones
// queued while draining) without waiting for real time.
function fakeBrowser() {
  let clock = 1_000_000
  let nextId = 1
  const timeouts = new Map<number, () => void>()
  const intervals: Array<{ fn: () => void, ms: number }> = []
  const windowTarget = Object.assign(new EventTarget(), {
    setTimeout: (fn: () => void) => { const id = nextId++; timeouts.set(id, fn); return id },
    clearTimeout: (id: number) => { timeouts.delete(id) },
    requestIdleCallback: (fn: () => void) => { const id = nextId++; timeouts.set(id, fn); return id },
    cancelIdleCallback: (id: number) => { timeouts.delete(id) },
    setInterval: (fn: () => void, ms: number) => { intervals.push({ fn, ms }); return nextId++ },
  })
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible', readyState: 'complete' })
  const fakeDate = { now: () => clock }
  return {
    window: windowTarget,
    document: documentTarget,
    Date: fakeDate,
    intervals,
    advance(ms: number) { clock += ms },
    async drain() {
      for (let round = 0; round < 50 && timeouts.size; round += 1) {
        const batch = [...timeouts.values()]
        timeouts.clear()
        batch.forEach((fn) => fn())
        await new Promise((resolve) => setImmediate(resolve))
      }
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

await runTest('web-api recovery listeners load no offline snapshot and run no second worker update check', async () => {
  const webApi = read('src/web-api.ts')
  // Every function that took part in the loop on c5b28762 is extracted when it
  // exists; after F1 only ensureSessionRecoveryListeners is left, which is the
  // point. loadOfflineSnapshotTransportModule is injected as a counter below
  // rather than extracted, so the real dynamic import never runs.
  const functions = topLevelFunctions('web-api.ts', webApi, [
    'ensureSessionRecoveryListeners',
    'runOfflineMaintenance',
    'refreshOfflineSnapshotSoon',
    'refreshServiceWorkerSoon',
    'startOfflineMaintenanceLoop',
    'scheduleInitialOfflineMaintenance',
  ])
  assert.match(functions, /function ensureSessionRecoveryListeners/, 'the foreground recovery listeners must still exist')

  const browser = fakeBrowser()
  const counts = { snapshotLoads: 0, snapshotRefreshes: 0, workerReady: 0, workerUpdates: 0, resumeWS: 0, healthPings: 0, screenRefreshes: 0 }
  const navigatorState = {
    onLine: true,
    serviceWorker: {
      get ready() {
        counts.workerReady += 1
        return Promise.resolve({ update: async () => { counts.workerUpdates += 1 } })
      },
    },
  }
  const dependencies: Record<string, unknown> = {
    window: browser.window,
    document: browser.document,
    navigator: navigatorState,
    Date: browser.Date,
    hasStoredUserSession: () => true,
    resumeWS: () => { counts.resumeWS += 1 },
    startHealthCheck: () => {},
    pingServerHealth: async () => { counts.healthPings += 1 },
    dispatchSyncUpdates: () => { counts.screenRefreshes += 1 },
    loadOfflineSnapshotTransportModule: async () => {
      counts.snapshotLoads += 1
      return { refreshOfflineDeviceSnapshot: async () => { counts.snapshotRefreshes += 1 } }
    },
    FOREGROUND_RECOVERY_THROTTLE_MS: 0,
    FOREGROUND_REFRESH_AFTER_MS: 45_000,
    FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS: ['sales'],
    // Only read by the pre-F1 loop; harmless when nothing references them.
    OFFLINE_REFRESH_INTERVAL_MS: 5 * 60_000,
    OFFLINE_SNAPSHOT_IDLE_DELAY_MS: 30_000,
    OFFLINE_SNAPSHOT_FORCE_DELAY_MS: 12_000,
    INITIAL_OFFLINE_MAINTENANCE_DELAY_MS: 45_000,
    INITIAL_OFFLINE_MAINTENANCE_IDLE_TIMEOUT_MS: 60_000,
    SERVICE_WORKER_UPDATE_INTERVAL_MS: 15 * 60_000,
  }
  const state = 'let sessionRecoveryListenersRegistered = false, lastForegroundRecoveryAt = 0, deferredForegroundRecoveryTimer = 0, backgroundedAt = 0, offlineMaintenanceStarted = false, initialOfflineMaintenanceScheduled = false, lastServiceWorkerUpdateAt = 0, offlineSnapshotTimer = 0, offlineSnapshotIdleId = 0;'
  const compiled = transpile(`${state}\n${functions}\nreturn { ensureSessionRecoveryListeners };`)
  const runtime = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))

  runtime.ensureSessionRecoveryListeners()
  const doc = browser.document
  // A till left open all day: reconnect, refocus, go to the background for
  // five minutes and come back, restore from the back/forward cache, and see
  // the socket reconnect -- every trigger the old loop hung off.
  browser.window.dispatchEvent(new Event('online'))
  browser.advance(2_000)
  browser.window.dispatchEvent(new Event('focus'))
  doc.visibilityState = 'hidden'
  doc.dispatchEvent(new Event('visibilitychange'))
  browser.advance(5 * 60_000)
  doc.visibilityState = 'visible'
  doc.dispatchEvent(new Event('visibilitychange'))
  browser.advance(2_000)
  browser.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
  browser.window.dispatchEvent(new Event('sync:reconnected'))
  await browser.drain()
  for (let tick = 0; tick < 3; tick += 1) {
    browser.advance(15 * 60_000)
    browser.intervals.forEach(({ fn }) => fn())
    await browser.drain()
  }

  assert.equal(counts.snapshotLoads + counts.snapshotRefreshes, 0, 'no foreground or reconnect event may load or run the retired offline snapshot')
  assert.equal(counts.workerReady + counts.workerUpdates, 0, 'web-api must not run a second service-worker update check; index.tsx owns it')
  assert.equal(browser.intervals.length, 0, 'web-api must not arm a background maintenance interval')
  // The recovery the listeners exist for is unchanged.
  assert.ok(counts.resumeWS > 0, 'returning to the tab must still resume the socket')
  assert.ok(counts.healthPings > 0, 'returning to the tab must still ping server health')
  assert.ok(counts.screenRefreshes > 0, 'a long background must still refresh the visible screens')
})

await runTest('web-api no longer references the snapshot transport, a maintenance loop or the worker registration', () => {
  const webApi = read('src/web-api.ts')
  const parsed = ts.createSourceFile('web-api.ts', webApi, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      if (specifier && ts.isStringLiteral(specifier) && /offlineSnapshotTransport/.test(specifier.text)) found.push(`import(${specifier.text})`)
    }
    if (ts.isImportTypeNode(node) && /offlineSnapshotTransport/.test(node.argument.getText(parsed))) found.push('typeof import(offlineSnapshotTransport)')
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'setInterval') found.push('setInterval')
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'ready' && /serviceWorker$/.test(node.expression.getText(parsed))) found.push('serviceWorker.ready')
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.deepEqual(found, [])
  // The one-time drain forwarders stay: they carry the worker's
  // BUSINESS_OS_OUTBOX_* results for already-queued sales to the page.
  assert.match(webApi, /navigator\.serviceWorker\?\.addEventListener\?\.\('message', forwardServiceWorkerOutboxEvent\)/)
  assert.match(webApi, /navigator\.serviceWorker\?\.addEventListener\?\.\('message', forwardServiceWorkerAppEvent\)/)
  assert.match(webApi, /startsWith\('BUSINESS_OS_OUTBOX_'\)/)
})

// The real watchForNewAppShell from index.tsx, bound to a fake browser.
function loadAppShellWatcher(browser: ReturnType<typeof fakeBrowser>, navigatorState: { onLine: boolean }) {
  const index = read('src/index.tsx')
  const functions = topLevelFunctions('index.tsx', index, ['watchForNewAppShell'])
  assert.match(functions, /function watchForNewAppShell/)
  const POLL = topLevelConstValue(index, 'SERVICE_WORKER_UPDATE_POLL_MS')
  const MIN_GAP = topLevelConstValue(index, 'SERVICE_WORKER_UPDATE_MIN_GAP_MS')
  const dependencies: Record<string, unknown> = {
    window: browser.window,
    document: browser.document,
    navigator: navigatorState,
    Date: browser.Date,
    SERVICE_WORKER_UPDATE_POLL_MS: POLL,
    SERVICE_WORKER_UPDATE_MIN_GAP_MS: MIN_GAP,
  }
  const compiled = transpile(`${functions}\nreturn { watchForNewAppShell };`)
  const runtime = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))
  return { watchForNewAppShell: runtime.watchForNewAppShell as (registration: unknown) => void, POLL, MIN_GAP }
}

await runTest('index.tsx update checker fires on its interval and on visibility return in a long-lived tab', async () => {
  const browser = fakeBrowser()
  const navigatorState = { onLine: true }
  const { watchForNewAppShell, POLL, MIN_GAP } = loadAppShellWatcher(browser, navigatorState)
  assert.ok(POLL <= 15 * 60_000, 'an untouched till must be re-checked at least every 15 minutes')

  let updates = 0
  const registration = { update: async () => { updates += 1 } }
  watchForNewAppShell(registration)
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  assert.equal(browser.intervals.length, 1, 'exactly one update poll')
  assert.equal(browser.intervals[0].ms, POLL)
  const tick = async () => { browser.advance(POLL); browser.intervals[0].fn(); await settle() }

  // A visible tab nobody touches: every tick asks the browser to look.
  await tick()
  assert.equal(updates, 1, 'the interval must check a visible tab')
  await tick()
  assert.equal(updates, 2, 'and keep checking on every tick')

  // Hidden: the interval waits for someone to look.
  browser.document.visibilityState = 'hidden'
  await tick()
  assert.equal(updates, 2, 'a hidden tab is not polled')

  // Coming back after hours is the moment the bar is worth showing.
  browser.advance(3 * 60 * 60_000)
  browser.document.visibilityState = 'visible'
  browser.document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(updates, 3, 'returning to the tab must check for a new build')

  // Rapid tab switching inside the gap does not hammer the network...
  browser.advance(Math.max(1, MIN_GAP - 1_000))
  browser.document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(updates, 3, 'a second return inside the minimum gap is skipped')
  // ...but a return after it does.
  browser.advance(2_000)
  browser.document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(updates, 4, 'a return after the minimum gap checks again')

  // Offline ticks burn nothing; reconnecting checks.
  navigatorState.onLine = false
  await tick()
  assert.equal(updates, 4, 'no check while offline')
  navigatorState.onLine = true
  browser.window.dispatchEvent(new Event('online'))
  await settle()
  assert.equal(updates, 5, 'reconnecting must check for a build shipped while offline')
})

// R-F1F3 F-03/F-09. A Worker deploy restarts the BroadcastHub Durable Object,
// so every open tab's socket drops and websocket.ts dispatches
// sync:reconnected a few seconds later (http.ts dispatches the same event
// when a failed health probe recovers). Before F1 that event forced web-api's
// second update check; F1 deleted that checker, and with it the only reaction,
// so a visible till learned about a deploy on the next 15-minute tick at best.
// The one checker must react itself: even seconds after another check (that
// one saw the old sw.js), once per reconnect, and through one listener that
// is never registered again however many events fire.
await runTest('index.tsx update checker asks for the new build on every app reconnect, through one listener', async () => {
  const browser = fakeBrowser()
  const navigatorState = { onLine: true }
  const { watchForNewAppShell, POLL } = loadAppShellWatcher(browser, navigatorState)

  const registrations = new Map<string, number>()
  for (const target of [browser.window, browser.document]) {
    const add = target.addEventListener.bind(target)
    target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
      registrations.set(type, (registrations.get(type) || 0) + 1)
      add(type, listener, options)
    }
  }
  const registrationCount = () => [...registrations.values()].reduce((sum, count) => sum + count, 0)

  // update() stays pending until released, like a real sw.js fetch in flight.
  let updates = 0
  const inFlight: Array<() => void> = []
  const registration = { update: () => { updates += 1; return new Promise<void>((resolve) => { inFlight.push(resolve) }) } }
  const settle = async () => {
    inFlight.splice(0).forEach((resolve) => resolve())
    for (let round = 0; round < 3; round += 1) await new Promise((resolve) => setImmediate(resolve))
  }

  watchForNewAppShell(registration)
  assert.equal(registrations.get('sync:reconnected'), 1, 'the update checker must listen for the app reconnect signal exactly once')
  const registeredAtStart = registrationCount()

  // The slow poll checks, and sees the build that is still live.
  browser.advance(POLL)
  browser.intervals[0].fn()
  assert.equal(updates, 1)
  await settle()

  // The deploy lands; the socket drops and reconnects seconds later.
  browser.advance(4_000)
  browser.window.dispatchEvent(new CustomEvent('sync:reconnected', { detail: { ts: 1 } }))
  assert.equal(updates, 2, 'a reconnect seconds after another check must still ask the browser for the new build')

  // The health probe reports the same reconnect while that check is in flight.
  browser.window.dispatchEvent(new CustomEvent('sync:reconnected'))
  assert.equal(updates, 2, 'one reconnect reported by both emitters is one check')
  await settle()

  // Every later reconnect checks again, once each.
  for (let reconnect = 1; reconnect <= 5; reconnect += 1) {
    browser.advance(10_000)
    browser.window.dispatchEvent(new CustomEvent('sync:reconnected', { detail: { ts: reconnect } }))
    await settle()
    assert.equal(updates, 2 + reconnect, `reconnect ${reconnect + 1} must check exactly once`)
  }

  // Nothing registered anything after the watcher was armed.
  browser.document.dispatchEvent(new Event('visibilitychange'))
  browser.window.dispatchEvent(new Event('online'))
  browser.advance(POLL)
  browser.intervals.forEach(({ fn }) => fn())
  await settle()
  assert.equal(registrations.get('sync:reconnected'), 1, 'reconnect handling must not add a listener per event')
  assert.equal(registrationCount(), registeredAtStart, 'no check or handler may register another listener')
  assert.equal(browser.intervals.length, 1, 'no check or handler may arm another poll')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('singleAppUpdateChecker: all tests passed')
