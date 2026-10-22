import type { D1Compat } from './db'
import { MoneyPrecisionError, sellingPriceCeilCent } from './moneyPrecision'
import { hasAnyPermission, type PermissionUser } from './permissions'
import { normalizePromotionRule } from './promotionRules'
import type { ReturnedSoldLine } from './returnsStock'
import { capturePricingProduct, evaluateCapturedPricingPool, SaleItemPricingError, type CapturedPricingPool } from './saleItemPricing'
import { selectInChunks } from './sqlBinding'

// What a return's replacement line may be priced at. A replacement is an ordinary sale line, so the price follows
// POST /api/sales: the server prices a line from the catalog, with the active promotions and the product's own
// discount (routes/sales.ts, evaluateCapturedPricingPool over source 'promotion'), and the only thing that lets a
// caller sell at any other price is the grant POST /api/sales itself asks for -- `pos` or `sales` (the till's per-sale
// price edit has no separate permission). A caller without that grant may therefore not sell a replacement under:
//   - for the units a returned unit of the same product covers (the straight swap, which the refund already pays at
//     the price on the sale being returned): the lowest of the catalog price, the promotion price and the price of the
//     sale line that unit was returned from. The covered units pair with their OWN recorded lines, highest recorded
//     price first, never with one pooled lowest price: a sale can carry a product on two lines at different prices
//     (2 at $5 and 1 at $0), and a unit paid at $5 is not a $0 unit;
//   - for every other unit, whether a further unit of the same product or any other product: the lowest of the
//     catalog price and the promotion price. That is a new purchase, priced like any POS sale.
// There is no cap on how many units a replacement may hand out (owner, 22 Oct 2026: a replacement may change and add
// both); only the price of the units beyond the returned ones is held. A price above the floor is never refused.
export const RETURN_REPLACEMENT_PRICE_REFUSAL = {
  error: 'You do not have permission to change the price of a replacement item. It is sold at the catalog price, its promotion price, or the price on the original sale.',
  code: 'return_replacement_price_forbidden',
} as const

/** Whoever may sell at a price of their own: the grant POST /api/sales asks for (routes/sales.ts, `pos` or `sales`). */
export function canSetSalePrice(user: PermissionUser): boolean {
  return hasAnyPermission(user, ['pos', 'sales'])
}

export type ReplacementPriceLine = {
  productId: number
  quantity: number
  /** What the till posted (the catalog price when it posted none). */
  priceUsd: number
  priceKhr: number
  catalogUsd: number
  catalogKhr: number
  /**
   * The units the return hands back of this product, one entry per line of the sale being returned that they come from, each
   * with that line's RECORDED unit price (recordedSoldLinesForReplacement: the sale line's own row, never a posted or refund
   * figure). Empty when the return hands back none of it. Every replacement line of one product carries the same list.
   */
  returned: readonly ReturnedSoldLine[]
}

type Leg = 'usd' | 'khr'
type Entry = { line: ReplacementPriceLine; index: number; promo: { usd: number; khr: number } | null }
const LEGS: readonly Leg[] = ['usd', 'khr']

// Money is kept to four places, so a price within half a place of the floor is the floor. Plain numbers, never a throw on odd input.
const TOLERANCE_PER_UNIT = 0.00005
// Quantities may be decimals, so a remainder this small is no unit at all.
const UNIT_EPSILON = 1e-9
const lowest = (...values: Array<number | null>): number => Math.min(...values.filter((value): value is number => value != null))
const postedPrice = (line: ReplacementPriceLine, leg: Leg): number => leg === 'usd' ? line.priceUsd : line.priceKhr
const catalogPrice = (line: ReplacementPriceLine, leg: Leg): number => leg === 'usd' ? line.catalogUsd : line.catalogKhr

// The returned lines in the order their units cover a replacement: the highest recorded price first (dollars, then riel),
// so the units that were paid the most are the ones a replacement is held to. The screen plans in this same order
// (frontend planReplacementParts), which is what keeps its defaults acceptable here. A line with no price recorded sorts last.
const rank = (value: number | null): number => value ?? -Infinity
const highestRecordedFirst = (a: ReturnedSoldLine, b: ReturnedSoldLine): number =>
  rank(a.usd) === rank(b.usd) ? (rank(a.khr) === rank(b.khr) ? 0 : rank(b.khr) > rank(a.khr) ? 1 : -1) : rank(b.usd) > rank(a.usd) ? 1 : -1

/** The returned units that can cover a replacement in one currency, highest recorded price first. A line with no price in this currency covers nothing in it. */
function coveringUnits(returned: readonly ReturnedSoldLine[], leg: Leg): Array<{ quantity: number; price: number }> {
  return [...returned].sort(highestRecordedFirst)
    .flatMap((line) => {
      const price = leg === 'usd' ? line.usd : line.khr
      return price != null && line.quantity > UNIT_EPSILON ? [{ quantity: line.quantity, price }] : []
    })
}

/**
 * The lowest total the lines of ONE product may sell for. Its units are taken highest base price first and each is covered
 * by the next returned unit, highest recorded price first, so a covered unit is floored at the lower of its base price and
 * the price of the line it was returned from; every unit past the returned ones is floored at its base price. Units are
 * ranked, not lines, so neither the order of the lines nor splitting one line in two can change the verdict.
 */
