// CACHE-LIFECYCLE R5/R6, gaps G4 and G14 (lane 6.0.1048).
//   G4  The owner's rule is "the app never restarts on its own". The build-mismatch handler of AppContext used to reload a tab with no unsaved
//       work (window.location.replace) the moment anything told it the server's frontend differed. Nothing sends that today, so the branch was
//       latent; the first slice to put the frontend hash in the bootstrap or /health would have switched on an automatic restart. Now the
//       handler raises the "Restart now" bar for a clean tab and for a dirty one, saves the drafts, and never navigates.
//   G14 A reset that removes the service worker (an organisation change on this device) used to leave the tab with a dead registration: its
//       update watcher asked a registration that no longer existed, so a long-lived till never heard about the next build until it was
//       reloaded. The reset now announces itself, the page registers a worker again and the SAME watcher is re-pointed at the new registration.
// Each OLD behaviour is embedded as a positive control (the harness must see the defect), each fix has a mutant.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { SERVICE_WORKER_RESET_EVENT, resetClientRuntimeState } from '../src/platform/runtime/clientRuntime.ts'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(FRONTEND, relative), 'utf8').split('\r\n').join('\n')
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

function sourceFile(relative: string) { return ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }

function topLevelFunctions(relative: string, names: string[]): string {
  const parsed = sourceFile(relative)
  const found = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || '')).map((node) => node.getText(parsed))
  assert.equal(found.length, names.length, `${relative} must keep top-level functions ${names.join(', ')}`)
  return found.join('\n')
}

function constantValue(relative: string, name: string): number {
  const match = read(relative).match(new RegExp(`^const ${name} = ([0-9_* ]+)$`, 'm'))
  assert.ok(match, `${name} must stay a named numeric constant`)
  return Number(Function(`return (${match[1].replace(/_/g, '')})`)())
}

// ---- G4 -------------------------------------------------------------------------------------------------------------------------------

