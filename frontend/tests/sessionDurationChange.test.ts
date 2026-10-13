// Changing the default login duration (CLAUDE-SEC-SESSIONS, "Frontend follow-up needed" 1).
//
// POST /api/auth/session-duration answers 400 session_duration_password_required for a longer duration without the
// current password. Before, saveSettings wrote login_session_duration to the device BEFORE calling it and had no way
// to send a password, so a refusal left the new value saved while the session stayed as it was.
//
//   the module     changeSessionDuration: the server is asked first, persist runs only after it accepted, every refusal
//                  is returned as a value (never thrown), none of them touches a sign-out
//   the callbacks  the REAL changeSessionDuration and saveSettings callbacks from AppContext.tsx, run with spies:
//                  the device record and the stored session expiry stay put on a refusal, move once on success, and
//                  the password reaches the request
//   the reasons    a pack sentence in en and km for every coded refusal
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { changeSessionDuration, normalizeSessionDuration, sessionDurationRefusalMessage, type SessionDurationApplied, type SessionDurationRefusal } from '../src/utils/sessionDurationChange.ts'
import { normalizeSettingsWriteOptions } from '../src/utils/settingsWriteOptions.ts'
import { sendChangedSettings } from '../src/utils/settingsSave.ts'
import { presentWriteError } from '../src/utils/writeErrorPresentation.ts'
import { withLoaderTimeout } from '../src/utils/loaders.ts'
import { getClientDeviceInfo } from '../src/utils/deviceInfo.ts'

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const apiError = (code: string, status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(`server said ${code}`), { code, status, ...extra })

await check('a refusal is a value: nothing is persisted, nothing throws, and the server was asked first', async () => {
  for (const [code, status, extra] of [
    ['session_duration_password_required', 400, {}],
    ['incorrect_password', 400, {}],
    ['current_password_rate_limited', 429, { retryAfterSeconds: 900 }],
    ['session_duration_rate_limited', 429, { retryAfterSeconds: 60 }],
  ] as const) {
    const calls: string[] = []
    const outcome = await changeSessionDuration({
      sessionDuration: '30d',
      refresh: async (duration, password) => { calls.push(`refresh:${duration}:${password}`); throw apiError(code, status, extra) },
      persist: () => { calls.push('persist') },
    })
    assert.equal(outcome.success, false, code)
    const refusal = outcome as SessionDurationRefusal
    assert.equal(refusal.code, code)
    assert.equal(refusal.status, status)
    assert.equal(refusal.retryAfterSeconds, 'retryAfterSeconds' in extra ? extra.retryAfterSeconds : null)
    assert.deepEqual(calls, ['refresh:30d:'], `${code}: asked once, persisted nothing`)
  }
})

await check('success persists once, after the server answered, with the server expiry', async () => {
  const calls: string[] = []
  const outcome = await changeSessionDuration({
    sessionDuration: ' 7d ',
    currentPassword: 'hunter2',
    refresh: async (duration, password) => { calls.push(`refresh:${duration}:${password}`); return { sessionExpiresAt: '2026-10-20T00:00:00.000Z', authMode: 'cookie' } },
    persist: (applied: SessionDurationApplied) => { calls.push(`persist:${applied.sessionDuration}:${applied.sessionExpiresAt}`) },
  })
  assert.deepEqual(calls, ['refresh:7d:hunter2', 'persist:7d:2026-10-20T00:00:00.000Z'])
  assert.equal(outcome.success, true)
})

await check('a {success:false} answer and a dropped connection are refusals too, not persisted', async () => {
  for (const failure of [async () => ({ success: false, error: 'no' }), async () => { throw new TypeError('Failed to fetch') }]) {
    let persisted = 0
    const outcome = await changeSessionDuration({ sessionDuration: '1d', refresh: failure, persist: () => { persisted += 1 } })
    assert.equal(outcome.success, false)
    assert.equal(persisted, 0)
  }
})

await check('nobody signed in: the choice is kept on the device only', async () => {
  const persisted: string[] = []
  await changeSessionDuration({ sessionDuration: '', refresh: null, persist: (applied) => { persisted.push(applied.sessionDuration) } })
  assert.deepEqual(persisted, ['session'])
  assert.equal(normalizeSessionDuration(undefined), 'session')
})

const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

