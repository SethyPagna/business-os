// Regression tests for the normal=3/admin=5 product-gallery contract.
// Runs the real validateProductImageGallery from productWrites.ts and also
// source-locks both route rejection and the two former ProductForm hardcodes.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function transpile(relativePath) {
  const sourcePath = path.join(__dirname, '..', 'src', relativePath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  return { sourcePath, output }
}

function load(relativePath, stubs = {}) {
  const compiled = transpile(relativePath)
  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', compiled.output)(
      moduleObj.exports, require, moduleObj, compiled.sourcePath, path.dirname(compiled.sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}

const media = load('lib/media.ts')
const productWrites = load('lib/productWrites.ts', {
  './db': { getDb: () => { throw new Error('DB must not be touched by pure gallery validation') } },
  './media': media,
  './batchCode': { dateToBatchCode: () => '' },
  './searchMatch': { normalizeSearchText: String, compactSearchText: String },
  './importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3 },
  '../index': {},
})

const { validateProductImageGallery, validatePreservedProductImageGallery, ProductImageLimitError } = productWrites
assert.strictEqual(typeof validateProductImageGallery, 'function')

assert.deepStrictEqual(validateProductImageGallery(['/a.webp', '/b.webp', '/c.webp'], 3), ['/a.webp', '/b.webp', '/c.webp'])
assert.deepStrictEqual(
  validateProductImageGallery(['/a.webp', '/a.webp', ' /b.webp '], 3),
  ['/a.webp', '/b.webp'],
  'duplicates and whitespace are normalized before the limit is counted',
)
assert.throws(
  () => validateProductImageGallery(['/1', '/2', '/3', '/4'], 3),
  (error) => error instanceof ProductImageLimitError && error.limit === 3 && error.supplied === 4,
)
assert.strictEqual(validateProductImageGallery(['/1', '/2', '/3', '/4', '/5'], 5).length, 5)
assert.throws(
  () => validateProductImageGallery(['/1', '/2', '/3', '/4', '/5', '/6'], 5),
  (error) => error instanceof ProductImageLimitError && error.limit === 5 && error.supplied === 6,
)
assert.deepStrictEqual(
  validatePreservedProductImageGallery(['/5', '/1', '/2', '/3'], ['/1', '/2', '/3', '/4', '/5'], 5),
  ['/5', '/1', '/2', '/3'],
  'a normal editor may retain, reorder, or reduce an existing admin gallery',
)
assert.strictEqual(
  validatePreservedProductImageGallery(['/1', '/2', '/3', '/new'], ['/1', '/2', '/3', '/4', '/5'], 5),
  null,
  'a fourth new path is not disguised as preservation',
)
assert.strictEqual(validatePreservedProductImageGallery(['/1', '/2', '/3', '/4', '/5', '/6'], ['/1', '/2', '/3', '/4', '/5', '/6'], 5), null)

const routesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
assert.match(routesSource, /validateImageGalleryPayload\(c\.env, user, body/)
assert.match(routesSource, /code: imageLimitError\.code[\s\S]*}, 409\)/)
assert.doesNotMatch(routesSource, /sanitizeMediaList\(rawPaths\)\.slice\(0, ADMIN_MAX_IMAGES_PER_PRODUCT\)/, 'imports must not inherit the admin override')

const formSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'products', 'forms', 'ProductForm.tsx'), 'utf8')
assert.doesNotMatch(formSource, /Math\.min\(5, existingCount/)
assert.doesNotMatch(formSource, /next\.length < 5/)
assert.match(formSource, /Math\.min\(imageLimit, existingCount/)
assert.match(formSource, /next\.length < imageLimit/)
assert.match(formSource, /image_gallery: imageList\.slice\(0, ADMIN_MAX_PRODUCT_GALLERY_IMAGES\)/)

console.log('PASS product galleries reject over-limit writes: normal=3, admin=5; no silent slicing or hidden client five-image bypass')
