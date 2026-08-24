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
