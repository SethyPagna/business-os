// On-demand image variants: GET /uploads/_v/w{160|320|640}/<storedName>
// (lib/imageVariants.ts serveUpload / serveImageVariant, lib/r2.ts).
//
// Drives the REAL compiled modules against a fake R2 bucket, a fake Images
// binding, a fake quota guard and a fake edge cache. Each case is chosen so
// the plausible wrong implementation fails it:
//   - a width outside the allowlist, or a name that could leave uploads/,
//     is refused BEFORE any R2 read or quota spend;
//   - hit serves the persisted variant without transforming or metering;
//   - miss meters exactly once, transforms at the requested width as WebP,
//     persists under variants/w<width>/<name>.webp, and the next request hits;
//   - binding missing / quota exhausted / reserve exhausted / quota not 'ok' /
//     transform error answer a 302 to the ORIGINAL (`/uploads/<name>`) with a
//     short max-age -- never a 500, never a persisted or edge-cached variant,
//     and never the original's bytes under the variant URL (that would
//     re-download ~0.84 MB every five minutes; the original URL is immutable);
//   - If-None-Match handles W/ and lists (the old strict-equality check did not).
//
// Run: node scripts/test-image-variants-pure.cjs
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

const r2 = transpile('r2.ts')
const quota = { calls: [], next: { allowed: true, zone: 'ok', reservedZone: 'ok' } }
const variants = transpile('imageVariants.ts', (request) => {
  if (request === './r2') return r2
  if (request === './quotaGuard') {
    return {
      consumeQuota: async (_env, resource) => {
        quota.calls.push(resource)
        return quota.next
      },
    }
  }
  if (request === '../index') return {}
  return require(request)
})

const { parseImageVariantPath, isSafeVariantSourceName, imageVariantKey, IMAGE_VARIANT_WIDTHS, serveUpload, IMAGE_VARIANT_FALLBACK_CACHE_CONTROL } = variants
const { ifNoneMatchMatches } = r2

function makeBucket(seed) {
  const store = new Map(Object.entries(seed))
  const log = { gets: [], puts: [] }
  return {
    store,
    log,
    failPut: false,
    async get(key) {
      log.gets.push(key)
      const entry = store.get(key)
      if (!entry) return null
      return {
        body: new Blob([entry.body]).stream(),
        httpEtag: `"${entry.etag || 'etag-' + key}"`,
        httpMetadata: { contentType: entry.contentType },
        writeHttpMetadata(headers) { if (entry.contentType) headers.set('content-type', entry.contentType) },
      }
    },
    async put(key, bytes, options) {
      log.puts.push(key)
      if (this.failPut) throw new Error('r2 down')
      store.set(key, { body: Buffer.from(bytes).toString('utf8'), contentType: options?.httpMetadata?.contentType })
    },
  }
}

