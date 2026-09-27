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

function bufferStartsWithAt(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (offset < 0 || bytes.length < offset + signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false
  }
  return true
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return ''
  return String.fromCharCode(...bytes.subarray(start, end))
}

// Callers check the bounds first.
function readU32BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset + 3] * 0x1000000 + ((bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset])
}

// A four-character box/atom/chunk type: printable ASCII, or the (c) byte
// QuickTime uses for its metadata atoms.
function isFourCcAt(bytes: Uint8Array, offset: number): boolean {
  if (offset + 4 > bytes.length) return false
  for (let index = offset; index < offset + 4; index += 1) {
    const byte = bytes[index]
    if (!((byte >= 0x20 && byte <= 0x7e) || byte === 0xa9)) return false
  }
  return true
}

// ---------------------------------------------------------------- ISO BMFF
// MP4, MOV, AVIF, HEIC, M4A audio and Canon CR3 raw photos all start with an
// `ftyp` box whose major brand says what the file is. S-uploads2a
// (2026-09-26): the brand is matched against explicit lists. Before, every
// brand that was not AVIF/HEIF/QuickTime fell through to video/mp4, so M4A
// audio and CR3 raw photos were stored and served as MP4 video, and an AVIF
// whose major brand is the generic HEIF `mif1`/`msf1` (with `avif` listed as
// compatible, as several encoders write it) was refused as HEIC. Brands are
// compared lower-cased. The owner-run purge
// (ops/scripts/purge-non-media-uploads.mjs) mirrors these lists;
// scripts/test-upload-classifier-parity-pure.cjs keeps the two equal.
export const MP4_VIDEO_BRANDS: readonly string[] = [
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'mp71', 'avc1', 'dash', 'cmfc', 'cmf2', 'mmp4', 'f4v ',
  'm4v ', 'm4vh', 'm4vp', 'msnv', 'xavc',
  'ndsc', 'ndsh', 'ndsm', 'ndsp', 'ndss', 'ndxc', 'ndxh', 'ndxm', 'ndxp', 'ndxs',
  '3gp4', '3gp5', '3gp6', '3gp7', '3gp8', '3gp9', '3gg6', '3g2a', '3g2b', '3g2c', 'kddi',
]
export const QUICKTIME_BRAND = 'qt  '
export const AVIF_BRANDS: readonly string[] = ['avif', 'avis']
// Generic HEIF brands: AVIF when `avif`/`avis` is a compatible brand and no
// HEVC brand is.
export const HEIF_STRUCTURAL_BRANDS: readonly string[] = ['mif1', 'msf1']
// HEVC-coded HEIF (HEIC). Refused for new uploads (owner direction). Also
// refused, by not being listed: audio ('M4A ', 'M4B ', 'M4P ', 'F4A '),
// Canon raw ('crx ') and every other brand.
export const HEVC_IMAGE_BRANDS: readonly string[] = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']

function readFtypBrands(bytes: Uint8Array): { major: string; compatible: string[] } | null {
  if (bytes.length < 12 || asciiAt(bytes, 4, 8) !== 'ftyp') return null
  const major = asciiAt(bytes, 8, 12).toLowerCase()
  const boxEnd = Math.min(bytes.length, Math.max(16, readU32BE(bytes, 0)), 16 + 4 * 64)
  const compatible: string[] = []
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) compatible.push(asciiAt(bytes, offset, offset + 4).toLowerCase())
  return { major, compatible }
}

// 'rejected' = a recognised ISO-BMFF container that is not on the lists,
// which must not fall through to a video default.
function detectIsoBmff(bytes: Uint8Array): DetectedUploadFormat | 'rejected' | null {
  const ftyp = readFtypBrands(bytes)
  if (!ftyp) return null
  const { major, compatible } = ftyp
  if (AVIF_BRANDS.includes(major)) return { kind: 'image', mime: 'image/avif', extension: '.avif' }
  if (HEIF_STRUCTURAL_BRANDS.includes(major)
    && compatible.some((brand) => AVIF_BRANDS.includes(brand))
    && !compatible.some((brand) => HEVC_IMAGE_BRANDS.includes(brand))) {
    return { kind: 'image', mime: 'image/avif', extension: '.avif' }
  }
  if (major === QUICKTIME_BRAND) return { kind: 'video', mime: 'video/quicktime', extension: '.mov' }
  if (MP4_VIDEO_BRANDS.includes(major)) return { kind: 'video', mime: 'video/mp4', extension: '.mp4' }
  return 'rejected'
}

// Classic QuickTime movies (older cameras and editors) have no `ftyp` box:
// the file starts straight with one of these atoms. They count as
// video/quicktime only when the atoms chain consistently and a movie atom
// (`moov` or `mdat`) is among them.
export const QUICKTIME_LEADING_ATOMS: readonly string[] = ['wide', 'mdat', 'moov', 'free', 'skip', 'pnot']

function detectQuickTimeAtoms(bytes: Uint8Array): DetectedUploadFormat | null {
  if (bytes.length < 8 || !QUICKTIME_LEADING_ATOMS.includes(asciiAt(bytes, 4, 8))) return null
  // A text file whose bytes 4-8 happen to spell an atom name: its "size" is
  // four printable characters and runs past the data.
  if (readU32BE(bytes, 0) > bytes.length && [0, 1, 2, 3].every((index) => bytes[index] >= 0x20 && bytes[index] <= 0x7e)) return null
  let offset = 0
  let sawMovie = false
  for (let atoms = 0; atoms < 64 && offset + 8 <= bytes.length; atoms += 1) {
    if (!isFourCcAt(bytes, offset + 4)) return null
    const type = asciiAt(bytes, offset + 4, offset + 8)
    if (type === 'moov' || type === 'mdat') sawMovie = true
    let size = readU32BE(bytes, offset)
    if (size === 0) break // runs to the end of the file
    if (size === 1) {
      if (offset + 16 > bytes.length) break
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      if (size < 16) return null
    } else if (size < 8) {
      return null
    }
    offset += size
  }
  return sawMovie ? { kind: 'video', mime: 'video/quicktime', extension: '.mov' } : null
}

