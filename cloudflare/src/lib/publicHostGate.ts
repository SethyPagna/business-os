/**
 * Storefront host API gate (G38 P0, design S1).
 *
 * Owner, 27 Sep 2026: "the public site never shows admin". One Worker serves
 * both hosts, so without a gate leangbeauty.com/api/auth/login, /api/products
 * and every other staff endpoint answered on the shop's public domain. On a
 * storefront host only the storefront's own API is reachable; everything else
 * is a plain 404, as if the staff app did not exist there.
 *
 * The host rule is the frontend's isAdminHostname (src/app/pathRouting.ts,
 * index.html's bootstrap, the service worker): admin.* and loopback are the
 * staff app, every other host is the storefront. Telegram, Google OAuth and
 * the deploy kit all call admin.leangbeauty.com, which is untouched.
 *
 * Pure and dependency-free: no D1, KV or subrequest, so it costs a string
 * compare on the Free plan's 10 ms budget and the pure test runs it as is.
 */

export function isStaffHostname(hostname: unknown): boolean {
  const host = String(hostname || '').toLowerCase().trim()
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
    || host === '::1'
    || host.startsWith('admin.')
}

// Exactly what the storefront bundle calls (src/api/portalPublicTransport.ts
// and the shared crash reporter, src/utils/clientCrashReport.ts).
const STOREFRONT_API_PREFIX = '/api/portal/'
const STOREFRONT_API_EXACT: ReadonlySet<string> = new Set(['/api/system/client-error'])
// Staff-only routes that live under /api/portal (Website Editor review of
// share screenshots). POST /api/portal/submissions itself is the customer's.
const STAFF_PORTAL_PREFIX = '/api/portal/submissions/'

export function isStorefrontApiPath(pathname: unknown): boolean {
  const path = String(pathname || '').replace(/\/{2,}/g, '/')
  if (STOREFRONT_API_EXACT.has(path)) return true
  if (!path.startsWith(STOREFRONT_API_PREFIX)) return false
  return !path.startsWith(STAFF_PORTAL_PREFIX)
}

/** true when this request must be answered 404 on a storefront host. */
export function isBlockedOnStorefrontHost(url: string): boolean {
  let parsed: URL
  try { parsed = new URL(url) } catch { return true }
  if (isStaffHostname(parsed.hostname)) return false
  const path = parsed.pathname
  if (path === '/ws' || path.startsWith('/ws/')) return true
  if (path === '/api' || path.startsWith('/api/')) return !isStorefrontApiPath(path)
  return false
}
