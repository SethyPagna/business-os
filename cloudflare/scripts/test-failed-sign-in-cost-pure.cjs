// RELEASE-20261006-VERIFY Exception 3: after E6, sign-in time showed whether
// an identifier has an account. Measured in Node: a bcrypt account with a
// wrong password ~150 ms, an unknown account (PBKDF2 dummy) ~4.8 ms, a PBKDF2
// account ~3.6 ms -- so storefront phones and staff usernames with a legacy
// bcrypt hash were enumerable until each signed in once.
//
// The fix: every FAILED sign-in is topped up to one fixed set of hash work,
// the "floor" (lib/passwordHash.ts spendFailedSignInFloor), chosen per table
// by lib/failedSignInCost.ts:
//   Paid, a bcrypt row may remain -> one PBKDF2 check + one bcrypt-10 compare
//   Paid, none remain             -> one PBKDF2 check
//   PLAN_TIER=free                -> one PBKDF2 check; bcrypt never runs as
//                                    padding (it cannot fit 10 ms of CPU) and
//                                    a readiness warning is logged.
//
// The work is measured with injected hash functions -- the real bcryptjs and
// the real WebCrypto deriveBits behind counting wrappers -- and compared as a
// signature: the PBKDF2 iteration counts and the bcrypt COSTS spent, which is
// what decides the time. Pins, for BOTH sign-in surfaces (the real
// routes/auth.ts POST /login and the real lib/portalAccounts.ts signin):
//   - in every state, the unknown-identifier path spends exactly the
//     signature of the slowest real failing path that can occur in that
//     state, and so does every other failing path (inactive, wrong password
//     on PBKDF2, wrong password on bcrypt, an unusable stored value);
//   - on Free, no failing path for an unknown identifier runs bcrypt, and
//     the one gap left (a wrong password on a bcrypt row) is pinned visibly;
//   - the "does bcrypt remain" answer costs one LIMIT 1 SELECT per table per
//     isolate per TTL (fake clock), never a write, is moved by what sign-ins
//     see, and fails safe to bcrypt on Paid.
//
// Control: at 2558a7c55 (before this fix) the matrix checks fail -- the
// unknown path spends one PBKDF2 and no bcrypt while a bcrypt account's wrong
// password spends a bcrypt-10 compare and no PBKDF2. See E6-HASH-REPORT.md
// section 8 for the recorded run.
//
// Run: node scripts/test-failed-sign-in-cost-pure.cjs

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Module = require('node:module')
const nodeCrypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const CURRENT_ITERATIONS = 10000

const compared = []
const countingBcrypt = { ...bcrypt, compareSync: (plain, hash) => { compared.push(String(hash)); return bcrypt.compareSync(plain, hash) } }
countingBcrypt.default = countingBcrypt
const derived = []
const subtle = globalThis.crypto.subtle
const realDeriveBits = subtle.deriveBits.bind(subtle)
subtle.deriveBits = (algorithm, ...rest) => { derived.push(algorithm.iterations); return realDeriveBits(algorithm, ...rest) }
const resetCounts = () => { compared.length = 0; derived.length = 0 }
const signature = () => ({ pbkdf2: [...derived].sort(), bcryptCosts: compared.map((hash) => hash.slice(4, 6)).sort() })
const PBKDF2_FLOOR = { pbkdf2: [CURRENT_ITERATIONS], bcryptCosts: [] }
const BCRYPT_FLOOR = { pbkdf2: [CURRENT_ITERATIONS], bcryptCosts: ['10'] }

const warnings = []
const realWarn = console.warn
console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }

function pbkdf2Row(password) {
  const salt = nodeCrypto.randomBytes(16)
  const key = nodeCrypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, CURRENT_ITERATIONS, 32, 'sha256')
  const b64 = (b) => b.toString('base64').replace(/=+$/, '')
  return `$pbkdf2-sha256$i=${CURRENT_ITERATIONS}$${b64(salt)}$${b64(key)}`
}
const BCRYPT_ROW = bcrypt.hashSync('legacy-pass-1', 10)

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}
const hasFloorModule = fs.existsSync(path.join(SRC, 'lib', 'failedSignInCost.ts'))

