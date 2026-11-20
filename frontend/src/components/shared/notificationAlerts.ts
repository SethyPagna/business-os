import { emitToast, NOTIFICATION_ALERT_MS, NOTIFICATION_MAX_VISIBLE } from './toastChannel.ts'

// Device-local memory of which bell items already popped up, kept apart from the bell's seen memory
// (notif_seen_alert_times_v1) so a pop-up does not clear the badge. One memory per signed-in user.
export const ANNOUNCED_ALERT_TIMES_KEY = 'notif_announced_alert_times_v1'
export const ANNOUNCED_ALERT_TIMES_LIMIT = 1000
// An alert that left its section is forgotten only after it stayed away this long when the Settings repeat interval is off or zero.
export const RESOLVED_QUIET_FALLBACK_MS = 10 * 60 * 1000

export type AlertCandidate = { id: string; tone?: string }
// The bell's own seen memory: item id -> when the bell last showed it.
export type AlertTimes = Record<string, number>
// The pop-up memory, one entry per announced item:
//   at           when it last popped (or was seen after coming back); entries merge across tabs by the latest `at`
//   section      the bell section it belongs to, so a load can tell that it left a section that is fully listed
//   absentSince  first load that found it gone from a complete section
//   resolved     it stayed gone for the quiet period: a later return is a new alert, and a bell "seen" older than absentSince no longer counts
export type AlertEntry = { at: number; section?: string; absentSince?: number; resolved?: boolean }
export type AlertMemory = Record<string, AlertEntry>
export type AlertStore = { read: () => AlertMemory; write: (memory: AlertMemory) => void }

export type AlertRow<T extends AlertCandidate> = { item: T; sectionId: string }
// A section counts as listed in full only when the Worker did not cut its items to a preview.
export type AlertSectionState = { id: string; complete: boolean }

// 20 is the smallest list limit the Worker uses (security stops at LIMIT 20, imports keep 20 items; sales, expiry, supplier
// credit and portal stop at 50, and only inventory says `truncated`). A section with this many items or more may have been
// cut off without saying so, so it never counts as listed in full.
export const SECTION_CUT_OFF_ITEMS = 20

/**
 * True only for an answer the Worker itself produced. When a bell read fails (a 500, a dropped connection, the browser offline) the API
 * layer hands the bell a stand-in with no sections so the panel can still draw; that stand-in carries no `generatedAt`, which the Worker
 * always sends. Reading the stand-in as a real, empty answer made every unresolved alert count as resolved and pop again once the
 * connection came back (round-4 review S4).
 */
export function summaryCameFromWorker(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const { generatedAt, unavailable } = result as { generatedAt?: unknown; unavailable?: unknown }
  return typeof generatedAt === 'string' && generatedAt.length > 0 && !unavailable
}

export function isSectionComplete(section: { truncated?: boolean; itemsTotal?: number; count?: number; items?: unknown[] } | null | undefined): boolean {
  if (!section || section.truncated) return false
  const listed = section.items?.length || 0
  if (Number(section.itemsTotal) > listed) return false
  if (Number(section.count) > listed) return false
  return listed < SECTION_CUT_OFF_ITEMS
}

// A section the Worker leaves out for a reason other than "no items": the admin switched it off in Settings. Its
// remembered alerts must not count as resolved. (A permission the user lacks is not visible here; the memory is per user,
// and a user who loses a permission and gets it back simply sees those alerts as new again.)
const PREFERENCE_FOR_SECTION: Record<string, string> = {
  inventory: 'inventoryEnabled',
  expiry: 'expiryEnabled',
  sales: 'salesEnabled',
  loyalty: 'loyaltyEnabled',
  system: 'systemEnabled',
  supplier_credit: 'supplierCreditEnabled',
}

