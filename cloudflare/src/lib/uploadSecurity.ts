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
export const EMBEDDED_MARKUP_TOKENS: readonly string[] = [
  '<script', '<html', '<svg', '<iframe', '<body', '<object', '<embed', '<!doctype html', '<meta', '<img', '<a href', 'javascript:',
  '<style', '<form', '<link', '<base', '<frame', '<frameset', '<applet', '<math',
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
  for (const region of planMarkupScan(bytes)) {
    if (markupInRange(bytes, region.start, region.end, region.mode)) return true
  }
  return false
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
