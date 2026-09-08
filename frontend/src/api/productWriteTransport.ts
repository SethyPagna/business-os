import { apiFetch, cacheInvalidate, route } from './http.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { selectedConflictCanContinueAutomatically, type SelectedConflictPreviewCaseRequest, type SelectedConflictStockChoice } from '../utils/selectedConflictMerge.ts'
import type { SelectedConflictGroupReviewRequest } from '../utils/selectedConflictActionReview.ts'

type ProductPayload = ExpectedUpdatedAtPayload

export type MergeDuplicateProductsChunkResult = {
  success: boolean
  complete: boolean
  blockedOnly?: boolean
  interrupted?: boolean
  interruptionCode?: 'merge_budget_reached' | 'merge_infrastructure_interrupted' | null
  error?: string
  stalled: boolean
  madeProgress: boolean
  batchLimit: number
  mergedGroups: number
  mergedProducts: number
  remainingProductsBefore: number
  remainingProducts: number | null
  remainingGroupCount: number | null
  maxAdditionalRequests: number | null
  requestId: string | null
  processedCaseKeys: string[]
  actionHistoryIds: number[]
  mergeOperationIds: string[]
  undoPendingOperationIds: string[]
  undoPendingCount: number
  refusals: Array<{ caseKey: string; keeperId: number; mergedId: number; mergedName: string | null; code: string; error: string }>
}

export type MergeDuplicateProductsOptions = { requestId?: string; signal?: AbortSignal }

const MERGE_DUPLICATES_CHUNK_TIMEOUT_MS = 120_000
export const MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS = 30_000
export const SELECTED_CONFLICT_MERGE_TIMEOUT_MS = 120_000

export type SelectedConflictMergeProductState = {
  id: number
  name: string | null
  barcode: string | null
  is_active: number | boolean
  is_group: number | boolean
  stock_quantity: number
  image_path: string | null
}

export type SelectedConflictMergeBranchState = {
  branch_id: number
  branch_name: string | null
  keeper_quantity: number
  discarded_quantity: number
  keeper_lot_count: number
  discarded_lot_count: number
}

export type SelectedConflictMergeProjectedBranchState = {
  branch_id: number
  branch_name: string | null
  quantity: number
  lot_count: number
}

export type SelectedConflictMergeMoneyState = {
  cost_price_usd?: number | null
  cost_price_khr?: number | null
  selling_price_usd?: number | null
  selling_price_khr?: number | null
  wholesale_price_usd?: number | null
  wholesale_price_khr?: number | null
}

export type SelectedConflictMergeImageState = { primary: string | null; gallery: string[] }

export type SelectedConflictMergePreviewCase = {
  ordinal: number
  case_key: string
  keep_id: number
  merge_id: number
  needs_stock_choice: boolean
  state_digest: string
  before: {
    keeper: SelectedConflictMergeProductState
    discarded: SelectedConflictMergeProductState
    stock: SelectedConflictMergeBranchState[]
    costs: { keeper: SelectedConflictMergeMoneyState; discarded: SelectedConflictMergeMoneyState }
    prices: { keeper: SelectedConflictMergeMoneyState; discarded: SelectedConflictMergeMoneyState }
    images: { keeper: SelectedConflictMergeImageState; discarded: SelectedConflictMergeImageState }
  }
  after_by_stock_choice: Record<SelectedConflictStockChoice, {
    stock: SelectedConflictMergeProjectedBranchState[]
    costs: SelectedConflictMergeMoneyState
    prices: SelectedConflictMergeMoneyState
    images: SelectedConflictMergeImageState
  }>
  blocked: null | { code: string; message: string; operation_id?: string }
}

export type SelectedConflictMergePreviewResult = {
  success: true
  manifest_version: 1
  manifest_digest: string
  cases: SelectedConflictMergePreviewCase[]
  skipped: Array<{ ordinal: number; case_key: string; product_ids: number[]; code: string; message: string }>
}

