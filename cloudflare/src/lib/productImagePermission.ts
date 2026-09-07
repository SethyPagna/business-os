import { sanitizeMediaList, sanitizeMediaPath } from './media'
import type { D1Compat } from './db'
import { buildInClause, chunkForBinding } from './sqlBinding'

export type ProductImageState = {
  image_path?: unknown
  image_gallery?: unknown
}

export class ProductImageAssetError extends Error {
  readonly code = 'missing_image_asset'
  constructor(readonly path: string) {
    super(`Image asset ${path} does not exist.`)
    this.name = 'ProductImageAssetError'
  }
}

function decodedUploadPathCandidate(path: string): string {
  if (!path.startsWith('/uploads/')) return path
  try {
    return decodeURI(path)
  } catch (_) {
    return path
  }
}

/** Resolve submitted upload identities exactly, then by one legacy decode. */
export async function resolveProductImageFields(db: D1Compat, body: Record<string, unknown>): Promise<void> {
  const hasPrimary = Object.prototype.hasOwnProperty.call(body, 'image_path')
  const hasGallery = Object.prototype.hasOwnProperty.call(body, 'image_gallery')
  if (!hasPrimary && !hasGallery) return
  const primary = hasPrimary ? sanitizeMediaPath(body.image_path, '') : ''
  const gallery = hasGallery ? sanitizeMediaList(body.image_gallery) : []
  const supplied = [...new Set([primary, ...gallery].filter((path) => path.startsWith('/uploads/')))]
  if (!supplied.length) return

  const candidates = [...new Set(supplied.flatMap((path) => [path, decodedUploadPathCandidate(path)]))]
  const assetPaths = new Set<string>()
  for (const chunk of chunkForBinding(candidates)) {
    const clause = buildInClause('path', chunk)
    const rows = await db.prepare(`SELECT public_path FROM file_assets WHERE public_path IN (${clause.sql})`)
      .all<{ public_path: string }>(clause.params)
    for (const row of rows) assetPaths.add(String(row.public_path))
  }
  const resolved = new Map<string, string>()
  for (const path of supplied) {
    const decoded = decodedUploadPathCandidate(path)
    const canonical = assetPaths.has(path) ? path : decoded !== path && assetPaths.has(decoded) ? decoded : ''
    if (!canonical) throw new ProductImageAssetError(path)
    resolved.set(path, canonical)
  }
  if (primary) body.image_path = resolved.get(primary) || primary
  if (hasGallery) body.image_gallery = gallery.map((path) => resolved.get(path) || path)
}

function sameOrderedPaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

/**
 * Answers whether the submitted image fields would change the product's
 * effective primary image or ordered gallery. Full product forms resend both
 * fields on every save, so field presence alone cannot be used as an image
 * permission check.
 */
export function productImageFieldsChanged(
  submitted: Record<string, unknown>,
  current?: ProductImageState | null,
): boolean {
  const hasPrimary = Object.prototype.hasOwnProperty.call(submitted, 'image_path')
  const hasGallery = Object.prototype.hasOwnProperty.call(submitted, 'image_gallery')
  if (!hasPrimary && !hasGallery) return false

  const submittedPrimary = sanitizeMediaPath(submitted.image_path, '')
  const submittedGallery = sanitizeMediaList(submitted.image_gallery)
  if (!current) {
    return (hasPrimary && Boolean(submittedPrimary)) || (hasGallery && submittedGallery.length > 0)
  }

  const currentPrimary = sanitizeMediaPath(current.image_path, '')
  const storedGallery = sanitizeMediaList(current.image_gallery)
  // Product reads expose the legacy primary as a one-item gallery when no
  // product_images rows exist. Compare that effective state so saving the
  // untouched form is not mistaken for a new gallery attachment.
  const currentGallery = storedGallery.length ? storedGallery : (currentPrimary ? [currentPrimary] : [])

  return (hasPrimary && submittedPrimary !== currentPrimary)
    || (hasGallery && !sameOrderedPaths(submittedGallery, currentGallery))
}

/** Remove fields proven unchanged so review/direct writers perform no image write. */
export function omitUnchangedProductImageFields(body: Record<string, unknown>): void {
  delete body.image_path
  delete body.image_gallery
}