function mismatchHandlerSource(text: string): string {
  const parsed = ts.createSourceFile('AppContext.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'onRuntimeMismatch' && node.initializer) found = node.initializer.getText(parsed)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(found, 'AppContext.tsx must keep onRuntimeMismatch')
  return found
}

// The handler exactly as it was before this slice (6.0.1042 / base), kept as the positive control.
const OLD_HANDLER = `(e) => {
      const detail = eventDetail(e)
      const message = detail.message
        || 'Business OS server update is required. Restart the server, then refresh this page.'
      const runtimeHash = String(detail.backend?.frontend?.hash || '').trim()
      setSyncServerUnreachable(true)
      if (hasDirtyWork()) {
        flushPendingWorkDrafts()
        window.dispatchEvent(new CustomEvent('sync:app-update-available', {
          detail: { reason: 'runtime_mismatch', message: 'New version ready', version: runtimeHash, ts: Date.now() },
        }))
        setNotification({ message: 'An app update is ready. Save or discard unfinished work before reloading.', type: 'warning', id: Date.now() })
        return
      }
      try {
        const recoveryKey = FRONTEND_BUILD_INFO.hash + ':' + (runtimeHash || 'unknown')
        const previous = window.sessionStorage.getItem(RUNTIME_RECOVERY_SESSION_KEY)
        if (previous !== recoveryKey) {
          window.sessionStorage.setItem(RUNTIME_RECOVERY_SESSION_KEY, recoveryKey)
          const url = new URL(window.location.href)
          url.searchParams.set('__bos_reload', String(Date.now()))
          if (runtimeHash) url.searchParams.set('__bos_server_build', runtimeHash)
          flushPendingWorkDrafts()
          window.location.replace(url.toString())
          return
        }
      } catch (_) {}
      setNotification({ message, type: 'error', id: Date.now() })
    }`

function runHandler(source: string, dirty: boolean) {
  const out = { navigations: 0, sessionWrites: 0, flushes: 0, notifications: [] as unknown[], unreachable: 0, bars: [] as any[] }
  const target = new EventTarget()
  target.addEventListener('sync:app-update-available', (event) => out.bars.push((event as CustomEvent).detail))
  const windowFake = Object.assign(target, {
    location: { href: 'https://shop.example.test/pos', replace: () => { out.navigations += 1 }, assign: () => { out.navigations += 1 }, reload: () => { out.navigations += 1 } },
    sessionStorage: { getItem: () => null, setItem: () => { out.sessionWrites += 1 } },
  })
  const dependencies: Record<string, unknown> = {
    window: windowFake,
    eventDetail: (event: Event) => (event as CustomEvent).detail || {},
    setSyncServerUnreachable: () => { out.unreachable += 1 },
    hasDirtyWork: () => dirty,
    flushPendingWorkDrafts: () => { out.flushes += 1 },
    setNotification: (value: unknown) => { out.notifications.push(value) },
    FRONTEND_BUILD_INFO: { hash: 'build-running' },
    RUNTIME_RECOVERY_SESSION_KEY: 'bos-runtime-version-recovery',
    Date,
  }
  const handler = new Function(...Object.keys(dependencies), transpile(`return (${source})`))(...Object.values(dependencies)) as (event: Event) => void
  handler(new CustomEvent('runtime:version-mismatch', { detail: { backend: { frontend: { hash: 'build-served' } }, message: 'x' } }))
  return out
}

await runTest('POSITIVE CONTROL: the handler as it was reloaded a clean tab on its own (the harness sees the defect)', () => {
  const clean = runHandler(OLD_HANDLER, false)
  assert.equal(clean.navigations, 1, 'the old handler navigated a tab with no unsaved work')
  const dirty = runHandler(OLD_HANDLER, true)
  assert.equal(dirty.navigations, 0)
  assert.equal(dirty.bars.length, 1)
})

await runTest('G4: a build mismatch raises the Restart bar for a clean tab and for a dirty one, saves the drafts, and never navigates', () => {
  const source = mismatchHandlerSource(read('src/AppContext.tsx'))
  for (const dirty of [false, true]) {
    const out = runHandler(source, dirty)
    assert.equal(out.navigations, 0, `dirty=${dirty}: no replace, assign or reload`)
    assert.equal(out.sessionWrites, 0, `dirty=${dirty}: no recovery marker either`)
    assert.equal(out.flushes, 1, `dirty=${dirty}: drafts saved`)
    assert.equal(out.bars.length, 1, `dirty=${dirty}: exactly one bar announcement`)
    assert.deepEqual({ reason: out.bars[0].reason, version: out.bars[0].version }, { reason: 'runtime_mismatch', version: 'build-served' })
    assert.equal(out.notifications.length, dirty ? 1 : 0, 'the unsaved-work warning only when there is unsaved work')
  }
})

await runTest('G4 source: no automatic navigation anywhere in the mismatch path or in the new signal path', () => {
  const handler = mismatchHandlerSource(read('src/AppContext.tsx'))
  assert.doesNotMatch(handler, /location|__bos_reload|sessionStorage|FRONTEND_BUILD_INFO|RUNTIME_RECOVERY/, 'the handler has no navigation or recovery marker')
  assert.doesNotMatch(read('src/AppContext.tsx'), /RUNTIME_RECOVERY_SESSION_KEY|bos-runtime-version-recovery/)
  for (const file of ['src/api/serverSignals.ts', 'src/api/dataEpoch.ts', 'src/api/epochReset.ts']) assert.doesNotMatch(read(file), /location\s*\.\s*(reload|replace|assign)/, file)
})

await runTest('MUTANT: putting the reload branch back is caught by the same assertions', () => {
  const regressed = runHandler(OLD_HANDLER, false)
  assert.notEqual(regressed.navigations, 0)
  assert.throws(() => assert.equal(regressed.navigations, 0, 'dirty=false: no replace, assign or reload'), /no replace, assign or reload/)
})

// ---- G14 ------------------------------------------------------------------------------------------------------------------------------

type Registration = { id: string; updates: number; update: () => Promise<void>; waiting?: undefined }
const registrationFake = (id: string): Registration => { const r: Registration = { id, updates: 0, update: async () => { r.updates += 1 } }; return r }

function startShell(rewrite: (code: string) => string = (code) => code) {
  const registrations: Registration[] = []
  const listenerCounts = new Map<string, number>()
  const target = new EventTarget()
  const add = target.addEventListener.bind(target)
  target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
    listenerCounts.set(type, (listenerCounts.get(type) || 0) + 1)
    add(type, listener, options)
  }
  const documentTarget = Object.assign(new EventTarget(), { readyState: 'complete', visibilityState: 'visible' })
  Object.assign(target, { setInterval: () => 1, setTimeout: (fn: () => void) => { fn(); return 1 }, clearTimeout: () => {}, requestIdleCallback: (fn: () => void) => { fn(); return 1 } })
  const navigatorFake = { onLine: true, serviceWorker: { register: async () => { const next = registrationFake(`R${registrations.length + 1}`); registrations.push(next); return next } } }
  const index = read('src/index.tsx')
  const code = rewrite(topLevelFunctions('src/index.tsx', ['scheduleAfterLoadIdle', 'watchForNewAppShell', 'requestWorkerVersion', 'announceWaitingAppShell', 'registerOfflineAppShell']))
  const dependencies: Record<string, unknown> = {
    window: target, document: documentTarget, navigator: navigatorFake, Date, MessageChannel,
    FRONTEND_BUILD_HASH: 'build-running',
    SERVICE_WORKER_REGISTER_IDLE_TIMEOUT_MS: 5000, SERVICE_WORKER_REGISTER_FALLBACK_DELAY_MS: 1200,
    SERVICE_WORKER_UPDATE_POLL_MS: constantValue('src/index.tsx', 'SERVICE_WORKER_UPDATE_POLL_MS'),
    SERVICE_WORKER_UPDATE_MIN_GAP_MS: constantValue('src/index.tsx', 'SERVICE_WORKER_UPDATE_MIN_GAP_MS'),
    SERVICE_WORKER_UPDATE_TIMEOUT_MS: constantValue('src/index.tsx', 'SERVICE_WORKER_UPDATE_TIMEOUT_MS'),
    WAITING_WORKER_VERSION_TIMEOUT_MS: 2000,
  }
  assert.ok(index.includes('sync:service-worker-reset'), 'index.tsx listens for the reset')
  const run = new Function(...Object.keys(dependencies), transpile(`${code}\nreturn { registerOfflineAppShell };`))(...Object.values(dependencies)) as { registerOfflineAppShell: () => void }
  return { window: target, registrations, listenerCounts, start: () => run.registerOfflineAppShell() }
}