export type SelectedConflictMergeApplyBody = {
  client_request_id: string
  manifest_version: 1
  manifest_digest: string
  cases: Array<{
    ordinal: number
    case_key: string
    keep_id: number
    merge_id: number
    state_digest: string
    stock: SelectedConflictStockChoice | null
  }>
}

export type SelectedConflictMergeApplyResult = {
  success: true
  complete: boolean
  blockedOnly: boolean
  interrupted: boolean
  interruptionCode: null | 'merge_budget_reached' | 'merge_infrastructure_interrupted' | 'merge_history_pending' | 'merge_history_unavailable' | 'merge_state_conflict'
  madeProgress: boolean
  requestId: string
  manifestDigest: string
  committedCases: Array<{
    caseKey: string
    keptId: number
    mergedId: number
    stockDisposition: SelectedConflictStockChoice | null
    operationId: string
    actionHistoryId: number | null
    undoReady: boolean
    undoAvailability: 'ready' | 'pending' | 'unavailable'
  }>
  processedCaseKeys: string[]
  refusals: Array<{ caseKey: string; keeperId: number; mergedId: number; code: string; error: string }>
  pendingCaseKeys: string[]
  remainingCaseCount: number | null
  maxAdditionalRequests: number | null
  undoPendingOperationIds: string[]
  undoUnavailableOperationIds: string[]
}

export type SelectedConflictGroupReviewMember = {
  id: number
  name: string | null
  barcode: string | null
  category: string | null
  brand: string | null
  unit: string | null
  image_path: string | null
  updated_at: string | null
  cost_price_usd: number | string | null
  cost_price_khr: number | string | null
  selling_price_usd: number | string | null
  selling_price_khr: number | string | null
  wholesale_price_usd: number | string | null
  wholesale_price_khr: number | string | null
}

export type SelectedConflictGroupReviewGroup = {
  ordinal: number
  group_key: string
  source_group_keys: string[]
  member_ids: number[]
  eligibility_basis: 'name' | 'barcode' | null
  eligibility_value: string | null
  members: SelectedConflictGroupReviewMember[]
  options: {
    barcode_source_ids: number[]
    category_source_ids: number[]
    brand_source_ids: number[]
    unit_source_ids: number[]
  }
  economics: {
    merged: Partial<Record<'cost_price_usd' | 'cost_price_khr' | 'selling_price_usd' | 'selling_price_khr' | 'wholesale_price_usd' | 'wholesale_price_khr', number>>
    distinctCosts: Partial<Record<'cost_price_usd' | 'cost_price_khr', number[]>>
    issues: Array<{ field: string; rowId: number | null; value: unknown; code: 'negative' | 'malformed' }>
  }
  stock: {
    rows: Array<{ product_id: number; branch_id: number; branch_name: string | null; quantity: number }>
    projected_by_branch: Array<{ branch_id: number; branch_name: string | null; quantity: number }>
  }
  lots: {
    rows: Array<{
      product_id: number
      batch_id: number
      batch_key: string
      lot_code: string | null
      expiry_date: string | null
      received_at: string | null
      is_active: number
      notes: string | null
      unit_cost_usd: number | null
      received_quantity: number | null
      received_branch_id: number | null
      received_cost_usd: number | null
      supplier_id: number | null
      supplier_name: string | null
      payment_status: string | null
      credit_due_date: string | null
      branch_id: number | null
      quantity: number | null
    }>
    projected_quantity: number
    count: number
  }
  state_digest: string
  blocked: null | {
    code: 'stale_group_members' | 'incompatible_group_identity' | 'overlap_requires_selection' | 'invalid_merge_numeric'
    message: string
  }
}

export type SelectedConflictGroupReviewPage = {
  cursor: string
  next_cursor: string | null
  limit: number
  groups: SelectedConflictGroupReviewGroup[]
}

