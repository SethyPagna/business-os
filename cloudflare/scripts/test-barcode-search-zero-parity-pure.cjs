const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

function load(rel) {
  const file = path.join(__dirname, '..', 'src', rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require)
  return mod.exports
}

function loadProductSearchQuery(searchModule) {
  const file = path.join(__dirname, '..', 'src', 'lib', 'productSearchQuery.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const mod = { exports: {} }
  const localRequire = (request) => request === './searchMatch' ? searchModule : require(request)
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, localRequire)
  return mod.exports
}

const search = load('lib/searchMatch.ts')
const productSearch = loadProductSearchQuery(search)
const upcE = '01234565'
const upcA = search.expandUpcE(upcE)
assert.equal(upcA, '012345000065')
assert.equal(search.compressUpcA(upcA), upcE)
assert.equal(search.barcodeKeysMatch(upcE, upcA), true)
assert.equal(search.barcodeKeysMatch(upcE, '1234565'), false, 'valid UPC-E must not collide with an unrelated 7-digit internal code')
assert.equal(search.barcodeKeysMatch('003614274226546', '3614274226546'), true)

const db = openDb([`CREATE TABLE products(id INTEGER PRIMARY KEY,barcode TEXT); CREATE INDEX idx_products_barcode_pg ON products(barcode);
  INSERT INTO products VALUES(1,'01234565'),(2,'012345000065'),(3,'1234565'),(4,'0001234565');`])
const params = {}
const sql = search.buildExactBarcodeMatchClause(upcE, params)
const rows = db.prepare(`SELECT p.id FROM products p WHERE ${sql} ORDER BY p.id`).all(params)
assert.deepEqual(rows.map((row) => Number(row.id)), [1, 2], 'server SQL matches the UPC pair and excludes 7-digit leading-zero lookalikes')
const rank = search.buildExactBarcodeRankSql('barcodeKey', 'p.barcode')
const ranked = db.prepare(`SELECT p.id,${rank} AS rank FROM products p ORDER BY rank,p.id`).all(params)
assert.deepEqual(ranked.filter((row) => Number(row.rank) === 0).map((row) => Number(row.id)), [1, 2])

for (const useSearchIndex of [true, false]) {
  const queryParams = {}
  const query = productSearch.buildProductSearchQuery(upcE, queryParams, { useSearchIndex })
  const found = db.prepare(`SELECT p.id FROM products p WHERE ${query.whereClause} ORDER BY p.id`).all(queryParams)
  assert.deepEqual(
    found.map((row) => Number(row.id)),
    [1, 2],
    `product query (${useSearchIndex ? 'indexed' : 'fallback'}) must not re-admit internal codes through FTS/LIKE`,
  )
}

assert.equal(search.matchesSearchTermGroups([upcE], ['1234565']), false)
assert.equal(search.matchesSearchTermGroups(['1234565'], [upcE]), false)

console.log('test-barcode-search-zero-parity-pure: all checks passed')
