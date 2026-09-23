// "Paid means it is not Not-Paid" is ONE rule that has to be enforced in two
// packages, because neither imports the other: the POS resolves the status
// before it submits (src/utils/saleStatusResolution.ts) and the Worker
// resolves it again on POST /sales (cloudflare/src/lib/saleStatusResolution.ts).
// Two copies of a money rule is exactly how a picker that promises
// "Completed" ends up in front of a server that writes "Not Paid".
//
// This test runs BOTH copies over the same fixture table and fails if they
// ever answer differently, and it additionally pins the answers themselves so
// a change that breaks both copies identically is still caught.
//
// DISCRIMINATING. The fixtures are chosen so the OLD behaviour (no resolver
// at all -- whatever status the caller asked for was recorded verbatim) and
// the NEW behaviour disagree on real rows:
//   * fully paid + awaiting_payment  -> old: 'awaiting_payment'  new: 'completed'
//   * fully paid + awaiting_payment + delivery
//                                    -> old: 'awaiting_payment'  new: 'awaiting_delivery'
// and so the boundary cannot be moved without a red. Paid means covered to
// within half a cent (PAID_STATUS_SHORTFALL_TOLERANCE_UNITS), everywhere:
//   * short by exactly half a cent, or by one riel -> resolves (it prints as
//     $0.00 and riel has no coin to close it)
//   * short by $0.0051, one unit past the band -> stays 'awaiting_payment'
//     (a debt is a debt)
// A float implementation drifts across that edge, which is the whole reason
// the kernel compares exact integers.
//
// ONE DEFINITION OF PAID. The band used to apply to sale creation alone, so
// the owner's 39,400-riel tender for a $9.61 sale at 4,100 was recorded
// Completed and then called short by everything else. The rows marked
// `exact: false` below are the ones the old exact formula refused: each is
// red on that tree (resolver, statusChangeNeedsPayment, coverage and the
// outstanding amount all answered "short").
//
// The same two files carry the forward half on EXISTING sales,
// statusChangeNeedsPayment: the Worker asks it before moving a Not Paid sale
// to a paid status (PATCH /:id/status, the group status action). Its fixture
// table below runs through both copies the same way, and every "needs the
// payment" row is one the pre-guard routes allowed.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'

import * as uiCopy from '../src/utils/saleStatusResolution.ts'

let failed = 0
function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`PASS ${name}`) })
    .catch((error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) })
}

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'saleStatusResolution.ts')
const uiPath = path.join(here, '..', 'src', 'utils', 'saleStatusResolution.ts')

const read = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

// Load the WORKER copy for real. Its relative import is extensionless (the
// Worker build resolves that; Node does not), so the specifier is rewritten
// to an absolute file URL and the result is written to a temp file outside
// the repo -- never into the source tree, which would leave a stray.
async function loadWorkerCopy(): Promise<typeof uiCopy> {
  const workerFinancialPrecision = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'financialPrecision.ts')
  const patched = read(workerPath).replace(
    /from '\.\/financialPrecision'/,
    `from ${JSON.stringify(pathToFileURL(workerFinancialPrecision).href)}`,
  )
  assert.ok(patched.includes('file:///'), 'the worker copy should import financialPrecision relatively')
  const temp = path.join(os.tmpdir(), `saleStatusResolution.worker.${process.pid}.${Date.now()}.ts`)
  writeFileSync(temp, patched)
  try {
    return await import(pathToFileURL(temp).href) as typeof uiCopy
  } finally {
    rmSync(temp, { force: true })
  }
}

type Fixture = {
  name: string
  requestedStatus: string
  paidUsd: number
  paidKhr: number
  totalUsd: number
  exchangeRate: number
  moneyPrecisionVersion: 0 | 1
  isDelivery: boolean
  expected: string
  /** What the pre-S4-41 code recorded: the requested status, verbatim. */
  expectedBeforeFix?: string
}

