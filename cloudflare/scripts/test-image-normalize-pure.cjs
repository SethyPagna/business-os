// K3 (Part 417): the on-upload image-normalization path --
// lib/imageAudit.ts's normalizeStoredImage (queue-side kernel) and
// enqueueImageNormalization (producer) against a REAL sqlite image_audit
// table (migration 0054 via load_migrations), with the provider ladder
// stubbed at the imagePipeline seam so the kernel's OWN rules are what's
// under test:
//   - only objects over the ceiling enter the ladder; smaller ones are
//     recorded 'ok' untouched
//   - a result that isn't genuinely smaller is never stored (no_saving)
//   - failure leaves the object byte-identical and records why
//   - success writes back, upserts 'optimized' with original_size
//   - the producer filters non-images, no-ops without a queue binding,
//     and never throws on a send failure
// Plus wiring pins: the queue consumer's optimize-image branch and all
// six ASSETS.put producer sites.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const CEILING = 350 * 1024

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function makeEnv(db, { optimizeResult, queue } = {}) {
  const store = new Map()
  const env = {
    ASSETS: {
      get: async (key) => store.has(key) ? { arrayBuffer: async () => store.get(key) } : null,
      put: async (key, bytes) => { store.set(key, bytes) },
    },
    MEDIA_QUEUE: queue,
  }
  const pipelineStub = {
    IMAGE_MAX_BYTES: CEILING,
    needsOptimization: (byteSize) => byteSize > CEILING,
    optimizeImage: async () => optimizeResult ?? { ok: false, provider: 'cloudflare', reason: 'binding_absent' },
  }
  const audit = loadReal('lib/imageAudit.ts', {
    './db': { getDb: () => db },
    './imagePipeline': pipelineStub,
    './r2': { listObjects: async () => [] },
    './analytics': { recordAnalytics: () => {} },
    './quotaGuard': { consumeQuota: async () => {} },
  })
  return { env, audit, store }
}

async function run() {
  const db = openDb(MIGRATION_SQLS)

  await check('a small image is recorded ok and never enters the ladder', async () => {
    const { env, audit, store } = makeEnv(db, { optimizeResult: { ok: true, bytes: new ArrayBuffer(1), byteSize: 1, provider: 'cloudflare' } })
    store.set('uploads/small.jpg', new ArrayBuffer(1000))
    const outcome = await audit.normalizeStoredImage(env, 'uploads/small.jpg')
    assert.equal(outcome, 'skipped')
    // untouched bytes, honest record
    assert.equal(store.get('uploads/small.jpg').byteLength, 1000)
    const row = await db.prepare(`SELECT status, byte_size FROM image_audit WHERE key = 'uploads/small.jpg'`).get()
    assert.equal(row.status, 'ok')
    assert.equal(row.byte_size, 1000)
  })

  await check('an oversized image optimizes: written back smaller, upserted optimized', async () => {
    const smaller = new ArrayBuffer(200 * 1024)
    const { env, audit, store } = makeEnv(db, { optimizeResult: { ok: true, bytes: smaller, byteSize: smaller.byteLength, contentType: 'image/webp', provider: 'cloudflare' } })
    store.set('uploads/big.png', new ArrayBuffer(500 * 1024))
    const outcome = await audit.normalizeStoredImage(env, 'uploads/big.png')
    assert.equal(outcome, 'optimized')
    assert.equal(store.get('uploads/big.png').byteLength, 200 * 1024)
    const row = await db.prepare(`SELECT status, byte_size, original_size, optimized_at FROM image_audit WHERE key = 'uploads/big.png'`).get()
    assert.equal(row.status, 'optimized')
    assert.equal(row.byte_size, 200 * 1024)
    assert.equal(row.original_size, 500 * 1024)
    assert.ok(row.optimized_at)
  })

  await check('a not-smaller result is never stored (no_saving), a failure leaves bytes untouched', async () => {
    const bigger = new ArrayBuffer(600 * 1024)
    const grew = makeEnv(db, { optimizeResult: { ok: true, bytes: bigger, byteSize: bigger.byteLength, provider: 'cloudinary' } })
    grew.store.set('uploads/grew.jpg', new ArrayBuffer(400 * 1024))
    assert.equal(await grew.audit.normalizeStoredImage(grew.env, 'uploads/grew.jpg'), 'skipped')
    assert.equal(grew.store.get('uploads/grew.jpg').byteLength, 400 * 1024)
    assert.equal((await db.prepare(`SELECT reason FROM image_audit WHERE key = 'uploads/grew.jpg'`).get()).reason, 'no_saving')

    const failed = makeEnv(db) // ladder answers binding_absent
    failed.store.set('uploads/stuck.jpg', new ArrayBuffer(400 * 1024))
    assert.equal(await failed.audit.normalizeStoredImage(failed.env, 'uploads/stuck.jpg'), 'failed')
    assert.equal(failed.store.get('uploads/stuck.jpg').byteLength, 400 * 1024)
    const row = await db.prepare(`SELECT status, reason FROM image_audit WHERE key = 'uploads/stuck.jpg'`).get()
    assert.equal(row.status, 'failed')
    assert.equal(row.reason, 'binding_absent')
  })

  await check('non-images and missing objects fall through without records', async () => {
    const { env, audit } = makeEnv(db)
    assert.equal(await audit.normalizeStoredImage(env, 'uploads/report.csv'), 'not_image')
    assert.equal(await audit.normalizeStoredImage(env, 'uploads/gone.jpg'), 'missing')
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM image_audit WHERE key IN ('uploads/report.csv','uploads/gone.jpg')`).get()).n, 0)
  })

  await check('producer: sends for images, filters non-images, survives no queue and send failures', async () => {
    const sent = []
    const good = makeEnv(db, { queue: { send: async (message) => { sent.push(message) } } })
    await good.audit.enqueueImageNormalization(good.env, 'uploads/photo.webp')
    await good.audit.enqueueImageNormalization(good.env, 'uploads/data.csv')
    assert.deepEqual(sent, [{ assetKey: 'uploads/photo.webp', kind: 'optimize-image' }])

    const none = makeEnv(db) // no MEDIA_QUEUE binding
    await none.audit.enqueueImageNormalization(none.env, 'uploads/photo.jpg') // must not throw

    const broken = makeEnv(db, { queue: { send: async () => { throw new Error('queue down') } } })
    await broken.audit.enqueueImageNormalization(broken.env, 'uploads/photo.jpg') // swallowed
  })

  await check('wiring pins: the consumer branch and all six producer sites', async () => {
    const queueSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'queue.ts'), 'utf8')
    assert.match(queueSource, /if \(kind === 'optimize-image'\) \{[\s\S]*?await normalizeStoredImage\(env, assetKey\)/)
    const producerCounts = [
      ['routes/files.ts', 1], ['routes/users.ts', 1], ['routes/products.ts', 1],
      ['routes/portal.ts', 1], ['routes/importJobs.ts', 2],
    ]
    for (const [rel, count] of producerCounts) {
      const source = fs.readFileSync(path.join(cloudflareRoot, 'src', rel), 'utf8')
      assert.equal((source.match(/await enqueueImageNormalization\(/g) || []).length, count, `${rel} producer count`)
    }
    // files.ts only enqueues IMAGES (videos wait on the container path)
    const filesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'files.ts'), 'utf8')
    assert.match(filesSource, /if \(mediaType === 'image'\) await enqueueImageNormalization/)
    // import staging keys stay out of the uploads/ audit scope
    const importSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'importJobs.ts'), 'utf8')
    assert.match(importSource, /if \(addToLibrary\) await enqueueImageNormalization/)
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
