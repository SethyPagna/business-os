// The sign-in screen that waits for an administrator to approve this device
// asks the Worker whether the decision has been made, so the person does not
// have to keep tapping "Check again". It runs at most DEVICE_WAIT_LIMIT_MS,
// stops the moment the screen goes away (stop() on unmount), and only reads a
// status: signing in is still a separate, explicit step in the caller.

export const DEVICE_WAIT_INTERVAL_MS = 10_000
export const DEVICE_WAIT_LIMIT_MS = 10 * 60 * 1000

export type DeviceWaitStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'missing'
export type DeviceWaitStop = 'rejected' | 'expired' | 'timeout'

type DeviceWaitOptions = {
  fetchStatus: () => Promise<DeviceWaitStatus | string | null | undefined>
  onApproved: () => void
  onStopped: (reason: DeviceWaitStop) => void
  intervalMs?: number
  limitMs?: number
  now?: () => number
  schedule?: (callback: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

export function startDeviceApprovalWait(options: DeviceWaitOptions): () => void {
  const intervalMs = options.intervalMs ?? DEVICE_WAIT_INTERVAL_MS
  const limitMs = options.limitMs ?? DEVICE_WAIT_LIMIT_MS
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms))
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const startedAt = now()
  let stopped = false
  let handle: unknown = null

  const finish = (): void => {
    stopped = true
    if (handle != null) cancel(handle)
    handle = null
  }

  const tick = async (): Promise<void> => {
    handle = null
    if (stopped) return
    if (now() - startedAt >= limitMs) {
      finish()
      options.onStopped('timeout')
      return
    }
    let status: string | null | undefined
    try {
      status = await options.fetchStatus()
    } catch (_) {
      status = 'pending'
    }
    if (stopped) return
    if (status === 'approved') {
      finish()
      options.onApproved()
      return
    }
    if (status === 'rejected') {
      finish()
      options.onStopped('rejected')
      return
    }
    if (status === 'expired' || status === 'missing') {
      finish()
      options.onStopped('expired')
      return
    }
    handle = schedule(() => { void tick() }, intervalMs)
  }

  handle = schedule(() => { void tick() }, intervalMs)
  return finish
}