const FIXTURES: Fixture[] = [
  {
    name: 'fully paid in USD, cashier picked Not Paid -> Completed',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'fully paid DELIVERY, cashier picked Not Paid -> Awaiting Delivery (queue survives)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: true,
    expected: 'awaiting_delivery', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'overpaid stays resolved (change is given, the sale is still paid)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 20, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'covered exactly by KHR against a USD total',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 41000, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  // Inside the half-cent band: a full payment. Each of these stayed Not Paid
  // under the old exact resolver while the same tender could be recorded
  // Completed at creation -- two definitions of paid.
  {
    name: 'the owner case: 39,400 riel for $9.61 at 4,100 requested Not Paid -> Completed',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 39400, totalUsd: 9.61, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'the owner case on a DELIVERY requested Not Paid -> Awaiting Delivery',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 39400, totalUsd: 9.61, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: true,
    expected: 'awaiting_delivery', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'short by ONE RIEL is paid in full (inside the band) -> Completed',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 40999, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'short by exactly half a cent (50 units) -> Completed',
    requestedStatus: 'awaiting_payment',
    paidUsd: 9.995, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'SHORT BY $0.0051 (51 units, one past the band) stays Not Paid -- a debt is a debt',
    requestedStatus: 'awaiting_payment',
    paidUsd: 9.9949, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'mixed tender covering exactly',
    requestedStatus: 'awaiting_payment',
    paidUsd: 5, paidKhr: 20500, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'mixed tender one riel short is paid in full (inside the band)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 5, paidKhr: 20499, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'mixed tender $0.0051 short stays Not Paid',
    requestedStatus: 'awaiting_payment',
    paidUsd: 4.9949, paidKhr: 20500, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'nothing paid stays Not Paid (the credit sale the shop actually wants)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'partial payment stays Not Paid',
    requestedStatus: 'awaiting_payment',
    paidUsd: 4, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'a $0 sale is covered trivially',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 0, totalUsd: 0, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'legacy (v0) money resolves on the quantized rate',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 0, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  // Every other status is returned untouched. The resolver must never grow an
  // opinion about these -- a cancelled sale that quietly became 'completed'
  // because it happened to be paid would resurrect a cancelled sale.
  {
    name: 'completed is never rewritten',
    requestedStatus: 'completed',
    paidUsd: 0, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed',
  },
  {
    name: 'awaiting_delivery is never rewritten',
    requestedStatus: 'awaiting_delivery',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: true,
    expected: 'awaiting_delivery',
  },
  {
    name: 'cancelled is never rewritten even when fully paid',
    requestedStatus: 'cancelled',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'cancelled',
  },
  {
    name: 'returned is never rewritten even when fully paid',
    requestedStatus: 'returned',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'returned',
  },
  {
    name: 'partial_return is never rewritten even when fully paid',
    requestedStatus: 'partial_return',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'partial_return',
  },
  // Unreadable money must not assert a payment nobody made.
  {
    name: 'a broken exchange rate leaves the status alone',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 0,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'a NaN paid amount leaves the status alone',
    requestedStatus: 'awaiting_payment',
    paidUsd: Number.NaN, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  // The legacy path used to quantize a zero rate to a zero numerator, and
  // with it every tender "covered" every total: this row resolved to
  // 'completed' with nothing paid. V1 already refused a zero rate.
  {
    name: 'a zero LEGACY exchange rate leaves the status alone too',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 0, totalUsd: 10, exchangeRate: 0,
    moneyPrecisionVersion: 0, isDelivery: false,
    expected: 'awaiting_payment',
  },
]

type StatusChangeFixture = {
  name: string
  from: unknown
  to: unknown
  sale: Record<string, unknown>
  expected: boolean
  /** The pre-guard routes allowed every move: "needs payment" was always false. */
  expectedBeforeFix?: false
  /** Inside the half-cent band: the old exact rule answered true (needs payment). */
  band?: true
}

const v1Row = (money: Record<string, unknown>): Record<string, unknown> => ({
  total_usd: 10, amount_paid_usd: 0, amount_paid_khr: 0, exchange_rate: 4100,
  money_precision_version: 1, calculated_total_usd: 10, ...money,
})
const legacyRow = (money: Record<string, unknown>): Record<string, unknown> => ({
  total_usd: 10, amount_paid_usd: 0, amount_paid_khr: 0, exchange_rate: 4100,
  money_precision_version: 0, calculated_total_usd: null, ...money,
})

const STATUS_CHANGE_FIXTURES: StatusChangeFixture[] = [
  {
    name: 'Not Paid -> Completed with nothing paid needs the payment',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({}),
    expected: true, expectedBeforeFix: false,
  },
  {
    name: 'Not Paid -> Awaiting Delivery with nothing paid needs the payment',
    from: 'awaiting_payment', to: 'awaiting_delivery', sale: v1Row({}),
    expected: true, expectedBeforeFix: false,
  },
  {
    name: 'partly paid still needs the payment',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ amount_paid_usd: 4 }),
    expected: true, expectedBeforeFix: false,
  },
  {
    name: '$0.0051 short (one unit past the band) still needs the payment',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ amount_paid_usd: 9.9949 }),
    expected: true, expectedBeforeFix: false,
  },
  // Inside the band the sale is paid: the old exact rule refused each of
  // these, so a Not Paid sale holding a full riel payment could never move.
  {
    name: 'one riel short does not (inside the half-cent band)',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ amount_paid_khr: 40999 }),
    expected: false, band: true,
  },
  {
    name: 'the owner case (39,400 riel for $9.61 at 4,100) does not',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ total_usd: 9.61, calculated_total_usd: 9.61, amount_paid_khr: 39400 }),
    expected: false, band: true,
  },
  {
    name: 'exactly half a cent short does not, to Awaiting Delivery either',
    from: 'awaiting_payment', to: 'awaiting_delivery', sale: v1Row({ amount_paid_usd: 9.995 }),
    expected: false, band: true,
  },
  {
    name: 'covered exactly in riel does not',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ amount_paid_khr: 41000 }),
    expected: false,
  },
  {
    name: 'a mixed tender covering exactly does not',
    from: 'awaiting_payment', to: 'awaiting_delivery', sale: v1Row({ amount_paid_usd: 5, amount_paid_khr: 20500 }),
    expected: false,
  },
  {
    name: 'a reopened sale that kept its tender does not (the reopen\'s Undo)',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ amount_paid_usd: 10 }),
    expected: false,
  },
  {
    name: 'a legacy row paid in dollars does not',
    from: 'awaiting_payment', to: 'completed', sale: legacyRow({ amount_paid_usd: 10 }),
    expected: false,
  },
  {
    name: 'a legacy row with a zero rate is unreadable, so it needs the payment',
    from: 'awaiting_payment', to: 'completed', sale: legacyRow({ amount_paid_khr: 41000, exchange_rate: 0 }),
    expected: true, expectedBeforeFix: false,
  },
  // Which money basis a row is read on: 204,999,980 riel against $50,000 at
  // 4100.00004 is $0.0054 short on the EXACT (V1) rate -- past the half-cent
  // band -- and $0.0049 short, inside it, on the rate quantized to four places
  // (legacy). calculated_total_usd alone marks recorded V1 money.
  {
    name: 'calculated_total_usd alone selects the exact V1 rate',
    from: 'awaiting_payment', to: 'completed',
    sale: legacyRow({ total_usd: 50000, calculated_total_usd: 50000, amount_paid_khr: 204999980, exchange_rate: 4100.00004 }),
    expected: true, expectedBeforeFix: false,
  },
  {
    name: 'without a V1 marker the legacy quantized rate is used',
    from: 'awaiting_payment', to: 'completed',
    sale: legacyRow({ total_usd: 50000, amount_paid_khr: 204999980, exchange_rate: 4100.00004 }),
    expected: false,
  },
  {
    name: 'absent payment columns count as nothing paid',
    from: 'awaiting_payment', to: 'completed', sale: { total_usd: 10, exchange_rate: 4100 },
    expected: true, expectedBeforeFix: false,
  },
  {
    name: 'an unreadable total needs the payment',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ total_usd: null, amount_paid_usd: 10 }),
    expected: true, expectedBeforeFix: false,
  },
  {
    name: 'a $0 sale needs nothing',
    from: 'awaiting_payment', to: 'completed', sale: v1Row({ total_usd: 0, calculated_total_usd: 0 }),
    expected: false,
  },
  {
    name: 'status words are matched case- and space-insensitively',
    from: ' Awaiting_Payment ', to: 'COMPLETED', sale: v1Row({}),
    expected: true, expectedBeforeFix: false,
  },
  // Not this rule's business: nothing here asserts a payment the sale lacks.
  {
    name: 'Completed -> Not Paid (the payment-correction reopen) is not refused',
    from: 'completed', to: 'awaiting_payment', sale: v1Row({}),
    expected: false,
  },
  {
    name: 'Awaiting Delivery -> Completed (paid to paid) is not refused',
    from: 'awaiting_delivery', to: 'completed', sale: v1Row({}),
    expected: false,
  },
  {
    name: 'Not Paid -> Cancelled is not refused',
    from: 'awaiting_payment', to: 'cancelled', sale: v1Row({}),
    expected: false,
  },
  {
    name: 'a NULL status is a legacy Completed, not Not Paid',
    from: null, to: 'completed', sale: v1Row({}),
    expected: false,
  },
  {
    name: 'Not Paid -> a NULL status (the legacy Completed an undo restores) needs the payment',
    from: 'awaiting_payment', to: null, sale: v1Row({}),
    expected: true, expectedBeforeFix: false,
  },
]

