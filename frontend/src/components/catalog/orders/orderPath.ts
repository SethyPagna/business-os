// Where an order lives in the address bar. The storefront host serves the same document for every path, so a link is all it takes:
//   /order/<token>   one order (the bookmarkable link; the token is the buyer's key to it)
//   /order           "My orders": the orders this browser placed
// Tiny and dependency-free on purpose: PublicCatalogRoot imports it before the first paint, and everything else loads lazily.

export const ORDER_PATH_ROOT = '/order'
/** The Worker's own token shape (isOrderToken in lib/onlineOrders.ts): 128 random bits as 22 URL-safe characters. */
export const ORDER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

export type OrderRoute = { kind: 'order'; token: string } | { kind: 'list' }

/** The order route a path selects, or null for every other (catalogue) path. A malformed token is still an order route, so it can say "not found". */
export function orderRouteFromPath(pathname: unknown): OrderRoute | null {
  const path = String(pathname ?? '').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (path === ORDER_PATH_ROOT) return { kind: 'list' }
  if (!path.startsWith(`${ORDER_PATH_ROOT}/`)) return null
  const segments = path.slice(ORDER_PATH_ROOT.length + 1).split('/')
  if (segments.length !== 1 || !segments[0]) return null
  let token = segments[0]
  try { token = decodeURIComponent(token) } catch { /* keep the raw segment: it fails the shape check below */ }
  return { kind: 'order', token }
}

export const isOrderToken = (value: unknown): value is string => typeof value === 'string' && ORDER_TOKEN_PATTERN.test(value)

export const orderPathFor = (token: string): string => `${ORDER_PATH_ROOT}/${encodeURIComponent(token)}`

/** Where "My orders" keeps its rows (orderHistory.ts reads and writes them; the cookie policy lists this key). */
export const ORDER_HISTORY_STORAGE_KEY = 'business-os-portal-orders-v1'

/**
 * Whether this browser has saved any order, without parsing them: the cart drawer (eager) only needs to know whether to offer the "My orders" link,
 * and the row sanitiser and writers (orderHistory.ts) load with the order screens, not with the catalogue.
 */
export function hasSavedOrders(): boolean {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(ORDER_HISTORY_STORAGE_KEY)
    return !!raw && raw.length > 2
  } catch {
    return false
  }
}
