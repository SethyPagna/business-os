import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as actor from '../src/api/actorReadScope.ts'
import { __resetApiHealthForTests, apiFetch, pingServerHealth, setSyncServerUrl } from '../src/api/http.ts'
import { permissionRefreshIntent } from '../src/utils/permissionRefreshAccumulator.ts'
import { ACTOR_GUARD_KEYS } from '../src/api/branchRefusalLanguage.ts'
import { STOCK_SESSION_FAILURE_KEYS } from '../src/utils/stockSessionDraft.ts'
import { stockFailureText } from '../src/utils/stockAdjustOutcome.ts'
import * as workDrafts from '../src/utils/workDrafts.ts'
import { appStorageResets } from './appPermissionRefresh.ts'

// The Stock Session writes for the owner who opened it: server, origin, user id
// and organization. Every case below runs the REAL authority module in one fake
// tab, so same-user churn (a session reset, a permission/profile/expiry rewrite,
// a reconnect) must continue, and a real owner change must refuse -- with saving
// cleared, a message, and the exits reachable.

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
function extract(text: string, name: string, dependencies: Record<string, any>): any {
  const tree = ts.createSourceFile('source.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.FunctionDeclaration | ts.VariableDeclaration | undefined
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(found, name)
  const declaration = (ts.isVariableDeclaration(found) ? 'const ' : '') + found.getText(tree)
  const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(dependencies), 'exports', `${compiled}; return ${name}`)(...Object.values(dependencies), {})
}
function effectCallback(text: string, marker: string): string {
  const tree = ts.createSourceFile('modal.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes(marker)) callback = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(callback, marker)
  return callback.getText(tree)
}
const http = source('api/http.ts'), transport = source('api/inventoryWriteTransport.ts'), modal = source('components/inventory/FastStockInModal.tsx')

// ---- one fake browser tab ----
const local = new Map<string, string>(), tabSession = new Map<string, string>()
const store = (map: Map<string, string>) => ({
  getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, String(value)) }, removeItem: (key: string) => { map.delete(key) },
  get length() { return map.size }, key: (index: number) => [...map.keys()][index] ?? null,
})
let onSyncUpdate: ((detail: any) => void) | null = null
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: store(local), sessionStorage: store(tabSession), location: { origin: 'https://shop.test', hostname: 'shop.test' },
  addEventListener() {}, removeEventListener() {},
  dispatchEvent: (event: { type?: string; detail?: unknown }) => { if (event?.type === 'sync:update') onSyncUpdate?.(event.detail); return true },
  setTimeout, clearTimeout, setInterval, clearInterval,
} })
const SERVER = 'https://original.example.test'
const OWNER = { id: 7, organization_id: 3, role_id: 2, name: 'Cashier', permissions: ['inventory.adjust'] }
const writeUser = (patch: Record<string, unknown> = {}): void => { local.set('businessos_user', JSON.stringify({ ...OWNER, ...patch })) }
function freshTab() {
  local.clear(); tabSession.clear(); writeUser(); setSyncServerUrl(SERVER); __resetApiHealthForTests()
  actor.resetActorReadSession()
  if (actor.isActorSessionQuarantined()) actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
  assert.equal(actor.isActorSessionQuarantined(), false)
}

// AppContext's own resets (source-read) over the real runtime reset.
const resets = appStorageResets(actor)
// A failed probe then a good one: http.ts's own reconnect refresh and the real
// permission-refresh intent start AppContext's real permission refresh, which
// runs the real runtime reset. 'bootstrap' says whether the bootstrap answered
// (applyBootstrapPayload writes the same account back) or not yet / failed.
async function healthFlap(bootstrap: 'back' | 'not back') {
  const before = actor.captureActorReadScope('inventory')
  const nativeFetch = globalThis.fetch
  const refreshes: Promise<void>[] = []
  onSyncUpdate = (detail) => {
    if (permissionRefreshIntent(detail, { userId: OWNER.id, roleId: OWNER.role_id }) === 'refresh') refreshes.push(resets.permissionRefresh())
  }
  try {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    await pingServerHealth(true)
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch
    await pingServerHealth(true)
  } finally { globalThis.fetch = nativeFetch; onSyncUpdate = null }
  assert(refreshes.length > 0, 'the reconnect really ran the permission refresh')
  await Promise.all(refreshes)
  assert.equal(actor.isActorReadScopeCurrent(before, false), false, 'control: the full read fingerprint moved')
  if (bootstrap === 'back') writeUser({ permissions: ['inventory.adjust', 'refreshed'] })
}
const SAME_USER: Record<string, () => void | Promise<void>> = {
  'session reset': () => actor.resetActorReadSession(),
  'permissions rewrite': () => writeUser({ permissions: ['inventory.adjust', 'products.add'] }),
  'avatar rewrite': () => writeUser({ avatar_path: 'avatar.png' }),
  'expiry rewrite': () => { local.set('businessos_user_expiry', String(Date.now() + 86_400_000)) },
  'health flap, bootstrap back': () => healthFlap('back'),
  'health flap, bootstrap not back or failed': () => healthFlap('not back'),
  // Defence in depth: whatever leaves no stored user for a moment, it is not another account.
  'stored user briefly missing': () => { local.delete('businessos_user'); tabSession.delete('businessos_user') },
}
const REAL_CHANGE: Record<string, () => void | Promise<void>> = {
  'another user': () => writeUser({ id: 8 }),
  'another organization': () => writeUser({ organization_id: 4 }),
  'another server': () => setSyncServerUrl('https://other.example.test'),
  // B is observed by an ordinary read while signed in, then A returns.
  'A to B and back to A': () => { writeUser({ id: 8 }); actor.captureActorReadScope(); writeUser() },
}

let failed = 0
async function check(name: string, action: () => Promise<void> | void) {
  try { freshTab(); await action(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}

await check('the real modules: same-user churn keeps the write identity, a real change refuses it', async () => {
  for (const [name, change] of Object.entries(SAME_USER)) {
    freshTab(); const identity = actor.captureActorWriteIdentity(); await change()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), true, name)
    assert.doesNotThrow(() => actor.assertActorWriteIdentity(identity), name)
  }
  for (const [name, change] of Object.entries(REAL_CHANGE)) {
    freshTab(); const identity = actor.captureActorWriteIdentity(); await change()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), false, name)
    assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_owner_changed', outcome: 'not_dispatched' }, name)
  }
  freshTab(); const identity = actor.captureActorWriteIdentity(), read = actor.captureActorReadScope('inventory')
  actor.invalidateActorReadChannel('inventory')
  assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'cache invalidation is ignored')
  assert.equal(actor.isActorReadScopeCurrent(read, false), true, 'the read fence ignores it too without includeInvalidation')
})

