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
