import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { getAuthStorage } from '../src/utils/authStorage.ts'

const source = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('AppContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['safeStorageGet', 'safeStorageSet', 'safeStorageRemove', 'getStoredUserPayload', 'getStoredUserExpiry', 'clearPersistedAuthState', 'persistAuthState']
const functions = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text)).map(node => node.getText(tree)).join('\n')
const shellTree = ts.createSourceFile('App.tsx', fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const shellFunctions = shellTree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && ['readStorageValue', 'hasUsableStoredAuthSession'].includes(node.name.text)).map(node => node.getText(shellTree)).join('\n')
assert.equal(names.length, tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)).length)
const STORAGE_KEYS = { USER: 'user', USER_EXPIRY: 'expiry', SERVER_START_TIME: 'server', OAUTH_LOGIN_PENDING: 'oauth-login', OAUTH_LINK_PENDING: 'oauth-link', OAUTH_CALLBACK_RESULT: 'oauth-result', SYNC_SERVER: 'sync' }
function execute(expression: string, bindings: Record<string, unknown> = {}) {
  const scope = { getAuthStorage, STORAGE_KEYS, SESSION_ONLY_STORAGE_KEYS: ['user', 'expiry'], ...bindings }
  const js = ts.transpileModule(`${functions}\n${shellFunctions}\nreturn (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), js)(...Object.values(scope))
}
function initializer(name: string): string {
  let result: string | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node)) {
      if (node.name.getText(tree) === name && node.initializer) result = node.initializer.getText(tree)
      if (ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer)) result = node.initializer.arguments[0].getText(tree)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(result, name)
  return result
}
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
function install(windowValue: unknown) { Object.defineProperty(globalThis, 'window', { configurable: true, value: windowValue }) }
function memoryStorage() {
  const values = new Map<string, string>([['pending-sale', 'keep'], ['draft', 'keep']])
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
try {
  for (const failure of ['getter', 'method']) {
    const blocked = () => { throw new DOMException('Storage blocked', 'SecurityError') }
    const browser: Record<string, unknown> = {}
    for (const key of ['localStorage', 'sessionStorage']) {
      if (failure === 'getter') Object.defineProperty(browser, key, { get: blocked })
      else browser[key] = { getItem: blocked, setItem: blocked, removeItem: blocked }
    }
    install(browser)
    assert.equal(execute('getStoredUserPayload()'), '')
    assert.equal(execute('getStoredUserExpiry()'), '')
    assert.equal(execute('hasUsableStoredAuthSession()'), false, 'the signed-out shell renders instead of throwing after provider boot')
    assert.doesNotThrow(() => execute('persistAuthState({ user: { id: 7 }, expiryTime: 123, sessionDuration: "session" })'))
    assert.doesNotThrow(() => execute('persistAuthState({ user: { id: 7 }, expiryTime: 123, sessionDuration: "30d" })'))
    assert.doesNotThrow(() => execute('clearPersistedAuthState()'))
    assert.doesNotThrow(() => execute(`(${initializer('persistAutoSyncUrl')})()`, { syncUrl: 'https://example.test' }))
    assert.equal(execute(`(${initializer('authReady')})()`, { publicMode: false, getAppApi: () => ({ getAppBootstrap() {} }) }), false, 'blocked storage still probes the authoritative cookie session')
    assert.equal(execute(`(${initializer('authReady')})()`, { publicMode: false, getAppApi: () => ({}) }), true, 'without a cookie probe the login can render')
  }
  const local = memoryStorage(), session = memoryStorage()
  install({ localStorage: local, sessionStorage: session })
  execute('persistAuthState({ user: { id: 7 }, expiryTime: 123, sessionDuration: "session" })')
  assert.equal(JSON.parse(execute('getStoredUserPayload()')).id, 7)
  assert.equal(session.getItem('expiry'), '123')
  execute('persistAuthState({ user: { id: 8 }, expiryTime: null, sessionDuration: "30d" })')
  assert.equal(session.getItem('user'), null)
  assert.equal(JSON.parse(execute('getStoredUserPayload()')).id, 8)
  assert.equal(execute('hasUsableStoredAuthSession()'), true)
  assert.equal(execute('getStoredUserExpiry()'), '')
  execute('clearPersistedAuthState()')
  assert.equal(execute('getStoredUserPayload()'), '')
  for (const store of [local, session]) {
    assert.equal(store.getItem('pending-sale'), 'keep')
    assert.equal(store.getItem('draft'), 'keep')
  }
  install(Object.defineProperty({ localStorage: local }, 'sessionStorage', { get() { throw new Error('blocked') } }))
  local.setItem('user', '{"id":9}')
  assert.equal(JSON.parse(execute('getStoredUserPayload()')).id, 9, 'one blocked store does not hide the available store')

  // No login duration chosen or stored: the sign-in, every bootstrap and a
  // profile update all store the user in the same place, so one tab's write
  // never removes the copy another tab reads (the K3 false "account changed").
  const loginSource = fs.readFileSync(new URL('../src/components/auth/Login.tsx', import.meta.url), 'utf8')
  const loginTree = ts.createSourceFile('Login.tsx', loginSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const initializerIn = (file: ts.SourceFile, outer: string | null, inner: string): string => {
    let result: string | undefined
    const visit = (node: ts.Node, inside: boolean) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (inside && !result && node.name.getText(file) === inner) result = node.initializer.getText(file)
        if (node.name.getText(file) === outer) inside = true
      }
      ts.forEachChild(node, (child) => visit(child, inside))
    }
    visit(file, outer === null)
    assert.ok(result, `${outer ?? 'module'}: ${inner}`)
    return result
  }
  const keys = { ...STORAGE_KEYS, SESSION_DURATION: 'duration' }
  const defaults = { STORAGE_KEYS: keys, DEFAULT_SESSION_DURATION: source.includes('const DEFAULT_SESSION_DURATION') ? execute(initializerIn(tree, null, 'DEFAULT_SESSION_DURATION')) : undefined }
  const signInMode = () => execute(initializerIn(loginTree, null, 'sessionDuration'), { settings: {} })
  const bootstrapMode = () => execute(initializerIn(tree, 'applyBootstrapPayload', 'sessionDuration'), { ...defaults, mergedSettings: {} })
  const profileUpdateMode = () => execute(initializerIn(tree, 'persistUser', 'currentMode'), defaults)
  const shared = memoryStorage(), tabA = memoryStorage(), tabB = memoryStorage()
  const inTab = (tab: ReturnType<typeof memoryStorage>, mode?: string) => {
    install({ localStorage: shared, sessionStorage: tab })
    if (mode) execute(`persistAuthState({ user: { id: 7 }, expiryTime: null, sessionDuration: ${JSON.stringify(mode)} })`)
    return JSON.parse(execute('getStoredUserPayload()') || '{}').id
  }
  inTab(tabA, signInMode())
  assert.equal(inTab(tabA, bootstrapMode()), 7)
  assert.equal(inTab(tabB), 7, 'after tab A signs in and bootstraps, tab B still reads the account')
  assert.equal(inTab(tabB, profileUpdateMode()), 7)
  assert.equal(inTab(tabA, bootstrapMode()), 7)
  assert.equal(inTab(tabB), 7, 'tab A bootstrapping again does not remove the copy tab B reads')
  assert.deepEqual([signInMode(), bootstrapMode(), profileUpdateMode()], ['always', 'always', 'always'], 'one default: the sign-in form\'s, unchanged')
  shared.setItem('duration', 'session')
  assert.deepEqual([bootstrapMode(), profileUpdateMode()], ['session', 'session'], 'a stored choice still wins')
  console.log('PASS with no login duration chosen, sign-in, bootstrap and profile updates store the user in one place for every tab')
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
console.log('PASS actual auth storage callbacks: throwing getters/methods, cookie probe, persistence, clear and pending-work preservation')
