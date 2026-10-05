import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  beginPermissionRefresh,
  createPermissionRefreshAccumulator,
  escalatePermissionRefresh,
  finishPermissionRefresh,
  FOREGROUND_RESUME_GAP_REASON,
  FOREGROUND_RESUME_REASON,
  notePermissionRefreshIntent,
  permissionSnapshotKey,
} from '../src/utils/permissionRefreshAccumulator.ts'
import { isOwnSettingsWrite } from '../src/utils/settingsSave.ts'

const subject = { userId: 'me', roleId: 'cashier' }
const appContextSource = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function runBurst(events: Array<{ channel: string; reason?: string; payload?: { id?: string | number } | null }>): number {
  const accumulator = createPermissionRefreshAccumulator()
  let scheduled = false
  let bootstrapCalls = 0
  for (const detail of events) {
    if (notePermissionRefreshIntent(accumulator, detail, subject)) scheduled = true
  }
  if (scheduled && beginPermissionRefresh(accumulator)) {
    bootstrapCalls += 1
    finishPermissionRefresh(accumulator)
  }
  return bootstrapCalls
}

test('an unrelated same-channel event cannot erase an already queued own-user refresh', () => {
  assert.equal(runBurst([
    { channel: 'users', payload: { id: 'me' } },
    { channel: 'users', payload: { id: 'someone-else' } },
  ]), 1)
})

test('payloadless foreground user/role refreshes fail closed and coalesce into one bootstrap', () => {
  assert.equal(runBurst([
    { channel: 'users', payload: null },
    { channel: 'roles', payload: null },
  ]), 1)
})

test('unrelated targeted user and role updates do not refresh this session', () => {
  assert.equal(runBurst([
    { channel: 'users', payload: { id: 'someone-else' } },
    { channel: 'roles', payload: { id: 'manager' } },
    { channel: 'products', payload: null },
  ]), 0)
})

test('payloadless list-cache revalidation does not become an auth bootstrap loop', () => {
  assert.equal(runBurst([
    { channel: 'users', payload: null, reason: 'cache-refresh' },
    { channel: 'roles', payload: null, reason: 'cache-refresh' },
  ]), 0)
})

test('events arriving during a refresh remain pending without starting concurrently', () => {
  const accumulator = createPermissionRefreshAccumulator()
  notePermissionRefreshIntent(accumulator, { channel: 'users', payload: { id: 'me' } }, subject)
  assert.equal(beginPermissionRefresh(accumulator), true)
  notePermissionRefreshIntent(accumulator, { channel: 'roles', payload: null }, subject)
  assert.equal(beginPermissionRefresh(accumulator), false, 'a second bootstrap must not overlap the first')
  assert.equal(finishPermissionRefresh(accumulator), true, 'the later intent must survive the first bootstrap')
  assert.equal(beginPermissionRefresh(accumulator), true)
  assert.equal(finishPermissionRefresh(accumulator), false)
})

test('a late refresh from an old session cannot clear or reschedule the new session generation', () => {
  const oldSession = createPermissionRefreshAccumulator()
  notePermissionRefreshIntent(oldSession, { channel: 'users', payload: { id: 'me' } }, subject)
  assert.equal(beginPermissionRefresh(oldSession), true)

  let currentSession = createPermissionRefreshAccumulator()
  notePermissionRefreshIntent(currentSession, { channel: 'roles', payload: null }, subject)
  assert.equal(beginPermissionRefresh(currentSession), true)

  const oldNeedsAnotherRefresh = finishPermissionRefresh(oldSession)
  assert.equal(oldNeedsAnotherRefresh && currentSession === oldSession, false)
  assert.equal(currentSession.running, true, 'the old completion must not clear the new refresh')

  notePermissionRefreshIntent(currentSession, { channel: 'users', payload: { id: 'me' } }, subject)
  assert.equal(beginPermissionRefresh(currentSession), false, 'a third refresh must not overlap the new refresh')
  assert.equal(finishPermissionRefresh(currentSession), true)
  assert.equal(beginPermissionRefresh(currentSession), true, 'the later intent runs after the new refresh finishes')
})

test('AppContext records auth intent before the per-channel debounce can replace event detail', () => {
  const onUpdate = appContextSource.slice(appContextSource.indexOf('    const onUpdate = (e: Event) => {'), appContextSource.indexOf('    const onStatus = (e: Event) => {'))
  assert.ok(onUpdate.indexOf('notePermissionRefreshIntent(') >= 0)
  assert.ok(onUpdate.indexOf('notePermissionRefreshIntent(') < onUpdate.indexOf('if (debounceRef.current[channel])'))
  assert.doesNotMatch(onUpdate, /affectsThisSession/)
  assert.match(appContextSource, /const accumulator = permissionRefreshRef\.current\n\s+if \(!beginPermissionRefresh\(accumulator\)\) return/)
  assert.match(appContextSource, /const needsAnotherRefresh = finishPermissionRefresh\(accumulator\)/)
  assert.match(appContextSource, /permissionRefreshRef\.current === accumulator && needsAnotherRefresh/)
  assert.match(appContextSource, /permissionRefreshRef\.current = createPermissionRefreshAccumulator\(\)/)
})

