// Server-side image optimisation, with a provider ladder and honest fallbacks.
//
// THE PROBLEM THIS SOLVES
//
// New uploads are already handled in the browser (utils/imageCompression.ts:
// 300-350KB band, stepped downscaling, WebP). But images ALREADY in R2 --
// the MB-sized ones uploaded before any of that existed -- have never had a
// server-side path, because this Worker had no image processing at all. That
// is the whole reason the backfill could not be built.
//
// THE LADDER, and why it is in this order
//
//   1. Cloudflare Images binding  -- 5,000 unique transformations/month free,
//      explicitly covering images stored OUTSIDE Images (ours, in R2). Same
//      account, no egress, no extra credentials. `.info()` is not billed at
//      all, which is what makes auditing free. First choice.
//
//   2. Cloudinary                 -- 25 credits/month, roughly 25,000
//      transformations. A genuinely separate quota, so it keeps working on
//      the day Cloudflare's 5,000 runs out. Costs a round trip and needs
//      credentials, so it is the fallback rather than the default.
//
//   3. Neither                    -- report why. NOT "pretend it worked".
//
// Every step is metered through quotaGuard, so the ladder degrades before it
// hits a wall rather than after: at 'critical' on Cloudflare we move to
// Cloudinary while Cloudflare still has headroom for anything that genuinely
// needs it.
//
// WHAT THIS DOES NOT DO
//
// It never deletes or overwrites an original in place. A caller decides what
// to do with the bytes it gets back, and the audit path only ever writes a
// derivative. Losing an original to a failed optimisation would be
// unrecoverable, and no amount of storage saved is worth that.

import type { Env } from '../index'
import { consumeQuota, readQuota } from './quotaGuard'
import { recordAnalytics } from './analytics'

/** Hard ceiling. Mirrors the browser's IMAGE_SIZE_CEILING_BYTES. */
export const IMAGE_MAX_BYTES = 350 * 1024
/** Floor. Landing far below the cap throws away quality nobody asked to save. */
export const IMAGE_TARGET_BYTES = 300 * 1024
/** Longest edge for a stored image, matching the browser pipeline. */
export const IMAGE_MAX_DIMENSION = 2560

export type ImageProvider = 'cloudflare' | 'cloudinary' | 'none'

export type OptimizeResult = {
  ok: boolean
  provider: ImageProvider
  bytes?: ArrayBuffer
  contentType?: string
  byteSize?: number
  /** Why it did not happen. Present only when ok is false. */
  reason?: string
}

// The attempt plan, ordered LEAST destructive first.
//
// Three levers get a file under the ceiling, and they are not equally costly
// to how the image looks:
//
//   1. FORMAT   -- free. AVIF is 30-50% smaller than JPEG at the same
//                  perceptual quality. Changing container costs nothing
//                  visually, so it is always tried first.
//   2. DIMENSION-- cheap. A photo shown at 1280px loses nothing real by being
//                  stored at 1280px, and a smaller image at HIGH quality
//                  looks better than a large one that has been crushed.
//   3. QUALITY  -- crude. This is what produces the blocking and smearing
//                  that made compressed images look bad, so it is the LAST
//                  lever and only used once format and size are exhausted.
//
// The previous plan had this backwards: it held the dimension at 2560 and
// walked quality down immediately, so the very first fallback for a large
// photo was the most visually damaging one available.
//
// Ordering matters beyond taste: the loop takes the FIRST result under the
// ceiling, so whatever comes first in this list is what most images get.
const MAX_QUALITY = 85
const DIMENSION_LADDER = [2560, 2048, 1600, 1280] as const
// Only reached when every dimension at full quality is still too big -- a
// dense photograph, typically. Applied at the smallest dimension.
const QUALITY_FALLBACK = [80, 72, 65, 58] as const
/** AVIF first: smaller at equal quality. WebP when AVIF cannot be produced. */
const FORMAT_LADDER = ['image/avif', 'image/webp'] as const

type OutputFormat = typeof FORMAT_LADDER[number]
export type TransformAttempt = { format: OutputFormat; width: number; quality: number }

