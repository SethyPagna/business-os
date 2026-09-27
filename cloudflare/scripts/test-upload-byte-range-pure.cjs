// Byte ranges and HEAD for /uploads/* (lib/r2.ts serveObject).
//
// Owner decision: storefront About videos are public and visitors play and
// pause them. iOS/Safari <video> needs byte ranges -- it probes with
// `Range: bytes=0-1` and will not play a source that answers 200 without
// Accept-Ranges, which is what every Range request got before this fix.
//
//   - `bytes=a-b`, `a-` and `-n` -> 206 with Content-Range, Content-Length and
//     Accept-Ranges, the body being exactly that span (R2 ranged get);
//   - a last-pos past the end is clamped; a suffix longer than the object is
//     the whole object;
//   - unsatisfiable (start at/after the end, `bytes=-0`, empty object) ->
//     416 with `Content-Range: bytes */size`;
//   - multi-range / malformed / non-bytes -> the full 200 (RFC 9110 allows
//     ignoring them); HEAD ignores Range;
//   - HEAD answers from R2 metadata (no body read) with Content-Length,
//     Accept-Ranges, the served type and the ETag; If-None-Match and
//     If-Modified-Since give 304;
//   - If-None-Match beats Range (304); If-Range is compared strongly;
//   - the ETag / If-None-Match behaviour, the edge cache (whole 200s only)
//     and the variants path (serveStoredObject null when absent) are kept;
//   - the serving policy still applies first: a denied type is a 404 for a
//     range or HEAD too, never a 206/416.
//
// Discriminating: the pre-fix module answers every Range with 200 and no
// Accept-Ranges, and HEAD with a streamed body and no Content-Length.
//
// Run: node scripts/test-upload-byte-range-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const LIB = path.join(__dirname, '..', 'src', 'lib')

function transpile(file, shim) {
  const sourcePath = path.join(LIB, file)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, shim || require, moduleObj)
  return moduleObj.exports
}

const uploadSecurity = transpile('uploadSecurity.ts')
const r2 = transpile('r2.ts', (request) => (request === './uploadSecurity' ? uploadSecurity : require(request)))
const { serveObject, serveStoredObject, UPLOAD_CONTENT_SECURITY_POLICY } = r2

// --- fixtures ----------------------------------------------------------------
const VIDEO = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13 + 5) & 0xff)
VIDEO.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0) // ....ftypisom
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 296 }, (_, i) => (i * 3) & 0xff)])
const HTML = Uint8Array.from(Buffer.from('<!doctype html><script>alert(1)</script>'.padEnd(200, ' ')))
const UPLOADED = new Date('2026-09-01T10:00:00Z')

// A fake R2 bucket with the binding's semantics (mirrors Miniflare's
// bucket.worker.js): onlyIf is evaluated first (a failed precondition returns
// the object WITHOUT a body), then the range -- suffix <= 0, offset > size and
// a zero length throw InvalidRange; offset+length past the end is clamped
// unless `clamp: false` (to prove the retry path does not depend on it).
function makeBucket(seed, { clamp = true } = {}) {
  const store = new Map(Object.entries(seed))
  const log = []
  const metaOf = (key, entry) => ({
    key,
    size: entry.bytes.length,
    etag: `etag-${key}`,
    httpEtag: `"etag-${key}"`,
    uploaded: UPLOADED,
    httpMetadata: { contentType: entry.contentType },
    writeHttpMetadata(headers) { if (entry.contentType) headers.set('content-type', entry.contentType) },
  })
  const invalidRange = () => new Error('get: The requested range is not satisfiable (10039)')
  const preconditionFails = (onlyIf, meta) => {
    if (!(onlyIf instanceof Headers)) return false
    const inm = onlyIf.get('if-none-match')
    if (inm) return inm.split(',').some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === meta.httpEtag)
    const ims = Date.parse(onlyIf.get('if-modified-since') || '')
    return Number.isFinite(ims) && Math.floor(meta.uploaded.getTime() / 1000) <= Math.floor(ims / 1000)
  }
  return {
    log,
    async head(key) {
      log.push({ op: 'head', key })
      const entry = store.get(key)
      return entry ? metaOf(key, entry) : null
    },
    async get(key, options = {}) {
      log.push({ op: 'get', key, range: options.range || null, conditional: !!options.onlyIf })
      const entry = store.get(key)
      if (!entry) return null
      const meta = metaOf(key, entry)
      if (preconditionFails(options.onlyIf, meta)) return meta
      const size = meta.size
      let start = 0
      let end = size
      if (options.range) {
        let { offset, length, suffix } = options.range
        if (suffix !== undefined) {
          if (suffix <= 0) throw invalidRange()
          if (suffix > size) suffix = size
          offset = size - suffix
          length = suffix
        }
        if (offset === undefined) offset = 0
        if (length === undefined) length = size - offset
        if (offset < 0 || offset > size || length <= 0) throw invalidRange()
        if (offset + length > size) {
          if (!clamp) throw invalidRange()
          length = size - offset
        }
        start = offset
        end = offset + length
      }
      return { ...meta, range: options.range, body: new Blob([entry.bytes.slice(start, end)]).stream() }
    },
  }
}

