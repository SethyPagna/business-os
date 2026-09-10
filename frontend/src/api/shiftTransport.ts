import { apiFetch, route } from './http.ts'
import { dispatchResolvedSyncError, type SyncProblemReference } from '../utils/syncProblemLifecycle.ts'

const unresolvedShiftWrites = new Map<string, SyncProblemReference>()
async function shiftWrite<T>(channel: string, send: () => Promise<T>, local: null, isWrite: true): Promise<T | null> {
  try {
    const result = await route<T>(channel, send, local, isWrite)
    dispatchResolvedSyncError(unresolvedShiftWrites.get(channel))
    unresolvedShiftWrites.delete(channel)
    return result
  } catch (cause) {
    const error = cause as { syncErrorId?: string; syncErrorChannel?: string; code?: string }
    if (error.code === 'shift_request_superseded') {
      dispatchResolvedSyncError(unresolvedShiftWrites.get(channel))
      unresolvedShiftWrites.delete(channel)
    }
    if (error.syncErrorId) unresolvedShiftWrites.set(channel, { errorId: error.syncErrorId, channel: error.syncErrorChannel, code: error.code })
    throw cause
  }
}

type ShiftMutationBody = Record<string, unknown>
export function freezeShiftMutation(body: ShiftMutationBody): ShiftMutationBody {
  return JSON.parse(JSON.stringify({ ...body, client_request_id: body.client_request_id || crypto.randomUUID() }))
}

export function pendingShiftMutation(actorId: number | string | undefined, id: number) {
  if (!actorId || typeof window === 'undefined') return null
  for (const action of ['edit', 'close', 'reopen', 'cancel'] as const) {
    const method = action === 'edit' ? 'PATCH' : 'POST'
    const path = `/api/shifts/${id}${action === 'edit' ? '' : `/${action}`}`
    const raw = window.sessionStorage.getItem(`businessos_shift_request_v1:${actorId}:${method}:${path}`)
    if (raw) return { action, body: JSON.parse(raw) as ShiftMutationBody }
  }
  return null
}

/** Saved before I/O, scoped to the signed-in actor and exact endpoint. A new
 * draft cannot replace a request whose acknowledgement has been lost. */
async function shiftMutationFetch(method: string, path: string, body: ShiftMutationBody, actorId?: number | string) {
  if (!actorId) throw new Error('The signed-in shift operator is required')
  const key = `businessos_shift_request_v1:${actorId}:${method}:${path}`
  const storage = window.sessionStorage
  const prior = storage.getItem(key)
  const frozen = prior ? JSON.parse(prior) as ShiftMutationBody : freezeShiftMutation(body)
  const serialized = JSON.stringify(frozen)
  storage.setItem(key, serialized)
  if (storage.getItem(key) !== serialized) throw new Error('Could not save the shift retry request')
  let uncertain = !!prior
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await apiFetch(method, path, frozen, 45_000, { skipWriteDedupe: true })
      const targetId = Number(path.match(/\/shifts\/(\d+)/)?.[1])
      const exactTarget = path.endsWith('/reopen')
        ? result?.reopened_from_shift_id === targetId && result?.shift?.parent_shift_id === targetId
        : result?.shift?.id === targetId
      if (!exactTarget) throw Object.assign(new Error('Could not verify the committed shift'), { outcome: 'unknown' })
      storage.removeItem(key)
      return result
    } catch (cause) {
      const error = cause as Error & { status?: number; outcome?: string; code?: string }
      if (error.code === 'shift_request_superseded') {
        storage.removeItem(key)
        error.outcome = 'rejected'
        throw error
      }
      const unknown = error.outcome === 'unknown' || !error.status || error.status >= 500
      uncertain ||= unknown
      if (!uncertain) storage.removeItem(key)
      if (unknown && attempt === 0) continue // exact receipt replay reconciles a lost response
      if (uncertain) error.outcome = 'unknown'
      throw error
    }
  }
}

export function shiftTimestampIsFuture(value: string, now = Date.now()): boolean {
  return new Date(value).getTime() > now
}

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

/**
 * The drawer reconciliation the server computes in ONE place
 * (cloudflare/src/lib/shiftReconciliation.ts) and returns with the close and
 * with the shift reads. Per currency, never cross-converted:
 *
 *   expected   = opening + additional cash + cash sales - refunds - expenses - courier
 *   difference = counted - expected
 *
 * The client renders these numbers and NEVER recomputes them. A second
 * implementation on this side is exactly how the app, the close dialog and
 * the Telegram shift report would come to disagree about one drawer -- which
 * is why the old `shiftCashDifference` helper (counted minus the opening
 * float) is gone rather than repointed: on a drawer that took $40 of cash
 * sales it reported a $3.25 SURPLUS for a till that is $28 short.
 */
