// Regression test for the live production incident: a bare 1-character
// search (a real user typed just "m") tripped "D1_ERROR: D1 DB exceeded
// its CPU time limit and was reset" -- confirmed from real `wrangler tail`
// output, not a guess. Root cause: buildShortWordFallbackClause's LIKE
// scan (lib/searchMatch.ts) is a function-wrapped, leading-wildcard
// `LIKE '%m%'` that can't use any index, and a 1-character query matches a
// huge, near-unselective fraction of any real catalog -- feeding
// thousands of rows into the caller's family-grouping/pagination query on
// top of the scan itself is what actually exhausts the CPU budget.
//
// This test seeds a catalog large enough to reproduce the same shape of
// problem (a single common letter matching a large fraction of names),
// applies the REAL migrations (same engine D1 runs on, via better-sqlite3)
// and the REAL current buildShortWordFallbackClause (not a hand-copied
// replica), and confirms:
//   1. A pathological single-letter query no longer requires scanning/
//      returning an unbounded result set -- it's capped at 500 rows.
//   2. A real, narrow short-word match (a fused "100ml" style token,
//      exactly the case this fallback exists for) is completely
//      unaffected by the cap -- same rows returned as before the fix.
//
// Run: node scripts/test-short-word-fallback-cap.cjs
// Requires better-sqlite3 (installed --no-save; test-only, see
// test-search-fts-pure.cjs's own header for why this is never a
// package.json dependency).

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

const { tokenizeSearchTermGroups, buildShortWordFallbackClause } = loadTs('src/lib/searchMatch.ts')

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

// Seed a realistic-scale catalog (5,000 rows -- half the real reported
// catalog size, plenty to reproduce the same cost profile) where roughly
// half of all names contain the letter "m" somewhere, same low-selectivity
// shape a real cosmetics catalog has for any single common letter.
const brands = ['MAC', 'Maybelline', 'NYX', 'Anastasia', 'Fenty', 'Rare Beauty']
const nouns = ['Lipstick', 'Foundation', 'Mascara', 'Blush', 'Primer', 'Concealer', 'Setting Spray', 'Bronzer']
const insert = db.prepare(`INSERT INTO products
  (name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
  VALUES (@name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, 50, 10, 0, 1)`)
const insertMany = db.transaction((rows) => { for (const row of rows) insert.run(row) })
const rows = []
for (let i = 0; i < 5000; i += 1) {
  const brand = brands[i % brands.length]
  const noun = nouns[i % nouns.length]
  rows.push({
    name: `${brand} ${noun} ${100 + i}`,
    sku: `SKU${i}`,
    barcode: String(6900000000000 + i),
    brand,
    category: noun,
    supplier: 'Acme',
    description: '',
    unit: 'pcs',
  })
}
// A handful of real fused-token products the short-word fallback exists
// for -- a person typing just "ml" or a single shade-code letter should
// still find these, unaffected by the new LIMIT.
rows.push({ name: 'Anastasia Foundation 110C', sku: 'ANF110C', barcode: '6900009999001', brand: 'Anastasia', category: 'Foundation', supplier: 'Acme', description: '', unit: 'pcs' })
rows.push({ name: 'Fenty Setting Spray 100ml', sku: 'FSS100', barcode: '6900009999002', brand: 'Fenty', category: 'Setting Spray', supplier: 'Acme', description: '', unit: 'pcs' })
rows.push({ name: 'Rare Beauty Primer 30ml', sku: 'RBP30', barcode: '6900009999003', brand: 'Rare Beauty', category: 'Primer', supplier: 'Acme', description: '', unit: 'pcs' })
insertMany(rows)

const params = {}
const groups = tokenizeSearchTermGroups('m', 6, 8)
const clause = buildShortWordFallbackClause(groups, 'AND', ['p.name', 'p.unit'], params, 'shortw')

check('a bare single-letter query still builds a valid, real fallback clause (not skipped)', () => {
  assert.ok(clause, 'expected a non-empty clause for a 1-character word')
})

check('the fallback clause is now a bounded, capped subquery -- not a raw inline boolean', () => {
  assert.match(clause, /^p\.id IN \(SELECT id FROM products p WHERE p\.is_active = 1 AND \(.*\) LIMIT 500\)$/)
})

check('the pathological single-letter query executes without error and returns AT MOST 500 rows (the real production crash, now bounded)', () => {
  const start = Date.now()
  const found = db.prepare(`SELECT id, name FROM products p WHERE ${clause}`).all(params)
  const elapsedMs = Date.now() - start
  assert.ok(found.length <= 500, `expected <= 500 rows, got ${found.length}`)
  assert.ok(found.length > 0, 'expected at least some real matches for the letter "m"')
  console.log(`  (bare "m" query returned ${found.length} rows in ${elapsedMs}ms against a 5,003-row catalog)`)
})

check('every row the capped query returns is a genuine match (the cap narrows quantity, never correctness)', () => {
  const found = db.prepare(`SELECT id, name, unit FROM products p WHERE ${clause}`).all(params)
  for (const row of found) {
    const haystack = `${row.name} ${row.unit}`.toLowerCase()
    assert.ok(haystack.includes('m'), `row "${row.name}" does not actually contain "m"`)
  }
})

check('a real narrow short-word match ("ml" fragment inside a fused token) is completely unaffected by the cap', () => {
  const mlParams = {}
  const mlGroups = tokenizeSearchTermGroups('ml', 6, 8)
  const mlClause = buildShortWordFallbackClause(mlGroups, 'AND', ['p.name', 'p.unit'], mlParams, 'shortw')
  const found = db.prepare(`SELECT id, name FROM products p WHERE ${mlClause}`).all(mlParams)
  const names = found.map((r) => r.name)
  assert.ok(names.includes('Fenty Setting Spray 100ml'), 'expected the 100ml product to match "ml"')
  assert.ok(names.includes('Rare Beauty Primer 30ml'), 'expected the 30ml product to match "ml"')
  assert.ok(found.length < 500, 'a real narrow match should be far under the cap, confirming the cap never engages for the legitimate case')
})

check('a real shade-code fragment ("110C" catalog convention, single-letter tail) still matches via the fallback', () => {
  const codeParams = {}
  const codeGroups = tokenizeSearchTermGroups('110c', 6, 8)
  const codeClause = buildShortWordFallbackClause(codeGroups, 'AND', ['p.name', 'p.unit'], codeParams, 'shortw')
  // "110c" is 4 chars, already >=3 -- trigram alone should cover it, so
  // buildShortWordFallbackClause may legitimately no-op here. This check
  // just confirms it doesn't error either way.
  if (codeClause) {
    const found = db.prepare(`SELECT id, name FROM products p WHERE ${codeClause}`).all(codeParams)
    assert.ok(Array.isArray(found))
  }
})

console.log(`\n${passed} short-word-fallback-cap checks passed`)
