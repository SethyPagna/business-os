// Legacy VIDEOS under unusual names are served by their bytes (lib/r2.ts
// serveObject), S-uploads3 fix 1 (refuter R-uploads2, 2026-09-27).
//
// Owner rule (27 Sep 2026): storage holds images and videos, and a legacy
// file whose name says nothing about it is served by its BYTES when it is
// media. Images already were; videos were a 404: a phone clip stored as
// `.bin` (lib/fileAssets.ts's name for a file without an extension), with no
// extension at all, as .m4v / .3gp / .3g2 (no served-type map names those),
// or a QuickTime movie whose first atom is `free`.
//
//   - those keys serve the detected video type, as an ATTACHMENT, exactly like
//     the same bytes under .mp4 / .webm / .mov: same status, same headers
//     (nosniff, the sandbox CSP, accept-ranges, length), same body; Range and
//     HEAD answer the same way;
//   - a legacy MP4-family clip off the upload allowlist (a Canon `CAEP` brand)
//     is served as video/mp4 as the purge keeps it;
//   - non-media under those names is still a hardened 404: HTML, SVG, PDF,
//     plain text, text crafted to start like a QuickTime atom, an empty file,
//     and audio (storage serves images and videos only).
//
// Fails on 0d7493589a (every video case is a 404 there). To run it against an
// older r2.ts: R2_TS=/path/to/old/r2.ts node test-upload-legacy-video-sniff-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const F = require('./harness/upload_fixtures.cjs')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const R2_SOURCE = process.env.R2_TS || path.join(LIB, 'r2.ts')

function transpile(sourcePath, shim) {
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, shim || require, moduleObj)
  return moduleObj.exports
}

const uploadSecurity = transpile(path.join(LIB, 'uploadSecurity.ts'))
const r2 = transpile(R2_SOURCE, (request) => (request === './uploadSecurity' ? uploadSecurity : require(request)))
const { serveObject, UPLOAD_CONTENT_SECURITY_POLICY } = r2

// --- byte fixtures ---------------------------------------------------------
const MP4 = F.bytes(F.ftyp('isom', 'isom', 'iso2', 'mp41'), F.MOOV, F.MDAT)
const M4V = F.bytes(F.ftyp('M4V ', 'M4V ', 'mp42', 'isom'), F.MOOV, F.MDAT)
const THREE_GP = F.bytes(F.ftyp('3gp5', '3gp5', 'isom'), F.MOOV, F.MDAT)
const WEBM = F.bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01], 'webm', F.randomBytes(F.mulberry32(41), 300))
const QT_FREE = F.quickTime('free')
const QT_WIDE = F.quickTime('wide')
const CANON = F.bytes(F.ftyp('CAEP', 'CAEP', 'mp42'), F.MOOV, F.MDAT)
const M4A = F.bytes(F.ftyp('M4A ', 'M4A ', 'mp42', 'isom'), F.MOOV, F.MDAT)
const HTML = F.enc('<!doctype html><html><script>alert(document.cookie)</script></html>')
const SVG = F.enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')
const PDF = F.bytes('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n')
const NOTES = F.enc('stock count for the shop, 12 boxes of tea, 4 of coffee\n')
const FREE_NOTES = F.bytes([0, 0, 0, 8], 'free', 'hello text after a tiny header, and more notes')

// [key, bytes, the type it serves as, the extension-typed key it must match]
const VIDEOS = [
  ['uploads/realvid.bin', MP4, 'video/mp4', 'uploads/ref-mp4.mp4'],
  ['uploads/realvidnoext', MP4, 'video/mp4', 'uploads/ref-mp4.mp4'],
  ['uploads/real.m4v', M4V, 'video/mp4', 'uploads/ref-m4v.mp4'],
  ['uploads/REAL.M4V', M4V, 'video/mp4', 'uploads/ref-m4v.mp4'],
  ['uploads/v.3gp', THREE_GP, 'video/mp4', 'uploads/ref-3gp.mp4'],
  ['uploads/v.3g2', THREE_GP, 'video/mp4', 'uploads/ref-3gp.mp4'],
  ['uploads/webm.bin', WEBM, 'video/webm', 'uploads/ref.webm'],
  ['uploads/qt-free.bin', QT_FREE, 'video/quicktime', 'uploads/ref-free.mov'],
  ['uploads/qt-wide', QT_WIDE, 'video/quicktime', 'uploads/ref-wide.mov'],
  ['uploads/MVI_0001.bin', CANON, 'video/mp4', 'uploads/ref-canon.mp4'],
]
const REFUSED = [
  ['uploads/page.m4v', HTML],
  ['uploads/logo.3gp', SVG],
  ['uploads/invoice.3g2', PDF],
  ['uploads/notes.m4v', NOTES],
  ['uploads/notes.bin', NOTES],
  ['uploads/free-notes.bin', FREE_NOTES],
  ['uploads/free-notes.m4v', FREE_NOTES],
  ['uploads/song.bin', M4A],
  ['uploads/song.m4v', M4A],
  ['uploads/empty.m4v', new Uint8Array(0)],
]

