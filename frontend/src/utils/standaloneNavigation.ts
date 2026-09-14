// G5/B9 (iOS PWA foolproofing): everything about being -- or becoming -- an
// installed home-screen app that is not React.
//
// The problems here share one question, "is this a browser tab or an
// installed app", answered once by isStandaloneDisplayMode() in
// standaloneDisplay.ts:
//
//   - Getting INTO the installed app. iOS Safari has no beforeinstallprompt
//     event and no programmatic install trigger of any kind -- Share -> Add
//     to Home Screen is the only path, and it has zero discoverability on
//     its own. Android/Chromium fires beforeinstallprompt instead, which
//     this app captured nowhere, so the browser's own mini-infobar was the
//     only offer the user ever got.
//   - Not being STRANDED once inside it. See
//     installStandaloneExternalLinkGuard below.
//   - Knowing which of the two you are in, so neither offer is ever made to
//     somebody already running the installed app.
import { STORAGE_KEYS } from '../constants.ts'
import { isStandaloneDisplayMode } from './standaloneDisplay.ts'

// -- B9: the standalone external-link guard --------------------------------
//
// Installed to a home screen, this app runs in its own window with no browser
// chrome at all -- no back button, no address bar, no tab strip. A
// `target="_blank"` link there opens a SECOND chromeless surface, and on iOS
// the user's only way back to the till is to kill the app and relaunch it
// from the icon. Eight such sites exist today; six are anchors (catalog
// editor, catalog preview, catalog products, catalog secondary tabs, the
// portal embed map-consent fallback, the files responses citations) and none
// of them is worth editing individually: this is one delegated listener for
// all of them, and for every one added later.
//
// WHAT IT DOES AND DELIBERATELY DOES NOT DO:
//
//   - SAME-ORIGIN `_blank` (the public portal preview, a privacy page, an
//     app route): navigated IN PLACE. It is this same app, so the installed
//     window can just go there and the app's own navigation brings the user
//     back. This is the case that strands somebody for no reason at all.
//   - CROSS-ORIGIN (a supplier's site, a Google Maps pin, an uploaded image
//     on another host): left exactly as it is. Those must leave the app
//     whatever happens, and iOS hands them to an in-app browser with a Done
//     control; forcing them into the installed window instead would replace
//     the app with somebody else's page and remove the only way back. The
//     residual "I am now looking at Safari" is unavoidable, not a defect
//     this guard can fix.
//
// It also cannot see a direct `window.open(...)` call, which is not a click
// on an anchor: PortalPromotionsBanner.tsx:159 and LoyaltyPointsPage.tsx:992
// are the remaining two of the eight, and both already hand the URL to the
// browser, which is the behaviour this guard would have chosen for them
// anyway (PortalPromotionsBanner already routes relative links through
// window.location.assign on its own).

/**
 * Whether a click on this anchor is a same-origin new-tab link -- the one
 * case the standalone guard rewrites. Pure, so the decision is testable
 * without a DOM.
 */
export function isSameOriginNewTabLink(href: string, target: string, baseUrl: string): boolean {
  if (String(target || '').toLowerCase() !== '_blank') return false
  try {
    const url = new URL(href, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.origin === new URL(baseUrl).origin
  } catch {
    return false
  }
}

let externalLinkGuardInstalled = false

function handleStandaloneAnchorClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return
  // A download link's whole point is to NOT navigate the window.
  if (anchor.hasAttribute('download')) return
  if (!isSameOriginNewTabLink(anchor.href, anchor.target, window.location.href)) return
  event.preventDefault()
  window.location.assign(anchor.href)
}

/**
 * Installs the document-level click guard. No-op in an ordinary browser tab
 * (where the back button already makes every link reversible) and idempotent
 * -- only the first call attaches a listener, so a re-render can never stack
 * a second one. Returns the teardown its caller's effect cleanup runs, which
 * also clears the installed flag so a remount re-arms it.
 */
export function installStandaloneExternalLinkGuard(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
  if (externalLinkGuardInstalled) return () => {}
  if (!isStandaloneDisplayMode()) return () => {}
  externalLinkGuardInstalled = true
  document.addEventListener('click', handleStandaloneAnchorClick, true)
  return () => {
    if (!externalLinkGuardInstalled) return
    externalLinkGuardInstalled = false
    document.removeEventListener('click', handleStandaloneAnchorClick, true)
  }
}

// -- iOS "Add to Home Screen" hint ----------------------------------------

