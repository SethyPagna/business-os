// The ONE membership-number authority for the whole app.
//
// Before this file there were four independent minters, all producing a
// random `LCMN-XXXXXXXX`:
//   1. routes/contacts.ts  generateMembershipNumber()   (manual add/edit)
//   2. lib/importEngine.ts nextMembershipNumber()       (spreadsheet import)
//   3. lib/portalAccounts.ts generateMembershipId()     (storefront signup)
//   4. frontend customerMembershipNumber.ts             (composed in the browser!)
// Four sources on one column is how you get a collision the day someone
// imports a spreadsheet while a cashier registers a walk-in -- each source
// only checked the rows IT knew about.
//
// The house format is now `LC-#####` (Leang Cosmetic), zero-padded to
// MEMBERSHIP_SEQUENCE_DIGITS, and the sequence is GAP-FILLING: the next
// number handed out is the smallest positive integer not currently in use,
// so a number freed by a deleted/merged customer is reused before the
// sequence grows. (The pre-existing minters were not sequential at all --
// they were random entropy, so nothing "appended" either; the gap-fill
// below is new behaviour, not a restoration.)
//
// Uniqueness has exactly one guarantee: the partial UNIQUE index
// `idx_customers_membership_lower_pg` on lower(membership_number)
// (migration 0015). Everything here is an optimisation on top of it --
// mintMembershipNumber() picks the gap, and withMintedMembershipNumber()
// re-mints and retries when a concurrent writer wins the race.

import type { D1Compat } from './db'

export const MEMBERSHIP_PREFIX = 'LC-'
export const MEMBERSHIP_SEQUENCE_DIGITS = 5
/** Shown as an input placeholder / example. Never written to the database. */
export const MEMBERSHIP_PLACEHOLDER = 'LC-00001'
/** SQLite GLOB that selects rows whose number is `LC-` followed by digits only. */
export const MEMBERSHIP_SQL_GLOB = "membership_number GLOB 'LC-[0-9]*' AND membership_number NOT GLOB 'LC-*[^0-9]*'"

const MEMBERSHIP_PATTERN = /^LC-(\d+)$/

/**
 * `1` -> `LC-00001`. Sequences past the padded width keep their natural width
 * (`LC-100000`) rather than being truncated -- the format grows, it never wraps.
 */
