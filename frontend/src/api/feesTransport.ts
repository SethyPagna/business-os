import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { dispatchResolvedSyncError } from '../utils/syncProblemLifecycle.ts'
import { MoneyPrecisionError, nativeChangeAmounts, type DecimalInput } from '../utils/moneyPrecision.ts'
import { reportUtcBound } from '../components/sales/reports/reportModel.ts'

// Frontend transport for the Fees page (cloudflare/src/routes/fees.ts).
// No local/offline mirror -- same reasoning as notesTransport.ts: a failed
// fee save while offline just surfaces as a normal error rather than
// needing an outbox/sync story like sales or inventory writes, since fees
// aren't part of the POS checkout critical path.

// 'expense' joined the set with the old-system expense migration (Part 379):
// 4,240 historical expense entries carry fee_type='expense', and manual
// entry offers it too. The column is free text in D1; this union is the
// frontend's vocabulary.
export type FeeType = 'tax' | 'delivery' | 'change' | 'expense' | 'other'

export type FeeRecord = {
  id: number
  fee_type: FeeType
  label: string | null
  amount_usd: number
  amount_khr: number
  fee_date: string
  sale_id: number | null
  sale_receipt_number?: string | null
  branch_id: number | null
  branch_name?: string | null
  delivery_contact_id: number | null
  delivery_contact_name?: string | null
  notes: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type FeeSummaryRow = {
  fee_type: FeeType
  count: number
  total_usd: number
  total_khr: number
}

export type FeeListResult = {
  fees: FeeRecord[]
  total: number
  limit: number
  offset: number
  summary: FeeSummaryRow[]
}

export type FeeListParams = {
  search?: string
  fee_type?: string
  from?: string
  to?: string
  createdFrom?: string
  createdTo?: string
  sale_id?: number | string
  branch_id?: number | string
  delivery_contact_id?: number | string
  limit?: number
  offset?: number
}

/** Same continuous Cambodia endpoint semantics as Reports: selected end
 * minute included; full-day ranges retain the booked fee_date basis. */
export function feeRangeParams(range: { startDate: string; endDate: string; startTime?: string; endTime?: string }): Pick<FeeListParams, 'from' | 'to' | 'createdFrom' | 'createdTo'> {
  const params: Pick<FeeListParams, 'from' | 'to' | 'createdFrom' | 'createdTo'> = {
    from: range.startDate || undefined, to: range.endDate || undefined,
  }
  const startTime = range.startTime || '00:00'
  const endTime = range.endTime || '23:59'
  if (startTime === '00:00' && endTime === '23:59') return params
  const createdFrom = reportUtcBound(range.startDate, startTime)
  const createdTo = reportUtcBound(range.endDate, endTime, 1)
  if (!createdFrom || !createdTo || createdFrom >= createdTo) throw new RangeError('Expense end date/time must be after the start date/time; both dates are required.')
  return { ...params, createdFrom, createdTo }
}

export type FeePayload = {
  fee_money_version?: 1
  fee_type?: FeeType | string
  label?: string | null
  amount_usd?: number
  amount_khr?: number
  fee_date?: string
  sale_id?: number | null
  branch_id?: number | null
  delivery_contact_id?: number | null
  notes?: string | null
  expectedUpdatedAt?: string | null
  client_request_id?: string
}

export type FeeCreateBody = {
  fee_money_version?: 1
  fee_type: FeeType
  label: string | null
  amount_usd: number
  amount_khr: number
  fee_date: string
  sale_id: number | null
  branch_id: number | null
  delivery_contact_id: number | null
  notes: string | null
}

export type PendingFeeCreate = {
  actor_id: string
  client_request_id: string
  body: FeeCreateBody
  sync_problem?: PendingFeeCreateSyncProblem
}

export type PendingFeeCreateSyncProblem = {
  actor_id: string
  client_request_id: string
  errorId: string
  channel: string
  code: string
}

type FeeCreateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const PENDING_FEE_CREATE_PREFIX = 'businessos_pending_fee_create_v2:'

export class FeeCreatePersistenceError extends Error {
  code = 'pending_request_persistence_failed'

  constructor() {
    super('This expense was not sent because its exact retry request could not be saved. Clear browser site storage, then try again.')
    this.name = 'FeeCreatePersistenceError'
  }
}

export class FeeCreatePendingRequestError extends Error {
  code = 'pending_fee_create_exists'
  pending: PendingFeeCreate

  constructor(pending: PendingFeeCreate) {
    super('A previous expense request still has an unknown result. Retry the original request or discard it before starting another.')
    this.name = 'FeeCreatePendingRequestError'
    this.pending = pending
  }
}

export class FeeCreateVerificationError extends Error {
  code = 'write_outcome_unknown'
  outcome = 'unknown'

  constructor() {
    super('The server response did not contain authoritative evidence for this expense. Retry the exact saved request.')
    this.name = 'FeeCreateVerificationError'
  }
}

function feeCreateActorId(value: number | string | null | undefined): string | null {
  const actorId = Number(String(value ?? '').trim())
  return Number.isSafeInteger(actorId) && actorId > 0 ? String(actorId) : null
}

export function pendingFeeCreateStorageKey(actorId: number | string): string {
  return `${PENDING_FEE_CREATE_PREFIX}${encodeURIComponent(String(actorId).trim())}`
}

function feeCreateStorage(): FeeCreateStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function roundFeeMoney(value: unknown): number {
  const numeric = Number(value)
  const nonNegative = Number.isFinite(numeric) ? Math.max(numeric, 0) : 0
  return Math.round((nonNegative + Number.EPSILON) * 100) / 100
}

function feeMoneyVersion(payload: FeePayload): 1 | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, 'fee_money_version')) return undefined
  if (payload.fee_money_version !== 1) throw new MoneyPrecisionError('invalid_decimal')
  return 1
}