export type SelectedConflictGroupReviewResult = {
  success: true
  manifest_version: 1
  resolution_version: 2
  review_id: string
  draft_digest: string
  status: 'draft'
  expires_at: string
  counts: {
    requested_groups: number
    actionable_groups: number
    blocked_groups: number
    total_members: number
  }
  page: SelectedConflictGroupReviewPage
}

function getDevicePayload(): ProductPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export async function createProduct(payload: ProductPayload = {}): Promise<unknown> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'product')
  return route(
    'products:create',
    () => apiFetch('POST', '/api/products', body),
    null,
    true,
  )
}

export async function updateProduct(id: string | number, payload: ProductPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('products', id, { ...getDevicePayload(), ...(payload || {}) })
  return route(
    'products:update',
    () => apiFetch('PUT', `/api/products/${encodeId(id)}`, body),
    null,
    true,
  )
}

export async function deleteProduct(id: string | number, reason?: string): Promise<unknown> {
  const payload = ensureClientRequestId(
    await withExpectedUpdatedAt('products', id, { reason: reason ?? '' }),
    'product-remove',
  )
  return route(
    'products:delete',
    () => apiFetch('DELETE', `/api/products/${encodeId(id)}`, payload),
    null,
    true,
  )
}

// The 10k+-safe path -- see cloudflare/src/lib/bulkDeleteEngine.ts for the
// full reasoning. Fires the job and returns immediately (202-style); the
// actual deletion happens server-side via the queue, polled through
// getBulkDeleteJobStatus below. No cacheInvalidate/route() wrapping here
// unlike the single-item calls above -- there's nothing to optimistically
// update locally yet (the job hasn't processed anything at the moment this
// resolves), and the eventual real-time `broadcast(...)` the job fires on
// completion (see bulkDeleteEngine.ts) is what actually refreshes every
// connected client's product list, this tab included.
export async function startBulkDeleteJob(ids: Array<string | number>, reason: string): Promise<{ jobId: string; totalCount: number }> {
  const result = (await apiFetch('POST', '/api/products/bulk-delete-jobs', { ids: ids.map((id) => Number(id)), reason })) as
    | { success?: boolean; jobId?: string; totalCount?: number; error?: string }
    | undefined
  if (!result?.jobId) throw new Error(result?.error || 'Failed to start bulk delete')
  return { jobId: result.jobId, totalCount: result.totalCount ?? ids.length }
}

export type BulkDeleteJobStatus = {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  totalCount: number
  processedCount: number
  failedCount: number
  lastError: string | null
}

export async function getBulkDeleteJobStatus(jobId: string): Promise<BulkDeleteJobStatus> {
  const result = (await apiFetch('GET', `/api/products/bulk-delete-jobs/${encodeId(jobId)}`)) as { success?: boolean; job?: BulkDeleteJobStatus; error?: string } | undefined
  if (!result?.job) throw new Error(result?.error || 'Bulk delete job not found')
  return result.job
}

export async function cancelBulkDeleteJob(jobId: string): Promise<void> {
  await apiFetch('POST', `/api/products/bulk-delete-jobs/${encodeId(jobId)}/cancel`)
}

export function createProductVariant(payload: ProductPayload = {}): Promise<unknown> {
  return route(
    'products:create',
    () => apiFetch('POST', '/api/products/variant', payload),
    null,
    true,
  )
}

// Retroactive cleanup for products already sitting in the catalog as
// separate rows for what's really the same item, differing only in which
// branch's stock ended up on which row (see the matching backend comment,
// routes/products.ts's POST /merge-duplicates, for the full identity rule
// and why import alone never catches this). Not tied to any one product --
// scans the whole catalog server-side, so no payload needed.
export function mergeDuplicateProducts(options: MergeDuplicateProductsOptions = {}): Promise<MergeDuplicateProductsChunkResult> {
  // One request id is retained by the caller for the entire bounded run. The
  // same body also lets apiFetch share an in-flight retry after a double tap.
  const body = ensureClientRequestId({ ...getDevicePayload(), client_request_id: options.requestId }, 'product-merge')
  return route(
    'products:mergeDuplicates',
    () => apiFetch('POST', '/api/products/merge-duplicates', body, MERGE_DUPLICATES_CHUNK_TIMEOUT_MS, { signal: options.signal }),
    null,
    true,
  ) as Promise<MergeDuplicateProductsChunkResult>
}

