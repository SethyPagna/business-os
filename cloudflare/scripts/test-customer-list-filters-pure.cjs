// Pure test for the two additive read filters that let a caller stop
// downloading the whole customers table:
//
//   1. GET /customers?ids=1,2,3        (lib/contactIds.ts, wired into
//      routes/contacts.ts's registerContactRoutes) -- batched by-id read.
//   2. GET /customers/points-summary?membership_only=1&sort=points&top=10
//      -- the loyalty board's ten rows, computed server-side.
//
// The helper module is transpiled and executed for real, its clause is run
// against a real SQLite database with the real migrations applied (so the
// SQL is proven, not assumed), and routes/contacts.ts is checked to still
// wire both -- a filter that exists but is no longer reachable from the
// route is the exact regression this guards.
//
// Run (from cloudflare/): node scripts/test-customer-list-filters-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function loadModule(relPath) {
  const filePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(filePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: `${relPath}-pure.ts`,
  })
  const moduleObj = { exports: {} }
  const req = (spec) => {
    throw new Error(`unexpected require in test harness: ${spec}`)
  }
  new Function('exports', 'require', outputText)(moduleObj.exports, req)
  return moduleObj.exports
}

const { parseContactIdFilter, buildContactIdClause, CONTACT_ID_FILTER_MAX } = loadModule('lib/contactIds.ts')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- parsing ------------------------------------------------------------

check('no ids param -> filter not requested, clause empty', () => {
  for (const raw of [undefined, null, '', [], ['']]) {
    const filter = parseContactIdFilter(raw)
    assert.strictEqual(filter.requested, false, `raw=${JSON.stringify(raw)}`)
    assert.strictEqual(buildContactIdClause(filter), '')
  }
})

check('comma list and repeated param both parse', () => {
  assert.deepStrictEqual(parseContactIdFilter('3,1,2').ids, [3, 1, 2])
  assert.deepStrictEqual(parseContactIdFilter(['3', '1', '2']).ids, [3, 1, 2])
  assert.deepStrictEqual(parseContactIdFilter(['3,1', '2']).ids, [3, 1, 2])
})

check('duplicates collapse, order preserved', () => {
  assert.deepStrictEqual(parseContactIdFilter('7,7,2,7').ids, [7, 2])
})

check('junk values are dropped, not coerced', () => {
  // Number('') === 0 and Number(' 5 ') === 5 -- neither may become an id.
  assert.deepStrictEqual(parseContactIdFilter('0,-1,1.5,abc,1e3, ,null,NaN').ids, [])
  assert.deepStrictEqual(parseContactIdFilter('12abc,4').ids, [4])
})

check('an all-junk ids param matches nothing (never the whole table)', () => {
  const filter = parseContactIdFilter('abc')
  assert.strictEqual(filter.requested, true)
  assert.deepStrictEqual(filter.ids, [])
  assert.strictEqual(buildContactIdClause(filter), '1 = 0')
})

check('over the ceiling is flagged, not silently truncated', () => {
  const many = Array.from({ length: CONTACT_ID_FILTER_MAX + 1 }, (_, i) => i + 1)
  const filter = parseContactIdFilter(many.join(','))
  assert.strictEqual(filter.tooMany, true)
  assert.strictEqual(filter.ids.length, CONTACT_ID_FILTER_MAX + 1, 'ids are kept intact so the route can reject')
  const atCeiling = parseContactIdFilter(many.slice(0, CONTACT_ID_FILTER_MAX).join(','))
  assert.strictEqual(atCeiling.tooMany, false)
})

check('clause renders integer literals, so no bound parameters are spent', () => {
  const clause = buildContactIdClause(parseContactIdFilter('4,9'))
  assert.strictEqual(clause, 'id IN (4, 9)')
  assert.ok(!clause.includes('@'), 'must not add named parameters to the statement')
  assert.ok(!clause.includes('?'), 'must not add positional parameters to the statement')
})

// --- real SQL -----------------------------------------------------------

function freshDb() {
  return openDb(loadAll())
}

function seedCustomers(db) {
  const rows = [
    { id: 1, name: 'Alpha', phone: '011000001', membership_number: 'M-1' },
    { id: 2, name: 'Bravo', phone: '011000002', membership_number: '' },
    { id: 3, name: 'Charlie', phone: '011000003', membership_number: '   ' },
    { id: 4, name: 'Delta', phone: '011000004', membership_number: 'M-4' },
    { id: 5, name: 'Echo', phone: '011000005', membership_number: null },
  ]
  for (const row of rows) {
    db.prepare('INSERT INTO customers (id, name, phone, membership_number) VALUES (@id, @name, @phone, @membership_number)')
      .bind(row)
      .run()
  }
  return rows
}

check('ids clause selects exactly the requested rows against real SQLite', () => {
  const db = freshDb()
  seedCustomers(db)
  const clause = buildContactIdClause(parseContactIdFilter('4,1'))
  const rows = db.prepare(`SELECT id FROM customers WHERE ${clause} ORDER BY id ASC`).bind({}).all()
  assert.deepStrictEqual(rows.map((r) => Number(r.id)), [1, 4])
})

check('never-matching clause returns zero rows, not the table', () => {
  const db = freshDb()
  seedCustomers(db)
  const clause = buildContactIdClause(parseContactIdFilter('nope'))
  const rows = db.prepare(`SELECT id FROM customers WHERE ${clause}`).bind({}).all()
  assert.strictEqual(rows.length, 0)
})

check('ids clause composes with another WHERE term', () => {
  const db = freshDb()
  seedCustomers(db)
  const clause = buildContactIdClause(parseContactIdFilter('1,2,3,4,5'))
  const sql = `SELECT id FROM customers WHERE ${clause} AND trim(COALESCE(membership_number, '')) <> '' ORDER BY id ASC`
  const rows = db.prepare(sql).bind({}).all()
  assert.deepStrictEqual(rows.map((r) => Number(r.id)), [1, 4])
})

check('membership_only predicate keeps only real membership numbers', () => {
  const db = freshDb()
  seedCustomers(db)
  const rows = db.prepare(
    `SELECT id FROM customers WHERE trim(COALESCE(membership_number, '')) <> '' ORDER BY lower(name) ASC`,
  ).bind({}).all()
  // Blank, whitespace-only and NULL membership numbers must all drop out.
  assert.deepStrictEqual(rows.map((r) => Number(r.id)), [1, 4])
})

// --- route wiring -------------------------------------------------------

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')

check('routes/contacts.ts wires the ids filter into the list route', () => {
  assert.ok(routeSource.includes("from '../lib/contactIds'"), 'imports the helper module')
  assert.ok(/parseContactIdFilter\(c\.req\.queries\('ids'\)/.test(routeSource), 'parses repeated + comma ids')
  assert.ok(routeSource.includes('buildContactIdClause(idFilter)'), 'builds the clause')
  assert.ok(routeSource.includes('idFilter.tooMany'), 'rejects an over-ceiling request')
})

check('routes/contacts.ts wires membership_only / sort=points / top', () => {
  assert.ok(routeSource.includes('query.membership_only'), 'membership_only param')
  assert.ok(routeSource.includes("=== 'points'"), 'sort=points branch')
  assert.ok(routeSource.includes('clampInt(query.top'), 'top slice')
})

console.log(`\n${passed} checks passed`)
