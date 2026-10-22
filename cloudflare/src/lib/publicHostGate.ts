/**
 * Storefront host API gate (G38 P0, design S1).
 *
 * Owner, 27 Sep 2026: "the public site never shows admin". One Worker serves
 * both hosts, so without a gate leangbeauty.com/api/auth/login, /api/products
 * and every other staff endpoint answered on the shop's public domain. On a
 * storefront host only the storefront's own API is reachable; everything else
 * is a plain 404, as if the staff app did not exist there.
 *
 * The host rule is the frontend's isStaffHostname (src/app/clientIdentity.ts,
 * index.html's bootstrap, the service worker): admin.*, loopback and the
 * deployment's configured staff host are the staff app, every other host is
 * the storefront. Telegram, Google OAuth and the deploy kit all call
 * admin.leangbeauty.com, which is untouched. The configured host (a workers.dev client's <client>-admin.<subdomain>.workers.dev,
 * where a *.workers.dev name cannot start with admin.) is ClientIdentity.staffHost: an exact hostname, never the public
 * host (lib/clientIdentity.ts staffHostFrom).
 *
 * Pure and dependency-free: no D1, KV or subrequest, so it costs a string
 * compare on the Free plan's 10 ms budget and the pure test runs it as is.
 */

export function isStaffHostname(hostname: unknown, staffHost: unknown = ''): boolean {
  const host = String(hostname || '').toLowerCase().trim()
  const configured = String(staffHost || '').toLowerCase().trim()
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
    || host === '::1'
    || host.startsWith('admin.')
    || (configured !== '' && host === configured)
}

// Exactly what the storefront bundle calls (src/api/portalPublicTransport.ts
// and the shared crash reporter, src/utils/clientCrashReport.ts).
const STOREFRONT_API_PREFIX = '/api/portal/'
const STOREFRONT_API_EXACT: ReadonlySet<string> = new Set(['/api/system/client-error'])
// Staff-only routes that live under /api/portal (Website Editor review of
// share screenshots). POST /api/portal/submissions itself is the customer's.
const STAFF_PORTAL_PREFIX = '/api/portal/submissions/'

// Allow-listed in the exact lower case the storefront sends; the staff prefix
// and dot segments are refused in any case, so no spelling reaches staff code.
export function isStorefrontApiPath(pathname: unknown): boolean {
  const path = String(pathname || '').replace(/\/{2,}/g, '/')
  if (STOREFRONT_API_EXACT.has(path)) return true
  if (!path.startsWith(STOREFRONT_API_PREFIX)) return false
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return false
  return !path.toLowerCase().startsWith(STAFF_PORTAL_PREFIX)
}

const MAX_DECODE_ROUNDS = 4
const ESCAPE = /%[0-9a-f]{2}/i
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/i

/**
 * The path this gate judges, or null when it cannot be read safely.
 *
 * Review F4 (13 Oct): Hono decodes the path before routing, so a gate reading
 * the raw pathname let /api/portal/%73ubmissions/review reach the staff review
 * route on the shop host. This decodes further than any router would --
 * decodeURIComponent (so %2F is a slash) repeated until nothing is left to
 * decode (so double encoding is seen through) -- reads backslashes as slashes
 * and collapses repeated slashes. A malformed escape in the request, an
 * invalid UTF-8 sequence, a decoded '%' that is ambiguous next to an escape,
 * or escapes still left after MAX_DECODE_ROUNDS answer null, and the caller
 * fails closed. A plain literal '%' (from %25 with no escape after it) stays.
 */
export function gatePath(pathname: string): string | null {
  let path = String(pathname || '')
  if (MALFORMED_ESCAPE.test(path)) return null
  for (let round = 0; ESCAPE.test(path); round += 1) {
    if (round >= MAX_DECODE_ROUNDS) return null
    try { path = decodeURIComponent(path) } catch { return null }
  }
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

/** true when this request must be answered 404 on a storefront host. */
export function isBlockedOnStorefrontHost(url: string, staffHost: unknown = ''): boolean {
  let parsed: URL
  try { parsed = new URL(url) } catch { return true }
  if (isStaffHostname(parsed.hostname, staffHost)) return false
  const path = gatePath(parsed.pathname)
  if (path === null) return true
  const lower = path.toLowerCase()
  if (lower === '/ws' || lower.startsWith('/ws/')) return true
  if (lower === '/api' || lower.startsWith('/api/')) return !isStorefrontApiPath(path)
  return false
}