// Read-only dry run for the endpoint above (GET /api/products/merge-
// duplicates/preview) -- lets MergeDuplicatesReviewModal show exactly
// which products would merge before the person commits to the real POST.
// Deliberately not routed through `route()`'s write-queue/offline-replay
// machinery the way mergeDuplicateProducts() above is: this never mutates
// anything, so there's nothing to replay if it fails offline -- a plain
// apiFetch that the modal can just retry is the right shape for a GET.
export function previewMergeDuplicateProducts(options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return apiFetch('GET', '/api/products/merge-duplicates/preview', undefined, MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS, { signal: options.signal })
}

// Products → Duplicates review section ("possibly the same" residue --
// same real barcode with differing details, or same display name with
// different barcodes). The sweep and dismiss mirror the contacts
// Possible Duplicates panel; the merge is a one-pair fold where the
// REVIEWER picked the keeper, so both ids ride in the payload. GET stays
// a plain apiFetch (read-only, retryable); the two writes go through
// route() like every other real mutation.
export function getPossiblySameProducts(): Promise<unknown> {
  return apiFetch('GET', '/api/products/possible-duplicates')
}

export function dismissProductDuplicateCluster(type: 'leadingzero' | 'barcode' | 'name' | 'similar', value: string): Promise<unknown> {
  return route(
    'products:dismissDuplicateCluster',
    () => apiFetch('POST', '/api/products/possible-duplicates/dismiss', { type, value }),
    null,
    true,
  )
}

// Read-only dry run behind every "keep this one" decision: what the row being
// discarded still holds (per branch, per lot) and whether the merge would move
// the keeper's prices. Callers open the confirm dialog with these numbers, so
// the operator answers with the facts in view. Plain apiFetch -- it writes
// nothing and is safe to repeat.
export function getMergePreview(keepId: number | string, mergeId: number | string): Promise<unknown> {
  const query = `keepId=${encodeURIComponent(String(keepId))}&mergeId=${encodeURIComponent(String(mergeId))}`
  return apiFetch('GET', `/api/products/possible-duplicates/merge-preview?${query}`)
}

// `stock` is the operator's answer for the discarded row's remaining stock:
// 'merge' moves every lot onto the keeper keeping its batch and branch, and
// 'write_off' zeroes them against a balancing ledger entry. It is deliberately
// NOT defaulted here: the server refuses a stocked row with no answer (400
// stock_choice_required) rather than guessing, and a default in the transport
// would quietly reinstate exactly the silent behaviour that was wrong.
export function mergePossiblySameProducts(
  keepId: number | string,
  mergeId: number | string,
  stock?: 'merge' | 'write_off',
): Promise<unknown> {
  return route(
    'products:mergePossiblySame',
    () => apiFetch('POST', '/api/products/possible-duplicates/merge', stock ? { keepId, mergeId, stock } : { keepId, mergeId }),
    null,
    true,
  )
}

// Combined review for a reviewer-selected set of exact two-row conflicts.
// Both calls deliberately bypass route(): preview is read-only and the apply
// request must never enter the offline replay queue because its manifest is a
// point-in-time authorization. A fresh server preview is required after any
// uncertain outcome or manual resume.
export function previewSelectedConflictMerges(
  cases: SelectedConflictPreviewCaseRequest[],
  options: { signal?: AbortSignal } = {},
): Promise<SelectedConflictMergePreviewResult> {
  return apiFetch(
    'POST',
    '/api/products/possible-duplicates/merge-batch/preview',
    { cases },
    MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS,
    { signal: options.signal },
  ) as Promise<SelectedConflictMergePreviewResult>
}

