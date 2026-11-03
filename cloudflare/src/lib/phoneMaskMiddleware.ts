import type { Context, MiddlewareHandler } from 'hono'
import { getSessionUser, hasSessionCookie } from './auth'
import { canSeeFullPhones, projectPhones, scrubMaskedRequestText, type PhoneActor } from './phoneAccess'

// Installed once for the whole /api surface (index.ts), ahead of every route, so a route that answers with c.json
// cannot send a full phone number to an account without `contacts_full_phone`. It wraps c.json the way
// acquisitionCostResponses does: the object a handler built (after any cache read) is projected before it is
// serialized, and nothing is buffered or re-parsed.
//
// The actor is the session account. Routers authenticate with requireAuth and put the user on the context; the few
// routes that read the session themselves (/auth/me, /auth/bootstrap) and any route that answers before requireAuth
// share one memoized lookup (getSessionUser), which this middleware starts first. With no session the answer is
// masked, never open. The storefront (/api/portal/*) answers a customer about their own account and has no staff
// actor: it is left alone, except the staff review routes there, which authenticate and are masked like the rest.
const STOREFRONT = /^\/api\/portal(?:\/|$)/

// The way back in (review B1). A form filled from a read that masked a value sends the mask back; an account that cannot see numbers
// therefore has the masked values taken out of its JSON write (lib/phoneAccess.ts scrubMaskedInput), once, ahead of every route, so a
// create, an edit, a bulk edit, a review-queue entry and a replayed request all see the field as untouched, never as the mask.
// Only a form-sized JSON body is read again here (not a plan limit: the scrub parses the body once more, so a bulk body is left to its
// own route, which has its own checks), and only one that contains "***" is parsed.
const SCRUB_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const SCRUB_BODY_MAX_BYTES = 1024 * 1024

async function scrubMaskedWrite(c: Context): Promise<void> {
  if (!SCRUB_METHODS.has(c.req.method)) return
  const type = (c.req.header('content-type') || '').toLowerCase()
  if (type && !type.includes('json') && !type.includes('text/plain')) return
  // A declared size over the bound is refused without reading. A request that declares none (chunked) is read: the route reads it too.
  const length = c.req.header('content-length')
  if (length !== undefined && /^\d+$/.test(length) && Number(length) > SCRUB_BODY_MAX_BYTES) return
  const raw = c.req.raw
  if (!raw.body) return
  const text = await c.req.text()
  const scrubbed = text.length > SCRUB_BODY_MAX_BYTES ? null : scrubMaskedRequestText(text)
  // The body was read, so the request is rebuilt for the routes that read it again (c.req.json() or the raw request).
  const headers = new Headers(raw.headers)
  if (scrubbed !== null) headers.set('content-length', String(new TextEncoder().encode(scrubbed).byteLength))
  c.req.raw = new Request(raw, { body: scrubbed ?? text, headers })
  c.req.bodyCache = {}
}

export const phoneMaskResponses: MiddlewareHandler = async (c, next) => {
  let sessionActor: PhoneActor = null
  if (!STOREFRONT.test(c.req.path) || /^\/api\/portal\/submissions\//.test(c.req.path)) {
    if (hasSessionCookie(c)) {
      try { sessionActor = (await getSessionUser(c)) as PhoneActor } catch { sessionActor = null }
    }
    if (sessionActor && !canSeeFullPhones(sessionActor)) await scrubMaskedWrite(c)
    const json: Function = c.json
    c.json = ((...args: Parameters<Context['json']>) => {
      const actor = ((c as unknown as { get(key: string): PhoneActor }).get('user') ?? sessionActor) as PhoneActor
      args[0] = projectPhones(args[0], actor) as typeof args[0]
      return Reflect.apply(json, c, args)
    }) as Context['json']
  }
  await next()
}
