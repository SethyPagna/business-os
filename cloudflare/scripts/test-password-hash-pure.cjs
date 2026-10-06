// lib/passwordHash.ts -- the one password hashing module (E6, Workers Free).
//
// Drives the REAL module with the REAL bcryptjs and Node's WebCrypto, and
// pins:
//   - the stored format, and that it is really PBKDF2-HMAC-SHA256 at the
//     stated count: the key is recomputed with node:crypto pbkdf2Sync, a
//     second implementation, so a module that hashed some other way (or
//     ignored the count) cannot agree with itself;
//   - the new format verifies; a wrong password fails; a tampered key fails;
//   - legacy bcrypt verifies (cost 4 and a real cost 10) and only a RIGHT
//     password asks for a rehash;
//   - nothing else verifies: a plaintext row equal to the password, a stub
//     `hash:<pw>` row, an empty row -- and none of them spends a derivation;
//   - a stored count outside 1,000..100,000 is refused without deriving
//     (a damaged row cannot burn unbounded CPU);
//   - another PBKDF2 count verifies and asks for a rehash;
//   - the unknown-account path spends exactly the work of a current-format
//     check: one importKey, one deriveBits at the same count;
//   - upgradePasswordHash rewrites exactly once (sequential and parallel),
//     never over a password changed in between, leaves updated_at alone,
//     and never throws;
//   - no plan-tier gate: the module reads no PLAN_TIER, so a legacy hash
//     verifies the same on Free as on Paid;
//   - pepper (PASSWORD_PEPPER): a peppered hash is
//     PBKDF2(HMAC-SHA256(pepper, password)) with $p=1$, recomputed here with
//     node:crypto; the right pepper verifies, a wrong or missing one fails;
//     with no pepper configured nothing is locked out (unpeppered and bcrypt
//     rows verify, new rows are written unpeppered, the warning never carries
//     a value); once it is set, unpeppered and bcrypt rows upgrade to
//     peppered exactly once; a short pepper counts as unset; an unknown
//     pepper version is refused without deriving; the dummy path spends the
//     same HMAC + derivation as a real peppered check; scripts/sync-secrets.cjs
//     never pushes PASSWORD_PEPPER.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const nodeCrypto = require('node:crypto')
const ts = require('typescript')
const bcrypt = require('bcryptjs')
const { DatabaseSync } = require('node:sqlite')

const SOURCE = path.join(__dirname, '..', 'src', 'lib', 'passwordHash.ts')
const source = fs.readFileSync(SOURCE, 'utf8')

// Counting WebCrypto: the module's global `crypto` is shadowed by this one.
const calls = { importKey: 0, deriveBits: [], sign: 0 }
const countingCrypto = {
  getRandomValues: (a) => globalThis.crypto.getRandomValues(a),
  subtle: {
    importKey: (...args) => { calls.importKey += 1; return globalThis.crypto.subtle.importKey(...args) },
    deriveBits: (algorithm, ...rest) => { calls.deriveBits.push(algorithm.iterations); return globalThis.crypto.subtle.deriveBits(algorithm, ...rest) },
    sign: (...args) => { calls.sign += 1; return globalThis.crypto.subtle.sign(...args) },
  },
}
function resetCalls() { calls.importKey = 0; calls.deriveBits = []; calls.sign = 0 }

function load() {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: SOURCE,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'crypto', output)(
    (request) => (request === 'bcryptjs' ? bcrypt : require(request)), mod, mod.exports, countingCrypto,
  )
  return mod.exports
}
const ph = load()

const b64 = (bytes) => Buffer.from(bytes).toString('base64').replace(/=+$/, '')
function pbkdf2Row(password, iterations, salt = nodeCrypto.randomBytes(16)) {
  const key = nodeCrypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256')
  return `$pbkdf2-sha256$i=${iterations}$${b64(salt)}$${b64(key)}`
}

