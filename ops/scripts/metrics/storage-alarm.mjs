// The D1 size alarm. Pure: no network, no clock of its own.
//
// Cloudflare Free caps one D1 database at 500 MB and refuses writes past it, so sales would stop. Every D1 call the ops export makes
// reports the database size in its meta (`size_after`, bytes), so the daily consistency run reads it for free: no query is added.
//   ALARM  the size is at or above 400 MB (80% of the cap). Fails the run. The owner then decides the hot/cold split.
//   WATCH  the 12-month projection is above 450 MB. Passes the run, shows in the encrypted report and the public log.
//   OK     neither.
// The projection needs a growth rate. A run keeps no history of its own (the repository is public and a read-only job commits
// nothing), so the slope comes from `storage-baseline.json`, the measured series, refreshed by a docs-only commit from the
// encrypted reports. The slope is the STEEPEST of all baseline points older than a week: an over-warning WATCH costs a log line,
// an under-warning costs the shop its sales.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MB = 1e6
export const ALARM_BYTES = 400 * MB
export const PROJECTION_LIMIT_BYTES = 450 * MB
export const FREE_CAP_BYTES = 500 * MB
export const PROJECTION_DAYS = 365
export const MIN_BASELINE_AGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
export const BASELINE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'storage-baseline.json')

export function loadBaseline(file = BASELINE_FILE) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed.series)) throw new Error('storage-baseline.json needs a series array')
  return parsed.series.map((point) => ({ date: String(point.date), bytes: Number(point.bytes) }))
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.bytes) && point.bytes > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// The largest growth per day from any baseline point at least a week old to the size now; null when no point qualifies.
export function growthPerDay(sizeBytes, now, baseline) {
  let steepest = null
  for (const point of baseline) {
    const ageDays = (now.getTime() - Date.parse(`${point.date}T00:00:00Z`)) / DAY_MS
    if (!(ageDays >= MIN_BASELINE_AGE_DAYS)) continue
    const perDay = (sizeBytes - point.bytes) / ageDays
    if (steepest === null || perDay > steepest) steepest = perDay
  }
  return steepest
}

// size_after of the last D1 response that carried one; null when none did (the run then says so instead of guessing).
export function sizeFromMetas(metas) {
  for (const meta of [...metas].reverse()) {
    const size = Number(meta && meta.size_after)
    if (Number.isFinite(size) && size > 0) return size
  }
  return null
}

export function evaluateStorage({ sizeBytes, now = new Date(), baseline = loadBaseline() }) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { level: 'UNKNOWN', sizeMB: null, reasons: ['no size_after in any response'] }
  const slope = growthPerDay(sizeBytes, now, baseline)
  const projected = slope === null ? null : sizeBytes + Math.max(0, slope) * PROJECTION_DAYS
  const daysTo = (limit) => (slope === null || slope <= 0 ? null : Math.max(0, Math.ceil((limit - sizeBytes) / slope)))
  const reasons = []
  let level = 'OK'
  if (sizeBytes >= ALARM_BYTES) { level = 'ALARM'; reasons.push('the database is at or above 400 MB') }
  else if (projected !== null && projected > PROJECTION_LIMIT_BYTES) { level = 'WATCH'; reasons.push('the 12-month projection is above 450 MB') }
  return {
    level,
    sizeMB: Math.round(sizeBytes / MB * 10) / 10,
    growthMBPerDay: slope === null ? null : Math.round(slope / MB * 100) / 100,
    projected12mMB: projected === null ? null : Math.round(projected / MB),
    daysTo400: sizeBytes >= ALARM_BYTES ? 0 : daysTo(ALARM_BYTES),
    daysTo500: sizeBytes >= FREE_CAP_BYTES ? 0 : daysTo(FREE_CAP_BYTES),
    reasons,
  }
}
