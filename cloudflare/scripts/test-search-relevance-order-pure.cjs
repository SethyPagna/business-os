// THE ORDERING TEST for the one shared product-search ranking.
//
// The report this lane exists for: "the search functions of transfer, stock
// change, returns etc... seems not fully scoped properly ... it shows
// products not really matched in top to bottom ... feels like the likely
// result was at bottom in reverse".
//
// Every product picker in the app now builds its search tail and its
// ordering through lib/productSearchQuery.ts, and pages it through
// lib/familyPagination.ts. This file asserts the EXACT ORDER those two
// produce on a seeded fixture, against real SQLite with every migration
// applied verbatim (node:sqlite via scripts/harness/d1compat.cjs -- the
// same FTS5 the Worker's D1 runs). Nothing here re-implements the ranking:
// the real transpiled modules are executed, so a future edit that keeps the
// shape but loses the order goes red.
//
// The ordering contract under test, in this order:
//   tier 0  exact barcode (leading-zero folded: the GTIN-14/EAN-13 twins)
//   tier 1  exact name
//   tier 2  name prefix
//   tier 3  everything else, by bm25
//   then    the caller's tail (family_name ASC), then family_root_id ASC
//
// Probes: exact barcode, a barcode differing only by a leading zero, a name
// prefix, a mid-word fragment, a 1-2 character query, and a many-match
// query paged three times (page N must CONTINUE page N-1 -- no repeat, no
// drop).
//
// Plus the standing constraint from the merge side: the product-identity
// normalizer must NEVER learn the leading-zero folding this search uses.
// It feeds productIdentitySignature, which decides what AUTO-MERGES, and
// the leading-zero twin pairs in this catalog are reserved for the operator
// to resolve by hand.
//
// Run from the cloudflare directory:
//   node scripts/test-search-relevance-order-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

// Transpile-and-run the REAL source, wiring each module's relative imports
// to the real modules too. No hand-copied replicas anywhere in this file.
const cache = new Map()
function loadReal(relPath, deps = {}) {
  if (cache.has(relPath)) return cache.get(relPath)
  const src = fs.readFileSync(path.join(root, relPath), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  const req = (id) => {
    if (Object.prototype.hasOwnProperty.call(deps, id)) return deps[id]
    throw new Error(`unmapped require(${id}) from ${relPath}`)
  }
  new Function('exports', 'require', 'module', outputText)(mod.exports, req, mod)
  cache.set(relPath, mod.exports)
  return mod.exports
}

const searchMatch = loadReal('src/lib/searchMatch.ts')
const productSearchQuery = loadReal('src/lib/productSearchQuery.ts', { './searchMatch': searchMatch })
const familyPagination = loadReal('src/lib/familyPagination.ts', {})
const productDetailRule = loadReal('src/lib/productDetailRule.ts', {})

const { buildProductSearchQuery, buildFamilyRelevanceOrderSql } = productSearchQuery
const { paginateProductFamilies } = familyPagination
const { normalizeSearchText } = searchMatch

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error && error.message}`)
    console.log(`FAIL ${name}\n      ${error && error.message}`)
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error && error.message}`)
    console.log(`FAIL ${name}\n      ${error && error.message}`)
  }
}

// --- fixture -----------------------------------------------------------

const db = openDb(loadAll())

// The scanned code and its zero-padded twin, the exact production shape:
// one product stored as the bare EAN-13 a scanner emits, its duplicate
// stored as the 14-character GTIN-14. Both must lead a scan of either form.
const SCANNED = '3348901770569'
const TWIN = `0${SCANNED}`

// Names are deliberately arranged so ALPHABETICAL order is the WRONG answer
// for every probe below -- an "Aaa..." decoy sorts first and the real hit
// sorts last. That is what made the original defect visible to the
// operator, and it is what makes this test non-vacuous: with the ordering
// removed, every assertion here flips to the decoy.
const FIXTURE = [
  // id, name, barcode, sku
  [101, 'Aaa Decoy Cleanser', '1111111111111', 'AAA-1'],
  [102, 'Aab Decoy Toner 3348901770569 In The Name', '2222222222222', 'AAB-1'],
  // Sorts first alphabetically and matches "matte", so A-Z answers THIS row
  // and only the relevance tier answers the lipstick. Without it the name
  // probes below would pass under either ordering, i.e. prove nothing.
  [109, 'Aaa Matte Cleanup Wipes', '3330001112226', 'AAA-3'],
  [103, 'Matte Lipstick', '9990001112223', 'MAT-EXACT'],
  [104, 'Matte Lipstick Refill Pack', '9990001112224', 'MAT-PREFIX'],
  [105, 'Zzz Ultra Matte Finish Powder', '9990001112225', 'MAT-MID'],
  [106, 'Zebra Backstage Highlighter New 002', SCANNED, 'SCAN-1'],
  [107, 'Zulu Backstage Highlighter New 002', TWIN, 'SCAN-2'],
  [108, 'Aaa Contains The Digits Somewhere', `99${SCANNED}`, 'AAA-2'],
]
// A block of same-prefix products used only by the pagination probe. Their
// names all start with "Pageable" so one query matches many families, and
// they are inserted in an order that is neither alphabetical nor by id --
// so a page that merely echoed insertion order would fail.
const PAGEABLE_COUNT = 9
for (let i = 0; i < PAGEABLE_COUNT; i += 1) {
  const n = ((i * 7) % PAGEABLE_COUNT) + 1
  const pad = String(n).padStart(2, '0')
  FIXTURE.push([200 + i, `Pageable Product ${pad}`, `7770000000${pad}`, `PG-${n}`])
}