// ONE DEFINITION OF PAID. paymentCoversSaleTotal answers "does this tender
// pay for the sale" -- covered within half a cent, exact integer units -- for
// every caller: the POS gate and picker, POST /sales, the resolver,
// statusChangeNeedsPayment and settlement. saleOutstandingUsd is the same
// comparison read as an amount, for every balance-due figure: 0 when covered,
// otherwise the exact shortfall (always more than half a cent, so it never
// prints $0.00). `exact` is what the OLD exact formula said -- the rows where
// it differs from `covered` are the band, and each is red on that tree.
type BandFixture = {
  name: string
  paidUsd: number
  paidKhr: number
  totalUsd: number
  exchangeRate: number
  covered: boolean | 'throws'
  exact?: boolean
  outstandingUsd?: number
}

const BAND_FIXTURES: BandFixture[] = [
  { name: 'exactly half a cent (50 units) short is covered', paidUsd: 9.995, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, covered: true, exact: false, outstandingUsd: 0 },
  { name: 'one riel short at 4,100 is covered', paidUsd: 0, paidKhr: 40999, totalUsd: 10, exchangeRate: 4100, covered: true, exact: false, outstandingUsd: 0 },
  { name: 'the owner case: 39,400 riel for $9.61 at 4,100 is covered', paidUsd: 0, paidKhr: 39400, totalUsd: 9.61, exchangeRate: 4100, covered: true, exact: false, outstandingUsd: 0 },
  { name: 'a mixed tender one riel short is covered', paidUsd: 5, paidKhr: 20499, totalUsd: 10, exchangeRate: 4100, covered: true, exact: false, outstandingUsd: 0 },
  { name: '$0.00525 short (37,979 riel for $9.50 at 4,000) is not covered', paidUsd: 0, paidKhr: 37979, totalUsd: 9.5, exchangeRate: 4000, covered: false, exact: false, outstandingUsd: 0.0053 },
  { name: 'one unit past the band ($0.0051 short) is not covered', paidUsd: 9.9949, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, covered: false, exact: false, outstandingUsd: 0.0051 },
  { name: 'a partial riel tender owes the rest', paidUsd: 3, paidKhr: 12600, totalUsd: 10, exchangeRate: 4200, covered: false, exact: false, outstandingUsd: 4 },
  { name: 'zero tender owes the whole total', paidUsd: 0, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, covered: false, exact: false, outstandingUsd: 10 },
  { name: 'an exactly covering tender owes nothing', paidUsd: 0, paidKhr: 41000, totalUsd: 10, exchangeRate: 4100, covered: true, exact: true, outstandingUsd: 0 },
  { name: 'an overpaid tender owes nothing (change is not a negative balance)', paidUsd: 20, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, covered: true, exact: true, outstandingUsd: 0 },
  { name: 'a $0 sale with no tender owes nothing', paidUsd: 0, paidKhr: 0, totalUsd: 0, exchangeRate: 4100, covered: true, exact: true, outstandingUsd: 0 },
  { name: 'a zero rate throws (callers refuse)', paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 0, covered: 'throws' },
  { name: 'a negative rate throws (callers refuse)', paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: -4100, covered: 'throws' },
  { name: 'a NaN tender throws (callers refuse)', paidUsd: Number.NaN, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, covered: 'throws' },
]

