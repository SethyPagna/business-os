import { getDb } from './db'
import { ACTOR_USERNAME_SQL, resolveActorUsername } from './actorSnapshot'
import type { Env } from '../index'

// Default retention window, in days, for automatic audit-log cleanup. This
// replaced a manual "Clear 30d" button in the Audit Logs UI -- retention is
// now enforced automatically on the cron schedule (see maybeRunScheduledAuditLogRetention
// below) instead of requiring an admin to remember to click something.
// Admins can override this via the "audit_log_retention_days" row in the
// settings table (exposed as a Settings-page field).
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 21
const AUDIT_LOG_RETENTION_SETTING_KEY = 'audit_log_retention_days'
const AUDIT_LOG_RETENTION_LAST_RUN_KEY = 'audit_log_retention_last_run'
// Deleting is a full-table scan on created_at, so the scheduled worker
// (which ticks every 6h per wrangler.toml's cron trigger) only actually
// performs a delete pass once per day -- frequent enough that the log table
// never grows much past the configured retention window, infrequent enough
// to not do needless work on every tick.
const AUDIT_LOG_RETENTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

// Ported from backend/src/helpers.ts's audit(). Deliberately swallows its
// own errors (matching the original's comment: "Audit failures must never
// crash the main request") -- an audit log write failing should never be
// the reason a branch/product/sale save fails for the person using the app.
//
// Part 133: audit_logs.device_name/device_tz/client_time have existed on
// the schema since migration 0001, and the Audit Log UI (`auditDeviceLabel`/
// `auditTimezoneLabel` in AuditLog.tsx) already reads and displays them --
// but this was the *only* place anything ever writes an audit_logs row
// (confirmed: `grep -rn "INSERT INTO audit_logs"` across the whole
// `cloudflare/src` tree returns exactly this one call site), and its
// INSERT never included those three columns. Every audit log entry the
// app has ever written has a null device_name/device_tz/client_time,
// silently falling back to the UI's generic "Web login"/"Web session"
// label for every single row, not just an edge case. Fixed by looking up
// the calling user's own most-recently-active live session (device_name/
// device_tz already captured there at login time, see createSession/
// lib/auth.ts) at write time -- deliberately NOT changing this function's
// public signature (userId, userName, action, entity, entityId, details),
// so none of this function's 40+ existing call sites across routes/*.ts
// need to change. client_time isn't available this way (that's a
// per-request client-clock value a small number of callers already thread
// through their own request body separately, e.g. products.ts/compat.ts's
// allowed-fields lists) -- left null here rather than guessed at with the
// server's own clock, since `auditTimezoneLabel`'s fallback already
// produces a reasonable "Server time" label for that case.
async function lookupAuditDeviceInfo(
  env: Env,
  userId: number | null,
): Promise<{ device_name: string | null; device_tz: string | null }> {
  if (!userId) return { device_name: null, device_tz: null }
  try {
    const db = getDb(env)
    const row = await db.prepare(`
      SELECT device_name, device_tz
      FROM user_sessions
      WHERE user_id = @user_id AND revoked_at IS NULL
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 1
    `).get<{ device_name: string | null; device_tz: string | null }>({ user_id: userId })
    return { device_name: row?.device_name ?? null, device_tz: row?.device_tz ?? null }
  } catch (_) {
    return { device_name: null, device_tz: null }
  }
}

// N13: the actor stored on an audit row is the account USERNAME, resolved here
// from users.id rather than taken on trust from the caller.
//
// audit() is called from 130+ places and every one of them passed a *display*
// name -- `user?.name` (the full name) at almost all sites, `user.name ||
// user.username` at a handful -- so the Audit Log read "Za Sethy" while the
// stock, sale and return ledgers built from the same session read "za".
// Resolving from the id fixes every call site at once and makes the value
// unforgeable: the only thing a caller influences is WHICH account id it names,
// and that already comes from the authenticated session.
//
// audit_logs stays OUT of the rename cascade (see userIdentity.ts) because an
// audit row is a point-in-time record; storing the username at write time is
// what makes that exclusion harmless instead of a second naming convention.
async function resolveAuditActorName(
  env: Env,
  userId: number | null,
  provided: string | null,
): Promise<string | null> {
  if (!userId) return resolveActorUsername(null, provided)
  try {
    const db = getDb(env)
    const row = await db.prepare(ACTOR_USERNAME_SQL).get<{ username: string | null }>({ user_id: userId })
    return resolveActorUsername(row, provided)
  } catch (_) {
    // Audit failures must never crash the main request -- fall back to the
    // value the caller already resolved (post-N13 that is itself the username).
    return resolveActorUsername(null, provided)
  }
}