function makeImages({ fail } = {}) {
  const calls = []
  return {
    calls,
    input(stream) {
      const call = { stream }
      calls.push(call)
      const chain = {
        transform(options) { call.transform = options; return chain },
        async output(options) {
          call.output = options
          if (fail) throw new Error(fail)
          const text = await new Response(stream).text()
          return { response: () => new Response(`webp(${call.transform.width}):${text}`, { headers: { 'content-type': 'image/webp' } }) }
        },
      }
      return chain
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

function makeCtx() {
  const pending = []
  return { pending, waitUntil(p) { pending.push(p) }, settle: () => Promise.all(pending) }
}

const NAME = 'shirt-1758844800000-ab12cd34.jpg'
function freshEnv({ images = makeImages(), extraSeed = {} } = {}) {
  quota.calls = []
  quota.next = { allowed: true, zone: 'ok', reservedZone: 'ok' }
  globalThis.caches = { default: makeCache() }
  const env = {
    ASSETS: makeBucket({
      [`uploads/${NAME}`]: { body: 'ORIGINAL', contentType: 'image/jpeg' },
      'backups/cloudflare/2026-09-01.json': { body: 'SECRET', contentType: 'application/json' },
      ...extraSeed,
    }),
  }
  if (images) env.IMAGES = images
  return env
}

const req = (p, headers = {}) => new Request(`https://shop.example${p}`, { headers })

const tests = []
const check = (name, fn) => tests.push([name, fn])

check('the width allowlist is exactly 160/320/640', async () => {
  assert.deepStrictEqual([...IMAGE_VARIANT_WIDTHS], [160, 320, 640])
  for (const w of [160, 320, 640]) {
    const parsed = parseImageVariantPath(`_v/w${w}/${NAME}`)
    assert.strictEqual(parsed.width, w)
    assert.strictEqual(parsed.originalKey, `uploads/${NAME}`)
    assert.strictEqual(parsed.variantKey, `variants/w${w}/${NAME}.webp`)
  }
  for (const bad of ['w0', 'w100', 'w321', 'w1280', 'w2560', 'w0320', 'w', 'x320', 'w320x', 'W320']) {
    assert.strictEqual(parseImageVariantPath(`_v/${bad}/${NAME}`), 'invalid', bad)
  }
})

check('non-variant paths are not intercepted', async () => {
  assert.strictEqual(parseImageVariantPath(NAME), null)
  assert.strictEqual(parseImageVariantPath(`sub/${NAME}`), null)
  assert.strictEqual(parseImageVariantPath(`_variants/${NAME}`), null)
})

check('traversal and names outside uploads/ are refused', async () => {
  const bad = [
    `_v/w320/../backups/cloudflare/2026-09-01.json`,
    `_v/w320/../../backups/x.jpg`,
    `_v/w320/a/b.jpg`,
    `_v/w320/..`,
    `_v/w320/.`,
    `_v/w320/..\\backups\\x.jpg`,
    `_v/w320/`,
    `_v/w320/x.json`,
    `_v/w320/x.html`,
    `_v/w320/x.svg`,
    `_v/w320/noextension`,
    `_v/w320/_v/w320/${NAME}`,
    `_v/w320/a\u0000.jpg`,
    `_v/w320/${'a'.repeat(300)}.jpg`,
  ]
  for (const p of bad) assert.strictEqual(parseImageVariantPath(p), 'invalid', JSON.stringify(p))
  // Whatever passes is one segment re-prefixed with uploads/ -- a literal
  // encoded slash stays literal and can only ever name a key under uploads/.
  const encoded = parseImageVariantPath('_v/w320/..%2Fbackups%2Fx.jpg')
  assert.ok(encoded !== 'invalid' && encoded.originalKey === 'uploads/..%2Fbackups%2Fx.jpg')
  assert.ok(isSafeVariantSourceName('shirt-1-ab.PNG'))
  assert.ok(isSafeVariantSourceName('ក្រមា-1-ab.webp'), 'Khmer stored names are ordinary names')
  assert.strictEqual(imageVariantKey(640, 'a.png'), 'variants/w640/a.png.webp')
})

check('an invalid variant request is a 404 with no R2 read and no quota spend', async () => {
  const env = freshEnv()
  const res = await serveUpload(env, '/uploads/_v/w320/../backups/cloudflare/2026-09-01.json', req('/uploads/_v/w320/x'), makeCtx())
  assert.strictEqual(res.status, 404)
  assert.deepStrictEqual(env.ASSETS.log.gets, [])
  assert.deepStrictEqual(quota.calls, [])
  const wide = await serveUpload(env, `/uploads/_v/w1280/${NAME}`, req(`/uploads/_v/w1280/${NAME}`), makeCtx())
  assert.strictEqual(wide.status, 404)
  assert.deepStrictEqual(env.ASSETS.log.gets, [])
})

check('a plain upload path is served by serveObject unchanged', async () => {
  const env = freshEnv()
  const res = await serveUpload(env, `/uploads/${NAME}`, req(`/uploads/${NAME}`), makeCtx())
  assert.strictEqual(res.status, 200)
  assert.strictEqual(await res.text(), 'ORIGINAL')
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.deepStrictEqual(env.ASSETS.log.gets, [`uploads/${NAME}`])
})

check('hit: persisted variant served immutable with its R2 etag, no transform, no quota', async () => {
  const images = makeImages()
  const env = freshEnv({ images, extraSeed: { [`variants/w320/${NAME}.webp`]: { body: 'STORED-VARIANT', contentType: 'image/webp', etag: 'v-etag' } } })
  const ctx = makeCtx()
  const res = await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), ctx)
  assert.strictEqual(res.status, 200)
  assert.strictEqual(await res.text(), 'STORED-VARIANT')
  assert.strictEqual(res.headers.get('etag'), '"v-etag"')
  assert.strictEqual(res.headers.get('content-type'), 'image/webp')
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.strictEqual(images.calls.length, 0)
  assert.deepStrictEqual(quota.calls, [])
  await ctx.settle()
  assert.ok(globalThis.caches.default.store.has(`https://shop.example/uploads/_v/w320/${NAME}`), 'hit is edge-cached')
})

check('miss: meter once, transform at width as WebP q80 scale-down, persist, serve; next request hits', async () => {
  const images = makeImages()
  const env = freshEnv({ images })
  const ctx = makeCtx()
  const res = await serveUpload(env, `/uploads/_v/w640/${NAME}`, req(`/uploads/_v/w640/${NAME}`), ctx)
  assert.strictEqual(res.status, 200)
  assert.strictEqual(await res.text(), 'webp(640):ORIGINAL')
  assert.strictEqual(res.headers.get('content-type'), 'image/webp')
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff')
  assert.deepStrictEqual(quota.calls, ['cf_images_transform'])
  assert.strictEqual(images.calls.length, 1)
  assert.deepStrictEqual(images.calls[0].transform, { width: 640, fit: 'scale-down' })
  assert.deepStrictEqual(images.calls[0].output, { format: 'image/webp', quality: 80 })
  await ctx.settle()
  assert.deepStrictEqual(env.ASSETS.log.puts, [`variants/w640/${NAME}.webp`])
  assert.strictEqual(env.ASSETS.store.get(`variants/w640/${NAME}.webp`).contentType, 'image/webp')
  assert.ok(!env.ASSETS.store.has(`uploads/${NAME}.webp`), 'original never overwritten')
  assert.strictEqual(env.ASSETS.store.get(`uploads/${NAME}`).body, 'ORIGINAL')

  const again = await serveUpload(env, `/uploads/_v/w640/${NAME}`, req(`/uploads/_v/w640/${NAME}`), makeCtx())
  assert.strictEqual(await again.text(), 'webp(640):ORIGINAL')
  assert.strictEqual(images.calls.length, 1, 'persisted once: second request does not transform')
  assert.deepStrictEqual(quota.calls, ['cf_images_transform'], 'and does not meter')
})

async function assertOriginalFallback(res, label) {
  assert.strictEqual(res.status, 302, label)
  assert.strictEqual(res.headers.get('location'), `/uploads/${encodeURIComponent(NAME)}`, `${label}: points at the original upload`)
  assert.strictEqual(await res.text(), '', `${label}: no body (the original's bytes are not served under the variant URL)`)
  assert.strictEqual(res.headers.get('cache-control'), IMAGE_VARIANT_FALLBACK_CACHE_CONTROL, `${label}: short max-age`)
  assert.strictEqual(IMAGE_VARIANT_FALLBACK_CACHE_CONTROL, 'public, max-age=300')
}

check('quota exhausted -> original, no transform, nothing persisted or edge-cached', async () => {
  const images = makeImages()
  const env = freshEnv({ images })
  quota.next = { allowed: false, zone: 'exhausted', reservedZone: 'exhausted' }
  const ctx = makeCtx()
  await assertOriginalFallback(await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), ctx), 'exhausted')
  await ctx.settle()
  assert.strictEqual(images.calls.length, 0)
  assert.deepStrictEqual(env.ASSETS.log.puts, [])
  assert.strictEqual(globalThis.caches.default.store.size, 0)
})

