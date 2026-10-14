// The Worker half of the login duration change (claude/sec-sessions-20261013, routes/auth.ts POST /session-duration) answers
// with these exact bodies. They go through the REAL transport (api/authTransport.ts -> http.ts apiFetch) and the REAL
// changeSessionDuration, so what the person sees is what the integrated app shows:
//   400 session_duration_password_required  -> the password step (a coded refusal the profile modal reacts to)
//   400 incorrect_password / 429 current_password_rate_limited / 429 session_duration_rate_limited -> their own pack sentence
//   409 session_duration_conflict, and the 401 invalid_session a parallel change causes
//       -> "Changed from another window — reload to continue": not a connection problem, and this module signs nobody out.
// Nothing is persisted on any refusal.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size }, clear: () => values.clear(), key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, String(v)) }, removeItem: (k: string) => { values.delete(k) },
  }
}
const locks = { request: async (_name: string, _options: unknown, run: () => unknown) => run() }
const win = Object.assign(new EventTarget(), { navigator: { locks, onLine: true }, localStorage: storage(), sessionStorage: storage(), location: { origin: 'https://till.example.test', hostname: 'till.example.test', port: '' } })
Object.assign(globalThis, { window: win })

const { setSyncServerUrl } = await import('../src/api/http.ts')
const { updateSessionDuration } = await import('../src/api/authTransport.ts')
const { changeSessionDuration, sessionDurationRefusalMessage, SESSION_DURATION_PASSWORD_REQUIRED } = await import('../src/utils/sessionDurationChange.ts')

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const realFetch = globalThis.fetch
const WORKER_BODIES: Record<string, { status: number; body: Record<string, unknown> }> = {
  session_duration_password_required: { status: 400, body: { error: 'Enter your current password to stay signed in for longer.', code: 'session_duration_password_required' } },
  incorrect_password: { status: 400, body: { error: 'Your current password is incorrect.', code: 'incorrect_password' } },
  current_password_rate_limited: { status: 429, body: { error: 'Too many wrong current-password attempts.', code: 'current_password_rate_limited', retryAfterSeconds: 900 } },
  session_duration_rate_limited: { status: 429, body: { error: 'Too many login duration changes. Please try again later.', code: 'session_duration_rate_limited', retryAfterSeconds: 60 } },
  session_duration_conflict: { status: 409, body: { error: 'The login duration was just changed from another window. Reload and check it before changing it again.', code: 'session_duration_conflict' } },
  invalid_session: { status: 401, body: { error: 'Not authenticated', code: 'invalid_session' } },
}

async function ask(code: string) {
  const answer = WORKER_BODIES[code]
  globalThis.fetch = (async () => new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const events: string[] = []
  const listen = (type: string) => win.addEventListener(type, () => events.push(type))
  for (const type of ['auth:unauthorized', 'sync:write-blocked', 'offline']) listen(type)
  const persisted: unknown[] = []
  const outcome = await changeSessionDuration({
    sessionDuration: '7d',
    currentPassword: code === 'session_duration_password_required' ? '' : 'typed-password',
    refresh: (duration, password) => updateSessionDuration({ sessionDuration: duration, ...(password ? { currentPassword: password } : {}) }),
    persist: (applied) => { persisted.push(applied) },
  })
  return { outcome, events, persisted }
}

try {
  setSyncServerUrl('https://till.example.test')

  for (const code of Object.keys(WORKER_BODIES)) {
    await check(`${code}: a refusal value with the Worker's code and status, nothing persisted, a sentence in both packs`, async () => {
      const { outcome, persisted } = await ask(code)
      assert.equal(outcome.success, false)
      if (outcome.success) return
      assert.equal(outcome.code, code)
      assert.equal(outcome.status, WORKER_BODIES[code].status)
      assert.deepEqual(persisted, [], 'the device record is not touched')
      const english = sessionDurationRefusalMessage(outcome, (key, fallback) => en[key] ?? fallback)
      const khmer = sessionDurationRefusalMessage(outcome, (key, fallback) => km[key] ?? fallback)
      assert.ok(english && khmer && /[ក-៿]/.test(khmer) && khmer !== english, `${code} has an English and a Khmer sentence`)
      if (code === 'current_password_rate_limited' || code === 'session_duration_rate_limited') assert.equal(outcome.retryAfterSeconds, WORKER_BODIES[code].body.retryAfterSeconds)
    })
  }

  await check('the password-required refusal is the one the profile modal answers with the password step', async () => {
    const { outcome } = await ask('session_duration_password_required')
    assert.equal(!outcome.success && outcome.code, SESSION_DURATION_PASSWORD_REQUIRED)
  })

  await check('a parallel change (409 conflict, 401 invalid_session) reads "Changed from another window — reload to continue", not a connection problem', async () => {
    for (const code of ['session_duration_conflict', 'invalid_session']) {
      const { outcome } = await ask(code)
      assert.equal(outcome.success, false)
      if (outcome.success) return
      assert.equal(sessionDurationRefusalMessage(outcome, (key, fallback) => en[key] ?? fallback), 'Changed from another window — reload to continue', code)
      assert.equal(sessionDurationRefusalMessage(outcome, (key, fallback) => km[key] ?? fallback), km.session_duration_changed_elsewhere, code)
      assert.ok(!/connection/i.test(en.session_duration_changed_elsewhere))
    }
  })

  await check('the 409 conflict neither signs out nor flags the connection down; no event of either kind leaves the transport', async () => {
    const { events } = await ask('session_duration_conflict')
    assert.deepEqual(events, [], 'no auth:unauthorized, no sync:write-blocked, no offline')
  })

  await check('control: an accepted change persists once with the server expiry', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ sessionExpiresAt: '2026-10-21T00:00:00.000Z', authMode: 'cookie' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const persisted: unknown[] = []
    const outcome = await changeSessionDuration({
      sessionDuration: '7d', currentPassword: 'typed-password',
      refresh: (duration, password) => updateSessionDuration({ sessionDuration: duration, currentPassword: password }),
      persist: (applied) => { persisted.push(applied) },
    })
    assert.equal(outcome.success, true)
    assert.equal(persisted.length, 1)
  })
} finally {
  globalThis.fetch = realFetch
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nsessionDurationWorkerContract: all checks passed')
