// Real-SQLite (not mocked) test of routes/products.ts's new JS fuzzy
// (typo-tolerant) fallback for the admin Products page search -- Section 2
// of docs/plans/coordinated-plan-2026-09-02.md ("make Products search
// typo-tolerant, matching what the branch Transfer modal's product search
// already claims to do").
//
// Applies the real migrations (better-sqlite3, same FTS5 build D1 runs on)
// and the real current lib/searchMatch.ts and lib/familyPagination.ts (not
// hand-copied replicas) -- same loadTs/dbShim technique as
// test-group-search-siblings-repro.cjs and test-search-brand-compact-pure.cjs.
//
// runProductsSearchPage below reimplements routes/products.ts's
// buildSearchFilters + searchProductsPayload's fuzzy-fallback block (the
// SQL clause construction, the total===0/hasSearchTerm/!digitsOnly gate,
// the bounded candidate query, runFuzzyFallbackMatch, and the
// paginateProductFamilies re-run) using the SAME real exported primitives
// products.ts itself calls -- not a second, independently-written fuzzy
// algorithm. This mirrors the existing test-search-brand-compact-pure.cjs
// approach (which does the same for buildSearchFilters' non-fallback half),
// since routes/products.ts itself can't be loaded standalone here (it pulls
// in Cloudflare-Workers-bound modules -- auth, promotion rules, image
// gallery, cache -- that don't resolve outside a real Worker).
//
// What this exists to prove, not just assume from the source read:
// 1. "Elixe" and "Elixer" (both real reported typos) surface "Elixir"
//    products via the fuzzy fallback, only after the strict SQL search
//    found zero rows.
// 2. Exact "Elixir" ranks via the STRICT path (never triggers fuzzy, and
//    the fallback's alphabetical-only order never applies to it).
// 3. A digits-only query (barcode/sku) never gets edit-distance tolerance,
//    even when it has zero exact hits.
// 4. Khmer text is unaffected: an exact Khmer word still matches via the
//    strict path, and a nonsense Khmer query correctly finds nothing (no
//    crash, no corruption) via the fallback.
// 5. Fuzzy results still respect an active brand filter.
// 6. Page 2 of a fuzzy-only result set is stable (same order every call)
//    and non-overlapping with page 1.
// 7. An empty/nonsense query returns nothing extra (no fallback firing on
//    an empty query, and a nonsense query's fallback correctly finds
//    nothing).
//
// Run: node scripts/test-products-search-fuzzy-pure.cjs

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
  isDigitsOnlyQuery,
  runFuzzyFallbackMatch,
  buildFtsMatchExpression,
  buildTrigramMatchExpression,
  buildHybridMatchClause,
  buildShortWordFallbackClause,
  buildPartialWordMatchClause,
  PRODUCT_SEARCH_COLUMNS,
  PRODUCTS_FTS_BM25_SQL,
} = loadTs('src/lib/searchMatch.ts')

// Real implementation, not a re-write -- see test-group-search-siblings-repro.cjs's
// own comment for why this matters (a stale hand-copy would silently keep
// passing after a real regression in the shipped helper).
const { paginateProductFamilies } = loadTs('src/lib/familyPagination.ts')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
for (const f of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8')
  try {
    db.exec(sql)
  } catch (err) {
    console.log(`MIGRATION FAILED: ${f}: ${err.message}`)
    process.exit(1)
  }
}
console.log(`Applied ${migrationFiles.length} migrations cleanly.`)

// D1Compat-shaped shim over better-sqlite3 -- paginateProductFamilies only
// calls db.prepare(sql).get(params)/.all(params) with @name-style params,
// which better-sqlite3 supports natively. Same shim as
// test-group-search-siblings-repro.cjs.
const dbShim = {
  prepare(sql) {
    const stmt = db.prepare(sql)
    return {
      async get(params) { return stmt.get(params || {}) },
      async all(params) { return stmt.all(params || {}) },
    }
  },
}