check('quota past the safe zone (warn / critical) -> original: a variant is the first thing to give way', async () => {
  for (const zone of ['warn', 'critical']) {
    const images = makeImages()
    const env = freshEnv({ images })
    quota.next = { allowed: true, zone, reservedZone: zone }
    await assertOriginalFallback(await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), makeCtx()), zone)
    assert.strictEqual(images.calls.length, 0, `${zone}: no transform`)
  }
})

check('the redirect target is one validated segment: encoded, never a variant path, never a backup', async () => {
  const names = ['Nivea Cream 100ml-1758844800000-ab12cd34.jpg', 'ក្រែម-1758844800000-ab12cd34.jpg']
  for (const name of names) {
    const env = freshEnv({ images: null, extraSeed: { [`uploads/${name}`]: { body: 'O', contentType: 'image/jpeg' } } })
    const res = await serveUpload(env, `/uploads/_v/w320/${name}`, req(`/uploads/_v/w320/${encodeURIComponent(name)}`), makeCtx())
    assert.strictEqual(res.status, 302)
    const location = res.headers.get('location')
    assert.strictEqual(location, `/uploads/${encodeURIComponent(name)}`)
    assert.ok(!location.includes('_v/') && !location.includes('..') && !location.includes('backups'), location)
    assert.strictEqual(decodeURIComponent(location.slice('/uploads/'.length)), name, 'round-trips to the same stored name')
  }
})

