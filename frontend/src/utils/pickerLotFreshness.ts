import { apiFetch } from '../api/http.ts'
import type { ProductBatchListResponse } from '../api/batchesTransport.ts'

/** Point reads for a sell picker must not inherit a stale tracking-index or
 * route-cache answer. The branch and product identify the actual stock source. */
export function readFreshPickerLots(productId: number, branchId: string, signal: AbortSignal): Promise<ProductBatchListResponse> {
  const query = new URLSearchParams({ productId: String(productId), branchId, _picker: `${Date.now()}-${Math.random()}` })
  return apiFetch('GET', `/api/batches/picker-lots?${query}`, undefined, 8000, { signal })
}

/** Own one effect generation. Cancellation and a partial group failure cannot
 * publish a stale or incomplete set of selectable lots. */
export function startPickerLotRead<T>(
  productIds: readonly number[],
  read: (productId: number, signal: AbortSignal) => Promise<T>,
  success: (rows: T[]) => void,
  failure: (error: unknown) => void,
): () => void {
  const controller = new AbortController()
  let cancelled = false
  Promise.all(productIds.map((id) => read(id, controller.signal))).then((rows) => {
    if (!cancelled) success(rows)
  }).catch((error: unknown) => {
    controller.abort()
    if (!cancelled) failure(error)
  })
  return () => { cancelled = true; controller.abort() }
}
