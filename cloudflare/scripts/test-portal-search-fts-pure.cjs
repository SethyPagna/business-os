// Real-SQLite (not mocked) test of routes/portal.ts's public storefront
// search path -- originally written for the move from a per-row
// REPLACE()-chain LIKE full-table-scan onto products_fts (FTS5 virtual
// table, via buildFtsMatchExpression's column-SET filter support), then
// widened to {name sku barcode brand category}, and now narrowed again to
// {name sku barcode} ONLY -- per an explicit request that free-text product
// search (Products/POS/Inventory/public portal, all four surfaces) should
// only ever match name/barcode/sku: product names in this catalog already
// carry the brand (including shorthand like "elf" for e.l.f.), and
// brand/category are already reachable via their own filter chips, so a
// brand/category text hit was noise, not signal, for someone typing into a
// product search box. See PRODUCT_SEARCH_COLUMNS's own comment in
// lib/searchMatch.ts for the full reasoning (that constant governs
// products.ts/inventory.ts; portal.ts passes its own literal column list to
// buildFtsMatchExpression, mirrored here). Applies migrations/
// 0018_products_fts.sql and 0019_products_fts_code.sql verbatim against an
// in-memory database (better-sqlite3, same FTS5 build D1 runs on), same
// technique as test-search-fts-pure.cjs.
//
// What this exists to prove, not just assume from the source read:
// 1. name matching still works.
// 2. sku/barcode still match (a word-prefix sku match via products_fts and
//    a mid-string barcode-fragment match via the products_fts_code trigram
//    fallback, mirroring products.ts's own ftsMatch/trigramMatch OR
//    combination).
// 3. brand/category/supplier/description/unit must ALL now NOT match via
//    free text -- brand/category dropped this session alongside the
//    pre-existing supplier/description/unit exclusions.
// 4. Multi-word AND within one query still works (portal has no AND/OR
//    toggle -- always one AND group).
// 5. Brand-shorthand aliases (RT/NYX/BH/OFRA) resolving against BRAND text
//    no longer apply on the storefront now that brand is out of scope --
//    typing "rt" must NOT find a product whose only "rt"-relevant text is
//    its brand field, now that brand isn't searched at all.
// 6. bm25 relevance ranking still works on the narrowed column-filtered
//    MATCH (confirms the ORDER BY is still legal SQL and doesn't throw
//    once the column-SET filter drops to a single-weight-tier set).
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
// {name sku barcode} via products_fts, OR'd against a products_fts_code
// trigram match for mid-string barcode/sku fragments, ranked by bm25
// (ftsMatch only) when there's a FTS5 match.
function runPortalSearch(db, rawQuery) {
  const words = tokenizeSearchWords(rawQuery, 8)
  if (!words.length) return db.prepare('SELECT id, name FROM products ORDER BY id').all()
  const ftsMatch = buildFtsMatchExpression([words], 'AND', ['name', 'sku', 'barcode'])
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

// --- 1. name matching works; brand/category text no longer matches -----
{
  const db = freshDb()
  // Brand/category deliberately do NOT restate "MAC"/"Tint" in the name
  // here (unlike the old version of this test) -- the whole point of
  // this check is that a brand/category word absent from the name must no
  // longer match, and "MAC Matte Lipstick" would have made 'mac' match via
  // NAME anyway, masking the very thing being tested.
  insertProduct(db, { id: 1, name: 'Matte Lipstick 617 Rebel', brand: 'MAC', category: 'Lipstick', sku: 'SKU1', barcode: '6923644012345' })
  insertProduct(db, { id: 2, name: 'Essence Lip Tint', brand: 'Essence', category: 'Beauty', sku: 'SKU2', barcode: '1112223334445' })
  const byName = runPortalSearch(db, 'lipstick')
  assert.deepStrictEqual(byName.map((r) => r.id), [1], 'a name-word search must still find the matching product via the storefront path')
  const byBrand = runPortalSearch(db, 'mac')
  assert.deepStrictEqual(byBrand.map((r) => r.id), [], 'a brand-only text search must NOT match via the storefront path now that brand is out of scope (use the brand filter chip instead)')
  assert.deepStrictEqual(runPortalSearch(db, 'rebel').map((r) => r.id), [1], 'sanity: a real name word still matches')
  const byCategory = runPortalSearch(db, 'beauty')
  assert.deepStrictEqual(byCategory.map((r) => r.id), [], 'a category-only text search must NOT match via the storefront path now that category is out of scope (use the category filter chip instead)')
  check('portal search matches name only, not brand/category text', () => {})
}

// --- 2. sku/barcode match; brand/category/supplier/description/unit must
// all NOT leak in -------------------------------------------------------
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
  assert.deepStrictEqual(runPortalSearch(db, 'uniquesku').map((r) => r.id), [1], 'a sku search must match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'genericbrand').map((r) => r.id), [], 'a brand-name search must NOT match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'genericcategory').map((r) => r.id), [], 'a category-name search must NOT match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'confidentialsupplier').map((r) => r.id), [], 'a supplier-name search must NOT match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'secretingredient').map((r) => r.id), [], 'a description-word search must NOT match via the public storefront path')
  assert.deepStrictEqual(runPortalSearch(db, 'peculiarunit').map((r) => r.id), [], 'a unit search must NOT match via the public storefront path (unit stays admin-only, see PRODUCT_SEARCH_COLUMNS)')
  check('storefront search scope is name/sku/barcode only -- brand/category/supplier/description/unit all stay out', () => {})
}

