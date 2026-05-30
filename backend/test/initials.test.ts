'use strict'

const assert = require('assert')
const { aggregateInitialRows, getInitialKey, getInitialType } = require('../src/initials.ts')

assert.strictEqual(getInitialKey('AHC Mask'), 'A')
assert.strictEqual(getInitialKey('\u1780\u17B6\u1795\u17D2\u179C\u17C1'), '\u1780')
assert.strictEqual(getInitialKey('651986410538'), '6')
assert.strictEqual(getInitialKey('# tester'), '#')
assert.strictEqual(getInitialType('\u1780'), 'khmer')

const initials = aggregateInitialRows([
  { value: 'B', count: 1 },
  { value: '\u1780', count: 2 },
  { value: 'A', count: 3 },
  { value: '6', count: 4 },
  { value: '#', count: 5 },
])

assert.deepStrictEqual(initials.map((entry) => entry.key), ['A', 'B', '6', '\u1780', '#'])
assert.strictEqual(initials.find((entry) => entry.key === '\u1780').count, 2)

console.log('PASS initials classify Latin, Khmer, numbers, and symbols')
