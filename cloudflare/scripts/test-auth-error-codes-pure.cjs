// I18N-4: every refusal POST /api/auth/login and POST /api/auth/otp/verify
// give carries a stable `code`, so the sign-in screen can say it in the
// operator's language (frontend/src/components/auth/authErrorText.ts) instead
// of showing the Worker's English sentence. The English `error` stays for
// older clients.
//
// Also pins that the code adds no new oracle: the per-typed-identifier and
// the per-account limits answer with ONE code, and the typed and the resolved
// lockout with one code, so a code never tells which bucket tripped.
//
// Drives the REAL routes/auth.ts (real lib/loginLockout.ts, lib/rateLimit.ts,
// lib/otpChallenge.ts, lib/totp.ts) over the full migrated schema through
// harness/load_auth_route.cjs, plus a source check that no refusal in the two
// handlers was left without a code.
//
// Run: node scripts/test-auth-error-codes-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const ROUTE = path.join(__dirname, '..', 'src', 'routes', 'auth.ts')

let ipSeq = 0
const freshIp = () => `192.0.2.${(ipSeq += 1)}`
const nowSql = () => new Date().toISOString().replace('T', ' ').replace('Z', '')

function seedRateLimit(h, bucket, clientKey, count) {
  const insert = h.raw.prepare('INSERT INTO rate_limit_events (bucket, client_key, created_at) VALUES (@bucket, @clientKey, @createdAt)')
  for (let i = 0; i < count; i += 1) insert.run({ bucket, clientKey, createdAt: nowSql() })
}

let deviceAnswers = []
function harness() {
  deviceAnswers = []
  const h = createAuthHarness({
    overrides: {
      '../lib/deviceTrust': {
        requiresDeviceApproval: () => true,
        checkDeviceTrust: async () => ({ status: deviceAnswers.length ? deviceAnswers.shift() : 'approved' }),
      },
    },
  })
  h.addUser({ id: 901, username: 'dara', name: 'Dara Sok', email: 'dara@shop.test', password: 'right-password' })
  h.addUser({ id: 902, username: 'owner', name: 'Owner', password: 'owner-password', otpSecret: SECRET })
  return h
}

async function passwordStep(h, ip) {
  const first = await h.request('/login', 'POST', { username: 'owner', password: 'owner-password', deviceId: 'dev-1' }, { ip })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.otpRequired, true)
  return first.body.otpChallenge
}

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

function expectCode(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body))
  assert.equal(res.body && res.body.code, code, `expected code ${code}: ${JSON.stringify(res.body)}`)
  assert.equal(typeof res.body.error, 'string', 'the English error stays for older clients')
}

