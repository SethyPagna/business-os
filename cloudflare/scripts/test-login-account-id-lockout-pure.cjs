// P2-1 (Release 1 auth audit). POST /auth/login's per-user rate limit and
// its escalating lockout were keyed only on the TYPED identifier, so every
// alias of one account -- username, email, display name -- had a separate
// allowance: three aliases meant three times the guesses before any wait.
// After the account is resolved, both are now also keyed on its id.
//
// Drives the REAL routes/auth.ts against the full migrated schema
// (harness/load_auth_route.cjs). Fails on a04da325: six failures spread
// two-per-alias never locked the account there, and eight failures spread
// the same way never met the per-account ceiling. The ceiling counts only
// FAILED attempts (test-login-success-not-throttled-pure.cjs).
//
// Run: node scripts/test-login-account-id-lockout-pure.cjs

const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const ALIASES = ['dara', 'dara@shop.test', 'Dara Sok']
let ipCounter = 0
const freshIp = () => `198.51.100.${++ipCounter}`

async function main() {
  await check('failures spread across aliases share ONE escalating lockout', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 601, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password' })
    const answers = []
    for (let i = 0; i < 6; i++) {
      answers.push(await h.request('/login', 'POST', { username: ALIASES[i % 3], password: `wrong-${i}` }, { ip: freshIp() }))
    }
    // Five free attempts in total, not five per alias (6 failures + the
    // check below stay under the 8-per-window limiter, so the lockout is what
    // answers).
    for (let i = 0; i < 5; i++) assert.equal(answers[i].status, 401, `attempt ${i + 1} is a plain wrong-password answer`)
    assert.equal(answers[5].status, 429, 'the 6th failure across aliases must lock the account')
    assert.equal(answers[5].body.locked, true)

    // A locked account gets no password compare through ANY alias, including
    // one that was never typed wrong.
    const fresh = await h.request('/login', 'POST', { username: 'DARA@SHOP.TEST', password: 'right-password' }, { ip: freshIp() })
    assert.equal(fresh.status, 429, 'the correct password through another alias must still wait')
    assert.equal(fresh.body.locked, true)
  })

  await check('the per-account limiter counts failures on every alias against one account', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 602, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password' })
    // Five failures (the lockout's free allowance), then a success, which
    // clears the lockout but not the sliding window, then three more.
    for (let i = 0; i < 5; i++) {
      const res = await h.request('/login', 'POST', { username: ALIASES[i % 3], password: 'wrong' }, { ip: freshIp() })
      assert.equal(res.status, 401)
    }
    assert.equal((await h.request('/login', 'POST', { username: 'dara', password: 'right-password' }, { ip: freshIp() })).status, 200)
    for (let i = 0; i < 3; i++) {
      const res = await h.request('/login', 'POST', { username: ALIASES[i % 3], password: 'wrong' }, { ip: freshIp() })
      assert.equal(res.status, 401, `failure ${6 + i} after the reset is a plain wrong-password answer`)
    }
    // Eight failures on one account, at most three per typed alias: only the
    // account-id bucket is full, and the lockout was cleared by the success.
    const res = await h.request('/login', 'POST', { username: 'DARA@SHOP.TEST', password: 'right-password' }, { ip: freshIp() })
    assert.equal(res.status, 429, 'the account-id ceiling holds whichever alias is typed')
    assert.notEqual(res.body.locked, true, 'answered by the limiter, not the lockout')
  })

  await check('a successful sign-in clears the account-id counter too', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 603, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password' })
    for (let i = 0; i < 2; i++) {
      await h.request('/login', 'POST', { username: ALIASES[i % 3], password: 'wrong' }, { ip: freshIp() })
    }
    const ok = await h.request('/login', 'POST', { username: 'dara', password: 'right-password' }, { ip: freshIp() })
    assert.equal(ok.status, 200)
    const row = h.raw.prepare("SELECT failed_count FROM login_lockouts WHERE username = '#uid:603'").get()
    assert.equal(row, undefined, 'the id-keyed counter is cleared on success')
    // Five fresh free attempts again (2 + 1 + 5 stays inside the limiter;
    // without the clear, the 4th of these would be the 6th failure and lock).
    for (let i = 0; i < 5; i++) {
      const res = await h.request('/login', 'POST', { username: ALIASES[i % 3], password: 'wrong' }, { ip: freshIp() })
      assert.equal(res.status, 401)
    }
  })

  await check('an unknown identifier still feeds (only) its typed-value lockout', async () => {
    const h = createAuthHarness()
    for (let i = 0; i < 6; i++) await h.request('/login', 'POST', { username: 'nobody', password: 'x' }, { ip: freshIp() })
    const res = await h.request('/login', 'POST', { username: 'nobody', password: 'x' }, { ip: freshIp() })
    assert.equal(res.status, 429)
    const idRows = h.raw.prepare("SELECT COUNT(*) AS n FROM login_lockouts WHERE username LIKE '#uid:%'").get()
    assert.equal(idRows.n, 0)
  })

  await check('the OTP second factor feeds and honours the same account-id lockout', async () => {
    const h = createAuthHarness()
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    h.addUser({ id: 604, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password', otpSecret: secret })
    // Five failures via the email alias arm the id key to its limit...
    for (let i = 0; i < 5; i++) await h.request('/login', 'POST', { username: 'dara@shop.test', password: 'wrong' }, { ip: freshIp() })
    // ...the password step via the username (a different typed key) clears
    // the id key only on a correct password, so drive the OTP step instead.
    const first = await h.request('/login', 'POST', { username: 'Dara Sok', password: 'right-password' }, { ip: freshIp() })
    assert.equal(first.status, 200)
    assert.equal(first.body.otpRequired, true)
    for (let i = 0; i < 6; i++) {
      await h.request('/otp/verify', 'POST', { userId: 604, token: '000000', otpChallenge: first.body.otpChallenge }, { ip: freshIp() })
    }
    const idRow = h.raw.prepare("SELECT failed_count FROM login_lockouts WHERE username = '#uid:604'").get()
    assert.ok(idRow && idRow.failed_count >= 6, 'wrong second-factor codes feed the id-keyed lockout')
    const viaEmail = await h.request('/login', 'POST', { username: 'dara@shop.test', password: 'right-password' }, { ip: freshIp() })
    assert.equal(viaEmail.status, 429, 'a lockout earned at the OTP step holds at the password step of every alias')
  })

  console.log(`test-login-account-id-lockout-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-login-account-id-lockout-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
