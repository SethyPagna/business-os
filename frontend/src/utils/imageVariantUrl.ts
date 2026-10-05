// URLs of the small, persisted copies of an uploaded image.
//
// A stored product photo is ~0.84 MB (imageCompression keeps new uploads in a
// quality band on purpose) but a grid tile is ~150 px, so every thumbnail used
// to download the original. The Worker serves
//
//   GET /uploads/_v/w<W>/<stored name>   ->   variants/w<W>/<stored name>.webp
//
// (cloudflare/src/lib/imageVariants.ts), and falls back to the ORIGINAL bytes
// while no variant exists, so asking for one is always safe.
//
// RULE DUPLICATED ACROSS PACKAGES: the widths and the "which names have a
// variant" test below mirror cloudflare/src/lib/imageVariants.ts
// (IMAGE_VARIANT_WIDTHS, isSafeVariantSourceName). The Worker refuses
// (404) any name this module would accept but it would not, and the image then
// falls back to the original, so drift costs the saving, not the picture. cloudflare/scripts/test-image-variant-url-parity-pure.cjs
// runs both implementations against each other.
//
// Pure: no DOM, no fetch -- testable in Node.

/** Widths the Worker will produce. Anything else is a 404 there. */
export const IMAGE_VARIANT_WIDTHS = [160, 320, 640] as const
export type ImageVariantWidth = typeof IMAGE_VARIANT_WIDTHS[number]

/** The width a grid / list thumbnail asks for (and the browser uploads at upload time). */
export const THUMBNAIL_VARIANT_WIDTH: ImageVariantWidth = 320
/** The larger width the browser uploads for dense displays (storefront cards). */
export const THUMBNAIL_VARIANT_WIDTH_2X: ImageVariantWidth = 640

// A SUBSET of the Worker's list: '.gif' is left out on purpose. A variant is a
// still WebP, and flattening an animated GIF would change what it shows.
const VARIANT_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif'])
const MAX_STORED_NAME_LENGTH = 255
const UPLOADS_PREFIX = '/uploads/'

/**
 * The stored name inside an `/uploads/<name>` path (a `?v=` cache-buster or
 * `#fragment` is dropped), or null when the value is not a plain upload path:
 * an absolute URL (an external CDN image), a data:/blob: URL, a nested path,
 * or anything that is not one URL-safe segment.
 */
export function storedUploadName(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const path = raw.startsWith(UPLOADS_PREFIX) ? raw : raw.startsWith('uploads/') ? `/${raw}` : ''
  if (!path) return null
  const name = path.slice(UPLOADS_PREFIX.length).split(/[?#]/, 1)[0]
  if (!name) return null
  return name
}

/**
 * True when the Worker can build a variant of `name`. Mirrors
 * isSafeVariantSourceName, plus `%`: a name that already contains percent
 * escapes is ambiguous between its raw and decoded forms, so it keeps the
 * (working) original URL rather than risk a variant URL the Worker reads as a
 * different name.
 */
export function hasImageVariant(name: string): boolean {
  if (!name || name.length > MAX_STORED_NAME_LENGTH) return false
  if (name === '.' || name === '..') return false
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f\u007f%]/.test(name)) return false
  if (name.startsWith('_v')) return false
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return VARIANT_SOURCE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

/**
 * `/uploads/<name>` -> `/uploads/_v/w<width>/<name>`, or null when the value
 * has no variant (callers then keep the original URL). The result carries NO
 * `?v=` build stamp on purpose: a stored name is unique and its variant never
 * changes, so the URL can stay cached across deploys.
 */
export function toImageVariantPath(value: unknown, width: ImageVariantWidth = THUMBNAIL_VARIANT_WIDTH): string | null {
  const name = storedUploadName(value)
  if (name === null || !hasImageVariant(name)) return null
  return `${UPLOADS_PREFIX}_v/w${width}/${name}`
}

/**
 * `<w320 url> 320w, <w640 url> 640w` for an `<img srcset>`, built by the
 * caller's own URL resolver (so the asset host / base URL rules still apply),
 * or '' when the value has no variant.
 */
export function imageVariantSrcSet(value: unknown, resolve: (variantPath: string) => string, widths: readonly ImageVariantWidth[] = [THUMBNAIL_VARIANT_WIDTH, THUMBNAIL_VARIANT_WIDTH_2X]): string {
  const parts: string[] = []
  for (const width of widths) {
    const path = toImageVariantPath(value, width)
    if (!path) return ''
    parts.push(`${resolve(path)} ${width}w`)
  }
  return parts.join(', ')
}

/**
 * Pixel size of a variant of a `width` x `height` source: scaled to
 * `targetWidth` wide, never enlarged (the Worker's `fit: 'scale-down'`).
 */
export function computeVariantDimensions(width: number, height: number, targetWidth: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 1, height: 1 }
  if (width <= targetWidth) return { width: Math.round(width), height: Math.round(height) }
  return { width: Math.round(targetWidth), height: Math.max(1, Math.round(height * (targetWidth / width))) }
}
