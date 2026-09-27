// F4 (Release 1 auth audit). CSRF defence in depth for the session cookie.
//
// The Worker sends no CORS headers, so a cross-site page cannot READ an API
// response and cannot send a preflighted request (JSON content type, custom
// headers). It can still fire a "simple" write -- an HTML form POST or a
// text/plain fetch -- and the browser attaches the session cookie. This guard
// refuses any state-changing /api request that a browser marks as coming from
// another site.
//
// A write is allowed when ANY of these holds:
//   - Origin equals the request's own origin;
//   - Sec-Fetch-Site is `same-origin` (the browser vouches for it; the Vite
//     dev proxy forwards it unchanged even though Origin names the dev port)
//     or `none` (user-initiated, e.g. typed into the address bar);
//   - both headers are absent (not a browser: curl, Telegram, a cron probe --
//     none of which carry the victim's cookie).
// Anything else -- `cross-site`, `same-site` (a sibling subdomain), or an
// Origin naming another host, including the opaque `null` -- is refused 403.
//
// Browsers forbid page script from setting Origin and Sec-Fetch-*, so a
// hostile page cannot forge its way past. Telegram's webhook is exempt by
// path; it authenticates with its own secret header.

import type { Context, Next } from 'hono'

const GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const EXEMPT_PATHS = new Set(['/api/telegram/webhook'])

export const CROSS_ORIGIN_WRITE_ERROR = 'Cross-origin requests are not allowed'

export type OriginGuardInput = {
  method: string
  path: string
  url: string
  origin: string | null | undefined
  secFetchSite: string | null | undefined
}

export function isCrossOriginWriteBlocked(input: OriginGuardInput): boolean {
  if (!GUARDED_METHODS.has(String(input.method || '').toUpperCase())) return false
  const path = String(input.path || '')
  if (!path.startsWith('/api/') && path !== '/api') return false
  if (EXEMPT_PATHS.has(path.replace(/\/+$/, ''))) return false

  const origin = input.origin == null ? '' : String(input.origin).trim()
  const site = input.secFetchSite == null ? '' : String(input.secFetchSite).trim().toLowerCase()

  if (!origin && !site) return false
  if (site === 'same-origin' || site === 'none') return false
  if (origin) {
    let requestOrigin = ''
    try {
      requestOrigin = new URL(input.url).origin
    } catch (_) {
      return true
    }
    if (origin.toLowerCase() === requestOrigin.toLowerCase()) return false
  }
  return true
}

export async function originGuard(c: Context, next: Next) {
  const blocked = isCrossOriginWriteBlocked({
    method: c.req.method,
    path: c.req.path,
    url: c.req.url,
    origin: c.req.header('origin'),
    secFetchSite: c.req.header('sec-fetch-site'),
  })
  if (blocked) return c.json({ error: CROSS_ORIGIN_WRITE_ERROR, code: 'cross_origin_write_refused' }, 403)
  return next()
}
