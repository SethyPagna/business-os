// The "Exact ៛" button and the "Collect (cash)" hint on a cash row (owner, 27 Oct 2026: cash riel is whole 100៛ notes, and a riel
// payment short by under 100៛ is fully paid). Lane MONEY-1 review fix B1, 4 Nov 2026.
//
// The reviewed build rounded Exact UP to the next note, so every all-riel cash sale over-tendered by 1-99៛ and the shift read
// "change given is ambiguous". Cash now rounds DOWN: the customer never pays above the total, the till's gate still accepts the
// tender (shortfallCovered), and the Collect hint says the same figure.
// DISCRIMINATING: $9.99 at 4,000 is 39,960៛ -- DOWN is 39,900 (60 short, paid), UP is 40,000 (40 over); a bank row keeps 39,960.
import assert from 'node:assert/strict'
import { posExactRielTender } from '../src/components/pos/posRielCash.ts'
import { cashierCollectKhr } from '../src/utils/rielRounding.ts'
import { paymentCoversSaleTotal, rielCashAmountValid } from '../src/utils/saleStatusResolution.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('a cash row takes the riel total DOWN to a whole 100៛ note', () => {
  assert.equal(posExactRielTender(39960, true), 39900)
  assert.equal(posExactRielTender(39960.4, true), 39900)
  assert.equal(posExactRielTender(12040, true), 12000)
  assert.equal(posExactRielTender(40000, true), 40000, 'a whole-note total is tendered as it is')
  assert.equal(posExactRielTender(19000, true), 19000)
})

runTest('a total under one note takes that one note, and nothing takes nothing', () => {
  assert.equal(posExactRielTender(40, true), 100)
  assert.equal(posExactRielTender(99.5, true), 100)
  assert.equal(posExactRielTender(0, true), 0)
  assert.equal(posExactRielTender(Number.NaN, true), 0)
})

runTest('a bank or QR row keeps the whole-riel total, rounded up so it is never short', () => {
  assert.equal(posExactRielTender(39960, false), 39960)
  assert.equal(posExactRielTender(39960.4, false), 39961)
})

runTest('the cash figure is always a valid cash amount and always covers the sale (the till gate and POST /sales agree)', () => {
  for (const [totalUsd, rate] of [[9.99, 4000], [3.01, 4000], [4.75, 4000], [9.61, 4100], [0.5, 4000], [123.45, 4050], [1, 4150]] as const) {
    const totalKhr = totalUsd * rate
    const tender = posExactRielTender(totalKhr, true)
    assert.ok(rielCashAmountValid(tender), `${tender} is whole notes (${totalUsd} at ${rate})`)
    assert.ok(paymentCoversSaleTotal({ totalUsd, paidUsd: 0, paidKhr: tender, exchangeRate: rate, moneyPrecisionVersion: 1 }), `${tender} covers $${totalUsd} at ${rate}`)
    assert.ok(tender <= Math.ceil(totalKhr), 'never above the total')
  }
})

runTest('a total one note past the cash figure is not covered: the rule absorbs under 100៛, not 100៛', () => {
  // $9.99 = 39,960: 39,800 is 160 short.
  assert.equal(paymentCoversSaleTotal({ totalUsd: 9.99, paidUsd: 0, paidKhr: 39800, exchangeRate: 4000, moneyPrecisionVersion: 1 }), false)
  assert.equal(paymentCoversSaleTotal({ totalUsd: 9.99, paidUsd: 0, paidKhr: 39900, exchangeRate: 4000, moneyPrecisionVersion: 1 }), true)
})

runTest('Collect (cash) says the same figure as Exact: DOWN to the note for cash, unchanged elsewhere', () => {
  assert.equal(cashierCollectKhr(39960, { isCashPayment: true, isWalkIn: true }), 39900)
  assert.equal(cashierCollectKhr(39960, { isCashPayment: true, isWalkIn: false }), 39900)
  assert.equal(cashierCollectKhr(39960, { isCashPayment: false, isWalkIn: true }), 39960, 'a non-cash walk-in is exact')
  assert.equal(cashierCollectKhr(39960, { isCashPayment: false, isWalkIn: false }), 40000, 'a non-cash delivery rounds up')
  for (const total of [39960, 12040, 19000, 4150]) assert.equal(cashierCollectKhr(total, { isCashPayment: true, isWalkIn: true }), posExactRielTender(total, true))
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
