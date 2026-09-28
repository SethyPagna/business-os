// Text is not media because a QuickTime atom header or an ID3 tag header
// sits in front of it (S-uploads4, refuter R-uploads3 finding C2, 2026-09-27).
//
// S-uploads3 kept crafted text out of the "other media" the purge keeps by
// requiring every QuickTime atom header to fit in the file and an ID3 tag to
// fit in the file. R-uploads3 kept text as media anyway behind a size-0 atom
// (size 0 means "runs to the end of the file") or an empty ID3 tag: the
// header's zero bytes stop decodeText, so otherMediaLooksLikeText never sees
// the text. The upload allowlist had the same size-0 rule and took
// `00 00 00 00 mdat` + text as video/quicktime. The fix judges what the
// atoms or the tag hold, their headers set aside.
//
// Each crafted file must be refused by every caller of the classifier:
//   - the owner-run purge (classifyObject) sends it to REVIEW -- never keeps
//     it, never purges it -- as a whole file and as the head of a larger one;
//   - the upload allowlist refuses it (classifyUploadedBuffer), and
//     detectOtherMedia does not keep it as media;
//   - backup restore withholds it as not-media (lib/backup.ts
//     judgeRestoredAsset), and /uploads/<key>.bin is a 404 (lib/r2.ts
//     serveObject), as the refuter measured them.
// Real media must not move: classic QuickTime movies with a trailing size-0
// mdat or a free atom holding text, MP4/MOV ending with a size-0 mdat, 64-bit
// sizes, heads of large files, MP3 with an empty, padded or real ID3 tag, and
// every catalogue fixture (JPEG/PNG/WebP/GIF/AVIF/MP4, CSV, PDF...) keeps its
// verdict.
//
// Fails on 5329c28c (and 63a1a770): every size-0/empty-tag case is kept as
// media. Against older sources:
//   UPLOAD_SECURITY_TS=... PURGE_SCRIPT=... node test-upload-empty-container-text-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const F = require('./harness/upload_fixtures.cjs')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const SECURITY_SOURCE = process.env.UPLOAD_SECURITY_TS || path.join(LIB, 'uploadSecurity.ts')
const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')