/**
 * Every attempt for one format, in order of increasing visual damage.
 *
 * Exported so the ordering is directly testable -- a regression here would be
 * invisible in the output (files would still be under the ceiling) but would
 * quietly make every stored image worse.
 */
export function buildAttemptPlan(format: OutputFormat): TransformAttempt[] {
  const attempts: TransformAttempt[] = DIMENSION_LADDER.map((width) => ({ format, width, quality: MAX_QUALITY }))
  const smallest = DIMENSION_LADDER[DIMENSION_LADDER.length - 1]
  for (const quality of QUALITY_FALLBACK) attempts.push({ format, width: smallest, quality })
  return attempts
}

export type ImageInfo = { format?: string; fileSize?: number; width?: number; height?: number }

/**
 * Reads an image's real dimensions and size.
 *
 * Free on Cloudflare's side -- `.info()` is explicitly not billed -- which is
 * what lets the 6-hourly audit inspect the whole library without spending
 * transformation quota. Returns null when the binding is absent or the object
 * is not a decodable image; the caller treats that as "cannot assess", never
 * as "fine".
 */
export async function readImageInfo(env: Env, body: ReadableStream | null): Promise<ImageInfo | null> {
  if (!env.IMAGES || !body) return null
  try {
    return (await env.IMAGES.info(body)) as ImageInfo
  } catch {
    return null
  }
}

/** True when a stored object is outside the band and worth reprocessing. */
export function needsOptimization(byteSize: number): boolean {
  return byteSize > IMAGE_MAX_BYTES
}

async function optimizeWithCloudflare(env: Env, source: ArrayBuffer): Promise<OptimizeResult> {
  if (!env.IMAGES) return { ok: false, provider: 'cloudflare', reason: 'binding_absent' }

  for (const format of FORMAT_LADDER) {
    for (const attempt of buildAttemptPlan(format)) {
      // A fresh stream per attempt: a ReadableStream is single-use, so
      // reusing one silently yields an empty body on the second try.
      const stream = new Blob([source]).stream()
      try {
        const result = await env.IMAGES
          .input(stream)
          // c_limit semantics: never enlarge a source that is already smaller.
          .transform({ width: attempt.width, fit: 'scale-down' })
          .output({ format: attempt.format, quality: attempt.quality })
        const bytes = await result.response().arrayBuffer()
        if (bytes.byteLength <= IMAGE_MAX_BYTES) {
          return { ok: true, provider: 'cloudflare', bytes, contentType: format, byteSize: bytes.byteLength }
        }
      } catch (error) {
        const message = String((error as Error)?.message || error)
        // 9422 is the documented "monthly transformation limit reached".
        // Distinguished from a decode failure because the right response is
        // different: move to the next provider, not the next quality step.
        if (message.includes('9422')) {
          return { ok: false, provider: 'cloudflare', reason: 'quota_exhausted' }
        }
        // An unsupported input format fails the same way at every quality, so
        // try the next FORMAT rather than grinding through the ladder.
        break
      }
    }
  }
  return { ok: false, provider: 'cloudflare', reason: 'could_not_reach_ceiling' }
}

/**
 * Cloudinary's signature: SHA-1 of the sorted params plus the API secret.
 *
 * Signed rather than an unsigned preset, deliberately. An unsigned preset is
 * a public endpoint anyone who learns the cloud name can upload through, and
 * it needs dashboard setup to exist at all. Signing keeps the credential in
 * `wrangler secret` and leaves nothing publicly writable.
 */
