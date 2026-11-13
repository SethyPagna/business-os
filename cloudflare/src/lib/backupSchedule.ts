// When the scheduled backup is due: once per Cambodia business date
// (Asia/Phnom_Penh, UTC+7, no DST), at the first heavy-cron tick at or after
// the close hour. Pure -- no Worker, no R2, no D1 -- so a test can drive it
// with a fake clock.
//
// Open shifts never delay it and nothing here reads them: the owner ruled
// (12 Nov 2026) that backups run daily after close, and a backup must not wait
// on a person closing a till.
//
// The same rule is applied twice, to two different "last done" instants:
//   - in the heavy lane (pickHeavyStepIndex), to the backup step's last OK
//     visit in the cron state it already loads (no extra read), to decide
//     which heavy step this tick runs;
//   - in maybeRunScheduledBackup (lib/backup.ts), to the newest backup actually
//     stored in R2, so a lost or reset cron state can never produce a second
//     backup on the same date.

// Import-free on purpose (the backup harnesses load this file by hand). The offset is businessDateWindow's
// BUSINESS_UTC_OFFSET_MINUTES; scripts/test-backup-daily-schedule-pure.cjs pins the two together.
const BUSINESS_UTC_OFFSET_MINUTES = 420

import type { RotationState, RotationStep } from './cronRotation'

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Cambodia calendar date (YYYY-MM-DD) of an instant. */
export function businessDateOf(ms: number): string {
  return new Date(ms + BUSINESS_UTC_OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 10)
}

/** Cambodia wall-clock hour (0-23) of an instant. */
export function businessHourOf(ms: number): number {
  return new Date(ms + BUSINESS_UTC_OFFSET_MINUTES * MINUTE_MS).getUTCHours()
}

export type ScheduledBackupGate = {
  due: boolean
  /**
   * due: 'first' (nothing recorded yet), 'after-close' (today's first tick past
   * the close hour), 'catch-up' (a whole business date went by with none).
   * not due: 'before-close' or 'already-today'.
   */
  reason: 'first' | 'after-close' | 'catch-up' | 'before-close' | 'already-today'
}

/**
 * `lastMs` is when the last scheduled backup (or backup visit) completed; 0 or
 * a non-finite value means none. `afterHourLocal` is the close hour from
 * getPlanLimits(env).scheduledBackupAfterHourLocal.
 */
export function scheduledBackupGate(nowMs: number, lastMs: number, afterHourLocal: number): ScheduledBackupGate {
  if (!Number.isFinite(lastMs) || lastMs <= 0) return { due: true, reason: 'first' }
  const today = businessDateOf(nowMs)
  // The business date the last backup covers: one taken before the close hour (a catch-up in the
  // small hours, a first run in the morning) holds that date's PREVIOUS day, not the day still being traded.
  const covered = businessDateOf(businessHourOf(lastMs) >= afterHourLocal ? lastMs : lastMs - DAY_MS)
  // The same date, or a clock that ran ahead: at most one per business date.
  if (covered >= today) return { due: false, reason: 'already-today' }
  if (businessHourOf(nowMs) >= afterHourLocal) return { due: true, reason: 'after-close' }
  // A missed night (the 22:17 run failed or was skipped): do not wait a second day.
  if (covered < businessDateOf(nowMs - DAY_MS)) return { due: true, reason: 'catch-up' }
  return { due: false, reason: 'before-close' }
}

/**
 * The business night an instant belongs to: the Cambodia date on which the close hour last passed (21:00 on the 12th to
 * 20:59 on the 13th is night 2026-11-12). The same grouping scheduledBackupGate uses for the date a backup covers.
 */
export function scheduledBackupNightOf(ms: number, afterHourLocal: number): string {
  return businessDateOf(ms - afterHourLocal * 60 * MINUTE_MS)
}

export type BackupCoverageItem = { uploaded: string | null; finalized: boolean; source?: 'manual' | 'scheduled' | null; scope?: 'full' | 'section' | null }

/**
 * The instant the schedule treats as "last backup done": the newest finalized
 * FULL SCHEDULED backup, and nothing else.
 *
 * A manual backup never counts, at any hour. A section backup (the pre-backup of
 * a reset or repair: a few tables, no assets) is not a backup of the shop, and
 * a full manual "Back up now" after close, although a complete snapshot, sits in
 * the manual pool (newest 2) where the next manual backups evict it, which would
 * leave a hole in the 7 daily backups the owner asked for. So the night run still
 * takes its own. `scope` is stamped on every new manifest; scheduled backups
 * from before it was stamped are full by construction (only the full writer runs
 * on a schedule), so a missing scope on a scheduled set counts.
 * `_afterHourLocal` is kept so callers read the same either way.
 */
export function scheduledBackupCoverageMs(items: readonly BackupCoverageItem[], _afterHourLocal: number): number {
  let newest = 0
  for (const item of items) {
    if (!item.finalized || !item.uploaded) continue
    const ms = Date.parse(item.uploaded)
    if (!Number.isFinite(ms)) continue
    if (item.source !== 'scheduled' || item.scope === 'section') continue
    if (ms > newest) newest = ms
  }
  return newest
}

/**
 * Which heavy step this tick runs (see runRotationTick's `select`). Without
 * this the two heavy steps alternate every 3 hours, so the backup would land on
 * the after-close tick only every other day. Backup goes first whenever the
 * gate is due; any other tick runs the other step, which keeps its own minimum
 * interval.
 */
export function pickHeavyStepIndex(steps: readonly RotationStep[], state: RotationState, nowMs: number, afterHourLocal: number, maxAttemptsPerNight: number = Infinity): number | undefined {
  const backupIndex = steps.findIndex((step) => step.id === 'backup')
  if (backupIndex < 0) return undefined
  const record = state.steps.backup
  const okAt = record?.okAt
  const lastMs = okAt ? Date.parse(okAt) : 0
  // Visits that threw or were killed this night (counted per night by the step's attemptWindow): after maxAttemptsPerNight the night
  // is given up and the tick goes to the other step, so a backup that keeps failing neither re-reads the whole database every
  // 3 h nor starves the image audit. The next night starts with a fresh allowance.
  const exhausted = !!record && record.windowKey === scheduledBackupNightOf(nowMs, afterHourLocal) && (record.windowFailures || 0) >= maxAttemptsPerNight
  if (!exhausted && scheduledBackupGate(nowMs, lastMs, afterHourLocal).due) return backupIndex
  const other = steps.findIndex((step) => step.id !== 'backup')
  return other >= 0 ? other : backupIndex
}
