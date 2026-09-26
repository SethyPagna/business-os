// Event handlers on any tag, in every scanned metadata/text part (S-uploads3
// fix 4, refuter R-uploads2, 2026-09-27).
//
// lib/uploadSecurity.ts's containsEmbeddedMarkup looked for a fixed list of
// tag tokens, and for event handler attributes only inside C2PA manifests.
// So script on a tag not in the list, in a JPEG comment, XMP, a PNG text
// chunk, a GIF comment, a WebP chunk or an AVIF meta box, passed as an image:
//   <details open ontoggle=...>  <input autofocus onfocus=...>
//   <video src=x onerror=...>    <audio src=x onerror=...>
//   <marquee onstart=...>        <textarea|select autofocus onfocus=...>
//   <x onclick=...>              (any unknown tag)
// Now, in every 'full' region (the first 1445 bytes and all metadata/text
// parts), a tag start followed by an event handler attribute is refused
// whatever the tag, and those tags are tokens as well. The owner-run purge
// mirrors it (its verdict is REVIEW, image-with-code), token for token --
// test-upload-classifier-parity-pure.cjs holds that.
//
// Controls: ordinary metadata (XMP, a caption with an e-mail in angle
// brackets and the word "on", a harmless <b> tag) is still an image.
//
// Fails on 0d7493589a. Against older sources:
//   UPLOAD_SECURITY_TS=... PURGE_SCRIPT=... node test-upload-markup-event-handler-tags-pure.cjs
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

const VECTORS = [
  '<details open ontoggle=alert(1)>',
  '<input autofocus onfocus=alert(1)>',
  '<video src=x onerror=alert(1)>',
  '<audio src=x onerror=alert(1)>',
  '<marquee onstart=alert(1)>',
  '<textarea autofocus onfocus=alert(1)>',
  '<select autofocus onfocus=alert(1)>',
  '<x onclick=alert(1)>click',
  '<custom-el onmouseover=alert(1)>',
  '<a onpointerenter=alert(1)>x</a>',
  '<video><source onerror=alert(1)>',
  '<x title=">" onclick=alert(1)>',
  '<x\nonclick\t=\nalert(1)>',
  '<X ONCLICK=alert(1)>',
  '<x/onclick=alert(1)>',
  '<details>',
  '<template>',
  '<noscript>',
]
// A byte string, or UTF-16LE of it.
const latin1 = (text) => F.latin1(text)
const utf16 = (text) => F.utf16le(text)
const PAD = ' '.repeat(2000)

// Every carrier puts the vector past the 1445-byte sniffing window, in a part
// the scan treats as metadata/text.
const CARRIERS = {
  'JPEG comment': (payload) => F.jpeg({ segments: [F.APP_PADDING, F.comSegment(payload)] }),
  'JPEG APP1 XMP': (payload) => F.jpeg({ segments: [F.APP_PADDING, F.jpegSegment(0xe1, F.bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/">', payload, '</x:xmpmeta>'))] }),
  'PNG tEXt': (payload) => F.png(F.pngChunk('tEXt', F.bytes('Comment\0', PAD)), F.pngChunk('tEXt', F.bytes('Comment\0', payload))),
  'PNG iTXt': (payload) => F.png(F.pngChunk('tEXt', F.bytes('Comment\0', PAD)), F.pngChunk('iTXt', F.bytes('XML:com.adobe.xmp\0\0\0\0\0', payload))),
  'GIF comment': (payload) => F.gif({ extensions: [F.bytes([0x21, 0xfe], F.gifSubBlocks(F.bytes(PAD))), F.bytes([0x21, 0xfe], F.gifSubBlocks(payload))] }),
  'WebP XMP chunk': (payload) => F.webp(F.webpChunk('VP8X', new Uint8Array(10)), F.webpChunk('EXIF', F.bytes(PAD)), F.webpChunk('XMP ', payload)),
  'AVIF meta box': (payload) => F.avif(F.bytes(PAD, payload), F.randomBytes(F.mulberry32(5), 800)),
}

const CONTROLS = [
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description rdf:about="" xmp:CreatorTool="Camera 1.0" photoshop:Source="shop"/></rdf:RDF></x:xmpmeta>',
  'Photo by Ana <ana@example.com> on location, one=1, online only',
  'caption: <b>Sale</b> on now',
]

const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

async function main() {
  const purge = await import(pathToFileURL(PURGE_SOURCE).href)
  const judge = (bytes) => ({
    worker: security.containsEmbeddedMarkup(bytes),
    format: security.detectUploadFormat(bytes),
    purge: purge.classifyObject({ key: 'uploads/photo.jpg', size: bytes.length, bytes, complete: true }),
  })
  for (const [carrier, build] of Object.entries(CARRIERS)) {
    for (const vector of VECTORS) {
      for (const [encoding, encode] of [['bytes', latin1], ['UTF-16', utf16]]) {
        check(`${carrier}, ${encoding}: ${JSON.stringify(vector)} is refused by the upload gate and reviewed by the purge`, () => {
          const bytes = build(encode(vector))
          const verdict = judge(bytes)
          assert.ok(verdict.format && verdict.format.kind === 'image', `the carrier is an allowed image (${JSON.stringify(verdict.format)})`)
          assert.equal(verdict.worker, true, 'containsEmbeddedMarkup')
          assert.throws(() => security.classifyUploadedBuffer(bytes), 'classifyUploadedBuffer refuses it')
          assert.equal(verdict.purge.action, 'review', JSON.stringify(verdict.purge))
          assert.equal(verdict.purge.group, 'image-with-code', JSON.stringify(verdict.purge))
        })
      }
    }
    for (const control of CONTROLS) {
      check(`${carrier}: ordinary metadata ${JSON.stringify(control.slice(0, 40))} is still an image`, () => {
        const bytes = build(latin1(control))
        const verdict = judge(bytes)
        assert.equal(verdict.worker, false, 'containsEmbeddedMarkup')
        assert.equal(security.classifyUploadedBuffer(bytes).kind, 'image')
        assert.equal(verdict.purge.action, 'keep', JSON.stringify(verdict.purge))
      })
    }
  }
  // The scan stays linear: many tag starts with no handler do not rescan
  // the same bytes (each byte is looked at once).
  check('20,000 tag starts in 1 MB of metadata are scanned in well under a second', () => {
    const noise = F.bytes(...Array.from({ length: 20000 }, (_, index) => `<a${index % 10} ` + 'x'.repeat(40)))
    const bytes = F.png(F.pngChunk('tEXt', F.bytes('Comment\0', noise)))
    const started = process.hrtime.bigint()
    assert.equal(security.containsEmbeddedMarkup(bytes), false)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`)
  })

  if (failures.length) {
    for (const failure of failures.slice(0, 40)) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: an event handler on any tag, and the script-capable tags, in every metadata/text part of JPEG/PNG/GIF/WebP/AVIF are refused (purge: review); ordinary metadata is still an image`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