async function cloudinarySignature(params: Record<string, string>, apiSecret: string): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign + apiSecret))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function optimizeWithCloudinary(env: Env, source: ArrayBuffer, fileName: string): Promise<OptimizeResult> {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim()
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim()
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim()
  if (!cloudName || !apiKey || !apiSecret) return { ok: false, provider: 'cloudinary', reason: 'not_configured' }

  try {
    const timestamp = String(Math.floor(Date.now() / 1000))
    // q_auto:good sits in the same perceptual place as the 80-85 range used
    // above; f_auto lets Cloudinary pick AVIF/WebP by capability; c_limit
    // never upscales, so a small source is left at its own size.
    const transformation = `c_limit,w_${IMAGE_MAX_DIMENSION}/q_auto:good/f_auto`
    // Only the params Cloudinary signs -- file and api_key are excluded from
    // the signature by its own spec, and including them makes every upload
    // fail with an opaque 401.
    const signed: Record<string, string> = { timestamp, transformation }
    const signature = await cloudinarySignature(signed, apiSecret)

    const form = new FormData()
    form.append('file', new Blob([source]), fileName || 'image')
    form.append('api_key', apiKey)
    form.append('timestamp', timestamp)
    form.append('transformation', transformation)
    form.append('signature', signature)

    const upload = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form })
    if (!upload.ok) return { ok: false, provider: 'cloudinary', reason: `upload_failed_${upload.status}` }
    const payload = (await upload.json()) as { secure_url?: string }
    if (!payload?.secure_url) return { ok: false, provider: 'cloudinary', reason: 'no_url_returned' }

    const derived = await fetch(payload.secure_url)
    if (!derived.ok) return { ok: false, provider: 'cloudinary', reason: `fetch_failed_${derived.status}` }
    const bytes = await derived.arrayBuffer()
    if (bytes.byteLength > IMAGE_MAX_BYTES) {
      return { ok: false, provider: 'cloudinary', reason: 'could_not_reach_ceiling' }
    }
    return {
      ok: true,
      provider: 'cloudinary',
      bytes,
      contentType: derived.headers.get('content-type') || 'image/webp',
      byteSize: bytes.byteLength,
    }
  } catch (error) {
    return { ok: false, provider: 'cloudinary', reason: String((error as Error)?.message || error).slice(0, 120) }
  }
}

/**
 * Optimises one image, trying each provider in turn.
 *
 * Returns ok:false with a reason rather than throwing. This runs from a cron
 * sweep over thousands of objects, where one undecodable file must not stop
 * the pass -- and a caller that cannot tell "already small enough" from
 * "provider is down" would make exactly the wrong decision about the original.
 */
export async function optimizeImage(
  env: Env,
  source: ArrayBuffer,
  fileName = 'image',
): Promise<OptimizeResult> {
  // Already inside the band: the cheapest possible answer, and the most
  // common one once a backfill has run.
  if (source.byteLength <= IMAGE_MAX_BYTES) {
    return { ok: false, provider: 'none', reason: 'already_within_band' }
  }

  const cloudflareBudget = await readQuota(env, 'cf_images_transform')
  // reservedZone, not zone: image work must stop before it eats the slice
  // held back for video. An image that misses a pass is merely larger than
  // ideal and the next sweep catches it; a video that cannot be processed is
  // a feature that does not work.
  //
  // Step down at 'critical' rather than 'exhausted' on top of that, so
  // Cloudflare keeps headroom for anything with no alternative.
  if (cloudflareBudget.reservedZone !== 'critical' && cloudflareBudget.reservedZone !== 'exhausted') {
    const result = await optimizeWithCloudflare(env, source)
    if (result.ok) {
      await consumeQuota(env, 'cf_images_transform', 1)
      recordAnalytics(env, {
        kind: 'image_optimized',
        labels: ['cloudflare', result.contentType || ''],
        values: [source.byteLength, result.byteSize || 0],
      })
      return result
    }
    // Only a real quota wall is worth recording; a per-file decode failure is
    // noise at this volume.
    if (result.reason === 'quota_exhausted') {
      recordAnalytics(env, { kind: 'image_provider_exhausted', labels: ['cloudflare'], values: [] })
    }
  }

  const cloudinaryBudget = await readQuota(env, 'cloudinary_transform')
  if (cloudinaryBudget.reservedZone !== 'exhausted') {
    const result = await optimizeWithCloudinary(env, source, fileName)
    if (result.ok) {
      await consumeQuota(env, 'cloudinary_transform', 1)
      recordAnalytics(env, {
        kind: 'image_optimized',
        labels: ['cloudinary', result.contentType || ''],
        values: [source.byteLength, result.byteSize || 0],
      })
      return result
    }
    return { ok: false, provider: 'cloudinary', reason: result.reason || 'failed' }
  }

  return { ok: false, provider: 'none', reason: 'no_provider_available' }
}
