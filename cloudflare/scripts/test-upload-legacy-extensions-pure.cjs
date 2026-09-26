// Legacy photos keep displaying from /uploads/* (lib/r2.ts serveObject).
//
// Before S-uploads a stored key kept whatever extension the uploader's file
// had, and lib/fileAssets.ts stored a name without one as `.bin`. Real photos
// therefore live in uploads/ as .jfif / .jpe / .pjpeg / .pjp, as iPhone
// .heic, as `.bin` and with no extension at all. The images-only guard
// (1e2c945c) answered all of them 404, and the sidebar avatar has no
// fallback, so users saw broken images.
//
//   - the JPEG aliases are inline image/jpeg by extension, and .heic/.heif
//     inline as image/heic / image/heif -- no extra R2 read;
//   - `.bin` and extensionless keys are decided by their FIRST BYTES
//     (uploadSecurity's detectUploadFormat, plus HEIF brands): an allowed
//     image is inline as the detected type, anything else stays a 404. The
//     uploader's stored type is never consulted, in either direction;
//   - the sniff is ONE small ranged read, paid only by those keys: a .jpg
//     still costs exactly one unranged R2 get;
//   - nosniff + the sandbox CSP on every response; .html / .svg stay 404.
//
// Discriminating: the pre-fix module 404s every alias, `.bin` JPEG and
// extensionless PNG (so those cases fail), and trusted the STORED type for an
// extensionless key (so the "stored type is ignored" cases fail both ways).
//
// Run: node scripts/test-upload-legacy-extensions-pure.cjs
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

function loadR2(uploadSecurity) {
  return transpile('r2.ts', (request) => {
    if (request === './uploadSecurity') {
      if (uploadSecurity instanceof Error) throw uploadSecurity
      return uploadSecurity
    }
    return require(request)
  })
}

const uploadSecurity = transpile('uploadSecurity.ts')
const r2 = loadR2(uploadSecurity)
const { serveObject, serveStoredObject, uploadServePolicy, UPLOAD_CONTENT_SECURITY_POLICY } = r2

