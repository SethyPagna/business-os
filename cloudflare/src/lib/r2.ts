// R2 object storage helper, using the native Workers R2 binding.
//
// The Docker runtime talks to R2 through its S3-compatible API (access key
// ID, secret key, endpoint URL, request signing) because a plain Node
// container has no other way to reach it. A Worker bound directly to the
// bucket skips all of that: no credentials to generate, rotate, or leak,
// no signing, no separate S3_* env vars. `env.ASSETS` in wrangler.toml's
// [[r2_buckets]] binding IS the bucket.

// serveObject's read-through cache (below) is keyed on the plain request
// URL, never on the R2 key directly -- so a write/delete THROUGH THIS MODULE
// must purge that same URL or a stale response keeps being served from
// `caches.default` for up to a year (`max-age=31536000, immutable`) after
// the object it was built from has changed or is gone entirely. `cacheOrigin`
// is OPTIONAL and backward-compatible: every existing call site keeps
// working with no cache awareness at all; a caller that also wants its write
// to invalidate the edge cache passes the origin the object is served from
// (e.g. `new URL(request.url).origin`) so this can rebuild serveObject's
// exact cache key. Purging is best-effort and never blocks or fails the
// write/delete it accompanies.
async function purgeServedObjectCache(cacheOrigin: string | undefined, key: string): Promise<void> {
  if (!cacheOrigin || typeof caches === 'undefined') return
  try {
    const url = new URL(`/${key}`, cacheOrigin).toString()
    await caches.default.delete(new Request(url, { method: 'GET' }))
  } catch {
    // Never let a cache-purge failure surface as a write/delete failure.
  }
}

export async function putObject(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream | Blob,
  contentType?: string,
  cacheOrigin?: string,
) {
  const result = await bucket.put(key, data, contentType ? { httpMetadata: { contentType } } : undefined)
  await purgeServedObjectCache(cacheOrigin, key)
  return result
}

export async function getObject(bucket: R2Bucket, key: string) {
  return bucket.get(key)
}

export async function deleteObject(bucket: R2Bucket, key: string, cacheOrigin?: string) {
  const result = await bucket.delete(key)
  await purgeServedObjectCache(cacheOrigin, key)
  return result
}

// R2's binding-level delete accepts up to 1,000 keys per call, and one call
// is ONE subrequest no matter how many keys it carries. The prefix-wide
// sweeps in routes/system.ts used to fire one deleteObject() per key inside
// a single Promise.all -- unbounded concurrency AND one subrequest per
// object, which blows the per-invocation subrequest ceiling on a large
// catalog (~20k objects) AFTER the D1 delete has already committed. Chunked
// bulk deletes make the same sweep cost ceil(n/1000) subrequests, run
// sequentially so a failure is attributable to its chunk.
//
// Never throws: every chunk is attempted, failures are collected per chunk,
// so callers report exactly what was left behind instead of guessing.
const R2_BULK_DELETE_MAX_KEYS = 1000

export async function deleteObjectsBulk(bucket: R2Bucket, keys: string[], cacheOrigin?: string): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0
  const errors: string[] = []
  for (let i = 0; i < keys.length; i += R2_BULK_DELETE_MAX_KEYS) {
    const chunk = keys.slice(i, i + R2_BULK_DELETE_MAX_KEYS)
    try {
      await bucket.delete(chunk)
      deleted += chunk.length
      await Promise.all(chunk.map((key) => purgeServedObjectCache(cacheOrigin, key)))
    } catch (error) {
      errors.push(`keys ${i}-${i + chunk.length - 1}: ${(error as Error).message || 'unknown error'}`)
    }
  }
  return { deleted, errors }
}

// R2 has no server-side "copy" op on the Workers binding -- a copy is a
// get() followed by a put() of the same bytes/metadata under a new key.
// Used by lib/backup.ts to actually back up asset *contents*, not just a
// manifest of their keys.
export async function copyObject(bucket: R2Bucket, sourceKey: string, destKey: string): Promise<boolean> {
  const object = await bucket.get(sourceKey)
  if (!object) return false
  const contentType = object.httpMetadata?.contentType
  await bucket.put(destKey, object.body, contentType ? { httpMetadata: { contentType } } : undefined)
  return true
}

