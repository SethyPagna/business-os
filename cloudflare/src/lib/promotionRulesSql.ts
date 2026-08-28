// Backend-only SQL companion to lib/promotionRules.ts (the shared kernel):
// turns the ACTIVE rule set into a WHERE-able "this product is promoted"
// condition so /api/products/search can rank promoted families first and
// answer the promoted/discounted/by-rule filters SERVER-side -- ordering
// has to live in SQL because the Products page and POS page through
// results (a client-side sort can only reorder the page it was given).
//
// Which rules are "active" is decided in JS by the kernel's isRuleActive
// (single source of truth for windows/benefits); SQL only expresses the
// SCOPE match (ids / category / brand, primary or multi-value column) and
// the per-product discount condition, which must mirror the kernel's
// productDiscountActive. Date comparison note: the discount window columns
// hold either date-only or datetime strings; datetime(col) normalizes both
// for comparison against @promoNow (UTC "now"), matching the kernel's
// UTC-midnight reading of date-only bounds.

import { normalizePromotionRule, isRuleActive, type PromotionRule } from './promotionRules'
import type { D1Compat } from './db'

export async function loadActivePromotionRules(db: D1Compat, now: Date = new Date()): Promise<PromotionRule[]> {
  const rows = await db.prepare(`
    SELECT * FROM promotion_rules WHERE is_active = 1 ORDER BY id ASC
  `).all<Record<string, unknown>>()
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePromotionRule(row))
    .filter((rule): rule is PromotionRule => Boolean(rule && isRuleActive(rule, now)))
}

// The per-product discount half of "promoted", as SQL. Mirrors the
// kernel's productDiscountActive: enabled + a real benefit for its type +
// an open window.
export function productDiscountActiveSql(params: Record<string, unknown>, now: Date = new Date()): string {
  params.promoNow = now.toISOString().replace('T', ' ').slice(0, 19)
  return `(
    p.discount_enabled = 1
    AND (
      (lower(COALESCE(p.discount_type, 'percent')) <> 'fixed' AND COALESCE(p.discount_percent, 0) > 0)
      OR (lower(COALESCE(p.discount_type, 'percent')) = 'fixed' AND (COALESCE(p.discount_amount_usd, 0) > 0 OR COALESCE(p.discount_amount_khr, 0) > 0))
    )
    AND (COALESCE(trim(p.discount_starts_at), '') = '' OR datetime(p.discount_starts_at) <= datetime(@promoNow))
    AND (COALESCE(trim(p.discount_ends_at), '') = '' OR datetime(p.discount_ends_at) >= datetime(@promoNow))
  )`
}

// Scope condition for ONE already-active rule. Multi-value category/brand
// membership matches the facet filters' rule (0033 columns, with the
// primary column as fallback).
function ruleScopeSql(rule: PromotionRule, index: number, params: Record<string, unknown>): string | null {
  if (rule.scope_type === 'products') {
    if (!rule.product_ids.length) return null
    // Inlined ints, not bind params: D1 binds are capped at 100 per
    // statement and the search query already spends many; ids are
    // validated positive integers so inlining is injection-safe.
    return `p.id IN (${rule.product_ids.map((id) => Math.trunc(id)).join(',')})`
  }
  const field = rule.scope_type === 'category' ? 'category' : 'brand'
  const multiCol = field === 'category' ? 'categories' : 'brands'
  const key = `promoRule${index}`
  const value = (field === 'category' ? rule.category : rule.brand).toLowerCase()
  if (!value) return null
  params[key] = value
  params[`${key}esc`] = value.replace(/[%_]/g, (m) => `\\${m}`)
  return `(lower(trim(COALESCE(p.${field}, ''))) = @${key} OR ('||' || lower(COALESCE(p.${multiCol}, p.${field}, '')) || '||') LIKE '%||' || @${key}esc || '||%' ESCAPE '\\')`
}

export function anyRuleAppliesSql(rules: readonly PromotionRule[], params: Record<string, unknown>): string {
  const clauses = rules
    .map((rule, index) => ruleScopeSql(rule, index, params))
    .filter((clause): clause is string => Boolean(clause))
  if (!clauses.length) return '0'
  return `(${clauses.join(' OR ')})`
}

export function singleRuleAppliesSql(rules: readonly PromotionRule[], ruleId: number, params: Record<string, unknown>): string {
  const rule = rules.find((entry) => entry.id === ruleId)
  if (!rule) return '0'
  return ruleScopeSql(rule, 9000 + rule.id, params) || '0'
}

// "Promoted" = the product's own discount is live OR any active rule
// reaches it -- the exact condition the kernel's isProductPromoted answers
// per product, expressed once for ORDER BY / WHERE use.
export function productPromotedSql(rules: readonly PromotionRule[], params: Record<string, unknown>, now: Date = new Date()): string {
  const discount = productDiscountActiveSql(params, now)
  const ruleSql = anyRuleAppliesSql(rules, params)
  return `(${discount} OR ${ruleSql})`
}
