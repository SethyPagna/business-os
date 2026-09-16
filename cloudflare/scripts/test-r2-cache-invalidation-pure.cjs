// Pins a real fix to lib/r2.ts's serveObject read-through cache (item 9,
// p8/tests sweep, Sep 16 2026): serveObject caches a SUCCESSFUL response in
// `caches.default`, keyed on the bare request URL, with
// `cache-control: public, max-age=31536000, immutable`. Before this fix,
// putObject/deleteObject/deleteObjectsBulk never touched that cache, so a
// PUT that replaced an object's bytes at the SAME key (e.g. async image
// normalization rewriting an upload in place) or a DELETE of it left the
// stale/deleted bytes being served from the edge cache for up to a year --
// an already-deleted image stayed downloadable forever. The fix adds an
// OPTIONAL `cacheOrigin` parameter to putObject/deleteObject/
// deleteObjectsBulk that, when a caller passes it, purges serveObject's
// exact cache key for that object. This test drives the REAL compiled
// r2.ts against a fake bucket AND a fake `caches.default`, so it fails
// against the pre-fix module (which has no cacheOrigin parameter or
// purge call at all) exactly as it passes against the fixed one.
//
// Run: node scripts/test-r2-cache-invalidation-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function compile(file) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  return ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
}

function loadCompiled(file) {
  const output = compile(file)
  const moduleObj = { exports: {} }
  const original = Module._load
  Module._load = function (request, parent, isMain) {
    return original.call(this, request, parent, isMain)
  }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      moduleObj.exports, require, moduleObj, path.join(__dirname, '..', 'src', 'lib', file), path.join(__dirname, '..', 'src', 'lib'),
    )
    return moduleObj.exports
  } finally {
    Module._load = original
  }
}

// --- a minimal fake edge cache, keyed on request.url exactly like the real
// `caches.default` would be -- a Map is enough to prove purge-vs-not.
function makeFakeCache() {
  const store = new Map()
  return {
    store,
    async match(request) {
      return store.has(request.url) ? store.get(request.url).clone() : undefined
    },
    async put(request, response) {
      store.set(request.url, response.clone())
    },
    async delete(request) {
      return store.delete(request.url)
    },
  }
}

// --- a minimal fake R2 bucket backed by a Map of key -> { body, contentType }.
function makeFakeBucket(seed) {
  const store = new Map(Object.entries(seed))
  return {
    store,
    async get(key) {
      const entry = store.get(key)
      if (!entry) return null
      return {
        body: entry.body,
        httpEtag: `"${entry.body}"`,
        writeHttpMetadata(headers) {
          if (entry.contentType) headers.set('content-type', entry.contentType)
        },
      }
    },
    async put(key, data, opts) {
      store.set(key, { body: data, contentType: opts?.httpMetadata?.contentType })
    },
    async delete(keyOrKeys) {
      for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) store.delete(key)
    },
  }
}

global.caches = { default: makeFakeCache() }
const r2 = loadCompiled('r2.ts')

async function seedCacheFor(bucket, key, origin) {
  const request = new Request(new URL(`/${key}`, origin).toString(), { method: 'GET' })
  const ctx = { waitUntil: (p) => p } // await it below instead of fire-and-forget, so the seed is deterministic
  const response = await r2.serveObject(bucket, key, request, ctx)
  assert.equal(response.status, 200, 'seed request must actually hit the object')
  // serveObject's own waitUntil call is synchronous in this fake ctx (the
  // promise executor runs immediately); await it explicitly so the cache
  // write has definitely landed before the next assertion reads the cache.
  await ctx.waitUntil(Promise.resolve())
  return request
}

