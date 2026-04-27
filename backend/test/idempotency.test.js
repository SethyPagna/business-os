'use strict'

const assert = require('node:assert/strict')
const { normalizeClientRequestId } = require('../src/idempotency')

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

runTest('normalizeClientRequestId trims and nulls empty values', () => {
  assert.equal(normalizeClientRequestId('   '), null)
  assert.equal(normalizeClientRequestId('  abc  '), 'abc')
})

runTest('normalizeClientRequestId caps length', () => {
  const value = 'x'.repeat(140)
  assert.equal(normalizeClientRequestId(value).length, 120)
})

if (failed > 0) {
  process.exitCode = 1
}
