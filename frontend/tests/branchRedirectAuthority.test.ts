import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { apiFetch, __resetApiHealthForTests, __resetApiWriteDedupeForTests, pingServerHealth, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import * as actor from '../src/api/actorReadScope.ts'
import * as redirect from '../src/api/branchRedirect.ts'
import { permissionRefreshIntent } from '../src/utils/permissionRefreshAccumulator.ts'
import { appStorageResets } from './appPermissionRefresh.ts'

const { captureActorReadScope, isActorReadScopeCurrent, resetActorReadSession } = actor
const { BRANCH_REDIRECT_DECLINED_CODE, BRANCH_REDIRECT_HEADER, registerBranchRedirectHandler } = redirect
const refusal = {
  error: 'Synthetic branch is disabled', code: 'branch_redirect_required',
  redirect: {
    addressed_branch_id: 1, addressed_branch_name: 'Old shop', successor_branch_id: 2,
    successor_branch_name: 'Active shop', targets: [{ id: 2, name: 'Active shop' }], requested_target_id: null,
  },
}
const body = { product_id: 11, branch_id: 1, qty: 2, client_request_id: 'original-receiving-request' }
const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const stale = (error: unknown) => ['actor_session_quarantined', 'actor_owner_changed'].includes(String((error as { code?: string }).code))
  && (error as { outcome?: string }).outcome === 'not_dispatched'
// A real owner change: another user, organization or server, or B signed in (and seen) before A came back.
const REAL_CHANGES = ['actor', 'server', 'organization', 'A to B and back to A'] as const
// The same user's churn: never a reason to drop the operator's confirmed answer.
const SAME_USER = ['session reset', 'permissions rewrite', 'avatar rewrite', 'expiry rewrite', 'health flap, bootstrap back', 'health flap, bootstrap not back', 'stored user briefly missing'] as const
// AppContext's own permission refresh (source-read) over the real runtime reset.
const resets = appStorageResets(actor)
type ChangeKind = typeof REAL_CHANGES[number] | typeof SAME_USER[number]
type Call = { url: string; body: BodyInit | null | undefined; redirect: string | null }
async function fixture(run: (f: {
  calls: Call[]; change: (kind: ChangeKind) => Promise<void>;
  respond: (fn: () => Response | Promise<Response>) => void;
}) => Promise<void>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalFetch = globalThis.fetch
  const storage = new Map<string, string>()
  const store = {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
    get length() { return storage.size }, key: (index: number) => [...storage.keys()][index] ?? null,
  }
  let onSyncUpdate: ((detail: any) => void) | null = null
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: store, sessionStorage: { getItem: () => null }, location: { origin: 'https://fixture.test' },
    addEventListener() {}, setTimeout, clearTimeout,
    dispatchEvent: (event: { type?: string; detail?: unknown }) => { if (event?.type === 'sync:update') onSyncUpdate?.(event.detail); return true },
  } })
  const USER = { id: 7, organization_id: 3, role_id: 2, permissions: ['inventory.adjust'] }
  const writeUser = (patch: Record<string, unknown> = {}) => storage.set('businessos_user', JSON.stringify({ ...USER, ...patch }))
  writeUser()
  resetActorReadSession()
  setSyncServerUrl('https://original.example.test')
  setSyncToken('')
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  const calls: Call[] = []
  let health: 'down' | 'up' = 'up'
  let response: () => Response | Promise<Response> = () => calls.length === 1 ? json(409, refusal) : json(200, { success: true })
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith('/health')) { if (health === 'down') throw new TypeError('Failed to fetch'); return new Response('ok', { status: 200 }) }
    calls.push({ url: String(url), body: options?.body, redirect: new Headers(options?.headers).get(BRANCH_REDIRECT_HEADER) })
    return response()
  }) as typeof fetch
  // A failed probe then a good one: http.ts's reconnect refresh and the real permission-refresh
  // intent start AppContext's real permission refresh; the bootstrap then answers, or not yet.
  const healthFlap = async (bootstrap: 'back' | 'not back') => {
    const refreshes: Promise<void>[] = []
    onSyncUpdate = (detail) => { if (permissionRefreshIntent(detail, { userId: USER.id, roleId: USER.role_id }) === 'refresh') refreshes.push(resets.permissionRefresh()) }
    try { health = 'down'; await pingServerHealth(true); health = 'up'; await pingServerHealth(true) } finally { onSyncUpdate = null }
    assert(refreshes.length > 0, 'the reconnect really ran the permission refresh')
    await Promise.all(refreshes)
    if (bootstrap === 'back') writeUser({ permissions: ['inventory.adjust', 'refreshed'] })
  }
  const change = async (kind: ChangeKind) => {
    if (kind === 'actor') { writeUser({ id: 8 }); resetActorReadSession() }
    else if (kind === 'server') setSyncServerUrl('https://changed.example.test')
    else if (kind === 'organization') writeUser({ organization_id: 4 })
    else if (kind === 'A to B and back to A') { writeUser({ id: 8 }); captureActorReadScope(); writeUser() }
    else if (kind === 'session reset') resetActorReadSession()
    else if (kind === 'permissions rewrite') writeUser({ permissions: ['inventory.adjust', 'products.add'] })
    else if (kind === 'avatar rewrite') writeUser({ avatar_path: 'avatar.png' })
    else if (kind === 'expiry rewrite') storage.set('businessos_user_expiry', String(Date.now() + 86_400_000))
    else if (kind === 'stored user briefly missing') storage.delete('businessos_user')
    else await healthFlap(kind === 'health flap, bootstrap back' ? 'back' : 'not back')
  }
  try {
    await run({ calls, respond: (fn) => { response = fn }, change })
  } finally {
    if (actor.isActorSessionQuarantined()) actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
    globalThis.fetch = originalFetch
    setSyncServerUrl(''); __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}
