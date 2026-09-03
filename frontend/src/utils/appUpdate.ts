import { hasInFlightOnlineSaleSubmission } from '../api/saleWriteTransport.ts'
import { hasDirtyWork } from './dirtyWork.ts'
import { flushPendingWorkDrafts } from './workDrafts.ts'

// P2-9 finding 3. The "a new version is ready" path used to exist only inside
// Sidebar.tsx's account panel: the service worker's
// BUSINESS_OS_APP_UPDATE_AVAILABLE broadcast reached App.tsx's
// useSyncErrorBanner, which stored it in `appUpdate` state and returned it --
// but the consumer never destructured it, so NOTHING was ever rendered. A user
// who never opens the account panel keeps running the stale bundle forever.
//
// This module is the single source of truth for both halves so the toast
// (AppUpdateToast.tsx) and the explicit menu action (Sidebar.tsx) cannot drift:
// the same guard decides whether a reload is safe, the same routine performs
// it, and the same bookkeeping decides whether the user is asked at all.

/** Why an update reload is refused right now, or null when it is safe. */
export type AppUpdateBlocker = 'sale-in-flight' | 'unsaved-work' | null

// The version this client has already observed. Absent means "this is the
// first service worker generation this browser has ever seen here".
const OBSERVED_VERSION_KEY = 'businessos_app_shell_version'
// The version the user explicitly answered "Later" to.
const DISMISSED_VERSION_KEY = 'businessos_app_update_dismissed'

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch (_) {
    return ''
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (_) {
    // Private-mode / quota failures must never break the update path itself.
    // Worst case the prompt is shown once more than strictly necessary.
  }
}

/**
 * Reload safety. Only genuine data-loss risks block; everything that survives
 * a reload on its own deliberately does not, because a permanent block would
 * strand the client on a stale bundle:
 *
 *  - An ONLINE sale submission in flight: the request is aborted by the reload
 *    with no local record of it (saleWriteTransport.ts:40-50). Real loss.
 *  - Registered dirty work (open editors with unsaved changes): iOS does not
 *    reliably show beforeunload, so this is the only guard those forms get.
 *  - The POS cart is NOT a blocker: POS.tsx:596-609 mirrors every open order
 *    into localStorage under `businessos_pos_orders_<user>` precisely so it
 *    survives a reload and an iOS process eviction.
 *  - The offline sync queue is NOT a blocker: it lives in IndexedDB and is
 *    replayed after the reload by the same code that replays it after a cold
 *    start.
 *
 * Checked in this order because a mid-checkout POS page deliberately never
 * registers as dirty work (multi-order carts persist across navigation by
 * design), so the sale check has to come first to be reached at all.
 */
export function getAppUpdateBlocker(): AppUpdateBlocker {
  if (hasInFlightOnlineSaleSubmission()) return 'sale-in-flight'
  if (hasDirtyWork()) return 'unsaved-work'
  return null
}

/**
 * Activate the waiting worker and reload. Returns the blocker instead of
 * reloading when one is present, so callers can explain rather than act --
 * no caller may reload without going through this.
 */
export async function applyAppUpdate(version?: string): Promise<AppUpdateBlocker> {
  const blocker = getAppUpdateBlocker()
  if (blocker === 'unsaved-work') {
    // Give every registered editor a chance to persist its draft before the
    // user is told to save; some of them save silently and stop being dirty.
    flushPendingWorkDrafts()
    const stillBlocked = getAppUpdateBlocker()
    if (stillBlocked) return stillBlocked
  } else if (blocker) {
    return blocker
  }
  flushPendingWorkDrafts()
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.('/')
    await registration?.update?.().catch(() => {})
    let waiting = registration?.waiting || null
    if (!waiting && registration?.installing) {
      const installing = registration.installing
      await new Promise<void>((resolve) => {
        if (installing.state === 'installed') return resolve()
        const timer = window.setTimeout(resolve, 5000)
        installing.addEventListener('statechange', () => {
          if (installing.state !== 'installed') return
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      waiting = registration.waiting
    }
    if (waiting) {
      const changed = new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 1500)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      // Posting to `controller` would target the OLD active worker and do
      // nothing; the waiting one is the only correct target.
      waiting.postMessage({ type: 'BUSINESS_OS_SKIP_WAITING' })
      await changed
    }
  } catch (_) {
    // A failed handshake still warrants the reload: the fresh navigation
    // picks up whatever generation the browser decides to serve.
  }
  // Written immediately before the reload, not on the way in, so an aborted
  // handshake cannot suppress the next prompt for a version never applied.
  if (version) writeStored(OBSERVED_VERSION_KEY, version)
  window.location.reload()
  return null
}

/**
 * Whether this broadcast should raise the toast. Two false-positive loops are
 * suppressed here, both of which the service worker makes unavoidable at the
 * broadcast site:
 *
 *  1. FIRST EVER LOAD. service-worker.ts's `activate` broadcasts
 *     unconditionally, including the very first install where there was no
 *     incumbent worker to be stale against -- a brand-new device would be told
 *     "new version ready" before it had ever run an old one. The first version
 *     this browser observes is recorded silently instead.
 *  2. RE-PROMPT AFTER AN ANSWER. The same version is broadcast twice per
 *     update (once from `install` with waiting:true, once from `activate`), and
 *     a client that has already applied or explicitly deferred that exact
 *     version must not be asked again.
 *
 * A broadcast with no version at all (App.tsx's synthetic fallback detail)
 * still prompts -- running stale code silently is the worse failure -- it just
 * cannot be de-duplicated.
 */
export function shouldPromptForAppUpdate(version: string): boolean {
  const observed = readStored(OBSERVED_VERSION_KEY)
  if (!observed) {
    writeStored(OBSERVED_VERSION_KEY, version || 'unknown')
    return false
  }
  if (!version) return true
  if (observed === version) return false
  if (readStored(DISMISSED_VERSION_KEY) === version) return false
  return true
}

/** Record the user's "Later" so this exact version stops asking. */
export function dismissAppUpdate(version: string): void {
  if (version) writeStored(DISMISSED_VERSION_KEY, version)
}

export const APP_UPDATE_STORAGE_KEYS = {
  observedVersion: OBSERVED_VERSION_KEY,
  dismissedVersion: DISMISSED_VERSION_KEY,
} as const
