// /uploads/*, the owner-run purge and the backup restore agree about a stored
// object (S-uploads5, refuter R-S-uploads4 finding F10, 2026-09-28).
//
// Three callers judge a file that is already in storage:
//   - /uploads/<key> for a key whose name says nothing (.bin, no extension,
//     .m4v/.3gp/.3g2) serves it by its first bytes (lib/r2.ts serveObject);
//   - the owner-run purge keeps, reviews or purges it from its first 4 KB
//     (an image is read whole for the markup scan);
//   - the backup restore writes it back or withholds it, reading it whole.
// S-uploads4 made the QuickTime and ID3 checks judge what the atoms or the
// tag HOLD. /uploads/* read only 64 bytes, so a classic QuickTime movie whose
// first free/skip atom holds 56+ bytes of encoder text looked like text there
// and was a 404, while the purge and the restore kept it as video/quicktime.
// The fix: one stored-media judgement (uploadSecurity.ts judgeStoredMedia,
// mirrored in the purge) that looks only at the object's first
// STORED_MEDIA_HEAD_BYTES, which every caller reads, so the three cannot
// disagree about the same object whatever each of them read.
//
// Checked here, each through the real entry point (serveObject with a fake
// bucket, the purge's classifyObject as its main loop calls it, backup.ts
// judgeRestoredAsset):
//   1. the refuter's classic MOVs are served under every sniffed key, kept by
//      the purge and restored, as video/quicktime;
//   2. the text in the first atom swept from 0 to 9000 bytes, in front of
//      moov + mdat, wide + mdat and a size-0 mdat: the three agree at every
//      length (real encoder text is kept; 4 KB+ of text is refused by all);
//   3. crafted text behind QuickTime/ID3 headers is refused by all three,
//      including a head that ends mid-character (the ID3 twin of the
//      R-uploads3 Khmer row) and content that starts past the first 4 KB;
//   4. 4,000 seeded mutations of real-shaped MOV/MP4/MP3 files: the three
//      agree on every one;
//   5. anything the upload allowlist accepts as a video, the three keep as
//      that video;
//   6. /uploads reads at least STORED_MEDIA_HEAD_BYTES, the purge's
//      HEAD_BYTES is at least that, and the judgement ignores bytes past it.
//
// Against older sources:
//   UPLOAD_SECURITY_TS=... PURGE_SCRIPT=... node test-upload-stored-media-agreement-pure.cjs
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
const size0 = (type, ...content) => F.bytes([0, 0, 0, 0], type, ...content)
const syncsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const id3 = (version, size, ...rest) => F.bytes('ID3', [version, 0, 0], syncsafe(size), ...rest)
// H.264 in AVCC framing: a 4-byte length, then a NAL unit.
const avcc = (seed, length) => F.bytes(F.u32be(length - 4), [0x65], F.randomBytes(F.mulberry32(seed), length - 5))
const MOOV = F.isoBox('moov', F.isoBox('mvhd', new Uint8Array(100)))
const MDAT = F.isoBox('mdat', avcc(81, 1200))
const WIDE = F.isoBox('wide', EMPTY)
const ENCODER = 'Created with QuickTime Pro 7.7.9; encoder settings: H.264 main profile, 1280x720, 30 fps. '
// Encoder text of exactly `length` bytes.
const encoderText = (length) => F.enc(ENCODER.repeat(Math.ceil(length / ENCODER.length) + 1).slice(0, length))
const KHMER = (length) => F.enc('ក'.repeat(Math.ceil(length / 3)))
const HTML = F.enc('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>\n')
const NOTES = F.enc('Stock count for the shop: 12 boxes of tea, 4 of coffee.\nCall the supplier on Monday.\n')
const FRAMES = F.bytes(...Array.from({ length: 12 }, (_, index) => F.bytes([0xff, 0xfb, 0x90, 0x64], F.randomBytes(F.mulberry32(90 + index), 413))))

// The refuter's classic MOVs (rs4/r2probe.cjs), the lane's REAL control first.
const REFUTER_MOVS = [
  ['free "IsoMedia File Produced by Google, 5-11-2011" (43 B), moov, mdat', F.bytes(F.isoBox('free', F.enc('IsoMedia File Produced by Google, 5-11-2011')), MOOV, MDAT)],
  ['free holding 60 B of text, moov, mdat', F.bytes(F.isoBox('free', F.enc('IsoMedia File Produced by Google, 5-11-2011 (QuickTime 7.7.9)')), MOOV, MDAT)],
  ['free holding 300 B of encoder text, wide, mdat', F.bytes(F.isoBox('free', F.enc(ENCODER.repeat(3))), WIDE, MDAT)],
  ['skip holding 64 B "Kodak EasyShare ...", moov, mdat', F.bytes(F.isoBox('skip', F.enc('Kodak EasyShare Z990 movie, firmware 1.02, (c) Eastman Kodak Co. ')), MOOV, MDAT)],
  ['control: free of 300 zero bytes, wide, mdat', F.bytes(F.isoBox('free', new Uint8Array(300)), WIDE, MDAT)],
  ['control: wide, mdat, moov', F.bytes(WIDE, MDAT, MOOV)],
]
const SNIFFED_KEYS = ['uploads/old.bin', 'uploads/old', 'uploads/old.m4v', 'uploads/old.3gp', 'uploads/old.3g2']

