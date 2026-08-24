import { buildProductGroups, mergeSameDetailRows, type ProductRecord } from '../../utils/productGrouping.ts'

type LooseRecord = Record<string, any>
export type CatalogProduct = LooseRecord & {
  id: string | number
  name?: string
  branch_stock?: Array<{ branch_id?: string | number | null; quantity?: string | number | null }>
  stock_quantity?: string | number | null
}

// The public catalog's bootstrap/search endpoints return one row per branch
// for products that are otherwise identical (same name, price, barcode,
// etc.) -- that's a storage/query concern, not something a storefront
// customer should see. Collapse those branch-only duplicates into a single
// display row (combined branch_stock) before they ever hit component state,
// so every source of `products` (server-embedded bootstrap, cached
// snapshot, bootstrap fetch, and search fetch) shows the same deduped list.
//
// Separately, grouped products (same product name, different branch/price/
// barcode/etc. -- what Products/Inventory/POS render as an expandable
// group with a variant list) are collapsed to a SINGLE card here: the
// public portal is a display surface, not a transaction surface -- there's
// no cart or checkout, and price is very often hidden entirely -- so a
// customer doesn't need (and shouldn't see) the branch/barcode/price picker
// POS uses. Per-variant detail belongs to POS only. The one card shown uses
// the highest-priced variant in the group -- a deliberate choice so the
// storefront never advertises a lower price than what every branch/variant
// actually charges.
export function collapsePortalProductGroups(products: CatalogProduct[]): CatalogProduct[] {
  if (!products.length) return products
  const productsById = new Map<unknown, CatalogProduct>(products.map((p) => [p?.id, p]))
  return buildProductGroups(products, productsById as unknown as Map<unknown, ProductRecord>).map((group) => {
    const candidates = group.rows.length ? group.rows : group.items
    return candidates.reduce((best, row) => {
      const price = Number((row as CatalogProduct)?.selling_price_usd || 0)
      const bestPrice = Number((best as CatalogProduct)?.selling_price_usd || 0)
      return price > bestPrice ? row : best
    }, candidates[0]) as unknown as CatalogProduct
  }).filter(Boolean)
}

export function mergePortalCatalogProducts(products: unknown): CatalogProduct[] {
  const deduped = mergeSameDetailRows(Array.isArray(products) ? products as CatalogProduct[] : []) as unknown as CatalogProduct[]
  return collapsePortalProductGroups(deduped)
}
