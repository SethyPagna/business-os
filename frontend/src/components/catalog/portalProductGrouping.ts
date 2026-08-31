import { buildProductGroups, mergeSameDetailRows, type ProductRecord } from '../../utils/productGrouping.ts'
import { combinePortalStockStatus } from './portalCatalogDisplay.ts'

type LooseRecord = Record<string, any>
export type CatalogProduct = LooseRecord & {
  id: string | number
  name?: string
  stock_status?: string
  branch_availability?: Array<{ branch_id?: string | number | null; status?: string }>
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

// The portal payload carries server-computed stock_status/branch_availability
// instead of raw quantities (routes/portal.ts attachPortalStockStatus), so
// the shared mergeSameDetailRows (which sums quantities for admin surfaces)
// can't combine availability across a branch-duplicated cluster -- the
// merged row would just inherit the lead row's status. Combine statuses
// here instead: the card badge takes the MOST available status across the
// merged rows (per branch too), so a product any row still carries never
// shows as out of stock. Deliberately conservative the other way -- two
// low-stock rows stay "low" even if their combined total would clear the
// threshold, which never overstates availability.
function combineMergedStockStatus(merged: CatalogProduct[], sourceById: Map<string, CatalogProduct>): CatalogProduct[] {
  return merged.map((row) => {
    const mergedIds: unknown[] = Array.isArray(row.__mergedProductIds) ? row.__mergedProductIds : []
    if (mergedIds.length <= 1 || typeof row.stock_status !== 'string') return row
    const cluster = mergedIds.map((id) => sourceById.get(String(id))).filter(Boolean) as CatalogProduct[]
    if (cluster.length <= 1) return row
    const statusByBranch = new Map<string, string>()
    let overall: string = 'out_of_stock'
    for (const item of cluster) {
      overall = combinePortalStockStatus(overall, item.stock_status)
      for (const entry of (Array.isArray(item.branch_availability) ? item.branch_availability : [])) {
        const key = String(entry?.branch_id)
        statusByBranch.set(key, combinePortalStockStatus(statusByBranch.get(key), entry?.status))
      }
    }
    return {
      ...row,
      stock_status: overall,
      branch_availability: [...statusByBranch.entries()].map(([branchId, status]) => ({ branch_id: Number(branchId), status })),
    }
  })
}

export function mergePortalCatalogProducts(products: unknown): CatalogProduct[] {
  const source = Array.isArray(products) ? products as CatalogProduct[] : []
  const deduped = mergeSameDetailRows(source) as unknown as CatalogProduct[]
  const sourceById = new Map(source.map((item) => [String(item?.id), item]))
  return collapsePortalProductGroups(combineMergedStockStatus(deduped, sourceById))
}
