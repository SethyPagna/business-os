import type { D1Compat } from './db'
import { MoneyPrecisionError, sellingPriceCeilCent } from './moneyPrecision'
import { hasAnyPermission, type PermissionUser } from './permissions'
import { normalizePromotionRule } from './promotionRules'
import { capturePricingProduct, evaluateCapturedPricingPool, SaleItemPricingError, type CapturedPricingPool } from './saleItemPricing'
import { selectInChunks } from './sqlBinding'

// What a return's replacement line may be priced at. A replacement is an ordinary sale line, so the price follows
// POST /api/sales: the server prices a line from the catalog, with the active promotions and the product's own
// discount (routes/sales.ts, evaluateCapturedPricingPool over source 'promotion'), and the only thing that lets a
// caller sell at any other price is the grant POST /api/sales itself asks for -- `pos` or `sales` (the till's per-sale
// price edit has no separate permission). A caller without that grant may therefore not price a replacement line
// below the lowest of: the catalog price, the promotion price, and the price the same product was sold at on the sale
// being returned (the straight swap, which the refund already pays at that price). A price above that is not refused.
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
  /** The unit price the same product was sold at on the sale being returned, when the server read it from that sale. */
  soldUsd: number | null
  soldKhr: number | null
}

// Money is kept to four places, so a price within half a place of the floor is the floor. Plain numbers, never a throw on odd input.
const below = (posted: number, floor: number): boolean => posted < floor - 0.00005
const lowest = (...values: Array<number | null>): number => Math.min(...values.filter((value): value is number => value != null))

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
 * The first line priced under what the server allows a caller without the POS price grant, or null. Costs no read
 * unless a line is posted under both its catalog price and its sold price: the common cases (the catalog price, the
 * original sale's price) are decided in memory, and only a lower price pays for the promotion evaluation.
 */
export async function firstDisallowedReplacementPrice(
  db: D1Compat,
  lines: readonly ReplacementPriceLine[],
  exchangeRate: number,
): Promise<ReplacementPriceLine | null> {
  const floor = (line: ReplacementPriceLine) => ({ usd: lowest(line.catalogUsd, line.soldUsd), khr: lowest(line.catalogKhr, line.soldKhr) })
  const under = (line: ReplacementPriceLine, usd: number, khr: number) => below(line.priceUsd, usd) || below(line.priceKhr, khr)
  const suspects = lines.map((line, index) => ({ line, index })).filter(({ line }) => under(line, floor(line).usd, floor(line).khr))
  if (!suspects.length) return null
  const promoted = await promotionUnitPrices(db, lines, exchangeRate)
  for (const { line, index } of suspects) {
    const base = floor(line)
    const promo = promoted?.[index] ?? null
    if (under(line, lowest(base.usd, promo?.usd ?? null), lowest(base.khr, promo?.khr ?? null))) return line
  }
  return null
}
