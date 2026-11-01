import type { Context, MiddlewareHandler } from 'hono'
import { getSessionUser, hasSessionCookie } from './auth'
import { projectPhones, type PhoneActor } from './phoneAccess'

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

export const phoneMaskResponses: MiddlewareHandler = async (c, next) => {
  let sessionActor: PhoneActor = null
  if (!STOREFRONT.test(c.req.path) || /^\/api\/portal\/submissions\//.test(c.req.path)) {
    if (hasSessionCookie(c)) {
      try { sessionActor = (await getSessionUser(c)) as PhoneActor } catch { sessionActor = null }
    }
    const json: Function = c.json
    c.json = ((...args: Parameters<Context['json']>) => {
      const actor = ((c as unknown as { get(key: string): PhoneActor }).get('user') ?? sessionActor) as PhoneActor
      args[0] = projectPhones(args[0], actor) as typeof args[0]
      return Reflect.apply(json, c, args)
    }) as Context['json']
  }
  await next()
}
