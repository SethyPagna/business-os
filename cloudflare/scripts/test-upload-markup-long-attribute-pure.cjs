// An event handler any distance after its tag start is refused (S-uploads4,
// refuter R-uploads3 finding C1, 2026-09-27).
//
// S-uploads3 refused a tag start ('<' and a letter) followed by an event
// handler attribute, but looked for the handler only within 1024 bytes of the
// tag start, and only inside the metadata part (JPEG segment, PNG chunk...)
// that held the tag start. A quoted attribute value is part of the tag, so
// one long value moved the handler out of reach, and so did a tag continued
// in the next segment. These passed as images:
//   <x title="A x1030" onclick=alert(1)>          in a JPEG comment
//   <a title="A x1100" onmouseover=alert(1)>      in a JPEG comment
//   <p title="A x1100" onmouseover=alert(1)>      in a PNG tEXt chunk
//   <x title="AAAA  |next segment|  AAAA" onclick=alert(1)>
//   <x title="  in compressed pixel data, the handler after the image's end
// Now, in lib/uploadSecurity.ts's containsEmbeddedMarkup (and the owner-run
// purge's mirror of it, verdict REVIEW), an event handler anywhere in a
// metadata/text part ('full' region) is refused when a tag starts anywhere
// before it in the file.
//
// Controls that must still be images: the same long attributes with no
// handler, words that only look like a handler, a handler-like phrase with no
// tag before it, handler-like bytes inside compressed pixel data (the scan
// keeps its false-positive budget there), real-shaped JPEG/PNG/GIF/WebP/AVIF.
// The refuter's 1000-byte case is refused before and after.
//
// S-uploads5 (refuter R-S-uploads4 F9): no case had its first tag start past
// 64 KB, so a tag-start search cut off there (a plausible "performance"
// bound) passed every check. Section 6 puts 64 KB+ of zero-filled metadata
// (an ICC profile, a colour table, a thumbnail placeholder) in front of the
// only tag in the file, in every carrier, bytes and UTF-16, through both
// mirrors. With firstTagStart cut at 64 KB in either mirror, sections 1-5
// still pass and section 6 fails 10 checks.
//
// Fails on 63a1a770 (every long and split case is accepted). Against older
// sources: UPLOAD_SECURITY_TS=... PURGE_SCRIPT=... node test-upload-markup-long-attribute-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const F = require('./harness/upload_fixtures.cjs')

const SECURITY_SOURCE = process.env.UPLOAD_SECURITY_TS || path.join(__dirname, '..', 'src', 'lib', 'uploadSecurity.ts')
const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')
function loadTs(filePath) {
  const outputText = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(loaded.exports, require, loaded, filePath, path.dirname(filePath))
  return loaded.exports
}
const security = loadTs(SECURITY_SOURCE)

// The window S-uploads3 searched after a tag start.
const OLD_WINDOW = 1024
const latin1 = (text) => F.latin1(text)
const utf16 = (text) => F.utf16le(text)
const PAD = ' '.repeat(2000)

function indexOfBytes(haystack, needle, from = 0) {
  for (let index = haystack.indexOf(needle[0], from); index !== -1; index = haystack.indexOf(needle[0], index + 1)) {
    let at = 1
    while (at < needle.length && haystack[index + at] === needle[at]) at += 1
    if (at === needle.length) return index
  }
  return -1
}
// A tag start: '<' and a letter, as bytes or UTF-16.
function firstTagStart(bytes) {
  const letter = (byte) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
  for (let index = bytes.indexOf(0x3c); index !== -1; index = bytes.indexOf(0x3c, index + 1)) {
    if (letter(bytes[index + 1]) || (bytes[index + 1] === 0 && letter(bytes[index + 2]) && bytes[index + 3] === 0)) return index
  }
  return -1
}
// Random bytes with no '<' (so no accidental tag start) and no '"' (so a
// browser reading the file as HTML stays inside the planted quoted value).
function scrubbed(seed, length) {
  const out = F.randomBytes(F.mulberry32(seed), length)
  for (let index = 0; index < out.length; index += 1) if (out[index] === 0x3c || out[index] === 0x22) out[index] = 0x41
  return out
}

