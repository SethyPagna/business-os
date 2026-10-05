// G38 Phase 1 acceptance, storefront side, through the REAL routes/portal.ts
// (harness/load_portal_auth_route.cjs: real auth chain, migrated SQLite).
//
//   1. Sign-up with a phone that IS in customers and one that is NOT:
//      identical status, body shape and Set-Cookie behaviour; customer count
//      unchanged in both. (bb639041 / 4ab47676e answer 409 vs 200 and write a
//      customer row: they must FAIL this.)
//   2. Sign-up with membershipId 'LC-00001' + the matching phone does NOT set
//      contact_id (the old code linked it).
//   3. GET /auth/me is an allowlist: membershipId, memberCode, name, email,
//      linked -- no customer id or name, no points, no sales. Owner answer 4
//      (5 Oct) supersedes the design's "no LC number": a LINKED member's
//      membershipId is the customer's LC number; the W- code stays memberCode.
//   4. The "Request link" button: always "in_review", one pending request per
//      member, withdrawable; an already linked member is told so.
//   5. The identity-check code a member reads to staff: six digits, accepted
//      by the staff-side verifier, dead after any link change.
//
// SECURITY_TEST_BASE=<sha> loads that commit's portal.ts, portalAccounts.ts
// and portalSession.ts: run with 4ab47676e to watch checks 1-3 fail.
//
// Run: node scripts/test-portal-members-signup-oracle-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const root = path.resolve(__dirname, '..')
const base = process.env.SECURITY_TEST_BASE
const sources = base
  ? Object.fromEntries(['routes/portal.ts', 'lib/portalAccounts.ts', 'lib/portalSession.ts'].map((rel) => (
    [rel, execFileSync('git', ['show', `${base}:cloudflare/src/${rel}`], { cwd: root, encoding: 'utf8' })]
  )))
  : {}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

const count = (h, table) => Number(h.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get({}).n)
const signup = (h, body, ip) => h.request('/auth/signup', 'POST', { password: 'visitor-pass', consent: true, consentLocale: 'km', ...body }, { ip })
const cookieOf = (response) => (response.headers.get('Set-Cookie') || '').split(';')[0]
const withCookie = (cookie) => ({ headers: { Cookie: cookie } })

// Shape of a JSON value: same keys and types all the way down, values ignored.
function shape(value) {
  if (Array.isArray(value)) return value.map(shape)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
  return value === null ? 'null' : typeof value
}

