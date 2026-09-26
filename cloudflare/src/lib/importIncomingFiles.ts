import type { Env } from '../index'
import { getDb, isImportMaintenanceFenceError, type D1Compat } from './db'
import { deleteObjectsBulk } from './r2'
import { buildInClause, selectInChunks } from './sqlBinding'

// S-uploads (owner ruling 2026-09-26): import files are TEMPORARY. The CSV,
// TSV or ZIP a person uploads to seed an import lives in R2 only while the
// import needs it, under imports/<jobId>/incoming/ (routes/importJobs.ts's
// storeUpload), and is deleted once the job finishes -- completed, failed or
// cancelled. Product images extracted from a ZIP are NOT import files: they
// are stored as Library images under uploads/ with a file_assets row
// (file_asset_id set) and stay.
//
// Where the delete runs:
//   - immediately at the unambiguous terminal points: the apply finalizer
//     (completed / completed_with_errors), every cancel that settles to
//     'cancelled', and the dead-letter handler (a failure nothing retries);
//   - otherwise by sweepStaleImportIncomingFiles on the scheduled tick.
//     markJobFailed inside the engine is deliberately NOT a delete point: a
//     queued chunk that fails is retried by Cloudflare Queues, and a retry
//     that is still materializing the CSV needs the file. The sweep deletes a
//     failed job's file once it has sat terminal for an hour, long past any
//     automatic retry.
//
// After the file is gone, a retry still works from the materialized source
// rows (import_job_source_rows, kept 24h by lib/importRetention.ts); only a
// job that failed before materialization finished is refused, with a clear
// message, by routes/importJobs.ts's /:id/retry.

export const IMPORT_INCOMING_PREFIX = 'imports/'
// import_job_files.status once the object behind the row has been deleted.
export const IMPORT_FILE_PURGED_STATUS = 'purged'

// Terminal job statuses, same four lib/importRetention.ts sweeps.
export const IMPORT_TERMINAL_STATUSES = ['completed', 'completed_with_errors', 'failed', 'cancelled'] as const
const TERMINAL_STATUS_SQL = `('completed', 'completed_with_errors', 'failed', 'cancelled')`
// Statuses in which the job may still read its incoming file.
export const IMPORT_ACTIVE_STATUSES = ['pending', 'created', 'queued', 'analyzing', 'running', 'awaiting_review', 'approved', 'applying', 'cancelling'] as const

// A terminal job's file is swept once it has been terminal this long.
export const TERMINAL_INCOMING_GRACE_HOURS = 1
// A job nobody ever started (pending/created), or an R2 object under
// imports/ whose job is gone, is swept at this age.
export const STALE_INCOMING_MAX_AGE_HOURS = 24
// Per-tick bound so one scheduled invocation stays small.
const SWEEP_MAX_JOBS = 25
const SWEEP_MAX_LIST_PAGES = 3

function sqliteTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

export function jobIdFromIncomingKey(key: string): string | null {
  const match = /^imports\/([^/]+)\//.exec(String(key || ''))
  return match ? match[1] : null
}

export interface IncomingPurgeResult {
  deleted: number
  errors: string[]
}

// Deletes every temporary import object of one job: the registered
// csv/zip rows that were never linked into the Library (file_asset_id IS
// NULL) plus anything else under imports/<jobId>/, then marks the rows
// purged. Never throws except for the restore-maintenance fence: a job's
// terminal write must not fail because R2 blinked -- the sweep retries.
export async function purgeImportIncomingFiles(env: Env, db: D1Compat, jobId: string): Promise<IncomingPurgeResult> {
  try {
    const rows = await db.prepare(`
      SELECT id, stored_path FROM import_job_files
      WHERE job_id = @id AND file_asset_id IS NULL AND stored_path LIKE 'imports/%'
        AND COALESCE(status, '') <> '${IMPORT_FILE_PURGED_STATUS}'
    `).all<{ id: number; stored_path: string }>({ id: jobId })
    const keys = new Set(rows.map((row) => String(row.stored_path || '')).filter(Boolean))
    // Anything under the job's own prefix, registered or not (a crash
    // between R2 put and the row insert leaves an unregistered object).
    const prefix = `${IMPORT_INCOMING_PREFIX}${jobId}/`
    let cursor: string | undefined
    for (let page = 0; page < SWEEP_MAX_LIST_PAGES; page += 1) {
      const listed = await env.ASSETS.list({ prefix, cursor, limit: 1000 })
      for (const object of listed.objects) keys.add(object.key)
      if (!listed.truncated) break
      cursor = listed.cursor
    }
    if (!keys.size && !rows.length) return { deleted: 0, errors: [] }
    const result = keys.size ? await deleteObjectsBulk(env.ASSETS, [...keys]) : { deleted: 0, errors: [] }
    if (!result.errors.length && rows.length) {
      await db.prepare(`
        UPDATE import_job_files SET status = '${IMPORT_FILE_PURGED_STATUS}', updated_at = CURRENT_TIMESTAMP
        WHERE job_id = @id AND file_asset_id IS NULL AND stored_path LIKE 'imports/%'
      `).run({ id: jobId })
    }
    return result
  } catch (error) {
    if (isImportMaintenanceFenceError(error)) throw error
    console.error('[import-incoming] purge failed', jobId, (error as Error)?.message || error)
    return { deleted: 0, errors: [String((error as Error)?.message || error)] }
  }
}

