// The image provider ladder, and the audit that feeds it.
//
// New uploads have been inside the 300-350KB band since the browser pipeline
// was fixed. Objects ALREADY in R2 were never touched, because this Worker
// had no server-side image processing at all until the Images binding was
// added. That is what this covers.
//
// The ladder is Cloudflare Images (5,000 unique transformations/month free,
// covering images stored outside Images) -> Cloudinary (a genuinely separate
// quota, so it still works the day Cloudflare's runs out) -> honest failure.
// The last rung matters most: reporting "could not" is what stops a caller
// deleting an original it thinks was replaced.
//
// Run: node scripts/test-image-pipeline-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const pipeline = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'imagePipeline.ts'), 'utf8')
const audit = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'imageAudit.ts'), 'utf8')
const index = fs.readFileSync(path.join(cloudflareRoot, 'src', 'index.ts'), 'utf8')
const wrangler = fs.readFileSync(path.join(cloudflareRoot, 'wrangler.toml'), 'utf8')
const MIGRATION_SQLS = loadAll()

// The real strict matcher, transpiled -- reimplementing the rule here would
// test this file's copy of it.
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))
const matcher = (() => {
  const src = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importImageMatch.ts'), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'importImageMatch.ts',
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
})()

let passed = 0
const tests = []
const check = (name, fn) => tests.push({ name, fn })

check('the band matches the browser pipeline exactly', async () => {
  // Two ceilings that disagree would mean a file passing one path and failing
  // the other, depending only on where it entered the system.
  assert.match(pipeline, /IMAGE_MAX_BYTES = 350 \* 1024/)
  assert.match(pipeline, /IMAGE_TARGET_BYTES = 300 \* 1024/)
  const browser = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'utils', 'imageCompression.ts'), 'utf8')
  assert.match(browser, /maxBytes: 350 \* 1024/, 'browser ceiling must be the same number')
  assert.match(browser, /targetBytes: 300 \* 1024/, 'browser floor must be the same number')
})

check('AVIF is tried before WebP, and quality descends', async () => {
  assert.match(pipeline, /FORMAT_LADDER = \['image\/avif', 'image\/webp'\]/, 'AVIF is 30-50% smaller at equal quality')
  const ladder = pipeline.match(/QUALITY_LADDER = \[([^\]]+)\]/)
  assert.ok(ladder, 'quality ladder not found')
  const values = ladder[1].split(',').map((v) => Number(v.trim()))
  assert.deepEqual(values, [...values].sort((a, b) => b - a), 'quality must descend, or "first under the ceiling" is not the best fit')
  assert.equal(values[0], 85, 'starts at 85 -- above that the file grows fast for gains the eye does not register')
})

check('an image already inside the band is not reprocessed', async () => {
  // The most common case once a backfill has run, and the cheapest answer.
  assert.match(pipeline, /reason: 'already_within_band'/)
  assert.match(pipeline, /if \(source\.byteLength <= IMAGE_MAX_BYTES\)/)
})

check('Cloudflare steps aside at CRITICAL, not at exhausted', async () => {
  // Handing over while there is still headroom leaves Cloudflare able to
  // serve work that has no alternative.
  assert.match(
    pipeline,
    /if \(cloudflareBudget\.zone !== 'critical' && cloudflareBudget\.zone !== 'exhausted'\)/,
    'the ladder must step down before the wall',
  )
})

check('the documented 9422 limit error moves to the next PROVIDER, not the next quality', async () => {
  // Retrying at a lower quality against an exhausted monthly limit fails
  // identically every time and burns the whole ladder doing it.
  assert.match(pipeline, /message\.includes\('9422'\)/)
  assert.match(pipeline, /reason: 'quota_exhausted'/)
})

check('each transform attempt gets a FRESH stream', async () => {
  // A ReadableStream is single-use; reusing one silently yields an empty body
  // on the second attempt, which would look like a decode failure.
  assert.match(pipeline, /const stream = new Blob\(\[source\]\)\.stream\(\)/)
  const loopBody = pipeline.slice(pipeline.indexOf('for (const format of FORMAT_LADDER)'))
  assert.ok(
    loopBody.indexOf('new Blob([source]).stream()') < loopBody.indexOf('.output({ format, quality })'),
    'the stream must be created inside the attempt loop',
  )
})

