// G1's ONE promotion evaluator. POS charges with it, the portal and the
// Products page advertise with it -- "POS + portal both read the SAME rule
// evaluation kernel (truth never diverges between what POS charges and
// what the portal advertises)". Hand-synced mirror:
// frontend/src/utils/promotionRules.ts -- same pattern as batchCode.ts's
// two copies (no shared package across the Worker/frontend boundary); keep
// the bodies identical when editing either.
//
// The kernel deliberately re-implements the tiny money helpers and the
// per-product discount math (same semantics as
// frontend/src/utils/pricing.ts's calculateProductDiscount, the pre-G1
// single-product discount path) so this file stays dependency-free and
// byte-syncable. If pricing.ts's rounding rule ever changes, change it
// here too -- a one-cent disagreement between POS and portal is exactly
// the bug the shared kernel exists to prevent.

export type PromotionRuleType = 'quantity_save' | 'percent_off' | 'fixed_off'
export type PromotionScopeType = 'products' | 'category' | 'brand'

export interface PromotionRule {
  id: number
  title: string
  show_title: boolean
  rule_type: PromotionRuleType
  min_quantity: number
  save_usd: number
  save_khr: number
  percent_off: number
  scope_type: PromotionScopeType
  product_ids: number[]
  category: string
  brand: string
  badge_color: string
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
}

type ProductLike = Record<string, unknown>

const RULE_TYPES = new Set<string>(['quantity_save', 'percent_off', 'fixed_off'])
const SCOPE_TYPES = new Set<string>(['products', 'category', 'brand'])
const DEFAULT_BADGE_COLOR = '#e11d48'

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

// Same "round price UP at the 2nd decimal" rule as utils/pricing.ts --
// prices never round down a cent against the shop.
function roundUpToDecimals(value: unknown, decimals = 2): number {
  const num = toFiniteNumber(value, 0)
  const factor = 10 ** decimals
  const scaled = num * factor
  const epsilon = 1e-9
  const rounded = num >= 0 ? Math.ceil(scaled - epsilon) / factor : Math.floor(scaled + epsilon) / factor
  if (Object.is(rounded, -0)) return 0
  return rounded
}

function money(value: unknown, fallback = 0): number {
  return roundUpToDecimals(toFiniteNumber(value, fallback), 2)
}

function normText(value: unknown): string {
  return String(value ?? '').trim()
}

function lowerKey(value: unknown): string {
  return normText(value).toLowerCase()
}

