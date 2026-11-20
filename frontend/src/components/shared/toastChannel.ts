// The pop-up channel lives beside AppContext (this folder ships in app-shared), not in src/app/: AppContext raises pop-ups through it, and the storefront shares AppContext, so a module in app-shell would pull that whole chunk into the public closure.
// Pop-up timing. Real alerts (error, warning, a new bell item) stay a full ten seconds so the whole
// sentence can be read; success and info keep the short confirmation time.
export const NOTIFICATION_SUCCESS_MS = 3500
export const NOTIFICATION_ALERT_MS = 10000
export const NOTIFICATION_MAX_VISIBLE = 3

// A caller that passes its own duration keeps it exactly (App.tsx's 6 s and 8 s notices do); only a
// caller that passes none gets the default for its type.
export function getNotificationDuration(type: unknown, explicit?: number): number {
  if (typeof explicit === 'number' && !Number.isNaN(explicit)) return explicit
  return type === 'error' || type === 'warning' ? NOTIFICATION_ALERT_MS : NOTIFICATION_SUCCESS_MS
}

export type ToastRequest = {
  message: string
  type: string
  duration: number
  // Set on a bell-item pop-up: activating it opens the bell on that item.
  onActivate?: () => void
}

// Every pop-up goes through this synchronous channel, not React state: two messages raised in one
// batch (two failed requests) must both reach the screen, which a single state slot cannot do.
type ToastListener = (request: ToastRequest) => void
const toastListeners = new Set<ToastListener>()

// A message raised while nothing is listening (the sign-in screen swapping for the shell, the boot shell)
// is held for its own lifetime and handed to the next listener, as the old single state slot held it.
const heldToasts: Array<{ request: ToastRequest; at: number }> = []

export function subscribeToasts(listener: ToastListener): () => void {
  toastListeners.add(listener)
  const now = Date.now()
  const held = heldToasts.splice(0)
  for (const entry of held) {
    if (now - entry.at < entry.request.duration) listener(entry.request)
  }
  return () => { toastListeners.delete(listener) }
}

export function emitToast(request: ToastRequest): void {
  if (!toastListeners.size) {
    heldToasts.push({ request, at: Date.now() })
    if (heldToasts.length > NOTIFICATION_MAX_VISIBLE) heldToasts.shift()
    return
  }
  for (const listener of [...toastListeners]) listener(request)
}
