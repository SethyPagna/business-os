// Mobile section-navigation preference: "pages" (default -- the mobile
// three-layer nav: main menu -> section cards -> full-screen section) or
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

function normalizeMode(value: unknown): MobileSectionNavMode | null {
  return value === 'pages' || value === 'sections' ? value : null
}

export function readMobileSectionNavMode(accountValue?: unknown): MobileSectionNavMode {
  if (typeof window !== 'undefined') {
    try {
      const stored = normalizeMode(window.localStorage.getItem(MOBILE_SECTION_NAV_STORAGE_KEY))
      if (stored) return stored
    } catch {
      // Private-mode / storage-disabled: fall through to the account value.
    }
  }
  return normalizeMode(accountValue) || DEFAULT_MOBILE_SECTION_NAV_MODE
}

export function writeMobileSectionNavMode(mode: MobileSectionNavMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MOBILE_SECTION_NAV_STORAGE_KEY, mode)
  } catch {
    // Ignore private-mode storage failures -- the in-memory preference for
    // this session still works, it just won't survive a reload.
  }
}
