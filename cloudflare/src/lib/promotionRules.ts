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

export type PromotionRuleType =
  | 'quantity_save'    // buy >= X items, save $Y off the line
  | 'percent_off'      // Z% off qualifying products
  | 'fixed_off'        // $Y off each qualifying unit
  | 'spend_save'       // spend >= $X on a qualifying line, save $Y
  | 'quantity_percent' // buy >= X items, get Z% off the line
  | 'next_item'        // buy X items, the NEXT one is Z%/$Y off -- the
                       // CHEAPEST item of each complete group takes the
                       // cut ("only lowest of the two"), repeating per
                       // group, evaluated cart-wide across the scope
export type PromotionScopeType = 'products' | 'category' | 'brand'
// Wording family for AUTO-generated titles (a typed title overrides):
// 'save' -> "Buy 3+ Save $5" | 'get' -> "Buy 3+ Get $5 Off" | 'free' ->
// "Buy 1 Get 1 Free" when the math genuinely makes the item free.
export type PromotionLabelStyle = 'save' | 'get' | 'free'

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
  min_spend_usd: number
  min_spend_khr: number
  label_style: PromotionLabelStyle
  product_ids: number[]
  category: string
  brand: string
  badge_color: string
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
}

type ProductLike = Record<string, unknown>

const RULE_TYPES = new Set<string>(['quantity_save', 'percent_off', 'fixed_off', 'spend_save', 'quantity_percent', 'next_item'])
const LABEL_STYLES = new Set<string>(['save', 'get', 'free'])
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
    min_spend_usd: money(row.min_spend_usd, 0),
    min_spend_khr: Math.max(0, toFiniteNumber(row.min_spend_khr, 0)),
    label_style: LABEL_STYLES.has(String(row.label_style)) ? String(row.label_style) as PromotionLabelStyle : 'save',
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
  if (rule.rule_type === 'spend_save' && ((rule.min_spend_usd <= 0 && rule.min_spend_khr <= 0) || (rule.save_usd <= 0 && rule.save_khr <= 0))) return false
  if (rule.rule_type === 'quantity_percent' && (rule.min_quantity < 1 || rule.percent_off <= 0)) return false
  if (rule.rule_type === 'next_item' && (rule.min_quantity < 1 || (rule.percent_off <= 0 && rule.save_usd <= 0 && rule.save_khr <= 0))) return false
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
    } else if (rule.rule_type === 'spend_save') {
      // Spend threshold: the USD threshold decides when set; otherwise the
      // KHR one. Benefit is a flat line saving, clamped at the line gross.
      const grossUsd = money(sellingUsd * qty)
      const grossKhr = money(sellingKhr * qty)
      const crossed = rule.min_spend_usd > 0 ? grossUsd >= rule.min_spend_usd : grossKhr >= rule.min_spend_khr
      if (crossed) {
        const lineUsd = Math.min(rule.save_usd, grossUsd)
        const lineKhr = Math.min(rule.save_khr || money(rule.save_usd * (toFiniteNumber(exchangeRate, 0) || 4100)), grossKhr)
        candidates.push({
          source: 'rule', rule,
          lineDiscountUsd: money(lineUsd), lineDiscountKhr: money(lineKhr),
          percentOff: grossUsd > 0 ? Math.round((lineUsd / grossUsd) * 100) : 0,
        })
      }
    } else if (rule.rule_type === 'quantity_percent' && qty >= rule.min_quantity) {
      const perUnitUsd = money(sellingUsd * (rule.percent_off / 100))
      const perUnitKhr = money(sellingKhr * (rule.percent_off / 100))
      candidates.push({ source: 'rule', rule, lineDiscountUsd: money(perUnitUsd * qty), lineDiscountKhr: money(perUnitKhr * qty), percentOff: rule.percent_off })
    } else if (rule.rule_type === 'next_item') {
      // Per-LINE evaluation of "buy N get the next one off": every
      // complete group of (N+1) units on THIS line discounts one unit --
      // same-product units share one price, so the cheapest-of-the-group
      // rule is trivially satisfied here. CROSS-line pairing (different
      // products in the rule's scope; the cheapest of each mixed group
      // takes the cut) lives in evaluateCartPromotionAdjustments below --
      // POS uses that; this per-line half keeps single-line carts, the
      // portal and grids correct on their own.
      const groupSize = rule.min_quantity + 1
      const groups = Math.floor(qty / groupSize)
      if (groups > 0) {
        const perHitUsd = rule.percent_off > 0 ? money(sellingUsd * (rule.percent_off / 100)) : Math.min(rule.save_usd, sellingUsd)
        const perHitKhr = rule.percent_off > 0
          ? money(sellingKhr * (rule.percent_off / 100))
          : Math.min(rule.save_khr || money(rule.save_usd * (toFiniteNumber(exchangeRate, 0) || 4100)), sellingKhr)
        const lineTotal = sellingUsd * qty
        candidates.push({
          source: 'rule', rule,
          lineDiscountUsd: money(perHitUsd * groups), lineDiscountKhr: money(perHitKhr * groups),
          percentOff: lineTotal > 0 ? Math.round(((perHitUsd * groups) / lineTotal) * 100) : 0,
        })
      }
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

// Money text for auto-labels: USD amount when set, else KHR.
function amountText(usd: number, khr: number): string {
  if (usd > 0) return '$' + String(usd)
  return '\u17DB' + String(khr)
}

// AUTO-generated title for a rule, in the operator's chosen wording style
// ('save' / 'get' / 'free' -- "basically same meaning just different
// wording styles"). A typed title always overrides (see ruleLabel);
// 'free' falls back to 'get' phrasing when the math isn't a genuine
// 100% freebie.
export function promotionAutoLabel(rule: PromotionRule | null | undefined): string {
  if (!rule) return ''
  const style = rule.label_style
  const amount = amountText(rule.save_usd, rule.save_khr)
  const pct = rule.percent_off
  switch (rule.rule_type) {
    case 'percent_off':
      return style === 'save' ? 'Save ' + pct + '%' : pct + '% Off'
    case 'fixed_off':
      return style === 'save' ? 'Save ' + amount : amount + ' Off'
    case 'quantity_save':
      return style === 'save'
        ? 'Buy ' + rule.min_quantity + '+ Save ' + amount
        : 'Buy ' + rule.min_quantity + '+ Get ' + amount + ' Off'
    case 'spend_save': {
      const threshold = amountText(rule.min_spend_usd, rule.min_spend_khr)
      return style === 'save'
        ? 'Spend ' + threshold + ' Save ' + amount
        : 'Spend ' + threshold + ' Get ' + amount + ' Off'
    }
    case 'quantity_percent':
      return style === 'save'
        ? 'Buy ' + rule.min_quantity + '+ Save ' + pct + '%'
        : 'Buy ' + rule.min_quantity + '+ Get ' + pct + '% Off'
    case 'next_item': {
      if (style === 'free' && pct >= 100) return 'Buy ' + rule.min_quantity + ' Get 1 Free'
      const benefit = pct > 0 ? pct + '% Off' : amount + ' Off'
      return style === 'save'
        ? 'Buy ' + rule.min_quantity + ' Save ' + (pct > 0 ? pct + '%' : amount) + ' On Next'
        : 'Buy ' + rule.min_quantity + ' Get Next ' + benefit
    }
    default:
      return ''
  }
}

// Display text for a winning rule: the typed Title when shown, the
// auto-label otherwise -- and nothing at all when the operator hid the
// title (the price cut itself still shows wherever prices render).
function ruleLabel(rule: PromotionRule): string {
  if (!rule.show_title) return ''
  return rule.title || promotionAutoLabel(rule)
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
  // Display-ready text: the typed Title when shown, else the style-worded
  // auto-label; '' when the operator hid the title (or the winning benefit
  // is the product's own discount with no label).
  label: string
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
    badge_color: DEFAULT_BADGE_COLOR, percent_off: 0, min_quantity: 0, save_usd: 0, save_khr: 0, label: '',
  }
  if (!product) return none
  const atOne = evaluatePromotionPricing(product, 1, rules, 4100, now)
  if (atOne.active) {
    const winningRule = atOne.rule_id != null ? rules.find((rule) => rule.id === atOne.rule_id) || null : null
    return {
      active: true, kind: 'price', title: atOne.title, show_title: atOne.show_title,
      badge_color: atOne.badge_color, percent_off: atOne.percent_off,
      min_quantity: 0, save_usd: atOne.line_discount_usd, save_khr: atOne.line_discount_khr,
      label: winningRule ? ruleLabel(winningRule) : (atOne.show_title ? atOne.title : ''),
    }
  }
  // Not-yet-earned deals advertise as hints -- every threshold type, not
  // just quantity_save: a spend threshold, a buy-X-percent deal and a
  // buy-N-get-next deal must all be visible on the card, not a checkout
  // surprise. Best hint = biggest save amount, then biggest percent.
  let hint: PromotionRule | null = null
  for (const rule of rules) {
    if (rule.rule_type !== 'quantity_save' && rule.rule_type !== 'quantity_percent' && rule.rule_type !== 'next_item' && rule.rule_type !== 'spend_save') continue
    if (!isRuleActive(rule, now) || !ruleAppliesToProduct(rule, product)) continue
    if (
      !hint
      || rule.save_usd > hint.save_usd
      || (rule.save_usd === hint.save_usd && rule.percent_off > hint.percent_off)
      || (rule.save_usd === hint.save_usd && rule.percent_off === hint.percent_off && rule.save_khr > hint.save_khr)
    ) hint = rule
  }
  if (!hint) return none
  return {
    active: true, kind: 'quantity_hint', title: hint.title, show_title: hint.show_title,
    badge_color: hint.badge_color, percent_off: hint.percent_off,
    min_quantity: hint.min_quantity, save_usd: hint.save_usd, save_khr: hint.save_khr,
    label: ruleLabel(hint),
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

// ---------------------------------------------------------------------------
// Cart-level evaluation (POS). Per-line rules evaluate line-by-line;
// next_item rules pair units ACROSS every line their scope reaches:
// units sort by price DESC, each complete group of (min_quantity+1)
// units discounts its CHEAPEST unit ("only lowest of the two gets the
// discount" -- user rule), repeating per group. Each line then takes its
// single best benefit -- its per-line winner or its share of a next_item
// pairing -- never stacked.

export interface PromotionCartLine {
  line_id: string
  product: ProductLike
  quantity: number
}

export interface CartLineAdjustment {
  line_id: string
  active: boolean
  rule_id: number | null
  rule_type: PromotionRuleType | 'product_discount' | null
  label: string
  badge_color: string
  unit_price_usd: number
  unit_price_khr: number
  line_discount_usd: number
  line_discount_khr: number
}

function nextItemAllocations(
  lines: readonly PromotionCartLine[],
  rule: PromotionRule,
  exchangeRate: number,
): Map<string, { usd: number; khr: number }> {
  const out = new Map<string, { usd: number; khr: number }>()
  type Unit = { line_id: string; usd: number; khr: number }
  const units: Unit[] = []
  for (const line of lines) {
    if (!ruleAppliesToProduct(rule, line.product)) continue
    const unitUsd = money(line.product?.selling_price_usd)
    const unitKhr = money(line.product?.selling_price_khr || unitUsd * (toFiniteNumber(exchangeRate, 0) || 4100))
    const qty = Math.max(0, Math.floor(toFiniteNumber(line.quantity, 0)))
    for (let i = 0; i < qty; i++) units.push({ line_id: line.line_id, usd: unitUsd, khr: unitKhr })
  }
  const groupSize = rule.min_quantity + 1
  if (units.length < groupSize) return out
  // The user's "only lowest of the two gets the discount", read the
  // merchant-safe way the big carts read it too: the number of EARNED
  // hits is floor(units / (N+1)), and those hits land on the CHEAPEST
  // qualifying units overall -- the shopper pays full price for the
  // dearest items, never earns the cut on them.
  units.sort((a, b) => a.usd - b.usd || a.khr - b.khr)
  const hits = Math.floor(units.length / groupSize)
  for (let g = 0; g < hits; g++) {
    const cheapest = units[g]
    const cutUsd = rule.percent_off > 0 ? money(cheapest.usd * (rule.percent_off / 100)) : Math.min(rule.save_usd, cheapest.usd)
    const cutKhr = rule.percent_off > 0
      ? money(cheapest.khr * (rule.percent_off / 100))
      : Math.min(rule.save_khr || money(rule.save_usd * (toFiniteNumber(exchangeRate, 0) || 4100)), cheapest.khr)
    const bucket = out.get(cheapest.line_id) || { usd: 0, khr: 0 }
    bucket.usd = money(bucket.usd + cutUsd)
    bucket.khr = money(bucket.khr + cutKhr)
    out.set(cheapest.line_id, bucket)
  }
  return out
}

export function evaluateCartPromotionAdjustments(
  lines: readonly PromotionCartLine[] = [],
  rules: readonly PromotionRule[] = [],
  exchangeRate = 4100,
  now: Date | string | number = new Date(),
): Map<string, CartLineAdjustment> {
  const result = new Map<string, CartLineAdjustment>()
  const activeRules = rules.filter((rule) => isRuleActive(rule, now))
  const perLineRules = activeRules.filter((rule) => rule.rule_type !== 'next_item')
  const nextItemRules = activeRules.filter((rule) => rule.rule_type === 'next_item')
  const pairings = nextItemRules.map((rule) => ({ rule, allocation: nextItemAllocations(lines, rule, exchangeRate) }))

  for (const line of lines) {
    const qty = Math.max(1, toFiniteNumber(line.quantity, 1))
    const sellingUsd = money(line.product?.selling_price_usd)
    const sellingKhr = money(line.product?.selling_price_khr || sellingUsd * (toFiniteNumber(exchangeRate, 0) || 4100))
    const grossUsd = money(sellingUsd * qty)
    const grossKhr = money(sellingKhr * qty)

    const perLine = evaluatePromotionPricing(line.product, qty, perLineRules, exchangeRate, now)
    let best: { usd: number; khr: number; rule: PromotionRule | null; fromProductDiscount: boolean } = perLine.active
      ? {
          usd: perLine.line_discount_usd,
          khr: perLine.line_discount_khr,
          rule: perLine.rule_id != null ? perLineRules.find((rule) => rule.id === perLine.rule_id) || null : null,
          fromProductDiscount: perLine.source === 'product_discount',
        }
      : { usd: 0, khr: 0, rule: null, fromProductDiscount: false }
    for (const pairing of pairings) {
      const share = pairing.allocation.get(line.line_id)
      if (!share) continue
      if (share.usd > best.usd || (share.usd === best.usd && share.khr > best.khr)) {
        best = { usd: share.usd, khr: share.khr, rule: pairing.rule, fromProductDiscount: false }
      }
    }

    const lineDiscountUsd = Math.min(best.usd, grossUsd)
    const lineDiscountKhr = Math.min(best.khr, grossKhr)
    const active = lineDiscountUsd > 0 || lineDiscountKhr > 0
    result.set(line.line_id, {
      line_id: line.line_id,
      active,
      rule_id: best.rule ? best.rule.id : null,
      rule_type: !active ? null : best.rule ? best.rule.rule_type : (best.fromProductDiscount ? 'product_discount' : null),
      label: !active ? '' : best.rule ? ruleLabel(best.rule) : (perLine.show_title ? perLine.title : ''),
      badge_color: best.rule ? best.rule.badge_color : (active ? perLine.badge_color : DEFAULT_BADGE_COLOR),
      unit_price_usd: active ? money(Math.max(0, grossUsd - lineDiscountUsd) / qty) : sellingUsd,
      unit_price_khr: active ? money(Math.max(0, grossKhr - lineDiscountKhr) / qty) : sellingKhr,
      line_discount_usd: active ? lineDiscountUsd : 0,
      line_discount_khr: active ? lineDiscountKhr : 0,
    })
  }
  return result
}
