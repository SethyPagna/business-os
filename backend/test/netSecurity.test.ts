'use strict'

const assert = require('node:assert/strict')
const {
  assertSafeOutboundUrl,
  isBlockedHostname,
  isSafeExternalImageReference,
} = require('../src/netSecurity')

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

runTest('assertSafeOutboundUrl allows trusted public https URLs', () => {
  assert.equal(assertSafeOutboundUrl('https://api.groq.com/openai/v1/chat/completions'), 'https://api.groq.com/openai/v1/chat/completions')
})

runTest('assertSafeOutboundUrl rejects localhost and private addresses', () => {
  assert.throws(() => assertSafeOutboundUrl('http://127.0.0.1:4000/test'))
  assert.throws(() => assertSafeOutboundUrl('https://192.168.1.10/file'))
  assert.equal(isBlockedHostname('localhost'), true)
  assert.equal(isBlockedHostname('10.0.0.8'), true)
})

runTest('isSafeExternalImageReference only allows uploads, data images, or public https image URLs', () => {
  assert.equal(isSafeExternalImageReference('/uploads/image.jpg'), true)
  assert.equal(isSafeExternalImageReference('data:image/png;base64,AAAA'), true)
  assert.equal(isSafeExternalImageReference('https://example.com/image.png'), true)
  assert.equal(isSafeExternalImageReference('https://example.com/file.svg'), false)
  assert.equal(isSafeExternalImageReference('http://example.com/image.jpg'), false)
})

if (failed > 0) {
  process.exitCode = 1
}
