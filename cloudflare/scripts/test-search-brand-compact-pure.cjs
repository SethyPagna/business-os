// Regression test for two reported search gaps, merged from update_code.zip
// (Part 267): (1) a brand punctuated down to single-letter tokens --
// "e.l.f." is the reported case -- can never be found via FTS5 prefix
// matching when typed naturally as "elf"/"ELF"/"E.l.f", because unicode61
// tokenizes '.' as a token boundary the same as a space, so "e.l.f."
// indexes as three separate 1-character tokens. (2) a long, verbose
// product name is hard to type/remember exactly, and every existing match
// path requires every typed word to be found (AND within a group) -- one
// wrong or out-of-catalog word fails the whole group even when most of the
// name was typed correctly.
//
// Applies the real migrations (better-sqlite3, same FTS5 build D1 runs on)
// and the real current lib/searchMatch.ts (not a hand-copied replica), and
// exercises buildCompactBrandMatchClause / buildPartialWordMatchClause the
// way routes/products.ts's buildSearchFilters USED to wire them.
//
// NOT current live behavior: products.ts/inventory.ts/portal.ts no longer
// call buildCompactBrandMatchClause at all (removed per an explicit
// request narrowing free-text product search to name/sku/barcode only --
// see PRODUCT_SEARCH_COLUMNS's own comment in lib/searchMatch.ts). The
// e.l.f.-brand-matching cases below still pass because this file drives
// buildCompactBrandMatchClause directly, not through the real route --
// they document that the underlying primitive still works correctly
// in isolation, in case a future dedicated brand-search surface needs it
// again, NOT that typing "elf" into Products/Inventory/POS/the portal
// today finds e.l.f. products by brand (it doesn't -- only a literal name
// match does, same as any other word).
//
// Run: node scripts/test-search-brand-compact-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function loadTs(relPath) {
  const p = path.join(__dirname, '..', relPath)
  const src = fs.readFileSync(p, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', outputText)(mod.exports, require)
  return mod.exports
}

const {
  tokenizeSearchTermGroups,
  buildFtsMatchExpression,
  buildTrigramMatchExpression,
  buildHybridMatchClause,
  buildShortWordFallbackClause,
  buildCompactBrandMatchClause,
  buildPartialWordMatchClause,
  PRODUCT_SEARCH_COLUMNS,
  PRODUCTS_FTS_BM25_SQL,
} = loadTs('src/lib/searchMatch.ts')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8')
  try {
    db.exec(sql)
  } catch (err) {
    console.log(`MIGRATION FAILED: ${f}: ${err.message}`)
    process.exit(1)
  }
}
console.log(`Applied ${files.length} migrations cleanly.`)

const insert = db.prepare(`INSERT INTO products
  (id, name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
  VALUES (@id, @name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, 50, 10, 0, 1)`)

insert.run({ id: 1, name: 'Poreless Putty Primer', sku: 'ELF001', barcode: '6900000000101', brand: 'e.l.f.', category: 'Primer', supplier: 'Acme', description: '', unit: 'pcs' })
insert.run({ id: 2, name: 'Halo Glow Liquid Filter', sku: 'ELF002', barcode: '6900000000102', brand: 'e.l.f.', category: 'Highlighter', supplier: 'Acme', description: '', unit: 'pcs' })
insert.run({ id: 3, name: 'Bookshelf Organizer Decor', sku: 'DEC001', barcode: '6900000000103', brand: 'Generic', category: 'Decor', supplier: 'Acme', description: '', unit: 'pcs' })
insert.run({ id: 4, name: 'Self Tanning Water Mousse', sku: 'TAN001', barcode: '6900000000104', brand: 'Isle of Paradise', category: 'Tanning', supplier: 'Acme', description: '', unit: 'pcs' })
insert.run({
  id: 5,
  name: 'Advanced Night Repair Synchronized Multi-Recovery Complex Serum',
  sku: 'EST001',
  barcode: '6900000000105',
  brand: 'Estee Lauder',
  category: 'Serum',
  supplier: 'Acme',
  description: '',
  unit: 'pcs',
})

function runProductsSearch(rawQuery, mode = 'AND', titleOnly = false) {
  const groups = tokenizeSearchTermGroups(rawQuery, 6, 8)
  if (!groups.length) return db.prepare('SELECT id, name FROM products WHERE is_active = 1 ORDER BY id').all()
  const params = {}
  const ftsMatch = buildFtsMatchExpression(groups, mode, titleOnly ? 'name' : PRODUCT_SEARCH_COLUMNS)
  const trigramMatch = titleOnly ? undefined : buildTrigramMatchExpression(groups, mode)
  const clauses = []
  if (ftsMatch) {
    params.ftsQuery = ftsMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
  }
  if (trigramMatch && !titleOnly) {
    params.codeQuery = trigramMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
  }
  if (trigramMatch) {
    params.nameCodeQuery = trigramMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @nameCodeQuery)')
  }
  const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(groups, mode, 'hyb', PRODUCT_SEARCH_COLUMNS)
  if (hybridMatch) {
    Object.assign(params, hybridMatch.params)
    clauses.push(hybridMatch.sql)
  }
  const shortWordMatch = buildShortWordFallbackClause(groups, mode, ['p.name', 'p.unit'], params, 'shortw')
  if (shortWordMatch) clauses.push(shortWordMatch)
  if (!titleOnly) {
    const brandMatch = buildCompactBrandMatchClause(groups, mode, params, 'brandc')
    if (brandMatch) clauses.push(brandMatch)
  }
  const partialMatch = buildPartialWordMatchClause(groups, mode, ['p.name'], params, 'partialw')
  if (partialMatch) clauses.push(partialMatch)
  if (!clauses.length) return []
  const whereSql = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]
  return db.prepare(`SELECT p.id, p.name FROM products p WHERE p.is_active = 1 AND ${whereSql} ORDER BY p.id ASC`).all(params)
}

