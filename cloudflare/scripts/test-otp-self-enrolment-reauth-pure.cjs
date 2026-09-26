// P1-4 (Release 1 auth audit). Self-service POST /auth/otp/setup and
// /auth/otp/confirm needed only a live session: whoever held a stolen or
// unattended session could enrol their own authenticator on the account --
// or replace the owner's -- and so own its second factor. Now a self change
// re-proves the account (current password on both steps; plus a valid,
// unspent code from the ACTIVE authenticator at setup when one exists),
// while admin-for-other-user management keeps its existing rules.
//
// Drives the REAL routes/auth.ts (harness/load_auth_route.cjs), and source
// locks the frontend so OtpModal asks for the password and sends it.
// Fails on a04da325.
//
// Run: node scripts/test-otp-self-enrolment-reauth-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const ACTIVE = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

function seeded() {
  const h = createAuthHarness()
  h.addUser({ id: 801, username: 'staff', password: 'staff-password' })
  h.addUser({ id: 802, username: 'enrolled', password: 'enrolled-password', otpSecret: ACTIVE })
  h.addUser({ id: 803, username: 'boss', password: 'boss-password', permissions: JSON.stringify({ all: true }) })
  return h
}

async function main() {
  await check('self setup with only a session is refused, and nothing is written', async () => {
    const h = seeded()
    const res = await h.request('/otp/setup', 'POST', { userId: 801 }, { actorId: 801 })
    assert.equal(res.status, 400)
    assert.equal(res.body.code, 'current_password_required')
    assert.equal(h.userRow(801).otp_pending_secret, null, 'no pending secret may be minted without re-authentication')
  })

  await check('self setup with a wrong password is refused', async () => {
    const h = seeded()
    const res = await h.request('/otp/setup', 'POST', { userId: 801, password: 'guess' }, { actorId: 801 })
    assert.equal(res.status, 401)
    assert.equal(h.userRow(801).otp_pending_secret, null)
  })

  await check('self setup + confirm with the current password enrols', async () => {
    const h = seeded()
    const setup = await h.request('/otp/setup', 'POST', { userId: 801, password: 'staff-password' }, { actorId: 801 })
    assert.equal(setup.status, 200)
    assert.ok(setup.body.secret)
    const code = await h.codeAt(setup.body.secret)
    const noPassword = await h.request('/otp/confirm', 'POST', { userId: 801, token: code }, { actorId: 801 })
    assert.equal(noPassword.status, 400, 'confirm without the password is refused too')
    assert.equal(h.userRow(801).otp_enabled, 0)
    const confirm = await h.request('/otp/confirm', 'POST', { userId: 801, token: code, password: 'staff-password' }, { actorId: 801 })
    assert.equal(confirm.status, 200)
    assert.equal(h.userRow(801).otp_enabled, 1)
  })

  await check('replacing an active authenticator also needs a valid current code from it', async () => {
    const h = seeded()
    const passwordOnly = await h.request('/otp/setup', 'POST', { userId: 802, password: 'enrolled-password' }, { actorId: 802 })
    assert.equal(passwordOnly.status, 401)
    assert.equal(passwordOnly.body.code, 'current_otp_required')
    const current = await h.codeAt(ACTIVE)
    const withCode = await h.request('/otp/setup', 'POST', { userId: 802, password: 'enrolled-password', currentToken: current }, { actorId: 802 })
    assert.equal(withCode.status, 200)
    // The code is spent -- a watcher cannot reuse it for a second setup.
    const replay = await h.request('/otp/setup', 'POST', { userId: 802, password: 'enrolled-password', currentToken: current }, { actorId: 802 })
    assert.equal(replay.status, 401)
  })

  await check('admin-for-other-user rules are unchanged: no target password, non-admin target only', async () => {
    const h = seeded()
    const setup = await h.request('/otp/setup', 'POST', { userId: 801 }, { actorId: 803 })
    assert.equal(setup.status, 200, 'an administrator still sets up a non-admin without that account\'s password')
    const confirm = await h.request('/otp/confirm', 'POST', { userId: 801, token: await h.codeAt(setup.body.secret) }, { actorId: 803 })
    assert.equal(confirm.status, 200)
    const otherStaff = await h.request('/otp/setup', 'POST', { userId: 803 }, { actorId: 801 })
    assert.equal(otherStaff.status, 403, 'a non-admin still cannot manage someone else')
  })

  await check('source lock: OtpModal asks for the password before setup and sends it on both steps', () => {
    const root = path.join(__dirname, '..', '..', 'frontend', 'src')
    const modal = fs.readFileSync(path.join(root, 'components', 'utils-settings', 'OtpModal.tsx'), 'utf8')
    assert.match(modal, /otpSetup\?\.\(\{ userId, password, currentToken/, 'setup must send the password (and current code)')
    assert.match(modal, /otpConfirm\?\.\(\{ userId, token: code, password \}/, 'confirm must send the password')
    assert.match(modal, /id="otp-setup-password"/, 'the setup flow renders a password field')
    assert.match(modal, /id="otp-setup-current-code"/, 'the setup flow renders the current-code field for an enrolled account')
    const profile = fs.readFileSync(path.join(root, 'components', 'users', 'UserProfileModal.tsx'), 'utf8')
    assert.match(profile, /otpCurrentlyEnabled=\{otpEnabled\}/, 'the profile tells the modal whether an authenticator is active')
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-otp-self-enrolment-reauth-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-otp-self-enrolment-reauth-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
