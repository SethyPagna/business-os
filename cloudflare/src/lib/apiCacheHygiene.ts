import type { Context, Next } from 'hono'

// Every /api/* body is per-account and goes to a till browser that several people share, so a response that names
// no cache policy of its own is private and never stored. A route's own Cache-Control always wins (the portal's
// public storefront header, the no-store routes). Cookie joins Vary so no shared cache can key one account's answer
// to another's request.
const DEFAULT_API_CACHE_CONTROL = 'private, no-store'

export function appendVary(headers: Headers, token: string): void {
  const existing = headers.get('Vary')
  if (!existing || !existing.trim()) {
    headers.set('Vary', token)
    return
  }
  const present = existing.split(',').map((part) => part.trim().toLowerCase())
  if (present.includes('*') || present.includes(token.toLowerCase())) return
  headers.set('Vary', `${existing}, ${token}`)
}

function applyApiCacheHygiene(headers: Headers): void {
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', DEFAULT_API_CACHE_CONTROL)
  appendVary(headers, 'Cookie')
}

// Registered right after the metrics middleware, so this code after next() runs last for every /api/* response,
// the app.onError and maintenance ones included. Setting before next() would be overwritten by the route.
export async function apiCacheHygiene(c: Context, next: Next): Promise<void> {
  await next()
  try {
    applyApiCacheHygiene(c.res.headers)
  } catch {
    // A response that came from fetch() or Response.redirect() has immutable headers.
    c.res = new Response(c.res.body, c.res)
    applyApiCacheHygiene(c.res.headers)
  }
}
