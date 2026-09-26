// Tills share logins: one account signs in on every register, every shift.
// The per-account login ceiling (8 per 15 min, keyed on the typed identifier
// and on the account id) spent a slot on EVERY attempt, so the 9th successful
// sign-in to one account inside the window was refused with 429. It now
// counts only failed attempts. The per-IP ceiling (20 per 15 min) had the
// same flaw one level up -- every till in a shop shares one public IP, so the
// 21st sign-in of a shift was refused as "too many from this network". It
// still reserves a slot atomically per attempt, but a verified password now
// gives it back; a parallel burst of failures still cannot exceed 20.
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

  await check('30 successful sign-ins from ONE shop network all answer 200 (tills share a public IP)', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 704, username: 'till', name: 'Front Till', email: 'till@shop.test', password: 'till-password' })
    h.addUser({ id: 705, username: 'cashier2', name: 'Second Cashier', email: 'c2@shop.test', password: 'c2-password' })
    const statuses = []
    for (let i = 0; i < 30; i++) {
      const who = i % 2 ? { username: 'cashier2', password: 'c2-password' } : { username: 'till', password: 'till-password' }
      statuses.push((await h.request('/login', 'POST', who, { ip: '198.51.100.7' })).status)
    }
    assert.deepEqual(statuses, Array(30).fill(200))
  })

  await check('control: 20 failures from one network still close it, even to the right password', async () => {
    const h = createAuthHarness()
    h.addUser({ id: 706, username: 'till', name: 'Front Till', email: 'till@shop.test', password: 'till-password' })
    // Distinct unknown usernames: one guess each, so no per-account limit or
    // lockout is involved -- only the per-network ceiling can refuse.
    for (let i = 0; i < 20; i++) {
      assert.equal((await h.request('/login', 'POST', { username: `nobody${i}`, password: 'guess' }, { ip: '203.0.113.99' })).status, 401, `guess ${i + 1}`)
    }
    const res = await h.request('/login', 'POST', { username: 'till', password: 'till-password' }, { ip: '203.0.113.99' })
    assert.equal(res.status, 429)
    assert.match(String(res.body && res.body.error), /from this network/)
    assert.equal((await h.request('/login', 'POST', { username: 'till', password: 'till-password' }, { ip: '203.0.113.100' })).status, 200, 'another network is unaffected')
  })

  await check('a parallel burst of guesses from one network admits at most 20 (atomic reserve, not a read-only peek)', async () => {
    const h = createAuthHarness()
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      h.request('/login', 'POST', { username: `burst${i}`, password: 'guess' }, { ip: '192.0.2.44' })))
    const admitted = results.filter((r) => r.status === 401).length
    const refused = results.filter((r) => r.status === 429).length
    assert.equal(admitted + refused, 40, 'every attempt is either a checked failure or refused')
    assert.ok(admitted <= 20, `at most 20 guesses reach the password check, got ${admitted}`)
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-login-success-not-throttled-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-login-success-not-throttled-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
