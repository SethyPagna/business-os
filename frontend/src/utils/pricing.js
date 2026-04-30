export function toFiniteNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function roundUpToDecimals(value, decimals = 2) {
  const num = toFiniteNumber(value, 0)
  const factor = 10 ** decimals
  const scaled = num * factor
  const epsilon = 1e-9
  if (num >= 0) return Math.ceil(scaled - epsilon) / factor
  return Math.floor(scaled + epsilon) / factor
}

export function normalizePriceValue(value, fallback = 0) {
  return roundUpToDecimals(toFiniteNumber(value, fallback), 2)
}

export function formatPriceNumber(value) {
  return normalizePriceValue(value, 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function normalizeDiscountPercent(value) {
  const num = toFiniteNumber(value, 0)
  return Math.min(100, Math.max(0, roundUpToDecimals(num, 2)))
}

export function normalizeDiscountType(value) {
  return String(value || '').toLowerCase() === 'fixed' ? 'fixed' : 'percent'
}

export function isProductDiscountActive(product = {}, now = new Date()) {
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

export function calculateProductDiscount(product = {}, exchangeRate = 4100) {
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
