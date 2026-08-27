import { sanitizeOriginalFileName } from './fileAssets'

function extensionOf(name: unknown): string {
  const match = /\.[a-z0-9]{1,10}$/i.exec(String(name || ''))
  return match?.[0]?.toLowerCase() || ''
}

/** Display/download name for one logical product reference to one object. */
export function logicalLibraryName(originalName: unknown, productName: unknown): string {
  if (!String(productName || '').trim()) return sanitizeOriginalFileName(String(originalName || 'file'))
  // A product name is label text, not a path. Replace separators before the
  // generic filename sanitizer (which intentionally keeps only the final
  // path segment for real uploaded paths) so "Brand / Shade" does not lose
  // "Brand" when converted into a download name.
  const safeLabel = String(productName).trim().replace(/[\\/]+/g, '-')
  return sanitizeOriginalFileName(`${safeLabel}_1${extensionOf(originalName)}`)
}
