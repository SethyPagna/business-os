// The received-date / expiry-date half of editing an existing lot
// (ManageBatchesModal), as pure functions so the rules can be tested without
// rendering the modal.
//
// DATE-CONSISTENCY sweep 3b: the editor used to seed its received-date field
// with `(received_at || '').slice(0, 10)` and send `receivedAt` on EVERY save.
// For a leftover month-first lot "03/04/2026" the day-first field read that as
// 3 April, and the Worker (typed fields are day-first) then stored 2026-04-03 and
// re-derived the lot code from it -- 4 March silently became 3 April on a save
// whose only intent was to fix the supplier. The rules now:
//   1. a field is seeded only with a value the system can read as a stored date;
//   2. an unreadable stored value seeds BLANK and is named to the operator, who
//      must type the correct date (nothing is guessed);
//   3. only a field that differs from its seed is sent -- an unchanged date is
//      never written back.

import { batchReceivedDayIso } from './batchLabel.ts'

export interface BatchDateSource {
  received_at?: string | null
  expiry_date?: string | null
}

export interface BatchDateDraft {
  receivedAt: string
  expiryDate: string
}

export interface BatchDateSeed extends BatchDateDraft {
  receivedAtSeed: string
  expiryDateSeed: string
  /** The stored texts that could not be seeded, for the "type the correct date" notice. */
  unreadable: string[]
}

const STORED_ISO_DATE = /^\d{4}-\d{2}-\d{2}/

export function seedBatchDateDraft(batch: BatchDateSource): BatchDateSeed {
  const storedReceived = String(batch.received_at ?? '').trim()
  const storedExpiry = String(batch.expiry_date ?? '').trim()
  // Business-day ISO: a default batch's UTC timestamp seeds the day it
  // belongs to in Phnom Penh, which is the day the list shows for it.
  const receivedAt = batchReceivedDayIso(storedReceived) || ''
  const expiryDate = STORED_ISO_DATE.test(storedExpiry) ? storedExpiry.slice(0, 10) : ''
  return {
    receivedAt,
    receivedAtSeed: receivedAt,
    expiryDate,
    expiryDateSeed: expiryDate,
    unreadable: [
      storedReceived && !receivedAt ? storedReceived : '',
      storedExpiry && !expiryDate ? storedExpiry : '',
    ].filter(Boolean),
  }
}

export interface BatchDatePatch {
  /** Present only when the operator changed the received date. */
  receivedAt?: string
  /** Present only when the operator changed the expiry date (null = cleared). */
  expiryDate?: string | null
}

/**
 * What to send for the date fields: only what changed. `receivedBlank` is true
 * when the operator emptied a received date that had a value -- the Worker
 * reads a blank received date as "today", so the caller must refuse that
 * rather than send it.
 */
export function buildBatchDatePatch(draft: BatchDateDraft, seed: Pick<BatchDateSeed, 'receivedAtSeed' | 'expiryDateSeed'>): { patch: BatchDatePatch; receivedBlank: boolean } {
  const patch: BatchDatePatch = {}
  const receivedChanged = draft.receivedAt !== seed.receivedAtSeed
  if (receivedChanged && draft.receivedAt) patch.receivedAt = draft.receivedAt
  if (draft.expiryDate !== seed.expiryDateSeed) patch.expiryDate = draft.expiryDate || null
  return { patch, receivedBlank: receivedChanged && !draft.receivedAt }
}

// ---------------------------------------------------------------------------
// The stock-in SESSION header edit (StockInSessionsSection) -- same rules, one
// level up: it PATCHes every lot of the session with the header's received date
// and due date. It used to seed `String(date).slice(0, 10)` and resend
// `receivedAt: editDate || null` on every save, so an unreadable stored date was
// either carried into the day-first field or replaced by "today" (a blank
// received date means "today" to the Worker).
// ---------------------------------------------------------------------------

export interface SessionHeaderDateSeed {
  receivedAt: string
  creditDueDate: string
  /** The stored texts that could not be seeded, for the "type the correct date" notice. */
  unreadable: string[]
}

export function seedSessionHeaderDates(session: { receivedDate?: string | null; creditDueDate?: string | null }): SessionHeaderDateSeed {
  const storedReceived = String(session.receivedDate ?? '').trim()
  const storedDue = String(session.creditDueDate ?? '').trim()
  const receivedAt = batchReceivedDayIso(storedReceived) || ''
  const creditDueDate = STORED_ISO_DATE.test(storedDue) ? storedDue.slice(0, 10) : ''
  return {
    receivedAt,
    creditDueDate,
    unreadable: [
      storedReceived && !receivedAt ? storedReceived : '',
      storedDue && !creditDueDate ? storedDue : '',
    ].filter(Boolean),
  }
}

/**
 * The received date to send for a header save: only when it changed. Emptying a
 * received date that had a value is flagged (`receivedBlank`) so the caller
 * refuses it. The due date is not diffed here: a credit session always sends
 * its due date with the payment status (the Worker requires the pair), and the
 * existing "credit needs a due date" refusal already blocks a blank one.
 */
export function buildSessionHeaderReceivedPatch(editReceivedAt: string, seedReceivedAt: string): { receivedAt?: string; receivedBlank: boolean } {
  if (editReceivedAt === seedReceivedAt) return { receivedBlank: false }
  if (!editReceivedAt) return { receivedBlank: true }
  return { receivedAt: editReceivedAt, receivedBlank: false }
}
