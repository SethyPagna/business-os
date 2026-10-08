// Parity: the URL the FRONTEND builds for a thumbnail
// (frontend/src/utils/imageVariantUrl.ts toImageVariantPath) must be one the
// WORKER accepts (cloudflare/src/lib/imageVariants.ts parseImageVariantPath),
// for the same width and the same stored name.
//
// The rule is written twice, once per package. If the frontend ever offers a
// name the Worker refuses, every such thumbnail is a 404 first and the
// original second (the component falls back once), i.e. the saving silently
// disappears; if the widths drift, a whole size class does. This runs both
// real implementations against each other over a corpus of ordinary and
// hostile names, so it fails on either side's edit.
//
// Subset, not equality: the frontend deliberately offers FEWER names (no .gif:
// a variant is a still WebP; no names with a % escape). Everything it offers
// must round-trip through the Worker.
//
// Positive control: a deliberately naive frontend (any extension, no segment
// check) is caught by the same corpus, so the test is able to fail.
//
// Run: node scripts/test-image-variant-url-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function transpile(file, shim) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, shim || require, moduleObj)
  return moduleObj.exports
}

const worker = transpile(path.join(__dirname, '..', 'src', 'lib', 'imageVariants.ts'), (request) => {
  if (request === './r2') return {}
  if (request === './quotaGuard') return {}
  if (request === '../index') return {}
  return require(request)
})
const frontendUtils = path.join(__dirname, '..', '..', 'frontend', 'src', 'utils')
const uploadKernel = transpile(path.join(frontendUtils, 'uploadUrlKernel.ts'))
const frontend = transpile(path.join(frontendUtils, 'imageVariantUrl.ts'), request => {
  if (request === './uploadUrlKernel.ts') return uploadKernel
  throw new Error(`Unexpected frontend dependency: ${request}`)
})

const tests = []
const test = (name, fn) => tests.push([name, fn])

const NAMES = [
  'shirt-1758844800000-ab12cd34.jpg', 'a.jpeg', 'b.PNG', 'c.WebP', 'd.avif', 'e.bmp', 'Nivea Cream 100ml-1758844800000-ab12cd34.jpg',
  'ក្រែម-1758844800000-ab12cd34.jpg', 'x.y.z.jpg', 'with-dash_and_underscore.png', '日本語-1.webp',
  // Not variants: wrong type, nesting, escapes, variant-of-variant, no stem.
  'clip.mp4', 'doc.pdf', 'data.csv', 'file.bin', 'noext', '.jpg', 'a.gif', 'anim.GIF', 'a.svg', 'a.html',
  'a/b.jpg', '../a.jpg', '..', '.', '_v-1.jpg', '_v', 'a\\b.jpg', 'a%2fb.jpg', 'percent%20.jpg', 'tab\t.jpg', 'nul\u0000.jpg',
  `${'a'.repeat(251)}.jpg`, `${'a'.repeat(252)}.jpg`, `${'a'.repeat(300)}.jpg`, '',
]

function check(toPath, label) {
  const offered = []
  for (const width of frontend.IMAGE_VARIANT_WIDTHS) {
    for (const name of NAMES) {
      const variantPath = toPath(`/uploads/${name}`, width)
      if (variantPath === null) continue
      offered.push([width, name, variantPath])
      assert.ok(variantPath.startsWith('/uploads/'), `${label}: ${variantPath}`)
      const parsed = worker.parseImageVariantPath(variantPath.slice('/uploads/'.length))
      assert.ok(parsed && parsed !== 'invalid', `${label}: the Worker refuses ${JSON.stringify(variantPath)}, which the frontend would request`)
      assert.equal(parsed.width, width, `${label}: width for ${JSON.stringify(name)}`)
      assert.equal(parsed.storedName, name, `${label}: stored name for ${JSON.stringify(name)}`)
      assert.equal(parsed.originalKey, `uploads/${name}`)
    }
  }
  return offered
}

test('the widths are the same list in both packages', () => {
  assert.deepEqual([...frontend.IMAGE_VARIANT_WIDTHS], [...worker.IMAGE_VARIANT_WIDTHS])
  assert.ok(worker.IMAGE_VARIANT_WIDTHS.includes(frontend.THUMBNAIL_VARIANT_WIDTH))
  assert.ok(worker.IMAGE_VARIANT_WIDTHS.includes(frontend.THUMBNAIL_VARIANT_WIDTH_2X))
})

test('every variant URL the frontend builds is accepted by the Worker, for the same width and name', () => {
  const offered = check((value, width) => frontend.toImageVariantPath(value, width), 'frontend')
  // The corpus is not vacuous: ordinary names were offered, at every width.
  assert.ok(offered.length >= 3 * 10, `only ${offered.length} URLs were offered`)
  assert.ok(offered.some(([, name]) => name === 'ក្រែម-1758844800000-ab12cd34.jpg'), 'Khmer name is offered')
  assert.ok(!offered.some(([, name]) => /\.gif$/i.test(name)), 'no animated-capable GIF variant is offered')
})

test('the frontend offers a variant for the names the Worker would build one for, except the deliberate exclusions', () => {
  const excluded = (name) => /\.gif$/i.test(name) || name.includes('%')
  for (const name of NAMES) {
    const parsed = worker.parseImageVariantPath(`_v/w320/${name}`)
    const workerAccepts = parsed && parsed !== 'invalid'
    const frontendOffers = frontend.toImageVariantPath(`/uploads/${name}`, 320) !== null
    if (frontendOffers) assert.ok(workerAccepts, `frontend offers ${JSON.stringify(name)} but the Worker refuses it`)
    if (workerAccepts && !excluded(name)) assert.ok(frontendOffers, `the Worker accepts ${JSON.stringify(name)} but the frontend never asks for it (the saving is lost)`)
  }
})

test('positive control: a naive frontend (any extension, no segment check) is caught by the same corpus', () => {
  const naive = (value, width) => `/uploads/_v/w${width}/${String(value).replace(/^\/uploads\//, '')}`
  assert.throws(() => check(naive, 'naive'), /the Worker refuses/)
})

;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}\n  ${String(error && error.message || error).split('\n').join('\n  ')}`) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exit(1)
})()
