'use strict'

const assert = require('assert')
const { aggregateInitialRows, getInitialKey, getInitialType } = require('../src/initials')

assert.strictEqual(getInitialKey('AHC Mask'), 'A')
assert.strictEqual(getInitialKey('កាហ្វេ'), 'ក')
assert.strictEqual(getInitialKey('651986410538'), '6')
assert.strictEqual(getInitialKey('# tester'), '#')
assert.strictEqual(getInitialType('ក'), 'khmer')

const initials = aggregateInitialRows([
  { value: 'B', count: 1 },
  { value: 'ក', count: 2 },
  { value: 'A', count: 3 },
  { value: '6', count: 4 },
  { value: '#', count: 5 },
])

assert.deepStrictEqual(initials.map((entry) => entry.key), ['A', 'B', '6', 'ក', '#'])
assert.strictEqual(initials.find((entry) => entry.key === 'ក').count, 2)

console.log('PASS initials classify Latin, Khmer, numbers, and symbols')