// ------------------------------------------------------- embedded markup
// An image carrying HTML/script is a polyglot, not a photo. Case-insensitive
// search for markup a browser acts on -- never '<?xml', '<x:xmpmeta',
// '<rdf:' or '<xmp:', which legitimate XMP metadata carries (so '<xmp' must
// never become a token).
//
// S-uploads2a (2026-09-26) closed refuter bypasses that passed as image/jpeg:
//   - a tag name ended by a form feed (`<script\f`) or NUL (`<svg\0`). The
//     HTML tokenizer ends a tag name at \t \n \f \r space '/' '>'; all of
//     those end a token here, plus NUL and '=' (`<a href=`, which the old
//     list never matched);
//   - UTF-16 markup (`<\0s\0c\0r\0...`): every token is also matched with a
//     zero byte after each character, which is UTF-16LE and, from the '<'
//     on, UTF-16BE;
//   - `<style>` and `<form>`, which were not tokens (nor were <link>, <base>,
//     <frame>, <frameset>, <applet>, <math>).
//
// False positives. Compressed image data is close to uniformly random; a
// random byte starts a match with probability about
//   (1/256) * (2/256)^k * (9/256)   for a '<' tag of k letters
// (2/256: either case; 9/256: the terminator set), i.e.
//   k = 3   '<svg' '<img'           6.5e-11 per byte, 1.4e-4 per MB for the pair
//   k = 4   '<html' '<form' ...     5.1e-13 per byte
//   k >= 5  '<style' '<script' ...  4.0e-15 per byte or less
// Every byte of a 12 MB photo (files.ts's fallback limit) searched for every
// token would flag about 1 real photo in 600, on '<svg'/'<img' alone. So the
// search follows the file's structure:
//   - the first 1445 bytes (the WHATWG MIME-sniffing window; C2PA
//     manifests excepted, below) and every metadata/text part -- JPEG
//     marker segments (EXIF, XMP, ICC, COM), PNG chunks other than
//     IDAT/fdAT, GIF extensions, WebP chunks other than VP8/VP8L/ALPH/ANMF,
//     ISO boxes other than mdat, anything after the image ends and anything
//     the walker cannot follow -- get every token;
//   - compressed pixel data (JPEG entropy-coded scans, IDAT/fdAT, GIF LZW
//     blocks, VP8/VP8L/ALPH/ANMF, mdat) gets only the tokens of 6+
//     characters: under 1e-6 false positives per 12 MB photo in total, and a
//     '<script' hidden in pixel data is still found.
// Metadata is small (typically under 128 KB even with an EXIF thumbnail), so
// a real photo is flagged with probability of about 2e-5.
//
// C2PA "Content Credentials" manifests (PNG caBX chunk, JPEG APP11 JUMBF,
// WebP C2PA chunk, ISO uuid box) are provenance records written by cameras
// and editors, and AI image generators embed their tool icon there as an SVG
// document (`c2pa.icon`, image/svg+xml, `<svg ...><path .../></svg>`): the
// two logo PNGs in frontend/icon logo images carry exactly that, and the
// whole-file scan refused them. Inside a manifest the tokens an inert SVG
// icon is made of ('<svg', '<img', '<style', '<a href') do not count;
// everything that runs script still does -- the other tokens and any event
// handler attribute (` onload=`, `/onerror =`), so `<svg onload=...>` hidden
// in a manifest is still refused.
//
// S-uploads3 (2026-09-27) closed refuter R-uploads2's bypasses: an event
// handler on a tag that was not a token (`<details open ontoggle=...>`,
// `<input autofocus onfocus=...>`, `<video><source onerror=...>`,
// `<marquee onstart=...>`, `<x onclick=...>`) passed as image/jpeg. An event
// handler attribute in a 'full' region (the sniffing window and all
// metadata/text parts) is refused when a tag starts -- '<' and a letter, as
// bytes or UTF-16 -- anywhere before it, whatever the tag, and the
// script-capable tags below are tokens too. S-uploads4 (refuter R-uploads3):
// the handler was looked for only 1024 bytes past a tag start in the same
// part, so one long quoted attribute value, or a tag continued in the next
// segment or chunk, hid it. A quoted value is part of the tag however long it
// runs, so there is no distance limit. Compressed pixel data ('payload')
// keeps its long-token rule. False positives: '<' + letter is about 8e-4 per
// random byte and a handler about 6e-11 per position, so random 128 KB
// metadata would flag about 1 photo in 100,000.
export const EMBEDDED_MARKUP_TOKENS: readonly string[] = [
  '<script', '<html', '<svg', '<iframe', '<body', '<object', '<embed', '<!doctype html', '<meta', '<img', '<a href', 'javascript:',
  '<style', '<form', '<link', '<base', '<frame', '<frameset', '<applet', '<math',
  '<details', '<input', '<video', '<audio', '<marquee', '<textarea', '<select', '<noscript', '<template', '<button', '<dialog',
  '<keygen', '<isindex', '<source', '<bgsound',
]
// Bytes that end a '<' token (see above). A token needs none at the end of
// the data; 'javascript:' needs none at all.
export const MARKUP_TAG_TERMINATORS: readonly number[] = [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f, 0x3d, 0x3e]
// A space inside a token matches a run of these (`<a/href`, `<!DOCTYPE\nhtml`).
export const MARKUP_TOKEN_SEPARATORS: readonly number[] = [0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f]
export const MARKUP_SNIFF_WINDOW_BYTES = 1445
export const MARKUP_PAYLOAD_MIN_TOKEN_LENGTH = 6
export const C2PA_MANIFEST_IGNORED_TOKENS: readonly string[] = ['<svg', '<img', '<style', '<a href']
// An event handler attribute: one of these, `on`, 3+ letters, optional
// whitespace, `=`.
export const EVENT_HANDLER_PRECEDERS: readonly number[] = [0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f, 0x22, 0x27]
// ISO BMFF `uuid` box type of a C2PA manifest store.
export const C2PA_UUID: readonly number[] = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81]
const MARKUP_MAX_NESTED_IMAGES = 8
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_PAYLOAD_CHUNKS: readonly string[] = ['IDAT', 'fdAT']
const WEBP_PAYLOAD_CHUNKS: readonly string[] = ['VP8 ', 'VP8L', 'ALPH', 'ANMF']

