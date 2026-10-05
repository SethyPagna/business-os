import type { Context, Next } from 'hono'

export const SMALL_BODY_BYTES = 64 * 1024
// The manifest-bound repair permits up to 512000 bytes of rows plus envelope.
export const MIGRATION_FINALIZE_BODY_BYTES = 768 * 1024
export const PORTAL_SCREENSHOT_BODY_BYTES = 20 * 1024 * 1024

// Exact POST endpoints only. Imports, sync/outbox, settings, bulk operations,
// binary uploads and all GET/HEAD requests need their own streaming budgets.
const PUBLIC_SMALL_POSTS = new Set([
  '/api/auth/login', '/api/auth/logout', '/api/auth/password-reset/email',
  '/api/auth/password-reset/complete', '/api/auth/password-reset/otp', '/api/auth/password-reset/admin-request',
  '/api/auth/otp/verify', '/api/auth/oauth/start', '/api/auth/oauth/complete',
  '/api/portal/auth/signup', '/api/portal/auth/signin', '/api/portal/auth/signout',
])
const STAFF_SMALL_POSTS = new Set([
  '/api/auth/session-duration', '/api/auth/otp/setup', '/api/auth/otp/confirm',
  '/api/auth/otp/disable', '/api/auth/otp/recover', '/api/auth/oauth/unlink',
  '/api/auth/devices/sessions/revoke-user',
  '/api/backups', '/api/backups/maintenance/clear',
  '/api/system/finalize-migration',
])

export function smallBodyAccess(method: string, path: string): 'public' | 'staff' | null {
  if (method !== 'POST') return null
  if (PUBLIC_SMALL_POSTS.has(path)) return 'public'
  if (STAFF_SMALL_POSTS.has(path)) return 'staff'
  return null
}

/** Admit the entire bounded wire body BEFORE next()/parsing can cause effects.
 * Content-Length is only an early rejection hint, never permission to skip
 * counting. Do not tee/clone or install a lazy throwing stream: routes often
 * swallow parser errors, and the global error handler maps exceptions to 500.
 */
export async function admitRequestBody(c: Context, maxBytes: number): Promise<Response | undefined> {
  const raw = c.req.raw
  const tooLarge = () => c.json({
    success: false, error: 'Request body is too large.', code: 'request_body_too_large', maxBytes,
  }, 413)
  const length = raw.headers.get('content-length')
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
    await raw.body?.cancel().catch(() => {})
    return tooLarge()
  }
  if (!raw.body) return
  const reader = raw.body.getReader()
  // One bounded allocation: retaining an array per incoming chunk would let
  // millions of one-byte chunks exceed the memory budget despite the byte cap.
  const body = new Uint8Array(maxBytes)
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > maxBytes - size) {
        await reader.cancel().catch(() => {})
        return tooLarge()
      }
      body.set(value, size)
      size += value.byteLength
    }
  } catch {
    await reader.cancel().catch(() => {})
    return c.json({ success: false, error: 'Could not read request body.', code: 'request_body_unreadable' }, 400)
  } finally {
    reader.releaseLock()
  }
  // Construct from the original to retain method, URL, headers and Workers
  // request metadata. No decode/re-encode: JSON and multipart see identical bytes.
  c.req.raw = new Request(raw, { body: body.subarray(0, size) })
}

// G38 E5: login CSRF on credential endpoints. The global originGuard (F4)
// lets a write through when it carries NEITHER Origin nor Sec-Fetch-Site, and
// a route that reads c.req.json() parses a text/plain body as JSON, so a
// cross-site HTML form or a no-preflight text/plain fetch could still sign a
// victim's browser into an attacker's account (login CSRF) wherever a browser
// omits those headers. Credential endpoints therefore demand more than F4:
//   - POST/PUT/PATCH must declare Content-Type application/json, which a
//     cross-site page cannot send without a CORS preflight the Worker never
//     answers -> 415 credential_json_required;
//   - the browser must vouch for same origin: Sec-Fetch-Site is exactly
//     'same-origin', or, from a browser that does not send Sec-Fetch-Site
//     (Safari before 16.4), Origin equals this request's own origin. Both
//     headers absent, 'same-site', 'cross-site', 'none' or a foreign / null
//     Origin -> 403 credential_origin_refused.
// GET/HEAD/OPTIONS pass untouched (/auth/me reads, it does not sign in).
const CREDENTIAL_GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CREDENTIAL_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

export type CredentialPostInput = {
  method: string
  url: string
  contentType: string | null | undefined
  origin: string | null | undefined
  secFetchSite: string | null | undefined
}

export type CredentialPostRefusal = { status: 403 | 415; code: 'credential_origin_refused' | 'credential_json_required'; error: string }

export function credentialPostRefusal(input: CredentialPostInput): CredentialPostRefusal | null {
  const method = String(input.method || '').toUpperCase()
  if (!CREDENTIAL_GUARDED_METHODS.has(method)) return null
  const site = input.secFetchSite == null ? '' : String(input.secFetchSite).trim().toLowerCase()
  const origin = input.origin == null ? '' : String(input.origin).trim().toLowerCase()
  let sameOrigin = false
  if (site) {
    sameOrigin = site === 'same-origin'
  } else if (origin) {
    try { sameOrigin = origin === new URL(input.url).origin.toLowerCase() } catch (_) { sameOrigin = false }
  }
  if (!sameOrigin) {
    return { status: 403, code: 'credential_origin_refused', error: 'This request must come from the shop website itself.' }
  }
  if (CREDENTIAL_BODY_METHODS.has(method)) {
    const mediaType = String(input.contentType || '').split(';')[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return { status: 415, code: 'credential_json_required', error: 'Send this request as JSON.' }
    }
  }
  return null
}

export async function requireJsonSameOriginCredentialPost(c: Context, next: Next) {
  const refusal = credentialPostRefusal({
    method: c.req.method,
    url: c.req.url,
    contentType: c.req.header('content-type'),
    origin: c.req.header('origin'),
    secFetchSite: c.req.header('sec-fetch-site'),
  })
  if (refusal) return c.json({ error: refusal.error, code: refusal.code }, refusal.status)
  return next()
}
