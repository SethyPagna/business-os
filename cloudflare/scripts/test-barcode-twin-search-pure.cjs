// Pins the barcode half of the 2026-09-03 "Change stock picker ignores the
// scanned barcode" fix, against REAL migrations and the REAL current
// lib/searchMatch.ts (transpiled, not a hand-copied replica) using
// better-sqlite3 -- the same FTS5 build D1 runs.
//
// The production shape being reproduced: this catalog stores ~3000 barcodes
// twice -- once as a 14-character GTIN-14 with a leading zero
// ("03348901770569") and once as the bare EAN-13 a scanner emits
// ("3348901770569") -- on two separate product rows with the same name.
// products_fts uses unicode61 PREFIX matching, and a 13-digit query is not a
// prefix of the 14-digit token, so the zero-padded twin could only ever be
// reached incidentally, through the products_fts_code trigram table. Routes
// that consult fewer indexes (branches.ts's TransferModal picker consults no
// JS fallback at all) would simply lose it.
//
// What this asserts:
//   1. a 13-digit scan finds the exact row AND its zero-padded twin, and no
//      unrelated product;
//   2. it still works with the trigram table deliberately taken out of the
//      query -- i.e. the twin is found by the STATED rule, not by accident;
//   3. rows whose barcode IS the scanned code rank ahead of rows that merely
//      contain the digits as a substring;
//   4. a 6-digit fragment still substring-matches (trigram path unharmed);
//   5. the "0" placeholder 238 production rows share is never an identity;
//   6. source shape: all three catalog-search routes wire the shared helper
//      and accept the term under query/q/search.
//
// Run: node scripts/test-barcode-twin-search-pure.cjs

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
  buildExactBarcodeMatchClause,
  buildExactBarcodeRankSql,
  normalizeBarcodeKey,
  barcodeKeysMatch,
  searchTermBarcodeKey,
  MIN_REAL_BARCODE_LENGTH,
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

const row = (id, name, barcode, sku) => insert.run({
  id, name, barcode, sku: sku || null,
  brand: '', category: '', supplier: '', description: '', unit: 'pcs',
})

const SCANNED = '3348901770569'
const TWIN = '03348901770569'

// The exact rows from the reported production case.
row(7231, 'Dior Backstage Highlighter New 002', SCANNED)
row(1722, 'Dior Backstage Highlighter New 002', TWIN)
// A different product whose barcode merely CONTAINS the scanned digits --
// must be found by a fragment search but must never outrank the real hit.
row(4001, 'Contains The Digits Somewhere', `99${SCANNED}`)
// The product the broken picker showed instead of the scanned one.
row(1, 'Abercrombie Authantic 10ml', '085715166012')
// Neighbours sharing a 6-digit fragment, for the trigram case.
row(7216, 'Dior Backstage Blush New 015', '3348901770521')
row(1701, 'Dior Backstage Blush New 015', '03348901770521')
// The legacy placeholder 238 production rows share.
row(5001, 'Legacy Placeholder A', '0')
row(5002, 'Legacy Placeholder B', '0')

// Mirrors routes/products.ts's buildSearchFilters clause assembly for the
// search half. `withTrigram: false` removes the products_fts_code branch to
// prove the twin is matched by the explicit rule and not by that index.
function runProductsSearch(rawQuery, { withTrigram = true } = {}) {
  const groups = tokenizeSearchTermGroups(rawQuery, 6, 8)
  if (!groups.length) return db.prepare('SELECT id, name, barcode FROM products WHERE is_active = 1 ORDER BY id').all()
  const params = {}
  const clauses = []
  let rankSql = null

  const ftsMatch = buildFtsMatchExpression(groups, 'AND', PRODUCT_SEARCH_COLUMNS)
  if (ftsMatch) {
    params.ftsQuery = ftsMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
    rankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
  }
  const trigramMatch = withTrigram ? buildTrigramMatchExpression(groups, 'AND') : undefined
  if (trigramMatch) {
    params.codeQuery = trigramMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
    params.nameCodeQuery = trigramMatch
    clauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @nameCodeQuery)')
  }
  const exactBarcodeMatch = buildExactBarcodeMatchClause(rawQuery, params)
  if (exactBarcodeMatch) {
    clauses.push(exactBarcodeMatch)
    const barcodeRank = buildExactBarcodeRankSql()
    rankSql = rankSql ? `(${barcodeRank} + ${rankSql})` : barcodeRank
  }
  if (!clauses.length) return []
  const whereSql = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]
  const orderSql = rankSql ? `ORDER BY (${rankSql}) ASC, p.id ASC` : 'ORDER BY p.id ASC'
  return db.prepare(`
    SELECT p.id, p.name, p.barcode FROM products p
    WHERE p.is_active = 1 AND ${whereSql}
    ${orderSql}
  `).all(params)
}

const ids = (rows) => rows.map((r) => r.id)

check('a scanned EAN-13 finds the exact row and its zero-padded GTIN-14 twin', () => {
  const found = ids(runProductsSearch(SCANNED))
  assert.ok(found.includes(7231), 'the exact-barcode row must be found')
  assert.ok(found.includes(1722), 'the leading-zero twin must be found')
  assert.ok(!found.includes(1), 'the unrelated Abercrombie row must NOT be found -- the reported bug')
  assert.ok(!found.includes(7216) && !found.includes(1701), 'a different product must not be dragged in')
})

