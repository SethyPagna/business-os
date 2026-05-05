const API_PREFIX = '/api/'
const UPLOADS_PREFIX = '/uploads/'
const STATIC_ASSET_RE = /\.[a-z0-9]+$/i

// Keep a small working set of pages mounted so tab switches still feel quick
// without letting the shell drag around every hidden page forever.
export const MAX_MOUNTED_PAGES = 8
export const MOBILE_MAX_MOUNTED_PAGES = 3
export const MOBILE_SHELL_BREAKPOINT = 768
export const DESKTOP_WARMUP_BREAKPOINT = 1024

export function isPublicCatalogPath(pathname) {
  const value = String(pathname || '/')
  if (!value || value === '/') return false
  if (value === '/health') return false
  if (value.startsWith(API_PREFIX)) return false
  if (value.startsWith(UPLOADS_PREFIX)) return false
  if (STATIC_ASSET_RE.test(value)) return false
  return true
}

export function updateMountedPages(previousPages, activePage, maxPages = MAX_MOUNTED_PAGES) {
  const list = Array.isArray(previousPages) ? previousPages.filter(Boolean) : []
  const next = [...list.filter((page) => page !== activePage), activePage]
  while (next.length > maxPages) {
    next.shift()
  }
  const unchanged = next.length === list.length && next.every((page, index) => page === list[index])
  return unchanged ? list : next
}

export function getMountedPageLimit({ viewportWidth = 0, coarsePointer = false, maxPages = MAX_MOUNTED_PAGES } = {}) {
  const width = Number(viewportWidth || 0)
  if (coarsePointer) return Math.min(maxPages, MOBILE_MAX_MOUNTED_PAGES)
  if (Number.isFinite(width) && width > 0 && width < MOBILE_SHELL_BREAKPOINT) {
    return Math.min(maxPages, MOBILE_MAX_MOUNTED_PAGES)
  }
  return maxPages
}

export function shouldWarmPageEntries({ viewportWidth = 0, coarsePointer = false } = {}) {
  const width = Number(viewportWidth || 0)
  if (coarsePointer) return false
  if (Number.isFinite(width) && width > 0 && width < DESKTOP_WARMUP_BREAKPOINT) return false
  return true
}

export function getNotificationPrefix(type) {
  if (type === 'success') return 'OK '
  if (type === 'error') return 'ERR '
  if (type === 'warning') return 'WARN '
  return 'INFO '
}

export function getNotificationColor(type) {
  if (type === 'success') return 'bg-green-600'
  if (type === 'error') return 'bg-red-600'
  if (type === 'warning') return 'bg-yellow-600'
  if (type === 'info') return 'bg-blue-600'
  return 'bg-gray-800'
}
