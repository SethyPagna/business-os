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
// The house format is `LC-#####` (Leang Cosmetic), zero-padded to
// MEMBERSHIP_SEQUENCE_DIGITS, and the sequence is GAP-FILLING: the next
// number handed out is the smallest positive integer not currently in use,
// so a number freed by a deleted/merged customer is reused before the
// sequence grows.
//
// DECISION (owner, 2026-09-06): gap-fill deliberately reuses a number freed
// by a hard delete, and an undo/redo of that delete must NOT fail because of
// it. Customers/suppliers/delivery_contacts are hard-deleted (bulkDeleteEngine.ts,
// routes/contacts.ts's single-row DELETE), and their undo/redo replays the
// exact original membership_number byte-for-byte (CustomersTab.tsx's
// buildCustomerPayload feeds it back into POST /customers). Between the
// delete and the undo, that freed slot is fair game for the next brand-new
// signup or manual add — gap-filling on purpose is the whole point of this
// file — so a same-number collision on restore is a real, if rare, race, not
// a bug in the caller. routes/contacts.ts's create route treats that one
// case (a body carrying `isUndoRestore: true`) by minting a fresh number
// instead of the flat 400 a normal manual add gets for the same collision
// (which stays a hard reject — that path IS a real typo/duplicate signal).
//
// Two tables share this ONE sequence: customers.membership_number (the CRM)
// and portal_accounts.membership_id (the storefront -- a signup mints from
// here too, see portalAccounts.ts). mintMembershipNumber() reads both before
// picking a gap, so a portal account with no matching customer row yet (e.g.
// a signup whose contact fold failed) still reserves its slot.
//
// Uniqueness has exactly one guarantee PER TABLE: the partial UNIQUE index
// `idx_customers_membership_lower_pg` on lower(customers.membership_number)
// (migration 0015) and `idx_portal_accounts_membership` on
// lower(portal_accounts.membership_id) (migration 0087). Everything here is
// an optimisation on top of those -- mintMembershipNumber() picks the gap,
// and withMintedMembershipNumber() re-mints and retries when a concurrent
// writer wins the race.
//
// 2026-09-06 (owner): a prior change ("mint secure IDs") replaced this
// gap-filling LC- sequence with eight random A-Z0-9 characters for every
// NEWLY created customer, while the 4,966 customers that already existed
// stayed on LC-00001..LC-04966 (migration 0110's backfill) and the Add
// Customer form kept promising "The next available LC- number is assigned
// when you save." Two of the three minting paths (manual add, storefront
// signup) were quietly minting the wrong shape. Restored to LC- gap-filling
// everywhere; the random path is gone, not kept as a fallback.

import type { D1Compat } from './db'

export const MEMBERSHIP_PREFIX = 'LC-'
export const MEMBERSHIP_SEQUENCE_DIGITS = 5
/** Shown as an input placeholder / example. Never written to the database. */
export const MEMBERSHIP_PLACEHOLDER = 'LC-00001'

/**
 * SQLite GLOB fragment selecting rows whose `column` is `LC-`/`lc-` + digits
 * only. Folded to lowercase on both sides: GLOB is case-sensitive (unlike
 * LIKE), and a hand-typed membership number is stored exactly as entered --
 * routes/contacts.ts's create/update paths do not force it to uppercase, so
 * a staff-typed `lc-00042` is a real row this must still recognise as taken
 * (parseMembershipSequence already treats it as sequence 42 via its own
 * upper-casing; this glob has to agree, or gap-fill would keep handing out
 * a number that only fails at INSERT time via the case-insensitive UNIQUE
 * index, exhausting withMintedMembershipNumber's retry budget on a number
 * it could have skipped up front). Also trimmed on both sides: `trim()`
 * matches parseMembershipSequence's own `String(value).trim().toUpperCase()`
 * (:108) and the lookup queries elsewhere (`lower(trim(membership_number)) =
 * lower(trim(@m))`), so a hand-typed ` LC-00001 ` with stray whitespace is
 * recognised as taken by every caller identically -- without it this glob
 * disagreed with parseMembershipSequence, so a padded row could pass the SQL
 * filter as untaken, get handed out again by gap-fill, and only fail at
 * INSERT time via the trim-agnostic UNIQUE index.
 *
 * Exported so every caller that needs to query a differently-named column
 * for the same house format (mintMembershipNumber's own portal_accounts
 * read below, and lib/importEngine.ts's classifyContacts, which unions
 * portal_accounts.membership_id into its customers-only allocator seed)
 * shares this ONE glob rather than hand-rolling their own and drifting.
 */
export function membershipGlob(column: string): string {
  return `lower(trim(${column})) GLOB 'lc-[0-9]*' AND lower(trim(${column})) NOT GLOB 'lc-*[^0-9]*'`
}

/** SQLite GLOB that selects rows whose number is `LC-` followed by digits only. */
export const MEMBERSHIP_SQL_GLOB = membershipGlob('membership_number')

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
 * one file can't collide with each other. The caller (lib/importEngine.ts's
 * classifyContacts) is responsible for folding in every other store that
 * shares this sequence before calling this -- a bulk import never WRITES
 * portal_accounts, but a portal signup can reserve a slot in it with no
 * matching customer row yet (a fold failure), so that slot is still real and
 * must not be handed out twice; see mintMembershipNumber below for the
 * DB-facing minter that unions both tables on every call instead of relying
 * on a caller-supplied snapshot.
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

/**
 * The next house number, gap-filled over every store that shares the
 * sequence: `customers.membership_number`, `portal_accounts.membership_id`
 * (a storefront signup mints from here too -- see portalAccounts.ts), and
 * `extraTaken`, a caller-supplied set of numbers not yet persisted anywhere
 * (e.g. other rows already assigned earlier in the same in-flight import
 * batch). Reading both tables here, rather than trusting a caller to fold
 * portal_accounts into extraTaken, means an orphaned portal account (e.g. a
 * signup whose contact fold failed, leaving no matching customer row) still
 * reserves its slot for every caller, not just the one that happened to pass
 * it in.
 *
 * The database's own UNIQUE indexes remain the final arbiter for a lost
 * race; see withMintedMembershipNumber below.
 */
export async function mintMembershipNumber(db: D1Compat, extraTaken: Iterable<unknown> = []): Promise<string> {
  const sequences: number[] = []
  for (const value of extraTaken) {
    const sequence = parseMembershipSequence(value)
    if (sequence !== null) sequences.push(sequence)
  }

  const customerRows = await db.prepare(
    `SELECT membership_number FROM customers WHERE ${MEMBERSHIP_SQL_GLOB}`,
  ).all<{ membership_number: string }>()
  for (const row of customerRows) {
    const sequence = parseMembershipSequence(row.membership_number)
    if (sequence !== null) sequences.push(sequence)
  }

  const portalRows = await db.prepare(
    `SELECT membership_id FROM portal_accounts WHERE ${membershipGlob('membership_id')}`,
  ).all<{ membership_id: string }>()
  for (const row of portalRows) {
    const sequence = parseMembershipSequence(row.membership_id)
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