export function sectionsSwitchedOff(preferences: Record<string, unknown> | null | undefined): Set<string> {
  const off = new Set<string>()
  for (const [section, key] of Object.entries(PREFERENCE_FOR_SECTION)) {
    const value = preferences?.[key]
    if (value === false || value === 0 || value === 'false' || value === '0') off.add(section)
  }
  return off
}

// Only a warning or a danger pops up. Info (a delivery waiting, a submission) and success (points reached) stay in the bell.
export function isAnnounceableTone(tone: unknown): boolean {
  return tone === 'danger' || tone === 'warning'
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

// Latest time per item wins, so a second tab or the desktop and phone bell instances never erase each other.
// On a tie the entry that carries the resolution wins, then the later absence mark.
export function mergeAlertMemory(...memories: AlertMemory[]): AlertMemory {
  const merged: AlertMemory = {}
  for (const memory of memories) {
    for (const [id, entry] of Object.entries(memory)) {
      const have = merged[id]
      if (!have || entry.at > have.at) merged[id] = entry
      else if (entry.at === have.at && (entry.resolved && !have.resolved || (entry.absentSince || 0) > (have.absentSince || 0))) merged[id] = entry
    }
  }
  return merged
}

type AnnounceArgs<T extends AlertCandidate> = {
  rows: Array<AlertRow<T>>
  // Which sections of this summary are listed in full. A section that is absent here changes nothing.
  sections: AlertSectionState[]
  // The summary loaded successfully (not the empty first state). The Worker leaves a section out when it has no items,
  // so then a section the memory knows but the summary lacks is complete and empty. Default false: omitted changes nothing.
  omittedAreEmpty?: boolean
  // Sections the Worker leaves out for another reason (switched off in Settings): never treated as empty.
  switchedOff?: ReadonlySet<string>
  // The panel is open, the bell is not this viewport's, the page is hidden or the summary is unavailable.
  blocked: boolean
  seenTimes: AlertTimes
  skipIds?: ReadonlySet<string>
  now: number
  // How long an alert must stay gone before it counts as resolved (the Settings repeat interval).
  quietMs: number
  store: AlertStore
}

// One summary load. Reads the memory fresh, updates what left a fully listed section, picks what is new to this
// device, writes the memory (before the caller emits anything) and says what to show. A blocked load (panel open,
// page hidden, summary unavailable) changes nothing at all.
export function announceFreshAlerts<T extends AlertCandidate>({ rows, sections, omittedAreEmpty = false, switchedOff, blocked, seenTimes, skipIds = new Set(), now, quietMs, store }: AnnounceArgs<T>): AlertPopupPlan<T> {
  if (blocked) return { kind: 'none' }
  const quiet = quietMs > 0 ? quietMs : RESOLVED_QUIET_FALLBACK_MS
  const stored = store.read()
  const next: AlertMemory = { ...stored }
  let changed = false

  const sectionOf = new Map<string, string>()
  const present = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.item?.id) continue
    if (!sectionOf.has(row.item.id)) sectionOf.set(row.item.id, row.sectionId)
    if (!present.has(row.sectionId)) present.set(row.sectionId, new Set())
    present.get(row.sectionId)?.add(row.item.id)
  }
  const complete = new Set(sections.filter((section) => section.complete).map((section) => section.id))
  if (omittedAreEmpty) {
    const listed = new Set(sections.map((section) => section.id))
    for (const entry of Object.values(stored)) {
      if (entry.section && !listed.has(entry.section) && !switchedOff?.has(entry.section)) complete.add(entry.section)
    }
  }

  // 1. What left a fully listed section: mark it absent, and resolved once it stayed away for the quiet period.
  for (const [id, entry] of Object.entries(stored)) {
    const home = entry.section || sectionOf.get(id)
    if (!entry.section && home) {
      next[id] = { ...entry, section: home }
      changed = true
    }
    if (!home || !complete.has(home) || entry.resolved) continue
    if (present.get(home)?.has(id)) {
      // Back inside the quiet period: it never counted as resolved.
      if (entry.absentSince) { next[id] = { at: entry.at, section: home }; changed = true }
    } else if (!entry.absentSince) {
      next[id] = { ...entry, section: home, absentSince: now }
      changed = true
    } else if (now - entry.absentSince >= quiet) {
      next[id] = { ...entry, section: home, resolved: true }
      changed = true
    }
  }

  // 2. What is new to this device: never announced, or announced and resolved since.
  const fresh: T[] = []
  const taken = new Set<string>()
  for (const { item, sectionId } of rows) {
    if (!item?.id || taken.has(item.id) || skipIds.has(item.id) || !isAnnounceableTone(item.tone)) continue
    const entry = next[item.id]
    if (entry && !entry.resolved) continue
    const seenAt = Number(seenTimes[item.id]) || 0
    if (entry?.resolved) {
      // The bell showed it again after it came back: that counts as seen, it does not pop.
      if (seenAt >= (entry.absentSince || 0)) {
        next[item.id] = { at: now, section: sectionId }
        changed = true
        taken.add(item.id)
        continue
      }
    } else if (seenAt) {
      continue
    }
    taken.add(item.id)
    fresh.push(item)
    next[item.id] = { at: now, section: sectionId }
    changed = true
  }

  if (changed) store.write(trimMemory(next))
  return planAlertPopups(fresh)
}

