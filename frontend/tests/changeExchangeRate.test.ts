// Locks resolveChangeExchangeRate: change money converts at its own USD->KHR
// rate, and any unset / blank / zero / malformed setting silently falls back
// to the main exchange rate (business rule, Aug 31 2026).

import assert from 'node:assert/strict'
import { resolveChangeExchangeRate } from '../src/components/pos/posCore.ts'

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const MAIN = 4100

runTest('a positive change rate string is used verbatim', () => {
  assert.equal(resolveChangeExchangeRate('4000', MAIN), 4000)
  assert.equal(resolveChangeExchangeRate(' 4050 ', MAIN), 4050)
  assert.equal(resolveChangeExchangeRate(4200, MAIN), 4200)
})

runTest('unset / blank falls back to the main rate', () => {
  assert.equal(resolveChangeExchangeRate(undefined, MAIN), MAIN)
  assert.equal(resolveChangeExchangeRate(null, MAIN), MAIN)
  assert.equal(resolveChangeExchangeRate('', MAIN), MAIN)
  assert.equal(resolveChangeExchangeRate('   ', MAIN), MAIN)
})

runTest('zero / negative / malformed falls back to the main rate', () => {
  assert.equal(resolveChangeExchangeRate('0', MAIN), MAIN)
  assert.equal(resolveChangeExchangeRate('-50', MAIN), MAIN)
  assert.equal(resolveChangeExchangeRate('abc', MAIN), MAIN)
  assert.equal(resolveChangeExchangeRate(Number.NaN, MAIN), MAIN)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll change-exchange-rate tests passed')
