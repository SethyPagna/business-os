import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { apiFetch, setSyncServerUrl, __resetApiWriteDedupeForTests, __resetApiHealthForTests } from '../src/api/http.ts'

// S-auth4b, owner requirement (27 Sep 2026): the forced password change for an
// account signed in with a publicly known password must never be a closed
// loop. The Worker answers every call but the own change-password and the
// sign-out probe with 403 password_change_required (cloudflare/src/lib/auth.ts
// requireAuth; server side pinned by
// cloudflare/scripts/test-migration-0202-leaked-password-pure.cjs). Here:
//   - whatever the entry path (password, password + authenticator, Google, a
//     session from before the flag, another device flagging the account), a
//     refused call shows the change screen instead of a broken app;
//   - a reload lands on the change screen again (the bootstrap user decides);
//   - old -> new: no client-only password rule beyond the app-wide minimum;
//   - a wrong current password is an error in the operator's language;
//   - the ways out: the reset-method chooser and a plain Sign out.

type TestCallback = () => void | Promise<void>

let failed = 0

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

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const forcedSource = read('../src/components/auth/ForcedPasswordChange.tsx')
const loginSource = read('../src/components/auth/Login.tsx')
const appSource = read('../src/App.tsx')
const appContextSource = read('../src/AppContext.tsx')
const handoffPath = new URL('../src/components/auth/passwordRecoveryHandoff.ts', import.meta.url)
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, unknown>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, unknown>

// Safari, Firefox and Chromium pair this form by a username text input they can
// see (never display:none) before the named current / new / confirm inputs.

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

type Spies = { calls: string[]; changeAnswer: () => Promise<unknown>; saveAnswer: boolean }
type ForcedUser = { id?: number; username?: string; name?: string }
type Translate = (key: string, fallback: string) => string
type ForcedInput = { user: ForcedUser; currentPassword: string; newPassword: string; confirmPassword: string; tr: Translate }
type ForcedModule = { default: unknown; changeForcedPassword: (input: ForcedInput) => Promise<string> }

const createSpies = (changeAnswer: () => Promise<unknown>, saveAnswer = true): Spies => ({ calls: [], changeAnswer, saveAnswer })
const trFrom = (values: Record<string, string>): Translate => (key, fallback) => values[key] ?? fallback
const SOKHA = { id: 2, username: 'sokha', name: 'Sokha' }
const input = (overrides: Partial<ForcedInput> = {}): ForcedInput => ({
  user: SOKHA, currentPassword: 'Admin123456!', newPassword: 'Brand-New-9x', confirmPassword: 'Brand-New-9x', tr: trFrom({}), ...overrides,
})

