// Staff login CSRF (the staff twin of G38 E5). POST /api/auth/login read
// c.req.json() with no content-type or origin check, so a cross-site
// text/plain POST -- an HTML form or a no-preflight fetch -- signed a
// victim's browser into an attacker's account wherever the browser omitted
// Origin and Sec-Fetch-Site (the global originGuard lets that through).
//
// Every unauthenticated credential write in routes/auth.ts -- /login,
// /otp/verify, /password-reset/*, /oauth/start -- now runs
// lib/requestBodyGuard requireJsonSameOriginCredentialPost first:
//   - Sec-Fetch-Site must be same-origin, or, when it is absent, Origin must
//     equal the request's own origin; otherwise 403 credential_origin_refused;
//   - Content-Type must be application/json; otherwise 415
//     credential_json_required.
//
// Drives the REAL routes/auth.ts and the REAL guard (harness/load_auth_route.cjs).
// Control: at 27a7ca975 the first check fails -- the text/plain cross-origin
// sign-in answers 200.
//
// Run: node scripts/test-auth-credential-post-guard-pure.cjs

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SELF = 'http://localhost' // the origin of h.request()'s URLs
let ipSeq = 0
const freshIp = () => `198.18.0.${(ipSeq += 1) % 250}`

function harness() {
  const h = createAuthHarness()
  h.addUser({ id: 61, username: 'victim-target', name: 'Attacker Account', password: 'attacker-pass-1' })
  return h
}
const LOGIN = { username: 'victim-target', password: 'attacker-pass-1' }

