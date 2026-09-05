import { apiFetch, route } from './http.ts'

// Cash-drawer shift registration (see cloudflare/src/routes/shifts.ts +
// migration 0116).
//
// NO LOCAL FALLBACK AND NO OFFLINE MIRROR, on purpose. Every other transport
// here passes a localFn to route() so a read still answers offline; this one
// passes null. A shift float is a count of physical cash in one drawer at one
// moment, and a queued offline "registration" would let two devices each open
// the same morning and reconcile into exactly the duplicate the server's
// UNIQUE index exists to prevent. Offline, the read fails, the prompt stays
// up, and nothing is written -- which is the correct behaviour anyway, since
// the employee has not registered yet.

export type Shift = {
  id: number
  shift_code: string
  scope_mode: ShiftScopeMode
  user_id: number
  user_name: string | null
  branch_id: number | null
  branch_name: string | null
  business_date: string
  opened_at: string
  opening_float_usd: number
  opening_float_khr: number
  opening_note: string | null
  closed_at: string | null
  closing_counted_usd: number | null
  closing_counted_khr: number | null
  closing_note: string | null
  closed_by_user_id: number | null
  closed_by_user_name: string | null
  revision: number
  capabilities: ShiftCapabilities
  cancelled_at: string | null
  cancelled_by_user_id: number | null
  cancelled_by_user_name: string | null
  cancel_reason: string | null
  parent_shift_id: number | null
  reopen_reason: string | null
  reopened_by_user_id: number | null
  reopened_by_user_name: string | null
}

export type ShiftCapabilities = {
  can_edit: boolean
  can_close: boolean
  can_reopen: boolean
  can_cancel: boolean
}

export type ShiftScopeMode = 'per_account' | 'shop_wide'

export type ShiftPolicy = {
  scope_mode: ShiftScopeMode
  admin_exempt: boolean
}

export type ShiftState = {
  shift: Shift | null
  policy: ShiftPolicy
  exempt: boolean
  // True only when today has no shift row at all. This is the prompt
  // condition, and it stays true across reloads, new tabs and other devices
  // until the float is actually registered -- the owner's "will prompt until
  // it is registered".
  needs_registration: boolean
  is_open: boolean
  can_end: boolean
  already_registered?: boolean
  already_closed?: boolean
}

export type ShiftAmendment = {
  id: number
  shift_session_id: number
  actor_user_id: number
  actor_name: string | null
  reason: string
  before_json: string
  after_json: string
  created_at: string
}

export type ShiftListResult = { shifts: Shift[]; scope: 'all' | 'own' }
export type ShiftHistoryResult = { shift: Shift; amendments: ShiftAmendment[] }

export function orderShiftRows(rows: Shift[]): Shift[] {
  return [...rows].sort((left, right) => {
    const leftOpen = left.closed_at == null && left.cancelled_at == null
    const rightOpen = right.closed_at == null && right.cancelled_at == null
    const openOrder = Number(!leftOpen) - Number(!rightOpen)
    if (openOrder !== 0) return openOrder
    const dateOrder = right.business_date.localeCompare(left.business_date)
    if (dateOrder !== 0) return dateOrder
    const openedOrder = right.opened_at.localeCompare(left.opened_at)
    return openedOrder || right.id - left.id
  })
}

export function shiftCashDifference(shift: Pick<Shift,
  'opening_float_usd' | 'opening_float_khr' | 'closing_counted_usd' | 'closing_counted_khr'
>): { usd: number | null; khr: number | null } {
  const difference = (closing: number | null, opening: number) => closing == null
    ? null
    : Number((Number(closing) - Number(opening)).toFixed(2))
  return {
    usd: difference(shift.closing_counted_usd, shift.opening_float_usd),
    khr: difference(shift.closing_counted_khr, shift.opening_float_khr),
  }
}