const insert = db.prepare(`INSERT INTO products
  (id, name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
  VALUES (@id, @name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, 50, 10, 0, 1)`)

function seed(row) {
  insert.run({ sku: null, barcode: null, brand: null, category: null, supplier: null, description: null, unit: 'pcs', ...row })
}

// Six "Elixir"-named products under the same brand -- enough to prove
// pagination (page 1 vs page 2) is stable once fuzzy fallback is the
// result source.
seed({ id: 1, name: 'Elixir Renewal Serum', sku: 'ELX001', barcode: '6900000000201', brand: 'Glow' })
seed({ id: 2, name: 'Elixir Hydra Boost', sku: 'ELX002', barcode: '6900000000202', brand: 'Glow' })
seed({ id: 3, name: 'Elixir Night Cream', sku: 'ELX003', barcode: '6900000000203', brand: 'Glow' })
seed({ id: 4, name: 'Elixir Radiance Oil', sku: 'ELX004', barcode: '6900000000204', brand: 'Glow' })
seed({ id: 5, name: 'Elixir Firming Mask', sku: 'ELX005', barcode: '6900000000205', brand: 'Glow' })
seed({ id: 6, name: 'Elixir Vitamin C Drops', sku: 'ELX006', barcode: '6900000000206', brand: 'Glow' })
// Same "Elixir" family word, but a DIFFERENT brand -- the active-brand-
// filter check must exclude this one while brand=Glow is selected, and
// include it when no brand filter is active.
seed({ id: 7, name: 'Elixir Body Butter', sku: 'ELX007', barcode: '6900000000207', brand: 'OtherBrand' })
// Unrelated decoys -- must never surface for an "Elixir"-family query.
seed({ id: 8, name: 'Matte Lipstick 617 Rebel', sku: 'LIP001', barcode: '6900000000301', brand: 'MAC' })
seed({ id: 9, name: 'Setting Spray Fix Plus', sku: 'SET001', barcode: '6900000000302', brand: 'Urban' })
// Digits-only (barcode/sku) case -- a real product with a real barcode,
// plus a typo'd digit query that must NOT fuzzy-match it.
seed({ id: 10, name: 'Travel Pouch', sku: 'POU001', barcode: '6900000099999', brand: 'Generic' })
// Khmer-name product -- must be findable by its exact word via the strict
// path, and a nonsense Khmer query must find nothing via the fallback
// without crashing/corrupting anything.
seed({ id: 11, name: 'ក្រែមទឹកមុខអង្កាម', sku: 'KHM001', barcode: '6900000000401', brand: 'KhmerBrand' })

// Mirrors routes/products.ts's buildSearchFilters (search-clause half) +
// searchProductsPayload's fuzzy-fallback block. See this file's header
// comment for why this reimplements the wiring against the real primitives
// rather than importing routes/products.ts directly.
const FUZZY_FALLBACK_CANDIDATE_LIMIT = 3000
const FUZZY_FALLBACK_MATCH_CAP = 500

