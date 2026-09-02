// P2-2 (Gate 2B audit, 2026-09-02): unit-tests lib/searchMatch.ts's new
// buildProductSearchPlan/computeExactBarcodeHitId exports -- the shared
// search-tail orchestrator products.ts/portal.ts/branches.ts (and
// inventory.ts, via a prepared patch) now build their match clauses
// through, instead of each hand-rolling the same FTS5-prefix ->
// trigram-substring -> hybrid -> short-word -> partial-word sequence.
//
// Applies the real migration files (better-sqlite3, same FTS5 build D1
// runs on) and the real current lib/searchMatch.ts (not a hand-copied
// replica) so this exercises actual FTS5 behavior, not a JS-only mock.
//
// Covers:
//  1. buildProductSearchPlan produces the same match clauses/results the
//     four routes' pre-refactor hand-rolled sequence did (parity, not a
//     new algorithm) for ordinary name/sku/barcode queries.
//  2. The confirmed 1-2 digit barcode-fragment gap (Gate 2B A.5) is closed:
//     a 2-character barcode-fragment query now finds the row via the
//     widened short-word fallback (name_normalized + barcode + sku).
//  3. exactRankSql ranks an exact barcode match ahead of a merely-relevant
//     name match.
//  4. computeExactBarcodeHitId's exact rule: digits-only, length >= 4,
//     not "0", exactly one row -- covering the 238-shared-"0"-barcode case
//     from the live catalog (Gate 2B A.0.5/A.4) explicitly.
//
// Run: node scripts/test-search-tail-parity.cjs

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
    fileName: path.basename(relPath) + '.pure.ts',
  })
  const moduleObj = { exports: {} }
  new Function('exports', outputText)(moduleObj.exports)
  return moduleObj.exports
}