// How a region of the file is searched.
type MarkupScanMode = 'full' | 'payload' | 'manifest'

type MarkupTokenGroups = Array<[number, string[]]>

// Tokens keyed by the byte they start with, both cases.
function groupMarkupTokens(tokens: readonly string[]): MarkupTokenGroups {
  const groups = new Map<number, string[]>()
  for (const token of tokens) {
    const first = token.charCodeAt(0)
    for (const byte of first >= 0x61 && first <= 0x7a ? [first, first - 0x20] : [first]) {
      groups.set(byte, [...(groups.get(byte) || []), token])
    }
  }
  return [...groups.entries()]
}

const MARKUP_TOKEN_GROUPS: Record<MarkupScanMode, MarkupTokenGroups> = {
  full: groupMarkupTokens(EMBEDDED_MARKUP_TOKENS),
  payload: groupMarkupTokens(EMBEDDED_MARKUP_TOKENS.filter((token) => token.length >= MARKUP_PAYLOAD_MIN_TOKEN_LENGTH)),
  manifest: groupMarkupTokens(EMBEDDED_MARKUP_TOKENS.filter((token) => !C2PA_MANIFEST_IGNORED_TOKENS.includes(token))),
}

function lowerAscii(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte
}

function isAsciiLetter(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
}

// `start` is an 'o'/'O' byte; `step` as in markupTokenAt.
function eventHandlerAt(bytes: Uint8Array, start: number, step: 1 | 2): boolean {
  const charAt = (at: number) => (at >= 0 && at < bytes.length && (step === 1 || bytes[at + 1] === 0x00) ? bytes[at] : -1)
  if (charAt(start) === -1 || !EVENT_HANDLER_PRECEDERS.includes(charAt(start - step))) return false
  if (lowerAscii(charAt(start + step)) !== 0x6e) return false
  let position = start + 2 * step
  let letters = 0
  while (isAsciiLetter(charAt(position))) { position += step; letters += 1 }
  if (letters < 3) return false
  while (MARKUP_TOKEN_SEPARATORS.includes(charAt(position)) && charAt(position) !== 0x2f) position += step
  return charAt(position) === 0x3d
}

function eventHandlerInRange(bytes: Uint8Array, start: number, end: number): boolean {
  for (const first of [0x6f, 0x4f]) {
    for (let index = bytes.indexOf(first, start); index !== -1 && index < end; index = bytes.indexOf(first, index + 1)) {
      if (eventHandlerAt(bytes, index, 1) || eventHandlerAt(bytes, index, 2)) return true
    }
  }
  return false
}

// '<' at `index` starts a tag: a letter follows, as a byte or as UTF-16.
function tagStartAt(bytes: Uint8Array, index: number): boolean {
  return isAsciiLetter(bytes[index + 1]) || (bytes[index + 1] === 0x00 && isAsciiLetter(bytes[index + 2]) && bytes[index + 3] === 0x00)
}

// Where the first tag starts, or -1. Every part counts, pixel data included:
// a tag started there runs on into the parts after it.
function firstTagStart(bytes: Uint8Array): number {
  for (let index = bytes.indexOf(0x3c); index !== -1; index = bytes.indexOf(0x3c, index + 1)) {
    if (tagStartAt(bytes, index)) return index
  }
  return -1
}

// `step` 1 matches bytes; 2 matches UTF-16 (a zero byte after each character).
function markupTokenAt(bytes: Uint8Array, start: number, token: string, step: 1 | 2): boolean {
  const charAt = (at: number) => (at < bytes.length && (step === 1 || bytes[at + 1] === 0x00) ? bytes[at] : -1)
  let position = start
  for (let index = 0; index < token.length; index += 1) {
    const want = token.charCodeAt(index)
    if (want === 0x20) {
      let run = 0
      while (MARKUP_TOKEN_SEPARATORS.includes(charAt(position))) { position += step; run += 1 }
      if (!run) return false
      continue
    }
    if (lowerAscii(charAt(position)) !== want) return false
    position += step
  }
  if (token.charCodeAt(0) !== 0x3c || position >= bytes.length) return true
  return MARKUP_TAG_TERMINATORS.includes(bytes[position])
}

function markupInRange(bytes: Uint8Array, start: number, end: number, mode: MarkupScanMode): boolean {
  for (const [first, tokens] of MARKUP_TOKEN_GROUPS[mode]) {
    for (let index = bytes.indexOf(first, start); index !== -1 && index < end; index = bytes.indexOf(first, index + 1)) {
      for (const token of tokens) {
        if (markupTokenAt(bytes, index, token, 1) || markupTokenAt(bytes, index, token, 2)) return true
      }
    }
  }
  return mode === 'manifest' && eventHandlerInRange(bytes, start, end)
}

type AddMarkupRegion = (start: number, end: number, mode: MarkupScanMode) => void

