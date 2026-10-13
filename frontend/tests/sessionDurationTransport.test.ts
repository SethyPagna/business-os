// The login-duration request through the REAL transport (authTransport.updateSessionDuration -> http.apiFetch), with
// only fetch stubbed. A refusal the Worker states by code -- 400 session_duration_password_required / incorrect_password,
// 429 current_password_rate_limited -- must reach the caller as an error carrying that code, send the typed password,
// and never be read as an invalid session: no auth:unauthorized, no quarantine, no stuck cookie phase. The transport
// dispatches auth:unauthorized for a 401 alone; the positive control below shows the listener is live.
import assert from 'node:assert/strict'

const local = new Map<string, string>()
const session = new Map<string, string>()
const storage = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) })
const events = new EventTarget()
let admissionQueue: Promise<unknown> = Promise.resolve()
const locks = { request: (_name: string, _options: unknown, action: () => unknown) => {
  const next = admissionQueue.then(action)
  admissionQueue = next.then(() => undefined, () => undefined)
  return next
} }
Object.assign(globalThis, { window: { location: { origin: 'https://session-duration.test' }, localStorage: storage(local), sessionStorage: storage(session),
  navigator: { locks },
  addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) } })
const scope = await import('../src/api/actorReadScope.ts')
const http = await import('../src/api/http.ts')
const { updateSessionDuration } = await import('../src/api/authTransport.ts')
const { changeSessionDuration } = await import('../src/utils/sessionDurationChange.ts')
http.setSyncServerUrl('https://session-duration.test')

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const seen: string[] = []
events.addEventListener('auth:unauthorized', () => { seen.push('auth:unauthorized') })
const originalFetch = globalThis.fetch
let lastBody: Record<string, unknown> = {}
const answer = (status: number, body: Record<string, unknown>) => {
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    assert.equal(scope.isActorCookieMutationPending(), true, 'the cookie phase is open while the request is out')
    lastBody = JSON.parse(String(init.body))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

try {
  for (const [status, body] of [
    [400, { error: 'Enter your current password to stay signed in for longer.', code: 'session_duration_password_required' }],
    [400, { error: 'Your current password is incorrect.', code: 'incorrect_password' }],
    [429, { error: 'Too many wrong attempts.', code: 'current_password_rate_limited', retryAfterSeconds: 900 }],
    [429, { error: 'Too many login duration changes.', code: 'session_duration_rate_limited', retryAfterSeconds: 60 }],
  ] as const) {
    await check(`${status} ${body.code}: returned as a coded refusal, the password is sent, nobody is signed out`, async () => {
      seen.length = 0
      answer(status, body)
      const outcome = await changeSessionDuration({
        sessionDuration: '30d',
        currentPassword: 'typed-password',
        refresh: (duration, password) => updateSessionDuration({ sessionDuration: duration, ...(password ? { currentPassword: password } : {}) }),
        persist: () => assert.fail('nothing is persisted on a refusal'),
      })
      assert.equal(outcome.success, false)
      assert.equal((outcome as { code: string }).code, body.code)
      assert.equal((outcome as { status: number }).status, status)
      assert.equal(lastBody.currentPassword, 'typed-password')
      assert.equal(lastBody.sessionDuration, '30d')
      assert.deepEqual(seen, [], 'no auth:unauthorized')
      assert.equal(scope.isActorSessionQuarantined(), false, 'the session is not quarantined')
      assert.equal(scope.isActorCookieMutationPending(), false, 'the cookie phase is settled')
    })
  }

  await check('200: the new expiry comes back and the session carries on', async () => {
    seen.length = 0
    answer(200, { sessionExpiresAt: '2026-11-12T00:00:00.000Z', authMode: 'cookie' })
    let persisted = ''
    const outcome = await changeSessionDuration({
      sessionDuration: '30d',
      refresh: (duration) => updateSessionDuration({ sessionDuration: duration }),
      persist: (applied) => { persisted = `${applied.sessionDuration}@${applied.sessionExpiresAt}` },
    })
    assert.equal(outcome.success, true)
    assert.equal(persisted, '30d@2026-11-12T00:00:00.000Z')
    assert.equal('currentPassword' in lastBody, false, 'no password key when none was typed')
    assert.deepEqual(seen, [])
  })

  await check('positive control: the listener is live -- an ordinary 401 does dispatch auth:unauthorized, and a 401 on this request is a refusal, never a persist', async () => {
    seen.length = 0
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Please sign in again to continue.', code: 'invalid_session' }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch
    await assert.rejects(http.apiFetch('GET', '/api/settings'))
    assert.deepEqual(seen, ['auth:unauthorized'])
    answer(401, { error: 'Please sign in again to continue.', code: 'invalid_session' })
    const outcome = await changeSessionDuration({
      sessionDuration: '1d',
      refresh: (duration) => updateSessionDuration({ sessionDuration: duration }),
      persist: () => assert.fail('nothing is persisted on a 401'),
    })
    assert.equal(outcome.success, false)
    assert.equal((outcome as { code: string }).code, 'invalid_session')
  })
} finally { globalThis.fetch = originalFetch }

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nsessionDurationTransport: all checks passed')
