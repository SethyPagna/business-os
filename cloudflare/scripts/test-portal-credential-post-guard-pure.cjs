// G38 E5: login CSRF on the storefront credential endpoints.
//
// Before this fix POST /api/portal/auth/signin parsed a text/plain body as
// JSON, and the global originGuard (F4) lets a write through when it carries
// neither Origin nor Sec-Fetch-Site. A cross-site form or no-preflight
// text/plain fetch could therefore sign a victim's browser into an
// attacker's member account wherever a browser omits those headers. Every
// write under /auth/* and the member's link request now demands a same-origin
// JSON request (lib/requestBodyGuard credentialPostRefusal).
//
//   1. The pure rule, case by case, including the Safari (< 16.4) path:
//      no Sec-Fetch-Site but Origin equal to the request's own origin.
//   2. Through the REAL routes/portal.ts: a text/plain sign-in with valid
//      credentials and no browser headers gets no session (403, no cookie);
//      text/plain from the page itself is 415; cross-site / same-site / none
//      / a foreign Origin are 403; sign-up and sign-out and the link request
//      are covered too; same-origin JSON still signs in (positive control);
//      GET /auth/me is untouched.
//
// SECURITY_TEST_BASE=<sha> loads that commit's routes/portal.ts: 9300c775e
// must FAIL the route checks (it answers the text/plain sign-in with 200 and
// a session cookie).
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
const sources = base
  ? { 'routes/portal.ts': execFileSync('git', ['show', `${base}:cloudflare/src/routes/portal.ts`], { cwd: root, encoding: 'utf8' }) }
  : {}

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

async function withMember() {
  const h = createPortalHarness({ sources, settings: { customer_portal_signup_enabled: 'true' } })
  const signup = await h.request('/auth/signup', 'POST', { name: 'Visitor', phone: PHONE, password: PASSWORD, consent: true, consentLocale: 'en' }, { ip: '192.0.2.1' })
  assert.equal(signup.status, 200, `fixture sign-up: ${JSON.stringify(signup.body)}`)
  return h
}
const sessions = (h) => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM portal_sessions').get({}).n)
const accounts = (h) => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get({}).n)

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
    const h = createPortalHarness({ sources, settings: { customer_portal_signup_enabled: 'true' } })
    const body = { name: 'Forged', phone: '012 999 333', password: 'forged-pass', consent: true, consentLocale: 'en' }
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
    const cookie = String(signin.headers.get('Set-Cookie') || '').split(';')[0]
    assert.ok(cookie)
    const out = await h.request('/auth/signout', 'POST', {}, { ip: '198.51.100.12', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(out.status, 403)
    const me = await h.request('/auth/me', 'GET', undefined, { ip: '198.51.100.12', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(me.status, 200, 'the session survived the forged sign-out')
  })

  await check('route: the member link request needs a same-origin JSON post too', async () => {
    const h = await withMember()
    const signin = await h.request('/auth/signin', 'POST', CREDS, { ip: '198.51.100.13' })
    const cookie = String(signin.headers.get('Set-Cookie') || '').split(';')[0]
    const plain = await h.request('/account/link-request', 'POST', undefined, { ip: '198.51.100.13', rawBody: '{"note":"x"}', headers: { Cookie: cookie, 'Content-Type': 'text/plain' } })
    assert.equal(plain.status, 415)
    const cross = await h.request('/account/link-request', 'DELETE', undefined, { ip: '198.51.100.13', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(cross.status, 403)
    const pending = Number(h.raw.prepare("SELECT COUNT(*) AS n FROM portal_member_link_requests WHERE status = 'pending'").get({}).n)
    assert.equal(pending, 0, 'nothing filed')
    const ok = await h.request('/account/link-request', 'POST', { note: 'x' }, { ip: '198.51.100.13', headers: { Cookie: cookie } })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  await check('the guard is registered before the first /auth handler (Hono runs in registration order)', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'routes', 'portal.ts'), 'utf8')
    const use = src.indexOf("app.use('/auth/*', requireJsonSameOriginCredentialPost)")
    const first = src.search(/app\.(post|put|patch|delete|get)\('\/auth\//)
    assert.ok(use > 0 && use < first, 'app.use precedes every /auth route')
  })

  console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
