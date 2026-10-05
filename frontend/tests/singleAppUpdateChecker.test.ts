import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

// F1 (27 Sep 2026). Offline selling is cancelled (owner, 26 Sep): queued
// sales drain once through the manual review path (retryPendingSyncNow ->
// syncPendingSalesQueue({ manualRecovery: true }), pinned by
// offlineSalesQueue.test.ts; the service worker's sync handlers replay
// nothing), offline is a banner plus blocked saving, and the PWA stays
// installable caching app code only.
//
// F1 -- web-api.ts ran a background "offline maintenance" loop: every five
// minutes, and again on every online / focus / visibility / pageshow /
// sync:reconnected event, it scheduled refreshOfflineDeviceSnapshot (eleven
// serial GETs whose results localMirrors.ts throws away on any http(s)
// origin) and a SECOND service-worker update check alongside index.tsx's own.
// After F1 the recovery listeners still resume the socket, ping health and
// refresh screens, but load no snapshot and never touch the worker; index.tsx
// is the one update checker, and it must still fire on its interval, when a
// long-lived till tab becomes visible again, when its window regains focus or
// comes back from the back/forward cache, and on the app's own reconnect
// signal (R-F1F3 F-03/F-09: F1 first deleted the reconnect, focus and pageshow
// reactions instead of moving them) -- that is the only way the "Restart now"
// bar reaches the till. One check that never settles must not silence the
// checker for the rest of the tab's life.
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

function optionalTopLevelConstValue(text: string, name: string): number | undefined {
  const match = text.match(new RegExp(`^const ${name} = ([0-9_* ]+)$`, 'm'))
  return match ? Number(Function(`return (${match[1].replace(/_/g, '')})`)()) : undefined
}

function topLevelConstValue(text: string, name: string): number {
  const value = optionalTopLevelConstValue(text, name)
  assert.ok(value !== undefined, `${name} must stay a named numeric constant`)
  return value
}

