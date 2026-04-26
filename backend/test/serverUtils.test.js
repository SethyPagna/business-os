'use strict'

const assert = require('node:assert/strict')
const {
  sanitizeObjectKeys,
  isApiOrHealthPath,
  isSpaFallbackEligible,
  mapServerError,
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

runTest('mapServerError maps known errors and defaults to 500', () => {
  assert.equal(mapServerError({ type: 'entity.too.large' }).status, 413)
  assert.equal(mapServerError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' }).status, 413)
  assert.equal(mapServerError({ name: 'MulterError', code: 'ANY' }).status, 400)
  assert.equal(mapServerError({ message: 'Unsupported file type' }).status, 400)
  assert.equal(mapServerError(new Error('boom')).status, 500)
})

if (failed > 0) {
  process.exitCode = 1
}
