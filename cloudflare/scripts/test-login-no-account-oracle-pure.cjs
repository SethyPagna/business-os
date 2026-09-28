// SEC1-02: POST /api/auth/login must answer a sign-in identifier that names
// no account exactly as it answers one that does, in body and in work done.
//
// Two channels used to tell them apart:
//   - the 401 body's failedAttempts was the worst of the TYPED-identifier
//     counter and the resolved ACCOUNT counter. Two spellings of one phone
//     ("012345678", "012-345-678") are two typed keys but one account, so the
//     second failure read 2 for a staff phone and 1 for a stranger's; the same
//     linkage showed an email or name belonged to a known username;
//   - bcrypt only ran when an account resolved, so an unknown, ambiguous or
//     inactive identifier answered in about a millisecond and a real one in a
//     full cost-10 compare.
//
// Drives the REAL routes/auth.ts (real lib/loginLockout.ts, lib/rateLimit.ts)
// over the full migrated schema (harness/load_auth_route.cjs), with the real
// bcryptjs behind a counting wrapper.
//
// Run: node scripts/test-login-no-account-oracle-pure.cjs

const assert = require('node:assert/strict')
const bcrypt = require('bcryptjs')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const compared = []
const countingBcrypt = {
  ...bcrypt,
  compareSync: (plain, hash) => { compared.push(String(hash)); return bcrypt.compareSync(plain, hash) },
}
const costOf = (hash) => Number(/^\$2[abxy]?\$(\d{2})\$/.exec(hash)?.[1] || 0)

let ipSeq = 0
const freshIp = () => `198.51.100.${(ipSeq += 1)}`

function harness() {
  const h = createAuthHarness({ overrides: { bcryptjs: countingBcrypt } })
  h.addUser({ id: 701, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password' })
  h.raw.prepare("UPDATE users SET phone_lookup = '012345678', password = @hash WHERE id = 701").run({ hash: bcrypt.hashSync('right-password', 10) })
  h.addUser({ id: 702, username: 'sok1', name: 'Twin Name', password: 'pw-702' })
  h.addUser({ id: 703, username: 'sok2', name: 'Twin Name', password: 'pw-703' })
  h.addUser({ id: 704, username: 'gone', name: 'Gone Staff', password: 'pw-704' })
  h.raw.prepare('UPDATE users SET is_active = 0 WHERE id = 704').run({})
  return h
}

// The same two failed attempts from one network; returns the second answer.
async function secondFailure(h, first, second) {
  const ip = freshIp()
  await h.request('/login', 'POST', { username: first, password: 'wrong' }, { ip })
  return h.request('/login', 'POST', { username: second, password: 'wrong' }, { ip })
}

let failures = 0
async function check(name, fn) {
  try { compared.length = 0; await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('two spellings of a staff phone answer exactly like two spellings of an unknown phone', async () => {
    const staff = await secondFailure(harness(), '012345678', '012-345-678')
    const stranger = await secondFailure(harness(), '099888777', '099-888-777')
    assert.equal(staff.status, 401)
    assert.deepEqual(staff, stranger, 'the second failure must not reveal that the phone is an account')
  })

  await check('an email after its username answers exactly like an unrelated email after that username', async () => {
    const linked = await secondFailure(harness(), 'dara', 'dara@shop.test')
    const unrelated = await secondFailure(harness(), 'dara', 'nobody@shop.test')
    assert.equal(linked.status, 401)
    assert.deepEqual(linked, unrelated, 'the answer must not link the email to the username')
  })

  await check('control: failedAttempts still counts the typed identifier\'s own failures', async () => {
    const res = await secondFailure(harness(), 'dara', 'dara')
    assert.equal(res.status, 401)
    assert.equal(res.body.failedAttempts, 2)
  })

  await check('unknown, ambiguous and inactive identifiers each spend one cost-10 compare, like a wrong password', async () => {
    const h = harness()
    for (const username of ['nobody-here', 'Twin Name', 'gone', '099888777']) {
      compared.length = 0
      const res = await h.request('/login', 'POST', { username, password: 'wrong' }, { ip: freshIp() })
      assert.equal(res.status, 401, `${username}: ${JSON.stringify(res.body)}`)
      assert.equal(compared.length, 1, `${username}: one bcrypt compare, as for a real account`)
      assert.equal(costOf(compared[0]), 10, `${username}: the compare runs at the cost staff hashes use (got ${compared[0].slice(0, 7)})`)
    }
    compared.length = 0
    const real = await h.request('/login', 'POST', { username: 'dara', password: 'wrong' }, { ip: freshIp() })
    assert.equal(real.status, 401)
    assert.equal(compared.length, 1)
    assert.equal(costOf(compared[0]), 10)
  })

  await check('wall clock: an unknown identifier takes at least half as long as a wrong password', async () => {
    const h = harness()
    const timeOf = async (username) => {
      const started = process.hrtime.bigint()
      await h.request('/login', 'POST', { username, password: 'wrong' }, { ip: freshIp() })
      return Number(process.hrtime.bigint() - started) / 1e6
    }
    await timeOf('dara')
    const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const known = []
    const unknown = []
    for (let i = 0; i < 5; i += 1) {
      known.push(await timeOf('dara'))
      unknown.push(await timeOf(`nobody-${i}`))
    }
    console.log(`  median ms: wrong password ${median(known).toFixed(1)}, unknown identifier ${median(unknown).toFixed(1)}`)
    assert.ok(median(unknown) >= median(known) * 0.5, `unknown ${median(unknown).toFixed(1)} ms vs known ${median(known).toFixed(1)} ms`)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
