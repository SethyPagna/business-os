import { SYNC } from '../constants.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { apiFetch, cacheInvalidate, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { mirrorReadResult, mirrorTable } from './localMirrors.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { contactDisplayAddress } from '../components/contacts/contactOptionUtils.ts'

type SalePayload = ExpectedUpdatedAtPayload
type ResultRecord = Record<string, unknown>
type CustomerRecord = {
  id?: unknown
  name?: unknown
  membership_number?: unknown
  phone?: unknown
  address?: unknown
}
type SaleAttachCustomerResult = ResultRecord & { customer?: CustomerRecord }
type AttemptedError = Error & { attempted?: unknown }
export type SalesReadOptions = { signal?: AbortSignal; timeoutMs?: number }
export const SALES_LIST_REQUEST_TIMEOUT_MS = 20_000

function encodeId(id: number | string): string {
  return encodeURIComponent(String(id))
}

function getDevicePayload(): SalePayload {
  return { ...getClientDeviceInfo() }
}

function getResultTimestamp(result: unknown): string {
  const row = (result || {}) as ResultRecord
  return String(row.updated_at || row.updatedAt || new Date().toISOString())
}

function attachAttempted(error: unknown, attempted: unknown): never {
  if (error && typeof error === 'object') {
    const attemptedError = error as AttemptedError
    attemptedError.attempted = attempted
  }
  throw error
}

export function createSale(payload: SalePayload): Promise<unknown> {
  return route(
    'sales:create',
    () => apiFetch('POST', '/api/sales', payload),
    null,
    true,
  )
}

export type BulkSaleCancelInput = { reason: string; note?: string; fee_usd?: number; fee_khr?: number; fee_note?: string }
export type BulkSaleStatusItem = { id: number; expected_status: string; expected_updated_at: string | null; cancel?: BulkSaleCancelInput }
export type BulkSaleStatusResult = { actionHistoryId: number; changedCount: number; unchangedCount: number; changedIds: number[]; unchangedIds: number[] }
export type BulkSaleStatusPayload = { client_request_id: string; items: BulkSaleStatusItem[]; target_status: string; source_status?: string; skip_stock?: boolean; cancel_reason?: string; cancel_note?: string }

export function buildBulkSaleCancelInput(draft: { cancel_reason: string; cancel_note?: string; cancel_fee_usd?: string | number; cancel_fee_khr?: string | number; cancel_fee_note?: string }): BulkSaleCancelInput {
  const feeUsd = Number(draft.cancel_fee_usd)
  const feeKhr = Number(draft.cancel_fee_khr)
  return {
    reason: String(draft.cancel_reason || ''),
    ...(String(draft.cancel_note || '').trim() ? { note: String(draft.cancel_note).trim() } : {}),
    ...(Number.isFinite(feeUsd) && feeUsd > 0 ? { fee_usd: feeUsd } : {}),
    ...(Number.isFinite(feeKhr) && feeKhr > 0 ? { fee_khr: feeKhr } : {}),
    ...(String(draft.cancel_fee_note || '').trim() ? { fee_note: String(draft.cancel_fee_note).trim() } : {}),
  }
}
export async function updateSalesBulkStatus(payload: BulkSaleStatusPayload): Promise<BulkSaleStatusResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connect to the server to change sale status.')
  const result = await route('sales:bulkStatus', () => apiFetch('POST', '/api/sales/bulk-status', payload), null, true) as BulkSaleStatusResult
  // This write also creates server history; its next read must see the group.
  cacheInvalidate('actionHistory')
  return result
}
export function createSaleWithoutWriteDedupe(payload: SalePayload): Promise<unknown> {
  return apiFetch(
    'POST',
    '/api/sales',
    payload,
    SYNC.REQUEST_TIMEOUT_MS,
    { skipWriteDedupe: true },
  )
}

