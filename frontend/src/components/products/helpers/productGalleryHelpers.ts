import { resolvePublicAssetUrl } from '../../../utils/publicAssetUrls.ts'

// Single source of truth for the frontend's per-product image cap --
// mirrors cloudflare/src/lib/importImageMatch.ts's MAX_IMAGES_PER_PRODUCT
// (kept as a separate constant since the frontend bundle can't import
// from the Worker's source tree, but every call site below that used to
// hardcode `5` now reads this one value instead, so lowering the cap only
// ever needs to happen in these two places). Lowered from 5 to 3 per
// explicit user direction -- applies uniformly to every product row,
// including each "child row"/variant in a group (a variant is just
// another product row, so it already goes through this exact same cap).
export const MAX_PRODUCT_GALLERY_IMAGES = 3

interface ProductGalleryRecord {
  image_gallery?: unknown
  image_path?: unknown
  [key: string]: unknown
}

interface ProductThumbnailState {
  gallery: string[]
  hasImage: boolean
  thumbnail: string
}

interface ProductLightboxState {
  images: string[]
  index: number
  title: string
}

interface ProductLightboxLike {
  images?: string[]
  index?: number
  [key: string]: unknown
}

export function normalizeProductGallery(value: unknown, fallback: unknown = null, limit: unknown = MAX_PRODUCT_GALLERY_IMAGES): string[] {
  const maxItems = Math.max(0, Number(limit || 0))
  if (!maxItems) return []

  let input: unknown[] = []
  if (Array.isArray(value)) {
    input = value
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      input = Array.isArray(parsed) ? parsed : value.split('|')
    } catch {
      input = value.split('|')
    }
  }

  const seen = new Set<string>()
  const list: string[] = []
  for (const entry of input) {
    const path = String(entry || '').trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    list.push(path)
    if (list.length >= maxItems) break
  }

  const fallbackValue = String(fallback || '').trim()
  if (!list.length && fallbackValue) list.push(fallbackValue)
  return list.slice(0, maxItems)
}

export function getProductGalleryImages(product?: ProductGalleryRecord | null, limit: unknown = MAX_PRODUCT_GALLERY_IMAGES): string[] {
  return normalizeProductGallery(product?.image_gallery, product?.image_path || null, limit)
}

export function buildProductThumbnailState(product?: ProductGalleryRecord | null, limit: unknown = MAX_PRODUCT_GALLERY_IMAGES): ProductThumbnailState {
  const gallery = getProductGalleryImages(product, limit)
  return {
    gallery,
    hasImage: gallery.length > 0,
    thumbnail: gallery[0] || '',
  }
}

export function resolveProductImageUrl(src: unknown): string {
  const raw = String(src || '').trim()
  if (!raw) return ''
  return resolvePublicAssetUrl(raw)
}

export function clampProductLightboxIndex(index: unknown, imageCount: unknown): number {
  const total = Math.max(0, Number(imageCount || 0))
  if (!total) return 0
  const numericIndex = Number(index)
  const safeIndex = Number.isFinite(numericIndex) ? numericIndex : 0
  return Math.max(0, Math.min(safeIndex, total - 1))
}

export function buildProductLightboxState(
  gallery: unknown,
  startIndex: unknown = 0,
  title = '',
): ProductLightboxState | null {
  const images = normalizeProductGallery(gallery).map(resolveProductImageUrl).filter(Boolean)
  if (!images.length) return null
  const index = clampProductLightboxIndex(startIndex, images.length)
  return { images, index, title }
}

export function buildProductLightboxGalleryInput(src: unknown, gallery: unknown): string[] {
  const normalizedGallery = normalizeProductGallery(Array.isArray(gallery) ? gallery : [])
  if (normalizedGallery.length) return normalizedGallery
  return normalizeProductGallery([src])
}

export function updateProductLightboxIndex(
  lightbox: ProductLightboxLike | null | undefined,
  nextIndex: unknown,
): ProductLightboxLike | null {
  if (!lightbox?.images?.length) return lightbox || null
  return {
    ...lightbox,
    index: clampProductLightboxIndex(nextIndex, lightbox.images.length),
  }
}
