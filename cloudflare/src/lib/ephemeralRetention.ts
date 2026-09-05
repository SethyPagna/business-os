// Scheduled retention for EPHEMERAL / LOG / expired-auth tables.
//
// The Aug-31 bloat audit found that the ONLY time-based retention on the cron
// was audit_logs + the import-staging tables. Every other table that grows
// over time had no automatic cleanup at all, so several would steadily
// re-bloat D1 no matter how often the import-staging fix ran. The highest-
// inflow offenders:
//   - rate_limit_events   -- one row per ALLOWED request on ~15 public/auth
//                            endpoints; the sliding window only filters the
//                            COUNT read, nothing ever deleted.
//   - user_sessions / portal_sessions -- one row per login; logout/expire were
//                            soft revoked_at/expires_at UPDATEs, never deleted.
//   - verification_codes, login_lockouts, portal_auth_lockouts, trusted_devices
//                         -- expired/consumed/revoked auth material, never GC'd.
//   - ai_response_logs    -- one row per anonymous portal AI chat, with several
//                            uncapped JSON columns, and no delete path anywhere.
//   - action_history      -- one undo/redo row per action, payloads up to ~20KB
//                            each, only ever cleared by a factory reset.
//
// None of these is business data (action_history is undo history, pruned only
// on a long window). This sweep prunes each by age / expiry / revocation, in
// bounded batches, and is throttled + guarded exactly like the other scheduled
// sweeps (index.ts wraps it in its own try/catch, and each table is guarded
// here too so one missing/locked table cannot stop the rest).

import { getDb } from './db'
import { sqliteUtcTimestamp } from './rateLimit'
import type { Env } from '../index'

const LAST_RUN_KEY = 'ephemeral_retention_last_run'
// 5h (not 6h) so ordinary jitter between 6h ticks can never make every second
// tick skip -- same reasoning as importRetention's interval.
const MIN_INTERVAL_MS = 5 * 60 * 60 * 1000

// Retention windows (days). Deliberately conservative for anything a person
// might look back at; aggressive for pure telemetry.
const RATE_LIMIT_TTL_DAYS = 1        // pure throwaway rate-limit telemetry
// Reset issuance counts consumed/expired rows too. Keep at least one hour
// of history (longer than its 15-minute quotas) so cleanup cannot reset them.
const VERIFICATION_HISTORY_MS = 60 * 60 * 1000
const AI_LOG_TTL_DAYS = 30           // operational AI-chat logs
const TRUSTED_DEVICE_TTL_DAYS = 30   // after revocation
const LOCKOUT_TTL_DAYS = 1           // stale (no-longer-locked) lockout rows
const ACTION_HISTORY_TTL_DAYS = 180  // undo history -- generous; undo is a recent-action feature

// Per-statement row cap so one sweep never builds an unbounded D1 transaction
// (D1 has its own per-statement CPU/row budget). D1 does not support
// `DELETE ... LIMIT`, so we delete by a bounded sub-select of ids and loop.
const DELETE_BATCH = 5000

// SQLite CURRENT_TIMESTAMP renders 'YYYY-MM-DD HH:MM:SS' (UTC); age cutoffs
// must be formatted the SAME way to compare correctly.
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

async function getSettingValue(env: Env, key: string): Promise<string | null> {
  const row = await getDb(env).prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key })
  return row?.value ?? null
}
async function setSettingValue(env: Env, key: string, value: string): Promise<void> {
  await getDb(env).prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ key, value })
}

type Db = ReturnType<typeof getDb>

// Bounded delete for tables that have an integer `id` PK: repeatedly delete a
// capped slice matching `where` until fewer than a full batch remain.
async function batchDeleteById(db: Db, table: string, where: string, params: Record<string, unknown>): Promise<number> {
  let total = 0
  for (;;) {
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${where} LIMIT ${DELETE_BATCH})`)
      .run(params)
    const n = result.changes || 0
    total += n
    if (n < DELETE_BATCH) break
  }
  return total
}

// Direct delete for the small PK-less lockout tables (bounded by distinct
// usernames/keys, so no batching needed).
async function directDelete(db: Db, table: string, where: string, params: Record<string, unknown>): Promise<number> {
  const result = await db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(params)
  return result.changes || 0
}

export interface EphemeralRetentionResult {
  skipped: boolean
  reason?: string
  deleted?: Record<string, number>
}

export async function maybeRunScheduledEphemeralRetention(env: Env): Promise<EphemeralRetentionResult> {
  const lastRunRaw = await getSettingValue(env, LAST_RUN_KEY)
  const lastRun = lastRunRaw ? Date.parse(lastRunRaw) : 0
  if (lastRun && Date.now() - lastRun < MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'ran-recently' }
  }

  const db = getDb(env)
  const deleted: Record<string, number> = {}
  // Each table guarded independently: a table missing on a not-yet-migrated
  // local DB, or a transient error on one, must not stop the others.
  const step = async (label: string, fn: () => Promise<number>) => {
    try { deleted[label] = await fn() } catch (error) { console.error(`[ephemeral-retention] ${label} failed`, (error as Error)?.message || error) }
  }

  await step('rate_limit_events', () => batchDeleteById(db, 'rate_limit_events', 'created_at < @cutoff', { cutoff: daysAgo(RATE_LIMIT_TTL_DAYS) }))
  await step('user_sessions', () => batchDeleteById(db, 'user_sessions', "revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)", {}))
  await step('portal_sessions', () => batchDeleteById(db, 'portal_sessions', "revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)", {}))
  const verificationNow = Date.now()
  await step('verification_codes', () => batchDeleteById(db, 'verification_codes', `
    created_at <= @historyCutoff
    AND (consumed_at IS NOT NULL OR julianday(expires_at) <= julianday(@now))
  `, {
    historyCutoff: sqliteUtcTimestamp(verificationNow - VERIFICATION_HISTORY_MS),
    now: sqliteUtcTimestamp(verificationNow),
  }))
  await step('trusted_devices', () => batchDeleteById(db, 'trusted_devices', 'revoked_at IS NOT NULL AND revoked_at < @cutoff', { cutoff: daysAgo(TRUSTED_DEVICE_TTL_DAYS) }))
  await step('ai_response_logs', () => batchDeleteById(db, 'ai_response_logs', 'created_at < @cutoff', { cutoff: daysAgo(AI_LOG_TTL_DAYS) }))
  await step('action_history', () => batchDeleteById(db, 'action_history', 'created_at < @cutoff', { cutoff: daysAgo(ACTION_HISTORY_TTL_DAYS) }))
  await step('login_lockouts', () => directDelete(db, 'login_lockouts', '(locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) AND updated_at < @cutoff', { cutoff: daysAgo(LOCKOUT_TTL_DAYS) }))
  await step('portal_auth_lockouts', () => directDelete(db, 'portal_auth_lockouts', '(locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) AND updated_at < @cutoff', { cutoff: daysAgo(LOCKOUT_TTL_DAYS) }))

  await setSettingValue(env, LAST_RUN_KEY, new Date().toISOString())
  return { skipped: false, deleted }
}
