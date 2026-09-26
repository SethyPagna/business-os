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
// formats the app legitimately keeps (JPEG/PNG/WebP/GIF/AVIF images,
// mp4/mov/webm video, PDF, CSV text, XLSX); anything else -- HTML, SVG, XML,
// JavaScript, BMP/HEIC, an unrecognized binary -- is null and must be
// rejected. The stored content-type and extension come from the detected
// format, never from the client's File.type or file name, because /uploads/*
// serves the stored httpMetadata content-type on the admin origin: a
// client-chosen `text/html` or `.svg` there is stored XSS.
//
// Owner direction (same day): the public /uploads prefix holds IMAGES ONLY
// (isPublicImageFormat). Every other allowed format is stored under a
// private prefix and read through an authenticated route -- see
// lib/fileAssets.ts's PRIVATE_LIBRARY_PREFIX. Images are also refused when
// they carry embedded HTML/script markup (a JPEG header followed by
// `<script>` is a polyglot, not a photo).

export type UploadedFileKind = 'image' | 'video' | 'document' | 'unknown'

export type DetectedUploadFormat = {
  kind: 'image' | 'video' | 'document'
  // Server-derived content type to store as the R2 httpMetadata and in
  // file_assets.mime_type.
  mime: string
  // Server-derived extension (with the dot) for the stored object key.
  extension: string
}

export const UNSUPPORTED_UPLOAD_MESSAGE =
  'This file type is not supported. Upload a JPEG, PNG, WebP, GIF or AVIF image, an MP4, MOV or WebM video, a PDF, a CSV, or an XLSX spreadsheet.'

export const EMBEDDED_MARKUP_MESSAGE =
  'This image contains embedded web page or script content and cannot be uploaded. Re-save it from a photo editor and try again.'

// The only content types ever stored under the public /uploads prefix.
export const PUBLIC_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export const MISMATCHED_UPLOAD_MESSAGE =
  'Uploaded file contents do not match the selected file type. Please choose a valid image, video, PDF, or CSV file.'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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

function indexOfAscii(bytes: Uint8Array, needle: string, from = 0, to = bytes.length): number {
  const first = needle.charCodeAt(0)
  const last = Math.min(to, bytes.length) - needle.length
  outer: for (let index = Math.max(0, from); index <= last; index += 1) {
    if (bytes[index] !== first) continue
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle.charCodeAt(offset)) continue outer
    }
    return index
  }
  return -1
}

function isLikelyCsvBuffer(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let invalidControls = 0
  let separators = 0
  for (const byte of bytes) {
    if (byte === 0) return false
    if (byte === 44 || byte === 59 || byte === 9) separators += 1
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13
    if (byte < 32 && !isAllowedControl) invalidControls += 1
  }
  return invalidControls === 0 && separators > 0
}