await runTest('both copies apply the one half-cent band to coverage and to the amount owed', async () => {
  const worker = await loadWorkerCopy()
  assert.equal(uiCopy.PAID_STATUS_SHORTFALL_TOLERANCE_UNITS, 50n, 'half a cent at four calculation decimals')
  assert.equal(worker.PAID_STATUS_SHORTFALL_TOLERANCE_UNITS, uiCopy.PAID_STATUS_SHORTFALL_TOLERANCE_UNITS)
  for (const fixture of BAND_FIXTURES) {
    const input = {
      paidUsd: fixture.paidUsd, paidKhr: fixture.paidKhr, totalUsd: fixture.totalUsd,
      exchangeRate: fixture.exchangeRate, moneyPrecisionVersion: 1,
    }
    for (const copy of [uiCopy, worker]) {
      if (fixture.covered === 'throws') {
        assert.throws(() => copy.paymentCoversSaleTotal(input), `"${fixture.name}" must throw`)
        assert.throws(() => copy.saleOutstandingUsd(input), `"${fixture.name}" must throw for the amount too`)
        continue
      }
      assert.equal(copy.paymentCoversSaleTotal(input), fixture.covered, `wrong coverage for "${fixture.name}"`)
      assert.equal(copy.saleOutstandingUsd(input), fixture.outstandingUsd, `wrong amount owed for "${fixture.name}"`)
      assert.equal(copy.saleOutstandingUsd(input) === 0, fixture.covered, `"${fixture.name}": owing nothing IS being covered`)
    }
  }
})