function feeMoney(payload: FeePayload, currency: 'usd' | 'khr', version: 1 | undefined): number {
  const key = currency === 'usd' ? 'amount_usd' : 'amount_khr'
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return 0
  if (!version) return roundFeeMoney(payload[key])
  const value = payload[key] as DecimalInput
  const change = nativeChangeAmounts({ paidUsd: currency === 'usd' ? value : 0,
    paidKhr: currency === 'khr' ? value : 0, payableUsd: 0, exchangeRate: 1, changeExchangeRate: 1 })
  return currency === 'usd' ? change.changeUsd : change.changeKhr
}

function optionalFeeId(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

/** Match the normalized intent the Worker hashes; transient UI-only fields
 * and caller-supplied request IDs are deliberately excluded. */
export function normalizeFeeCreateBody(payload: FeePayload): FeeCreateBody {
  const version = feeMoneyVersion(payload)
  const amountUsd = feeMoney(payload, 'usd', version), amountKhr = feeMoney(payload, 'khr', version)
  if (version && amountUsd === 0 && amountKhr === 0) throw new MoneyPrecisionError('invalid_decimal')
  const type = String(payload.fee_type || '').trim().toLowerCase()
  const rawLabel = typeof payload.label === 'string' ? payload.label.trim().replace(/\s+/g, ' ') : ''
  const label = rawLabel.split(' ').slice(0, 6).join(' ').slice(0, 60).trim()
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : ''
  return {
    fee_type: (['tax', 'delivery', 'change', 'expense', 'other'].includes(type) ? type : 'other') as FeeType,
    label: label || null,
    amount_usd: amountUsd,
    amount_khr: amountKhr,
    fee_date: String(payload.fee_date || '').trim(),
    sale_id: optionalFeeId(payload.sale_id),
    branch_id: optionalFeeId(payload.branch_id),
    delivery_contact_id: optionalFeeId(payload.delivery_contact_id),
    notes: notes ? notes.slice(0, 2000) : null,
    ...(version ? { fee_money_version: version } : {}),
  }
}

function readPendingFeeCreate(storage: FeeCreateStorage, actorId: string): PendingFeeCreate | null {
  try {
    const parsed = JSON.parse(storage.getItem(pendingFeeCreateStorageKey(actorId)) || 'null') as PendingFeeCreate | null
    const requestId = String(parsed?.client_request_id || '').trim()
    if (!parsed || parsed.actor_id !== actorId || !/^[A-Za-z0-9_-]{8,120}$/.test(requestId) || !parsed.body) return null
    // Validate structure, not re-normalized text. Legacy trim-then-truncate
    // notes can legitimately end in whitespace; retry must retain those bytes.
    const body = parsed.body
    const version = feeMoneyVersion(body)
    const keys = ['fee_type','label','amount_usd','amount_khr','fee_date','sale_id','branch_id','delivery_contact_id','notes', ...(version ? ['fee_money_version'] : [])]
    if (Object.keys(body).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(body,key))) return null
    if (!['tax','delivery','change','expense','other'].includes(body.fee_type) || typeof body.fee_date !== 'string') return null
    if ([body.label,body.notes].some(value => value !== null && typeof value !== 'string')) return null
    if ([body.sale_id,body.branch_id,body.delivery_contact_id].some(value => value !== null && (!Number.isSafeInteger(value) || value <= 0))) return null
    if ([body.amount_usd,body.amount_khr].some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null
    if (version && (feeMoney(body,'usd',version) !== body.amount_usd || feeMoney(body,'khr',version) !== body.amount_khr
      || (body.amount_usd === 0 && body.amount_khr === 0))) return null
    const syncProblem = parsed.sync_problem
    const normalizedProblem = syncProblem
      && syncProblem.actor_id === actorId
      && syncProblem.client_request_id === requestId
      && String(syncProblem.errorId || '').trim()
      && String(syncProblem.channel || '').trim()
      && String(syncProblem.code || '').trim()
      ? {
          actor_id: actorId,
          client_request_id: requestId,
          errorId: String(syncProblem.errorId).trim(),
          channel: String(syncProblem.channel).trim(),
          code: String(syncProblem.code).trim(),
        }
      : undefined
    return {
      actor_id: actorId,
      client_request_id: requestId,
      body: parsed.body,
      ...(normalizedProblem ? { sync_problem: normalizedProblem } : {}),
    }
  } catch {
    return null
  }
}

export function getPendingFeeCreate(
  actorIdValue: number | string | null | undefined,
  storage: FeeCreateStorage | null = feeCreateStorage(),
): PendingFeeCreate | null {
  const actorId = feeCreateActorId(actorIdValue)
  return actorId && storage ? readPendingFeeCreate(storage, actorId) : null
}

/** Persist one actor-scoped stable identity and its original normalized body
 * before POST /api/fees can start. A changed draft can neither replace the
 * body nor borrow its request ID. */
export function prepareFeeCreatePayload(
  payload: FeePayload,
  actorIdValue: number | string | null | undefined,
  storage: FeeCreateStorage | null = feeCreateStorage(),
  createRequestId: () => string = () => crypto.randomUUID(),
): FeePayload & { client_request_id: string } {
  const actorId = feeCreateActorId(actorIdValue)
  if (!actorId || !storage) throw new FeeCreatePersistenceError()
  try {
    const pending = readPendingFeeCreate(storage, actorId)
    // The exact stored intent bypasses all fresh normalization, including
    // legacy text normalization that is not necessarily idempotent at a cap.
    if (pending && Object.keys(payload).filter(key => key !== 'client_request_id').length === Object.keys(pending.body).length
      && Object.entries(pending.body).every(([key,value]) => (payload as unknown as Record<string, unknown>)[key] === value)) {
      return { ...pending.body, client_request_id: pending.client_request_id }
    }
    const body = normalizeFeeCreateBody(payload)
    if (pending) {
      if (Object.keys(body).length !== Object.keys(pending.body).length
        || Object.entries(body).some(([key, value]) => (pending.body as unknown as Record<string, unknown>)[key] !== value)) throw new FeeCreatePendingRequestError(pending)
      return { ...pending.body, client_request_id: pending.client_request_id }
    }
    const requestId = String(payload.client_request_id || createRequestId()).trim()
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) throw new Error('invalid request id')
    const envelope: PendingFeeCreate = { actor_id: actorId, client_request_id: requestId, body }
    const serialized = JSON.stringify(envelope)
    const key = pendingFeeCreateStorageKey(actorId)
    storage.setItem(key, serialized)
    if (storage.getItem(key) !== serialized) throw new Error('pending request read-back failed')
    return { ...body, client_request_id: requestId }
  } catch (error) {
    if (error instanceof FeeCreatePersistenceError || error instanceof FeeCreatePendingRequestError || error instanceof MoneyPrecisionError) throw error
    throw new FeeCreatePersistenceError()
  }
}

