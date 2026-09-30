import { getDb } from './db'
import { cleanOrphanImportStaging, type OrphanStagingReport } from './importRetention'
import type { Env } from '../index'

// The cron used to run the orphan-staging sweep on every 6-hourly tick. That
// sweep is ten NOT IN counts, ten NOT IN deletes and two GROUP BYs over the
// staging tables -- full scans whose only job is to find rows a mid-flight job
// delete left behind, which is rare. Once a day is plenty, and every skipped
// tick costs one settings read instead of the scans.
//
// 20 h, not 24 h: ticks land a few seconds apart from the stamp, so a 24 h
// gate would skip the tick that is exactly a day later and run every 30 h.
const ORPHAN_STAGING_LAST_RUN_KEY = 'orphan_staging_last_run'
const ORPHAN_STAGING_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000

export type ScheduledOrphanStagingResult =
  | { skipped: true; reason: 'ran-recently' }
  | ({ skipped: false } & OrphanStagingReport)

export async function maybeRunScheduledOrphanStagingCleanup(env: Env, now: number = Date.now()): Promise<ScheduledOrphanStagingResult> {
  const db = getDb(env)
  const row = await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key: ORPHAN_STAGING_LAST_RUN_KEY })
  const lastRun = row?.value ? Date.parse(row.value) : NaN
  // An unreadable stamp, or one in the future (clock skew), must not silence
  // the sweep until it "expires".
  const elapsed = now - lastRun
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < ORPHAN_STAGING_MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'ran-recently' }
  }

  const report = await cleanOrphanImportStaging(env, { apply: true })
  // Stamped only after a completed sweep: a thrown one retries on the next tick.
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ key: ORPHAN_STAGING_LAST_RUN_KEY, value: new Date(now).toISOString() })
  return { skipped: false, ...report }
}
