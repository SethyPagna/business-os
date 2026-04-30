'use strict'

const { normalizePriceValue } = require('./money')

const DISCOUNT_TYPES = new Set(['percent', 'fixed'])
const DEFAULT_BADGE_COLOR = '#e11d48'

function normalizeBooleanFlag(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback ? 1 : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  const raw = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on', 'enabled', 'active'].includes(raw)) return 1
  if (['0', 'false', 'no', 'n', 'off', 'disabled', 'inactive'].includes(raw)) return 0
  return Number(value) ? 1 : 0
}

function normalizePercent(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(100, Math.max(0, Math.ceil((num * 100) - 1e-9) / 100))
}

function normalizeDiscountType(value) {
  const raw = String(value || '').trim().toLowerCase()
  return DISCOUNT_TYPES.has(raw) ? raw : 'percent'
}

function normalizeHexColor(value, fallback = DEFAULT_BADGE_COLOR) {
  const raw = String(value || '').trim()
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback
}

function normalizeDateText(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return raw
}

function pick(source, key, fallback) {
  return Object.prototype.hasOwnProperty.call(source || {}, key) ? source[key] : fallback
}

function normalizeProductDiscount(source = {}, fallback = {}) {
  const type = normalizeDiscountType(pick(source, 'discount_type', fallback.discount_type))
  const amountUsd = normalizePriceValue(pick(source, 'discount_amount_usd', fallback.discount_amount_usd) || 0)
  const amountKhr = normalizePriceValue(pick(source, 'discount_amount_khr', fallback.discount_amount_khr) || 0)
  const percent = normalizePercent(pick(source, 'discount_percent', fallback.discount_percent))
  const enabled = normalizeBooleanFlag(
    pick(source, 'discount_enabled', fallback.discount_enabled),
    fallback.discount_enabled || 0,
  )
  return {
    discount_enabled: enabled,
    discount_type: type,
    discount_percent: type === 'percent' ? percent : 0,
    discount_amount_usd: type === 'fixed' ? amountUsd : 0,
    discount_amount_khr: type === 'fixed' ? amountKhr : 0,
    discount_label: String(pick(source, 'discount_label', fallback.discount_label) || '').trim(),
    discount_badge_color: normalizeHexColor(pick(source, 'discount_badge_color', fallback.discount_badge_color)),
    discount_starts_at: normalizeDateText(pick(source, 'discount_starts_at', fallback.discount_starts_at)),
    discount_ends_at: normalizeDateText(pick(source, 'discount_ends_at', fallback.discount_ends_at)),
  }
}

function isDiscountActive(product = {}, now = new Date()) {
  if (!normalizeBooleanFlag(product.discount_enabled, 0)) return false
  const type = normalizeDiscountType(product.discount_type)
  if (type === 'percent' && normalizePercent(product.discount_percent) <= 0) return false
  if (type === 'fixed' && normalizePriceValue(product.discount_amount_usd || 0) <= 0 && normalizePriceValue(product.discount_amount_khr || 0) <= 0) return false

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const startsAt = normalizeDateText(product.discount_starts_at)
  const endsAt = normalizeDateText(product.discount_ends_at)
  if (startsAt && new Date(startsAt).getTime() > nowMs) return false
  if (endsAt && new Date(endsAt).getTime() < nowMs) return false
  return true
}

function calculateDiscountedPrice(product = {}, exchangeRate = 4100) {
  const sellingUsd = normalizePriceValue(product.selling_price_usd || 0)
  const sellingKhr = normalizePriceValue(product.selling_price_khr || (sellingUsd * exchangeRate))
  if (!isDiscountActive(product)) {
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
    percentOff = normalizePercent(product.discount_percent)
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

module.exports = {
  DEFAULT_BADGE_COLOR,
  calculateDiscountedPrice,
  isDiscountActive,
  normalizeProductDiscount,
}
