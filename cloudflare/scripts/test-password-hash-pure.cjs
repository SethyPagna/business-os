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
//   - no plan-tier gate: the module reads no env and no PLAN_TIER, so a
//     legacy hash verifies the same on Free as on Paid.

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
const calls = { importKey: 0, deriveBits: [] }
const countingCrypto = {
  getRandomValues: (a) => globalThis.crypto.getRandomValues(a),
  subtle: {
    importKey: (...args) => { calls.importKey += 1; return globalThis.crypto.subtle.importKey(...args) },
    deriveBits: (algorithm, ...rest) => { calls.deriveBits.push(algorithm.iterations); return globalThis.crypto.subtle.deriveBits(algorithm, ...rest) },
  },
}
function resetCalls() { calls.importKey = 0; calls.deriveBits = [] }

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
  assert.ok(stored.startsWith(ph.CURRENT_PASSWORD_HASH_PREFIX), 'the readiness prefix matches what hashPassword writes')
  assert.equal(ph.isCurrentPasswordHash(stored), true)
  assert.equal(ph.isCurrentPasswordHash(pbkdf2Row(pw, 20000)), false, 'another count is not current')
  assert.equal(ph.isCurrentPasswordHash(bcrypt.hashSync(pw, 4)), false)
  assert.equal(ph.isCurrentPasswordHash(`${ph.CURRENT_PASSWORD_HASH_PREFIX}garbage`), false, 'a prefix alone is not a hash')

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
  assert.ok(!/bcrypt\.(compare|hash)/.test(source.slice(source.indexOf('export async function spendDummyPasswordVerify'))), 'the dummy path never runs bcrypt')

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

  // No plan-tier gate anywhere in the module.
  assert.ok(!/PLAN_TIER|planTier|getPlanLimits|env\b/.test(source.replace(/\/\/.*$/gm, '')), 'the module reads no env and no plan tier')

  console.log('test-password-hash-pure: all assertions passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
