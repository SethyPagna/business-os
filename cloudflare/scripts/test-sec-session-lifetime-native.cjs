'use strict'
// Staff session lifetime and sign-in throttling through the REAL Worker
// (src/index.ts bundled onto Miniflare, every migration applied). Findings S1
// and S3 of Records/Lanes/2026-10-13/OPUS-SECURITY-AUDIT-WHOLE-APP.md.
//
//   S1a  "Until I close the browser" is a browser-session cookie.
//   S1b  A renewal never makes the window longer than the chosen duration.
//   S1c  /session-duration revokes the token it re-issues from and asks for
//        the current password before lengthening.
//   S3b  The sign-in, authenticator and reset throttles count an IPv6 /64 as
//        one network.
//
// Elapsed time is simulated by moving the session row's timestamps.
//
// Run: node scripts/test-sec-session-lifetime-native.cjs
const assert = require('node:assert/strict')
const { createHash, createHmac } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: splitSql } = require('wrangler')
const bcrypt = require('bcryptjs')

const root = path.join(__dirname, '..')
const ADMIN = 'https://admin.sessions.example'
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const PASSWORD = `session-pass-${Date.now()}`
const OTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

let mf
let db
let passed = 0
let failed = 0

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    process.exitCode = 1
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

async function boot() {
  const bundle = await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'silent', nodePaths: [path.join(root, 'node_modules')] })
  mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], cache: false,
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: 'https://shop.sessions.example', BUSINESS_OS_ADMIN_URL: ADMIN, BUSINESS_OS_ORGANIZATION_SLUG: 'sessions', BUSINESS_OS_ORGANIZATION_NAME: 'Sessions' },
    outboundService: () => new Response('refused', { status: 503 }), log: new Log(LogLevel.NONE),
  })
  db = await mf.getD1Database('DB')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of splitSql(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))) {
      if (file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      await db.prepare(statement).run()
    }
  }
  await mf.dispatchFetch(`${ADMIN}/api/organizations/bootstrap`)
  const adminRole = await db.prepare("SELECT id FROM roles WHERE code = 'admin'").first()
  const org = await db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').first()
  const hash = bcrypt.hashSync(PASSWORD, 4)
  for (const username of ['owner_a', 'owner_b', 'owner_c', 'owner_otp', 'owner_net', 'owner_race', 'owner_boom']) {
    await db.prepare("INSERT INTO users (username, name, password, role_id, permissions, is_active, organization_id) VALUES (?, ?, ?, ?, '{}', 1, ?)")
      .bind(username, username, hash, adminRole.id, org.id).run()
  }
  await db.prepare("UPDATE users SET otp_enabled = 1, otp_secret = ? WHERE username = 'owner_otp'").bind(OTP_SECRET).run()
}

async function request(pathname, { method = 'GET', body, cookie, ip = '198.51.100.7' } = {}) {
  const response = await mf.dispatchFetch(ADMIN + pathname, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Origin: ADMIN,
      'Sec-Fetch-Site': 'same-origin',
      'CF-Connecting-IP': ip,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  const setCookie = response.headers.get('set-cookie') || ''
  const token = /bos_session=([^;]+)/.exec(setCookie)?.[1]
  return { status: response.status, body: json, setCookie, cookie: token ? `bos_session=${token}` : null }
}

const signIn = (username, sessionDuration, ip) =>
  request('/api/auth/login', { method: 'POST', ip, body: { username, password: PASSWORD, ...(sessionDuration === undefined ? {} : { sessionDuration }), deviceId: `dev-${username}`, deviceName: 'Session probe' } })

function totp(secret, step) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const value = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(value % 1000000).padStart(6, '0')
}

const sessionRow = async (cookie) => {
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
  return db.prepare('SELECT id, created_at, expires_at, revoked_at FROM user_sessions WHERE token_hash = ?')
    .bind(createHash('sha256').update(token).digest('hex')).first()
}