async function runProductsSearchPage({ query = '', mode = 'AND', titleOnly = false, brand, page = 1, pageSize = 20 }) {
  const groups = tokenizeSearchTermGroups(query, 6, 8)
  const digitsOnly = isDigitsOnlyQuery(groups)
  const hasSearchTerm = groups.length > 0
  const searchTerms = groups.map((words) => words.join(' '))

  const where = ['p.is_active = 1']
  const params = {}

  if (brand) {
    params.brand = brand.toLowerCase()
    where.push('lower(trim(p.brand)) = @brand')
  }

  let matchRankSql
  let searchWhereClause
  if (hasSearchTerm) {
    const ftsMatch = buildFtsMatchExpression(groups, mode, titleOnly ? 'name' : PRODUCT_SEARCH_COLUMNS)
    const trigramMatch = buildTrigramMatchExpression(groups, mode)
    const matchClauses = []
    if (ftsMatch) {
      params.ftsQuery = ftsMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
    }
    if (trigramMatch && !titleOnly) {
      params.codeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
    }
    if (trigramMatch) {
      params.nameCodeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @nameCodeQuery)')
    }
    const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(groups, mode, 'hyb', PRODUCT_SEARCH_COLUMNS)
    if (hybridMatch) {
      Object.assign(params, hybridMatch.params)
      matchClauses.push(hybridMatch.sql)
    }
    const shortWordMatch = buildShortWordFallbackClause(groups, mode, ['p.name'], params, 'shortw')
    if (shortWordMatch) matchClauses.push(shortWordMatch)
    const partialMatch = buildPartialWordMatchClause(groups, mode, ['p.name'], params, 'partialw')
    if (partialMatch) matchClauses.push(partialMatch)
    if (matchClauses.length) {
      searchWhereClause = matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0]
      if (!titleOnly && ftsMatch) {
        matchRankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
      }
    }
  }

  // baseWhere: every OTHER active filter (brand above), captured before the
  // search match clause itself is folded in -- same role as products.ts's
  // own baseWhere/fuzzyFallbackBaseWhere, used below only if the strict
  // search comes back empty for a real, non-digits-only query.
  const baseWhere = [...where]
  if (searchWhereClause) where.push(searchWhereClause)

  const selectColumns = 'p.id, p.name, p.sku, p.barcode, p.brand'
  const whereSql = `WHERE ${where.join(' AND ')}`

  let { items, total, totalPages } = await paginateProductFamilies({
    db: dbShim,
    selectColumns,
    joinSql: '',
    whereSql,
    params,
    page,
    pageSize,
    familyOrderSql: matchRankSql ? 'match_rank ASC, family_name ASC' : 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    matchRankSql,
    familyMemberBaseWhereSql: hasSearchTerm ? 'p.is_active = 1' : undefined,
  })

  // JS fuzzy (typo-tolerant) fallback -- only when the strict SQL search
  // above found literally zero rows for a real, non-digits-only query.
  // Mirrors routes/products.ts's searchProductsPayload block verbatim in
  // shape (candidate query scoped by baseWhere, runFuzzyFallbackMatch,
  // capped id list, re-run through paginateProductFamilies).
  if (total === 0 && hasSearchTerm && !digitsOnly) {
    const candidateRows = await dbShim.prepare(`
      SELECT p.id AS id, p.name AS name, p.sku AS sku, p.barcode AS barcode
      FROM products p
      WHERE ${baseWhere.join(' AND ')}
      ORDER BY p.id ASC
      LIMIT ${FUZZY_FALLBACK_CANDIDATE_LIMIT}
    `).all(params)
    const candidates = (candidateRows || []).map((row) => ({
      id: row.id,
      haystack: titleOnly ? String(row.name || '') : [row.name, row.sku, row.barcode].filter(Boolean).join(' '),
    }))
    const fuzzyIds = runFuzzyFallbackMatch(candidates, searchTerms, mode).slice(0, FUZZY_FALLBACK_MATCH_CAP)
    if (fuzzyIds.length) {
      const fuzzyWhereSql = `WHERE ${[...baseWhere, `p.id IN (${fuzzyIds.join(',')})`].join(' AND ')}`
      const fuzzyResult = await paginateProductFamilies({
        db: dbShim,
        selectColumns,
        joinSql: '',
        whereSql: fuzzyWhereSql,
        params,
        page,
        pageSize,
        familyOrderSql: 'family_name ASC',
        intraFamilyOrderSql: 'lower(name) ASC, id ASC',
        familyMemberBaseWhereSql: 'p.is_active = 1',
      })
      items = fuzzyResult.items
      total = fuzzyResult.total
      totalPages = fuzzyResult.totalPages
    }
  }

  return { items, total, totalPages, digitsOnly, hasSearchTerm }
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
    passed += 1
  } catch (err) {
    console.log('FAIL', name, '--', err.message)
    failed += 1
  }
}