// --- byte fixtures ---------------------------------------------------------
const filler = (n) => Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff)
const ascii = (s) => Array.from(Buffer.from(s, 'latin1'))
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0x00, ...filler(189)])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...filler(150)])
const HEIC = Uint8Array.from([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic'), ...filler(120)])
const AVIF_MIF1 = Uint8Array.from([0, 0, 0, 0x1c, ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1avifmiaf'), ...filler(120)])
const MP4 = Uint8Array.from([0, 0, 0, 0x18, ...ascii('ftypisom'), 0, 0, 2, 0, ...ascii('isomiso2'), ...filler(120)])
const HTML = Uint8Array.from(ascii('<!doctype html><html><script>alert(document.cookie)</script></html>'))
const SVG = Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'))
const PDF = Uint8Array.from(ascii('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n<script>x</script>'))

// --- a fake R2 bucket with the binding's range / onlyIf semantics ----------
function makeBucket(seed) {
  const store = new Map(Object.entries(seed))
  const log = []
  return {
    log,
    async get(key, options = {}) {
      log.push({ key, range: options.range || null, conditional: !!options.onlyIf })
      const entry = store.get(key)
      if (!entry) return null
      const bytes = entry.bytes
      const size = bytes.length
      const httpEtag = `"etag-${key}"`
      const meta = {
        key,
        size,
        httpEtag,
        httpMetadata: { contentType: entry.contentType },
        writeHttpMetadata(headers) { if (entry.contentType) headers.set('content-type', entry.contentType) },
      }
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

function makeCache() {
  const store = new Map()
  return {
    store,
    async match(request) { return store.has(request.url) ? store.get(request.url).clone() : undefined },
    async put(request, response) { store.set(request.url, response.clone()) },
    async delete(request) { return store.delete(request.url) },
  }
}

const bucket = makeBucket({
  'uploads/cat.jfif': { bytes: JPEG, contentType: 'image/pjpeg' },
  'uploads/cat.JFIF': { bytes: JPEG, contentType: 'application/octet-stream' },
  'uploads/cat.jpe': { bytes: JPEG, contentType: 'image/jpeg' },
  'uploads/cat.pjpeg': { bytes: JPEG, contentType: 'image/pjpeg' },
  'uploads/cat.pjp': { bytes: JPEG, contentType: 'image/jpeg' },
  'uploads/iphone.heic': { bytes: HEIC, contentType: 'image/heic' },
  'uploads/iphone.HEIC': { bytes: HEIC, contentType: '' },
  'uploads/iphone.heif': { bytes: HEIC, contentType: 'image/heif' },
  'uploads/paste-1712345678.bin': { bytes: JPEG, contentType: 'application/octet-stream' },
  'uploads/legacy-avatar': { bytes: PNG, contentType: 'text/html' },
  'uploads/legacy-logo': { bytes: PNG, contentType: 'application/octet-stream' },
  'uploads/camera.bin': { bytes: HEIC, contentType: 'application/octet-stream' },
  'uploads/modern-avif': { bytes: AVIF_MIF1, contentType: '' },
  'uploads/evil.bin': { bytes: HTML, contentType: 'image/png' },
  'uploads/evil-svg.bin': { bytes: SVG, contentType: 'image/svg+xml' },
  'uploads/invoice': { bytes: PDF, contentType: 'image/jpeg' },
  'uploads/clip.bin': { bytes: MP4, contentType: 'video/mp4' },
  'uploads/empty.bin': { bytes: new Uint8Array(0), contentType: 'image/jpeg' },
  'uploads/page.html': { bytes: JPEG, contentType: 'image/jpeg' },
  'uploads/logo.svg': { bytes: SVG, contentType: 'image/svg+xml' },
  'uploads/photo.jpg': { bytes: JPEG, contentType: 'text/html' },
  'uploads/photo.png': { bytes: PNG, contentType: 'image/png' },
})

const req = (url, headers = {}) => new Request(`https://shop.example${url}`, { headers })
const serve = (key, headers, ctx) => serveObject(bucket, key, req(`/${key}`, headers), ctx)
const bodyBytes = async (res) => new Uint8Array(await res.arrayBuffer())
const readsOf = (key) => bucket.log.filter((entry) => entry.key === key)

function assertHardened(res, label) {
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  assert.strictEqual(res.headers.get('content-security-policy'), UPLOAD_CONTENT_SECURITY_POLICY, `${label}: CSP`)
}

async function assertInlineImage(res, type, expectedBytes, label) {
  assert.strictEqual(res.status, 200, `${label}: status`)
  assert.strictEqual(res.headers.get('content-type'), type, `${label}: type`)
  assert.strictEqual(res.headers.get('content-disposition'), null, `${label}: inline`)
  assertHardened(res, label)
  assert.deepStrictEqual(await bodyBytes(res), expectedBytes, `${label}: the WHOLE object is served, not the sniffed prefix`)
}

async function assertDenied(res, label) {
  assert.strictEqual(res.status, 404, `${label}: 404`)
  assertHardened(res, label)
  assert.notStrictEqual(res.headers.get('content-type') || '', 'text/html', `${label}: never text/html`)
  const text = await res.text()
  assert.ok(!/script|svg|PDF|ftyp/i.test(text), `${label}: stored bytes never leak`)
}

const tests = []
const check = (name, fn) => tests.push([name, fn])

check('the JPEG aliases (.jfif .jpe .pjpeg .pjp, any case) are inline image/jpeg', async () => {
  for (const key of ['uploads/cat.jfif', 'uploads/cat.JFIF', 'uploads/cat.jpe', 'uploads/cat.pjpeg', 'uploads/cat.pjp']) {
    await assertInlineImage(await serve(key), 'image/jpeg', JPEG, key)
  }
})

check('.heic / .heif photos are inline as image/heic / image/heif', async () => {
  await assertInlineImage(await serve('uploads/iphone.heic'), 'image/heic', HEIC, 'heic')
  await assertInlineImage(await serve('uploads/iphone.HEIC'), 'image/heic', HEIC, 'HEIC')
  await assertInlineImage(await serve('uploads/iphone.heif'), 'image/heif', HEIC, 'heif')
})

check('a .bin holding a JPEG is inline image/jpeg', async () => {
  await assertInlineImage(await serve('uploads/paste-1712345678.bin'), 'image/jpeg', JPEG, '.bin jpeg')
})

check('an extensionless PNG is inline image/png, whatever type the uploader stored', async () => {
  await assertInlineImage(await serve('uploads/legacy-avatar'), 'image/png', PNG, 'noext png stored as text/html')
  await assertInlineImage(await serve('uploads/legacy-logo'), 'image/png', PNG, 'noext png stored as octet-stream')
})

check('sniffed HEIC and mif1-branded AVIF are served as what they are', async () => {
  await assertInlineImage(await serve('uploads/camera.bin'), 'image/heic', HEIC, '.bin heic')
  await assertInlineImage(await serve('uploads/modern-avif'), 'image/avif', AVIF_MIF1, 'noext avif (mif1 major brand)')
})

check('a .bin holding HTML is still refused, even stored as image/png', async () => {
  await assertDenied(await serve('uploads/evil.bin'), '.bin html')
})

check('sniffed SVG, PDF, video and empty objects are refused', async () => {
  await assertDenied(await serve('uploads/evil-svg.bin'), '.bin svg')
  await assertDenied(await serve('uploads/invoice'), 'noext pdf stored as image/jpeg')
  await assertDenied(await serve('uploads/clip.bin'), '.bin mp4 (sniffed keys serve images only)')
  await assertDenied(await serve('uploads/empty.bin'), 'empty .bin')
})

check('.html and .svg stay 404 without any R2 read, even holding image bytes', async () => {
  await assertDenied(await serve('uploads/page.html'), '.html holding a JPEG')
  await assertDenied(await serve('uploads/logo.svg'), '.svg')
  assert.strictEqual(readsOf('uploads/page.html').length, 0, '.html never reaches R2')
  assert.strictEqual(readsOf('uploads/logo.svg').length, 0, '.svg never reaches R2')
})

check('the image hot path is unchanged: one unranged read per extension-typed key', async () => {
  bucket.log.length = 0
  await assertInlineImage(await serve('uploads/photo.jpg'), 'image/jpeg', JPEG, 'jpg')
  await assertInlineImage(await serve('uploads/photo.png'), 'image/png', PNG, 'png')
  await assertInlineImage(await serve('uploads/cat.jfif'), 'image/jpeg', JPEG, 'jfif')
  for (const key of ['uploads/photo.jpg', 'uploads/photo.png', 'uploads/cat.jfif']) {
    const reads = readsOf(key)
    assert.strictEqual(reads.length, 1, `${key}: exactly one R2 read`)
    assert.strictEqual(reads[0].range, null, `${key}: never a sniffing range read`)
  }
})

check('a sniffed key costs one small ranged read, then the normal read', async () => {
  bucket.log.length = 0
  await serve('uploads/paste-1712345678.bin')
  const reads = readsOf('uploads/paste-1712345678.bin')
  assert.strictEqual(reads.length, 2, 'peek + read')
  assert.deepStrictEqual(reads[0].range, { offset: 0, length: 64 }, 'the peek reads the first 64 bytes only')
  assert.strictEqual(reads[0].conditional, false, 'the peek is unconditional (the type is known before any 304)')
  assert.strictEqual(reads[1].range, null)
  assert.strictEqual(reads[1].conditional, true, 'the real read keeps the conditional request')
})

check('If-None-Match on a sniffed image is a 304 with the image type; a sniffed non-image never 304s', async () => {
  const notModified = await serve('uploads/paste-1712345678.bin', { 'if-none-match': '"etag-uploads/paste-1712345678.bin"' })
  assert.strictEqual(notModified.status, 304)
  assert.strictEqual(notModified.headers.get('content-type'), 'image/jpeg')
  assertHardened(notModified, '304')
  const refused = await serve('uploads/evil.bin', { 'if-none-match': '"etag-uploads/evil.bin"' })
  assert.strictEqual(refused.status, 404, 'a matching ETag does not turn a refused object into a 304')
})

check('the edge cache: a sniffed image is cached with its sniffed type; an older non-image entry is re-judged', async () => {
  const cache = makeCache()
  globalThis.caches = { default: cache }
  try {
    const pending = []
    const ctx = { waitUntil(p) { pending.push(p) } }
    const first = await serve('uploads/legacy-avatar', {}, ctx)
    await assertInlineImage(first, 'image/png', PNG, 'first (R2)')
    await Promise.all(pending)
    bucket.log.length = 0
    const second = await serve('uploads/legacy-avatar', {}, ctx)
    await assertInlineImage(second, 'image/png', PNG, 'second (cache)')
    assert.strictEqual(readsOf('uploads/legacy-avatar').length, 0, 'a cached sniffed image costs no R2 read')

    // An entry cached before this guard with the uploader's hostile type is
    // not served; the bytes decide (HTML -> 404).
    cache.store.set('https://shop.example/uploads/evil.bin', new Response('<script>1</script>', { headers: { 'content-type': 'text/html', etag: '"x"' } }))
    await assertDenied(await serve('uploads/evil.bin', {}, ctx), 'pre-guard text/html entry for an HTML .bin')
    cache.store.set('https://shop.example/uploads/paste-1712345678.bin', new Response('stale', { headers: { 'content-type': 'application/octet-stream' } }))
    await assertInlineImage(await serve('uploads/paste-1712345678.bin', {}, ctx), 'image/jpeg', JPEG, 'pre-guard octet-stream entry for a JPEG .bin')
  } finally {
    delete globalThis.caches
  }
})

check('an absent sniffed key is a hardened 404 from serveObject and null from serveStoredObject', async () => {
  await assertDenied(await serve('uploads/missing.bin'), 'missing .bin')
  assert.strictEqual(await serveStoredObject(bucket, 'uploads/missing', req('/uploads/missing')), null)
})

check('if the byte classifier cannot load, sniffed keys fail closed', async () => {
  const broken = loadR2(new Error('module unavailable'))
  const res = await broken.serveObject(bucket, 'uploads/paste-1712345678.bin', req('/uploads/paste-1712345678.bin'))
  await assertDenied(res, 'classifier unavailable')
  // ...and extension-typed images do not depend on it at all.
  const jpg = await broken.serveObject(bucket, 'uploads/cat.jfif', req('/uploads/cat.jfif'))
  assert.strictEqual(jpg.status, 200)
})

check('the policy: sniffed keys take only the image type their bytes were detected as', async () => {
  assert.deepStrictEqual(uploadServePolicy('uploads/a.bin'), { kind: 'deny' }, 'no sniffed type -> deny')
  assert.deepStrictEqual(uploadServePolicy('uploads/a'), { kind: 'deny' })
  for (const type of ['text/html', 'image/svg+xml', 'application/pdf', 'text/xml', 'video/mp4', 'application/octet-stream']) {
    assert.deepStrictEqual(uploadServePolicy('uploads/a.bin', type), { kind: 'deny' }, `.bin as ${type}`)
    assert.deepStrictEqual(uploadServePolicy('uploads/a', type), { kind: 'deny' }, `noext as ${type}`)
  }
  assert.deepStrictEqual(uploadServePolicy('uploads/a.bin', 'image/png'), { kind: 'inline', contentType: 'image/png' })
  for (const ext of ['.jfif', '.jpe', '.pjpeg', '.pjp']) {
    assert.deepStrictEqual(uploadServePolicy(`uploads/a${ext}`, 'text/html'), { kind: 'inline', contentType: 'image/jpeg' }, ext)
  }
  for (const ext of ['.html', '.htm', '.svg', '.xml', '.xhtml', '.js', '.pdf.html']) {
    assert.deepStrictEqual(uploadServePolicy(`uploads/a${ext}`, 'image/png'), { kind: 'deny' }, ext)
  }
})

;(async () => {
  let passed = 0
  for (const [name, fn] of tests) {
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
