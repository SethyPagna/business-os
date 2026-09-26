// Ported from backend/src/fileAssets.ts. No native dependencies in this
// slice -- pure string logic, so it's an exact behavioral port, not an
// approximation.

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.csv'])

export type MediaType = 'image' | 'video' | 'document' | 'file'

export interface PhysicalStorageSummary {
  totalBytes: number
  fileCount: number
  countsByType: Record<MediaType, number>
}

export function normalizePhysicalStorageSummary(row: Record<string, unknown> | null | undefined): PhysicalStorageSummary {
  const count = (value: unknown) => Math.max(0, Number(value) || 0)
  return {
    totalBytes: count(row?.total_bytes),
    fileCount: count(row?.file_count),
    countsByType: {
      image: count(row?.image_count),
      video: count(row?.video_count),
      document: count(row?.document_count),
      file: count(row?.other_count),
    },
  }
}

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
//
// S-uploads (2026-09-26), owner direction: the public /uploads prefix is
// for IMAGES ONLY. Library PDF, CSV and XLSX files are
// written under PRIVATE_LIBRARY_PREFIX, which index.ts's public
// /uploads/* route cannot reach (it only ever reads `uploads/<path>`), and
// its file_assets.public_path is the authenticated route below instead of
// an /uploads URL. Rows written before this change keep their /uploads
// public_path and stay where they are; storageKeyForAsset reads either.
// (Video stays public pending an owner ruling -- uploadSecurity.ts's
// isPublicUploadFormat.)
export const PUBLIC_UPLOADS_PREFIX = 'uploads/'
export const PRIVATE_LIBRARY_PREFIX = 'private/library/'
export const PRIVATE_LIBRARY_ROUTE = '/api/files/private/'

export function publicPathForStoredName(storedName: string, isPublic: boolean): string {
  return isPublic ? `/${PUBLIC_UPLOADS_PREFIX}${storedName}` : `${PRIVATE_LIBRARY_ROUTE}${encodeURIComponent(storedName)}`
}

export function storageKeyForStoredName(storedName: string, isPublic: boolean): string {
  return `${isPublic ? PUBLIC_UPLOADS_PREFIX : PRIVATE_LIBRARY_PREFIX}${storedName}`
}

// The R2 key of an existing file_assets row: private rows are recognised by
// their public_path, everything else (every pre-existing row) is uploads/.
export function storageKeyForAsset(asset: { stored_name: string; public_path?: string | null }): string {
  const isPrivate = String(asset.public_path || '').startsWith(PRIVATE_LIBRARY_ROUTE)
  return storageKeyForStoredName(String(asset.stored_name || ''), !isPrivate)
}

//
// S-uploads (2026-09-26): the extension is never the client's to choose.
// A caller that classified the bytes passes the detected extension
// (lib/uploadSecurity.ts's detectUploadFormat); otherwise the client's
// extension survives only when it is on STORED_EXTENSION_ALLOWLIST, and
// anything else (.html, .svg, .xml, .js ...) is stored as .bin.
const STORED_EXTENSION_ALLOWLIST = new Set([
  ...IMAGE_EXTENSIONS, '.avif', '.heic', '.heif',
  ...VIDEO_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS, '.tsv', '.txt', '.xlsx', '.xls', '.xlsm', '.zip', '.json',
])

export function safeStoredExtension(fileName: string): string {
  const ext = extname(fileName)
  return STORED_EXTENSION_ALLOWLIST.has(ext) ? ext : '.bin'
}

export function buildUniqueStoredName(originalName: string, detectedExtension?: string): string {
  const safeName = sanitizeOriginalFileName(originalName)
  const clientExt = extname(safeName)
  const base = (clientExt ? safeName.slice(0, safeName.length - clientExt.length) : safeName) || 'file'
  const forced = detectedExtension ? String(detectedExtension).toLowerCase() : ''
  const ext = /^\.[a-z0-9]{1,8}$/.test(forced) ? forced : safeStoredExtension(safeName)
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `${base}-${Date.now()}-${randomSuffix}${ext}`
}