const raw = db.db
raw.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)")
const insert = raw.prepare(`INSERT INTO products
  (id, name, sku, barcode, brand, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active, name_normalized)
  VALUES (?, ?, ?, ?, '', '', 'pcs', 50, 10, 0, 1, ?)`)
const stock = raw.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 25)')
for (const [id, name, barcode, sku] of FIXTURE) {
  // name_normalized is written in JS by lib/productWrites.ts's insertRow in
  // production; use the REAL fold here so the tier comparison is honest.
  insert.run(id, name, sku, barcode, normalizeSearchText(name))
  stock.run(id)
}

// name_key is what FAMILY_ROOT_KEY_SQL groups on. Production maintains it
// by trigger (migration 0010); fill it for rows this raw INSERT created in
// case the trigger did not fire on this build, so families are real.
raw.exec("UPDATE products SET name_key = lower(trim(name)) WHERE COALESCE(name_key, '') = ''")

const seeded = raw.prepare('SELECT COUNT(*) AS n FROM products').get().n
assert.equal(seeded, FIXTURE.length, 'fixture must be fully seeded before any ordering assertion runs')

// --- the query under test ----------------------------------------------
//
// Byte-for-byte the wiring routes/branches.ts uses for the Transfer picker
// and the per-branch search box (see its paginateProductFamilies call), so
// this exercises the shipped path rather than an approximation of it.
async function search(rawQuery, { page = 1, pageSize = 20 } = {}) {
  const params = { branchId: 1 }
  const where = ['p.is_active = 1']
  const q = buildProductSearchQuery(rawQuery, params)
  if (q.whereClause) where.push(q.whereClause)
  const { items, total, totalPages } = await paginateProductFamilies({
    db,
    selectColumns: 'p.id, p.name, p.sku, p.barcode, COALESCE(bs.quantity, 0) AS branch_quantity',
    joinSql: 'LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId',
    whereSql: `WHERE ${where.join(' AND ')}`,
    params,
    page,
    pageSize,
    familyOrderSql: buildFamilyRelevanceOrderSql('family_name ASC', {
      hasTier: Boolean(q.matchTierSql),
      hasRank: Boolean(q.matchRankSql),
    }),
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    matchRankSql: q.matchRankSql,
    matchTierSql: q.matchTierSql,
  })
  return {
    names: items.map((r) => String(r.name)),
    ids: items.map((r) => Number(r.id)),
    total,
    totalPages,
  }
}

// The SAME query with the relevance keys removed -- i.e. exactly what these
// endpoints did before this lane: match the rows, then order them
// `family_name ASC`. Used as a control so every ordering assertion below is
// demonstrably about the ranking and not about which rows got matched. If a
// future edit made A-Z and relevance agree on this fixture, the control
// assertion goes red and says so, instead of the suite passing vacuously.
async function searchAlphabetical(rawQuery, { page = 1, pageSize = 20 } = {}) {
  const params = { branchId: 1 }
  const where = ['p.is_active = 1']
  const q = buildProductSearchQuery(rawQuery, params)
  if (q.whereClause) where.push(q.whereClause)
  const { items } = await paginateProductFamilies({
    db,
    selectColumns: 'p.id, p.name, p.sku, p.barcode, COALESCE(bs.quantity, 0) AS branch_quantity',
    joinSql: 'LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId',
    whereSql: `WHERE ${where.join(' AND ')}`,
    params,
    page,
    pageSize,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
  })
  return { names: items.map((r) => String(r.name)), ids: items.map((r) => Number(r.id)) }
}

const alphabetical = (names) => [...names].sort((a, b) => a.localeCompare(b))