await runTest('the band fixtures discriminate: one definition, not exact coverage, and not a float', () => {
  // Rows the old exact formula refused but the one definition covers: on the
  // pre-fix tree paymentCoversSaleTotal, the resolver, statusChangeNeedsPayment
  // and settlement all called these short, while creation called them paid.
  const bandOnly = BAND_FIXTURES.filter((fixture) => fixture.covered === true && fixture.exact === false)
  assert.ok(bandOnly.length >= 3, 'expected several rows inside the band but not exactly covered')
  // Rows a band that was too wide would let through.
  const refusedShort = BAND_FIXTURES.filter((fixture) => fixture.covered === false && fixture.totalUsd > 0)
  assert.ok(refusedShort.length >= 3, 'expected rows just past the band that must stay refused')
  // The creation-only copy is gone: there is one coverage function to ask.
  assert.equal('tenderAllowsPaidStatus' in uiCopy, false, 'a second coverage function is a second definition of paid')
})

// THE STORED ROW. recordedSaleOutstandingUsd is what the receipt and the sale
// detail print as "balance due": the same reading of the row that
// statusChangeNeedsPayment makes, so a sale that may move to Completed never
// shows money still owed, and one that may not always does.
const RECORDED_OUTSTANDING_FIXTURES: Array<{ name: string; sale: Record<string, unknown>; expected: number | 'throws' }> = [
  { name: 'the owner case owes nothing (it printed "$0.00 / 1 riel" before)', sale: v1Row({ total_usd: 9.61, calculated_total_usd: 9.61, amount_paid_khr: 39400 }), expected: 0 },
  { name: 'exactly half a cent short owes nothing', sale: v1Row({ amount_paid_usd: 9.995 }), expected: 0 },
  { name: '$0.0051 short owes $0.0051', sale: v1Row({ amount_paid_usd: 9.9949 }), expected: 0.0051 },
  { name: 'exact payment owes nothing', sale: v1Row({ amount_paid_khr: 41000 }), expected: 0 },
  { name: 'a credit sale owes its total', sale: v1Row({}), expected: 10 },
  { name: 'legacy rows read on the quantized rate', sale: legacyRow({ total_usd: 50000, amount_paid_khr: 204999980, exchange_rate: 4100.00004 }), expected: 0 },
  { name: 'V1 rows read on the exact rate', sale: legacyRow({ total_usd: 50000, calculated_total_usd: 50000, amount_paid_khr: 204999980, exchange_rate: 4100.00004 }), expected: 0.0054 },
  { name: 'an unreadable total throws', sale: v1Row({ total_usd: null }), expected: 'throws' },
]

