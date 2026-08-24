import { apiFetch, route } from './http.ts'

// Batch / lot / expiry-date tracking transport (see
// cloudflare/src/routes/batches.ts + cloudflare/src/lib/productBatches.ts).
// No local/offline mirror -- like notes, this rides on top of the same
// sync server every other write already goes through, but batch data
// itself isn't cached/queued locally the way inventory/sales writes are;
// a failed read/write while offline surfaces as a normal error.

export type ProductBatch = {
  id: number
  lot_code: string | null
  expiry_date: string | null
  received_at: string | null
  notes: string | null
  is_active: number
  quantity: number
  batch_number: number | null
}

export type ReceiveBatchPayload = {
  productId: number
  branchId: number
  quantity: number
  expiryDate?: string | null
  receivedDate?: string | null
  notes?: string | null
}

// The lot a cashier picked at checkout for a batch-tracked product -- see
// ProductDetailSheet's batch-picker step and POS.tsx's addToCart overload.
// `quantity` here is the batch's own remaining stock at pick time, used to
// clamp the cart line (a batch-tracked product's sellable quantity is
// whichever single lot was picked, not the product's overall stock).
export type BatchSelection = {
  batchId: number
  batchLabel: string | null
  batchExpiryDate: string | null
  quantity: number
}

// GET /api/batches/tracked-product-ids?branchId= -- product ids that carry
// active batch/expiry tracking, optionally scoped to one branch. Used by
// the POS to decide which products need the batch-picker instead of a
// one-tap add.
export function getTrackedBatchProductIds(branchId?: number | string | null): Promise<{ productIds: number[] }> {
  const query = branchId != null && branchId !== 'all' ? `?branchId=${encodeURIComponent(String(branchId))}` : ''
  return route(
    'batches:tracked-product-ids',
    () => apiFetch('GET', `/api/batches/tracked-product-ids${query}`),
    () => ({ productIds: [] }),
    { raceLocalFallback: false },
  )
}

// GET /api/batches?productId=&branchId=&onlyAvailable= -- every active
// batch for one product, FIFO-ordered (soonest expiry first).
export function getProductBatches(productId: number | string, branchId: number | string, onlyAvailable = false): Promise<{ batches: ProductBatch[] }> {
  const params = new URLSearchParams({ productId: String(productId), branchId: String(branchId) })
  if (onlyAvailable) params.set('onlyAvailable', '1')
  return route(
    'batches:list',
    () => apiFetch('GET', `/api/batches?${params.toString()}`),
    () => ({ batches: [] }),
    { raceLocalFallback: false },
  )
}

// POST /api/batches -- receive stock into a batch (creates a new batch, or
// tops up an existing one when the received date's derived code already
// matches one on this product -- see cloudflare/src/lib/batchCode.ts).
export function receiveBatchStock(payload: ReceiveBatchPayload): Promise<{ success: boolean; batchId: number; lotCode?: string }> {
  return route(
    'batches:receive',
    () => apiFetch('POST', '/api/batches', {
      product_id: payload.productId,
      branch_id: payload.branchId,
      quantity: payload.quantity,
      expiry_date: payload.expiryDate || null,
      received_date: payload.receivedDate || null,
      notes: payload.notes || null,
    }),
    null,
    true,
  )
}

// PATCH /api/batches/:id -- edit a batch's own fields (expiry/notes/
// received date), or reactivate/deactivate it via is_active. There is no
// more separately-editable lot code -- correcting receivedAt recomputes
// the batch's code automatically server-side (see cloudflare/src/lib/
// batchCode.ts's dateToBatchCode).
export function updateBatch(id: number | string, patch: { expiryDate?: string | null; notes?: string | null; isActive?: boolean; receivedAt?: string | null }): Promise<{ success: boolean }> {
  const body: Record<string, unknown> = {}
  if (patch.expiryDate !== undefined) body.expiry_date = patch.expiryDate || null
  if (patch.notes !== undefined) body.notes = patch.notes || null
  if (patch.isActive !== undefined) body.is_active = patch.isActive
  if (patch.receivedAt !== undefined) body.received_at = patch.receivedAt || null
  return route(
    'batches:update',
    () => apiFetch('PATCH', `/api/batches/${encodeURIComponent(String(id))}`, body),
    null,
    true,
  )
}

// PATCH /api/batches/:id/branches/:branchId -- corrects one batch's
// on-hand quantity at one branch (a stock-take SET, not a delta; the
// server computes and applies the delta to branch_stock/stock_quantity
// itself). Existed server-side with nothing calling it -- this is what
// lets a stock change be scoped to a single batch/lot instead of the
// product's overall quantity, per the "apply stock changes... to a
// specific batch" request.
export function updateBatchBranchQuantity(id: number | string, branchId: number | string, quantity: number): Promise<{ success: boolean }> {
  return route(
    'batches:update-branch-quantity',
    () => apiFetch('PATCH', `/api/batches/${encodeURIComponent(String(id))}/branches/${encodeURIComponent(String(branchId))}`, { quantity }),
    null,
    true,
  )
}

// DELETE /api/batches/:id -- soft delete (is_active = 0). Server never
// hard-deletes a batch row (sale_item_batch_allocations still reference
// it for historical reports), so this just stops it being offered again.
export function deactivateBatch(id: number | string): Promise<{ success: boolean }> {
  return route(
    'batches:deactivate',
    () => apiFetch('DELETE', `/api/batches/${encodeURIComponent(String(id))}`),
    null,
    true,
  )
}
