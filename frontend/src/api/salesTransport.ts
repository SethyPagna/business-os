import { SYNC } from '../constants.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { apiFetch, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

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

export function createSaleWithoutWriteDedupe(payload: SalePayload): Promise<unknown> {
  return apiFetch(
    'POST',
    '/api/sales',
    payload,
    SYNC.REQUEST_TIMEOUT_MS,
    { skipWriteDedupe: true },
  )
}

export function getSales(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  const mirror = query ? undefined : mirrorTable('sales')
  return routeMirrored(
    `sales:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales', query)),
    async () => {
      const db = await getLocalDb()
      return db.table('sales').orderBy('created_at').reverse().limit(1000).toArray()
    },
    mirror,
  )
}

export async function updateSaleStatus(
  id: number | string,
  saleStatus: unknown,
  notes?: unknown,
  // Cancellation payload (Part 383): cancel_reason / cancel_note /
  // cancel_fee_usd / cancel_fee_khr / cancel_fee_note. The backend
  // REFUSES a transition to 'cancelled' without a reason, so callers
  // collect it (CancelSaleModal) before calling this.
  extra?: Record<string, unknown> | null,
): Promise<unknown> {
  const payload = await withExpectedUpdatedAt('sales', id, {
    ...getDevicePayload(),
    sale_status: saleStatus,
    notes,
    ...(extra || {}),
  })
  try {
    const result = await route(
      'sales:updateStatus',
      () => apiFetch('PATCH', `/api/sales/${encodeId(id)}/status`, payload),
      null,
      true,
    )
    const db = await getLocalDb()
    await db.table('sales').update(id, {
      sale_status: saleStatus,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttempted(error, { sale_status: saleStatus, notes })
  }
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
      customer_address: result?.customer?.address || null,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttempted(error, {
      customer_id: payload?.customer_id || null,
      customer_name: payload?.customer_name || '',
      customer_phone: payload?.customer_phone || '',
      customer_address: payload?.customer_address || '',
    })
  }
}

export type SaleItemAddition = {
  product_id: number
  quantity: number
  applied_price_usd?: number
  branch_id?: number | null
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
 */
export async function addSaleItems(
  id: number | string,
  items: SaleItemAddition[] = [],
  notes = '',
): Promise<unknown> {
  const body = await withExpectedUpdatedAt('sales', id, {
    ...getDevicePayload(),
    items,
    notes,
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
