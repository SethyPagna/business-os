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
import { roundMoney4, roundMoney2, sumMoney4, subtractMoney4, multiplyMoney4, nativeChangeAmounts, sellingPriceCeilCent } from './moneyPrecision'
import { buildSaleMoneyPrecision, canonicalMoney4, SaleMoneyContractError } from './saleMoneyPrecision'

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export type CanonicalSaleItemMoneyInput = {
  sellingPriceInputUsd?: unknown
  appliedPriceUsd?: unknown
  appliedPriceKhr?: unknown
  basePriceUsd?: unknown
  basePriceKhr?: unknown
}

export type CanonicalSaleItemMoney = {
  appliedPriceUsd: number
  appliedPriceKhr: number
  basePriceUsd: number
  basePriceKhr: number
  manualDiscountUsd: number
  manualDiscountKhr: number
}

/**
 * Resolve the paired USD/KHR snapshots stored on sale_items. USD is the
 * authoritative basis whenever it is available; client KHR fields are only
 * a fallback for genuinely KHR-only legacy lines. This keeps manual discount
 * amounts non-negative and prevents a stale/zero KHR base from becoming a
 * negative discount when the applied USD price is reduced.
 */
export function canonicalSaleItemMoney(
  input: CanonicalSaleItemMoneyInput,
  exchangeRate: unknown,
  moneyPrecisionVersion: 0 | 1 = 0,
): CanonicalSaleItemMoney {
  const rateValue = Number(exchangeRate)
  const rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 4100
  if (moneyPrecisionVersion === 1) {
    const appliedPriceUsd = newSaleMoney4(input.appliedPriceUsd)
    const basePriceUsd = input.basePriceUsd == null ? appliedPriceUsd : newSaleMoney4(input.basePriceUsd)
    if (input.sellingPriceInputUsd !== undefined && sellingPriceCeilCent(input.sellingPriceInputUsd as number) !== basePriceUsd)
      throw new SaleMoneyContractError('money_precision_selling_base_mismatch')
    if (appliedPriceUsd > basePriceUsd) throw new SaleMoneyContractError('money_precision_discount_mismatch')
    const appliedPriceKhr = multiplyMoney4(appliedPriceUsd, rate)
    const basePriceKhr = multiplyMoney4(basePriceUsd, rate)
    return { appliedPriceUsd, appliedPriceKhr, basePriceUsd, basePriceKhr,
      manualDiscountUsd: subtractMoney4(basePriceUsd, appliedPriceUsd),
      manualDiscountKhr: subtractMoney4(basePriceKhr, appliedPriceKhr) }
  }
  const appliedRaw = Number(input.appliedPriceUsd)
  const appliedPriceUsd = Number.isFinite(appliedRaw) ? round2(Math.max(0, appliedRaw)) : 0
  const baseRaw = Number(input.basePriceUsd)
  const basePriceUsd = Number.isFinite(baseRaw) && baseRaw > 0
    ? round2(baseRaw)
    : appliedPriceUsd
  const clientAppliedKhr = Number(input.appliedPriceKhr)
  const clientBaseKhr = Number(input.basePriceKhr)
  const fallbackAppliedKhr = Number.isFinite(clientAppliedKhr) ? Math.round(Math.max(0, clientAppliedKhr)) : 0
  const fallbackBaseKhr = Number.isFinite(clientBaseKhr) ? Math.round(Math.max(0, clientBaseKhr)) : fallbackAppliedKhr
  const hasUsdBasis = basePriceUsd > 0 || appliedPriceUsd > 0
  const appliedPriceKhr = hasUsdBasis
    ? Math.round(appliedPriceUsd * rate)
    : fallbackAppliedKhr
  const basePriceKhr = hasUsdBasis
    ? Math.round(basePriceUsd * rate)
    : fallbackBaseKhr
  return {
    appliedPriceUsd,
    appliedPriceKhr,
    basePriceUsd,
    basePriceKhr,
    manualDiscountUsd: round2(Math.max(0, basePriceUsd - appliedPriceUsd)),
    manualDiscountKhr: Math.max(0, basePriceKhr - appliedPriceKhr),
  }
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
  preserveRecordedTender?: boolean
  preserveRecordedBasketOperands?: boolean
  moneyPrecisionVersion?: 0 | 1
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
  moneyPrecisionVersion?: 1
  calculatedTotalUsd?: number
  roundingAdjustmentUsd?: number
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
  if (input.moneyPrecisionVersion === 1) return computeSaleTotalsV1(input)
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

/** New explicit-v1 inputs only. Never pass historical snapshots here. */
export function newSaleMoney4(value: unknown, fallback = 0): number {
  if (value === undefined) return fallback
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || Number(value) < 0)
    throw new SaleMoneyContractError('money_precision_invalid_amount')
  return roundMoney4(value)
}