// --- a fake R2 bucket with the binding's range / onlyIf semantics ----------
function makeBucket(seed) {
  const store = new Map(Object.entries(seed))
  return {
    async head(key) {
      const entry = store.get(key)
      return entry ? { key, size: entry.bytes.length, httpEtag: `"etag-${key}"`, etag: `etag-${key}` } : null
    },
    async get(key, options = {}) {
      const entry = store.get(key)
      if (!entry) return null
      const bytes = entry.bytes
      const size = bytes.length
      const httpEtag = `"etag-${key}"`
      const meta = { key, size, httpEtag, etag: `etag-${key}`, httpMetadata: { contentType: 'text/html' }, writeHttpMetadata(headers) { headers.set('content-type', 'text/html') } }
      const inm = options.onlyIf instanceof Headers ? options.onlyIf.get('if-none-match') : null
      if (inm && inm.split(',').some((tag) => tag.trim().replace(/^W\//, '') === httpEtag)) return meta
      let start = 0
      let end = size
      const range = options.range
      if (range) {
        if ('suffix' in range) {
          if (!(range.suffix > 0)) throw new Error('get: The requested range is not satisfiable (10039)')
          start = Math.max(0, size - range.suffix)
        } else {
          const offset = range.offset ?? 0
          let length = range.length ?? size - offset
          if (offset > size) throw new Error('get: The requested range is not satisfiable (10039)')
          if (offset + length > size) length = size - offset
          if (length <= 0) throw new Error('get: The requested range is not satisfiable (10039)')
          start = offset
          end = offset + length
        }
      }
      return { ...meta, range, body: new Blob([bytes.slice(start, end)]).stream() }
    },
  }
}

const seed = {}
for (const [key, bytes, , ref] of VIDEOS) { seed[key] = { bytes }; seed[ref] = { bytes } }
for (const [key, bytes] of REFUSED) seed[key] = { bytes }
const bucket = makeBucket(seed)

const serve = (key, headers = {}, method = 'GET') => serveObject(bucket, key, new Request(`https://shop.example/${key}`, { method, headers }))
const bodyBytes = async (res) => new Uint8Array(await res.arrayBuffer())
// Everything but the names that legitimately differ between two keys.
function comparableHeaders(res) {
  const out = {}
  for (const [name, value] of res.headers) if (name !== 'etag' && name !== 'content-disposition') out[name] = value
  return out
}
function assertVideo(res, type, label) {
  assert.strictEqual(res.headers.get('content-type'), type, `${label}: type`)
  assert.match(res.headers.get('content-disposition') || '', /^attachment; filename="[\w.-]+"$/, `${label}: attachment`)
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  assert.strictEqual(res.headers.get('content-security-policy'), UPLOAD_CONTENT_SECURITY_POLICY, `${label}: sandbox CSP`)
}
async function assertDenied(res, label) {
  assert.strictEqual(res.status, 404, `${label}: 404`)
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  assert.strictEqual(res.headers.get('content-security-policy'), UPLOAD_CONTENT_SECURITY_POLICY, `${label}: CSP`)
  assert.ok(!/^(video|audio|text\/html)/.test(res.headers.get('content-type') || ''), `${label}: no media or HTML type`)
  const text = await res.text()
  assert.ok(!/script|svg|PDF|ftyp|free|stock/i.test(text), `${label}: stored bytes never leak`)
}

const failures = []
let checks = 0
async function check(label, fn) {
  checks += 1
  try { await fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

async function main() {
  for (const [key, bytes, type, ref] of VIDEOS) {
    await check(`${key}: GET is 200 ${type}, an attachment, the whole object, like ${ref}`, async () => {
      const res = await serve(key)
      assert.strictEqual(res.status, 200, 'status')
      assertVideo(res, type, key)
      assert.deepStrictEqual(await bodyBytes(res), bytes, 'the whole object')
      const reference = await serve(ref)
      assert.strictEqual(reference.status, 200, 'reference status')
      assert.deepStrictEqual(comparableHeaders(res), comparableHeaders(reference), 'the same headers as the extension-typed video')
    })
    await check(`${key}: Range bytes=0-1 is a 206 of two bytes, like ${ref}`, async () => {
      const res = await serve(key, { range: 'bytes=0-1' })
      assert.strictEqual(res.status, 206, 'status')
      assertVideo(res, type, key)
      assert.strictEqual(res.headers.get('content-range'), `bytes 0-1/${bytes.length}`, 'content-range')
      assert.deepStrictEqual(await bodyBytes(res), bytes.slice(0, 2), 'two bytes')
      const reference = await serve(ref, { range: 'bytes=0-1' })
      assert.strictEqual(reference.status, 206)
      assert.deepStrictEqual(comparableHeaders(res), comparableHeaders(reference), 'the same headers as the extension-typed video')
    })
    await check(`${key}: HEAD is 200 with the length and no body, like ${ref}`, async () => {
      const res = await serve(key, {}, 'HEAD')
      assert.strictEqual(res.status, 200, 'status')
      assertVideo(res, type, key)
      assert.strictEqual(res.headers.get('content-length'), String(bytes.length), 'content-length')
      assert.strictEqual((await bodyBytes(res)).length, 0, 'no body')
      const reference = await serve(ref, {}, 'HEAD')
      assert.deepStrictEqual(comparableHeaders(res), comparableHeaders(reference), 'the same headers as the extension-typed video')
    })
  }
  await check('a conditional GET on a sniffed video is a 304 carrying the video type', async () => {
    const res = await serve('uploads/realvid.bin', { 'if-none-match': '"etag-uploads/realvid.bin"' })
    assert.strictEqual(res.status, 304)
    assertVideo(res, 'video/mp4', '304')
  })
  for (const [key] of REFUSED) {
    await check(`${key}: not an image or video -> 404`, async () => assertDenied(await serve(key), key))
    await check(`${key}: Range and HEAD are refused too`, async () => {
      await assertDenied(await serve(key, { range: 'bytes=0-1' }), `${key} range`)
      const head = await serve(key, {}, 'HEAD')
      assert.strictEqual(head.status, 404, `${key} HEAD`)
    })
  }

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: legacy videos under .bin/no extension/.m4v/.3gp/.3g2 serve by their bytes like .mp4/.webm/.mov; non-media stays 404`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