await check('the real permission refresh keeps the stored account and the owner, inside the reset, before the bootstrap and after', async () => {
  const identity = actor.captureActorWriteIdentity()
  let inside: unknown = null
  await resets.permissionRefresh(() => { inside = { stored: local.has('businessos_user'), current: actor.isActorWriteIdentityCurrent(identity) } })
  assert.deepEqual(inside, { stored: true, current: true }, 'inside the reset (W1)')
  assert.equal(local.has('businessos_user'), true, 'the bootstrap has not answered, or failed: the account is still stored (W2)')
  assert.doesNotThrow(() => actor.assertActorWriteIdentity(identity), 'W2: the route checks pass')
  const opened = actor.captureActorWriteIdentity()
  assert.equal(JSON.parse(opened.owner)[2], String(OWNER.id), 'W7: a session opened in that moment is the same account\'s')
  writeUser({ avatar_path: 'fresh.png' })
  assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'W4: the bootstrap wrote the same account back')
  assert.equal(actor.isActorWriteIdentityCurrent(opened), true, 'W7: and the session opened in the gap continues')
  for (const [name, change] of Object.entries(REAL_CHANGE)) {
    freshTab(); const before = actor.captureActorWriteIdentity(); await resets.permissionRefresh(); await change()
    assert.equal(actor.isActorWriteIdentityCurrent(before), false, `${name} after a refresh still refuses`)
  }
  // Another tab signs B in while this tab's refresh is in its async cleanup: the
  // refresh never writes A back over B.
  freshTab(); const held = actor.captureActorWriteIdentity()
  await resets.permissionRefresh(() => writeUser({ id: 8 }))
  assert.equal(JSON.parse(String(local.get('businessos_user'))).id, 8, 'B signed in during the refresh stays stored; A is not restored over it')
  assert.equal(JSON.parse(actor.captureActorWriteIdentity().owner)[2], '8', 'a session opened next is B\'s')
  assert.equal(actor.isActorWriteIdentityCurrent(held), false, 'and A\'s session refuses')
})
await check('sign-out and session expiry still clear the stored account; the runtime refresh keeps it', async () => {
  for (const [name, reset] of [['sign-out', resets.signOut], ['session expiry', resets.sessionExpiry]] as const) {
    freshTab(); await reset(); assert.equal(local.has('businessos_user'), false, name)
  }
  assert.deepEqual([resets.options.permissionRefresh.clearAuth, resets.options.sessionExpiry.clearAuth, resets.options.signOut.clearAuth], [false, true, true])
  // Session expiry forgets the account before clearing it, so a missing user then reads as signed out.
  assert.match(source('AppContext.tsx').replace(/\r\n/g, '\n'), /const handleUnauthorizedSession = useCallback\(async[^\n]*\n\s*if \(isActorSessionQuarantined\(\)\) return\n\s*disconnectWS\(\)\n\s*forgetActorWriteAccount\(\)\n\s*await clearLocalBusinessState\(\{\n\s*clearAuth: true,/)
  // So does another tab's confirmed sign-out, before this tab's account cleanup.
  assert.match(source('AppContext.tsx').replace(/\r\n/g, '\n'), /prepareConfirmedSignoutUi\(signout\.token, async \(\) => \{\n(?:\s*\/\/[^\n]*\n)*\s*forgetActorWriteAccount\(\)\n\s*await resetLocalBusinessState\(\{\n\s*clearAuth: true,/)
})
await check('no stored user is the last account, unless the session is locked, a sign-in is pending or the session expired', async () => {
  const missing = () => { local.delete('businessos_user'); tabSession.delete('businessos_user') }
  let identity = actor.captureActorWriteIdentity(); missing()
  assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'a moment with no stored user is the same account')
  writeUser({ id: 8 }); assert.equal(actor.isActorWriteIdentityCurrent(identity), false, 'the next account written decides')
  writeUser(); assert.equal(actor.isActorWriteIdentityCurrent(identity), false, 'A -> B -> A through the gap still refuses')
  freshTab(); identity = actor.captureActorWriteIdentity(); missing(); setSyncServerUrl('https://other.example.test')
  assert.equal(actor.isActorWriteIdentityCurrent(identity), false, 'another server during the gap refuses'); setSyncServerUrl(SERVER)
  freshTab(); identity = actor.captureActorWriteIdentity(); missing(); local.set('businessos_read_session', 'another-tab-signed-in')
  assert.equal(actor.isActorWriteIdentityCurrent(identity, true), false, 'locked: no stored user is not assumed to be anyone')
  freshTab(); identity = actor.captureActorWriteIdentity(); missing(); local.set('businessos_auth_cookie_pending', 'auth-pending:fixture')
  assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_session_quarantined' }, 'a sign-in pending')
  local.delete('businessos_auth_cookie_pending')
  freshTab(); identity = actor.captureActorWriteIdentity()
  const tab = (globalThis as unknown as { window: Record<string, unknown> }).window
  tab.navigator = globalThis.navigator
  try {
    const marker = await actor.beginActorCookieMutation()
    missing()
    assert.equal(actor.isActorWriteIdentityCurrent(identity, true), false, 'a sign-in or sign-out in this tab: no stored user is nobody')
    assert.equal(actor.finishActorCookieMutation(marker), true)
    assert.equal(actor.isActorWriteIdentityCurrent(identity, true), false, 'and stays nobody once that phase settles')
    writeUser(); assert.equal(actor.isActorWriteIdentityCurrent(identity, true), true, 'the same account signing in continues')
  } finally { delete tab.navigator }
  freshTab(); identity = actor.captureActorWriteIdentity(); actor.forgetActorWriteAccount(); missing()
  assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_owner_changed' }, 'expired: signed out')
  writeUser(); assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'the same account signing back in continues')
})
await check('a forgotten account stays forgotten until a sign-in is confirmed, even if read while still stored', async () => {
  const missing = () => { local.delete('businessos_user'); tabSession.delete('businessos_user') }
  const read = () => { actor.actorWriteAccount(); actor.captureActorWriteIdentity() }
  const tab = (globalThis as unknown as { window: Record<string, unknown> }).window
  tab.navigator = globalThis.navigator
  try {
    // A sign-out in this tab: reads while A is still stored do not bring A back.
    freshTab(); let identity = actor.captureActorWriteIdentity()
    const signout = await actor.beginActorCookieMutation()
    read(); assert.equal(actor.isActorWriteIdentityCurrent(identity, true), true, 'A still stored during the sign-out')
    missing(); assert.equal(actor.finishActorCookieMutation(signout), true); read()
    assert.equal(actor.isActorWriteIdentityCurrent(identity, true), false, 'signed out: no stored user is nobody')
    // Session expiry: a read before the account is cleared does not bring it back.
    freshTab(); identity = actor.captureActorWriteIdentity(); actor.forgetActorWriteAccount(); read(); missing(); read()
    assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_owner_changed' }, 'expired: still signed out')
    // Another tab's confirmed sign-out: reconciling with no stored user confirms nobody.
    const peerChange = (marker: string) => { local.set('businessos_read_session', marker); assert.equal(actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker()), true) }
    freshTab(); identity = actor.captureActorWriteIdentity(); actor.forgetActorWriteAccount(); missing(); peerChange('peer-signed-out')
    writeUser(); read(); missing(); read()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), false, 'an account stored after a sign-out is not remembered until a sign-in is confirmed')
    // Released by a confirmed sign-in: another tab's, reconciled with its account stored ...
    writeUser(); peerChange('peer-signed-in'); read(); missing()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'a reconciled sign-in: a missing user is that account again')
    // ... or this tab's own, acknowledged.
    freshTab(); identity = actor.captureActorWriteIdentity()
    const signin = await actor.beginActorCookieMutation(), signedIn = { ...OWNER }
    assert.equal(actor.finishActorCookieMutation(signin, true, signedIn), true)
    assert.equal(actor.acknowledgeActorCookieUser(signedIn), true)
    read(); missing()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'an acknowledged sign-in: a missing user is that account again')
    // ... or a Google sign-in returning to this tab.
    freshTab(); identity = actor.captureActorWriteIdentity()
    const oauth = await actor.beginActorCookieMutation()
    actor.prepareActorOauthCookieRedirect(oauth, 'https://shop.test/')
    assert.equal(actor.finishActorOauthCookieRedirect(oauth), true)
    read(); missing()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'a returned Google sign-in: a missing user is that account again')
  } finally { delete tab.navigator }
  freshTab()
})
await check('a login-duration change keeps the account; a sign-out through the same transport still forgets it', async () => {
  const missing = () => { local.delete('businessos_user'); tabSession.delete('businessos_user') }
  const tab = (globalThis as unknown as { window: Record<string, unknown> }).window
  const nativeFetch = globalThis.fetch
  const sent: string[] = []
  tab.navigator = globalThis.navigator
  globalThis.fetch = (async (url: unknown) => {
    sent.push(new URL(String(url)).pathname)
    assert.equal(actor.isActorCookieMutationPending(), true, 'the request runs inside a cookie phase')
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    // Opus Q2 / K3: the duration change re-issues the same account's cookie.
    freshTab(); let identity = actor.captureActorWriteIdentity()
    await apiFetch('POST', '/api/auth/session-duration', { sessionDuration: '7d' })
    assert.equal(actor.isActorCookieMutationPending(), false)
    missing()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'after a login-duration change a missing user is still the same account')
    assert.doesNotThrow(() => actor.assertActorWriteIdentity(identity), 'no false "account changed"')
    // Control: a sign-out over the same transport forgets.
    freshTab(); identity = actor.captureActorWriteIdentity()
    await apiFetch('POST', '/api/auth/logout', {})
    missing()
    assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_owner_changed' }, 'after a sign-out a missing user is nobody')
    assert.deepEqual(sent, ['/api/auth/session-duration', '/api/auth/logout'])
  } finally { globalThis.fetch = nativeFetch; delete tab.navigator }
  freshTab()
})
await check('another tab signing in locks the identity, and the same owner confirmed again releases it', () => {
  const identity = actor.captureActorWriteIdentity()
  local.set('businessos_read_session', 'another-tab-signed-in')
  assert.equal(actor.isActorWriteIdentityCurrent(identity), false, 'locked while the change is checked')
  assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_session_quarantined' })
  assert.equal(actor.isActorWriteIdentityCurrent(identity, true), true, 'the owner itself did not change')
  assert.equal(actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker()), true)
  assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'the same owner continues once confirmed')
})

