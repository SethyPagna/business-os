import { getDb } from './db'
import type { Env } from '../index'
import { audit } from './audit'
import { deleteObjectsBulk } from './r2'

// K4 phase 1 (storage/jobs hardening): scheduled retention for import
// artifacts, per the locked execution plan's policy:
//
//   - DETAILED artifacts live for 24 hours after a job reaches a terminal
//     status. "Detailed" is the bulk payload: materialized CSV rows
//     (import_job_source_rows), per-row analyze/apply results
//     (import_job_rows), row errors, chunk bookkeeping, row signatures,
//     image match/rename plans, grouping state, and the raw uploaded
//     CSV/ZIP in R2 when it was never linked into the Library. On
//     production this class measured ~193MB of a ~243MB database.
//   - A COMPACT SUMMARY lives for 7 days: the import_jobs row itself
//     (status, counts, summary_json, policy_json) plus the per-action
//     idempotency ledgers (import_sales_commits, import_stock_action_
//     commits/guards) and the file-name rows. At 7 days the whole job is
//     deleted the same way the user-facing per-job Delete does.
//
// Both windows are settings-overridable (see the setting keys below) so
// the operator can lengthen them without a deploy. The sweep only ever
// touches TERMINAL jobs -- completed/failed/cancelled. A job sitting in
// awaiting_review is a person's pending decision, not stale async work,
// and keeps its staged rows until they confirm or cancel it. Jobs stuck
// in queued/analyzing/applying belong to the lease/retry machinery
// (importEngine.ts), not to retention.
//
// import_auto_merges is deliberately NOT in either tier: it is merge
// EVIDENCE keyed by product, read by the product merge-log endpoint, and
// outlives the job that produced it.
//
// Once a job's details are pruned, /:id/retry is refused with a clear 409
// (see routes/importJobs.ts) -- a retry needs the staged source rows and
// the raw file, and both are gone by design.

export const IMPORT_DETAIL_RETENTION_HOURS_DEFAULT = 24
export const IMPORT_SUMMARY_RETENTION_DAYS_DEFAULT = 7
const DETAIL_RETENTION_SETTING_KEY = 'import_detail_retention_hours'
const SUMMARY_RETENTION_SETTING_KEY = 'import_summary_retention_days'
const IMPORT_RETENTION_LAST_RUN_KEY = 'import_retention_last_run'

// The scheduled worker ticks every 6h. 5h (not 6h exactly) so ordinary
// timing jitter between ticks can never make every second tick skip.
const IMPORT_RETENTION_MIN_INTERVAL_MS = 5 * 60 * 60 * 1000

// Per-run work bound: each tier processes at most this many jobs per tick,
// so one invocation's D1/R2 work stays finite no matter how large the
// backlog is (the first production run faces the whole 193MB). The sweep
// simply continues on later ticks until it reaches steady state.
const IMPORT_RETENTION_MAX_JOBS_PER_TIER = 20

// Terminal = the statuses every writer settles on and nothing resumes
// from without an explicit /retry (queue.ts, importEngine.ts,
// routes/importJobs.ts write exactly these three).
const TERMINAL_STATUS_SQL = `('completed', 'failed', 'cancelled')`

// finished_at is CURRENT_TIMESTAMP at every site that sets it, but the
// tracker's /cancel path flips status without stamping it -- COALESCE to
// updated_at, exactly as routes/notifications.ts already does.
const FINISHED_AT_SQL = `COALESCE(finished_at, updated_at)`

// SQLite CURRENT_TIMESTAMP renders 'YYYY-MM-DD HH:MM:SS' (UTC). Cutoffs
// must be rendered the SAME way -- a bare toISOString() compares wrong
// against that format at the 'T'/' ' position on same-date values.
function sqliteTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

type JobScopedStatement = { sql: string; params: { id: string } }

// The 24h tier: bulk per-row payload. One definition, shared by the
// scheduled sweep and the full-delete list below so the two can not drift.
export function importJobDetailDeleteStatements(jobId: string): JobScopedStatement[] {
  const params = { id: jobId }
  return [
    { sql: `DELETE FROM import_job_errors WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_job_batches WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_job_rows WHERE job_id = @id`, params }, // chunked analyze/apply's persisted per-row results -- see migration 0011
    { sql: `DELETE FROM import_job_source_rows WHERE job_id = @id`, params }, // materialized parsed CSV rows -- see migration 0012
    { sql: `DELETE FROM import_job_row_signatures WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_job_image_matches WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_job_image_renames WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_stock_action_groups WHERE job_id = @id`, params },
  ]
}