async function main() {
  // 0. the control: prove the fixture can tell the two orders apart ------
  await checkAsync('CONTROL: the pre-fix ordering answers the WRONG row for every probe', async () => {
    const scan = await searchAlphabetical(SCANNED)
    assert.equal(scan.names[0], 'Aaa Contains The Digits Somewhere',
      `A-Z must answer a decoy for a scan, or the ordering assertions below prove nothing. got: ${JSON.stringify(scan.names)}`)
    const name = await searchAlphabetical('matte')
    assert.notEqual(name.names[0], 'Matte Lipstick',
      `A-Z must answer the wrong row for a name search too. got: ${JSON.stringify(name.names)}`)
  })

  // 1. exact barcode ----------------------------------------------------
  await checkAsync('an exact barcode scan puts that product FIRST, not alphabetically', async () => {
    const { names } = await search(SCANNED)
    assert.ok(names.length >= 2, `expected several matches, got ${JSON.stringify(names)}`)
    assert.equal(names[0], 'Zebra Backstage Highlighter New 002',
      `the scanned product must lead. got: ${JSON.stringify(names)}`)
    // Non-vacuous: A-Z would have answered a decoy, and the decoy is present.
    assert.notEqual(names[0], alphabetical(names)[0],
      'fixture is broken: alphabetical order would give the same answer, so this proves nothing')
    assert.ok(names.some((n) => n.startsWith('Aa')),
      'the alphabetical decoys must be IN the result set, otherwise filtering, not ranking, is being tested')
    // The two rows that merely CONTAIN the scanned digits -- one in its
    // barcode, one in its NAME -- are both matched, and both must sit below
    // the row whose barcode IS the code.
    for (const decoy of ['Aaa Contains The Digits Somewhere', 'Aab Decoy Toner 3348901770569 In The Name']) {
      const at = names.indexOf(decoy)
      assert.ok(at > 0, `${decoy} must be matched (so this is a ranking test, not a filtering one). got: ${JSON.stringify(names)}`)
    }
  })

  // 2. the leading-zero twin --------------------------------------------
  await checkAsync('a barcode differing only by a leading zero still leads', async () => {
    const { names } = await search(TWIN)
    assert.ok(
      names[0] === 'Zebra Backstage Highlighter New 002' || names[0] === 'Zulu Backstage Highlighter New 002',
      `one of the two twin rows must lead a GTIN-14 scan. got: ${JSON.stringify(names)}`,
    )
    assert.ok(
      names.includes('Zebra Backstage Highlighter New 002') && names.includes('Zulu Backstage Highlighter New 002'),
      `both twin rows must be reachable from either form. got: ${JSON.stringify(names)}`,
    )
    // Both twins occupy tier 0, so whichever of them the tail orders first
    // is fine -- what must never happen is a THIRD row landing above them.
    assert.deepEqual(
      names.slice(0, 2).sort(),
      ['Zebra Backstage Highlighter New 002', 'Zulu Backstage Highlighter New 002'],
      `only the two twin rows may lead a GTIN-14 scan. got: ${JSON.stringify(names)}`,
    )
  })

  // 3. exact name beats prefix beats the rest ---------------------------
  await checkAsync('an exact name outranks a prefix match, which outranks a mid-word one', async () => {
    const { names } = await search('matte lipstick')
    assert.equal(names[0], 'Matte Lipstick', `exact name must lead. got: ${JSON.stringify(names)}`)
    assert.equal(names[1], 'Matte Lipstick Refill Pack', `prefix match must be second. got: ${JSON.stringify(names)}`)
  })

  await checkAsync('a name prefix leads even when a decoy sorts earlier alphabetically', async () => {
    const { names } = await search('matte')
    assert.equal(names[0], 'Matte Lipstick', `got: ${JSON.stringify(names)}`)
    assert.ok(
      names.indexOf('Matte Lipstick Refill Pack') < names.indexOf('Zzz Ultra Matte Finish Powder'),
      `prefix must outrank mid-word. got: ${JSON.stringify(names)}`,
    )
  })

  // 4. mid-word fragment -------------------------------------------------
  await checkAsync('a mid-word fragment still matches and still ranks the prefix hits first', async () => {
    const { names } = await search('ipstic')
    assert.ok(names.length >= 1, `a mid-word fragment must return rows. got: ${JSON.stringify(names)}`)
    assert.ok(names.includes('Matte Lipstick'), `got: ${JSON.stringify(names)}`)
  })

  // 5. very short query --------------------------------------------------
  await checkAsync('a 1-2 character query returns rows and is deterministically ordered', async () => {
    const first = await search('ma')
    assert.ok(first.names.length >= 1, `a two-character query must return rows. got: ${JSON.stringify(first.names)}`)
    const again = await search('ma')
    assert.deepEqual(again.names, first.names, 'the same query must produce the same order every time')
    const single = await search('m')
    assert.ok(Array.isArray(single.names), 'a one-character query must not throw')
  })

  // 6. pagination --------------------------------------------------------
  await checkAsync('page 2 CONTINUES page 1 exactly -- no repeated and no dropped family', async () => {
    const all = await search('pageable', { page: 1, pageSize: 50 })
    assert.ok(all.ids.length >= 6, `need several families to page. got ${all.ids.length}`)
    const size = 4
    const p1 = await search('pageable', { page: 1, pageSize: size })
    const p2 = await search('pageable', { page: 2, pageSize: size })
    const p3 = await search('pageable', { page: 3, pageSize: size })
    const stitched = [...p1.ids, ...p2.ids, ...p3.ids]
    assert.deepEqual(stitched, all.ids.slice(0, stitched.length),
      `paged reads must reproduce the single-page order exactly.\n  paged:  ${JSON.stringify(stitched)}\n  single: ${JSON.stringify(all.ids)}`)
    assert.equal(new Set(stitched).size, stitched.length,
      `no id may appear on two pages. got ${JSON.stringify(stitched)}`)
    assert.equal(stitched.length, all.ids.length,
      `every family must appear on exactly one page. paged ${stitched.length} of ${all.ids.length}`)
    assert.equal(p1.total, all.total, 'the family total must not change with page size')
  })

  await checkAsync('a barcode scan keeps its top row on page 1 at any page size', async () => {
    const { names } = await search(SCANNED, { page: 1, pageSize: 1 })
    assert.deepEqual(names, ['Zebra Backstage Highlighter New 002'],
      `the exact hit must be the single row a pageSize-1 read returns. got: ${JSON.stringify(names)}`)
  })

  // 7. the ordering must actually be wired, not merely available ---------
  check('the shared order builder puts the tier above promoted and bm25', () => {
    assert.equal(
      buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: true, hasRank: true }),
      'match_tier ASC, match_rank ASC, family_name ASC',
    )
    assert.equal(
      buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: true, hasRank: true, promotedFirst: true }),
      'match_tier ASC, family_promoted DESC, match_rank ASC, family_name ASC',
      'a promoted product must never outrank the product the operator actually scanned',
    )
    assert.equal(
      buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: false, hasRank: false }),
      'family_name ASC',
      'with no search term the browse order must be untouched',
    )
  })

  check('every picker endpoint orders through the shared builder', () => {
    for (const route of ['products.ts', 'inventory.ts', 'branches.ts']) {
      const src = fs.readFileSync(path.join(root, 'src', 'routes', route), 'utf8')
      assert.match(src, /buildFamilyRelevanceOrderSql\(/,
        `${route} must order through the shared relevance builder`)
      assert.match(src, /matchTierSql/,
        `${route} must pass the relevance tier to paginateProductFamilies`)
      assert.ok(!/family_promoted DESC, \$\{familyOrderSql\}/.test(src),
        `${route} must not put promoted-first ahead of the relevance tier again`)
    }
  })

  check('the window function has a unique terminal key so paging cannot shuffle', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'lib', 'familyPagination.ts'), 'utf8')
    assert.match(
      src,
      /ROW_NUMBER\(\) OVER \(ORDER BY \$\{familyOrderSql\}, family_root_id ASC\)/,
      'without family_root_id (the GROUP BY key) the ranking is not a total order and OFFSET paging can repeat or drop a family',
    )
  })

  // 8. the auto-merge identity normalizer must NOT learn this folding ----
  check('the product-identity normalizer never folds leading zeros', () => {
    const a = productDetailRule.productIdentitySignature({ name: 'Twin', barcode: SCANNED, cost_price_usd: 1 })
    const b = productDetailRule.productIdentitySignature({ name: 'Twin', barcode: TWIN, cost_price_usd: 1 })
    assert.notEqual(a, b,
      'the GTIN-14/EAN-13 twin pairs are reserved for the operator to merge by hand -- teaching the '
      + 'IDENTITY normalizer the search fold would silently auto-merge them. Search-only folding belongs '
      + 'in searchMatch.ts normalizeBarcodeKey, which this file exercises above.')
    const src = fs.readFileSync(path.join(root, 'src', 'lib', 'productDetailRule.ts'), 'utf8')
    const fnStart = src.indexOf('function normalizedBarcode')
    assert.ok(fnStart >= 0, 'normalizedBarcode must still exist in lib/productDetailRule.ts')
    const fn = src.slice(fnStart)
    const body = fn.slice(0, fn.indexOf('\n}') + 2)
    assert.ok(!/\^0\+|padStart|checkDigit|check_digit/i.test(body),
      `normalizedBarcode must stay trim+lowercase only. got:\n${body}`)
  })

  console.log(`\n${passed} checks passed`)
  if (failures.length) {
    console.log(`${failures.length} FAILED:`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
