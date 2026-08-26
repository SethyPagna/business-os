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

/**
 * Quality ladder, highest first.
 *
 * Walked in order and the FIRST result at or under the ceiling is taken --
 * which, because quality is monotonically decreasing, is by construction the
 * best-looking one that fits. This is the same rule the browser pipeline uses,
 * and it exists because the obvious alternative (keep the smallest) is what
 * made stored images sit far below their budget.
 *
 * 85 first because that is where the quality/size curve turns: above it the
 * file grows fast for gains the eye does not register.
 */
const QUALITY_LADDER = [85, 80, 72, 65, 58] as const

/** AVIF first: 30-50% smaller than JPEG at equal quality, WebP a close second. */
const FORMAT_LADDER = ['image/avif', 'image/webp'] as const

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
    for (const quality of QUALITY_LADDER) {
      // A fresh stream per attempt: a ReadableStream is single-use, so
      // reusing one silently yields an empty body on the second try.
      const stream = new Blob([source]).stream()
      try {
        const result = await env.IMAGES
          .input(stream)
          .transform({ width: IMAGE_MAX_DIMENSION })
          .output({ format, quality })
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
  // Step down at 'critical' rather than 'exhausted', so Cloudflare keeps
  // headroom for work that has no alternative.
  if (cloudflareBudget.zone !== 'critical' && cloudflareBudget.zone !== 'exhausted') {
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
  if (cloudinaryBudget.zone !== 'exhausted') {
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