function makeCache() {
  const store = new Map()
  const puts = []
  return {
    store,
    puts,
    async match(request) { return store.has(request.url) ? store.get(request.url).clone() : undefined },
    async put(request, response) { puts.push(request.url); store.set(request.url, response.clone()) },
    async delete(request) { return store.delete(request.url) },
  }
}

const SEED = {
  'uploads/about.mp4': { bytes: VIDEO, contentType: 'video/mp4' },
  'uploads/photo.jpg': { bytes: JPEG, contentType: 'image/jpeg' },
  'uploads/paste.bin': { bytes: JPEG, contentType: 'application/octet-stream' },
  'uploads/evil.bin': { bytes: HTML, contentType: 'image/png' },
  'uploads/page.html': { bytes: HTML, contentType: 'text/html' },
  'uploads/empty.mp4': { bytes: new Uint8Array(0), contentType: 'video/mp4' },
  'variants/w320/photo.jpg.webp': { bytes: JPEG, contentType: 'image/webp' },
}
let bucket = makeBucket(SEED)

const request = (key, headers = {}, method = 'GET') => new Request(`https://shop.example/${key}`, { method, headers })
const serve = (key, headers, ctx, method) => serveObject(bucket, key, request(key, headers, method), ctx)
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer())

function assertHardened(res, label) {
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  assert.strictEqual(res.headers.get('content-security-policy'), UPLOAD_CONTENT_SECURITY_POLICY, `${label}: CSP`)
}

async function assertPartial(res, { start, end, size, source, type }, label) {
  assert.strictEqual(res.status, 206, `${label}: 206`)
  assert.strictEqual(res.headers.get('content-range'), `bytes ${start}-${end}/${size}`, `${label}: Content-Range`)
  assert.strictEqual(res.headers.get('content-length'), String(end - start + 1), `${label}: Content-Length`)
  assert.strictEqual(res.headers.get('accept-ranges'), 'bytes', `${label}: Accept-Ranges`)
  if (type) assert.strictEqual(res.headers.get('content-type'), type, `${label}: type`)
  assert.ok(res.headers.get('etag'), `${label}: ETag kept`)
  assertHardened(res, label)
  assert.deepStrictEqual(await bytesOf(res), source.slice(start, end + 1), `${label}: exactly the requested bytes`)
}

async function assertUnsatisfiable(res, size, label) {
  assert.strictEqual(res.status, 416, `${label}: 416`)
  assert.strictEqual(res.headers.get('content-range'), `bytes */${size}`, `${label}: Content-Range bytes */size`)
  assertHardened(res, label)
  assert.strictEqual((await bytesOf(res)).length, 0, `${label}: no body`)
}

async function assertWhole(res, source, label) {
  assert.strictEqual(res.status, 200, `${label}: 200`)
  assert.strictEqual(res.headers.get('content-range'), null, `${label}: no Content-Range`)
  assert.strictEqual(res.headers.get('accept-ranges'), 'bytes', `${label}: Accept-Ranges`)
  assert.strictEqual(res.headers.get('content-length'), String(source.length), `${label}: Content-Length`)
  assert.deepStrictEqual(await bytesOf(res), source, `${label}: the whole object`)
}

const tests = []
const check = (name, fn) => tests.push([name, fn])

check('the iOS probe `bytes=0-1` on a video is a 206 with the first two bytes', async () => {
  const res = await serve('uploads/about.mp4', { range: 'bytes=0-1' })
  await assertPartial(res, { start: 0, end: 1, size: 1000, source: VIDEO, type: 'video/mp4' }, 'bytes=0-1')
  assert.ok(/^attachment;/.test(res.headers.get('content-disposition') || ''), 'the video stays an attachment for navigation')
})

