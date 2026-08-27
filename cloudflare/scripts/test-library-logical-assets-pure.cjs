const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function load(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const fileAssets = load('fileAssets.ts')
const names = load('libraryLogicalAssets.ts', { './fileAssets': fileAssets })
assert.strictEqual(names.logicalLibraryName('upload.JPEG', 'Anastasia / Nectarine'), 'Anastasia-Nectarine_1.jpeg')
assert.strictEqual(names.logicalLibraryName('original.webp', ''), 'original.webp')
assert.strictEqual(names.logicalLibraryName('../unsafe.png', null), 'unsafe.png')

const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'files.ts'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0055_library_image_reference_indexes.sql'), 'utf8')
assert.match(route, /UNION\s+SELECT pi\.image_path/, 'cover and gallery references must be de-duplicated into the same logical reference set')
assert.match(route, /LEFT JOIN product_refs refs ON refs\.public_path = fa\.public_path/, 'unreferenced physical objects must remain visible')
assert.match(route, /SELECT COUNT\(\*\) AS count FROM logical_assets/, 'pagination must count logical rows')
assert.match(route, /reference_product_name.*LIKE @search/s, 'search must include the product-derived logical name')
assert.match(migration, /products\(image_path\)/)
assert.match(migration, /product_images\(image_path\)/)
console.log('PASS Library exposes one indexed logical row/name per product reference without copying the stored object')