// The whole job: detail tier + idempotency ledgers + file rows + the job
// row itself. routes/importJobs.ts's deleteJobData (the user-facing
// Delete) runs THIS list -- before K4 it deleted only six of these
// tables, leaving signature/commit/guard/group/image rows orphaned
// forever, which is exactly the "orphan staging rows" the Phase-0 audit
// measured.
export function importJobFullDeleteStatements(jobId: string): JobScopedStatement[] {
  const params = { id: jobId }
  return [
    ...importJobDetailDeleteStatements(jobId),
    { sql: `DELETE FROM import_sales_commits WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_stock_action_commits WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_stock_action_guards WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_job_files WHERE job_id = @id`, params },
    { sql: `DELETE FROM import_jobs WHERE id = @id`, params },
  ]
}

// Every job-scoped table, for the orphan report/cleanup below. Kept next
// to the two lists above so a new job-scoped table gets added to all
// three in one edit.
const JOB_SCOPED_TABLES = [
  'import_job_errors',
  'import_job_batches',
  'import_job_rows',
  'import_job_source_rows',
  'import_job_row_signatures',
  'import_job_image_matches',
  'import_job_image_renames',
  'import_stock_action_groups',
  'import_sales_commits',
  'import_stock_action_commits',
  'import_stock_action_guards',
  'import_job_files',
] as const

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

