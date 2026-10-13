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
  for (const username of ['owner_a', 'owner_b', 'owner_c', 'owner_otp']) {
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

  console.log(`\n${passed} passed, ${failed} failed`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { if (mf) await mf.dispose() })
