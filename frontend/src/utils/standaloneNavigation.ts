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
//   - Knowing which of the two you are in, so neither offer is ever made to
//     somebody already running the installed app.
import { STORAGE_KEYS } from '../constants.ts'
import { isStandaloneDisplayMode } from './standaloneDisplay.ts'

// -- iOS "Add to Home Screen" hint ----------------------------------------

const IOS_INSTALL_HINT_DISMISSED_KEY = `${STORAGE_KEYS.DEVICE_SETTINGS}:ios_install_hint_dismissed_at`
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
    const raw = Number(window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY))
    return Number.isFinite(raw) ? raw : 0
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

/** Idempotent: only the first call attaches listeners. */
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
