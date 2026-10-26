// W3: recordFailedLogin must be atomic. The old body read failed_count and then
// wrote count+1 back, so concurrent failures read the same number and lost
// attempts -- an attacker firing guesses in parallel got more than the counted
// ones. This loads the REAL lib/loginLockout.ts against a real SQLite with every
// migration applied, behind a db wrapper that yields to the event loop between
// statements (as D1 round trips do), so interleaving is real.
//
// Also carries a CONTROL: the previous read-modify-write body, run on the same
// wrapper, must lose counts. If it ever stops losing them the wrapper no longer
// interleaves and the atomic assertions below prove nothing.
//
// Run (from cloudflare/): node scripts/test-login-lockout-atomic-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
const tick = () => new Promise((resolve) => setImmediate(resolve))

// Every statement result arrives a few event-loop turns after it was asked for.
const slowDb = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      async get(params) { await tick(); const r = stmt.get(params); await tick(); return r },
      async all(params) { await tick(); const r = stmt.all(params); await tick(); return r },
      async run(params) { await tick(); const r = stmt.run(params); await tick(); return r },
    }
  },
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
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

const { recordFailedLogin, getLoginLockoutState } = loadReal('lib/loginLockout.ts', {
  './db': { getDb: () => slowDb },
  './rateLimit': loadReal('lib/rateLimit.ts', { './db': { getDb: () => slowDb } }),
})

// The previous implementation, verbatim in shape: read, add one, write back.
async function oldReadModifyWrite(key) {
  const existing = await slowDb.prepare('SELECT failed_count FROM login_lockouts WHERE username = ?').get([key])
  const failedCount = (existing?.failed_count || 0) + 1
  if (existing) {
    await slowDb.prepare('UPDATE login_lockouts SET failed_count = ? WHERE username = ?').run([failedCount, key])
  } else {
    await slowDb.prepare('INSERT OR REPLACE INTO login_lockouts (username, failed_count) VALUES (?, ?)').run([key, failedCount])
  }
  return failedCount
}

const countOf = (key) => rawDb.prepare('SELECT failed_count AS n FROM login_lockouts WHERE username = ?').get([key])?.n || 0
const lockedUntilOf = (key) => rawDb.prepare('SELECT locked_until AS l FROM login_lockouts WHERE username = ?').get([key])?.l

async function run() {
  const N = 12

  // CONTROL: the old read-modify-write loses counts under concurrency.
  await Promise.all(Array.from({ length: N }, () => oldReadModifyWrite('control')))
  const controlCount = countOf('control')
  assert.ok(controlCount < N, `control must lose counts (got ${controlCount} of ${N}); the wrapper is not interleaving`)

  // N concurrent failures against a fresh key must ALL count.
  const results = await Promise.all(Array.from({ length: N }, () => recordFailedLogin({}, 'victim')))
  assert.strictEqual(countOf('victim'), N, 'every concurrent failure must be counted')
  assert.deepStrictEqual(results.map((r) => r.failedCount).sort((a, b) => a - b), Array.from({ length: N }, (_, i) => i + 1),
    'each concurrent caller must see a distinct count 1..N')

  // Concurrent failures against an EXISTING row also all count.
  await Promise.all(Array.from({ length: N }, () => recordFailedLogin({}, 'victim')))
  assert.strictEqual(countOf('victim'), 2 * N)

  // Thresholds unchanged: 5 free, then 30s doubling, cap 1800s.
  const expectedWait = (n) => (n <= 5 ? 0 : Math.min(1800, 30 * 2 ** (n - 6)))
  for (let n = 1; n <= 24; n++) {
    const state = await recordFailedLogin({}, 'ladder')
    assert.strictEqual(state.failedCount, n)
    assert.strictEqual(state.retryAfterSeconds, expectedWait(n), `wait for failure ${n}`)
    assert.strictEqual(state.locked, n > 5)
    // The stored lock time (computed in SQL) agrees with the reported wait.
    const stored = lockedUntilOf('ladder')
    if (n <= 5) assert.strictEqual(stored, null, `no lock stored for failure ${n}`)
    else {
      const remaining = (new Date(stored).getTime() - Date.now()) / 1000
      assert.ok(Math.abs(remaining - expectedWait(n)) < 5, `stored lock for failure ${n}: ${remaining}s vs ${expectedWait(n)}s`)
    }
    const read = await getLoginLockoutState({}, 'ladder')
    assert.strictEqual(read.failedCount, n)
    assert.strictEqual(read.locked, n > 5)
  }

  // Key normalisation unchanged: case and padding share one counter.
  await Promise.all(['Case', ' case ', 'CASE'].map((u) => recordFailedLogin({}, u)))
  assert.strictEqual(countOf('case'), 3)

  console.log('test-login-lockout-atomic-pure.cjs: all checks passed')
}

run().catch((error) => {
  console.error('test-login-lockout-atomic-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
