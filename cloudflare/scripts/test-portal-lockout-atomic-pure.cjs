// 6.0.993 (RC1 review P3-3): recordPortalFailure must be atomic, like the staff
// lockout fixed in 6.0.986. The old body read the row and then wrote count+1, so
// concurrent failures read the same number and lost attempts: a parallel burst
// got more guesses than the 10 the flow allows. This loads the REAL
// lib/portalAuthLockout.ts against SQLite with every migration applied, behind a
// db wrapper that yields to the event loop between statements (as D1 round trips
// do), so interleaving is real.
//
// CONTROL: the previous read-modify-write body, on the same wrapper, must lose
// counts; if it ever stops losing them the wrapper no longer interleaves and the
// atomic assertions prove nothing. The same old body is also the PARITY oracle
// for the sequential behaviour (thresholds, cooldown, window restart).
//
// Run (from cloudflare/): node scripts/test-portal-lockout-atomic-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
const tick = () => new Promise((resolve) => setImmediate(resolve))
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const { recordPortalFailure, getPortalLockoutState, clearPortalLockout } = loadReal('lib/portalAuthLockout.ts', { './db': { getDb: () => slowDb } })

// The previous implementation, verbatim in shape.
const MAX_FAILURES = 10
const COOLDOWN_SECONDS = 30 * 60
async function oldRecord(scope, rawKey) {
  const k = { scope, key: String(rawKey || '').trim().toLowerCase() }
  const existing = await slowDb.prepare('SELECT failed_count, locked_until FROM portal_auth_lockouts WHERE scope = @scope AND key = @key').get(k)
  const priorExpired = existing?.locked_until ? new Date(existing.locked_until).getTime() <= Date.now() : false
  const base = existing && !priorExpired ? existing.failed_count : 0
  const failedCount = base + 1
  const lockedUntil = failedCount >= MAX_FAILURES ? new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString() : null
  if (existing) await slowDb.prepare('UPDATE portal_auth_lockouts SET failed_count = @failed_count, locked_until = @locked_until, updated_at = CURRENT_TIMESTAMP WHERE scope = @scope AND key = @key').run({ ...k, failed_count: failedCount, locked_until: lockedUntil })
  else await slowDb.prepare('INSERT INTO portal_auth_lockouts (scope, key, failed_count, locked_until) VALUES (@scope, @key, @failed_count, @locked_until)').run({ ...k, failed_count: failedCount, locked_until: lockedUntil })
  return { locked: !!lockedUntil, failedCount, retryAfterSeconds: lockedUntil ? COOLDOWN_SECONDS : 0 }
}

const row = (scope, key) => rawDb.prepare('SELECT failed_count AS n, locked_until AS l FROM portal_auth_lockouts WHERE scope = ? AND key = ?').get([scope, key])
const countOf = (scope, key) => row(scope, key)?.n || 0
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