export type ShiftMoney = { usd: number; khr: number }
export type ShiftCountedMoney = { usd: number | null; khr: number | null }
export type ShiftReconciliation = {
  opening: ShiftCountedMoney
  additional_cash?: ShiftMoney
  cash_sales: ShiftMoney
  refunds: ShiftMoney
  expenses: ShiftMoney
  courier: ShiftMoney
  expected: ShiftCountedMoney
  counted: ShiftCountedMoney
  difference: ShiftCountedMoney
  /** A component could not be established; the figures are shown with a warning. */
  needs_review: boolean
  /** Machine codes, translated by the app's own pack. */
  review_codes: string[]
}

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
  opening_float_usd: number | null
  opening_float_khr: number | null
  additional_cash_usd?: number
  additional_cash_khr?: number
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
  // Present on the close response and on the shift reads. Absent on rows that
  // come back from a list (the server does not price a whole page of shifts).
  reconciliation?: ShiftReconciliation | null
  // The admin report half. Null for a caller without the shift-review
  // capability, and absent from list rows and from /current -- see
  // `ShiftFigures`.
  figures?: ShiftFigures | null
}

/**
 * The shift REPORT figures, computed once on the server
 * (cloudflare/src/lib/shiftReconciliation.ts) and rendered here as they
 * arrive. Two halves that never mix:
 *
 *   * `opening` / `closing` are the REGISTRATION -- the cash counted into the
 *     drawer at open and out of it at end, per currency. A record for the
 *     report and nothing else: no sales, cost or profit figure is derived
 *     from them, which is why the same window prices identically whatever
 *     was counted (owner ruling, Sep 6 2026).
 *   * everything else is the business, from the sales kernel and the `fees`
 *     table. `credit_usd` is an amount OWED and is printed as a positive
 *     note; it is already inside sales and profit and is subtracted from
 *     nothing.
 *
 * `delivery_cost` counts both ways a courier gets paid (a fee row typed
 * delivery, and a payout recorded on the sale) and `other_expenses` is every
 * remaining fee, so the two always sum to the drawer's expense outflow.
 */