// Data after an image's end marker: an appended JPEG (MPF secondary image,
// gain map), a motion photo's MP4 (Pixel: straight after the image; Samsung:
// after a 'MotionPhoto_Data' label), or anything else, which gets every token.
function walkMarkupTrailer(bytes: Uint8Array, offset: number, add: AddMarkupRegion, depth: number): void {
  if (offset >= bytes.length) return
  if (depth >= MARKUP_MAX_NESTED_IMAGES) { add(offset, bytes.length, 'full'); return }
  let jpegStart = offset
  const paddingEnd = Math.min(bytes.length, offset + 4096)
  while (jpegStart < paddingEnd && bytes[jpegStart] === 0x00) jpegStart += 1
  if (bufferStartsWithAt(bytes, jpegStart, [0xff, 0xd8, 0xff])) { walkJpegMarkup(bytes, jpegStart, add, depth + 1); return }
  const lastBoxStart = Math.min(bytes.length - 8, offset + 64)
  for (let box = offset; box <= lastBoxStart; box += 1) {
    if (bytes[box + 4] === 0x66 && bytes[box + 5] === 0x74 && bytes[box + 6] === 0x79 && bytes[box + 7] === 0x70) {
      add(offset, box, 'full')
      walkIsoBoxMarkup(bytes, box, add)
      return
    }
  }
  add(offset, bytes.length, 'full')
}

function walkJpegMarkup(bytes: Uint8Array, start: number, add: AddMarkupRegion, depth: number): void {
  let offset = start + 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { add(offset, bytes.length, 'full'); return }
    const markerStart = offset
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9) { walkMarkupTrailer(bytes, offset, add, depth); return }
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) continue
    if (marker === 0x00 || offset + 2 > bytes.length) { add(markerStart, bytes.length, 'full'); return }
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2) { add(markerStart, bytes.length, 'full'); return }
    // APP11 holding JUMBF ('JP') is a C2PA manifest.
    const jumbf = marker === 0xeb && bytes[offset + 2] === 0x4a && bytes[offset + 3] === 0x50
    add(offset + 2, offset + length, jumbf ? 'manifest' : 'full')
    offset += length
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not a stuffed
      // 0xFF00, a restart marker or fill.
      let end = offset
      for (;;) {
        end = bytes.indexOf(0xff, end)
        if (end === -1 || end + 1 >= bytes.length) { end = bytes.length; break }
        const next = bytes[end + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) end += 2
        else if (next === 0xff) end += 1
        else break
      }
      add(offset, end, 'payload')
      offset = end
    }
  }
}

function walkPngMarkup(bytes: Uint8Array, start: number, add: AddMarkupRegion, depth: number): void {
  let offset = start + 8
  while (offset + 12 <= bytes.length) {
    for (let index = offset + 4; index < offset + 8; index += 1) {
      if (!isAsciiLetter(bytes[index])) { add(offset, bytes.length, 'full'); return }
    }
    const type = asciiAt(bytes, offset + 4, offset + 8)
    const dataEnd = offset + 8 + readU32BE(bytes, offset)
    if (dataEnd + 4 > bytes.length) { add(offset, bytes.length, 'full'); return }
    add(offset + 8, dataEnd, PNG_PAYLOAD_CHUNKS.includes(type) ? 'payload' : type === 'caBX' ? 'manifest' : 'full')
    offset = dataEnd + 4
    if (type === 'IEND') { walkMarkupTrailer(bytes, offset, add, depth); return }
  }
  add(offset, bytes.length, 'full')
}

function gifColourTableBytes(packed: number): number {
  return packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0
}

// End of a run of GIF data sub-blocks, or -1 when it runs past the data.
function skipGifSubBlocks(bytes: Uint8Array, offset: number): number {
  let position = offset
  while (position < bytes.length) {
    const size = bytes[position]
    if (size === 0) return position + 1
    position += 1 + size
  }
  return -1
}

function walkGifMarkup(bytes: Uint8Array, start: number, add: AddMarkupRegion, depth: number): void {
  if (start + 13 > bytes.length) { add(start, bytes.length, 'full'); return }
  let offset = start + 13 + gifColourTableBytes(bytes[start + 10])
  add(start, offset, 'full')
  while (offset < bytes.length) {
    const introducer = bytes[offset]
    if (introducer === 0x3b) { walkMarkupTrailer(bytes, offset + 1, add, depth); return }
    if (introducer === 0x21) {
      const end = skipGifSubBlocks(bytes, offset + 2)
      if (end < 0) { add(offset, bytes.length, 'full'); return }
      add(offset + 1, end, 'full')
      offset = end
    } else if (introducer === 0x2c && offset + 11 <= bytes.length) {
      // Image descriptor, local colour table, LZW code size, then LZW data.
      const dataStart = offset + 11 + gifColourTableBytes(bytes[offset + 9])
      const end = dataStart <= bytes.length ? skipGifSubBlocks(bytes, dataStart) : -1
      if (end < 0) { add(offset, bytes.length, 'full'); return }
      add(offset + 1, dataStart, 'full')
      add(dataStart, end, 'payload')
      offset = end
    } else {
      add(offset, bytes.length, 'full')
      return
    }
  }
}

function walkWebpMarkup(bytes: Uint8Array, start: number, add: AddMarkupRegion, depth: number): void {
  const riffEnd = Math.min(bytes.length, start + 8 + readU32LE(bytes, start + 4))
  let offset = start + 12
  while (offset + 8 <= riffEnd) {
    if (!isFourCcAt(bytes, offset)) { add(offset, bytes.length, 'full'); return }
    const fourcc = asciiAt(bytes, offset, offset + 4)
    const size = readU32LE(bytes, offset + 4)
    const dataEnd = offset + 8 + size
    if (dataEnd > bytes.length) { add(offset, bytes.length, 'full'); return }
    add(offset + 8, dataEnd, WEBP_PAYLOAD_CHUNKS.includes(fourcc) ? 'payload' : fourcc === 'C2PA' ? 'manifest' : 'full')
    offset = dataEnd + (size % 2)
  }
  if (offset < riffEnd) add(offset, riffEnd, 'full')
  walkMarkupTrailer(bytes, Math.max(offset, riffEnd), add, depth)
}

