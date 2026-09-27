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
import { getPlanLimits } from './planTier'
import { sqliteUtcTimestamp } from './rateLimit'
import { deleteObjectsBulk } from './r2'
import { recordAnalytics } from './analytics'
import type { Env } from '../index'

const LAST_RUN_KEY = 'ephemeral_retention_last_run'
// Durable outcome of the last completed sweep: { at, failed, deleted,
// retained }. There is no job_runs table in this schema; the settings row
// sits beside LAST_RUN_KEY so a failing step leaves evidence in D1, not only
// in a console line nobody tails.
export const LAST_RESULT_KEY = 'ephemeral_retention_last_result'
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

// Customer share submissions (N45). These are the one place in the schema
// where the business stores photographs a CUSTOMER took -- of their own
// social feed, routinely showing other people. Nothing in the codebase ever
// deleted them: rows and R2 objects both accumulated forever.
//
// Two different things are being retained here, and they must not be
// confused. The IMAGE is the personal data and has a purpose that ends at
// review. The ROW is a points ledger entry -- summarizePoints() in
// routes/portal.ts adds reward_points for every submission with
// status='approved', so deleting a reviewed row would silently move a real
// customer's points balance. So:
//   - a REVIEWED submission keeps its row and loses its images;
//   - a submission nobody ever reviewed earns nothing, so it goes entirely.
// Both windows are exported so the storefront copy that promises them and
// the code that enforces them cannot drift.
export const SUBMISSION_IMAGE_TTL_DAYS = 90    // after review
export const SUBMISSION_UNREVIEWED_TTL_DAYS = 180 // never reviewed: row and all
// Must match PORTAL_SUBMISSION_PREFIX in routes/portal.ts -- only objects
// this app wrote under its own private prefix are ever deleted from R2.
const SUBMISSION_OBJECT_PREFIX = 'private/portal-submissions/'
// Bounded per sweep: an R2 delete is a subrequest, and the sweep shares an
// invocation budget with every other step here.
const SUBMISSION_ROW_BATCH = 200

