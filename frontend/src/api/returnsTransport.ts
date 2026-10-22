import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { businessDateTimeId } from '../utils/timestampId.ts'
import { buildAttemptedReturnItems } from './conflicts.ts'
import { apiFetch, confirmServerReachable, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { getReturn, getReturns } from './returnsReadTransport.ts'
import type { ReturnBulkPayload, ReturnBulkResult } from '../components/returns/helpers/returnBulkAction.ts'
import { assertActorReadScope, captureActorReadScope, type ActorReadScope } from './actorReadScope.ts'
import { getSyncServerUrl } from './httpState.ts'
import { roundMoney2, roundMoney4, subtractMoney4, sumMoney4 } from '../utils/moneyPrecision.ts'

type ReturnPayload = Record<string, unknown>
export type PreparedReturnUpdateRequest = Record<string, unknown> & { client_request_id: string }
type ReturnUpdateAttempt = {
  reason: unknown
  return_type: unknown
  notes: unknown
  total_refund_usd: unknown
  total_refund_khr: unknown
  items: ReturnType<typeof buildAttemptedReturnItems>
}
type AttemptedError = Error & { attempted?: ReturnUpdateAttempt }
type ResultRecord = Record<string, unknown>

function encodeId(id: number | string): string {
  return encodeURIComponent(String(id))
}

function getDevicePayload(): ReturnPayload {
  return { ...getClientDeviceInfo() }
}

function getResultTimestamp(result: unknown): string {
  const row = (result || {}) as ResultRecord
  return String(row.updated_at || row.updatedAt || new Date().toISOString())
}

// RET-/SRET-YYYYMMDD-HHMMSS (Phnom Penh wall clock) -- same datetime-id
// convention as sales receipts; see utils/timestampId.ts.
function buildReturnNumber(payload: ReturnPayload, prefix: string): string {
  return String(payload.return_number || '').trim() || `${prefix}-${businessDateTimeId()}`
}

function attachAttemptedReturnUpdate(error: unknown, payload: ReturnPayload): never {
  if (error && typeof error === 'object') {
    const attemptedError = error as AttemptedError
    attemptedError.attempted = {
      reason: payload.reason || '',
      return_type: payload.return_type || '',
      notes: payload.notes || '',
      total_refund_usd: payload.total_refund_usd || 0,
      total_refund_khr: payload.total_refund_khr || 0,
      items: buildAttemptedReturnItems(Array.isArray(payload.items) ? payload.items : []),
    }
  }
  throw error
}

export { getReturn, getReturns }

export type ReturnQuoteLineV1 = { sale_item_id: number; quantity: number; total_usd: number; total_khr: number; applied_price_usd: number; applied_price_khr: number }
export type ReturnQuoteV1 = {
  money_precision_version: 1; sale_id: number; sale_revision: number
  calculated_refund_usd: number; rounding_adjustment_usd: number
  total_refund_usd: number; total_refund_khr: number; items: ReturnQuoteLineV1[]
}
// The one-step exchange (6.0.958): the replacement priced and netted against the refund by the Worker, reviewed by the till, then sent back
// beside the customer's own payment rows. Money is dollars; riel is derived at the original sale's rate on both sides.
export type ExchangeQuoteLineV1 = {
  product_id: number; product_name: string; branch_id: number; batch_id: number | null; quantity: number
  unit_price_usd: number; unit_price_khr: number; total_usd: number; total_khr: number
}
export type ExchangeQuoteV1 = {
  version: 1; sale_id: number; exchange_rate: number; not_paid: boolean; lines: ExchangeQuoteLineV1[]
  calculated_total_usd: number; rounding_adjustment_usd: number; total_usd: number; total_khr: number
  refund_usd: number; owed_reduction_usd: number; credit_usd: number; net_usd: number
}
export type ExchangePaymentV1 = { details: Array<{ method: string; amount_usd: number; amount_khr: number }>; change_currency: 'USD' | 'KHR' }
export type ReplacementItemV1 = { product_id: number; branch_id: number | null; batch_id: number | null; quantity: number; applied_price_usd?: number }
export type ReturnCreateV1Body = ReturnPayload & { money_precision_version: 1; client_request_id: string; return_number: string; sale_id: number; expected_quote: ReturnQuoteV1 }
export type PendingReturnCreateV1 = { version: 1; actor: string; origin: string; session: string; createdAt: number; bodyJson: string }
const PENDING_RETURN_V1 = 'businessos_pending_return_create_v1:'
const MAX_RETURN_PENDING_BYTES = 131072
function returnV1Error(code: string): Error { return Object.assign(new Error(code), { code, outcome: 'not_dispatched' }) }
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function finiteMoney(value: unknown, signed = false): value is number {
  try { return typeof value === 'number' && Number.isFinite(value) && (signed || value >= 0) && roundMoney4(value) === value } catch { return false }
}
export function validateReturnQuoteV1(value: unknown): ReturnQuoteV1 {
  const keys = ['money_precision_version', 'sale_id', 'sale_revision', 'calculated_refund_usd', 'rounding_adjustment_usd', 'total_refund_usd', 'total_refund_khr', 'items']
  if (!exactKeys(value, keys) || value.money_precision_version !== 1 || !Number.isSafeInteger(value.sale_id)
    || Number(value.sale_id) <= 0 || !Number.isSafeInteger(value.sale_revision) || Number(value.sale_revision) < 0
    || !Array.isArray(value.items) || !value.items.length || value.items.length > 50) throw returnV1Error('return_v1_review_required')
  const quote = value as unknown as ReturnQuoteV1
  if (![quote.calculated_refund_usd, quote.total_refund_usd, quote.total_refund_khr].every(v => finiteMoney(v))
    || !finiteMoney(quote.rounding_adjustment_usd, true) || Math.abs(quote.rounding_adjustment_usd) >= .01
    || roundMoney2(quote.total_refund_usd) !== quote.total_refund_usd
    || subtractMoney4(quote.total_refund_usd, quote.calculated_refund_usd) !== quote.rounding_adjustment_usd) throw returnV1Error('return_v1_review_required')
  const ids = new Set<number>()
  for (const line of quote.items) {
    if (!exactKeys(line, ['sale_item_id', 'quantity', 'total_usd', 'total_khr', 'applied_price_usd', 'applied_price_khr'])
      || !Number.isSafeInteger(line.sale_item_id) || line.sale_item_id <= 0 || ids.has(line.sale_item_id)
      || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0
      || ![line.total_usd, line.total_khr, line.applied_price_usd, line.applied_price_khr].every(v => finiteMoney(v))) throw returnV1Error('return_v1_review_required')
    ids.add(line.sale_item_id)
  }
  if (sumMoney4(quote.items.map(line => line.total_usd)) !== quote.calculated_refund_usd) throw returnV1Error('return_v1_review_required')
  return JSON.parse(JSON.stringify(quote)) as ReturnQuoteV1
}
export function validateExchangeQuoteV1(value: unknown): ExchangeQuoteV1 {
  const keys = ['version', 'sale_id', 'exchange_rate', 'not_paid', 'lines', 'calculated_total_usd', 'rounding_adjustment_usd', 'total_usd', 'total_khr',
    'refund_usd', 'owed_reduction_usd', 'credit_usd', 'net_usd']
  if (!exactKeys(value, keys) || value.version !== 1 || !Number.isSafeInteger(value.sale_id) || Number(value.sale_id) <= 0 || typeof value.not_paid !== 'boolean'
    || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > 50) throw returnV1Error('return_v1_review_required')
  const quote = value as unknown as ExchangeQuoteV1
  if (!finiteMoney(quote.exchange_rate) || quote.exchange_rate <= 0
    || ![quote.calculated_total_usd, quote.total_usd, quote.total_khr, quote.refund_usd, quote.owed_reduction_usd, quote.credit_usd].every(v => finiteMoney(v))
    || !finiteMoney(quote.rounding_adjustment_usd, true) || !finiteMoney(quote.net_usd, true)) throw returnV1Error('return_v1_review_required')
  for (const line of quote.lines) {
    if (!exactKeys(line, ['product_id', 'product_name', 'branch_id', 'batch_id', 'quantity', 'unit_price_usd', 'unit_price_khr', 'total_usd', 'total_khr'])
      || !Number.isSafeInteger(line.product_id) || line.product_id <= 0 || typeof line.product_name !== 'string' || !Number.isSafeInteger(line.branch_id)
      || !(line.batch_id === null || Number.isSafeInteger(line.batch_id)) || typeof line.quantity !== 'number' || !(line.quantity > 0)
      || ![line.unit_price_usd, line.unit_price_khr, line.total_usd, line.total_khr].every(v => finiteMoney(v))) throw returnV1Error('return_v1_review_required')
  }
  // The same arithmetic the Worker commits: lines sum to the calculated total, the rounding step makes the total, the credit is the refund's
  // cash share, and the net is what is left to collect (or hand back, when negative).
  if (sumMoney4(quote.lines.map(line => line.total_usd)) !== quote.calculated_total_usd
    || sumMoney4([quote.calculated_total_usd, quote.rounding_adjustment_usd]) !== quote.total_usd
    || subtractMoney4(quote.refund_usd, quote.owed_reduction_usd) !== quote.credit_usd
    || subtractMoney4(quote.total_usd, quote.credit_usd) !== quote.net_usd) throw returnV1Error('return_v1_review_required')
  return JSON.parse(JSON.stringify(quote)) as ExchangeQuoteV1
}
function requireReturnCapability(value: unknown): void {
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).customer_return_create_version !== 1) throw returnV1Error('return_v1_unavailable')
}
export async function getReturnQuoteV1(saleId: number, items: Array<{ sale_item_id: number; quantity: number }>): Promise<ReturnQuoteV1> {
  const scope = captureActorReadScope('returns')
  assertActorReadScope(scope)
  if (navigator.onLine === false && !(await confirmServerReachable())) throw returnV1Error('return_v1_unavailable')
  // POST is a read: never route through write invalidation.
  const result = await apiFetch('POST', '/api/returns/quote', { sale_id: saleId, items }) as Record<string, unknown>
  assertActorReadScope(scope)
  requireReturnCapability(result)
  const { customer_return_create_version: _create, customer_return_edit_version: _edit, ...raw } = result
  const quote = validateReturnQuoteV1(raw)
  if (quote.sale_id !== saleId || JSON.stringify(quote.items.map(({ sale_item_id, quantity }) => ({ sale_item_id, quantity }))) !== JSON.stringify(items)) throw returnV1Error('return_v1_review_required')
  return quote
}
// The refund quote AND the replacement quote for one exchange, from one server call: the replacement is priced and netted by the same
// function the commit recomputes it with, so what the till shows is what the create is compared against.
export async function getReturnExchangeQuoteV1(saleId: number, items: Array<{ sale_item_id: number; quantity: number }>, replacementItems: ReplacementItemV1[]): Promise<{ quote: ReturnQuoteV1; exchange: ExchangeQuoteV1 }> {
  const scope = captureActorReadScope('returns')
  assertActorReadScope(scope)
  if (navigator.onLine === false && !(await confirmServerReachable())) throw returnV1Error('return_v1_unavailable')
  const result = await apiFetch('POST', '/api/returns/quote', { sale_id: saleId, items, replacement_items: replacementItems }) as Record<string, unknown>
  assertActorReadScope(scope)
  requireReturnCapability(result)
  const { customer_return_create_version: _create, customer_return_edit_version: _edit, exchange: rawExchange, ...raw } = result
  const quote = validateReturnQuoteV1(raw)
  const exchange = validateExchangeQuoteV1(rawExchange)
  if (quote.sale_id !== saleId || exchange.sale_id !== saleId
    || JSON.stringify(quote.items.map(({ sale_item_id, quantity }) => ({ sale_item_id, quantity }))) !== JSON.stringify(items)
    || exchange.refund_usd !== quote.total_refund_usd) throw returnV1Error('return_v1_review_required')
  return { quote, exchange }
}
function returnPendingScope(actorId: unknown): { actor: string; origin: string; session: string; key: string } {
  assertActorReadScope(captureActorReadScope(), false)
  const actor = String(actorId ?? '').trim()
  if (!/^\d+$/.test(actor) || Number(actor) <= 0) throw returnV1Error('return_v1_session_changed')
  try {
    const user = JSON.parse(window.sessionStorage?.getItem('businessos_user') || window.localStorage.getItem('businessos_user') || 'null') as { id?: unknown } | null
    if (String(user?.id ?? '') !== actor) throw returnV1Error('return_v1_session_changed')
    const origin = `${window.location.origin}|${new URL(getSyncServerUrl() || window.location.origin, window.location.origin).href.replace(/\/$/, '')}`
    const session = window.localStorage.getItem('businessos_read_session')
    if (!session) throw returnV1Error('return_v1_session_changed')
    return { actor, origin, session, key: PENDING_RETURN_V1 + encodeURIComponent(origin) + ':' + actor }
  } catch (error) { if ((error as { code?: string })?.code === 'return_v1_session_changed') throw error; throw returnV1Error('return_v1_storage_failed') }
}
export function pendingReturnCreateBody(pending: PendingReturnCreateV1): ReturnCreateV1Body {
  let body: ReturnCreateV1Body
  try { body = JSON.parse(pending.bodyJson) as ReturnCreateV1Body } catch { throw returnV1Error('return_v1_storage_failed') }
  if (!body || body.money_precision_version !== 1 || typeof body.client_request_id !== 'string' || !body.client_request_id
    || typeof body.return_number !== 'string' || !body.return_number || body.sale_id !== validateReturnQuoteV1(body.expected_quote).sale_id) throw returnV1Error('return_v1_storage_failed')
  if (!Array.isArray(body.items) || body.items.length !== body.expected_quote.items.length
    || body.items.some((item: Record<string, unknown>, index: number) => !item || item.sale_item_id !== body.expected_quote.items[index].sale_item_id
      || item.quantity !== body.expected_quote.items[index].quantity || !['restock', 'damaged', 'none'].includes(String(item.stock_action))
      || Object.hasOwn(item, 'refund_snapshot_json'))) throw returnV1Error('return_v1_storage_failed')
  // An exchange body carries its replacement lines, the reviewed replacement quote and the customer's payment as one frozen unit; a plain
  // return carries none of the three. A half of an exchange can never be retried as something else.
  const lines = Array.isArray(body.replacement_items) ? body.replacement_items : []
  const hasExchange = Object.hasOwn(body, 'expected_exchange') || Object.hasOwn(body, 'exchange_payment')
  if (lines.length === 0 ? hasExchange : !(Object.hasOwn(body, 'expected_exchange') && Object.hasOwn(body, 'exchange_payment'))) throw returnV1Error('return_v1_storage_failed')
  if (lines.length > 0) {
    try {
      const exchange = validateExchangeQuoteV1(body.expected_exchange)
      const payment = body.exchange_payment as ExchangePaymentV1 | null
      if (exchange.sale_id !== body.sale_id || !payment || !Array.isArray(payment.details) || !['USD', 'KHR'].includes(String(payment.change_currency))) throw new Error('shape')
    } catch { throw returnV1Error('return_v1_storage_failed') }
  }
  return body
}
export function loadPendingReturnCreateV1(actorId: unknown): PendingReturnCreateV1 | null {
  const current = returnPendingScope(actorId)
  try {
    const raw = window.localStorage.getItem(current.key)
    if (raw == null) return null
    if (raw.length > MAX_RETURN_PENDING_BYTES) throw new Error('size')
    const pending = JSON.parse(raw) as PendingReturnCreateV1
    if (pending.version !== 1 || pending.actor !== current.actor || pending.origin !== current.origin
      || typeof pending.session !== 'string' || !pending.session || !Number.isFinite(pending.createdAt) || typeof pending.bodyJson !== 'string') throw new Error('shape')
    pendingReturnCreateBody(pending)
    return pending // Session mismatch is quarantined, never deleted or rewritten.
  } catch { throw returnV1Error('return_v1_storage_failed') }
}
export function pendingReturnCreateSessionCurrent(pending: PendingReturnCreateV1, actorId: unknown): boolean {
  const current = returnPendingScope(actorId)
  return pending.actor === current.actor && pending.origin === current.origin && pending.session === current.session
}
export type ReturnCreateRecovery = { scope: ActorReadScope; actor: string; origin: string; bodyJson: string }
const returnRecoveryAuthorizations = new WeakSet<ReturnCreateRecovery>()
// Ephemeral, explicit review authorization. Never rebind the durable envelope.
export function authorizeReturnCreateRecovery(actorId: unknown, pending: PendingReturnCreateV1, reviewed: boolean): ReturnCreateRecovery {
  const current = returnPendingScope(actorId)
  if (reviewed !== true || pending.actor !== current.actor || pending.origin !== current.origin
    || loadPendingReturnCreateV1(actorId)?.bodyJson !== pending.bodyJson) throw returnV1Error('return_v1_review_required')
  const authorization = { scope: captureActorReadScope('returns'), actor: current.actor, origin: current.origin, bodyJson: pending.bodyJson }
  returnRecoveryAuthorizations.add(authorization)
  return authorization
}
function assertReturnCreateAdmission(actorId: unknown, pending: PendingReturnCreateV1, recovery?: ReturnCreateRecovery): void {
  const current = returnPendingScope(actorId)
  if (pending.actor !== current.actor || pending.origin !== current.origin) throw returnV1Error('return_v1_session_changed')
  if (recovery) {
    if (!returnRecoveryAuthorizations.has(recovery) || recovery.actor !== current.actor || recovery.origin !== current.origin
      || recovery.bodyJson !== pending.bodyJson) throw returnV1Error('return_v1_session_changed')
    assertActorReadScope(recovery.scope, false)
  } else if (!pendingReturnCreateSessionCurrent(pending, actorId)) throw returnV1Error('return_v1_session_changed')
}
export async function prepareReturnCreateV1(actorId: unknown, payload: ReturnPayload, quote: ReturnQuoteV1, exchange?: { quote: ExchangeQuoteV1; payment: ExchangePaymentV1; lines: ReplacementItemV1[] } | null): Promise<PendingReturnCreateV1> {
  const scope = captureActorReadScope('returns')
  const current = returnPendingScope(actorId)
  if (!navigator.locks?.request) throw returnV1Error('return_v1_storage_failed')
  return navigator.locks.request(current.key, () => {
  assertActorReadScope(scope, false)
  if (loadPendingReturnCreateV1(actorId)) throw returnV1Error('return_v1_pending')
  const expected = validateReturnQuoteV1(quote)
  const expectedExchange = exchange ? validateExchangeQuoteV1(exchange.quote) : null
  if (exchange && (!exchange.lines.length || expectedExchange!.sale_id !== expected.sale_id)) throw returnV1Error('return_v1_review_required')
  const body = ensureClientRequestId({ ...getDevicePayload(), ...payload, money_precision_version: 1, expected_quote: expected, sale_id: expected.sale_id,
    ...(expectedExchange && exchange ? { replacement_items: exchange.lines, expected_exchange: expectedExchange, exchange_payment: exchange.payment } : {}) }, 'return')
  const pending: PendingReturnCreateV1 = { version: 1, actor: current.actor, origin: current.origin, session: current.session, createdAt: Date.now(),
    bodyJson: JSON.stringify({ ...body, return_number: buildReturnNumber(body, 'RET') }) }
  pendingReturnCreateBody(pending)
  const serialized = JSON.stringify(pending)
  if (serialized.length > MAX_RETURN_PENDING_BYTES) throw returnV1Error('return_v1_storage_failed')
  try {
    window.localStorage.setItem(current.key, serialized)
    if (window.localStorage.getItem(current.key) !== serialized) throw new Error('readback')
  } catch { throw returnV1Error('return_v1_storage_failed') }
  return pending
  })
}
export async function clearPendingReturnCreateV1(actorId: unknown, pending: PendingReturnCreateV1, recovery?: ReturnCreateRecovery): Promise<void> {
  const scope = captureActorReadScope('returns')
  const current = returnPendingScope(actorId)
  if (!navigator.locks?.request) throw returnV1Error('return_v1_storage_failed')
  return navigator.locks.request(current.key, () => {
  assertActorReadScope(scope, false)
  const saved = loadPendingReturnCreateV1(actorId)
  if (!saved) return
  if (saved.bodyJson !== pending.bodyJson) throw returnV1Error('return_v1_session_changed')
  assertReturnCreateAdmission(actorId, pending, recovery)
  try {
    window.localStorage.removeItem(current.key)
    if (window.localStorage.getItem(current.key) != null) throw new Error('readback')
  } catch { throw returnV1Error('return_v1_storage_failed') }
  })
}
const returnCreateFlights = new Set<string>()
export async function submitReturnCreateV1(actorId: unknown, pending: PendingReturnCreateV1, recovery?: ReturnCreateRecovery): Promise<unknown> {
  const scope: ActorReadScope = captureActorReadScope('returns')
  assertActorReadScope(scope, false)
  if (navigator.onLine === false && !(await confirmServerReachable())) throw returnV1Error('return_v1_unavailable')
  assertReturnCreateAdmission(actorId, pending, recovery)
  if (loadPendingReturnCreateV1(actorId)?.bodyJson !== pending.bodyJson) throw returnV1Error('return_v1_session_changed')
  const body = pendingReturnCreateBody(pending)
  if (returnCreateFlights.has(body.client_request_id)) throw returnV1Error('return_v1_pending')
  returnCreateFlights.add(body.client_request_id)
  try {
    const current = returnPendingScope(actorId)
    if (!navigator.locks?.request) throw returnV1Error('return_v1_storage_failed')
    return await navigator.locks.request(current.key, async () => {
    assertActorReadScope(scope, false)
    assertReturnCreateAdmission(actorId, pending, recovery)
    if (loadPendingReturnCreateV1(actorId)?.bodyJson !== pending.bodyJson) throw returnV1Error('return_v1_pending')
    // Fresh static capability, not a re-quote: an earlier attempt may have
    // already consumed the quantity and its exact receipt still must replay.
    const capability = await apiFetch('GET', '/api/returns/capabilities')
    assertActorReadScope(scope, false)
    assertReturnCreateAdmission(actorId, pending, recovery)
    requireReturnCapability(capability)
    if (loadPendingReturnCreateV1(actorId)?.bodyJson !== pending.bodyJson) throw returnV1Error('return_v1_pending')
    let result: unknown
    try { result = await apiFetch('POST', '/api/returns', body) } catch (error) {
      assertActorReadScope(scope, false)
      // This specific create response is after the server's exact receipt
      // lookup. It authoritatively refuses a not-yet-committed stale quote.
      const failure = error as { status?: number; code?: string; returnV1QuoteRejected?: boolean }
      if (failure?.status === 409 && failure.code === 'customer_return_quote_stale') failure.returnV1QuoteRejected = true
      throw error
    }
    assertActorReadScope(scope, false)
    const row = result as Record<string, unknown> | null
    // A plain return has no replacement sale; an exchange has exactly one, and its receipt number is how the till finds it.
    const exchanged = Array.isArray(body.replacement_items) && body.replacement_items.length > 0
    const replacementOk = exchanged
      ? Number.isSafeInteger(row?.replacementSaleId) && Number(row?.replacementSaleId) > 0 && typeof row?.replacementReceiptNumber === 'string' && row.replacementReceiptNumber !== ''
      : row?.replacementSaleId === null && row?.replacementReceiptNumber === null
    if (!row || !Number.isSafeInteger(row.id) || Number(row.id) <= 0 || row.returnNumber !== body.return_number || !replacementOk) throw Object.assign(new Error('return_v1_pending'), { code: 'return_v1_pending', outcome: 'unknown' })
    return result
    })
  } finally { returnCreateFlights.delete(body.client_request_id) }
}

