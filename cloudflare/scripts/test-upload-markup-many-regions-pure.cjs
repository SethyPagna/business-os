// The embedded-markup scan stays linear however many metadata parts an image
// has (S-uploads5, refuter R-S-uploads4 finding F11, 2026-09-28).
//
// containsEmbeddedMarkup searches each part of an image ('region': a JPEG
// segment, a PNG chunk, a GIF extension, a WebP chunk) for tokens and, after
// the first tag start, for an event handler. The search started with the
// native indexOf at the region's start and stopped at the first hit at or past
// the region's end -- but indexOf itself is not bounded by the end, so a part
// with no candidate byte ('o' for a handler, '<'/'j' for a token) scanned on
// to the end of the file. One such scan per part makes a crafted image of
// many tiny parts quadratic: the refuter measured 44 s (tag start, no 'o')
// and 91 s (no 'j', no 'o') for 0.5 MiB of 8-byte JPEG comments, where 25 MB
// uploads are allowed. S-uploads4's handler search after any tag start made
// the first shape quadratic; the token search already was for the second.
// The search now runs on a view that ends at the region's end, in
// uploadSecurity.ts and in the owner-run purge's mirror.
//
// Checked, in both mirrors: 256 KiB of tiny JPEG/PNG/GIF/WebP parts of
// either shape is scanned in under 3 s (about 0.1-0.3 s linear, 10-25 s
// quadratic on the refuter's machine), still not markup; the same with an
// event handler or a <script> in the last part is still refused, so the
// bound loses nothing at the far end.
//
// Against older sources:
//   UPLOAD_SECURITY_TS=... PURGE_SCRIPT=... node test-upload-markup-many-regions-pure.cjs
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

const SIZE = 256 * 1024
const BOUND_MS = 3000
// The two shapes the refuter timed: a tag start and no 'o' (every handler
// search misses), and no 'j' and no 'o' (every token search for 'javascript:'
// and every handler search misses).
const SHAPES = [['"<ajJ" (a tag start, no handler candidate)', '<ajJ'], ['"<a<a" (no "j", no "o")', '<a<a']]
// A carrier made of `count` parts each holding `payload`, then `last`.
const CARRIERS = [
  ['JPEG of 8-byte comment segments', (payload, count, last) => F.bytes([0xff, 0xd8], ...Array(count).fill(F.comSegment(payload)), F.comSegment(last), [0xff, 0xda, 0, 2], F.randomBytes(F.mulberry32(3), 64), [0xff, 0xd9]), 8],
  ['PNG of 16-byte tEXt chunks', (payload, count, last) => F.png(...Array(count).fill(F.pngChunk('tEXt', F.enc(payload))), F.pngChunk('tEXt', F.enc(last))), 16],
  ['GIF of 8-byte comment extensions', (payload, count, last) => F.gif({ extensions: [...Array(count).fill(F.bytes([0x21, 0xfe], F.gifSubBlocks(F.enc(payload)))), F.bytes([0x21, 0xfe], F.gifSubBlocks(F.enc(last)))] }), 8],
  ['WebP of 12-byte XMP chunks', (payload, count, last) => F.webp(F.webpChunk('VP8X', new Uint8Array(10)), ...Array(count).fill(F.webpChunk('XMP ', F.enc(payload))), F.webpChunk('XMP ', F.enc(last))), 12],
]

const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}
function timed(fn) {
  const started = process.hrtime.bigint()
  const value = fn()
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 }
}

async function main() {
  const purge = await import(pathToFileURL(PURGE_SOURCE).href)
  const mirrors = [['uploadSecurity.ts', security], ['purge mirror', purge]]
  for (const [carrier, build, partBytes] of CARRIERS) {
    for (const [shape, payload] of SHAPES) {
      const count = Math.floor(SIZE / partBytes)
      const plain = build(payload, count, payload)
      const endings = [
        ['nothing else', plain, false],
        ['an event handler in the last part', build(payload, count, 'x onclick=alert(1)>'), true],
        ['a <script> in the last part', build(payload, count, '<script>'), true],
      ]
      check(`fixture: ${carrier} of ${shape} is an allowed image of ${count}+ parts`, () => {
        const format = security.detectUploadFormat(plain)
        assert.ok(format && format.kind === 'image', JSON.stringify(format))
        assert.ok(plain.length >= SIZE, `${plain.length} bytes`)
      })
      for (const [mirror, module] of mirrors) {
        for (const [ending, bytes, expected] of endings) {
          check(`${mirror}: ${carrier}, ${shape}, then ${ending}: ${expected ? 'refused' : 'an image'} in under ${BOUND_MS} ms`, () => {
            const { value, ms } = timed(() => module.containsEmbeddedMarkup(bytes))
            assert.equal(value, expected)
            assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms for ${bytes.length} bytes`)
          })
        }
      }
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: 256 KiB images of tiny JPEG/PNG/GIF/WebP metadata parts (a tag start with no handler candidate, or no candidate at all) are scanned in under ${BOUND_MS} ms by uploadSecurity.ts and the purge mirror, and a handler or <script> in the last part is still refused`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