let failures = 0
async function check(name, fn) {
  resetCounts()
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

// ---- staff: the real POST /login ------------------------------------------
let ipSeq = 0
const freshIp = () => `192.0.2.${(ipSeq += 1) % 250}`
// state: 'bcrypt' (an active bcrypt row remains), 'none' (only an INACTIVE
// bcrypt row remains -- it cannot be checked, so it must not hold the floor up)
function staffHarness({ state, planTier }) {
  const h = createAuthHarness({ overrides: { bcryptjs: countingBcrypt } })
  if (planTier) h.env.PLAN_TIER = planTier
  const set = (id, hash) => h.raw.prepare('UPDATE users SET password = @hash WHERE id = @id').run({ hash, id })
  h.addUser({ id: 901, username: 'cur', name: 'Current Staff', password: 'x' }); set(901, pbkdf2Row('cur-pass-1'))
  h.addUser({ id: 902, username: 'odd', name: 'Odd Staff', password: 'x' }); set(902, 'not-a-hash')
  h.addUser({ id: 903, username: 'gone', name: 'Gone Staff', password: 'x' }); set(903, BCRYPT_ROW)
  h.raw.prepare('UPDATE users SET is_active = 0 WHERE id = 903').run({})
  if (state === 'bcrypt') { h.addUser({ id: 904, username: 'old', name: 'Old Staff', password: 'x' }); set(904, BCRYPT_ROW) }
  const legacyQueries = []
  const prepare = h.db.prepare.bind(h.db)
  h.db.prepare = (sql) => { if (/substr\(password/.test(sql)) legacyQueries.push(sql); return prepare(sql) }
  h.legacyQueries = legacyQueries
  return h
}
async function staffSignature(h, username) {
  resetCounts()
  const res = await h.request('/login', 'POST', { username, password: 'wrong-guess-1' }, { ip: freshIp() })
  assert.equal(res.status, 401, `${username}: ${JSON.stringify(res.body)}`)
  return signature()
}

// ---- storefront: the real lib/portalAccounts.ts signin --------------------
function portalFixture({ state, planTier }) {
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => { const r = stmt.run(p); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
  const phone = loadReal('lib/phone.ts')
  const contactOptions = loadReal('lib/contactOptions.ts')
  const sqlBinding = loadReal('lib/sqlBinding.ts')
  const passwordHash = loadReal('lib/passwordHash.ts', { bcryptjs: countingBcrypt })
  const floorModule = hasFloorModule ? loadReal('lib/failedSignInCost.ts', { './planTier': loadReal('lib/planTier.ts') }) : {}
  const portal = loadReal('lib/portalAccounts.ts', {
    './db': { getDb: () => db },
    './membershipNumber': loadReal('lib/membershipNumber.ts'),
    './phone': phone,
    './passwordPolicy': loadReal('lib/passwordPolicy.ts'),
    './contactDuplicates': loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions, './phone': phone, './sqlBinding': sqlBinding }),
    './anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
    './passwordHash': passwordHash,
    './failedSignInCost': floorModule,
  })
  const env = planTier ? { PLAN_TIER: planTier } : {}
  return { rawDb, portal, env, passwordHash }
}
async function portalAccount(f, name, phoneNumber, hash) {
  const res = await f.portal.signupPortalAccount(f.env, { name, phone: phoneNumber, password: 'portal-pass-1', consent: true })
  assert.equal(res.ok, true, JSON.stringify(res))
  if (hash !== undefined) f.rawDb.prepare('UPDATE portal_accounts SET password_hash = ? WHERE id = ?').run([hash, res.accountId])
  return res
}
async function portalSignature(f, identifier, phoneNumber, password = 'wrong-guess-1') {
  resetCounts()
  const res = await f.portal.signinPortalAccount(f.env, { identifier, phone: phoneNumber, password, consent: true })
  assert.equal(res.ok, false, `${identifier}: ${JSON.stringify(res)}`)
  assert.equal(res.code, 'invalid_credentials')
  return signature()
}
async function portalCase({ state, planTier }) {
  const f = portalFixture({ state, planTier })
  await portalAccount(f, 'Current', '097 100 001')
  await portalAccount(f, 'Odd', '097 100 002', 'not-a-hash')
  if (state === 'bcrypt') await portalAccount(f, 'Legacy', '097 100 003', BCRYPT_ROW)
  const out = {
    unknown: await portalSignature(f, 'Nobody', '011 999 888'),
    pbkdf2Wrong: await portalSignature(f, 'Current', '097100001'),
    pbkdf2WrongName: await portalSignature(f, 'Somebody Else', '097100001', 'portal-pass-1'),
    unusable: await portalSignature(f, 'Odd', '097100002'),
  }
  if (state === 'bcrypt') out.bcryptWrong = await portalSignature(f, 'Legacy', '097100003')
  return out
}

;(async () => {
  // ---- the matrix: unknown == slowest real failing path, per state ---------
  await check('[staff, Paid, bcrypt remains] every failing path spends the bcrypt floor, the unknown one included', async () => {
    const h = staffHarness({ state: 'bcrypt' })
    const slowest = await staffSignature(h, 'old')
    assert.deepEqual(slowest.bcryptCosts, ['10'], 'control: the instrument sees the real bcrypt-10 compare')
    for (const username of ['nobody-here', 'gone', 'cur', 'odd']) {
      assert.deepEqual(await staffSignature(h, username), slowest, `${username} must cost what a wrong password on the bcrypt account costs`)
    }
    assert.deepEqual(slowest, BCRYPT_FLOOR, 'the bcrypt row is padded with the PBKDF2 half')
  })

  await check('[staff, Paid, none remain] every failing path spends one PBKDF2 check and no bcrypt', async () => {
    const h = staffHarness({ state: 'none' })
    const slowest = await staffSignature(h, 'cur')
    assert.deepEqual(slowest, PBKDF2_FLOOR)
    for (const username of ['nobody-here', 'gone', 'odd']) {
      assert.deepEqual(await staffSignature(h, username), slowest, `${username}`)
    }
  })

  await check('[staff, Free] no unknown-identifier path runs bcrypt; it costs what a PBKDF2 account costs; the bcrypt row gap is pinned', async () => {
    for (const state of ['bcrypt', 'none']) {
      warnings.length = 0
      const h = staffHarness({ state, planTier: 'free' })
      const pbkdf2 = await staffSignature(h, 'cur')
      assert.deepEqual(pbkdf2, PBKDF2_FLOOR)
      for (const username of ['nobody-here', 'gone', 'odd']) {
        assert.deepEqual(await staffSignature(h, username), pbkdf2, `[${state}] ${username}`)
      }
      if (state === 'bcrypt') {
        // Residual by design: the real bcrypt check still runs on Free (E6
        // option C), and is padded with the PBKDF2 half; nothing else is.
        assert.deepEqual(await staffSignature(h, 'old'), BCRYPT_FLOOR)
        assert.equal(warnings.filter((w) => /PLAN_TIER=free/.test(w) && /\busers\b/.test(w)).length, 1, `one readiness warning: ${JSON.stringify(warnings)}`)
      } else {
        assert.equal(warnings.filter((w) => /PLAN_TIER=free/.test(w)).length, 0, 'no warning once no active bcrypt row remains')
      }
    }
  })

  await check('[storefront, Paid, bcrypt remains] every failing signin spends the bcrypt floor, the unknown phone included', async () => {
    const out = await portalCase({ state: 'bcrypt' })
    assert.deepEqual(out.bcryptWrong.bcryptCosts, ['10'], 'control: the instrument sees the real bcrypt-10 compare')
    for (const [key, sig] of Object.entries(out)) assert.deepEqual(sig, out.bcryptWrong, `${key} must cost what a wrong password on the bcrypt account costs`)
    assert.deepEqual(out.bcryptWrong, BCRYPT_FLOOR, 'the bcrypt row is padded with the PBKDF2 half')
  })

  await check('[storefront, Paid, none remain] every failing signin spends one PBKDF2 check and no bcrypt', async () => {
    const out = await portalCase({ state: 'none' })
    for (const [key, sig] of Object.entries(out)) assert.deepEqual(sig, PBKDF2_FLOOR, key)
  })

  await check('[storefront, Free] the unknown phone never runs bcrypt and costs what a PBKDF2 account costs', async () => {
    for (const state of ['bcrypt', 'none']) {
      warnings.length = 0
      const out = await portalCase({ state, planTier: 'free' })
      for (const key of ['unknown', 'pbkdf2Wrong', 'pbkdf2WrongName', 'unusable']) assert.deepEqual(out[key], PBKDF2_FLOOR, `[${state}] ${key}`)
      if (state === 'bcrypt') {
        assert.deepEqual(out.bcryptWrong, BCRYPT_FLOOR, 'the residual Free gap, pinned')
        assert.equal(warnings.filter((w) => /PLAN_TIER=free/.test(w) && /portal_accounts/.test(w)).length, 1, JSON.stringify(warnings))
      }
    }
  })

  // ---- the floor decision and its cache (needs the new module) -------------
  const floor = hasFloorModule ? loadReal('lib/failedSignInCost.ts', { './planTier': loadReal('lib/planTier.ts') }) : null

  await check('floor decision table: Paid follows the bcrypt state and fails safe to bcrypt; Free is always PBKDF2', async () => {
    assert.ok(floor, 'lib/failedSignInCost.ts exists')
    assert.equal(floor.chooseFailedSignInFloor('paid', true), 'bcrypt')
    assert.equal(floor.chooseFailedSignInFloor('paid', null), 'bcrypt', 'unknown is bcrypt on Paid')
    assert.equal(floor.chooseFailedSignInFloor('paid', false), 'pbkdf2-sha256')
    for (const remains of [true, null, false]) assert.equal(floor.chooseFailedSignInFloor('free', remains), 'pbkdf2-sha256')
  })

  await check('the bcrypt state costs one SELECT per table per TTL (fake clock), is moved by sign-ins, and a failed read is not cached', async () => {
    assert.ok(floor, 'lib/failedSignInCost.ts exists')
    floor.__resetFailedSignInCostForTests()
    const queries = []
    let answer = { legacy: 1 }
    let throwNext = false
    const fakeDb = { prepare: (sql) => ({ get: async () => { queries.push(sql); if (throwNext) { throwNext = false; throw new Error('D1 down') } return answer } }) }
    const T0 = 1_000_000
    const TTL = floor.LEGACY_STATE_TTL_MS
    assert.ok(TTL >= 60_000 && TTL <= 15 * 60_000, `a short TTL, not per request and not forever: ${TTL}`)
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0), true)
    answer = null
    for (let i = 1; i <= 20; i += 1) assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0 + i * 1000), true, 'cached')
    assert.equal(queries.length, 1, '21 sign-ins inside the TTL: one query')
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0 + TTL + 1), false, 'requeried after the TTL')
    assert.equal(queries.length, 2)
    floor.noteLegacyBcryptSeen('users', T0 + TTL + 2)
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0 + TTL + 3), true, 'a bcrypt row seen by a sign-in marks the table at once')
    assert.equal(queries.length, 2, 'without a query')
    floor.noteLegacyBcryptUpgraded('users')
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0 + TTL + 4), false, 'an upgrade makes the next sign-in ask again')
    assert.equal(queries.length, 3)
    // Per table.
    answer = { legacy: 1 }
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'portal_accounts', T0 + TTL + 5), true)
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0 + TTL + 6), false, 'the tables are cached separately')
    // Fail safe.
    floor.__resetFailedSignInCostForTests()
    throwNext = true
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0), null)
    assert.equal(await floor.failedSignInFloor({}, { prepare: () => ({ get: async () => { throw new Error('D1 down') } }) }, 'portal_accounts'), 'bcrypt', 'unknown -> bcrypt on Paid')
    assert.equal(await floor.legacyBcryptRemains(fakeDb, 'users', T0 + 1), true, 'a failed read was not cached')
    assert.ok(warnings.some((w) => /could not tell whether bcrypt hashes remain in users/.test(w)))
  })

  await check('the bcrypt-state SQL: SELECT-only, LIMIT 1, and counts only rows a sign-in can check', async () => {
    assert.ok(floor, 'lib/failedSignInCost.ts exists')
    const source = fs.readFileSync(path.join(SRC, 'lib', 'failedSignInCost.ts'), 'utf8')
    assert.ok(!/\b(INSERT|UPDATE|DELETE|REPLACE)\b/.test(source), 'no write anywhere in the module')
    for (const sql of Object.values(floor.LEGACY_BCRYPT_SQL)) assert.match(sql, /^SELECT 1 AS legacy FROM \w+ WHERE .* LIMIT 1$/)
    const raw = openDb(loadAll())
    const has = (table) => Boolean(raw.prepare(floor.LEGACY_BCRYPT_SQL[table]).get({}))
    raw.prepare("INSERT INTO users (id, username, name, password, permissions, is_active) VALUES (1, 'a', 'A', @p, '{}', 1)").run({ p: pbkdf2Row('x') })
    raw.prepare("INSERT INTO users (id, username, name, password, permissions, is_active) VALUES (2, 'b', 'B', @p, '{}', 0)").run({ p: BCRYPT_ROW })
    raw.prepare("INSERT INTO users (id, username, name, password, permissions, is_active, deleted_at) VALUES (3, 'c', 'C', @p, '{}', 1, '2026-01-01')").run({ p: BCRYPT_ROW })
    assert.equal(has('users'), false, 'inactive and deleted bcrypt rows cannot be checked at sign-in')
    raw.prepare("INSERT INTO users (id, username, name, password, permissions, is_active) VALUES (4, 'd', 'D', @p, '{}', 1)").run({ p: bcrypt.hashSync('x', 4).replace(/^\$2b\$/, '$2a$') })
    assert.equal(has('users'), true, 'an active $2a$ row counts')
    const f = portalFixture({ state: 'none' })
    await portalAccount(f, 'Plain', '097 200 001')
    assert.equal(Boolean(f.rawDb.prepare(floor.LEGACY_BCRYPT_SQL.portal_accounts).get({})), false)
    await portalAccount(f, 'Old', '097 200 002', bcrypt.hashSync('x', 4).replace(/^\$2b\$/, '$2y$'))
    assert.equal(Boolean(f.rawDb.prepare(floor.LEGACY_BCRYPT_SQL.portal_accounts).get({})), true, 'a $2y$ row counts')
  })

  await check('POST /login: many failed sign-ins in one isolate run the bcrypt-state query once', async () => {
    const h = staffHarness({ state: 'none' })
    for (let i = 0; i < 6; i += 1) await staffSignature(h, i % 2 ? 'cur' : `nobody-${i}`)
    assert.equal(h.legacyQueries.length, 1, `queries: ${h.legacyQueries.length}`)
  })

  await check('the last staff upgrade turns the floor down in this isolate without waiting for the TTL', async () => {
    const h = staffHarness({ state: 'bcrypt' })
    assert.deepEqual(await staffSignature(h, 'nobody-1'), BCRYPT_FLOOR)
    const ok = await h.request('/login', 'POST', { username: 'old', password: 'legacy-pass-1' }, { ip: freshIp() })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.match(h.userRow(904).password, /^\$pbkdf2-sha256\$/)
    assert.deepEqual(await staffSignature(h, 'nobody-2'), PBKDF2_FLOOR, 'no active bcrypt row is left')
  })

  await check('a bcrypt row that reappears (e.g. a restore) raises the floor at its first checked sign-in, not after the TTL', async () => {
    const h = staffHarness({ state: 'none' })
    assert.deepEqual(await staffSignature(h, 'nobody-1'), PBKDF2_FLOOR, 'cached: none remain')
    h.raw.prepare('UPDATE users SET password = @hash WHERE id = 902').run({ hash: BCRYPT_ROW })
    assert.deepEqual(await staffSignature(h, 'odd'), BCRYPT_FLOOR, 'its own bcrypt-10 compare, padded with PBKDF2')
    assert.deepEqual(await staffSignature(h, 'nobody-2'), BCRYPT_FLOOR, 'staff: the next unknown identifier spends the bcrypt floor')
    assert.equal(h.legacyQueries.length, 1, 'without another query')

    const f = portalFixture({ state: 'none' })
    const odd = await portalAccount(f, 'Odd', '097 300 001')
    assert.deepEqual(await portalSignature(f, 'Nobody', '011 999 777'), PBKDF2_FLOOR, 'cached: none remain')
    f.rawDb.prepare('UPDATE portal_accounts SET password_hash = ? WHERE id = ?').run([BCRYPT_ROW, odd.accountId])
    assert.deepEqual(await portalSignature(f, 'Odd', '097300001'), BCRYPT_FLOOR)
    assert.deepEqual(await portalSignature(f, 'Nobody', '011 999 777'), BCRYPT_FLOOR, 'storefront: the next unknown phone spends the bcrypt floor')
  })

  await check('the dummy bcrypt hash is a real cost-10 hash, the cost every pre-E6 writer used', async () => {
    const ph = loadReal('lib/passwordHash.ts')
    assert.match(ph.DUMMY_BCRYPT_HASH, /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/)
    assert.equal(bcrypt.getRounds(ph.DUMMY_BCRYPT_HASH), 10)
  })

  console.warn = realWarn
  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
