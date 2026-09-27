import { getDb } from './db'
import type { Env } from '../index'

// checkRateLimit (lib/rateLimit.ts) already guards /login with a sliding
// window (8 failures / 15 min per username) -- but a sliding window resets
// itself once the window rolls past, and it doesn't escalate: attempt 6
// and attempt 60 get the same flat "try again later". The ask here is
// different: after 5 failures, tell the person to wait, and make every
// further failure wait *longer*, with the count only clearing on a
// successful login -- so this tracks its own persistent per-username
// counter in a dedicated table rather than reusing rate_limit_events.
//
// Free attempts: 5 (matches "if login fails more than 5 times").
// From the 6th failure on, wait = LOCKOUT_BASE_SECONDS * 2^(failures-6),
// capped at LOCKOUT_MAX_SECONDS -- so 6th=30s, 7th=60s, 8th=120s, ...
// up to the 30-minute cap, and it keeps re-arming the same escalating
// wait on every failure while still locked, per "increments every time
// until successful".
const FREE_ATTEMPTS = 5
const LOCKOUT_BASE_SECONDS = 30
const LOCKOUT_MAX_SECONDS = 30 * 60

function lockoutKey(username: string): string {
  return String(username || '').trim().toLowerCase()
}

// The typed-identifier key above gives every alias of one account (its
// username in any case, its email, its phone, its display name) a bucket of
// its own, so an attacker rotating aliases got 5 free guesses per alias. Once
// a route has RESOLVED the account it also keys on this id-based value, which
// every alias shares. The '#' prefix keeps it out of the lowercased
// typed-username space in practice; a collision would only let someone lock
// an account they could already lock by typing its username.
export function userIdLockoutKey(userId: number | string): string {
  return `#uid:${Number(userId)}`
}

// S-auth4d: every lockout key is ALSO scoped to the network it came from.
// Keyed on the account alone, anyone who knew a username could fail it six
// times from anywhere and lock the owner out at the shop -- and one failure
// every 30 minutes kept the wait armed. Scoped, the failing network waits
// and the owner's does not. Guessing spread across many networks is bounded
// separately by the routes' account-wide failure ceiling. The '@' suffix is
// applied after the lowercasing above, so every alias still shares one key
// per network (P2-1).
export function perNetworkLockoutKey(key: string, ip: string | null | undefined): string {
  return `${lockoutKey(key)}@${String(ip || 'unknown').trim().toLowerCase()}`
}

function computeWaitSeconds(failedCount: number): number {
  if (failedCount <= FREE_ATTEMPTS) return 0
  const doublings = failedCount - FREE_ATTEMPTS - 1
  const wait = LOCKOUT_BASE_SECONDS * Math.pow(2, Math.max(0, doublings))
  return Math.min(wait, LOCKOUT_MAX_SECONDS)
}

export type LoginLockoutState = {
  locked: boolean
  failedCount: number
  retryAfterSeconds: number
}

// A route that checks or feeds more than one key (the typed identifier AND
// the resolved account id) answers with the most restrictive of them, so the
// caller builds one message and never reveals which key tripped.
export function worstLockoutState(...states: LoginLockoutState[]): LoginLockoutState {
  return states.reduce<LoginLockoutState>((worst, state) => ({
    locked: worst.locked || state.locked,
    failedCount: Math.max(worst.failedCount, state.failedCount),
    retryAfterSeconds: Math.max(worst.retryAfterSeconds, state.retryAfterSeconds),
  }), { locked: false, failedCount: 0, retryAfterSeconds: 0 })
}

// Read-only check -- call before verifying credentials so a still-locked
// account never even reaches the password compare.
export async function getLoginLockoutState(env: Env, username: string): Promise<LoginLockoutState> {
  const db = getDb(env)
  const row = await db.prepare(`
    SELECT failed_count, locked_until FROM login_lockouts WHERE username = ?
  `).get<{ failed_count: number; locked_until: string | null }>([lockoutKey(username)])
  if (!row || !row.locked_until) return { locked: false, failedCount: row?.failed_count || 0, retryAfterSeconds: 0 }

  const remainingMs = new Date(row.locked_until).getTime() - Date.now()
  if (remainingMs <= 0) return { locked: false, failedCount: row.failed_count, retryAfterSeconds: 0 }
  return { locked: true, failedCount: row.failed_count, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
}

// Call on every failed login (bad password or unknown username -- unknown
// username is still keyed by the typed value, same as the existing
// per-username rate-limit bucket, so a nonexistent-username probe can't
// dodge the counter either). Returns the resulting state so the route can
// build one consistent error message from it.
export async function recordFailedLogin(env: Env, username: string): Promise<LoginLockoutState> {
  const db = getDb(env)
  const key = lockoutKey(username)
  const existing = await db.prepare(`SELECT failed_count FROM login_lockouts WHERE username = ?`).get<{ failed_count: number }>([key])
  const failedCount = (existing?.failed_count || 0) + 1
  const waitSeconds = computeWaitSeconds(failedCount)
  const lockedUntil = waitSeconds > 0 ? new Date(Date.now() + waitSeconds * 1000).toISOString() : null

  if (existing) {
    await db.prepare(`
      UPDATE login_lockouts SET failed_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?
    `).run([failedCount, lockedUntil, key])
  } else {
    await db.prepare(`
      INSERT INTO login_lockouts (username, failed_count, locked_until) VALUES (?, ?, ?)
    `).run([key, failedCount, lockedUntil])
  }

  return { locked: waitSeconds > 0, failedCount, retryAfterSeconds: waitSeconds }
}

// Call on every successful login -- clears the counter back to zero, per
// "increments every time until successful". A row with 0 failures and no
// lock is left alone rather than deleted-then-reinserted on the next
// failure; either is fine correctness-wise, this just avoids a write on
// the common case (successful login, no prior failures).
export async function clearLoginLockout(env: Env, username: string): Promise<void> {
  const db = getDb(env)
  await db.prepare(`DELETE FROM login_lockouts WHERE username = ?`).run([lockoutKey(username)])
}