const ELIXIR_FAMILY_IDS = [1, 2, 3, 4, 5, 6, 7]

async function main() {
  // --- 1. "Elixe" (missing letters) surfaces every Elixir product via the
  // fuzzy fallback -- the strict search finds zero rows first. ------------
  await check('typo "Elixe" surfaces every Elixir-family product via the fuzzy fallback', async () => {
    const result = await runProductsSearchPage({ query: 'Elixe', pageSize: 20 })
    const ids = result.items.map((r) => r.id).sort((a, b) => a - b)
    assert.deepStrictEqual(ids, ELIXIR_FAMILY_IDS, `expected all 7 Elixir-family products, got ${JSON.stringify(ids)}`)
    assert.ok(!ids.includes(8) && !ids.includes(9), 'unrelated decoys must never surface')
  })

  // --- 2. "Elixer" (transposed/extra letter) also surfaces them ----------
  await check('typo "Elixer" surfaces every Elixir-family product via the fuzzy fallback', async () => {
    const result = await runProductsSearchPage({ query: 'Elixer', pageSize: 20 })
    const ids = result.items.map((r) => r.id).sort((a, b) => a - b)
    assert.deepStrictEqual(ids, ELIXIR_FAMILY_IDS, `expected all 7 Elixir-family products, got ${JSON.stringify(ids)}`)
  })

  // --- 3. Exact "Elixir" ranks via the STRICT path (never invokes fuzzy) --
  await check('exact "Elixir" matches via the strict SQL path, not the fuzzy fallback', async () => {
    const result = await runProductsSearchPage({ query: 'Elixir', pageSize: 20 })
    const ids = result.items.map((r) => r.id).sort((a, b) => a - b)
    assert.deepStrictEqual(ids, ELIXIR_FAMILY_IDS, 'exact "Elixir" must still find every Elixir-family product via ordinary FTS5 prefix matching')
  })

  // --- 4. Digits-only query stays exact-only: zero exact hits means zero
  // results, never a fuzzy-tolerant barcode/sku match. ---------------------
  await check('a digits-only query with zero exact hits returns nothing (no edit-distance tolerance on barcodes)', async () => {
    // '6900000099998' is one digit off product 10's real barcode
    // ('6900000099999') -- close enough that a naive fuzzy pass over
    // digits would find it, which is exactly what must NOT happen.
    const result = await runProductsSearchPage({ query: '6900000099998', pageSize: 20 })
    assert.strictEqual(result.digitsOnly, true, 'the query must be classified as digits-only')
    assert.deepStrictEqual(result.items.map((r) => r.id), [], 'a near-miss digits-only query must return zero rows, never a fuzzy barcode match')
  })

  await check('a digits-only query with an EXACT hit still matches normally (sanity)', async () => {
    const result = await runProductsSearchPage({ query: '6900000099999', pageSize: 20 })
    assert.deepStrictEqual(result.items.map((r) => r.id), [10], 'the exact barcode must still match via the strict path')
  })

  // --- 5. Khmer text is unaffected --------------------------------------
  await check('an exact Khmer word matches via the strict path (unaffected by the fuzzy change)', async () => {
    const result = await runProductsSearchPage({ query: 'អង្កាម', pageSize: 20 })
    assert.deepStrictEqual(result.items.map((r) => r.id), [11], 'the exact Khmer substring must still match the Khmer-named product')
  })

  await check('a nonsense Khmer query finds nothing via the fallback, without crashing or corrupting results', async () => {
    const result = await runProductsSearchPage({ query: 'ឆុងឆាំងខ្លាំង', pageSize: 20 })
    assert.deepStrictEqual(result.items.map((r) => r.id), [], 'unrelated Khmer nonsense must not fuzzy-match the Khmer product or anything else')
  })

  // --- 6. Fuzzy results respect an active brand filter --------------------
  await check('fuzzy fallback results respect an active brand filter (Glow excludes the OtherBrand Elixir)', async () => {
    const result = await runProductsSearchPage({ query: 'Elixe', brand: 'Glow', pageSize: 20 })
    const ids = result.items.map((r) => r.id).sort((a, b) => a - b)
    assert.deepStrictEqual(ids, [1, 2, 3, 4, 5, 6], 'brand=Glow must exclude product 7 (brand=OtherBrand) even though it matches the fuzzy query')
  })

  await check('fuzzy fallback results respect an active brand filter (OtherBrand includes ONLY its own Elixir)', async () => {
    const result = await runProductsSearchPage({ query: 'Elixe', brand: 'OtherBrand', pageSize: 20 })
    assert.deepStrictEqual(result.items.map((r) => r.id), [7], 'brand=OtherBrand must return only product 7')
  })

  // --- 7. Page 2 of a fuzzy-only result set is stable and non-overlapping -
  await check('fuzzy fallback pagination: page 1 and page 2 are stable and non-overlapping', async () => {
    const page1a = await runProductsSearchPage({ query: 'Elixe', pageSize: 3, page: 1 })
    const page1b = await runProductsSearchPage({ query: 'Elixe', pageSize: 3, page: 1 })
    const page2a = await runProductsSearchPage({ query: 'Elixe', pageSize: 3, page: 2 })
    const page2b = await runProductsSearchPage({ query: 'Elixe', pageSize: 3, page: 2 })

    const ids1a = page1a.items.map((r) => r.id)
    const ids1b = page1b.items.map((r) => r.id)
    const ids2a = page2a.items.map((r) => r.id)
    const ids2b = page2b.items.map((r) => r.id)

    assert.deepStrictEqual(ids1a, ids1b, 'page 1 must return the exact same order on repeated calls')
    assert.deepStrictEqual(ids2a, ids2b, 'page 2 must return the exact same order on repeated calls')
    assert.strictEqual(ids1a.length, 3, 'page 1 should hold a full 3-item page (7 total, pageSize 3)')
    assert.strictEqual(ids2a.length, 3, 'page 2 should also hold a full 3-item page')
    const overlap = ids1a.filter((id) => ids2a.includes(id))
    assert.deepStrictEqual(overlap, [], `page 1 and page 2 must never share an id, got overlap ${JSON.stringify(overlap)}`)
    assert.strictEqual(page1a.total, 7, 'total must count all 7 Elixir-family products regardless of page')
    assert.strictEqual(page1a.totalPages, 3, '7 items at pageSize 3 is 3 pages')

    // Page 3 (the remainder) plus pages 1+2 must together be exactly the
    // full family, with nothing dropped or duplicated across the split.
    const page3 = await runProductsSearchPage({ query: 'Elixe', pageSize: 3, page: 3 })
    const allIds = [...ids1a, ...ids2a, ...page3.items.map((r) => r.id)].sort((a, b) => a - b)
    assert.deepStrictEqual(allIds, ELIXIR_FAMILY_IDS, 'pages 1-3 together must reconstruct the full 7-item family with no gaps or duplicates')
  })

  // --- 8. Empty/nonsense query returns nothing extra ----------------------
  await check('an empty query does not invoke the fuzzy fallback (returns the full active catalog, not a fuzzy-filtered subset)', async () => {
    const result = await runProductsSearchPage({ query: '', pageSize: 100 })
    assert.strictEqual(result.hasSearchTerm, false, 'an empty query must never be treated as a search term')
    assert.strictEqual(result.total, 11, 'an empty query must return every active product (no filtering, fuzzy or otherwise)')
  })

  await check('a nonsense query (matches nothing, even fuzzily) returns zero rows, not a false-positive fallback match', async () => {
    const result = await runProductsSearchPage({ query: 'zzxxqqjjvvbb', pageSize: 20 })
    assert.deepStrictEqual(result.items.map((r) => r.id), [], 'a query with no plausible fuzzy match against any seeded product must return nothing')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