function walkIsoBoxMarkup(bytes: Uint8Array, start: number, add: AddMarkupRegion): void {
  let offset = start
  while (offset + 8 <= bytes.length) {
    if (!isFourCcAt(bytes, offset + 4)) { add(offset, bytes.length, 'full'); return }
    const type = asciiAt(bytes, offset + 4, offset + 8)
    let size = readU32BE(bytes, offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > bytes.length) { add(offset, bytes.length, 'full'); return }
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      header = 16
    } else if (size === 0) {
      size = bytes.length - offset
    }
    if (size < header) { add(offset, bytes.length, 'full'); return }
    const c2pa = type === 'uuid' && bufferStartsWithAt(bytes, offset + header, [...C2PA_UUID])
    add(offset + header, offset + size, type === 'mdat' ? 'payload' : c2pa ? 'manifest' : 'full')
    offset += size
  }
  add(offset, bytes.length, 'full')
}

function planMarkupScan(bytes: Uint8Array): Array<{ start: number; end: number; mode: MarkupScanMode }> {
  const regions: Array<{ start: number; end: number; mode: MarkupScanMode }> = []
  const add: AddMarkupRegion = (start, end, mode) => {
    const clipped = Math.min(end, bytes.length)
    if (clipped > start) regions.push({ start, end: clipped, mode })
  }
  const gif = asciiAt(bytes, 0, 6)
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) walkJpegMarkup(bytes, 0, add, 0)
  else if (bufferStartsWith(bytes, PNG_SIGNATURE)) walkPngMarkup(bytes, 0, add, 0)
  else if (gif === 'GIF87a' || gif === 'GIF89a') walkGifMarkup(bytes, 0, add, 0)
  else if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') walkWebpMarkup(bytes, 0, add, 0)
  else if (asciiAt(bytes, 4, 8) === 'ftyp') walkIsoBoxMarkup(bytes, 0, add)
  else add(0, bytes.length, 'full')
  // The sniffing window gets every token, compressed data included -- but
  // not inside a C2PA manifest, which keeps its own rules (the manifest in
  // the repo's logo PNGs starts at byte 41).
  const manifests = regions.filter((region) => region.mode === 'manifest' && region.start < MARKUP_SNIFF_WINDOW_BYTES).sort((a, b) => a.start - b.start)
  let windowStart = 0
  for (const manifest of manifests) {
    add(windowStart, Math.min(manifest.start, MARKUP_SNIFF_WINDOW_BYTES), 'full')
    windowStart = Math.max(windowStart, manifest.end)
  }
  add(windowStart, MARKUP_SNIFF_WINDOW_BYTES, 'full')
  return regions
}

export function containsEmbeddedMarkup(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length === 0) return false
  const regions = planMarkupScan(bytes)
  for (const region of regions) {
    if (markupInRange(bytes, region.start, region.end, region.mode)) return true
  }
  // An event handler attribute in a 'full' region after a tag start, however
  // far after it.
  const tagStart = firstTagStart(bytes)
  if (tagStart === -1) return false
  return regions.some((region) => region.mode === 'full' && eventHandlerInRange(bytes, Math.max(region.start, tagStart + 2), region.end))
}

// The single allowlist: images and videos only. Returns null for anything
// the app does not store -- PDF, CSV, XLSX, HTML, SVG, XML, JS, BMP,
// HEIC/HEIF, M4A/M4B audio, camera raw and every unrecognised binary.
export function detectUploadFormat(bytes: Uint8Array): DetectedUploadFormat | null {
  if (!bytes || bytes.length === 0) return null
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', extension: '.jpg' }
  if (bufferStartsWith(bytes, PNG_SIGNATURE)) return { kind: 'image', mime: 'image/png', extension: '.png' }
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
  return detectQuickTimeAtoms(bytes)
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

// ------------------------------------------------ stored media (legacy)
// S-uploads3 (2026-09-27). The allowlist above decides NEW uploads. A file
// already in storage is judged more generously: an iPhone HEIC, a BMP scan,
// a camera raw, an MP4 whose brand is not on MP4_VIDEO_BRANDS (Canon
// `CAEP`, `mp21`), an M4A voice note -- somebody's photo, clip or recording.
// The owner-run purge (ops/scripts/purge-non-media-uploads.mjs) keeps every
// one of them, and lib/r2.ts serves the photos and videos among them; the
// backup restore (lib/backup.ts) uses the same detection so that a restore
// puts back exactly what the purge keeps. detectOtherMedia and
// otherMediaLooksLikeText, with every declaration they use, are mirrored
// token for token in the purge script and held equal by
// scripts/test-upload-classifier-parity-pure.cjs. Edit both together.
export type OtherMedia = { kind: 'photo' | 'video-audio'; format: string }

const u16leAt = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8)
const u16beAt = (bytes: Uint8Array, offset: number): number => (bytes[offset] << 8) | bytes[offset + 1]
const textAt = (bytes: Uint8Array, offset: number, text: string): boolean => asciiAt(bytes, offset, offset + text.length) === text
const latin1Head = (bytes: Uint8Array, limit: number): string => String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, limit)))
const printable = (text: string): string => text.replace(/[^\x20-\x7e]/g, '?')