await runTest('both copies read a stored sale\'s balance due identically, and in step with the paid statuses', async () => {
  const worker = await loadWorkerCopy()
  for (const fixture of RECORDED_OUTSTANDING_FIXTURES) {
    for (const copy of [uiCopy, worker]) {
      if (fixture.expected === 'throws') {
        assert.throws(() => copy.recordedSaleOutstandingUsd(fixture.sale), `"${fixture.name}" must throw`)
        continue
      }
      assert.equal(copy.recordedSaleOutstandingUsd(fixture.sale), fixture.expected, `wrong balance due for "${fixture.name}"`)
      assert.equal(copy.statusChangeNeedsPayment('awaiting_payment', 'completed', fixture.sale), fixture.expected > 0,
        `"${fixture.name}": a sale owes money exactly when it cannot move to Completed`)
    }
  }
})

await runTest('the UI and Worker copies differ only in the import specifier', () => {
  const workerBody = read(workerPath).replace(/from '\.\/financialPrecision'/, "from './financialPrecision.ts'")
  const uiBody = read(uiPath)
  // The two files carry their own "this file is the mirror of ..." note, which
  // names the other package, so compare with those sentences normalised away
  // rather than demanding identical prose.
  const normalise = (source: string): string => source
    .replace(/\/\/ This file is the mirror of [^\n]*\n(?:\/\/[^\n]*\n)*/, '')
  assert.equal(normalise(workerBody), normalise(uiBody),
    'the resolver bodies have drifted -- a money rule must not have two implementations')
})

await runTest('both copies resolve every fixture identically, and correctly', async () => {
  const worker = await loadWorkerCopy()
  for (const fixture of FIXTURES) {
    const input = {
      requestedStatus: fixture.requestedStatus,
      paidUsd: fixture.paidUsd,
      paidKhr: fixture.paidKhr,
      totalUsd: fixture.totalUsd,
      exchangeRate: fixture.exchangeRate,
      moneyPrecisionVersion: fixture.moneyPrecisionVersion,
      isDelivery: fixture.isDelivery,
    }
    const ui = uiCopy.resolvePaidSaleStatus(input)
    const wk = worker.resolvePaidSaleStatus(input)
    assert.equal(ui, wk, `UI and Worker disagree on "${fixture.name}"`)
    assert.equal(ui, fixture.expected, `wrong resolution for "${fixture.name}"`)
  }
})

await runTest('the fixtures actually discriminate against the pre-fix behaviour', async () => {
  const worker = await loadWorkerCopy()
  // The pre-S4-41 code had no resolver: the requested status was recorded
  // verbatim. If no fixture disagreed with that, this whole file would pass
  // against the broken tree and prove nothing.
  const discriminating = FIXTURES.filter((fixture) => fixture.expectedBeforeFix !== undefined)
  assert.ok(discriminating.length >= 4, 'expected several fixtures that the old code got wrong')
  for (const fixture of discriminating) {
    assert.equal(fixture.expectedBeforeFix, fixture.requestedStatus,
      'the old behaviour is "record what was asked for"')
    assert.notEqual(fixture.expected, fixture.expectedBeforeFix,
      `"${fixture.name}" does not separate the old code from the new`)
    const resolved = worker.resolvePaidSaleStatus({
      requestedStatus: fixture.requestedStatus,
      paidUsd: fixture.paidUsd,
      paidKhr: fixture.paidKhr,
      totalUsd: fixture.totalUsd,
      exchangeRate: fixture.exchangeRate,
      moneyPrecisionVersion: fixture.moneyPrecisionVersion,
      isDelivery: fixture.isDelivery,
    })
    assert.notEqual(resolved, fixture.expectedBeforeFix,
      `"${fixture.name}" still records the old status`)
  }
})

