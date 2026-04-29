'use strict'

const assert = require('node:assert/strict')
const {
  hasImportValue,
  normalizeFieldRule,
  normalizeImageConflictMode,
  parseImportFlag,
  parseImportNumber,
  resolveImportValue,
} = require('../src/productImportPolicies')

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('parseImportNumber rejects malformed and negative numbers by default', async () => {
  assert.throws(() => parseImportNumber({ selling_price_usd: 'abc' }, 'selling_price_usd', 0), /Invalid selling_price_usd/)
  assert.throws(() => parseImportNumber({ stock_quantity: '-1' }, 'stock_quantity', 0), /stock_quantity cannot be negative/)
})

runTest('parseImportFlag normalizes truthy and falsy import values', () => {
  assert.equal(parseImportFlag({ is_group: 'yes' }, 'is_group', 0), 1)
  assert.equal(parseImportFlag({ is_group: 'No' }, 'is_group', 1), 0)
  assert.equal(parseImportFlag({ is_group: '' }, 'is_group', 1), 1)
})

runTest('resolveImportValue respects keep, merge blank, and clear policies', () => {
  assert.equal(resolveImportValue('Existing', 'Incoming', true, 'keep_existing'), 'Existing')
  assert.equal(resolveImportValue('', 'Incoming', true, 'merge_blank_only'), 'Incoming')
  assert.equal(resolveImportValue('Existing', 'Incoming', true, 'merge_blank_only'), 'Existing')
  assert.equal(resolveImportValue('Existing', 'Incoming', true, 'clear_value'), null)
  assert.equal(resolveImportValue('Existing', 'Incoming', true, 'use_imported'), 'Incoming')
})

runTest('normalizeImageConflictMode maps aliases and defaults by import action', () => {
  assert.equal(normalizeImageConflictMode('append', 'merge', true), 'append_csv')
  assert.equal(normalizeImageConflictMode('replace', 'merge', true), 'replace_with_csv')
  assert.equal(normalizeImageConflictMode('', 'new', true), 'replace_with_csv')
  assert.equal(normalizeImageConflictMode('', 'merge', false), 'keep_existing')
})

runTest('hasImportValue only treats non-empty values as imported', () => {
  assert.equal(hasImportValue({ brand: '  ' }, 'brand'), false)
  assert.equal(hasImportValue({ brand: 'QA Brand' }, 'brand'), true)
  assert.equal(normalizeFieldRule('weird', 'merge_blank_only'), 'merge_blank_only')
})

if (failed > 0) {
  process.exitCode = 1
}
