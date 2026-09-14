import { apiFetch, route } from './http.ts'

// K2 / 11.9 (Part 416): open damaged lots for the POS damage source option
// (see cloudflare/src/routes/batches.ts GET /damaged-lots and
// lib/returnsStock.ts). Its own file rather than batchesTransport.ts only
// for working-tree coordination (that file was mid-flight in another
// session when this landed); it follows the same rules -- per-product
// cache key, and NO local fallback: a failed read must surface as an
// error, never cache as a definitive "no damaged stock".
export type DamagedLot = {
  id: number
  branch_id: number | null
  batch_id: number | null
  return_id: number | null
  quantity_remaining: number
  reason: string | null
  created_at: string | null
}

export function getDamagedLots(productId: number | string, branchId?: number | string | null): Promise<{ lots: DamagedLot[] }> {
  const params = new URLSearchParams({ productId: String(productId) })
  if (branchId != null && branchId !== '') params.set('branchId', String(branchId))
  return route(
    `batches:damaged:${productId}:${branchId ?? 'all'}`,
    () => apiFetch('GET', `/api/batches/damaged-lots?${params.toString()}`),
    undefined,
    { raceLocalFallback: false },
  )
}

// P3-L6: the Products page's TAGGED child rows -- held, non-sellable units
// grouped per (product, tag, branch). A separate read from the products list
// on purpose: these units are not in branch_stock and must never be folded
// into a group's sellable total or offered by a product picker, and keeping
// them on their own wire makes that structural rather than a filter.
export type TaggedLotGroup = {
  product_id: number
  product_name: string | null
  branch_id: number | null
  branch_name: string | null
  /** The English condition token, shown verbatim in every language. */
  condition_tag: string
  quantity: number
  lot_count: number
}

export function getTaggedLots(productIds: Array<number | string>): Promise<{ items: TaggedLotGroup[] }> {
  const ids = [...new Set(productIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
  if (!ids.length) return Promise.resolve({ items: [] })
  const query = new URLSearchParams({ productIds: ids.join(',') })
  return route(
    `inventory:tagged-lots:${ids.join('-')}`,
    () => apiFetch('GET', `/api/inventory/tagged-lots?${query.toString()}`),
    undefined,
    { raceLocalFallback: false },
  ) as Promise<{ items: TaggedLotGroup[] }>
}

export type TaggedLotChange = {
  productId: number | string
  branchId: number | string
  conditionTag: string
  quantity: number
  reason: string
}

/** Remove entirely: the held units are destroyed and booked as a loss at cost. */
export function disposeTaggedLot(payload: TaggedLotChange): Promise<unknown> {
  return route('inventory:tagged-lots:dispose', () => apiFetch('POST', '/api/inventory/tagged-lots/dispose', payload), null, true)
}

/** Restore to sellable: the exact reversal of keeping the units as tagged. */
export function restoreTaggedLot(payload: TaggedLotChange): Promise<unknown> {
  return route('inventory:tagged-lots:restore', () => apiFetch('POST', '/api/inventory/tagged-lots/restore', payload), null, true)
}