export function clearPendingFeeCreate(
  actorIdValue: number | string | null | undefined,
  requestId: string,
  storage: FeeCreateStorage | null = feeCreateStorage(),
): void {
  const actorId = feeCreateActorId(actorIdValue)
  if (!actorId || !storage) return
  try {
    const pending = readPendingFeeCreate(storage, actorId)
    if (pending?.client_request_id === requestId) storage.removeItem(pendingFeeCreateStorageKey(actorId))
  } catch {
    // A confirmed server receipt is authoritative. A stale local slot is
    // harmless because its request id will replay rather than duplicate.
  }
}

/** Explicit operator discard owns both pieces of the same unresolved work:
 * remove only the exact actor/request envelope, then resolve only the warning
 * identity stored on that envelope. A mismatched request is a no-op, and a
 * failed removal cannot dismiss a warning while its retry remains pending. */
export function discardPendingFeeCreate(
  actorIdValue: number | string | null | undefined,
  requestId: string,
  storage: FeeCreateStorage | null = feeCreateStorage(),
): boolean {
  const actorId = feeCreateActorId(actorIdValue)
  if (!actorId || !storage) return false
  const pending = readPendingFeeCreate(storage, actorId)
  if (!pending || pending.client_request_id !== requestId) return false
  try {
    storage.removeItem(pendingFeeCreateStorageKey(actorId))
    if (readPendingFeeCreate(storage, actorId)?.client_request_id === requestId) return false
  } catch {
    return false
  }
  dispatchResolvedSyncError(pending.sync_problem)
  return true
}

