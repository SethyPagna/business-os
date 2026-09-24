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
// COVERAGE IS NOT RE-DERIVED ANYWHERE ELSE. paymentCoversSaleTotalUnits below
// is THE coverage formula and saleOutstandingUsd is the same comparison read
// as an amount. The POS checkout gate and status picker, POST /sales,
// lib/paymentSettlement.ts's `insufficient_payment` check, this resolver,
// statusChangeNeedsPayment, and every "outstanding / balance due" figure (the
// receipt, the sale detail, the settlement editor, the Worker's edit
// responses) call them rather than keeping inline copies. A sale that one
// surface calls paid is a sale every surface calls paid, and no drift is
// possible because there is nothing to drift from.
//
// NORMALISING IS CREATION ONLY, AND SILENT. POST /sales normalises without a
// 4xx -- a stale or offline client must not be told its already-rung sale is
// invalid. Nothing re-labels an EXISTING paid sale as Not Paid by itself: on
// PATCH /:id/status, completed/awaiting_delivery -> awaiting_payment IS the
// shop's payment-correction reopen (it is the only thing that turns on
// `payment_correction_allowed` and it writes its own audit action
// `sale_payment_correction_opened`), so refusing it would leave a mis-keyed
// tender uncorrectable forever.
//
// THE FORWARD MOVE IS REFUSED ON EXISTING SALES. The mirror-image hole had two
// more mouths: PATCH /:id/status without payment fields, and the Sales page's
// group status action, both moved a Not Paid sale that still owed money to
// completed or awaiting_delivery -- a paid status asserting a payment nobody
// made, and a debt gone from every Not Paid list. statusChangeNeedsPayment
// below is the one answer to "may this sale take that status with the money
// it has"; the status route, lib/saleBulkStatus.ts and the Sales page's group
// picker all ask it. A settlement in the same request is the other way in,
// and it has its own coverage check (lib/paymentSettlement.ts).
//
// ONE DEFINITION OF PAID: COVERED TO WITHIN HALF A US CENT. A tender covers a
// sale when it falls short by at most PAID_STATUS_SHORTFALL_TOLERANCE_UNITS
// ($0.005), compared in exact integer units, never floats. Two facts make
// that the real boundary rather than a rounding convenience: a shortfall under
// half a cent prints as $0.00, so nobody at the counter can see it, and riel
// has no coin below 100, so nobody could hand it over either. 39,400 riel for
// a $9.61 sale at 4,100 (39,401 riel) is a normal full payment.
//
// The band is the ONLY coverage answer, everywhere. It used to apply to
// creation alone, and that made two definitions of "paid": the owner's tender
// was recorded Completed, then printed a red "Balance due $0.00 / 1 riel",
// pre-filled $0.01 to settle, could still be recorded Not Paid, and could not
// be settled or completed with the same money. A paid sale is Completed and an
// unpaid one is Not Paid, so every question -- may it be born paid, does
// Not Paid resolve to paid, may it move to a paid status, does a settlement
// cover it, what is still owed -- asks the same comparison. The POS clients
// already deployed, including sales queued offline, were built on this band,
// so their sales still land. Refunds, change and overpayment are not coverage
// questions and do not take the band.
//
// Neither half moves a sale by itself -- the resolver only picks the status a
// sale is BORN with, and the guard only refuses -- so a pending
// `sale.add_items` undo (which requires the sale to still be in the status it
// was added in, lib/undoAppliers.ts) can never be invalidated by either.
//
// This file is the mirror of cloudflare/src/lib/saleStatusResolution.ts. The
// ONLY permitted difference is the import specifier (this copy needs the
// explicit .ts extension so Node can load it in tests; the Worker build
// resolves extensionless). Everything below the import must stay identical:
// frontend/tests/saleStatusResolutionParity.test.ts enforces exactly that and
// drives BOTH copies through the same fixture table, and
// cloudflare/scripts/test-sale-paid-status-resolution-pure.cjs and
// test-sale-bulk-status-paid-guard-pure.cjs drive the Worker copy through
// the real routes.