export function saveReturnReasonPresets(presets: { customer: string[]; supplier: string[] }): Promise<unknown> {
  return route(
    'returns:reason-presets:save',
    () => apiFetch('POST', '/api/returns/reason-presets', { presets }),
    null,
    true,
  )
}

export function getReturnReasonImpact(payload: { return_scope: 'customer' | 'supplier'; from: string; to: string }): Promise<unknown> {
  const query = new URLSearchParams(payload)
  return apiFetch('GET', `/api/returns/reasons/impact?${query.toString()}`)
}

export function replaceReturnReason(payload: {
  return_scope: 'customer' | 'supplier'
  from: string
  to: string
  scope: 'presets_only' | 'linked'
  presets: { customer: string[]; supplier: string[] }
}): Promise<unknown> {
  return route(
    'returns:reason-presets:replace',
    () => apiFetch('POST', '/api/returns/reasons/replace', payload),
    null,
    true,
  )
}

export function createReturn(payload: ReturnPayload = {}): Promise<unknown> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'return')
  return route(
    'returns:create',
    () => apiFetch('POST', '/api/returns', {
      ...body,
      return_number: buildReturnNumber(body, 'RET'),
    }),
    null,
    true,
  )
}

export function createSupplierReturn(payload: ReturnPayload = {}): Promise<unknown> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'supplier_return')
  return route(
    'returns:createSupplier',
    () => apiFetch('POST', '/api/returns/supplier', {
      ...body,
      return_number: buildReturnNumber(body, 'SRET'),
    }),
    null,
    true,
  )
}

