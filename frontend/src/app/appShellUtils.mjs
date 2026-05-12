const API_PREFIX = '/api/'
const UPLOADS_PREFIX = '/uploads/'
const STATIC_ASSET_RE = /\.[a-z0-9]+$/i
const ADMIN_ROUTE_PAGE_BY_SEGMENT = new Map([
  ['dashboard', 'dashboard'],
  ['products', 'products'],
  ['product', 'products'],
  ['pos', 'pos'],
  ['point-of-sale', 'pos'],
  ['inventory', 'inventory'],
  ['sales', 'sales'],
  ['returns', 'returns'],
  ['branches', 'branches'],
  ['contacts', 'contacts'],
  ['delivery-contacts', 'contacts'],
  ['catalog', 'catalog'],
  ['loyalty-points', 'loyalty_points'],
  ['loyalty', 'loyalty_points'],
  ['users', 'users'],
  ['audit-log', 'audit_log'],
  ['audit', 'audit_log'],
  ['receipt-settings', 'receipt_settings'],
  ['receipts', 'receipt_settings'],
  ['backup', 'backup'],
  ['backups', 'backup'],
  ['settings', 'settings'],
  ['files', 'files'],
  ['library', 'files'],
  ['server', 'server'],
])
const ADMIN_AUTH_ROUTE_SEGMENTS = new Set(['login', 'admin', 'app'])
export const APP_NAVIGATION_EVENT = 'bos:navigation'
const ADMIN_PATH_BY_PAGE = new Map([
  ['dashboard', '/'],
  ['products', '/products'],
  ['pos', '/pos'],
  ['inventory', '/inventory'],
  ['sales', '/sales'],
  ['returns', '/returns'],
  ['branches', '/branches'],
  ['contacts', '/contacts'],
  ['catalog', '/catalog'],
  ['loyalty_points', '/loyalty-points'],
  ['users', '/users'],
  ['audit_log', '/audit-log'],
  ['receipt_settings', '/receipt-settings'],
  ['backup', '/backup'],
  ['settings', '/settings'],
  ['files', '/files'],
  ['server', '/server'],
])

// Keep a small working set of pages mounted so tab switches still feel quick
// without letting the shell drag around every hidden page forever.
export const MAX_MOUNTED_PAGES = 8
export const MOBILE_MAX_MOUNTED_PAGES = 3
export const MOBILE_SHELL_BREAKPOINT = 768
export const DESKTOP_WARMUP_BREAKPOINT = 1024

export function normalizeAppPath(pathname) {
  const value = String(pathname || '/')
    .split('?')[0]
    .split('#')[0]
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase()
  return value || '/'
}

export function getAdminPageFromPath(pathname) {
  const value = normalizeAppPath(pathname)
  if (value === '/') return ''
  const segment = value.split('/').filter(Boolean)[0] || ''
  return ADMIN_ROUTE_PAGE_BY_SEGMENT.get(segment) || ''
}

export function getAdminPathForPage(pageId) {
  return ADMIN_PATH_BY_PAGE.get(String(pageId || '').trim()) || '/'
}

export function isAdminAppPath(pathname) {
  const value = normalizeAppPath(pathname)
  if (value === '/') return true
  const segment = value.split('/').filter(Boolean)[0] || ''
  return ADMIN_AUTH_ROUTE_SEGMENTS.has(segment) || ADMIN_ROUTE_PAGE_BY_SEGMENT.has(segment)
}

export function isPublicCatalogPath(pathname) {
  const value = normalizeAppPath(pathname)
  if (!value || value === '/') return false
  if (value === '/health') return false
  if (value.startsWith(API_PREFIX)) return false
  if (value.startsWith(UPLOADS_PREFIX)) return false
  if (STATIC_ASSET_RE.test(value)) return false
  if (isAdminAppPath(value)) return false
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