export function parseShiftCount(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function requiredShiftCount(value: unknown, label: string): number {
  const parsed = parseShiftCount(value)
  if (parsed == null) throw new Error(`${label} must be an explicit non-negative number`)
  return parsed
}

// Shift timestamps are entered in the shop's canonical Phnom Penh wall clock.
// Cambodia is UTC+07 year-round, so attaching the offset prevents a cashier's
// device timezone from silently moving a historical close by an hour or a day.
export function shiftLocalDateTimeToIso(value: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) throw new Error('A shift date and time is required')
  const parsed = new Date(`${normalized}:00+07:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid shift date and time')
  return parsed.toISOString()
}

function queryString(values: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== '') query.set(key, String(value))
  })
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

const branchQuery = (branchId: number | null | undefined) =>
  branchId == null ? '' : `?branch_id=${encodeURIComponent(String(branchId))}`

export async function fetchCurrentShift(branchId?: number | null): Promise<ShiftState> {
  const query = branchQuery(branchId)
  const state = await route<ShiftState>(
    `shifts:current:${query}`,
    () => apiFetch('GET', `/api/shifts/current${query}`),
    null,
  )
  // route() resolves null when it has no answer (offline, no local fallback).
  // Null must NOT read as "registered" -- that would skip the prompt for the
  // rest of the day. Throwing keeps the caller's catch in charge.
  if (!state) throw new Error('Could not read the current shift')
  return state
}

export type OpenShiftInput = {
  branchId?: number | null
  branchName?: string | null
  openingFloatUsd: number
  openingFloatKhr: number
  openingNote?: string | null
}

export async function openShift(input: OpenShiftInput): Promise<ShiftState> {
  const openingFloatUsd = requiredShiftCount(input.openingFloatUsd, 'Opening USD count')
  const openingFloatKhr = requiredShiftCount(input.openingFloatKhr, 'Opening KHR count')
  // isWrite = true: no local race, no cached answer. The server's UNIQUE index
  // is the arbiter of "once a day", so this call must actually reach it.
  const state = await route<ShiftState>(
    'shifts:open',
    () => apiFetch('POST', '/api/shifts/open', {
      branch_id: input.branchId ?? null,
      branch_name: input.branchName ?? null,
      opening_float_usd: openingFloatUsd,
      opening_float_khr: openingFloatKhr,
      opening_note: input.openingNote ?? null,
    }),
    null,
    true,
  )
  // already_registered on the response means another tab or device won the
  // race. That is a success, not a conflict: today IS registered, which is all
  // the caller needs in order to stop prompting.
  if (!state) throw new Error('Could not register the shift')
  return state
}

export type CloseShiftInput = {
  branchId?: number | null
  closingCountedUsd: number
  closingCountedKhr: number
  closingNote?: string | null
}

export async function closeShift(input: CloseShiftInput): Promise<ShiftState> {
  const closingCountedUsd = requiredShiftCount(input.closingCountedUsd, 'Closing USD count')
  const closingCountedKhr = requiredShiftCount(input.closingCountedKhr, 'Closing KHR count')
  const state = await route<ShiftState>(
    'shifts:close',
    () => apiFetch('POST', '/api/shifts/close', {
      branch_id: input.branchId ?? null,
      closing_counted_usd: closingCountedUsd,
      closing_counted_khr: closingCountedKhr,
      closing_note: input.closingNote ?? null,
    }),
    null,
    true,
  )
  // already_closed is likewise not an error -- the shift was already ended and
  // the first count stands untouched. The caller just stops showing End Shift.
  if (!state) throw new Error('Could not end the shift')
  return state
}

export async function fetchShiftPolicy(): Promise<ShiftPolicy> {
  const policy = await route<ShiftPolicy>('shifts:policy', () => apiFetch('GET', '/api/shifts/policy'), null)
  if (!policy) throw new Error('Could not read shift policy')
  return policy
}

export async function listShifts(filters: {
  branchId?: number | null
  userId?: number | string | null
  from?: string
  to?: string
  limit?: number
} = {}): Promise<ShiftListResult> {
  const query = queryString({
    branch_id: filters.branchId,
    user_id: filters.userId,
    from: filters.from,
    to: filters.to,
    limit: filters.limit ?? 50,
  })
  const result = await route<ShiftListResult>(`shifts:list:${query}`, () => apiFetch('GET', `/api/shifts${query}`), null)
  if (!result) throw new Error('Could not read shift history')
  return result
}

export async function fetchShiftHistory(id: number): Promise<ShiftHistoryResult> {
  const result = await route<ShiftHistoryResult>(`shifts:history:${id}`, () => apiFetch('GET', `/api/shifts/${id}/history`), null)
  if (!result) throw new Error('Could not read shift amendments')
  return result
}

export type AmendShiftInput = {
  expectedRevision: number
  reason: string
  openedAt: string
  openingFloatUsd: number
  openingFloatKhr: number
  openingNote?: string | null
  closedAt?: string | null
  closingCountedUsd?: number | null
  closingCountedKhr?: number | null
  closingNote?: string | null
}

export async function amendShift(id: number, input: AmendShiftInput): Promise<{ shift: Shift }> {
  const openingFloatUsd = requiredShiftCount(input.openingFloatUsd, 'Opening USD count')
  const openingFloatKhr = requiredShiftCount(input.openingFloatKhr, 'Opening KHR count')
  const closingCountedUsd = input.closedAt == null
    ? null
    : requiredShiftCount(input.closingCountedUsd, 'Closing USD count')
  const closingCountedKhr = input.closedAt == null
    ? null
    : requiredShiftCount(input.closingCountedKhr, 'Closing KHR count')
  const result = await route<{ shift: Shift }>(
    `shifts:amend:${id}`,
    () => apiFetch('PATCH', `/api/shifts/${id}`, {
      expected_revision: input.expectedRevision,
      reason: input.reason,
      opened_at: input.openedAt,
      opening_float_usd: openingFloatUsd,
      opening_float_khr: openingFloatKhr,
      opening_note: input.openingNote ?? null,
      closed_at: input.closedAt ?? null,
      closing_counted_usd: closingCountedUsd,
      closing_counted_khr: closingCountedKhr,
      closing_note: input.closingNote ?? null,
    }),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not amend shift')
  return result
}

export type CloseShiftByIdInput = {
  expectedRevision: number
  closedAt: string
  closingCountedUsd: number
  closingCountedKhr: number
  closingNote?: string | null
}

export type CloseShiftByIdResult = {
  shift: Shift
  already_closed: boolean
  is_open: false
}

export async function closeShiftById(id: number, input: CloseShiftByIdInput): Promise<CloseShiftByIdResult> {
  const closingCountedUsd = requiredShiftCount(input.closingCountedUsd, 'Closing USD count')
  const closingCountedKhr = requiredShiftCount(input.closingCountedKhr, 'Closing KHR count')
  const result = await route<CloseShiftByIdResult>(
    `shifts:close:${id}`,
    () => apiFetch('POST', `/api/shifts/${id}/close`, {
      expected_revision: input.expectedRevision,
      closed_at: input.closedAt,
      closing_counted_usd: closingCountedUsd,
      closing_counted_khr: closingCountedKhr,
      closing_note: input.closingNote ?? null,
    }),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not close shift')
  return result
}

export type ReopenShiftInput = {
  expectedRevision: number
  reason: string
  openingFloatUsd: number
  openingFloatKhr: number
  openingNote?: string | null
}

export type ReopenShiftResult = {
  shift: Shift
  reopened_from_shift_id: number
}

export async function reopenShift(id: number, input: ReopenShiftInput): Promise<ReopenShiftResult> {
  const openingFloatUsd = requiredShiftCount(input.openingFloatUsd, 'Opening USD count')
  const openingFloatKhr = requiredShiftCount(input.openingFloatKhr, 'Opening KHR count')
  const result = await route<ReopenShiftResult>(
    `shifts:reopen:${id}`,
    () => apiFetch('POST', `/api/shifts/${id}/reopen`, {
      expected_revision: input.expectedRevision,
      reason: input.reason,
      opening_float_usd: openingFloatUsd,
      opening_float_khr: openingFloatKhr,
      opening_note: input.openingNote ?? null,
    }),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not reopen shift')
  return result
}

export type CancelShiftResult = {
  shift: Shift
  cancelled: true
}

export async function cancelShift(id: number, expectedRevision: number, reason: string): Promise<CancelShiftResult> {
  const result = await route<CancelShiftResult>(
    `shifts:cancel:${id}`,
    () => apiFetch('POST', `/api/shifts/${id}/cancel`, {
      expected_revision: expectedRevision,
      reason,
    }),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not cancel shift')
  return result
}
