// Upload content-type validation, ported from backend/src/uploadSecurity.ts.
//
// detectBufferKind does magic-byte sniffing (checking the actual file
// signature, not trusting the client-supplied MIME type or extension) --
// pure buffer inspection with no native dependencies, so it ports directly
// and unchanged in spirit.
//
// NOT ported: backend/src/uploadSecurity.ts's validateImageMetadata, which
// uses `sharp` (a native binary) to check image dimensions/frame count and
// reject decompression-bomb-style images. Sharp cannot run in a Workers V8
// isolate at all -- same category of gap as ffmpeg (see queue.ts), not a
// simple oversight. The magic-byte check below still catches the more
// common attack (a disguised executable/script uploaded with a spoofed
// image extension); dimension-bomb protection would need Cloudflare Images
// or a Container to restore.
//
// S-uploads (2026-09-26, compliance audit P1-2): the store is an ALLOWLIST.
// Every uploaded buffer is classified by detectUploadFormat into one of the
// formats the app keeps; anything else is null and must be rejected. The
// stored content-type and extension come from the detected format, never
// from the client's File.type or file name, because /uploads/* serves the
// stored object on the admin origin: a client-chosen `text/html` or `.svg`
// there is stored XSS.
//
// Owner ruling (same day): storage holds ONLY images and videos -- JPEG,
// PNG, WebP, GIF, AVIF, and MP4/MOV/WebM. PDF, CSV, XLSX and every other
// document type are refused by the Library. Videos stay public (the
// storefront About block plays them to visitors). Import CSV/ZIP files are
// not Library files: they are temporary, job-scoped objects under imports/
// (classifyImportUpload below; lib/importIncomingFiles.ts deletes them when
// the job finishes). Images are also refused when they carry embedded
// HTML/script markup (a JPEG header followed by `<script>` is a polyglot,
// not a photo).

export type UploadedFileKind = 'image' | 'video' | 'document' | 'unknown'

export type DetectedUploadFormat = {
  kind: 'image' | 'video'
  // Server-derived content type to store as the R2 httpMetadata and in
  // file_assets.mime_type.
  mime: string
  // Server-derived extension (with the dot) for the stored object key.
  extension: string
}

export const UNSUPPORTED_UPLOAD_MESSAGE =
  'This file type is not supported. The Library only stores images (JPEG, PNG, WebP, GIF, AVIF) and videos (MP4, MOV, WebM).'

// For the image-only writers (product images, avatars, import images).
export const UNSUPPORTED_IMAGE_MESSAGE =
  'This file type is not supported. Upload a JPEG, PNG, WebP, GIF or AVIF image.'

export const EMBEDDED_MARKUP_MESSAGE =
  'This image contains embedded web page or script content and cannot be uploaded. Re-save it from a photo editor and try again.'

export const MISMATCHED_UPLOAD_MESSAGE =
  'Uploaded file contents do not match the selected file type. Please choose a valid image or video file.'

// The only image content types ever stored.
export const PUBLIC_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

function bufferStartsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false
  }
  return true
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return ''
  return String.fromCharCode(...bytes.subarray(start, end))
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'])

// 'rejected' = a recognised ISO-BMFF container that is not on the list
// (HEIC/HEIF), which must not fall through to the video/mp4 default.
function detectIsoBmff(bytes: Uint8Array): DetectedUploadFormat | 'rejected' | null {
  if (bytes.length < 12 || asciiAt(bytes, 4, 8) !== 'ftyp') return null
  const brand = asciiAt(bytes, 8, 12).toLowerCase()
  if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif', extension: '.avif' }
  if (HEIF_BRANDS.has(brand)) return 'rejected'
  if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', extension: '.mov' }
  return { kind: 'video', mime: 'video/mp4', extension: '.mp4' }
}

