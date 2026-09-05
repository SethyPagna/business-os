import type { Context } from 'hono'

export const SMALL_BODY_BYTES = 64 * 1024
// The manifest-bound repair permits up to 512000 bytes of rows plus envelope.
export const MIGRATION_FINALIZE_BODY_BYTES = 768 * 1024
export const PORTAL_SCREENSHOT_BODY_BYTES = 20 * 1024 * 1024

// Exact POST endpoints only. Imports, sync/outbox, settings, bulk operations,
// binary uploads and all GET/HEAD requests need their own streaming budgets.
const PUBLIC_SMALL_POSTS = new Set([
  '/api/auth/login', '/api/auth/logout', '/api/auth/password-reset/email',
  '/api/auth/password-reset/complete', '/api/auth/password-reset/otp',
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
