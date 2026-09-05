// One authority for newly minted IDs. Legacy helpers below remain for historical compatibility;
// existing identities are never renumbered. New IDs contain eight secure random A-Z/0-9 characters.
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
const MEMBERSHIP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MEMBERSHIP_ATTEMPTS = 32

export function randomMembershipNumber(): string {
  let result = ''
  // Rejection sampling avoids bias from 256 not being divisible by 36.
  for (let draw = 0; draw < MEMBERSHIP_ATTEMPTS && result.length < 8; draw += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    for (const byte of bytes) {
      if (byte < 252) result += MEMBERSHIP_ALPHABET[byte % 36]
      if (result.length === 8) break
    }
  }
  if (result.length !== 8) throw new Error('Could not generate a membership number')
  return result
}

export function createMembershipNumberAllocator(existingNumbers: Iterable<unknown>): () => string {
  const taken = new Set(Array.from(existingNumbers, normalizeMembershipNumber))
  return () => {
    for (let attempt = 0; attempt < MEMBERSHIP_ATTEMPTS; attempt += 1) {
      const candidate = randomMembershipNumber()
      if (taken.has(candidate)) continue
      taken.add(candidate)
      return candidate
    }
    throw new Error('Could not mint a unique membership number')
  }
}

export async function mintMembershipNumber(db: D1Compat, extraTaken: Iterable<unknown> = []): Promise<string> {
  const allocate = createMembershipNumberAllocator(extraTaken)
  for (let attempt = 0; attempt < MEMBERSHIP_ATTEMPTS; attempt += 1) {
    const candidate = allocate()
    const collision = await db.prepare(
      'SELECT id FROM customers WHERE lower(trim(membership_number)) = lower(@candidate) LIMIT 1',
    ).get({ candidate })
    if (!collision) return candidate
  }
  throw new Error('Could not mint a unique membership number')
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
 * that number first, mint a fresh random value and retry. The database unique
 * index remains the final arbiter when concurrent writers choose the same ID.
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