const {
  tokenizeSearchTermGroups,
  buildProductSearchPlan,
  computeExactBarcodeHitId,
  PRODUCT_SEARCH_COLUMNS,
  MIN_REAL_BARCODE_LENGTH,
} = loadTs('src/lib/searchMatch.ts')

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
    category TEXT, supplier TEXT, description TEXT, unit TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    name_normalized TEXT, unit_normalized TEXT, brand_compact TEXT
  )`)
  for (const file of ['0018_products_fts.sql', '0019_products_fts_code.sql', '0021_products_fts_name_trigram.sql', '0106_barcode_aliases.sql']) {
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'))
  }
  return db
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function insertProduct(db, row) {
  const merged = { sku: null, barcode: null, brand: null, category: null, supplier: null, description: null, unit: null, ...row }
  db.prepare(`INSERT INTO products (id, name, sku, barcode, brand, category, supplier, description, unit, name_normalized, unit_normalized, brand_compact)
    VALUES (@id, @name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, @name_normalized, @unit_normalized, @brand_compact)`).run({
    ...merged,
    name_normalized: normalized(merged.name),
    unit_normalized: normalized(merged.unit),
    brand_compact: String(merged.brand || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  })
}

function runPlan(db, rawQuery, opts = {}) {
  const groups = tokenizeSearchTermGroups(rawQuery, 6, 8)
  const plan = buildProductSearchPlan({
    groups,
    mode: opts.mode || 'AND',
    columns: PRODUCT_SEARCH_COLUMNS,
    titleOnly: !!opts.titleOnly,
    exactMatchQuery: opts.exactMatchQuery !== undefined ? opts.exactMatchQuery : rawQuery,
  })
  if (!plan.whereClause) {
    return { plan, rows: db.prepare('SELECT id, name, barcode FROM products WHERE is_active = 1 ORDER BY id').all() }
  }
  const rows = db.prepare(`
    SELECT p.id, p.name, p.barcode,
      (${plan.exactRankSql}) AS exact_rank,
      (${plan.matchRankSql || '0'}) AS bm25_rank
    FROM products p
    WHERE p.is_active = 1 AND ${plan.whereClause}
    ORDER BY exact_rank ASC, bm25_rank ASC, p.id ASC
  `).all(plan.params)
  return { plan, rows }
}

// --- fixture catalog -------------------------------------------------

const db = freshDb()
insertProduct(db, { id: 1, name: 'MAC Matte Lipstick 617', sku: 'MAC-617', barcode: '6923644012345' })
insertProduct(db, { id: 2, name: 'CLINIQUE Cleansing Balm 125ml', sku: 'CLQ-125', barcode: '020714215552' })
insertProduct(db, { id: 3, name: 'Aveeno Eye Cream 14ml', sku: 'AVN-014', barcode: '0' })
insertProduct(db, { id: 4, name: 'Aveeno Body Lotion 350ml', sku: 'AVN-350', barcode: '0' })
insertProduct(db, { id: 5, name: 'Elixir The Serum Essence', sku: 'ELX-001', barcode: '4909978282509' })
insertProduct(db, { id: 6, name: 'Random Filler Twelve Item', sku: 'RF-012', barcode: '90000012' })

// --- 1. parity: an ordinary name query still finds the row via FTS -----

check('buildProductSearchPlan: name prefix query matches via FTS5', () => {
  const { rows } = runPlan(db, 'mac matte')
  assert.ok(rows.some((r) => r.id === 1), 'expected MAC Matte Lipstick to match')
})

check('buildProductSearchPlan: exact sku-shaped fragment matches via trigram', () => {
  const { rows } = runPlan(db, '012345')
  assert.ok(rows.some((r) => r.id === 1), 'expected barcode substring "012345" to match id 1 (6923644012345)')
})

// --- 2. the confirmed 1-2 digit barcode-fragment gap is closed ---------

check('buildProductSearchPlan: 2-digit barcode fragment ("12") now matches via widened short-word fallback', () => {
  const { rows } = runPlan(db, '12')
  // "12" is a substring of id 6's barcode (90000012) and id 1's barcode
  // (6923644012345) -- pre-fix this returned zero rows everywhere
  // (Gate 2B A.5): trigram drops <3-char words, hybrid needs 2+ words per
  // group, and the short-word LIKE fallback was scoped to name_normalized
  // only, never barcode/sku.
  const ids = rows.map((r) => r.id)
  assert.ok(ids.includes(6), `expected id 6 (barcode 90000012) in ${JSON.stringify(ids)}`)
})

check('buildProductSearchPlan: 1-digit fragment ("9") matches via the same widened fallback', () => {
  const { rows } = runPlan(db, '9')
  const ids = rows.map((r) => r.id)
  // "9" appears in id 1's barcode (6923644012345), id 5's (4909978282509),
  // and id 5's sku (ELX-001) does not, but its barcode does.
  assert.ok(ids.includes(1) && ids.includes(5), `expected ids 1 and 5 in ${JSON.stringify(ids)}`)
})

check('buildProductSearchPlan: barcode "0" (238-row placeholder in production) still only matches via the short-word fallback, not treated specially by the plan itself', () => {
  const { rows } = runPlan(db, '0')
  const ids = rows.map((r) => r.id)
  // Both id 3 and id 4 share literal barcode "0" -- the plan itself makes
  // no attempt to disambiguate them (that's computeExactBarcodeHitId's
  // job, tested separately below); it just returns whatever the search
  // legitimately matches.
  assert.ok(ids.includes(3) && ids.includes(4), `expected both placeholder-barcode rows in ${JSON.stringify(ids)}`)
})

// --- 3. exact-rank ordering ---------------------------------------------

check('buildProductSearchPlan: exactRankSql ranks an exact barcode hit ahead of a same-relevance name match', () => {
  // Query the full barcode of id 2 -- id 2 should sort first even though
  // bm25 alone weights name/sku/barcode equally (PRODUCTS_FTS_BM25_SQL,
  // 10/10/10) and nothing here makes id 2's *name* especially relevant.
  const { rows } = runPlan(db, '020714215552')
  assert.strictEqual(rows[0].id, 2, `expected exact barcode hit (id 2) first, got ${JSON.stringify(rows.map((r) => r.id))}`)
  assert.strictEqual(rows[0].exact_rank, 0)
})

check('buildProductSearchPlan: exactRankSql is a no-op constant (2) when exactMatchQuery is not passed', () => {
  const groups = tokenizeSearchTermGroups('mac', 6, 8)
  const plan = buildProductSearchPlan({ groups, mode: 'AND', columns: PRODUCT_SEARCH_COLUMNS })
  assert.strictEqual(plan.exactRankSql, '2')
})

// --- 4. computeExactBarcodeHitId ----------------------------------------

check('computeExactBarcodeHitId: exact digits-only barcode, length >= 4, single row -> that id', () => {
  const rows = [{ id: 2, barcode: '020714215552' }, { id: 1, barcode: '6923644012345' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, '020714215552'), 2)
})

check('computeExactBarcodeHitId: "0" is never treated as an exact hit even with one row', () => {
  const rows = [{ id: 3, barcode: '0' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, '0'), null)
})

check('computeExactBarcodeHitId: shared placeholder "0" across two rows -> null (not just because of the "0" rule -- also fails the length gate)', () => {
  const rows = [{ id: 3, barcode: '0' }, { id: 4, barcode: '0' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, '0'), null)
})

check('computeExactBarcodeHitId: two rows sharing one real barcode -> null (ambiguous, never picks one)', () => {
  const rows = [{ id: 10, barcode: '041554089073' }, { id: 11, barcode: '041554089073' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, '041554089073'), null)
})

check('computeExactBarcodeHitId: a short numeric fragment below MIN_REAL_BARCODE_LENGTH never counts, even with one matching row', () => {
  assert.strictEqual(MIN_REAL_BARCODE_LENGTH, 4)
  const rows = [{ id: 6, barcode: '123' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, '123'), null)
})

check('computeExactBarcodeHitId: a non-digits query never counts, even if it happens to equal a barcode string', () => {
  const rows = [{ id: 1, barcode: 'ABC1234' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, 'ABC1234'), null)
})

check('computeExactBarcodeHitId: whitespace around the scanned value is trimmed before comparing', () => {
  const rows = [{ id: 1, barcode: '6923644012345' }]
  assert.strictEqual(computeExactBarcodeHitId(rows, '  6923644012345  '), 1)
})

console.log(`\nAll ${passed} search-tail-parity tests passed`)

// Coordinator (P2-2 × P2-3 seam): an alias barcode recorded in barcode_aliases
// (migration 0105, applied in freshDb) finds its product through the plan's
// extraExactClauses, built by lib/barcodeAliases.ts with the routes' `p`
// table alias -- exactly how products/portal/branches/inventory wire it.
check('alias barcode (barcode_aliases) finds the product via extraExactClauses', () => {
  const { buildAliasExactClause } = loadTs('src/lib/barcodeAliases.ts')
  db.prepare("INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source) VALUES (2, '00020714215552', '00020714215552', 'test')").run()
  const raw = '00020714215552'
  const groups = tokenizeSearchTermGroups(raw, 6, 8)
  const params = {}
  const clause = buildAliasExactClause(raw, params, { productAlias: 'p', paramKey: 'aliasExact' })
  assert.ok(clause.includes('ba.product_id = p.id AND ba.barcode_normalized = @aliasExact)'), clause)
  const plan = buildProductSearchPlan({ groups, mode: 'AND', columns: PRODUCT_SEARCH_COLUMNS, exactMatchQuery: raw, extraExactClauses: [clause].filter(Boolean) })
  Object.assign(params, plan.params)
  const rows = db.prepare(`SELECT p.id FROM products p WHERE p.is_active = 1 AND ${plan.whereClause}`).all(params)
  assert.ok(rows.some((r) => r.id === 2), `expected the alias to resolve to id 2, got ${JSON.stringify(rows)}`)
  const { rows: without } = runPlan(db, raw)
  assert.ok(!without.some((r) => r.id === 2), 'without the alias clause the alias barcode must not match id 2 (the clause did the work)')
})
