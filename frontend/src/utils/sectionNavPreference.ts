import { useSyncExternalStore } from 'react'
import { useIsCompactViewport } from './useViewport.ts'

// Mobile section-navigation preference: "pages" (inline groups -> section body) or
// "sections" (today's chip row, kept on mobile too). See
// components/shared/HubSectionNav.tsx for where this is consumed and
// components/utils-settings/Settings.tsx's "Navigation Layout" block for
// the control that writes it.
//
// Two-tier persistence, same pattern as the rest of this app's `bos:`
// localStorage keys layered on top of the generic settings API:
//   - localStorage (`bos:ui:mobile-section-nav`) is the instant, per-device
//     value -- read synchronously, so toggling it in Settings takes effect
//     immediately without waiting for a save round-trip.
//   - the account-level setting (`ui_mobile_section_nav`, persisted through
//     the same generic `settings` mechanism as `ui_nav_order` /
//     `ui_mobile_pinned` in Settings.tsx) is the value a NEW device should
//     start from, so the preference follows the account instead of only
//     ever defaulting to "pages" on a fresh phone.
export type MobileSectionNavMode = 'pages' | 'sections'

export const MOBILE_SECTION_NAV_STORAGE_KEY = 'bos:ui:mobile-section-nav'
export const MOBILE_SECTION_NAV_SETTINGS_KEY = 'ui_mobile_section_nav'
export const DEFAULT_MOBILE_SECTION_NAV_MODE: MobileSectionNavMode = 'pages'

let sessionMode: MobileSectionNavMode | null = null
const PREFERENCE_EVENT = 'bos:mobile-section-nav'

function normalizeMode(value: unknown): MobileSectionNavMode | null {
  return value === 'pages' || value === 'sections' ? value : null
}

export function readMobileSectionNavMode(accountValue?: unknown): MobileSectionNavMode {
  if (typeof window !== 'undefined') {
    if (sessionMode) return sessionMode
    try {
      const stored = normalizeMode(window.localStorage.getItem(MOBILE_SECTION_NAV_STORAGE_KEY))
      if (stored) return stored
    } catch {
      // The account/default value remains available when reads are blocked.
    }
  }
  return normalizeMode(accountValue) || DEFAULT_MOBILE_SECTION_NAV_MODE
}

export function writeMobileSectionNavMode(mode: MobileSectionNavMode): void {
  if (typeof window === 'undefined') return
  sessionMode = mode
  try {
    window.localStorage.setItem(MOBILE_SECTION_NAV_STORAGE_KEY, mode)
  } catch {
    // Ignore private-mode storage failures -- the in-memory preference for
    // this session still works, it just won't survive a reload.
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT))
}

export function subscribeMobileSectionNavMode(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const storage = (event: StorageEvent) => {
    if (event.key === MOBILE_SECTION_NAV_STORAGE_KEY || event.key === null) {
      sessionMode = null
      notify()
    }
  }
  window.addEventListener(PREFERENCE_EVENT, notify)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, notify)
    window.removeEventListener('storage', storage)
  }
}

export function useMobileSectionNavMode(accountValue?: unknown): MobileSectionNavMode {
  return useSyncExternalStore(
    subscribeMobileSectionNavMode,
    () => readMobileSectionNavMode(accountValue),
    () => normalizeMode(accountValue) || DEFAULT_MOBILE_SECTION_NAV_MODE,
  )
}

/** True when the compact home sheet owns section switching, so a page must
 *  NOT also draw its own section row (compact viewport + "pages" mode). One
 *  authority for that decision: HubSectionNav's `layered` branch and every
 *  page that keeps a hand-placed section row (Products) read it from here. */
export function useLayeredSectionNav(accountValue?: unknown): boolean {
  const isCompact = useIsCompactViewport()
  const mode = useMobileSectionNavMode(accountValue)
  return isCompact && mode === 'pages'
}