/** A successful status alone is insufficient: an edge/proxy or malformed
 * Worker response must not make the browser forget an unresolved request.
 * The returned row carries server-only identity/timestamps and must match
 * every normalized intent field plus the authenticated actor. */
export function isAuthoritativeFeeCreateResponse(
  response: unknown,
  pending: PendingFeeCreate,
): response is { fee: FeeRecord } {
  const fee = (response as { fee?: Partial<FeeRecord> } | null)?.fee
  const body = pending.body
  if (!fee || typeof fee !== 'object') return false
  if (!Number.isSafeInteger(fee.id) || Number(fee.id) <= 0) return false
  if (!Number.isFinite(Date.parse(String(fee.created_at || ''))) || !Number.isFinite(Date.parse(String(fee.updated_at || '')))) return false
  if (fee.created_at !== fee.updated_at) return false
  if (fee.created_by !== Number(pending.actor_id)) return false
  if (fee.created_by_name !== null && typeof fee.created_by_name !== 'string') return false
  if (fee.fee_type !== body.fee_type || fee.label !== body.label || fee.fee_date !== body.fee_date || fee.notes !== body.notes) return false
  if (typeof fee.amount_usd !== 'number' || fee.amount_usd !== body.amount_usd) return false
  if (typeof fee.amount_khr !== 'number' || fee.amount_khr !== body.amount_khr) return false
  if (fee.sale_id !== body.sale_id || fee.delivery_contact_id !== body.delivery_contact_id) return false
  if (body.branch_id == null) return Number.isSafeInteger(Number(fee.branch_id)) && Number(fee.branch_id) > 0
  return fee.branch_id === body.branch_id
}