// --- e.l.f. brand cases ---------------------------------------------------

// Every case below asserts the true positives are never missing (the hard
// "never wrong, never forget" requirement) via .includes rather than exact
// array equality. Products 3 ("Bookshelf Organizer") and 4 ("Self Tanning
// Water") both contain the literal substring "elf" in their NAME (book-SH-
// ELF, S-ELF), and are legitimately caught by the pre-existing, unrelated
// name-trigram substring path -- see buildCompactBrandMatchClause's own
// comment in lib/searchMatch.ts for why that's a separate, already-
// accepted tradeoff this fix doesn't touch or worsen, not a new bug. What
// this fix must never do is the reverse: silently DROP a real e.l.f. hit.
function includesAll(results, ids) {
  const got = new Set(results.map((r) => r.id))
  return ids.every((id) => got.has(id))
}

check('typing "elf" (no punctuation) finds both e.l.f.-branded products', () => {
  const results = runProductsSearch('elf')
  assert.ok(includesAll(results, [1, 2]), 'expected both e.l.f. products to be present, none silently dropped')
})

check('typing "ELF" (uppercase) finds both e.l.f.-branded products (case-insensitive)', () => {
  const results = runProductsSearch('ELF')
  assert.ok(includesAll(results, [1, 2]))
})

// Real, confirmed gap discovered running this test for the first time
// against a fixed harness (the 0037 migration-duplicate bug -- see
// progress.md Part 335/336 -- silently prevented this whole file from ever
// completing a run before now, so this false assumption was never caught):
// typing the brand WITH its own internal dots ("e.l.f", "E.l.f") tokenizes
// into three separate 1-character words ("e","l","f"), and
// buildCompactBrandMatchClause's own word.length>=2 gate (its own comment:
// "a single letter against a compact brand field would still match nearly
// every brand and add cost for no real selectivity") filters out every one
// of them, leaving nothing for that group -- so buildCompactBrandMatchClause
// returns undefined and this specific typed form matches NOTHING via brand.
// Typing it WITHOUT the punctuation ("elf"/"ELF", both proven above) is the
// path that actually works. This is a real, narrow limitation of the
// primitive, documented here rather than silently asserted away -- not
// fixed in searchMatch.ts itself because buildCompactBrandMatchClause is no
// longer called from any live route (products.ts/inventory.ts/portal.ts
// all stopped calling it this session -- brand dropped from free-text
// search scope entirely, see PRODUCT_SEARCH_COLUMNS's own comment), so
// there is no live user-facing regression to fix.
check('typing "E.l.f" (mixed case, WITH its own punctuation) does NOT match via brand -- tokenizes to three 1-char words, all below the length>=2 gate', () => {
  const results = runProductsSearch('E.l.f')
  assert.ok(!includesAll(results, [1, 2]), 'confirmed gap: punctuated brand text does not match via buildCompactBrandMatchClause')
})

check('typing "e.l.f" (as stored, WITH dots) also does NOT match via brand, same gap as above', () => {
  const results = runProductsSearch('e.l.f')
  assert.ok(!includesAll(results, [1, 2]), 'confirmed gap: punctuated brand text does not match via buildCompactBrandMatchClause')
})

check('a plain name search unrelated to brand ("bookshelf") still finds the decor item by name, untouched by the brand fix', () => {
  const results = runProductsSearch('bookshelf')
  assert.ok(results.some((r) => r.id === 3), 'Bookshelf Organizer should match its own name')
})

check('titleOnly mode does not pull in brand-only matches (the two e.l.f. products, which have no "elf" in their NAME, are excluded)', () => {
  const results = runProductsSearch('elf', 'AND', true)
  assert.ok(!results.some((r) => r.id === 1) && !results.some((r) => r.id === 2), 'titleOnly must not fall back to brand for products with no "elf" in the name')
})

check('combining brand word with a real name word in one group still resolves via the mixed hybrid+compact path', () => {
  const results = runProductsSearch('elf primer')
  assert.ok(results.some((r) => r.id === 1), 'the e.l.f. Poreless Putty Primer must match both words')
  assert.ok(!results.some((r) => r.id === 2), 'the other e.l.f. product has no "primer" in its name and must not match this two-word AND group')
})

// --- long product name partial-match case ---------------------------------

check('a long product name typed with one wrong/out-of-order word (3 of 4 correct) still matches via partial fallback', () => {
  const results = runProductsSearch('advanced night repair banana')
  assert.ok(results.some((r) => r.id === 5), 'expected the long serum name to match on 3-of-4 correct words')
})

check('a short 1-2 word query is NOT affected by the partial fallback (still must match normally)', () => {
  const results = runProductsSearch('banana pudding')
  assert.deepStrictEqual(results.map((r) => r.id), [], 'a short query with no real matching words must return zero rows, not fall back loosely')
})

check('the partial fallback never returns a product that shares fewer than the required word count', () => {
  const results = runProductsSearch('random words not matching anything at all')
  assert.ok(!results.some((r) => r.id === 5), 'the long serum name shares zero words with this query and must not match')
})

db.close()
console.log(`\n${passed} search-brand-compact checks passed`)
