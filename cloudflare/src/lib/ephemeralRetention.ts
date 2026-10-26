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
import type { Env } from '../index'

const LAST_RUN_KEY = 'ephemeral_retention_last_run'
// 5h so ordinary jitter between rotation visits (2.75 h apart) can never make
// every second visit skip -- same reasoning as importRetention's interval.
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
// must be formatted the SAME way to compare correctly. Only for columns whose
// every writer uses CURRENT_TIMESTAMP / sqliteUtcTimestamp.
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

// For a column written as BOTH 'YYYY-MM-DD HH:MM:SS' (column DEFAULT) and
// toISOString() 'YYYY-MM-DDTHH:MM:SS.sssZ'. A single string cutoff is wrong for
// one of the two shapes on the cutoff's own day (' ' < 'T'), so each shape gets
// its own bounded range: space rows are exact below the space cutoff; ISO rows
// are exact inside [cutoff-day 'T', ISO cutoff). A space row never reaches the
// ISO range and an ISO row on the cutoff day never matches the space range, so
// nothing is deleted early or kept past the TTL. Bare column: index-seekable.
function mixedFormatOlderThan(column: string, days: number): { where: string; params: Record<string, string> } {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const iso = cutoff.toISOString()
  return {
    where: `(${column} < @spaceCutoff OR (${column} >= @isoDayStart AND ${column} < @isoCutoff))`,
    params: { spaceCutoff: sqliteUtcTimestamp(cutoff.getTime()), isoDayStart: `${iso.slice(0, 10)}T`, isoCutoff: iso },
  }
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

// Bounded work per scheduled visit. A cron invocation has the same 10 ms CPU
// budget as a request on Free, so a sweep takes at most this many bounded
// statements per visit and reports `more` when it stopped with work left;
// the rotating cron (lib/cronRotation.ts) resumes it on the next tick and the
// last-run stamp is NOT written, so nothing is skipped.
export const MAX_BATCHES_PER_VISIT = 3

class Budget {
  more = false
  private left: number
  constructor(batches: number) { this.left = batches }
  /** Take one bounded statement; false (and `more`) once none are left. */
  take(): boolean {
    if (this.left > 0) { this.left -= 1; return true }
    this.more = true
    return false
  }
}

// Bounded delete for tables that have an integer `id` PK: repeatedly delete a
// capped slice matching `where` until fewer than a full batch remain.
async function batchDeleteById(env: Env, db: Db, table: string, where: string, params: Record<string, unknown>, budget: Budget): Promise<number> {
  // Rows per bounded DELETE, tier-aware -- see lib/planTier.ts. Free gets
  // 1000 instead of 5000: it keeps one statement inside the 10 ms cron
  // budget, and stops a log sweep spending a noticeable slice of the
  // 100,000-rows-written-per-day D1 ceiling on pruning alone.
  const deleteBatch = getPlanLimits(env).ephemeralDeleteBatch
  let total = 0
  while (budget.take()) {
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
  /** Stopped at the per-visit bound with work left; run again soon. */
  more?: boolean
}

// Scheduled slices. Each is one cron visit; the legacy no-argument call still
// runs everything (kept for tests and manual use).
export const EPHEMERAL_RETENTION_GROUPS = ['rate_limit', 'auth', 'logs', 'history', 'submissions'] as const
export type EphemeralRetentionGroup = typeof EPHEMERAL_RETENTION_GROUPS[number]

// ---------------------------------------------------------------------------
// action_history is a PARENT table. Operation receipts point at it through
// `REFERENCES action_history(id)` columns (NO ACTION for the bulk / session /
// receipt / recovery tables, ON DELETE SET NULL for the product-conflict and
// product-remove tables). D1 enforces foreign keys and a NO ACTION violation
// aborts the WHOLE bounded DELETE: one referenced id inside a slice meant the
// slice deleted nothing, the step's error was swallowed, and the next sweep
// picked the same slice again -- so one old receipt stalled retention forever.
//
// Every referenced id is kept, not only the NO ACTION ones: receipts are
// idempotency evidence, and a SET NULL cascade would silently cut an
// operation's undo link to its history row. Ids named by a top-level
// `history_id` inside an undo_snapshots payload are kept too (customer
// gender restoration joins through it).
//
// The referencing columns are DISCOVERED from the live schema each run (one
// sqlite_master x pragma_foreign_key_list read), so a future migration that
// adds another reference cannot reintroduce the stall. Internal D1 (_cf_*) and
// sqlite_* tables are filtered first (MATERIALIZED): D1 does not authorize
// reading their foreign keys.
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

// Snapshot payloads are large: instr() skips the JSON parse for any payload
// that cannot name a history row, and json_valid() keeps one malformed legacy
// payload from erroring the statement (which would recreate the stall).
// CASE, not AND: SQLite does not promise left-to-right AND evaluation.
const SNAPSHOT_HISTORY_ID = `CASE WHEN instr(payload_json, '"history_id"') > 0 AND json_valid(payload_json)
      THEN CAST(json_extract(payload_json, '$.history_id') AS INTEGER) END`
const SNAPSHOT_HISTORY_EXCLUSION = ` AND id NOT IN (SELECT ${SNAPSHOT_HISTORY_ID} FROM undo_snapshots
    WHERE (${SNAPSHOT_HISTORY_ID}) IS NOT NULL)`

// One non-correlated NOT IN per referencing column, built once per statement.
// `IS NOT NULL` is load-bearing: a single NULL in the set makes NOT IN unknown
// for every row and silently stops all pruning.
export function actionHistoryReferenceExclusion(references: ForeignReference[]): string {
  return references.map(({ table_name, column_name }) => {
    const column = quoteIdent(column_name)
    return ` AND id NOT IN (SELECT ${column} FROM ${quoteIdent(table_name)} WHERE ${column} IS NOT NULL)`
  }).join('') + SNAPSHOT_HISTORY_EXCLUSION
}

async function pruneActionHistory(env: Env, db: Db, budget: Budget): Promise<number> {
  const references = await discoverActionHistoryReferences(db)
  return batchDeleteById(env, db, 'action_history', `created_at < @cutoff${actionHistoryReferenceExclusion(references)}`, { cutoff: daysAgo(ACTION_HISTORY_TTL_DAYS) }, budget)
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
async function pruneSubmissionImages(env: Env, db: Db, budget: Budget): Promise<number> {
  let total = 0
  while (budget.take()) {
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
async function pruneUnreviewedSubmissions(env: Env, db: Db, budget: Budget): Promise<number> {
  let total = 0
  while (budget.take()) {
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

export async function maybeRunScheduledEphemeralRetention(env: Env, group?: EphemeralRetentionGroup): Promise<EphemeralRetentionResult> {
  // One stamp per slice, so a slice that stopped early is retried on its own
  // while finished slices stay quiet. No group = the whole sweep, legacy key.
  const lastRunKey = group ? `${LAST_RUN_KEY}:${group}` : LAST_RUN_KEY
  const lastRunRaw = await getSettingValue(env, lastRunKey)
  const lastRun = lastRunRaw ? Date.parse(lastRunRaw) : 0
  if (lastRun && Date.now() - lastRun < MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'ran-recently' }
  }

  const db = getDb(env)
  const deleted: Record<string, number> = {}
  let more = false
  const want = (name: EphemeralRetentionGroup) => !group || group === name
  // Each table guarded independently: a table missing on a not-yet-migrated
  // local DB, or a transient error on one, must not stop the others. The
  // table's own bounded budget is collected into `more`.
  const step = async (label: string, fn: (budget: Budget) => Promise<number>, batches: number = MAX_BATCHES_PER_VISIT) => {
    const budget = new Budget(batches)
    try { deleted[label] = await fn(budget) } catch (error) { console.error(`[ephemeral-retention] ${label} failed`, (error as Error)?.message || error) }
    if (budget.more) more = true
  }
  // Tables that share one visit get one statement each; a slice with a single
  // heavy table gets the full per-visit bound.
  const shared = group ? 1 : MAX_BATCHES_PER_VISIT

  if (want('rate_limit')) {
    await step('rate_limit_events', (b) => batchDeleteById(env, db, 'rate_limit_events', 'created_at < @cutoff', { cutoff: daysAgo(RATE_LIMIT_TTL_DAYS) }, b))
  }
  if (want('auth')) {
    await step('user_sessions', (b) => batchDeleteById(env, db, 'user_sessions', "revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)", {}, b), shared)
    await step('portal_sessions', (b) => batchDeleteById(env, db, 'portal_sessions', "revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)", {}, b), shared)
    const verificationNow = Date.now()
    await step('verification_codes', (b) => batchDeleteById(env, db, 'verification_codes', `
      created_at <= @historyCutoff
      AND (consumed_at IS NOT NULL OR julianday(expires_at) <= julianday(@now))
    `, {
      historyCutoff: sqliteUtcTimestamp(verificationNow - VERIFICATION_HISTORY_MS),
      now: sqliteUtcTimestamp(verificationNow),
    }, b), shared)
    await step('trusted_devices', (b) => batchDeleteById(env, db, 'trusted_devices', 'revoked_at IS NOT NULL AND revoked_at < @cutoff', { cutoff: daysAgo(TRUSTED_DEVICE_TTL_DAYS) }, b), shared)
    await step('login_lockouts', () => directDelete(db, 'login_lockouts', '(locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) AND updated_at < @cutoff', { cutoff: daysAgo(LOCKOUT_TTL_DAYS) }))
    await step('portal_auth_lockouts', () => directDelete(db, 'portal_auth_lockouts', '(locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) AND updated_at < @cutoff', { cutoff: daysAgo(LOCKOUT_TTL_DAYS) }))
  }
  if (want('logs')) {
    const aiLogCutoff = mixedFormatOlderThan('created_at', AI_LOG_TTL_DAYS) // portal.ts writes toISOString()
    await step('ai_response_logs', (b) => batchDeleteById(env, db, 'ai_response_logs', aiLogCutoff.where, aiLogCutoff.params, b))
  }
  if (want('history')) {
    await step('action_history', (b) => pruneActionHistory(env, db, b))
  }
  if (want('submissions')) {
    await step('share_submission_images', (b) => pruneSubmissionImages(env, db, b), shared + 1)
    await step('share_submissions_unreviewed', (b) => pruneUnreviewedSubmissions(env, db, b), shared + 1)
  }

  // Not stamped while work remains: the next visit resumes instead of waiting
  // out the interval.
  if (!more) await setSettingValue(env, lastRunKey, new Date().toISOString())
  return { skipped: false, deleted, ...(more ? { more: true } : {}) }
}
