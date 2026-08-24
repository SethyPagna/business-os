// Real-SQLite (not mocked) test of routes/portal.ts's public storefront
// search path -- originally written for this session's first move from a
// per-row REPLACE()-chain LIKE full-table-scan onto products_fts (FTS5
// virtual table, via buildFtsMatchExpression's column-SET filter support),
// updated again this session when portal.ts's column scope itself changed
// from {name brand category} to {name sku barcode brand category} plus a
// products_fts_code trigram fallback -- closing the "public portal search"
// half of the "Products/POS/Inventory/public portal search accuracy"
// progress.md item, which explicitly named barcode/sku as the
// second-most-used search dimension after name for every one of those
// surfaces, portal included. Applies migrations/0018_products_fts.sql and
// 0019_products_fts_code.sql verbatim against an in-memory database
// (better-sqlite3, same FTS5 build D1 runs on), same technique as
// test-search-fts-pure.cjs.
//
// What this exists to prove, not just assume from the source read:
// 1. name/brand/category matching still works the same as the old LIKE
//    version (no regression from the rewrite).
// 2. sku/barcode now DO match (the real gap this session's second pass
//    closed) -- both a word-prefix sku match via products_fts and a
//    mid-string barcode-fragment match via the products_fts_code trigram
//    fallback, mirroring products.ts's own ftsMatch/trigramMatch OR
//    combination. supplier/description/unit must still NOT match --
//    those were never in scope and this session didn't touch that part
//    of the decision (see PRODUCT_SEARCH_COLUMNS's own comment in
//    lib/searchMatch.ts for why unit is admin-only and portal has no
//    equivalent use for it).
// 3. Multi-word AND within one query still works (portal has no AND/OR
//    toggle -- always one AND group).
// 4. Brand-shorthand aliases (RT/NYX/BH/OFRA) still resolve, via
//    buildFtsMatchExpression's own alias expansion.
// 5. bm25 relevance ranking works on a column-filtered MATCH (confirms
//    the new ORDER BY -- match rank first, name tiebreaker -- is legal
//    SQL and actually orders best-match-first, not just that it doesn't
//    throw).
//
// Run: node scripts/test-portal-search-fts-pure.cjs
// Requires better-sqlite3 (same test-only, --no-save install as
// test-search-fts-pure.cjs/test-search-500-repro.cjs).

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const searchMatchPath = path.join(__dirname, '..', 'src', 'lib', 'searchMatch.ts')
const searchMatchSource = fs.readFileSync(searchMatchPath, 'utf8')
const { outputText } = ts.transpileModule(searchMatchSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'searchMatch-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { tokenizeSearchWords, buildFtsMatchExpression, buildTrigramMatchExpression, PRODUCTS_FTS_BM25_SQL } = moduleObj.exports

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT, sku TEXT, barcode TEXT, brand TEXT,
    category TEXT, supplier TEXT, description TEXT, unit TEXT
  )`)
  const migration0018 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0018_products_fts.sql'), 'utf8')
  db.exec(migration0018)
  const migration0019 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0019_products_fts_code.sql'), 'utf8')
  db.exec(migration0019)
  return db
}

function insertProduct(db, row) {
  db.prepare(`INSERT INTO products (id, name, sku, barcode, brand, category, supplier, description, unit)
    VALUES (@id, @name, @sku, @barcode, @brand, @category, @supplier, @description, @unit)`).run({
    sku: null, barcode: null, brand: null, category: null, supplier: null, description: null, unit: null,
    ...row,
  })
}

// Mirrors routes/portal.ts's buildPortalProductFilters search-clause
// construction exactly: one flat AND-group of every typed word, scoped to
// {name sku barcode brand category} via products_fts, OR'd against a
// products_fts_code trigram match for mid-string barcode/sku fragments,
// ranked by bm25 (ftsMatch only) when there's a FTS5 match.
function runPortalSearch(db, rawQuery) {
  const words = tokenizeSearchWords(rawQuery, 8)
  if (!words.length) return db.prepare('SELECT id, name FROM products ORDER BY id').all()
  const ftsMatch = buildFtsMatchExpression([words], 'AND', ['name', 'sku', 'barcode', 'brand', 'category'])
  const trigramMatch = buildTrigramMatchExpression([words], 'AND')
  const matchClauses = []
  const params = {}
  if (ftsMatch) {
    params.ftsQuery = ftsMatch
    matchClauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
  }
  if (trigramMatch) {
    params.codeQuery = trigramMatch
    matchClauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
  }
  if (!matchClauses.length) return []
  const whereSql = matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0]
  const rankSql = ftsMatch
    ? `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
    : '0'
  return db.prepare(`
    SELECT p.id, p.name, (${rankSql}) AS rank
    FROM products p
    WHERE ${whereSql}
    ORDER BY rank ASC, lower(p.name) ASC, p.id ASC
  `).all(params)
}

