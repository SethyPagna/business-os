/** True when the app is running as an INSTALLED app window (an iOS Home
 *  Screen PWA, an installed Android/desktop PWA) rather than in a browser tab.
 *
 *  Why any caller needs this: an installed iOS PWA has no real popup window.
 *  `window.open()` there returns a truthy proxy object while the content is
 *  handed to Safari, so the usual "if (popup) ... else same-tab fallback"
 *  shape takes the popup branch, keeps waiting for a postMessage that can
 *  never arrive from another app, and the flow hangs with no error.
 *
 *  iOS Safari only reports the non-standard `navigator.standalone`; every
 *  other engine reports the display-mode media query. Both accesses are
 *  guarded: `standalone` is absent on most platforms and `matchMedia` is
 *  absent outside a browser (SSR, node tests). */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if ((window.navigator as Navigator & { standalone?: boolean })?.standalone === true) return true
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
  } catch {
    return false
  }
}