export type BulkSaleUpdatePayload = {
  client_request_id: string
  items: Array<{ id: number; expected_updated_at: string | null }>
  action:
    | { kind: 'payment_method'; source: string | null; target: string }
    | { kind: 'delivery_contact' | 'customer'; source_id: number | null; target_id: number | null }
}
export type BulkSaleUpdateResult = { actionHistoryId?: number; changedCount: number; unchangedCount: number; changedIds?: number[]; unchangedIds?: number[] }

export async function updateSalesBulkField(payload: BulkSaleUpdatePayload): Promise<BulkSaleUpdateResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connect to the server to update sales.')
  const result = await route('sales:bulkUpdate', () => apiFetch('POST', '/api/sales/bulk-update', payload), null, true) as BulkSaleUpdateResult
  cacheInvalidate('actionHistory')
  return result
}

export function getSales(params: QueryParams = {}, options: SalesReadOptions = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  const mirror = query ? undefined : mirrorTable('sales')
  return route(
    `sales:get:${query}`,
    async () => mirrorReadResult(
      mirror,
      await apiFetch(
        'GET',
        appendQuery('/api/sales', query),
        undefined,
        options.timeoutMs ?? SALES_LIST_REQUEST_TIMEOUT_MS,
        { signal: options.signal },
      ),
    ),
    async () => {
      const db = await getLocalDb()
      return db.table('sales').orderBy('created_at').reverse().limit(1000).toArray()
    },
    // A timed-out list request has already consumed the page's whole read
    // budget. Keep the ordinary retry for an immediate connection failure,
    // but do not start another full timeout window after that budget expires.
    {
      // Live-server Sales data is a sensitive mirror and is purged by policy.
      // Waiting for the server path keeps cancellation observable instead of
      // converting an explicit abort into a background Dexie fallback race.
      raceLocalFallback: false,
      // The caller owns the AbortController until this promise settles. Await
      // a stale cache refresh so returning a stale value cannot make the page
      // abort its own still-running background request in `finally`.
      staleWhileRevalidate: false,
      retryTimedOutRead: false,
      signal: options.signal,
    },
  )
}

export type PreparedSaleStatusRequest = ExpectedUpdatedAtPayload & { client_request_id: string }

export type SaleStatusReceipt = { committed: boolean; response?: Record<string, unknown> }

/** No cache or local fallback: this read is used to converge after a receipt. */
export function getAuthoritativeSale(id: number | string): Promise<unknown> {
  return apiFetch('GET', `/api/sales?id=${encodeId(id)}&limit=2&_detail=${Date.now()}-${Math.random()}`, undefined, 8000)
}

/** Authoritative actor/request receipt check; does not submit another mutation. */
export function getSaleStatusReceipt(id: number | string, payload: PreparedSaleStatusRequest): Promise<SaleStatusReceipt> {
  return apiFetch('POST', `/api/sales/${encodeId(id)}/status-receipt`, payload, 8000, { skipWriteDedupe: true }) as Promise<SaleStatusReceipt>
}

export function getSaleLineReceipt(id: number | string, kind: 'add_items' | 'amendment', payload: Record<string, unknown>): Promise<SaleStatusReceipt> {
  return apiFetch('POST', `/api/sales/${encodeId(id)}/line-receipt/${kind}`, payload, 8000, { skipWriteDedupe: true }) as Promise<SaleStatusReceipt>
}

export async function prepareSaleStatusRequest(
  id: number | string,
  saleStatus: unknown,
  notes?: unknown,
  // Cancellation payload (Part 383): cancel_reason / cancel_note /
  // cancel_fee_usd / cancel_fee_khr / cancel_fee_note. The backend
  // REFUSES a transition to 'cancelled' without a reason, so callers
  // collect it (CancelSaleModal) before calling this.
  extra?: Record<string, unknown> | null,
): Promise<PreparedSaleStatusRequest> {
  const payload = await withExpectedUpdatedAt('sales', id, ensureClientRequestId({
    ...getDevicePayload(),
    sale_status: saleStatus,
    notes,
    ...(extra || {}),
  }, 'sale-status'))
  return payload as PreparedSaleStatusRequest
}