// ---- the transport: route() + commitFastStockIn extracted from source, real authority ----
function transportFixture(mode: 'normal' | 'late-success' | 'late-404' | 'fresh-404' | 'settlement-switch' | 'before-dispatch', change: () => void | Promise<void>) {
  const calls: string[][] = [], settled: number[][] = [], invalidations: string[] = [], events: unknown[] = [], answered: unknown[] = []
  const route = extract(http, 'route', {
    ...actor, getSyncServerUrl: () => 'https://fixture.invalid',
    getReadServerBaseUrl: () => 'https://fixture.invalid', hasStoredAuthSession: () => true, getSameOriginApiBaseUrl: () => '',
    throwIfRequestAborted() {}, _serverOnline: true, cacheInvalidateWithDerived: (key: string) => invalidations.push(key),
    setServerHealth() {}, logCall() {}, isConnectivityError: () => false, isWriteConflictError: () => false,
    isInvalidSessionError: () => false, createSyncErrorId: () => 'event', window: { dispatchEvent: (event: unknown) => events.push(event) },
  })
  const isDeferredStockInResult = extract(transport, 'isDeferredStockInResult', {})
  const commitStockInLinesInRounds = extract(transport, 'commitStockInLinesInRounds', { isDeferredStockInResult })
  const commit = extract(transport, 'commitFastStockIn', {
    ...actor, receiveBatchWireBody: (body: unknown) => body, getDevicePayload: () => ({}), commitStockInLinesInRounds,
    route: async (...args: unknown[]) => { if (mode === 'before-dispatch' && !calls.length) await change(); return route(...args) },
    fastStockInCommitPayload: extract(transport, 'fastStockInCommitPayload', {}),
    apiFetch: async (_method: string, _url: string, body: any) => {
      calls.push(body.lines.map((line: any) => line.key))
      if (mode === 'late-success' || mode === 'late-404') await change()
      if (mode === 'late-404' || mode === 'fresh-404') throw Object.assign(new Error('No route'), { status: 404 })
      return { results: body.lines.map((line: any, index: number) => index === 0 ? { key: line.key, ok: true } : { key: line.key, ok: false, code: 'deferred' }) }
    },
  })
  const lines = ['existing', 'new'].map(key => ({ key, wire: 'receive', body: { productId: key === 'existing' ? 1 : 2 } }))
  const run = (writeIdentity?: unknown) => commit(lines, async (rows: any[]) => {
    settled.push(rows.map(row => row.index))
    if (mode === 'settlement-switch') await change()
  }, { ...(writeIdentity ? { writeIdentity } : {}), onAnsweredAfterOwnerChange: (rows: unknown) => answered.push(rows) })
  return { calls, settled, invalidations, events, answered, run }
}
const refused = (error: any) => ['actor_owner_changed', 'actor_session_quarantined'].includes(error.code)

