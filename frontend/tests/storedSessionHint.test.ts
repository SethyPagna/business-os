// The expiry recorded at sign-in is a hint, not the session (CLAUDE-SEC-SESSIONS, "Frontend follow-up needed" 3).
//
// The Worker renews a session each time it is used and tells the app its expiry only at sign-in and when the duration
// changes, so a renewed 1-day session was treated as expired by the app after the first 24 hours: the stored account
// was wiped on load, and a bootstrap that could not be answered (offline, a gateway blip) left the login screen.
//
// The REAL code is run: App.tsx hasUsableStoredAuthSession, AppContext's initial-user initializer and its
// adoptHeldSession, with the real storage helpers. Past the hint the stored session is kept but not shown; the Worker's
// answer decides: accepted -> signed in, rejected -> signed out and the record cleared, unanswered -> the stored
// account is shown (the offline banner blocks saving).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { getAuthStorage } from '../src/utils/authStorage.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const parse = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const contextText = read('../src/AppContext.tsx')
const shellText = read('../src/App.tsx')
const context = parse('AppContext.tsx', contextText)
const shell = parse('App.tsx', shellText)

function declaration(tree: ts.SourceFile, name: string): string | undefined {
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (node.name.getText(tree) === name) found = node.initializer.getText(tree)
      else if (ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(tree) === name && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0].getText(tree)
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}
function functions(tree: ts.SourceFile, names: string[]): string {
  return tree.statements
    .filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text))
    .map((node) => node.getText(tree))
    .join('\n')
}

const STORAGE_KEYS = { USER: 'user', USER_EXPIRY: 'expiry', SERVER_START_TIME: 'server', OAUTH_LOGIN_PENDING: 'oauth-login', OAUTH_LINK_PENDING: 'oauth-link', OAUTH_CALLBACK_RESULT: 'oauth-result', SYNC_SERVER: 'sync' }
const STORAGE_HELPERS = ['safeStorageGet', 'safeStorageSet', 'safeStorageRemove', 'getStoredUserPayload', 'getStoredUserExpiry', 'clearPersistedAuthState', 'persistAuthState', 'readStoredUser', 'storedExpiryHasPassed']

