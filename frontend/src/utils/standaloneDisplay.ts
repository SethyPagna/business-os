// Whether this app is running as an installed home-screen app rather than in
// an ordinary browser tab.
//
// TWO signals are required, not one. iOS Safari never implemented the
// `display-mode` media query for its home-screen web apps and exposes only
// the legacy `navigator.standalone` boolean; Android/desktop expose only the
// media query. Checking either one alone reports "browser tab" on half the
// devices this app runs on.
//
// Fully guarded: this is called during boot, and matchMedia is missing in
// non-browser environments and on a few embedded engines.
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean }
    if (nav?.standalone === true) return true
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
  } catch {
    return false
  }
}
