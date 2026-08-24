// Regression test for lib/loginLockout.ts -- the Aug 2026 ask: "if login
// fails more than 5 times it lets you wait, tells you that, and increments
// every time until successful". Loads the REAL lib/loginLockout.ts against
// a real in-memory SQLite DB with every real migration applied (including
// 0031_login_lockouts.sql), same transpile-and-run harness as
// test-reset-products-pure.cjs -- no reimplementation of the logic here.
//
// Run (from cloudflare/): node scripts/test-login-lockout-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

const { getLoginLockoutState, recordFailedLogin, clearLoginLockout } = loadReal('lib/loginLockout.ts', {
  './db': { getDb: () => db },
})

const fakeEnv = {}

async function run() {
  // 1. Fresh username: no lockout, zero failures.
  let state = await getLoginLockoutState(fakeEnv, 'alice')
  assert.strictEqual(state.locked, false)
  assert.strictEqual(state.failedCount, 0)

  // 2. First 5 failures: counted, but never lock -- "more than 5 times".
  for (let i = 1; i <= 5; i++) {
    const failure = await recordFailedLogin(fakeEnv, 'alice')
    assert.strictEqual(failure.locked, false, `attempt ${i} should not lock yet`)
    assert.strictEqual(failure.failedCount, i)
    assert.strictEqual(failure.retryAfterSeconds, 0)
  }
  state = await getLoginLockoutState(fakeEnv, 'alice')
  assert.strictEqual(state.locked, false)

  // 3. 6th failure: now locked, and told to wait (base wait, 30s).
  let failure = await recordFailedLogin(fakeEnv, 'alice')
  assert.strictEqual(failure.locked, true)
  assert.strictEqual(failure.failedCount, 6)
  assert.strictEqual(failure.retryAfterSeconds, 30)
  state = await getLoginLockoutState(fakeEnv, 'alice')
  assert.strictEqual(state.locked, true)
  assert.strictEqual(state.failedCount, 6)
  assert.ok(state.retryAfterSeconds > 0 && state.retryAfterSeconds <= 30)

  // 4. Escalation: each further failure while locked increases the wait
  // ("increments every time until successful") -- 7th=60s, 8th=120s.
  failure = await recordFailedLogin(fakeEnv, 'alice')
  assert.strictEqual(failure.failedCount, 7)
  assert.strictEqual(failure.retryAfterSeconds, 60)
  failure = await recordFailedLogin(fakeEnv, 'alice')
  assert.strictEqual(failure.failedCount, 8)
  assert.strictEqual(failure.retryAfterSeconds, 120)

  // 5. Cap: wait never exceeds the 30-minute ceiling even after many
  // further failures.
  for (let i = 9; i <= 20; i++) {
    failure = await recordFailedLogin(fakeEnv, 'alice')
  }
  assert.strictEqual(failure.retryAfterSeconds, 30 * 60)

  // 6. Reset on success: clearLoginLockout brings the account back to a
  // clean, unlocked state with the counter back at zero.
  await clearLoginLockout(fakeEnv, 'alice')
  state = await getLoginLockoutState(fakeEnv, 'alice')
  assert.strictEqual(state.locked, false)
  assert.strictEqual(state.failedCount, 0)

  // 7. After a reset, the account gets its 5 free attempts again -- the
  // counter genuinely restarted, not just unlocked with the old count
  // still armed.
  failure = await recordFailedLogin(fakeEnv, 'alice')
  assert.strictEqual(failure.locked, false)
  assert.strictEqual(failure.failedCount, 1)

  // 8. Separate usernames track independently, and matching is
  // case-insensitive (same as the real /login route's `lower(u.username)`
  // lookup) so 'Bob' and 'bob' share one counter.
  await recordFailedLogin(fakeEnv, 'Bob')
  const bobState = await getLoginLockoutState(fakeEnv, 'bob')
  assert.strictEqual(bobState.failedCount, 1)
  const aliceState = await getLoginLockoutState(fakeEnv, 'alice')
  assert.strictEqual(aliceState.failedCount, 1, 'alice and bob counters must not cross-contaminate')

  console.log('test-login-lockout-pure.cjs: all checks passed')
}

run().catch((error) => {
  console.error('test-login-lockout-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