;(async () => {
  const origin = 'https://shop.example.workers.dev'
  const key = 'uploads/product-1.jpg'

  // --- PUT purges: seed the cache, overwrite the same key, prove the next
  // read is NOT the stale cached bytes.
  {
    const bucket = makeFakeBucket({ [key]: { body: 'ORIGINAL_BYTES', contentType: 'image/jpeg' } })
    global.caches.default = makeFakeCache()
    const seedRequest = await seedCacheFor(bucket, key, origin)
    const cachedBeforeWrite = await global.caches.default.match(seedRequest)
    assert.ok(cachedBeforeWrite, 'the edge cache must actually hold the seeded response before the write')

    await r2.putObject(bucket, key, 'REPLACED_BYTES', 'image/jpeg', origin)
    const cachedAfterWrite = await global.caches.default.match(seedRequest)
    assert.equal(cachedAfterWrite, undefined, 'putObject must purge the stale cached response for the SAME key when given cacheOrigin')

    const freshResponse = await r2.serveObject(bucket, key, new Request(seedRequest.url), { waitUntil: (p) => p })
    assert.equal(await freshResponse.text(), 'REPLACED_BYTES', 'after the purge, serveObject must read the NEW bytes from the bucket, not the stale cache')
    console.log('PASS putObject(..., cacheOrigin) purges the stale caches.default entry for the same key')
  }

  // --- putObject with NO cacheOrigin is a strict no-op on the cache (never
  // throws, never touches `caches` at all) -- the parameter is opt-in.
  {
    const bucket = makeFakeBucket({ [key]: { body: 'ORIGINAL_BYTES', contentType: 'image/jpeg' } })
    global.caches.default = makeFakeCache()
    const seedRequest = await seedCacheFor(bucket, key, origin)
    await r2.putObject(bucket, key, 'REPLACED_BYTES', 'image/jpeg') // no cacheOrigin
    const stillCached = await global.caches.default.match(seedRequest)
    assert.ok(stillCached, 'omitting cacheOrigin must not purge anything -- backward compatible for every existing caller')
    console.log('PASS putObject without cacheOrigin never touches the edge cache (backward compatible)')
  }

  // --- DELETE purges: an already-deleted object must never keep being
  // served from the cache as if it still existed.
  {
    const bucket = makeFakeBucket({ [key]: { body: 'ORIGINAL_BYTES', contentType: 'image/jpeg' } })
    global.caches.default = makeFakeCache()
    const seedRequest = await seedCacheFor(bucket, key, origin)
    assert.ok(await global.caches.default.match(seedRequest), 'sanity: the cache holds the seeded response')

    await r2.deleteObject(bucket, key, origin)
    const cachedAfterDelete = await global.caches.default.match(seedRequest)
    assert.equal(cachedAfterDelete, undefined, 'deleteObject must purge the cached response for the deleted key')

    const afterDeleteResponse = await r2.serveObject(bucket, key, new Request(seedRequest.url), { waitUntil: (p) => p })
    assert.equal(afterDeleteResponse.status, 404, 'a deleted object must read as 404 once the stale cache entry is gone, never the deleted bytes')
    console.log('PASS deleteObject(..., cacheOrigin) purges the cache and the object reads as 404 afterward')
  }

  // --- Bulk delete purges every key in the chunk, not just the first.
  {
    const keyB = 'uploads/product-2.jpg'
    const bucket = makeFakeBucket({
      [key]: { body: 'A', contentType: 'image/jpeg' },
      [keyB]: { body: 'B', contentType: 'image/jpeg' },
    })
    global.caches.default = makeFakeCache()
    const requestA = await seedCacheFor(bucket, key, origin)
    const requestB = await seedCacheFor(bucket, keyB, origin)
    const result = await r2.deleteObjectsBulk(bucket, [key, keyB], origin)
    assert.equal(result.deleted, 2)
    assert.equal(await global.caches.default.match(requestA), undefined, 'deleteObjectsBulk must purge the FIRST key')
    assert.equal(await global.caches.default.match(requestB), undefined, 'deleteObjectsBulk must purge every OTHER key in the same call too')
    console.log('PASS deleteObjectsBulk(..., cacheOrigin) purges every deleted key, not only the first')
  }

  console.log('\nOK - lib/r2.ts serveObject cache is invalidated on write and delete')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
