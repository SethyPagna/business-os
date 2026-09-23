import { getDb } from './db'
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

// Return bulk undo/redo audit rows are the only durable source of the actor
// and timestamp for those replays. The operation receipt retains the status
// transition and generation, but it cannot identify who replayed it or when.
// Shift lifecycle requests also use their atomic audit row as the durable
// replay receipt. Only the four exact-request lifecycle actions qualify;
// ordinary Shift logs and legacy writes without request identity still age out.
// Keep this predicate narrow: ordinary audit data, the original bulk receipt,
// and unrelated undo/redo rows continue to follow the configured retention.
export function buildAuditLogRetentionDeleteSql(): string {
  return `DELETE FROM audit_logs WHERE id IN (
    SELECT id FROM audit_logs
    WHERE created_at < @cutoff
      AND NOT COALESCE(CASE WHEN json_valid(details) THEN (
        (entity = 'return'
        AND action IN ('action_undo','action_redo')
        AND json_extract(details, '$.kind') = 'return.fields.bulk'
        ) OR (
          entity = 'shift_session'
          AND action IN ('shift.close','shift.reopen','shift.amend','shift.cancel')
          AND json_type(details, '$.request.id') = 'text'
          AND length(json_extract(details, '$.request.id')) BETWEEN 16 AND 128
          AND json_extract(details, '$.request.id') NOT GLOB '*[^a-zA-Z0-9_-]*'
          AND json_type(details, '$.request.target') = 'integer'
          AND json_extract(details, '$.request.target') > 0
          AND json_type(details, '$.request.canonical') = 'text'
          AND CASE WHEN json_valid(json_extract(details, '$.request.canonical')) THEN
            json_extract(json_extract(details, '$.request.canonical'), '$.client_request_id') = json_extract(details, '$.request.id')
          ELSE 0 END
        )
      ) ELSE 0 END, 0)
    LIMIT 5000
  )`
}

// ---------------------------------------------------------------------------
// Before/after field diffs (records/history lane, phase 1)
//
// The Audit Log page already renders a Field | Before | After table for any
// row whose old_value/new_value hold a flat JSON object of fields
// (frontend/src/utils/auditLogFieldDiff.ts -> buildAuditFieldDiff). Almost
// every update route wrote new_value only (a copy of `details`), so that
// table had nothing to show and the page fell back to a raw blob. This is the
// ONE shared "which fields changed" helper for every route that now records a
// before/after -- users, roles, products, contacts, promotions, settings, fees
// and returns all call it, so the written shape can never drift between them.
//
// Rules, chosen to match what the renderer will actually display:
//   - a key whose before and after normalize to the same text is NOT written
//     (the renderer would drop the row anyway, so writing it is noise);
//   - bookkeeping keys the renderer ignores are never written;
//   - secret-shaped keys are never written at all, and a caller can mark
//     further keys as redacted (the key is recorded as having changed, the
//     values are masked).
// Returns null when nothing changed, which is a route's signal to fall back to
// its plain audit() call (or to skip the row entirely).
// ---------------------------------------------------------------------------
export interface AuditFieldChange {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

// Mirrors IGNORED_DIFF_KEYS in frontend/src/utils/auditLogFieldDiff.ts -- the
// renderer drops these, so a writer must not spend a row on them.
const AUDIT_DIFF_IGNORED_KEYS = new Set(['id', 'created_at', 'updated_at', 'client_request_id'])

// Never recorded in an audit row under any circumstances: password hashes,
// session/API tokens, raw credentials and inline binary blobs. This is a hard
// stop, not a redaction -- the key does not appear at all.
const AUDIT_NEVER_RECORDED = /(password|passcode|secret|token|api[_-]?key|private[_-]?key|credential|salt|_hash$|^hash$|blob|base64|data_url)/i

// Exposed so a caller with its own secret-key rule (settings' own
// isSensitiveSettingKey) can widen it rather than restate it.
export function isSecretShapedAuditKey(key: string): boolean {
  return AUDIT_NEVER_RECORDED.test(key)
}

export const AUDIT_REDACTED_BEFORE = '(hidden)'
export const AUDIT_REDACTED_AFTER = '(hidden, changed)'

// Stable, order-independent text for comparison: two permission objects that
// differ only in key order are the same permissions, and a boolean true and
// the integer 1 D1 stores for it are the same flag.
function canonicalAuditText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => canonicalAuditText(entry)))
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, canonicalAuditText(entry)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return JSON.stringify(entries)
  }
  return String(value)
}

// What actually lands in old_value/new_value. Booleans become the 0/1 the
// column holds so a diff never reads "No -> 1"; everything else is stored as
// the route supplied it.
function recordedAuditValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0
  return value === undefined ? null : value
}

