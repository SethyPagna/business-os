// The Category suggestion source, against a REAL in-memory sqlite catalog
// and the REAL current src/lib/lookupSuggestions.ts (transpiled, not a
// hand-copied replica).
//
// The bug this pins (owner, 2026-09-06: "categories still does not show the
// available options when i write... especially so for add/create products"):
// GET /api/categories returned `SELECT * FROM categories ORDER BY lower(name)`
// and nothing else. Production's `categories` table has ZERO rows while
// products carry 42 distinct category strings, so every product form offered
// an empty Category list while the catalog was full of categories.
//
// DISCRIMINATING INPUT -- the data on which the old and new reads disagree:
// an EMPTY lookup table plus products carrying 'Makeup - Face' (twice, with
// two spellings) and 'skincare' (once).
//   old read  -> []                              (what the owner saw)
//   new read  -> ['Makeup - Face', 'skincare']
// The old query is executed below as a positive control so the test cannot
// pass by measuring nothing: if it ever stops returning [] on this fixture,
// the fixture -- not the fix -- is what changed.
//
// And the half that must NOT change: the category MANAGER still lists only
// real lookup rows, so a used-but-unmanaged category can never be renamed or
// deleted through a button with no row behind it.
//
// Run: node scripts/test-lookup-suggestions-pure.cjs

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
  })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(module, module.exports, require)
  return module.exports
}

const { mergeLookupSuggestionRows, usedLookupValuesSql } = loadTs('src/lib/lookupSuggestions.ts')

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, color TEXT, updated_at TEXT);
  CREATE TABLE units (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, color TEXT, updated_at TEXT);
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, category TEXT, unit TEXT, is_active INTEGER DEFAULT 1
  );
`)
// Production shape: the lookup table is EMPTY.
db.prepare("INSERT INTO products (name, category, unit) VALUES ('Lipstick', 'Makeup - Face', 'pcs')").run()
// Same category, different spelling -- one suggestion, not two.
db.prepare("INSERT INTO products (name, category, unit) VALUES ('Foundation', 'makeup - face', 'pcs')").run()
db.prepare("INSERT INTO products (name, category, unit) VALUES ('Toner', 'skincare', 'btl')").run()
// Blank/whitespace category must never become a suggestion.
db.prepare("INSERT INTO products (name, category, unit) VALUES ('No category', '   ', 'pcs')").run()

const readLookupRows = (table) => db.prepare(`SELECT * FROM ${table} ORDER BY lower(name) ASC`).all()
const readUsed = (column) => db.prepare(usedLookupValuesSql(column)).all()
const readSuggestions = (table, column) => mergeLookupSuggestionRows(readLookupRows(table), readUsed(column))

check('POSITIVE CONTROL: the OLD read really does return nothing on this fixture', () => {
  assert.deepEqual(readLookupRows('categories'), [], 'lookup table must be empty for this test to discriminate')
})

check('empty lookup + products using two categories -> both are suggested', () => {
  const rows = readSuggestions('categories', 'category')
  assert.deepEqual(rows.map((row) => row.name), ['Makeup - Face', 'skincare'])
  assert.deepEqual(rows.map((row) => row.source), ['products', 'products'])
})

check('used-only rows carry a synthetic id that is not a lookup row id', () => {
  const rows = readSuggestions('categories', 'category')
  assert.deepEqual(rows.map((row) => row.id), ['used:makeup - face', 'used:skincare'])
  for (const row of rows) assert.equal(Number.isFinite(Number(row.id)), false, 'a used-only id must never look like a row id')
})

check('the category MANAGER list stays empty -- nothing new became deletable', () => {
  const managed = readSuggestions('categories', 'category').filter((row) => row.source === 'lookup')
  assert.deepEqual(managed, [], 'manager rows come from the lookup table only')
})

check('a managed row wins over the same name in use (one row, source lookup)', () => {
  db.prepare("INSERT INTO categories (name, color) VALUES ('SKINCARE', '#111111')").run()
  const rows = readSuggestions('categories', 'category')
  assert.deepEqual(rows.map((row) => row.name), ['SKINCARE', 'Makeup - Face'], 'lookup rows come first, then used-only names')
  assert.deepEqual(rows.map((row) => row.source), ['lookup', 'products'])
  assert.equal(rows[0].color, '#111111', 'a lookup row keeps every column the manager reads')
  assert.equal(rows[0].id, 1, 'a lookup row keeps its real id')
  const managed = rows.filter((row) => row.source === 'lookup')
  assert.deepEqual(managed.map((row) => row.name), ['SKINCARE'], 'the manager gained exactly the row it created')
  db.prepare('DELETE FROM categories').run()
})

check('inactive-only categories sort after active ones', () => {
  db.prepare("INSERT INTO products (name, category, unit, is_active) VALUES ('Retired', 'Archive', 'pcs', 0)").run()
  const rows = readSuggestions('categories', 'category')
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Makeup - Face', 'skincare', 'Archive'],
    'active names alphabetically, then inactive-only names',
  )
  db.prepare("DELETE FROM products WHERE name = 'Retired'").run()
})

check('units get the identical treatment -- one rule, both lookups', () => {
  const rows = readSuggestions('units', 'unit')
  assert.deepEqual(rows.map((row) => row.name), ['btl', 'pcs'])
  assert.deepEqual(rows.map((row) => row.source), ['products', 'products'])
})

check('the route wires the shared merge into BOTH lookup GETs', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'lookups.ts'), 'utf8')
  assert.match(routeSrc, /mergeLookupSuggestionRows/, 'GET must return the merged suggestion rows')
  assert.match(routeSrc, /usedLookupValuesSql\(/, 'the used-values query must come from the shared lib')
  // registerLookupRoutes is called once for categories and once for units, so
  // one wired GET covers both -- assert it is the shared registrar, not a
  // category-only special case.
  assert.match(routeSrc, /registerLookupRoutes\('category', 'categories'\)/)
  assert.match(routeSrc, /registerLookupRoutes\('unit', 'units'\)/)
})

check('both manager modals drop used-only rows before showing anything', () => {
  for (const modal of ['ManageCategoriesModal.tsx', 'ManageUnitsModal.tsx']) {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'products', 'lookups', modal),
      'utf8',
    )
    assert.match(
      src,
      /source !== 'products'/,
      `${modal} must keep lookup rows only -- a used-only category has no row to rename or delete`,
    )
  }
})

if (!process.exitCode) console.log(`\n${passed} checks passed`)
