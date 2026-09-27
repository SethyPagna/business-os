// On-demand, persisted-once image variants for /uploads/.
//
// Stored product images are ~0.8-0.9 MB at up to 2560px, and every POS and
// catalog grid used to download that original for a 150px tile. A variant is
// a downscaled WebP of ONE original at ONE allowlisted width:
//
//   GET /uploads/_v/w320/<storedName>   ->  R2 key variants/w320/<storedName>.webp
//
// The first request transforms (Cloudflare Images binding, metered through
// quotaGuard) and writes the result back to R2; every later request is a plain
// R2 read, so each (image, width) spends at most one transformation ever.
//
// The top half is pure -- parsing and key building, no bindings -- so the
// allowlist and the traversal rules are testable without a Worker. The
// serving half (below) reuses lib/r2.ts's serveStoredObject and safe headers.
//
// SCOPE: only originals under `uploads/` are reachable. The same bucket holds
// `backups/...` (lib/backup.ts); a stored name is a single path segment and is
// always re-prefixed with `uploads/` here, so no request can name a backup.

import type { Env } from '../index'
import { consumeQuota } from './quotaGuard'
import { applySafeUploadHeaders, serveObject, serveStoredObject } from './r2'

/** The only widths the route will ever produce. Anything else is a 404. */
export const IMAGE_VARIANT_WIDTHS = [160, 320, 640] as const
export type ImageVariantWidth = typeof IMAGE_VARIANT_WIDTHS[number]

/** Path segment that marks a variant request under /uploads/. */
export const IMAGE_VARIANT_PATH_PREFIX = '_v/'

/**
 * Extensions a variant may be built from. Mirrors lib/fileAssets.ts's
 * IMAGE_EXTENSIONS: a PDF, video or CSV under uploads/ is never an image
 * source, so asking for its "variant" is an unknown name, not a transform
 * that would spend quota only to fail.
 */
const VARIANT_SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])

const MAX_STORED_NAME_LENGTH = 255

export type ImageVariantRequest = {
  width: ImageVariantWidth
  storedName: string
  /** R2 key of the original: always `uploads/<storedName>`. */
  originalKey: string
  /** R2 key of the persisted variant. */
  variantKey: string
}

export function isImageVariantWidth(value: number): value is ImageVariantWidth {
  return (IMAGE_VARIANT_WIDTHS as readonly number[]).includes(value)
}

/**
 * True when `name` is one plain stored file name that could have come from
 * buildUniqueStoredName: one segment, no dot-segment, no separators or
 * control characters, an image extension. Anything else is rejected rather
 * than normalised -- a name that needs cleaning was never issued by us.
 */
export function isSafeVariantSourceName(name: string): boolean {
  if (!name || name.length > MAX_STORED_NAME_LENGTH) return false
  if (name === '.' || name === '..') return false
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return false
  // A variant of a variant is never a thing.
  if (name.startsWith('_v')) return false
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return VARIANT_SOURCE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export function imageVariantKey(width: ImageVariantWidth, storedName: string): string {
  return `variants/w${width}/${storedName}.webp`
}

/**
 * Parses the part of the request path AFTER `/uploads/`.
 *
 * Returns:
 *   - `null`       -- not a variant request at all (serve it as an upload)
 *   - `'invalid'`  -- a variant request that must be refused (404)
 *   - the request  -- a valid width and stored name
 */
export function parseImageVariantPath(uploadRelativePath: string): ImageVariantRequest | 'invalid' | null {
  const raw = String(uploadRelativePath || '')
  if (!raw.startsWith(IMAGE_VARIANT_PATH_PREFIX)) return null
  const rest = raw.slice(IMAGE_VARIANT_PATH_PREFIX.length)
  const match = /^w(\d{1,4})\/(.+)$/.exec(rest)
  if (!match) return 'invalid'
  const width = Number(match[1])
  if (!isImageVariantWidth(width) || match[1] !== String(width)) return 'invalid'
  const storedName = match[2]
  if (!isSafeVariantSourceName(storedName)) return 'invalid'
  return {
    width,
    storedName,
    originalKey: `uploads/${storedName}`,
    variantKey: imageVariantKey(width, storedName),
  }
}

// ---------------------------------------------------------------------------
// Serving.
//
// Lives here rather than in lib/r2.ts because it needs quotaGuard (and so
// D1), and r2.ts is loaded dependency-free by the backup tests. index.ts's
// public `/uploads/*` handler calls serveUpload; everything that is not a
// variant request goes straight to serveObject exactly as before.

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void }