await check('every coded refusal has a sentence in both packs, Khmer in km; an unknown code has none', () => {
  const refusal = (code: string): SessionDurationRefusal => ({ success: false, code, error: 'English from the Worker', status: 400, retryAfterSeconds: null })
  for (const code of ['session_duration_password_required', 'incorrect_password', 'current_password_rate_limited', 'session_duration_rate_limited']) {
    const english = sessionDurationRefusalMessage(refusal(code), (key, fallback) => en[key] ?? fallback)
    const khmer = sessionDurationRefusalMessage(refusal(code), (key, fallback) => km[key] ?? fallback)
    assert.ok(english && !/English from the Worker/.test(english), code)
    assert.ok(khmer && /[ក-៿]/.test(khmer), `${code}: Khmer`)
    assert.notEqual(khmer, english)
  }
  assert.equal(sessionDurationRefusalMessage(refusal('anything_else'), (_key, fallback) => fallback), null)
  for (const key of ['session_duration_password_title', 'session_duration_password_required', 'session_duration_rate_limited', 'session_duration_not_changed']) {
    assert.ok(en[key] && km[key] && /[ក-៿]/.test(km[key]), key)
  }
})

const source = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('AppContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declarationText(name: string): string {
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) found = node.initializer.getText(tree)
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, `AppContext declares ${name}`)
  return found
}
function functionText(name: string): string {
  const node = tree.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  assert.ok(node, `AppContext declares function ${name}`)
  return node.getText(tree)
}
function run(code: string, scope: Record<string, unknown>): unknown {
  const js = ts.transpileModule(`return (${code});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), js)(...Object.values(scope))
}
const useCallback = (fn: unknown) => fn
const STORAGE_KEYS = { SESSION_DURATION: 'businessos_session_duration' }

type Spies = { events: string[]; requests: Array<Record<string, unknown>> }
function sessionDurationCallback(spies: Spies, answer: (request: Record<string, unknown>) => Promise<unknown>, signedIn = true): (value: unknown, password?: string) => Promise<{ success: boolean }> {
  const scope: Record<string, unknown> = {
    useCallback,
    user: signedIn ? { id: 7, name: 'Cashier' } : null,
    getAppApi: () => ({ updateSessionDuration: (request: Record<string, unknown>) => { spies.requests.push(request); spies.events.push('request'); return answer(request) } }),
    applySessionDurationChange: changeSessionDuration,
    getClientDeviceInfo,
    withLoaderTimeout,
    APP_SESSION_DURATION_TIMEOUT_MS: 1000,
    applyDeviceSettings: (updates: Record<string, unknown>) => { spies.events.push(`device:${updates.login_session_duration}`) },
    persistAuthState: (state: { sessionDuration: string; expiryTime: number | null }) => { spies.events.push(`stored:${state.sessionDuration}:${state.expiryTime}`) },
    computeSessionExpiryMs: run(functionText('computeSessionExpiryMs'), { STORAGE_KEYS }),
  }
  return run(declarationText('changeSessionDuration'), scope) as never
}

await check('AppContext.changeSessionDuration: the password reaches the request; a refusal moves neither the device record nor the stored expiry', async () => {
  for (const [code, status] of [['session_duration_password_required', 400], ['incorrect_password', 400], ['current_password_rate_limited', 429]] as const) {
    const spies: Spies = { events: [], requests: [] }
    const change = sessionDurationCallback(spies, async () => { throw apiError(code, status) })
    const outcome = await change('30d', code === 'incorrect_password' ? 'wrong' : '')
    assert.equal(outcome.success, false)
    assert.deepEqual(spies.events, ['request'], `${code}: only the request happened`)
    assert.equal(spies.requests[0].sessionDuration, '30d')
    assert.equal('currentPassword' in spies.requests[0], code === 'incorrect_password', `${code}: a password is sent only when one was typed`)
  }
})

await check('AppContext.changeSessionDuration: success writes the device record and the stored session after the request, from the server expiry', async () => {
  const spies: Spies = { events: [], requests: [] }
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const change = sessionDurationCallback(spies, async () => ({ sessionExpiresAt: expiresAt, authMode: 'cookie' }))
  const outcome = await change('3d', 'right')
  assert.equal(outcome.success, true)
  assert.equal(spies.requests[0].currentPassword, 'right')
  assert.deepEqual(spies.events, ['request', 'device:3d', `stored:3d:${Date.parse(expiresAt)}`])
})

await check('AppContext.changeSessionDuration: a shorter choice goes through without a password', async () => {
  const spies: Spies = { events: [], requests: [] }
  const change = sessionDurationCallback(spies, async () => ({ sessionExpiresAt: '' }))
  assert.equal((await change('session')).success, true)
  assert.equal('currentPassword' in spies.requests[0], false)
  assert.equal(spies.events[0], 'request')
})

await check('AppContext.changeSessionDuration: signed out, only the device record changes and no request is made', async () => {
  const spies: Spies = { events: [], requests: [] }
  const change = sessionDurationCallback(spies, async () => ({}), false)
  assert.equal((await change('14d')).success, true)
  assert.deepEqual(spies.events, ['device:14d'])
})

type SaveResult = { success: boolean; error?: { code?: string }; conflict?: boolean }
type SaveSpies = { events: string[]; saved: Array<Record<string, unknown>>; toasts: string[] }
function hasDeclaration(name: string): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) found = true
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}
// The same scope serves the code before and after the change: the names it never reads are ignored.
function saveSettingsCallback(spies: SaveSpies, answer: () => Promise<unknown>): (settings: Record<string, unknown>) => Promise<SaveResult> {
  const scope: Record<string, unknown> = {
    useCallback,
    user: { id: 7, name: 'Cashier' },
    normalizeSettingsWriteOptions,
    sessionDurationRefusalMessage,
    applySessionDurationChange: changeSessionDuration,
    presentWriteError,
    sendChangedSettings,
    DEVICE_LOCAL_SETTING_KEYS: run(declarationText('DEVICE_LOCAL_SETTING_KEYS'), {}),
    settingsRef: { current: {} },
    inFlightSettingKeysRef: { current: new Map() },
    getAppApi: () => ({
      saveSettings: async (changed: Record<string, unknown>) => { spies.saved.push(changed); spies.events.push('server-settings'); return { saved: {} } },
      updateSessionDuration: (request: Record<string, unknown>) => { spies.events.push(`request:${request.sessionDuration}:${request.currentPassword ?? ''}`); return answer() },
    }),
    getClientDeviceInfo,
    withLoaderTimeout,
    APP_SETTINGS_SAVE_TIMEOUT_MS: 1000,
    APP_SESSION_DURATION_TIMEOUT_MS: 1000,
    applyDeviceSettings: (updates: Record<string, unknown>) => { spies.events.push(`device:${Object.keys(updates).join(',')}`) },
    writeStoredSessionDuration: (value: unknown) => { spies.events.push(`device-duration:${value}`); return String(value) },
    persistAuthState: (state: { sessionDuration: string }) => { spies.events.push(`stored:${state.sessionDuration}`) },
    computeSessionExpiryMs: run(functionText('computeSessionExpiryMs'), { STORAGE_KEYS }),
    refreshAppData: () => {},
    setSettings: () => {},
    notify: (message: string) => { spies.toasts.push(message) },
    t: (key: string) => en[key] ?? key,
  }
  if (hasDeclaration('changeSessionDuration')) scope.changeSessionDuration = run(declarationText('changeSessionDuration'), scope)
  return run(declarationText('saveSettings'), scope) as never
}
const firstDeviceWrite = (events: string[]) => events.findIndex((event) => event.startsWith('device'))

await check('AppContext.saveSettings: a login duration the server refuses writes nothing to the device, saves nothing else and says why in the pack', async () => {
  const spies: SaveSpies = { events: [], saved: [], toasts: [] }
  const save = saveSettingsCallback(spies, async () => { throw apiError('session_duration_password_required', 400) })
  const result = await save({ login_session_duration: '30d', theme: 'dark' })
  assert.equal(result.success, false)
  assert.deepEqual(spies.events, ['request:30d:'], 'only the request happened: no device record, no stored session, no server setting')
  assert.deepEqual(spies.toasts, [en.session_duration_password_required])
})

await check('AppContext.saveSettings: the server is asked before the device record changes, and the rest of the save goes on', async () => {
  const spies: SaveSpies = { events: [], saved: [], toasts: [] }
  const save = saveSettingsCallback(spies, async () => ({ sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }))
  const result = await save({ login_session_duration: '1d', business_name: 'Leang' })
  assert.equal(result.success, true)
  assert.equal(spies.events[0], 'request:1d:', 'the request is first')
  assert.ok(firstDeviceWrite(spies.events) > 0, 'the device is written only after it')
  assert.deepEqual(spies.saved, [{ business_name: 'Leang' }], 'the duration is not sent as a server setting')
  assert.deepEqual(spies.toasts, [en.settings_saved])
})

await check('AppContext source: the old write-then-call order is gone', () => {
  assert.doesNotMatch(source, /writeStoredSessionDuration\(mergedUpdates/)
  assert.doesNotMatch(source, /const mergedUpdates = \{ \.\.\.requestedServerUpdates, \.\.\.deviceUpdates \}/)
  assert.match(source, /refresh: canRefresh/)
  assert.match(source, /\.\.\.\(password \? \{ currentPassword: password \} : \{\}\)/)
  const handleUnauthorizedInDuration = declarationText('changeSessionDuration')
  assert.doesNotMatch(handleUnauthorizedInDuration, /logout|handleUnauthorizedSession|clearPersistedAuthState|setUser\(/, 'a refusal has no path to a sign-out')
})

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nsessionDurationChange: all checks passed')