// The first entry of a ZIP file: its name and, when stored uncompressed,
// its data (an ODF/EPUB/OpenRaster `mimetype` entry is stored first).
function zipFirstEntry(bytes: Uint8Array): { name: string; data: Uint8Array | null } | null {
  if (bytes.length < 30 || !bufferStartsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return null
  const method = u16leAt(bytes, 8)
  const compressedSize = readU32LE(bytes, 18)
  const nameLength = u16leAt(bytes, 26)
  const extraLength = u16leAt(bytes, 28)
  if (30 + nameLength > bytes.length) return null
  const name = String.fromCharCode(...bytes.subarray(30, 30 + nameLength))
  const dataStart = 30 + nameLength + extraLength
  const data = method === 0 ? bytes.subarray(dataStart, Math.min(bytes.length, dataStart + compressedSize)) : null
  return { name, data }
}

function zipMimetype(bytes: Uint8Array): string | null {
  const entry = zipFirstEntry(bytes)
  if (!entry || entry.name !== 'mimetype' || !entry.data) return null
  return String.fromCharCode(...entry.data.subarray(0, 100))
}

// ------------------------------------------- other media: always kept
// Photos, videos and recordings the upload allowlist does not take (new
// uploads of these are refused), but a stored one is somebody's photo or
// clip. Generous on purpose: a wrong match here only keeps a file.
const OTHER_HEIF_BRANDS: readonly string[] = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'mif2', 'mif3', 'miaf', 'heif', 'avif', 'avis', 'avci', 'avcs', 'jpeg', 'jpgs', 'vvic', 'vvis', 'evbi', 'evbs', 'j2ki', 'j2is']
const ISO_AUDIO_BRANDS: readonly string[] = ['m4a ', 'm4b ', 'm4p ', 'f4a ', 'f4b ']
const BMP_HEADER_SIZES: readonly number[] = [12, 16, 40, 52, 56, 64, 108, 124]

function isNetpbm(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] < 0x31 || bytes[1] > 0x37) return false
  if (bytes[1] === 0x37) return /^P7\s+(WIDTH|HEIGHT|DEPTH|MAXVAL|TUPLTYPE|ENDHDR|#)/.test(latin1Head(bytes, 64))
  if (![0x09, 0x0a, 0x0d, 0x20].includes(bytes[2])) return false
  let offset = 2
  while (offset < bytes.length) {
    if ([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20].includes(bytes[offset])) offset += 1
    else if (bytes[offset] === 0x23) { while (offset < bytes.length && bytes[offset] !== 0x0a) offset += 1 }
    else break
  }
  return offset < bytes.length && bytes[offset] >= 0x30 && bytes[offset] <= 0x39
}

// S-uploads3 (2026-09-27): the loose QuickTime and MP3 signatures below
// kept crafted text as media (R-uploads2: `\0\0\0\x08free` followed by
// notes, `ID3\x03\x00` followed by notes). Every atom header within the
// bytes read must be a four-character type with a size that stays inside
// the file; the last one may run past the bytes read.
function quickTimeAtomsFit(bytes: Uint8Array, totalSize: number): boolean {
  let offset = 0
  for (let atoms = 0; atoms < 64 && offset + 8 <= bytes.length; atoms += 1) {
    if (!isFourCcAt(bytes, offset + 4)) return false
    let size = readU32BE(bytes, offset)
    if (size === 0) return true
    if (size === 1) {
      if (offset + 16 > bytes.length) return true
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      if (size < 16) return false
    } else if (size < 8) {
      return false
    }
    if (offset + size > totalSize) return false
    offset += size
  }
  return true
}

// An ID3v2 header: version 2-4, only the flag bits that version defines,
// a sync-safe size (every byte under 0x80) and a tag that fits in the file.
const ID3_UNDEFINED_FLAG_BITS: readonly number[] = [0x3f, 0x1f, 0x0f]
function id3TagFits(bytes: Uint8Array, totalSize: number): boolean {
  if (bytes.length < 10 || bytes[3] < 2 || bytes[3] > 4 || bytes[4] === 0xff) return false
  if (bytes[5] & ID3_UNDEFINED_FLAG_BITS[bytes[3] - 2]) return false
  if ([6, 7, 8, 9].some((index) => bytes[index] >= 0x80)) return false
  const size = bytes[6] * 0x200000 + bytes[7] * 0x4000 + bytes[8] * 0x80 + bytes[9]
  return 10 + size <= totalSize
}

