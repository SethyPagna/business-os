// Security audit P2-a. POST /auth/password-reset/otp set a new password from
// nothing but an identifier and one six-digit authenticator code, which
// contradicts the owner rule that resets go through the administrator reset
// code (14 Oct 2026). The route is retired: every call answers 410 with a
// stable code and changes nothing, whatever the code or the account.
//
// Drives the REAL routes/auth.ts (harness/load_auth_route.cjs). On the base
// commit a valid code answers 200 and replaces the password hash.
//
// Run: node scripts/test-password-reset-otp-hardening-pure.cjs

const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CODE = 'PASSWORD_RESET_OTP_RETIRED'
let passed = 0
const failures = []
let ipCounter = 0
const freshIp = () => `192.0.2.${++ipCounter % 250}`
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

const reset = (h, identifier, otp) => h.request('/password-reset/otp', 'POST', { identifier, otp, newPassword: 'new-password-1' }, { ip: freshIp() })

async function main() {
  await check('a valid authenticator code answers 410 with the stable code and leaves the password hash alone', async () => {
    const h = seeded()
    const before = h.userRow(701).password
    const res = await reset(h, 'dara', await h.codeAt(SECRET))
    assert.equal(res.status, 410, JSON.stringify(res.body))
    assert.equal(res.body.code, CODE)
    assert.equal(res.body.success, false)
    assert.equal(h.userRow(701).password, before, 'the stored hash is unchanged')
    const login = await h.request('/login', 'POST', { username: 'dara', password: 'old-password' }, { ip: freshIp() })
    assert.equal(login.status, 200, 'the old password still signs in')
  })

  await check('unknown account, account without 2FA and wrong code give the same 410 (no account oracle)', async () => {
    const h = seeded()
    const answers = [
      await reset(h, 'ghost', '000000'),
      await reset(h, 'nootp', '000000'),
      await reset(h, 'dara', '000000'),
    ]
    for (const res of answers) assert.deepEqual({ s: res.status, b: res.body }, { s: 410, b: answers[0].body })
    assert.equal(answers[0].body.code, CODE)
  })

  await check('repeated calls are never rate-limited into a different answer and never lock the account', async () => {
    const h = seeded()
    for (let i = 0; i < 8; i += 1) assert.equal((await reset(h, 'dara', '000000')).status, 410)
    const login = await h.request('/login', 'POST', { username: 'dara', password: 'old-password' }, { ip: freshIp() })
    assert.equal(login.status, 200)
  })

  if (failures.length) {
    console.error(`test-password-reset-otp-hardening-pure.cjs FAILED: ${failures.length} check(s)`)
    process.exit(1)
  }
  console.log(`test-password-reset-otp-hardening-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
