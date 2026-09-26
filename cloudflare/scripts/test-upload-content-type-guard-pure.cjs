// Stored-XSS guard for /uploads/* (lib/r2.ts serveObject).
//
// /uploads/* is public and same-origin with the admin app. serveObject used to
// replay the UPLOADER's content type (object.writeHttpMetadata), so an
// uploaded .html or .svg rendered inline and ran script on the admin origin.
// Owner direction: public /uploads is for images. jpeg/png/webp/gif/avif are
// inline with the allowlisted type; the few non-images a current flow still
// serves (video, bmp, pdf, csv) are attachments with their real media type;
// everything else is a 404. Every response carries nosniff and a sandboxing
// CSP.
//
// Discriminating: the fake bucket's writeHttpMetadata replays the stored
// (hostile) type exactly like R2 does, so the pre-fix module serves
// `text/html` inline for the .html case and fails here; the first guard
// version (octet-stream attachment for everything unlisted) fails the 404s.
//
// Run: node scripts/test-upload-content-type-guard-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(file, shim) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, shim || require, moduleObj)
  return moduleObj.exports
}

// r2.ts lazily loads uploadSecurity to sniff `.bin` / extensionless keys.
function loadR2() {
  const uploadSecurity = transpile('uploadSecurity.ts')
  return transpile('r2.ts', (request) => (request === './uploadSecurity' ? uploadSecurity : require(request)))
}

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

