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
assert.deepStrictEqual(fileAssets.normalizePhysicalStorageSummary({
  total_bytes: 4096, file_count: 4, image_count: 1, video_count: 1, document_count: 1, other_count: 1,
}), { totalBytes: 4096, fileCount: 4, countsByType: { image: 1, video: 1, document: 1, file: 1 } })
const names = load('libraryLogicalAssets.ts', { './fileAssets': fileAssets })
assert.strictEqual(names.logicalLibraryName('upload.JPEG', 'Anastasia / Nectarine'), 'Anastasia-Nectarine_1.jpeg')
assert.strictEqual(names.logicalLibraryName('original.webp', ''), 'original.webp')
assert.strictEqual(names.logicalLibraryName('../unsafe.png', null), 'unsafe.png')

const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'files.ts'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0055_library_image_reference_indexes.sql'), 'utf8')
assert.match(route, /FROM file_assets fa CROSS JOIN products p ON p\.image_path = fa\.public_path\s+WHERE \+p\.is_active = 1 AND fa\.public_path != ''\s+UNION\s+SELECT fa\.\*, p\.id, p\.name\s+FROM file_assets fa CROSS JOIN product_images pi ON pi\.image_path = fa\.public_path CROSS JOIN products p ON p\.id = pi\.product_id\s+WHERE \+p\.is_active = 1 AND fa\.public_path != ''/, 'cover and gallery references must be de-duplicated (UNION) into one logical reference set, each arm an indexed seek from file_assets with +p.is_active kept off the active index')
assert.match(route, /UNION ALL\s+SELECT fa\.\*, NULL, NULL\s+FROM file_assets fa\s+WHERE NOT EXISTS \(SELECT 1 FROM products p WHERE p\.image_path = fa\.public_path[^\n]*\n\s+AND NOT EXISTS \(SELECT 1 FROM product_images pi CROSS JOIN products p ON p\.id = pi\.product_id WHERE pi\.image_path = fa\.public_path/, 'unreferenced physical objects must remain visible')
assert.match(route, /SELECT COUNT\(\*\) AS count FROM logical_assets/, 'pagination must count logical rows')
assert.match(route, /SUM\(CASE WHEN byte_size > 0 THEN byte_size ELSE 0 END\)[\s\S]*AS total_bytes[\s\S]*FROM file_assets/, 'physical bytes must count stored objects directly, not logical product references')
assert.match(route, /physicalStorage: normalizePhysicalStorageSummary\(physicalStorageRow\)/, 'library response must expose normalized physical bytes and per-type counts')
assert.match(route, /reference_product_name.*LIKE @search/s, 'search must include the product-derived logical name')
assert.match(route, /app\.get\('\/:id\/download'/, 'downloads must stream through the guarded server endpoint')
assert.match(route, /Content-Disposition.*filename\*=UTF-8/s, 'logical Unicode filenames must be emitted without renaming R2')
assert.match(route, /hasFullLibraryAccess\(user\)/, 'download remains a Full Library action')
assert.match(migration, /products\(image_path\)/)
assert.match(migration, /product_images\(image_path\)/)
console.log('PASS Library exposes one indexed logical row/name per product reference without copying the stored object')
