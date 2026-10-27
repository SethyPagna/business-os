import { nativeChangeAmounts, sellingPriceCeilCent, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { NativeSaleChangeValidationError, planNativeSaleChange, type NativeSaleChangePlan } from './nativeSaleChange'
import { paymentCoversSaleTotal, rielCashFloor } from './saleStatusResolution'
import {
  capturedPricingMetadata, capturePricingProduct, evaluateCapturedPricingPool, serializeSaleItemPricing,
  type CapturedPricingPool, type ExactLinePricing, type ReceiptAllocationContext,
} from './saleItemPricing'
import { computeSaleTotals, resolveChangeExchangeRate } from './saleTotals'

// One-step exchange for a money-v1 sale (owner, 22 Oct 2026: "replacement actually isn't replacing but changing or adding
// both ... the customer pays, or gets back, the difference").
//
// The refund and the replacement stay two honest records, as they always have been for a v0 sale:
//   - the RETURN books the refund R at the entitlement price (cash out of the dollar drawer);
//   - the REPLACEMENT is an ordinary money-v1 sale S2 of the new goods (total T, whole cents);
//   - the exchange is settled at the counter by treating the refund's CASH share C as a tender towards S2: S2's payment rows
//     are {the shop's cash method, C} plus whatever the customer pays on top, and any overpayment is S2's ACTUAL change,
//     handed back in the currency the customer chose. The dollar drawer therefore sees +C (S2 credit) - C (refund) = 0 for
//     the part that was netted, and only the money that physically changed hands moves a drawer, per currency.
// Nothing here needs a schema change: S2 is an ordinary sale row and the existing shift / report / Telegram readers already
// know how to read its tender and its actual change.
//
// This module is pure: it prices the lines, builds the quote the till reviews, and settles the tender.

import {
  canonicalExchangeExpected, canonicalExchangePayment, RETURN_EXCHANGE_MAX_LINES, RETURN_EXCHANGE_MAX_TENDER_ROWS, ReturnExchangeError,
  type ExchangeLineIntent, type ExchangePaymentIntent, type ExchangeQuoteV1, type ExchangeTenderRow,
} from './returnExchangeIntent'

export {
  canonicalExchangeExpected, canonicalExchangePayment, RETURN_EXCHANGE_MAX_LINES, RETURN_EXCHANGE_MAX_TENDER_ROWS, ReturnExchangeError,
  type ExchangeLineIntent, type ExchangePaymentIntent, type ExchangeQuoteV1, type ExchangeTenderRow,
}

export type ExchangeProduct = {
  id: number
  name: string
  selling_price_usd: number | null
  selling_price_khr: number | null
  cost_price_usd: number | null
  cost_price_khr: number | null
}

export type PricedExchangeLine = {
  /** The line key inside the pricing pool (r0, r1, ...). */
  key: string
  product_id: number
  product_name: string
  branch_id: number
  batch_id: number | null
  quantity: number
  /** The catalog selling price at pricing time, ceilinged to the cent (what the price floor compares against). */
  catalog_usd: number
  unit_price_usd: number
  unit_price_khr: number
  total_usd: number
  total_khr: number
  cost_price_usd: number | null
  cost_price_khr: number | null
  amounts: ExactLinePricing
  metadata: { price_mode: string; product_discount_type: string | null; product_discount_label: string | null }
  pricing_snapshot_json: string
}

export type ExchangePricing = {
  lines: PricedExchangeLine[]
  subtotal_usd: number
  calculated_total_usd: number
  rounding_adjustment_usd: number
  total_usd: number
  total_khr: number
}

function money(value: unknown, code: string): number {
  const number = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(number) || number < 0) {
    throw new ReturnExchangeError(code, 'A replacement price must be a non-negative amount.')
  }
  return number
}

/**
 * Prices every replacement line the way an ordinary money-v1 sale prices a line with a price of its own: the unit price is the
 * posted price (else the catalog price) ceilinged to the cent, the line is gross = price x quantity at four places, and the
 * sale total is the cent-rounded sum (rounding_adjustment_usd stays within half a cent). No promotion is applied -- a
 * replacement has always sold at the catalog price or the price the till posted -- so the pricing pool carries no rules.
 */