export async function listObjects(bucket: R2Bucket, prefix: string) {
  const out: R2Object[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    out.push(...page.objects)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return out
}

// ---------------------------------------------------------------------------
// Served content types (stored-XSS guard).
//
// /uploads/* is public and same-origin with the admin app. It used to replay
// whatever Content-Type the UPLOADER supplied (object.writeHttpMetadata), so
// an uploaded .html or .svg rendered inline and ran script on the admin
// origin. Owner direction: public /uploads is for IMAGES. The served type is
// decided HERE, from the key's extension, and stored metadata is never
// replayed:
//
//   inline      jpeg / png / webp / gif / avif (and the image variants,
//               always .webp). The extension wins over whatever type the
//               uploader stored; with nosniff a browser will not reinterpret
//               a .jpg as HTML.
//   attachment  types a CURRENT flow still serves from /uploads (see
//               ATTACHMENT_UPLOAD_TYPES). Correct media type so <video>/<img>
//               keep working, but Content-Disposition: attachment so a
//               navigation downloads instead of rendering.
//   404         everything else (.html, .svg, .js, .bin, ...), and an
//               extensionless key unless its STORED type is an inline image.
//
// Every response also carries nosniff and a sandboxing CSP. A CSP on an image
// response does not affect embedding it in <img>; it only governs the
// response when it is navigated to as a document.
const INLINE_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}
// TODO(owner: public /uploads is images-only): these are non-images a current
// flow still reaches through /uploads, kept as attachments until those flows
// move to an authenticated/download route:
//   - video: the public storefront About block (CatalogSecondaryTabs <video>),
//     the catalog editor, and the Files page / file picker previews;
//   - .bmp: lib/fileAssets.ts still accepts it as an image upload;
//   - .pdf / .csv: the Files page lists and copies every asset's public URL.
const ATTACHMENT_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
}
const INLINE_STORED_TYPES = new Set(Object.values(INLINE_UPLOAD_TYPES))

export const UPLOAD_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"

export type UploadServePolicy =
  | { kind: 'inline'; contentType: string }
  | { kind: 'attachment'; contentType: string }
  | { kind: 'deny' }

function keyExtension(key: string): string {
  const lastSegment = String(key || '').split('/').pop() || ''
  const match = /\.[^.]+$/.exec(lastSegment)
  return match ? match[0].toLowerCase() : ''
}

/**
 * How a stored key may be served. Pass `storedContentType` only once the
 * object has been read; without it an extensionless key is 'deny' for now
 * (callers use policyNeedsStoredType to know whether to look).
 */
export function uploadServePolicy(key: string, storedContentType?: string | null): UploadServePolicy {
  const ext = keyExtension(key)
  if (ext) {
    if (INLINE_UPLOAD_TYPES[ext]) return { kind: 'inline', contentType: INLINE_UPLOAD_TYPES[ext] }
    if (ATTACHMENT_UPLOAD_TYPES[ext]) return { kind: 'attachment', contentType: ATTACHMENT_UPLOAD_TYPES[ext] }
    return { kind: 'deny' }
  }
  const stored = String(storedContentType || '').split(';')[0].trim().toLowerCase()
  return INLINE_STORED_TYPES.has(stored) ? { kind: 'inline', contentType: stored } : { kind: 'deny' }
}

/** True when the policy cannot be decided from the key alone. */
function policyNeedsStoredType(key: string): boolean {
  return keyExtension(key) === ''
}

/**
 * Sets the served type, disposition and hardening headers on `headers`,
 * REPLACING any content-type/content-disposition already there. Used for
 * fresh R2 reads, for edge-cache hits (entries cached before this guard
 * existed still hold the replayed type) and for image variants. Returns
 * null when the key must not be served at all.
 */
export function applySafeUploadHeaders(headers: Headers, key: string, storedContentType?: string | null): Headers | null {
  const policy = uploadServePolicy(key, storedContentType)
  if (policy.kind === 'deny') return null
  headers.set('content-type', policy.contentType)
  if (policy.kind === 'inline') {
    headers.delete('content-disposition')
  } else {
    const fileName = (String(key || '').split('/').pop() || 'download').replace(/[^\w.-]+/g, '_')
    headers.set('content-disposition', `attachment; filename="${fileName}"`)
  }
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-security-policy', UPLOAD_CONTENT_SECURITY_POLICY)
  return headers
}

function deniedUpload(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'x-content-type-options': 'nosniff', 'content-security-policy': UPLOAD_CONTENT_SECURITY_POLICY },
  })
}

