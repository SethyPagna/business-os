'use strict'

const assert = require('node:assert/strict')
const {
  sanitizeObjectKeys,
  sanitizeStringValue,
  isApiOrHealthPath,
  isSpaFallbackEligible,
  isAllowedRequestOrigin,
  isAllowedWebSocketOrigin,
  mapServerError,
  setTunnelSecurityHeaders,
} = require('../src/serverUtils')

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

runTest('sanitizeObjectKeys removes prototype-pollution keys recursively', () => {
  const child = { ok: 'value' }
  Object.defineProperty(child, '__proto__', {
    value: 'bad',
    enumerable: true,
    configurable: true,
    writable: true,
  })

  const payload = {
    safe: 1,
    nested: {
      constructor: 'bad',
      child,
    },
    array: [{ prototype: 'bad', valid: true }],
  }

  sanitizeObjectKeys(payload)

  assert.equal(payload.safe, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(payload.nested, 'constructor'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload.nested.child, '__proto__'), false)
  assert.equal(payload.nested.child.ok, 'value')
  assert.equal(payload.array[0].prototype, undefined)
  assert.equal(payload.array[0].valid, true)
})

runTest('sanitizeStringValue strips control and bidi characters', () => {
  assert.equal(sanitizeStringValue('safe\u0000text\u202E'), 'safetext')
})

runTest('isApiOrHealthPath detects API and health routes', () => {
  assert.equal(isApiOrHealthPath('/api/products'), true)
  assert.equal(isApiOrHealthPath('/health'), true)
  assert.equal(isApiOrHealthPath('/uploads/image.jpg'), false)
})

runTest('isSpaFallbackEligible only allows browser navigation paths', () => {
  assert.equal(isSpaFallbackEligible('/catalog'), true)
  assert.equal(isSpaFallbackEligible('/api/products'), false)
  assert.equal(isSpaFallbackEligible('/uploads/image.jpg'), false)
  assert.equal(isSpaFallbackEligible('/assets/app.js'), false)
})

runTest('origin policy allows localhost and denies unknown web origins', () => {
  assert.equal(isAllowedRequestOrigin(undefined), true)
  assert.equal(isAllowedRequestOrigin('http://localhost:5173'), true)
  assert.equal(isAllowedRequestOrigin('http://127.0.0.1:3000'), true)
  assert.equal(isAllowedRequestOrigin('https://evil.example.com'), false)
})

runTest('websocket origin policy accepts same-host and rejects mismatched origins', () => {
  assert.equal(isAllowedWebSocketOrigin({
    headers: {
      origin: 'http://localhost:5173',
      host: 'localhost:4000',
    },
  }), true)
  assert.equal(isAllowedWebSocketOrigin({
    headers: {
      origin: 'https://evil.example.com',
      host: 'localhost:4000',
    },
  }), false)
})

runTest('mapServerError maps known errors and defaults to 500', () => {
  assert.equal(mapServerError({ type: 'entity.too.large' }).status, 413)
  assert.equal(mapServerError({ type: 'entity.parse.failed' }).status, 400)
  assert.equal(mapServerError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' }).status, 413)
  assert.equal(mapServerError({ name: 'MulterError', code: 'ANY' }).status, 400)
  assert.equal(mapServerError(new Error('CORS origin denied')).status, 403)
  assert.equal(mapServerError({ message: 'Unsupported file type' }).status, 400)
  assert.equal(mapServerError(new Error('boom')).status, 500)
})

runTest('setTunnelSecurityHeaders emits strict script CSP without unsafe-inline or unsafe-eval', () => {
  const headers = new Map()
  const res = {
    setHeader(name, value) {
      headers.set(String(name), String(value))
    },
  }
  const req = {
    protocol: 'https',
    headers: {
      host: 'localhost:4000',
      'x-forwarded-proto': 'https',
    },
  }

  setTunnelSecurityHeaders(req, res)

  const csp = headers.get('Content-Security-Policy') || ''
  const scriptSrc = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src')) || ''
  assert.match(scriptSrc, /^script-src\b/)
  assert.match(scriptSrc, /'self'/)
  assert.match(scriptSrc, /https:\/\/translate\.google\.com/)
  assert.match(scriptSrc, /https:\/\/translate\.googleapis\.com/)
  assert.doesNotMatch(scriptSrc, /unsafe-inline/)
  assert.doesNotMatch(scriptSrc, /unsafe-eval/)
  assert.match(csp, /manifest-src 'self'/)
  assert.match(csp, /worker-src 'self' blob:/)
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
})

if (failed > 0) {
  process.exitCode = 1
}