// Case-insensitive search for markup that makes an image a polyglot. Only
// tags a browser would act on; not '<?xml' or '<x:xmpmeta', which legitimate
// XMP metadata carries. Skips quickly to each candidate first byte so a 1MB
// photo is one pass.
const POLYGLOT_TAGS = ['<script', '<html', '<svg', '<iframe', '<body', '<object', '<embed', '<!doctype html', '<meta', '<img', '<a href', 'javascript:']

export function containsEmbeddedMarkup(bytes: Uint8Array): boolean {
  const lower = (byte: number) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte)
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte !== 0x3c && byte !== 0x6a && byte !== 0x4a) continue
    outer: for (const tag of POLYGLOT_TAGS) {
      if (lower(byte) !== tag.charCodeAt(0)) continue
      if (index + tag.length > bytes.length) continue
      for (let offset = 1; offset < tag.length; offset += 1) {
        if (lower(bytes[index + offset]) !== tag.charCodeAt(offset)) continue outer
      }
      // A tag must end at a delimiter ('<img' is not '<imgx'); the URL
      // scheme needs none.
      if (tag.startsWith('<')) {
        const next = bytes[index + tag.length]
        if (next !== undefined && next !== 0x20 && next !== 0x3e && next !== 0x2f && next !== 0x09 && next !== 0x0a && next !== 0x0d) continue
      }
      return true
    }
  }
  return false
}

