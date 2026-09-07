// The mobile two-layer navigation chrome: where the fixed top bar ENDS.
//
// WHY THIS FILE EXISTS
// --------------------
// The compact shell stacks up to two fixed bars at the top of the viewport
// (the app-update bar, then the mobile top bar), and BOTH of them can be
// absent: the update bar only when a new build is waiting, the top bar
// whenever useMobileHeaderAutoHide has hidden it on a scroll-down. Anything
// that has to sit flush under that stack -- App.tsx's <main> padding, and the
// compact pages-mode navigation layer Sidebar.tsx opens from the Back control
// -- therefore needs the SAME four-way answer.
//
// Before this module the answer was written out twice by hand (App.tsx's
// `pt-16 / pt-[calc(4rem+env(...))] / pt-0 / pt-[env(...)]` chain and the
// header's own `top-*`/`h-*` chain) and the navigation layer had no answer at
// all: it was anchored to the BOTTOM of the viewport with `max-h-[70vh]`, so
// its top edge landed wherever its content happened to end. That is the
// reported "considerable gap between the open pages and top bar", and the
// page underneath showing through that gap is the reported "it still shows
// the page i back from". A bottom-anchored sheet cannot be flush with a
// top-anchored bar; only a shared offset can.
//
// Two projections of one measurement:
//   - mobileChromeViewportOffset -- from the top of the VIEWPORT. What a
//     `position: fixed` overlay needs.
//   - mobileChromeContentOffset  -- from the top of #app-root, which already
//     carries the update bar as its own padding. What <main> needs.
// They must differ by exactly the update bar, and navChrome.test.ts asserts
// that relationship against App.tsx's real classes rather than trusting the
// two chains to stay in step by eye.

/** The compact top bar's own height. `h-16` in Sidebar.tsx; the safe-area
 *  inset is carried separately because it is a viewport quantity, not part
 *  of the bar's box. */
export const MOBILE_HEADER_HEIGHT_REM = 4
/** AppUpdateBanner's `min-h-[calc(3rem+env(safe-area-inset-top))]`, which
 *  #app-root mirrors as its own `pt-[calc(3rem+env(safe-area-inset-top))]`. */
export const APP_UPDATE_BAR_HEIGHT_REM = 3

const SAFE_AREA_TOP = 'env(safe-area-inset-top)'

export type MobileChromeState = {
  /** useMobileHeaderAutoHide's answer: false while the bar is translated off. */
  headerVisible: boolean
  /** An update is waiting, so AppUpdateBanner occupies the first band. */
  appUpdateVisible: boolean
}

function offset(rem: number): string {
  return rem > 0 ? `calc(${rem}rem + ${SAFE_AREA_TOP})` : SAFE_AREA_TOP
}

/** Distance from the top of the VIEWPORT to the bottom edge of the fixed
 *  chrome. A fixed overlay given this as its `top` is flush with the bar
 *  above it in all four states -- no band, nothing showing through. */
export function mobileChromeViewportOffset({ headerVisible, appUpdateVisible }: MobileChromeState): string {
  return offset(
    (appUpdateVisible ? APP_UPDATE_BAR_HEIGHT_REM : 0)
    + (headerVisible ? MOBILE_HEADER_HEIGHT_REM : 0),
  )
}

/** The same edge measured from the top of #app-root. When the update bar is
 *  up, #app-root's own padding already accounts for it (bar height AND the
 *  safe area), so the content offset must not count either one twice. */
export function mobileChromeContentOffset({ headerVisible, appUpdateVisible }: MobileChromeState): string {
  const bars = headerVisible ? MOBILE_HEADER_HEIGHT_REM : 0
  if (appUpdateVisible) return bars > 0 ? `${bars}rem` : '0px'
  return offset(bars)
}

/** The compact navigation layer's open state. `expanded` is the page whose
 *  sections are unfolded inside it (mobileHomeTiles' `openId`). */
export type NavLayerState = { open: boolean; expanded: string | null }

/**
 * What the top bar's Back control does.
 *
 * It is a TOGGLE, not an opener. Once the layer covers the page it was opened
 * from (which is the whole point of anchoring it to the top bar), an
 * open-only control leaves no way back to the page without picking a
 * different section -- the scrim that used to serve as "tap outside to
 * dismiss" is exactly the gap that had to go. One control, one affordance,
 * both directions.
 *
 * Opening unfolds the current page's own sections when it has any, so the
 * layer opens showing where you are rather than a cold list.
 */
export function navLayerToggle(current: NavLayerState, page: string, hasSections: boolean): NavLayerState {
  if (current.open) return { open: false, expanded: null }
  return { open: true, expanded: hasSections ? page : null }
}
