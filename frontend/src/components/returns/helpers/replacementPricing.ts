// Which price each unit of a return's replacement line goes out at by default. A replacement is an exchange plus an optional extra
// purchase with no cap on its quantity (owner, 22 Oct 2026). The units a returned unit of the same product covers are the straight swap
// and go out at the price the original sale recorded; every other unit -- a further unit of that product, or any other product -- is a
// new purchase at the catalog price. This mirrors the Worker's floor for a caller without the POS price grant
// (cloudflare/src/lib/returnReplacementPrice.ts), so these defaults are the lowest prices the server accepts from them.

export interface ReplacementPricingRow {
  key: string
  productId: number | string
  quantity: number
  catalogUsd: number
  catalogKhr: number | null
}

/** One returned line of the sale: what came back and the unit price the sale recorded for it (riel null when the sale line has none). */
export interface ReturnedUnitsLine {
  productId: number | string | null | undefined
  quantity: number
  soldUsd: number | string | null | undefined
  soldKhr: number | string | null | undefined
}

/** `quantity` units at one unit price; `swapped` when a returned unit covers them (priced at what the sale recorded). */
export interface ReplacementPart {
  quantity: number
  priceUsd: number
  priceKhr: number | null
  swapped: boolean
}

const recorded = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const units = (value: number): number => Number(value.toFixed(6))

/**
 * The parts of every row, in row order. The units a returned unit covers are one pool per product shared by that product's rows, so
 * two rows of one product cannot both spend the same returned unit. The sold price is the lowest recorded price among the returned
 * lines of the product; a line the sales import left without a riel price is worth its dollar price at the sale's rate, whole riel,
 * rounded down -- the same figure the Worker derives.
 */
export function planReplacementParts(
  rows: readonly ReplacementPricingRow[],
  returned: readonly ReturnedUnitsLine[],
  saleRate: number,
): Map<string, ReplacementPart[]> {
  const pools = new Map<string, { left: number; usd: number | null; khr: number | null }>()
  for (const line of returned) {
    const quantity = Number(line.quantity)
    const usd = recorded(line.soldUsd)
    if (line.productId == null || !(quantity > 0)) continue
    const khr = recorded(line.soldKhr) ?? (usd != null && saleRate > 0 ? Math.floor(usd * saleRate + 1e-6) : null)
    const pool = pools.get(String(line.productId)) ?? { left: 0, usd: null, khr: null }
    pool.left += quantity
    if (usd != null) pool.usd = pool.usd == null ? usd : Math.min(pool.usd, usd)
    if (khr != null) pool.khr = pool.khr == null ? khr : Math.min(pool.khr, khr)
    pools.set(String(line.productId), pool)
  }
  const plan = new Map<string, ReplacementPart[]>()
  for (const row of rows) {
    const parts: ReplacementPart[] = []
    const pool = pools.get(String(row.productId))
    const swapped = pool && pool.usd != null ? Math.min(row.quantity, pool.left) : 0
    if (pool && swapped > 0) {
      pool.left -= swapped
      parts.push({ quantity: units(swapped), priceUsd: pool.usd as number, priceKhr: pool.khr, swapped: true })
    }
    if (row.quantity - swapped > 0) parts.push({ quantity: units(row.quantity - swapped), priceUsd: row.catalogUsd, priceKhr: row.catalogKhr, swapped: false })
    plan.set(row.key, parts)
  }
  return plan
}

export const replacementPartsTotalUsd = (parts: readonly ReplacementPart[]): number =>
  parts.reduce((sum, part) => sum + part.priceUsd * part.quantity, 0)
