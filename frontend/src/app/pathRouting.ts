const API_PREFIX = '/api/'
const UPLOADS_PREFIX = '/uploads/'
const STATIC_ASSET_RE = /\.[a-z0-9]+$/i
const ADMIN_ROUTE_PAGE_BY_SEGMENT = new Map<string, string>([
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
const ADMIN_AUTH_ROUTE_SEGMENTS = new Set<string>(['login', 'admin', 'app'])
const ADMIN_PATH_BY_PAGE = new Map<string, string>([
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

export const APP_NAVIGATION_EVENT = 'bos:navigation'
export const APP_PAGE_INTENT_EVENT = 'bos:page-intent'

export function normalizeAppPath(pathname: unknown): string {
  const value = String(pathname || '/')
    .split('?')[0]
    .split('#')[0]
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase()
  return value || '/'
}

export function getAdminPageFromPath(pathname: unknown): string {
  const value = normalizeAppPath(pathname)
  if (value === '/') return ''
  const segment = value.split('/').filter(Boolean)[0] || ''
  return ADMIN_ROUTE_PAGE_BY_SEGMENT.get(segment) || ''
}

export function getAdminPathForPage(pageId: unknown): string {
  return ADMIN_PATH_BY_PAGE.get(String(pageId || '').trim()) || '/'
}

export function isAdminAppPath(pathname: unknown): boolean {
  const value = normalizeAppPath(pathname)
  if (value === '/') return true
  const segment = value.split('/').filter(Boolean)[0] || ''
  return ADMIN_AUTH_ROUTE_SEGMENTS.has(segment) || ADMIN_ROUTE_PAGE_BY_SEGMENT.has(segment)
}

export function isPublicCatalogPath(pathname: unknown): boolean {
  const value = normalizeAppPath(pathname)
  if (!value || value === '/') return false
  if (value === '/health') return false
  if (value.startsWith(API_PREFIX)) return false
  if (value.startsWith(UPLOADS_PREFIX)) return false
  if (STATIC_ASSET_RE.test(value)) return false
  if (isAdminAppPath(value)) return false
  return true
}
