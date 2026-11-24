// G38 S1: a W- member code that cannot be minted never breaks the shopper's own requests.
//
// Drives the REAL routes/portal.ts (sign-in, GET /auth/me, POST /account/consent/renew) against the fully migrated
// schema, with a database that refuses the mint UPDATE for a reason other than a duplicate code (write quota,
// overload, any D1 error). Each request must still succeed and answer memberCode null; the next request mints.
// The mutant is the same source with the failure rethrown, and must fail the same checks.
//
// Run (from cloudflare/): node scripts/test-portal-member-code-mint-failure-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const PASSWORD = 'sup3rsecret-pass'
const OLD_CONSENT = 'portal-legal-2026-09-30'
const portalAccountsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalAccounts.ts'), 'utf8').replace(/\r\n/g, '\n')

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

function makeWorld(sources) {
  const state = { refuseMint: null, refusedCalls: 0 }
  let harness = null
  const refusing = () => {
    const base = harness.db
    return {
      ...base,
      prepare(sql) {
        if (state.refuseMint && /SET\s+member_code\s*=/i.test(sql)) {
          return {
            get: async () => { state.refusedCalls += 1; throw new Error(state.refuseMint) },
            all: async () => { state.refusedCalls += 1; throw new Error(state.refuseMint) },
            run: async () => { state.refusedCalls += 1; throw new Error(state.refuseMint) },
          }
        }
        return base.prepare(sql)
      },
    }
  }
  const dbModule = { getDb: () => refusing() }
  harness = createPortalHarness({
    settings: { customer_portal_signup_enabled: 'true' },
    overrides: { '../lib/db': dbModule, './db': dbModule },
    sources,
  })
  return { h: harness, state }
}

async function signUpAndIn(h, phone = '012 900 100') {
  const signup = await h.request('/auth/signup', 'POST', { name: 'Mint Visitor', phone, password: PASSWORD, consent: true, consentLocale: 'en', ageConfirmed: true })
  assert.equal(signup.status, 200, JSON.stringify(signup.body))
  const membershipId = signup.body.account?.membershipId || signup.body.membershipId
  assert.ok(membershipId, JSON.stringify(signup.body))
  return { membershipId, phone }
}
const signIn = (h, who) => h.request('/auth/signin', 'POST', { identifier: who.membershipId, phone: who.phone, password: PASSWORD, consent: true, consentLocale: 'en', ageConfirmed: true })
const cookieOf = (res) => {
  const header = res.headers.get('Set-Cookie') || ''
  const match = /^([^=]+=[^;]*)/.exec(header)
  return match ? match[1] : ''
}
const storedCode = (h) => h.raw.prepare('SELECT member_code FROM portal_accounts ORDER BY id LIMIT 1').get({}).member_code

async function scenarios(label, sources) {
  await check(`${label}: sign-in succeeds with the session set and memberCode null when the mint is refused, then the next sign-in mints`, async () => {
    const { h, state } = makeWorld(sources)
    const who = await signUpAndIn(h)
    const sessionsBefore = h.raw.prepare('SELECT COUNT(*) AS n FROM portal_sessions').get({}).n
    state.refuseMint = 'D1_ERROR: write quota exceeded'
    const res = await signIn(h, who)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.ok, true)
    assert.equal(res.body.account.memberCode, null)
    assert.equal(res.body.account.membershipId, who.membershipId, 'the LC number is still shown')
    assert.ok(cookieOf(res), 'the session cookie is set')
    assert.ok(state.refusedCalls > 0, 'the mint was attempted')
    assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM portal_sessions').get({}).n, sessionsBefore + 1, 'exactly one session row for the answered sign-in')
    assert.equal(storedCode(h), null)
    state.refuseMint = null
    const again = await signIn(h, who)
    assert.equal(again.status, 200)
    assert.match(again.body.account.memberCode, /^W-/, 'the next call tries again and mints')
    assert.equal(storedCode(h), again.body.account.memberCode)
  })

  await check(`${label}: GET /auth/me answers 200 with memberCode null when the mint is refused`, async () => {
    const { h, state } = makeWorld(sources)
    const who = await signUpAndIn(h)
    const cookie = cookieOf(await signIn(h, who))
    h.raw.prepare('UPDATE portal_accounts SET member_code = NULL').run({})
    state.refuseMint = 'D1_ERROR: overloaded'
    const res = await h.request('/auth/me', 'GET', undefined, { headers: { Cookie: cookie } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.account.memberCode, null)
    assert.equal(res.body.account.name, 'Mint Visitor')
  })

  await check(`${label}: consent renewal answers 200 and renews with memberCode null when the mint is refused`, async () => {
    const { h, state } = makeWorld(sources)
    const who = await signUpAndIn(h)
    const cookie = cookieOf(await signIn(h, who))
    h.raw.prepare('UPDATE portal_accounts SET member_code = NULL, consent_version = ?').run([OLD_CONSENT])
    state.refuseMint = 'D1_ERROR: write quota exceeded'
    const res = await h.request('/account/consent/renew', 'POST', { consent: true, ageConfirmed: true, consentLocale: 'en' }, { headers: { Cookie: cookie } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.ok, true)
    assert.equal(res.body.renewed, true)
    assert.equal(res.body.account.memberCode, null)
    assert.equal(h.raw.prepare('SELECT consent_version FROM portal_accounts LIMIT 1').get({}).consent_version, 'portal-legal-2026-10-20')
  })
}

async function main() {
  await scenarios('fixed source', undefined)

  const mutant = portalAccountsSource.replace(
    "portal_member_code_mint_failed', error instanceof Error ? error.message : String(error))\n      return null",
    "portal_member_code_mint_failed', error instanceof Error ? error.message : String(error))\n      throw error",
  )
  const mutantApplied = mutant !== portalAccountsSource
  await check('the mutant that rethrows is applied to the real source', async () => assert.ok(mutantApplied, 'mutant text not found in lib/portalAccounts.ts'))
  if (mutantApplied) {
    const before = failed
    const savedExit = process.exitCode
    await scenarios('mutant (rethrow)', { 'lib/portalAccounts.ts': mutant })
    const mutantFailures = failed - before
    failed = before
    process.exitCode = savedExit
    await check('the rethrowing mutant turns all three scenarios red', async () => assert.equal(mutantFailures, 3, `${mutantFailures} of 3 failed`))
  }
  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