const cookieLifetimeDays = (setCookie) => {
  const expires = /Expires=([^;]+)/i.exec(setCookie)
  return expires ? (Date.parse(expires[1]) - Date.now()) / DAY : null
}

async function main() {
  await boot()

  await check('S1a: "Until I close the browser" is a browser-session cookie (no Expires, no Max-Age)', async () => {
    const res = await signIn('owner_a', 'session')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.match(res.setCookie, /^bos_session=/)
    assert.doesNotMatch(res.setCookie, /expires=/i, res.setCookie.replace(/bos_session=[^;]+/, 'bos_session=<redacted>'))
    assert.doesNotMatch(res.setCookie, /max-age=/i)
    assert.match(res.setCookie, /HttpOnly/i)
    assert.match(res.setCookie, /Secure/i)
    assert.match(res.setCookie, /SameSite=Lax/i)
    const row = await sessionRow(res.cookie)
    assert.ok(Date.parse(row.expires_at) - Date.now() <= DAY + 5000, 'the server-side window stays 24 hours')
    assert.equal((await request('/api/auth/me', { cookie: res.cookie })).status, 200, 'the session cookie authenticates')
  })

  await check('S1a: every other choice, and no choice at all, keeps a persistent transport cookie', async () => {
    for (const choice of ['1d', '30d', 'always', undefined]) {
      const res = await signIn('owner_a', choice)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const days = cookieLifetimeDays(res.setCookie)
      assert.ok(days !== null && days > 398 && days <= 399, `${choice}: persistent cookie, ${days} days`)
    }
  })

  await check('S1a: the choice is trimmed and lower-cased; empty or unknown keeps the default', async () => {
    for (const choice of [' SESSION ', 'Session']) {
      const res = await signIn('owner_a', choice)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.doesNotMatch(res.setCookie, /expires=|max-age=/i, `"${choice}" is the browser-session choice`)
    }
    for (const choice of ['', '   ', 'forever', '__proto__', 'toString']) {
      const res = await signIn('owner_a', choice)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const days = cookieLifetimeDays(res.setCookie)
      assert.ok(days > 398 && days <= 399, `"${choice}": the default keeps the persistent cookie`)
      assert.ok(Date.parse((await sessionRow(res.cookie)).expires_at) - Date.now() > 3000 * DAY, `"${choice}": the default is the long window`)
    }
  })

  await check('S1a: the authenticator step issues the same browser-session cookie', async () => {
    const first = await signIn('owner_otp', 'session')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.otpRequired, true)
    assert.equal(first.cookie, null, 'no session before the second factor')
    const step = Math.floor(Date.now() / 30000)
    const done = await request('/api/auth/otp/verify', { method: 'POST', body: { userId: first.body.userId, token: totp(OTP_SECRET, step), otpChallenge: first.body.otpChallenge, sessionDuration: 'session', deviceId: 'dev-owner_otp', deviceName: 'Session probe' } })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.doesNotMatch(done.setCookie, /expires=|max-age=/i)
    assert.equal((await request('/api/auth/me', { cookie: done.cookie })).status, 200)
  })

  const DURATION_MS = { session: DAY, '1d': DAY, '3d': 3 * DAY, '7d': 7 * DAY }
  const sqliteStamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  const waitForExpiryChange = async (cookie, before) => {
    for (let i = 0; i < 100; i += 1) {
      const row = await sessionRow(cookie)
      if (row.expires_at !== before) return row
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return sessionRow(cookie)
  }
  // Pretends time has passed: the session keeps `leftMs` of its window, with
  // created_at and expires_at both moved back, then one request renews it.
  const useAfterAging = async (cookie, leftMs) => {
    const row = await sessionRow(cookie)
    const shift = (Date.parse(row.expires_at) - Date.now()) - leftMs
    const expires = new Date(Date.parse(row.expires_at) - shift).toISOString()
    const created = sqliteStamp(Date.parse(`${row.created_at.replace(' ', 'T')}Z`) - shift)
    await db.prepare('UPDATE user_sessions SET created_at = ?, expires_at = ?, last_seen_at = NULL WHERE id = ?').bind(created, expires, row.id).run()
    assert.equal((await request('/api/auth/me', { cookie })).status, 200)
    return waitForExpiryChange(cookie, expires)
  }

  for (const choice of ['session', '1d', '3d']) {
    await check(`S1b: three renewals of a "${choice}" session never lengthen its window`, async () => {
      const chosen = DURATION_MS[choice]
      const res = await signIn('owner_b', choice)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      for (let i = 1; i <= 3; i += 1) {
        const row = await useAfterAging(res.cookie, 0.45 * chosen)
        const remaining = Date.parse(row.expires_at) - Date.now()
        assert.ok(remaining > 0.9 * chosen, `renewal ${i}: renewed, ${(remaining / HOUR).toFixed(1)} h left`)
        assert.ok(remaining <= chosen + 5000, `renewal ${i}: ${(remaining / HOUR).toFixed(1)} h left exceeds the chosen ${(chosen / HOUR).toFixed(1)} h`)
      }
    })
  }

  await check('S1b: a session in the first half of its window is not renewed', async () => {
    const res = await signIn('owner_b', '3d')
    const row = await sessionRow(res.cookie)
    await db.prepare('UPDATE user_sessions SET last_seen_at = NULL WHERE id = ?').bind(row.id).run()
    assert.equal((await request('/api/auth/me', { cookie: res.cookie })).status, 200)
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal((await sessionRow(res.cookie)).expires_at, row.expires_at)
  })

  await check('S1b: the duration in a token cannot be edited into a longer one', async () => {
    const res = await signIn('owner_b', 'session')
    assert.equal((await request('/api/auth/me', { cookie: res.cookie })).status, 200)
    const forged = res.cookie.replace(/\.session$/, '.always')
    assert.notEqual(forged, res.cookie)
    assert.equal((await request('/api/auth/me', { cookie: forged })).status, 401)
  })

  await check('S1b: a token issued before the duration suffix renews by a named duration, not by its grown window', async () => {
    const userId = (await db.prepare("SELECT id FROM users WHERE username = 'owner_c'").first()).id
    const token = `legacy-${Date.now()}`
    const now = Date.now()
    await db.prepare('INSERT INTO user_sessions (user_id, token_hash, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, createHash('sha256').update(token).digest('hex'), 'dev-owner_c', sqliteStamp(now - 50 * HOUR), new Date(now + 24 * HOUR).toISOString()).run()
    const cookie = `bos_session=${token}`
    const row = await sessionRow(cookie)
    assert.equal((await request('/api/auth/me', { cookie })).status, 200)
    const renewed = await waitForExpiryChange(cookie, row.expires_at)
    const remaining = Date.parse(renewed.expires_at) - Date.now()
    assert.ok(Math.abs(remaining - 3 * DAY) < 5000, `74 h window renews by 3 days, not 74 h: ${(remaining / HOUR).toFixed(2)} h left`)
  })

  const changeDuration = (cookie, body) =>
    request('/api/auth/session-duration', { method: 'POST', cookie, body: { deviceTz: 'Asia/Phnom_Penh', clientTime: new Date().toISOString(), ...body } })
  const liveRows = async (username) =>
    (await db.prepare('SELECT COUNT(*) AS n FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE u.username = ? AND s.revoked_at IS NULL').bind(username).first()).n
  const isSignedIn = async (cookie) => (await request('/api/auth/me', { cookie })).status === 200

  await check('S1c: a duration change replaces the session it was made from', async () => {
    const first = await signIn('owner_a', '1d')
    const change = await changeDuration(first.cookie, { sessionDuration: '1d' })
    assert.equal(change.status, 200, JSON.stringify(change.body))
    assert.ok(change.cookie && change.cookie !== first.cookie, 'a new cookie is issued')
    assert.ok((await sessionRow(first.cookie)).revoked_at, 'the old token is revoked')
    assert.equal(await isSignedIn(first.cookie), false, 'the old cookie is refused')
    assert.equal(await isSignedIn(change.cookie), true, 'the new cookie signs in')
  })

  await check('S1c: lengthening asks for the current password and changes nothing without it', async () => {
    const first = await signIn('owner_a', '1d')
    const before = await liveRows('owner_a')
    for (const body of [{ sessionDuration: 'always' }, { sessionDuration: '7d' }, { sessionDuration: 'not-a-duration' }, {}]) {
      const refused = await changeDuration(first.cookie, body)
      assert.equal(refused.status, 400, JSON.stringify(body))
      assert.equal(refused.body.code, 'session_duration_password_required')
      assert.equal(refused.cookie, null, 'no cookie is issued')
    }
    assert.equal(await liveRows('owner_a'), before, 'no session was minted or revoked')
    assert.equal(await isSignedIn(first.cookie), true, 'the session it was asked from is untouched')
    const wrong = await changeDuration(first.cookie, { sessionDuration: 'always', currentPassword: 'not-the-password' })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.code, 'incorrect_password')
    assert.equal(await isSignedIn(first.cookie), true)
    const right = await changeDuration(first.cookie, { sessionDuration: 'always', currentPassword: PASSWORD })
    assert.equal(right.status, 200, JSON.stringify(right.body))
    assert.equal(await isSignedIn(first.cookie), false, 'the old token is revoked once the change is accepted')
    assert.equal(await isSignedIn(right.cookie), true)
    const days = cookieLifetimeDays(right.setCookie)
    assert.ok(days > 398 && days <= 399, 'a long choice keeps the persistent transport cookie')
  })

  await check('S1c: a shorter or equal choice needs no password; "until I close the browser" is the shortest', async () => {
    const always = await signIn('owner_a', 'always')
    const sevenDays = await changeDuration(always.cookie, { sessionDuration: '7d' })
    assert.equal(sevenDays.status, 200, JSON.stringify(sevenDays.body))
    assert.equal(await isSignedIn(always.cookie), false)
    const sameLength = await changeDuration(sevenDays.cookie, { sessionDuration: '7d' })
    assert.equal(sameLength.status, 200, JSON.stringify(sameLength.body))
    const browserSession = await changeDuration(sameLength.cookie, { sessionDuration: 'session' })
    assert.equal(browserSession.status, 200, JSON.stringify(browserSession.body))
    assert.doesNotMatch(browserSession.setCookie, /expires=|max-age=/i, 'the re-issue honours the browser-session choice too')
    assert.equal(await isSignedIn(sameLength.cookie), false)
    const oneDay = await changeDuration(browserSession.cookie, { sessionDuration: '1d' })
    assert.equal(oneDay.status, 400, '"1d" survives a browser restart, "session" does not, though both last 24 hours')
    assert.equal(oneDay.body.code, 'session_duration_password_required')
    assert.equal(await isSignedIn(browserSession.cookie), true)
  })

  await check('S1c: a token issued before the duration suffix is shortened without a password, and lengthened only with one', async () => {
    const userId = (await db.prepare("SELECT id FROM users WHERE username = 'owner_c'").first()).id
    const legacy = async (token, windowMs) => {
      const now = Date.now()
      await db.prepare('INSERT INTO user_sessions (user_id, token_hash, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, createHash('sha256').update(token).digest('hex'), 'dev-owner_c', sqliteStamp(now - HOUR), new Date(now - HOUR + windowMs).toISOString()).run()
      return `bos_session=${token}`
    }
    const tenYears = await legacy(`legacy-always-${Date.now()}`, 10 * 365 * DAY)
    const shortened = await changeDuration(tenYears, { sessionDuration: '30d' })
    assert.equal(shortened.status, 200, JSON.stringify(shortened.body))
    assert.equal(await isSignedIn(tenYears), false)
    const oneDay = await legacy(`legacy-day-${Date.now()}`, DAY)
    const refused = await changeDuration(oneDay, { sessionDuration: '30d' })
    assert.equal(refused.status, 400)
    assert.equal(refused.body.code, 'session_duration_password_required')
    const allowed = await changeDuration(oneDay, { sessionDuration: '30d', currentPassword: PASSWORD })
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
  })

  const wrongPassword = (username, ip) =>
    request('/api/auth/login', { method: 'POST', ip, body: { username, password: 'not-the-password', deviceId: 'dev-net', deviceName: 'Session probe' } })
  const inNetwork = (prefix, host) => `${prefix}:${host.toString(16)}`

  await check('S3b: failed sign-ins from three addresses of one IPv6 /64 lock that network together', async () => {
    const addresses = ['2001:db8:a:b::1', '2001:0db8:000a:000b:0000:0000:0000:0002', '2001:db8:a:b:dead:beef:cafe:3']
    const answers = []
    for (let i = 0; i < 6; i += 1) answers.push(await wrongPassword('owner_net', addresses[i % 3]))
    for (let i = 0; i < 5; i += 1) assert.equal(answers[i].status, 401, `failure ${i + 1} is a plain wrong-password answer`)
    assert.equal(answers[5].status, 429, 'the sixth failure from the shared /64 locks it')
    assert.equal(answers[5].body.code, 'login_locked')
    const sameNetworkRight = await signIn('owner_net', 'session', '2001:db8:a:b:1:2:3:4')
    assert.equal(sameNetworkRight.status, 429, 'a fourth address of the same /64 is locked too, even with the right password')
    const otherNetwork = await signIn('owner_net', 'session', '2001:db8:a:c::1')
    assert.equal(otherNetwork.status, 200, 'the owner on another network is not locked out by it')
  })

  await check('S3b: the per-network sign-in ceiling counts a /64 as one network', async () => {
    const answers = []
    for (let i = 0; i < 21; i += 1) answers.push(await wrongPassword(`ghost-${i}`, inNetwork('2001:db8:c:d:0:0:0', i + 1)))
    for (let i = 0; i < 20; i += 1) assert.equal(answers[i].status, 401, `attempt ${i + 1}`)
    assert.equal(answers[20].status, 429)
    assert.equal(answers[20].body.code, 'login_rate_limited_network')
    assert.equal((await wrongPassword('ghost-other', '2001:db8:c:e::1')).status, 401, 'another /64 is unaffected')
  })

  await check('S3b: the authenticator and reset ceilings count a /64 as one network', async () => {
    const otp = []
    for (let i = 0; i < 26; i += 1) otp.push(await request('/api/auth/otp/verify', { method: 'POST', ip: inNetwork('2001:db8:e:f:0:0:0', i + 1), body: { userId: 987654, token: '000000' } }))
    assert.ok(otp.slice(0, 25).every((res) => res.status === 401), 'the first 25 are answered')
    assert.equal(otp[25].status, 429)
    assert.equal(otp[25].body.code, 'otp_rate_limited_network')
    const reset = []
    for (let i = 0; i < 26; i += 1) {
      reset.push(await request('/api/auth/password-reset/otp', { method: 'POST', ip: inNetwork('2001:db8:1:2:0:0:0', i + 1), body: { identifier: `nobody-${i}`, otp: '000000', newPassword: 'a-long-new-password-1' } }))
    }
    assert.ok(reset.slice(0, 25).every((res) => res.status === 401), 'the first 25 are answered')
    assert.equal(reset[25].status, 429)
  })

  await check('SR-2: parallel duration changes from one cookie give exactly one new session', async () => {
    const first = await signIn('owner_race', 'always')
    assert.equal(await liveRows('owner_race'), 1)
    const answers = await Promise.all(Array.from({ length: 5 }, () => changeDuration(first.cookie, { sessionDuration: '7d' })))
    const won = answers.filter((answer) => answer.status === 200)
    assert.equal(won.length, 1, `statuses ${answers.map((answer) => answer.status)}`)
    for (const lost of answers.filter((answer) => answer.status !== 200)) {
      assert.ok([401, 409].includes(lost.status), `a refused call is a conflict, or a request that arrived after the claim: ${lost.status}`)
      assert.ok(['session_duration_conflict', 'invalid_session'].includes(lost.body.code), lost.body.code)
      assert.equal(lost.cookie, null, 'a refused call issues no cookie')
    }
    assert.equal(await liveRows('owner_race'), 1, 'one live session before, one after')
    assert.equal(await isSignedIn(first.cookie), false)
    assert.equal(await isSignedIn(won[0].cookie), true)
    const lengthened = await Promise.all(Array.from({ length: 5 }, () => changeDuration(won[0].cookie, { sessionDuration: 'always', currentPassword: PASSWORD })))
    assert.equal(lengthened.filter((answer) => answer.status === 200).length, 1, `with the password: statuses ${lengthened.map((answer) => answer.status)}`)
    assert.equal(await liveRows('owner_race'), 1)
  })

  await check('SR-2: a failed insert leaves the old session live', async () => {
    const first = await signIn('owner_boom', 'always')
    await db.prepare("UPDATE user_sessions SET device_name = 'boom' WHERE id = ?").bind((await sessionRow(first.cookie)).id).run()
    await db.prepare("CREATE TRIGGER sessions_boom BEFORE INSERT ON user_sessions WHEN NEW.device_name = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END").run()
    try {
      const failed = await changeDuration(first.cookie, { sessionDuration: '7d' })
      assert.ok(failed.status >= 500, `the insert is refused: ${failed.status}`)
      assert.equal(failed.cookie, null)
    } finally {
      await db.prepare('DROP TRIGGER sessions_boom').run()
    }
    assert.equal((await sessionRow(first.cookie)).revoked_at, null, 'the claim rolled back with the insert')
    assert.equal(await isSignedIn(first.cookie), true)
    assert.equal(await liveRows('owner_boom'), 1)
  })

  const adminRoleId = (await db.prepare("SELECT id FROM roles WHERE code = 'admin'").first()).id
  const addUsers = async (prefix, count) => {
    for (let i = 1; i <= count; i += 1) {
      await db.prepare("INSERT INTO users (username, name, password, role_id, permissions, is_active, email) VALUES (?, ?, ?, ?, '{}', 1, ?)")
        .bind(`${prefix}_${i}`, `${prefix}_${i}`, 'x', adminRoleId, `${prefix}_${i}@sessions.example`).run()
    }
  }

  await check('S3b: the administrator-approval request ceiling counts a /64 as one network', async () => {
    await addUsers('approve', 6)
    for (let i = 1; i <= 6; i += 1) {
      const res = await request('/api/auth/password-reset/admin-request', { method: 'POST', ip: inNetwork('2001:db8:5:6:0:0:0', i), body: { identifier: `approve_${i}` } })
      assert.equal(res.status, 200)
    }
    const recorded = (await db.prepare("SELECT COUNT(*) AS n FROM password_reset_requests r JOIN users u ON u.id = r.user_id WHERE u.username LIKE 'approve%'").first()).n
    assert.equal(recorded, 5, 'the sixth request from the same /64 within the hour records nothing')
  })

  await check('S3b: the e-mailed reset link ceiling counts a /64 as one network', async () => {
    await addUsers('mail', 9)
    for (let i = 1; i <= 9; i += 1) {
      const res = await request('/api/auth/password-reset/email', { method: 'POST', ip: inNetwork('2001:db8:7:8:0:0:0', i), body: { identifier: `mail_${i}` } })
      assert.equal(res.status, 200)
    }
    const rows = (await db.prepare("SELECT requester_ip FROM verification_codes WHERE target LIKE 'mail%'").all()).results
    assert.equal(rows.length, 8, 'the ninth link from the same /64 is not issued')
    assert.deepEqual([...new Set(rows.map((row) => row.requester_ip))], ['2001:db8:7:8::/64'])
  })

  console.log(`\n${passed} passed, ${failed} failed`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { if (mf) await mf.dispose() })
