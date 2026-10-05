// The image variant door is WIRED: index.ts's real `app.get('/uploads/*')`
// handler answers /uploads/_v/w320/<name>.
//
// lib/imageVariants.ts and its unit test existed for weeks with no caller:
// index.ts called serveObject with the key `uploads/_v/w320/<name>`, which is
// not an object, so every variant URL was a 404 (live, measured by the G39
// audit). The unit test could not see it -- it calls serveUpload directly.
// This one takes the handler out of index.ts (harness/load_uploads_route.cjs)
// and mounts it on a real Hono app, so it fails on the commit before the
// wiring and passes after.
//
// Cases chosen so the plausible wrong implementation fails each:
//   - original present, variant absent  -> 302 to /uploads/<name>, short max-age
//     (a 404 here is the live bug; an `immutable` year here would pin the
//     fallback under the thumbnail URL for good)
//   - variant persisted                 -> 200 THE VARIANT, immutable, etag
//     (serving the original here saves nothing)
//   - plain /uploads/<name>             -> unchanged: the original, immutable
//   - variant of an absent original     -> 404 (not a persisted-variant leak)
//   - no transform spent on a hit or on a plain request (quota never called)
//
// Run: node scripts/test-image-variants-wiring-pure.cjs
const assert = require('node:assert/strict')
const { Hono } = require('hono')
const { loadUploadsRoute } = require('./harness/load_uploads_route.cjs')

const quotaCalls = []
const { handlers } = loadUploadsRoute({
  stubs: { quotaGuard: { consumeQuota: async (_env, resource) => { quotaCalls.push(resource); return { allowed: true, zone: 'ok', reservedZone: 'ok' } } } },
})

const NAME = 'shirt-1758844800000-ab12cd34.jpg'
const ORIGINAL = 'ORIGINAL-BYTES-0.84MB'
const THUMB = 'THUMB-BYTES-20KB'

function makeBucket(seed) {
  const store = new Map(Object.entries(seed))
  return {
    reads: [],
    async get(key) {
      this.reads.push(String(key))
      const entry = store.get(String(key))
      if (!entry) return null
      return {
        body: new Blob([entry]).stream(), httpEtag: `"etag-${String(key).length}"`, size: entry.length,
        httpMetadata: { contentType: 'application/octet-stream' },
        writeHttpMetadata(headers) { headers.set('content-type', 'application/octet-stream') },
      }
    },
    async head(key) { return store.has(String(key)) ? { size: store.get(String(key)).length, httpEtag: '"x"' } : null },
    async put() { throw new Error('serving must not write when there is no Images binding') },
  }
}

globalThis.caches = { default: { async match() { return undefined }, async put() {}, async delete() { return true } } }
const ctx = { waitUntil() {}, passThroughOnException() {} }

async function get(seed, pathname) {
  const app = new Hono()
  app.get('/uploads/*', ...handlers)
  const bucket = makeBucket(seed)
  const res = await app.request(new Request(`https://shop.example${pathname}`), undefined, { ASSETS: bucket }, ctx)
  return { res, bucket, text: res.status === 200 ? await res.text() : '' }
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('variant URL, original only: a 302 to the original and a SHORT max-age (not a 404, not a pinned year)', async () => {
  const { res } = await get({ [`uploads/${NAME}`]: ORIGINAL }, `/uploads/_v/w320/${NAME}`)
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), `/uploads/${NAME}`)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
})

test('following that redirect through the same handler serves the original, immutable', async () => {
  const seed = { [`uploads/${NAME}`]: ORIGINAL }
  const first = await get(seed, `/uploads/_v/w320/${NAME}`)
  const second = await get(seed, first.res.headers.get('location'))
  assert.equal(second.res.status, 200)
  assert.equal(second.text, ORIGINAL)
  assert.match(second.res.headers.get('cache-control'), /max-age=31536000/)
})

test('variant URL, variant persisted: the variant, immutable, with an etag', async () => {
  const { res, text } = await get({ [`uploads/${NAME}`]: ORIGINAL, [`variants/w320/${NAME}.webp`]: THUMB }, `/uploads/_v/w320/${NAME}`)
  assert.equal(res.status, 200)
  assert.equal(text, THUMB)
  assert.equal(res.headers.get('content-type'), 'image/webp')
  assert.match(res.headers.get('cache-control'), /immutable/)
  assert.ok(res.headers.get('etag'))
})

test('a variant hit never reads the original (one R2 read)', async () => {
  const { bucket } = await get({ [`uploads/${NAME}`]: ORIGINAL, [`variants/w640/${NAME}.webp`]: THUMB }, `/uploads/_v/w640/${NAME}`)
  assert.deepEqual(bucket.reads, [`variants/w640/${NAME}.webp`])
})

test('plain /uploads/<name> is unchanged: the original, one year immutable', async () => {
  const { res, text } = await get({ [`uploads/${NAME}`]: ORIGINAL, [`variants/w320/${NAME}.webp`]: THUMB }, `/uploads/${NAME}`)
  assert.equal(res.status, 200)
  assert.equal(text, ORIGINAL)
  assert.match(res.headers.get('cache-control'), /max-age=31536000/)
})

test('variant of an original that does not exist: 404', async () => {
  const { res } = await get({}, `/uploads/_v/w320/${NAME}`)
  assert.equal(res.status, 404)
})

test('a width outside the allowlist is refused without touching R2', async () => {
  const { res, bucket } = await get({ [`uploads/${NAME}`]: ORIGINAL }, `/uploads/_v/w1280/${NAME}`)
  assert.equal(res.status, 404)
  assert.deepEqual(bucket.reads, [])
})

test('no transformation is metered for a hit, a plain read or a refusal', async () => {
  assert.deepEqual(quotaCalls, [])
})

;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}\n  ${String(error && error.message || error).split('\n').join('\n  ')}`) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exit(1)
})()
