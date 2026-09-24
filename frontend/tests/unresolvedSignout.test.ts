import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const local = new Map<string, string>([['businessos_user', JSON.stringify({ id: 71 })], ['businessos_draft_A', 'private draft bytes'], ['retained-files', 'original encrypted bytes']])
const session = new Map<string, string>()
const store = (data: Map<string, string>) => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
const events = new EventTarget()
let lockQueue = Promise.resolve()
const locks = { request: (_name: string, _options: unknown, action: () => unknown) => { const task = lockQueue.then(action); lockQueue = task.then(() => undefined, () => undefined); return task } }
Object.assign(globalThis, { window: { location: { origin: 'https://signout.test', hostname: 'signout.test', port: '', pathname: '/pos' }, localStorage: store(local), sessionStorage: store(session), navigator: { locks }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) } })
const scope = await import('../src/api/actorReadScope.ts')
const signout = await import('../src/api/unresolvedSignout.ts')
const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://signout.test')
let actor: number | null = 71
let mode = 'network'
let posts = 0
let businessWrites = 0
let probes = 0
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const path = String(url)
  if (path.endsWith('/api/sync/owner')) {
    probes++
    assert.equal(init?.cache, 'no-store')
    assert.equal(init?.credentials, 'include')
    if (mode === 'offline') throw new TypeError('Failed to fetch')
    if (mode === 'edge401') return new Response('Cloudflare Access', { status: 401 })
    if (mode === 'gateway') return new Response('upstream unavailable', { status: 503 })
    if (actor === null) return new Response(JSON.stringify({ error: 'Not authenticated', code: 'invalid_session' }), { status: 401 })
    return new Response(JSON.stringify({ owner: { actor_id: actor, organization_id: null, authority: 'https://signout.test', runtime: 'cloudflare-workers', version: 1 } }))
  }
  if (path.endsWith('/api/auth/logout')) {
    posts++
    assert.deepEqual(JSON.parse(String(init?.body)), { expected_actor_id: 71, expected_organization_id: null })
    if (mode === 'lost-ack' || mode === 'success') actor = null
    if (mode !== 'success') throw new TypeError('Network terminated')
    return new Response(JSON.stringify({ ok: true }))
  }
  if (path.endsWith('/api/auth/login')) { actor = 72; return new Response(JSON.stringify({ success: true, user: { id: 72 } })) }
  businessWrites++
  return new Response(JSON.stringify({ ok: true }))
}) as typeof fetch