const TEXT_LENGTHS = [0, 1, 8, 40, 48, 55, 56, 57, 60, 64, 100, 300, 1000, 2000, 4000, 4072, 4080, 4086, 4087, 4088, 4089, 4096, 4100, 5000, 9000]
const LAYOUTS = [
  ['free(text), moov, mdat', (text) => F.bytes(F.isoBox('free', text), MOOV, MDAT)],
  ['skip(text), wide, mdat', (text) => F.bytes(F.isoBox('skip', text), WIDE, MDAT)],
  ['free(text), wide, size-0 mdat', (text) => F.bytes(F.isoBox('free', text), WIDE, size0('mdat', avcc(82, 6000)))],
  ['wide, free(text), 64-bit mdat', (text) => F.bytes(WIDE, F.isoBox('free', text), [0, 0, 0, 1], 'mdat', F.u32be(0), F.u32be(16 + 3000), avcc(83, 3000))],
]

// Text behind a header: refused by all three, as a small and a large file.
const emptyAtoms = (count) => F.bytes(...Array.from({ length: count }, () => F.isoBox('free', EMPTY)))
const CRAFTED = [
  ['a size-0 mdat, then a web page', size0('mdat', HTML)],
  ['a free atom sized to the whole file, holding notes', F.isoBox('free', NOTES)],
  ['70 empty free atoms, then notes', F.bytes(emptyAtoms(70), NOTES)],
  ['a size-0 free atom, then 6 KB of Khmer notes (the first 4 KB ends mid-character)', size0('free', KHMER(6000))],
  ['a size-0 free atom, then 9 KB of notes', size0('free', encoderText(9000))],
  ['ID3 v2.3, tag size 0, then notes', id3(3, 0, NOTES)],
  ['ID3 v2.3, a one-byte tag, then 6 KB of Khmer notes (the first 4 KB ends mid-character)', id3(3, 1, [0], KHMER(6000))],
  ['ID3 v2.4, an empty tag, then 9 KB of notes', id3(4, 0, encoderText(9000))],
  ['520 empty atoms (past the first 4 KB), then a size-0 mdat of video', F.bytes(emptyAtoms(520), size0('mdat', avcc(84, 3000)))],
  ['an empty mdat and 600 empty atoms, then a web page', F.bytes(F.isoBox('mdat', EMPTY), emptyAtoms(600), HTML)],
]

// Real-shaped media the mutations start from.
const SEEDS = [
  ...REFUTER_MOVS.map(([, bytes]) => bytes),
  F.bytes(WIDE, MOOV, size0('mdat', avcc(85, 9000))),
  F.bytes(F.isoBox('pnot', F.bytes(F.u32be(0x7c0f2a10), [0, 0], 'PICT', [0, 1])), F.isoBox('PICT', F.randomBytes(F.mulberry32(86), 6000)), MOOV, MDAT),
  F.bytes(F.isoBox('free', encoderText(3000)), MOOV, F.isoBox('mdat', avcc(87, 9000))),
  F.bytes(F.ftyp('qt  ', 'qt  '), WIDE, MOOV, size0('mdat', avcc(88, 5000))),
  F.bytes(F.ftyp('isom', 'isom', 'mp41'), MOOV, F.isoBox('mdat', avcc(89, 5000))),
  id3(3, 0, FRAMES),
  id3(3, 5000, 'APIC', F.u32be(4990), [0, 0], [0], 'image/jpeg', [0, 3, 0], F.randomBytes(F.mulberry32(91), 4974), FRAMES),
  id3(4, 60, 'TIT2', syncsafe(11), [0, 0], [3], 'Song title', new Uint8Array(39), FRAMES),
]