// The single allowlist: images and videos only. Returns null for anything
// the app does not store -- PDF, CSV, XLSX, HTML, SVG, XML, JS, BMP,
// HEIC/HEIF and every unrecognised binary.
export function detectUploadFormat(bytes: Uint8Array): DetectedUploadFormat | null {
  if (!bytes || bytes.length === 0) return null
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', extension: '.jpg' }
  if (bufferStartsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', extension: '.png' }
  const gif = asciiAt(bytes, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return { kind: 'image', mime: 'image/gif', extension: '.gif' }
  // BMP and HEIC/HEIF are deliberately NOT on the list (owner direction:
  // images are JPEG/PNG/WebP/GIF/AVIF). The browser re-encodes BMP to
  // WebP/JPEG before upload (frontend utils/imageCompression.ts).
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', extension: '.webp' }
  if (bufferStartsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', extension: '.webm' }
  const isoBmff = detectIsoBmff(bytes)
  if (isoBmff === 'rejected') return null
  if (isoBmff) return isoBmff
  return null
}

export function isPublicImageFormat(format: DetectedUploadFormat | null | undefined): boolean {
  return !!format && format.kind === 'image' && PUBLIC_IMAGE_MIMES.has(format.mime)
}

// Every Library format is stored under the public uploads/ prefix: images,
// and videos (the storefront About block plays Library videos to anonymous
// visitors). There is no private Library prefix -- documents are refused.
export function isLibraryMediaFormat(format: DetectedUploadFormat | null | undefined): boolean {
  return isPublicImageFormat(format) || (!!format && format.kind === 'video')
}

export function detectBufferKind(bytes: Uint8Array): UploadedFileKind {
  return detectUploadFormat(bytes)?.kind ?? 'unknown'
}

export function getExpectedUploadedKind(mimeType: string, fileName: string): UploadedFileKind {
  const mime = mimeType.toLowerCase()
  const name = fileName.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(name)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return 'video'
  // A document claim is still recognised so a PDF/CSV/XLSX claim over
  // image bytes is reported as a mismatch rather than silently accepted.
  if (mime === 'application/pdf' || mime === 'text/csv' || mime === 'application/csv' || mime === 'application/vnd.ms-excel' || mime.includes('spreadsheetml') || /\.(pdf|csv|xlsx)$/i.test(name)) return 'document'
  return 'unknown'
}

// Client MIME claims that must never be accepted, whatever the bytes are:
// a caller that stored the client's File.type would otherwise serve valid
// PNG bytes as text/html.
function isDangerousClaimedMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  if (!mime) return false
  if (mime.includes('svg') || mime.includes('html') || mime.includes('javascript') || mime.includes('ecmascript')) return true
  // XML families: text/xml, application/xml and any +xml suffix.
  return mime === 'text/xml' || mime === 'application/xml' || mime.endsWith('+xml') || mime === 'text/xsl'
}

// Shared gate for the claim-aware writers (product images, avatars, import
// images). Throws for anything outside the allowlist, for a dangerous
// client MIME claim, and when the client's declared kind contradicts the
// bytes. Returns the detected format so callers store the server-derived
// type and extension.
export function validateUploadedBuffer(bytes: Uint8Array, mimeType: string, fileName: string): DetectedUploadFormat {
  const detected = detectUploadFormat(bytes)
  if (!detected) throw new Error(UNSUPPORTED_UPLOAD_MESSAGE)
  if (isDangerousClaimedMime(mimeType)) throw new Error(UNSUPPORTED_UPLOAD_MESSAGE)
  if (detected.kind === 'image' && containsEmbeddedMarkup(bytes)) throw new Error(EMBEDDED_MARKUP_MESSAGE)
  const expectedKind = getExpectedUploadedKind(mimeType, fileName)
  if (expectedKind !== 'unknown' && detected.kind !== expectedKind) {
    throw new Error(MISMATCHED_UPLOAD_MESSAGE)
  }
  return detected
}

// For routes that ignore the client's claim entirely (files.ts, the sync
// upload DO): the bytes alone decide. Throws UNSUPPORTED_UPLOAD_MESSAGE.
export function classifyUploadedBuffer(bytes: Uint8Array): DetectedUploadFormat {
  const detected = detectUploadFormat(bytes)
  if (!detected) throw new Error(UNSUPPORTED_UPLOAD_MESSAGE)
  if (detected.kind === 'image' && containsEmbeddedMarkup(bytes)) throw new Error(EMBEDDED_MARKUP_MESSAGE)
  return detected
}

// routes/importJobs.ts's storeUpload: the stored type/extension/visibility
// for each import upload kind, derived on the server. Only images are
// public (uploads/ + a Library row); the ZIP container and the CSV/TSV
// source are temporary job-scoped objects under imports/, never reachable
// through /uploads/*, and deleted when the job finishes
// (lib/importIncomingFiles.ts). Before S-uploads the ZIP skipped
// validation and was stored under public uploads/ with the client's
// File.type.
export type ImportUploadFormat = { contentType: string; extension: string; isPublic: boolean }

export const NOT_A_ZIP_MESSAGE = 'This file is not a ZIP archive. Upload a .zip of product images.'

export function isZipBuffer(bytes: Uint8Array): boolean {
  return bufferStartsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || bufferStartsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
}

export function classifyImportUpload(kind: 'csv' | 'zip' | 'image', bytes: Uint8Array, claimedMime: string, fileName: string): ImportUploadFormat {
  if (kind === 'image') {
    const detected = validateUploadedBuffer(bytes, claimedMime, fileName)
    if (!isPublicImageFormat(detected)) throw new Error(UNSUPPORTED_IMAGE_MESSAGE)
    return { contentType: detected.mime, extension: detected.extension, isPublic: true }
  }
  if (kind === 'zip') {
    if (!isZipBuffer(bytes)) throw new Error(NOT_A_ZIP_MESSAGE)
    return { contentType: 'application/zip', extension: '.zip', isPublic: false }
  }
  const isTsv = /\.tsv$/i.test(fileName)
  return { contentType: isTsv ? 'text/tab-separated-values' : 'text/csv', extension: isTsv ? '.tsv' : '.csv', isPublic: false }
}

// Extension for a server-produced image content type (the inline optimizer
// may re-encode to AVIF/WebP), so the stored key matches its bytes.
export function extensionForImageMime(mimeType: string | null | undefined): string | null {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif',
  }
  return map[mime] || null
}