check('failure is reported, never disguised as success', async () => {
  // A caller that cannot tell "already small enough" from "provider is down"
  // would make exactly the wrong decision about the original.
  assert.match(pipeline, /reason: 'no_provider_available'/)
  assert.match(pipeline, /reason: 'not_configured'/)
  assert.ok(!/catch \{\s*\}/.test(pipeline), 'no silently swallowed errors')
})

check('quotas exist for both providers, with the documented free limits', async () => {
  const guard = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'quotaGuard.ts'), 'utf8')
  assert.match(guard, /cf_images_transform: \{ limit: 5000, window: 'month' \}/, 'Cloudflare Images free plan is 5,000/month')
  assert.match(guard, /cloudinary_transform: \{ limit: 25_000, window: 'month' \}/)
})

check('the Images binding is declared and optional', async () => {
  assert.match(wrangler, /\[images\]\s*\nbinding = "IMAGES"/)
  // Optional so a local run, or a deploy predating the binding, degrades to
  // "no server-side transform" instead of throwing.
  assert.match(index, /IMAGES\?: ImagesBinding/)
})

// ---- the audit ----
check('the sweep never resets an already-optimized object back to oversized', async () => {
  // Without this it would be re-encoded every six hours forever, spending
  // quota to produce a file it had already produced.
  assert.match(audit, /WHEN image_audit\.status = 'optimized' AND @byteSize <= @ceiling THEN 'optimized'/)
})

check('reprocessing takes the LARGEST files first', async () => {
  // That is where the storage actually is. If the month's budget runs out
  // part-way it should have been spent on the files that mattered.
  assert.match(audit, /WHERE status = 'oversized'\s*\n\s*ORDER BY byte_size DESC/)
})

check('a result that is not smaller is never written back', async () => {
  // A "successful" transform that grew the file costs storage AND quality.
  assert.match(audit, /if \(result\.byteSize && result\.byteSize >= source\.byteLength\)/)
  assert.match(audit, /reason: 'no_saving'|'no_saving'/)
})

check('a provider-level wall stops the pass instead of grinding through it', async () => {
  assert.match(audit, /if \(result\.reason === 'no_provider_available' \|\| result\.reason === 'quota_exhausted'\) break/)
})

check('originals are never deleted by the audit', async () => {
  // Storage saved is never worth an unrecoverable loss. The only DELETE here
  // removes an audit ROW for an object that no longer exists.
  const deletes = audit.match(/ASSETS\.delete/g) || []
  assert.deepEqual(deletes, [], 'the audit must not delete R2 objects')
  assert.match(audit, /DELETE FROM image_audit WHERE key = @key/, 'only the audit row is removed')
})

