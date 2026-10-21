// Owner rule: minimum storefront account age is 16. The combined tick on the
// storefront ("I am 16 or older, and I agree to ...") is a prompt; the Worker is
// the enforcement, because POST /api/portal/auth/signup is public. Every path
// that creates a portal_accounts row (the new-customer path and the
// existing-membership claim path both end in claimAccount; sign-in never
// creates one) must see ageConfirmed === true, a strict boolean.
//
// Drives the REAL routes/portal.ts against the fully migrated schema. Failures
// must answer 400 age_confirmation_required and leave no account, customer,
// session cookie or audit row behind. No column stores the confirmation (that
// needs a migration), so none is asserted.
//
// Run: node scripts/test-portal-signup-age-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

const PASSWORD = 'sup3rsecret-pass'
const auditRows = []
const h = createPortalHarness({
  settings: { customer_portal_signup_enabled: 'true' },
  overrides: { '../lib/audit': { audit: async (...args) => { auditRows.push(args) } } },
})
const count = (table) => Number(h.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get({}).n)
const snapshot = () => [count('portal_accounts'), count('customers'), count('portal_sessions'), auditRows.length]
const signup = (phone, extra, ip = '203.0.113.20') => h.request('/auth/signup', 'POST', {
  name: 'Age Visitor', phone, password: PASSWORD, consent: true, consentLocale: 'en', ...extra,
}, { ip })

async function main() {
  const refused = [
    ['missing', {}],
    ['false', { ageConfirmed: false }],
    ['the string "true"', { ageConfirmed: 'true' }],
    ['the string "on"', { ageConfirmed: 'on' }],
    ['the number 1', { ageConfirmed: 1 }],
    ['null', { ageConfirmed: null }],
  ]
  for (const [label, extra] of refused) {
    await check(`ageConfirmed ${label}: 400 age_confirmation_required, nothing written, no cookie`, async () => {
      const before = snapshot()
      const res = await signup('012 301 401', extra)
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.code, 'age_confirmation_required')
      assert.equal(res.headers.get('Set-Cookie'), null)
      assert.deepEqual(snapshot(), before)
    })
  }

  await check('the existing-membership claim path demands it too', async () => {
    h.raw.prepare("INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES ('Old Buyer', '012 555 666', '012555666', 'LC-90001')").run({})
    const before = snapshot()
    const res = await signup('012 555 666', { membershipId: 'LC-90001' })
    assert.equal(res.status, 400)
    assert.equal(res.body.code, 'age_confirmation_required')
    assert.deepEqual(snapshot(), before)
    const ok = await signup('012 555 666', { membershipId: 'LC-90001', ageConfirmed: true })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  await check('missing consent is still reported as consent first (rule order unchanged)', async () => {
    const res = await signup('012 301 402', { consent: false })
    assert.equal(res.body.code, 'consent_required')
  })

  await check('refusals are form errors: many in a row never lock the network out', async () => {
    for (let i = 0; i < 12; i += 1) assert.equal((await signup('012 301 403', {}, '203.0.113.21')).body.code, 'age_confirmation_required')
    const ok = await signup('012 301 403', { ageConfirmed: true }, '203.0.113.21')
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  await check('ageConfirmed true creates the account and the session cookie', async () => {
    const before = snapshot()
    const res = await signup('012 301 404', { ageConfirmed: true })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.ok(res.headers.get('Set-Cookie'))
    const after = snapshot()
    assert.equal(after[0], before[0] + 1)
    assert.equal(after[2], before[2] + 1)
  })

  await check('positive control: sign-in of that existing account demands no age', async () => {
    const res = await h.request('/auth/signin', 'POST', { identifier: 'Age Visitor', phone: '012 301 404', password: PASSWORD, consent: true }, { ip: '203.0.113.22' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