function computeSaleTotalsV1(input: SaleTotalsInput): SaleTotals {
  const rate = Number(input.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) throw new SaleMoneyContractError('money_precision_invalid_rate')
  const operand=(value:unknown)=>{
    if(!input.preserveRecordedBasketOperands)return newSaleMoney4(value)
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new SaleMoneyContractError('money_precision_invalid_snapshot')
    return value
  }
  const customerDeliveryFeeUsd = input.isDelivery && input.deliveryFeePaidBy === 'customer' ? operand(input.deliveryFeeUsd) : 0
  const financial = buildSaleMoneyPrecision(sumMoney4([
    operand(input.subtotalUsd), -operand(input.discountUsd),
    -operand(input.membershipDiscountUsd), operand(input.taxUsd), customerDeliveryFeeUsd,
  ]))
  // Tender is actual native money, not basket revenue. Preserve denomination.
  if (isSuppliedAmount(input.rawAmountPaidUsd)) newSaleMoney4(input.rawAmountPaidUsd)
  if (isSuppliedAmount(input.rawAmountPaidKhr)) newSaleMoney4(input.rawAmountPaidKhr)
  const amountPaidUsd = isSuppliedAmount(input.rawAmountPaidUsd)
    ? input.preserveRecordedTender ? Number(input.rawAmountPaidUsd) : roundMoney2(input.rawAmountPaidUsd as number) : financial.total_usd
  const amountPaidKhr = isSuppliedAmount(input.rawAmountPaidKhr)
    ? input.preserveRecordedTender ? Number(input.rawAmountPaidKhr) : Math.round(Number(input.rawAmountPaidKhr)) : 0
  const change = nativeChangeAmounts({paidUsd:amountPaidUsd,paidKhr:amountPaidKhr,payableUsd:financial.total_usd,
    exchangeRate:rate,changeExchangeRate:resolveChangeExchangeRate(input.changeExchangeRate,rate)})
  return { customerDeliveryFeeUsd, totalUsd: financial.total_usd,
    calculatedTotalUsd: financial.calculated_total_usd, roundingAdjustmentUsd: financial.rounding_adjustment_usd, moneyPrecisionVersion: 1,
    totalKhr: multiplyMoney4(financial.total_usd,rate), amountPaidUsd, amountPaidKhr,
    changeUsd: change.changeUsd, changeKhr: change.changeKhr }
}

/** Whole-basket upgrade precondition. Unknown/higher-precision historical money
 * must be reviewed, never silently rounded merely to label a parent v1. */
export function assertCanonicalSaleChildren(lines: readonly Record<string, unknown>[]): void {
  if (!lines.length || lines.length > 200) throw new SaleMoneyContractError('money_precision_basket_review_needed')
  const amounts = ['applied_price_usd','applied_price_khr','cost_price_usd','cost_price_khr','total_usd','total_khr',
    'product_discount_usd','product_discount_khr','base_price_usd','base_price_khr','manual_discount_usd','manual_discount_khr']
  for (const row of lines) {
    if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0)
      throw new SaleMoneyContractError('money_precision_basket_review_needed')
    for (const key of amounts) {
      if ((key === 'cost_price_usd' || key === 'cost_price_khr') && row[key] === null) continue
      if (row[key] == null) throw new SaleMoneyContractError('money_precision_basket_review_needed')
      canonicalMoney4(row[key], true)
    }
    // Fixed discounts are money; percentages retain their original precision.
    if (row.manual_discount_type === 'fixed') canonicalMoney4(row.manual_discount_value, true)
  }
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