check('bytes=a-b, a- and -n select exactly that span', async () => {
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=100-199' }), { start: 100, end: 199, size: 1000, source: VIDEO }, 'a-b')
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=900-' }), { start: 900, end: 999, size: 1000, source: VIDEO }, 'a-')
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=-50' }), { start: 950, end: 999, size: 1000, source: VIDEO }, '-n')
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=999-999' }), { start: 999, end: 999, size: 1000, source: VIDEO }, 'last byte')
})

check('a range is one ranged R2 read, never the whole object', async () => {
  bucket.log.length = 0
  await (await serve('uploads/about.mp4', { range: 'bytes=100-199' })).arrayBuffer()
  await (await serve('uploads/about.mp4', { range: 'bytes=900-' })).arrayBuffer()
  await (await serve('uploads/about.mp4', { range: 'bytes=-50' })).arrayBuffer()
  assert.deepStrictEqual(bucket.log.map((entry) => entry.range), [{ offset: 100, length: 100 }, { offset: 900 }, { suffix: 50 }])
  assert.ok(bucket.log.every((entry) => entry.op === 'get' && entry.conditional), 'conditional ranged gets only')
})

check('a last-pos past the end is clamped; a suffix longer than the object is the whole object', async () => {
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=990-5000' }), { start: 990, end: 999, size: 1000, source: VIDEO }, 'clamped last-pos')
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=-5000' }), { start: 0, end: 999, size: 1000, source: VIDEO }, 'long suffix')
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=0-' }), { start: 0, end: 999, size: 1000, source: VIDEO }, 'bytes=0-')
})

check('clamping does not depend on R2 doing it: a refused over-long range is retried as the exact span', async () => {
  const strict = makeBucket(SEED, { clamp: false })
  const res = await serveObject(strict, 'uploads/about.mp4', request('uploads/about.mp4', { range: 'bytes=990-5000' }))
  await assertPartial(res, { start: 990, end: 999, size: 1000, source: VIDEO }, 'non-clamping R2')
  assert.deepStrictEqual(strict.log.map((entry) => entry.op), ['get', 'head', 'get'])
  assert.deepStrictEqual(strict.log[2].range, { offset: 990, length: 10 })
})

check('unsatisfiable ranges are 416 with Content-Range: bytes */size', async () => {
  await assertUnsatisfiable(await serve('uploads/about.mp4', { range: 'bytes=1000-' }), 1000, 'start == size')
  await assertUnsatisfiable(await serve('uploads/about.mp4', { range: 'bytes=5000-6000' }), 1000, 'start past the end')
  await assertUnsatisfiable(await serve('uploads/about.mp4', { range: 'bytes=-0' }), 1000, 'bytes=-0')
  await assertUnsatisfiable(await serve('uploads/empty.mp4', { range: 'bytes=0-1' }), 0, 'empty object')
})

check('multi-range, malformed and non-bytes Range headers get the full 200', async () => {
  for (const range of ['bytes=0-1,5-6', 'bytes=abc', 'items=0-1', 'bytes=5-2', 'bytes=-', 'bytes 0-1']) {
    await assertWhole(await serve('uploads/about.mp4', { range }), VIDEO, range)
  }
})

check('a plain GET is the whole object with Accept-Ranges and Content-Length', async () => {
  await assertWhole(await serve('uploads/about.mp4'), VIDEO, 'no Range')
  await assertWhole(await serve('uploads/photo.jpg'), JPEG, 'image')
})

check('images honour ranges too, sniffed .bin included; a refused .bin is never a 206 or 416', async () => {
  await assertPartial(await serve('uploads/photo.jpg', { range: 'bytes=0-9' }), { start: 0, end: 9, size: 300, source: JPEG, type: 'image/jpeg' }, 'jpg')
  await assertPartial(await serve('uploads/paste.bin', { range: 'bytes=10-19' }), { start: 10, end: 19, size: 300, source: JPEG, type: 'image/jpeg' }, 'sniffed .bin')
  for (const range of ['bytes=0-1', 'bytes=99999-']) {
    const res = await serve('uploads/evil.bin', { range })
    assert.strictEqual(res.status, 404, `evil.bin ${range}`)
    assertHardened(res, `evil.bin ${range}`)
  }
  const html = await serve('uploads/page.html', { range: 'bytes=0-1' })
  assert.strictEqual(html.status, 404, '.html with a range')
  const missing = await serve('uploads/missing.mp4', { range: 'bytes=0-1' })
  assert.strictEqual(missing.status, 404, 'absent with a range')
})