function rememberPendingFeeCreateProblem(
  pending: PendingFeeCreate,
  error: unknown,
  storage: FeeCreateStorage | null,
): void {
  if (!storage || (error as { outcome?: unknown } | null)?.outcome !== 'unknown') return
  const value = error as { syncErrorId?: unknown; syncErrorChannel?: unknown; code?: unknown }
  const errorId = String(value.syncErrorId || '').trim()
  const channel = String(value.syncErrorChannel || '').trim()
  const code = String(value.code || '').trim()
  if (!errorId || !channel || !code) return
  const current = readPendingFeeCreate(storage, pending.actor_id)
  if (!current || current.client_request_id !== pending.client_request_id) return
  const next: PendingFeeCreate = {
    ...current,
    sync_problem: {
      actor_id: pending.actor_id,
      client_request_id: pending.client_request_id,
      errorId,
      channel,
      code,
    },
  }
  try {
    storage.setItem(pendingFeeCreateStorageKey(pending.actor_id), JSON.stringify(next))
  } catch {
    // The original immutable request remains durable even if enriching it
    // with banner identity fails; never discard the safer retry state.
  }
}

export function getFees(params: FeeListParams = {}): Promise<FeeListResult> {
  const query = buildQueryString(params as QueryParams)
  return route(
    // route() uses this channel as both its 20-second cache key and its
    // in-flight de-duplication key. Include every effective list parameter;
    // otherwise page 2, a new page size, or a changed filter can reuse page
    // 1's cached response and make the pagination controls look broken.
    `fees:get:${query || 'all'}`,
    () => apiFetch('GET', appendQuery('/api/fees', query)),
    () => ({ fees: [], total: 0, limit: 100, offset: 0, summary: [] }),
    { raceLocalFallback: false },
  ) as Promise<FeeListResult>
}

// Fetch EVERY expense record matching the given filters (for CSV export),
// paginating past the server's 500-row cap (routes/fees.ts clamps limit to
// 500). Two deliberate choices keep the result complete and correct:
//   - It calls apiFetch directly rather than filling the interactive list's
//     short-lived route cache with every export page. apiFetch's GET de-dupe
//     key includes the offset in the path, so every page is distinct.
//   - The loop is driven by the server's reported `total`, so it stops exactly
//     when every matching row has been gathered and never truncates a real
//     set; a page ceiling derived from that same total guards against a
//     malformed response spinning forever.
export async function getAllFeesForExport(
  params: Omit<FeeListParams, 'limit' | 'offset'> = {},
  onProgress?: (loaded: number, total: number) => void,
): Promise<FeeRecord[]> {
  const PAGE = 500
  const all: FeeRecord[] = []
  let offset = 0
  let total = 0
  let pagesRemaining = 1
  do {
    const query = buildQueryString({ ...params, limit: PAGE, offset } as QueryParams)
    const result = (await apiFetch('GET', appendQuery('/api/fees', query))) as FeeListResult | null
    const rows = Array.isArray(result?.fees) ? result!.fees : []
    if (offset === 0) {
      total = Number(result?.total) || rows.length
      pagesRemaining = Math.max(1, Math.ceil(total / PAGE))
    }
    all.push(...rows)
    onProgress?.(all.length, total)
    offset += PAGE
    pagesRemaining -= 1
    if (rows.length < PAGE) break // server ran out early -- nothing more to page
  } while (all.length < total && pagesRemaining > 0)
  return all
}

// Every distinct saved label with its usage count and dominant fee type,
// most-used first (GET /api/fees/labels). FeeForm offers these as
// suggestions and auto-picks the dominant type when a known label is chosen.
export type FeeLabelSuggestion = {
  label: string
  uses: number
  fee_type: FeeType
  type_counts?: Array<{ fee_type: FeeType; uses: number }>
}

export function getFeeLabels(): Promise<{ labels: FeeLabelSuggestion[] }> {
  return route(
    'fees:labels',
    () => apiFetch('GET', '/api/fees/labels'),
    () => ({ labels: [] }),
    { raceLocalFallback: false },
  ) as Promise<{ labels: FeeLabelSuggestion[] }>
}