await check('original owner completes deferred rounds once and retains result order', async () => {
  const f = transportFixture('normal', () => {}), results = await f.run()
  assert.deepEqual(f.calls, [['existing', 'new'], ['new']]); assert(results.every((row: any) => row.ok))
  assert.deepEqual(f.settled, [[0], [1]])
})
for (const [name, change] of Object.entries(REAL_CHANGE)) {
  for (const mode of ['late-success', 'late-404', 'before-dispatch'] as const) {
    await check(`${name}, ${mode}: the stale operation cannot publish or select the old-Worker fallback`, async () => {
      const f = transportFixture(mode, change)
      await assert.rejects(f.run(), refused)
      assert.equal(f.calls.length, mode === 'before-dispatch' ? 0 : 1)
      assert.deepEqual(f.settled, []); assert.deepEqual(f.invalidations, []); assert.deepEqual(f.events, [])
      // F2: the server's answer for the original owner is handed over to be kept, never settled or shown.
      assert.deepEqual(f.answered, mode === 'late-success'
        ? [[{ key: 'existing', result: { key: 'existing', ok: true } }, { key: 'new', result: { key: 'new', ok: false, code: 'deferred' } }]]
        : [])
    })
  }
}
for (const [name, change] of Object.entries(SAME_USER)) {
  await check(`${name}, late success and late 404: the same owner's rounds continue`, async () => {
    const f = transportFixture('late-success', change), results = await f.run()
    assert.deepEqual(f.calls, [['existing', 'new'], ['new']]); assert(results.every((row: any) => row.ok)); assert.deepEqual(f.settled, [[0], [1]])
    assert.deepEqual(f.answered, [], 'the same owner settles normally')
    freshTab()
    const fallback = transportFixture('late-404', change)
    assert.equal(await fallback.run(), null, 'the old-Worker fallback stays available to the same owner')
  })
}
await check('original current 404 retains legacy fallback', async () => {
  const f = transportFixture('fresh-404', () => {}); assert.equal(await f.run(), null); assert.equal(f.calls.length, 1)
})
await check('an owner change during settlement cannot send another deferred round', async () => {
  const f = transportFixture('settlement-switch', REAL_CHANGE['another user']), results = await f.run().catch((error: any) => error)
  assert.deepEqual(f.calls, [['existing', 'new']])
  assert(Array.isArray(results) ? results[1].ok === false : refused(results))
})
await check('an identity captured before product preparation is not recaptured at stock entry', async () => {
  const f = transportFixture('normal', () => {}), owner = actor.captureActorWriteIdentity(); writeUser({ id: 8 })
  await assert.rejects(f.run(owner), refused); assert.deepEqual(f.calls, [])
})

