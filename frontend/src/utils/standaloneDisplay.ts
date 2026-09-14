/**
 * Is this document running as an INSTALLED app (iOS "Add to Home Screen",
 * Android/desktop PWA install) rather than inside a browser tab?
 *
 * iOS is why this exists. A standalone iOS PWA has no address bar and no popup
 * setting, and `window.open` there either returns null or hands the new
 * document to Safari in a different context -- so any flow built on a second
 * window (printing, previews) is dead on arrival and has to take a
 * same-document path instead. `navigator.standalone` is the iOS-only signal;
 * the display-mode media query covers every other installed surface.
 */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean })?.standalone
  if (iosStandalone === true) return true
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
  } catch {
    // Very old WebViews throw on an unknown media feature rather than
    // reporting no match; a throw here must never break the caller.
    return false
  }
}
