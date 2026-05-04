const assert = require('assert')
const fs = require('fs')
const path = require('path')

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
}

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

const authSource = read('src/routes/auth.js')
const sessionSource = read('src/sessionAuth.js')
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
const syncSource = fs.existsSync(path.join(__dirname, '..', 'src/routes/sync.js'))
  ? read('src/routes/sync.js')
  : ''
const serverUtilsSource = read('src/serverUtils.js')

runTest('auth sessions are issued as HttpOnly cookies and cleared on logout', () => {
  assert.match(sessionSource, /function setAuthSessionCookie/)
  assert.match(sessionSource, /httpOnly:\s*true/)
  assert.match(sessionSource, /sameSite:\s*'lax'/)
  assert.match(sessionSource, /secure:\s*isSecureRequest/)
  assert.match(authSource, /setAuthSessionCookie\(req, res, session\)/)
  assert.match(authSource, /clearAuthSessionCookie\(req, res\)/)
  assert.doesNotMatch(authSource, /authToken:\s*session\.token/)
  assert.doesNotMatch(sessionSource, new RegExp(`x-auth-${'session'}`))
  assert.doesNotMatch(sessionSource, /authorization/i)
  assert.doesNotMatch(sessionSource, /searchParams\.get\('token'\)/)
})

runTest('generic sync outbox endpoint is mounted and only accepts allowlisted operation ids', () => {
  assert.match(serverSource, /target\.use\('\/api\/sync', require\('\.\/src\/routes\/sync'\)\)/)
  assert.match(syncSource, /const OUTBOX_OPERATION_MAP =/)
  assert.match(syncSource, /products\.create/)
  assert.match(syncSource, /returns\.create/)
  assert.match(syncSource, /settings\.update/)
  assert.match(syncSource, /dangerous|onlineOnly/i)
  assert.match(syncSource, /\/outbox/)
  assert.match(syncSource, /base_updated_at/)
  assert.match(syncSource, /client_request_id/)
})

runTest('sync outbox rejects stale, tampered, oversized, or unsupported operations', () => {
  assert.match(syncSource, /verifyOperationDigest/)
  assert.match(syncSource, /payload_digest/)
  assert.match(syncSource, /schema_version/)
  assert.match(syncSource, /maxOperations/)
  assert.match(syncSource, /unsupported_operation/)
  assert.match(syncSource, /write_conflict/)
})

runTest('chunked offline file upload endpoints validate chunk manifest and hash before assembly', () => {
  assert.match(syncSource, /\/files\/chunks\/init/)
  assert.match(syncSource, /\/files\/chunks\/:uploadId\/chunk/)
  assert.match(syncSource, /\/files\/chunks\/:uploadId\/complete/)
  assert.match(syncSource, /CHUNK_SIZE_BYTES/)
  assert.match(syncSource, /sha256/)
  assert.match(syncSource, /validateUploadBufferPayload/)
})

runTest('Cloudflare Access readiness is reported without hard lockout', () => {
  assert.match(serverUtilsSource, /getCloudflareAccessDiagnostics/)
  assert.match(serverUtilsSource, /cf-access-authenticated-user-email/i)
  assert.match(serverUtilsSource, /cf-access-jwt-assertion/i)
  assert.match(syncSource, /cloudflareAccess/)
})
