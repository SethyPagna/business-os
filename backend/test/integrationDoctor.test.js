'use strict'

const assert = require('node:assert/strict')

const {
  buildExpectedOauthChecklist,
  redactPresence,
} = require('../src/services/integrationDoctor')

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

runTest('integration doctor redacts configured secrets', () => {
  assert.deepEqual(redactPresence('super-secret'), {
    configured: true,
    redacted: '[redacted]',
  })
  assert.deepEqual(redactPresence(''), {
    configured: false,
    redacted: '',
  })
})

runTest('integration doctor documents separate Google OAuth clients', () => {
  const checklist = buildExpectedOauthChecklist('https://admin.leangcosmetics.dpdns.org/api/system/drive-sync/oauth/callback')
  assert.equal(checklist.googleLoginClient.name, 'business-os')
  assert.equal(checklist.googleDriveClient.name, 'Business-os Drive')
  assert.ok(checklist.googleLoginClient.authorizedRedirectUris.some((uri) => uri.endsWith('/auth/v1/callback') || uri === ''))
  assert.ok(checklist.googleDriveClient.authorizedRedirectUris.includes('http://localhost:4000/api/system/drive-sync/oauth/callback'))
  assert.ok(checklist.googleDriveClient.authorizedRedirectUris.includes('https://admin.leangcosmetics.dpdns.org/api/system/drive-sync/oauth/callback'))
})

if (failed > 0) {
  process.exitCode = 1
}
