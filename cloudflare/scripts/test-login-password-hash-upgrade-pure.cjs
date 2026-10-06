// E6 (5 Oct 2026): staff sign-in upgrades a legacy bcrypt hash to the
// current PBKDF2-SHA256 format exactly once, on every plan.
//
// Drives the REAL routes/auth.ts and lib/passwordHash.ts over the full
// migrated schema (harness/load_auth_route.cjs), with the real bcryptjs and
// the real WebCrypto behind counting wrappers. Pins:
//   - a right password on a bcrypt row signs in and rewrites the row; the new
//     row is PBKDF2-HMAC-SHA256 at the current count, recomputed here with
//     node:crypto (a second implementation);
//   - the next sign-in reads the new row: one derivation, no bcrypt, no
//     second rewrite;
//   - a wrong password, an inactive account and a right password on an
//     already-current row never rewrite (a failed sign-in is padded to the
//     failed-sign-in floor -- test-failed-sign-in-cost-pure.cjs -- which is
//     work, not a rewrite);
//   - updated_at (the Users-page edit-conflict token) is untouched;
//   - an OTP account is upgraded at the password step (the password was right);
//   - tier behaviour: with PLAN_TIER=free a legacy row still signs in and is
//     upgraded -- refusing it would lock out whoever has not signed in since
//     the release, the owner included;
//   - parallel sign-ins on one legacy row leave one valid current row;
//   - password reset by OTP writes the current format, and self-service
//     OTP disable checks the password through the same module;
//   - with PASSWORD_PEPPER set, a legacy bcrypt row and an unpeppered PBKDF2
//     row are each rewritten peppered exactly once (recomputed here with
//     node:crypto HMAC + PBKDF2); without it they keep signing in.
//
// Run: node scripts/test-login-password-hash-upgrade-pure.cjs

const assert = require('node:assert/strict')
const nodeCrypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const CURRENT_ITERATIONS = 10000
const compared = []
const countingBcrypt = { ...bcrypt, compareSync: (plain, hash) => { compared.push(String(hash)); return bcrypt.compareSync(plain, hash) } }
const derived = []
const subtle = globalThis.crypto.subtle
const realDeriveBits = subtle.deriveBits.bind(subtle)
subtle.deriveBits = (algorithm, ...rest) => { derived.push(algorithm.iterations); return realDeriveBits(algorithm, ...rest) }

function isCurrentRowFor(row, password) {
  const m = /^\$pbkdf2-sha256\$i=(\d+)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(String(row))
  if (!m || Number(m[1]) !== CURRENT_ITERATIONS) return false
  const key = nodeCrypto.pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(m[2], 'base64'), CURRENT_ITERATIONS, 32, 'sha256')
  return key.toString('base64').replace(/=+$/, '') === m[3]
}

let ipSeq = 0
const freshIp = () => `203.0.113.${(ipSeq += 1) % 250}`
const STAMP = '2026-01-02 03:04:05'
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

function harness({ planTier } = {}) {
  const h = createAuthHarness({ overrides: { bcryptjs: countingBcrypt } })
  if (planTier) h.env.PLAN_TIER = planTier
  h.addUser({ id: 801, username: 'owner', name: 'Owner', password: 'owner-pass-1' })
  h.raw.prepare('UPDATE users SET password = @hash, updated_at = @stamp WHERE id = 801').run({ hash: bcrypt.hashSync('owner-pass-1', 10), stamp: STAMP })
  h.addUser({ id: 802, username: 'away', name: 'Away', password: 'away-pass-1' })
  h.raw.prepare('UPDATE users SET is_active = 0 WHERE id = 802').run({})
  return h
}
const login = (h, username, password) => h.request('/login', 'POST', { username, password }, { ip: freshIp() })

