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

export type BackupCoverageItem = { uploaded: string | null; finalized: boolean; source?: 'manual' | 'scheduled' | null }

/**
 * The instant the schedule treats as "last backup done": the newest finalized
 * SCHEDULED backup, or a finalized manual one taken after the close hour (a
 * person who backed up after close has already covered that date). A manual
 * backup in the middle of the afternoon covers nothing: the night run still
 * captures the day.
 */
export function scheduledBackupCoverageMs(items: readonly BackupCoverageItem[], afterHourLocal: number): number {
  let newest = 0
  for (const item of items) {
    if (!item.finalized || !item.uploaded) continue
    const ms = Date.parse(item.uploaded)
    if (!Number.isFinite(ms)) continue
    const counts = item.source === 'scheduled' || businessHourOf(ms) >= afterHourLocal
    if (counts && ms > newest) newest = ms
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
export function pickHeavyStepIndex(steps: readonly RotationStep[], state: RotationState, nowMs: number, afterHourLocal: number): number | undefined {
  const backupIndex = steps.findIndex((step) => step.id === 'backup')
  if (backupIndex < 0) return undefined
  const okAt = state.steps.backup?.okAt
  const lastMs = okAt ? Date.parse(okAt) : 0
  if (scheduledBackupGate(nowMs, lastMs, afterHourLocal).due) return backupIndex
  const other = steps.findIndex((step) => step.id !== 'backup')
  return other >= 0 ? other : backupIndex
}
