// Stored-XSS guard for /uploads/* (lib/r2.ts serveObject).
//
// /uploads/* is public and same-origin with the admin app. serveObject used to
// replay the UPLOADER's content type (object.writeHttpMetadata), so an
// uploaded .html or .svg rendered inline and ran script on the admin origin.
// The served type now comes from a server allowlist; anything else downloads
// as an octet-stream attachment, and every response carries nosniff and a
// sandboxing CSP.
//
// Discriminating: the fake bucket's writeHttpMetadata replays the stored
// (hostile) type exactly like R2 does, so the pre-fix module serves
// `text/html` inline for the .html case and fails here.
//
// Run: node scripts/test-upload-content-type-guard-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function loadR2() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'r2.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, require, moduleObj)
  return moduleObj.exports
}

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

const { serveObject, inlineContentTypeFor, UPLOAD_CONTENT_SECURITY_POLICY } = loadR2()

const bucket = makeBucket({
  'uploads/evil.html': { body: '<script>alert(1)</script>', contentType: 'text/html' },
  'uploads/evil.svg': { body: '<svg onload="alert(1)"/>', contentType: 'image/svg+xml' },
  'uploads/tool.exe': { body: 'MZ', contentType: 'application/x-msdownload' },
  'uploads/noext': { body: '<script>1</script>', contentType: 'text/html' },
  'uploads/noext-image': { body: 'png', contentType: 'image/png' },
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

function assertAttachment(res, label) {
  assert.strictEqual(res.status, 200, label)
  assert.strictEqual(res.headers.get('content-type'), 'application/octet-stream', `${label}: octet-stream`)
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
  ['.html is an octet-stream attachment, never text/html', async () => {
    assertAttachment(await serveObject(bucket, 'uploads/evil.html', get('/uploads/evil.html')), 'html')
  }],
  ['.svg is an attachment (script-capable image type)', async () => {
    assertAttachment(await serveObject(bucket, 'uploads/evil.svg', get('/uploads/evil.svg')), 'svg')
  }],
  ['unknown extension is an attachment', async () => {
    assertAttachment(await serveObject(bucket, 'uploads/tool.exe', get('/uploads/tool.exe')), 'exe')
  }],
  ['extensionless key with a hostile stored type is an attachment', async () => {
    assertAttachment(await serveObject(bucket, 'uploads/noext', get('/uploads/noext')), 'noext')
  }],
  ['extensionless key with an allowlisted stored type stays inline', async () => {
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
    assertAttachment(res, 'cached html')
    const notModified = await serveObject(bucket, 'uploads/evil.html', get('/uploads/evil.html', { 'if-none-match': '"old"' }), { waitUntil() {} })
    assert.strictEqual(notModified.status, 304)
    assert.strictEqual(notModified.headers.get('content-type'), 'application/octet-stream', '304 carries the safe type too')
    delete globalThis.caches
  }],
  ['inlineContentTypeFor never returns a script-capable type', async () => {
    for (const [key, stored] of [['a.html', 'text/html'], ['a.htm', 'text/html'], ['a.svg', 'image/svg+xml'], ['a.xml', 'text/xml'], ['a.js', 'text/javascript'], ['noext', 'image/svg+xml'], ['noext', 'application/xhtml+xml']]) {
      assert.strictEqual(inlineContentTypeFor(key, stored), null, `${key} (${stored})`)
    }
    assert.strictEqual(inlineContentTypeFor('x.pdf', 'text/html'), 'application/pdf')
    assert.strictEqual(inlineContentTypeFor('x.mp4', ''), 'video/mp4')
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
