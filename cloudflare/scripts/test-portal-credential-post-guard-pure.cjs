// G38 E5: login CSRF on the storefront credential endpoints.
//
// Before this fix POST /api/portal/auth/signin parsed a text/plain body as
// JSON, and the global originGuard (F4) lets a write through when it carries
// neither Origin nor Sec-Fetch-Site. A cross-site form or no-preflight
// text/plain fetch could therefore sign a victim's browser into an
// attacker's member account wherever a browser omits those headers. Staff
// /api/auth/login already demanded a same-origin JSON request
// (lib/requestBodyGuard credentialPostRefusal); routes/portal.ts never
// registered it. Every storefront write that rides or plants the bos_portal
// cookie -- /auth/*, /account/*, /submissions -- now does.
//
//   1. The pure rule, case by case, including the Safari (< 16.4) path:
//      no Sec-Fetch-Site but Origin equal to the request's own origin.
//   2. Through the REAL routes/portal.ts: a text/plain sign-in with valid
//      credentials and no browser headers gets no session (403, no cookie);
//      text/plain from the page itself is 415; cross-site / same-site / none
//      / a foreign Origin are 403; sign-up, sign-out, the saved cart and
//      wishlist and a screenshot submission are covered too; same-origin
//      JSON still signs in (positive control); GET /auth/me is untouched.
//
// test-portal-credential-post-guard-native.cjs drives the same contract
// through the whole Worker (global originGuard included) on workerd.
//
// SECURITY_TEST_BASE=<sha> loads that commit's routes/portal.ts: 0baa53f2f
// must FAIL the route checks (it answers the text/plain sign-in with 200 and
// a session cookie). Ported from donor 2e2d2dd8c (its member link request
// check is replaced by the cart / wishlist / submission check; that route is
// not on this base).
//
// Run: node scripts/test-portal-credential-post-guard-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const root = path.resolve(__dirname, '..')
const base = process.env.SECURITY_TEST_BASE
const portalSource = base
  ? execFileSync('git', ['show', `${base}:cloudflare/src/routes/portal.ts`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'src', 'routes', 'portal.ts'), 'utf8')
const sources = base ? { 'routes/portal.ts': portalSource } : {}

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

function loadGuard() {
  const file = path.join(root, 'src', 'lib', 'requestBodyGuard.ts')
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', out)(require, mod, mod.exports)
  return mod.exports
}

const SITE = 'https://leangbeauty.com'
const URL_ = `${SITE}/api/portal/auth/signin`
const PHONE = '012 888 222'
const PASSWORD = 'visitor-pass'
const CREDS = { identifier: 'Visitor', phone: PHONE, password: PASSWORD, consent: true }
// Sign-up is off unless explicitly enabled (owner ruling 6 Oct); the fixture
// member needs it on, and screenshot submissions are off unless switched on.
const OPEN = { customer_portal_signup_enabled: 'true', customer_portal_submission_enabled: 'true' }

async function withMember() {
  const h = createPortalHarness({ sources, settings: OPEN })
  const signup = await h.request('/auth/signup', 'POST', { name: 'Visitor', phone: PHONE, password: PASSWORD, consent: true, ageConfirmed: true, consentLocale: 'en' }, { ip: '192.0.2.1' })
  assert.equal(signup.status, 200, `fixture sign-up: ${JSON.stringify(signup.body)}`)
  return h
}
const sessions = (h) => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM portal_sessions').get({}).n)
const accounts = (h) => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get({}).n)
const cookieOf = (response) => String(response.headers.get('Set-Cookie') || '').split(';')[0]

