import { roundMoney2, roundMoney4, sellingPriceCeilCent } from './moneyPrecision.ts'

type DiscountType = 'fixed' | 'percent'

interface ProductDiscountInput {
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  discount_enabled?: unknown
  discount_type?: unknown
  discount_percent?: unknown
  discount_amount_usd?: unknown
  discount_amount_khr?: unknown
  discount_starts_at?: unknown
  discount_ends_at?: unknown
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function roundUpToDecimals(value: unknown, decimals = 2): number {
  const num = toFiniteNumber(value, 0)
  const factor = 10 ** decimals
  const scaled = num * factor
  const epsilon = 1e-9
  const rounded = num >= 0
    ? Math.ceil(scaled - epsilon) / factor
    : Math.floor(scaled + epsilon) / factor
  if (Object.is(rounded, -0)) return 0
  return rounded
}

/**
 * A SELLING PRICE to the cent: rounds UP, so the shop never undercharges by a fraction (owner, 24 Sep 2026). It is for a price
 * a product is sold at, never for a figure to be shown: tax, a total, change, a discount or a report figure is DISPLAYED money
 * and rounds to the nearest cent (roundDisplayMoney).
 */
export function normalizePriceValue(value: unknown, fallback = 0): number {
  return roundUpToDecimals(toFiniteNumber(value, fallback), 2)
}

/**
 * DISPLAYED money: the nearest cent, half away from zero, read from the exact decimal value (owner, 24 Sep 2026: normal
 * displayed money rounds to the nearest cent, never always up; internal money stays at four decimals). Tax of 2.161 reads
 * 2.16 and 2.165 reads 2.17. Rounding is a display step only: a stored or computed value is never passed back through it.
 */
export function roundDisplayMoney(value: unknown): number {
  const num = toFiniteNumber(value, 0)
  let rounded: number
  try { rounded = roundMoney2(num) } catch { rounded = Math.round(num * 100) / 100 }
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Internal cost/discount boundary. Never format an editable value to cents. */
export function normalizeInternalMoney(value: unknown, fallback = 0): number {
  return roundMoney4(toFiniteNumber(value, fallback))
}

/** New selling-price input policy, not a computed net-price policy. */
export function normalizeSellingPrice(value: unknown, fallback = 0): number {
  return sellingPriceCeilCent(toFiniteNumber(value, fallback))
}

export function editableMoneyValue(value: unknown, fallback = 0): string {
  return String(normalizeInternalMoney(value, fallback))
}

/** A selling price as a two-decimal string (rounds UP). A figure that is not a price uses formatMoneyNumber. */
export function formatPriceNumber(value: unknown): string {
  return normalizePriceValue(value, 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * THE one way to SHOW a selling, wholesale, promotion or unit price through a display formatter (fmtUSD / fmtKHR, from the app context or a
 * prop): the price rounds UP first, with the rule the till charges it by (normalizePriceValue / sellingPriceCeilCent), and the formatter then
 * prints that cent-valued figure. So a product stored at 2.161 reads $2.17 on its card, in the cart and on the receipt -- the same figure it is
 * sold at. An AMOUNT (a total, tax, change, a line total, a report figure) goes straight to fmtUSD, which rounds to the nearest cent.
 */
export function priceText(format: (amount: number) => string, price: unknown): string {
  return format(normalizePriceValue(price, 0))
}

/** Displayed money as a two-decimal string, rounded to the NEAREST cent (roundDisplayMoney). */
export function formatMoneyNumber(value: unknown): string {
  return roundDisplayMoney(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function normalizeDiscountPercent(value: unknown): number {
  const num = toFiniteNumber(value, 0)
  return Math.min(100, Math.max(0, roundUpToDecimals(num, 2)))
}

export function normalizeDiscountType(value: unknown): DiscountType {
  return String(value || '').toLowerCase() === 'fixed' ? 'fixed' : 'percent'
}

export function isProductDiscountActive(product: ProductDiscountInput = {}, now: Date | string | number = new Date()): boolean {
  if (!product?.discount_enabled) return false
  const type = normalizeDiscountType(product.discount_type)
  if (type === 'percent' && normalizeDiscountPercent(product.discount_percent) <= 0) return false
  if (type === 'fixed' && normalizePriceValue(product.discount_amount_usd || 0) <= 0 && normalizePriceValue(product.discount_amount_khr || 0) <= 0) return false
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const starts = String(product.discount_starts_at || '').trim()
  const ends = String(product.discount_ends_at || '').trim()
  if (starts && !Number.isNaN(new Date(starts).getTime()) && new Date(starts).getTime() > nowMs) return false
  if (ends && !Number.isNaN(new Date(ends).getTime()) && new Date(ends).getTime() < nowMs) return false
  return true
}

export function calculateProductDiscount(product: ProductDiscountInput = {}, exchangeRate = 4100) {
  const sellingUsd = normalizePriceValue(product.selling_price_usd || 0)
  const sellingKhr = normalizePriceValue(product.selling_price_khr || (sellingUsd * exchangeRate))
  if (!isProductDiscountActive(product)) {
    return {
      active: false,
      applied_price_usd: sellingUsd,
      applied_price_khr: sellingKhr,
      discount_amount_usd: 0,
      discount_amount_khr: 0,
      percent_off: 0,
    }
  }
  const type = normalizeDiscountType(product.discount_type)
  let discountUsd = 0
  let discountKhr = 0
  let percentOff = 0
  if (type === 'percent') {
    percentOff = normalizeDiscountPercent(product.discount_percent)
    discountUsd = normalizePriceValue(sellingUsd * (percentOff / 100))
    discountKhr = normalizePriceValue(sellingKhr * (percentOff / 100))
  } else {
    discountUsd = normalizePriceValue(product.discount_amount_usd || 0)
    discountKhr = normalizePriceValue(product.discount_amount_khr || (discountUsd * exchangeRate))
    percentOff = sellingUsd > 0 ? Math.round((Math.min(discountUsd, sellingUsd) / sellingUsd) * 100) : 0
  }
  discountUsd = Math.min(discountUsd, sellingUsd)
  discountKhr = Math.min(discountKhr, sellingKhr)
  return {
    active: true,
    applied_price_usd: normalizePriceValue(Math.max(0, sellingUsd - discountUsd)),
    applied_price_khr: normalizePriceValue(Math.max(0, sellingKhr - discountKhr)),
    discount_amount_usd: discountUsd,
    discount_amount_khr: discountKhr,
    percent_off: Math.max(0, percentOff),
  }
}