// lib/*.ts through the TypeScript compiler; './x' imports resolve to lib/x.ts
// (uploadSecurity to SECURITY_SOURCE), one instance each.
const modules = new Map()
function loadLib(id) {
  const file = id === './uploadSecurity' ? SECURITY_SOURCE : path.join(LIB, `${id.slice(2)}.ts`)
  if (modules.has(file)) return modules.get(file).exports
  const outputText = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const loaded = { exports: {} }
  modules.set(file, loaded)
  const load = (request) => (request.startsWith('./') ? loadLib(request) : require(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(loaded.exports, load, loaded, file, path.dirname(file))
  return loaded.exports
}
const security = loadLib('./uploadSecurity')
const { judgeRestoredAsset } = loadLib('./backup')
const { serveObject } = loadLib('./r2')

// ------------------------------------------------------------- fixtures
const EMPTY = new Uint8Array(0)
const NOTES = F.enc('Stock count for the shop: 12 boxes of tea, 4 of coffee.\nCall the supplier on Monday.\n')
const CSV = F.enc('sku,name,qty\nA-1,Green tea,12\nB-2,Coffee,4\n')
const HTML = F.enc('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>\n')
// 4200 bytes of three-byte characters: the 4096-byte text sample ends
// inside one.
const KHMER = F.enc('ក'.repeat(1400))
const VIDEO = F.randomBytes(F.mulberry32(71), 3000)
const FRAMES = F.bytes([0xff, 0xfb, 0x90, 0x64], F.randomBytes(F.mulberry32(72), 413), [0xff, 0xfb, 0x90, 0x64], F.randomBytes(F.mulberry32(73), 413))

// An atom of size 0: it runs to the end of the file.
const size0 = (type, ...content) => F.bytes([0, 0, 0, 0], type, ...content)
const syncsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const id3 = (version, size, ...rest) => F.bytes('ID3', [version, 0, 0], syncsafe(size), ...rest)
const emptyAtoms = (count) => Array.from({ length: count }, () => F.isoBox('free', EMPTY))
// ID3 v2.4 and v2.2 title frames, then padding.
const TAG_24 = F.bytes('TIT2', syncsafe(11), [0, 0], [3], 'Song title', new Uint8Array(30))
const TAG_22 = F.bytes('TT2', [0, 0, 11], [0], 'Song title', new Uint8Array(12))

const CRAFTED = [
  // The refuter's rows (R-uploads3 C2).
  ['a size-0 free atom, then notes', size0('free', NOTES)],
  ['a size-0 wide atom, then notes', size0('wide', NOTES)],
  ['ID3 v2.3, tag size 0, then notes', id3(3, 0, NOTES)],
  ['ID3 v2.4, tag size 0, then a CSV', id3(4, 0, CSV)],
  // R-uploads2's rows, refused since S-uploads3; they must stay refused.
  ['an empty free atom, then notes', F.bytes(F.isoBox('free', EMPTY), NOTES)],
  ['"ID3", version 3, then notes', F.bytes('ID3', [3, 0], NOTES)],
  // The same header with every leading atom and ID3 version.
  ['a size-0 skip atom, then notes', size0('skip', NOTES)],
  ['a size-0 pnot atom, then notes', size0('pnot', NOTES)],
  ['a size-0 mdat atom, then notes', size0('mdat', NOTES)],
  ['a size-0 moov atom, then a web page', size0('moov', HTML)],
  ['a size-0 mdat atom, then a web page', size0('mdat', HTML)],
  ['a size-0 free atom, then a web page', size0('free', HTML)],
  ['ID3 v2.2, tag size 0, then notes', id3(2, 0, NOTES)],
  // Other ways to put the text inside the atoms or the tag.
  ['an empty mdat atom, then a web page', F.bytes(F.isoBox('mdat', EMPTY), HTML)],
  ['a free atom sized to the whole file, holding notes', F.isoBox('free', NOTES)],
  ['a 64-bit free atom sized to the whole file, holding a CSV', F.bytes([0, 0, 0, 1], 'free', F.u32be(0), F.u32be(16 + CSV.length), CSV)],
  ['a wide atom, then a size-0 free atom holding notes', F.bytes(F.isoBox('wide', EMPTY), size0('free', NOTES))],
  ['70 empty free atoms, then notes', F.bytes(...emptyAtoms(70), NOTES)],
  ['an empty mdat and 70 empty free atoms, then a web page', F.bytes(F.isoBox('mdat', EMPTY), ...emptyAtoms(70), HTML)],
  ['ID3 v2.3 with 20 bytes of padding, then notes', id3(3, 20, new Uint8Array(20), NOTES)],
  ['ID3 v2.3 whose tag holds the notes', id3(3, NOTES.length, NOTES)],
  ['a size-0 free atom, then 4 KB of Khmer notes', size0('free', KHMER)],
  ['a size-0 free atom, then UTF-16 notes with a byte order mark', size0('free', [0xff, 0xfe], F.utf16le('Stock count for the shop\r\n'))],
]

// [label, bytes, key, upload allowlist type, purge group, restored type,
//  served type under a .bin key (null: not served, storage serves only
//  images and videos)]
const REAL = [
  ['a classic MOV: wide, moov, then a size-0 mdat of video', F.bytes(F.isoBox('wide', EMPTY), F.MOOV, size0('mdat', VIDEO)), 'uploads/old1.mov', 'video/quicktime', 'videos', 'video/quicktime', 'video/quicktime'],
  ['a classic MOV that is one size-0 mdat of video', size0('mdat', VIDEO), 'uploads/old2.mov', 'video/quicktime', 'videos', 'video/quicktime', 'video/quicktime'],
  ['a classic MOV whose free atom holds text, then moov and mdat', F.bytes(F.isoBox('free', F.enc('IsoMedia File Produced by Google, 5-11-2011')), F.MOOV, F.MDAT), 'uploads/old3.mov', 'video/quicktime', 'videos', 'video/quicktime', 'video/quicktime'],
  ['a classic MOV: moov, a free atom holding text, a size-0 mdat', F.bytes(F.MOOV, F.isoBox('free', F.enc('encoder: QuickTime 7.7')), size0('mdat', VIDEO)), 'uploads/old4.mov', 'video/quicktime', 'videos', 'video/quicktime', 'video/quicktime'],
  ['a classic MOV with a 64-bit mdat', F.quickTime('skip'), 'uploads/old5.mov', 'video/quicktime', 'videos', 'video/quicktime', 'video/quicktime'],
  ['an iPhone MOV (ftyp qt) ending with a size-0 mdat', F.bytes(F.ftyp('qt  ', 'qt  '), F.isoBox('wide', EMPTY), F.MOOV, size0('mdat', VIDEO)), 'uploads/iphone2.mov', 'video/quicktime', 'videos', 'video/quicktime', 'video/quicktime'],
  ['an MP4 ending with a size-0 mdat', F.bytes(F.ftyp('isom', 'isom', 'mp41'), F.MOOV, size0('mdat', VIDEO)), 'uploads/clip2.mp4', 'video/mp4', 'videos', 'video/mp4', 'video/mp4'],
  ['a size-0 free atom of zeros (QuickTime-like)', size0('free', new Uint8Array(40)), 'uploads/partial2.mov', null, 'other-video-audio', 'video/quicktime', 'video/quicktime'],
  ['MP3: an empty ID3 tag, then frames', id3(3, 0, FRAMES), 'uploads/a.mp3', null, 'other-video-audio', 'audio/mpeg', null],
  ['MP3: an ID3 tag of 20 bytes of padding, then frames', id3(3, 20, new Uint8Array(20), FRAMES), 'uploads/b.mp3', null, 'other-video-audio', 'audio/mpeg', null],
  ['MP3: ID3 v2.4 with a title frame and padding, then frames', id3(4, TAG_24.length, TAG_24, FRAMES), 'uploads/c.mp3', null, 'other-video-audio', 'audio/mpeg', null],
  ['MP3: ID3 v2.2 with a title frame and padding, then frames', id3(2, TAG_22.length, TAG_22, FRAMES), 'uploads/d.mp3', null, 'other-video-audio', 'audio/mpeg', null],
]

// The first 4 KB of a large file (the purge reads no more).
const MB5 = 5 * 1024 * 1024
const HEADS = [
  ['a 5 MB classic MOV whose first free atom runs past the bytes read', F.bytes(F.u32be(1 << 20), 'free', new Uint8Array(4088)), MB5, 'uploads/big1.mov', 'other-video-audio'],
  ['a 5 MB classic MOV: wide, then an mdat running past the bytes read', F.bytes(F.isoBox('wide', EMPTY), F.u32be(MB5 - 8), 'mdat', F.randomBytes(F.mulberry32(74), 4080)), MB5, 'uploads/big2.mov', 'videos'],
  ['a 5 MB classic MOV that is one size-0 mdat', size0('mdat', F.randomBytes(F.mulberry32(75), 4088)), MB5, 'uploads/big3.mov', 'videos'],
  ['a 5 MB MP3 whose ID3 tag (cover art) runs past the bytes read', id3(3, 300000, 'APIC', F.u32be(299990), [0, 0], [0], 'image/jpeg', [0, 3, 0], F.randomBytes(F.mulberry32(76), 4050)).subarray(0, 4096), MB5, 'uploads/big.mp3', 'other-video-audio'],
]

// A fake R2 bucket: GET with a byte range, as lib/r2.ts reads it.
function makeBucket(objects) {
  return {
    async head(key) {
      const bytes = objects.get(key)
      return bytes ? { key, size: bytes.length, httpEtag: `"etag-${key}"`, etag: `etag-${key}` } : null
    },
    async get(key, options = {}) {
      const bytes = objects.get(key)
      if (!bytes) return null
      const size = bytes.length
      let start = 0
      let end = size
      if (options.range) {
        const offset = options.range.offset ?? 0
        const length = Math.min(options.range.length ?? size - offset, size - offset)
        if (offset > size || length <= 0) throw new Error('get: The requested range is not satisfiable (10039)')
        start = offset
        end = offset + length
      }
      return {
        key, size, httpEtag: `"etag-${key}"`, etag: `etag-${key}`, range: options.range,
        httpMetadata: { contentType: 'text/html' },
        writeHttpMetadata(headers) { headers.set('content-type', 'text/html') },
        body: new Blob([bytes.slice(start, end)]).stream(),
      }
    },
  }
}
async function served(key, bytes) {
  const response = await serveObject(makeBucket(new Map([[key, bytes]])), key, new Request(`https://shop.example/${key}`))
  await response.arrayBuffer()
  return { status: response.status, type: response.headers.get('content-type'), nosniff: response.headers.get('x-content-type-options') }
}

// ------------------------------------------------------------- checks
const failures = []
let checks = 0
async function check(label, fn) {
  checks += 1
  try { await fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}
const throwsMessage = (fn) => { try { fn(); return null } catch (error) { return error.message } }

async function main() {
  const purge = await import(pathToFileURL(PURGE_SOURCE).href)

  // 1. Crafted text behind a header: refused everywhere.
  for (const [label, bytes] of CRAFTED) {
    const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    await check(`crafted, purge: ${label} -> review`, () => {
      const verdict = purge.classifyObject({ key: `uploads/${slug}.bin`, size: bytes.length, bytes })
      assert.equal(verdict.action, 'review', `${verdict.action} / ${verdict.group} / ${verdict.format}`)
    })
    await check(`crafted, purge: ${label}, as the head of a larger file -> review`, () => {
      const verdict = purge.classifyObject({ key: `uploads/${slug}.bin`, size: bytes.length + 100000, bytes, complete: false })
      assert.equal(verdict.action, 'review', `${verdict.action} / ${verdict.group} / ${verdict.format}`)
    })
    await check(`crafted, upload: ${label} is refused`, () => {
      assert.equal(throwsMessage(() => security.classifyUploadedBuffer(bytes)), security.UNSUPPORTED_UPLOAD_MESSAGE, `accepted as ${(security.detectUploadFormat(bytes) || {}).mime}`)
    })
    await check(`crafted, stored media: ${label} is not kept as media`, () => {
      for (const [head, total] of [[bytes, bytes.length], [bytes, bytes.length + 100000]]) {
        const other = security.detectOtherMedia(head, total)
        assert.ok(!other || security.otherMediaLooksLikeText(other, head, total === head.length), `kept as ${other && other.format} (size ${total})`)
      }
    })
    await check(`crafted, backup restore: ${label} is withheld as not-media`, () => {
      assert.deepEqual(judgeRestoredAsset(bytes, true, bytes.length), { reason: 'not-media' })
    })
    await check(`crafted, /uploads: ${label} under a .bin key is a 404`, async () => {
      const response = await served(`uploads/${slug}.bin`, bytes)
      assert.equal(response.status, 404, `${response.status} ${response.type}`)
      assert.equal(response.nosniff, 'nosniff')
    })
  }

  // 2. Real media: the same verdicts as before.
  for (const [label, bytes, key, allowlisted, group, restored, servedType] of REAL) {
    await check(`real, purge: ${label} -> keep (${group})`, () => {
      const verdict = purge.classifyObject({ key, size: bytes.length, bytes })
      assert.equal(verdict.action, 'keep', `${verdict.action} / ${verdict.group} / ${verdict.format}`)
      assert.equal(verdict.group, group)
    })
    await check(`real, upload allowlist: ${label} -> ${allowlisted}`, () => {
      const detected = security.detectUploadFormat(bytes)
      assert.equal(detected ? detected.mime : null, allowlisted)
      if (allowlisted) assert.equal(security.classifyUploadedBuffer(bytes).mime, allowlisted)
    })
    if (!allowlisted) {
      await check(`real, stored media: ${label} is kept as media`, () => {
        const other = security.detectOtherMedia(bytes, bytes.length)
        assert.ok(other, 'not media')
        assert.equal(security.otherMediaLooksLikeText(other, bytes, true), false, 'looks like text')
      })
    }
    await check(`real, backup restore: ${label} -> ${restored}`, () => {
      assert.deepEqual(judgeRestoredAsset(bytes, true, bytes.length), { contentType: restored })
    })
    if (servedType) {
      await check(`real, /uploads: ${label} under a .bin key -> 200 ${servedType}`, async () => {
        const response = await served(`uploads/real-${key.split('/').pop()}.bin`, bytes)
        assert.equal(response.status, 200, `${response.status}`)
        assert.equal(response.type, servedType)
      })
    }
  }
  for (const [label, head, size, key, group] of HEADS) {
    await check(`real, purge head: ${label} -> keep (${group})`, () => {
      const verdict = purge.classifyObject({ key, size, bytes: head, complete: false })
      assert.equal(verdict.action, 'keep', `${verdict.action} / ${verdict.group} / ${verdict.format}`)
      assert.equal(verdict.group, group)
    })
  }

  // 3. Every catalogue fixture keeps its verdict.
  for (const entry of F.catalogue().filter((item) => item.group !== 'running-import')) {
    await check(`catalogue: ${entry.name} -> ${entry.group}, upload ${entry.worker}`, () => {
      assert.equal(purge.classifyObject({ key: entry.key, size: entry.bytes.length, bytes: entry.bytes }).group, entry.group)
      const detected = security.detectUploadFormat(entry.bytes)
      assert.equal(detected ? detected.mime : null, entry.worker)
    })
  }

  // 4. The atom walk has no atom limit, so it must stay linear: 32 MB (the
  // backup restore's whole-file limit) of an empty mdat and empty free atoms
  // (they hold nothing: refused), of the same atoms holding one letter each
  // (text: refused), of empty atoms that end in a size-0 mdat of video, and
  // of an mdat of video followed by empty atoms (the walk reaches the end:
  // accepted). About 0.2-0.7 s here; the bound is loose so a slow CI runner
  // does not flake, and still fails a walk that goes quadratic (4 million
  // atoms). S-uploads5 (R-S-uploads4 F10): what the atoms hold is judged
  // only in the first 4 KB of the file (the head /uploads/*, the purge and
  // the restore all read), so the video behind 4 million empty atoms is not
  // seen and the file is refused, as the purge already refused it.
  const ATOMS_BYTES = 32 * 1024 * 1024
  const atomChain = (atomSize, count) => {
    const bytes = new Uint8Array(count * atomSize)
    for (let offset = 0; offset < bytes.length; offset += atomSize) bytes.set([0, 0, 0, atomSize, 0x66, 0x72, 0x65, 0x65, 0x41].slice(0, atomSize), offset)
    bytes.set([0x6d, 0x64, 0x61, 0x74], 4)
    return bytes
  }
  const chains = [
    ['empty atoms', atomChain(8, Math.floor(ATOMS_BYTES / 8)), null],
    ['atoms holding one letter each', atomChain(9, Math.floor(ATOMS_BYTES / 9)), null],
    ['empty atoms ending in a size-0 mdat of video', F.bytes(atomChain(8, Math.floor((ATOMS_BYTES - 8 - VIDEO.length) / 8)), size0('mdat', VIDEO)), null],
    ['an mdat of video followed by empty atoms', F.bytes(F.isoBox('mdat', VIDEO), atomChain(8, Math.floor((ATOMS_BYTES - 8 - VIDEO.length) / 8)).subarray(8)), 'video/quicktime'],
  ]
  for (const [label, bytes, expected] of chains) {
    await check(`32 MB of ${label} is walked in under 3 s`, () => {
      // Only the two detectors that walk the atoms are timed; the restore
      // verdict below also runs backup.ts's own whole-file checks.
      const started = process.hrtime.bigint()
      const detected = security.detectUploadFormat(bytes)
      const other = security.detectOtherMedia(bytes, bytes.length)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const verdict = judgeRestoredAsset(bytes, true, bytes.length)
      assert.equal(detected ? detected.mime : null, expected, label)
      if (expected) {
        assert.deepEqual(verdict, { contentType: expected })
      } else {
        assert.ok(!other || security.otherMediaLooksLikeText(other, bytes, true), `${label} kept as ${other && other.format}`)
        assert.deepEqual(verdict, { reason: 'not-media' })
      }
      assert.ok(ms < 3000, `${ms.toFixed(0)} ms`)
    })
  }

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: text behind a size-0 or sized-to-the-end QuickTime atom, a chain of empty atoms or an empty/padded ID3 tag is refused by the upload allowlist, withheld by backup restore, a 404 under /uploads/*.bin and REVIEW in the purge; real MOV/MP4 (size-0 mdat, text in a free atom, 64-bit sizes, heads of large files), MP3 with an ID3 tag and every catalogue fixture keep their verdicts`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