// DEVICE-scoped on purpose, not account-scoped: shop devices are shared by
// several staff accounts, and "this iPad is already on its home screen" is a
// fact about the iPad, not about whoever is signed in. Re-asking the next
// cashier to install an app that is already installed would be noise. It
// stores a timestamp only -- never anything about a user, a sale or a
// balance -- so nothing leaks between accounts.
//
// `-v1` so a later shape change (say, a count as well as a timestamp) can be
// migrated instead of misread; an old or malformed value is silently treated
// as "never dismissed" by readIosInstallHintDismissedAt below.
const IOS_INSTALL_HINT_DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:ios-install-hint-dismissed-at-v1`
/** A dismissal is a "not now", not a "never": the hint returns after this. */
export const IOS_INSTALL_HINT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPod|iPad/.test(userAgent)) return true
  // iPadOS 13+ dropped the "iPad" UA token and reports as "Macintosh". Touch
  // points are what separate it from a real Mac, which must never see this.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

function isIosSafariBrowser(userAgent: string): boolean {
  // Chrome/Firefox/Edge/Opera for iOS embed Safari's engine but ship their
  // own UA token, and none of them can Add to Home Screen the way this hint
  // describes -- telling their users to tap Share would be wrong directions.
  return /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
}

/**
 * Whether the iOS Share -> Add to Home Screen hint should be offered right
 * now: a real iOS device, in Mobile Safari, not already running the installed
 * app, and not dismissed within the last IOS_INSTALL_HINT_SNOOZE_MS.
 */
export function shouldOfferIosInstallHint(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (isStandaloneDisplayMode()) return false
  const userAgent = navigator.userAgent || ''
  if (!isIosDevice(userAgent, Number(navigator.maxTouchPoints) || 0)) return false
  if (!isIosSafariBrowser(userAgent)) return false
  return readIosInstallHintDismissedAt() + IOS_INSTALL_HINT_SNOOZE_MS <= Date.now()
}

function readIosInstallHintDismissedAt(): number {
  try {
    const stored = window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY)
    const raw = Number(stored)
    // A value written by an older/other shape (an object, '1', '') is not a
    // usable timestamp. Fall back silently to "never dismissed" rather than
    // trusting a number that means something else.
    if (!stored || !Number.isFinite(raw) || raw <= 0) return 0
    return raw
  } catch {
    // Private mode / blocked storage: treat as never dismissed. Showing the
    // hint again is a much smaller cost than never showing it at all.
    return 0
  }
}

/** Snoozes the iOS hint for IOS_INSTALL_HINT_SNOOZE_MS from now. */
export function dismissIosInstallHint(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, String(Date.now()))
  } catch {
    // Same reasoning as the read above: a device that cannot remember the
    // dismissal gets asked again rather than failing loudly at the user.
  }
}

// -- Android/Chromium beforeinstallprompt capture ---------------------------
//
// Chrome/Edge/Samsung Internet fire this once the page qualifies as
// installable. preventDefault() suppresses the browser's own mini-infobar and
// keeps the event alive so a control this app owns can replay it. The event is
// single-use (prompt() throws the second time) and browser-held: `appinstalled`
// and a reload both invalidate it, so the reference is dropped in both cases
// rather than cached past its lifetime.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const INSTALL_PROMPT_AVAILABLE_EVENT = 'businessos:install-prompt-available'

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null
let installCaptureInstalled = false

function handleBeforeInstallPrompt(event: Event): void {
  event.preventDefault()
  deferredInstallPrompt = event as BeforeInstallPromptEvent
  window.dispatchEvent(new Event(INSTALL_PROMPT_AVAILABLE_EVENT))
}

function handleAppInstalled(): void {
  deferredInstallPrompt = null
}

/**
 * Idempotent: only the first call attaches listeners, so a re-render cannot
 * stack a second pair. Returns the teardown its caller's effect cleanup runs;
 * the captured prompt itself is module state and deliberately survives it, so
 * a remount finds the event that already fired instead of losing it.
 */
export function installBeforeInstallPromptCapture(): () => void {
  if (typeof window === 'undefined' || installCaptureInstalled) return () => {}
  installCaptureInstalled = true
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)
  return () => {
    if (!installCaptureInstalled) return
    installCaptureInstalled = false
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', handleAppInstalled)
  }
}

/** Subscribe to the moment a deferred prompt appears. Returns an unsubscribe. */
export function onInstallPromptAvailable(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, listener)
  return () => window.removeEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, listener)
}

export function hasDeferredInstallPrompt(): boolean {
  return deferredInstallPrompt != null
}

/**
 * Whether the device is one the owner wants an install affordance on at all.
 *
 * beforeinstallprompt fires on DESKTOP Chrome too, and a desktop till is not
 * what "make iOS PWA foolproof" is about -- the install band is for phones
 * and tablets only.
 */
export function isHandheldInstallTarget(): boolean {
  if (typeof navigator === 'undefined') return false
  const userAgent = navigator.userAgent || ''
  if (/Android|iPhone|iPod|iPad|Mobile/i.test(userAgent)) return true
  return isIosDevice(userAgent, Number(navigator.maxTouchPoints) || 0)
}

/** Replays the captured prompt. Resolves true only if the user accepted. */
export async function promptAppInstall(): Promise<boolean> {
  const event = deferredInstallPrompt
  if (!event) return false
  // Cleared BEFORE awaiting: the event is spent the moment prompt() is
  // called, so a second click while the native sheet is open must not find
  // a reference it would only throw on.
  deferredInstallPrompt = null
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice?.outcome === 'accepted'
  } catch {
    return false
  }
}