export async function submitSaleStatusRequest(id: number | string, payload: PreparedSaleStatusRequest): Promise<unknown> {
  if (!String(payload?.client_request_id || '').trim()) {
    throw new Error('Sale status updates require a prepared client_request_id.')
  }
  try {
    const result = await route(
      'sales:updateStatus',
      () => apiFetch('PATCH', `/api/sales/${encodeId(id)}/status`, payload),
      null,
      true,
    )
    const db = await getLocalDb()
    await db.table('sales').update(id, {
      sale_status: payload.sale_status,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttempted(error, { sale_status: payload.sale_status, notes: payload.notes })
  }
}

export async function updateSaleStatus(
  id: number | string,
  saleStatus: unknown,
  notes?: unknown,
  extra?: Record<string, unknown> | null,
): Promise<unknown> {
  return submitSaleStatusRequest(id, await prepareSaleStatusRequest(id, saleStatus, notes, extra))
}

export async function attachSaleCustomer(
  id: number | string,
  payload: SalePayload = {},
): Promise<unknown> {
  const body = await withExpectedUpdatedAt('sales', id, { ...getDevicePayload(), ...(payload || {}) })
  try {
    const result = await route(
      'sales:attachCustomer',
      () => apiFetch('PATCH', `/api/sales/${encodeId(id)}/customer`, body),
      null,
      true,
    ) as SaleAttachCustomerResult
    const db = await getLocalDb()
    await db.table('sales').update(id, {
      customer_id: result?.customer?.id || null,
      customer_name: result?.customer?.name || null,
      customer_membership_number: result?.customer?.membership_number || null,
      customer_phone: result?.customer?.phone || null,
      // N21: the response carries the customer's RAW address column (the
      // Contact Options JSON); the server stored the display address on the
      // sale. Mirror what the server stored, or the sale detail shows the JSON
      // again the moment this device reads its local copy offline.
      customer_address: contactDisplayAddress(result?.customer?.address) || null,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttempted(error, {
      customer_id: payload?.customer_id || null,
      customer_name: payload?.customer_name || '',
      customer_phone: payload?.customer_phone || '',
      customer_address: contactDisplayAddress(payload?.customer_address) || '',
    })
  }
}

export type SaleItemAddition = {
  product_id: number
  quantity: number
  applied_price_usd?: number
  branch_id?: number | null
  batch_id?: number
  batch_label?: string
  batch_expiry_date?: string
  // Explicitly selects branch stock that is not represented by a received-
  // date lot. Omitting this is a different instruction: normal server FIFO.
  unlotted_stock?: boolean
}

/**
 * S4-24b: add product lines to a sale that already exists (POST
 * /api/sales/:id/items). Carries the same expected-updated-at stamp every
 * other sale write does, so two people editing the same receipt get a write
 * conflict rather than a silent last-write-wins.
 *
 * Deliberately NOT mirrored to the local db and NOT queued offline: it moves
 * stock and changes what the customer owes against a row whose current state
 * only the server knows. A replay from an outbox minutes later could deduct
 * units a different sale has since taken.
 *
 * N18: `review.client_request_id` is CHECKED here rather than assumed. The
 * Worker rejects a body without one, and the caller's id must be the STABLE
 * per-user-action id (SaleDetailModal's addRequestIdRef) -- minting one here
 * would make every retry a fresh request and re-add the same lines. So a
 * caller that lost the id fails locally, immediately and by name, instead of
 * spending a round trip to earn an opaque 400. (This is the guard; the actual
 * loss was api/methods.ts's registry wrapper dropping the fourth argument.)
 */
export async function addSaleItems(
  id: number | string,
  items: SaleItemAddition[] = [],
  notes = '',
  review: { client_request_id: string; expected_exchange_rate: number; expected_updated_at?: string },
): Promise<unknown> {
  if (!String(review?.client_request_id || '').trim()) {
    throw new Error("addSaleItems needs the caller's stable client_request_id; it must never be generated per request.")
  }
  const body = await withExpectedUpdatedAt('sales', id, {
    ...getDevicePayload(),
    items,
    notes,
    ...review,
  })
  try {
    const result = await route(
      'sales:addItems',
      () => apiFetch('POST', `/api/sales/${encodeId(id)}/items`, body),
      null,
      true,
    ) as ResultRecord
    const db = await getLocalDb()
    await db.table('sales').update(id, {
      subtotal_usd: result?.subtotalUsd,
      total_usd: result?.totalUsd,
      total_khr: result?.totalKhr,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttempted(error, { items, notes })
  }
}

export interface SaleAmendmentRequest {
  kind: 'line_quantity_increased' | 'line_quantity_decreased' | 'line_removed' | 'line_updated' | 'line_replaced' | 'delivery_fee_changed' | 'delivery_actual_cost_changed' | 'delivery_added'
  sale_item_id?: number
  quantity?: number
  applied_price_usd?: number
  delivery_fee_usd?: number
  delivery_actual_cost_usd?: number | string | null
  delivery_contact_id?: number
  replacement?: { product_id: number; quantity: number; applied_price_usd?: number; branch_id?: number | null }
  notes?: string
  client_request_id: string
  expected_exchange_rate: number
  expected_updated_at?: string
}

/**
 * S4-30: amend a recorded sale (POST /api/sales/:id/amendments).
 *
 * Same discipline as addSaleItems above and for the same reasons: it carries
 * the expected-updated-at stamp so two people correcting the same receipt get
 * a write conflict rather than a silent last-write-wins, and it is
 * deliberately NOT queued offline -- it moves stock in BOTH directions against
 * a row whose current state only the server knows, and a replay from an outbox
 * minutes later could hand back units another sale has since taken.
 *
 * Carries the same client_request_id guard as addSaleItems, for the same
 * reason: POST /amendments refuses a body without one (routes/sales.ts), and
 * the id must be the caller's stable per-action id, never a per-request mint.
 */
export async function amendSale(id: number | string, request: SaleAmendmentRequest): Promise<unknown> {
  if (!String(request?.client_request_id || '').trim()) {
    throw new Error("amendSale needs the caller's stable client_request_id; it must never be generated per request.")
  }
  const body = await withExpectedUpdatedAt('sales', id, {
    ...getDevicePayload(),
    ...request,
  })
  try {
    const result = await route(
      'sales:amend',
      () => apiFetch('POST', `/api/sales/${encodeId(id)}/amendments`, body),
      null,
      true,
    ) as ResultRecord
    const db = await getLocalDb()
    await db.table('sales').update(id, {
      subtotal_usd: result?.subtotalUsd,
      total_usd: result?.totalUsd,
      total_khr: result?.totalKhr,
      ...(result?.isDelivery !== undefined ? { is_delivery: result.isDelivery } : {}),
      ...(result?.deliveryContactId !== undefined ? { delivery_contact_id: result.deliveryContactId } : {}),
      ...(result?.deliveryContactName !== undefined ? { delivery_contact_name: result.deliveryContactName } : {}),
      ...(result?.deliveryContactPhone !== undefined ? { delivery_contact_phone: result.deliveryContactPhone } : {}),
      ...(result?.deliveryContactAddress !== undefined ? { delivery_contact_address: result.deliveryContactAddress } : {}),
      ...(result?.deliveryFeeUsd !== undefined ? { delivery_fee_usd: result.deliveryFeeUsd } : {}),
      ...(result?.deliveryFeeKhr !== undefined ? { delivery_fee_khr: result.deliveryFeeKhr } : {}),
      ...(result?.deliveryFeePaidBy !== undefined ? { delivery_fee_paid_by: result.deliveryFeePaidBy } : {}),
      delivery_actual_cost_usd: result?.deliveryActualCostUsd,
      delivery_actual_cost_khr: result?.deliveryActualCostKhr,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttempted(error, { ...request })
  }
}

/** Sales-scoped driver picker for the atomic add-delivery correction. */
export function getSaleDeliveryOptions(search = ''): Promise<unknown> {
  const query = buildQueryString({ search }, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/sales/delivery-options', query))
}

/**
 * The sale's amendment history (GET /api/sales/:id/amendments) -- the
 * STAFF-facing read. The receipt never calls this: it renders net state, which
 * is the whole point of the ledger split.
 *
 * No local fallback: an empty history fabricated offline would read as "this
 * sale was never amended", which is a wrong answer rather than a missing one.
 */
export function getSaleAmendments(id: number | string): Promise<unknown> {
  return route(
    `sales:amendments:${id}`,
    () => apiFetch('GET', `/api/sales/${encodeId(id)}/amendments`),
    null,
    { raceLocalFallback: false },
  )
}

/**
 * N41: one sale's RECORDS (GET /api/sales/:id/records) -- every change anybody
 * ever made to it, from every writer that records itself somewhere different.
 *
 * NOT getSaleAmendments with a longer name. That one reads the amendment
 * ledger and answers "how was this sale corrected"; this one unions the ledger
 * with audit_logs, the bulk-operation receipt and the sale's own creation, so a
 * sale cancelled inside a bulk action -- which writes nothing the ledger can
 * see -- still says who cancelled it and when.
 *
 * No local fallback, for the same reason the amendment history has none: an
 * empty list fabricated offline reads as "nobody ever touched this sale",
 * which is a wrong answer rather than a missing one.
 */
export function getSaleRecords(id: number | string): Promise<unknown> {
  return route(
    `sales:records:${id}`,
    () => apiFetch('GET', `/api/sales/${encodeId(id)}/records`),
    null,
    { raceLocalFallback: false },
  )
}

export function getSalesExport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `sales:export:${query || 'all'}`,
    () => apiFetch('GET', appendQuery('/api/sales/export', query)),
    // An export must come from the server. Racing a fabricated empty object
    // could win before the live response and produce a blank download.
    null,
    { raceLocalFallback: false },
  )
}

// Unbounded revenue/count aggregate matching the /api/sales list's filters
// (see routes/sales.ts's /stats handler) -- used for the Sales page header
// so it stops silently under-reporting once a filtered range has more rows
// than the list's own page cap.
export function getSalesStats(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    // Aggregate results are filter-specific. A constant channel made the
    // first (usually unfiltered) response a fresh-cache hit for every later
    // search/date/status request, so a one-row receipt search displayed the
    // all-history count and revenue until the cache expired.
    `sales:stats:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales/stats', query)),
    () => ({ total_count: 0, revenue_usd: 0, pending_revenue_usd: 0, truncated_in_list: false }),
  )
}

// Range-scoped figures + fold breakdowns for the Sales page's StatsStrip
// (routes/sales.ts /stats-strip: kernel totals, payment mix, status mix,
// the range's customer returns). Plain apiFetch, no fabricated-zero
// fallback: a failed read should surface as the strip's error/empty state,
// never as an all-zero day that reads as "no sales".
export function getSalesStatsStrip(params: { startDate: string; endDate: string; startTime?: string; endTime?: string; branchId?: string | number }): Promise<unknown> {
  const query = buildQueryString(params as QueryParams, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/sales/stats-strip', query))
}

// ---- Phase X (Part 395): daily report + per-courier delivery totals -------
// No local fallbacks that fabricate zeros: a failed report read should show
// the error path, never an all-zero report that reads as "no sales".

export function getSalesDailyReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `sales:daily-report:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales/daily-report', query)),
    null,
  )
}

export function getSalesDayReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `sales:day-report:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales/day-report', query)),
    null,
  )
}

export function getDeliveryContactReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `sales:delivery-contact-report:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales/delivery-contact-report', query)),
    null,
  )
}

export function getCustomerSalesReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `sales:customer-report:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales/customer-report', query)),
    null,
  )
}