export async function audit(
  env: Env,
  userId: number | null,
  userName: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = null,
): Promise<void> {
  try {
    const detailsStr = details != null
      ? (typeof details === 'object' ? JSON.stringify(details) : String(details))
      : null
    const { device_name: deviceName, device_tz: deviceTz } = await lookupAuditDeviceInfo(env, userId)
    const actorName = await resolveAuditActorName(env, userId, userName)
    const db = getDb(env)
    await db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value, device_name, device_tz)
      VALUES (@user_id, @user_name, @action, @entity, @entity_id, @details, @table_name, @record_id, @new_value, @device_name, @device_tz)
    `).run({
      user_id: userId,
      user_name: actorName,
      action,
      entity,
      entity_id: entityId,
      details: detailsStr,
      table_name: entity,
      record_id: entityId,
      new_value: detailsStr,
      device_name: deviceName,
      device_tz: deviceTz,
    })
  } catch (_) {
    // Swallow -- see comment above.
  }
}

async function getSettingValue(env: Env, key: string): Promise<string | null> {
  const db = getDb(env)
  const row = await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key })
  return row?.value ?? null
}

async function setSettingValue(env: Env, key: string, value: string): Promise<void> {
  const db = getDb(env)
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ key, value })
}

export async function getAuditLogRetentionDays(env: Env): Promise<number> {
  const raw = await getSettingValue(env, AUDIT_LOG_RETENTION_SETTING_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUDIT_LOG_RETENTION_DAYS
}

// Runs on the scheduled worker tick. Deletes audit_logs rows older than the
// configured retention window (default 21 days, see DEFAULT_AUDIT_LOG_RETENTION_DAYS),
// throttled to at most once per day so a 6h cron tick doesn't re-scan the
// table for nothing.
export async function maybeRunScheduledAuditLogRetention(env: Env): Promise<{ skipped: boolean; reason?: string; deleted?: number; retentionDays?: number }> {
  const lastRunRaw = await getSettingValue(env, AUDIT_LOG_RETENTION_LAST_RUN_KEY)
  const lastRun = lastRunRaw ? Date.parse(lastRunRaw) : 0
  if (lastRun && Date.now() - lastRun < AUDIT_LOG_RETENTION_MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'ran-recently' }
  }
  const retentionDays = await getAuditLogRetentionDays(env)
  // Compare the RAW created_at column against a full 'YYYY-MM-DD HH:MM:SS'
  // cutoff. The old `date(created_at) < @cutoff` wrapped the column in a
  // function, which defeats any index on created_at and forces a full-table
  // scan, and it deleted in ONE unbounded statement -- on a large backlog that
  // can exceed D1's per-statement CPU/row budget and throw every run, so the
  // table never shrinks. Batch by id (audit_logs has an integer id) so each
  // statement stays bounded; D1 has no `DELETE ... LIMIT`, hence the sub-select.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const db = getDb(env)
  let deleted = 0
  for (;;) {
    const result = await db.prepare('DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < @cutoff LIMIT 5000)').run({ cutoff })
    const n = result.changes ?? 0
    deleted += n
    if (n < 5000) break
  }
  await setSettingValue(env, AUDIT_LOG_RETENTION_LAST_RUN_KEY, new Date().toISOString())
  if (deleted > 0) {
    await audit(env, null, null, 'audit_log_retention_auto_delete', 'audit_log', null, { retentionDays, cutoffDate: cutoff, deleted })
  }
  return { skipped: false, deleted, retentionDays }
}