import { exactDecimalRatio, financialCalculationUnits, type FinancialDecimalInput } from './financialPrecision.ts'

/** The credit status: the sale asserts the customer still owes the money. */
export const NOT_PAID_STATUS = 'awaiting_payment'

/** The statuses that assert the sale IS paid: the counter sale, and the paid order still waiting for its driver. */
export const PAID_SALE_STATUSES: readonly string[] = ['completed', 'awaiting_delivery']

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
 *
 * A zero or negative rate is refused on BOTH paths (exactDecimalRatio already
 * refuses it for V1): with a zero numerator every tender would "cover" every
 * total, which is the one answer this formula must never give by accident.
 */
function rateRatio(exchangeRate: FinancialDecimalInput, moneyPrecisionVersion: number | undefined): { numerator: bigint; denominator: bigint } {
  if (moneyPrecisionVersion === 1) return exactDecimalRatio(exchangeRate)
  const numerator = financialCalculationUnits(exchangeRate)
  if (numerator <= 0n) throw new RangeError('The exchange rate must be positive.')
  return { numerator, denominator: 10_000n }
}

/**
 * Half a US cent, in financial calculation units (four decimals): the most a
 * tender may fall short of the total and still cover it. See the header --
 * a shortfall under half a cent prints as $0.00 and riel has no coin that
 * could close it.
 */
export const PAID_STATUS_SHORTFALL_TOLERANCE_UNITS = 50n

type UnitsTender = SaleCoverageInput & { paidUsdUnits: bigint; paidKhrUnits: bigint }
type AmountTender = SaleCoverageInput & { paidUsd: FinancialDecimalInput; paidKhr: FinancialDecimalInput }

/**
 * The one integer expression behind both answers: the shortfall
 * (total - tender, in calculation units) multiplied by the rate numerator, so
 * no division and no rounding ever happens. Positive means short.
 */
function scaledShortfall(input: UnitsTender): { scaled: bigint; numerator: bigint } {
  const { numerator, denominator } = rateRatio(input.exchangeRate, input.moneyPrecisionVersion)
  const totalUsdUnits = financialCalculationUnits(input.totalUsd)
  return { scaled: (totalUsdUnits - input.paidUsdUnits) * numerator - input.paidKhrUnits * denominator, numerator }
}

function unitsTender(input: AmountTender): UnitsTender {
  return {
    ...input,
    paidUsdUnits: financialCalculationUnits(input.paidUsd),
    paidKhrUnits: financialCalculationUnits(input.paidKhr),
  }
}

/**
 * Does the tender cover the sale total? THE coverage formula: short by at
 * most half a cent.
 *
 * Exact integer comparison, never floating point: a mixed USD+KHR tender at
 * the edge of the band must not be rounded across it in either direction (a
 * shortfall rounded into coverage would label a debt "Completed" and lose the
 * shop money quietly).
 *
 * Takes bigint UNITS so a caller that summed tender rows exactly can hand its
 * exact sum straight in without a round trip through a JS number.
 *
 * Throws on an unreadable amount or rate (a zero or negative rate included);
 * every caller treats a throw as "not covered" -- money that cannot be read
 * is not evidence of a payment.
 */
export function paymentCoversSaleTotalUnits(input: UnitsTender): boolean {
  const { scaled, numerator } = scaledShortfall(input)
  return scaled <= PAID_STATUS_SHORTFALL_TOLERANCE_UNITS * numerator
}

/** Number-taking convenience over paymentCoversSaleTotalUnits. Same formula. */
export function paymentCoversSaleTotal(input: AmountTender): boolean {
  return paymentCoversSaleTotalUnits(unitsTender(input))
}

/**
 * What is still owed on the sale, in dollars at four decimals. The same
 * comparison as paymentCoversSaleTotal, read as an amount: 0 when the tender
 * covers the sale, otherwise the exact shortfall rounded half-up to the
 * calculation unit -- which is always more than half a cent, so it never
 * prints as $0.00. Overpayment is change, not a negative balance: it reads 0.
 *
 * Throws like paymentCoversSaleTotal; a caller that has to show a figure
 * decides what an unreadable sale owes.
 */