export type ShiftFigures = {
  opening: ShiftCountedMoney
  additional_cash?: ShiftMoney
  closing: ShiftCountedMoney
  sales_usd: number
  cogs_usd: number
  profit_usd: number
  delivery_fee_usd: number
  credit_usd: number
  refunds_usd: number
  delivery_cost: ShiftMoney
  other_expenses: ShiftMoney
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

export function parseShiftCount(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export type ShiftCountBlocker = 'both_blank' | 'invalid'

/**
 * Why a two-currency count pair cannot be submitted yet, or null when it can.
 * Rendered NEXT TO the button (ShiftSubmitRow), never swallowed by a bare
 * `disabled`. The action is allowed once EITHER field holds a valid count.
 *
 * `blankMeansUncounted` is the report-only registration rule. A blank field is
 * unknown/null; an explicit 0 is a measured zero. Opening, reopening and close
 * all use this option, while an invalid non-blank entry still blocks.
 * An invalid entry (negative, NaN) still blocks everywhere.
 */
export function shiftCountPairBlocker(
  usd: unknown,
  khr: unknown,
  options: { blankMeansUncounted?: boolean } = {},
): ShiftCountBlocker | null {
  const usdBlank = typeof usd === 'string' && usd.trim() === ''
  const khrBlank = typeof khr === 'string' && khr.trim() === ''
  if (usdBlank && khrBlank) return options.blankMeansUncounted ? null : 'both_blank'
  if ((!usdBlank && parseShiftCount(usd) == null) || (!khrBlank && parseShiftCount(khr) == null)) return 'invalid'
  if (!options.blankMeansUncounted && (usdBlank || khrBlank)) return 'invalid'
  return null
}

/**
 * The counted drawer a CLOSE form submits.
 *
 * Each currency is independent. A blank field means that currency was not
 * counted, which is null on the wire and NULL in the column -- never 0,
 * because "the till held nothing" and "nobody counted the till" are different
 * facts and the shift report prints them differently. An explicit 0 remains a
 * measured zero. ONE implementation is used by POS close and by the Shifts
 * popup's close.
 */
export function shiftClosingCounts(usd: unknown, khr: unknown): { usd: number | null; khr: number | null } {
  return { usd: parseShiftCount(usd), khr: parseShiftCount(khr) }
}

/** Opening registration uses the same per-currency blank/null contract. */
export const shiftOpeningCounts = shiftClosingCounts

function requiredShiftCount(value: unknown, label: string): number {
  const parsed = parseShiftCount(value)
  if (parsed == null) throw new Error(`${label} must be an explicit non-negative number`)
  return parsed
}

/** A count that may legitimately be absent (the closing drawer). */
function optionalShiftCount(value: unknown, label: string): number | null {
  if (value == null) return null
  return requiredShiftCount(value, label)
}

// Shift timestamps are entered in the shop's canonical Phnom Penh wall clock.
// Cambodia is UTC+07 year-round, so attaching the offset prevents a cashier's
// device timezone from silently moving a historical close by an hour or a day.
export function shiftLocalDateTimeToIso(value: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) throw new Error('A shift date and time is required')
  const parsed = new Date(`${normalized}:00+07:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid shift date and time')
  if (new Date(parsed.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) !== normalized) throw new Error('Invalid shift date and time')
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
  openingFloatUsd: number | null
  openingFloatKhr: number | null
  openingNote?: string | null
}

export async function openShift(input: OpenShiftInput): Promise<ShiftState> {
  const openingFloatUsd = optionalShiftCount(input.openingFloatUsd, 'Opening USD count')
  const openingFloatKhr = optionalShiftCount(input.openingFloatKhr, 'Opening KHR count')
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
  shiftId?: number
  expectedRevision?: number
  actorId?: number | string
  closedAt?: string
  branchId?: number | null
  // Null is "not counted" and is accepted by the Worker: ending a shift is
  // never gated on the drawer count. See shiftClosingCounts.
  closingCountedUsd: number | null
  closingCountedKhr: number | null
  additionalCashUsd?: number | null
  additionalCashKhr?: number | null
  closingNote?: string | null
}

export async function closeShift(input: CloseShiftInput): Promise<ShiftState> {
  const closingCountedUsd = optionalShiftCount(input.closingCountedUsd, 'Closing USD count')
  const closingCountedKhr = optionalShiftCount(input.closingCountedKhr, 'Closing KHR count')
  if (!input.shiftId || input.expectedRevision == null) throw new Error('The exact shift and revision are required')
  const state = await shiftWrite<ShiftState>(
    `shifts:close:${input.shiftId}`,
    () => shiftMutationFetch('POST', `/api/shifts/${input.shiftId}/close`, {
      expected_revision: input.expectedRevision,
      closed_at: input.closedAt || new Date().toISOString(),
      closing_counted_usd: closingCountedUsd,
      closing_counted_khr: closingCountedKhr,
      ...(input.additionalCashUsd !== undefined ? { additional_cash_usd: optionalShiftCount(input.additionalCashUsd, 'Additional USD cash') } : {}),
      ...(input.additionalCashKhr !== undefined ? { additional_cash_khr: optionalShiftCount(input.additionalCashKhr, 'Additional KHR cash') } : {}),
      closing_note: input.closingNote ?? null,
    }, input.actorId),
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
  const result = await apiFetch('GET', `/api/shifts/${id}/history`) as ShiftHistoryResult
  if (!result) throw new Error('Could not read shift amendments')
  return result
}

export type AmendShiftInput = {
  actorId?: number | string
  expectedRevision: number
  reason: string
  openedAt: string
  openingFloatUsd: number | null
  openingFloatKhr: number | null
  additionalCashUsd?: number | null
  additionalCashKhr?: number | null
  openingNote?: string | null
  closedAt?: string | null
  closingCountedUsd?: number | null
  closingCountedKhr?: number | null
  closingNote?: string | null
}

export async function amendShift(id: number, input: AmendShiftInput): Promise<{ shift: Shift }> {
  if (shiftTimestampIsFuture(input.openedAt) || (input.closedAt && shiftTimestampIsFuture(input.closedAt))) throw new Error('Shift time cannot be in the future.')
  const openingFloatUsd = optionalShiftCount(input.openingFloatUsd, 'Opening USD count')
  const openingFloatKhr = optionalShiftCount(input.openingFloatKhr, 'Opening KHR count')
  // Optional even on a closed shift: a shift ended without a count keeps that
  // fact through an amendment instead of gaining a fabricated 0.
  const closingCountedUsd = input.closedAt == null
    ? null
    : optionalShiftCount(input.closingCountedUsd, 'Closing USD count')
  const closingCountedKhr = input.closedAt == null
    ? null
    : optionalShiftCount(input.closingCountedKhr, 'Closing KHR count')
  const result = await shiftWrite<{ shift: Shift }>(
    `shifts:amend:${id}`,
    () => shiftMutationFetch('PATCH', `/api/shifts/${id}`, {
      expected_revision: input.expectedRevision,
      reason: input.reason,
      opened_at: input.openedAt,
      opening_float_usd: openingFloatUsd,
      opening_float_khr: openingFloatKhr,
      ...(input.additionalCashUsd !== undefined ? { additional_cash_usd: optionalShiftCount(input.additionalCashUsd, 'Additional USD cash') } : {}),
      ...(input.additionalCashKhr !== undefined ? { additional_cash_khr: optionalShiftCount(input.additionalCashKhr, 'Additional KHR cash') } : {}),
      opening_note: input.openingNote ?? null,
      closed_at: input.closedAt ?? null,
      closing_counted_usd: closingCountedUsd,
      closing_counted_khr: closingCountedKhr,
      closing_note: input.closingNote ?? null,
    }, input.actorId),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not amend shift')
  return result
}

export type CloseShiftByIdInput = {
  actorId?: number | string
  expectedRevision: number
  closedAt: string
  // Optional for the same reason as CloseShiftInput's: the historic close in
  // the Shifts popup is the same close.
  closingCountedUsd: number | null
  closingCountedKhr: number | null
  additionalCashUsd?: number | null
  additionalCashKhr?: number | null
  closingNote?: string | null
}

export type CloseShiftByIdResult = {
  shift: Shift
  already_closed: boolean
  is_open: false
}

export async function closeShiftById(id: number, input: CloseShiftByIdInput): Promise<CloseShiftByIdResult> {
  if (shiftTimestampIsFuture(input.closedAt)) throw new Error('Closing time cannot be in the future.')
  const closingCountedUsd = optionalShiftCount(input.closingCountedUsd, 'Closing USD count')
  const closingCountedKhr = optionalShiftCount(input.closingCountedKhr, 'Closing KHR count')
  const result = await shiftWrite<CloseShiftByIdResult>(
    `shifts:close:${id}`,
    () => shiftMutationFetch('POST', `/api/shifts/${id}/close`, {
      expected_revision: input.expectedRevision,
      closed_at: input.closedAt,
      closing_counted_usd: closingCountedUsd,
      closing_counted_khr: closingCountedKhr,
      additional_cash_usd: optionalShiftCount(input.additionalCashUsd, 'Additional USD cash'),
      additional_cash_khr: optionalShiftCount(input.additionalCashKhr, 'Additional KHR cash'),
      closing_note: input.closingNote ?? null,
    }, input.actorId),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not close shift')
  return result
}

export type ReopenShiftInput = {
  actorId?: number | string
  expectedRevision: number
  reason: string
  openingFloatUsd: number | null
  openingFloatKhr: number | null
  openingNote?: string | null
}

export type ReopenShiftResult = {
  shift: Shift
  reopened_from_shift_id: number
}

export async function reopenShift(id: number, input: ReopenShiftInput): Promise<ReopenShiftResult> {
  const openingFloatUsd = optionalShiftCount(input.openingFloatUsd, 'Opening USD count')
  const openingFloatKhr = optionalShiftCount(input.openingFloatKhr, 'Opening KHR count')
  const result = await shiftWrite<ReopenShiftResult>(
    `shifts:reopen:${id}`,
    () => shiftMutationFetch('POST', `/api/shifts/${id}/reopen`, {
      expected_revision: input.expectedRevision,
      reason: input.reason,
      opening_float_usd: openingFloatUsd,
      opening_float_khr: openingFloatKhr,
      opening_note: input.openingNote ?? null,
    }, input.actorId),
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

export async function cancelShift(id: number, expectedRevision: number, reason: string, actorId?: number | string): Promise<CancelShiftResult> {
  const result = await shiftWrite<CancelShiftResult>(
    `shifts:cancel:${id}`,
    () => shiftMutationFetch('POST', `/api/shifts/${id}/cancel`, {
      expected_revision: expectedRevision,
      reason,
    }, actorId),
    null,
    true,
  )
  if (!result?.shift) throw new Error('Could not cancel shift')
  return result
}
