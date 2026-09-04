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
}

export type ShiftState = {
  shift: Shift | null
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
  // isWrite = true: no local race, no cached answer. The server's UNIQUE index
  // is the arbiter of "once a day", so this call must actually reach it.
  const state = await route<ShiftState>(
    'shifts:open',
    () => apiFetch('POST', '/api/shifts/open', {
      branch_id: input.branchId ?? null,
      branch_name: input.branchName ?? null,
      opening_float_usd: input.openingFloatUsd,
      opening_float_khr: input.openingFloatKhr,
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
  const state = await route<ShiftState>(
    'shifts:close',
    () => apiFetch('POST', '/api/shifts/close', {
      branch_id: input.branchId ?? null,
      closing_counted_usd: input.closingCountedUsd,
      closing_counted_khr: input.closingCountedKhr,
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
