// The image provider ladder, and the audit that feeds it.
//
// New uploads target the shared sub-1MB quality band since the browser pipeline
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
const matcherPipeline = (() => {
  const src = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'imagePipeline.ts'), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'imagePipeline.ts',
  })
  const mod = { exports: {} }
  const shim = (r) => (r === './quotaGuard' || r === './analytics' || r === '../index') ? {} : require(r)
  new Function('exports', 'require', 'module', outputText)(mod.exports, shim, mod)
  return mod.exports
})()

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
  assert.match(pipeline, /IMAGE_MAX_BYTES = 900 \* 1024/)
  assert.match(pipeline, /IMAGE_TARGET_BYTES = 820 \* 1024/)
  const browser = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'utils', 'imageCompression.ts'), 'utf8')
  assert.match(browser, /maxBytes: 900 \* 1024/, 'browser ceiling must be the same number')
  assert.match(browser, /targetBytes: 820 \* 1024/, 'browser target must be the same number')
})

check('AVIF is tried before WebP', async () => {
  assert.match(pipeline, /FORMAT_LADDER = \['image\/avif', 'image\/webp'\]/, 'AVIF is 30-50% smaller at equal quality')
})

check('quality reduction is the LAST lever, never the first', async () => {
  // The three levers are not equally costly to how the image looks. Format is
  // free, resizing is cheap, and quality reduction is what produces the
  // blocking and smearing that made compressed images look bad. The plan used
  // to hold the dimension at 2560 and walk quality down immediately, so the
  // very first fallback for a large photo was the most damaging one.
  //
  // This matters beyond taste: the loop takes the FIRST result under the
  // ceiling, so whatever comes first is what MOST images actually get.
  const plan = matcherPipeline.buildAttemptPlan('image/avif')
  assert.ok(plan.length > 1)
  assert.equal(plan[0].quality, 85, 'the first attempt must be full quality')
  assert.equal(plan[0].width, 2560, 'and full size')

  const firstReducedQuality = plan.findIndex((a) => a.quality < 85)
  const lastFullQuality = plan.map((a) => a.quality).lastIndexOf(85)
  assert.ok(
    lastFullQuality < firstReducedQuality,
    'every full-quality resize must be tried BEFORE any quality reduction',
  )

  // Within the full-quality run, size steps down monotonically.
  const fullQualityWidths = plan.filter((a) => a.quality === 85).map((a) => a.width)
  assert.deepEqual(fullQualityWidths, [...fullQualityWidths].sort((a, b) => b - a), 'sizes descend')
  // Quality only ever drops at the smallest size -- shrinking further after
  // already crushing quality would be doing both kinds of damage at once.
  const reduced = plan.filter((a) => a.quality < 85)
  assert.ok(reduced.every((a) => a.width === fullQualityWidths[fullQualityWidths.length - 1]),
    'quality fallback applies only at the smallest dimension')
  assert.deepEqual(reduced.map((a) => a.quality), [...reduced.map((a) => a.quality)].sort((a, b) => b - a))
})

check('a transform never upscales a source that is already smaller', async () => {
  assert.match(pipeline, /fit: 'scale-down'/, 'scale-down is c_limit semantics -- shrink only')
})

check('image work leaves a reserve for video', async () => {
  // A video that cannot be processed is a feature that does not work; an
  // image that misses a pass is merely larger than ideal and the next sweep
  // catches it. Left to compete freely the 6-hourly image sweep would spend
  // the month in its first day or two -- it has thousands of candidates and
  // video has a handful.
  const guard = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'quotaGuard.ts'), 'utf8')
  assert.match(guard, /cf_images_transform: 500/, 'reserve held back from the 5,000')
  assert.match(guard, /export function reservedZoneFor/)
  assert.match(pipeline, /cloudflareBudget\.reservedZone !== 'critical'/, 'the image path must read the RESERVED zone')
  assert.match(pipeline, /cloudinaryBudget\.reservedZone !== 'exhausted'/)
  assert.ok(!/cloudflareBudget\.zone !==/.test(pipeline), 'reading the raw zone here would spend the video reserve')
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
    /if \(cloudflareBudget\.reservedZone !== 'critical' && cloudflareBudget\.reservedZone !== 'exhausted'\)/,
    'the ladder must step down before the wall, and against the RESERVED ceiling',
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
    loopBody.indexOf('new Blob([source]).stream()') < loopBody.indexOf('.output({ format: attempt.format, quality: attempt.quality })'),
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
  // P2-8: the numbers moved to planTier.ts (quotaGuard.ts now keeps only
  // each resource's reset window and the PlanLimits field that carries its
  // ceiling), so pin them where they actually live -- on BOTH tiers, since
  // Images and Cloudinary bill independently of the Workers plan.
  const guard = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'quotaGuard.ts'), 'utf8')
  assert.match(guard, /cf_images_transform: \{ window: 'month', tierField: 'imagesTransformsPerMonth' \}/)
  assert.match(guard, /cloudinary_transform: \{ window: 'month', tierField: 'cloudinaryTransformsPerMonth' \}/)
  const planTier = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'planTier.ts'), 'utf8')
  assert.equal((planTier.match(/imagesTransformsPerMonth: 5_000,/g) || []).length, 2, 'Cloudflare Images free plan is 5,000/month, on both tiers')
  assert.equal((planTier.match(/cloudinaryTransformsPerMonth: 25_000,/g) || []).length, 2)
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
  // skipped because an image sweep failed. (Part 544 rewrote scheduled() from
  // a .then() chain to sequential awaits; Part 574 wrapped each in its own
  // runStep(label, () => fn(env)) guard so one throw can no longer abort the
  // rest. The ORDER is still the invariant, so that is what gets pinned now.)
  const scheduled = index.slice(index.indexOf('async scheduled('))
  const backupAt = scheduled.indexOf("runStep('backup', () => maybeRunScheduledBackup(env))")
  const retentionAt = scheduled.indexOf("runStep('audit-log-retention', () => maybeRunScheduledAuditLogRetention(env))")
  const auditAt = scheduled.indexOf("runStep('image-audit', () => maybeRunScheduledImageAudit(env))")
  assert.ok(backupAt >= 0, 'the backup must run in the scheduled tick')
  assert.ok(retentionAt > backupAt, 'audit-log retention must run after the backup')
  assert.ok(auditAt > retentionAt, 'the image audit must run last')
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
  assert.match(products, /\{indented \? null : \([\s\S]*?aria-label=\{thumbnailState\.hasImage[\s\S]*?openLightbox\(thumbnailState\.gallery, 0, productName\)/,
    'desktop child rows must skip their duplicate thumbnail while standalone image clicks open the lightbox directly')
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