export function priceExchangeLines(input: {
  lines: ReadonlyArray<{ intent: ExchangeLineIntent; product: ExchangeProduct; branchId: number; unitCostUsd: number | null; unitCostKhr: number | null }>
  exchangeRate: number
  evaluatedAt: string
  poolKey: string
}): ExchangePricing {
  const rate = Number(input.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) throw new ReturnExchangeError('return_exchange_rate_invalid', 'The exchange rate is invalid.')
  if (!input.lines.length || input.lines.length > RETURN_EXCHANGE_MAX_LINES) {
    throw new ReturnExchangeError('return_exchange_lines_invalid', `A replacement has between 1 and ${RETURN_EXCHANGE_MAX_LINES} lines.`)
  }
  const keyed = input.lines.map((line, index) => {
    const quantity = Number(line.intent.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ReturnExchangeError('return_exchange_lines_invalid', 'Each replacement line needs a positive quantity.')
    const catalog = sellingPriceCeilCent(money(line.product.selling_price_usd ?? 0, 'return_exchange_price_invalid'))
    const unit = line.intent.applied_price_usd == null
      ? catalog
      : sellingPriceCeilCent(money(line.intent.applied_price_usd, 'return_exchange_price_invalid'))
    return { ...line, key: `r${index}`, quantity, catalog, unit }
  })
  const pool: CapturedPricingPool = {
    version: 1, pool_key: input.poolKey, evaluation_time: input.evaluatedAt, exchange_rate: rate, rules: [],
    lines: keyed.map((line) => ({
      line_key: line.key, source: 'selling' as const,
      product: { ...capturePricingProduct({ id: line.product.id, selling_price_usd: line.unit }), id: line.product.id, selling_price_usd: line.unit },
      selling_price_input_usd: line.unit, manual: { type: 'none' as const, value: 0 },
    })),
  }
  const quantities = Object.fromEntries(keyed.map((line) => [line.key, line.quantity]))
  const exact = evaluateCapturedPricingPool(pool, quantities)
  const subtotal = sumMoney4(keyed.map((line) => exact.get(line.key)!.total_usd))
  const totals = computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: subtotal, discountUsd: 0, membershipDiscountUsd: 0, taxUsd: 0,
    isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: rate,
    rawAmountPaidUsd: 0, rawAmountPaidKhr: 0,
  })
  const allocation: ReceiptAllocationContext = {
    version: 1, lines: keyed.map((line) => ({ line_key: line.key, amount: exact.get(line.key)!.total_usd })),
    discount_usd: 0, membership_discount_usd: 0, tax_usd: 0,
  }
  const lines = keyed.map((line): PricedExchangeLine => {
    const amounts = exact.get(line.key)!
    return {
      key: line.key, product_id: line.product.id, product_name: line.product.name, branch_id: line.branchId,
      batch_id: line.intent.batch_id ?? null, quantity: line.quantity, catalog_usd: line.catalog,
      unit_price_usd: amounts.applied_price_usd, unit_price_khr: amounts.applied_price_khr,
      total_usd: amounts.total_usd, total_khr: amounts.total_khr,
      cost_price_usd: line.unitCostUsd, cost_price_khr: line.unitCostKhr,
      amounts, metadata: capturedPricingMetadata(pool, line.key, amounts),
      pricing_snapshot_json: serializeSaleItemPricing(pool, quantities, line.key, allocation),
    }
  })
  return {
    lines, subtotal_usd: subtotal,
    calculated_total_usd: totals.calculatedTotalUsd ?? subtotal,
    rounding_adjustment_usd: totals.roundingAdjustmentUsd ?? 0,
    total_usd: totals.totalUsd, total_khr: totals.totalKhr,
  }
}

export function buildExchangeQuoteV1(input: {
  saleId: number
  exchangeRate: number
  changeRateSetting?: unknown
  pricing: ExchangePricing
  refundUsd: number
  owedReductionUsd: number
  notPaid: boolean
}): ExchangeQuoteV1 {
  const credit = subtractMoney4(input.refundUsd, input.owedReductionUsd)
  return {
    version: 1,
    sale_id: input.saleId,
    exchange_rate: input.exchangeRate,
    change_exchange_rate: resolveChangeExchangeRate(input.changeRateSetting, input.exchangeRate),
    not_paid: input.notPaid,
    lines: input.pricing.lines.map((line) => ({
      product_id: line.product_id, product_name: line.product_name, branch_id: line.branch_id, batch_id: line.batch_id,
      quantity: line.quantity, unit_price_usd: line.unit_price_usd, unit_price_khr: line.unit_price_khr,
      total_usd: line.total_usd, total_khr: line.total_khr,
    })),
    calculated_total_usd: input.pricing.calculated_total_usd,
    rounding_adjustment_usd: input.pricing.rounding_adjustment_usd,
    total_usd: input.pricing.total_usd,
    total_khr: input.pricing.total_khr,
    refund_usd: input.refundUsd,
    owed_reduction_usd: input.owedReductionUsd,
    credit_usd: credit,
    net_usd: subtractMoney4(input.pricing.total_usd, credit),
  }
}

