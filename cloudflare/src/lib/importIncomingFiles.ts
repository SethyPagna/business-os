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
//
// The sweep judges every FILE by its own upload time, not only the job by
// its timestamps (S-uploads2b). A job's clock says nothing about a file
// attached later: a CSV uploaded to a job created 25h earlier (or to a
// failed job, which accepts a corrected CSV) sat on a job that still looked
// idle, the next tick deleted it, and /start then answered "Upload a CSV
// before starting the import". Now no file younger than the threshold its
// job is judged by (1h terminal grace / 24h never started) is removed:
// registered rows by created_at, unregistered objects under the job's
// prefix by R2's `uploaded`. storeUpload also touches the job on every
// attach, so an attach counts as activity -- but that is the liveness half;
// the per-file age is what holds even when a tick lands between the R2 put
// and the row insert.

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
const HOUR_MS = 60 * 60 * 1000

// When a terminal job last moved: the later of finished_at and updated_at.
// finished_at alone goes stale -- a reaped job that is retried and then
// fails inside a chunk (markJobFailed stamps only updated_at) still carries
// the first run's finished_at, which would cut the 1h grace short. SQLite's
// two-argument MAX() is NULL when either side is, hence the COALESCEs.
const TERMINAL_SINCE_SQL = `MAX(COALESCE(j.finished_at, j.updated_at), COALESCE(j.updated_at, j.finished_at))`

// SQLite CURRENT_TIMESTAMP form ('YYYY-MM-DD HH:MM:SS', UTC), so cutoffs
// compare correctly against created_at/updated_at as text.
function sqliteTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function uploadedMs(object: R2Object): number {
  return object.uploaded instanceof Date ? object.uploaded.getTime() : Date.parse(String(object.uploaded || ''))
}

export function jobIdFromIncomingKey(key: string): string | null {
  const match = /^imports\/([^/]+)\//.exec(String(key || ''))
  return match ? match[1] : null
}

export interface IncomingPurgeResult {
  deleted: number
  errors: string[]
}

export interface IncomingPurgeOptions {
  // Sweep mode: delete only files uploaded before this instant -- rows by
  // their created_at, unregistered objects by R2's `uploaded`; a younger
  // file (and its row) is left exactly as it is. Omitted at the terminal
  // points (commit, cancel, dead letter), which remove everything the job
  // has.
  uploadedBeforeMs?: number
}

