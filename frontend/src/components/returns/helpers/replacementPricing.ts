// Which price each unit of a return's replacement line goes out at by default. A replacement is an exchange plus an optional extra
// purchase with no cap on its quantity (owner, 22 Oct 2026). The units a returned unit of the same product covers are the straight swap
// and go out at the price the original sale recorded for the line each one came back from; every other unit -- a further unit of that
// product, or any other product -- is a new purchase at the catalog price. This mirrors the Worker's floor for a caller without the POS
// price grant (cloudflare/src/lib/returnReplacementPrice.ts), so these defaults are the lowest prices the server accepts from them.

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

export const replacementPartsTotalUsd = (parts: readonly ReplacementPart[]): number =>
  parts.reduce((sum, part) => sum + part.priceUsd * part.quantity, 0)

/** The price fields of one line of the sale being returned, as the sales read carries them. */
export interface SaleLinePriceFields {
  product_id?: number | string | null
  base_price_usd?: number | string | null
  base_price_khr?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
}

/** What a "Same item" row starts its extras from: dollars, riel (0 when unknown), and whether it is the product's own catalog row. */
export interface SameItemCatalog {
  usd: number
  khr: number
  fromCatalog: boolean
}

/**
 * The catalog price a "Same item" row prices its extra units at. Normally the product's own catalog row, but that read needs the Products
 * grant and a role with Returns alone is refused it (403) -- the shortcut must never depend on it. When the read is refused or fails, the
 * price falls back to what the SALE recorded for the product: the catalog snapshot on a sale line (base_price_*, the price before any manual
 * cut) when it holds one, else the price that line sold at -- the dearest such line of the product on the sale, so a free line (a
 * buy-2-get-1 at $0) never makes the extras free. The returned units themselves are priced from their own sale lines whichever way this
 * goes (planReplacementParts); only the extras lean on this, and the Worker still holds them to the real catalog / promotion price, so a
 * stale snapshot can at worst be refused, never undercharge. Resolves to null when the read worked and found no such product.
 */
export async function resolveSameItemCatalog(
  readProduct: () => Promise<{ selling_price_usd?: unknown; selling_price_khr?: unknown } | null | undefined>,
  saleLines: readonly SaleLinePriceFields[],
  productId: number | string,
): Promise<SameItemCatalog | null> {
  let product: { selling_price_usd?: unknown; selling_price_khr?: unknown } | null | undefined
  try {
    product = await readProduct()
  } catch {
    return saleLineCatalog(saleLines, productId)
  }
  if (!product) return null
  return { usd: recorded(product.selling_price_usd) ?? 0, khr: recorded(product.selling_price_khr) ?? 0, fromCatalog: true }
}

function saleLineCatalog(saleLines: readonly SaleLinePriceFields[], productId: number | string): SameItemCatalog {
  const prices = saleLines.filter((line) => String(line.product_id) === String(productId)).map((line) => {
    const baseUsd = recorded(line.base_price_usd)
    const baseKhr = recorded(line.base_price_khr)
    const usd = baseUsd != null && baseUsd > 0 ? baseUsd : recorded(line.applied_price_usd) ?? 0
    const khr = baseKhr != null && baseKhr > 0 ? baseKhr : recorded(line.applied_price_khr) ?? 0
    return { usd, khr }
  })
  const dearest = prices.reduce((best, price) => price.usd > best.usd ? price : best, { usd: 0, khr: 0 })
  return { usd: dearest.usd, khr: dearest.khr, fromCatalog: false }
}