check('HEAD: metadata only, with Content-Length, Accept-Ranges, type and ETag', async () => {
  bucket.log.length = 0
  const res = await serve('uploads/about.mp4', {}, undefined, 'HEAD')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.body, null, 'no body')
  assert.strictEqual(res.headers.get('content-length'), '1000')
  assert.strictEqual(res.headers.get('accept-ranges'), 'bytes')
  assert.strictEqual(res.headers.get('content-type'), 'video/mp4')
  assert.strictEqual(res.headers.get('etag'), '"etag-uploads/about.mp4"')
  assertHardened(res, 'HEAD')
  assert.deepStrictEqual(bucket.log.map((entry) => entry.op), ['head'], 'HEAD reads metadata, never the body')
  const withRange = await serve('uploads/about.mp4', { range: 'bytes=0-1' }, undefined, 'HEAD')
  assert.strictEqual(withRange.status, 200, 'HEAD ignores Range')
  assert.strictEqual(withRange.headers.get('content-length'), '1000')
  assert.strictEqual(withRange.headers.get('content-range'), null)
})

check('HEAD revalidation: If-None-Match / If-Modified-Since give 304', async () => {
  const etag = '"etag-uploads/about.mp4"'
  const inm = await serve('uploads/about.mp4', { 'if-none-match': `W/${etag}` }, undefined, 'HEAD')
  assert.strictEqual(inm.status, 304)
  assert.strictEqual(inm.headers.get('etag'), etag)
  const stale = await serve('uploads/about.mp4', { 'if-none-match': '"other"' }, undefined, 'HEAD')
  assert.strictEqual(stale.status, 200)
  const since = await serve('uploads/about.mp4', { 'if-modified-since': new Date('2026-09-02T00:00:00Z').toUTCString() }, undefined, 'HEAD')
  assert.strictEqual(since.status, 304)
  const before = await serve('uploads/about.mp4', { 'if-modified-since': new Date('2026-08-01T00:00:00Z').toUTCString() }, undefined, 'HEAD')
  assert.strictEqual(before.status, 200)
})

check('HEAD keeps the serving policy: denied, absent and sniffed keys', async () => {
  assert.strictEqual((await serve('uploads/page.html', {}, undefined, 'HEAD')).status, 404)
  assert.strictEqual((await serve('uploads/missing.mp4', {}, undefined, 'HEAD')).status, 404)
  assert.strictEqual((await serve('uploads/evil.bin', {}, undefined, 'HEAD')).status, 404)
  bucket.log.length = 0
  const sniffed = await serve('uploads/paste.bin', {}, undefined, 'HEAD')
  assert.strictEqual(sniffed.status, 200)
  assert.strictEqual(sniffed.headers.get('content-type'), 'image/jpeg')
  assert.strictEqual(sniffed.headers.get('content-length'), '300', 'the full size, not the sniffed prefix')
  assert.deepStrictEqual(bucket.log.map((entry) => entry.op), ['get'], 'a sniffed HEAD is answered from the sniffing read alone')
})

check('If-None-Match beats Range (304), and If-Range is compared strongly', async () => {
  const etag = '"etag-uploads/about.mp4"'
  const notModified = await serve('uploads/about.mp4', { range: 'bytes=0-1', 'if-none-match': etag })
  assert.strictEqual(notModified.status, 304)
  assert.strictEqual(notModified.headers.get('etag'), etag)
  await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=0-1', 'if-range': etag }), { start: 0, end: 1, size: 1000, source: VIDEO }, 'If-Range matches')
  await assertWhole(await serve('uploads/about.mp4', { range: 'bytes=0-1', 'if-range': '"old"' }), VIDEO, 'If-Range stale')
  bucket.log.length = 0
  await assertWhole(await serve('uploads/about.mp4', { range: 'bytes=0-1', 'if-range': `W/${etag}` }), VIDEO, 'weak If-Range')
  assert.deepStrictEqual(bucket.log.map((entry) => entry.range), [null], 'a weak If-Range spends no ranged read')
  await assertWhole(await serve('uploads/about.mp4', { range: 'bytes=0-1', 'if-range': UPLOADED.toUTCString() }), VIDEO, 'date If-Range')
})