export function normalizePromotionRule(row: Record<string, unknown> | null | undefined): PromotionRule | null {
  if (!row) return null
  const id = Number(row.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const ruleType = RULE_TYPES.has(String(row.rule_type)) ? String(row.rule_type) as PromotionRuleType : 'percent_off'
  const scopeType = SCOPE_TYPES.has(String(row.scope_type)) ? String(row.scope_type) as PromotionScopeType : 'products'
  let productIds: number[] = []
  const rawIds = row.product_ids
  const parsed = Array.isArray(rawIds)
    ? rawIds
    : (() => { try { return JSON.parse(String(rawIds || '[]')) } catch { return [] } })()
  if (Array.isArray(parsed)) {
    const seen = new Set<number>()
    for (const entry of parsed) {
      const pid = Number(entry)
      if (Number.isFinite(pid) && pid > 0 && !seen.has(pid)) { seen.add(pid); productIds.push(pid) }
    }
  }
  return {
    id,
    title: normText(row.title).slice(0, 120),
    show_title: !(row.show_title === 0 || row.show_title === false),
    rule_type: ruleType,
    min_quantity: Math.max(0, toFiniteNumber(row.min_quantity, 0)),
    save_usd: money(row.save_usd, 0),
    save_khr: Math.max(0, toFiniteNumber(row.save_khr, 0)),
    percent_off: Math.min(100, Math.max(0, toFiniteNumber(row.percent_off, 0))),
    scope_type: scopeType,
    product_ids: productIds,
    category: normText(row.category),
    brand: normText(row.brand),
    badge_color: /^#[0-9a-fA-F]{6}$/.test(normText(row.badge_color)) ? normText(row.badge_color).toLowerCase() : DEFAULT_BADGE_COLOR,
    starts_at: normText(row.starts_at) || null,
    ends_at: normText(row.ends_at) || null,
    is_active: !(row.is_active === 0 || row.is_active === false),
  }
}

// Window semantics MATCH isProductDiscountActive (utils/pricing.ts): a
// date-only bound parses as UTC midnight, so an end date expires at the
// START of that day -- the pre-existing per-product rule, kept identical
// on purpose rather than introducing a second calendar convention.
function windowOpen(startsAt: string | null, endsAt: string | null, nowMs: number): boolean {
  if (startsAt) {
    const t = new Date(startsAt).getTime()
    if (!Number.isNaN(t) && t > nowMs) return false
  }
  if (endsAt) {
    const t = new Date(endsAt).getTime()
    if (!Number.isNaN(t) && t < nowMs) return false
  }
  return true
}

function nowMsOf(now: Date | string | number): number {
  return now instanceof Date ? now.getTime() : new Date(now).getTime()
}

export function isRuleActive(rule: PromotionRule | null | undefined, now: Date | string | number = new Date()): boolean {
  if (!rule || !rule.is_active) return false
  if (rule.rule_type === 'percent_off' && rule.percent_off <= 0) return false
  if (rule.rule_type === 'fixed_off' && rule.save_usd <= 0 && rule.save_khr <= 0) return false
  if (rule.rule_type === 'quantity_save' && (rule.min_quantity < 1 || (rule.save_usd <= 0 && rule.save_khr <= 0))) return false
  if (rule.scope_type === 'products' && rule.product_ids.length === 0) return false
  if (rule.scope_type === 'category' && !rule.category) return false
  if (rule.scope_type === 'brand' && !rule.brand) return false
  return windowOpen(rule.starts_at, rule.ends_at, nowMsOf(now))
}

// Multi-value category/brand membership, matching the server facet rule
// (migrations/0033): the product's primary `category`/`brand` counts, and
// so does membership in the `||`-delimited `categories`/`brands` string.
function fieldMatches(product: ProductLike, field: 'category' | 'brand', wanted: string): boolean {
  const target = lowerKey(wanted)
  if (!target) return false
  if (lowerKey(product?.[field]) === target) return true
  const multi = lowerKey(product?.[field === 'category' ? 'categories' : 'brands'])
  if (!multi) return false
  return multi.split('||').some((part) => part.trim() === target)
}

export function ruleAppliesToProduct(rule: PromotionRule | null | undefined, product: ProductLike | null | undefined): boolean {
  if (!rule || !product) return false
  if (rule.scope_type === 'products') return rule.product_ids.includes(Number(product.id))
  if (rule.scope_type === 'category') return fieldMatches(product, 'category', rule.category)
  return fieldMatches(product, 'brand', rule.brand)
}

export function activeRulesForProduct(
  product: ProductLike | null | undefined,
  rules: readonly PromotionRule[] = [],
  now: Date | string | number = new Date(),
): PromotionRule[] {
  if (!product) return []
  return rules.filter((rule) => isRuleActive(rule, now) && ruleAppliesToProduct(rule, product))
}

// ---------------------------------------------------------------------------
// Per-product discount (pre-G1 path), re-stated here so the kernel can pick
// the BEST single benefit. Same semantics as pricing.ts.

function productDiscountActive(product: ProductLike, nowMs: number): boolean {
  if (!product?.discount_enabled) return false
  const type = lowerKey(product.discount_type) === 'fixed' ? 'fixed' : 'percent'
  if (type === 'percent' && toFiniteNumber(product.discount_percent) <= 0) return false
  if (type === 'fixed' && money(product.discount_amount_usd) <= 0 && money(product.discount_amount_khr) <= 0) return false
  return windowOpen(normText(product.discount_starts_at) || null, normText(product.discount_ends_at) || null, nowMs)
}

export interface PromotionEvaluation {
  active: boolean
  // 'rule' = a promotion_rules row won; 'product_discount' = the product's
  // own discount fields won; null = nothing applies (full price).
  source: 'rule' | 'product_discount' | null
  rule_id: number | null
  title: string
  show_title: boolean
  badge_color: string
  rule_type: PromotionRuleType | 'product_discount' | null
  percent_off: number
  // Per-unit money at the given quantity (quantity_save spreads its line
  // saving across the units so per_unit x qty === line total, cent-safe
  // via the line_* fields which are authoritative).
  unit_price_usd: number
  unit_price_khr: number
  line_total_usd: number
  line_total_khr: number
  line_discount_usd: number
  line_discount_khr: number
}

function evaluationOf(
  product: ProductLike,
  quantity: number,
  exchangeRate: number,
): { sellingUsd: number; sellingKhr: number; qty: number } {
  const sellingUsd = money(product?.selling_price_usd)
  const sellingKhr = money(product?.selling_price_khr || sellingUsd * (toFiniteNumber(exchangeRate, 0) || 4100))
  const qty = Math.max(1, toFiniteNumber(quantity, 1))
  return { sellingUsd, sellingKhr, qty }
}

function noPromotion(product: ProductLike, quantity: number, exchangeRate: number): PromotionEvaluation {
  const { sellingUsd, sellingKhr, qty } = evaluationOf(product, quantity, exchangeRate)
  return {
    active: false, source: null, rule_id: null, title: '', show_title: false,
    badge_color: DEFAULT_BADGE_COLOR, rule_type: null, percent_off: 0,
    unit_price_usd: sellingUsd, unit_price_khr: sellingKhr,
    line_total_usd: money(sellingUsd * qty), line_total_khr: money(sellingKhr * qty),
    line_discount_usd: 0, line_discount_khr: 0,
  }
}

// The heart of G1: evaluate EVERY applicable benefit (the product's own
// discount + every active rule that reaches this product at this quantity)
// and apply the single BEST one -- never stacked. "Best" = largest line
// discount in USD, KHR breaking ties (covers KHR-only amounts).
export function evaluatePromotionPricing(
  product: ProductLike | null | undefined,
  quantity: number,
  rules: readonly PromotionRule[] = [],
  exchangeRate = 4100,
  now: Date | string | number = new Date(),
): PromotionEvaluation {
  if (!product) return noPromotion({}, quantity, exchangeRate)
  const { sellingUsd, sellingKhr, qty } = evaluationOf(product, quantity, exchangeRate)
  const nowMs = nowMsOf(now)

  type Candidate = {
    source: 'rule' | 'product_discount'
    rule: PromotionRule | null
    lineDiscountUsd: number
    lineDiscountKhr: number
    percentOff: number
  }
  const candidates: Candidate[] = []

  if (productDiscountActive(product, nowMs)) {
    const type = lowerKey(product.discount_type) === 'fixed' ? 'fixed' : 'percent'
    let perUnitUsd = 0
    let perUnitKhr = 0
    let pct = 0
    if (type === 'percent') {
      pct = Math.min(100, Math.max(0, toFiniteNumber(product.discount_percent)))
      perUnitUsd = money(sellingUsd * (pct / 100))
      perUnitKhr = money(sellingKhr * (pct / 100))
    } else {
      perUnitUsd = Math.min(money(product.discount_amount_usd), sellingUsd)
      perUnitKhr = Math.min(money(product.discount_amount_khr || perUnitUsd * (toFiniteNumber(exchangeRate, 0) || 4100)), sellingKhr)
      pct = sellingUsd > 0 ? Math.round((perUnitUsd / sellingUsd) * 100) : 0
    }
    candidates.push({
      source: 'product_discount', rule: null,
      lineDiscountUsd: money(perUnitUsd * qty), lineDiscountKhr: money(perUnitKhr * qty),
      percentOff: pct,
    })
  }

  for (const rule of rules) {
    if (!isRuleActive(rule, nowMs) || !ruleAppliesToProduct(rule, product)) continue
    if (rule.rule_type === 'percent_off') {
      const perUnitUsd = money(sellingUsd * (rule.percent_off / 100))
      const perUnitKhr = money(sellingKhr * (rule.percent_off / 100))
      candidates.push({ source: 'rule', rule, lineDiscountUsd: money(perUnitUsd * qty), lineDiscountKhr: money(perUnitKhr * qty), percentOff: rule.percent_off })
    } else if (rule.rule_type === 'fixed_off') {
      const perUnitUsd = Math.min(rule.save_usd, sellingUsd)
      const perUnitKhr = Math.min(rule.save_khr || money(rule.save_usd * (toFiniteNumber(exchangeRate, 0) || 4100)), sellingKhr)
      candidates.push({
        source: 'rule', rule,
        lineDiscountUsd: money(perUnitUsd * qty), lineDiscountKhr: money(perUnitKhr * qty),
        percentOff: sellingUsd > 0 ? Math.round((perUnitUsd / sellingUsd) * 100) : 0,
      })
    } else if (rule.rule_type === 'quantity_save' && qty >= rule.min_quantity) {
      const lineUsd = Math.min(rule.save_usd, money(sellingUsd * qty))
      const lineKhr = Math.min(rule.save_khr || money(rule.save_usd * (toFiniteNumber(exchangeRate, 0) || 4100)), money(sellingKhr * qty))
      const lineTotal = sellingUsd * qty
      candidates.push({
        source: 'rule', rule,
        lineDiscountUsd: money(lineUsd), lineDiscountKhr: money(lineKhr),
        percentOff: lineTotal > 0 ? Math.round((lineUsd / lineTotal) * 100) : 0,
      })
    }
  }

  if (!candidates.length) return noPromotion(product, quantity, exchangeRate)

  let best = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (
      candidate.lineDiscountUsd > best.lineDiscountUsd
      || (candidate.lineDiscountUsd === best.lineDiscountUsd && candidate.lineDiscountKhr > best.lineDiscountKhr)
    ) best = candidate
  }
  if (best.lineDiscountUsd <= 0 && best.lineDiscountKhr <= 0) return noPromotion(product, quantity, exchangeRate)

  const grossUsd = money(sellingUsd * qty)
  const grossKhr = money(sellingKhr * qty)
  const lineDiscountUsd = Math.min(best.lineDiscountUsd, grossUsd)
  const lineDiscountKhr = Math.min(best.lineDiscountKhr, grossKhr)
  const lineTotalUsd = money(Math.max(0, grossUsd - lineDiscountUsd))
  const lineTotalKhr = money(Math.max(0, grossKhr - lineDiscountKhr))
  return {
    active: true,
    source: best.source,
    rule_id: best.rule ? best.rule.id : null,
    title: best.rule ? best.rule.title : normText(product.discount_label),
    show_title: best.rule ? best.rule.show_title : Boolean(normText(product.discount_label)),
    badge_color: best.rule ? best.rule.badge_color : (normText(product.discount_badge_color) || DEFAULT_BADGE_COLOR),
    rule_type: best.rule ? best.rule.rule_type : 'product_discount',
    percent_off: Math.max(0, best.percentOff),
    // Per-unit derived FROM the line totals (line values are authoritative
    // so per_unit x qty can't leak cents past them).
    unit_price_usd: money(lineTotalUsd / qty),
    unit_price_khr: money(lineTotalKhr / qty),
    line_total_usd: lineTotalUsd,
    line_total_khr: lineTotalKhr,
    line_discount_usd: lineDiscountUsd,
    line_discount_khr: lineDiscountKhr,
  }
}

