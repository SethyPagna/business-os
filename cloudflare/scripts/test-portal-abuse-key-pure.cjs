// Regression lock: the storefront's abuse counters keep no readable
// identifiers (N45).
//
// Two tables protect the public portal by counting rows that share a key:
// rate_limit_events (sliding window) and portal_auth_lockouts (flat 10-failure
// cap). Nothing ever reads a key back -- they are compared for equality and
// nothing else -- but the keys used to BE the identifiers: the visitor's IP,
// their IP+user-agent pair, and, for sign-in, the canonical phone number of
// the account being attempted. A table of phone numbers people are trying to
// sign in to, beside a failure count, is the sharpest personal data on the
// public surface, and it is collected by the defence rather than by any
// feature.
//
// What this pins:
//   1. a phone number put into the lockout does not appear in the row
//   2. the same phone still lands on the same row -- the cap still counts,
//      locks and clears exactly as before (a hash that broke the limiter
//      would be worse than the leak)
//   3. two different phones stay two different rows
//   4. the scope is mixed in, so one table's keys cannot probe another's
//   5. binding a salt changes the keys (an unsalted digest of a phone number
//      or an IPv4 address is enumerable offline)
//   6. every checkRateLimit call on the public portal routes passes a
//      one-way key, not the address itself
//
// Runs the REAL lib/portalAuthLockout.ts and lib/portalAbuseKey.ts against
// in-memory SQLite with every migration applied.
//
// Run (from cloudflare/): node scripts/test-portal-abuse-key-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SRC = path.join(__dirname, '..', 'src')

function allMigrationSql() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

function wrap(rawDb) {
  return {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}

const rawDb = openDb(allMigrationSql())
const db = wrap(rawDb)
const abuseKey = loadReal('lib/portalAbuseKey.ts')
const lockout = loadReal('lib/portalAuthLockout.ts', {
  './db': { getDb: () => db },
  './portalAbuseKey': abuseKey,
})

const env = { AUTH_SESSION_SECRET: 'a-real-deployment-secret' }
const PHONE = '+855 70 111 222'
const OTHER_PHONE = '+855 70 999 888'
const IP = '203.0.113.42'

const rows = () => rawDb.prepare('SELECT scope, key, failed_count, locked_until FROM portal_auth_lockouts').all({}) || []
const clearTable = () => rawDb.prepare('DELETE FROM portal_auth_lockouts').run({})

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('a failed sign-in stores no readable phone number', async () => {
    clearTable()
    await lockout.recordPortalFailure(env, 'signin', PHONE)
    const stored = rows()
    assert.equal(stored.length, 1, 'one row per key')
    const [row] = stored
    assert.equal(row.failed_count, 1)
    // Every shape the number could survive in.
    const variants = [PHONE, PHONE.toLowerCase(), PHONE.replace(/\s/g, ''), '85570111222', '70111222', '111222']
    for (const variant of variants) {
      assert.ok(!row.key.includes(variant), `the stored key must not contain ${variant}`)
    }
    assert.match(row.key, /^[0-9a-f]{32}$/, 'the key is an opaque digest')
  })

  await check('the same phone still counts onto the same row, and still locks', async () => {
    clearTable()
    for (let i = 0; i < 9; i += 1) await lockout.recordPortalFailure(env, 'signin', PHONE)
    assert.equal(rows().length, 1, 'nine failures on one number must be ONE row, or the cap never fires')
    let state = await lockout.getPortalLockoutState(env, 'signin', PHONE)
    assert.equal(state.locked, false, 'nine failures is under the cap')
    assert.equal(state.failedCount, 9)

    state = await lockout.recordPortalFailure(env, 'signin', PHONE)
    assert.equal(state.locked, true, 'the tenth failure locks')
    assert.ok(state.retryAfterSeconds > 0)
    assert.equal((await lockout.getPortalLockoutState(env, 'signin', PHONE)).locked, true, 'and the lock is readable back')

    // A differently-typed but identical number reaches the same row.
    assert.equal((await lockout.getPortalLockoutState(env, 'signin', '  +855 70 111 222  ')).locked, true)

    await lockout.clearPortalLockout(env, 'signin', PHONE)
    assert.equal(rows().length, 0, 'a successful sign-in clears the row')
  })

  await check('a different phone is a different row', async () => {
    clearTable()
    await lockout.recordPortalFailure(env, 'signin', PHONE)
    await lockout.recordPortalFailure(env, 'signin', OTHER_PHONE)
    assert.equal(rows().length, 2)
    assert.equal((await lockout.getPortalLockoutState(env, 'signin', OTHER_PHONE)).failedCount, 1)
  })

  await check('the scope is mixed in, so keys cannot travel between counters', async () => {
    const signin = await abuseKey.portalAbuseKey(env, 'lockout:signin', PHONE)
    const signup = await abuseKey.portalAbuseKey(env, 'lockout:signup', PHONE)
    const ip = await abuseKey.portalAbuseKey(env, 'ip', PHONE)
    assert.notEqual(signin, signup, 'the same value in two scopes must not share a key')
    assert.notEqual(signin, ip)
    assert.equal(signin, await abuseKey.portalAbuseKey(env, 'lockout:signin', PHONE), 'but the same scope is stable')
  })

  await check('the salt changes the keys', async () => {
    const salted = await abuseKey.portalAbuseKey(env, 'ip', IP)
    const other = await abuseKey.portalAbuseKey({ AUTH_SESSION_SECRET: 'a-different-secret' }, 'ip', IP)
    const unsalted = await abuseKey.portalAbuseKey({}, 'ip', IP)
    assert.notEqual(salted, other, 'rotating the secret must rotate the keys')
    assert.notEqual(salted, unsalted, 'a bound secret must actually be mixed in')
    assert.equal(await abuseKey.portalAbuseKey(env, 'ip', ''), '', 'an empty identifier stays empty so callers can skip it')
    assert.equal(await abuseKey.portalAbuseKey(env, 'ip', null), '')
  })

  await check('no portal route hands a raw address to a rate-limit counter', () => {
    const source = fs.readFileSync(path.join(SRC, 'routes', 'portal.ts'), 'utf8')
    const calls = source.match(/checkRateLimit\([^)]*\)/g) || []
    assert.ok(calls.length >= 4, `expected the public portal's rate-limited routes, found ${calls.length}`)
    for (const call of calls) {
      assert.match(call, /portalAbuseKey/, `this call still passes the identifier itself: ${call}`)
      assert.doesNotMatch(
        call,
        /checkRateLimit\([^,]+,[^,]+,\s*getClientIp\(/,
        `getClientIp goes through portalAbuseKey, not straight into the counter: ${call}`,
      )
    }
    // The AI throttle key is built here and consumed in lib/portalAi.ts.
    assert.match(source, /portalAbuseKey\(env, 'ai_visitor'/, 'the AI visitor fingerprint must be one-way before it leaves the function')
    assert.doesNotMatch(source, /return `\$\{ip\}\|\$\{ua \|\| 'unknown-agent'\}`/, 'the raw ip|ua fingerprint must not be returned')

    const lockoutSource = fs.readFileSync(path.join(SRC, 'lib', 'portalAuthLockout.ts'), 'utf8')
    assert.match(lockoutSource, /portalAbuseKey\(env, `lockout:\$\{scope\}`, key\)/, 'the lockout key must be one-way')
    assert.doesNotMatch(lockoutSource, /key: String\(key \|\| ''\)\.trim\(\)\.toLowerCase\(\)/, 'the plaintext key must not come back')
  })

  console.log(`\n${passed} check group(s) passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