export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  options: { keys?: readonly string[]; redact?: (key: string) => boolean } = {},
): AuditFieldChange | null {
  const candidates = options.keys && options.keys.length
    ? options.keys
    : [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  const beforeOut: Record<string, unknown> = {}
  const afterOut: Record<string, unknown> = {}
  let changed = 0
  for (const key of candidates) {
    if (AUDIT_DIFF_IGNORED_KEYS.has(key)) continue
    // A redacted key only ever records two fixed strings, so redaction is
    // checked BEFORE the never-recorded stop: "the API key changed" is useful
    // and leaks nothing, while an unredacted secret-shaped key is dropped.
    const redacted = options.redact?.(key) === true
    if (!redacted && AUDIT_NEVER_RECORDED.test(key)) continue
    const beforeValue = before ? before[key] : undefined
    const afterValue = after ? after[key] : undefined
    const beforeText = canonicalAuditText(beforeValue)
    const afterText = after ? canonicalAuditText(afterValue) : null
    if (beforeText === afterText) continue
    changed += 1
    if (redacted) {
      beforeOut[key] = beforeText === null ? null : AUDIT_REDACTED_BEFORE
      afterOut[key] = afterText === null ? null : AUDIT_REDACTED_AFTER
      continue
    }
    beforeOut[key] = recordedAuditValue(beforeValue)
    afterOut[key] = recordedAuditValue(afterValue)
  }
  if (!changed) return null
  // A delete (after === null) records the removed record as the before image
  // and a null after, which is what makes the renderer show every field as
  // removed instead of as an unexplained blank.
  return { before: beforeOut, after: after ? afterOut : null }
}

// Serializers for routes that build their audit row inside their own D1 batch
// (roles, payment-method rename) instead of calling audit().
export function auditChangeColumns(change: AuditFieldChange | null | undefined): { old_value: string | null; new_value: string | null } {
  if (!change) return { old_value: null, new_value: null }
  return {
    old_value: change.before ? JSON.stringify(change.before) : null,
    new_value: change.after ? JSON.stringify(change.after) : null,
  }
}

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
//
// P4-4a: this used to be two SELECTs (lookupAuditDeviceInfo, resolveAuditActorName)
// plus the INSERT -- three sequential D1 round trips, awaited at 135 call sites.
// Both lookups are expressed here as LEFT JOINs against the same @user_id bind,
// folded into ONE `INSERT ... SELECT`, so audit() costs exactly one round trip
// regardless of whether userId is set. The fallback semantics are unchanged:
//   - user_name: the account's own username when the users row exists and is
//     non-blank, else the caller-provided name (mirrors resolveActorUsername's
//     `trimmed(row?.username) || trimmed(fallback) || null`); when userId is
//     null the LEFT JOIN matches no row, which is the same "no account" case
//     resolveAuditActorName short-circuited on before.
//   - device_name/device_tz: the most-recently-active live session's device
//     info (mirrors lookupAuditDeviceInfo's ORDER BY last_seen_at DESC, id DESC
//     LIMIT 1), NULL when there is no such session or no userId.
export async function audit(
  env: Env,
  userId: number | null,
  userName: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = null,
  // Optional field-level before/after (build it with changedFields above).
  // Three distinct cases, and the difference matters:
  //   - argument ABSENT: old_value stays NULL and new_value stays the details
  //     blob -- byte-for-byte what every pre-existing call site already wrote;
  //   - argument null (a route that opted in, on a save that changed nothing):
  //     BOTH columns are NULL, so the Audit Log shows an empty diff instead of
  //     a details blob it would otherwise render as "every field was added";
  //   - a real change: the two columns hold the changed fields.
  change?: AuditFieldChange | null,
): Promise<void> {
  try {
    const detailsStr = details != null
      ? (typeof details === 'object' ? JSON.stringify(details) : String(details))
      : null
    const changeColumns = auditChangeColumns(change)
    const db = getDb(env)
    await db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, device_tz)
      SELECT
        @user_id,
        COALESCE(NULLIF(TRIM(u.username), ''), NULLIF(TRIM(@user_name), '')),
        @action, @entity, @entity_id, @details, @table_name, @record_id, @old_value, @new_value,
        s.device_name,
        s.device_tz
      FROM (SELECT 1 AS one) AS _dummy
      LEFT JOIN users u ON u.id = @user_id
      LEFT JOIN (
        SELECT device_name, device_tz
        FROM user_sessions
        WHERE user_id = @user_id AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, id DESC
        LIMIT 1
      ) AS s ON 1 = 1
    `).run({
      user_id: userId,
      user_name: userName,
      action,
      entity,
      entity_id: entityId,
      details: detailsStr,
      table_name: entity,
      record_id: entityId,
      old_value: changeColumns.old_value,
      new_value: change === undefined ? detailsStr : changeColumns.new_value,
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
    const result = await db.prepare(buildAuditLogRetentionDeleteSql()).run({ cutoff })
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
