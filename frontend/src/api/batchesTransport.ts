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
  // D5a: the lot's supplier attribution (first attribution sticks). The
  // add-stock pickers read these to decide whether picking this lot means
  // "supplier already recorded" (shown read-only) or "choice will fill the
  // blank". Optional because older cached list payloads predate the field.
  supplier_id?: number | null
  supplier_name?: string | null
  // Optimistic-concurrency token echoed back on edit so the server can reject
  // a stale write (see updateBatch). Optional because older cached list
  // payloads predate the field.
  updated_at?: string | null
}

export type ReceiveBatchPayload = {
  productId: number
  branchId: number
  quantity: number
  expiryDate?: string | null
  receivedDate?: string | null
  notes?: string | null
  // D4b: explicit existing lot to top up (the same picker every adjust
  // surface has). When set it always wins over date matching; the server
  // validates the lot belongs to this product and keeps its received_at.
  batchId?: number | null
  // Migrations 0062/0065: supplier attribution, per-lot unit cost, and the
  // paid / on-credit choice (credit requires the due date the admin
  // reminder is built on — the server enforces it too).
  supplierId?: number | null
  supplierName?: string | null
  unitCostUsd?: number | null
  paymentStatus?: 'paid' | 'credit' | null
  creditDueDate?: string | null
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
  const scope = branchId != null && branchId !== 'all' ? String(branchId) : 'all'
  const query = scope === 'all' ? '' : `?branchId=${encodeURIComponent(scope)}`
  return route(
    // The branch is part of the cache key. route()'s read cache is keyed by
    // the channel string ALONE (see http.ts's cacheGetStale), so a constant
    // channel makes every branch share one cached answer -- the first
    // branch's tracked-id list would be replayed for all the others.
    `batches:tracked-product-ids:${scope}`,
    () => apiFetch('GET', `/api/batches/tracked-product-ids${query}`),
    // NO local fallback, deliberately. Supplying `() => ({ productIds: [] })`
    // here looked harmless but was a correctness hole: http.ts's
    // hasUsableLocalData counts ANY non-empty object as usable data (it only
    // special-cases `items`/`rows`), so a 403/500/timeout resolved as a
    // SUCCESSFUL empty list and was written into the read cache. Every
    // batch-tracked product then looked untracked, the lot picker never
    // appeared, and batch-tracked stock was sold with no lot chosen --
    // bypassing FIFO/expiry silently, with nothing on screen. Letting the
    // error propagate lets callers tell "nothing is tracked" apart from "we
    // don't know what's tracked", which are opposite situations.
    undefined,
    { raceLocalFallback: false },
  )
}

// GET /api/batches?productId=&branchId=&onlyAvailable= -- every active
// batch for one product, FIFO-ordered (soonest expiry first).
export function getProductBatches(productId: number | string, branchId: number | string, onlyAvailable = false): Promise<{ batches: ProductBatch[] }> {
  const params = new URLSearchParams({ productId: String(productId), branchId: String(branchId) })
  if (onlyAvailable) params.set('onlyAvailable', '1')
  return route(
    // Product, branch and the onlyAvailable flag ALL belong in the cache
    // key. route()'s read cache is keyed by the channel string alone, so a
    // constant 'batches:list' meant every product in the catalogue shared
    // one cached lot list: the first product's answer was replayed for the
    // next one, and an empty result cached before any batches existed stuck
    // permanently. That is the reported "batch pick not working" -- the POS
    // lot picker showed "No lots available at this branch" while the
    // request beside it returned two lots, and once warm it would have
    // shown ANOTHER product's lots, which is worse than showing none.
    `batches:list:${productId}:${branchId}:${onlyAvailable ? 1 : 0}`,
    () => apiFetch('GET', `/api/batches?${params.toString()}`),
    // NO local fallback -- same reasoning as getTrackedBatchProductIds
    // above. `() => ({ batches: [] })` turned any failure into a cached
    // "this product has no lots at this branch", which reads on screen as a
    // definitive answer ("No lots available at this branch") when in truth
    // the request never succeeded. Callers must be able to distinguish the
    // two, so the error propagates.
    undefined,
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
      batch_id: payload.batchId ?? null,
      notes: payload.notes || null,
      supplier_id: payload.supplierId ?? null,
      supplier_name: payload.supplierName || null,
      unit_cost_usd: payload.unitCostUsd ?? null,
      payment_status: payload.paymentStatus || null,
      credit_due_date: payload.creditDueDate || null,
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
export function updateBatch(id: number | string, patch: { expiryDate?: string | null; notes?: string | null; isActive?: boolean; receivedAt?: string | null; expectedUpdatedAt?: string | null }): Promise<{ success: boolean }> {
  const body: Record<string, unknown> = {}
  if (patch.expiryDate !== undefined) body.expiry_date = patch.expiryDate || null
  if (patch.notes !== undefined) body.notes = patch.notes || null
  if (patch.isActive !== undefined) body.is_active = patch.isActive
  if (patch.receivedAt !== undefined) body.received_at = patch.receivedAt || null
  // Sent through so the server can reject a stale edit (conflictControl).
  if (patch.expectedUpdatedAt) body.expectedUpdatedAt = patch.expectedUpdatedAt
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