;(async () => {
  await check('/login refusals carry their codes', async () => {
    const h = harness()
    expectCode(await h.request('/login', 'POST', { username: 'dara' }, { ip: freshIp() }), 400, 'credentials_required')
    expectCode(await h.request('/login', 'POST', { username: 'dara', password: 'wrong', deviceId: 'dev-1' }, { ip: freshIp() }), 401, 'invalid_credentials')
    expectCode(await h.request('/login', 'POST', { username: 'nobody-here', password: 'wrong' }, { ip: freshIp() }), 401, 'invalid_credentials')

    const busy = freshIp()
    seedRateLimit(h, 'auth:login_ip', busy, 20)
    expectCode(await h.request('/login', 'POST', { username: 'dara', password: 'right-password' }, { ip: busy }), 429, 'login_rate_limited_network')

    deviceAnswers = ['rejected']
    expectCode(await h.request('/login', 'POST', { username: 'dara', password: 'right-password', deviceId: 'dev-x' }, { ip: freshIp() }), 403, 'device_rejected')
  })

  await check('/login lockout answers login_locked with the wait, typed and resolved alike', async () => {
    const h = harness()
    const ip = freshIp()
    let locked = null
    for (let i = 0; i < 12 && !locked; i += 1) {
      const res = await h.request('/login', 'POST', { username: 'dara@shop.test', password: 'wrong' }, { ip })
      if (res.status === 429) locked = res
      else expectCode(res, 401, 'invalid_credentials')
    }
    assert.ok(locked, 'the lockout engages')
    expectCode(locked, 429, 'login_locked')
    assert.ok(locked.body.retryAfterSeconds > 0, 'the wait travels with the code')
    // Typed key locked: the pre-check answers.
    expectCode(await h.request('/login', 'POST', { username: 'dara@shop.test', password: 'right-password' }, { ip }), 429, 'login_locked')
    // A different alias of the same account: only the RESOLVED key is locked.
    const resolved = await h.request('/login', 'POST', { username: 'dara', password: 'right-password' }, { ip })
    expectCode(resolved, 429, 'login_locked')
    assert.ok(resolved.body.retryAfterSeconds > 0)
  })

  await check('/login per-identifier and per-account limits share one code', async () => {
    const h = harness()
    const typedIp = freshIp()
    seedRateLimit(h, 'auth:login_user', `user:nobody-here@${typedIp}`, 8)
    const typed = await h.request('/login', 'POST', { username: 'nobody-here', password: 'wrong' }, { ip: typedIp })
    expectCode(typed, 429, 'login_rate_limited_account')

    const accountIp = freshIp()
    seedRateLimit(h, 'auth:login_user', `uid:901@${accountIp}`, 8)
    const perAccount = await h.request('/login', 'POST', { username: 'dara', password: 'wrong' }, { ip: accountIp })
    expectCode(perAccount, 429, 'login_rate_limited_account')

    const wide = harness()
    seedRateLimit(wide, 'auth:login_account', 'uid:901', 40)
    const accountWide = await wide.request('/login', 'POST', { username: 'dara', password: 'wrong' }, { ip: freshIp() })
    expectCode(accountWide, 429, 'login_rate_limited_account')

    assert.deepEqual(perAccount.body, typed.body, 'a known account\'s limit reads exactly like a stranger\'s')
    assert.deepEqual(accountWide.body, typed.body)
  })

  await check('/login: an authenticator that cannot be read answers otp_unavailable', async () => {
    const h = harness()
    h.addUser({ id: 903, username: 'broken', name: 'Broken', password: 'broken-password', otpSecret: 'enc:v1:AAAA:BBBB:CCCC' })
    expectCode(await h.request('/login', 'POST', { username: 'broken', password: 'broken-password', deviceId: 'dev-1' }, { ip: freshIp() }), 503, 'otp_unavailable')
  })

  await check('/otp/verify refusals carry their codes', async () => {
    const h = harness()
    const ip = freshIp()
    expectCode(await h.request('/otp/verify', 'POST', { userId: 902 }, { ip }), 400, 'otp_code_required')
    expectCode(await h.request('/otp/verify', 'POST', { userId: 902, token: '123456', otpChallenge: 'forged' }, { ip }), 401, 'otp_challenge_expired')
    const challenge = await passwordStep(h, ip)
    const wrong = await h.request('/otp/verify', 'POST', { userId: 902, token: '000000', otpChallenge: challenge }, { ip })
    expectCode(wrong, 401, 'otp_invalid')

    const busy = freshIp()
    seedRateLimit(h, 'auth:otp_ip', busy, 25)
    expectCode(await h.request('/otp/verify', 'POST', { userId: 902, token: '123456', otpChallenge: challenge }, { ip: busy }), 429, 'otp_rate_limited_network')

    const limited = harness()
    const limitedIp = freshIp()
    const limitedChallenge = await passwordStep(limited, limitedIp)
    seedRateLimit(limited, 'auth:otp', 'user:902', 10)
    expectCode(await limited.request('/otp/verify', 'POST', { userId: 902, token: '123456', otpChallenge: limitedChallenge }, { ip: limitedIp }), 429, 'otp_rate_limited_account')
  })

  await check('/otp/verify: account or authenticator gone since the password step answers otp_unavailable', async () => {
    const h = harness()
    const ip = freshIp()
    const challenge = await passwordStep(h, ip)
    h.raw.prepare("UPDATE users SET otp_secret = 'enc:v1:AAAA:BBBB:CCCC' WHERE id = 902").run({})
    expectCode(await h.request('/otp/verify', 'POST', { userId: 902, token: '123456', otpChallenge: challenge }, { ip }), 400, 'otp_unavailable')
    h.raw.prepare('UPDATE users SET otp_enabled = 0 WHERE id = 902').run({})
    expectCode(await h.request('/otp/verify', 'POST', { userId: 902, token: '123456', otpChallenge: challenge }, { ip }), 401, 'otp_unavailable')
  })

  await check('/otp/verify lockout answers login_locked with the wait', async () => {
    const h = harness()
    const ip = freshIp()
    const challenge = await passwordStep(h, ip)
    let locked = null
    for (let i = 0; i < 12 && !locked; i += 1) {
      const res = await h.request('/otp/verify', 'POST', { userId: 902, token: '000000', otpChallenge: challenge }, { ip })
      if (res.status === 429) locked = res
      else expectCode(res, 401, 'otp_invalid')
    }
    assert.ok(locked, 'the lockout engages')
    expectCode(locked, 429, 'login_locked')
    assert.ok(locked.body.retryAfterSeconds > 0)
    const again = await h.request('/otp/verify', 'POST', { userId: 902, token: await h.codeAt(SECRET), otpChallenge: challenge }, { ip })
    expectCode(again, 429, 'login_locked')
  })

  await check('/otp/verify: a device rejected at the code step answers device_rejected', async () => {
    const h = harness()
    const ip = freshIp()
    const challenge = await passwordStep(h, ip)
    deviceAnswers = ['rejected']
    expectCode(await h.request('/otp/verify', 'POST', { userId: 902, token: await h.codeAt(SECRET), otpChallenge: challenge, deviceId: 'dev-2' }, { ip }), 403, 'device_rejected')
  })

  await check('source: no refusal in /login or /otp/verify is left without a code', async () => {
    const source = fs.readFileSync(ROUTE, 'utf8')
    for (const route of ["app.post('/login'", "app.post('/otp/verify'"]) {
      const start = source.indexOf(route)
      assert.ok(start >= 0, route)
      const end = source.indexOf('\napp.', start + route.length)
      const handler = source.slice(start, end)
      const refusals = [...handler.matchAll(/c\.json\(\{([\s\S]*?)\},\s*(4\d\d|5\d\d)\)/g)]
      assert.ok(refusals.length >= 7, `${route}: found ${refusals.length} refusals`)
      for (const [text] of refusals) assert.match(text, /\bcode: '[a-z_]+'/, `${route} refusal without a code: ${text.slice(0, 120)}`)
    }
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
