import { hasDirtyWork } from './dirtyWork.ts'
import { flushPendingWorkDrafts } from './workDrafts.ts'

export type RestartAppResult = 'blocked' | 'reloading'

type RestartAppOptions = {
  unsavedWorkMessage?: string
}

type UnsavedWorkNotice = (message: string) => void

let unsavedWorkNotice: UnsavedWorkNotice | null = null
let restartInFlight: Promise<RestartAppResult> | null = null
const OPTIONAL_APP_OPERATION_TIMEOUT_MS = 5000

export function optionalAppOperation<T>(operation: () => Promise<T> | T): Promise<T | undefined> {
  return new Promise((resolve) => {
    const finish = (value?: T) => {
      window.clearTimeout(timer)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(), OPTIONAL_APP_OPERATION_TIMEOUT_MS)
    Promise.resolve().then(operation).then(finish, () => finish())
  })
}

function waitForWorkerEvent(target: EventTarget, event: string, ready: (() => boolean) | null, timeout: number, start?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      window.clearTimeout(timer)
      target.removeEventListener(event, changed)
      resolve()
    }
    const changed = () => { if (!ready || ready()) finish() }
    const timer = window.setTimeout(finish, timeout)
    try {
      target.addEventListener(event, changed)
      start?.()
      if (ready) changed()
    } catch (error) {
      window.clearTimeout(timer)
      target.removeEventListener(event, changed)
      reject(error)
    }
  })
}

// Both restart callers use the shell's non-blocking notice; a native alert
// would freeze the installed PWA. Pass null to unregister.
export function setAppUpdateUnsavedWorkNotice(notice: UnsavedWorkNotice | null): void {
  unsavedWorkNotice = notice
}

function refuseDirtyRestart(options: RestartAppOptions): boolean {
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
    return true
  }
  return false
}

export function restartIntoLatestApp(options: RestartAppOptions = {}): Promise<RestartAppResult> {
  if (typeof window === 'undefined') return Promise.resolve('blocked')
  if (restartInFlight) return restartInFlight
  restartInFlight = restart(options).then((result) => {
    // Keep successful ownership until navigation; a second caller must not reload twice.
    if (result === 'blocked') restartInFlight = null
    return result
  }, (error) => {
    restartInFlight = null
    console.warn('[app-update] restart failed', error)
    return 'blocked'
  })
  return restartInFlight
}

async function restart(options: RestartAppOptions): Promise<RestartAppResult> {
  if (refuseDirtyRestart(options)) return 'blocked'

  flushPendingWorkDrafts()
  try {
    const registration = await optionalAppOperation(() => navigator.serviceWorker?.getRegistration?.('/'))
    await optionalAppOperation(() => registration?.update?.())

    let waiting = registration?.waiting || null
    if (!waiting && registration?.installing) {
      const installing = registration.installing
      await waitForWorkerEvent(installing, 'statechange', () => installing.state === 'installed' || installing.state === 'redundant', 5000)
      waiting = registration.waiting
    }

    if (waiting) {
      if (refuseDirtyRestart(options)) return 'blocked'
      await waitForWorkerEvent(navigator.serviceWorker, 'controllerchange', null, 1500,
        () => waiting.postMessage({ type: 'BUSINESS_OS_SKIP_WAITING' }))
    }
  } catch {
    // Reload still performs a network-first update when service workers are
    // unavailable or the browser refuses an explicit registration check.
  }

  if (refuseDirtyRestart(options)) return 'blocked'
  flushPendingWorkDrafts()
  window.location.reload()
  return 'reloading'
}
