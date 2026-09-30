// AUTH-P1 (C15): shared tills. After a password sign-in the app asks the
// browser to save the password (frontend Login.tsx requestPasswordSave). On a
// till that other staff also sign in to, that would leave one person's
// password in the till's password manager for the next person. The sign-in
// answer therefore says `sharedDevice: true` when ANOTHER account has already
// been seen on this browser's device id (trusted_devices, migration 0005),
// and the app then does not ask.
//
// Administrator accounts skip device approval and get no trusted_devices row,
// so an administrator signing in on a staff till is still recognised as
// shared (a staff row exists for that device), while a device only ever used
// by administrators reads as not shared.
//
// Drives the REAL routes/auth.ts /login and /otp/verify (harness/
// load_auth_route.cjs, every migration applied).
//
// Run: node scripts/test-login-shared-device-pure.cjs

const assert = require('node:assert/strict')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.log(`not ok - ${name}\n${error.stack || error}`) }
}

function seenOnDevice(h, userId, deviceId, status = 'approved') {
  h.raw.prepare('INSERT INTO trusted_devices (user_id, device_id, status) VALUES (?, ?, ?)').run([userId, deviceId, status])
}

function harnessWithStaff() {
  const h = createAuthHarness()
  h.addUser({ id: 11, username: 'dara', password: 'dara-pass-11' })
  h.addUser({ id: 12, username: 'sokha', password: 'sokha-pass-12' })
  h.addUser({ id: 13, username: 'vanna', password: 'vanna-pass-13', otpSecret: SECRET })
  h.addUser({ id: 1, username: 'owner', password: 'owner-pass-1', roleCode: 'admin' })
  return h
}

const signIn = (h, username, password, deviceId, ip = '203.0.113.20') =>
  h.request('/login', 'POST', { username, password, ...(deviceId === undefined ? {} : { deviceId }) }, { ip })

;(async () => {
  await check('two staff accounts on one till: the second sign-in is shared', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'till-1')
    seenOnDevice(h, 12, 'till-1')
    const res = await signIn(h, 'sokha', 'sokha-pass-12', 'till-1')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.success, true)
    assert.equal(res.body.sharedDevice, true)
  })

  await check('a device only this person uses is not shared', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'phone-11')
    const res = await signIn(h, 'dara', 'dara-pass-11', 'phone-11')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.sharedDevice, false)
  })

  await check('another account seen on the device counts whatever its approval state', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'till-2')
    seenOnDevice(h, 12, 'till-2', 'rejected')
    const res = await signIn(h, 'dara', 'dara-pass-11', 'till-2')
    assert.equal(res.body.sharedDevice, true)
  })

  await check('an administrator on a staff till is shared; on a device only administrators use it is not', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'till-3')
    assert.equal((await signIn(h, 'owner', 'owner-pass-1', 'till-3')).body.sharedDevice, true)
    assert.equal((await signIn(h, 'owner', 'owner-pass-1', 'owner-laptop')).body.sharedDevice, false)
  })

  await check('no device id: nothing is known about the device, so it is not reported shared', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'till-4')
    const res = await signIn(h, 'owner', 'owner-pass-1', undefined)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.sharedDevice, false)
  })

  await check('the authenticator step answers the same for the device it is finishing on', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'till-5')
    seenOnDevice(h, 13, 'till-5')
    const first = await signIn(h, 'vanna', 'vanna-pass-13', 'till-5')
    assert.equal(first.body.otpRequired, true, JSON.stringify(first.body))
    assert.equal('sharedDevice' in first.body, false, 'nothing about the device before the second factor')
    const verified = await h.request('/otp/verify', 'POST', { userId: 13, token: await h.codeAt(SECRET), otpChallenge: first.body.otpChallenge, deviceId: 'till-5' }, { ip: '203.0.113.20' })
    assert.equal(verified.status, 200, JSON.stringify(verified.body))
    assert.equal(verified.body.sharedDevice, true)
  })

  await check('the authenticator step answers success like /login: the app completes the sign-in on it', async () => {
    const h = harnessWithStaff()
    const first = await signIn(h, 'vanna', 'vanna-pass-13', 'phone-13')
    const verified = await h.request('/otp/verify', 'POST', { userId: 13, token: await h.codeAt(SECRET), otpChallenge: first.body.otpChallenge, deviceId: 'phone-13' }, { ip: '203.0.113.20' })
    assert.equal(verified.status, 200, JSON.stringify(verified.body))
    assert.equal(verified.body.success, true, 'Login.tsx handleOtp only completes on success && user')
    assert.equal(verified.body.user.username, 'vanna')
  })

  await check('the authenticator step on a personal device is not shared', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 13, 'phone-13')
    const first = await signIn(h, 'vanna', 'vanna-pass-13', 'phone-13')
    const verified = await h.request('/otp/verify', 'POST', { userId: 13, token: await h.codeAt(SECRET), otpChallenge: first.body.otpChallenge, deviceId: 'phone-13' }, { ip: '203.0.113.20' })
    assert.equal(verified.status, 200, JSON.stringify(verified.body))
    assert.equal(verified.body.sharedDevice, false)
  })

  await check('a failed device lookup never fails the sign-in and offers no save', async () => {
    const h = harnessWithStaff()
    h.raw.exec('DROP TABLE trusted_devices')
    const res = await signIn(h, 'owner', 'owner-pass-1', 'owner-laptop')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.success, true)
    assert.equal(res.body.sharedDevice, true)
  })

  await check('a refused sign-in says nothing about the device', async () => {
    const h = harnessWithStaff()
    seenOnDevice(h, 11, 'till-6')
    seenOnDevice(h, 12, 'till-6')
    const res = await signIn(h, 'sokha', 'wrong-password', 'till-6')
    assert.notEqual(res.status, 200)
    assert.equal(res.body && 'sharedDevice' in res.body, false)
  })

  if (failures) { console.log(`${failures} failing`); process.exitCode = 1; return }
  console.log('all ok')
})()