// { kind: 'photo' | 'video-audio', format } or null. `totalSize` is the
// object's size when only its first bytes were read.
export function detectOtherMedia(bytes: Uint8Array, totalSize: number = bytes ? bytes.length : 0): OtherMedia | null {
  if (!bytes || bytes.length < 2) return null
  const photo = (format: string): OtherMedia => ({ kind: 'photo', format })
  const media = (format: string): OtherMedia => ({ kind: 'video-audio', format })
  const at = (offset: number, signature: number[]): boolean => bufferStartsWithAt(bytes, offset, signature)
  const has = (offset: number, text: string): boolean => textAt(bytes, offset, text)

  // ISO BMFF the allowlist refused: HEIC/HEIF, Canon CR3, M4A, any brand.
  const ftyp = readFtypBrands(bytes)
  if (ftyp) {
    if (ftyp.major === 'crx ') return photo('camera raw (CR3)')
    if (ISO_AUDIO_BRANDS.includes(ftyp.major)) return media('M4A/M4B audio')
    if ([ftyp.major, ...ftyp.compatible].some((brand) => OTHER_HEIF_BRANDS.includes(brand))) return photo('HEIC/HEIF')
    return media('MP4 family (brand ' + printable(ftyp.major) + ')')
  }
  // QuickTime atoms that do not chain within the bytes read, as long as
  // every atom header that is read fits in the file (see quickTimeAtomsFit).
  if (bytes.length >= 8 && QUICKTIME_LEADING_ATOMS.includes(asciiAt(bytes, 4, 8)) && quickTimeAtomsFit(bytes, totalSize)) return media('QuickTime')
  if (has(0, 'RIFF') || has(0, 'RIFX')) {
    const form = asciiAt(bytes, 8, 12)
    if (form === 'AVI ' || form === 'AVIX') return media('AVI')
    if (form === 'CDXA') return media('Video CD')
    if (form === 'WAVE' || form === 'RMP3') return media('WAV')
    if (form === 'RMID') return media('MIDI')
    if (form === 'QLCM') return media('QCELP')
    if (form === 'ACON') return photo('animated cursor')
  }
  if (has(0, 'FORM')) {
    const form = asciiAt(bytes, 8, 12)
    if (form === 'AIFF' || form === 'AIFC' || form === '8SVX') return media('AIFF')
    if (form === 'ILBM' || form === 'PBM ' || form === 'ACBM') return photo('IFF image')
  }
  // Video.
  if (at(0, [0, 0, 1, 0xba]) || at(0, [0, 0, 1, 0xb3])) return media('MPEG')
  for (const [first, stride] of [[0, 188], [4, 192]]) {
    if (bytes.length > first + 2 * stride && [0, 1, 2].every((packet) => bytes[first + packet * stride] === 0x47)) return media('MPEG transport stream')
  }
  if (has(0, 'FLV') && bytes[3] === 1) return media('Flash video (FLV)')
  if (at(0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return media('Windows Media (WMV/WMA)')
  if (has(0, '.RMF')) return media('RealMedia')
  if (has(0, 'OggS') && bytes[4] === 0) return media('Ogg')
  // Audio. 0xFF 0xFE is a UTF-16 byte order mark, not an MPEG frame.
  if (has(0, 'ID3') && id3TagFits(bytes, totalSize)) return media('MP3')
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return media('AAC')
  if (bytes.length >= 3 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && bytes[1] !== 0xfe && bytes[1] !== 0xff
    && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] >> 4) !== 0x0f && ((bytes[2] >> 2) & 0x03) !== 0x03) return media('MP3')
  if (has(0, 'fLaC') && (bytes[4] & 0x7f) === 0) return media('FLAC')
  if (has(0, 'MThd') && bytes.length >= 8 && readU32BE(bytes, 4) === 6) return media('MIDI')
  if (has(0, '#!AMR')) return media('AMR')
  if (has(0, 'caff') && bytes.length >= 6 && u16beAt(bytes, 4) === 1) return media('Core Audio (CAF)')
  if (has(0, '.snd') && bytes.length >= 8 && readU32BE(bytes, 4) >= 24 && readU32BE(bytes, 4) < 65536) return media('AU')
  if (has(0, 'MAC ') && bytes.length >= 6 && u16leAt(bytes, 4) >= 3800 && u16leAt(bytes, 4) <= 4200) return media("Monkey's Audio")
  if (has(0, 'wvpk')) return media('WavPack')
  if (has(0, 'DSD ') && bytes.length >= 12 && bytes[4] === 28 && [5, 6, 7, 8, 9, 10, 11].every((index) => bytes[index] === 0)) return media('DSD')
  if (has(0, 'MPCK')) return media('Musepack')
  if (at(0, [0x0b, 0x77])) return media('AC-3')
  if (at(0, [0x7f, 0xfe, 0x80, 0x01])) return media('DTS')
  // Photos and other images.
  if (has(0, 'BM') && bytes.length >= 18 && BMP_HEADER_SIZES.includes(readU32LE(bytes, 14))) return photo('BMP')
  if (at(0, [0x49, 0x49, 0x2a, 0x00]) || at(0, [0x4d, 0x4d, 0x00, 0x2a]) || at(0, [0x49, 0x49, 0x2b, 0x00]) || at(0, [0x4d, 0x4d, 0x00, 0x2b])) return photo('TIFF or camera raw')
  if (has(0, 'IIRO') || has(0, 'IIRS') || has(0, 'MMOR') || at(0, [0x49, 0x49, 0x55, 0x00])) return photo('camera raw')
  if (has(0, 'FUJIFILMCCD-RAW')) return photo('camera raw (RAF)')
  if (at(0, [0x49, 0x49, 0x1a, 0, 0, 0]) && has(6, 'HEAPCCDR')) return photo('camera raw (CRW)')
  if (has(0, 'FOVb')) return photo('camera raw (X3F)')
  if (at(0, [0x00, 0x4d, 0x52, 0x4d])) return photo('camera raw (MRW)')
  if ((at(0, [0, 0, 1, 0]) || at(0, [0, 0, 2, 0])) && bytes.length >= 22) {
    const count = u16leAt(bytes, 4)
    if (count >= 1 && count <= 256 && bytes[9] === 0 && readU32LE(bytes, 18) >= 6 + 16 * count) return photo('icon (ICO/CUR)')
  }
  if (has(0, '8BPS') && bytes.length >= 6 && [1, 2].includes(u16beAt(bytes, 4))) return photo('Photoshop (PSD)')
  if (at(0, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]) || at(0, [0xff, 0x4f, 0xff, 0x51])) return photo('JPEG 2000')
  if (at(0, [0xff, 0x0a]) || at(0, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return photo('JPEG XL')
  if (at(0, [0x49, 0x49, 0xbc])) return photo('JPEG XR')
  if (has(0, 'gimp xcf ')) return photo('GIMP (XCF)')
  if (has(0, 'qoif')) return photo('QOI')
  if (has(0, 'DDS ') && bytes.length >= 8 && readU32LE(bytes, 4) === 124) return photo('DDS')
  if (at(0, [0x76, 0x2f, 0x31, 0x01])) return photo('OpenEXR')
  if (has(0, '#?RADIANCE') || has(0, '#?RGBE')) return photo('Radiance HDR')
  if (at(0, [0x42, 0x50, 0x47, 0xfb])) return photo('BPG')
  if (has(0, 'icns') && bytes.length >= 8 && readU32BE(bytes, 4) <= totalSize) return photo('Apple icon (ICNS)')
  if (has(0, 'FLIF')) return photo('FLIF')
  if (has(0, 'farbfeld')) return photo('farbfeld')
  if (has(0, 'SIMPLE  =')) return photo('FITS')
  if (at(0, [0xd7, 0xcd, 0xc6, 0x9a]) || at(0, [1, 0, 9, 0, 0, 3]) || at(0, [2, 0, 9, 0, 0, 3])) return photo('Windows metafile (WMF)')
  if (at(0, [1, 0, 0, 0]) && has(40, ' EMF')) return photo('Windows metafile (EMF)')
  if (bytes.length >= 4 && bytes[0] === 0x0a && [0, 2, 3, 4, 5].includes(bytes[1]) && bytes[2] === 1 && [1, 2, 4, 8].includes(bytes[3])) return photo('PCX')
  if (isNetpbm(bytes)) return photo('NetPBM')
  if (has(0, '/* XPM */')) return photo('XPM')
  if (/^#define [A-Za-z0-9_]+_width [0-9]+/.test(latin1Head(bytes, 96))) return photo('XBM')
  if ((zipMimetype(bytes) || '').startsWith('image/')) return photo('OpenRaster')
  return null
}

// -------------------------------------------------------------- text
const TEXT_SAMPLE_BYTES = 4096
// Tab, line feed, vertical tab, form feed, carriage return.
const TEXT_WHITESPACE: readonly number[] = [0x09, 0x0a, 0x0b, 0x0c, 0x0d]
const isTextCode = (code: number): boolean => TEXT_WHITESPACE.includes(code)
  || (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f) && code !== 0xfffe && code !== 0xffff)

function utf16Units(bytes: Uint8Array, start: number, littleEndian: boolean): number[] {
  const units: number[] = []
  for (let offset = start; offset + 1 < bytes.length; offset += 2) {
    units.push(littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1])
  }
  return units
}

