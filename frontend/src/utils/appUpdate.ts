import { hasDirtyWork } from './dirtyWork.ts'
import { flushPendingWorkDrafts } from './workDrafts.ts'

export type RestartAppResult = 'blocked' | 'reloading'

type RestartAppOptions = {
  unsavedWorkMessage?: string
}

type UnsavedWorkNotice = (message: string) => void

let unsavedWorkNotice: UnsavedWorkNotice | null = null

/**
 * G10: where the "you still have unfinished work" refusal is shown.
 *
 * This used to be window.alert(), which is the one dialog in the app that
 * freezes the whole tab until it is acknowledged -- on an installed iOS PWA
 * it is a system sheet over a chromeless window, it stops the render loop,
 * and it is exactly the inconsistent native popup this project replaced
 * everywhere else with its own notice/confirm surfaces. This module is a
 * plain util with no React, so the shell registers its own non-blocking
 * notice here once at mount and BOTH callers of restartIntoLatestApp (the
 * update bar in App.tsx and the sidebar's manual update action, which this
 * lane does not edit) get it without either of them changing.
 *
 * Pass null to unregister.
 */
export function setAppUpdateUnsavedWorkNotice(notice: UnsavedWorkNotice | null): void {
  unsavedWorkNotice = notice
}

/**
 * Activate the newest installed app shell and reload without risking
 * unfinished editor work. Both the global update bar and the sidebar's
 * manual update action use this one path so their safety behavior cannot
 * drift apart.
 */
export async function restartIntoLatestApp(options: RestartAppOptions = {}): Promise<RestartAppResult> {
  if (typeof window === 'undefined') return 'blocked'

  // The guard itself is unchanged: a restart still REFUSES while there is
  // unfinished work, and still flushes the drafts it can before saying so.
  // Only how the refusal reaches the user changed (see the notice above).
  if (hasDirtyWork()) {
    flushPendingWorkDrafts()
    const message = options.unsavedWorkMessage
      || 'Save or discard your unfinished work before updating the app.'
    if (unsavedWorkNotice) {
      unsavedWorkNotice(message)
    } else {
      // Never silent: a refusal the user cannot see reads as a dead button.
      console.warn(`[app-update] restart blocked: ${message}`)
    }
    return 'blocked'
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
      waiting.postMessage({ type: 'BUSINESS_OS_SKIP_WAITING' })
      await changed
    }
  } catch {
    // Reload still performs a network-first update when service workers are
    // unavailable or the browser refuses an explicit registration check.
  }

  window.location.reload()
  return 'reloading'
}