// A text buffer that would be interpreted as markup or script if it were
// ever served (or sniffed) as anything but text/csv. The CSV heuristic
// alone accepts `<html><body onload=...>,` -- commas are everywhere -- so
// text is only CSV when it also carries none of these tells.
const MARKUP_TAG_RE = /<\/?(?:!doctype|\?xml|!\[cdata\[|html|head|body|script|svg|iframe|frame|object|embed|meta|link|style|base|form|math|xml|xsl|template|img|video|audio|a)[\s>/]/i
const SCRIPT_RE = /(?:^|[\s;{}()])(?:function\s*[\w$]*\s*\(|(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=|document\s*\.\s*\w|window\s*\.\s*\w|eval\s*\(|=>\s*\{)/

function looksLikeMarkupOrScript(head: Uint8Array): boolean {
  let text = String.fromCharCode(...head.subarray(0, Math.min(head.length, 8192)))
  if (text.startsWith('ï»¿')) text = text.slice(3)
  const trimmed = text.trimStart()
  if (/^<[A-Za-z!?/]/.test(trimmed)) return true
  if (trimmed.startsWith('#!')) return true
  return MARKUP_TAG_RE.test(text) || SCRIPT_RE.test(text)
}

function isXlsxBuffer(bytes: Uint8Array): boolean {
  if (!bufferStartsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false
  // OOXML packages always carry [Content_Types].xml and an xl/ part. Look
  // in the head (local headers) and the tail (central directory) only, so
  // a 25MB file is not scanned end to end.
  const headEnd = Math.min(bytes.length, 64 * 1024)
  const tailStart = Math.max(0, bytes.length - 256 * 1024)
  const has = (needle: string) => indexOfAscii(bytes, needle, 0, headEnd) >= 0 || indexOfAscii(bytes, needle, tailStart) >= 0
  return has('[Content_Types].xml') && has('xl/workbook')
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

// The single allowlist. Returns null for anything the app does not store.
export function detectUploadFormat(bytes: Uint8Array): DetectedUploadFormat | null {
  if (!bytes || bytes.length === 0) return null
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', extension: '.jpg' }
  if (bufferStartsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', extension: '.png' }
  const gif = asciiAt(bytes, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return { kind: 'image', mime: 'image/gif', extension: '.gif' }
  // BMP and HEIC/HEIF are deliberately NOT on the list (owner direction:
  // public images are JPEG/PNG/WebP/GIF/AVIF). The browser re-encodes BMP to
  // WebP/JPEG before upload (frontend utils/imageCompression.ts).
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', extension: '.webp' }
  if (asciiAt(bytes, 0, 5) === '%PDF-') return { kind: 'document', mime: 'application/pdf', extension: '.pdf' }
  if (bufferStartsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', extension: '.webm' }
  const isoBmff = detectIsoBmff(bytes)
  if (isoBmff === 'rejected') return null
  if (isoBmff) return isoBmff
  if (isXlsxBuffer(bytes)) return { kind: 'document', mime: XLSX_MIME, extension: '.xlsx' }
  const head = bytes.subarray(0, Math.min(bytes.length, 8192))
  if (isLikelyCsvBuffer(head) && !looksLikeMarkupOrScript(head)) {
    return { kind: 'document', mime: 'text/csv', extension: '.csv' }
  }
  return null
}

export function isPublicImageFormat(format: DetectedUploadFormat | null | undefined): boolean {
  return !!format && format.kind === 'image' && PUBLIC_IMAGE_MIMES.has(format.mime)
}

// Which Library uploads are written under the public uploads/ prefix.
// Images, plus -- pending an owner ruling -- VIDEO: the public storefront's
// About block plays Library videos to anonymous visitors
// (frontend CatalogSecondaryTabs <video src>), so a private video would break
// that live surface. lib/r2.ts (lane K3) serves /uploads video with its
// extension-derived type as an attachment + nosniff + sandbox CSP, and the
// extension here is always the detected one. PDF, CSV and XLSX are private.
// To make video private too, drop the second clause; nothing else changes.
export function isPublicUploadFormat(format: DetectedUploadFormat | null | undefined): boolean {
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
  if (mime === 'application/pdf' || mime === 'text/csv' || mime === 'application/csv' || mime === 'application/vnd.ms-excel' || mime === XLSX_MIME || /\.(pdf|csv|xlsx)$/i.test(name)) return 'document'
  return 'unknown'
}

// Client MIME claims that must never be accepted, whatever the bytes are:
// a caller that still stores the client's File.type would otherwise serve
// valid PNG bytes as text/html.
function isDangerousClaimedMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  if (!mime) return false
  if (mime.includes('svg') || mime.includes('html') || mime.includes('javascript') || mime.includes('ecmascript')) return true
  // XML families: text/xml, application/xml and any +xml suffix. Not a
  // substring test -- the XLSX type contains "openxmlformats".
  return mime === 'text/xml' || mime === 'application/xml' || mime.endsWith('+xml') || mime === 'text/xsl'
}

// Shared gate for every upload writer. Throws for anything outside the
// allowlist, for a dangerous client MIME claim, and (as before) when the
// client's declared kind contradicts the bytes. Returns the detected
// format so callers can store the server-derived type and extension.
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
// source are private job-scoped objects under imports/, never reachable
// through /uploads/*. Before S-uploads the ZIP skipped validation and was
// stored under public uploads/ with the client's File.type.
export type ImportUploadFormat = { contentType: string; extension: string; isPublic: boolean }

export const NOT_A_ZIP_MESSAGE = 'This file is not a ZIP archive. Upload a .zip of product images.'

export function isZipBuffer(bytes: Uint8Array): boolean {
  return bufferStartsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || bufferStartsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
}

export function classifyImportUpload(kind: 'csv' | 'zip' | 'image', bytes: Uint8Array, claimedMime: string, fileName: string): ImportUploadFormat {
  if (kind === 'image') {
    const detected = validateUploadedBuffer(bytes, claimedMime, fileName)
    if (!isPublicImageFormat(detected)) throw new Error(UNSUPPORTED_UPLOAD_MESSAGE)
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