// [path, a well-formed JSON body for it]
const GUARDED = [
  ['/login', LOGIN],
  ['/otp/verify', { userId: 61, token: '123456', otpChallenge: 'x' }],
  ['/password-reset/email', { email: 'nobody@shop.test' }],
  ['/password-reset/admin-request', { identifier: 'victim-target' }],
  ['/password-reset/complete', { accessToken: 'link-token', newPassword: 'brand-new-pass-1' }],
  ['/password-reset/otp', { identifier: 'victim-target', otp: '123456', newPassword: 'brand-new-pass-1' }],
  ['/oauth/start', { mode: 'login' }],
]

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('control: a cross-origin text/plain sign-in (no Sec-Fetch-Site) is refused, not signed in', async () => {
    const h = harness()
    const res = await h.request('/login', 'POST', undefined, {
      ip: freshIp(),
      rawBody: JSON.stringify(LOGIN),
      headers: { 'Sec-Fetch-Site': null, 'Content-Type': 'text/plain;charset=UTF-8', Origin: 'https://evil.example' },
    })
    assert.equal(res.status, 403, JSON.stringify(res.body))
    assert.equal(res.body?.code, 'credential_origin_refused')
    assert.equal(res.body?.user, undefined, 'no user, no session')
  })

  await check('control: the same text/plain body with neither Origin nor Sec-Fetch-Site is refused', async () => {
    const h = harness()
    const res = await h.request('/login', 'POST', undefined, { ip: freshIp(), rawBody: JSON.stringify(LOGIN), headers: { 'Sec-Fetch-Site': null, 'Content-Type': 'text/plain' } })
    assert.equal(res.status, 403, JSON.stringify(res.body))
    assert.equal(res.body?.code, 'credential_origin_refused')
  })

  await check('the admin app\'s own sign-in still works: same-origin JSON (Sec-Fetch-Site), and Origin-only (Safari < 16.4)', async () => {
    const h = harness()
    const viaFetchMetadata = await h.request('/login', 'POST', LOGIN, { ip: freshIp() })
    assert.equal(viaFetchMetadata.status, 200, JSON.stringify(viaFetchMetadata.body))
    assert.equal(viaFetchMetadata.body?.user?.id, 61)
    const viaOrigin = await h.request('/login', 'POST', LOGIN, { ip: freshIp(), headers: { 'Sec-Fetch-Site': null, Origin: SELF } })
    assert.equal(viaOrigin.status, 200, JSON.stringify(viaOrigin.body))
    const jsonWithCharset = await h.request('/login', 'POST', undefined, { ip: freshIp(), rawBody: JSON.stringify(LOGIN), headers: { 'Content-Type': 'application/json; charset=utf-8' } })
    assert.equal(jsonWithCharset.status, 200, 'a charset parameter is still JSON')
  })

  await check('every unauthenticated credential write refuses a cross-origin or header-less request with 403', async () => {
    const h = harness()
    const foreign = [
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': 'none' },
      { 'Sec-Fetch-Site': 'cross-site', Origin: SELF },
      { 'Sec-Fetch-Site': null },
      { 'Sec-Fetch-Site': null, Origin: 'null' },
      { 'Sec-Fetch-Site': null, Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': null, Origin: 'http://localhost.evil.example' },
    ]
    for (const [route, body] of GUARDED) {
      for (const headers of foreign) {
        const res = await h.request(route, 'POST', body, { ip: freshIp(), headers })
        assert.equal(res.status, 403, `${route} ${JSON.stringify(headers)}: ${JSON.stringify(res.body)}`)
        assert.equal(res.body?.code, 'credential_origin_refused', route)
      }
    }
  })

  await check('every unauthenticated credential write refuses a same-origin non-JSON body with 415', async () => {
    const h = harness()
    for (const [route, body] of GUARDED) {
      for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null]) {
        const res = await h.request(route, 'POST', undefined, { ip: freshIp(), rawBody: JSON.stringify(body), headers: { 'Content-Type': contentType } })
        assert.equal(res.status, 415, `${route} ${contentType}: ${JSON.stringify(res.body)}`)
        assert.equal(res.body?.code, 'credential_json_required', route)
      }
    }
  })

  await check('every guarded route still reaches its handler for a same-origin JSON request', async () => {
    const h = harness()
    for (const [route, body] of GUARDED) {
      const res = await h.request(route, 'POST', body, { ip: freshIp() })
      assert.ok(![403, 415].includes(res.status) || !/^credential_/.test(String(res.body?.code || '')), `${route}: ${res.status} ${JSON.stringify(res.body)}`)
    }
  })

  await check('a refused sign-in reaches no handler: it spends no failed-attempt count', async () => {
    const h = harness()
    const ip = freshIp()
    for (let i = 0; i < 3; i += 1) {
      await h.request('/login', 'POST', undefined, { ip, rawBody: JSON.stringify({ ...LOGIN, password: 'wrong' }), headers: { 'Content-Type': 'text/plain' } })
    }
    const res = await h.request('/login', 'POST', { ...LOGIN, password: 'wrong' }, { ip })
    assert.equal(res.status, 401)
    assert.equal(res.body?.failedAttempts, 1, 'the three refused posts never reached the lockout counter')
  })

  await check('scoped to the credential writes: POST /logout, and Google\'s cross-site GET /oauth/callback, never meet the credential guard', async () => {
    const h = harness()
    // /logout is left to the global originGuard (F4); a forced logout is not a sign-in.
    const logout = await h.request('/logout', 'POST', undefined, { rawBody: '', headers: { 'Sec-Fetch-Site': null, 'Content-Type': 'text/plain' } })
    assert.equal(logout.status, 200, JSON.stringify(logout.body))
    const callback = await h.request('/oauth/callback?code=c&state=s', 'GET', undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.notEqual(callback.body?.code, 'credential_origin_refused')
    assert.notEqual(callback.body?.code, 'credential_json_required')
  })

  await check('an encoded or trailing-slash path is no way around the guard', async () => {
    const h = harness()
    for (const route of ['/%6cogin', '/login/', '/LOGIN', '/password-reset/%6ftp', '/oauth/%73tart']) {
      const res = await h.request(route, 'POST', undefined, { ip: freshIp(), rawBody: JSON.stringify(LOGIN), headers: { 'Sec-Fetch-Site': null, 'Content-Type': 'text/plain' } })
      assert.notEqual(res.status, 200, `${route}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body?.user, undefined, route)
    }
  })

  await check('the admin app sends every guarded call as JSON through apiFetch', async () => {
    const root = path.join(__dirname, '..', '..', 'frontend', 'src', 'api')
    const http = fs.readFileSync(path.join(root, 'http.ts'), 'utf8')
    assert.match(http, /const headers: Record<string, string> = \{ 'Content-Type': 'application\/json'/, 'apiFetch always declares JSON')
    assert.match(http, /requestInit\.body = JSON\.stringify\(body\)/)
    const transport = fs.readFileSync(path.join(root, 'authTransport.ts'), 'utf8')
    for (const route of ['/api/auth/login', '/api/auth/otp/verify', '/api/auth/password-reset/otp', '/api/auth/password-reset/email', '/api/auth/password-reset/admin-request', '/api/auth/password-reset/complete', '/api/auth/oauth/start']) {
      assert.ok(transport.includes(`apiFetch('POST', '${route}'`), `${route} goes through apiFetch`)
    }
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