check('the common miss probes the original with a ranged read and never streams the whole file', async () => {
  const env = freshEnv({ images: null })
  const gets = []
  const realGet = env.ASSETS.get.bind(env.ASSETS)
  env.ASSETS.get = async (key, options) => { gets.push([key, options && options.range]); return realGet(key, options) }
  await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), makeCtx())
  assert.deepStrictEqual(gets.filter(([key]) => key === `uploads/${NAME}`), [[`uploads/${NAME}`, { offset: 0, length: 1 }]])
})

check('video reserve exhausted (allowed but reservedZone exhausted) -> original', async () => {
  const images = makeImages()
  const env = freshEnv({ images })
  quota.next = { allowed: true, zone: 'critical', reservedZone: 'exhausted' }
  await assertOriginalFallback(await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), makeCtx()), 'reserve')
  assert.strictEqual(images.calls.length, 0)
})

check('binding missing -> original, and no quota spent', async () => {
  const env = freshEnv({ images: null })
  await assertOriginalFallback(await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), makeCtx()), 'no binding')
  assert.deepStrictEqual(quota.calls, [])
  assert.deepStrictEqual(env.ASSETS.log.puts, [])
})

check('transform error (9422) -> redirect to the original, never a 500', async () => {
  const images = makeImages({ fail: 'IMAGES_TRANSFORM_ERROR 9422: monthly limit' })
  const env = freshEnv({ images })
  const ctx = makeCtx()
  await assertOriginalFallback(await serveUpload(env, `/uploads/_v/w160/${NAME}`, req(`/uploads/_v/w160/${NAME}`), ctx), '9422')
  await ctx.settle()
  assert.deepStrictEqual(env.ASSETS.log.puts, [])
})

check('a failed R2 put does not fail the response', async () => {
  const env = freshEnv()
  env.ASSETS.failPut = true
  const ctx = makeCtx()
  const res = await serveUpload(env, `/uploads/_v/w320/${NAME}`, req(`/uploads/_v/w320/${NAME}`), ctx)
  assert.strictEqual(res.status, 200)
  assert.strictEqual(await res.text(), 'webp(320):ORIGINAL')
  await ctx.settle()
})

check('unknown original -> 404 before any quota is spent', async () => {
  const env = freshEnv()
  const res = await serveUpload(env, '/uploads/_v/w320/missing-1-aa.jpg', req('/uploads/_v/w320/missing-1-aa.jpg'), makeCtx())
  assert.strictEqual(res.status, 404)
  assert.deepStrictEqual(quota.calls, [])
})

check('If-None-Match: W/ prefixes, lists and * are honoured', async () => {
  assert.strictEqual(ifNoneMatchMatches('"abc"', '"abc"'), true)
  assert.strictEqual(ifNoneMatchMatches('W/"abc"', '"abc"'), true)
  assert.strictEqual(ifNoneMatchMatches('"abc"', 'W/"abc"'), true)
  assert.strictEqual(ifNoneMatchMatches('"x", W/"abc" ,"y"', '"abc"'), true)
  assert.strictEqual(ifNoneMatchMatches('*', '"abc"'), true)
  assert.strictEqual(ifNoneMatchMatches('"abcd"', '"abc"'), false)
  assert.strictEqual(ifNoneMatchMatches('"x", "y"', '"abc"'), false)
  assert.strictEqual(ifNoneMatchMatches('', '"abc"'), false)
  assert.strictEqual(ifNoneMatchMatches('"abc"', ''), false)
  assert.strictEqual(ifNoneMatchMatches(' , ', '"abc"'), false)
})

check('edge-cache hit answers a weak / listed If-None-Match with 304', async () => {
  const env = freshEnv({ extraSeed: { [`variants/w320/${NAME}.webp`]: { body: 'V', contentType: 'image/webp', etag: 'v1' } } })
  const url = `/uploads/_v/w320/${NAME}`
  const ctx = makeCtx()
  await (await serveUpload(env, url, req(url), ctx)).text()
  await ctx.settle()
  const res = await serveUpload(env, url, req(url, { 'if-none-match': '"zzz", W/"v1"' }), makeCtx())
  assert.strictEqual(res.status, 304)
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
  delete globalThis.caches
  console.log(`${passed}/${tests.length} passed`)
})()