async function main() {
  // Format and independent recomputation.
  assert.equal(ph.PASSWORD_HASH_ITERATIONS, 10000)
  const pw = 'correct horse 1'
  const stored = await ph.hashPassword(pw)
  const m = /^\$pbkdf2-sha256\$i=(\d+)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(stored)
  assert.ok(m, `format: ${stored}`)
  assert.equal(Number(m[1]), ph.PASSWORD_HASH_ITERATIONS)
  const salt = Buffer.from(m[2], 'base64')
  assert.equal(salt.length, 16)
  const expected = nodeCrypto.pbkdf2Sync(Buffer.from(pw, 'utf8'), salt, ph.PASSWORD_HASH_ITERATIONS, 32, 'sha256')
  assert.equal(m[3], b64(expected), 'the stored key is PBKDF2-HMAC-SHA256(password, salt, count, 32)')
  assert.notEqual(await ph.hashPassword(pw), stored, 'a fresh random salt every time')
  assert.equal(ph.passwordHashScheme(stored), 'pbkdf2-sha256')
  assert.ok(stored.startsWith(ph.currentPasswordHashPrefix(undefined)), 'the readiness prefix matches what hashPassword writes')
  assert.equal(ph.isCurrentPasswordHash(stored), true)
  assert.equal(ph.isCurrentPasswordHash(pbkdf2Row(pw, 20000)), false, 'another count is not current')
  assert.equal(ph.isCurrentPasswordHash(bcrypt.hashSync(pw, 4)), false)
  assert.equal(ph.isCurrentPasswordHash(`${ph.currentPasswordHashPrefix(undefined)}garbage`), false, 'a prefix alone is not a hash')

  // New format.
  assert.deepEqual(await ph.verifyPassword(pw, stored), { ok: true, needsRehash: false, scheme: 'pbkdf2-sha256' })
  assert.deepEqual(await ph.verifyPassword('correct horse 2', stored), { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' })
  assert.equal((await ph.verifyPassword('', stored)).ok, false)
  const tamperedKey = Buffer.from(m[3], 'base64'); tamperedKey[31] ^= 1
  assert.equal((await ph.verifyPassword(pw, `$pbkdf2-sha256$i=${m[1]}$${m[2]}$${b64(tamperedKey)}`)).ok, false, 'one flipped bit fails')
  // Khmer and other non-ASCII passwords hash their UTF-8 bytes, as bcryptjs did.
  const khmer = 'ពាក្យសម្ងាត់១២'
  const khmerRow = await ph.hashPassword(khmer)
  assert.equal((await ph.verifyPassword(khmer, khmerRow)).ok, true)
  assert.equal((await ph.verifyPassword(khmer.normalize('NFD') + 'x', khmerRow)).ok, false)
  assert.equal((await ph.verifyPassword(pw, pbkdf2Row(pw, 10000))).ok, true, 'a row written by another PBKDF2 implementation verifies')

  // Legacy bcrypt.
  for (const cost of [4, 10]) {
    const legacy = bcrypt.hashSync(pw, cost)
    assert.equal(ph.passwordHashScheme(legacy), 'bcrypt')
    resetCalls()
    assert.deepEqual(await ph.verifyPassword(pw, legacy), { ok: true, needsRehash: true, scheme: 'bcrypt' }, `bcrypt cost ${cost} verifies and asks for a rehash`)
    assert.deepEqual(await ph.verifyPassword('wrong-password', legacy), { ok: false, needsRehash: false, scheme: 'bcrypt' }, `bcrypt cost ${cost}: wrong fails, no rehash`)
    assert.equal(calls.deriveBits.length, 0, 'a bcrypt row spends no PBKDF2')
  }
  assert.equal((await ph.verifyPassword(pw, bcrypt.hashSync(pw, 4).replace('$2b$', '$2a$'))).ok, true, '$2a$ rows from older libraries verify')

  // Nothing else verifies, and nothing else spends CPU.
  resetCalls()
  for (const row of [pw, `hash:${pw}`, '', null, undefined, '$pbkdf2-sha256$i=10000$short$short', `$pbkdf2-sha512$i=10000$${m[2]}$${m[3]}`]) {
    assert.deepEqual(await ph.verifyPassword(pw, row), { ok: false, needsRehash: false, scheme: 'unknown' }, `refused: ${String(row)}`)
  }
  assert.equal(calls.deriveBits.length, 0)
  assert.equal(calls.importKey, 0)

  // Stored count bounds.
  resetCalls()
  for (const iterations of [999, 100001, 9999999]) {
    const row = `$pbkdf2-sha256$i=${iterations}$${m[2]}$${m[3]}`
    assert.deepEqual(await ph.verifyPassword(pw, row), { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' }, `count ${iterations} refused`)
  }
  assert.equal(calls.deriveBits.length, 0, 'an out-of-range count never derives')
  for (const iterations of [1000, 20000, 100000]) {
    const row = pbkdf2Row(pw, iterations)
    assert.deepEqual(await ph.verifyPassword(pw, row), { ok: true, needsRehash: iterations !== 10000, scheme: 'pbkdf2-sha256' }, `count ${iterations}`)
    assert.equal((await ph.verifyPassword('nope-nope', row)).needsRehash, false, 'a wrong password never asks for a rehash')
  }

  // Unknown-account path: the same work as one current-format check.
  resetCalls()
  await ph.verifyPassword('anything-at-all', stored)
  const realCheck = { importKey: calls.importKey, deriveBits: [...calls.deriveBits] }
  resetCalls()
  assert.equal(await ph.spendDummyPasswordVerify('anything-at-all'), undefined)
  assert.deepEqual({ importKey: calls.importKey, deriveBits: [...calls.deriveBits] }, realCheck)
  assert.deepEqual(realCheck, { importKey: 1, deriveBits: [ph.PASSWORD_HASH_ITERATIONS] })
  // The PBKDF2 dummy itself never runs bcrypt; the bcrypt padding of a failed
  // sign-in lives in spendFailedSignInFloor, behind its floor
  // (test-failed-sign-in-cost-pure.cjs).
  const dummyStart = source.indexOf('export async function spendDummyPasswordVerify')
  const dummyBody = source.slice(dummyStart, source.indexOf('\nexport ', dummyStart + 1))
  assert.ok(dummyBody.includes('constantTimeEqual(actual, DUMMY_KEY)'), 'the slice is the dummy body')
  assert.ok(!/bcrypt\.(compare|hash)/.test(dummyBody), 'the dummy path never runs bcrypt')

  // Upgrade: exactly once, compare-and-set, updated_at untouched, never throws.
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, password TEXT, updated_at TEXT);
    CREATE TABLE portal_accounts (id INTEGER PRIMARY KEY, password_hash TEXT, updated_at TEXT);`)
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return { run: async (params) => { await new Promise((r) => setImmediate(r)); const info = stmt.run(params); return { changes: Number(info.changes) } } }
    },
  }
  const legacyRow = bcrypt.hashSync(pw, 4)
  sqlite.prepare("INSERT INTO users (id, password, updated_at) VALUES (1, ?, '2026-01-01 00:00:00')").run(legacyRow)
  assert.equal(await ph.upgradePasswordHash(db, 'users', 1, pw, legacyRow), true, 'first upgrade rewrites')
  const upgraded = sqlite.prepare('SELECT password, updated_at FROM users WHERE id = 1').get()
  assert.equal(ph.passwordHashScheme(upgraded.password), 'pbkdf2-sha256')
  assert.equal((await ph.verifyPassword(pw, upgraded.password)).ok, true, 'the rewritten row verifies the same password')
  assert.equal(upgraded.updated_at, '2026-01-01 00:00:00', 'updated_at (the edit-conflict token) is untouched')
  assert.equal(await ph.upgradePasswordHash(db, 'users', 1, pw, legacyRow), false, 'a second upgrade from the old value changes nothing')
  assert.equal(sqlite.prepare('SELECT password FROM users WHERE id = 1').get().password, upgraded.password)

  const raceRow = bcrypt.hashSync(pw, 4)
  sqlite.prepare("INSERT INTO portal_accounts (id, password_hash, updated_at) VALUES (7, ?, 'x')").run(raceRow)
  const results = await Promise.all(Array.from({ length: 6 }, () => ph.upgradePasswordHash(db, 'portal_accounts', 7, pw, raceRow)))
  assert.equal(results.filter(Boolean).length, 1, `six racing upgrades rewrite exactly once: ${results}`)
  assert.equal(ph.passwordHashScheme(sqlite.prepare('SELECT password_hash FROM portal_accounts WHERE id = 7').get().password_hash), 'pbkdf2-sha256')

  const changedMeanwhile = await ph.hashPassword('a-new-password')
  sqlite.prepare("INSERT INTO users (id, password, updated_at) VALUES (2, ?, 'y')").run(changedMeanwhile)
  assert.equal(await ph.upgradePasswordHash(db, 'users', 2, pw, legacyRow), false, 'a password changed in between is never overwritten')
  assert.equal(sqlite.prepare('SELECT password FROM users WHERE id = 2').get().password, changedMeanwhile)

  const warn = console.warn
  console.warn = () => {}
  try {
    const broken = { prepare() { return { run: async () => { throw new Error('D1 unavailable') } } } }
    assert.equal(await ph.upgradePasswordHash(broken, 'users', 1, pw, legacyRow), false, 'a failed upgrade answers false, never throws')
  } finally {
    console.warn = warn
  }
  assert.ok(!/UPDATE[^']*updated_at/.test(source), 'no upgrade statement writes updated_at')

  // Every writer and verifier goes through this module: no other Worker
  // source imports bcryptjs or calls its hash/compare (a new writer that
  // did would write cost-10 bcrypt rows the Free plan cannot check).
  const srcRoot = path.join(__dirname, '..', 'src')
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|js|mjs|cjs)$/.test(entry.name) && full !== SOURCE) {
        const text = fs.readFileSync(full, 'utf8')
        if (/from ['"]bcryptjs['"]|require\(['"]bcryptjs['"]\)|\b(hashSync|compareSync|genSaltSync)\(/.test(text)) offenders.push(path.relative(srcRoot, full))
      }
    }
  }
  walk(srcRoot)
  assert.deepEqual(offenders, [], `bcryptjs used outside lib/passwordHash.ts: ${offenders.join(', ')}`)

  // No plan-tier gate anywhere in the module; the only env key it names is the pepper secret.
  const code = source.replace(/\/\/.*$/gm, '')
  assert.ok(!/PLAN_TIER|planTier|getPlanLimits/.test(code), 'the module reads no plan tier')
  assert.deepEqual([...new Set(code.match(/'[A-Z][A-Z0-9]*_[A-Z0-9_]+'/g) || [])], ["'PASSWORD_PEPPER'"], 'PASSWORD_PEPPER is the only env key')

  await pepperChecks()

  console.log('test-password-hash-pure: all assertions passed')
}

async function pepperChecks() {
  // A fresh module instance: its warn-once flag has not fired yet.
  const ph = load()
  const PEPPER = 'a3f1'.repeat(16)
  const OTHER = '0b7e'.repeat(16)
  const withPepper = { PASSWORD_PEPPER: PEPPER, PLAN_TIER: 'free' }
  const otherPepper = { PASSWORD_PEPPER: OTHER }
  const noPepper = { PLAN_TIER: 'free' }
  const shortPepper = { PASSWORD_PEPPER: 'too-short-to-trust' }
  const pw = 'peppered pass 7'
  const independent = (password, pepper, salt, iterations) => {
    const material = pepper ? nodeCrypto.createHmac('sha256', Buffer.from(pepper, 'utf8')).update(Buffer.from(password, 'utf8')).digest() : Buffer.from(password, 'utf8')
    return b64(nodeCrypto.pbkdf2Sync(material, salt, iterations, 32, 'sha256'))
  }

  // Status.
  assert.deepEqual(ph.passwordPepperStatus(withPepper), { configured: true, version: 1 })
  assert.deepEqual(ph.passwordPepperStatus(noPepper), { configured: false, version: null })
  assert.deepEqual(ph.passwordPepperStatus(shortPepper), { configured: false, version: null }, 'a pepper under 32 characters counts as unset')
  assert.deepEqual(ph.passwordPepperStatus(undefined), { configured: false, version: null })

  // Format and independent recomputation.
  const peppered = await ph.hashPassword(pw, withPepper)
  const m = /^\$pbkdf2-sha256\$i=10000\$p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(peppered)
  assert.ok(m, `peppered format: ${peppered}`)
  assert.equal(m[2], independent(pw, PEPPER, Buffer.from(m[1], 'base64'), 10000), 'key = PBKDF2(HMAC-SHA256(pepper, password), salt, 10000, 32)')
  assert.notEqual(m[2], independent(pw, null, Buffer.from(m[1], 'base64'), 10000), 'and not the unpeppered key')
  assert.ok(peppered.startsWith(ph.currentPasswordHashPrefix(withPepper)))
  assert.equal(ph.isCurrentPasswordHash(peppered, withPepper), true)
  assert.equal(ph.isCurrentPasswordHash(peppered, noPepper), false)
  assert.deepEqual(ph.describePasswordHash(peppered), { scheme: 'pbkdf2-sha256', iterations: 10000, pepperVersion: 1 })

  // Verify: right pepper, wrong pepper, missing pepper.
  assert.deepEqual(await ph.verifyPassword(pw, peppered, withPepper), { ok: true, needsRehash: false, scheme: 'pbkdf2-sha256' })
  assert.equal((await ph.verifyPassword('peppered pass 8', peppered, withPepper)).ok, false)
  assert.equal((await ph.verifyPassword(pw, peppered, otherPepper)).ok, false, 'a wrong pepper fails')
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    resetCalls()
    assert.deepEqual(await ph.verifyPassword(pw, peppered, noPepper), { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' }, 'a peppered row cannot verify without its secret')
    assert.equal(calls.deriveBits.length, 0)
    resetCalls()
    const v2 = peppered.replace('$p=1$', '$p=2$')
    assert.deepEqual(await ph.verifyPassword(pw, v2, withPepper), { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' }, 'an unknown pepper version is refused')
    assert.equal(calls.deriveBits.length, 0, 'without deriving')

    // Missing pepper never locks anyone out.
    const unpeppered = await ph.hashPassword(pw, noPepper)
    assert.match(unpeppered, /^\$pbkdf2-sha256\$i=10000\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/, 'unset pepper: written unpeppered')
    assert.match(await ph.hashPassword(pw, shortPepper), /^\$pbkdf2-sha256\$i=10000\$[A-Za-z0-9+/]{22}\$/, 'short pepper: written unpeppered')
    assert.deepEqual(await ph.verifyPassword(pw, unpeppered, noPepper), { ok: true, needsRehash: false, scheme: 'pbkdf2-sha256' }, 'no rehash churn while unset')
    assert.deepEqual(await ph.verifyPassword(pw, bcrypt.hashSync(pw, 4), noPepper), { ok: true, needsRehash: true, scheme: 'bcrypt' })
    assert.equal(ph.isCurrentPasswordHash(unpeppered, noPepper), true)
    assert.equal(ph.isCurrentPasswordHash(unpeppered, withPepper), false)
    const joined = warnings.join('\n')
    assert.match(joined, /PASSWORD_PEPPER is not set/, 'a missing pepper is logged')
    assert.ok(!joined.includes(PEPPER) && !joined.includes(OTHER) && !joined.includes('too-short-to-trust'), 'no warning carries a secret value')
    assert.equal(warnings.filter((w) => /PASSWORD_PEPPER is not set/.test(w)).length, 1, 'the missing-pepper warning is logged once per isolate')

    // Upgrade unpeppered -> peppered, and bcrypt -> peppered, exactly once.
    assert.deepEqual(await ph.verifyPassword(pw, unpeppered, withPepper), { ok: true, needsRehash: true, scheme: 'pbkdf2-sha256' }, 'unpeppered rows still verify once the pepper is set, and ask for a rehash')
    assert.equal((await ph.verifyPassword('wrong-one-1', unpeppered, withPepper)).needsRehash, false)
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, password TEXT, updated_at TEXT)')
    const db = { prepare(sql) { const stmt = sqlite.prepare(sql); return { run: async (p) => { await new Promise((r) => setImmediate(r)); return { changes: Number(stmt.run(p).changes) } } } } }
    const legacy = bcrypt.hashSync(pw, 4)
    sqlite.prepare("INSERT INTO users (id, password, updated_at) VALUES (1, ?, 'u'), (2, ?, 'u')").run(unpeppered, legacy)
    for (const [id, previous] of [[1, unpeppered], [2, legacy]]) {
      const raced = await Promise.all(Array.from({ length: 4 }, () => ph.upgradePasswordHash(db, 'users', id, pw, previous, withPepper)))
      assert.equal(raced.filter(Boolean).length, 1, `row ${id}: rewritten exactly once`)
      const row = sqlite.prepare('SELECT password, updated_at FROM users WHERE id = ?').get(id)
      assert.equal(ph.describePasswordHash(row.password).pepperVersion, 1, `row ${id} is now peppered`)
      assert.equal(row.updated_at, 'u')
      assert.deepEqual(await ph.verifyPassword(pw, row.password, withPepper), { ok: true, needsRehash: false, scheme: 'pbkdf2-sha256' }, 'and current: no second rewrite')
    }
  } finally {
    console.warn = warn
  }

  // Dummy path with a pepper: the same calls as a real peppered check.
  resetCalls()
  await ph.verifyPassword('anything-else-1', peppered, withPepper)
  const real = { importKey: calls.importKey, sign: calls.sign, deriveBits: [...calls.deriveBits] }
  resetCalls()
  await ph.spendDummyPasswordVerify('anything-else-1', withPepper)
  assert.deepEqual({ importKey: calls.importKey, sign: calls.sign, deriveBits: [...calls.deriveBits] }, real)
  assert.deepEqual(real, { importKey: 2, sign: 1, deriveBits: [10000] })

  // The deploy-time secret sync must never push a local pepper over production's.
  const syncSecrets = fs.readFileSync(path.join(__dirname, 'sync-secrets.cjs'), 'utf8')
  assert.ok(!syncSecrets.includes('PASSWORD_PEPPER'), 'scripts/sync-secrets.cjs never pushes PASSWORD_PEPPER')
}

main().catch((error) => { console.error(error); process.exit(1) })
