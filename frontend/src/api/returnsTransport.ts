import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { businessDateTimeId } from '../utils/timestampId.ts'
import { buildAttemptedReturnItems } from './conflicts.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { apiFetch, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { getReturn, getReturns } from './returnsReadTransport.ts'

type ReturnPayload = ExpectedUpdatedAtPayload
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

export async function updateReturn(id: number | string, payload: ReturnPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('returns', id, { ...getDevicePayload(), ...(payload || {}) })
  try {
    const result = await route(
      'returns:update',
      () => apiFetch('PATCH', `/api/returns/${encodeId(id)}`, body),
      null,
      true,
    )
    const db = await getLocalDb()
    await db.table('returns').update(id, {
      ...payload,
      updated_at: getResultTimestamp(result),
    }).catch(() => {})
    return result
  } catch (error) {
    attachAttemptedReturnUpdate(error, payload)
  }
}