export function getFeeLabelImpact(from: string, to: string): Promise<unknown> {
  const query = new URLSearchParams({ from, to })
  return apiFetch('GET', `/api/fees/labels/impact?${query.toString()}`)
}

export function replaceFeeLabel(from: string, to: string): Promise<unknown> {
  return apiFetch('POST', '/api/fees/labels/replace', { from, to })
}

export type FeeLabelTypeImpact = {
  label: string
  linked_records: number
  type_counts: Array<{ fee_type: FeeType; uses: number }>
  historical_snapshots_preserved: string[]
}

export function getFeeLabelTypeImpact(label: string): Promise<FeeLabelTypeImpact> {
  const query = new URLSearchParams({ label })
  return apiFetch('GET', `/api/fees/labels/type-impact?${query.toString()}`) as Promise<FeeLabelTypeImpact>
}

export function classifyFeeLabel(label: string, feeType: FeeType): Promise<{ success: boolean; changed: number; label: string; fee_type: FeeType }> {
  return apiFetch('POST', '/api/fees/labels/classify', { label, fee_type: feeType }) as Promise<{ success: boolean; changed: number; label: string; fee_type: FeeType }>
}

export function getFee(id: number): Promise<{ fee: FeeRecord }> {
  // The channel string is BOTH the 20s read-cache key and the in-flight
  // dedupe key in route(); a constant 'fees:get-one' made every id share one
  // slot, so opening fee B within the cache window rendered fee A's data (the
  // same class as the fixed lots-per-channel bug). The id is part of the key
  // now. Write-invalidation still works: it clears by entity prefix
  // (getChannelRefreshKey splits on ':' -> 'fees'), which covers every
  // per-id entry.
  return route(
    `fees:get-one:${id}`,
    () => apiFetch('GET', `/api/fees/${encodeURIComponent(String(id))}`),
    null,
    { raceLocalFallback: false },
  ) as Promise<{ fee: FeeRecord }>
}

// Reports hub: fee totals over a range (startDate/endDate/branchId), keyed on
// fee_date. Mirrors the sales daily-report transport shape.
export function getFeesReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `fees:report:${query}`,
    () => apiFetch('GET', appendQuery('/api/fees/report', query)),
    null,
    { raceLocalFallback: false },
  )
}

export async function createFee(payload: FeePayload, actorId: number | string | null | undefined): Promise<{ fee: FeeRecord }> {
  const storage = feeCreateStorage()
  const prepared = prepareFeeCreatePayload(payload, actorId, storage)
  const pending = getPendingFeeCreate(actorId, storage)
  if (!pending || pending.client_request_id !== prepared.client_request_id) throw new FeeCreatePersistenceError()
  let response: { fee: FeeRecord }
  try {
    response = await route(
      `fees:create:${pending.actor_id}:${pending.client_request_id}`,
      async () => {
        const result = await apiFetch('POST', '/api/fees', prepared)
        if (!isAuthoritativeFeeCreateResponse(result, pending)) throw new FeeCreateVerificationError()
        return result
      },
      null,
      true,
    ) as { fee: FeeRecord }
  } catch (error) {
    rememberPendingFeeCreateProblem(pending, error, storage)
    throw error
  }
  clearPendingFeeCreate(pending.actor_id, pending.client_request_id, storage)
  dispatchResolvedSyncError(pending.sync_problem)
  return response
}

export function updateFee(id: number, payload: FeePayload): Promise<{ fee: FeeRecord }> {
  return route(
    'fees:update',
    () => apiFetch('PUT', `/api/fees/${encodeURIComponent(String(id))}`, payload),
    null,
    true,
  ) as Promise<{ fee: FeeRecord }>
}

export function deleteFee(id: number): Promise<{ success: boolean }> {
  return route(
    'fees:delete',
    () => apiFetch('DELETE', `/api/fees/${encodeURIComponent(String(id))}`),
    null,
    true,
  ) as Promise<{ success: boolean }>
}