export function formatMembershipNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Membership sequence must be a positive integer, got ${String(sequence)}`)
  }
  return `${MEMBERSHIP_PREFIX}${String(sequence).padStart(MEMBERSHIP_SEQUENCE_DIGITS, '0')}`
}

/**
 * `LC-00042` / ` lc-42 ` -> 42. Anything else (blank, a legacy `LCMN-...`,
 * a hand-typed vanity number, `LC-00000`) -> null, i.e. "not part of the
 * house sequence" -- such a row keeps its number and simply doesn't
 * participate in gap-filling.
 */
export function parseMembershipSequence(value: unknown): number | null {
  const raw = String(value ?? '').trim().toUpperCase()
  const match = MEMBERSHIP_PATTERN.exec(raw)
  if (!match) return null
  const sequence = Number(match[1])
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null
  return sequence
}

/** Normalises for storage/comparison: trims and upper-cases. */
export function normalizeMembershipNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

/** True when `value` already carries the house format. */
export function isHouseMembershipNumber(value: unknown): boolean {
  return parseMembershipSequence(value) !== null
}

/**
 * The gap-fill rule, in one place: the smallest positive integer that is not
 * already taken. `[1,2,4]` -> 3. `[1,2,3]` -> 4. `[]` -> 1.
 */
export function firstFreeMembershipSequence(taken: Iterable<number>): number {
  const used = new Set<number>()
  for (const value of taken) {
    if (Number.isInteger(value) && value >= 1) used.add(value)
  }
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

/**
 * `count` sequences in ascending gap-fill order, none repeated. Used by the
 * import engine, which mints many numbers in one synchronous pass before any
 * of them is written.
 */
export function allocateMembershipSequences(taken: Iterable<number>, count: number): number[] {
  const used = new Set<number>()
  for (const value of taken) {
    if (Number.isInteger(value) && value >= 1) used.add(value)
  }
  const out: number[] = []
  let candidate = 1
  while (out.length < count) {
    while (used.has(candidate)) candidate += 1
    used.add(candidate)
    out.push(candidate)
    candidate += 1
  }
  return out
}

/**
 * A synchronous, self-contained minter over an already-loaded snapshot of
 * membership numbers. The import engine holds every existing customer row in
 * memory already, so it mints from this rather than paying a D1 round trip per
 * row. Numbers it hands out are added to the snapshot, so two blank rows in
 * one file can't collide with each other.
 */
export function createMembershipNumberAllocator(existingNumbers: Iterable<unknown>): () => string {
  const takenSequences = new Set<number>()
  for (const value of existingNumbers) {
    const sequence = parseMembershipSequence(value)
    if (sequence !== null) takenSequences.add(sequence)
  }
  return () => {
    const sequence = firstFreeMembershipSequence(takenSequences)
    takenSequences.add(sequence)
    return formatMembershipNumber(sequence)
  }
}

// --- D1-facing -------------------------------------------------------------

type SequenceShapeRow = { taken: number; max_sequence: number }

/**
 * The next house number for `customers`, gap-filled.
 *
 * Two steps so the common case stays cheap. Step one is a pure aggregate: how
 * many house numbers exist, and what is the largest. When those are equal the
 * sequence is exactly 1..max with no holes, so the answer is max + 1 without
 * transferring a single row. Only when they disagree (something was deleted,
 * merged, or hand-edited) do we pull the sequence list and find the hole.
 *
 * `extraTaken` lets a caller fold in numbers held outside customers --
 * portalAccounts.ts passes portal_accounts.membership_id. Passing any forces
 * the slow path, since the aggregate shortcut can only reason about one table.
 */
export async function mintMembershipNumber(db: D1Compat, extraTaken: Iterable<unknown> = []): Promise<string> {
  const extraSequences: number[] = []
  for (const value of extraTaken) {
    const sequence = parseMembershipSequence(value)
    if (sequence !== null) extraSequences.push(sequence)
  }

  if (extraSequences.length === 0) {
    const shape = await db.prepare(`
      SELECT COUNT(*) AS taken,
             COALESCE(MAX(CAST(substr(membership_number, ${MEMBERSHIP_PREFIX.length + 1}) AS INTEGER)), 0) AS max_sequence
      FROM customers
      WHERE ${MEMBERSHIP_SQL_GLOB}
    `).get<SequenceShapeRow>()
    const taken = Number(shape?.taken ?? 0)
    const maxSequence = Number(shape?.max_sequence ?? 0)
    if (taken === maxSequence) return formatMembershipNumber(maxSequence + 1)
  }

  const rows = await db.prepare(`
    SELECT membership_number FROM customers WHERE ${MEMBERSHIP_SQL_GLOB}
  `).all<{ membership_number: string }>()
  const sequences: number[] = extraSequences.slice()
  for (const row of rows) {
    const sequence = parseMembershipSequence(row.membership_number)
    if (sequence !== null) sequences.push(sequence)
  }
  return formatMembershipNumber(firstFreeMembershipSequence(sequences))
}

/**
 * Does this error mean another writer took the number between our mint and our
 * write? SQLite reports an expression index by name, so match either the column
 * or the index from migration 0015.
 */
export function isMembershipCollision(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
  if (!/UNIQUE constraint failed/i.test(message)) return false
  return /membership/i.test(message) || /idx_customers_membership_lower_pg/i.test(message)
}

/**
 * Mint a number, run the write with it, and if the DB says someone else took
 * that number first, mint the next one and try again. This is the concurrency
 * story for a deterministic sequence: two cashiers registering walk-ins at the
 * same instant both compute the same next number, one INSERT loses, and this
 * hands the loser the following number instead of an error.
 */
export async function withMintedMembershipNumber<T>(
  db: D1Compat,
  write: (membershipNumber: string) => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const membershipNumber = await mintMembershipNumber(db)
    try {
      return await write(membershipNumber)
    } catch (error) {
      if (!isMembershipCollision(error)) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not mint a unique membership number')
}
