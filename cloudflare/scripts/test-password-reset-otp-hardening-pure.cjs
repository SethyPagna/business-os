// P1-1 (Release 1 auth audit). POST /auth/password-reset/otp sets a new
// password from nothing but an identifier and a six-digit TOTP code. Before
// the fix it:
//   - rate-limited only on `<ip>:<raw typed identifier>`, so letter case,
//     email-vs-username, or a new IP each bought a fresh 10 guesses;
//   - fed no lockout;
//   - accepted the same code again for its whole validity window;
//   - answered "unknown account" / "no 2FA" (400 Invalid reset request)
//     differently from "wrong code" (401 Invalid OTP code).
//
// Drives the REAL routes/auth.ts (harness/load_auth_route.cjs). Every check
// below fails on a04da325.
//
// Run: node scripts/test-password-reset-otp-hardening-pure.cjs

const assert = require('node:assert/strict')
const bcrypt = require('bcryptjs')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
let passed = 0
const failures = []
let ipCounter = 0
const freshIp = () => `192.0.2.${++ipCounter % 250}`
// Runs every check even after a failure, so a run at the pre-fix commit
// shows each one failing on its own.
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

function seeded() {
  const h = createAuthHarness()
  h.addUser({ id: 701, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'old-password', otpSecret: SECRET })
  h.addUser({ id: 702, username: 'nootp', name: 'No Otp', email: 'nootp@shop.test', password: 'old-password' })
  return h
}

async function wrongCode(h) {
  const good = await h.codeAt(SECRET)
  return good === '000000' ? '111111' : '000000'
}

async function main() {
  await check('unknown account, account without 2FA and wrong code get one identical answer', async () => {
    const h = seeded()
    const bad = await wrongCode(h)
    const unknown = await h.request('/password-reset/otp', 'POST', { identifier: 'ghost', otp: bad, newPassword: 'new-password-1' }, { ip: freshIp() })
    const noOtp = await h.request('/password-reset/otp', 'POST', { identifier: 'nootp', otp: bad, newPassword: 'new-password-1' }, { ip: freshIp() })
    const wrong = await h.request('/password-reset/otp', 'POST', { identifier: 'dara', otp: bad, newPassword: 'new-password-1' }, { ip: freshIp() })
    assert.deepEqual({ s: unknown.status, b: unknown.body }, { s: wrong.status, b: wrong.body }, 'unknown account must look like a wrong code')
    assert.deepEqual({ s: noOtp.status, b: noOtp.body }, { s: wrong.status, b: wrong.body }, 'an account without 2FA must look like a wrong code')
    assert.equal(wrong.status, 401)
  })

  await check('rotating case, alias and IP does not reset the per-account ceiling', async () => {
    const h = seeded()
    const bad = await wrongCode(h)
    const identifiers = ['dara', 'DARA', 'dara@shop.test', 'Dara@Shop.Test', ' dara ', 'DaRa']
    const statuses = []
    for (const identifier of identifiers) {
      const res = await h.request('/password-reset/otp', 'POST', { identifier, otp: bad, newPassword: 'new-password-1' }, { ip: freshIp() })
      statuses.push(res.status)
    }
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401])
    assert.equal(statuses[5], 429, 'the 6th guess at one account inside 15 minutes is refused whatever is typed')
    // Even the RIGHT code is refused now -- the attacker cannot finish.
    const good = await h.codeAt(SECRET)
    const res = await h.request('/password-reset/otp', 'POST', { identifier: 'dara@shop.test', otp: good, newPassword: 'new-password-1' }, { ip: freshIp() })
    assert.equal(res.status, 429)
    assert.ok(bcrypt.compareSync('old-password', h.userRow(701).password), 'the password did not change')
  })

  await check('a per-IP ceiling holds across many accounts', async () => {
    const h = seeded()
    const bad = await wrongCode(h)
    let last
    for (let i = 0; i < 26; i++) {
      last = await h.request('/password-reset/otp', 'POST', { identifier: `probe-${i}`, otp: bad, newPassword: 'new-password-1' }, { ip: '198.18.0.1' })
    }
    assert.equal(last.status, 429)
  })

  await check('failed reset codes feed the sign-in lockout by account id', async () => {
    const h = seeded()
    const bad = await wrongCode(h)
    for (const identifier of ['dara', 'dara@shop.test', 'DARA', 'Dara@shop.test', 'dara']) {
      await h.request('/password-reset/otp', 'POST', { identifier, otp: bad, newPassword: 'new-password-1' }, { ip: freshIp() })
    }
    const login = await h.request('/login', 'POST', { username: 'Dara Sok', password: 'wrong' }, { ip: freshIp() })
    assert.equal(login.status, 429, 'the 6th failure against the account (5 at reset + 1 at login) locks it')
    assert.equal(login.body.locked, true)
  })

  await check('a code is spent once: the same step cannot reset twice, nor follow a sign-in', async () => {
    const h = seeded()
    const good = await h.codeAt(SECRET)
    const first = await h.request('/password-reset/otp', 'POST', { identifier: 'dara', otp: good, newPassword: 'new-password-1' }, { ip: freshIp() })
    assert.equal(first.status, 200)
    assert.equal(first.body.success, true)
    assert.ok(bcrypt.compareSync('new-password-1', h.userRow(701).password))

    const replay = await h.request('/password-reset/otp', 'POST', { identifier: 'dara@shop.test', otp: good, newPassword: 'attacker-password' }, { ip: freshIp() })
    assert.equal(replay.status, 401, 'the replayed code is refused')
    assert.equal(replay.body.error, (await h.request('/password-reset/otp', 'POST', { identifier: 'ghost', otp: good, newPassword: 'x-password-1' }, { ip: freshIp() })).body.error)
    assert.ok(bcrypt.compareSync('new-password-1', h.userRow(701).password), 'the replay did not change the password')

    // Same guard across endpoints: a code used to sign in cannot then reset.
    const h2 = seeded()
    const code = await h2.codeAt(SECRET)
    const step1 = await h2.request('/login', 'POST', { username: 'dara', password: 'old-password' }, { ip: freshIp() })
    const verify = await h2.request('/otp/verify', 'POST', { userId: 701, token: code, otpChallenge: step1.body.otpChallenge }, { ip: freshIp() })
    assert.equal(verify.status, 200)
    const afterLogin = await h2.request('/password-reset/otp', 'POST', { identifier: 'dara', otp: code, newPassword: 'attacker-password' }, { ip: freshIp() })
    assert.equal(afterLogin.status, 401, 'a code spent on sign-in is refused at reset')
  })

  await check('a genuine reset succeeds and clears the lockout it accumulated', async () => {
    const h = seeded()
    const bad = await wrongCode(h)
    for (let i = 0; i < 3; i++) await h.request('/password-reset/otp', 'POST', { identifier: 'dara', otp: bad, newPassword: 'new-password-1' }, { ip: freshIp() })
    const ok = await h.request('/password-reset/otp', 'POST', { identifier: 'DARA', otp: await h.codeAt(SECRET), newPassword: 'new-password-1' }, { ip: freshIp() })
    assert.equal(ok.status, 200)
    assert.equal(h.raw.prepare("SELECT COUNT(*) AS n FROM login_lockouts WHERE username = '#uid:701'").get().n, 0)
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-password-reset-otp-hardening-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-password-reset-otp-hardening-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