function floorTotal(lines: ReadonlyArray<{ quantity: number; base: number }>, covering: ReadonlyArray<{ quantity: number; price: number }>): number {
  let at = 0
  let left = covering[0]?.quantity ?? 0
  return [...lines].sort((a, b) => b.base - a.base).reduce((total, { quantity, base }) => {
    let need = quantity
    let sum = 0
    while (need > UNIT_EPSILON && at < covering.length) {
      const swapped = Math.min(need, left)
      sum += swapped * Math.min(base, covering[at].price)
      need -= swapped
      left -= swapped
      if (left <= UNIT_EPSILON) left = covering[++at]?.quantity ?? 0
    }
    return total + sum + Math.max(0, need) * base
  }, 0)
}

/** Is this product's group posted under its floor in one currency? Base = the catalog price, or the lower promotion price once `usePromo`. */
function groupUnder(group: readonly Entry[], leg: Leg, usePromo: boolean): boolean {
  const units = group.reduce((sum, { line }) => sum + line.quantity, 0)
  const posted = group.reduce((sum, { line }) => sum + postedPrice(line, leg) * line.quantity, 0)
  const floor = floorTotal(group.map(({ line, promo }) => ({
    quantity: line.quantity, base: lowest(catalogPrice(line, leg), usePromo ? promo?.[leg] ?? null : null),
  })), coveringUnits(group[0].line.returned, leg))
  return posted < floor - TOLERANCE_PER_UNIT * units
}

/** The promotion-evaluated unit price of every line, priced as one basket the way the till prices a cart; null when it cannot be proven. */
async function promotionUnitPrices(db: D1Compat, lines: readonly ReplacementPriceLine[], exchangeRate: number): Promise<Array<{ usd: number; khr: number }> | null> {
  const productIds = [...new Set(lines.map((line) => line.productId))]
  const products = await selectInChunks(productIds, 0, (chunk) => db.prepare(`SELECT * FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`)
    .all<Record<string, unknown>>(chunk))
  const ruleRows = await db.prepare('SELECT * FROM promotion_rules WHERE is_active=1 ORDER BY id LIMIT 101').all<Record<string, unknown>>()
  const rules = ruleRows.map((row) => normalizePromotionRule(row, 1))
  if (ruleRows.length > 100 || rules.some((rule) => !rule)) return null
  const byId = new Map(products.map((row) => [Number(row.id), row]))
  try {
    const pool: CapturedPricingPool = {
      version: 1, pool_key: crypto.randomUUID(), evaluation_time: new Date().toISOString(), exchange_rate: exchangeRate,
      rules: rules as CapturedPricingPool['rules'],
      lines: lines.map((line, index) => {
        const row = byId.get(line.productId)
        if (!row) throw new SaleItemPricingError()
        return {
          line_key: `r${index}`, source: 'promotion' as const,
          product: {
            ...capturePricingProduct(row),
            selling_price_usd: sellingPriceCeilCent(Number(row.selling_price_usd ?? 0)),
            wholesale_price_usd: row.wholesale_price_usd == null ? null : sellingPriceCeilCent(Number(row.wholesale_price_usd)),
          },
          selling_price_input_usd: null, manual: { type: 'none' as const, value: 0 },
        }
      }),
    }
    const priced = evaluateCapturedPricingPool(pool, Object.fromEntries(lines.map((line, index) => [`r${index}`, line.quantity])))
    return lines.map((_, index) => {
      const exact = priced.get(`r${index}`)!
      return { usd: exact.applied_price_usd, khr: exact.applied_price_khr }
    })
  } catch (error) {
    if (error instanceof SaleItemPricingError || error instanceof MoneyPrecisionError) return null
    throw error
  }
}

/**
 * The first line of a product whose lines, taken together, are posted under what the server allows a caller without the
 * POS price grant (dollars or riel), or null. The floor is per product, not per line: the units the return hands back
 * (`returned`) may sell down to the price of the sale line each came from, and every unit beyond them, with every unit of
 * any other product, down to the catalog / promotion price (see the header). Costs no read unless a product is posted under its
 * catalog-based floor: the common cases (the catalog price, the swap at the original sale's price) are decided in
 * memory, and only a lower price pays for the promotion evaluation.
 */
export async function firstDisallowedReplacementPrice(
  db: D1Compat,
  lines: readonly ReplacementPriceLine[],
  exchangeRate: number,
): Promise<ReplacementPriceLine | null> {
  const groups = new Map<number, Entry[]>()
  lines.forEach((line, index) => groups.set(line.productId, [...(groups.get(line.productId) ?? []), { line, index, promo: null }]))
  const under = (group: readonly Entry[], usePromo: boolean) => LEGS.some((leg) => groupUnder(group, leg, usePromo))
  const suspects = [...groups.values()].filter((group) => under(group, false))
  if (!suspects.length) return null
  const promoted = await promotionUnitPrices(db, lines, exchangeRate)
  for (const group of suspects) {
    for (const entry of group) entry.promo = promoted?.[entry.index] ?? null
    if (under(group, true)) return group[0].line
  }
  return null
}
