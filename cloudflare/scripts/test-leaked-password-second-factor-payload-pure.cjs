// S-auth4b follow-up. Signing in with a publicly known password marks the
// account must_change_password, and the app shows its forced change screen
// from the flag on the sign-in payload (frontend/src/App.tsx). POST /login
// carried the flag, but an account with an authenticator finishes at
// POST /otp/verify, whose payload did not -- so the app mounted and every
// call answered 403 password_change_required behind it. The flag is read
// from the account, so it also holds on a later sign-in before the change.
//
// Drives the REAL routes/auth.ts against the full migrated schema
// (harness/load_auth_route.cjs, which applies migration 0202).
//
// Run: node scripts/test-leaked-password-second-factor-payload-pure.cjs

const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const LEAKED = 'Admin123456!'
let failures = 0

async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.log(`not ok - ${name}: ${error.message}`) }
}

async function signInWithCode(h, userId, username, password) {
  const first = await h.request('/login', 'POST', { username, password }, { ip: '203.0.113.5' })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.otpRequired, true)
  return h.request('/otp/verify', 'POST', { userId, token: await h.codeAt(SECRET), otpChallenge: first.body.otpChallenge }, { ip: '203.0.113.5' })
}

;(async () => {
  await check('a leaked password finished with an authenticator code: the payload says must change', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 801, username: 'owner', name: 'Owner', password: LEAKED, otpSecret: SECRET })
    const verified = await signInWithCode(h, 801, 'owner', LEAKED)
    assert.equal(verified.status, 200, JSON.stringify(verified.body))
    assert.equal(verified.body.user.must_change_password, 1)
  })

  await check('control: an ordinary password finished with a code is not flagged', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 802, username: 'cashier', name: 'Cashier', password: 'ordinary-password-7', otpSecret: SECRET })
    const verified = await signInWithCode(h, 802, 'cashier', 'ordinary-password-7')
    assert.equal(verified.status, 200, JSON.stringify(verified.body))
    assert.equal(verified.body.user.must_change_password, 0)
  })

  await check('an account already flagged stays flagged on the password-only payload', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 803, username: 'till', name: 'Till', password: 'ordinary-password-8' })
    h.raw.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run([803])
    const res = await h.request('/login', 'POST', { username: 'till', password: 'ordinary-password-8' }, { ip: '203.0.113.6' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.user.must_change_password, 1, 'the flag is the account\'s, not only this sign-in\'s')
  })

  if (failures) { console.log(`${failures} failing`); process.exitCode = 1; return }
  console.log('all ok')
})()
