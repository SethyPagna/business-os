import type { Env } from '../index'
import type { FailedSignInFloor } from './passwordHash'
import { resolvePlanTier, type PlanTier } from './planTier'

// Which work a FAILED sign-in must cost (lib/passwordHash.ts
// spendFailedSignInFloor), per account table. RELEASE-20261006-VERIFY
// Exception 3: once E6 made a current hash cheap (~5 ms of PBKDF2), a
// legacy bcrypt row with a wrong password still cost ~150 ms, so the answer
// time showed which staff usernames and storefront phones have accounts.
// A failure therefore costs as much as the slowest real check that can still
// happen in that table:
//   - Paid, a bcrypt row may remain (or that is not known): 'bcrypt'.
//   - Paid, none remain: 'pbkdf2-sha256'.
//   - PLAN_TIER=free: always 'pbkdf2-sha256' -- a bcrypt-10 compare does not
//     fit the 10 ms CPU limit, so it never runs as padding there. While bcrypt
//     rows remain on Free the gap is back for those rows only; a warning is
//     logged once per isolate and table, and GET /api/users/password-hash-status
//     names the staff accounts still pending.
//
// "Does a bcrypt row remain" is one LIMIT 1 query per table, cached in isolate
// memory for LEGACY_STATE_TTL_MS: no D1 read per sign-in and no write at all.
// The cache is moved by what sign-ins see: a bcrypt row checked in this
// isolate marks the table 'remains' at once, and a successful upgrade clears
// the entry so the next sign-in re-asks (that is how the last upgrade turns
// the floor down without waiting for the TTL). A failed query is not cached
// and counts as "unknown", which is 'bcrypt' on Paid (fail safe).
// Both callers resolve the floor BEFORE branching on whether the account
// exists, so a cache miss's D1 round trip is spent on both paths alike.
export type SignInTable = 'users' | 'portal_accounts'

// users: only rows POST /login can actually check -- deleted and inactive
// accounts take the unknown-account path. Matches the readiness report's
// activeLegacyBcrypt. portal_accounts: every row can be checked.
export const LEGACY_BCRYPT_SQL: Readonly<Record<SignInTable, string>> = {
  users: "SELECT 1 AS legacy FROM users WHERE deleted_at IS NULL AND is_active = 1 AND substr(password, 1, 4) IN ('$2a$', '$2b$', '$2y$') LIMIT 1",
  portal_accounts: "SELECT 1 AS legacy FROM portal_accounts WHERE substr(password_hash, 1, 4) IN ('$2a$', '$2b$', '$2y$') LIMIT 1",
}
export const LEGACY_STATE_TTL_MS = 5 * 60 * 1000

type ReadDb = { prepare(sql: string): { get<T = unknown>(params?: Record<string, unknown>): Promise<T | null | undefined> } }

const legacyState = new Map<SignInTable, { remains: boolean; until: number }>()
const warnedFree = new Set<SignInTable>()

// true / false from a fresh or cached answer; null when the query failed.
export async function legacyBcryptRemains(db: ReadDb, table: SignInTable, now: number = Date.now()): Promise<boolean | null> {
  const cached = legacyState.get(table)
  if (cached && cached.until > now) return cached.remains
  try {
    const row = await db.prepare(LEGACY_BCRYPT_SQL[table]).get<{ legacy: number }>({})
    const remains = Boolean(row)
    legacyState.set(table, { remains, until: now + LEGACY_STATE_TTL_MS })
    return remains
  } catch (error) {
    console.warn(`[password-hash] could not tell whether bcrypt hashes remain in ${table}:`, String((error as Error)?.message || error))
    return null
  }
}

// A sign-in just checked a bcrypt row in this table.
export function noteLegacyBcryptSeen(table: SignInTable, now: number = Date.now()): void {
  legacyState.set(table, { remains: true, until: now + LEGACY_STATE_TTL_MS })
}

// A bcrypt row in this table was just rewritten: ask again next time.
export function noteLegacyBcryptUpgraded(table: SignInTable): void {
  legacyState.delete(table)
}

export function chooseFailedSignInFloor(tier: PlanTier, remains: boolean | null): FailedSignInFloor {
  if (tier === 'free') return 'pbkdf2-sha256'
  return remains === false ? 'pbkdf2-sha256' : 'bcrypt'
}

export async function failedSignInFloor(env: Env, db: ReadDb, table: SignInTable): Promise<FailedSignInFloor> {
  const remains = await legacyBcryptRemains(db, table)
  const tier = resolvePlanTier(env)
  if (tier === 'free' && remains !== false && !warnedFree.has(table)) {
    warnedFree.add(table)
    console.warn(`[password-hash] PLAN_TIER=free while legacy bcrypt hashes ${remains ? 'remain' : 'may remain'} in ${table}; failed sign-ins are padded with PBKDF2 only, so a wrong password on a bcrypt account answers slower than an unknown one. Check GET /api/users/password-hash-status.`)
  }
  return chooseFailedSignInFloor(tier, remains)
}

export function __resetFailedSignInCostForTests(): void {
  legacyState.clear()
  warnedFree.clear()
}
