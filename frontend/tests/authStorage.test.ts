import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { getAuthStorage } from '../src/utils/authStorage.ts'

const source = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('AppContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['safeStorageGet', 'safeStorageSet', 'safeStorageRemove', 'getStoredUserPayload', 'getStoredUserExpiry', 'clearPersistedAuthState', 'persistAuthState']
const functions = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text)).map(node => node.getText(tree)).join('\n')
assert.equal(names.length, tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)).length)
const STORAGE_KEYS = { USER: 'user', USER_EXPIRY: 'expiry', SERVER_START_TIME: 'server', OAUTH_LOGIN_PENDING: 'oauth-login', OAUTH_LINK_PENDING: 'oauth-link', OAUTH_CALLBACK_RESULT: 'oauth-result', SYNC_SERVER: 'sync' }
function execute(expression: string, bindings: Record<string, unknown> = {}) {
  const scope = { getAuthStorage, STORAGE_KEYS, SESSION_ONLY_STORAGE_KEYS: ['user', 'expiry'], ...bindings }
  const js = ts.transpileModule(`${functions}\nreturn (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
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
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
console.log('PASS actual auth storage callbacks: throwing getters/methods, cookie probe, persistence, clear and pending-work preservation')
