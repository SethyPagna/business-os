// G38 P0 (design S4): storefront sign-in lockout denial of service.
//
// The 10-fail sign-in lockout was keyed on the customer's phone alone, so a
// stranger who knew a phone number could fail it ten times from anywhere and
// lock the real customer out for 30 minutes. It is now keyed on phone +
// network (an IPv6 /64 counts as one network), with a phone-wide failure
// ceiling (PORTAL_SIGNIN_PHONE_WIDE_MAX per 30 minutes) still bounding
// guessing spread across many networks.
//
// Drives the REAL routes/portal.ts sign-up and sign-in against the full
// migrated schema (harness/load_portal_auth_route.cjs). Positive control: ten
// failures DO lock the failing network. Wrong-implementation control: the
// same victim scenario is replayed against a mutant keyed on the phone alone
// and must fail. SECURITY_TEST_BASE=<sha> loads that commit's portal.ts (the
// pre-fix base bb639041d must report FAIL).
//
// Run: node scripts/test-portal-signin-lockout-per-network-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const root = path.resolve(__dirname, '..')
const PORTAL_REL = 'routes/portal.ts'
const currentPortal = fs.readFileSync(path.join(root, 'src', PORTAL_REL), 'utf8')
const portalSource = process.env.SECURITY_TEST_BASE
  ? execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/routes/portal.ts`], { cwd: root, encoding: 'utf8' })
  : currentPortal

const PHONE = '012 345 678'
const PASSWORD = 'right-password'
const ATTACKER = '198.51.100.66'
const VICTIM = '203.0.113.10'

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

async function harnessWithAccount(source = portalSource) {
  const h = createPortalHarness({ sources: { [PORTAL_REL]: source } })
  const signup = await h.request('/auth/signup', 'POST', { name: 'Dara', phone: PHONE, password: PASSWORD, consent: true, consentLocale: 'en' }, { ip: '192.0.2.1' })
  assert.equal(signup.status, 200, `fixture sign-up failed: ${JSON.stringify(signup.body)}`)
  return h
}

const signin = (h, ip, password) => h.request('/auth/signin', 'POST', { identifier: 'Dara', phone: PHONE, password, consent: true }, { ip })

async function strangerCannotLockVictim(h) {
  const answers = []
  for (let i = 0; i < 10; i++) answers.push(await signin(h, ATTACKER, `wrong-${i}`))
  answers.forEach((answer, i) => assert.equal(answer.status, 401, `attacker attempt ${i + 1} is a plain wrong-password answer`))
  const victim = await signin(h, VICTIM, PASSWORD)
  assert.equal(victim.status, 200, `the customer on another network is not locked out by a stranger (got ${victim.status} ${victim.body?.code})`)
}

async function main() {
  await check('ten failures from one network do not lock the customer on another network', async () => {
    await strangerCannotLockVictim(await harnessWithAccount())
  })

  await check('positive control: ten failures DO lock the failing network, even with the right password', async () => {
    const h = await harnessWithAccount()
    for (let i = 0; i < 10; i++) assert.equal((await signin(h, ATTACKER, `wrong-${i}`)).status, 401)
    const locked = await signin(h, ATTACKER, PASSWORD)
    assert.equal(locked.status, 429, 'the failing network is locked')
    assert.equal(locked.body.code, 'locked')
    assert.match(String(locked.headers.get('Retry-After')), /^\d+$/)
  })

  await check('an IPv6 /64 is one network: rotating addresses inside it share the lock', async () => {
    const h = await harnessWithAccount()
    for (let i = 0; i < 10; i++) assert.equal((await signin(h, `2001:db8:77:1::${(i + 1).toString(16)}`, `wrong-${i}`)).status, 401)
    assert.equal((await signin(h, '2001:db8:77:1:ffff::42', PASSWORD)).status, 429, 'a fresh address in the same /64 is still locked')
    assert.equal((await signin(h, '2001:db8:77:2::1', PASSWORD)).status, 200, 'the next /64 is a different network')
  })

  await check('the phone-wide ceiling still bounds guessing spread across many networks', async () => {
    const h = await harnessWithAccount()
    const max = h.portal.PORTAL_SIGNIN_PHONE_WIDE_MAX
    assert.ok(Number.isInteger(max) && max > 10, 'PORTAL_SIGNIN_PHONE_WIDE_MAX is exported and above the per-network cap')
    let sent = 0
    for (let net = 1; sent < max; net++) {
      for (let i = 0; i < 10 && sent < max; i++, sent++) assert.equal((await signin(h, `10.9.${net}.1`, `wrong-${sent}`)).status, 401)
    }
    const fresh = await signin(h, '10.200.0.1', PASSWORD)
    assert.equal(fresh.status, 429, 'once the phone-wide ceiling is full, every network waits')
    assert.equal(fresh.body.code, 'locked', 'the same answer as a network lock: which key tripped is not revealed')
  })

  await check('a success never spends the phone-wide ceiling', async () => {
    const h = await harnessWithAccount()
    const max = h.portal.PORTAL_SIGNIN_PHONE_WIDE_MAX
    assert.ok(Number.isInteger(max), 'PORTAL_SIGNIN_PHONE_WIDE_MAX is exported')
    for (let i = 0; i < max + 5; i++) assert.equal((await signin(h, `10.8.${i}.1`, PASSWORD)).status, 200, `success ${i + 1}`)
  })

  await check('control: a lockout keyed on the phone alone fails the stranger scenario', async () => {
    const needle = '`${canonicalPhone}\\u0000${network}`'
    assert.ok(currentPortal.includes(needle), 'mutant injection point not found')
    const mutant = currentPortal.replace(needle, 'canonicalPhone')
    await assert.rejects(strangerCannotLockVictim(await harnessWithAccount(mutant)), /not locked out by a stranger/)
  })

  console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
