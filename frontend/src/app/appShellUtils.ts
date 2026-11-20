export {
  APP_NAVIGATION_EVENT,
  APP_PAGE_INTENT_EVENT,
  getAdminPageFromPath,
  getAdminPathForPage,
  isAdminAppPath,
  isPublicCatalogPath,
  normalizeAppPath,
  resolveAdminLandingPage,
} from './pathRouting.ts'

// Keep a small working set of pages mounted so tab switches still feel quick
// without letting the shell drag around every hidden page forever.
export const MAX_MOUNTED_PAGES = 8
export const MOBILE_MAX_MOUNTED_PAGES = 3
export const MOBILE_SHELL_BREAKPOINT = 768

export function updateMountedPages(
  previousPages: unknown = [],
  activePage: unknown = undefined,
  maxPages: number = MAX_MOUNTED_PAGES,
): unknown[] {
  const list = Array.isArray(previousPages) ? previousPages.filter(Boolean) : []
  const next = [...list.filter((page) => page !== activePage), activePage]
  while (next.length > maxPages) {
    next.shift()
  }
  const unchanged = next.length === list.length && next.every((page, index) => page === list[index])
  return unchanged ? list : next
}

interface MountedPageLimitOptions {
  viewportWidth?: unknown
  coarsePointer?: boolean
  maxPages?: number
}

export function getMountedPageLimit({
  viewportWidth = 0,
  coarsePointer = false,
  maxPages = MAX_MOUNTED_PAGES,
}: MountedPageLimitOptions = {}): number {
  const width = Number(viewportWidth || 0)
  if (coarsePointer) return Math.min(maxPages, MOBILE_MAX_MOUNTED_PAGES)
  if (Number.isFinite(width) && width > 0 && width < MOBILE_SHELL_BREAKPOINT) {
    return Math.min(maxPages, MOBILE_MAX_MOUNTED_PAGES)
  }
  return maxPages
}

export function getNotificationPrefix(type: unknown): string {
  if (type === 'success') return 'OK '
  if (type === 'error') return 'ERR '
  if (type === 'warning') return 'WARN '
  return 'INFO '
}

export function getNotificationColor(type: unknown): string {
  if (type === 'success') return 'bg-green-600'
  if (type === 'error') return 'bg-red-600'
  if (type === 'warning') return 'bg-yellow-600'
  if (type === 'info') return 'bg-blue-600'
  return 'bg-gray-800'
}

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

export function subscribeToasts(listener: ToastListener): () => void {
  toastListeners.add(listener)
  return () => { toastListeners.delete(listener) }
}

export function emitToast(request: ToastRequest): void {
  for (const listener of [...toastListeners]) listener(request)
}
