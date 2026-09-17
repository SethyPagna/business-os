// P11-12: pins cloudflare/src/lib/receivablesPaidGuard.ts against the exact
// production defect shape -- a multi-line legacy invoice whose "Amount Paid"
// column repeats the FULL invoice total on every line, so the OLD aggregation
// (take row['Amount Paid'] at face value) multiplies the true paid amount by
// the invoice's own line count and manufactures a negative outstanding
// balance for money that was actually paid in full.
//
// Fixture: a 3-line invoice, total 5370 split across the lines as line
// amounts summing to 5370 (matching the "Taxable Amount + VAT" column being
// correctly split per line in production), each line's "Amount Paid" column
// repeating the invoice-level 5370 paid figure -- so naively summing
// row.paid across 2 of its lines (a plausible historical per-invoice
// aggregation) or trusting a single already-summed cell yields 10740 (the
// exact 2x figure measured in production), and status is already 'Paid'.
// A genuine single-line, exactly-settled row and a genuine PARTIAL balance
// row are included as controls that must NOT be touched.
//
// Run: node scripts/test-receivables-paid-guard-pure.cjs

const assert = require('assert')
const { normalizeReceivablePaidAmount, isSettledReceivableStatus } = require('../src/lib/receivablesPaidGuard.ts')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

// ---- P1: the production defect shape (production examples) ----------------
const productionExamples = [
  { total: 5370, multipliedPaid: 10740 },
  { total: 780, multipliedPaid: 4680 }, // 6x
  { total: 624, multipliedPaid: 3744 }, // 6x
]
for (const { total, multipliedPaid } of productionExamples) {
  // OLD aggregation: trust the report's own "Amount Paid" cell as-is.
  const oldAggregation = { paidUsd: multipliedPaid, outstandingUsd: total - multipliedPaid }
  check(`old aggregation manufactures a negative balance for total=${total}`, oldAggregation.outstandingUsd < 0)

  const fixed = normalizeReceivablePaidAmount({ totalUsd: total, paidUsd: multipliedPaid, status: 'Paid' })
  check(`fixed clamps paid to total for total=${total}`, fixed.paidUsd === total)
  check(`fixed leaves outstanding at 0 for total=${total}`, fixed.outstandingUsd === 0)
  check(`fixed flags the row as corrected for total=${total}`, fixed.corrected === true)
}

// ---- P2: the test MUST fail against the old (naive) aggregation ------------
// i.e. the old computation and the fixed computation must actually disagree
// on this fixture -- a discriminating test, not a tautology.
{
  const { total, multipliedPaid } = productionExamples[0]
  const oldOutstanding = total - multipliedPaid
  const fixedOutstanding = normalizeReceivablePaidAmount({ totalUsd: total, paidUsd: multipliedPaid, status: 'Paid' }).outstandingUsd
  check('fixed and old aggregation genuinely disagree on the fixture', oldOutstanding !== fixedOutstanding)
}

// ---- P3: control -- a genuine single-line settled row is untouched --------
{
  const control = normalizeReceivablePaidAmount({ totalUsd: 200, paidUsd: 200, status: 'Paid' })
  check('control: exact single-line paid=total stays uncorrected', control.corrected === false)
  check('control: exact single-line paid=total keeps paid=200', control.paidUsd === 200)
  check('control: exact single-line paid=total keeps outstanding=0', control.outstandingUsd === 0)
}

// ---- P4: control -- a genuine PARTIAL balance is untouched (never clamped) -
{
  const control = normalizeReceivablePaidAmount({ totalUsd: 500, paidUsd: 300, status: 'unpaid' })
  check('control: genuine partial balance stays uncorrected', control.corrected === false)
  check('control: genuine partial balance keeps paid=300', control.paidUsd === 300)
  check('control: genuine partial balance keeps outstanding=200', control.outstandingUsd === 200)
}

// ---- P5: control -- a non-multiple overpay (rounding, not the line bug) ---
{
  // paid is more than total but NOT a clean integer multiple -- must not be
  // silently reinterpreted as the multiplication defect.
  const control = normalizeReceivablePaidAmount({ totalUsd: 100, paidUsd: 137.5, status: 'Paid' })
  check('control: non-multiple overpay stays uncorrected', control.corrected === false)
  check('control: non-multiple overpay keeps paid=137.5', control.paidUsd === 137.5)
  check('control: non-multiple overpay outstanding is -37.5', control.outstandingUsd === -37.5)
}

// ---- P6: isSettledReceivableStatus is case/whitespace tolerant ------------
check('isSettledReceivableStatus accepts " Paid "', isSettledReceivableStatus(' Paid '))
check('isSettledReceivableStatus rejects "Outstanding"', !isSettledReceivableStatus('Outstanding'))
check('isSettledReceivableStatus rejects null', !isSettledReceivableStatus(null))

console.log(`\n${checks} checks passed.`)