type HandlerRun = { bootstrapCalls: number; clears: number; loadSettingsCalls: number; applied: number; unauthorized: number }
type HandlerOptions = { serverUser?: Record<string, unknown>; offline?: boolean }
const sessionUser = { id: 'me', role_id: 'cashier', role_code: 'cashier', permissions: '{"sales":true}', role_permissions: '{"pos":true}', is_active: 1, organization_id: 1 }

async function runExtractedHandler(events: Array<{ channel: string; reason?: string; payload?: { id?: string | number } | null }>): Promise<number> {
  return (await runExtractedHandlerCounts(events)).bootstrapCalls
}

async function runExtractedHandlerCounts(events: Array<{ channel: string; reason?: string; payload?: { id?: string | number } | null }>, options: HandlerOptions = {}): Promise<HandlerRun> {
  const syncSection = appContextSource.indexOf('  // Sync event listeners')
  const start = appContextSource.indexOf('    let disposed = false', syncSection)
  const end = appContextSource.indexOf('    const onStatus = (e: Event) => {', start)
  assert.ok(start >= 0 && end > start, 'AppContext handler extraction boundaries changed')
  const handler = ts.transpileModule(
    `${appContextSource.slice(start, end)}\nglobalThis.onUpdate = onUpdate;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText
  const timers = new Map<number, () => unknown>()
  let nextTimer = 0
  const counts: HandlerRun = { bootstrapCalls: 0, clears: 0, loadSettingsCalls: 0, applied: 0, unauthorized: 0 }
  const serverUser = options.serverUser || sessionUser
  const clearTimer = (id: number) => { timers.delete(id) }
  const context = {
    eventDetail: (event: { detail: unknown }) => event.detail,
    debounceRef: { current: {} },
    permissionRefreshRef: { current: createPermissionRefreshAccumulator() },
    permissionRefreshTimerRef: { current: null },
    schedulePermissionRefreshRef: { current: () => {} },
    beginPermissionRefresh,
    escalatePermissionRefresh,
    finishPermissionRefresh,
    FOREGROUND_RESUME_REASON,
    isOwnSettingsWrite,
    notePermissionRefreshIntent,
    permissionSnapshotKey,
    clearTimeout: clearTimer,
    window: {
      clearTimeout: clearTimer,
      setTimeout: (fn: () => unknown) => { timers.set(++nextTimer, fn); return nextTimer },
    },
    SYNC: { EVENT_DEBOUNCE_MS: 150 },
    user: sessionUser,
    clearLocalBusinessState: async () => { counts.clears += 1 },
    readAppBootstrap: async () => { counts.bootstrapCalls += 1; return { user: serverUser, ...(options.offline ? { offline: true } : {}) } },
    applyBootstrapPayload: async () => { counts.applied += 1 },
    handleUnauthorizedSession: async () => { counts.unauthorized += 1 },
    getStoredUserPayload: () => ({ id: 'me' }),
    loadSettings: async () => { counts.loadSettingsCalls += 1 },
    setSyncChannel: () => {},
  }
  vm.createContext(context)
  vm.runInContext(handler, context)
  for (const detail of events) (context as typeof context & { onUpdate: (event: { detail: unknown }) => void }).onUpdate({ detail })
  while (timers.size) {
    const pending = [...timers.values()]
    timers.clear()
    for (const callback of pending) await callback()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return counts
}

test('the extracted AppContext handler preserves the reviewed failing bursts', async () => {
  assert.equal(await runExtractedHandler([
    { channel: 'users', payload: { id: 'me' } },
    { channel: 'users', payload: { id: 'someone-else' } },
  ]), 1)
  assert.equal(await runExtractedHandler([
    { channel: 'roles', reason: 'visibility-resume', payload: null },
  ]), 1)
  assert.equal(await runExtractedHandler([
    { channel: 'users', reason: 'visibility-resume', payload: null },
    { channel: 'roles', reason: 'visibility-resume', payload: null },
  ]), 1, 'one foreground burst must not start redundant bootstraps')
})

test('backend authorization still resolves the current user and role on every protected request', () => {
  const source = readFileSync(new URL('../../cloudflare/src/lib/auth.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('export async function getSessionUser')
  const getSessionUser = source.slice(start, source.indexOf('export async function revokeSession', start))
  assert.match(source, /export async function requireAuth[\s\S]*const user = await getSessionUser\(c\)/)
  assert.match(getSessionUser, /r\.permissions AS role_permissions/)
  assert.match(getSessionUser, /LEFT JOIN roles r ON r\.id = u\.role_id/)
})

// E4 (G39 item 4): a tab refocus used to dispatch id-less users/roles events,
// which cleared local state, re-read bootstrap and quarantined the browser's
// other tabs on every refocus. These runs count what each burst costs.
const resumeChannels = ['settings', 'products', 'sales', 'users', 'roles', 'pendingActions']

test('a refocus whose socket stayed open costs no bootstrap, no reset and no settings read', async () => {
  const run = await runExtractedHandlerCounts(resumeChannels.map((channel) => ({ channel, reason: FOREGROUND_RESUME_REASON, payload: null })))
  assert.deepEqual(run, { bootstrapCalls: 0, clears: 0, loadSettingsCalls: 0, applied: 0, unauthorized: 0 })
})

test('a refocus after a socket gap verifies with one bootstrap read and keeps the session when nothing changed', async () => {
  const run = await runExtractedHandlerCounts(resumeChannels.map((channel) => ({ channel, reason: FOREGROUND_RESUME_GAP_REASON, payload: null })))
  assert.equal(run.bootstrapCalls, 1, 'one users+roles burst is one verification read')
  assert.equal(run.clears, 0, 'an unchanged session must not clear local state or rotate the cross-tab marker')
  assert.equal(run.applied, 0)
  assert.equal(run.loadSettingsCalls, 1, 'a settings push may have been missed during the gap')
})

test('a refocus after a socket gap that finds changed authority runs the full refresh', async () => {
  for (const serverUser of [
    { ...sessionUser, role_id: 'manager' },
    { ...sessionUser, permissions: '{"sales":false}' },
    { ...sessionUser, role_permissions: '{"pos":false}' },
    { ...sessionUser, is_active: 0 },
  ]) {
    const run = await runExtractedHandlerCounts([{ channel: 'roles', reason: FOREGROUND_RESUME_GAP_REASON, payload: null }], { serverUser })
    assert.equal(run.clears, 1, 'a changed authority must reset local state: ' + JSON.stringify(serverUser))
    assert.equal(run.applied, 1, 'and apply the new bootstrap')
    assert.equal(run.bootstrapCalls, 2, 'verification read + the full refresh read')
  }
})

test('an offline verification read neither resets nor escalates', async () => {
  const run = await runExtractedHandlerCounts([{ channel: 'users', reason: FOREGROUND_RESUME_GAP_REASON, payload: null }], { serverUser: { ...sessionUser, role_id: 'x' }, offline: true })
  assert.equal(run.clears, 0)
  assert.equal(run.applied, 0)
})

test('control: a server push for the signed-in user or role still runs the full permission refresh', async () => {
  for (const event of [{ channel: 'users', payload: { id: 'me' } }, { channel: 'roles', payload: { id: 'cashier' } }]) {
    const run = await runExtractedHandlerCounts([event])
    assert.equal(run.clears, 1, JSON.stringify(event))
    assert.equal(run.bootstrapCalls, 1)
    assert.equal(run.applied, 1)
  }
})

test('control: an own-user push inside a resume burst is not downgraded to a verification', async () => {
  const run = await runExtractedHandlerCounts([
    { channel: 'users', reason: FOREGROUND_RESUME_REASON, payload: null },
    { channel: 'users', reason: FOREGROUND_RESUME_GAP_REASON, payload: null },
    { channel: 'users', payload: { id: 'me' } },
    { channel: 'roles', reason: FOREGROUND_RESUME_GAP_REASON, payload: null },
  ])
  assert.equal(run.clears, 1)
  assert.equal(run.bootstrapCalls, 1, 'one full refresh, no separate verification read')
})

test('control: id-less users/roles from any other source still fail closed', async () => {
  const run = await runExtractedHandlerCounts([{ channel: 'users', payload: null }, { channel: 'roles', reason: 'visibility-resume', payload: null }])
  assert.equal(run.clears, 1)
  assert.equal(run.bootstrapCalls, 1)
})

test('the permission snapshot ignores display-only fields and catches authority fields', () => {
  assert.equal(permissionSnapshotKey(sessionUser), permissionSnapshotKey({ ...sessionUser, name: 'Renamed', username: 'renamed' }))
  assert.equal(permissionSnapshotKey({ ...sessionUser, id: 5 }), permissionSnapshotKey({ ...sessionUser, id: '5' }))
  for (const field of ['id', 'organization_id', 'role_id', 'role_code', 'role_name', 'permissions', 'role_permissions', 'is_active', 'must_change_password']) {
    assert.notEqual(permissionSnapshotKey(sessionUser), permissionSnapshotKey({ ...sessionUser, [field]: 'changed' }), field)
  }
})
