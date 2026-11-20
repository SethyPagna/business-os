import { NOTIFICATION_MAX_VISIBLE } from './toastChannel.ts'

// Device-local memory of which bell items already popped up, same shape and same repeat interval as
// the bell's seen memory (notif_seen_alert_times_v1). Kept separate so a pop-up does not clear the badge.
export const ANNOUNCED_ALERT_TIMES_KEY = 'notif_announced_alert_times_v1'
export const ANNOUNCED_ALERT_TIMES_LIMIT = 1000

export type AlertCandidate = { id: string; tone?: string }

// Success rows (points reached) are good news, not alerts.
export function isAnnounceableTone(tone: unknown): boolean {
  return tone === 'danger' || tone === 'warning' || tone === 'info'
}

// An item pops up when neither the pop-up memory nor the bell's seen memory has it inside the repeat window.
export function pickAlertsToAnnounce<T extends AlertCandidate>(
  items: T[],
  seenTimes: Record<string, number>,
  announcedTimes: Record<string, number>,
  now: number,
  realertMs: number,
  skipIds: ReadonlySet<string> = new Set(),
): T[] {
  const picked: T[] = []
  const taken = new Set<string>()
  for (const item of items) {
    if (!item?.id || taken.has(item.id) || skipIds.has(item.id) || !isAnnounceableTone(item.tone)) continue
    const lastShown = Math.max(Number(seenTimes[item.id]) || 0, Number(announcedTimes[item.id]) || 0)
    if (lastShown && now - lastShown < realertMs) continue
    taken.add(item.id)
    picked.push(item)
  }
  return picked
}

export type AlertPopupPlan<T> =
  | { kind: 'none' }
  | { kind: 'each'; items: T[] }
  | { kind: 'many'; count: number }

// Up to three get a pop-up each; more than three collapse into one "N alerts need attention".
export function planAlertPopups<T>(fresh: T[]): AlertPopupPlan<T> {
  if (!fresh.length) return { kind: 'none' }
  if (fresh.length > NOTIFICATION_MAX_VISIBLE) return { kind: 'many', count: fresh.length }
  return { kind: 'each', items: fresh }
}

export function toastTypeForTone(tone: unknown): 'error' | 'warning' | 'info' {
  return tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : 'info'
}

export function readAnnouncedAlertTimes(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ANNOUNCED_ALERT_TIMES_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, number> = {}
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      const numeric = Number(at)
      if (Number.isFinite(numeric)) result[id] = numeric
    }
    return result
  } catch (_) {
    return {}
  }
}

export function writeAnnouncedAlertTimes(times: Record<string, number>): void {
  try {
    const trimmed = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, ANNOUNCED_ALERT_TIMES_LIMIT)
    window.localStorage.setItem(ANNOUNCED_ALERT_TIMES_KEY, JSON.stringify(Object.fromEntries(trimmed)))
  } catch (_) {
    // Storage unavailable: the pop-up may repeat on the next load, which is the safe direction.
  }
}
