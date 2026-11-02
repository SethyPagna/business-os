// The announcement bar (owner, 2 Nov 2026): one short message above the storefront header, English and Khmer, with an
// optional link, an on/off switch and an optional first and last day. The Worker publishes it inside the one cached
// public config (cloudflare lib/portalText.ts portalAnnouncementConfig); everything about "now" is decided here, in
// the visitor's browser, by comparing the shop's day (Asia/Phnom_Penh) with those two days, so no cache is time-keyed.

/** The visitor's answer to the bar, kept per browser so a closed message stays closed on every later visit. */
export const PORTAL_ANNOUNCEMENT_STORAGE_KEY = 'business-os-portal-announcement-v1'
export const PORTAL_ANNOUNCEMENT_MAX_LENGTH = 200

type PortalAnnouncementSource = {
  announcementEnabled?: unknown
  announcementTextEn?: unknown
  announcementTextKm?: unknown
  announcementLink?: unknown
  announcementStart?: unknown
  announcementEnd?: unknown
  announcementVersion?: unknown
}

export type PortalAnnouncement = {
  text: string
  /** The language the shown text is written in, so a Khmer message is typeset as Khmer on an English page. */
  textLanguage: 'en' | 'km'
  /** An absolute http(s) URL, or '' for a message with no link. */
  link: string
  /** Changes when the message or its link changes; the key a closed bar is remembered by. */
  version: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// Same rule as the Worker (cloudflare lib/portalText.ts normalizePortalAnnouncementLink). Not utils/safeLinkUrl.ts: that file
// sits in the catalog-products chunk, and this one is shared core, so importing it would close a chunk cycle.
const LINK_MAX_LENGTH = 500
const LINK_UNSAFE = /[\p{Cc}\p{Cf}\s\\]/u

/** An absolute http(s) URL with no credentials and nothing else (the Worker refuses the rest on save; this is the second check at the click). */
export function portalAnnouncementLink(value: unknown): string {
  if (typeof value !== 'string') return ''
  const link = value.trim()
  if (!link || link.length > LINK_MAX_LENGTH || LINK_UNSAFE.test(link) || !/^https?:\/\//i.test(link)) return ''
  try {
    const url = new URL(link)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password ? link : ''
  } catch {
    return ''
  }
}

/** True when `today` (YYYY-MM-DD, the shop's day) is inside the optional first/last day, both ends included. */
export function portalAnnouncementInWindow(start: unknown, end: unknown, today: string): boolean {
  const first = DAY.test(text(start)) ? text(start) : ''
  const last = DAY.test(text(end)) ? text(end) : ''
  if (first && today < first) return false
  if (last && today > last) return false
  return true
}

/** What the Website Editor flags under the fields (the Worker refuses the same values on save). */
export function portalAnnouncementIssues(draft: { link?: unknown; start?: unknown; end?: unknown }): { link: boolean; range: boolean } {
  const link = text(draft.link)
  const start = text(draft.start)
  const end = text(draft.end)
  return { link: Boolean(link) && !portalAnnouncementLink(link), range: DAY.test(start) && DAY.test(end) && end < start }
}

/**
 * The bar to show for this page language, or null. Khmer pages show the Khmer message and fall back to the English one
 * (and the other way round) so a shop that wrote only one language still shows its message.
 * `ignoreDays` is the Website Editor preview: the owner sees the message while typing, whatever the days say.
 */
export function resolvePortalAnnouncement(source: PortalAnnouncementSource, language: string, today: string, options: { ignoreDays?: boolean } = {}): PortalAnnouncement | null {
  if (source.announcementEnabled !== true) return null
  const english = text(source.announcementTextEn)
  const khmer = text(source.announcementTextKm)
  const useKhmer = language === 'km' ? Boolean(khmer) : !english
  const shown = useKhmer ? khmer : english
  if (!shown) return null
  if (!options.ignoreDays && !portalAnnouncementInWindow(source.announcementStart, source.announcementEnd, today)) return null
  const link = portalAnnouncementLink(source.announcementLink)
  const version = text(source.announcementVersion) || `${english}\u0001${khmer}\u0001${link}`
  return { text: shown, textLanguage: useKhmer ? 'km' : 'en', link, version }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** The version of the message this browser closed ('' when none, or when storage is blocked). */
export function readDismissedPortalAnnouncement(storage: StorageLike | null = browserStorage()): string {
  try {
    return storage?.getItem(PORTAL_ANNOUNCEMENT_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/** Remembers the closed message; a blocked storage only means it comes back on the next visit. */
export function dismissPortalAnnouncement(version: string, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(PORTAL_ANNOUNCEMENT_STORAGE_KEY, version)
  } catch {
    // The bar is already hidden for this page view by the caller's state.
  }
}
