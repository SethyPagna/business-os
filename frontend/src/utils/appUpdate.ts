import { hasDirtyWork } from './dirtyWork.ts'
import { flushPendingWorkDrafts } from './workDrafts.ts'

export type RestartAppResult = 'blocked' | 'reloading'

type RestartAppOptions = {
  unsavedWorkMessage?: string
}

/**
 * Activate the newest installed app shell and reload without risking
 * unfinished editor work. Both the global update bar and the sidebar's
 * manual update action use this one path so their safety behavior cannot
 * drift apart.
 */
export async function restartIntoLatestApp(options: RestartAppOptions = {}): Promise<RestartAppResult> {
  if (typeof window === 'undefined') return 'blocked'

  if (hasDirtyWork()) {
    flushPendingWorkDrafts()
    window.alert(
      options.unsavedWorkMessage
        || 'Save or discard your unfinished work before updating the app.',
    )
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