function makeBucket(seed) {
  return {
    async get(key) {
      const entry = seed[key]
      if (!entry) return null
      return {
        body: new Blob([entry.body]).stream(),
        httpEtag: `"etag-${key}"`,
        httpMetadata: { contentType: entry.contentType },
        writeHttpMetadata(headers) {
          if (entry.contentType) headers.set('content-type', entry.contentType)
          if (entry.contentDisposition) headers.set('content-disposition', entry.contentDisposition)
        },
      }
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

const { serveObject, uploadServePolicy, UPLOAD_CONTENT_SECURITY_POLICY } = loadR2()

const bucket = makeBucket({
  'uploads/evil.html': { body: '<script>alert(1)</script>', contentType: 'text/html' },
  'uploads/evil.svg': { body: '<svg onload="alert(1)"/>', contentType: 'image/svg+xml' },
  'uploads/tool.exe': { body: 'MZ', contentType: 'application/x-msdownload' },
  'uploads/blob.bin': { body: 'x', contentType: 'image/png' },
  'uploads/clip.mp4': { body: 'mp4', contentType: 'text/html' },
  'uploads/doc.pdf': { body: 'pdf', contentType: 'application/pdf' },
  'uploads/old.bmp': { body: 'bmp', contentType: 'image/bmp' },
  'uploads/noext': { body: '<script>1</script>', contentType: 'text/html' },
  // Extensionless keys are judged by their bytes (lib/r2.ts sniffing), so
  // this one holds real PNG bytes; test-upload-legacy-extensions-pure.cjs
  // covers the sniffing itself.
  'uploads/noext-image': { body: PNG_BYTES, contentType: 'image/png' },
  'uploads/liar.jpg': { body: '<script>1</script>', contentType: 'text/html', contentDisposition: 'inline' },
  'uploads/photo.jpg': { body: 'jpg', contentType: 'image/jpeg' },
  'uploads/photo.PNG': { body: 'png', contentType: 'image/png' },
  'uploads/photo.webp': { body: 'webp', contentType: 'image/webp' },
  'variants/w320/photo.jpg.webp': { body: 'webp', contentType: 'image/webp' },
})

function get(url, headers = {}) {
  return new Request(`https://shop.example${url}`, { headers })
}

function assertHardened(res, label) {
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  assert.strictEqual(res.headers.get('content-security-policy'), UPLOAD_CONTENT_SECURITY_POLICY, `${label}: CSP`)
  assert.ok(/(^|;\s*)sandbox(;|$)/.test(res.headers.get('content-security-policy')), `${label}: CSP sandboxes`)
}

async function assertDenied(res, label) {
  assert.strictEqual(res.status, 404, `${label}: 404`)
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  const body = await res.text()
  assert.ok(!/script|svg|MZ/.test(body), `${label}: stored bytes never leak`)
}

function assertAttachment(res, type, label) {
  assert.strictEqual(res.status, 200, label)
  assert.strictEqual(res.headers.get('content-type'), type, `${label}: type`)
  assert.ok(/^attachment;/.test(res.headers.get('content-disposition') || ''), `${label}: attachment`)
  assertHardened(res, label)
}

function assertInline(res, type, label) {
  assert.strictEqual(res.status, 200, label)
  assert.strictEqual(res.headers.get('content-type'), type, `${label}: type`)
  assert.strictEqual(res.headers.get('content-disposition'), null, `${label}: inline`)
  assertHardened(res, label)
}

const tests = [
  ['.html is a 404, never text/html', async () => {
    await assertDenied(await serveObject(bucket, 'uploads/evil.html', get('/uploads/evil.html')), 'html')
  }],
  ['.svg is a 404 (script-capable image type)', async () => {
    await assertDenied(await serveObject(bucket, 'uploads/evil.svg', get('/uploads/evil.svg')), 'svg')
  }],
  ['unknown extensions are a 404, even with an image stored type', async () => {
    await assertDenied(await serveObject(bucket, 'uploads/tool.exe', get('/uploads/tool.exe')), 'exe')
    await assertDenied(await serveObject(bucket, 'uploads/blob.bin', get('/uploads/blob.bin')), 'bin')
  }],
  ['extensionless key with a hostile stored type is a 404', async () => {
    await assertDenied(await serveObject(bucket, 'uploads/noext', get('/uploads/noext')), 'noext')
  }],
  ['current non-image flows are attachments with their real type', async () => {
    assertAttachment(await serveObject(bucket, 'uploads/clip.mp4', get('/uploads/clip.mp4')), 'video/mp4', 'mp4 (stored as text/html)')
    assertAttachment(await serveObject(bucket, 'uploads/doc.pdf', get('/uploads/doc.pdf')), 'application/pdf', 'pdf')
    assertAttachment(await serveObject(bucket, 'uploads/old.bmp', get('/uploads/old.bmp')), 'image/bmp', 'bmp')
  }],
  ['extensionless key holding an allowlisted image stays inline', async () => {
    assertInline(await serveObject(bucket, 'uploads/noext-image', get('/uploads/noext-image')), 'image/png', 'noext-image')
  }],
  ['the extension wins over a hostile stored type and disposition', async () => {
    assertInline(await serveObject(bucket, 'uploads/liar.jpg', get('/uploads/liar.jpg')), 'image/jpeg', 'liar.jpg')
  }],
  ['jpeg / png (any case) / webp are inline with the correct type', async () => {
    assertInline(await serveObject(bucket, 'uploads/photo.jpg', get('/uploads/photo.jpg')), 'image/jpeg', 'jpg')
    assertInline(await serveObject(bucket, 'uploads/photo.PNG', get('/uploads/photo.PNG')), 'image/png', 'png')
    assertInline(await serveObject(bucket, 'uploads/photo.webp', get('/uploads/photo.webp')), 'image/webp', 'webp')
  }],
  ['variant keys (.webp) go through the same helper', async () => {
    assertInline(await serveObject(bucket, 'variants/w320/photo.jpg.webp', get('/uploads/_v/w320/photo.jpg')), 'image/webp', 'variant')
  }],
  ['a pre-guard edge-cache entry is re-sanitised on the way out', async () => {
    const cache = makeCache()
    globalThis.caches = { default: cache }
    const url = 'https://shop.example/uploads/evil.html'
    cache.store.set(url, new Response('<script>1</script>', { headers: { 'content-type': 'text/html', etag: '"old"' } }))
    const res = await serveObject(bucket, 'uploads/evil.html', get('/uploads/evil.html'), { waitUntil() {} })
    await assertDenied(res, 'cached html')
    const notModified = await serveObject(bucket, 'uploads/evil.html', get('/uploads/evil.html', { 'if-none-match': '"old"' }), { waitUntil() {} })
    assert.strictEqual(notModified.status, 404, 'no 304 for a denied type either')
    // An extensionless key's cached hostile type is re-judged on the way out.
    const noextUrl = 'https://shop.example/uploads/noext'
    cache.store.set(noextUrl, new Response('<script>1</script>', { headers: { 'content-type': 'text/html' } }))
    await assertDenied(await serveObject(bucket, 'uploads/noext', get('/uploads/noext'), { waitUntil() {} }), 'cached noext')
    // A cached image is re-headered, not re-typed from the entry.
    const jpgUrl = 'https://shop.example/uploads/liar.jpg'
    cache.store.set(jpgUrl, new Response('x', { headers: { 'content-type': 'text/html', etag: '"j"' } }))
    const jpg = await serveObject(bucket, 'uploads/liar.jpg', get('/uploads/liar.jpg', { 'if-none-match': '"j"' }), { waitUntil() {} })
    assert.strictEqual(jpg.status, 304)
    assert.strictEqual(jpg.headers.get('content-type'), 'image/jpeg', '304 carries the safe type too')
    delete globalThis.caches
  }],
  ['the policy never serves a script-capable type, and inlines only the five image types', async () => {
    for (const [key, stored] of [['a.html', 'text/html'], ['a.htm', 'text/html'], ['a.svg', 'image/svg+xml'], ['a.xml', 'text/xml'], ['a.js', 'text/javascript'], ['a.json', 'application/json'], ['noext', 'image/svg+xml'], ['noext', 'application/xhtml+xml'], ['noext', 'video/mp4']]) {
      assert.deepStrictEqual(uploadServePolicy(key, stored), { kind: 'deny' }, `${key} (${stored})`)
    }
    const inline = ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.gif', 'a.avif'].map((k) => uploadServePolicy(k, 'text/html'))
    assert.deepStrictEqual(inline.map((p) => p.kind), Array(6).fill('inline'))
    assert.deepStrictEqual(inline.map((p) => p.contentType), ['image/jpeg', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
    for (const k of ['a.mp4', 'a.webm', 'a.mov', 'a.bmp', 'a.pdf', 'a.csv']) assert.strictEqual(uploadServePolicy(k).kind, 'attachment', k)
  }],
]

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