export interface PromotionBadge {
  active: boolean
  // 'price' badges change the displayed price at quantity 1;
  // 'quantity_hint' advertises a buy-more rule without cutting the qty-1
  // price (e.g. "Buy 3+ Save $5").
  kind: 'price' | 'quantity_hint' | null
  title: string
  show_title: boolean
  badge_color: string
  percent_off: number
  min_quantity: number
  save_usd: number
  save_khr: number
}

// What a product GRID (Products page, POS grid, portal card) shows before
// any quantity is chosen: the qty-1 evaluation for price-cutting benefits,
// plus the best not-yet-earned quantity rule as an advertisement -- a
// "buy >= 3" deal must be visible on the card, not a checkout surprise.
export function promotionBadgeForProduct(
  product: ProductLike | null | undefined,
  rules: readonly PromotionRule[] = [],
  now: Date | string | number = new Date(),
): PromotionBadge {
  const none: PromotionBadge = {
    active: false, kind: null, title: '', show_title: false,
    badge_color: DEFAULT_BADGE_COLOR, percent_off: 0, min_quantity: 0, save_usd: 0, save_khr: 0,
  }
  if (!product) return none
  const atOne = evaluatePromotionPricing(product, 1, rules, 4100, now)
  if (atOne.active) {
    return {
      active: true, kind: 'price', title: atOne.title, show_title: atOne.show_title,
      badge_color: atOne.badge_color, percent_off: atOne.percent_off,
      min_quantity: 0, save_usd: atOne.line_discount_usd, save_khr: atOne.line_discount_khr,
    }
  }
  let hint: PromotionRule | null = null
  for (const rule of rules) {
    if (rule.rule_type !== 'quantity_save') continue
    if (!isRuleActive(rule, now) || !ruleAppliesToProduct(rule, product)) continue
    if (!hint || rule.save_usd > hint.save_usd || (rule.save_usd === hint.save_usd && rule.save_khr > hint.save_khr)) hint = rule
  }
  if (!hint) return none
  return {
    active: true, kind: 'quantity_hint', title: hint.title, show_title: hint.show_title,
    badge_color: hint.badge_color, percent_off: 0,
    min_quantity: hint.min_quantity, save_usd: hint.save_usd, save_khr: hint.save_khr,
  }
}

export function isProductPromoted(
  product: ProductLike | null | undefined,
  rules: readonly PromotionRule[] = [],
  now: Date | string | number = new Date(),
): boolean {
  return promotionBadgeForProduct(product, rules, now).active
}

// Stable promoted-first partition for client-sorted surfaces (the portal
// grid); server-sorted surfaces (Products/POS via /api/products/search)
// get the same rule from the query's family ordering instead.
export function partitionPromotedFirst<T extends ProductLike>(
  products: readonly T[] = [],
  rules: readonly PromotionRule[] = [],
  now: Date | string | number = new Date(),
): T[] {
  const promoted: T[] = []
  const rest: T[] = []
  for (const product of products) {
    (isProductPromoted(product, rules, now) ? promoted : rest).push(product)
  }
  return [...promoted, ...rest]
}