// Every carrier puts its payload past the 1445-byte sniffing window, in a part
// the scan treats as metadata/text. `segmentLimit`: the largest payload it holds.
const CARRIERS = [
  ['JPEG comment', (payload) => F.jpeg({ segments: [F.APP_PADDING, F.comSegment(payload)] }), 65000],
  ['JPEG APP1 XMP', (payload) => F.jpeg({ segments: [F.APP_PADDING, F.jpegSegment(0xe1, F.bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/">', payload, '</x:xmpmeta>'))] }), 65000],
  ['PNG tEXt', (payload) => F.png(F.pngChunk('tEXt', F.bytes('Comment\0', PAD)), F.pngChunk('tEXt', F.bytes('Comment\0', payload))), Infinity],
  ['PNG iTXt', (payload) => F.png(F.pngChunk('tEXt', F.bytes('Comment\0', PAD)), F.pngChunk('iTXt', F.bytes('XML:com.adobe.xmp\0\0\0\0\0', payload))), Infinity],
  ['GIF comment', (payload) => F.gif({ extensions: [F.bytes([0x21, 0xfe], F.gifSubBlocks(F.bytes(PAD))), F.bytes([0x21, 0xfe], F.gifSubBlocks(payload))] }), Infinity],
  ['WebP XMP chunk', (payload) => F.webp(F.webpChunk('VP8X', new Uint8Array(10)), F.webpChunk('EXIF', F.bytes(PAD)), F.webpChunk('XMP ', payload)), Infinity],
  ['AVIF meta box', (payload) => F.avif(F.bytes(PAD, payload), F.randomBytes(F.mulberry32(5), 800)), Infinity],
]

// 64 KB+ of zero-filled metadata in front of the payload (section 6). A
// JPEG segment holds at most 65533 bytes, so it takes two there.
const DEEP_PADDING = 70000
const zeros = (length) => new Uint8Array(length)
const DEEP_CARRIERS = [
  ['JPEG: two zero-filled APP2 segments, then a comment', (payload) => F.jpeg({ segments: [F.jpegSegment(0xe2, zeros(DEEP_PADDING / 2)), F.jpegSegment(0xe2, zeros(DEEP_PADDING / 2)), F.comSegment(payload)] })],
  ['PNG: a zero-filled iCCP chunk, then tEXt', (payload) => F.png(F.pngChunk('iCCP', zeros(DEEP_PADDING)), F.pngChunk('tEXt', F.bytes('Comment\0', payload)))],
  ['GIF: a zero-filled application extension, then a comment', (payload) => F.gif({ extensions: [F.bytes([0x21, 0xff], F.gifSubBlocks(zeros(DEEP_PADDING))), F.bytes([0x21, 0xfe], F.gifSubBlocks(payload))] })],
  ['WebP: a zero-filled ICCP chunk, then XMP', (payload) => F.webp(F.webpChunk('VP8X', new Uint8Array(10)), F.webpChunk('ICCP', zeros(DEEP_PADDING)), F.webpChunk('XMP ', payload))],
  ['AVIF: zero-filled metadata, then the payload, in the meta box', (payload) => F.avif(F.bytes(zeros(DEEP_PADDING), payload), F.randomBytes(F.mulberry32(7), 800))],
]

// '%' is where the long attribute value goes.
const TEMPLATES = [
  '<x title="%" onclick=alert(1)>',
  '<a title="%" onmouseover=alert(1)>x</a>',
  '<p title="%" onmouseover=alert(1)>',
  "<x title='%' onclick=alert(1)>",
  '<x data-x=% onclick=alert(1)>',
]
const LENGTHS = [1030, 1100, 4096, 30000, 200000]

// The file for `template` with a value of about `length` bytes, placed so the
// handler lands in one piece (a GIF comment is cut into 255-byte sub-blocks;
// `step` says which way to move the length until it does), and the distance
// in the file from the vector's tag start to its handler's 'o'.
function place(build, template, length, encode, step = 1) {
  const [head, tail] = template.split('%')
  const tagBytes = encode(head)
  const handlerBytes = encode(tail)
  const toHandler = encode(tail.slice(0, tail.search(/on/i))).length
  for (let n = length; Math.abs(n - length) < 600; n += step) {
    const file = build(encode(head + 'A'.repeat(n) + tail))
    const tagAt = indexOfBytes(file, tagBytes)
    const handlerAt = tagAt === -1 ? -1 : indexOfBytes(file, handlerBytes, tagAt)
    if (handlerAt !== -1) return { file, distance: handlerAt + toHandler - tagAt }
  }
  throw new Error('the vector does not fit in the carrier in one piece')
}

// A tag continued in the next metadata part: the tag start in one, the handler
// in the next. [label, file, the gap between them in bytes (at least)].
function splitTags() {
  const tag = '<x title="'
  const handler = '" onclick=alert(1)>'
  const cases = []
  for (const run of [20, 40000]) {
    cases.push([`JPEG: tag start in one comment, handler in the next (${run}-byte value)`,
      F.jpeg({ segments: [F.APP_PADDING, F.comSegment(tag + 'A'.repeat(run)), F.comSegment('A'.repeat(run) + handler)] })])
    cases.push([`PNG: tag start in one tEXt chunk, handler in the next (${run}-byte value)`,
      F.png(F.pngChunk('tEXt', F.bytes('Comment\0', PAD)), F.pngChunk('tEXt', F.bytes('Comment\0', tag, 'A'.repeat(run))), F.pngChunk('tEXt', F.bytes('Comment\0', 'A'.repeat(run), handler)))])
    cases.push([`WebP: tag start in the XMP chunk, handler in the EXIF chunk (${run}-byte value)`,
      F.webp(F.webpChunk('VP8X', new Uint8Array(10)), F.webpChunk('ICCP', F.bytes(PAD)), F.webpChunk('XMP ', F.bytes(tag, 'A'.repeat(run))), F.webpChunk('EXIF', F.bytes('A'.repeat(run), handler)))])
    cases.push([`AVIF: tag start in the meta box, handler in a free box (${run}-byte value)`,
      F.bytes(F.ftyp('avif', 'mif1', 'miaf'), F.isoBox('meta', F.bytes(PAD, tag, 'A'.repeat(run))), F.isoBox('free', F.bytes('A'.repeat(run), handler)), F.isoBox('mdat', F.randomBytes(F.mulberry32(6), 800)))])
  }
  cases.push(['GIF: tag start in one comment extension, handler in the next',
    F.gif({ extensions: [F.bytes([0x21, 0xfe], F.gifSubBlocks(F.bytes(PAD))), F.bytes([0x21, 0xfe], F.gifSubBlocks(F.bytes(tag, 'AAAA'))), F.bytes([0x21, 0xfe], F.gifSubBlocks(F.bytes('AAAA', handler)))] })])
  return cases
}

// The tag start is in compressed pixel data past the sniffing window, the
// handler in a metadata/text part after it; nothing else in the file starts a
// tag. A browser reading these as HTML sees one tag with a long title.
function payloadTagStarts() {
  const cases = []
  const tag = F.latin1('<x title="')
  const handler = '" onclick=alert(1)>'
  const scan = scrubbed(71, 6000)
  scan.set(tag, 3000)
  const header = F.bytes([0xff, 0xd8],
    F.jpegSegment(0xe0, F.bytes('JFIF\0', [1, 1, 0, 0, 72, 0, 72, 0, 0])),
    F.jpegSegment(0xdb, F.bytes([0], new Uint8Array(64).fill(1))),
    F.jpegSegment(0xc0, F.bytes([8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])),
    F.jpegSegment(0xc4, F.bytes([0], new Uint8Array(28).fill(2))),
    F.jpegSegment(0xda, F.bytes([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])))
  cases.push(['JPEG: tag start in the scan data, handler after the end marker', F.bytes(header, F.entropyCoded(scan), [0xff, 0xd9], handler)])
  const idat = scrubbed(72, 6000)
  idat.set(tag, 3000)
  cases.push(['PNG: tag start in IDAT, handler in a later tEXt chunk', F.png(F.pngChunk('IDAT', idat), F.pngChunk('tEXt', F.bytes('Comment\0', handler)))])
  return cases
}

const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

async function main() {
  const purge = await import(pathToFileURL(PURGE_SOURCE).href)
  const purgeVerdict = (bytes) => purge.classifyObject({ key: 'uploads/photo.img', size: bytes.length, bytes, complete: true })
  function assertRefused(bytes) {
    const format = security.detectUploadFormat(bytes)
    assert.ok(format && format.kind === 'image', `the carrier is an allowed image (${JSON.stringify(format)})`)
    assert.equal(security.containsEmbeddedMarkup(bytes), true, 'containsEmbeddedMarkup')
    assert.throws(() => security.classifyUploadedBuffer(bytes), (error) => error.message === security.EMBEDDED_MARKUP_MESSAGE, 'classifyUploadedBuffer refuses it as embedded markup')
    assert.throws(() => security.validateUploadedBuffer(bytes, format.mime, 'photo' + format.extension), (error) => error.message === security.EMBEDDED_MARKUP_MESSAGE, 'validateUploadedBuffer refuses it as embedded markup')
    assert.equal(purge.containsEmbeddedMarkup(bytes), true, 'the purge mirror finds it')
    const verdict = purgeVerdict(bytes)
    assert.equal(verdict.action, 'review', JSON.stringify(verdict))
    assert.equal(verdict.group, 'image-with-code', JSON.stringify(verdict))
  }
  function assertImage(bytes) {
    const format = security.detectUploadFormat(bytes)
    assert.ok(format && format.kind === 'image', `the carrier is an allowed image (${JSON.stringify(format)})`)
    assert.equal(security.containsEmbeddedMarkup(bytes), false, 'containsEmbeddedMarkup')
    assert.equal(security.classifyUploadedBuffer(bytes).mime, format.mime, 'classifyUploadedBuffer accepts it')
    assert.equal(purge.containsEmbeddedMarkup(bytes), false, 'the purge mirror agrees')
    const verdict = purgeVerdict(bytes)
    assert.equal(verdict.action, 'keep', JSON.stringify(verdict))
  }

  // 1. The refuter's vectors and variants: long quoted/unquoted values, bytes
  //    and UTF-16, in every carrier.
  for (const [carrier, build, limit] of CARRIERS) {
    for (const template of TEMPLATES) {
      for (const length of LENGTHS) {
        for (const [encoding, encode, width] of [['bytes', latin1, 1], ['UTF-16', utf16, 2]]) {
          if (length * width + 200 > limit) continue
          check(`${carrier}, ${encoding}: ${template.replace('%', `A x${length}`)} is refused`, () => {
            const { file, distance } = place(build, template, length, encode)
            assert.ok(distance > OLD_WINDOW, `fixture: the handler is ${distance} bytes after the tag start`)
            assertRefused(file)
          })
        }
      }
    }
    // The refuter's control: 1000 bytes of value keeps the handler inside the
    // old window, and was refused before this fix too.
    check(`${carrier}: <x title="A x1000" onclick=alert(1)> is refused (control)`, () => {
      const { file, distance } = place(build, '<x title="%" onclick=alert(1)>', 1000, latin1, -1)
      assert.ok(distance < OLD_WINDOW, `fixture: the handler is ${distance} bytes after the tag start`)
      assertRefused(file)
    })
  }

  // 2. A tag continued across metadata parts.
  for (const [label, file] of splitTags()) check(`${label} is refused`, () => assertRefused(file))

  // 3. A tag start in compressed pixel data, the handler in metadata after it.
  for (const [label, file] of payloadTagStarts()) {
    check(`${label} is refused`, () => {
      const tagAt = firstTagStart(file)
      assert.ok(tagAt >= security.MARKUP_SNIFF_WINDOW_BYTES, `fixture: the first tag start is at ${tagAt}, in the pixel data past the sniffing window`)
      assertRefused(file)
    })
  }

  // 4. Controls: still images.
  const controls = []
  for (const [carrier, build, limit] of CARRIERS) {
    const run = Math.min(limit - 200, 200000)
    controls.push([`${carrier}: a ${run}-byte attribute with no handler`, build(latin1(`<x title="${'A'.repeat(run)}">`))])
    controls.push([`${carrier}: an XMP thumbnail attribute of ${run} bytes`, build(latin1(`<rdf:Description rdf:about="" xmp:CreatorTool="Camera 1.0" xmpGImg:image="${'QUJD'.repeat(run >> 2)}"/>`))])
    for (const after of ['" onclickx>', '" on=1>', '" one=1>', '" onab=1>', '" on-click=1>', '" online only>', '" on clicking=1>']) {
      controls.push([`${carrier}: a 5000-byte value then ${JSON.stringify(after)} (not a handler)`, build(latin1(`<x title="${'A'.repeat(5000)}${after}`))])
    }
    controls.push([`${carrier}: a caption with an e-mail address in angle brackets`, build(latin1('Photo by Ana <ana@example.com> on location, one=1, online only ' + 'x'.repeat(3000)))])
  }
  // A handler-like phrase with no tag start anywhere before it: text, not a tag.
  controls.push(['JPEG: "status online=yes" in a comment before any tag start, a <b> tag after it',
    F.jpeg({ segments: [F.APP_PADDING, F.comSegment('status online=yes, sale on now'), F.comSegment('<b>Sale</b>')] })])
  // Handler-like bytes in compressed pixel data past the sniffing window: the
  // scan does not look for handlers there (random data would refuse about one
  // 12 MB photo in a thousand), only for tokens of 6+ characters.
  const scan = F.randomBytes(F.mulberry32(73), 20000)
  scan.set(latin1(' onclick=alert(1)'), 12000)
  controls.push(['JPEG with XMP: handler-like bytes inside the scan data',
    F.jpeg({ segments: [F.jpegSegment(0xe1, F.bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>'))], scan })])
  const idat = F.randomBytes(F.mulberry32(74), 20000)
  idat.set(latin1(' onload=alert(1)'), 12000)
  controls.push(['PNG with an XMP iTXt: handler-like bytes inside IDAT',
    F.png(F.pngChunk('iTXt', F.bytes('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')), F.pngChunk('IDAT', idat))])
  // Real-shaped images of every allowed kind.
  for (const entry of F.catalogue()) {
    if (entry.markup === false && entry.worker && entry.worker.startsWith('image/')) controls.push([`catalogue: ${entry.name}`, entry.bytes])
  }
  for (const [label, file] of controls) check(`control: ${label} is still an image`, () => assertImage(file))

  // 5. The scan stays linear.
  check('a 4 MB text chunk of handler-like words after a tag start is scanned in well under a second', () => {
    const bytes = F.png(F.pngChunk('tEXt', F.bytes('Comment\0<x ', ' onab x'.repeat(600000))))
    const started = process.hrtime.bigint()
    assert.equal(security.containsEmbeddedMarkup(bytes), false)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`)
  })
  check('20,000 tag starts in 1 MB of metadata are scanned in well under a second', () => {
    const noise = F.bytes(...Array.from({ length: 20000 }, (_, index) => `<a${index % 10} ` + 'x'.repeat(40)))
    const bytes = F.png(F.pngChunk('tEXt', F.bytes('Comment\0', noise)))
    const started = process.hrtime.bigint()
    assert.equal(security.containsEmbeddedMarkup(bytes), false)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`)
  })

  // 6. The first tag start past 64 KB of zero-filled metadata.
  for (const [carrier, build] of DEEP_CARRIERS) {
    for (const [encoding, encode] of [['bytes', latin1], ['UTF-16', utf16]]) {
      check(`${carrier}, ${encoding}: <x title="A x1100" onclick=alert(1)> after ${DEEP_PADDING} zero bytes is refused`, () => {
        const { file } = place(build, '<x title="%" onclick=alert(1)>', 1100, encode)
        const tagAt = firstTagStart(file)
        assert.ok(tagAt > 65536, `fixture: the first tag start is at ${tagAt}`)
        assertRefused(file)
      })
      check(`control: ${carrier}, ${encoding}: <x title="A x1100"> after ${DEEP_PADDING} zero bytes is still an image`, () => {
        const file = build(encode(`<x title="${'A'.repeat(1100)}">`))
        assert.ok(firstTagStart(file) > 65536, 'fixture: the first tag start is past 64 KB')
        assertImage(file)
      })
    }
  }

  if (failures.length) {
    for (const failure of failures.slice(0, 40)) console.error(`FAIL ${failure}`)
    if (failures.length > 40) console.error(`...and ${failures.length - 40} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: an event handler any distance after a tag start -- a long attribute value, a tag continued in the next segment or chunk, a tag started in pixel data -- is refused in every JPEG/PNG/GIF/WebP/AVIF metadata part (purge: review); long attributes without a handler and real-shaped images are still images`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
