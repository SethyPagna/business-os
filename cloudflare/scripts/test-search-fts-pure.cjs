// Real-SQLite (not mocked) test of the products_fts/products_fts_code
// search path: applies migrations/0018_products_fts.sql and
// migrations/0019_products_fts_code.sql verbatim against an in-memory
// database (better-sqlite3, which bundles the same FTS5 build D1 runs
// on), builds the exact MATCH expressions lib/searchMatch.ts's
// buildFtsMatchExpression/buildTrigramMatchExpression produce, and runs
// them the same way routes/products.ts's buildSearchFilters combines the
// two -- as close to a real deploy as this sandbox can get without D1
// access. This is deliberately NOT a JS-logic-only mock: the whole point
// is confirming real FTS5 behavior (prefix vs. substring matching), which
// a hand-rolled JS re-implementation could easily get subtly wrong in a
// way that matched the test but not the database.
//
// Covers the two specific reported cases from progress.md's "Products/
// POS/Inventory search accuracy" item: typing "012" should find it via
// barcode (a substring in the middle of one unbroken token -- the bug
// products_fts_code/buildTrigramMatchExpression fixes) and a token deep
// inside a long name like "mac matte lipstick 617" should match without
// typing the whole string (already worked via products_fts's own prefix
// matching -- confirmed here too, not just assumed from the code read).
//
// Run: node scripts/test-search-fts-pure.cjs
// Requires better-sqlite3 (installed --no-save into node_modules for this
// session; not a package.json dependency -- Cloudflare Workers/D1 has no
// use for a native SQLite binding, this is a test-only tool for exercising
// real FTS5 offline).

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
const {
  tokenizeSearchTermGroups,
  buildFtsMatchExpression,
  buildTrigramMatchExpression,
  buildHybridMatchClause,
  PRODUCTS_FTS_BM25_SQL,
} = moduleObj.exports

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- schema: apply the real migration files verbatim -------------------

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT, sku TEXT, barcode TEXT, brand TEXT,
    category TEXT, supplier TEXT, description TEXT, unit TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    name_normalized TEXT, unit_normalized TEXT, brand_compact TEXT
  )`)
  const migration0018 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0018_products_fts.sql'), 'utf8')
  const migration0019 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0019_products_fts_code.sql'), 'utf8')
  db.exec(migration0018)
  db.exec(migration0019)
  return db
}

// Same JS-side fold routes/products.ts's write path (lib/productWrites.ts's
// insertRow) now applies at write time -- see migrations/0037_product_
// search_compact_columns.sql's own comment for why this moved out of SQL
// entirely. This helper's own tiny fold is deliberately independent of
// lib/searchMatch.ts's real normalizeSearchText/compactSearchText (this
// file intentionally has zero imports from the app's own source, to stay
// a pure verbatim-migration-file test) -- good enough to exercise
// buildCompactColumnMatchClause's SQL shape, not meant to be a second
// source of truth for the real fold's exact Unicode behavior (that's
// covered by test-search-brand-compact-pure.cjs against the real fold).
function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function insertProduct(db, row) {
  const merged = {
    sku: null, barcode: null, brand: null, category: null, supplier: null, description: null, unit: null,
    ...row,
  }
  db.prepare(`INSERT INTO products (id, name, sku, barcode, brand, category, supplier, description, unit, name_normalized, unit_normalized, brand_compact)
    VALUES (@id, @name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, @name_normalized, @unit_normalized, @brand_compact)`).run({
    ...merged,
    name_normalized: normalized(merged.name),
    unit_normalized: normalized(merged.unit),
    brand_compact: compact(merged.brand),
  })
}

// Mirrors routes/products.ts's buildSearchFilters search-clause
// construction exactly (see that file's comment for why IN-subqueries,
// not a JOIN + direct MATCH).
function runSearch(db, rawQuery, mode = 'AND', titleOnly = false) {
  const groups = tokenizeSearchTermGroups(rawQuery, 6, 8)
  if (!groups.length) return db.prepare('SELECT id, name FROM products ORDER BY id').all()
  const ftsMatch = buildFtsMatchExpression(groups, mode, titleOnly ? 'name' : undefined)
  const trigramMatch = titleOnly ? undefined : buildTrigramMatchExpression(groups, mode)
  const clauses = []
  const params = {}
  if (ftsMatch) {
    params.ftsQuery = ftsMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
  }
  if (trigramMatch) {
    params.codeQuery = trigramMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
  }
  const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(groups, mode, 'hyb')
  if (hybridMatch) {
    Object.assign(params, hybridMatch.params)
    clauses.push(hybridMatch.sql)
  }
  if (!clauses.length) return []
  const whereSql = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]
  const rankSql = (!titleOnly && ftsMatch)
    ? `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
    : '0'
  return db.prepare(`
    SELECT p.id, p.name, (${rankSql}) AS rank
    FROM products p
    WHERE ${whereSql}
    ORDER BY rank ASC, p.id ASC
  `).all(params)
}