let failures = 0
async function check(name, fn) {
  try { compared.length = 0; derived.length = 0; await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  for (const planTier of ['paid', 'free']) {
    await check(`[${planTier}] a legacy bcrypt row signs in and is rewritten once in the current format`, async () => {
      const h = harness({ planTier })
      const before = h.userRow(801)
      assert.match(before.password, /^\$2[aby]\$10\$/)

      const first = await login(h, 'owner', 'owner-pass-1')
      assert.equal(first.status, 200, JSON.stringify(first.body))
      assert.equal(compared.length, 1, 'one bcrypt compare for the legacy row')
      assert.deepEqual(derived, [CURRENT_ITERATIONS], 'one derivation: the rewrite')
      const after = h.userRow(801)
      assert.ok(isCurrentRowFor(after.password, 'owner-pass-1'), `rewritten as PBKDF2-SHA256 i=${CURRENT_ITERATIONS}: ${after.password}`)
      assert.equal(after.updated_at, STAMP, 'updated_at is not touched by a re-encoding')

      compared.length = 0
      derived.length = 0
      const second = await login(h, 'owner', 'owner-pass-1')
      assert.equal(second.status, 200)
      assert.equal(compared.length, 0, 'no bcrypt once upgraded')
      assert.deepEqual(derived, [CURRENT_ITERATIONS], 'one derivation: the check; no second rewrite')
      assert.equal(h.userRow(801).password, after.password, 'the row is rewritten exactly once')
    })
  }

  await check('a wrong password on a legacy row never rewrites it', async () => {
    const h = harness()
    const before = h.userRow(801).password
    const res = await login(h, 'owner', 'not-the-password')
    assert.equal(res.status, 401)
    assert.equal(h.userRow(801).password, before)
    assert.equal(compared.length, 1, 'the one bcrypt compare is the real check; no bcrypt padding on top')
    assert.deepEqual(derived, [CURRENT_ITERATIONS], 'one derivation: the PBKDF2 half of the failed-sign-in floor (the row is unchanged above)')
  })

  await check('an inactive account with its right password is refused and not rewritten', async () => {
    const h = harness()
    const before = h.userRow(802).password
    const res = await login(h, 'away', 'away-pass-1')
    assert.equal(res.status, 401)
    assert.equal(h.userRow(802).password, before)
    // An active bcrypt row (801) remains, so on Paid the inactive path spends
    // the bcrypt floor: the dummy bcrypt-10 compare plus the dummy PBKDF2.
    assert.equal(compared.length, 1, 'the inactive path spends the dummy bcrypt compare')
    assert.notEqual(compared[0], before, 'never the inactive account\'s own hash')
    assert.match(compared[0], /^\$2b\$10\$/)
    assert.deepEqual(derived, [CURRENT_ITERATIONS])
  })

  await check('an OTP account is upgraded at the password step', async () => {
    const h = createAuthHarness({ overrides: { bcryptjs: countingBcrypt } })
    h.addUser({ id: 803, username: 'otpuser', name: 'Otp User', password: 'otp-pass-12', otpSecret: SECRET })
    const res = await login(h, 'otpuser', 'otp-pass-12')
    assert.equal(res.status, 200)
    assert.equal(res.body.otpRequired, true, JSON.stringify(res.body))
    assert.ok(isCurrentRowFor(h.userRow(803).password, 'otp-pass-12'))
  })

  await check('parallel sign-ins on one legacy row leave one valid current row', async () => {
    const h = harness()
    const results = await Promise.all(Array.from({ length: 4 }, () => login(h, 'owner', 'owner-pass-1')))
    for (const r of results) assert.equal(r.status, 200)
    assert.ok(isCurrentRowFor(h.userRow(801).password, 'owner-pass-1'))
    compared.length = 0
    assert.equal((await login(h, 'owner', 'owner-pass-1')).status, 200)
    assert.equal(compared.length, 0)
  })

  await check('password reset by OTP writes the current format', async () => {
    const h = createAuthHarness({ overrides: { bcryptjs: countingBcrypt } })
    h.addUser({ id: 804, username: 'resetme', name: 'Reset Me', password: 'old-password', otpSecret: SECRET })
    const res = await h.request('/password-reset/otp', 'POST', { identifier: 'resetme', otp: await h.codeAt(SECRET), newPassword: 'brand-new-pass-1' }, { ip: freshIp() })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.ok(isCurrentRowFor(h.userRow(804).password, 'brand-new-pass-1'), h.userRow(804).password)
    compared.length = 0
    assert.equal((await login(h, 'resetme', 'brand-new-pass-1')).status, 200)
    assert.equal(compared.length, 0, 'the new password is never checked with bcrypt')
  })

  await check('self-service OTP disable checks the current password through the module', async () => {
    const h = createAuthHarness({ overrides: { bcryptjs: countingBcrypt } })
    h.addUser({ id: 805, username: 'selfoff', name: 'Self Off', password: 'self-pass-1', otpSecret: SECRET })
    const wrong = await h.request('/otp/disable', 'POST', { userId: 805, password: 'nope-nope' }, { actorId: 805 })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.code, 'incorrect_password')
    const right = await h.request('/otp/disable', 'POST', { userId: 805, password: 'self-pass-1' }, { actorId: 805 })
    assert.equal(right.status, 200, JSON.stringify(right.body))
  })

  await check('with PASSWORD_PEPPER set, bcrypt and unpeppered rows upgrade to peppered exactly once', async () => {
    const PEPPER = '9a1b'.repeat(16)
    const isPepperedRowFor = (row, password) => {
      const m = /^\$pbkdf2-sha256\$i=10000\$p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(String(row))
      if (!m) return false
      const material = nodeCrypto.createHmac('sha256', Buffer.from(PEPPER, 'utf8')).update(Buffer.from(password, 'utf8')).digest()
      return nodeCrypto.pbkdf2Sync(material, Buffer.from(m[1], 'base64'), 10000, 32, 'sha256').toString('base64').replace(/=+$/, '') === m[2]
    }
    const h = harness({ planTier: 'free' })
    h.addUser({ id: 806, username: 'plain', name: 'Plain Row', password: 'plain-pass-1' })
    // No pepper yet: the bcrypt row upgrades to the unpeppered format.
    assert.equal((await login(h, 'plain', 'plain-pass-1')).status, 200)
    assert.ok(isCurrentRowFor(h.userRow(806).password, 'plain-pass-1'), 'without a pepper: unpeppered current row')
    h.env.PASSWORD_PEPPER = PEPPER
    for (const [username, password, id] of [['owner', 'owner-pass-1', 801], ['plain', 'plain-pass-1', 806]]) {
      assert.equal((await login(h, username, password)).status, 200, username)
      const upgraded = h.userRow(id).password
      assert.ok(isPepperedRowFor(upgraded, password), `${username}: peppered row ${upgraded.slice(0, 26)}`)
      compared.length = 0
      derived.length = 0
      assert.equal((await login(h, username, password)).status, 200)
      assert.equal(h.userRow(id).password, upgraded, `${username}: rewritten exactly once`)
      assert.deepEqual(derived, [CURRENT_ITERATIONS], 'one derivation, no rewrite')
      assert.equal(compared.length, 0)
    }
    assert.equal(h.userRow(801).updated_at, STAMP)
    // The pepper removed: peppered rows cannot sign in (the secret must never
    // be lost), unpeppered rows still can.
    delete h.env.PASSWORD_PEPPER
    assert.equal((await login(h, 'owner', 'owner-pass-1')).status, 401)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