// Deletes the temporary import objects of one job: the registered csv/zip
// rows that were never linked into the Library (file_asset_id IS NULL) plus
// anything else under imports/<jobId>/, then marks the rows purged. Never
// throws except for the restore-maintenance fence: a job's terminal write
// must not fail because R2 blinked -- the sweep retries.
export async function purgeImportIncomingFiles(env: Env, db: D1Compat, jobId: string, options: IncomingPurgeOptions = {}): Promise<IncomingPurgeResult> {
  try {
    const cutoffMs = options.uploadedBeforeMs
    const cutoff = cutoffMs === undefined ? null : sqliteTimestamp(cutoffMs)
    const rows = await db.prepare(`
      SELECT id, stored_path, created_at FROM import_job_files
      WHERE job_id = @id AND file_asset_id IS NULL AND stored_path LIKE 'imports/%'
        AND COALESCE(status, '') <> '${IMPORT_FILE_PURGED_STATUS}'
    `).all<{ id: number; stored_path: string; created_at: string | null }>({ id: jobId })
    // A row with no created_at cannot be aged; it counts as old, as before.
    const isDue = (row: { created_at: string | null }) => cutoff === null || String(row.created_at || '') < cutoff
    const dueRows = rows.filter(isDue)
    const youngKeys = new Set(rows.filter((row) => !isDue(row)).map((row) => String(row.stored_path || '')))
    const keys = new Set(dueRows.map((row) => String(row.stored_path || '')).filter((key) => key && !youngKeys.has(key)))
    // Anything under the job's own prefix, registered or not (a crash
    // between R2 put and the row insert leaves an unregistered object) --
    // except a younger file's object, or, in sweep mode, an unregistered
    // object uploaded after the cutoff (its row may be about to land).
    const prefix = `${IMPORT_INCOMING_PREFIX}${jobId}/`
    let cursor: string | undefined
    for (let page = 0; page < SWEEP_MAX_LIST_PAGES; page += 1) {
      const listed = await env.ASSETS.list({ prefix, cursor, limit: 1000 })
      for (const object of listed.objects) {
        if (keys.has(object.key) || youngKeys.has(object.key)) continue
        if (cutoffMs !== undefined && !(uploadedMs(object) < cutoffMs)) continue
        keys.add(object.key)
      }
      if (!listed.truncated) break
      cursor = listed.cursor
    }
    if (!keys.size && !dueRows.length) return { deleted: 0, errors: [] }
    const result = keys.size ? await deleteObjectsBulk(env.ASSETS, [...keys]) : { deleted: 0, errors: [] }
    if (!result.errors.length && dueRows.length) {
      await db.prepare(`
        UPDATE import_job_files SET status = '${IMPORT_FILE_PURGED_STATUS}', updated_at = CURRENT_TIMESTAMP
        WHERE job_id = @id AND file_asset_id IS NULL AND stored_path LIKE 'imports/%'
          ${cutoff === null ? '' : `AND COALESCE(created_at, '') < @cutoff`}
      `).run(cutoff === null ? { id: jobId } : { id: jobId, cutoff })
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
// In cases 1 and 2 the file itself must also be older than the same cutoff
// (see the header): a file attached after the job went quiet waits out its
// own grace. Jobs that are running or awaiting a person's review keep their
// file.
export async function sweepStaleImportIncomingFiles(env: Env, nowMs: number = Date.now()): Promise<IncomingSweepResult> {
  const db = getDb(env)
  let jobsPurged = 0
  let orphanObjectsDeleted = 0
  let errors = 0
  const terminalCutoffMs = nowMs - TERMINAL_INCOMING_GRACE_HOURS * HOUR_MS
  const staleCutoffMs = nowMs - STALE_INCOMING_MAX_AGE_HOURS * HOUR_MS
  const terminalCutoff = sqliteTimestamp(terminalCutoffMs)
  const staleCutoff = sqliteTimestamp(staleCutoffMs)

  const jobs = await db.prepare(`
    SELECT DISTINCT j.id, j.status FROM import_jobs j
    JOIN import_job_files f ON f.job_id = j.id
    WHERE f.file_asset_id IS NULL AND f.stored_path LIKE 'imports/%'
      AND COALESCE(f.status, '') <> '${IMPORT_FILE_PURGED_STATUS}'
      AND (
        (j.status IN ${TERMINAL_STATUS_SQL} AND ${TERMINAL_SINCE_SQL} < @terminalCutoff
          AND COALESCE(f.created_at, '') < @terminalCutoff)
        OR (j.status IN ('pending', 'created') AND j.updated_at < @staleCutoff
          AND COALESCE(f.created_at, '') < @staleCutoff)
      )
    LIMIT ${SWEEP_MAX_JOBS}
  `).all<{ id: string; status: string }>({ terminalCutoff, staleCutoff })
  for (const job of jobs) {
    const terminal = (IMPORT_TERMINAL_STATUSES as readonly string[]).includes(String(job.status))
    const result = await purgeImportIncomingFiles(env, db, String(job.id), {
      uploadedBeforeMs: terminal ? terminalCutoffMs : staleCutoffMs,
    })
    if (result.errors.length) errors += 1
    else jobsPurged += 1
  }

  // Orphans: R2 objects under imports/ with no live job behind them.
  const candidates: { key: string; jobId: string }[] = []
  let cursor: string | undefined
  for (let page = 0; page < SWEEP_MAX_LIST_PAGES; page += 1) {
    const listed = await env.ASSETS.list({ prefix: IMPORT_INCOMING_PREFIX, cursor, limit: 1000 })
    for (const object of listed.objects) {
      const objectUploadedMs = uploadedMs(object)
      if (!Number.isFinite(objectUploadedMs) || objectUploadedMs >= staleCutoffMs) continue
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
