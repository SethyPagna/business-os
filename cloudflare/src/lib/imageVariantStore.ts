// Writing and deleting persisted image variants (the read half is
// lib/imageVariants.ts, served by GET /uploads/_v/w<W>/<name>).
//
// WHY THE BROWSER MAKES THE THUMBNAILS
//
// A stored original is ~0.84 MB (utils/imageCompression.ts keeps new uploads
// in a quality band on purpose), but a POS/catalog tile is ~150 px. Shrinking
// it on the Worker is not an option on the Free plan (10 ms CPU, no native
// image library, and the Cloudflare Images binding is capped at 5,000 unique
// transformations a month). The uploader's browser already decoded the photo
// to compress it, so it also encodes a 320 px and a 640 px WebP (~20 and ~60 KB)
// and sends them in the SAME multipart request. The Worker only validates the bytes and
// copies them to R2: no decode, no CPU worth measuring, no quota.
//
// Everything here is best effort and never throws. A missing, oversized or
// invalid thumbnail must not fail the upload it rides on: the variant URL
// falls back to the original (lib/imageVariants.ts), and the on-demand
// transform there (or the documented backfill) fills it later.

import type { Env } from '../index'
import { classifyUploadedBuffer } from './uploadSecurity'
import { IMAGE_VARIANT_WIDTHS, imageVariantKey, isSafeVariantSourceName, type ImageVariantWidth } from './imageVariants'

/**
 * Widths the browser makes at upload time, and the multipart field each rides
 * in. 320 serves the admin/POS lists and the storefront's small screens; 640
 * is the storefront card on a dense display (srcset). 160 is not made: a 320
 * file is ~20 KB already.
 */
export const CLIENT_VARIANT_WIDTHS = [320, 640] as const satisfies readonly ImageVariantWidth[]
export type ClientVariantWidth = typeof CLIENT_VARIANT_WIDTHS[number]
export function clientVariantField(width: ClientVariantWidth): string {
  return `variant_w${width}`
}
/**
 * A 320 px WebP is 10-40 KB and a 640 px one 30-100 KB. These ceilings are
 * generous headroom for a noisy photo and still far below the original, so a
 * field cannot be used to park a large file under variants/.
 */
export const CLIENT_VARIANT_MAX_BYTES: Readonly<Record<ClientVariantWidth, number>> = { 320: 150 * 1024, 640: 350 * 1024 }

export type ClientVariantOutcome = 'stored' | 'absent' | 'rejected' | 'failed'

type VariantEnv = Pick<Env, 'ASSETS'>

function isBlobLike(value: unknown): value is Blob {
  return !!value && typeof value === 'object' && typeof (value as Blob).arrayBuffer === 'function' && typeof (value as Blob).size === 'number'
}

/**
 * Persists the browser-made thumbnails that came with an upload, if any.
 * `storedName` is the name the ORIGINAL was just stored under; each
 * thumbnail is only ever written at that name's variant key, so a client
 * cannot choose where it lands. One bad or missing width never affects the
 * other, and nothing here throws.
 */
export async function persistClientImageVariants(env: VariantEnv, storedName: string, form: FormData | null | undefined): Promise<Record<ClientVariantWidth, ClientVariantOutcome>> {
  const outcome = {} as Record<ClientVariantWidth, ClientVariantOutcome>
  for (const width of CLIENT_VARIANT_WIDTHS) outcome[width] = await persistOne(env, storedName, form, width)
  return outcome
}

async function persistOne(env: VariantEnv, storedName: string, form: FormData | null | undefined, width: ClientVariantWidth): Promise<ClientVariantOutcome> {
  const field = form ? form.get(clientVariantField(width)) : null
  if (field === null || field === undefined || field === '') return 'absent'
  if (!isBlobLike(field)) return 'rejected'
  if (!isSafeVariantSourceName(storedName)) return 'rejected'
  if (field.size === 0 || field.size > CLIENT_VARIANT_MAX_BYTES[width]) return 'rejected'
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await field.arrayBuffer())
    // The bytes decide, exactly as for every other public image: WebP only
    // (that is all the browser is asked for, and all the variant key says),
    // and the embedded-markup refusal applies. classifyUploadedBuffer throws
    // for anything else.
    if (classifyUploadedBuffer(bytes).mime !== 'image/webp') return 'rejected'
  } catch {
    return 'rejected'
  }
  try {
    await env.ASSETS.put(imageVariantKey(width, storedName), bytes, { httpMetadata: { contentType: 'image/webp' } })
    return 'stored'
  } catch {
    return 'failed'
  }
}

/** Every R2 key a stored original can have a variant under. */
export function variantKeysForStoredName(storedName: string): string[] {
  if (!isSafeVariantSourceName(storedName)) return []
  return IMAGE_VARIANT_WIDTHS.map((width) => imageVariantKey(width, storedName))
}

/** `uploads/<name>` -> `<name>`, or null for any key that is not a plain upload. */
export function storedNameFromUploadKey(key: string): string | null {
  const text = String(key || '').replace(/^\/+/, '')
  if (!text.startsWith('uploads/')) return null
  const name = text.slice('uploads/'.length)
  return isSafeVariantSourceName(name) ? name : null
}

/** Variant keys that go with a list of original `uploads/<name>` keys. */
export function variantKeysForUploadKeys(keys: readonly string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const name = storedNameFromUploadKey(key)
    if (name) out.push(...variantKeysForStoredName(name))
  }
  return out
}

/**
 * Deletes the variants of one original, and drops their edge-cache entries
 * (serveStoredObject caches a hit under the request URL, up to a year) so a
 * deleted photo does not keep answering from a variant. Best effort: a
 * failure leaves an orphaned thumbnail, never a failed delete.
 */
export async function deleteImageVariants(env: VariantEnv, storedName: string, cacheOrigin?: string): Promise<void> {
  const keys = variantKeysForStoredName(storedName)
  if (!keys.length) return
  try {
    await env.ASSETS.delete(keys)
  } catch {
    // Orphaned variants are harmless to correctness; see above.
  }
  if (!cacheOrigin || typeof caches === 'undefined') return
  for (const width of IMAGE_VARIANT_WIDTHS) {
    try {
      await caches.default.delete(new Request(new URL(`/uploads/_v/w${width}/${storedName}`, cacheOrigin).toString(), { method: 'GET' }))
    } catch {
      // Same: never surface a purge failure.
    }
  }
}