await runTest('G14: after a reset removed the worker the page registers again and the one watcher asks the NEW registration', async () => {
  const shell = startShell()
  shell.start()
  await settle(); await settle()
  assert.equal(shell.registrations.length, 1, 'registered once at start')
  const focusListeners = shell.listenerCounts.get('focus')
  shell.window.dispatchEvent(new CustomEvent(SERVICE_WORKER_RESET_EVENT))
  await settle(); await settle()
  assert.equal(shell.registrations.length, 2, 'a reset that removed the worker is followed by a new registration in the same tab')
  assert.equal(shell.listenerCounts.get('focus'), focusListeners, 'and the watcher was re-pointed, not started a second time')
  const [dead, live] = shell.registrations
  const deadBefore = dead.updates
  const liveBefore = live.updates
  shell.window.dispatchEvent(new CustomEvent('sync:server-build', { detail: { build: 'build-next' } }))
  await settle()
  assert.equal(dead.updates, deadBefore, 'the dead registration is never asked again')
  assert.equal(live.updates, liveBefore + 1, 'the live one is')
})

await runTest('MUTANT: a watcher that keeps asking the first registration (no re-pointing) is caught by the same assertions', async () => {
  const shell = startShell((code) => {
    const anchor = 'if (pointWatcherAt) pointWatcherAt(registration)\n      else pointWatcherAt = watchForNewAppShell(registration)'
    assert.ok(code.includes(anchor), 'mutation anchor missing')
    return code.replace(anchor, 'if (!pointWatcherAt) pointWatcherAt = watchForNewAppShell(registration)')
  })
  shell.start()
  await settle(); await settle()
  shell.window.dispatchEvent(new CustomEvent(SERVICE_WORKER_RESET_EVENT))
  await settle(); await settle()
  const [dead, live] = shell.registrations
  const deadBefore = dead.updates
  const liveBefore = live.updates
  shell.window.dispatchEvent(new CustomEvent('sync:server-build', { detail: { build: 'build-next' } }))
  await settle()
  assert.equal(dead.updates, deadBefore + 1, 'the mutant asks the dead registration')
  assert.equal(live.updates, liveBefore, 'and never the live one, so the real assertions (dead unchanged, live +1) are red on it')
})

await runTest('G14: resetClientRuntimeState announces a removed worker once, and not when the caller keeps it', async () => {
  const originals = { window: (globalThis as any).window, navigator: (globalThis as any).navigator, localStorage: (globalThis as any).localStorage }
  const events: string[] = []
  let unregistered = 0
  const local = (() => { const values = new Map<string, string>(); return { get length() { return values.size }, key: (i: number) => [...values.keys()][i] ?? null, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) }, clear: () => values.clear() } as unknown as Storage })()
  const target = new EventTarget()
  target.addEventListener(SERVICE_WORKER_RESET_EVENT, () => events.push('reset'))
  ;(globalThis as any).window = Object.assign(target, { localStorage: local, sessionStorage: local, caches: { keys: async () => ['business-os-app-shell-x', 'other'], delete: async () => true } })
  ;(globalThis as any).localStorage = local
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unregistered += 1; return true } }] } } })
  try {
    await resetClientRuntimeState({ mirrorTables: [] })
    assert.deepEqual(events, ['reset'], 'announced once, after the worker was removed')
    assert.equal(unregistered, 1)
    await resetClientRuntimeState({ mirrorTables: [], preserveServiceWorker: true })
    assert.deepEqual(events, ['reset'], 'a reset that keeps the worker announces nothing')
    assert.equal(unregistered, 1)
  } finally {
    ;(globalThis as any).window = originals.window
    ;(globalThis as any).localStorage = originals.localStorage
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originals.navigator })
  }
})

await runTest('the Restart bar is the only update path: restartIntoLatestApp is the one place that reloads for an update, and it refuses unsaved work', () => {
  const update = read('src/utils/appUpdate.ts')
  assert.match(update, /if \(refuseDirtyRestart\(options\)\) return 'blocked'/)
  assert.equal((update.match(/window\.location\.reload\(\)/g) || []).length, 1)
  const app = read('src/App.tsx')
  assert.doesNotMatch(app.replace(/\/\/.*$/gm, ''), /sync:app-update-available[\s\S]{0,400}location\.(reload|replace|assign)/, 'the announcement handler does not navigate')
})

if (failed) { console.error(`${failed} updateOnlyThroughTheBar test(s) failed`); process.exit(1) }
console.log('updateOnlyThroughTheBar tests passed')
