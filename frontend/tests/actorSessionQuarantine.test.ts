import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const data = new Map<string, string>([['businessos_user', JSON.stringify({ id: 1 })]])
const events = new EventTarget()
Object.assign(globalThis, { window: {
  location: { origin: 'https://quarantine.test' },
  localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) },
  sessionStorage: { getItem: () => null },
  addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events), setTimeout, clearTimeout,
} })
const scope = await import('../src/api/actorReadScope.ts')
const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://quarantine.test')
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { resolve, promise } }
const flush = () => new Promise<void>((r) => setImmediate(r))
let sequence = 0
function externalChange() {
  data.set('businessos_read_session', 'external-' + ++sequence)
  assert.equal(scope.isActorSessionQuarantined(), true)
}
let fetches = 0
let unauthorized = 0
events.addEventListener('auth:unauthorized', () => { unauthorized++ })
const originalFetch = globalThis.fetch
try {
  const dispatched = deferred<Response>()
  globalThis.fetch = (() => { fetches++; return dispatched.promise }) as typeof fetch
  const priorWrite = http.apiFetch('POST', '/api/sales', { client_request_id: 'already-sent' })
  externalChange()
  for (const [method, path] of [['POST', '/api/sales'], ['GET', '/api/products'], ['GET', '/api/auth/bootstrap']]) {
    await assert.rejects(http.apiFetch(method, path), (e: any) => e.code === 'actor_session_quarantined' && e.outcome === 'not_dispatched')
  }
  assert.equal(fetches, 1, 'old UI cannot send new private reads or mutations')
  dispatched.resolve(new Response(JSON.stringify({ success: true, operation_id: 'committed' })))
  assert.deepEqual(await priorWrite, { success: true, operation_id: 'committed' }, 'already dispatched receipt remains observable')
  globalThis.fetch = (async (url: any) => {
    assert.equal(String(url), 'https://quarantine.test/api/auth/bootstrap')
    return new Response(JSON.stringify({ error: 'Not authenticated', code: 'invalid_session' }), { status: 401 })
  }) as typeof fetch
  await assert.rejects(http.readActorSessionRecoveryBootstrap(), (e: any) => e.status === 401)
  assert.equal(unauthorized, 0, 'recovery401 never logs out or clears another tab session')
  assert.equal(scope.completeActorSessionReconciliation('obsolete-marker'), false)
  assert.equal(scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker()), true)
  const oldUnauthorized = deferred<Response>()
  globalThis.fetch = (() => oldUnauthorized.promise) as typeof fetch
  const oldWrite = http.apiFetch('POST', '/api/sales', { client_request_id: 'old-session-write' })
  scope.resetActorReadSession()
  data.set('businessos_user', JSON.stringify({ id: 2 }))
  oldUnauthorized.resolve(new Response(JSON.stringify({ error: 'Old session expired' }), { status: 401 }))
  await assert.rejects(oldWrite, (e: any) => e.status === 401)
  assert.equal(unauthorized, 0, 'late old mutation401 preserves its result without logging out new same-tab actor')
  data.set('businessos_user', JSON.stringify({ id: 1 }))
  externalChange()

  // Execute the actual AppContext effect bodies with explicit hook/commit
  // scheduling. No copied reconciliation implementation or source regex verdict.
  const source = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
  const block = source.slice(source.indexOf('  const reconciledActorRef ='), source.indexOf('  // Sync event listeners'))
  const code = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  function harness(response: Promise<any>) {
    const env: any = {
      ...scope, user: { id: 1, permissions: { sales: true } }, publicMode: false, effects: [], applied: [], flushed: 0,
      useRef: (current: unknown) => ({ current }),
      useEffect: (fn: () => unknown) => { env.effects.push(fn) },
      flushPendingWorkDrafts: () => { env.flushed++ }, disconnectWS: () => {}, resumeWS: () => {}, startHealthCheck: () => {},
      setAuthReady: (v: boolean) => { env.ready = v },
      readActorSessionRecoveryBootstrap: () => response,
      shouldResetForRuntimeChange: () => false, readStoredRuntimeDescriptor: () => ({}), buildRuntimeDescriptorFromBootstrap: () => ({}),
      applyBootstrapPayload: async (payload: any) => { env.applied.push(payload); env.user = payload.user },
    }
    new Function('env', `with(env){${code}}`)(env)
    const cleanup = env.effects[1]()
    return { env, commit: () => env.effects[0](), cleanup }
  }
  const other = harness(Promise.resolve({ user: { id: 2 } }))
  await flush()
  assert.equal(other.env.applied.length, 0)
  assert.equal(scope.isActorSessionQuarantined(), true, 'different account never binds over old mounted drafts')
  assert.equal(scope.actorSessionQuarantineStatus(), 'different-account')
  assert.equal(other.env.flushed, 1)
  other.cleanup()

  const same = harness(Promise.resolve({ user: { id: 1, permissions: { sales: false } } }))
  await flush()
  assert.equal(same.env.applied.length, 1)
  assert.equal(scope.isActorSessionQuarantined(), true, 'same actor stays locked until permission snapshot commits')
  same.commit()
  assert.equal(scope.isActorSessionQuarantined(), false)
  assert.equal(same.env.user.permissions.sales, false)
  same.cleanup()

  externalChange()
  const old = deferred<any>()
  const stale = harness(old.promise)
  externalChange()
  old.resolve({ user: { id: 1 } })
  await flush()
  // Both requests in this fixture share a promise: only the newest generation
  // may apply. The stale request is excluded by the actual request counter.
  assert.equal(stale.env.applied.length, 1)
  stale.commit()
  stale.cleanup()
  assert.equal(scope.isActorSessionQuarantined(), false)
  const logoutBlock = source.slice(source.indexOf('  const logout = useCallback'), source.indexOf('  // Notifications.'))
  const logoutCode = ts.transpileModule(logoutBlock, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const logoutResponse = deferred<void>()
  const logoutEnv: any = { ...scope, useCallback: (fn: any) => fn, disconnectWS: () => {}, getAppApi: () => ({ logout: () => logoutResponse.promise }),
    withLoaderTimeout: (fn: any) => fn(), APP_LOGOUT_TIMEOUT_MS: 1000, cleared: 0,
    clearLocalBusinessState: async () => { logoutEnv.cleared++ }, setUser: () => { logoutEnv.cleared++ },
    setAuthReady: () => {}, setPage: () => {}, clearPersistedAuthState: () => { logoutEnv.cleared++ } }
  const logout = new Function('env', `with(env){${logoutCode}; return logout}`)(logoutEnv)
  const ending = logout()
  externalChange()
  logoutResponse.resolve()
  await ending
  assert.equal(logoutEnv.cleared, 0, 'old dispatched logout completion cannot clear new session locally')
  scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
} finally { globalThis.fetch = originalFetch }
console.log('PASS quarantine dispatch, exact recovery401 isolation, preserved write receipts, actual AppContext effects and commit fence')