async function main() {
  await check('a phone in customers and one that is not: same status, body shape, cookie; no customer written', async () => {
    const h = createPortalHarness({ sources })
    h.raw.prepare("INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES ('Known Customer', '012 777 111', '012777111', 'LC-00010')").run({})
    const customersBefore = count(h, 'customers')
    const known = await signup(h, { name: 'Known Customer', phone: '012 777 111' }, '203.0.113.1')
    const fresh = await signup(h, { name: 'New Visitor', phone: '012 888 222' }, '203.0.113.2')
    assert.equal(known.status, fresh.status, `status ${known.status} vs ${fresh.status}`)
    assert.equal(known.status, 200)
    assert.deepEqual(shape(known.body), shape(fresh.body), 'body shape depends on the phone')
    assert.ok(cookieOf(known).startsWith('bos_portal='), 'known phone gets a session cookie')
    assert.ok(cookieOf(fresh).startsWith('bos_portal='), 'new phone gets a session cookie')
    assert.equal(count(h, 'customers'), customersBefore, 'sign-up wrote a customer row')
  })

  await check("membershipId 'LC-00001' + the matching phone does not link the account", async () => {
    const h = createPortalHarness({ sources })
    h.raw.prepare("INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES ('Receipt Holder', '012 600 600', '012600600', 'LC-00001')").run({})
    const res = await signup(h, { name: 'Receipt Holder', phone: '012 600 600', membershipId: 'LC-00001' }, '203.0.113.3')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = h.raw.prepare("SELECT contact_id FROM portal_accounts WHERE phone = '012600600'").get({})
    assert.equal(row.contact_id, null, 'the account was attached to the customer')
  })

  await check('/auth/me is an allowlist; a linked member sees the store number, nothing else of the customer', async () => {
    const h = createPortalHarness({ sources })
    const res = await signup(h, { name: 'Web Dara', phone: '012 300 300' }, '203.0.113.4')
    const cookie = cookieOf(res)
    const unlinked = await h.request('/auth/me', 'GET', undefined, withCookie(cookie))
    assert.deepEqual(Object.keys(unlinked.body), ['account'])
    assert.deepEqual(Object.keys(unlinked.body.account).sort(), ['email', 'linked', 'memberCode', 'membershipId', 'name'])
    assert.match(unlinked.body.account.membershipId, /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    assert.equal(unlinked.body.account.linked, false)

    h.raw.prepare("INSERT INTO customers (id, name, phone, membership_number, notes) VALUES (900, 'Secret Store Name', '099 000 111', 'LC-00900', 'staff only note')").run({})
    h.raw.prepare("INSERT INTO loyalty_point_adjustments (customer_id, points) VALUES (900, 4321)").run({})
    h.raw.prepare("INSERT INTO sales (customer_id, customer_name, total_usd) VALUES (900, 'Secret Store Name', 77.25)").run({})
    h.raw.prepare("UPDATE portal_accounts SET contact_id = 900 WHERE phone = '012300300'").run({})
    const linked = await h.request('/auth/me', 'GET', undefined, withCookie(cookie))
    assert.deepEqual(Object.keys(linked.body), ['account'])
    assert.deepEqual(Object.keys(linked.body.account).sort(), ['email', 'linked', 'memberCode', 'membershipId', 'name'])
    assert.equal(linked.body.account.membershipId, 'LC-00900', 'owner answer 4: a linked member sees the store number')
    assert.equal(linked.body.account.memberCode, unlinked.body.account.memberCode, 'the W- code stays as the alias')
    assert.equal(linked.body.account.linked, true)
    const text = JSON.stringify(linked.body)
    for (const secret of ['Secret Store Name', 'staff only note', '4321', '77.25', '"900"', ':900']) {
      assert.ok(!text.includes(secret), `/auth/me leaked ${secret}`)
    }
  })

  await check('sign-in answers with the same allowlisted view', async () => {
    const h = createPortalHarness({ sources })
    await signup(h, { name: 'Sign In', phone: '012 301 301' }, '203.0.113.5')
    const res = await h.request('/auth/signin', 'POST', { identifier: 'Sign In', phone: '012 301 301', password: 'visitor-pass', consent: true }, { ip: '203.0.113.6' })
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body.account).sort(), ['email', 'linked', 'memberCode', 'membershipId', 'name'])
  })

  await check('Request link: always in_review, one pending per member, withdrawable; linked members are told', async () => {
    const h = createPortalHarness({ sources })
    const res = await signup(h, { name: 'Asker', phone: '012 302 302' }, '203.0.113.7')
    const cookie = cookieOf(res)
    assert.equal((await h.request('/account/link-request', 'POST', {}, { ip: '203.0.113.7' })).status, 401, 'needs a session')
    const first = await h.request('/account/link-request', 'POST', { note: 'I buy at the Russian market shop' }, withCookie(cookie))
    const second = await h.request('/account/link-request', 'POST', { note: 'again' }, withCookie(cookie))
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.body.request.status, 'in_review')
    assert.deepEqual(second.body.request, first.body.request, 'a second press returns the pending request')
    assert.equal(count(h, 'portal_member_link_requests'), 1)
    const read = await h.request('/account/link-request', 'GET', undefined, withCookie(cookie))
    assert.deepEqual(read.body, { request: first.body.request, linked: false })
    assert.equal((await h.request('/account/link-request', 'DELETE', undefined, withCookie(cookie))).status, 200)
    assert.equal(h.raw.prepare('SELECT status FROM portal_member_link_requests').get({}).status, 'withdrawn')
    assert.equal((await h.request('/account/link-request', 'GET', undefined, withCookie(cookie))).body.request, null)

    h.raw.prepare("INSERT INTO customers (id, name, membership_number) VALUES (901, 'Store Asker', 'LC-00901')").run({})
    h.raw.prepare("UPDATE portal_accounts SET contact_id = 901 WHERE phone = '012302302'").run({})
    const linked = await h.request('/account/link-request', 'POST', {}, withCookie(cookie))
    assert.equal(linked.status, 409)
    assert.equal(linked.body.code, 'member_already_linked')
  })

  await check('the identity-check code: six digits, accepted by the staff verifier, dead after a link change', async () => {
    const h = createPortalHarness({ sources })
    const res = await signup(h, { name: 'Coder', phone: '012 303 303' }, '203.0.113.8')
    const cookie = cookieOf(res)
    const got = await h.request('/account/link-code', 'GET', undefined, withCookie(cookie))
    assert.equal(got.status, 200)
    assert.match(got.body.code, /^\d{6}$/)
    assert.ok(got.body.expiresInSeconds > 600 && got.body.expiresInSeconds <= 1200)
    assert.equal(got.headers.get('Cache-Control'), 'no-store')
    const accounts = h.load('lib/portalAccounts.ts')
    const row = h.raw.prepare("SELECT id, link_version FROM portal_accounts WHERE phone = '012303303'").get({})
    assert.equal(await accounts.verifyPortalLinkCheckCode(h.env, row.id, row.link_version, got.body.code), true)
    assert.equal(await accounts.verifyPortalLinkCheckCode(h.env, row.id, row.link_version, '000000'.replace(/./g, (d, i) => String((Number(got.body.code[i]) + 1) % 10))), false, 'a different code fails')
    assert.equal(await accounts.verifyPortalLinkCheckCode(h.env, row.id, row.link_version + 1, got.body.code), false, 'a link change kills the code')
    assert.equal(await accounts.verifyPortalLinkCheckCode(h.env, row.id + 1, row.link_version, got.body.code), false, "another member's code fails")
    // Ten minutes later it still works (previous window); twenty minutes later it does not.
    const later = Date.now() + 10 * 60 * 1000
    assert.equal(await accounts.verifyPortalLinkCheckCode(h.env, row.id, row.link_version, got.body.code, later), true)
    assert.equal(await accounts.verifyPortalLinkCheckCode(h.env, row.id, row.link_version, got.body.code, Date.now() + 21 * 60 * 1000), false)
  })

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
