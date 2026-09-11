import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const local = new Map<string, string>()
const session = new Map<string, string>()
const storage = (map: Map<string, string>) => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k) })
const events = new EventTarget()
let admissionQueue = Promise.resolve()
const locks = { request: (_name: string, _options: unknown, action: () => unknown) => {
  const next = admissionQueue.then(action)
  admissionQueue = next.then(() => undefined, () => undefined)
  return next
} }
Object.assign(globalThis, { window: { location: { origin: 'https://auth-phase.test' }, localStorage: storage(local), sessionStorage: storage(session),
  navigator: { locks },
  addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) } })
const scope = await import('../src/api/actorReadScope.ts')
const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://auth-phase.test')
const originalFetch = globalThis.fetch
try {
  let redirect = ''
  local.set('businessos_oauth_callback_result', 'stale previous callback')
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    assert.equal(scope.isActorCookieMutationPending(), true)
    assert.equal(local.has('businessos_oauth_callback_result'), false)
    redirect = JSON.parse(String(init.body)).redirectTo
    return new Response(JSON.stringify({ success: true, url: 'https://accounts.example/authorize' }))
  }) as typeof fetch
  await http.apiFetch('POST', '/api/auth/oauth/start', { mode: 'login', redirectTo: 'https://auth-phase.test/?auth_mode=login&auth_provider=google' })
  const marker = local.get('businessos_read_session')!
  assert.equal(new URL(redirect).searchParams.get('auth_session_intent'), marker)
  assert.equal(scope.isActorCookieMutationPending(), true, 'OAuth start response cannot settle future callback cookie')
  await assert.rejects(http.readActorSessionRecoveryBootstrap())
  // The callback arrives in this same tab after a full-page navigation.
  const returnModule = '../src/api/actorReadScope.ts?oauth-return'
  const reloaded = await import(returnModule)
  assert.equal(reloaded.isActorSessionQuarantined(), true)
  assert.equal(reloaded.finishActorOauthCookieRedirect('old-intent'), false)
  assert.equal(local.get('businessos_read_session'), marker)
  // Execute Login's actual cookie-phase callback block, not a copied handler.
  const login = readFileSync(new URL('../src/components/auth/Login.tsx', import.meta.url), 'utf8')
  const start = login.indexOf("    if (matchingStoredCallback && mode === 'login' && isActorCookieMutationPending())")
  const block = login.slice(start, login.indexOf('    const clearCallbackUrl', start))
  assert.ok(start >= 0 && block.length > 0)
  const code = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const env = { matchingStoredCallback: true, mode: 'login', url: new URL(redirect), ...reloaded }
  new Function('env', `with(env){${code}}`)(env)
  assert.equal(reloaded.isActorCookieMutationPending(), false)
  assert.equal(reloaded.isActorSessionQuarantined(), false)
  assert.equal(session.has('businessos_oauth_cookie_owner'), false)
  const settled = local.get('businessos_read_session')
  scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
  reloaded.completeActorSessionReconciliation(reloaded.actorSessionReconciliationMarker())
  assert.equal(local.get('businessos_read_session'), settled, 'same-account completion in two tabs does not rotate marker and ping-pong')

  for (const outcome of ['network', 'parse']) {
    globalThis.fetch = (async () => {
      assert.equal(scope.isActorCookieMutationPending(), true)
      if (outcome === 'network') throw new TypeError('Network terminated')
      return new Response('not json')
    }) as typeof fetch
    await assert.rejects(http.apiFetch('POST', '/api/auth/otp/verify', {}))
    assert.equal(scope.isActorCookieMutationPending(), false, 'terminal fetch/body error settles cookie phase, not operation success')
    assert.equal(scope.isActorSessionQuarantined(), true, 'unknown cookie actor requires authoritative reconciliation in originating tab too')
    scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
  }
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, url: 'https://accounts.example/link' }))) as typeof fetch
  await http.apiFetch('POST', '/api/auth/oauth/start', { mode: 'link' })
  assert.equal(scope.isActorCookieMutationPending(), false, 'profile link does not establish an account cookie')
  console.log('PASS actual OAuth start/full-page callback owner binding, terminal fetch lifecycle and no cross-tab marker ping-pong')
} finally { globalThis.fetch = originalFetch }