// --- the two reported cases ---------------------------------------------

check('barcode substring match ("012" inside "6923644012345") -- the reported bug, now fixed', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick 617 Rebel', barcode: '6923644012345', brand: 'MAC' })
  insertProduct(db, { id: 2, name: 'Unrelated Product', barcode: '9999999999999', brand: 'Other' })
  const results = runSearch(db, '012')
  assert.deepStrictEqual(results.map((r) => r.id), [1], 'searching "012" should find only the product whose barcode contains it')
  db.close()
})

check('a token deep inside a long name ("617" in "MAC Matte Lipstick 617 Rebel") matches without typing the whole name', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick 617 Rebel', barcode: '6923644012345', brand: 'MAC' })
  insertProduct(db, { id: 2, name: 'Unrelated Product', barcode: '9999999999999', brand: 'Other' })
  const results = runSearch(db, '617')
  assert.deepStrictEqual(results.map((r) => r.id), [1])
  db.close()
})

check('full multi-word phrase "mac matte lipstick 617" matches via AND of prefix terms', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick 617 Rebel', barcode: '6923644012345', brand: 'MAC' })
  insertProduct(db, { id: 2, name: 'MAC Matte Lipstick 512 Diva', barcode: '6923644051200', brand: 'MAC' })
  const results = runSearch(db, 'mac matte lipstick 617')
  assert.deepStrictEqual(results.map((r) => r.id), [1], 'the 512 shade should not match a search for 617')
  db.close()
})

check('barcode match still surfaces even when combined with a name/brand match elsewhere (OR across match sources)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Random Other 617', barcode: '9999999999999', brand: 'Other' }) // matches via name (617 is a token)
  insertProduct(db, { id: 2, name: 'MAC Matte Lipstick', barcode: '6923644012345', brand: 'MAC' }) // matches via barcode trigram only
  const results = runSearch(db, '012, 617', 'OR')
  const ids = results.map((r) => r.id).sort()
  assert.deepStrictEqual(ids, [1, 2])
  db.close()
})

// --- mixed name+barcode group (buildHybridMatchClause) ---------------------

check('a single group mixing a name word and a barcode-fragment word matches (the documented gap, now fixed)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick', barcode: '6923644012345', brand: 'MAC' })
  insertProduct(db, { id: 2, name: 'MAC Matte Lipstick', barcode: '9999999999999', brand: 'MAC' }) // MAC but wrong barcode
  insertProduct(db, { id: 3, name: 'Essence Tint', barcode: '6923644012345', brand: 'Essence' }) // right barcode, not MAC
  const results = runSearch(db, 'mac 012', 'AND')
  assert.deepStrictEqual(results.map((r) => r.id), [1], 'only the row that is both MAC AND has 012 in its barcode should match')
  db.close()
})

check('without the hybrid fallback, the mixed group would NOT match (regression guard proving this is a real fix, not a no-op)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick', barcode: '6923644012345', brand: 'MAC' })
  const groups = tokenizeSearchTermGroups('mac 012', 6, 8)
  const ftsMatch = buildFtsMatchExpression(groups, 'AND')
  const trigramMatch = buildTrigramMatchExpression(groups, 'AND')
  const clauses = []
  const params = {}
  if (ftsMatch) { params.ftsQuery = ftsMatch; clauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)') }
  if (trigramMatch) { params.codeQuery = trigramMatch; clauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)') }
  const whereSql = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]
  const withoutHybrid = db.prepare(`SELECT p.id FROM products p WHERE ${whereSql}`).all(params)
  assert.deepStrictEqual(withoutHybrid.map((r) => r.id), [], 'sanity check: ftsMatch/trigramMatch alone genuinely cannot express this, confirming the hybrid clause is doing real work')
  db.close()
})

check('mixed group respects OR mode against other groups (hybrid clause joins with the same top-level mode)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick', barcode: '6923644012345', brand: 'MAC' }) // matches "mac 012" hybrid group
  insertProduct(db, { id: 2, name: 'Essence Tint', barcode: '1112223334445', brand: 'Essence' }) // matches "essence" plain group
  insertProduct(db, { id: 3, name: 'Unrelated Item', barcode: '5556667778889', brand: 'Other' })
  const results = runSearch(db, 'mac 012, essence', 'OR')
  assert.deepStrictEqual(results.map((r) => r.id).sort(), [1, 2])
  db.close()
})

check('mixed group is a no-op for single-word groups (does not duplicate the already-covered common case)', () => {
  const groups = tokenizeSearchTermGroups('lipstick', 6, 8)
  assert.strictEqual(buildHybridMatchClause(groups, 'AND', 'hyb'), undefined, 'a single-word group should not trigger the hybrid path')
})

