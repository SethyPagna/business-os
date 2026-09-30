import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const start = source.indexOf('    const onUnauthorized = (e: Event) => {')
const end = source.indexOf("    window.addEventListener('sync:update'", start)
assert.ok(start >= 0 && end > start, 'load the mounted unauthorized recovery handler')
const code = ts.transpileModule(source.slice(start, end) + '\nreturn onUnauthorized;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

type Payload = { user?: { id: number }; unauthorized?: boolean; authError?: string } | null
type Scenario = {
  response?: Payload
  error?: Error
  applyError?: Error
  signedOut?: boolean
  staleBefore?: boolean
  staleAfter?: boolean
}

async function recover(options: Scenario) {
  const calls: string[] = []
  const scheduled: Array<() => Promise<void>> = []
  let scopeCurrent = !options.staleBefore
  const actor = options.signedOut ? null : { id: 71 }
  const recovery = { current: false }
  const env = {
    disposed: false,
    user: actor,
    eventDetail: () => ({ error: 'Initial session refusal' }),
    getStoredUserPayload: () => actor,
    authRecoveryRef: recovery,
    captureActorReadScope: () => ({}),
    isActorReadScopeCurrent: () => scopeCurrent,
    window: { setTimeout: (fn: () => Promise<void>) => { scheduled.push(fn) } },
    readAppBootstrap: async () => {
      calls.push('read')
      if (options.staleAfter) scopeCurrent = false
      if (options.error) throw options.error
      return options.response ?? null
    },
    applyBootstrapPayload: async () => {
      calls.push('apply')
      if (options.applyError) throw options.applyError
    },
    handleUnauthorizedSession: async (message: string) => { calls.push(`clear:${message}`) },
  }
  const onUnauthorized = new Function('env', `with(env){${code}}`)(env)
  onUnauthorized(new Event('auth:unauthorized'))
  onUnauthorized(new Event('auth:unauthorized'))
  assert.equal(scheduled.length, options.signedOut ? 0 : 1, 'coalesce the same burst')
  for (const run of scheduled) await run()
  assert.equal(recovery.current, false, 'release the recovery guard after every outcome')
  return calls
}

assert.deepEqual(await recover({ response: null }), ['read'], 'an unavailable bootstrap cannot prove the session expired')
assert.deepEqual(await recover({ error: Object.assign(new Error('Database unavailable'), { status: 500 }) }), ['read'], 'server failure preserves the session')
assert.deepEqual(await recover({ error: new TypeError('Failed to fetch') }), ['read'], 'network failure preserves the session')
assert.deepEqual(await recover({ response: { user: { id: 71 } } }), ['read', 'apply'], 'confirmed session is applied')
assert.deepEqual(await recover({ response: { unauthorized: true, authError: 'Session expired' } }), ['read', 'clear:Session expired'], 'confirmed invalid session still clears')
assert.deepEqual(await recover({ response: { unauthorized: true } }), ['read', 'clear:Initial session refusal'], 'confirmed refusal keeps the original message fallback')
assert.deepEqual(await recover({ response: { user: { id: 71 } }, applyError: new Error('Settings unavailable') }), ['read', 'apply'], 'a failed bootstrap consumer cannot invalidate confirmed auth')
assert.deepEqual(await recover({ signedOut: true }), [], 'signed-out pages have no session to recover')
assert.deepEqual(await recover({ staleBefore: true }), [], 'do not read for a stale actor')
assert.deepEqual(await recover({ response: { unauthorized: true }, staleAfter: true }), ['read'], 'a late refusal cannot clear a newer actor')

console.log('PASS unauthorized recovery preserves sessions through outages and still clears confirmed invalid sessions (10 scenarios)')
