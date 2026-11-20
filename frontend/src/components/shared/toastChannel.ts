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

export type StackToast = ToastRequest & { key: string }

// The visible pop-ups and every clock live here, at module level, not in a component: App draws the stack from a
// different <Notification> on each screen (boot, sign-in, forced password change, shell), and a screen swap must
// neither drop a message nor restart its clock. Whichever <Notification> is mounted draws this same list.
// Every pop-up goes through this synchronous channel, not React state: two messages raised in one batch (two
// failed requests) must both reach the screen, which a single state slot cannot do.
type Clock = { handle: number | null; left: number; startedAt: number }
let stack: StackToast[] = []
const clocks = new Map<string, Clock>()
const changeListeners = new Set<() => void>()
let sequence = 0

function changed(next: StackToast[]): void {
  stack = next
  for (const listener of [...changeListeners]) listener()
}

function stopClock(key: string): void {
  const clock = clocks.get(key)
  if (clock?.handle != null) window.clearTimeout(clock.handle)
  clocks.delete(key)
}

// A pop-up that would vanish at once (no number, zero, negative, Infinity) lives for its type's own time instead.
function lifetime(type: string, duration: unknown): number {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : getNotificationDuration(type)
}

export function dismissToast(key: string): void {
  stopClock(key)
  if (stack.some((toast) => toast.key === key)) changed(stack.filter((toast) => toast.key !== key))
}

function startClock(key: string, ms: number): void {
  stopClock(key)
  const clock: Clock = { handle: null, left: ms, startedAt: Date.now() }
  clock.handle = window.setTimeout(() => dismissToast(key), ms)
  clocks.set(key, clock)
}

// The newest message is always on screen. At most NOTIFICATION_MAX_VISIBLE show at once; a further one pushes the
// oldest off at once (there is no waiting list). A message identical to one already showing does not add a second
// pop-up, it restarts that pop-up's clock; if keyboard focus is holding that pop-up, the restarted clock stays held.
export function emitToast(request: ToastRequest): void {
  const ms = lifetime(request.type, request.duration)
  const same = stack.find((toast) => toast.message === request.message && toast.type === request.type)
  if (same) {
    const clock = clocks.get(same.key)
    if (clock && clock.handle == null) {
      clock.left = ms
      clock.startedAt = Date.now()
    } else {
      startClock(same.key, ms)
    }
    changed(stack.map((toast) => (toast === same ? { ...toast, duration: ms, onActivate: request.onActivate || toast.onActivate } : toast)))
    return
  }
  sequence += 1
  const key = `toast-${sequence}`
  const next = [...stack, { ...request, key, duration: ms }]
  while (next.length > NOTIFICATION_MAX_VISIBLE) {
    const evicted = next.shift()
    if (evicted) stopClock(evicted.key)
  }
  changed(next)
  startClock(key, ms)
}

export function getToastStack(): StackToast[] {
  return stack
}

// Keyboard focus holds a pop-up's clock; leaving it hands back what was left.
export function pauseToast(key: string): void {
  const clock = clocks.get(key)
  if (!clock || clock.handle == null) return
  window.clearTimeout(clock.handle)
  clock.handle = null
  clock.left = Math.max(0, clock.left - (Date.now() - clock.startedAt))
}

export function resumeToast(key: string): void {
  const clock = clocks.get(key)
  if (!clock || clock.handle != null) return
  startClock(key, clock.left)
}

// A pop-up whose time ran out while no timer could fire (a throttled background tab) is gone before the next screen draws it.
function dropExpired(): void {
  const now = Date.now()
  for (const toast of [...stack]) {
    const clock = clocks.get(toast.key)
    if (clock && clock.handle != null && clock.startedAt + clock.left <= now) dismissToast(toast.key)
  }
}

export function subscribeToastStack(listener: () => void): () => void {
  dropExpired()
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}

// The signed-in user changed (sign-out, or another account): drop every visible pop-up and held message and cancel
// their clocks, so one user's alert never shows to the next. Listeners stay; a message raised after this shows normally.
export function clearToasts(): void {
  for (const key of [...clocks.keys()]) stopClock(key)
  if (stack.length) changed([])
}

// True when a user id change must clear the pop-ups: someone was signed in and now nobody is, or another account is.
// Nobody -> someone (a sign-in) keeps what the sign-in screen showed.
export function userChangeClearsToasts(previousId: unknown, nextId: unknown): boolean {
  const previous = previousId == null || previousId === '' ? '' : String(previousId)
  const next = nextId == null || nextId === '' ? '' : String(nextId)
  if (!previous || previous === next) return false
  return true
}

// Test seam: forget every pop-up and clock.
export function resetToastStack(): void {
  for (const key of [...clocks.keys()]) stopClock(key)
  stack = []
  sequence = 0
  changeListeners.clear()
}
