// Being, or becoming, an installed home-screen app, outside React. "Browser tab or
// installed app" is answered once, by isStandaloneDisplayMode() (standaloneDisplay.ts).
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

export type InstallRoute = 'native-prompt' | 'ios-share'

// Device-scoped, not account-scoped: a shared till is installed, or its bar
// closed, whoever is signed in. Timestamps only, so nothing leaks between accounts.
const INSTALL_BAND_DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:install-offer-dismissed-at-v2`
const LEGACY_IOS_HINT_DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:ios-install-hint-dismissed-at-v1`
const APP_INSTALLED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:app-installed-at-v1`

/** clientRuntime.ts spells these out in its logout preserve list; installOffer.test.ts keeps the two in step. */
export const INSTALL_OFFER_DEVICE_KEYS = [INSTALL_BAND_DISMISSED_KEY, LEGACY_IOS_HINT_DISMISSED_KEY, APP_INSTALLED_KEY] as const

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

function isHandheldInstallTarget(): boolean {
  if (typeof navigator === 'undefined') return false
  const userAgent = navigator.userAgent || ''
  if (/Android|iPhone|iPod|iPad|Mobile/i.test(userAgent)) return true
  return isIosDevice(userAgent, Number(navigator.maxTouchPoints) || 0)
}

function readDeviceTimestamp(key: string): number {
  try {
    const stored = Number(window.localStorage.getItem(key))
    return Number.isFinite(stored) && stored > 0 ? stored : 0
  } catch {
    return 0
  }
}

function rememberOnDevice(key: string): void {
  try {
    window.localStorage.setItem(key, String(Date.now()))
  } catch {
    // Blocked storage: the in-page state still applies; the next visit asks again.
  }
}

function forgetOnDevice(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Blocked storage has nothing to forget.
  }
}

// preventDefault() suppresses the browser's own mini-infobar and keeps the
// event so a control this app owns can replay it. The event is single-use and
// browser-held: `appinstalled` and a reload both invalidate it.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null
let installCaptureInstalled = false
let installBandDismissedThisPage = false
const installOfferListeners = new Set<() => void>()

function notifyInstallOffer(): void {
  for (const listener of installOfferListeners) listener()
}

/** For useSyncExternalStore: every change to either route calls the listener. */
export function subscribeInstallOffer(listener: () => void): () => void {
  installOfferListeners.add(listener)
  return () => { installOfferListeners.delete(listener) }
}

function recordAppInstalled(): void {
  deferredInstallPrompt = null
  rememberOnDevice(APP_INSTALLED_KEY)
  notifyInstallOffer()
}

function handleBeforeInstallPrompt(event: Event): void {
  event.preventDefault()
  deferredInstallPrompt = event as BeforeInstallPromptEvent
  // Chromium fires this only while the app is not installed, so an older install record is stale.
  forgetOnDevice(APP_INSTALLED_KEY)
  notifyInstallOffer()
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
  window.addEventListener('appinstalled', recordAppInstalled)
  return () => {
    if (!installCaptureInstalled) return
    installCaptureInstalled = false
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', recordAppInstalled)
  }
}

/** The account-menu entry: any device that can install now, desktops included (owner default). */
export function installMenuRoute(): InstallRoute | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null
  if (isStandaloneDisplayMode() || readDeviceTimestamp(APP_INSTALLED_KEY) > 0) return null
  if (deferredInstallPrompt) return 'native-prompt'
  const userAgent = navigator.userAgent || ''
  return isIosDevice(userAgent, Number(navigator.maxTouchPoints) || 0) && isIosSafariBrowser(userAgent) ? 'ios-share' : null
}

/** The band: phones and tablets only, and never again on a device where it was closed (owner default, 28 Sep 2026). */
export function installBandRoute(): InstallRoute | null {
  if (!isHandheldInstallTarget() || isInstallBandDismissed()) return null
  return installMenuRoute()
}

function isInstallBandDismissed(): boolean {
  return installBandDismissedThisPage
    || readDeviceTimestamp(INSTALL_BAND_DISMISSED_KEY) > 0
    || readDeviceTimestamp(LEGACY_IOS_HINT_DISMISSED_KEY) > 0
}

export function dismissInstallBand(): void {
  installBandDismissedThisPage = true
  rememberOnDevice(INSTALL_BAND_DISMISSED_KEY)
  notifyInstallOffer()
}

/** Replays the captured prompt. Resolves true only if the user accepted. */
export async function promptAppInstall(): Promise<boolean> {
  const event = deferredInstallPrompt
  if (!event) return false
  // Spent the moment prompt() is called: a second click while the native sheet is open must find nothing.
  deferredInstallPrompt = null
  notifyInstallOffer()
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice?.outcome !== 'accepted') return false
    recordAppInstalled()
    return true
  } catch {
    return false
  }
}
