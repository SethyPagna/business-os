// Ported from backend/src/fileAssets.ts. No native dependencies in this
// slice -- pure string logic, so it's an exact behavioral port, not an
// approximation.

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.csv'])

export type MediaType = 'image' | 'video' | 'document' | 'file'

function extname(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName)
  return match ? match[0].toLowerCase() : ''
}

export function getMediaType(mimeType: string, fileName: string): MediaType {
  const lowered = mimeType.toLowerCase()
  const ext = extname(fileName)
  if (lowered.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (lowered.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (lowered === 'application/pdf' || lowered === 'text/csv' || lowered === 'application/csv' || lowered === 'application/vnd.ms-excel' || DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  return 'file'
}

const MAX_ORIGINAL_FILE_NAME_LENGTH = 180

// Strips path separators and control characters, matching the original's
// sanitizeOriginalFileName -- this is the name shown to admins, not the
// name used as the R2 object key (see buildUniqueStoredName below).
//
// Disallowed characters render as '-' (Part 242), same convention as
// importImageMatch.ts's sanitizeBaseName -- see that function's comment
// for the full rationale (visually obvious substitution, run-collapsing,
// trimmed edges) and why this needed to be applied consistently across
// every place a product/file name gets turned into a safe filename.
export function sanitizeOriginalFileName(originalName: string): string {
  const normalized = String(originalName || '').trim().replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  const base = (lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]*-[\s-]*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, MAX_ORIGINAL_FILE_NAME_LENGTH)
  return base || 'file'
}

// The R2 object key / stored filename -- always unique via a timestamp +
// random suffix (the original does this whenever object storage is
// enabled, which for the Workers path is always, since there is no local
// disk to fall back to).
export function buildUniqueStoredName(originalName: string): string {
  const safeName = sanitizeOriginalFileName(originalName)
  const ext = extname(safeName) || '.bin'
  const base = safeName.slice(0, safeName.length - ext.length) || 'file'
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `${base}-${Date.now()}-${randomSuffix}${ext}`
}