// ---- the modal: performCommit and friends extracted from source, real authority ----
function modalFixture(boundary: string, change: () => void | Promise<void>) {
  const receivingIdentity = actor.captureActorWriteIdentity()
  const effects: Array<{ name: string; current: boolean }> = [], requests: number[] = [], drafts: Array<{ current: boolean; lines: any[] }> = [], screens: Array<{ current: boolean; lines: any[] }> = []
  const effect = (name: string) => effects.push({ name, current: actor.isActorWriteIdentityCurrent(receivingIdentity) })
  let saving = false, switched = false
  const received = [1, 2].map(id => ({ key: String(id), product: { id }, mode: 'add', status: 'queued', quantity: 1, freeQuantity: 0, createPayload: boundary.startsWith('create') && id === 1 ? { name: 'New' } : null }))
  const tr = (_key: string, fallback: string) => fallback
  const dependencies: Record<string, any> = {
    isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, saving: false, received, branchId: '1', canEditCosts: true, canViewCosts: true,
    paidAmount: '', paymentStatus: 'paid', creditDueDate: '', submissionsRef: { current: {} },
    refuseDestination: () => false, lineNeedsCreate: (line: any) => !!line.createPayload,
    setSaving: (value: boolean) => { saving = value; effect(`saving:${value}`) }, setSignInChanged: (value: boolean) => effect(`sign-in-changed:${value}`),
    setReceived: (lines: any[] = []) => {
      effect('received')
      screens.push({ current: actor.isActorWriteIdentityCurrent(receivingIdentity), lines: structuredClone(lines) })
      // Between two old-Worker sends: the next line must be checked before it goes out.
      if (boundary === 'fallback-between' && !switched && lines.some(line => line.status === 'saved')) { switched = true; void change() }
    },
    setCreatedProductIds: () => effect('created-ids'),
    setStep: () => effect('step'), notify: () => effect('notify'), tr,
    finishSession: () => effect('finish'), onDone: () => effect('done'),
    persistSessionDraft: (lines: any[] = []) => { drafts.push({ current: actor.isActorWriteIdentityCurrent(receivingIdentity), lines: structuredClone(lines) }); effect('draft') },
    persistSubmissionDraft: () => effect('submission'),
    applyLineOutcome: (lines: any[], key: string, patch: any) => lines.map(line => line.key === key ? { ...line, ...patch } : line),
    createHeldProduct: async () => { await change(); if (boundary.endsWith('error')) throw Error('Late create failure'); return 72 }, failureText: () => 'Failed', stockLineNeedsRemoval: () => false,
    describeLineResult: () => 'Received', commitSessionBlock: () => ({}), captureReceivingRequest() {},
    buildLineRequest: (line: any) => ({ key: line.key, wire: 'receive', body: { productId: line.product.id } }),
    isDeferredStockInResult: () => false,
    commitFastStockIn: async (_lines: unknown, settled: (rows: unknown[]) => void, options: any) => {
      if (boundary === 'round-settle') {
        await change()
        settled([{ index: 0, result: { ok: true } }, { index: 1, result: { ok: true } }])
        return [{ ok: true }, { ok: true }]
      }
      if (boundary.startsWith('commit')) {
        await change()
        if (boundary.endsWith('error')) throw Error('Late commit failure')
        if (!actor.isActorWriteIdentityCurrent(options.writeIdentity)) {
          // What the real transport hands over when the server answered the original owner (transport cases above).
          options.onAnsweredAfterOwnerChange?.([{ key: '1', result: { ok: true } }, { key: '2', result: { ok: false, code: 'deferred' } }])
          throw Object.assign(new Error('The signed-in account changed'), { code: 'actor_owner_changed' })
        }
      }
      return boundary.startsWith('fallback') ? null : []
    },
    receiveBatchStock: async (body: any) => {
      requests.push(body.productId)
      if (boundary !== 'fallback-between') await change()
      if (boundary.endsWith('error')) throw Error('Late fallback failure')
      return { success: true }
    },
    adjustStock: () => { throw new Error('unexpected adjustment') },
  }
  dependencies.ownerChangedText = extract(modal, 'ownerChangedText', { tr })
  dependencies.assertReceivingOwner = extract(modal, 'assertReceivingOwner', dependencies)
  dependencies.stopForSignInChange = extract(modal, 'stopForSignInChange', dependencies)
  dependencies.performCommitSequential = extract(modal, 'performCommitSequential', dependencies)
  const performCommit = extract(modal, 'performCommit', dependencies)
  const perform = async () => { if (boundary === 'before') await change(); await performCommit() }
  return { perform, effects, requests, drafts, screens, saving: () => saving, receivingIdentity }
}
const exits = (saving: boolean, receivingIdentity: unknown) => {
  const reached: string[] = []
  const closeGuard = { requestClose: () => reached.push('close'), promptOpen: false }
  extract(modal, 'requestCloseIfIdle', { saving, closeGuard })()
  extract(modal, 'preserveAndMinimize', {
    saving, onMinimize: () => reached.push('minimize'), flushPendingWorkDraft() {}, writeWorkDraft() {}, currentDraft: () => ({}), fastStockInDraftKey: 'pinned-owner-key', sessionLabel: 'Add Session',
    onClose: () => reached.push('closed'), notify: (message: string) => reached.push(`notice:${message.slice(0, 7)}`),
    tr: (_key: string, fallback: string) => fallback, isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity,
  })()
  let onKey: ((event: unknown) => void) | undefined
  extract(`const listen = ${effectCallback(modal, 'onEscape')}`, 'listen', {
    saving, selectedGroup: null, reasonsOpen: false, closeGuard: { ...closeGuard, requestClose: () => reached.push('escape') },
    parentPanelRef: { current: null }, Element: class {}, window: { addEventListener: (_type: string, handler: any) => { onKey = handler }, removeEventListener() {} },
  })()
  assert(onKey)
  onKey({ key: 'Escape', defaultPrevented: false, target: null, preventDefault() {} })
  return reached
}

