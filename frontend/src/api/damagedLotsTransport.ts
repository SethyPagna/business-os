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
