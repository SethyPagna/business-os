// Section 8b (PWA/iOS): standalone-display-mode navigation safeguard.
//
// Once installed to a home screen, this app runs in its own window with no
// browser chrome -- no back/forward, no address bar, no "open in new tab".
// A link to an external site (a supplier's website, a Google Maps pin, a
// social/WhatsApp share link) that navigates that SAME window strands the
// user: the installed app is gone, replaced by someone else's page, with no
// visible way back to Business OS short of relaunching from the home
// screen icon. In an ordinary browser tab this is a non-issue (the back
// button and the tab strip make it reversible), so this guard only
// installs itself when the display mode is actually standalone.
//
// The fix is universal at the click-delegation level rather than per-link:
// walk up from the click target to the nearest <a>, and if its resolved
// href is a different origin, open it in the system browser (window.open,
// which standalone PWA shells hand off to the OS) instead of letting the
// default navigation replace this window. Same-origin links -- the entire
// app -- are left completely alone.
import { STORAGE_KEYS } from '../../constants.ts'

const IOS_INSTALL_HINT_DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:ios_install_hint_dismissed`

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch (_) {}
  // iOS Safari never implemented the display-mode media query for its home
  // screen web apps -- this vendor-prefixed boolean on navigator is the only
  // way to detect it there.
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

function resolveAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('a[href]')
}

function isExternalHttpLink(anchor: HTMLAnchorElement): boolean {
  try {
    const url = new URL(anchor.href, window.location.href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.origin !== window.location.origin
  } catch (_) {
    return false
  }
}

let guardInstalled = false

/**
 * Installs a document-level click guard that hands cross-origin http(s)
 * links to the system browser instead of navigating the installed PWA
 * window away. No-op outside standalone display mode, and idempotent (safe
 * to call more than once -- only the first call attaches a listener).
 */
export function installStandaloneExternalLinkGuard(): void {
  if (typeof document === 'undefined' || guardInstalled) return
  if (!isStandaloneDisplayMode()) return
  guardInstalled = true
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = resolveAnchor(event.target)
    if (!anchor || !isExternalHttpLink(anchor)) return
    event.preventDefault()
    window.open(anchor.href, '_blank', 'noopener,noreferrer')
  }, true)
}

// -- iOS "Add to Home Screen" install hint ---------------------------------
//
// Android/desktop Chrome exposes a native beforeinstallprompt event this app
// can hook a real "Install" button to. iOS Safari has never implemented
// that event -- the ONLY way onto a home screen there is the user manually
// opening the Share sheet and tapping "Add to Home Screen", a flow with no
// programmatic trigger and no discoverability of its own. This hint exists
// to surface that manual path once, for iOS Safari visitors who are not
// already running the installed app.

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports as "Macintosh" with touch support enabled -- the
  // classic iPad UA substring is gone, so a real Mac (no touch points) is
  // the only thing this second check could otherwise misclassify.
  if (/iPad/.test(ua)) return true
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}

function isIosSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // Other iOS browsers (Chrome/Firefox/Edge for iOS) embed Safari's engine
  // but ship their own UA token and cannot install to the home screen via
  // Share -> Add to Home Screen the same way -- only Mobile Safari can.
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

/** Whether the one-time iOS "Add to Home Screen" hint should be offered. */
export function shouldOfferIosInstallHint(): boolean {
  if (typeof window === 'undefined') return false
  if (isStandaloneDisplayMode()) return false
  if (!isIosDevice() || !isIosSafariBrowser()) return false
  try {
    return window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) !== '1'
  } catch (_) {
    return false
  }
}

/** Persists that the hint was seen/dismissed -- never shown again on this device. */
export function dismissIosInstallHint(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, '1')
  } catch (_) {}
}

// -- Android/desktop "beforeinstallprompt" capture --------------------------
//
// Chrome/Edge/Samsung Internet fire this event once the browser decides the
// page qualifies as installable (valid manifest, registered service worker,
// served over https). Calling preventDefault() suppresses the browser's own
// mini-infobar and keeps the event alive so it can be replayed later from a
// UI control this app owns instead -- the same banner IosInstallHint.tsx
// already renders for iOS. The event is single-use (`.prompt()` throws if
// called twice) and browser-held, not ours: `appinstalled` (fired on
// success) and losing the tab/reload both invalidate it, so the reference is
// dropped in both cases rather than cached beyond that lifetime.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const INSTALL_PROMPT_AVAILABLE_EVENT = 'businessos:install-prompt-available'

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null
let installCaptureInstalled = false

export function installBeforeInstallPromptCapture(): void {
  if (typeof window === 'undefined' || installCaptureInstalled) return
  installCaptureInstalled = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredInstallPrompt = event as BeforeInstallPromptEvent
    window.dispatchEvent(new Event(INSTALL_PROMPT_AVAILABLE_EVENT))
  })
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
  })
}

/** Subscribe to the moment a deferred install prompt becomes available. Returns an unsubscribe fn. */
export function onInstallPromptAvailable(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, listener)
  return () => window.removeEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, listener)
}

export function hasDeferredInstallPrompt(): boolean {
  return deferredInstallPrompt != null
}

/** Replays the captured prompt. Resolves true only if the user accepted it. */
export async function promptAppInstall(): Promise<boolean> {
  const event = deferredInstallPrompt
  if (!event) return false
  deferredInstallPrompt = null
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice?.outcome === 'accepted'
  } catch (_) {
    return false
  }
}
