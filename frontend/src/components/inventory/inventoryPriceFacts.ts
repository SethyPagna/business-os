// The price details an Inventory row shows (owner, 11 Nov): selling, wholesale and the promotion price, taken from the fields the Products row already carries.
// Nothing is read for them. Cost rides the same way: the Worker puts the cost keys on a row only for a viewer who may see cost (owner, 17 Nov), and the page draws them only for that viewer too.
import { evaluatePromotionPricing, type PromotionRule } from '../../utils/promotionRules.ts'
import { knownCost } from '../../utils/costDisplay.ts'

/** The Products row keys that make a price; the server cuts all of them without the Inventory price grant. */
export const PRICE_KEYS = ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'discount_enabled', 'discount_type', 'discount_percent',
  'discount_amount_usd', 'discount_amount_khr', 'discount_label', 'discount_badge_color', 'discount_starts_at', 'discount_ends_at'] as const

/** The Products row keys that make a cost; the Worker sends them only to a viewer who may see cost (cloudflare/src/lib/inventoryCheckList.ts COST_KEYS). */
export const COST_KEYS = ['cost_price_usd', 'cost_price_khr', 'cost_needs_review', 'purchase_price_usd', 'purchase_price_khr', 'cost_review_key'] as const

export type PriceMoney = { usd: number; khr: number | null }
export type PriceFacts = { selling: PriceMoney | null; wholesale: PriceMoney | null; promotion: PriceMoney | null }

const amount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Selling and wholesale as stored, and the promotion price only while the POS evaluator says one applies to one unit right now. */
export function priceFacts(product: Record<string, unknown>, rules: readonly PromotionRule[] | undefined, exchangeRate: number, now: Date | number = new Date()): PriceFacts {
  const sellingUsd = amount(product.selling_price_usd)
  if (sellingUsd === null) return { selling: null, wholesale: null, promotion: null }
  const sellingKhr = amount(product.selling_price_khr)
  const wholesaleUsd = amount(product.wholesale_price_usd), wholesaleKhr = amount(product.wholesale_price_khr)
  const evaluation = evaluatePromotionPricing(product, 1, rules ?? [], exchangeRate, now)
  return {
    selling: { usd: sellingUsd, khr: sellingKhr && sellingKhr > 0 ? sellingKhr : null },
    wholesale: (wholesaleUsd ?? 0) > 0 || (wholesaleKhr ?? 0) > 0 ? { usd: wholesaleUsd ?? 0, khr: wholesaleKhr && wholesaleKhr > 0 ? wholesaleKhr : null } : null,
    promotion: evaluation.active && evaluation.unit_price_usd < sellingUsd ? { usd: evaluation.unit_price_usd, khr: evaluation.unit_price_khr } : null,
  }
}

export type CostFact = { usd: number | null; khr: number | null; needsReview: boolean }

/** The row's cost, or null when the row carries no cost key at all (not sent to this viewer: nothing to draw, not even "unknown"). The catalogue cost column decides known vs unknown; the purchase mirror only stands in when it is absent. */
export function costFact(product: Record<string, unknown>): CostFact | null {
  if (!COST_KEYS.some(key => Object.hasOwn(product, key))) return null
  const pick = (currency: 'usd' | 'khr') => knownCost(product[`cost_price_${currency}`] !== undefined ? product[`cost_price_${currency}`] : product[`purchase_price_${currency}`])
  const khr = pick('khr')
  return { usd: pick('usd'), khr: khr && khr > 0 ? khr : null, needsReview: product.cost_needs_review === true || product.cost_needs_review === 1 }
}
