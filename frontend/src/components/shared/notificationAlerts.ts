import { emitToast, NOTIFICATION_ALERT_MS, NOTIFICATION_MAX_VISIBLE } from './toastChannel.ts'

// Device-local memory of which bell items already popped up, kept apart from the bell's seen memory
// (notif_seen_alert_times_v1) so a pop-up does not clear the badge. One memory per signed-in user.
export const ANNOUNCED_ALERT_TIMES_KEY = 'notif_announced_alert_times_v1'
export const ANNOUNCED_ALERT_TIMES_LIMIT = 1000

export type AlertCandidate = { id: string; tone?: string }
export type AlertTimes = Record<string, number>
export type AlertStore = { read: () => AlertTimes; write: (times: AlertTimes) => void }

// Only a warning or a danger pops up. Info (a delivery waiting, a submission) and success (points reached) stay in the bell.
export function isAnnounceableTone(tone: unknown): boolean {
  return tone === 'danger' || tone === 'warning'
}

// An item pops up once per device: when neither the pop-up memory nor the bell's seen memory has it.
export function pickAlertsToAnnounce<T extends AlertCandidate>(
  items: T[],
  seenTimes: AlertTimes,
  announcedTimes: AlertTimes,
  skipIds: ReadonlySet<string> = new Set(),
): T[] {
  const picked: T[] = []
  const taken = new Set<string>()
  for (const item of items) {
    if (!item?.id || taken.has(item.id) || skipIds.has(item.id) || !isAnnounceableTone(item.tone)) continue
    if (Number(seenTimes[item.id]) || Number(announcedTimes[item.id])) continue
    taken.add(item.id)
    picked.push(item)
  }
  return picked
}

export type AlertPopupPlan<T> =
  | { kind: 'none' }
  | { kind: 'each'; items: T[] }
  | { kind: 'many'; count: number }

// Up to three get a pop-up each; more than three collapse into one "N alerts need attention", N being what popped in this load.
export function planAlertPopups<T>(fresh: T[]): AlertPopupPlan<T> {
  if (!fresh.length) return { kind: 'none' }
  if (fresh.length > NOTIFICATION_MAX_VISIBLE) return { kind: 'many', count: fresh.length }
  return { kind: 'each', items: fresh }
}

export function toastTypeForTone(tone: unknown): 'error' | 'warning' | 'info' {
  return tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : 'info'
}

// Latest time per item wins, so two tabs or the desktop and phone bell instances never erase each other.
export function mergeAlertTimes(...memories: AlertTimes[]): AlertTimes {
  const merged: AlertTimes = {}
  for (const memory of memories) {
    for (const [id, at] of Object.entries(memory)) {
      if (!(id in merged) || at > merged[id]) merged[id] = at
    }
  }
  return merged
}

type AnnounceArgs<T extends AlertCandidate> = {
  items: T[]
  // The panel is open, the bell is not this viewport's, the page is hidden or the summary is unavailable.
  blocked: boolean
  seenTimes: AlertTimes
  skipIds?: ReadonlySet<string>
  now: number
  store: AlertStore
}

// One summary load. Reads the memory fresh, picks what is new to this device, writes the merged memory
// (before the caller emits anything) and says what to show.
export function announceFreshAlerts<T extends AlertCandidate>({ items, blocked, seenTimes, skipIds, now, store }: AnnounceArgs<T>): AlertPopupPlan<T> {
  if (blocked) return { kind: 'none' }
  const stored = store.read()
  const fresh = pickAlertsToAnnounce(items, seenTimes, stored, skipIds)
  if (!fresh.length) return { kind: 'none' }
  store.write(mergeAlertTimes(stored, Object.fromEntries(fresh.map((item) => [item.id, now]))))
  return planAlertPopups(fresh)
}

type PopUpText<T> = {
  // One item's text, built by the same function the bell row uses, so a pop-up never reads in another language than the bell.
  itemMessage: (item: T) => string
  manyMessage: (count: number) => string
  // View: open the bell on this item, or just open it for the collapsed "N alerts" pop-up.
  open: (item: T | null) => void
}

// Every bell-item pop-up lasts the alert time; a danger is an error pop-up, a warning is a warning pop-up.
export function popUpAlerts<T extends AlertCandidate>(plan: AlertPopupPlan<T>, text: PopUpText<T>): void {
  if (plan.kind === 'many') {
    emitToast({ message: text.manyMessage(plan.count), type: 'warning', duration: NOTIFICATION_ALERT_MS, onActivate: () => text.open(null) })
    return
  }
  if (plan.kind !== 'each') return
  for (const item of plan.items) {
    emitToast({ message: text.itemMessage(item), type: toastTypeForTone(item.tone), duration: NOTIFICATION_ALERT_MS, onActivate: () => text.open(item) })
  }
}

export function alertStoreKey(userId: unknown): string {
  return `${ANNOUNCED_ALERT_TIMES_KEY}:${String(userId ?? 'anonymous')}`
}

function parseTimes(raw: string | null): AlertTimes {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const result: AlertTimes = {}
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      const numeric = Number(at)
      if (Number.isFinite(numeric)) result[id] = numeric
    }
    return result
  } catch (_) {
    return {}
  }
}

// Held in memory too, so a browser that refuses storage still pops an item once per page life, not on every load.
const sessionMemory = new Map<string, AlertTimes>()

export function browserAlertStore(userId: unknown): AlertStore {
  const key = alertStoreKey(userId)
  return {
    read: () => {
      let stored: AlertTimes = {}
      try { stored = parseTimes(window.localStorage.getItem(key)) } catch (_) { /* memory below */ }
      return mergeAlertTimes(stored, sessionMemory.get(key) || {})
    },
    write: (times) => {
      const trimmed = Object.fromEntries(Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, ANNOUNCED_ALERT_TIMES_LIMIT))
      sessionMemory.set(key, trimmed)
      try { window.localStorage.setItem(key, JSON.stringify(trimmed)) } catch (_) { /* kept in memory */ }
    },
  }
}
