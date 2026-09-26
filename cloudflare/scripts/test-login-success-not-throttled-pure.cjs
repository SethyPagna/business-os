// Tills share logins: one account signs in on every register, every shift.
// The per-account login ceiling (8 per 15 min, keyed on the typed identifier
// and on the account id) spent a slot on EVERY attempt, so the 9th successful
// sign-in to one account inside the window was refused with 429. It now
// counts only failed attempts. The per-IP request ceiling (20 per 15 min) is
// unchanged and is not what this test measures.
//
// Drives the REAL routes/auth.ts and lib/rateLimit.ts against the migrated
// schema (harness/load_auth_route.cjs). Fails on 3627133f/db430872 (the uid
// bucket) and on a04da325 (the typed-username bucket).
//
// Run: node scripts/test-login-success-not-throttled-pure.cjs

const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

let passed = 0
const failures = []
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

async function main() {
  await check('20 successful sign-ins in a row to one shared till account all answer 200', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 701, username: 'till', name: 'Front Till', email: 'till@shop.test', password: 'till-password' })
    const statuses = []
    for (let i = 0; i < 20; i++) {
      const res = await h.request('/login', 'POST', { username: 'till', password: 'till-password' }, { ip: '198.51.100.20' })
      statuses.push(res.status)
    }
    assert.deepEqual(statuses, Array(20).fill(200))
  })

  await check('successes through several aliases do not spend the account-id allowance either', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 702, username: 'till', name: 'Front Till', email: 'till@shop.test', password: 'till-password' })
    const aliases = ['till', 'till@shop.test', 'Front Till']
    for (let i = 0; i < 20; i++) {
      const res = await h.request('/login', 'POST', { username: aliases[i % 3], password: 'till-password' }, { ip: `198.51.100.${100 + i}` })
      assert.equal(res.status, 200, `sign-in ${i + 1}`)
    }
  })

  await check('control: failures still spend it -- eight failures around a success refuse the next attempt', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 703, username: 'till', name: 'Front Till', email: 'till@shop.test', password: 'till-password' })
    const ip = (n) => `203.0.113.${n}`
    for (let i = 0; i < 5; i++) assert.equal((await h.request('/login', 'POST', { username: 'till', password: 'wrong' }, { ip: ip(i) })).status, 401)
    assert.equal((await h.request('/login', 'POST', { username: 'till', password: 'till-password' }, { ip: ip(10) })).status, 200, 'clears the lockout, not the window')
    for (let i = 0; i < 3; i++) assert.equal((await h.request('/login', 'POST', { username: 'till', password: 'wrong' }, { ip: ip(20 + i) })).status, 401)
    const res = await h.request('/login', 'POST', { username: 'till', password: 'till-password' }, { ip: ip(30) })
    assert.equal(res.status, 429, 'eight failures in the window fill the per-account ceiling')
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-login-success-not-throttled-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-login-success-not-throttled-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
