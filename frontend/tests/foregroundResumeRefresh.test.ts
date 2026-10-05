import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import {
  FOREGROUND_RESUME_GAP_REASON,
  FOREGROUND_RESUME_REASON,
} from '../src/utils/permissionRefreshAccumulator.ts'

// E4 (G39 item 4). A tab shown again after >= 45 s used to dispatch 22
// id-less sync channels with the trigger as their reason; AppContext read the
// id-less users/roles events as "permissions may have changed" and reset local
// state, re-read bootstrap and quarantined the browser's other tabs every time.
// This runs the real web-api.ts listeners extracted from the source and records
// what a resume dispatches: one forced health ping and one refresh burst whose
// reason says whether the sync socket could have missed a push.

const source = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('web-api.ts', source, ts.ScriptTarget.Latest, true)
const listeners = parsed.statements
  .filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'ensureSessionRecoveryListeners')
  .map((node) => node.getText(parsed))
  .join('\n')
assert.match(listeners, /function ensureSessionRecoveryListeners/)

type Dispatch = { channels: readonly string[]; reason: string; extra?: Record<string, unknown> }

function harness() {
  let clock = 5_000_000
  let socketOpen = true
  const dispatches: Dispatch[] = []
  const pings: boolean[] = []
  const window = Object.assign(new EventTarget(), {
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const dependencies: Record<string, unknown> = {
    window,
    document,
    Date: { now: () => clock },
    hasStoredUserSession: () => true,
    resumeWS: () => {},
    startHealthCheck: () => {},
    isWSConnected: () => socketOpen,
    pingServerHealth: async (force: boolean) => { pings.push(force) },
    dispatchSyncUpdates: (channels: readonly string[], reason: string, extra?: Record<string, unknown>) => { dispatches.push({ channels, reason, extra }) },
    FOREGROUND_RECOVERY_THROTTLE_MS: 0,
    FOREGROUND_REFRESH_AFTER_MS: 45_000,
    FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS: ['settings', 'products', 'users', 'roles'],
    FOREGROUND_RESUME_REASON,
    FOREGROUND_RESUME_GAP_REASON,
  }
  const state = 'let sessionRecoveryListenersRegistered = false, lastForegroundRecoveryAt = 0, deferredForegroundRecoveryTimer = 0, backgroundedAt = 0, syncSocketDroppedAt = 0;'
  const compiled = ts.transpileModule(`${state}\n${listeners}\nreturn { ensureSessionRecoveryListeners };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies)).ensureSessionRecoveryListeners()
  const setVisibility = (state: 'hidden' | 'visible') => {
    document.visibilityState = state
    document.dispatchEvent(new Event('visibilitychange'))
  }
  return {
    dispatches,
    pings,
    advance: (ms: number) => { clock += ms },
    hide: () => setVisibility('hidden'),
    show: () => setVisibility('visible'),
    socket: (connected: boolean) => {
      socketOpen = connected
      window.dispatchEvent(Object.assign(new Event('sync:status'), { detail: { connected } }))
    },
    pageshow: (persisted: boolean) => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted })),
  }
}

test('a 60 s hide with the socket open throughout: one forced ping and a no-gap refresh', () => {
  const tab = harness()
  tab.hide()
  tab.advance(60_000)
  tab.show()
  assert.deepEqual(tab.pings, [true])
  assert.equal(tab.dispatches.length, 1)
  assert.equal(tab.dispatches[0].reason, FOREGROUND_RESUME_REASON)
  assert.equal(tab.dispatches[0].extra?.trigger, 'visibility-resume', 'the trigger stays visible for logs, outside the reason')
})

test('a socket drop while hidden marks the resume as a gap, even after it reconnected', () => {
  const tab = harness()
  tab.hide()
  tab.advance(20_000)
  tab.socket(false)
  tab.advance(10_000)
  tab.socket(true)
  tab.advance(30_000)
  tab.show()
  assert.equal(tab.dispatches.length, 1)
  assert.equal(tab.dispatches[0].reason, FOREGROUND_RESUME_GAP_REASON)
})

test('a socket that is closed at resume is a gap', () => {
  const tab = harness()
  tab.hide()
  tab.advance(60_000)
  tab.socket(false)
  tab.show()
  assert.equal(tab.dispatches[0].reason, FOREGROUND_RESUME_GAP_REASON)
})

test('a drop before the hide does not count against a later continuous hide', () => {
  const tab = harness()
  tab.socket(false)
  tab.advance(1_000)
  tab.socket(true)
  tab.advance(1_000)
  tab.hide()
  tab.advance(60_000)
  tab.show()
  assert.equal(tab.dispatches[0].reason, FOREGROUND_RESUME_REASON)
})

test('a back/forward-cache restore is always a gap', () => {
  const tab = harness()
  tab.pageshow(true)
  assert.equal(tab.dispatches.length, 1)
  assert.equal(tab.dispatches[0].reason, FOREGROUND_RESUME_GAP_REASON)
})

test('a short hide refreshes nothing and pings without forcing', () => {
  const tab = harness()
  tab.hide()
  tab.advance(10_000)
  tab.show()
  assert.equal(tab.dispatches.length, 0)
  assert.deepEqual(tab.pings, [false])
})

test('resume reasons are never a generic id-less refresh reason', () => {
  // The old code passed the trigger ('visibility-resume', 'window-focus',
  // 'pageshow-resume') as the reason, which AppContext could not tell apart
  // from a reconnect after an outage.
  assert.doesNotMatch(source, /dispatchSyncUpdates\(FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS, reason\)/)
  const tab = harness()
  tab.hide()
  tab.advance(60_000)
  tab.show()
  assert.ok([FOREGROUND_RESUME_REASON, FOREGROUND_RESUME_GAP_REASON].includes(tab.dispatches[0].reason))
})

test('shell listeners do not turn a no-gap resume into extra reads', () => {
  const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const appContext = read('AppContext.tsx')
  assert.match(appContext, /if \(channel === 'settings' && detail\.reason !== FOREGROUND_RESUME_REASON\) loadSettings\(\)/, 'settings is re-read only when a push could have been missed')
  const bell = read('components/shared/NotificationCenter.tsx')
  assert.match(bell, /if \(syncChannel\.reason === FOREGROUND_RESUME_REASON\) return/, 'the bell skips a no-gap resume burst')
  assert.match(bell, /document\.visibilityState === 'visible' && refreshDueWhileHiddenRef\.current/, 'showing the tab only catches up a refresh that came due while hidden')
  assert.match(bell, /if \(document\.visibilityState === 'hidden'\) \{\n\s+refreshDueWhileHiddenRef\.current = true/)
})
