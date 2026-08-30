import { apiFetch, cacheInvalidate, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type ProductPayload = ExpectedUpdatedAtPayload

function getDevicePayload(): ProductPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

async function ensureSupplierExists(name: unknown): Promise<void> {
  const supplierName = String(name || '').trim()
  if (!supplierName) return

  try {
    const db = await getLocalDb()
    const suppliers = db.table('suppliers') as unknown as {
      where: (field: string) => {
        equalsIgnoreCase: (value: string) => {
          first: () => Promise<unknown>
        }
      }
    }
    const existing = await suppliers.where('name').equalsIgnoreCase(supplierName).first()
    if (existing) return

    await apiFetch('POST', '/api/suppliers', { name: supplierName, ...getDevicePayload() })
    cacheInvalidate('suppliers')
  } catch (_) {}
}

export async function createProduct(payload: ProductPayload = {}): Promise<unknown> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'product')
  await ensureSupplierExists(body.supplier)
  return route(
    'products:create',
    () => apiFetch('POST', '/api/products', body),
    null,
    true,
  )
}

export async function updateProduct(id: string | number, payload: ProductPayload = {}): Promise<unknown> {
  await ensureSupplierExists(payload.supplier)
  const body = await withExpectedUpdatedAt('products', id, { ...getDevicePayload(), ...(payload || {}) })
  return route(
    'products:update',
    () => apiFetch('PUT', `/api/products/${encodeId(id)}`, body),
    null,
    true,
  )
}

export async function deleteProduct(id: string | number, reason?: string): Promise<unknown> {
  const payload = await withExpectedUpdatedAt('products', id, { reason: reason ?? '' })
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
export function mergeDuplicateProducts(): Promise<unknown> {
  return route(
    'products:mergeDuplicates',
    () => apiFetch('POST', '/api/products/merge-duplicates'),
    null,
    true,
  )
}

// Read-only dry run for the endpoint above (GET /api/products/merge-
// duplicates/preview) -- lets MergeDuplicatesReviewModal show exactly
// which products would merge before the person commits to the real POST.
// Deliberately not routed through `route()`'s write-queue/offline-replay
// machinery the way mergeDuplicateProducts() above is: this never mutates
// anything, so there's nothing to replay if it fails offline -- a plain
// apiFetch that the modal can just retry is the right shape for a GET.
export function previewMergeDuplicateProducts(): Promise<unknown> {
  return apiFetch('GET', '/api/products/merge-duplicates/preview')
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

export function dismissProductDuplicateCluster(type: 'barcode' | 'name', value: string): Promise<unknown> {
  return route(
    'products:dismissDuplicateCluster',
    () => apiFetch('POST', '/api/products/possible-duplicates/dismiss', { type, value }),
    null,
    true,
  )
}

export function mergePossiblySameProducts(keepId: number | string, mergeId: number | string): Promise<unknown> {
  return route(
    'products:mergePossiblySame',
    () => apiFetch('POST', '/api/products/possible-duplicates/merge', { keepId, mergeId }),
    null,
    true,
  )
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
