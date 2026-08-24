// Regression test for the reported bug: searching a barcode/term that only
// matches ONE row of a grouped product silently drops that group's sibling
// rows (different branch/price/barcode) from the response entirely, so the
// group renders on POS/Products as if it were a single standalone product
// -- no variant list, no other barcodes/prices visible.
//
// Two distinct code paths, two distinct fixes, both exercised here for
// real against real SQLite (all migrations applied verbatim, same engine
// D1 runs on -- same approach as test-search-500-repro.cjs):
//
//   1. Explicit parent_id-linked families -- lib/familyPagination.ts's
//      opt-in `familyMemberBaseWhereSql` on paginateProductFamilies.
//   2. Same-name duplicate rows with no parent_id (the more common case in
//      this catalog, per this file's own comments elsewhere) -- routes/
//      products.ts's expandSearchResultsToNameSiblings, a post-processing
//      step run after the normal paginated results come back.
//
// Run: node scripts/test-group-search-siblings-repro.cjs
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

// Real implementation, not a re-write -- if this drifts from the shipped
// helper, this test should fail loudly rather than silently test a stale
// copy.
const { paginateProductFamilies } = loadTs('src/lib/familyPagination.ts')

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

// D1Compat-shaped shim over better-sqlite3 -- paginateProductFamilies only
// calls db.prepare(sql).get(params)/.all(params) with @name-style params,
// which better-sqlite3 supports natively, so no positional translation is
// needed for this test (unlike the real D1Compat, which exists to bridge
// D1's positional-only bind()).
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
  (name, sku, barcode, brand, category, supplier, unit, stock_quantity, is_active, parent_id)
  VALUES (@name, @sku, @barcode, @brand, @category, @supplier, @unit, @stock_quantity, 1, @parent_id)`)

// --- Case 1: same-name duplicate rows, NO parent_id (the common case) ---
// Three rows of the "same" product at different branches, each with its
// own barcode/price -- exactly the reported scenario ("different
// branches/prices/barcodes").
insert.run({ name: 'Blue Polo Shirt', sku: 'BPS-A', barcode: '6001000000011', brand: 'Acme', category: 'Apparel', supplier: 'Acme', unit: 'pcs', stock_quantity: 5, parent_id: null })
insert.run({ name: 'Blue Polo Shirt', sku: 'BPS-B', barcode: '6001000000022', brand: 'Acme', category: 'Apparel', supplier: 'Acme', unit: 'pcs', stock_quantity: 8, parent_id: null })
insert.run({ name: 'Blue Polo Shirt', sku: 'BPS-C', barcode: '6001000000033', brand: 'Acme', category: 'Apparel', supplier: 'Acme', unit: 'pcs', stock_quantity: 2, parent_id: null })

// --- Case 2: explicit parent_id-linked family -------------------------
const parentId = insert.run({ name: 'Red Sneaker', sku: 'RSN-P', barcode: '6002000000011', brand: 'Nike', category: 'Footwear', supplier: 'Acme', unit: 'pcs', stock_quantity: 10, parent_id: null }).lastInsertRowid
insert.run({ name: 'Red Sneaker', sku: 'RSN-42', barcode: '6002000000042', brand: 'Nike', category: 'Footwear', supplier: 'Acme', unit: 'pcs', stock_quantity: 4, parent_id: parentId })
insert.run({ name: 'Red Sneaker', sku: 'RSN-43', barcode: '6002000000043', brand: 'Nike', category: 'Footwear', supplier: 'Acme', unit: 'pcs', stock_quantity: 6, parent_id: parentId })

// --- Control: unrelated standalone product, must never be pulled in ---
insert.run({ name: 'Green Hat', sku: 'GHT-1', barcode: '6003000000099', brand: 'Acme', category: 'Apparel', supplier: 'Acme', unit: 'pcs', stock_quantity: 3, parent_id: null })

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
    passed++
  } catch (err) {
    console.log('FAIL', name, '--', err.message)
    failed++
  }
}

const selectColumns = 'p.id, p.name, p.sku, p.barcode, p.parent_id, p.is_active'

// ---- Test A: parent_id-linked family, familyMemberBaseWhereSql fix ----
async function testParentFamily() {
  // Search matches ONLY the '42' child's barcode -- before the fix,
  // 'matched' (and therefore the response) would contain just that one
  // row; parent + the '43' sibling would silently vanish.
  const result = await paginateProductFamilies({
    db: dbShim,
    selectColumns,
    joinSql: '',
    whereSql: "WHERE p.is_active = 1 AND p.barcode = '6002000000042'",
    params: {},
    page: 1,
    pageSize: 20,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    familyMemberBaseWhereSql: 'p.is_active = 1',
  })
  const names = result.items.map((r) => r.sku).sort()
  assert.deepStrictEqual(names, ['RSN-42', 'RSN-43', 'RSN-P'], `expected all 3 family rows, got ${JSON.stringify(names)}`)
  // Family paging unit is still 1 (one family qualified), not 3 rows.
  assert.strictEqual(result.total, 1, `expected total=1 family, got ${result.total}`)
}

// ---- Test B: same behavior WITHOUT the opt-in, confirming it's the ----
// ---- fix (not some other path) that returns the siblings --------------
async function testParentFamilyWithoutOptIn() {
  const result = await paginateProductFamilies({
    db: dbShim,
    selectColumns,
    joinSql: '',
    whereSql: "WHERE p.is_active = 1 AND p.barcode = '6002000000042'",
    params: {},
    page: 1,
    pageSize: 20,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    // no familyMemberBaseWhereSql -- prior (buggy-for-this-case) behavior
  })
  const names = result.items.map((r) => r.sku).sort()
  assert.deepStrictEqual(names, ['RSN-42'], `expected only the matched row without the opt-in, got ${JSON.stringify(names)}`)
}

// ---- Test C: same-name duplicate rows, expandSearchResultsToNameSiblings ----
// Reimplemented verbatim against the same query shape products.ts uses
// (case/whitespace-normalized name match), since the real function lives
// inside routes/products.ts and is coupled to Cloudflare's Env/getDb --
// see this repo's own test-search-500-repro.cjs for the same "replicate
// the exact SQL rather than import the Workers-bound module" approach.
async function expandSearchResultsToNameSiblings(items) {
  if (!items.length) return items
  const seenIds = new Set(items.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && id > 0))
  const namesByKey = new Map()
  for (const item of items) {
    const rawName = String(item.name || '').trim().replace(/\s+/g, ' ')
    if (!rawName) continue
    const key = rawName.toLowerCase()
    if (!namesByKey.has(key)) namesByKey.set(key, rawName)
  }
  if (!namesByKey.size) return items
  const keys = [...namesByKey.keys()]
  const placeholders = keys.map((_, i) => `@name${i}`).join(', ')
  const params = {}
  keys.forEach((key, i) => { params[`name${i}`] = key })
  const siblingRows = await dbShim.prepare(`
    SELECT p.id, p.name, p.sku, p.barcode, p.parent_id, p.is_active
    FROM products p
    WHERE p.is_active = 1
      AND lower(trim(p.name)) IN (${placeholders})
  `).all(params)
  const extras = siblingRows.filter((row) => {
    const id = Number(row.id)
    if (!Number.isFinite(id) || id <= 0 || seenIds.has(id)) return false
    seenIds.add(id)
    return true
  })
  if (!extras.length) return items
  return [...items, ...extras]
}

async function testNameSiblingExpansion() {
  // Search matches ONLY the 'B' branch row's barcode -- the reported bug's
  // exact shape: no parent_id relationship at all, just same normalized
  // name. Simulate what searchProductsPayload does: paginateProductFamilies
  // WITHOUT the parent_id opt-in (this group has no parent_id, so that
  // fix alone can't help it -- each duplicate row is already its own
  // one-row "family" as far as familyPagination.ts is concerned), then
  // expandSearchResultsToNameSiblings as the second pass.
  const paged = await paginateProductFamilies({
    db: dbShim,
    selectColumns,
    joinSql: '',
    whereSql: "WHERE p.is_active = 1 AND p.barcode = '6001000000022'",
    params: {},
    page: 1,
    pageSize: 20,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    familyMemberBaseWhereSql: 'p.is_active = 1',
  })
  const beforeExpansion = paged.items.map((r) => r.sku).sort()
  assert.deepStrictEqual(beforeExpansion, ['BPS-B'], `expected only the matched duplicate row before expansion, got ${JSON.stringify(beforeExpansion)}`)

  const expanded = await expandSearchResultsToNameSiblings(paged.items)
  const afterExpansion = expanded.map((r) => r.sku).sort()
  assert.deepStrictEqual(afterExpansion, ['BPS-A', 'BPS-B', 'BPS-C'], `expected all 3 same-name siblings after expansion, got ${JSON.stringify(afterExpansion)}`)
}

// ---- Test D: control -- unrelated product never pulled in -------------
async function testControlNotPulledIn() {
  const paged = await paginateProductFamilies({
    db: dbShim,
    selectColumns,
    joinSql: '',
    whereSql: "WHERE p.is_active = 1 AND p.barcode = '6001000000022'",
    params: {},
    page: 1,
    pageSize: 20,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    familyMemberBaseWhereSql: 'p.is_active = 1',
  })
  const expanded = await expandSearchResultsToNameSiblings(paged.items)
  const skus = expanded.map((r) => r.sku)
  assert.ok(!skus.includes('GHT-1'), `Green Hat should never be pulled in, got ${JSON.stringify(skus)}`)
}

async function main() {
  await check('parent_id-linked family: barcode match on one child returns whole family', () => testParentFamily())
  await check('parent_id-linked family: without opt-in, only the matched row comes back (confirms the fix is what fixes it)', () => testParentFamilyWithoutOptIn())
  await check('same-name duplicate rows: expandSearchResultsToNameSiblings pulls in siblings', () => testNameSiblingExpansion())
  await check('unrelated standalone product is never pulled in as a false sibling', () => testControlNotPulledIn())

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