/** Browsers re-ask after this long when they got the ORIGINAL for a variant URL. */
export const IMAGE_VARIANT_FALLBACK_CACHE_CONTROL = 'public, max-age=300'
const IMAGE_VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const IMAGE_VARIANT_QUALITY = 80

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'cache-control': IMAGE_VARIANT_FALLBACK_CACHE_CONTROL } })
}

/**
 * The public `/uploads/*` entry point. `requestPath` is the request's path
 * (`/uploads/...`), exactly what index.ts already derives its key from.
 */
export async function serveUpload(env: Env, requestPath: string, request: Request, ctx?: WaitUntilContext): Promise<Response> {
  const relative = String(requestPath || '').replace(/^\/uploads\//, '')
  const variant = parseImageVariantPath(relative)
  if (variant === null) return serveObject(env.ASSETS, `uploads/${relative}`, request, ctx)
  if (variant === 'invalid') return notFound()
  return serveImageVariant(env, variant, request, ctx)
}

/**
 * The ORIGINAL, served for a variant URL with a short cache lifetime, so the
 * browser asks again later and upgrades once a variant can be produced.
 * Deliberately never written to the edge cache under the variant URL.
 */
function originalAsFallback(variant: ImageVariantRequest, original: R2ObjectBody): Response {
  // Typed by the original's extension alone: a variant source always has an
  // image extension (isSafeVariantSourceName), and the uploader's stored
  // type is never an input to the serving policy.
  const headers = applySafeUploadHeaders(new Headers(), variant.originalKey)
  // Unreachable for a name that passed isSafeVariantSourceName (every source
  // extension is servable), but the serving policy stays the single authority.
  if (!headers) return notFound()
  headers.set('cache-control', IMAGE_VARIANT_FALLBACK_CACHE_CONTROL)
  return new Response(original.body, { headers })
}

async function refetchOriginalAsFallback(env: Env, variant: ImageVariantRequest): Promise<Response> {
  try {
    const original = await env.ASSETS.get(variant.originalKey)
    return original ? originalAsFallback(variant, original) : notFound()
  } catch {
    return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } })
  }
}

/**
 * hit  -> the persisted variant (immutable, R2 ETag, edge-cached)
 * miss -> meter one transformation, transform, persist in waitUntil, serve
 * no binding / quota spent / any failure -> the original, max-age=300
 *
 * Never a 500: every failure after validation degrades to the original.
 */
export async function serveImageVariant(env: Env, variant: ImageVariantRequest, request: Request, ctx?: WaitUntilContext): Promise<Response> {
  try {
    const hit = await serveStoredObject(env.ASSETS, variant.variantKey, request, ctx)
    if (hit) return hit
  } catch {
    // A failed variant read is a miss, not an error.
  }

  let original: R2ObjectBody | null
  try {
    original = await env.ASSETS.get(variant.originalKey)
  } catch {
    return refetchOriginalAsFallback(env, variant)
  }
  // Checked BEFORE any quota is spent, so probing random names costs nothing.
  if (!original) return notFound()
  if (!env.IMAGES) return originalAsFallback(variant, original)

  try {
    const quota = await consumeQuota(env, 'cf_images_transform')
    // Image work leaves the video reserve alone (quotaGuard VIDEO_RESERVE).
    if (!quota.allowed || quota.reservedZone === 'exhausted') return originalAsFallback(variant, original)
  } catch {
    return originalAsFallback(variant, original)
  }

  try {
    const result = await env.IMAGES
      .input(original.body)
      // Never enlarges: a source narrower than the width comes back as-is.
      .transform({ width: variant.width, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: IMAGE_VARIANT_QUALITY })
    const bytes = await result.response().arrayBuffer()
    if (!bytes.byteLength) throw new Error('empty transform output')
    const persist = env.ASSETS
      .put(variant.variantKey, bytes, { httpMetadata: { contentType: 'image/webp' } })
      .then(() => undefined, () => undefined)
    if (ctx) ctx.waitUntil(persist)
    else await persist
    const headers = applySafeUploadHeaders(new Headers(), variant.variantKey, 'image/webp')
    if (!headers) throw new Error('variant key not servable')
    headers.set('cache-control', IMAGE_VARIANT_CACHE_CONTROL)
    return new Response(bytes, { headers })
  } catch {
    // Includes 9422 (monthly transformation limit) and undecodable input.
    // The original's body was handed to the transformer, so read it again.
    return refetchOriginalAsFallback(env, variant)
  }
}
