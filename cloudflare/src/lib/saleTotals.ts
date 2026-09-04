// The money math for a sale, extracted from routes/sales.ts so it can be
// tested directly instead of only through a live request.
//
// It lives in its own module because two real bugs shipped inside this
// arithmetic while it was inline in the route handler, both invisible to
// every existing test:
//
//   * the delivery fee was charged by the POS cart and printed on the
//     receipt but never added to the recorded total, so `sales.total_usd`
//     sat below what was actually collected on every delivery sale -- and
//     that gap propagated into change, the Sales page, salesAnalytics and
//     loyalty-points accrual;
//   * `Number(body.amount_paid_usd) || totalUsd` read a legitimate 0 (a
//     KHR-only sale) as "the client sent nothing" and recorded the full
//     total as USD tendered, together with roughly a whole extra total of
//     change.
//
// Both are the same underlying shape: a value that is part of the total
// being applied somewhere other than where the total is computed. Keeping
// the whole computation in one pure function is what makes that class of
// mistake visible.

/**
 * Two-decimal rounding for USD amounts. Deliberately round-half-up via
 * Number.EPSILON rather than bare Math.round, which mis-rounds values like
 * 1.005 that arrive from float arithmetic. Kept identical to the routine
 * routes/sales.ts has always used -- changing money-rounding behavior is a
 * deliberate, separately-reviewed decision, not a refactor side effect.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * True when the request actually carried a tender amount, as opposed to
 * omitting the field. `undefined`, `null` and `''` all mean "not supplied";
 * a numeric 0 means "they really did hand over nothing in this currency",
 * which is the normal shape of a KHR-only (or USD-only) payment and must be
 * preserved rather than replaced with the total.
 */
function isSuppliedAmount(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  return Number.isFinite(Number(value))
}

export type SaleTotalsInput = {
  subtotalUsd: number
  discountUsd: number
  membershipDiscountUsd: number
  taxUsd: number
  isDelivery: boolean
  deliveryFeeUsd: number
  /** 'customer' or 'store'; anything else is treated as store-absorbed. */
  deliveryFeePaidBy: string
  exchangeRate: number
  /**
   * The raw `change_exchange_rate` SETTING (Part 534: change money converts
   * at its own rate). Absent/blank/non-positive falls back to exchangeRate,
   * so callers can pass the settings value straight through.
   */
  changeExchangeRate?: unknown
  /** Raw request value -- may be absent, null, 0, or non-numeric. */
  rawAmountPaidUsd: unknown
  /** Raw request value -- may be absent, null, 0, or non-numeric. */
  rawAmountPaidKhr: unknown
}

export type SaleTotals = {
  /** The delivery fee actually billed to the customer (0 when store-paid). */
  customerDeliveryFeeUsd: number
  totalUsd: number
  totalKhr: number
  amountPaidUsd: number
  amountPaidKhr: number
  changeUsd: number
  changeKhr: number
}

/**
 * The part of a delivery fee the CUSTOMER was billed -- the ONLY part
 * `sales.total_usd` ever carries. When the store absorbs it the customer's
 * bill is unchanged and the fee is a cost, not revenue: the same rule as
 * POS.tsx's customerFeeUsd and the frontend's receiptDeliveryFigures, so the
 * cart, the receipt and the stored row all agree on one number.
 *
 * Exported because lib/telegram.ts needs the same answer to print a sale
 * summary whose lines foot to total_usd, and it had reached that answer with
 * its own literal: it compared the payer against 'shop', while the column
 * default, POS.tsx's DELIVERY_FEE_PAYER and salesAnalytics.ts all use
 * 'store'. So a delivery the shop absorbed was added into the alert's Total
 * while its Net Total (total_usd) excluded it, and the "(shop paid)" tag
 * could never print. One rule, one place.
 */
export function customerBilledDeliveryFeeUsd(isDelivery: boolean, feeUsd: unknown, paidBy: unknown): number {
  return isDelivery && String(paidBy || 'customer') === 'customer'
    ? round2(Number(feeUsd) || 0)
    : 0
}

export function computeSaleTotals(input: SaleTotalsInput): SaleTotals {
  const exchangeRate = Number(input.exchangeRate) || 4100

  const deliveryFeeUsd = round2(Number(input.deliveryFeeUsd) || 0)
  const customerDeliveryFeeUsd = customerBilledDeliveryFeeUsd(input.isDelivery, deliveryFeeUsd, input.deliveryFeePaidBy)

  const totalUsd = round2(
    (Number(input.subtotalUsd) || 0)
    - (Number(input.discountUsd) || 0)
    - (Number(input.membershipDiscountUsd) || 0)
    + (Number(input.taxUsd) || 0)
    + customerDeliveryFeeUsd,
  )
  const totalKhr = Math.round(totalUsd * exchangeRate)

  // A genuinely tendered 0 must survive -- that is the whole KHR-only case
  // the old `|| totalUsd` destroyed. But "absent" has to be detected before
  // coercion, not after: `Number(null)` and `Number('')` are both 0, so a
  // JSON null or an empty form field would otherwise be recorded as "paid
  // nothing" rather than falling back. Only a real number (or a numeric
  // string) counts as a supplied tender.
  const amountPaidUsd = isSuppliedAmount(input.rawAmountPaidUsd)
    ? round2(Math.max(0, Number(input.rawAmountPaidUsd)))
    : totalUsd
  const amountPaidKhr = isSuppliedAmount(input.rawAmountPaidKhr)
    ? Math.round(Math.max(0, Number(input.rawAmountPaidKhr)))
    : 0

  // Payment converts at the MAIN rate; the KHR change handed back converts
  // at the dedicated change rate (Part 534) -- the same split POS.tsx
  // displays, so the stored row can't disagree with what the cashier was
  // told to hand over. The KHR conversion uses the EXACT overpay, not the
  // cent-rounded changeUsd: rounding first shifts whole tens of riel
  // (2.2051 * 4000 = 8,820 displayed vs round2 first = 2.21 * 4000 = 8,840).
  const changeUsdExact = amountPaidUsd + amountPaidKhr / exchangeRate - totalUsd
  const changeUsd = round2(changeUsdExact)
  const changeKhr = Math.round(changeUsdExact * resolveChangeExchangeRate(input.changeExchangeRate, exchangeRate))

  return { customerDeliveryFeeUsd, totalUsd, totalKhr, amountPaidUsd, amountPaidKhr, changeUsd, changeKhr }
}

/**
 * Resolve the `change_exchange_rate` setting against the sale's main rate.
 * Hand-synced twin of frontend posCore.ts's resolveChangeExchangeRate (same
 * pairing discipline as receiptNumber.ts <-> timestampId.ts): blank, absent
 * or non-positive means "same as exchange rate".
 */
export function resolveChangeExchangeRate(rawSetting: unknown, mainRate: number): number {
  const parsed = parseFloat(String(rawSetting ?? '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : mainRate
}