check('the audit cannot break the backup chain', async () => {
  // It runs last, and swallows its own errors, because a backup must never be
  // skipped because an image sweep failed.
  assert.match(index, /\.then\(\(\) => maybeRunScheduledImageAudit\(env\)\)/)
  const chain = index.slice(index.indexOf('maybeRunScheduledBackup(env)'))
  assert.ok(
    chain.indexOf('maybeRunScheduledImageAudit') > chain.indexOf('maybeRunScheduledAuditLogRetention'),
    'the image audit must run last',
  )
  assert.match(audit, /catch \(error\) \{\s*\n\s*console\.error\('\[image-audit\] pass failed'/)
})

check('the audit tables exist and index the sweep order', async () => {
  const db = openDb(MIGRATION_SQLS)
  await db.prepare(`INSERT INTO image_audit (key, byte_size, status) VALUES ('uploads/a.jpg', 900000, 'oversized')`).run({})
  await db.prepare(`INSERT INTO image_audit (key, byte_size, status) VALUES ('uploads/b.jpg', 100, 'ok')`).run({})
  const rows = await db.prepare(`SELECT key FROM image_audit WHERE status = 'oversized' ORDER BY byte_size DESC`).all({})
  assert.deepEqual(rows.map((r) => r.key), ['uploads/a.jpg'])
  const idx = await db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_image_audit_status'`).get({})
  assert.ok(idx, 'the status index must exist, or every pass scans the whole table')
})

// ---------------------------------------------------------------------------
// Strict library matching.
//
// Wiring library images runs across the WHOLE catalog at once, so the import's
// fuzzy bigram fallback is the wrong tool: at that scale a near-miss means
// silently attaching the wrong photo to a real product, and nobody notices
// until a customer does. The rule is exact name, or name + _1.._3.
// ---------------------------------------------------------------------------
check('strict matching accepts the bare name and the indexed forms, nothing else', async () => {
  const products = [{ id: 1, name: 'Coca Cola' }, { id: 2, name: 'Chanel No 5' }]
  const names = ['Coca Cola.jpg', 'Coca Cola_1.jpg', 'Coca Cola_2.jpg', 'Coca Cola Zero.jpg', 'Chanel No 5.jpg']
  const images = names.map((n, i) => ({ id: i, originalName: n, relativePath: n, publicPath: '/x' }))
  const result = matcher.matchLibraryImagesStrict(images, products)
  const matchedNames = result.matched.map((entry) => entry.image.originalName)
  assert.ok(matchedNames.includes('Coca Cola.jpg'), 'exact 1:1 must match')
  assert.ok(matchedNames.includes('Coca Cola_1.jpg') && matchedNames.includes('Coca Cola_2.jpg'), 'indexed forms must match')
  assert.ok(!matchedNames.includes('Coca Cola Zero.jpg'), 'a DIFFERENT product name must not fuzzy-match')
  assert.ok(matchedNames.includes('Chanel No 5.jpg'), 'a trailing number that is part of the NAME must not be read as an index')
})

check('the 3-image cap is enforced by the matcher, not left to the caller', async () => {
  const products = [{ id: 1, name: 'Coca Cola' }]
  const names = ['Coca Cola.jpg', 'Coca Cola_1.jpg', 'Coca Cola_2.jpg', 'Coca Cola_3.jpg']
  const images = names.map((n, i) => ({ id: i, originalName: n, relativePath: n, publicPath: '/x' }))
  const result = matcher.matchLibraryImagesStrict(images, products)
  assert.equal(result.matched.length, 3, 'a group is one product and holds at most three images')
  assert.equal(result.unmatched.length, 1, 'the fourth is reported, not silently dropped')
})

check('an index ABOVE the cap is not treated as an index', async () => {
  // "Coca Cola_9" must not quietly become "Coca Cola" -- the 9 is not a slot
  // this product has, so the file is a miss, not a fourth image.
  const products = [{ id: 1, name: 'Coca Cola' }]
  const images = [{ id: 0, originalName: 'Coca Cola_9.jpg', relativePath: 'Coca Cola_9.jpg', publicPath: '/x' }]
  const result = matcher.matchLibraryImagesStrict(images, products)
  assert.equal(result.matched.length, 0)
})

check('a name shared by two products is AMBIGUOUS, never guessed', async () => {
  // Picking one arbitrarily would attach the photo to the wrong row, and two
  // products sharing a name is a grouping question for the operator.
  const products = [{ id: 3, name: 'Twin Name' }, { id: 4, name: 'Twin Name' }]
  const images = [{ id: 0, originalName: 'Twin Name.jpg', relativePath: 'Twin Name.jpg', publicPath: '/x' }]
  const result = matcher.matchLibraryImagesStrict(images, products)
  assert.equal(result.matched.length, 0)
  assert.equal(result.ambiguous.length, 1)
})

check('the wire-images route uses the STRICT matcher, not the fuzzy import one', async () => {
  const route = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  assert.match(route, /matchLibraryImagesStrict\(/)
  assert.ok(!/matchImagesToProducts\(/.test(route), 'the fuzzy matcher must not be reachable from the library path')
})

check('grouped CHILD rows show no thumbnail on the desktop table either', async () => {
  // A name group is ONE product with ONE set of photos, drawn on the group
  // header. renderMobileProductCard already did this; the desktop TABLE row
  // did not, which is why duplicate thumbnails and the ragged left edge
  // appeared only on large screens.
  const products = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
  assert.match(products, /\{indented \? null : thumbnailState\.hasImage/, 'desktop row must skip the image for a child row')
  const guards = products.match(/indented \? null/g) || []
  assert.ok(guards.length >= 2, 'both the mobile card and the desktop row need the guard')
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