function trimMemory(memory: AlertMemory): AlertMemory {
  const entries = Object.entries(memory)
  if (entries.length <= ANNOUNCED_ALERT_TIMES_LIMIT) return memory
  // Full: resolved markers go first (oldest first), then unresolved entries oldest first. Keep the best 1000:
  // unresolved before resolved, newest first within each.
  const rank = (entry: AlertEntry) => (entry.resolved ? 0 : 1)
  return Object.fromEntries(entries.sort((a, b) => rank(b[1]) - rank(a[1]) || b[1].at - a[1].at).slice(0, ANNOUNCED_ALERT_TIMES_LIMIT))
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

// Reads both the current entries and the older bare-number memory (item id -> time) that earlier builds wrote.
export function parseAlertMemory(raw: string | null): AlertMemory {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const result: AlertMemory = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' || typeof value === 'string') {
        const at = Number(value)
        if (Number.isFinite(at)) result[id] = { at }
        continue
      }
      if (!value || typeof value !== 'object') continue
      const obj = value as Record<string, unknown>
      const at = Number(obj.at)
      if (!Number.isFinite(at)) continue
      const entry: AlertEntry = { at }
      if (typeof obj.section === 'string' && obj.section) entry.section = obj.section
      if (Number.isFinite(Number(obj.absentSince)) && Number(obj.absentSince) > 0) entry.absentSince = Number(obj.absentSince)
      if (obj.resolved === true) entry.resolved = true
      result[id] = entry
    }
    return result
  } catch (_) {
    return {}
  }
}

// Held in memory too, so a browser that refuses storage still pops an item once per page life, not on every load.
// The memory is the fallback only: while storage works it is the single source (a tab that dropped or resolved an
// item must not be undone by another tab's older copy), and the merge is for storage that refused a write.
const sessionMemory = new Map<string, AlertMemory>()
const unsavedKeys = new Set<string>()

export function browserAlertStore(userId: unknown): AlertStore {
  const key = alertStoreKey(userId)
  return {
    read: () => {
      let stored: AlertMemory | null = null
      try { stored = parseAlertMemory(window.localStorage.getItem(key)) } catch (_) { /* memory below */ }
      if (stored && !unsavedKeys.has(key)) return stored
      return mergeAlertMemory(stored || {}, sessionMemory.get(key) || {})
    },
    write: (memory) => {
      sessionMemory.set(key, memory)
      try {
        window.localStorage.setItem(key, JSON.stringify(memory))
        unsavedKeys.delete(key)
      } catch (_) {
        unsavedKeys.add(key) // kept in memory
      }
    },
  }
}
