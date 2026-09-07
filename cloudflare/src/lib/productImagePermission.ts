import { sanitizeMediaList, sanitizeMediaPath } from './media'

export type ProductImageState = {
  image_path?: unknown
  image_gallery?: unknown
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