// --- 1. name/brand/category matching, same as the old LIKE version -----
{
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick 617 Rebel', brand: 'MAC', category: 'Lipstick', sku: 'SKU1', barcode: '6923644012345' })
  insertProduct(db, { id: 2, name: 'Essence Lip Tint', brand: 'Essence', category: 'Tint', sku: 'SKU2', barcode: '1112223334445' })
  const byName = runPortalSearch(db, 'lipstick')
  assert.deepStrictEqual(byName.map((r) => r.id), [1], 'a name-word search must still find the matching product via the storefront path')
  const byBrand = runPortalSearch(db, 'mac')
  assert.deepStrictEqual(byBrand.map((r) => r.id), [1], 'a brand search must still work via the storefront path')
  const byCategory = runPortalSearch(db, 'tint')
  assert.deepStrictEqual(byCategory.map((r) => r.id), [2], 'a category search must still work via the storefront path')
  check('portal search matches name/brand/category, same as the old LIKE-chain version', () => {})
}

// --- 2. sku/barcode now match (the real gap this session's second pass
// closed); supplier/description/unit must still NOT leak in -- those
// were never in scope and this session didn't touch that boundary. ---
{
  const db = freshDb()
  insertProduct(db, {
    id: 1,
    name: 'Generic Product',
    brand: 'GenericBrand',
    category: 'GenericCategory',
    sku: 'UNIQUESKU999',
    barcode: '6923644012345',
    supplier: 'ConfidentialSupplierName',
    description: 'internal notes mentioning secretingredient',
    unit: 'peculiarunit',
  })
  assert.deepStrictEqual(runPortalSearch(db, '012').map((r) => r.id), [1], 'a barcode mid-string fragment search must match via the trigram fallback, same as products.ts/inventory.ts')
  assert.deepStrictEqual(runPortalSearch(db, 'uniquesku').map((r) => r.id), [1], 'a sku search must match via the public storefront path now that sku is in scope')
  assert.deepStrictEqual(runPortalSearch(db, 'confidentialsupplier').map((r) => r.id), [], 'a supplier-name search must NOT match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'secretingredient').map((r) => r.id), [], 'a description-word search must NOT match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'peculiarunit').map((r) => r.id), [], 'a unit search must NOT match via the public storefront path (unit stays admin-only, see PRODUCT_SEARCH_COLUMNS)')
  check('storefront search scope is name/sku/barcode/brand/category after widening -- supplier/description/unit still do not leak in', () => {})
}

// --- 3. multi-word AND within one query (no AND/OR toggle on the
// storefront -- always one AND group) -----------------------------------
{
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick', brand: 'MAC', category: 'Lipstick' })
  insertProduct(db, { id: 2, name: 'MAC Foundation', brand: 'MAC', category: 'Foundation' })
  assert.deepStrictEqual(runPortalSearch(db, 'mac lipstick').map((r) => r.id), [1], 'a two-word storefront query must require both words (AND), matching only the lipstick, not the foundation')
  check('storefront multi-word search is AND, same as before the FTS5 move', () => {})
}

// --- 4. brand-shorthand aliases still resolve ---------------------------
{
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Setting Spray', brand: 'Real Techniques', category: 'Tools' })
  assert.deepStrictEqual(runPortalSearch(db, 'rt').map((r) => r.id), [1], "the 'rt' -> 'Real Techniques' alias must still resolve through the storefront's FTS5 path")
  check('storefront brand-shorthand aliases (RT/NYX/BH/OFRA) still resolve after the FTS5 move', () => {})
}

// --- 5. bm25 relevance ranking works on the column-filtered MATCH and
// actually orders the better match first -------------------------------
{
  const db = freshDb()
  // Product 1: "lipstick" only in category (weaker, single low-weight hit).
  insertProduct(db, { id: 1, name: 'Rebel Red', brand: 'MAC', category: 'Lipstick' })
  // Product 2: "lipstick" in the name itself (stronger, higher-weight column).
  insertProduct(db, { id: 2, name: 'MAC Lipstick Classic', brand: 'MAC', category: 'Makeup' })
  const results = runPortalSearch(db, 'lipstick')
  assert.deepStrictEqual(results.map((r) => r.id), [2, 1], 'bm25 ranking on the column-filtered MATCH must still rank a name hit above a category-only hit, matching PRODUCTS_FTS_BM25_SQL\'s column weights')
  check('bm25 relevance ranking works correctly on the widened column-filtered MATCH', () => {})
}

console.log(`\n${passed} portal-search-FTS checks passed`)
