import assert from 'node:assert/strict'
import { apiFetch, __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import { captureActorReadScope, isActorReadScopeCurrent, resetActorReadSession } from '../src/api/actorReadScope.ts'
import { BRANCH_REDIRECT_DECLINED_CODE, BRANCH_REDIRECT_HEADER, registerBranchRedirectHandler } from '../src/api/branchRedirect.ts'

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
const stale = (error: unknown) => (error as { code?: string }).code === 'actor_session_quarantined'
type Call = { url: string; body: BodyInit | null | undefined; redirect: string | null }
async function fixture(run: (f: {
  calls: Call[]; change: (kind: 'actor' | 'server') => void;
  respond: (fn: () => Response | Promise<Response>) => void;
}) => Promise<void>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalFetch = globalThis.fetch
  const storage = new Map<string, string>()
  const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: store, sessionStorage: { getItem: () => null }, location: { origin: 'https://fixture.test' },
    addEventListener() {}, dispatchEvent() { return true }, setTimeout, clearTimeout,
  } })
  storage.set('businessos_user', JSON.stringify({ id: 7 }))
  resetActorReadSession()
  setSyncServerUrl('https://original.example.test')
  setSyncToken('')
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  const calls: Call[] = []
  let response: () => Response | Promise<Response> = () => calls.length === 1 ? json(409, refusal) : json(200, { success: true })
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), body: options?.body, redirect: new Headers(options?.headers).get(BRANCH_REDIRECT_HEADER) })
    return response()
  }) as typeof fetch
  try {
    await run({ calls, respond: (fn) => { response = fn }, change: (kind) => {
      if (kind === 'actor') { storage.set('businessos_user', JSON.stringify({ id: 8 })); resetActorReadSession() }
      else setSyncServerUrl('https://changed.example.test')
    } })
  } finally {
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
for (const kind of ['actor', 'server'] as const) {
  await check(`${kind} change while operator confirms prevents all redirect writes`, () => fixture(async ({ calls, change }) => {
    const asked = deferred<void>(), answer = deferred<number | null>(), scope = captureActorReadScope()
    const unregister = registerBranchRedirectHandler(() => { asked.resolve(); return answer.promise })
    try {
      const pending = apiFetch('POST', '/api/inventory/adjust', body)
      await asked.promise; change(kind); assert.equal(isActorReadScopeCurrent(scope, false), false); answer.resolve(2)
      await assert.rejects(pending, stale); assert.equal(calls.length, 1)
      assert.deepEqual(await apiFetch('POST', '/api/inventory/adjust', { ...body, client_request_id: 'new-owner-command' }), { success: true })
      assert.equal(calls.length, 2, 'new authority remains able to issue its own operation')
    } finally { unregister() }
  }))
  await check(`${kind} change before refusal arrives cannot open an old-owner redirect`, () => fixture(async ({ calls, change, respond }) => {
    let prompts = 0
    const unregister = registerBranchRedirectHandler(async () => { prompts++; return 2 })
    respond(() => { if (calls.length === 1) { change(kind); return json(409, refusal) }; return json(200, { success: true }) })
    try {
      await assert.rejects(apiFetch('POST', '/api/inventory/adjust', body), stale)
      assert.equal(prompts, 0); assert.equal(calls.length, 1)
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
    await asked.promise; change('server'); answer.resolve(2)
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
  respond(() => { change('actor'); return json(200, { success: true }) })
  assert.deepEqual(await apiFetch('POST', '/api/inventory/adjust', body), { success: true })
  assert.equal(calls.length, 1)
}))
if (failures) process.exitCode = 1