async function getPositiveIntSetting(env: Env, key: string, fallback: number): Promise<number> {
  const raw = await getSettingValue(env, key)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Deletes the raw uploaded objects for one job, honoring the same rule as
// the user-facing delete: a file with a file_asset_id is the person's
// Library copy and must never be taken out from under them.
async function deleteUnlinkedJobFiles(env: Env, jobId: string): Promise<{ deleted: number; errors: string[] }> {
  const db = getDb(env)
  const files = await db.prepare(`SELECT stored_path, file_asset_id FROM import_job_files WHERE job_id = @id`)
    .all<{ stored_path: string; file_asset_id: number | null }>({ id: jobId })
  const keys = files
    .filter((f) => !f.file_asset_id)
    .map((f) => String(f.stored_path || ''))
    .filter(Boolean)
  if (!keys.length) return { deleted: 0, errors: [] }
  return deleteObjectsBulk(env.ASSETS, keys)
}

export interface ImportRetentionRunResult {
  skipped: boolean
  reason?: string
  detailPruned?: number
  summaryDeleted?: number
  r2Deleted?: number
  r2Errors?: number
  detailHours?: number
  summaryDays?: number
}

// Runs on the scheduled worker tick, throttled like the audit-log
// retention sweep. Swallows its own errors: retention must never be the
// reason the backup/image-audit chain around it breaks -- a failed pass
// just runs again on a later tick.
export async function maybeRunScheduledImportRetention(env: Env): Promise<ImportRetentionRunResult> {
  try {
    const lastRunRaw = await getSettingValue(env, IMPORT_RETENTION_LAST_RUN_KEY)
    const lastRun = lastRunRaw ? Date.parse(lastRunRaw) : 0
    if (lastRun && Date.now() - lastRun < IMPORT_RETENTION_MIN_INTERVAL_MS) {
      return { skipped: true, reason: 'ran-recently' }
    }

    const detailHours = await getPositiveIntSetting(env, DETAIL_RETENTION_SETTING_KEY, IMPORT_DETAIL_RETENTION_HOURS_DEFAULT)
    const summaryDays = await getPositiveIntSetting(env, SUMMARY_RETENTION_SETTING_KEY, IMPORT_SUMMARY_RETENTION_DAYS_DEFAULT)
    // The summary window can never be shorter than the detail window --
    // a misconfigured pair would otherwise delete whole jobs while their
    // details were still inside their own retention.
    const summaryHours = Math.max(summaryDays * 24, detailHours)

    const db = getDb(env)
    let detailPruned = 0
    let summaryDeleted = 0
    let r2Deleted = 0
    const r2Errors: string[] = []

    // ---- 24h tier: strip bulk detail, keep the summary row -------------
    const detailCutoff = sqliteTimestamp(Date.now() - detailHours * 60 * 60 * 1000)
    const detailJobs = await db.prepare(`
      SELECT id FROM import_jobs
      WHERE status IN ${TERMINAL_STATUS_SQL}
        AND details_pruned_at IS NULL
        AND ${FINISHED_AT_SQL} < @cutoff
      ORDER BY ${FINISHED_AT_SQL} ASC
      LIMIT ${IMPORT_RETENTION_MAX_JOBS_PER_TIER}
    `).all<{ id: string }>({ cutoff: detailCutoff })

    for (const job of detailJobs) {
      // R2 first, best-effort: a failed object delete is reported in the
      // audit event but does not stop the D1 purge or the marker below --
      // the D1 payload is the 193MB that must not stay hostage to an R2
      // hiccup, and the raw files measured only ~14MB total. The 7d full
      // delete tries the same keys again (deleting a gone key is a no-op).
      const r2 = await deleteUnlinkedJobFiles(env, job.id)
      r2Deleted += r2.deleted
      r2Errors.push(...r2.errors)
      await db.batch([
        ...importJobDetailDeleteStatements(job.id),
        // chunk_state_json/materialize_state_json are continuation state a
        // terminal job can never use again, and they can be large.
        // updated_at is deliberately NOT bumped: the 7d summary clock runs
        // from the job's own finish time, not from this sweep's visit.
        { sql: `UPDATE import_jobs SET details_pruned_at = CURRENT_TIMESTAMP, chunk_state_json = NULL, materialize_state_json = NULL WHERE id = @id`, params: { id: job.id } },
      ])
      detailPruned += 1
    }

    // ---- 7d tier: delete the whole job ---------------------------------
    // No details_pruned_at filter: a job that somehow crossed 7 days
    // without a detail pass (sweep down for a week) is fully deleted here
    // in one go -- the full list contains every detail statement.
    const summaryCutoff = sqliteTimestamp(Date.now() - summaryHours * 60 * 60 * 1000)
    const summaryJobs = await db.prepare(`
      SELECT id FROM import_jobs
      WHERE status IN ${TERMINAL_STATUS_SQL}
        AND ${FINISHED_AT_SQL} < @cutoff
      ORDER BY ${FINISHED_AT_SQL} ASC
      LIMIT ${IMPORT_RETENTION_MAX_JOBS_PER_TIER}
    `).all<{ id: string }>({ cutoff: summaryCutoff })

    for (const job of summaryJobs) {
      const r2 = await deleteUnlinkedJobFiles(env, job.id)
      r2Deleted += r2.deleted
      r2Errors.push(...r2.errors)
      await db.batch(importJobFullDeleteStatements(job.id))
      summaryDeleted += 1
    }

    await setSettingValue(env, IMPORT_RETENTION_LAST_RUN_KEY, new Date().toISOString())

    if (detailPruned > 0 || summaryDeleted > 0) {
      await audit(env, null, null, 'import_retention_auto_clean', 'import_job', null, {
        detailPruned,
        summaryDeleted,
        r2Deleted,
        r2Errors: r2Errors.length || undefined,
        detailHours,
        summaryDays,
      })
    }

    return { skipped: false, detailPruned, summaryDeleted, r2Deleted, r2Errors: r2Errors.length, detailHours, summaryDays }
  } catch (error) {
    console.error('[import-retention] sweep failed', (error as Error).message || error)
    return { skipped: true, reason: 'error' }
  }
}

export interface OrphanStagingReport {
  applied: boolean
  tables: Record<string, number>
  r2Keys: number
  r2Deleted?: number
  r2Errors?: string[]
}

// Orphan staging = job-scoped rows whose import_jobs row no longer exists
// (left behind by the pre-K4 per-job delete, which skipped half the
// ledgers). Per the locked plan this cleanup is NEVER automatic: the
// admin endpoint (routes/system.ts) defaults to a dry-run report and only
// deletes on an explicit force, after the operator has a backup.
export async function cleanOrphanImportStaging(env: Env, options: { apply: boolean }): Promise<OrphanStagingReport> {
  const db = getDb(env)
  const tables: Record<string, number> = {}
  for (const table of JOB_SCOPED_TABLES) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE job_id NOT IN (SELECT id FROM import_jobs)`,
    ).get<{ n: number }>()
    tables[table] = row?.n ?? 0
  }
  // Orphaned raw files: only ever the unlinked ones -- a Library-linked
  // object belongs to the Library row, not the import job.
  const orphanFiles = await db.prepare(`
    SELECT stored_path FROM import_job_files
    WHERE job_id NOT IN (SELECT id FROM import_jobs) AND file_asset_id IS NULL
  `).all<{ stored_path: string }>()
  const r2Keys = orphanFiles.map((f) => String(f.stored_path || '')).filter(Boolean)

  if (!options.apply) {
    return { applied: false, tables, r2Keys: r2Keys.length }
  }

  const r2 = await deleteObjectsBulk(env.ASSETS, r2Keys)
  await db.batch(
    JOB_SCOPED_TABLES.map((table) => ({
      sql: `DELETE FROM ${table} WHERE job_id NOT IN (SELECT id FROM import_jobs)`,
    })),
  )
  return { applied: true, tables, r2Keys: r2Keys.length, r2Deleted: r2.deleted, r2Errors: r2.errors.length ? r2.errors : undefined }
}