let quarantined = false
function execute(expression: string, bindings: Record<string, unknown> = {}) {
  const scope = { getAuthStorage, STORAGE_KEYS, SESSION_ONLY_STORAGE_KEYS: ['user', 'expiry'], isActorSessionQuarantined: () => quarantined, ...bindings }
  const js = ts.transpileModule(`${functions(context, STORAGE_HELPERS)}\n${functions(shell, ['readStorageValue', 'hasUsableStoredAuthSession'])}\nreturn (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), js)(...Object.values(scope))
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
function memoryStorage() {
  const values = new Map<string, string>([['pending-sale', 'keep']])
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
function install(local: ReturnType<typeof memoryStorage>, session: ReturnType<typeof memoryStorage>) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: local, sessionStorage: session } })
}

let failed = 0
function check(name: string, run: () => void): void {
  try { run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const DAY = 24 * 60 * 60 * 1000
const cashier = { id: 7, name: 'Cashier' }
function signedIn(expiry: number | null, where: 'local' | 'session' = 'local') {
  const local = memoryStorage(), session = memoryStorage()
  install(local, session)
  const store = where === 'local' ? local : session
  store.setItem('user', JSON.stringify(cashier))
  if (expiry !== null) store.setItem('expiry', String(expiry))
  return { local, session, store }
}
const initialUser = (publicMode = false) => execute(`(${declaration(context, 'user')})()`, { publicMode })
const adopt = (state: { user: unknown }) => {
  const text = declaration(context, 'adoptHeldSession')
  assert.ok(text, 'AppContext declares adoptHeldSession')
  execute(`(${text})()`, { setUser: (next: unknown) => { state.user = typeof next === 'function' ? (next as (current: unknown) => unknown)(state.user) : next } })
}

try {
  check('a stored session past its recorded expiry is still usable by the shell (the Worker may have renewed it)', () => {
    signedIn(Date.now() - 3 * DAY)
    assert.equal(execute('hasUsableStoredAuthSession()'), true)
    signedIn(Date.now() - 3 * DAY, 'session')
    assert.equal(execute('hasUsableStoredAuthSession()'), true)
  })

  check('control: no stored user, an unreadable one, or blocked storage is not a stored session', () => {
    install(memoryStorage(), memoryStorage())
    assert.equal(execute('hasUsableStoredAuthSession()'), false)
    const { store } = signedIn(Date.now() + DAY)
    store.setItem('user', '{not json')
    assert.equal(execute('hasUsableStoredAuthSession()'), false)
    store.setItem('user', 'null')
    assert.equal(execute('hasUsableStoredAuthSession()'), false)
    const blocked = () => { throw new DOMException('Storage blocked', 'SecurityError') }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked }, sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } } })
    assert.equal(execute('hasUsableStoredAuthSession()'), false)
  })

  check('initial user: past the hint nobody is shown yet, but the stored record is NOT wiped', () => {
    const { local } = signedIn(Date.now() - 3 * DAY)
    assert.equal(initialUser(), null, 'the account is not shown before the Worker answers')
    assert.equal(local.getItem('user'), JSON.stringify(cashier), 'the stored account is kept for the bootstrap to decide')
    assert.ok(local.getItem('expiry'), 'and so is the recorded expiry')
    assert.equal(local.getItem('pending-sale'), 'keep')
  })

  check('initial user: inside the hint, or with no expiry, or in either storage, the account is shown at once; public mode shows none', () => {
    signedIn(Date.now() + DAY)
    assert.deepEqual(initialUser(), cashier)
    signedIn(null)
    assert.deepEqual(initialUser(), cashier)
    signedIn(Date.now() + DAY, 'session')
    assert.deepEqual(initialUser(), cashier)
    assert.equal(initialUser(true), null)
    install(memoryStorage(), memoryStorage())
    assert.equal(initialUser(), null)
  })

  check('the Worker accepted: the account it applied stays, the stored copy does not replace it', () => {
    signedIn(Date.now() - 3 * DAY)
    const state = { user: initialUser() as unknown }
    assert.equal(state.user, null)
    state.user = { ...cashier, permissions: ['pos'] }
    adopt(state)
    assert.deepEqual(state.user, { ...cashier, permissions: ['pos'] })
  })

  check('the Worker rejected: the record is cleared, nobody is shown and the shell no longer holds', () => {
    signedIn(Date.now() - 3 * DAY)
    const state = { user: initialUser() as unknown }
    assert.equal(execute('hasUsableStoredAuthSession()'), true, 'held while the Worker has not answered')
    execute('clearPersistedAuthState()')
    adopt(state)
    assert.equal(state.user, null, 'a rejected session is not brought back')
    assert.equal(execute('hasUsableStoredAuthSession()'), false, 'so the login screen shows')
  })

  check('no answer (offline, a gateway blip, a timeout): the stored account is shown instead of the login screen', () => {
    signedIn(Date.now() - 3 * DAY)
    const state = { user: initialUser() as unknown }
    adopt(state)
    assert.deepEqual(state.user, cashier)
  })

  check('a locked session is not adopted', () => {
    signedIn(Date.now() - 3 * DAY)
    quarantined = true
    try {
      const state = { user: initialUser() as unknown }
      adopt(state)
      assert.equal(state.user, null)
    } finally { quarantined = false }
  })

  check('real expiry and sign-out are not weakened: the Worker rejection and the explicit sign-out still clear the record and the user', () => {
    const unauthorized = declaration(context, 'handleUnauthorizedSession')
    assert.ok(unauthorized)
    assert.match(unauthorized, /await clearLocalBusinessState\(\{\s*clearAuth: true/)
    assert.match(unauthorized, /setUser\(null\)/)
    assert.match(unauthorized, /clearPersistedAuthState\(\)/)
    const startup = contextText.slice(contextText.indexOf('const discoverSyncUrl'))
    assert.match(startup, /if \(bootstrap\?\.unauthorized\) \{\s*await handleUnauthorizedSession\(/)
    const onUnauthorized = contextText.slice(contextText.indexOf('const onUnauthorized = (e: Event)'))
    assert.match(onUnauthorized, /handleUnauthorizedSession\(/, 'a 401 after start still signs out')
  })

  check('every way the startup bootstrap can end without a verdict adopts the held session', () => {
    const startup = contextText.slice(contextText.indexOf('const discoverSyncUrl'), contextText.indexOf('// Theme and CSS variables.'))
    assert.match(startup, /\.finally\(\(\) => \{\s*settled = true\s*window\.clearTimeout\(authReadyWatchdog\)\s*adoptHeldSession\(\)\s*setAuthReady\(true\)/)
    assert.match(startup, /\} else \{\s*adoptHeldSession\(\)\s*runStartupHealthProbe\(\)\s*\}/, 'no bootstrap probe in this build')
    assert.match(startup, /\} else \{\s*adoptHeldSession\(\)\s*setAuthReady\(true\)\s*\}/, 'no server address')
    assert.match(startup, /discoverSyncUrl error:[^\n]*\n\s*adoptHeldSession\(\)/, 'a startup error')
  })
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nstoredSessionHint: all checks passed')