// --- 3. multi-word AND within one query (no AND/OR toggle on the
// storefront -- always one AND group) -----------------------------------
{
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick', brand: 'MAC', category: 'Lipstick' })
  insertProduct(db, { id: 2, name: 'MAC Foundation', brand: 'MAC', category: 'Foundation' })
  assert.deepStrictEqual(runPortalSearch(db, 'matte lipstick').map((r) => r.id), [1], 'a two-word storefront query (both words in the NAME) must require both words (AND), matching only the lipstick, not the foundation')
  check('storefront multi-word search is AND, same as before', () => {})
}

// --- 4. brand-shorthand aliases no longer resolve via BRAND text (brand
// is out of scope); they still resolve normally when the alias word is
// genuinely part of the NAME -------------------------------------------
{
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Setting Spray', brand: 'Real Techniques', category: 'Tools' })
  assert.deepStrictEqual(runPortalSearch(db, 'rt').map((r) => r.id), [], "'rt' must NOT resolve to a product whose only 'Real Techniques' text is its brand field, now that brand is out of the storefront's search scope")
  const db2 = freshDb()
  insertProduct(db2, { id: 1, name: 'RT Precision Foundation Brush', brand: 'Real Techniques', category: 'Tools' })
  assert.deepStrictEqual(runPortalSearch(db2, 'rt').map((r) => r.id), [1], "'rt' must still match a product whose NAME literally starts with 'RT' -- this is a plain name-prefix match, unrelated to brand-alias expansion")
  check('storefront brand-shorthand alias resolution no longer applies to brand-only text', () => {})
}

// --- 5. bm25 relevance ranking still works on the narrowed column-
// filtered MATCH (name/sku/barcode all carry equal weight in
// PRODUCTS_FTS_BM25_SQL now that this is the only tier the storefront
// queries -- this just confirms the ORDER BY stays legal SQL and both a
// name match and a sku match come back, not a specific weight ordering) --
{
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Rebel Red Lipstick', brand: 'MAC', category: 'Lipstick', sku: 'SKU-OTHER' })
  insertProduct(db, { id: 2, name: 'Unrelated Product', brand: 'MAC', category: 'Makeup', sku: 'SKU-LIPSTICK' })
  const results = runPortalSearch(db, 'lipstick')
  assert.ok(results.some((r) => r.id === 1), 'the name match must be present')
  assert.ok(results.some((r) => r.id === 2), 'the sku match must be present')
  check('bm25 relevance ranking does not throw on the narrowed column-filtered MATCH', () => {})
}

console.log(`\n${passed} portal-search-FTS checks passed`)
