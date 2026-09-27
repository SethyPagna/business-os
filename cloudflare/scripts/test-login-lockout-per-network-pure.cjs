// S-auth4d: sign-in lockout denial of service.
//
// The escalating lockout (lib/loginLockout.ts) and the per-account sliding
// limiter were keyed on the account alone, so ANYONE who knew a username
// could fail it six times from anywhere and the owner, typing the right
// password at the shop, waited -- and one failure every 30 minutes kept the
// wait armed forever. Also /otp/verify spent its per-user allowance before
// checking the sign-in challenge, so ten garbage calls naming a user id
// blocked that user's second factor without knowing any password.
//
// Now the lockout and the per-account limiter are scoped to the network
// (account + IP): the attacker's network waits, the owner's does not. What
// still spans networks is a much higher account-wide failure ceiling
// (LOGIN_ACCOUNT_WIDE_MAX), so guessing spread over many IPs stays bounded.
//
// Drives the REAL routes/auth.ts against the full migrated schema
// (harness/load_auth_route.cjs).
//
// Run: node scripts/test-login-lockout-per-network-pure.cjs

const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    process.exitCode = 1
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

const ATTACKER = '198.51.100.66'
const OWNER = '203.0.113.10'

async function main() {
  await check('failures from one network lock that network, not the owner elsewhere', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 701, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password' })
    const answers = []
    for (let i = 0; i < 7; i++) {
      answers.push(await h.request('/login', 'POST', { username: i % 2 ? 'owner@shop.test' : 'owner', password: `wrong-${i}` }, { ip: ATTACKER }))
    }
    for (let i = 0; i < 5; i++) assert.equal(answers[i].status, 401, `attempt ${i + 1} is a plain wrong-password answer`)
    assert.equal(answers[5].status, 429, 'the attacker network is locked on its 6th failure')
    assert.equal(answers[5].body.locked, true)
    // The attacker's network stays locked even with the right password.
    const attackerRight = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: ATTACKER })
    assert.equal(attackerRight.status, 429, 'the locked network gets no password compare')

    // The owner, on another network, signs in.
    const owner = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: OWNER })
    assert.equal(owner.status, 200, 'a victim on another network is not locked out by the attacker')
    assert.ok(!owner.body.locked)
  })

  await check('the per-account sliding limiter is per network too', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 702, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password' })
    // 8 failures from the attacker (the per-account limiter's allowance).
    for (let i = 0; i < 8; i++) await h.request('/login', 'POST', { username: 'owner', password: 'wrong' }, { ip: ATTACKER })
    const owner = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: OWNER })
    assert.equal(owner.status, 200, 'the per-account limiter filled from one network does not refuse another')
  })

  await check('aliases still share one lockout within a network (P2-1 kept)', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 703, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password' })
    const aliases = ['dara', 'dara@shop.test', 'Dara Sok']
    const answers = []
    for (let i = 0; i < 6; i++) answers.push(await h.request('/login', 'POST', { username: aliases[i % 3], password: 'wrong' }, { ip: ATTACKER }))
    assert.equal(answers[5].status, 429, 'six failures across three aliases lock the account on that network')
    const viaOtherAlias = await h.request('/login', 'POST', { username: 'DARA@SHOP.TEST', password: 'right-password' }, { ip: ATTACKER })
    assert.equal(viaOtherAlias.status, 429)
  })

  await check('guessing spread over many networks meets the account-wide ceiling', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 704, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password' })
    let refusedAt = 0
    for (let i = 0; i < 80; i++) {
      // Four failures per network: under both per-network allowances.
      const ip = `192.0.2.${Math.floor(i / 4) + 1}`
      const res = await h.request('/login', 'POST', { username: 'owner', password: 'wrong' }, { ip })
      if (res.status === 429) { refusedAt = i + 1; break }
      assert.equal(res.status, 401)
    }
    assert.ok(refusedAt > 8, `the ceiling is not the per-network allowance (refused at ${refusedAt})`)
    assert.ok(refusedAt > 0 && refusedAt <= 41, `distributed guessing is bounded account-wide (refused at ${refusedAt})`)
    // A fresh network with the right password is refused while it is full:
    // the ceiling bounds guessing, it is not a per-network lock.
    const fresh = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: '192.0.2.200' })
    assert.equal(fresh.status, 429)
  })

  await check('a success clears only its own network, and success does not spend the ceiling', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 705, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password' })
    for (let i = 0; i < 6; i++) await h.request('/login', 'POST', { username: 'owner', password: 'wrong' }, { ip: ATTACKER })
    assert.equal((await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: OWNER })).status, 200)
    // The owner's success does not unlock the attacker's network.
    assert.equal((await h.request('/login', 'POST', { username: 'owner', password: 'wrong' }, { ip: ATTACKER })).status, 429)
    // Fifty successful sign-ins (a shared till) never fill the ceiling.
    for (let i = 0; i < 50; i++) {
      assert.equal((await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: `192.0.2.${i + 1}` })).status, 200)
    }
  })

  await check('failed authenticator codes lock that network only', async () => {
    const h = createAuthHarness()
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    h.addUser({ id: 706, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password', otpSecret: secret })
    const first = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: ATTACKER })
    assert.equal(first.body.otpRequired, true)
    for (let i = 0; i < 6; i++) {
      await h.request('/otp/verify', 'POST', { userId: 706, token: '000000', otpChallenge: first.body.otpChallenge }, { ip: ATTACKER })
    }
    const owner = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: OWNER })
    assert.equal(owner.status, 200)
    assert.equal(owner.body.otpRequired, true, 'the owner reaches the second factor from their own network')
  })

  await check('/otp/verify: calls without a live challenge do not spend the user\'s allowance', async () => {
    const h = createAuthHarness()
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    h.addUser({ id: 707, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password', otpSecret: secret })
    for (let i = 0; i < 12; i++) {
      const res = await h.request('/otp/verify', 'POST', { userId: 707, token: '000000', otpChallenge: `forged-${i}` }, { ip: `198.51.100.${i + 1}` })
      assert.equal(res.status, 401, 'no live challenge: refused as expired, not rate limited')
    }
    const first = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: OWNER })
    assert.equal(first.body.otpRequired, true)
    const verified = await h.request('/otp/verify', 'POST', { userId: 707, token: await h.codeAt(secret), otpChallenge: first.body.otpChallenge }, { ip: OWNER })
    assert.equal(verified.status, 200, 'the owner\'s real code still works after forged calls')
    assert.ok(verified.body.token || verified.body.user || verified.body.success !== false)
  })

  await check('/password-reset/otp failures do not lock the owner\'s sign-in from another network', async () => {
    const h = createAuthHarness()
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    h.addUser({ id: 708, username: 'owner', name: 'Owner', email: 'owner@shop.test', password: 'right-password', otpSecret: secret })
    // Five reset failures (its own per-account bucket stops at five) and one
    // sign-in failure: six on the account, all from the attacker's network.
    await h.request('/login', 'POST', { username: 'owner', password: 'wrong' }, { ip: ATTACKER })
    for (let i = 0; i < 5; i++) {
      await h.request('/password-reset/otp', 'POST', { identifier: 'owner', otp: '000000', newPassword: 'another-password-9' }, { ip: ATTACKER })
    }
    const owner = await h.request('/login', 'POST', { username: 'owner', password: 'right-password' }, { ip: OWNER })
    assert.equal(owner.status, 200)
    assert.equal(owner.body.otpRequired, true)
  })

  console.log(`test-login-lockout-per-network-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-login-lockout-per-network-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