export function createSelectedConflictGroupReview(
  body: SelectedConflictGroupReviewRequest,
  options: { signal?: AbortSignal } = {},
): Promise<SelectedConflictGroupReviewResult> {
  return apiFetch(
    'POST',
    '/api/products/possible-duplicates/merge-batch/preview',
    body,
    MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS,
    { signal: options.signal },
  ) as Promise<SelectedConflictGroupReviewResult>
}

export function getSelectedConflictGroupReviewPage(
  reviewId: string,
  cursor: string,
  limit = 50,
  options: { signal?: AbortSignal } = {},
): Promise<SelectedConflictGroupReviewResult> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)))
  const safeCursor = /^\d+$/.test(String(cursor)) ? String(cursor) : '0'
  return apiFetch(
    'GET',
    `/api/products/possible-duplicates/merge-batch/reviews/${encodeId(reviewId)}?cursor=${encodeURIComponent(safeCursor)}&limit=${safeLimit}`,
    undefined,
    MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS,
    { signal: options.signal },
  ) as Promise<SelectedConflictGroupReviewResult>
}

export function makeSelectedConflictMergeApplyBody(
  preview: SelectedConflictMergePreviewResult,
  choices: Readonly<Record<string, SelectedConflictStockChoice | undefined>>,
  clientRequestId: string,
): SelectedConflictMergeApplyBody {
  const requestId = String(clientRequestId || '').trim()
  if (!requestId) throw new Error('A stable client request ID is required.')
  return {
    client_request_id: requestId,
    manifest_version: preview.manifest_version,
    manifest_digest: preview.manifest_digest,
    cases: preview.cases
      .filter((item) => !item.blocked)
      .map((item, ordinal) => ({
        ordinal,
        case_key: item.case_key,
        keep_id: item.keep_id,
        merge_id: item.merge_id,
        state_digest: item.state_digest,
        stock: item.needs_stock_choice ? choices[item.case_key] || null : null,
      })),
  }
}

export async function runSelectedConflictMergeBatch(
  body: SelectedConflictMergeApplyBody,
  options: {
    signal?: AbortSignal
    onProgress?: (result: SelectedConflictMergeApplyResult) => void
  } = {},
): Promise<SelectedConflictMergeApplyResult> {
  let attempts = 0
  let callCeiling = 1
  // At most one productive continuation per reviewed case, plus a bounded
  // final receipt/history pass. A malicious or broken response cannot keep
  // extending its own loop by returning the same positive allowance forever.
  const absoluteCallCeiling = Math.max(1, Math.min(14, body.cases.length + 2))
  try {
    while (attempts < callCeiling) {
      // Count the attempt before awaiting: a timeout can happen after D1 has
      // committed, so reconciliation must run even when no response arrives.
      attempts += 1
      const result = await apiFetch(
        'POST',
        '/api/products/possible-duplicates/merge-batch',
        body,
        SELECTED_CONFLICT_MERGE_TIMEOUT_MS,
        { signal: options.signal },
      ) as SelectedConflictMergeApplyResult
      options.onProgress?.(result)
      if (!selectedConflictCanContinueAutomatically(result)) return result
      const additional = Math.min(12, Number(result.maxAdditionalRequests))
      callCeiling = Math.min(absoluteCallCeiling, Math.max(callCeiling, attempts + additional))
    }
    throw new Error('Selected conflict merge continuation limit reached.')
  } finally {
    if (attempts > 0) {
      cacheInvalidate('products')
      cacheInvalidate('inventory')
    }
  }
}

// Zero-quantity product cleanup (progress.md part 91's full spec, part 97
// build): a read-only candidate scan plus a confirm-only delete, mirroring
// mergeDuplicateProducts()/previewMergeDuplicateProducts() above -- GET for
// the read (safe to call repeatedly, no write-queue involvement needed),
// POST for the actual soft-delete (goes through `route()` since it's a
// real mutation the offline write-queue should know how to replay).
export function previewZeroQuantityCandidates(thresholdDays?: number): Promise<unknown> {
  const query = typeof thresholdDays === 'number' && Number.isFinite(thresholdDays)
    ? `?thresholdDays=${encodeURIComponent(String(Math.max(0, Math.floor(thresholdDays))))}`
    : ''
  return apiFetch('GET', `/api/products/zero-quantity-candidates${query}`)
}