// True when the job's source CSV has been deleted AND its rows were never
// fully materialized -- the one case where a retry has nothing to run from.
export async function importSourceUnavailableForRetry(db: D1Compat, jobId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM import_job_files WHERE job_id = @id AND kind = 'csv') AS total,
      (SELECT COUNT(*) FROM import_job_files WHERE job_id = @id AND kind = 'csv' AND COALESCE(status, '') <> '${IMPORT_FILE_PURGED_STATUS}') AS live,
      (SELECT COALESCE(materialize_done, 0) FROM import_jobs WHERE id = @id) AS materialized
  `).get<{ total: number; live: number; materialized: number }>({ id: jobId })
  return Number(row?.total || 0) > 0 && Number(row?.live || 0) === 0 && !Number(row?.materialized || 0)
}

export interface IncomingSweepResult {
  jobsPurged: number
  orphanObjectsDeleted: number
  errors: number
}

// Scheduled safety net (index.ts scheduled handler). Three cases:
//   1. terminal jobs, terminal for over TERMINAL_INCOMING_GRACE_HOURS, that
//      still have an unpurged incoming file (engine-level failures, the
//      stalled-job reaper, any delete that errored);
//   2. jobs never started (pending/created) and idle for over
//      STALE_INCOMING_MAX_AGE_HOURS;
//   3. objects under imports/ older than STALE_INCOMING_MAX_AGE_HOURS whose
//      job no longer exists or is terminal.
// Jobs that are running or awaiting a person's review keep their file.
export async function sweepStaleImportIncomingFiles(env: Env, nowMs: number = Date.now()): Promise<IncomingSweepResult> {
  const db = getDb(env)
  let jobsPurged = 0
  let orphanObjectsDeleted = 0
  let errors = 0
  const terminalCutoff = sqliteTimestamp(nowMs - TERMINAL_INCOMING_GRACE_HOURS * 60 * 60 * 1000)
  const staleCutoff = sqliteTimestamp(nowMs - STALE_INCOMING_MAX_AGE_HOURS * 60 * 60 * 1000)

  const jobs = await db.prepare(`
    SELECT DISTINCT j.id FROM import_jobs j
    JOIN import_job_files f ON f.job_id = j.id
    WHERE f.file_asset_id IS NULL AND f.stored_path LIKE 'imports/%'
      AND COALESCE(f.status, '') <> '${IMPORT_FILE_PURGED_STATUS}'
      AND (
        (j.status IN ${TERMINAL_STATUS_SQL} AND COALESCE(j.finished_at, j.updated_at) < @terminalCutoff)
        OR (j.status IN ('pending', 'created') AND j.updated_at < @staleCutoff)
      )
    LIMIT ${SWEEP_MAX_JOBS}
  `).all<{ id: string }>({ terminalCutoff, staleCutoff })
  for (const job of jobs) {
    const result = await purgeImportIncomingFiles(env, db, String(job.id))
    if (result.errors.length) errors += 1
    else jobsPurged += 1
  }

  // Orphans: R2 objects under imports/ with no live job behind them.
  const staleBeforeMs = nowMs - STALE_INCOMING_MAX_AGE_HOURS * 60 * 60 * 1000
  const candidates: { key: string; jobId: string }[] = []
  let cursor: string | undefined
  for (let page = 0; page < SWEEP_MAX_LIST_PAGES; page += 1) {
    const listed = await env.ASSETS.list({ prefix: IMPORT_INCOMING_PREFIX, cursor, limit: 1000 })
    for (const object of listed.objects) {
      const uploadedMs = object.uploaded instanceof Date ? object.uploaded.getTime() : Date.parse(String(object.uploaded || ''))
      if (!Number.isFinite(uploadedMs) || uploadedMs >= staleBeforeMs) continue
      const jobId = jobIdFromIncomingKey(object.key)
      candidates.push({ key: object.key, jobId: jobId || '' })
    }
    if (!listed.truncated) break
    cursor = listed.cursor
  }
  if (candidates.length) {
    const jobIds = [...new Set(candidates.map((c) => c.jobId).filter(Boolean))]
    const activeRows = await selectInChunks(jobIds, 0, (chunk) => {
      const inClause = buildInClause('j', chunk)
      return db.prepare(`
        SELECT id FROM import_jobs WHERE id IN (${inClause.sql})
          AND status NOT IN ${TERMINAL_STATUS_SQL}
      `).all<{ id: string }>(inClause.params)
    })
    const activeJobs = new Set(activeRows.map((row) => String(row.id)))
    const orphanKeys = candidates.filter((c) => !c.jobId || !activeJobs.has(c.jobId)).map((c) => c.key)
    if (orphanKeys.length) {
      const result = await deleteObjectsBulk(env.ASSETS, orphanKeys)
      orphanObjectsDeleted += result.deleted
      errors += result.errors.length
    }
  }
  return { jobsPurged, orphanObjectsDeleted, errors }
}