function compileModule(rel: string, resolve: (id: string) => unknown): Record<string, unknown> {
  const code = transformSync(read(rel), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
  return mod.exports
}

function loadForcedScreen(spies: Spies, appContext: Record<string, unknown> = {}, passwordManager?: unknown): ForcedModule {
  return compileModule('../src/components/auth/ForcedPasswordChange.tsx', (id) => {
    if (id.endsWith('/AppContext.tsx')) return { useApp: () => ({ user: SOKHA, t: (key: string) => key, logout: async () => {}, ...appContext }) }
    if (id.endsWith('/userAdminTransport.ts')) {
      return { changeUserPassword: async (userId: unknown, body: { newPassword: string }) => { spies.calls.push(`change:${userId}:${body.newPassword}`); return spies.changeAnswer() } }
    }
    if (id.endsWith('/loaders.ts')) return { withLoaderTimeout: (fn: () => unknown) => fn() }
    if (id.endsWith('/passwordManager.ts')) {
      if (passwordManager) return passwordManager
      return { requestPasswordSave: async (request: { username: string; password: string }) => { spies.calls.push(`save:${request.username}:${request.password}`); return spies.saveAnswer } }
    }
    if (id.endsWith('/passwordRules.ts')) return require('../src/utils/passwordRules.ts')
    if (id.endsWith('/ownPasswordChange.ts')) return require('../src/components/auth/password/ownPasswordChange.ts')
    if (id.endsWith('/NewPasswordFields.tsx')) {
      return compileModule('../src/components/auth/password/NewPasswordFields.tsx', (inner) => {
        if (inner.endsWith('/passwordManager.ts')) return require('../src/utils/passwordManager.ts')
        if (inner.endsWith('/passwordSuggest.ts')) return require('../src/utils/passwordSuggest.ts')
        return require(inner)
      })
    }
    if (id.endsWith('/passwordRecoveryHandoff.ts')) return { requestPasswordRecoveryAfterSignOut: (identifier: string) => spies.calls.push(`recover:${identifier}`) }
    return require(id)
  }) as unknown as ForcedModule
}

async function withWindowEvents<T>(spies: Spies, fn: () => Promise<T>, windowExtras: Record<string, unknown> = {}): Promise<T> {
  const originalWindow = globalThis.window
  globalThis.window = {
    ...windowExtras,
    dispatchEvent: (event: Event) => {
      spies.calls.push(`dispatch:${event.type}:${(event as CustomEvent).detail?.must_change_password}`)
      return true
    },
  } as unknown as Window & typeof globalThis
  try {
    return await fn()
  } finally {
    globalThis.window = originalWindow
  }
}

const HUNG_SAVE_LIMIT_MS = 4000

async function settlesWithin<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms) })
  try {
    return await Promise.race([promise, limit])
  } finally {
    clearTimeout(timer)
  }
}

