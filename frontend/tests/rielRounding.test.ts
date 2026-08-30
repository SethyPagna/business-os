// Locks the 100-riel physical-cash rounding matrix (business rule, Aug 31
// 2026). These figures are cashier-facing only -- the saved sale and printed
// receipt keep the exact calculation -- but the DIRECTIONS are money, so a
// regression here mis-handles real cash.

import assert from 'node:assert/strict'
import {
  RIEL_STEP,
  roundRielDown,
  roundRielUp,
  cashierCollectKhr,
  cashierChangeKhr,
} from '../src/utils/rielRounding.ts'

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

runTest('the riel step is 100', () => {
  assert.equal(RIEL_STEP, 100)
})

runTest('roundRielDown floors to the nearest 100, never below zero', () => {
  assert.equal(roundRielDown(4150), 4100)
  assert.equal(roundRielDown(4100), 4100)
  assert.equal(roundRielDown(99), 0)
  assert.equal(roundRielDown(0), 0)
  assert.equal(roundRielDown(-50), 0)
  assert.equal(roundRielDown(Number.NaN), 0)
})

runTest('roundRielUp ceils to the nearest 100, never below zero', () => {
  assert.equal(roundRielUp(4150), 4200)
  assert.equal(roundRielUp(4100), 4100)
  assert.equal(roundRielUp(1), 100)
  assert.equal(roundRielUp(0), 0)
  assert.equal(roundRielUp(-50), 0)
  assert.equal(roundRielUp(Number.NaN), 0)
})

runTest('cash payment is collected exact, never rounded up', () => {
  assert.equal(cashierCollectKhr(4150, { isCashPayment: true, isWalkIn: false }), 4150)
  assert.equal(cashierCollectKhr(4150, { isCashPayment: true, isWalkIn: true }), 4150)
})

runTest('any walk-in sale is collected exact, even when paid by a non-cash method', () => {
  assert.equal(cashierCollectKhr(4150, { isCashPayment: false, isWalkIn: true }), 4150)
})

runTest('non-cash payment on a delivery order rounds the collected amount UP to 100', () => {
  assert.equal(cashierCollectKhr(4150, { isCashPayment: false, isWalkIn: false }), 4200)
  assert.equal(cashierCollectKhr(4100, { isCashPayment: false, isWalkIn: false }), 4100)
})

runTest('change handed back always rounds DOWN to 100', () => {
  assert.equal(cashierChangeKhr(4150), 4100)
  assert.equal(cashierChangeKhr(4100), 4100)
  assert.equal(cashierChangeKhr(80), 0)
  assert.equal(cashierChangeKhr(0), 0)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll riel-rounding tests passed')
