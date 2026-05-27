export function normalizeProductGallery(value: unknown, fallback?: unknown, limit?: unknown): string[]
export function getProductGalleryImages(product?: Record<string, unknown>, limit?: unknown): string[]
export function buildProductThumbnailState(product?: Record<string, unknown>, limit?: unknown): {
  gallery: string[]
  hasImage: boolean
  thumbnail: string
}
export function resolveProductImageUrl(src: unknown): string
export function clampProductLightboxIndex(index: unknown, imageCount: unknown): number
export function buildProductLightboxState(gallery: unknown, startIndex?: unknown, title?: string): {
  images: string[]
  index: number
  title: string
} | null
export function buildProductLightboxGalleryInput(src: unknown, gallery: unknown): string[]
export function updateProductLightboxIndex(lightbox: {
  images?: string[]
  index?: number
  [key: string]: unknown
} | null | undefined, nextIndex: unknown): {
  images?: string[]
  index?: number
  [key: string]: unknown
} | null