// Per-statement row cap so one sweep never builds an unbounded D1 transaction
// (D1 has its own per-statement CPU/row budget). D1 does not support
// `DELETE ... LIMIT`, so we delete by a bounded sub-select of ids and loop.
// The number is plan-sensitive and therefore lives in lib/planTier.ts
// (ephemeralDeleteBatch: paid 5000, free 1000), read per run in
// batchDeleteById below rather than kept as a second copy here.

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
async function batchDeleteById(env: Env, db: Db, table: string, where: string, params: Record<string, unknown>): Promise<number> {
  // Rows per bounded DELETE, tier-aware -- see lib/planTier.ts. Free gets
  // 1000 instead of 5000: it keeps one statement inside the 10 ms cron
  // budget, and stops a log sweep spending a noticeable slice of the
  // 100,000-rows-written-per-day D1 ceiling on pruning alone.
  const deleteBatch = getPlanLimits(env).ephemeralDeleteBatch
  let total = 0
  for (;;) {
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${where} LIMIT ${deleteBatch})`)
      .run(params)
    const n = result.changes || 0
    total += n
    if (n < deleteBatch) break
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
  // Steps that threw, with the error message. A failing step no longer
  // disappears into one console line: it is returned, logged with a count,
  // and recorded to Analytics Engine, while every other step still runs.
  failed?: Record<string, string>
  // action_history rows past the window that were deliberately KEPT because
  // another table still references them (see pruneActionHistory).
  retained?: Record<string, number>
}

// ---------------------------------------------------------------------------
// action_history is a PARENT table. Operation receipts point at it through
// plain `REFERENCES action_history(id)` columns (sale_bulk_operations,
// stock_session_operations, return_bulk_operations, sale_mutation_receipts,
// sale_incident_recovery_members, sale_not_paid_stock_recovery_members,
// stock_lot_adjustment_operations -- NO ACTION) and the product-conflict /
// product-remove tables (ON DELETE SET NULL). D1 enforces foreign keys, and
// a NO ACTION violation aborts the WHOLE bounded DELETE statement: a single
// referenced id inside a slice meant the slice deleted nothing, the error was
// swallowed, and the next sweep picked the same slice again -- so one old
// receipt stalled action_history retention forever.
//
// Every referenced id is excluded, not only the NO ACTION ones: receipts are
// idempotency/concurrency evidence that is never pruned, and a SET NULL
// cascade would silently cut a merge-run / conflict-group / remove
// operation's undo link to its history row. Rows named by a top-level
// `history_id` inside an undo_snapshots payload (customer gender
// restoration joins through it) are excluded too.
//
// The referencing columns are DISCOVERED from the live schema each run (one
// sqlite_master x pragma_foreign_key_list read), so a future migration that
// adds another reference cannot reintroduce the stall. Internal D1
// (_cf_*) and sqlite_* tables are filtered before the pragma is evaluated
// (MATERIALIZED), since D1 does not authorize reading them.
// ---------------------------------------------------------------------------
export type ForeignReference = { table_name: string; column_name: string }

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}

export async function discoverActionHistoryReferences(db: Db): Promise<ForeignReference[]> {
  const rows = await db.prepare(`
    WITH candidate AS MATERIALIZED (
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE '!_cf!_%' ESCAPE '!'
        AND name NOT LIKE 'sqlite!_%' ESCAPE '!'
    )
    SELECT candidate.name AS table_name, f."from" AS column_name
    FROM candidate JOIN pragma_foreign_key_list(candidate.name) AS f
    WHERE lower(f."table") = 'action_history'
    ORDER BY candidate.name, f."from"
  `).all<ForeignReference>({})
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.table_name && row?.column_name)
}

// The exclusion is a non-correlated NOT IN per referencing column: SQLite
// builds each set once per statement, so an unindexed history_id column costs
// one scan of that (small) table rather than one per candidate row.
// `IS NOT NULL` is load-bearing -- a single NULL in the set would make
// NOT IN unknown for every row and silently stop all pruning.
export function actionHistoryReferenceExclusion(references: ForeignReference[]): string {
  return references.map(({ table_name, column_name }) => {
    const column = quoteIdent(column_name)
    return ` AND id NOT IN (SELECT ${column} FROM ${quoteIdent(table_name)} WHERE ${column} IS NOT NULL)`
  }).join('') + SNAPSHOT_HISTORY_EXCLUSION
}

// Snapshot payloads are large; instr() skips the JSON parse for every payload
// that cannot name a history row, and json_valid() keeps one malformed legacy
// payload (0135 indexes exist for exactly those) from erroring the statement
// -- which would recreate the very stall this sweep is fixing.
// CASE (not AND) because SQLite does not promise to evaluate AND left-to-right.
const SNAPSHOT_HISTORY_ID = `CASE WHEN instr(payload_json, '"history_id"') > 0 AND json_valid(payload_json)
      THEN CAST(json_extract(payload_json, '$.history_id') AS INTEGER) END`
const SNAPSHOT_HISTORY_EXCLUSION = ` AND id NOT IN (SELECT ${SNAPSHOT_HISTORY_ID} FROM undo_snapshots
    WHERE (${SNAPSHOT_HISTORY_ID}) IS NOT NULL)`

async function pruneActionHistory(env: Env, db: Db, retained: Record<string, number>): Promise<number> {
  const cutoff = daysAgo(ACTION_HISTORY_TTL_DAYS)
  const references = await discoverActionHistoryReferences(db)
  const removed = await batchDeleteById(env, db, 'action_history', `created_at < @cutoff${actionHistoryReferenceExclusion(references)}`, { cutoff })
  // Everything still older than the window is, by construction, referenced.
  // Reported so a growing pinned set is visible rather than inferred.
  const left = await db.prepare('SELECT COUNT(*) AS n FROM action_history WHERE created_at < @cutoff').get<{ n: number }>({ cutoff })
  retained.action_history = Number(left?.n || 0)
  return removed
}

// Collect the R2 keys a set of submission rows points at. Only keys under
// this app's own private prefix are returned: a legacy `/uploads/...` value
// is a public catalogue-bucket path that other rows may share, and this
// sweep must never reach outside what it wrote.
function submissionObjectKeys(rows: Array<{ screenshots_json?: string | null }>): string[] {
  const keys: string[] = []
  for (const row of rows) {
    let parsed: unknown = []
    try { parsed = JSON.parse(String(row?.screenshots_json || '[]')) } catch { parsed = [] }
    if (!Array.isArray(parsed)) continue
    for (const entry of parsed) {
      const key = String(entry || '')
      if (key.startsWith(SUBMISSION_OBJECT_PREFIX)) keys.push(key)
    }
  }
  return keys
}

async function deleteSubmissionObjects(env: Env, keys: string[]): Promise<void> {
  if (!keys.length) return
  // Best effort, and deliberately BEFORE the row update/delete: an object
  // whose row is gone can never be found again, whereas a row whose delete
  // failed is simply retried on the next sweep.
  await deleteObjectsBulk(env.ASSETS, keys)
}

// Reviewed long enough ago: drop the images, keep the row (and its points).
// `screenshots_json` is emptied in the same pass, which is also what makes
// this idempotent -- an emptied row no longer matches.
async function pruneSubmissionImages(env: Env, db: Db): Promise<number> {
  let total = 0
  for (;;) {
    const rows = await db.prepare(`
      SELECT id, screenshots_json FROM customer_share_submissions
      WHERE reviewed_at IS NOT NULL AND reviewed_at < @cutoff
        AND screenshots_json IS NOT NULL AND screenshots_json NOT IN ('[]', '')
      LIMIT ${SUBMISSION_ROW_BATCH}
    `).all<{ id: number; screenshots_json: string | null }>({ cutoff: daysAgo(SUBMISSION_IMAGE_TTL_DAYS) })
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) break
    await deleteSubmissionObjects(env, submissionObjectKeys(list))
    const ids = list.map((row) => Number(row.id)).filter((id) => Number.isInteger(id))
    if (!ids.length) break
    await db.prepare(
      `UPDATE customer_share_submissions SET screenshots_json = '[]' WHERE id IN (${ids.join(', ')})`,
    ).run({})
    total += ids.length
    if (list.length < SUBMISSION_ROW_BATCH) break
  }
  return total
}

// Never reviewed and older than the outer window: no points were ever
// awarded, so nothing is lost by removing the row with its images.
async function pruneUnreviewedSubmissions(env: Env, db: Db): Promise<number> {
  let total = 0
  for (;;) {
    const rows = await db.prepare(`
      SELECT id, screenshots_json FROM customer_share_submissions
      WHERE reviewed_at IS NULL AND created_at < @cutoff
      LIMIT ${SUBMISSION_ROW_BATCH}
    `).all<{ id: number; screenshots_json: string | null }>({ cutoff: daysAgo(SUBMISSION_UNREVIEWED_TTL_DAYS) })
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) break
    await deleteSubmissionObjects(env, submissionObjectKeys(list))
    const ids = list.map((row) => Number(row.id)).filter((id) => Number.isInteger(id))
    if (!ids.length) break
    await db.prepare(`DELETE FROM customer_share_submissions WHERE id IN (${ids.join(', ')})`).run({})
    total += ids.length
    if (list.length < SUBMISSION_ROW_BATCH) break
  }
  return total
}

export async function maybeRunScheduledEphemeralRetention(env: Env): Promise<EphemeralRetentionResult> {
  const lastRunRaw = await getSettingValue(env, LAST_RUN_KEY)
  const lastRun = lastRunRaw ? Date.parse(lastRunRaw) : 0
  if (lastRun && Date.now() - lastRun < MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'ran-recently' }
  }

  const db = getDb(env)
  const deleted: Record<string, number> = {}
  const failed: Record<string, string> = {}
  const retained: Record<string, number> = {}
  // Each table guarded independently: a table missing on a not-yet-migrated
  // local DB, or a transient error on one, must not stop the others.
  const step = async (label: string, fn: () => Promise<number>) => {
    try { deleted[label] = await fn() } catch (error) {
      const message = String((error as Error)?.message || error).slice(0, 300)
      failed[label] = message
      console.error(`[ephemeral-retention] ${label} failed`, message)
    }
  }

  await step('rate_limit_events', () => batchDeleteById(env, db, 'rate_limit_events', 'created_at < @cutoff', { cutoff: daysAgo(RATE_LIMIT_TTL_DAYS) }))
  await step('user_sessions', () => batchDeleteById(env, db, 'user_sessions', "revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)", {}))
  await step('portal_sessions', () => batchDeleteById(env, db, 'portal_sessions', "revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)", {}))
  const verificationNow = Date.now()
  await step('verification_codes', () => batchDeleteById(env, db, 'verification_codes', `
    created_at <= @historyCutoff
    AND (consumed_at IS NOT NULL OR julianday(expires_at) <= julianday(@now))
  `, {
    historyCutoff: sqliteUtcTimestamp(verificationNow - VERIFICATION_HISTORY_MS),
    now: sqliteUtcTimestamp(verificationNow),
  }))
  await step('trusted_devices', () => batchDeleteById(env, db, 'trusted_devices', 'revoked_at IS NOT NULL AND revoked_at < @cutoff', { cutoff: daysAgo(TRUSTED_DEVICE_TTL_DAYS) }))
  await step('ai_response_logs', () => batchDeleteById(env, db, 'ai_response_logs', 'created_at < @cutoff', { cutoff: daysAgo(AI_LOG_TTL_DAYS) }))
  await step('action_history', () => pruneActionHistory(env, db, retained))
  await step('share_submission_images', () => pruneSubmissionImages(env, db))
  await step('share_submissions_unreviewed', () => pruneUnreviewedSubmissions(env, db))
  await step('login_lockouts', () => directDelete(db, 'login_lockouts', '(locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) AND updated_at < @cutoff', { cutoff: daysAgo(LOCKOUT_TTL_DAYS) }))
  await step('portal_auth_lockouts', () => directDelete(db, 'portal_auth_lockouts', '(locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) AND updated_at < @cutoff', { cutoff: daysAgo(LOCKOUT_TTL_DAYS) }))

  const failedLabels = Object.keys(failed)
  if (failedLabels.length) {
    console.error(`[ephemeral-retention] ${failedLabels.length} step(s) failed: ${failedLabels.join(', ')}`)
  }
  try {
    await setSettingValue(env, LAST_RESULT_KEY, JSON.stringify({ at: new Date().toISOString(), failed, deleted, retained }))
  } catch (error) {
    console.error('[ephemeral-retention] could not record the sweep result', (error as Error)?.message || error)
  }
  // Table labels and counts only -- nothing identifying (see analytics.ts).
  // -1 means the action_history step did not complete.
  recordAnalytics(env, {
    kind: 'ephemeral_retention',
    labels: [failedLabels.join(',') || 'ok'],
    values: [failedLabels.length, deleted.action_history ?? -1, retained.action_history ?? -1],
  })

  await setSettingValue(env, LAST_RUN_KEY, new Date().toISOString())
  return { skipped: false, deleted, failed, retained }
}