export type ExchangeSettlement = {
  paymentDetails: ExchangeTenderRow[]
  paymentMethod: string
  amountPaidUsd: number
  amountPaidKhr: number
  change: NativeSaleChangePlan
  saleStatus: 'completed' | 'awaiting_payment'
}

/**
 * Settles S2: the refund's cash share is the first tender row, the customer's rows follow, and whatever the tender exceeds the
 * total by is the sale's ACTUAL change in the chosen currency. Dollar change is the overpayment to the cent; riel change is the
 * overpayment at the change rate ROUNDED DOWN to 100 riel (owner, 21 Oct 2026: a riel refund rounds down, the drawer expects the
 * rounded amount; up to 99 riel stays with the till). A tender that does not cover the total is a 400 -- except when the original
 * sale reads Not Paid, where the replacement stays Not Paid for the rest (nothing is netted across a debt, and none is invented).
 */
export function settleExchange(input: {
  totalUsd: number
  creditUsd: number
  cashMethod: string
  payment: ExchangePaymentIntent
  exchangeRate: number
  changeRateSetting?: unknown
  notPaid: boolean
}): ExchangeSettlement {
  const credit: ExchangeTenderRow[] = input.creditUsd > 0 ? [{ method: input.cashMethod, amount_usd: input.creditUsd, amount_khr: 0, refund_credit: true }] : []
  const paymentDetails = [...credit, ...input.payment.details]
  if (paymentDetails.length > RETURN_EXCHANGE_MAX_TENDER_ROWS + 1) {
    throw new ReturnExchangeError('return_exchange_payment_invalid', 'The replacement payment has too many rows.')
  }
  const amountPaidUsd = sumMoney4(paymentDetails.map((row) => row.amount_usd))
  const amountPaidKhr = paymentDetails.reduce((sum, row) => sum + row.amount_khr, 0)
  let covered = false
  try {
    covered = paymentCoversSaleTotal({ paidUsd: amountPaidUsd, paidKhr: amountPaidKhr, totalUsd: input.totalUsd, exchangeRate: input.exchangeRate, moneyPrecisionVersion: 1 })
  } catch { covered = false }
  const paymentMethod = [...new Set(paymentDetails.map((row) => row.method))].join(' + ')
  const none: NativeSaleChangePlan = { changeUsd: 0, changeKhr: 0, changeIsActual: 0, changeExchangeRate: null }
  if (!covered) {
    if (!input.notPaid) {
      throw new ReturnExchangeError('return_exchange_payment_short', 'The payment does not cover the replacement after the refund. Add the rest, or return fewer items.', 409)
    }
    return { paymentDetails, paymentMethod, amountPaidUsd, amountPaidKhr, change: none, saleStatus: 'awaiting_payment' }
  }
  const surplus = nativeChangeAmounts({
    paidUsd: amountPaidUsd, paidKhr: amountPaidKhr, payableUsd: input.totalUsd, exchangeRate: input.exchangeRate,
    changeExchangeRate: resolveChangeExchangeRate(input.changeRateSetting, input.exchangeRate),
  })
  if (!surplus.hasOverpayment) return { paymentDetails, paymentMethod, amountPaidUsd, amountPaidKhr, change: none, saleStatus: 'completed' }
  const candidates = input.payment.change_currency === 'KHR'
    ? [{ usd: 0, khr: rielCashFloor(surplus.changeKhr) }, { usd: 0, khr: Math.max(0, rielCashFloor(surplus.changeKhr) - 100) }]
    : [{ usd: surplus.changeUsd, khr: 0 }, { usd: Math.max(0, Math.round(surplus.changeUsd * 100 - 1) / 100), khr: 0 }]
  let failure: unknown = null
  for (const candidate of candidates) {
    try {
      const change = planNativeSaleChange({
        actualIntent: true, rawChangeUsd: candidate.usd, rawChangeKhr: candidate.khr,
        amountPaidUsd, amountPaidKhr, totalUsd: input.totalUsd, exchangeRate: input.exchangeRate,
        changeExchangeRate: input.changeRateSetting, fallbackChangeUsd: 0, fallbackChangeKhr: 0,
      })
      return { paymentDetails, paymentMethod, amountPaidUsd, amountPaidKhr, change, saleStatus: 'completed' }
    } catch (error) {
      if (!(error instanceof NativeSaleChangeValidationError)) throw error
      failure = error
    }
  }
  throw new ReturnExchangeError('return_exchange_change_unreconciled',
    failure instanceof Error ? failure.message : 'The change does not reconcile with the payment.', 409)
}