async function main() {
  await check('rule: only a same-origin JSON write passes; reads are untouched', () => {
    const { credentialPostRefusal } = loadGuard()
    const code = (over) => {
      const r = credentialPostRefusal({ method: 'POST', url: URL_, contentType: 'application/json', origin: null, secFetchSite: 'same-origin', ...over })
      return r ? `${r.status} ${r.code}` : 'pass'
    }
    const table = [
      [{}, 'pass'],
      [{ contentType: 'application/json; charset=utf-8' }, 'pass'],
      [{ contentType: 'Application/JSON' }, 'pass'],
      [{ secFetchSite: null, origin: SITE }, 'pass'], // Safari < 16.4: Origin only
      [{ secFetchSite: null, origin: 'HTTPS://LEANGBEAUTY.COM' }, 'pass'],
      [{ contentType: 'text/plain' }, '415 credential_json_required'],
      [{ contentType: 'text/plain;charset=UTF-8' }, '415 credential_json_required'],
      [{ contentType: 'application/x-www-form-urlencoded' }, '415 credential_json_required'],
      [{ contentType: 'multipart/form-data; boundary=x' }, '415 credential_json_required'],
      [{ contentType: null }, '415 credential_json_required'],
      [{ contentType: 'application/jsonx' }, '415 credential_json_required'],
      [{ secFetchSite: null, origin: null }, '403 credential_origin_refused'], // F4 lets this through
      [{ secFetchSite: 'cross-site' }, '403 credential_origin_refused'],
      [{ secFetchSite: 'same-site' }, '403 credential_origin_refused'],
      [{ secFetchSite: 'none' }, '403 credential_origin_refused'],
      [{ secFetchSite: 'cross-site', origin: SITE }, '403 credential_origin_refused'], // the browser's word wins
      [{ secFetchSite: null, origin: 'https://evil.example' }, '403 credential_origin_refused'],
      [{ secFetchSite: null, origin: 'null' }, '403 credential_origin_refused'],
      [{ secFetchSite: null, origin: 'https://leangbeauty.com.evil.example' }, '403 credential_origin_refused'],
      [{ secFetchSite: null, origin: 'http://leangbeauty.com' }, '403 credential_origin_refused'],
      [{ method: 'GET', secFetchSite: 'cross-site', contentType: null }, 'pass'],
      [{ method: 'HEAD', secFetchSite: null, contentType: null }, 'pass'],
      [{ method: 'DELETE', contentType: null }, 'pass'], // no body to type
      [{ method: 'DELETE', contentType: null, secFetchSite: 'cross-site' }, '403 credential_origin_refused'],
      [{ method: 'PUT', contentType: 'text/plain' }, '415 credential_json_required'],
    ]
    for (const [over, want] of table) assert.equal(code(over), want, JSON.stringify(over))
  })

  await check('route: a text/plain sign-in with valid credentials and no browser headers gets no session', async () => {
    const h = await withMember()
    const before = sessions(h)
    const res = await h.request('/auth/signin', 'POST', undefined, {
      ip: '198.51.100.7', rawBody: JSON.stringify(CREDS),
      headers: { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': null },
    })
    assert.equal(res.headers.get('Set-Cookie'), null, 'login CSRF: no session cookie for a header-less text/plain post')
    assert.equal(res.status, 403)
    assert.equal(res.body.code, 'credential_origin_refused')
    assert.equal(sessions(h), before, 'no session row written')
  })

  await check('route: text/plain from the page itself is 415; cross-site / same-site / none / foreign Origin are 403; none sets a cookie', async () => {
    const h = await withMember()
    const before = sessions(h)
    const cases = [
      [{ 'Content-Type': 'text/plain' }, 415],
      [{ 'Content-Type': 'application/x-www-form-urlencoded' }, 415],
      [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
      [{ 'Sec-Fetch-Site': 'same-site' }, 403],
      [{ 'Sec-Fetch-Site': 'none' }, 403],
      [{ 'Sec-Fetch-Site': null, Origin: 'https://evil.example' }, 403],
      [{ 'Sec-Fetch-Site': null }, 403],
    ]
    for (const [headers, status] of cases) {
      const res = await h.request('/auth/signin', 'POST', undefined, { ip: '198.51.100.8', rawBody: JSON.stringify(CREDS), headers })
      assert.equal(res.status, status, JSON.stringify(headers))
      assert.equal(res.headers.get('Set-Cookie'), null, JSON.stringify(headers))
    }
    assert.equal(sessions(h), before)
  })

  await check('positive control: same-origin JSON signs in, and so does Safari sending Origin only', async () => {
    const h = await withMember()
    const res = await h.request('/auth/signin', 'POST', CREDS, { ip: '198.51.100.9' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.ok(res.headers.get('Set-Cookie'))
    // app.request resolves a bare path against http://localhost.
    const safari = await h.request('/auth/signin', 'POST', CREDS, { ip: '198.51.100.10', headers: { 'Sec-Fetch-Site': null, Origin: 'http://localhost' } })
    assert.equal(safari.status, 200, JSON.stringify(safari.body))
    assert.ok(safari.headers.get('Set-Cookie'))
  })

  await check('route: a cross-site or text/plain sign-up writes nothing', async () => {
    const h = createPortalHarness({ sources, settings: OPEN })
    const body = { name: 'Forged', phone: '012 999 333', password: 'forged-pass', consent: true, ageConfirmed: true, consentLocale: 'en' }
    const plain = await h.request('/auth/signup', 'POST', undefined, { ip: '198.51.100.11', rawBody: JSON.stringify(body), headers: { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': null } })
    const cross = await h.request('/auth/signup', 'POST', body, { ip: '198.51.100.11', headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(plain.status, 403)
    assert.equal(cross.status, 403)
    assert.equal(accounts(h), 0)
    assert.equal(plain.headers.get('Set-Cookie'), null)
  })

  await check('route: cross-site sign-out keeps the session; GET /auth/me is not a write and still answers', async () => {
    const h = await withMember()
    const signin = await h.request('/auth/signin', 'POST', CREDS, { ip: '198.51.100.12' })
    const cookie = cookieOf(signin)
    assert.ok(cookie)
    const out = await h.request('/auth/signout', 'POST', {}, { ip: '198.51.100.12', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(out.status, 403)
    const me = await h.request('/auth/me', 'GET', undefined, { ip: '198.51.100.12', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(me.status, 200, 'the session survived the forged sign-out')
    assert.ok(me.body.account, 'still signed in')
  })

  await check('route: the saved cart, wishlist and a screenshot submission need a same-origin JSON write too', async () => {
    const h = await withMember()
    const signin = await h.request('/auth/signin', 'POST', CREDS, { ip: '198.51.100.13' })
    const cookie = cookieOf(signin)
    assert.ok(cookie)
    const buckets = () => h.raw.prepare('SELECT cart_json, wishlist_json FROM portal_accounts LIMIT 1').get({})
    const submissions = () => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get({}).n)
    const before = { buckets: buckets(), submissions: submissions() }
    const writes = [
      ['PUT', '/account/cart', { items: [{ id: 'forged', qty: 9 }] }],
      ['PUT', '/account/wishlist', { items: [{ id: 'forged' }] }],
      ['POST', '/submissions', { rightsConsent: true, privacyConsent: true, screenshots: [] }],
    ]
    for (const [method, pathname, payload] of writes) {
      const plain = await h.request(pathname, method, undefined, { ip: '198.51.100.13', rawBody: JSON.stringify(payload), headers: { Cookie: cookie, 'Content-Type': 'text/plain', 'Sec-Fetch-Site': null } })
      assert.deepEqual([plain.status, plain.body && plain.body.code], [403, 'credential_origin_refused'], `${method} ${pathname} header-less text/plain`)
      const typed = await h.request(pathname, method, undefined, { ip: '198.51.100.13', rawBody: JSON.stringify(payload), headers: { Cookie: cookie, 'Content-Type': 'text/plain' } })
      assert.deepEqual([typed.status, typed.body && typed.body.code], [415, 'credential_json_required'], `${method} ${pathname} same-origin text/plain`)
      const cross = await h.request(pathname, method, payload, { ip: '198.51.100.13', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
      assert.deepEqual([cross.status, cross.body && cross.body.code], [403, 'credential_origin_refused'], `${method} ${pathname} cross-site`)
    }
    assert.deepEqual(buckets(), before.buckets, 'refused writes leave the saved buckets alone')
    assert.equal(submissions(), before.submissions, 'nothing filed')
    // Positive controls: the storefront's own requests (portalPublicTransport.ts).
    const cart = await h.request('/account/cart', 'PUT', { items: [{ id: 'p-1', qty: 2 }] }, { ip: '198.51.100.13', headers: { Cookie: cookie } })
    assert.equal(cart.status, 200, JSON.stringify(cart.body))
    const wish = await h.request('/account/wishlist', 'PUT', { items: [{ id: 'p-2' }] }, { ip: '198.51.100.13', headers: { Cookie: cookie } })
    assert.equal(wish.status, 200, JSON.stringify(wish.body))
    const read = await h.request('/account/cart', 'GET', undefined, { ip: '198.51.100.13', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(read.status, 200, 'GET of the saved cart is not a write')
    const share = await h.request('/submissions', 'POST', { screenshots: [] }, { ip: '198.51.100.13', headers: { Cookie: cookie } })
    assert.deepEqual([share.status, share.body && share.body.code], [400, 'submission_consent_required'], 'a same-origin JSON submission reaches its own validation')
  })

  await check('the guard is registered before the first /auth, /account and /submissions handler (Hono runs in registration order)', () => {
    const src = portalSource
    for (const [prefix, line] of [
      ['/auth/', "app.use('/auth/*', requireJsonSameOriginCredentialPost)"],
      ['/account/', "app.use('/account/*', requireJsonSameOriginCredentialPost)"],
      ['/submissions', "app.use('/submissions', requireJsonSameOriginCredentialPost)"],
    ]) {
      const use = src.indexOf(line)
      const first = src.search(new RegExp(`app\\.(post|put|patch|delete|get)\\('${prefix.replace(/[/]/g, '\\/')}`))
      assert.ok(use > 0 && first > 0 && use < first, `${line} precedes every ${prefix} route`)
    }
  })

  console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
