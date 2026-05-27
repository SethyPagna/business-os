import assert from 'node:assert/strict'
import {
  aggregateInitialOptions,
  buildInitialOptionsFromProducts,
  compareInitialKeys,
  getInitialKey,
  getInitialType,
} from '../src/utils/initials.ts'

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

await runTest('getInitialKey classifies Latin, Khmer, numbers, and symbols', () => {
  assert.equal(getInitialKey('AHC Mask'), 'A')
  assert.equal(getInitialKey('\u1780\u17B6\u17A0\u17D2\u179C\u17C1'), '\u1780')
  assert.equal(getInitialKey('651986410538'), '6')
  assert.equal(getInitialKey('# tester'), '#')
  assert.equal(getInitialType('\u1780'), 'khmer')
})

await runTest('aggregateInitialOptions merges counts and sorts by initial class', () => {
  const initials = aggregateInitialOptions([
    { value: 'B', count: 1 },
    { value: '\u1780', count: 2 },
    { value: 'A', count: 3 },
    { value: '6', count: 4 },
    { value: '#', count: 5 },
    { value: '\u1780\u1798\u17D2\u179A\u1784', count: 1 },
  ])

  assert.deepEqual(initials.map((entry) => entry.key), ['A', 'B', '6', '\u1780', '#'])
  assert.equal(initials.find((entry) => entry.key === '\u1780')?.count, 3)
})

await runTest('buildInitialOptionsFromProducts derives one count per product name', () => {
  const initials = buildInitialOptionsFromProducts([
    { name: 'Serum' },
    { name: 'Sunscreen' },
    { label: '\u1780\u17D2\u179A\u17C1\u1798' },
    { name: '' },
  ])

  assert.equal(initials.find((entry) => entry.key === 'S')?.count, 2)
  assert.equal(initials.find((entry) => entry.key === '\u1780')?.count, 1)
  assert.equal(initials.find((entry) => entry.key === '#')?.count, 1)
})

await runTest('compareInitialKeys keeps stable Latin, number, Khmer, symbol order', () => {
  const values = ['#', '\u1781', '2', 'B', '\u1780', 'A']
  assert.deepEqual(values.sort(compareInitialKeys), ['A', 'B', '2', '\u1780', '\u1781', '#'])
})

if (failed > 0) {
  process.exitCode = 1
}
