import { apiFetch, route } from './http.ts'
import { ensureClientRequestId } from './requestIds.ts'

// K2 / 11.9 (Part 416): open damaged lots for the POS damage source option
// (see cloudflare/src/routes/batches.ts GET /damaged-lots and
// lib/returnsStock.ts). Its own file rather than batchesTransport.ts only
// for working-tree coordination (that file was mid-flight in another
// session when this landed); it follows the same rules -- per-product
// cache key, and NO local fallback: a failed read must surface as an
// error, never cache as a definitive "no damaged stock".
export type DamagedLot = {
  id: number
  product_id: number
  branch_id: number | null
  batch_id: number | null
  return_id: number | null
  quantity_remaining: number
  reason: string | null
  created_at: string | null
  /** P3-L6: which condition the held units carry ('broken', 'expired', ...).
    * Null only for a row written before the tag existed. The wire value is
    * the English constant in every language. unit_cost_usd is deliberately
    * NOT on this reader -- see lib/returnsStock.ts listOpenDamagedLots. */
  condition_tag?: string | null
}

export async function getDamagedLots(productId: number | string, branchId?: number | string | null, signal?: AbortSignal): Promise<{ lots: DamagedLot[] }> {
  const params = new URLSearchParams({ productId: String(productId) })
  if (branchId != null && branchId !== '') params.set('branchId', String(branchId))
  const response = await route<{ lots: DamagedLot[] }>(
    `batches:damaged:${productId}:${branchId ?? 'all'}`,
    (requestSignal) => apiFetch('GET', `/api/batches/damaged-lots?${params.toString()}`, undefined, 8000, { signal: requestSignal }),
    undefined,
    { raceLocalFallback: false, bypassCache: true, signal },
  )
  if (!Array.isArray(response?.lots)) throw new Error('Invalid condition stock response')
  const lots = response.lots.map(lot => {
    if (!Number.isFinite(Number(lot.id)) || Number(lot.id) <= 0 || !Number.isFinite(Number(lot.quantity_remaining)) || Number(lot.quantity_remaining) < 0
      || (lot.product_id != null && Number(lot.product_id) !== Number(productId))
      || (branchId != null && branchId !== '' && Number(lot.branch_id) !== Number(branchId))) throw new Error('Invalid condition stock source')
    return { ...lot, product_id: Number(productId) }
  })
  return { lots }
}

// Tagged child rows identify the counted subset D inside physical stock T.
// They are explicit sale sources and must not be added to physical totals.
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
  /** SCAN1 STK-D: the per-request receipt id (POST /inventory/adjust's guard).
    * A retry that carries the same id replays the first answer instead of
    * disposing / restoring the units a second time. The dialog mints it once
    * so its own retries reuse it; a caller that sends none still gets one. */
  client_request_id?: string
}

/** Remove entirely: the held units are destroyed and booked as a loss at cost. */
export function disposeTaggedLot(payload: TaggedLotChange): Promise<unknown> {
  const body = ensureClientRequestId(payload, 'tagged')
  return route('inventory:tagged-lots:dispose', () => apiFetch('POST', '/api/inventory/tagged-lots/dispose', body), null, true)
}

/** Clear the condition tag: decrease D while physical stock T stays unchanged. */
export function restoreTaggedLot(payload: TaggedLotChange): Promise<unknown> {
  const body = ensureClientRequestId(payload, 'tagged')
  return route('inventory:tagged-lots:restore', () => apiFetch('POST', '/api/inventory/tagged-lots/restore', body), null, true)
}