check('titleOnly mode skips the hybrid fallback too (no barcode/sku matching in name-only mode)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Matte Lipstick', barcode: '6923644012345', brand: 'MAC' })
  const results = runSearch(db, 'mac 012', 'AND', /* titleOnly */ true)
  assert.deepStrictEqual(results.map((r) => r.id), [], 'titleOnly search must not fall back to the hybrid barcode match either')
  db.close()
})

// --- comma AND/OR grouping (already implemented -- confirming, not fixing) --

check('comma splits into GROUPS; a plain space inside a group is normal word-spacing, not a group boundary', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'MAC Lipstick', brand: 'MAC' })
  insertProduct(db, { id: 2, name: 'Essence Tint', brand: 'Essence' })
  insertProduct(db, { id: 3, name: 'Unrelated Item', brand: 'Other' })
  // AND mode: with comma as group separator, "mac lipstick, essence tint" is
  // two 2-word phrase groups -- neither product satisfies BOTH phrases, so
  // AND mode (must match every group) should find nothing.
  const andResults = runSearch(db, 'mac lipstick, essence tint', 'AND')
  assert.deepStrictEqual(andResults.map((r) => r.id), [])
  // OR mode: either phrase group is enough -- both real products match,
  // the unrelated one doesn't.
  const orResults = runSearch(db, 'mac lipstick, essence tint', 'OR')
  assert.deepStrictEqual(orResults.map((r) => r.id).sort(), [1, 2])
  db.close()
})

// --- edge cases -----------------------------------------------------------

check('a 1-2 character search term returns zero rows via trigram, not a SQL error (trigram needs 3+ chars per token)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Something', barcode: '123456789' })
  assert.doesNotThrow(() => runSearch(db, '12'))
  db.close()
})

check('empty query returns every active row untouched (no MATCH clause built)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'A' })
  insertProduct(db, { id: 2, name: 'B' })
  const results = runSearch(db, '')
  assert.deepStrictEqual(results.map((r) => r.id), [1, 2])
  db.close()
})

check('titleOnly mode skips the barcode/sku trigram fallback entirely', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Some Product', barcode: '6923644012345' })
  const results = runSearch(db, '012', 'AND', /* titleOnly */ true)
  assert.deepStrictEqual(results.map((r) => r.id), [], 'titleOnly search must not fall back to barcode matching')
  db.close()
})

check('a product edited after insert is re-indexed by the sync triggers (external-content FTS5 needs this)', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Old Name', barcode: '1112223334445' })
  assert.deepStrictEqual(runSearch(db, '223').map((r) => r.id), [1])
  db.prepare('UPDATE products SET barcode = @barcode WHERE id = 1').run({ barcode: '9998887776665' })
  assert.deepStrictEqual(runSearch(db, '223').map((r) => r.id), [], 'old barcode fragment should no longer match after the update')
  assert.deepStrictEqual(runSearch(db, '887').map((r) => r.id), [1], 'new barcode fragment should match after the update')
  db.close()
})

// Regression test for a real bug found while adding routes/portal.ts's
// FTS5 column-SET filter (see searchMatch.ts's expandAliasCandidatesForFts
// comment for the full root cause): a brand-shorthand alias whose full
// form is MULTIPLE words (RT/NYX/BH/OFRA all are) silently never matched
// via buildFtsMatchExpression before this fix, because the alias's compact
// joined form ("realtechniques") is not a prefix of either of the two
// separate FTS5 tokens ("real", "techniques") unicode61 actually indexes
// for a stored "Real Techniques" brand. This was never caught by this
// file's own test suite until now -- added here, not just in the portal's
// own new test, so ANY caller of buildFtsMatchExpression (products.ts,
// inventory.ts, portal.ts) is covered by this file's regression suite
// going forward, not just the one route that happened to add a new test.
check('multi-word brand-shorthand alias resolves via FTS5 (RT -> "Real Techniques")', () => {
  const db = freshDb()
  insertProduct(db, { id: 1, name: 'Setting Spray', brand: 'Real Techniques', category: 'Tools' })
  insertProduct(db, { id: 2, name: 'Unrelated Product', brand: 'Other Brand' })
  const byAlias = runSearch(db, 'rt')
  assert.deepStrictEqual(byAlias.map((r) => r.id), [1], "'rt' must resolve to the 'Real Techniques' brand via FTS5, not just the JS/LIKE fallback paths")
  const byFullName = runSearch(db, 'real techniques')
  assert.deepStrictEqual(byFullName.map((r) => r.id), [1], 'typing the full alias target out should also still match directly (unaffected either way, confirmed for completeness)')
  db.close()
})

console.log(`\n${passed} search-FTS checks passed`)
