// Which price each unit of a return's replacement line goes out at by default. A replacement is an exchange plus an optional extra
// purchase with no cap on its quantity (owner, 22 Oct 2026). The units a returned unit of the same product covers are the straight swap
// and go out at the price the original sale recorded for the line each one came back from; every other unit -- a further unit of that
// product, or any other product -- is a new purchase at the catalog price. This mirrors the Worker's floor for a caller without the POS
// price grant (cloudflare/src/lib/returnReplacementPrice.ts), so these defaults are the lowest prices the server accepts from them.

export interface ReplacementPricingRow {
  key: string
  productId: number | string
  quantity: number
  /** The catalog price of one unit; null when this screen could not read it (the Worker then prices the row's extra units). */
  catalogUsd: number | null
  catalogKhr: number | null
}

/** One returned line of the sale: what came back and the unit price the sale recorded for it (riel null when the sale line has none). */
export interface ReturnedUnitsLine {
  productId: number | string | null | undefined
  quantity: number
  soldUsd: number | string | null | undefined
  soldKhr: number | string | null | undefined
}

/**
 * `quantity` units at one unit price; `swapped` when a returned unit covers them (priced at what the sale recorded). A part that is not
 * swapped is a purchase at the catalog price the Worker charges: `priceUsd` is that catalog price when the screen read it, and null when it
 * could not (such a part is posted with no price and shown as "catalog price", never as a figure the Worker has not charged).
 */
export interface ReplacementPart {
  quantity: number
  priceUsd: number | null
  priceKhr: number | null
  swapped: boolean
}

const recorded = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const units = (value: number): number => Number(value.toFixed(6))

/**
 * The parts of every row, in row order. A product can sit on several returned lines at different prices (2 at $5 and 1 at $0), and
 * each returned unit was paid at its OWN line's price, so the units a returned unit covers are paired with their lines, highest
 * recorded price first (dollars, then riel) -- never one pooled lowest price. They are one list per product shared by that
 * product's rows, so two rows of one product cannot both spend the same returned unit, and a row that takes several lines' units
 * is split into one part per price. A line the sales import left without a riel price is worth its dollar price at the sale's
 * rate, whole riel, rounded down -- the same figure the Worker derives; a line with no dollar price covers nothing (its units go
 * out at the catalog price). The Worker ranks the same way (returnReplacementPrice.ts), which keeps these defaults acceptable.
 */
export function planReplacementParts(
  rows: readonly ReplacementPricingRow[],
  returned: readonly ReturnedUnitsLine[],
  saleRate: number,
): Map<string, ReplacementPart[]> {
  const pools = new Map<string, Array<{ left: number; usd: number; khr: number | null }>>()
  for (const line of returned) {
    const quantity = Number(line.quantity)
    const usd = recorded(line.soldUsd)
    if (line.productId == null || !(quantity > 0) || usd == null) continue
    const khr = recorded(line.soldKhr) ?? (saleRate > 0 ? Math.floor(usd * saleRate + 1e-6) : null)
    pools.set(String(line.productId), [...(pools.get(String(line.productId)) ?? []), { left: quantity, usd, khr }])
  }
  for (const pool of pools.values()) pool.sort((a, b) => b.usd - a.usd || (b.khr ?? -Infinity) - (a.khr ?? -Infinity) || 0)
  const plan = new Map<string, ReplacementPart[]>()
  for (const row of rows) {
    const parts: ReplacementPart[] = []
    let need = row.quantity
    for (const source of pools.get(String(row.productId)) ?? []) {
      const swapped = units(Math.min(need, source.left))
      if (!(swapped > 0)) continue
      source.left = units(source.left - swapped)
      need = units(need - swapped)
      const last = parts[parts.length - 1]
      if (last && last.priceUsd === source.usd && last.priceKhr === source.khr) last.quantity = units(last.quantity + swapped)
      else parts.push({ quantity: swapped, priceUsd: source.usd, priceKhr: source.khr, swapped: true })
    }
    if (need > 0) parts.push({ quantity: units(need), priceUsd: row.catalogUsd, priceKhr: row.catalogKhr, swapped: false })
    plan.set(row.key, parts)
  }
  return plan
}

/** What the parts come to, or null when any part has no known price (the total is then only the Worker's to say). */
export function replacementPartsTotalUsd(parts: readonly ReplacementPart[]): number | null {
  let total = 0
  for (const part of parts) {
    if (part.priceUsd == null) return null
    total += part.priceUsd * part.quantity
  }
  return total
}

/** The sum of several rows' totals; null as soon as one row's total is unknown. */
export function replacementRowsTotalUsd(rowTotals: ReadonlyArray<number | null>): number | null {
  let total = 0
  for (const rowTotal of rowTotals) {
    if (rowTotal == null) return null
    total += rowTotal
  }
  return total
}

/**
 * What a "Same item" row starts its extras from: dollars and riel, each null when this screen does not know it, and whether it is the
 * product's own catalog row.
 */
export interface SameItemCatalog {
  usd: number | null
  khr: number | null
  fromCatalog: boolean
}

/**
 * The catalog price a "Same item" row prices its extra units at. Normally the product's own catalog row, but that read needs the Products
 * grant and a role with Returns alone is refused it (403) -- the shortcut must never depend on it. When the read is refused or fails the
 * price is UNKNOWN (null), not a guess from the sale: the extras are posted with no price at all, the Worker prices them at today's catalog
 * price, and the screen names no figure for them until the review shows the Worker's quote. (A sale line's catalog snapshot is the
 * price when it was sold; if the catalog has moved since, the screen would show -- and for a caller who may set prices, post -- a price the
 * Worker would not have charged.) The returned units are priced from their own sale lines whichever way this goes (planReplacementParts).
 * Resolves to null when the read worked and found no such product.
 */
export async function resolveSameItemCatalog(
  readProduct: () => Promise<{ selling_price_usd?: unknown; selling_price_khr?: unknown } | null | undefined>,
): Promise<SameItemCatalog | null> {
  let product: { selling_price_usd?: unknown; selling_price_khr?: unknown } | null | undefined
  try {
    product = await readProduct()
  } catch {
    return { usd: null, khr: null, fromCatalog: false }
  }
  if (!product) return null
  return { usd: recorded(product.selling_price_usd) ?? 0, khr: recorded(product.selling_price_khr) ?? 0, fromCatalog: true }
}