await runTest('coverage is exact integer arithmetic, not floating point', async () => {
  const worker = await loadWorkerCopy()
  // 0.1 + 0.2 in USD against a 0.3 total: a float implementation computes
  // 0.30000000000000004 >= 0.3 and calls it covered by luck; and the riel
  // boundary below is where a float actually goes wrong.
  for (const copy of [uiCopy, worker]) {
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0.3, paidKhr: 0, totalUsd: 0.3, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), true, 'an exactly-covering USD tender is covered')
    // The riel edge of the half-cent band at 4,100 is 20.5 riel.
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 40980, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), true, '20 riel short ($0.00488) is inside the band')
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 40979, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), false, '21 riel short ($0.00512) is NOT covered')
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 41000, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), true, 'exactly covering in riel IS covered')
    // A non-integer rate must not be quantized away under V1.
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 41000.5, totalUsd: 10, exchangeRate: 4100.05, moneyPrecisionVersion: 1,
    }), true, 'an exact V1 rate keeps its fractional part')
  }
})

await runTest('NOT_PAID_STATUS is the credit status both packages agree on', async () => {
  const worker = await loadWorkerCopy()
  assert.equal(uiCopy.NOT_PAID_STATUS, 'awaiting_payment')
  assert.equal(worker.NOT_PAID_STATUS, uiCopy.NOT_PAID_STATUS)
})

await runTest('the paid statuses are the same two in both packages', async () => {
  const worker = await loadWorkerCopy()
  assert.deepEqual([...uiCopy.PAID_SALE_STATUSES], ['completed', 'awaiting_delivery'])
  assert.deepEqual([...worker.PAID_SALE_STATUSES], [...uiCopy.PAID_SALE_STATUSES])
})

await runTest('both copies answer statusChangeNeedsPayment identically, and correctly', async () => {
  const worker = await loadWorkerCopy()
  for (const fixture of STATUS_CHANGE_FIXTURES) {
    const ui = uiCopy.statusChangeNeedsPayment(fixture.from, fixture.to, fixture.sale)
    const wk = worker.statusChangeNeedsPayment(fixture.from, fixture.to, fixture.sale)
    assert.equal(ui, wk, `UI and Worker disagree on "${fixture.name}"`)
    assert.equal(ui, fixture.expected, `wrong answer for "${fixture.name}"`)
  }
})

await runTest('the status-change fixtures discriminate against the pre-guard routes', () => {
  // Before the guard, PATCH /:id/status and the group action allowed every
  // one of these moves. If no fixture expected a refusal, this table would
  // pass against the broken routes and prove nothing.
  const discriminating = STATUS_CHANGE_FIXTURES.filter((fixture) => fixture.expectedBeforeFix !== undefined)
  assert.ok(discriminating.length >= 4, 'expected several moves the old routes allowed wrongly')
  for (const fixture of discriminating) {
    assert.equal(fixture.expected, true, `"${fixture.name}" does not separate the old routes from the new`)
  }
  // And against the exact-only rule that followed: a Not Paid sale holding a
  // tender inside the band could never be completed with its own money.
  const band = STATUS_CHANGE_FIXTURES.filter((fixture) => fixture.band)
  assert.ok(band.length >= 3, 'expected several in-band moves the exact rule refused')
  for (const fixture of band) assert.equal(fixture.expected, false, `"${fixture.name}" is inside the band`)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
