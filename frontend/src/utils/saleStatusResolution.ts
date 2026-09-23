// "Paid means it is not Not-Paid" -- the one resolver every surface that
// records or re-labels a sale status runs (S4-41).
//
// THE OWNER'S RULING, in their own words: "A paid sale would usually already
// use a completed status, unless there was a loophole as we can choose status
// when making pos sale make sure this part is updated."
//
// The loophole was real and had two mouths, both at CREATION: the POS let a
// cashier type the full tender and then pick "Not Paid", and POST /sales
// never compared the money to the status at all, so any client (including an
// offline replay) could record the pair.
//
// WHY THE RULE IS NOT "paid => completed". `awaiting_delivery` is not a flag
// beside the status, it IS a status, and its own help text defines it as a
// PAID state ("Paid, not yet delivered -- stock deducted", both language
// packs). Forcing every covered sale to `completed` would empty the delivery
// queue -- the shop would lose the list of orders it still has to drive out.
// So the rule is stated as a refusal of the one status that asserts a debt:
//
//   a sale whose recorded payment COVERS its total must never carry
//   `awaiting_payment`; it resolves to `awaiting_delivery` when the sale is a
//   delivery, and to `completed` otherwise.
//
// which gives the owner's sentence back unchanged for the counter sale, and
// keeps the delivery queue intact for the rest.
//
// COVERAGE IS NOT RE-DERIVED HERE. paymentCoversSaleTotalUnits below is THE
// coverage formula, and lib/paymentSettlement.ts's `insufficient_payment`
// check calls it rather than keeping the inline copy it used to carry. One
// formula, two callers: a sale that settlement calls covered is a sale this
// resolver calls paid, and no drift is possible because there is nothing to
// drift from.
//
// CREATION ONLY, AND SILENTLY. POST /sales normalises without a 4xx -- a
// stale or offline client must not be told its already-rung sale is invalid.
// The rule deliberately does NOT extend to PATCH /:id/status: there,
// completed/awaiting_delivery -> awaiting_payment IS the shop's
// payment-correction reopen (it is the only thing that turns on
// `payment_correction_allowed` and it writes its own audit action
// `sale_payment_correction_opened`), so refusing it would leave a mis-keyed
// tender uncorrectable forever.
//
// That containment is also what keeps undo safe: this rule only ever picks
// the status a sale is BORN with, and never moves an existing sale between
// statuses, so a pending `sale.add_items` undo (which requires the sale to
// still be in the status it was added in, lib/undoAppliers.ts) can never be
// invalidated by it.
//
// This file is the mirror of cloudflare/src/lib/saleStatusResolution.ts. The
// ONLY permitted difference is the import specifier (this copy needs the
// explicit .ts extension so Node can load it in tests; the Worker build
// resolves extensionless). Everything below the import must stay identical:
// frontend/tests/saleStatusResolutionParity.test.ts enforces exactly that and
// drives BOTH copies through the same fixture table, and
// cloudflare/scripts/test-sale-paid-status-resolution-pure.cjs drives the
// Worker copy against the route's own combinations.

import { exactDecimalRatio, financialCalculationUnits, type FinancialDecimalInput } from './financialPrecision.ts'

/** The credit status: the sale asserts the customer still owes the money. */
export const NOT_PAID_STATUS = 'awaiting_payment'

export type SaleCoverageInput = {
  totalUsd: FinancialDecimalInput
  exchangeRate: FinancialDecimalInput
  /** 1 = the sale carries recorded V1 money; 0/absent = legacy. */
  moneyPrecisionVersion?: number
}

/**
 * The rate as an exact integer ratio.
 *
 * V1 money keeps the rate EXACT (it is a decimal ratio, not an amount);
 * legacy rows quantize it to the calculation scale first, which is what the
 * rows were written with. Both are expressed as one ratio so the comparison
 * below is a single integer expression either way.
 */
function rateRatio(exchangeRate: FinancialDecimalInput, moneyPrecisionVersion: number | undefined): { numerator: bigint; denominator: bigint } {
  return moneyPrecisionVersion === 1
    ? exactDecimalRatio(exchangeRate)
    : { numerator: financialCalculationUnits(exchangeRate), denominator: 10_000n }
}

/**
 * Does the tender cover the sale total? THE coverage formula.
 *
 * Exact integer comparison, never floating point: a mixed USD+KHR tender that
 * covers the balance by a single riel must not be rounded into a shortfall
 * (or a shortfall rounded into coverage, which would label a debt "Completed"
 * and lose the shop money quietly).
 *
 * Takes bigint UNITS so a caller that summed tender rows exactly can hand its
 * exact sum straight in without a round trip through a JS number.
 */
export function paymentCoversSaleTotalUnits(input: SaleCoverageInput & {
  paidUsdUnits: bigint
  paidKhrUnits: bigint
}): boolean {
  const { numerator, denominator } = rateRatio(input.exchangeRate, input.moneyPrecisionVersion)
  const totalUsdUnits = financialCalculationUnits(input.totalUsd)
  return input.paidUsdUnits * numerator + input.paidKhrUnits * denominator >= totalUsdUnits * numerator
}

/** Number-taking convenience over paymentCoversSaleTotalUnits. Same formula. */
export function paymentCoversSaleTotal(input: SaleCoverageInput & {
  paidUsd: FinancialDecimalInput
  paidKhr: FinancialDecimalInput
}): boolean {
  return paymentCoversSaleTotalUnits({
    ...input,
    paidUsdUnits: financialCalculationUnits(input.paidUsd),
    paidKhrUnits: financialCalculationUnits(input.paidKhr),
  })
}

export type PaidStatusResolutionInput = SaleCoverageInput & {
  requestedStatus: string
  paidUsd: FinancialDecimalInput
  paidKhr: FinancialDecimalInput
  /** The POS's own signal, unchanged: body.is_delivery / active.isDelivery. */
  isDelivery: boolean
}

/**
 * The status a sale should actually be recorded with.
 *
 * Only ever rewrites `awaiting_payment`, and only when the money covers the
 * total. Every other status is returned untouched -- this resolver has no
 * opinion about a cancelled sale, a return status, or a deliberately
 * unpaid order, and must never grow one: its whole job is closing the
 * paid-but-labelled-unpaid hole.
 *
 * An unparseable amount or rate is treated as NOT covered (the status stands).
 * A sale whose money cannot be read is not evidence that it was paid, and
 * silently promoting it to `completed` would assert a payment nobody made.
 */
export function resolvePaidSaleStatus(input: PaidStatusResolutionInput): string {
  const requested = String(input.requestedStatus || '').trim().toLowerCase()
  if (requested !== NOT_PAID_STATUS) return input.requestedStatus
  let covered = false
  try {
    covered = paymentCoversSaleTotal(input)
  } catch {
    return input.requestedStatus
  }
  if (!covered) return input.requestedStatus
  return input.isDelivery ? 'awaiting_delivery' : 'completed'
}