async function run() {
  const N = 14

  // CONTROL: the old read-modify-write loses counts under concurrency.
  // (the old insert branch can even die on the primary key when two callers both saw no row)
  await Promise.allSettled(Array.from({ length: N }, () => oldRecord('signin', 'control')))
  assert.ok(countOf('signin', 'control') < N, `control must lose counts (got ${countOf('signin', 'control')} of ${N}); the wrapper is not interleaving`)

  // N concurrent failures against a fresh key all count, each caller sees a distinct count.
  const results = await Promise.all(Array.from({ length: N }, () => recordPortalFailure({}, 'signin', 'victim')))
  assert.strictEqual(countOf('signin', 'victim'), N, 'every concurrent failure must be counted')
  assert.deepStrictEqual(results.map((r) => r.failedCount).sort((a, b) => a - b), Array.from({ length: N }, (_, i) => i + 1))
  assert.strictEqual(results.filter((r) => r.locked).length, N - MAX_FAILURES + 1, 'failures 10..N report locked')
  // Concurrent failures against an EXISTING row also all count.
  await Promise.all(Array.from({ length: N }, () => recordPortalFailure({}, 'signin', 'victim')))
  assert.strictEqual(countOf('signin', 'victim'), 2 * N)

  // PARITY: the same sequential run on both implementations gives the same states.
  for (let n = 1; n <= 13; n++) {
    const fresh = await recordPortalFailure({}, 'signup', 'ladder')
    const old = await oldRecord('signup', 'ladder-old')
    assert.deepStrictEqual(fresh, old, `failure ${n}`)
    assert.strictEqual(fresh.locked, n >= MAX_FAILURES)
    assert.strictEqual(fresh.retryAfterSeconds, n >= MAX_FAILURES ? COOLDOWN_SECONDS : 0)
    const a = row('signup', 'ladder'); const b = row('signup', 'ladder-old')
    assert.strictEqual(a.n, b.n)
    if (n < MAX_FAILURES) assert.strictEqual(a.l, null)
    else {
      assert.match(a.l, ISO, 'stored lock time keeps the toISOString shape')
      assert.ok(Math.abs((new Date(a.l) - new Date(b.l)) / 1000) < 5, 'same cooldown')
      assert.ok(Math.abs((new Date(a.l) - Date.now()) / 1000 - COOLDOWN_SECONDS) < 5)
    }
    const read = await getPortalLockoutState({}, 'signup', 'ladder')
    assert.strictEqual(read.failedCount, n)
    assert.strictEqual(read.locked, n >= MAX_FAILURES)
  }

  // A lock whose cooldown has elapsed restarts the window at 1 and clears the lock.
  const past = new Date(Date.now() - 1000).toISOString()
  rawDb.prepare('INSERT INTO portal_auth_lockouts (scope, key, failed_count, locked_until) VALUES (?, ?, ?, ?)').run(['signin', 'expired', 10, past])
  rawDb.prepare('INSERT INTO portal_auth_lockouts (scope, key, failed_count, locked_until) VALUES (?, ?, ?, ?)').run(['signin', 'expired-old', 10, past])
  const restarted = await recordPortalFailure({}, 'signin', 'expired')
  assert.deepStrictEqual(restarted, await oldRecord('signin', 'expired-old'))
  assert.deepStrictEqual(restarted, { locked: false, failedCount: 1, retryAfterSeconds: 0 })
  assert.strictEqual(row('signin', 'expired').l, null)

  // A live lock keeps counting and re-arms the cooldown.
  const future = new Date(Date.now() + 60_000).toISOString()
  rawDb.prepare('INSERT INTO portal_auth_lockouts (scope, key, failed_count, locked_until) VALUES (?, ?, ?, ?)').run(['signin', 'live', 10, future])
  const live = await recordPortalFailure({}, 'signin', 'live')
  assert.deepStrictEqual(live, { locked: true, failedCount: 11, retryAfterSeconds: COOLDOWN_SECONDS })
  assert.ok(new Date(row('signin', 'live').l) - Date.now() > 25 * 60_000, 'cooldown re-armed to ~30 minutes')

  // Scopes are separate counters; keys normalise (case, padding); an empty key counts nothing.
  await Promise.all(['Case', ' case ', 'CASE'].map((u) => recordPortalFailure({}, 'signin', u)))
  assert.strictEqual(countOf('signin', 'case'), 3)
  assert.strictEqual(countOf('signup', 'case'), 0)
  assert.deepStrictEqual(await recordPortalFailure({}, 'signin', '  '), { locked: false, failedCount: 0, retryAfterSeconds: 0 })

  // Success clears the counter.
  await clearPortalLockout({}, 'signin', 'case')
  assert.strictEqual(row('signin', 'case'), undefined)

  console.log('test-portal-lockout-atomic-pure.cjs: all checks passed')
}

run().catch((error) => {
  console.error('test-portal-lockout-atomic-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