export function deleteZeroQuantityProducts(ids: Array<string | number>): Promise<unknown> {
  return route(
    'products:zeroQuantityDelete',
    () => apiFetch('POST', '/api/products/zero-quantity-delete', { ids }),
    null,
    true,
  )
}

// Attaching Library photos to products by filename (routes/products.ts's
// POST /wire-images/preview + /wire-images). Same preview-then-apply split
// as merge-duplicates above and for the same reason: this runs across the
// whole catalog, so the person has to see what would move before it moves.
//
// The apply call sends back the exact changes the preview showed rather
// than a "do it again" flag -- re-matching server-side could apply
// something the reviewer never saw if the Library changed in between.
export function previewWireProductImages(): Promise<unknown> {
  return apiFetch('POST', '/api/products/wire-images/preview')
}

export function wireProductImages(changes: unknown[]): Promise<unknown> {
  return route(
    'products:wireImages',
    () => apiFetch('POST', '/api/products/wire-images', { changes }),
    null,
    true,
  )
}

// The undo for the two above. Detaches only -- every file stays in the
// Library, which is what makes re-running the preview after a bad wire a
// real recovery path rather than a re-upload.
export function unwireProductImages(productIds: Array<string | number>): Promise<unknown> {
  return route(
    'products:unwireImages',
    () => apiFetch('POST', '/api/products/unwire-images', { productIds }),
    null,
    true,
  )
}

// D5 (Part 578, item 3): attribute a supplier to a product's unattributed
// (supplier_id NULL) lots after the fact -- the "stays linkable later" case
// from migration 0062. Routed like every other real mutation; the server
// records it as one undoable/redoable action (surfaced by the Products page's
// ActionHistoryBar). batchIds narrows to specific lots; omit to take every
// unattributed lot the product has.
export function backfillProductSupplier(
  productId: string | number,
  supplierId: number,
  batchIds?: Array<number>,
): Promise<{ success?: boolean; updated?: number; actionHistoryId?: number | null; error?: string } | null> {
  return route(
    'products:backfillSupplier',
    () => apiFetch('POST', `/api/products/${encodeId(productId)}/suppliers/backfill`, {
      supplierId,
      ...(Array.isArray(batchIds) ? { batchIds } : {}),
    }) as Promise<{ success?: boolean; updated?: number; actionHistoryId?: number | null; error?: string }>,
    null,
    true,
  )
}

export function bulkImportProducts(payload: ProductPayload = {}): Promise<unknown> {
  return route(
    'products:bulkImport',
    () => apiFetch('POST', '/api/products/bulk-import', payload),
    null,
    true,
  )
}

// P3 (Part 387): the whole-catalog price adjustment -- runs server-side as
// set-based UPDATEs (POST /api/products/bulk-price-adjust). preview: true
// answers with { count } (rows that would actually change); the apply
// returns { success, changed }. Full products access required server-side;
// NO undo at this scope, which the caller's confirm states.
export function bulkPriceAdjustAllProducts(payload: {
  direction: 'increase' | 'decrease'
  amount: number
  fields: string[]
  skip_zero: boolean
  preview?: boolean
}): Promise<{ count?: number; success?: boolean; changed?: number; error?: string }> {
  const request = () => apiFetch('POST', '/api/products/bulk-price-adjust', { ...payload, ...getDevicePayload() }) as Promise<{ count?: number; success?: boolean; changed?: number; error?: string }>
  if (payload.preview) return request()
  return route('products:bulkPriceAdjustAll', request, null, true).then((result) => {
    cacheInvalidate('products')
    return result as { success?: boolean; changed?: number; error?: string }
  })
}