function transpile(body: string): string {
  return ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

// A tiny deterministic browser: timers, idle callbacks and intervals are
// recorded. drain() runs every queued timeout/idle task (including ones
// queued while draining) without waiting for real time; fireDue() runs only
// the timeouts whose delay has elapsed on the fake clock.
function fakeBrowser() {
  let clock = 1_000_000
  let nextId = 1
  const timeouts = new Map<number, { fn: () => void, due: number }>()
  const intervals: Array<{ fn: () => void, ms: number }> = []
  const queue = (fn: () => void, ms = 0) => { const id = nextId++; timeouts.set(id, { fn, due: clock + Number(ms || 0) }); return id }
  const windowTarget = Object.assign(new EventTarget(), {
    setTimeout: (fn: () => void, ms?: number) => queue(fn, ms),
    clearTimeout: (id: number) => { timeouts.delete(id) },
    requestIdleCallback: (fn: () => void) => queue(fn),
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
    pendingTimeouts: () => timeouts.size,
    fireDue() {
      for (const [id, { fn, due }] of [...timeouts]) {
        if (due > clock || !timeouts.has(id)) continue
        timeouts.delete(id)
        fn()
      }
    },
    async drain() {
      for (let round = 0; round < 50 && timeouts.size; round += 1) {
        const batch = [...timeouts.values()]
        timeouts.clear()
        batch.forEach(({ fn }) => fn())
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
    isWSConnected: () => true,
    FOREGROUND_RESUME_REASON: 'foreground-resume',
    FOREGROUND_RESUME_GAP_REASON: 'foreground-resume-gap',
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
  const state = 'let sessionRecoveryListenersRegistered = false, lastForegroundRecoveryAt = 0, deferredForegroundRecoveryTimer = 0, backgroundedAt = 0, syncSocketDroppedAt = 0, offlineMaintenanceStarted = false, initialOfflineMaintenanceScheduled = false, lastServiceWorkerUpdateAt = 0, offlineSnapshotTimer = 0, offlineSnapshotIdleId = 0;'
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
  // F1 leaves the BUSINESS_OS_OUTBOX_* / app-event forwarders alone. They are
  // not the drain: the worker's replay functions have no caller and its sync
  // handlers answer manual_recovery_required (service-worker.ts
  // syncOutboxOnce). The drain is the manual review path, see the header.
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
  // Read when present so the behaviour below, not a missing name, is what
  // fails on a checker that has no bound.
  const TIMEOUT = optionalTopLevelConstValue(index, 'SERVICE_WORKER_UPDATE_TIMEOUT_MS')
  const dependencies: Record<string, unknown> = {
    window: browser.window,
    document: browser.document,
    navigator: navigatorState,
    Date: browser.Date,
    SERVICE_WORKER_UPDATE_POLL_MS: POLL,
    SERVICE_WORKER_UPDATE_MIN_GAP_MS: MIN_GAP,
    SERVICE_WORKER_UPDATE_TIMEOUT_MS: TIMEOUT,
  }
  const compiled = transpile(`${functions}\nreturn { watchForNewAppShell };`)
  const runtime = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))
  return { watchForNewAppShell: runtime.watchForNewAppShell as (registration: unknown) => void, POLL, MIN_GAP, TIMEOUT }
}

// Counts addEventListener calls per event type on the fake window + document.
function countListenerRegistrations(browser: ReturnType<typeof fakeBrowser>) {
  const registrations = new Map<string, number>()
  for (const [label, target] of [['window', browser.window], ['document', browser.document]] as const) {
    const add = target.addEventListener.bind(target)
    target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
      registrations.set(`${label}:${type}`, (registrations.get(`${label}:${type}`) || 0) + 1)
      add(type, listener, options)
    }
  }
  return registrations
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

  const registrations = countListenerRegistrations(browser)
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
  assert.equal(registrations.get('window:sync:reconnected'), 1, 'the update checker must listen for the app reconnect signal exactly once')
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
  assert.equal(registrations.get('window:sync:reconnected'), 1, 'reconnect handling must not add a listener per event')
  assert.equal(registrationCount(), registeredAtStart, 'no check or handler may register another listener')
  assert.equal(browser.intervals.length, 1, 'no check or handler may arm another poll')
})

// F1 also dropped the focus and pageshow reactions the old second checker had.
// A till window left visible beside another app never fires visibilitychange
// when the cashier clicks back into it -- only focus -- and a page restored
// from the back/forward cache (iOS in particular) may report only pageshow
// with persisted set. Both go through the same check() and minimum gap as the
// other event triggers, so the iOS burst of online + focus + visibilitychange
// + pageshow is still one request.
await runTest('index.tsx update checker asks again when the till window regains focus or returns from the back/forward cache', async () => {
  const browser = fakeBrowser()
  const navigatorState = { onLine: true }
  const { watchForNewAppShell, POLL, MIN_GAP } = loadAppShellWatcher(browser, navigatorState)
  const registrations = countListenerRegistrations(browser)

  let updates = 0
  const registration = { update: async () => { updates += 1 } }
  const settle = async () => { for (let round = 0; round < 3; round += 1) await new Promise((resolve) => setImmediate(resolve)) }
  const pageshow = (persisted: boolean) => Object.assign(new Event('pageshow'), { persisted })

  watchForNewAppShell(registration)
  assert.equal(registrations.get('window:focus'), 1, 'the update checker must listen for window focus exactly once')
  assert.equal(registrations.get('window:pageshow'), 1, 'the update checker must listen for pageshow exactly once')

  // Hours at the till with the window visible but behind another app, then the
  // cashier clicks back in: visibility never changed, focus did.
  browser.advance(3 * 60 * 60_000)
  browser.window.dispatchEvent(new Event('focus'))
  await settle()
  assert.equal(updates, 1, 'regaining window focus must check for a new build')

  // Clicking between windows inside the gap does not hammer the network...
  browser.advance(Math.max(1, MIN_GAP - 1_000))
  browser.window.dispatchEvent(new Event('focus'))
  await settle()
  assert.equal(updates, 1, 'a second focus inside the minimum gap is skipped')
  // ...and a focus after it checks again.
  browser.advance(2_000)
  browser.window.dispatchEvent(new Event('focus'))
  await settle()
  assert.equal(updates, 2, 'a focus after the minimum gap checks again')

  // A page restored from the back/forward cache is a return; a pageshow that is
  // not a restore is the page's own first load, which register() already checked.
  browser.advance(MIN_GAP + 1_000)
  browser.window.dispatchEvent(pageshow(false))
  await settle()
  assert.equal(updates, 2, 'a pageshow that is not a back/forward-cache restore is not a return')
  browser.window.dispatchEvent(pageshow(true))
  await settle()
  assert.equal(updates, 3, 'a back/forward-cache restore must check for a new build')
  browser.advance(Math.max(1, MIN_GAP - 1_000))
  browser.window.dispatchEvent(pageshow(true))
  await settle()
  assert.equal(updates, 3, 'a second restore inside the minimum gap is skipped')

  // An offline till burns nothing on focus or restore.
  browser.advance(MIN_GAP + 1_000)
  navigatorState.onLine = false
  browser.window.dispatchEvent(new Event('focus'))
  browser.window.dispatchEvent(pageshow(true))
  await settle()
  assert.equal(updates, 3, 'no check on focus or restore while offline')
  navigatorState.onLine = true

  // iOS reports one return as a burst of every signal: still one request.
  browser.advance(MIN_GAP + 1_000)
  browser.window.dispatchEvent(new Event('online'))
  browser.window.dispatchEvent(new Event('focus'))
  browser.document.dispatchEvent(new Event('visibilitychange'))
  browser.window.dispatchEvent(pageshow(true))
  await settle()
  assert.equal(updates, 4, 'one return reported by every signal is one check')

  // No trigger registered anything more.
  browser.advance(POLL)
  browser.intervals.forEach(({ fn }) => fn())
  await settle()
  assert.equal(registrations.get('window:focus'), 1, 'focus handling must not add a listener per event')
  assert.equal(registrations.get('window:pageshow'), 1, 'pageshow handling must not add a listener per event')
})

// R-F1F3 F-03 (PLAUSIBLE). `checking` folds overlapping triggers into one
// request, and only the update() promise settling cleared it. A sw.js fetch
// that never settles (a stalled connection, a captive portal) therefore left
// it set for the rest of the tab's life: every later interval tick, return and
// reconnect was silently skipped, and that till never saw "Restart now" again.
// A check is now released after a bounded wait; a timed-out check that settles
// late must not release the one that replaced it; and update() throwing
// instead of rejecting must neither wedge the checker nor escape into the page.
await runTest('an update check that never settles does not block every later check in the tab', async () => {
  const browser = fakeBrowser()
  const navigatorState = { onLine: true }
  const { watchForNewAppShell, POLL, TIMEOUT } = loadAppShellWatcher(browser, navigatorState)

  let updates = 0
  let mode: 'hang' | 'controlled' | 'throw' = 'hang'
  const inFlight: Array<() => void> = []
  const registration = {
    update: () => {
      updates += 1
      if (mode === 'throw') throw new Error('InvalidStateError')
      if (mode === 'hang') return new Promise<void>(() => {})
      return new Promise<void>((resolve) => { inFlight.push(resolve) })
    },
  }
  const settle = async () => { for (let round = 0; round < 3; round += 1) await new Promise((resolve) => setImmediate(resolve)) }
  const reconnect = () => browser.window.dispatchEvent(new CustomEvent('sync:reconnected'))
  const tick = async () => { browser.advance(POLL); browser.fireDue(); browser.intervals[0].fn(); await settle() }

  watchForNewAppShell(registration)

  // The slow poll's request stalls forever.
  await tick()
  assert.equal(updates, 1)
  // Seconds later both reconnect emitters still fold into the stalled request.
  browser.advance(5_000)
  browser.fireDue()
  reconnect()
  await settle()
  assert.equal(updates, 1, 'a reconnect seconds into a check still in flight is folded into it')

  // The next tick must not be swallowed by the stalled request.
  await tick()
  assert.equal(updates, 2, 'a check that never settled must not block the next interval tick')

  // The bound is a named constant, shorter than the poll.
  assert.ok(TIMEOUT !== undefined, 'the release must be the named SERVICE_WORKER_UPDATE_TIMEOUT_MS')
  assert.ok(TIMEOUT > 5_000 && TIMEOUT < POLL, `the release must wait out a slow fetch but come before the next poll (got ${TIMEOUT})`)
  browser.advance(TIMEOUT - 1)
  browser.fireDue()
  reconnect()
  await settle()
  assert.equal(updates, 2, 'a stalled check is not released before the timeout')
  browser.advance(1)
  browser.fireDue()
  reconnect()
  await settle()
  assert.equal(updates, 3, 'a reconnect after the timeout must check again')

  // Release every stalled check, then: check A times out, check B replaces it,
  // and A settles late while B is still in flight.
  browser.advance(TIMEOUT)
  browser.fireDue()
  mode = 'controlled'
  reconnect()
  assert.equal(updates, 4)
  const settleA = inFlight.shift() as () => void
  browser.advance(TIMEOUT)
  browser.fireDue()
  reconnect()
  assert.equal(updates, 5)
  const settleB = inFlight.shift() as () => void
  settleA()
  await settle()
  reconnect()
  await settle()
  assert.equal(updates, 5, 'a timed-out check settling late must not release the check that replaced it')
  settleB()
  await settle()
  reconnect()
  await settle()
  assert.equal(updates, 6, 'once the replacement settles the next reconnect checks')
  ;(inFlight.shift() as () => void)()
  await settle()

  // update() throwing instead of returning a rejected promise.
  mode = 'throw'
  browser.advance(POLL)
  assert.doesNotThrow(() => browser.intervals[0].fn(), 'a throwing update() must not escape the checker')
  assert.equal(updates, 7)
  await settle()
  mode = 'controlled'
  reconnect()
  assert.equal(updates, 8, 'a throwing update() must not leave the checker wedged')
  ;(inFlight.shift() as () => void)()
  await settle()
  // A timer-based release must not outlive the checks it guarded.
  assert.equal(browser.pendingTimeouts(), 0, 'no timeout may outlive its check')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('singleAppUpdateChecker: all tests passed')