const context = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const callback = context.match(/const logout = useCallback\((async \(\) => \{[\s\S]*?\n  \}), \[user\]\)/)?.[1]
assert.ok(callback)
const dependencies = { ...scope, ...signout, recoverUnresolvedSignout: http.recoverUnresolvedSignout, user: { id: 71 }, flushPendingWorkDrafts() {}, disconnectWS() {} }
const code = ts.transpileModule(`return (${callback});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const logout = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
await logout()
const intent = signout.readSignoutIntent()!
assert.equal(intent.phase, 'pending')
assert.equal(posts, 1)
assert.equal(actor, 71)
assert.equal(scope.isActorCookieMutationPending(), false, 'fetch ended, but sign-out intent must remain')
assert.equal(scope.isActorSessionQuarantined(), true)
assert.equal(scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker()), false)
assert.equal(scope.acknowledgeActorCookieUser({ id: 71 }), false)
assert.throws(() => http.readActorSessionRecoveryBootstrap(), /Sign-out is not yet confirmed/)
for (const [method, path] of [['POST', '/api/products'], ['GET', '/api/auth/bootstrap'], ['POST', '/api/auth/login'], ['POST', '/api/auth/otp/verify'], ['POST', '/api/auth/oauth/start']]) {
  await assert.rejects(http.apiFetch(method, path, {}), /Sign-out is not yet confirmed/)
}
assert.equal(businessWrites, 0)
const reloadPath = '../src/api/unresolvedSignout.ts?reload-d2'
const reload = await import(reloadPath)
assert.equal(reload.isSignoutBlocked(), true, 'fresh runtime reads the durable fence')
assert.equal(reload.readSignoutIntent().token, intent.token)
const bootstrapSource = fs.readFileSync(new URL('../src/api/appBootstrapTransport.ts', import.meta.url), 'utf8')
const bootstrapModule = { exports: {} as { getAppBootstrap?: () => Promise<unknown> } }
const bootstrapCode = ts.transpileModule(bootstrapSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
new Function('require', 'module', 'exports', bootstrapCode)((path: string) => path.includes('actorReadScope') ? scope : path.includes('unresolvedSignout') ? signout : path.includes('constants') ? { STORAGE_KEYS: { USER: 'businessos_user' } } : path.includes('syncRuntime') ? { hasStoredUserSession: () => true } : http, bootstrapModule, bootstrapModule.exports)
let embeddedReads = 0
Object.assign(globalThis, { document: { getElementById: () => { embeddedReads++; return { textContent: JSON.stringify({ user: { id: 71 } }), remove() {} } } } })
await assert.rejects(bootstrapModule.exports.getAppBootstrap!(), /Sign-out is not yet confirmed/)
assert.equal(embeddedReads, 0, 'retained private bootstrap is not consumed while signing out')
const vite = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const early = vite.slice(vite.indexOf('  var signoutFenced ='), vite.indexOf('  // Observe early failure'))
assert.ok(early.length > 0)
let earlyFetches = 0
const quietWindow = { localStorage: store(local), fetch: async () => { earlyFetches++; return new Response('{}') }, __businessOsAuthBootstrapPromise: null }
new Function('window', 'pathname', 'isPublicCatalogPath', 'isLoginPath', 'hasEmbeddedAuthBootstrap', early)(quietWindow, '/pos', () => false, () => false, () => false)
assert.equal(earlyFetches, 0, 'quiet pre-module startup must not fetch the old actor')
const cookiePhase = await scope.beginActorCookieMutation(intent.token)
const priorProbes = probes
await assert.rejects(http.recoverUnresolvedSignout(intent, false))
assert.equal(probes, priorProbes, 'recovery cannot race an unfinished cookie mutation')
scope.finishActorCookieMutation(cookiePhase)
for (mode of ['offline', 'edge401', 'gateway']) {
  await assert.rejects(http.recoverUnresolvedSignout(intent, true))
  assert.equal(signout.readSignoutIntent()?.phase, 'pending')
}
mode = 'network'; actor = 72
const priorPosts = posts
await assert.rejects(http.recoverUnresolvedSignout(intent, true), (error: any) => error.code === 'signout_actor_changed')
assert.equal(posts, priorPosts, 'B must not receive even a logout POST for A')
actor = 71; mode = 'lost-ack'
await http.recoverUnresolvedSignout(intent, true)
assert.equal(signout.readSignoutIntent()?.phase, 'confirmed')
assert.equal(signout.isSignoutBlocked(), true, 'server proof cannot unhide pre-commit old UI')
assert.equal(scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker()), false)
assert.equal(signout.acknowledgeConfirmedSignout(intent.token), true)
assert.equal(scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker()), true)
assert.equal(reload.isSignoutBlocked(), true, 'another runtime must independently hide old UI before acknowledgment')
const login = await http.apiFetch('POST', '/api/auth/login', {})
assert.equal(scope.acknowledgeActorCookieUser(login.user), true)
assert.equal(local.has(signout.SIGNOUT_INTENT_KEY), false, 'explicit new cookie admission consumes only the confirmed tombstone')
assert.equal(local.get('businessos_draft_A'), 'private draft bytes')
assert.equal(local.get('retained-files'), 'original encrypted bytes')
assert.ok(probes >= 5)
actor = 71; mode = 'success'
const normal = signout.beginUnresolvedSignout({ id: 71 })
await http.recoverUnresolvedSignout(normal, true)
assert.equal(signout.readSignoutIntent()?.phase, 'confirmed')
let uiClears = 0
assert.equal(await signout.prepareConfirmedSignoutUi(normal.token, () => { uiClears++ }), true)
assert.equal(uiClears, 1)
local.set(signout.SIGNOUT_INTENT_KEY, JSON.stringify({ ...normal, token: 'newer-intent', phase: 'pending' }))
assert.equal(await signout.prepareConfirmedSignoutUi(normal.token, () => { uiClears++ }), false)
assert.equal(uiClears, 1, 'late auth cleanup cannot touch a newer sign-out/account transition')
await assert.rejects(signout.confirmSignoutIntent(normal.token))
assert.equal(signout.readSignoutIntent()?.token, 'newer-intent')
console.log('PASS actual logout/HTTP lifecycle: failed logout stays fenced, fresh reload blocked, B untouched, exact invalid_session resolves lost ack, drafts retained')

// Transient storage failures must remain safe and recoverable, not strand a
// cookie mutation that never dispatched.
local.delete(signout.SIGNOUT_INTENT_KEY)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
const realStore = window.localStorage
let failReadback = false
Object.assign(window, { localStorage: { ...store(local), setItem(key: string, value: string) { local.set(key, value); if (key === signout.SIGNOUT_INTENT_KEY) failReadback = true }, getItem(key: string) { if (key === signout.SIGNOUT_INTENT_KEY && failReadback) { failReadback = false; throw Error('transient readback') } return local.get(key) ?? null } } })
assert.throws(() => signout.beginUnresolvedSignout({ id: 71 }))
Object.assign(window, { localStorage: realStore })
const recoveredIntent = JSON.parse(local.get(signout.SIGNOUT_INTENT_KEY)!)
assert.equal(signout.assertSignoutIntentCurrent(recoveredIntent.token).token, recoveredIntent.token)
await signout.confirmSignoutIntent(recoveredIntent.token)
signout.acknowledgeConfirmedSignout(recoveredIntent.token)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
Object.assign(window, { localStorage: { ...store(local), removeItem(key: string) { if (key === signout.SIGNOUT_INTENT_KEY) throw Error('remove denied'); local.delete(key) } } })
await assert.rejects(scope.beginActorCookieMutation(), (error: any) => error.code === 'signout_unresolved' && error.outcome === 'not_dispatched')
assert.equal(scope.isActorCookieMutationPending(), false, 'failed admission owns and settles only its new marker')
assert.equal(signout.readSignoutIntent()?.token, recoveredIntent.token)
Object.assign(window, { localStorage: realStore })
const admitted = await scope.beginActorCookieMutation()
scope.finishActorCookieMutation(admitted)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())

// No storage event is delivered: validation itself observes another tab's fence.
const precedingRead = scope.captureActorReadScope()
local.set(signout.SIGNOUT_INTENT_KEY, JSON.stringify({ ...normal, token: 'other-tab', phase: 'pending' }))
assert.equal(scope.isActorReadScopeCurrent(precedingRead), false)
local.delete(signout.SIGNOUT_INTENT_KEY)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())

// Execute the actual OTP callback and actual early-bootstrap transport with
// replies delayed until AFTER server confirmation and user=null acknowledgment.
let resolveOtp!: (value: unknown) => void
let resolveEarly!: (value: unknown) => void
const otpReply = new Promise((resolve) => { resolveOtp = resolve })
const earlyReply = new Promise((resolve) => { resolveEarly = resolve })
Object.assign(globalThis, { document: { getElementById: () => null } })
Object.assign(window, { __businessOsAuthBootstrapPromise: earlyReply })
const pendingEarly = bootstrapModule.exports.getAppBootstrap!()
const otpBlock = context.slice(context.indexOf('    const handleOtpLogin ='), context.indexOf("    window.addEventListener('otp:login'"))
let shownUser: unknown = null
const otpEnv = { ...scope, eventDetail: () => ({ id: 71 }), computeSessionExpiryMs: () => null, persistAuthState() {}, setAuthReady() {}, authEstablishedAtRef: { current: 0 }, readAppBootstrap: () => otpReply, handleUnauthorizedSession() {}, applyBootstrapPayload() { throw Error('stale apply') }, setUser(value: unknown) { shownUser = value }, loadSettings() {}, setPage() {}, settingsRef: { current: {} }, resolveAdminLandingPage: () => 'dashboard' }
const otpCode = ts.transpileModule(otpBlock + '\nreturn handleOtpLogin;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const otpHandler = new Function('env', `with(env){${otpCode}}`)(otpEnv)
const pendingOtp = otpHandler(new Event('otp:login'))
const lateIntent = signout.beginUnresolvedSignout({ id: 71 })
scope.resetActorReadSession()
await signout.confirmSignoutIntent(lateIntent.token)
assert.equal(signout.acknowledgeConfirmedSignout(lateIntent.token), true)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
resolveOtp(null)
resolveEarly({ user: { id: 71 } })
await pendingOtp
await assert.rejects(pendingEarly, (error: any) => error.code === 'stale_read_scope')
assert.equal(shownUser, null, 'late OTP fallback cannot reopen the signed-out actor')
http.setSyncServerUrl('https://different-authority.test')
assert.equal(signout.isSignoutBlocked(), true)
assert.equal(signout.acknowledgeConfirmedSignout(lateIntent.token), false)
assert.equal(await signout.prepareConfirmedSignoutUi(lateIntent.token, () => { throw Error('foreign authority cleanup') }), false)
console.log('PASS transient storage recovery, exact admission rollback, delayed storage event, delayed OTP/bootstrap, and confirmed authority fences')

http.setSyncServerUrl('https://signout.test')
local.delete(signout.SIGNOUT_INTENT_KEY)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
const mountedIntent = signout.beginUnresolvedSignout({ id: 71 })
const effectsBlock = context.slice(context.indexOf('  const reconciledActorRef ='), context.indexOf('  // Sync event listeners'))
const effectsCode = ts.transpileModule(effectsBlock, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let pendingUser: unknown = undefined
let authClears = 0
const accountResets: any[] = []
const mounted: any = { ...scope, ...signout, user: { id: 71 }, publicMode: false, effects: [],
  useRef: (current: unknown) => ({ current }), useEffect: (fn: () => unknown) => mounted.effects.push(fn),
  flushPendingWorkDrafts() {}, disconnectWS() {}, setPage() {}, setAuthReady() {}, applyBootstrapPayload() {},
  recoverUnresolvedSignout: async () => {},
  resetLocalBusinessState: async (options: unknown) => { accountResets.push({ options, userAtReset: pendingUser }) },
  clearPersistedAuthState() { authClears++ }, setUser(value: unknown) { pendingUser = value },
}
new Function('env', `with(env){${effectsCode}}`)(mounted)
// Negative control: an UNRESOLVED sign-out erases nothing.
const cleanupPending = mounted.effects[2]()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(accountResets.length, 0, 'unresolved sign-out must not erase any account data')
assert.equal(authClears, 0)
cleanupPending()
await signout.confirmSignoutIntent(mountedIntent.token)
const cleanupMounted = mounted.effects[2]()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(authClears, 1)
assert.equal(pendingUser, null)
// Confirmed sign-out runs the old logout's account cleanup, before the UI drops
// the actor, while retaining queued offline sales and device settings.
assert.equal(accountResets.length, 1, 'confirmed sign-out must clear the signed-out account state')
assert.deepEqual(accountResets[0].options, { clearAuth: true, preserveSyncServer: true, preserveSessionDuration: true, preserveRuntimeMeta: true, preserveOfflineWork: true })
assert.equal(accountResets[0].userAtReset, undefined, 'cleanup completes under the lock before setUser(null)')
assert.equal(signout.isSignoutBlocked(), true, 'setUser scheduling alone cannot unhide mounted actor')
mounted.effects[0]()
assert.equal(signout.isSignoutBlocked(), true, 'old actor commit cannot acknowledge sign-out')
mounted.user = pendingUser
mounted.effects[0]()
assert.equal(signout.isSignoutBlocked(), false, 'only actual user=null commit releases this runtime')
cleanupMounted()

let recoveryReply!: (value: unknown) => void
let delayedTimer!: () => Promise<void>
let unauthorizedClears = 0
const oldRecovery = new Promise((resolve) => { recoveryReply = resolve })
const recoveryBlock = context.slice(context.indexOf('    const onUnauthorized ='), context.indexOf("    window.addEventListener('sync:update'"))
const recoveryCode = ts.transpileModule(recoveryBlock + '\nreturn onUnauthorized;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const recoveryEnv = { ...scope, disposed: false, user: { id: 71 }, eventDetail: () => ({ error: 'old 401' }), getStoredUserPayload: () => ({ id: 71 }), authRecoveryRef: { current: false }, window: { setTimeout: (fn: () => Promise<void>) => { delayedTimer = fn } }, readAppBootstrap: () => oldRecovery, applyBootstrapPayload() { throw Error('stale recovery apply') }, handleUnauthorizedSession() { unauthorizedClears++ } }
const onUnauthorized = new Function('env', `with(env){${recoveryCode}}`)(recoveryEnv)
onUnauthorized(new Event('auth:unauthorized'))
const pendingRecovery = delayedTimer()
scope.resetActorReadSession()
local.set('businessos_user', JSON.stringify({ id: 72 }))
recoveryReply(null)
await pendingRecovery
assert.equal(unauthorizedClears, 0, 'late A recovery cannot clear B auth after completed sign-out')
console.log('PASS actual mounted commit fence and delayed unauthorized-recovery callback')

// Legitimate bootstrap normalization changes user fields without changing the
// authenticated session. It must still finish login/OTP readiness and routing.
local.delete(signout.SIGNOUT_INTENT_KEY)
scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker())
const authenticated = { id: 71, organizationId: null }
const bootstrapped = { id: 71, organization_id: null, role_name: 'Admin' }
const readyWrites: boolean[] = []
let landing: unknown = null
const happyEnv: any = { ...scope, ...signout, useCallback: (fn: unknown) => fn, eventDetail: () => authenticated,
  computeSessionExpiryMs: () => null, persistAuthState: ({ user }: any) => local.set('businessos_user', JSON.stringify(user)),
  setAuthReady: (value: boolean) => readyWrites.push(value), authEstablishedAtRef: { current: 0 },
  readAppBootstrap: async () => ({ user: bootstrapped }),
  applyBootstrapPayload: async ({ user }: any) => { local.set('businessos_user', JSON.stringify(user)) },
  handleUnauthorizedSession() { throw Error('unexpected unauthorized') }, setUser() {}, loadSettings() {},
  setPage: (value: unknown) => { landing = value }, settingsRef: { current: { default_landing_page: 'products' } }, resolveAdminLandingPage: (value: unknown) => value,
  cacheClearAll() {}, getAppApi: () => ({}), resumeWS() {}, startHealthCheck() {}, safeStorageGet: () => null, getAuthStorage: () => ({}), STORAGE_KEYS: {},
}
const loginBlock = context.slice(context.indexOf('  const persistAuthenticatedUser ='), context.indexOf('  const login = useCallback'))
const loginCode = ts.transpileModule(loginBlock + '\nreturn persistAuthenticatedUser;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const finishLogin = new Function('env', `with(env){${loginCode}}`)(happyEnv)
await finishLogin(authenticated)
assert.deepEqual(readyWrites, [false, true])
assert.equal(landing, 'products')
readyWrites.length = 0; landing = null
const happyOtp = new Function('env', `with(env){${otpCode}}`)(happyEnv)
await happyOtp(new Event('otp:login'))
assert.deepEqual(readyWrites, [false, true])
assert.equal(landing, 'products')
console.log('PASS normal login and OTP finish after canonical bootstrap user-field refresh')