const SAME_USER_BOUNDARIES = ['before', 'create', 'commit', 'round-settle', 'fallback']
for (const [name, change] of Object.entries(SAME_USER)) {
  for (const boundary of SAME_USER_BOUNDARIES) {
    await check(`actual modal, ${name} at ${boundary}: the same owner's session continues and completes`, async () => {
      const f = modalFixture(boundary, change); await f.perform()
      const names = f.effects.map(effect => effect.name)
      assert.deepEqual(f.effects.filter(effect => !effect.current), [], 'nothing ran under a refused identity')
      assert(names.includes('finish'), names.join(','))
      assert.equal(names.some(entry => entry.startsWith('sign-in-changed')), false)
      assert.equal(f.saving(), false)
      if (boundary === 'fallback') assert.deepEqual(f.requests, [1, 2])
    })
  }
}
// The owner really changed: nothing is applied or shown, saving clears, the message shows. F2: what the
// server already confirmed for the original owner is written to that owner's pinned draft, and nothing else.
const STOP = new Set(['saving:false', 'sign-in-changed:true'])
const KEPT: Record<string, (lines: any[]) => void> = {
  create: (lines) => assert.deepEqual(lines.map(line => [line.key, line.product.id, line.status]), [['1', 72, 'queued'], ['2', 2, 'queued']], 'the created product keeps its id'),
  commit: (lines) => assert.deepEqual(lines.map(line => [line.key, line.status]), [['1', 'saved'], ['2', 'saving']], 'only the confirmed line is saved'),
  fallback: (lines) => assert.deepEqual(lines.map(line => [line.key, line.status]), [['1', 'saved'], ['2', 'saving']], 'the line sent before the change is saved'),
}
const SHOWN: Record<string, string[][]> = { commit: [['1', 'saved'], ['2', 'queued']], fallback: [['1', 'saved'], ['2', 'queued']] }
for (const [name, change] of Object.entries(REAL_CHANGE)) {
  for (const boundary of ['before', 'create', 'create-error', 'commit', 'commit-error', 'fallback', 'fallback-error', 'fallback-between', 'round-settle']) {
    await check(`actual modal, ${name} at ${boundary}: applies nothing, clears saving and says how to continue`, async () => {
      const f = modalFixture(boundary, change); await f.perform()
      const stale = f.effects.filter(effect => !effect.current).map(effect => effect.name)
      const staleDrafts = f.drafts.filter(draft => !draft.current)
      if (KEPT[boundary]) { assert.equal(staleDrafts.length, 1, 'kept once'); KEPT[boundary](staleDrafts[0].lines) }
      else assert.deepEqual(staleDrafts, [], 'nothing unconfirmed is written')
      // N1: after a started commit the screen shows what the server confirmed, so Complete never resends it.
      assert.deepEqual(new Set(stale), new Set([...STOP, ...(KEPT[boundary] ? ['draft'] : []), ...(boundary === 'before' ? [] : ['received'])]), stale.join(','))
      if (SHOWN[boundary]) assert.deepEqual(f.screens.filter(screen => !screen.current).at(-1)?.lines.map((line: any) => [line.key, line.status]), SHOWN[boundary], 'the screen')
      assert.equal(f.saving(), false, 'saving is cleared, so close and minimize work')
      assert.equal(f.effects.some(effect => effect.name === 'finish'), false)
      if (boundary.startsWith('fallback')) assert.deepEqual(f.requests, [1])
    })
  }
}
for (const boundary of ['create', 'commit', 'fallback', 'round-settle']) {
  await check(`actual modal, another user at ${boundary}: close, Escape and minimize stay reachable and minimize tells the truth`, async () => {
    const f = modalFixture(boundary, REAL_CHANGE['another user']); await f.perform()
    assert.deepEqual(exits(f.saving(), f.receivingIdentity), ['close', 'notice:Closed.', 'closed', 'escape'], 'no chip for the new owner, no "nothing was lost"')
  })
}
await check('positive control: the same owner after a reset minimizes to the chip as before', async () => {
  const f = modalFixture('commit', SAME_USER['session reset']); await f.perform()
  assert.deepEqual(exits(f.saving(), f.receivingIdentity), ['close', 'minimize', 'closed', 'escape'])
})
await check('direct finish callback: the same owner finishes; another owner keeps the draft and gets the message', () => {
  const receivingIdentity = actor.captureActorWriteIdentity(), effects: string[] = []
  const finish = extract(modal, 'finishSession', { isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, stopForSignInChange: () => effects.push('sign-in-changed'), onDone: () => effects.push('done'), clearWorkDraft: () => effects.push('clear'), fastStockInDraftKey: 'old-owner', onClose: () => effects.push('close') })
  actor.resetActorReadSession(); finish(); assert.deepEqual(effects, ['done', 'clear', 'close'], 'a session reset still finishes')
  effects.length = 0
  writeUser({ id: 8 }); finish(); assert.deepEqual(effects, ['sign-in-changed'])
})
await check('modal keeps the identity and draft key it opened with across a new-owner render', () => {
  let identitySlot: unknown, keyRef: unknown, ownerKey = 'owner-one'
  const useState = (init: () => unknown) => [identitySlot ??= init()]
  const tree = ts.createSourceFile('modal.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let statement = ''
  const visit = (node: ts.Node) => { if (ts.isVariableStatement(node) && node.getText(tree).includes('useState(captureActorWriteIdentity)')) statement = node.getText(tree); ts.forEachChild(node, visit) }
  visit(tree); assert(statement)
  const currentIdentity = () => new Function('useState', 'captureActorWriteIdentity', `${statement}; return receivingIdentity`)(useState, actor.captureActorWriteIdentity)
  const currentKey = () => extract(modal, 'fastStockInDraftKey', { scopedWorkDraftKey: () => ownerKey, useRef: (value: unknown) => ({ current: keyRef ??= value }) })
  const originalIdentity = currentIdentity(), originalKey = currentKey()
  writeUser({ id: 8 }); ownerKey = 'owner-two'
  assert.equal(currentIdentity(), originalIdentity); assert.equal(currentKey(), originalKey)
  assert.equal(actor.isActorWriteIdentityCurrent(originalIdentity as actor.ActorWriteIdentity), false)
})
await check('autosave: the same owner keeps saving through churn; another owner is not saved and is told', async () => {
  const receivingIdentity = actor.captureActorWriteIdentity(), writes: unknown[] = [], flags: boolean[] = []
  const run = extract(`const run = ${effectCallback(modal, 'scheduleWorkDraftWrite')}`, 'run', {
    isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
    scheduleWorkDraftWrite: (...args: unknown[]) => { writes.push(args); return () => {} }, fastStockInDraftKey: 'old-owner', currentDraft: () => ({ lines: ['original'] }),
    autosaveCancelRef: { current: () => {} },
  })
  run(); await healthFlap('not back'); actor.resetActorReadSession(); writeUser({ avatar_path: 'a.png' }); run()
  assert.equal(writes.length, 2, 'churn keeps the autosave going'); assert.deepEqual(flags, [false, false])
  writeUser({ id: 8 }); run()
  assert.equal(writes.length, 2, 'nothing is saved under another owner')
  assert.deepEqual(flags, [false, false, true], 'and the message shows instead of silently not saving')
})
await check('a locked session shows the message, and the same owner confirmed again clears it', async () => {
  const receivingIdentity = actor.captureActorWriteIdentity(), flags: boolean[] = []
  const subscribe = extract(`const subscribe = ${effectCallback(modal, 'subscribeActorSessionQuarantine')}`, 'subscribe', {
    subscribeActorSessionQuarantine: actor.subscribeActorSessionQuarantine, isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent,
    receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
  })
  const unsubscribe = subscribe()
  try {
    local.set('businessos_read_session', 'another-tab-signed-in'); actor.isActorSessionQuarantined()
    assert.deepEqual(flags, [], 'never set inside the notifying call (it may run inside another component render)')
    await Promise.resolve(); assert.deepEqual(flags, [true])
    actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
    await Promise.resolve(); assert.deepEqual(flags, [true, false])
  } finally { unsubscribe() }
})
await check('the message is inline and translated, Complete waits while it shows, and the header exits stay on', () => {
  const en = JSON.parse(source('lang/en.json')), km = JSON.parse(source('lang/km.json'))
  for (const key of ['stock_session_sign_in_changed', 'stock_session_kept_for_owner']) {
    assert(String(km[key] || '').includes('វគ្គ'), `${key}: Khmer names the session`)
    assert.notEqual(km[key], en[key])
  }
  const flat = modal.replace(/\r\n/g, '\n')
  assert(flat.includes(`tr('stock_session_sign_in_changed', ${JSON.stringify(en.stock_session_sign_in_changed).replace(/^"|"$/g, "'")})`), 'the fallback is the pack English')
  assert(flat.includes(`tr('stock_session_kept_for_owner', ${JSON.stringify(en.stock_session_kept_for_owner).replace(/^"|"$/g, "'")})`), 'the fallback is the pack English')
  assert.match(flat, /\{ownerDiffers \? <p role="alert"[^>]*>\{ownerChangedText\(\)\}<\/p> : null\}\s*<StockSessionFooter/)
  assert.match(flat, /primaryDisabled=\{footerDisabled \|\| ownerDiffers\}/)
  assert.match(flat, /const ownerDiffers = signInChanged && !isActorWriteIdentityCurrent\(receivingIdentity\)\n/, 'they follow the owner itself')
  assert.match(flat, /<StockSessionHeader[\s\S]*?disabled=\{busy\}[\s\S]*?onClose=\{requestCloseIfIdle\}/, 'close and minimize follow saving alone')
  assert.match(flat, /const busy = saving\n/)
  assert.match(flat, /const editLocked = busy \|\| ownerDiffers\n/, 'edits that would no longer be saved are locked')
  for (const surface of ['StockSessionSharedDetails', 'StockSessionLineEntry', 'StockSessionItems', 'StockSessionPaymentStep']) {
    assert.match(flat, new RegExp(`<${surface}[\\s\\S]*?(?:busy|disabled)=\\{editLocked(?: \\|\\| detailsLocked)?\\}`), surface)
  }
  assert.match(flat, /<StockSessionSteps [^\n]*disabled=\{editLocked\}/)
})
await check('F4: an owner change while the product attempt registers cannot hold the product; churn can', async () => {
  const run = async (change: () => void | Promise<void>) => {
    freshTab()
    const receivingIdentity = actor.captureActorWriteIdentity(), applied: unknown[] = [], flags: boolean[] = []
    const tr = (_key: string, fallback: string) => fallback
    const dependencies: Record<string, any> = {
      isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
      omitUnauthorizedCatalogCosts: (value: unknown) => value, user: { id: 7 }, onPrepareProduct: async (value: unknown) => value,
      createClientRequestId: () => 'product-1', registerReceivingProductAttempt: async () => { await change() },
      stockFailureText: () => 'Failed', tr, priceText: (value: unknown) => String(value ?? ''),
      applyEntry: (entry: unknown) => applied.push(entry), setBatchChoice: () => applied.push('batch'), setSupplier: () => applied.push('supplier'),
      supplier: { supplierName: '' }, brand: '', canReceive: true, canViewCosts: true,
    }
    dependencies.ownerChangedText = extract(modal, 'ownerChangedText', { tr })
    dependencies.assertReceivingOwner = extract(modal, 'assertReceivingOwner', dependencies)
    const hold = extract(modal, 'holdNewProduct', dependencies)
    return { promise: hold({ name: 'New' }), applied, flags }
  }
  const control = await run(() => {}); await control.promise
  assert.equal(control.applied.length, 2, 'positive control: the current owner holds the product')
  const churn = await run(SAME_USER['session reset']); await churn.promise
  assert.equal(churn.applied.length, 2, 'a session reset does not block holding the product')
  const fenced = await run(REAL_CHANGE['another user'])
  await assert.rejects(fenced.promise, (error: any) => error.code === 'actor_owner_changed' && /signed-in account changed/.test(error.message))
  assert.deepEqual(fenced.applied, []); assert.deepEqual(fenced.flags, [true])
})

// ---- the receiving create: productWriteTransport.createProduct over the real route() ----
const products = source('api/productWriteTransport.ts')
function createFixture(mode: 'mid-request' | 'before-dispatch', change: () => void | Promise<void>) {
  const sent: unknown[] = []
  const route = extract(http, 'route', {
    ...actor, getSyncServerUrl: () => 'https://fixture.invalid',
    getReadServerBaseUrl: () => 'https://fixture.invalid', hasStoredAuthSession: () => true, getSameOriginApiBaseUrl: () => '',
    throwIfRequestAborted() {}, _serverOnline: true, cacheInvalidateWithDerived() {}, setServerHealth() {}, logCall() {},
    isConnectivityError: () => false, isWriteConflictError: () => false, isInvalidSessionError: () => false,
    createSyncErrorId: () => 'event', window: { dispatchEvent: () => true },
  })
  const createProduct = extract(products, 'createProduct', {
    ...actor, ensureClientRequestId: (body: unknown) => body, getDevicePayload: () => ({}),
    route: async (...args: unknown[]) => { if (mode === 'before-dispatch') await change(); return route(...args) },
    apiFetch: async (_method: string, _url: string, body: unknown) => { sent.push(body); if (mode === 'mid-request') await change(); return { id: 72 } },
  })
  return { sent, createProduct }
}
await check('the receiving create keeps a confirmed product through same-user churn; a real change refuses it', async () => {
  for (const [name, change] of Object.entries(SAME_USER)) {
    freshTab()
    const f = createFixture('mid-request', change)
    assert.deepEqual(await f.createProduct({ name: 'New' }, undefined, actor.captureActorWriteIdentity()), { id: 72 }, name)
    freshTab()
    const control = createFixture('mid-request', change)
    // An avatar or expiry rewrite of the same account is not a read-fence change (login refresh, 14 Oct).
    if (name === 'avatar rewrite' || name === 'expiry rewrite') assert.deepEqual(await control.createProduct({ name: 'New' }), { id: 72 }, name)
    else await assert.rejects(control.createProduct({ name: 'New' }), { code: 'stale_read_scope' }, `${name}: every other caller keeps the read fence`)
  }
  for (const [name, change] of Object.entries(REAL_CHANGE)) {
    freshTab()
    const late = createFixture('mid-request', change)
    await assert.rejects(late.createProduct({ name: 'New' }, undefined, actor.captureActorWriteIdentity()),
      (error: any) => error.code === 'actor_owner_changed' && error.outcome === 'unknown' && error.confirmedResult?.id === 72, name)
    freshTab()
    const early = createFixture('before-dispatch', change)
    await assert.rejects(early.createProduct({ name: 'New' }, undefined, actor.captureActorWriteIdentity()), { code: 'actor_owner_changed' }, name)
    assert.deepEqual(early.sent, [], `${name}: nothing was sent`)
  }
})

await check('the receiving flow says the sign-in guards in the UI language', async () => {
  const km = JSON.parse(source('lang/km.json')) as Record<string, string>
  const tr = (key: string, fallback: string) => km[key] ?? fallback
  const actorGuardText = extract(modal, 'actorGuardText', { ACTOR_GUARD_KEYS, tr })
  const failureText = extract(modal, 'failureText', { STOCK_SESSION_FAILURE_KEYS, actorGuardText, stockFailureText, tr })
  for (const code of Object.keys(ACTOR_GUARD_KEYS)) {
    assert.ok(km[code], `${code} is in the Khmer pack`)
    assert.equal(failureText(Object.assign(new Error('English sentence'), { code }), 'Error'), km[code], code)
  }
  assert.equal(failureText(Object.assign(new Error('Another refusal'), { code: 'other' }), 'Error'), 'Another refusal', 'control: other refusals are unchanged')
  // Holding a new product: an image upload refused mid-preparation, and the attempt registration refused.
  for (const [step, code] of [['prepare', 'stale_read_scope'], ['register', 'actor_session_quarantined']] as const) {
    freshTab()
    const refusal = Object.assign(new Error('English sentence'), { code, name: 'AbortError' })
    const dependencies: Record<string, any> = {
      isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity: actor.captureActorWriteIdentity(), setSignInChanged() {},
      omitUnauthorizedCatalogCosts: (value: unknown) => value, user: { id: 7 },
      onPrepareProduct: async (value: unknown) => { if (step === 'prepare') throw refusal; return value },
      createClientRequestId: () => 'product-1', registerReceivingProductAttempt: async () => { if (step === 'register') throw refusal },
      actorGuardText, failureText, stockFailureText, tr, priceText: (value: unknown) => String(value ?? ''),
      applyEntry() {}, setBatchChoice() {}, setSupplier() {}, supplier: { supplierName: '' }, brand: '', canReceive: true, canViewCosts: true,
    }
    dependencies.ownerChangedText = extract(modal, 'ownerChangedText', { tr })
    dependencies.assertReceivingOwner = extract(modal, 'assertReceivingOwner', dependencies)
    const hold = extract(modal, 'holdNewProduct', dependencies)
    await assert.rejects(hold({ name: 'New' }), (error: any) => error.message === km[code] && error.code === code, step)
  }
})
await check('the banner and the locks follow the owner: a lock raises them, the same owner back drops them, another owner keeps them', () => {
  const receivingIdentity = actor.captureActorWriteIdentity()
  const ownerDiffers = (signInChanged: boolean) => extract(modal, 'ownerDiffers', { signInChanged, isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity })
  assert.equal(ownerDiffers(false), false)
  local.set('businessos_read_session', 'another-tab-signed-in')
  assert.equal(ownerDiffers(true), true, 'locked while the sign-in is checked')
  actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
  assert.equal(ownerDiffers(true), false, 'the same owner confirmed: gone at the next render, before anything resets the latch')
  const flags: boolean[] = []
  const run = extract(`const run = ${effectCallback(modal, 'scheduleWorkDraftWrite')}`, 'run', {
    isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
    scheduleWorkDraftWrite: () => () => {}, fastStockInDraftKey: 'owner', currentDraft: () => ({}), autosaveCancelRef: { current: () => {} },
  })
  run(); assert.deepEqual(flags, [false], 'the owner check resets the latch')
  assert.match(modal.replace(/\r\n/g, '\n'), /scannedBarcode, createdProductIds, received, user\]\)/, 'and runs again when the app\'s user changes (the bootstrap after a refresh)')
  writeUser({ id: 8 })
  assert.equal(ownerDiffers(true), true, 'another owner: they stay')
})