// Serves an R2 object as an HTTP response, honoring conditional requests
// (If-None-Match / If-Modified-Since) so browsers and CDNs can cache
// uploaded assets without re-downloading them.
//
// `ctx` is optional and, when passed, turns on a `caches.default` (the free
// Workers edge cache, same primitive lib/cache.ts's cachedJsonResponse
// already uses) read-through in front of R2: /uploads/* never consulted it
// before, so every image load -- including the SAME image requested by many
// different visitors -- was a fresh R2 read through the Worker. Only a
// SUCCESSFUL (200) response is ever cached, and the cache key is the bare
// request URL (no headers), so this is only safe for a route that is
// public/unauthenticated for everyone who can reach it -- which is exactly
// why the one caller that passes `ctx` is index.ts's public `/uploads/*`,
// and the one that must not is portal.ts's staff-only, explicitly
// uncacheable submission-screenshot route (it omits `ctx`, so this stays a
// plain R2 read for it, unchanged).
export async function serveObject(
  bucket: R2Bucket,
  key: string,
  request: Request,
  ctx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  return (await serveStoredObject(bucket, key, request, ctx)) || new Response('Not found', { status: 404 })
}

// Strong-or-weak ETag comparison (RFC 9110 13.1.2: If-None-Match uses the
// WEAK comparison, so `W/` is ignored on either side) against a header that
// may be `*` or a comma-separated list. The old check was a plain string
// equality, so a CDN- or browser-weakened `W/"x"` or a multi-tag list never
// matched and every revalidation re-downloaded the whole image.
export function ifNoneMatchMatches(ifNoneMatch: string | null | undefined, etag: string | null | undefined): boolean {
  const header = String(ifNoneMatch || '').trim()
  const current = String(etag || '').trim()
  if (!header || !current) return false
  if (header === '*') return true
  const opaque = (tag: string) => tag.trim().replace(/^W\//i, '')
  const target = opaque(current)
  return header.split(',').some((candidate) => {
    const value = opaque(candidate)
    return value !== '' && value === target
  })
}

/**
 * serveObject without the 404: resolves to null when the key does not exist,
 * so a caller with a fallback (the image-variant route: miss -> transform)
 * can tell "absent" from "served". Same cache, conditional and safe-header
 * behaviour as serveObject.
 */
export async function serveStoredObject(
  bucket: R2Bucket,
  key: string,
  request: Request,
  ctx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response | null> {
  // Keyed on the URL alone (method normalized to GET) -- never on the
  // request's own conditional/auth headers, so every visitor's request for
  // the same asset hits the same cache entry. `caches.default` is only
  // touched when `ctx` is passed (never for the private, uncacheable
  // portal.ts caller) -- both because that route must never share-cache and
  // because `caches` does not exist as a global outside a real Workers
  // runtime, so referencing it unconditionally would break every caller.
  // Refused by extension before any cache or R2 read: a denied type costs
  // nothing and can never be served from a pre-guard cache entry either.
  if (!policyNeedsStoredType(key) && uploadServePolicy(key).kind === 'deny') return deniedUpload()
  const cache = ctx ? caches.default : null
  const cacheKey = ctx ? new Request(new URL(request.url).toString(), { method: 'GET' }) : null
  if (cache && cacheKey) {
    const cached = await cache.match(cacheKey)
    if (cached) {
      // Still honor a conditional request against the cached ETag -- the
      // cache entry replaces the R2 read, not the conditional-request
      // contract this route already had.
      // Headers are re-derived on the way out, never trusted from the
      // entry: a response cached before the content-type guard existed
      // would otherwise keep serving the uploader's type for a year.
      const cachedHeaders = applySafeUploadHeaders(new Headers(cached.headers), key, cached.headers.get('content-type'))
      if (!cachedHeaders) return deniedUpload()
      const etag = cached.headers.get('etag')
      const ifNoneMatch = request.headers.get('if-none-match')
      if (ifNoneMatchMatches(ifNoneMatch, etag)) {
        return new Response(null, { status: 304, headers: cachedHeaders })
      }
      return new Response(cached.body, { status: cached.status, headers: cachedHeaders })
    }
  }
  const object = await bucket.get(key, {
    onlyIf: request.headers,
  })
  if (object === null) return null
  const headers = new Headers()
  // Deliberately NOT object.writeHttpMetadata(headers): that replays the
  // uploader-supplied content-type/disposition. See applySafeUploadHeaders.
  if (!applySafeUploadHeaders(headers, key, object.httpMetadata?.contentType)) return deniedUpload()
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  if (!('body' in object)) {
    // Conditional request matched -- object unchanged.
    return new Response(null, { status: 304, headers })
  }
  const response = new Response(object.body as ReadableStream, { headers })
  if (cache && cacheKey) {
    // Don't make the caller wait for the cache write -- same fire-and-forget
    // shape lib/cache.ts's cachedJsonResponse already uses.
    ctx!.waitUntil(cache.put(cacheKey, response.clone()))
  }
  return response
}