export function saleOutstandingUsd(input: AmountTender): number {
  const { scaled, numerator } = scaledShortfall(unitsTender(input))
  if (scaled <= PAID_STATUS_SHORTFALL_TOLERANCE_UNITS * numerator) return 0
  return Number((2n * scaled + numerator) / (2n * numerator)) / 10_000
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

/**
 * A stored sale's money, in the shape both packages already hold it: the
 * Worker reads the row (`SELECT s.*`) and the Sales page lists the same
 * columns under the same names, so both hand the SAME object to the rule
 * below and nothing is re-mapped on either side.
 */
export type RecordedSaleMoney = {
  total_usd?: unknown
  amount_paid_usd?: unknown
  amount_paid_khr?: unknown
  exchange_rate?: unknown
  money_precision_version?: unknown
  calculated_total_usd?: unknown
  /** The rest of the row rides along untouched (and keeps this from being a weak type). */
  [column: string]: unknown
}

/** A stored amount as the formula takes it: an absent PAYMENT is none; an absent total or rate is unreadable. */
function storedAmount(value: unknown, absentIsZero: boolean): FinancialDecimalInput {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value
  if (value == null && absentIsZero) return 0
  throw new TypeError('The sale money cannot be read.')
}

function statusWord(status: unknown): string {
  return String(status || 'completed').trim().toLowerCase()
}

/**
 * A stored sale's money as the coverage formula takes it, read on the basis
 * the sale was written with: V1 when it carries recorded V1 money (the same
 * two columns the Worker's hasRecordedSaleMoneyPrecision and the frontend's
 * saleUsesSavedExchangeRate ask), legacy otherwise -- at the sale's OWN
 * booked rate, the rate its tender was taken at. Throws when unreadable.
 */
function recordedTender(sale: RecordedSaleMoney): AmountTender {
  return {
    paidUsd: storedAmount(sale.amount_paid_usd, true),
    paidKhr: storedAmount(sale.amount_paid_khr, true),
    totalUsd: storedAmount(sale.total_usd, false),
    exchangeRate: storedAmount(sale.exchange_rate, false),
    moneyPrecisionVersion: Number(sale.money_precision_version) === 1 || sale.calculated_total_usd != null ? 1 : 0,
  }
}

/**
 * What a STORED sale still owes: saleOutstandingUsd over recordedTender. The
 * receipt, the sale detail and anything else printing a balance due read the
 * row through this, so the figure and the paid statuses cannot disagree.
 * Throws when the money cannot be read.
 */
export function recordedSaleOutstandingUsd(sale: RecordedSaleMoney): number {
  return saleOutstandingUsd(recordedTender(sale))
}

/**
 * Would moving an EXISTING sale from `fromStatus` to `toStatus` assert a
 * payment the sale does not have?
 *
 * True only for Not Paid -> a paid status, and only when the payment already
 * recorded on the sale does not cover its total. Everything else is false:
 * the payment-correction reopen (a paid status -> Not Paid), paid -> paid
 * (a delivered order, or a legacy row), cancelling, and the returns flow's
 * statuses are not this rule's business.
 *
 * The money is read by recordedTender, on the basis the sale was written
 * with. Unreadable money counts as NOT covered, the same stance as
 * resolvePaidSaleStatus: money that cannot be read is not evidence of a
 * payment.
 *
 * A missing status is a legacy completed sale, the reading both packages
 * give a NULL `sale_status` -- and an undo can put one back.
 */
export function statusChangeNeedsPayment(fromStatus: unknown, toStatus: unknown, sale: RecordedSaleMoney): boolean {
  if (statusWord(fromStatus) !== NOT_PAID_STATUS) return false
  if (!PAID_SALE_STATUSES.includes(statusWord(toStatus))) return false
  try {
    return !paymentCoversSaleTotal(recordedTender(sale))
  } catch {
    return true
  }
}
