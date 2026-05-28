'use strict'

const assert = require('node:assert/strict')
const {
  canManageOtpTarget,
  requiresSelfOtpDisablePassword,
} = require('../src/authOtpGuards')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const adminActor = {
  id: 1,
  username: 'admin',
  role_code: 'admin',
  permissions: '{}',
}

const normalUser = {
  id: 2,
  username: 'seller',
  role_code: 'staff',
  permissions: '{}',
}

const peerAdmin = {
  id: 3,
  username: 'boss',
  role_code: 'admin',
  permissions: '{}',
}

runTest('user can manage own OTP settings', () => {
  assert.equal(canManageOtpTarget(normalUser, { ...normalUser }), true)
})

runTest('non-admin cannot manage another user OTP settings', () => {
  assert.equal(canManageOtpTarget(normalUser, peerAdmin), false)
})

runTest('admin can manage non-admin OTP settings', () => {
  assert.equal(canManageOtpTarget(adminActor, normalUser), true)
})

runTest('admin cannot manage another admin OTP settings', () => {
  assert.equal(canManageOtpTarget(adminActor, peerAdmin), false)
})

runTest('self OTP disable requires a password', () => {
  assert.equal(requiresSelfOtpDisablePassword(normalUser, normalUser, ''), true)
  assert.equal(requiresSelfOtpDisablePassword(normalUser, normalUser, 'secret'), false)
})

runTest('admin disabling another user OTP does not require target password', () => {
  assert.equal(requiresSelfOtpDisablePassword(adminActor, normalUser, ''), false)
})

if (failed > 0) {
  process.exitCode = 1
}
