import { resolveProductNames } from './productDetailSections.ts'

// One name rule for every public surface: the heading is the official name
// when the product has one, the shop name otherwise; the shop name is the
// second line only when it differs from the heading. These pure helpers carry
// that rule to the List, Saved, the copied text and the assistant rows.

type NamedProduct = { id: string | number; name?: unknown; description?: unknown; category?: unknown; brand?: unknown }

export type PortalNamedRow = { id: string | number; name: string; shopLine?: string; category: string; brand: string }

/** The row a list or saved entry stores: heading as `name`, shop name as its own optional field. */
export function portalRowFromProduct(product: NamedProduct): PortalNamedRow {
  const { heading, shopLine } = resolveProductNames(product)
  const row: PortalNamedRow = { id: product.id, name: heading, category: String(product.category || ''), brand: String(product.brand || '') }
  if (shopLine) row.shopLine = shopLine
  return row
}

/**
 * Names for one assistant result. The Worker's row carries only the shop name, so the product is looked up in the
 * loaded catalogue by id; a product that is not loaded falls back to the result's own name.
 */
export function assistantRowNames(
  item: { product_id: string | number; name: string },
  products: ReadonlyArray<NamedProduct> | undefined,
): { heading: string; shopLine: string } {
  const loaded = products?.find((product) => String(product.id) === String(item.product_id))
  if (!loaded) return { heading: String(item.name || ''), shopLine: '' }
  const names = resolveProductNames(loaded)
  return names.heading ? names : { heading: String(item.name || ''), shopLine: '' }
}