await check('autosave never loses a scan to the refresh or a lock; minimize says "nothing was lost" only when true; Discard keeps another owner\'s draft', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage })
  try {
    const session = () => {
      const key = 'businessos_draft_v2_fixture_fast_stockin'
      const receivingIdentity = actor.captureActorWriteIdentity()
      const box = { lines: ['line-1'], flags: [] as boolean[], toasts: [] as string[] }
      const deps = {
        isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, setSignInChanged: (value: boolean) => box.flags.push(value),
        scheduleWorkDraftWrite: workDrafts.scheduleWorkDraftWrite, writeWorkDraft: workDrafts.writeWorkDraft, flushPendingWorkDraft: workDrafts.flushPendingWorkDraft,
        clearWorkDraft: workDrafts.clearWorkDraft, fastStockInDraftKey: key, currentDraft: () => ({ lines: [...box.lines] }), autosaveCancelRef: { current: () => {} },
        saving: false, onMinimize: () => box.toasts.push('chip: nothing was lost'), notify: (message: string) => box.toasts.push(message),
        tr: (_key: string, fallback: string) => fallback, onClose() {}, onDone() {}, received: [], sessionLabel: 'Add Session',
      }
      // React runs the previous cleanup before every new run.
      const effect = extract(`const effect = ${effectCallback(modal, 'scheduleWorkDraftWrite')}`, 'effect', deps)
      let cleanup: unknown
      const run = () => { if (typeof cleanup === 'function') cleanup(); cleanup = effect() }
      const saved = () => workDrafts.readWorkDraft<{ lines: string[] }>(key)?.data?.lines.join(',')
      return { box, run, saved, minimize: extract(modal, 'preserveAndMinimize', deps), discard: extract(modal, 'discardAndClose', deps), flush: () => workDrafts.flushPendingWorkDraft(key) }
    }
    let s = session()
    s.run(); s.flush()
    s.box.lines = ['line-1', 'line-2']; s.run()
    await healthFlap('not back')
    s.box.lines = ['line-1', 'line-2', 'line-3']; s.run()
    assert.equal(s.box.flags.at(-1), false, 'A1: no banner while the bootstrap is out')
    writeUser({ avatar_path: 'fresh.png' })
    s.minimize()
    assert.equal(s.saved(), 'line-1,line-2,line-3', 'A4: the chip reopens every scan')
    assert.equal(s.box.toasts.at(-1), 'chip: nothing was lost', 'A3: so the message is true')

    freshTab(); s = session()
    s.run(); s.box.lines = ['line-1', 'line-2']; s.run()
    local.set('businessos_read_session', 'another-tab-signed-in')
    s.box.lines = ['line-1', 'line-2', 'typed-while-locked']; s.run(); s.flush()
    assert.equal(s.saved(), 'line-1,line-2', 'a lock keeps the scan made before it')
    actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
    s.minimize()
    assert.equal(s.saved(), 'line-1,line-2,typed-while-locked', 'the same owner confirmed: minimize keeps exactly what the screen shows')
    assert.equal(s.box.toasts.at(-1), 'chip: nothing was lost')

    freshTab(); s = session()
    s.run(); s.box.lines = ['line-1', 'line-2']; s.run()
    await healthFlap('not back'); writeUser({ id: 8 })
    s.box.lines = ['line-1', 'line-2', 'typed-by-b']; s.run(); s.flush()
    assert.equal(s.saved(), 'line-1,line-2', 'A5: another account: the original owner\'s scans kept, nothing after')
    s.discard()
    assert.equal(s.saved(), 'line-1,line-2', 'A6: Discard by another account keeps the original owner\'s draft')
    assert.match(s.box.toasts.at(-1) || '', /kept for the account that started it/)
    s.minimize()
    assert.equal(s.saved(), 'line-1,line-2', 'minimize after the change writes nothing of the new account')
  } finally {
    workDrafts.flushPendingWorkDrafts()
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
if (failed) process.exitCode = 1