check('the edge cache holds whole 200s only; ranges bypass it; HEAD and 304 are served from it', async () => {
  const cache = makeCache()
  globalThis.caches = { default: cache }
  try {
    const pending = []
    const ctx = { waitUntil(p) { pending.push(p) } }
    await assertWhole(await serve('uploads/about.mp4', {}, ctx), VIDEO, 'first full GET')
    await Promise.all(pending)
    assert.deepStrictEqual(cache.puts, ['https://shop.example/uploads/about.mp4'])

    bucket.log.length = 0
    await assertPartial(await serve('uploads/about.mp4', { range: 'bytes=0-1' }, ctx), { start: 0, end: 1, size: 1000, source: VIDEO }, 'range with a warm cache')
    await Promise.all(pending)
    assert.strictEqual(bucket.log.length, 1, 'the range was read from R2, not answered 200 from the cached whole')
    assert.strictEqual(cache.puts.length, 1, 'a 206 is never cached')

    bucket.log.length = 0
    const head = await serve('uploads/about.mp4', {}, ctx, 'HEAD')
    assert.strictEqual(head.status, 200)
    assert.strictEqual(head.body, null)
    assert.strictEqual(head.headers.get('accept-ranges'), 'bytes')
    const revalidated = await serve('uploads/about.mp4', { 'if-none-match': '"etag-uploads/about.mp4"' }, ctx)
    assert.strictEqual(revalidated.status, 304)
    assert.strictEqual(revalidated.headers.get('content-length'), null, 'a 304 carries no Content-Length')
    const again = await serve('uploads/about.mp4', {}, ctx)
    await assertWhole(again, VIDEO, 'cached full GET')
    assert.strictEqual(bucket.log.length, 0, 'HEAD, 304 and the cached GET cost no R2 read')
  } finally {
    delete globalThis.caches
  }
})

check('the variants path: serveStoredObject still answers null when absent and ranges a hit', async () => {
  assert.strictEqual(await serveStoredObject(bucket, 'variants/w640/nope.jpg.webp', request('uploads/_v/w640/nope.jpg', { range: 'bytes=0-1' })), null)
  assert.strictEqual(await serveStoredObject(bucket, 'variants/w640/nope.jpg.webp', request('uploads/_v/w640/nope.jpg', {}, 'HEAD')), null)
  const hit = await serveStoredObject(bucket, 'variants/w320/photo.jpg.webp', request('uploads/_v/w320/photo.jpg', { range: 'bytes=0-3' }))
  await assertPartial(hit, { start: 0, end: 3, size: 300, source: JPEG, type: 'image/webp' }, 'variant hit')
})

check('parseByteRange / resolveByteRange edge cases', async () => {
  const { parseByteRange, resolveByteRange } = r2
  assert.deepStrictEqual(parseByteRange('bytes=0-1'), { kind: 'bounded', first: 0, last: 1 })
  assert.deepStrictEqual(parseByteRange('BYTES=7-'), { kind: 'open', first: 7 })
  assert.deepStrictEqual(parseByteRange('bytes=-3'), { kind: 'suffix', length: 3 })
  for (const bad of [null, '', 'bytes=', 'bytes=-', 'bytes=1-0', 'bytes=0-1,2-3', 'bytes=a-b', 'bits=0-1']) {
    assert.strictEqual(parseByteRange(bad), null, String(bad))
  }
  assert.deepStrictEqual(resolveByteRange({ kind: 'bounded', first: 5, last: 50 }, 10), { start: 5, end: 9 })
  assert.deepStrictEqual(resolveByteRange({ kind: 'suffix', length: 50 }, 10), { start: 0, end: 9 })
  assert.strictEqual(resolveByteRange({ kind: 'open', first: 10 }, 10), null)
  assert.strictEqual(resolveByteRange({ kind: 'suffix', length: 0 }, 10), null)
  assert.strictEqual(resolveByteRange({ kind: 'bounded', first: 0, last: 0 }, 0), null)
})

;(async () => {
  let passed = 0
  for (const [name, fn] of tests) {
    bucket = makeBucket(SEED)
    try {
      await fn()
      passed += 1
      console.log(`PASS ${name}`)
    } catch (error) {
      console.error(`FAIL ${name}`)
      console.error(error)
      process.exitCode = 1
    }
  }
  console.log(`${passed}/${tests.length} passed`)
})()