check('the twin is found by the stated rule, not by the trigram index', () => {
  const found = ids(runProductsSearch(SCANNED, { withTrigram: false }))
  assert.ok(found.includes(7231), 'exact row still found without trigram')
  assert.ok(
    found.includes(1722),
    'the zero-padded twin must still be found with products_fts_code out of the query -- '
    + 'this is what routes without a trigram/JS fallback (branches.ts) depend on',
  )
})

check('typing the 14-digit GTIN-14 finds the bare EAN-13 twin too', () => {
  const found = ids(runProductsSearch(TWIN))
  assert.ok(found.includes(1722) && found.includes(7231), 'the fold is symmetric end to end')
})

check('exact barcode hits rank ahead of substring-only hits', () => {
  const found = runProductsSearch(SCANNED)
  const identityRows = found.filter((r) => barcodeKeysMatch(r.barcode, SCANNED)).map((r) => r.id)
  const substringRow = found.findIndex((r) => r.id === 4001)
  assert.ok(identityRows.length === 2, 'both twins are barcode-identity hits')
  if (substringRow >= 0) {
    const lastIdentityIndex = Math.max(...identityRows.map((id) => found.findIndex((r) => r.id === id)))
    assert.ok(
      lastIdentityIndex < substringRow,
      'a row that merely contains the digits must sort after both identity rows',
    )
  }
})

check('a 6-digit barcode fragment still substring-matches (trigram path unharmed)', () => {
  const found = ids(runProductsSearch('901770'))
  assert.ok(found.includes(7216) && found.includes(1701), 'fragment finds the Blush twins')
  assert.ok(found.includes(7231) && found.includes(1722), 'fragment finds the Highlighter twins')
  assert.ok(!found.includes(1), 'fragment must not match an unrelated barcode')
})

check('the "0" placeholder is never a barcode identity', () => {
  assert.equal(normalizeBarcodeKey('0'), '', '"0" is not a real barcode')
  assert.equal(normalizeBarcodeKey('0000'), '', 'an all-zero code is not a real barcode')
  assert.equal(normalizeBarcodeKey('012'), '', `under ${MIN_REAL_BARCODE_LENGTH} chars is not a real barcode`)
  assert.ok(!barcodeKeysMatch('0', '0'), 'two placeholders are not the same product')
  const params = {}
  assert.equal(buildExactBarcodeMatchClause('0', params), undefined, 'no barcode clause is emitted for "0"')
  assert.deepEqual(params, {}, 'and no parameter is bound')
  // 238 production rows share "0". Typing "0" still reaches them through the
  // ordinary FTS prefix path (unchanged, and not this rule's business) -- but
  // the barcode-identity rule itself must contribute nothing, so those rows
  // are never ranked or matched as "the same barcode".
  assert.equal(
    buildExactBarcodeRankSql().includes('@barcodeKey'),
    true,
    'the rank expression is only ever valid alongside a bound barcode key',
  )
  const zeroParams = {}
  assert.equal(buildExactBarcodeMatchClause('0000', zeroParams), undefined, 'all-zero codes emit no clause')
  assert.deepEqual(zeroParams, {})
})

check('a multi-word query is not treated as a barcode lookup', () => {
  assert.equal(searchTermBarcodeKey(`dior ${SCANNED}`), '', 'two words stay an ordinary search')
  const params = {}
  assert.equal(buildExactBarcodeMatchClause(`dior ${SCANNED}`, params), undefined)
  assert.deepEqual(params, {})
})

// --- source shape -------------------------------------------------------

const routeSurfaces = [
  ['products.ts (Products / POS / StockAdjustModal / FastStockIn / Promotions / NewReturn)', 'src/routes/products.ts'],
  ['inventory.ts (Inventory page picker)', 'src/routes/inventory.ts'],
  ['branches.ts (TransferModal picker)', 'src/routes/branches.ts'],
]

check('every catalog-search route wires the shared barcode helper', () => {
  for (const [label, relPath] of routeSurfaces) {
    const source = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    assert.ok(
      source.includes('buildExactBarcodeMatchClause('),
      `${label} must call the shared exact-barcode clause builder`,
    )
    assert.ok(
      source.includes('buildExactBarcodeRankSql('),
      `${label} must rank exact barcode hits first`,
    )
  }
})

check('every catalog-search route accepts the term under query/q/search', () => {
  for (const [label, relPath] of routeSurfaces) {
    const source = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    assert.ok(
      /query\('?query'?\)?\s*\|\|[\s\S]{0,80}search/.test(source) || /query\.query \|\| query\.q \|\| query\.search/.test(source),
      `${label} must read the free-text term from query, q or search -- an unrecognized key `
      + 'used to return the whole unfiltered catalog with a 200',
    )
  }
})

check('/products/filters still strips every free-text alias from its facet query', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/products.ts'), 'utf8')
  assert.match(
    source,
    /const \{ query: _searchTerm, q: _searchTermAlt, search: _searchTermAlias, \.\.\.structuralQuery \} = query/,
    'facet metadata must stay scoped to structural filters, including the new `search` alias',
  )
})

console.log(`\nAll ${passed} checks passed.`)
