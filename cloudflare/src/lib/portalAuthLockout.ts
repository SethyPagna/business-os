import { getDb } from './db'
import type { Env } from '../index'

// Flat per-flow lockout for the storefront auth surface. The user's rule is
// literal: "cannot fail more than ten times for each sign up and another 10
// times for each sign in." So — unlike the staff login lockout
// (lib/loginLockout.ts, 5 free then an ESCALATING wait) — this is a flat cap
// of 10 failures per (scope,key), then a fixed cooldown, then a fresh window.
// Kept in its own table (portal_auth_lockouts) so the two philosophies never
// share a row.
//
// scope is 'signup' or 'signin'. key is the CANONICAL phone for signin (so a
// single targeted account can't be hammered regardless of source IP) and the
// client IP for signup (there is no stable account yet). The caller layers a
// per-IP sliding window (lib/rateLimit.ts) on top for broad abuse.

export type PortalLockoutScope = 'signup' | 'signin'

const MAX_FAILURES = 10
const COOLDOWN_SECONDS = 30 * 60

export type PortalLockoutState = {
  locked: boolean
  failedCount: number
  retryAfterSeconds: number
}

function normKey(scope: PortalLockoutScope, key: string): { scope: string; key: string } {
  return { scope, key: String(key || '').trim().toLowerCase() }
}

// Read-only — call BEFORE any DB probe so a locked key never even reaches the
// account lookup (this is also what keeps signup/signin from being a free
// enumeration oracle once someone is rate-limited).
export async function getPortalLockoutState(env: Env, scope: PortalLockoutScope, key: string): Promise<PortalLockoutState> {
  const k = normKey(scope, key)
  if (!k.key) return { locked: false, failedCount: 0, retryAfterSeconds: 0 }
  const row = await getDb(env).prepare(
    'SELECT failed_count, locked_until FROM portal_auth_lockouts WHERE scope = @scope AND key = @key',
  ).get<{ failed_count: number; locked_until: string | null }>(k)
  if (!row || !row.locked_until) return { locked: false, failedCount: row?.failed_count || 0, retryAfterSeconds: 0 }
  const remainingMs = new Date(row.locked_until).getTime() - Date.now()
  if (remainingMs <= 0) return { locked: false, failedCount: 0, retryAfterSeconds: 0 } // cooldown elapsed => fresh window
  return { locked: true, failedCount: row.failed_count, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
}

// Call on every failure. Once the count reaches MAX_FAILURES the key is locked
// for COOLDOWN_SECONDS; an expired lock starts counting fresh from this
// failure so the cooldown is a reset, not a permanent brick.
export async function recordPortalFailure(env: Env, scope: PortalLockoutScope, key: string): Promise<PortalLockoutState> {
  const k = normKey(scope, key)
  if (!k.key) return { locked: false, failedCount: 0, retryAfterSeconds: 0 }
  const db = getDb(env)
  const existing = await db.prepare(
    'SELECT failed_count, locked_until FROM portal_auth_lockouts WHERE scope = @scope AND key = @key',
  ).get<{ failed_count: number; locked_until: string | null }>(k)

  // A previous lock whose cooldown has elapsed resets the window.
  const priorExpired = existing?.locked_until ? new Date(existing.locked_until).getTime() <= Date.now() : false
  const base = existing && !priorExpired ? existing.failed_count : 0
  const failedCount = base + 1
  const lockedUntil = failedCount >= MAX_FAILURES ? new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString() : null

  if (existing) {
    await db.prepare(
      'UPDATE portal_auth_lockouts SET failed_count = @failed_count, locked_until = @locked_until, updated_at = CURRENT_TIMESTAMP WHERE scope = @scope AND key = @key',
    ).run({ ...k, failed_count: failedCount, locked_until: lockedUntil })
  } else {
    await db.prepare(
      'INSERT INTO portal_auth_lockouts (scope, key, failed_count, locked_until) VALUES (@scope, @key, @failed_count, @locked_until)',
    ).run({ ...k, failed_count: failedCount, locked_until: lockedUntil })
  }
  return {
    locked: !!lockedUntil,
    failedCount,
    retryAfterSeconds: lockedUntil ? COOLDOWN_SECONDS : 0,
  }
}

// Call on success — clears the counter for that key.
export async function clearPortalLockout(env: Env, scope: PortalLockoutScope, key: string): Promise<void> {
  const k = normKey(scope, key)
  if (!k.key) return
  await getDb(env).prepare('DELETE FROM portal_auth_lockouts WHERE scope = @scope AND key = @key').run(k)
}