// End of the last complete UTF-8 sequence (a read may stop mid-character).
function utf8CompleteEnd(bytes: Uint8Array, start: number): number {
  const end = bytes.length
  for (let back = 1; back <= 3 && end - back >= start; back += 1) {
    const byte = bytes[end - back]
    if ((byte & 0xc0) === 0x80) continue
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return need > back ? end - back : end
  }
  return end
}

// The text of `bytes`, or null when they are not text: UTF-8 (optional
// BOM), UTF-16 with a BOM, or 8-bit text in a legacy code page that is
// mostly ASCII -- with no control character except tab, line feed,
// vertical tab, form feed and carriage return (a DOS end-of-file byte may
// end the file). Binary data, every media format among it, has control
// bytes within its first few bytes. Only the first 4 KB are examined.
export function decodeText(bytes: Uint8Array, complete = true): string | null {
  const whole = complete && bytes.length <= TEXT_SAMPLE_BYTES
  let sample = bytes.subarray(0, TEXT_SAMPLE_BYTES)
  if (whole && sample.length && sample[sample.length - 1] === 0x1a) sample = sample.subarray(0, sample.length - 1)
  if (bufferStartsWith(sample, [0xff, 0xfe]) || bufferStartsWith(sample, [0xfe, 0xff])) {
    if (whole && sample.length % 2) return null
    const units = utf16Units(sample, 2, sample[0] === 0xff)
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index]
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = units[index + 1]
        if (next === undefined && !whole) break
        if (next === undefined || next < 0xdc00 || next > 0xdfff) return null
        index += 1
      } else if ((unit >= 0xdc00 && unit <= 0xdfff) || !isTextCode(unit)) {
        return null
      }
    }
    return String.fromCharCode(...units)
  }
  const start = bufferStartsWith(sample, [0xef, 0xbb, 0xbf]) ? 3 : 0
  const end = whole ? sample.length : utf8CompleteEnd(sample, start)
  let text: string | null = null
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(sample.subarray(start, end)) } catch { text = null }
  if (text !== null) {
    for (const char of text) if (!isTextCode(char.codePointAt(0)!)) return null
    return text
  }
  // Legacy 8-bit text (a Windows-1252 CSV export): no control bytes, and
  // at least three quarters plain ASCII.
  let asciiBytes = 0
  for (const byte of sample) {
    if ((byte < 0x20 && !TEXT_WHITESPACE.includes(byte)) || byte === 0x7f) return null
    if (byte < 0x80) asciiBytes += 1
  }
  return asciiBytes >= sample.length * 0.75 ? String.fromCharCode(...sample) : null
}

// Media formats that are plain text by design.
const TEXT_MEDIA_FORMATS: readonly string[] = ['XPM', 'XBM', 'NetPBM', 'Radiance HDR', 'FITS']

// S-uploads3 (2026-09-27): some signatures detectOtherMedia accepts are
// loose enough for text to meet them -- MPEG transport-stream sync bytes
// ('G') 188 apart in a CSV, the AC-3 sync word (vertical tab, 'w'). Media of
// every other format has control bytes within its first bytes, so when the
// data also decodes as text it is neither kept as media nor purged as text:
// it goes to review.
export function otherMediaLooksLikeText(other: OtherMedia, bytes: Uint8Array, complete = true): boolean {
  return !TEXT_MEDIA_FORMATS.includes(other.format) && decodeText(bytes, complete) !== null
}

// Worker only (not mirrored): the content type a stored file of another
// media format is written back with -- never a type a browser renders as a
// document. Formats without a plain media type are octet-stream; /uploads/*
// decides the served type itself (lib/r2.ts) and never replays this one.
const OTHER_MEDIA_TYPES: Readonly<Record<string, string>> = {
  'HEIC/HEIF': 'image/heic',
  BMP: 'image/bmp',
  'TIFF or camera raw': 'image/tiff',
  QuickTime: 'video/quicktime',
  AVI: 'video/x-msvideo',
  'M4A/M4B audio': 'audio/mp4',
  MP3: 'audio/mpeg',
}

export function otherMediaContentType(other: OtherMedia): string {
  if (other.format.startsWith('MP4 family')) return 'video/mp4'
  return OTHER_MEDIA_TYPES[other.format] || 'application/octet-stream'
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