type Tag = Record<string, string>
function tagsOf(html: string, name: string): Tag[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))].map((match) => {
    const attributes: Tag = {}
    for (const attribute of match[1].matchAll(/([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g)) attributes[attribute[1].toLowerCase()] = attribute[2] ?? ''
    return attributes
  })
}

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

// Drives the real apiFetch against one canned answer and returns the window
// events it dispatched.
async function eventsFor(status: number, body: unknown, path = '/api/products'): Promise<CustomEvent[]> {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const events: CustomEvent[] = []
  globalThis.window = {
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: Event) => events.push(event as CustomEvent),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as Window & typeof globalThis
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch
  try {
    await apiFetch('GET', path, undefined, 1000).catch(() => null)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    setSyncServerUrl('')
  }
  return events
}

await runTest('a call refused with 403 password_change_required tells the app, whatever screen made it', async () => {
  const refused = { error: 'Your password is publicly known. Change it before continuing.', code: 'password_change_required' }
  const first = (await eventsFor(403, refused)).filter((event) => event.type === 'auth:password-change-required')
  assert.equal(first.length, 1, 'one event per refused call')
  const second = (await eventsFor(403, refused, '/api/sales')).filter((event) => event.type === 'auth:password-change-required')
  const a = Number((first[0].detail as { sequence?: unknown }).sequence)
  const b = Number((second[0].detail as { sequence?: unknown }).sequence)
  assert.ok(Number.isSafeInteger(a) && a > 0, 'each refusal names the request it answered')
  assert.ok(b > a, 'request order is monotonic, so a refusal of an older request can be told apart')
  const all = await eventsFor(403, refused)
  assert.equal(all.some((event) => event.type === 'auth:unauthorized'), false, 'not treated as a lost session: no sign-out, no redirect')
})

await runTest('control: other 403s and a wrong current password (400) do not raise the change screen', async () => {
  const other = await eventsFor(403, { error: 'No permission', code: 'forbidden' })
  assert.equal(other.some((event) => event.type === 'auth:password-change-required'), false)
  const wrong = await eventsFor(400, { success: false, error: 'Current password is incorrect', code: 'incorrect_password' }, '/api/users/2/change-password')
  assert.equal(wrong.some((event) => event.type === 'auth:password-change-required' || event.type === 'auth:unauthorized'), false, 'a wrong current password stays on the screen')
})

await runTest('the app shows the change screen on that event and ignores a refusal older than its own successful change', () => {
  assert.match(appContextSource, /window\.addEventListener\(PASSWORD_CHANGE_REQUIRED_EVENT, handlePasswordChangeRequired\)/)
  assert.match(appContextSource, /window\.removeEventListener\(PASSWORD_CHANGE_REQUIRED_EVENT, handlePasswordChangeRequired\)/)
  const handler = /const handlePasswordChangeRequired = \(e: Event\) => \{([\s\S]*?)\r?\n {4}\}\r?\n/.exec(appContextSource)?.[1] || ''
  assert.ok(handler, 'handlePasswordChangeRequired is defined')
  assert.match(handler, /if \(sequence <= passwordChangeClearedAtRef\.current\) return/)
  assert.match(handler, /must_change_password: 1/)
  assert.match(handler, /persistUser\(flagged\)/, 'a reload keeps the screen even before the bootstrap answers')
  // The marker moves whenever the flag goes from 1 to anything else (the
  // change screen's own success, a bootstrap, a sign-out) -- and at once for
  // the change screen's own success, before a refusal in flight is handled.
  assert.match(appContextSource, /if \(wasMustChangePasswordRef\.current && !mustChangePassword\) passwordChangeClearedAtRef\.current = currentApiRequestSequence\(\)/)
  assert.match(appContextSource, /if \('must_change_password' in nextUser && Number\(nextUser\.must_change_password \|\| 0\) !== 1\) \{\s*passwordChangeClearedAtRef\.current = currentApiRequestSequence\(\)/)
})

await runTest('every entry path hands the Worker\'s user (with its flag) to the app, and the app gates on it', () => {
  // App.tsx renders the change screen instead of the app for the flag.
  assert.match(appSource, /if \(Number\(\(user as \{ must_change_password\?: unknown \}\)\.must_change_password \|\| 0\) === 1\) \{[\s\S]{0,200}<ForcedPasswordChange \/>/)
  // Password: AppContext.login; authenticator: Login's OTP verify; Google: the
  // callback result and the completion. Each passes the payload user through.
  assert.match(appContextSource, /if \(result\.success && result\.user\) \{\s*await persistAuthenticatedUser\(result\.user,/)
  assert.match(loginSource, /await persistAuthenticatedUser\(verifyResult\.user,/)
  assert.match(loginSource, /await persistAuthenticatedUser\(callbackResult\.user,/)
  assert.match(loginSource, /if \(result\?\.success && result\?\.user\) \{\s*await persistAuthenticatedUser\(result\.user,/)
  // Sign-in and reload both finish on the bootstrap user, which carries the
  // flag from the session lookup; the sign-in payload is the fallback.
  assert.match(appContextSource, /const nextUser = safePayload\?\.user \|\| fallbackUser \|\| null/)
  assert.match(appContextSource, /persistAuthState\(\{ user: nextUser, expiryTime, sessionDuration \}\)\s*setUser\(nextUser\)/)
})

await runTest('old -> new: the change screen adds no password rule of its own', () => {
  assert.doesNotMatch(forcedSource, /newPassword === currentPassword/, 'the Worker decides what is publicly known')
  assert.doesNotMatch(forcedSource, /length < \d/, 'no local minimum: the shared rule (utils/passwordRules.ts = the Worker\'s) decides')
  assert.match(forcedSource, /import \{[^}]*\bnewPasswordProblem\b[^}]*\} from '\.\.\/\.\.\/utils\/passwordRules\.ts'/)
  assert.match(forcedSource, /changeUserPassword\(userId, \{ currentPassword, newPassword \}\)/)
})

await runTest('a wrong current password is an error in the operator\'s language, and the screen stays', async () => {
  const spies = createSpies(async () => ({ success: false, error: 'Current password is incorrect', code: 'incorrect_password' }))
  const { changeForcedPassword } = loadForcedScreen(spies)
  const shown = await withWindowEvents(spies, () => changeForcedPassword(input({ tr: trFrom({ current_password_incorrect: 'KM-WRONG' }) })))
  assert.equal(shown, 'KM-WRONG')
  assert.deepEqual(spies.calls, ['change:2:Brand-New-9x'], 'nothing saved, the screen is not left')
  const limited = createSpies(async () => ({ success: false, error: 'Too many attempts', code: 'current_password_rate_limited' }))
  const limitedShown = await withWindowEvents(limited, () => loadForcedScreen(limited).changeForcedPassword(input({ tr: trFrom({ current_password_rate_limited: 'KM-LIMIT' }) })))
  assert.equal(limitedShown, 'KM-LIMIT', 'the usual limit keeps its own message')
})

await runTest('the form pairs for password managers: username text input first, then named current, new and confirm', () => {
  const screen = loadForcedScreen(createSpies(async () => ({ success: true })))
  const html = renderToStaticMarkup(React.createElement(screen.default))
  assert.equal(tagsOf(html, 'form').length, 1, 'one real form with a submit button')
  const inputs = tagsOf(html, 'input')
  assert.deepEqual(inputs.map((tag) => [tag.type, tag.name, tag.autocomplete]), [
    ['text', 'username', 'username'],
    ['password', 'current_password', 'current-password'],
    ['password', 'new_password', 'new-password'],
    ['password', 'confirm_password', 'new-password'],
  ])
  const [username] = inputs
  assert.equal(username.value, 'sokha', 'the canonical username, not what was typed at sign-in')
  assert.equal('hidden' in username, false, 'never display:none: WebKit may skip a hidden username when pairing')
  assert.match(username.class || '', /\bsr-only\b/)
  assert.ok(inputs[2].passwordrules, 'Safari\'s generator gets the rules for its own suggestion')
})

await runTest('Suggest, Show and Copy are icon-only buttons whose tooltip is their translated name', () => {
  const screen = loadForcedScreen(createSpies(async () => ({ success: true })), {
    t: (key: string) => ({ password_suggest: 'KM-SUGGEST', show_password: 'KM-SHOW', copy_new_password: 'KM-COPY' } as Record<string, string>)[key] ?? key,
  })
  const html = renderToStaticMarkup(React.createElement(screen.default))
  for (const label of ['KM-SUGGEST', 'KM-SHOW', 'KM-COPY']) {
    const button = new RegExp(`<button type="button"[^>]*aria-label="${label}" title="${label}"[^>]*>([\\s\\S]*?)</button>`).exec(html)
    assert.ok(button, `${label} button with a matching tooltip`)
    assert.equal(button[1].replace(/<[^>]+>/g, '').trim(), '', `${label} shows an icon, no text`)
  }
})

await runTest('success asks the browser to update the saved password BEFORE the app leaves the screen', async () => {
  const spies = createSpies(async () => ({ success: true }))
  const { changeForcedPassword } = loadForcedScreen(spies)
  const shown = await withWindowEvents(spies, () => changeForcedPassword(input()))
  assert.equal(shown, '')
  assert.deepEqual(spies.calls, ['change:2:Brand-New-9x', 'save:sokha:Brand-New-9x', 'dispatch:user:updated:0'])
})

await runTest('a browser that will not save never blocks leaving the screen', async () => {
  const spies = createSpies(async () => ({ success: true }), false)
  const { changeForcedPassword } = loadForcedScreen(spies)
  assert.equal(await withWindowEvents(spies, () => changeForcedPassword(input())), '')
  assert.deepEqual(spies.calls.at(-1), 'dispatch:user:updated:0')
})

await runTest('a browser whose save never answers still leaves the screen once the password is changed', async () => {
  const spies = createSpies(async () => ({ success: true }))
  const { changeForcedPassword } = loadForcedScreen(spies, {}, require('../src/utils/passwordManager.ts'))
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { store: () => new Promise(() => {}) } } })
  class PasswordCredential {}
  try {
    const shown = await settlesWithin(HUNG_SAVE_LIMIT_MS, withWindowEvents(spies, () => changeForcedPassword(input()), { PasswordCredential }))
    assert.equal(shown, '')
    assert.deepEqual(spies.calls, ['change:2:Brand-New-9x', 'dispatch:user:updated:0'])
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
})

await runTest('the new-password rule: refused before any request, in the operator\'s language; a server refusal code too', async () => {
  const tr = trFrom({ password_edge_whitespace: 'KM-EDGE', password_too_short: 'KM-SHORT {min}', new_password_confirm_mismatch: 'KM-MISMATCH' })
  let spies = createSpies(async () => ({ success: true }))
  let screen = loadForcedScreen(spies)
  assert.equal(await withWindowEvents(spies, () => screen.changeForcedPassword(input({ newPassword: ' Brand-New-9x', confirmPassword: ' Brand-New-9x', tr }))), 'KM-EDGE')
  assert.equal(await withWindowEvents(spies, () => screen.changeForcedPassword(input({ newPassword: 'abcde', confirmPassword: 'abcde', tr }))), 'KM-SHORT 6')
  assert.equal(await withWindowEvents(spies, () => screen.changeForcedPassword(input({ confirmPassword: 'Brand-New-9y', tr }))), 'KM-MISMATCH')
  assert.deepEqual(spies.calls, [], 'no request, no save, no dispatch')

  spies = createSpies(async () => ({ success: false, error: 'Password cannot start or end with a space', code: 'password_edge_whitespace' }))
  screen = loadForcedScreen(spies)
  assert.equal(await withWindowEvents(spies, () => screen.changeForcedPassword(input({ tr }))), 'KM-EDGE', 'the server\'s English is not shown')
  assert.deepEqual(spies.calls, ['change:2:Brand-New-9x'])
})

await runTest('the ways out: the reset-method chooser (after signing out) and a plain Sign out', () => {
  assert.match(forcedSource, /requestPasswordRecoveryAfterSignOut\(String\(user\?\.username \|\| ''\)\)\s*void logout\(\)/)
  assert.match(forcedSource, /tr\('forced_password_change_forgot',/)
  assert.match(forcedSource, /onClick=\{\(\) => \{ void logout\(\) \}\}>\s*\{tr\('forced_password_change_sign_out', 'Sign out'\)\}/)
  // The sign-in screen opens the chooser for that account, once.
  assert.match(loginSource, /const handoff = takePasswordRecoveryAfterSignOut\(\)\s*if \(!handoff\) return\s*setShowResetChooser\(true\)\s*setResetIdentifier\(handoff\.identifier\)/)
})

await runTest('the recovery handoff survives sign-out in memory, is taken once, and goes stale', async () => {
  assert.ok(fs.existsSync(handoffPath), 'components/auth/passwordRecoveryHandoff.ts exists')
  const handoff = await import(handoffPath.href)
  assert.equal(handoff.takePasswordRecoveryAfterSignOut(), null)
  handoff.requestPasswordRecoveryAfterSignOut('owner')
  assert.deepEqual(handoff.takePasswordRecoveryAfterSignOut(), { identifier: 'owner' })
  assert.equal(handoff.takePasswordRecoveryAfterSignOut(), null, 'taken once')
  const realNow = Date.now
  try {
    handoff.requestPasswordRecoveryAfterSignOut('owner')
    Date.now = () => realNow() + 11 * 60 * 1000
    assert.equal(handoff.takePasswordRecoveryAfterSignOut(), null, 'a sign-out that never finished does not open the chooser much later')
  } finally {
    Date.now = realNow
  }
  assert.doesNotMatch(fs.readFileSync(handoffPath, 'utf8'), /localStorage|sessionStorage/, 'nothing about the account is written to storage')
})

await runTest('both language packs carry every new string', () => {
  for (const key of [
    'current_password_incorrect', 'forced_password_change_forgot', 'forced_password_change_sign_out',
    'password_suggest', 'password_strength_label', 'password_strength_weak', 'password_strength_fair', 'password_strength_strong',
    'password_too_short', 'password_too_long', 'password_edge_whitespace',
  ]) {
    for (const [name, pack] of [['en', en], ['km', km]] as const) {
      assert.equal(typeof pack[key], 'string', `${name}.${key}`)
      assert.ok(String(pack[key]).trim(), `${name}.${key} is not empty`)
    }
    assert.notEqual(km[key], en[key], `km.${key} is translated`)
  }
})

if (failed > 0) {
  process.exitCode = 1
}
