// G38 P0, owner answer 5 Oct: new storefront phone + password sign-ups stay
// OPEN until Telegram verification ships (Phase 3), behind a setting the
// owner can switch off without a deploy: customer_portal_signup_enabled
// (default true). When it is off, sign-up answers one identical 403
// portal_signup_paused for every phone -- known customer or not -- reads no
// customer, writes nothing and sets no cookie; existing accounts still sign
// in. This is the no-schema way to stop the sign-up phone oracle and the CRM
// row per probe (design S2) on demand; the full fix is Phase 1 (M1).
//
// Drives the REAL routes/portal.ts against the migrated schema. Positive
// control: with the switch at its default the same two phones DO answer
// differently (409 vs 200), so the "identical answer" check can see a
// difference. SECURITY_TEST_BASE=<sha> loads that commit's portal.ts
// (bb639041d must FAIL).
//
// Run: node scripts/test-portal-signup-pause-setting-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const root = path.resolve(__dirname, '..')
const sources = process.env.SECURITY_TEST_BASE
  ? { 'routes/portal.ts': execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/routes/portal.ts`], { cwd: root, encoding: 'utf8' }) }
  : {}

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

const KNOWN_PHONE = '012 777 111'
const NEW_PHONE = '012 888 222'

function setup(signupSetting) {
  const h = createPortalHarness({ sources })
  h.raw.prepare("INSERT INTO customers (name, phone, phone_normalized) VALUES ('Known Customer', @phone, @norm)").run({ phone: KNOWN_PHONE, norm: '012777111' })
  if (signupSetting !== undefined) h.raw.prepare("INSERT INTO settings (key, value) VALUES ('customer_portal_signup_enabled', @v)").run({ v: signupSetting })
  return h
}
const count = (h, table) => Number(h.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get({}).n)
const signup = (h, phone, ip) => h.request('/auth/signup', 'POST', { name: 'Visitor', phone, password: 'visitor-pass', consent: true, consentLocale: 'km' }, { ip })

async function main() {
  await check('positive control: at the default the two phones answer differently (sign-up open)', async () => {
    const h = setup(undefined)
    const known = await signup(h, KNOWN_PHONE, '203.0.113.1')
    const fresh = await signup(h, NEW_PHONE, '203.0.113.2')
    assert.equal(known.status, 409)
    assert.equal(fresh.status, 200, 'sign-up stays open by default (owner: allow until Phase 3)')
    assert.notDeepEqual([known.status, known.body], [fresh.status, fresh.body])
  })

  await check('paused: one identical answer for a known and an unknown phone, nothing written, no cookie', async () => {
    const h = setup('false')
    const customersBefore = count(h, 'customers')
    const accountsBefore = count(h, 'portal_accounts')
    const known = await signup(h, KNOWN_PHONE, '203.0.113.1')
    const fresh = await signup(h, NEW_PHONE, '203.0.113.2')
    assert.equal(known.status, 403)
    assert.deepEqual([known.status, known.body], [fresh.status, fresh.body], 'the answer does not depend on the phone')
    assert.equal(known.body.code, 'portal_signup_paused')
    assert.equal(known.headers.get('Set-Cookie'), null)
    assert.equal(fresh.headers.get('Set-Cookie'), null)
    assert.equal(count(h, 'customers'), customersBefore, 'no customer row created')
    assert.equal(count(h, 'portal_accounts'), accountsBefore, 'no account created')
  })

  await check('paused: an existing account still signs in, and the public config says sign-up is paused', async () => {
    const h = setup(undefined)
    assert.equal((await signup(h, NEW_PHONE, '203.0.113.2')).status, 200)
    h.raw.prepare("INSERT INTO settings (key, value) VALUES ('customer_portal_signup_enabled', 'false')").run({})
    const signin = await h.request('/auth/signin', 'POST', { identifier: 'Visitor', phone: NEW_PHONE, password: 'visitor-pass', consent: true }, { ip: '203.0.113.3' })
    assert.equal(signin.status, 200, 'existing phone + password accounts keep working')
    const config = await h.request('/config', 'GET', undefined, { ip: '203.0.113.3' })
    assert.equal(config.body.signupEnabled, false)
  })

  console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