// Bulk return actions deliberately bypass route()/the offline write queue.
// They are optimistic-concurrency guarded against live stock and return
// revisions, so replaying them later from an offline snapshot would turn a
// safe all-or-none action into an unknowable partial-time action.
export async function bulkUpdateReturns(payload: ReturnBulkPayload): Promise<ReturnBulkResult> {
  if (navigator.onLine === false && !(await confirmServerReachable())) throw new Error('Connect to the server before changing returns in bulk.')
  return apiFetch('POST', '/api/returns/bulk', payload) as Promise<ReturnBulkResult>
}

export async function prepareReturnUpdateRequest(_id: number | string, payload: ReturnPayload = {}): Promise<PreparedReturnUpdateRequest> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'return-edit')
  return body as PreparedReturnUpdateRequest
}

export async function submitReturnUpdateRequest(id: number | string, body: PreparedReturnUpdateRequest): Promise<unknown> {
  if (!String(body?.client_request_id || '').trim()) {
    throw new Error('Return updates require a prepared client_request_id.')
  }
  try {
    const result = await route(
      'returns:update',
      () => apiFetch('PATCH', `/api/returns/${encodeId(id)}`, body),
      null,
      true,
    )
    const db = await getLocalDb()
    const {
      client_request_id: _clientRequestId,
      expected_updated_at: _expectedUpdatedAt,
      clientTime: _clientTime,
      deviceTz: _deviceTz,
      deviceName: _deviceName,
      ...localUpdate
    } = body
    await db.table('returns').update(id, {
      ...localUpdate,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttemptedReturnUpdate(error, body)
  }
}

export async function updateReturn(id: number | string, payload: ReturnPayload = {}): Promise<unknown> {
  return submitReturnUpdateRequest(id, await prepareReturnUpdateRequest(id, payload))
}