let failures = 0
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}`, error) }
}

await check('current authority confirms same body and request ID at the original server', () => fixture(async ({ calls }) => {
  const unregister = registerBranchRedirectHandler(async () => 2)
  try {
    assert.deepEqual(await apiFetch('POST', '/api/inventory/adjust', body), { success: true })
    assert.equal(calls.length, 2); assert.equal(calls[1].url, calls[0].url)
    assert.equal(calls[1].body, JSON.stringify(body)); assert.equal(calls[1].redirect, '2')
  } finally { unregister() }
}))
for (const kind of REAL_CHANGES) {
  await check(`${kind} change while operator confirms prevents all redirect writes`, () => fixture(async ({ calls, change }) => {
    const asked = deferred<void>(), answer = deferred<number | null>(), scope = captureActorReadScope()
    const unregister = registerBranchRedirectHandler(() => { asked.resolve(); return answer.promise })
    try {
      const pending = apiFetch('POST', '/api/inventory/adjust', body)
      await asked.promise; await change(kind); assert.equal(isActorReadScopeCurrent(scope, false), false); answer.resolve(2)
      await assert.rejects(pending, stale); assert.equal(calls.length, 1)
      assert.deepEqual(await apiFetch('POST', '/api/inventory/adjust', { ...body, client_request_id: 'new-owner-command' }), { success: true })
      assert.equal(calls.length, 2, 'new authority remains able to issue its own operation')
    } finally { unregister() }
  }))
  await check(`${kind} change before refusal arrives cannot open an old-owner redirect`, () => fixture(async ({ calls, change, respond }) => {
    let prompts = 0
    const unregister = registerBranchRedirectHandler(async () => { prompts++; return 2 })
    respond(async () => { if (calls.length === 1) { await change(kind); return json(409, refusal) }; return json(200, { success: true }) })
    try {
      await assert.rejects(apiFetch('POST', '/api/inventory/adjust', body), stale)
      assert.equal(prompts, 0); assert.equal(calls.length, 1)
    } finally { unregister() }
  }))
}
for (const kind of SAME_USER) {
  await check(`same user, ${kind} while the operator confirms: the confirmed write is resent once`, () => fixture(async ({ calls, change }) => {
    const asked = deferred<void>(), answer = deferred<number | null>(), scope = captureActorReadScope()
    const unregister = registerBranchRedirectHandler(() => { asked.resolve(); return answer.promise })
    try {
      const pending = apiFetch('POST', '/api/inventory/adjust', body)
      await asked.promise; await change(kind)
      // A same-account rewrite keeps the read fingerprint too (login refresh, 14 Oct).
      if (kind !== 'session reset') assert.equal(isActorReadScopeCurrent(scope, false), kind.endsWith('rewrite'), 'control: the read fingerprint moved unless the same account was rewritten')
      answer.resolve(2)
      assert.deepEqual(await pending, { success: true })
      assert.equal(calls.length, 2); assert.equal(calls[1].body, calls[0].body); assert.equal(calls[1].redirect, '2')
    } finally { unregister() }
  }))
}
await check('a later redirect still refuses a server change after an earlier confirmed retry', () => fixture(async ({ calls, change, respond }) => {
  const asked = deferred<void>(), answer = deferred<number | null>()
  let prompts = 0
  const unregister = registerBranchRedirectHandler(() => ++prompts === 1 ? Promise.resolve(2) : (asked.resolve(), answer.promise))
  respond(() => calls.length <= 2 ? json(409, refusal) : json(200, { success: true }))
  try {
    const pending = apiFetch('POST', '/api/inventory/adjust', body)
    await asked.promise; await change('server'); answer.resolve(2)
    await assert.rejects(pending, stale); assert.equal(calls.length, 2)
    assert.equal(calls[1].body, calls[0].body); assert.equal(calls[1].redirect, '2')
  } finally { unregister() }
}))
await check('current authority decline remains cancelled with no retry', () => fixture(async ({ calls }) => {
  const unregister = registerBranchRedirectHandler(async () => null)
  try {
    await assert.rejects(apiFetch('POST', '/api/inventory/adjust', body), (error: any) => error.code === BRANCH_REDIRECT_DECLINED_CODE && error.userCancelled)
    assert.equal(calls.length, 1)
  } finally { unregister() }
}))
await check('GET and ordinary failures retain their original errors without a prompt', () => fixture(async ({ calls, respond }) => {
  let prompts = 0
  const unregister = registerBranchRedirectHandler(async () => { prompts++; return 2 })
  try {
    await assert.rejects(apiFetch('GET', '/api/inventory/adjust'), (error: any) => error.code === refusal.code)
    respond(() => json(403, { error: 'Not allowed', code: 'synthetic_permission_denied' }))
    await assert.rejects(apiFetch('POST', '/api/inventory/adjust', body), (error: any) => error.code === 'synthetic_permission_denied')
    assert.equal(prompts, 0); assert.equal(calls.length, 2)
  } finally { unregister() }
}))
await check('ordinary successful responses keep existing account-transition semantics', () => fixture(async ({ change, respond, calls }) => {
  respond(async () => { await change('actor'); return json(200, { success: true }) })
  assert.deepEqual(await apiFetch('POST', '/api/inventory/adjust', body), { success: true })
  assert.equal(calls.length, 1)
}))

// ---- the queued question and the float that shows it ----
const request = redirect.branchRedirectRequestOf({ code: refusal.code, redirect: refusal.redirect }) as redirect.BranchRedirectRequest
await check('a question queued behind another is never put to a different owner', () => fixture(async ({ change }) => {
  const asked: string[] = []
  let releaseFirst!: (value: number | null) => void
  const unregister = registerBranchRedirectHandler((ask) => new Promise<number | null>((done) => { asked.push(ask.code); if (asked.length === 1) releaseFirst = done; else done(2) }))
  try {
    const first = redirect.askBranchRedirect(request), second = redirect.askBranchRedirect(request)
    await new Promise((done) => setTimeout(done, 5))
    await change('actor'); releaseFirst(null)
    assert.equal(await first, null); assert.equal(await second, null)
    assert.equal(asked.length, 1, 'the second question never reached the float')
  } finally { unregister() }
}))
await check('positive control: a queued question is asked of the same owner after a session reset', () => fixture(async ({ change }) => {
  let releaseFirst!: (value: number | null) => void, asked = 0
  const unregister = registerBranchRedirectHandler(() => new Promise<number | null>((done) => { asked++; if (asked === 1) releaseFirst = done; else done(2) }))
  try {
    const first = redirect.askBranchRedirect(request), second = redirect.askBranchRedirect(request)
    await new Promise((done) => setTimeout(done, 5))
    await change('session reset'); releaseFirst(2)
    assert.equal(await first, 2); assert.equal(await second, 2); assert.equal(asked, 2)
  } finally { unregister() }
}))

// The real hook, driven by a minimal hook renderer (useState/useRef/useCallback/useEffect).
let rendering: { cursor: number; slots: any[]; effects: Array<() => void> } | null = null
const fakeReact = {
  useState(init: unknown) {
    const frame = rendering!, index = frame.cursor++
    if (!(index in frame.slots)) frame.slots[index] = typeof init === 'function' ? (init as () => unknown)() : init
    return [frame.slots[index], (next: unknown) => {
      const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(frame.slots[index]) : next
      if (!Object.is(value, frame.slots[index])) { frame.slots[index] = value; schedule() }
    }]
  },
  useRef(init: unknown) { const frame = rendering!, index = frame.cursor++; if (!(index in frame.slots)) frame.slots[index] = { current: init }; return frame.slots[index] },
  useCallback(fn: unknown, deps: unknown[]) {
    const frame = rendering!, index = frame.cursor++, prev = frame.slots[index]
    if (prev && deps.every((dep, at) => Object.is(dep, prev.deps[at]))) return prev.fn
    frame.slots[index] = { fn, deps }; return fn
  },
  useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
    const frame = rendering!, index = frame.cursor++, prev = frame.slots[index]
    if (prev && deps && deps.every((dep, at) => Object.is(dep, prev.deps[at]))) return
    frame.effects.push(() => { prev?.cleanup?.(); frame.slots[index] = { deps, cleanup: fn() } })
  },
}
let schedule: () => void = () => {}
function mountQueueHook() {
  const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/components/shared/useBranchRedirectQueue.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, (id: string) => {
    if (id === 'react') return fakeReact
    if (id === '../../api/actorReadScope.ts') return actor
    if (id === '../../api/branchRedirect.ts') return redirect
    throw new Error(`unexpected import ${id}`)
  })
  const frame = { cursor: 0, slots: [] as any[], effects: [] as Array<() => void> }
  let value: any = null, busy = false, again = false
  const renders: any[] = []
  const render = () => {
    if (busy) { again = true; return }
    busy = true
    do { again = false; rendering = frame; frame.cursor = 0; frame.effects = []; value = mod.exports.useBranchRedirectQueue(); renders.push(value); rendering = null; frame.effects.forEach((run) => run()) } while (again)
    busy = false
  }
  schedule = render
  render()
  return { get value() { return value }, renders, render, unmount: () => { frame.slots.forEach((slot) => slot?.cleanup?.()) } }
}
const tick = () => new Promise((done) => setTimeout(done, 5))
await check('the float hides a question from the next owner and answers Back', () => fixture(async ({ change }) => {
  const host = mountQueueHook()
  try {
    const answer = redirect.askBranchRedirect(request); await tick()
    assert.equal(host.value?.request.detail.addressed_branch_name, 'Old shop', 'control: the asking owner sees it')
    const before = host.renders.length
    await change('actor'); host.render()
    assert.equal(host.value, null, 'the next owner never sees the previous owner\'s branches')
    assert(host.renders.length > before && host.renders.slice(before).every((rendered) => rendered === null), 'not even for the one render before the effect answers Back')
    assert.equal(await answer, null)
  } finally { host.unmount() }
}))
await check('the float drops the question when another tab signs a different account in', () => fixture(async () => {
  const host = mountQueueHook()
  try {
    const answer = redirect.askBranchRedirect(request); await tick()
    assert(host.value)
    window.localStorage.setItem('businessos_user', JSON.stringify({ id: 9, organization_id: 3 }))
    window.localStorage.setItem('businessos_read_session', 'another-tab-signed-in')
    const before = host.renders.length
    actor.isActorSessionQuarantined()
    assert.equal(host.renders.length, before, 'nothing renders inside the notifying call')
    await tick()
    assert.equal(host.value, null, 'the lock screen\'s change notice re-checks the owner without an app render')
    assert(host.renders.length > before && host.renders.slice(before).every((rendered) => rendered === null))
    assert.equal(await answer, null)
  } finally { host.unmount() }
}))
await check('the float keeps the question when it re-renders while a refresh waits for its bootstrap', () => fixture(async ({ change }) => {
  const host = mountQueueHook()
  try {
    const answer = redirect.askBranchRedirect(request); await tick()
    await change('health flap, bootstrap not back'); host.render()
    assert(host.value, 'still shown: nothing answered Back for the operator')
    await change('stored user briefly missing'); host.render()
    assert(host.value, 'still shown with no stored user for a moment')
    host.value.answer(2)
    assert.equal(await answer, 2)
  } finally { host.unmount() }
}))
await check('positive control: the float keeps the question through a session reset and returns the answer', () => fixture(async ({ change }) => {
  const host = mountQueueHook()
  try {
    const answer = redirect.askBranchRedirect(request); await tick()
    await change('session reset'); await change('avatar rewrite'); host.render()
    assert(host.value, 'still shown to the same owner')
    host.value.answer(2)
    assert.equal(await answer, 2)
  } finally { host.unmount() }
}))

// ---- the guard messages in both languages ----
await check('guard messages are pack text, word for word, and restated in Khmer', async () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  assert.equal(en.actor_session_quarantined, actor.ACTOR_SESSION_QUARANTINED_MESSAGE)
  assert.equal(en.actor_owner_changed, actor.ACTOR_OWNER_CHANGED_MESSAGE)
  assert.equal(en.stale_read_scope, actor.STALE_READ_SCOPE_MESSAGE)
  const code = transformSync(fs.readFileSync(new URL('../src/api/branchRefusalLanguage.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (id: string) => { if (id.endsWith('/lang/km.json')) return km; throw new Error(id) })
  let language = 'km'
  const previousDocument = (globalThis as { document?: unknown }).document
  Object.assign(globalThis, { document: { documentElement: { getAttribute: () => language } } })
  try {
    for (const key of ['actor_session_quarantined', 'actor_owner_changed', 'stale_read_scope']) {
      assert(km[key] && km[key] !== en[key], key)
      const error = await mod.exports.restateActorGuard(Object.assign(new Error(en[key]), { code: key, outcome: 'not_dispatched' }))
      assert.equal(error.message, km[key]); assert.equal(error.code, key); assert.equal(error.outcome, 'not_dispatched')
    }
    language = 'en'
    const english = await mod.exports.restateActorGuard(Object.assign(new Error(en.actor_owner_changed), { code: 'actor_owner_changed' }))
    assert.equal(english.message, en.actor_owner_changed)
  } finally { Object.assign(globalThis, { document: previousDocument }) }
  assert.match(fs.readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8'), /restateActorGuard\(error as Error & \{ code\?: unknown \}\)/, 'the redirect fence restates its refusal')
})
if (failures) process.exitCode = 1