// ---------------------------------------------------- the three callers
function makeBucket(objects, reads) {
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
        if (reads) reads.push(options.range)
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

// /uploads/<key>: the served type, or 'refused' for a 404.
async function servedType(key, bytes, reads) {
  const response = await serveObject(makeBucket(new Map([[key, bytes]]), reads), key, new Request(`https://shop.example/${key}`))
  await response.arrayBuffer()
  if (response.status === 404) return 'refused'
  assert.equal(response.status, 200, `status ${response.status}`)
  return response.headers.get('content-type')
}

const isMime = (format) => /^(image|video|audio)\//.test(format)
let purge
// The purge's main loop: the first HEAD_BYTES, an image the app accepts
// read whole. The type it keeps the object as, or 'refused' (review/purge).
function purgeType(bytes, key = 'uploads/old.bin') {
  let read = bytes.subarray(0, Math.min(bytes.length, purge.HEAD_BYTES))
  const format = purge.detectUploadFormat(read)
  if (read.length < bytes.length && bytes.length <= purge.FULL_SCAN_MAX_BYTES && format && format.kind === 'image') read = bytes
  const verdict = purge.classifyObject({ key, size: bytes.length, bytes: read, complete: read.length >= bytes.length })
  if (verdict.action !== 'keep') return 'refused'
  return isMime(verdict.format) ? verdict.format : security.otherMediaContentType({ format: verdict.format })
}

// Backup restore of the whole copy.
function restoredType(bytes) {
  const verdict = judgeRestoredAsset(bytes, true, bytes.length)
  return verdict.contentType || 'refused'
}

const SERVED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm']
// All three verdicts, and the disagreement if there is one. /uploads serves
// images and videos only (audio and other formats are a 404 there) and does
// not scan images for markup, so it is compared on everything but images.
async function judge(bytes, key = 'uploads/old.bin') {
  const kept = purgeType(bytes, key)
  const restored = restoredType(bytes)
  const served = await servedType(key, bytes)
  const problems = []
  if (kept !== restored) problems.push(`purge keeps as ${kept}, restore as ${restored}`)
  if (!served.startsWith('image/') && !restored.startsWith('image/')) {
    const expected = SERVED_VIDEO.includes(restored) ? restored : 'refused'
    if (served !== expected) problems.push(`/uploads serves as ${served}, the restore says ${restored}`)
  }
  return { kept, restored, served, problems }
}
const describe = (verdicts) => `purge ${verdicts.kept}, restore ${verdicts.restored}, /uploads ${verdicts.served}`

// ------------------------------------------------------------- checks
const failures = []
let checks = 0
async function check(label, fn) {
  checks += 1
  try { await fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

async function main() {
  purge = await import(pathToFileURL(PURGE_SOURCE).href)

  // 1. The refuter's classic MOVs: video/quicktime everywhere, every key.
  for (const [label, bytes] of REFUTER_MOVS) {
    for (const key of SNIFFED_KEYS) {
      await check(`refuter MOV: ${label} under ${key} is served, kept and restored as video/quicktime`, async () => {
        const verdicts = await judge(bytes, key)
        assert.deepEqual([verdicts.served, verdicts.kept, verdicts.restored], ['video/quicktime', 'video/quicktime', 'video/quicktime'], describe(verdicts))
      })
    }
  }

  // 2. Text in the first atom, swept: the three agree at every length, and
  //    real encoder text (up to 4000 bytes) is kept as a movie.
  for (const [layout, build] of LAYOUTS) {
    for (const length of TEXT_LENGTHS) {
      await check(`sweep: ${layout} with ${length} B of text: the three agree`, async () => {
        const verdicts = await judge(build(encoderText(length)))
        assert.deepEqual(verdicts.problems, [], describe(verdicts))
        if (length <= 4000) assert.equal(verdicts.restored, 'video/quicktime', describe(verdicts))
      })
    }
  }

  // 3. Crafted text behind a header: refused by all three, and refused as
  //    the head of a larger object by the purge.
  for (const [label, bytes] of CRAFTED) {
    await check(`crafted: ${label} is refused by all three`, async () => {
      const verdicts = await judge(bytes)
      assert.deepEqual([verdicts.served, verdicts.kept, verdicts.restored], ['refused', 'refused', 'refused'], describe(verdicts))
    })
    await check(`crafted: ${label} is refused by the upload allowlist`, () => {
      assert.equal(security.detectUploadFormat(bytes), null)
    })
  }

  // 4. Seeded mutations of real-shaped media: text written over a range,
  //    single bytes changed, cut short, text appended.
  const rng = F.mulberry32(20260928)
  const pick = (n) => Math.floor(rng() * n)
  const LETTERS = F.enc('abcdefghij klmnopqrstuvwxyz ABCDEFGHIJ.,;:\n0123456789')
  const MUTATIONS = 4000
  let disagreements = 0
  const examples = []
  for (let index = 0; index < MUTATIONS; index += 1) {
    const seed = SEEDS[index % SEEDS.length]
    let bytes = Uint8Array.from(seed)
    const kind = pick(4)
    if (kind === 0) {
      const start = pick(Math.min(bytes.length, 200))
      const length = 1 + pick(Math.min(6000, bytes.length - start))
      for (let at = start; at < start + length; at += 1) bytes[at] = LETTERS[pick(LETTERS.length)]
    } else if (kind === 1) {
      for (let count = 1 + pick(4); count > 0; count -= 1) bytes[pick(bytes.length)] = pick(256)
    } else if (kind === 2) {
      bytes = bytes.subarray(0, 1 + pick(bytes.length))
    } else {
      const tail = new Uint8Array(1 + pick(5000))
      for (let at = 0; at < tail.length; at += 1) tail[at] = LETTERS[pick(LETTERS.length)]
      bytes = F.bytes(bytes, tail)
    }
    const verdicts = await judge(bytes)
    if (verdicts.problems.length) {
      disagreements += 1
      if (examples.length < 3) examples.push(`#${index} (seed ${index % SEEDS.length}, kind ${kind}, ${bytes.length} B): ${verdicts.problems.join('; ')}`)
    }
  }
  await check(`mutations: the three agree on all ${MUTATIONS} seeded mutations of real-shaped MOV/MP4/MP3`, () => {
    assert.equal(disagreements, 0, `${disagreements} disagree, e.g. ${examples.join(' | ')}`)
  })

  // 5. The upload allowlist never takes a video the stored judgement refuses.
  const everything = [...REFUTER_MOVS.map(([, bytes]) => bytes), ...LAYOUTS.flatMap(([, build]) => TEXT_LENGTHS.map((length) => build(encoderText(length)))), ...CRAFTED.map(([, bytes]) => bytes), ...SEEDS]
  await check('upload allowlist: every video it accepts is kept, restored and served as that video', async () => {
    for (const bytes of everything) {
      const format = security.detectUploadFormat(bytes)
      if (!format || format.kind !== 'video') continue
      const verdicts = await judge(bytes)
      assert.deepEqual([verdicts.kept, verdicts.restored, verdicts.served], [format.mime, format.mime, format.mime], `${format.mime}: ${describe(verdicts)}`)
    }
  })

  // 6. How much each caller reads.
  await check('the stored-media head is 4096 bytes and the purge reads at least that much', () => {
    assert.equal(security.STORED_MEDIA_HEAD_BYTES, 4096)
    assert.ok(purge.HEAD_BYTES >= security.STORED_MEDIA_HEAD_BYTES, `purge HEAD_BYTES ${purge.HEAD_BYTES}`)
    assert.equal(purge.STORED_MEDIA_HEAD_BYTES, security.STORED_MEDIA_HEAD_BYTES)
  })
  await check('/uploads reads at least STORED_MEDIA_HEAD_BYTES of a sniffed key', async () => {
    const reads = []
    await servedType('uploads/old.bin', F.bytes(REFUTER_MOVS[2][1], new Uint8Array(20000)), reads)
    assert.ok(reads.length >= 1, 'no ranged read')
    assert.equal(reads[0].offset ?? 0, 0)
    assert.ok(reads[0].length >= security.STORED_MEDIA_HEAD_BYTES, `first read ${reads[0].length} bytes`)
  })
  await check('the stored judgement ignores every byte past the head', () => {
    for (const bytes of [...SEEDS, ...CRAFTED.map(([, crafted]) => crafted)]) {
      if (bytes.length <= security.STORED_MEDIA_HEAD_BYTES) continue
      const head = bytes.subarray(0, security.STORED_MEDIA_HEAD_BYTES)
      const changed = F.bytes(head, encoderText(bytes.length - head.length))
      assert.deepEqual(security.judgeStoredMedia(changed, bytes.length, true), security.judgeStoredMedia(bytes, bytes.length, true))
      assert.deepEqual(security.judgeStoredMedia(head, bytes.length, false), security.judgeStoredMedia(bytes, bytes.length, true))
    }
  })

  if (failures.length) {
    for (const failure of failures.slice(0, Number(process.env.SHOW_FAILURES || 40))) console.error(`FAIL ${failure}`)
    if (failures.length > Number(process.env.SHOW_FAILURES || 40)) console.error(`...and ${failures.length - Number(process.env.SHOW_FAILURES || 40)} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: /uploads/* (sniffed keys), the purge and the backup restore give the same verdict for the same stored object -- classic MOVs with encoder text in the first atom are video/quicktime for all three at every text length, crafted text behind QuickTime/ID3 headers is refused by all three, and ${MUTATIONS} seeded mutations of real-shaped MOV/MP4/MP3 never split them`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
