// One boundary for "may this sale be BORN with a paid status" (Completed /
// Awaiting Delivery), asked by BOTH the POS checkout gate and the Worker's
// POST /sales: tenderAllowsPaidStatus in saleStatusResolution.ts (covered
// within half a cent, exact integer units).
//
// The defect this pins: the POS gate was a float comparison
// (`totalPaid < totalUsd - 0.005`) while the Worker used the EXACT coverage
// formula. 39,400 riel for a $9.61 sale at 4,100 (one riel short) passed the
// POS and was answered 400 by the Worker -- and a sale queued offline on that
// tender replayed into a non-retryable 400 and was lost.
//
// DISCRIMINATING. On the pre-fix tree the POS gate does not call
// tenderAllowsPaidStatus (and still compares the float `totalPaid`), and the
// Worker gate calls paymentCoversSaleTotal: every source assertion below is
// red there. The behavioural half runs the owner's tender through the same
// kernel both gates now import.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { paymentCoversSaleTotal, tenderAllowsPaidStatus } from '../src/utils/saleStatusResolution.ts'

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

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pos = read('../src/components/pos/POS.tsx')
const worker = read('../../cloudflare/src/routes/sales.ts')

/** The POS checkout's paid-status gate: from its `if` to the resolver call right after it. */
function posGate(): string {
  const end = pos.indexOf('const recordedSaleStatus = resolvePosSaleStatus(saleStatus)')
  assert.ok(end > 0, 'the checkout still resolves the recorded status')
  const start = pos.lastIndexOf("if (saleStatus !== 'awaiting_payment')", end)
  assert.ok(start > 0, 'the checkout still gates the paid statuses')
  return pos.slice(start, end)
}

/** The POST /sales paid-status gate: the block that answers the first insufficient_payment_for_status. */
function workerGate(): string {
  const code = worker.indexOf("code: 'insufficient_payment_for_status'")
  assert.ok(code > 0, 'POST /sales still refuses an uncovered paid status')
  const start = worker.lastIndexOf("if (saleStatus === 'completed' || saleStatus === 'awaiting_delivery')", code)
  assert.ok(start > 0, 'the POST /sales gate is still keyed on the two paid statuses')
  return worker.slice(start, code)
}

const ownerTender = { paidUsd: 0, paidKhr: 39400, totalUsd: 9.61, exchangeRate: 4100, moneyPrecisionVersion: 1 }

runTest('the POS gate asks tenderAllowsPaidStatus with the resolver\'s own inputs', () => {
  const gate = posGate()
  assert.match(gate, /tenderAllowsPaidStatus\(\{\s*paidUsd: paidUsdNum,\s*paidKhr: paidKhrNum,\s*totalUsd,\s*exchangeRate,\s*moneyPrecisionVersion: 1,\s*\}\)/,
    'the gate must pass the same tender, total and rate the status resolver sees')
  assert.match(gate, /catch\s*\{\s*allowsPaidStatus = false\s*\}/, 'an unreadable rate must refuse, not throw out of checkout')
  assert.match(gate, /if \(!allowsPaidStatus\) return notify\(t\('insufficient_amount'\), 'error'\)/)
  assert.match(pos, /import \{[^}]*\btenderAllowsPaidStatus\b[^}]*\} from '\.\.\/\.\.\/utils\/saleStatusResolution\.ts'/)
})

runTest('the float half-cent comparison is gone from the POS', () => {
  assert.doesNotMatch(pos, /totalPaid\s*<\s*totalUsd/, 'a float gate can disagree with the Worker on a one-riel tender')
})

runTest('the Worker POST /sales gate asks the same function', () => {
  const gate = workerGate()
  assert.match(gate, /tenderAllowsPaidStatus\(\{/, 'POST /sales must use the shared creation boundary')
  assert.doesNotMatch(gate, /paymentCoversSaleTotal\(/, 'the exact formula refuses tenders the POS accepts')
  assert.match(gate, /catch\s*\{\s*coveredForStatus = false\s*\}/, 'a bad rate still refuses')
})

runTest('the owner\'s tender (39,400 riel for $9.61 at 4,100) passes the shared boundary', () => {
  assert.equal(tenderAllowsPaidStatus(ownerTender), true)
  // ...while exact coverage still calls it short, so the Not-Paid resolver and
  // settlement keep their exact answers.
  assert.equal(paymentCoversSaleTotal(ownerTender), false)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
