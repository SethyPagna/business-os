// P3-10: the supplier Purchases float's Start->End range, proven against the
// REAL route code and the REAL migration chain.
//
// The owner could not narrow a supplier's purchase history at all -- the
// modal had no date range, and GET /suppliers/:id/purchases read only
// page/page_size. This pins the contract the modal now depends on:
//
//   - the route's own WHERE builder is executed here (extracted from the
//     shipped source, not re-typed), so a regression that stops applying the
//     bounds fails this file instead of passing a stale copy;
//   - no range sent  => the complete supplier history, exactly as before,
//     including lots with no recorded receive date;
//   - a bound sent   => plain calendar-day comparison on received_at, both
//     edge days INCLUDED (a timezone-shifted bound would drop one), and lots
//     with no recorded date excluded rather than silently counted;
//   - the totals honour the range too, so the headline numbers always
//     describe the rows the operator is looking at;
//   - name-only attribution (no supplier_id) stays inside the window.
//
// Run: node scripts/test-supplier-purchases-range-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

// autocrlf rewrites this checkout to CRLF; normalize before any \n-anchored
// extraction (the same trap Part 416's sweep hit).
const contactsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8').replace(/\r\n/g, '\n')
const routeMatch = contactsSource.match(/app\.get\('\/suppliers\/:id\/purchases'[\s\S]*?\n\}\)\n/)
assert.ok(routeMatch, 'contacts.ts still defines GET /suppliers/:id/purchases')
const route = routeMatch[0]

// --- the route's OWN filter builder, transpiled and executed --------------
const builderStart = route.indexOf('  const params: Record<string, unknown>')
const builderEnd = route.indexOf('const purchasesWhere')
assert.ok(builderStart >= 0 && builderEnd > builderStart, 'the purchases route builds params + purchasesWhere')
const builderBody = route.slice(builderStart, route.indexOf('\n', builderEnd))
const builderSource = `(function (query, id, supplier) {\n${builderBody}\n  return { purchasesWhere, params }\n})`
const buildFilters = eval(ts.transpileModule(builderSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)

// --- the route's OWN two SQL statements ----------------------------------
const totalsSql = route.match(/const totalsRow = await db\.prepare\(`([\s\S]*?)`\)/)
const batchesSql = route.match(/const batches = await db\.prepare\(`([\s\S]*?)`\)/)
assert.ok(totalsSql && batchesSql, 'both purchase statements are readable from the source')
function bind(sql, where) {
  const bound = sql.replace('${purchasesWhere}', where)
  assert.ok(!bound.includes('${'), 'every interpolation in the extracted SQL is accounted for')
  return bound
}

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

const SUPPLIER = { id: 7, name: 'Bong Long' }
function freshDb() {
  const sqlite = new Database(':memory:')
  for (const file of migrationFiles) sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)`).run()
  sqlite.prepare('INSERT INTO suppliers (id, name) VALUES (?, ?)').run(SUPPLIER.id, SUPPLIER.name)
  sqlite.prepare(`INSERT INTO products (id, name, is_active) VALUES (101, 'Serum', 1), (102, 'Toner', 1)`).run()
  return sqlite
}
let lotId = 0
function seedLot(sqlite, { receivedAt, supplierId = SUPPLIER.id, supplierName = null, qty = 2, cost = 10, productId = 101 }) {
  lotId += 1
  sqlite.prepare(`
    INSERT INTO product_batches (id, variant_product_id, batch_key, received_at, supplier_id, supplier_name,
      received_quantity, unit_cost_usd, received_cost_usd, payment_status)
    VALUES (@id, @productId, @key, @receivedAt, @supplierId, @supplierName, @qty, @unit, @cost, 'paid')
  `).run({ id: lotId, productId, key: `k-${lotId}`, receivedAt, supplierId, supplierName, qty, unit: cost / qty, cost })
  return lotId
}

function run(sqlite, query) {
  const { purchasesWhere, params } = buildFilters(query, SUPPLIER.id, { id: SUPPLIER.id, name: SUPPLIER.name })
  const rows = sqlite.prepare(bind(batchesSql[1], purchasesWhere)).all({ ...params, limit: 50, offset: 0 })
  const totals = sqlite.prepare(bind(totalsSql[1], purchasesWhere)).get(params)
  return { rows, totals, ids: rows.map((row) => row.id).sort((a, b) => a - b) }
}

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failures += 1; console.error(`FAIL ${name}`); console.error(error && error.message) }
}

const sqlite = freshDb()
const aug19 = seedLot(sqlite, { receivedAt: '2026-08-19' })
const sep01 = seedLot(sqlite, { receivedAt: '2026-09-01' })
const sep07 = seedLot(sqlite, { receivedAt: '2026-09-07 09:10:00' })
const sep30 = seedLot(sqlite, { receivedAt: '2026-09-30' })
const undated = seedLot(sqlite, { receivedAt: null })
// Attributed by typed name only -- the same lot the merge rule folds in.
const nameOnly = seedLot(sqlite, { receivedAt: '2026-09-02', supplierId: null, supplierName: '  bong long ', productId: 102 })
const byId = (a, b) => a - b

check('no range sent means the complete history, undated lots included', () => {
  const { ids, totals } = run(sqlite, {})
  assert.deepStrictEqual(ids, [aug19, sep01, sep07, sep30, undated, nameOnly].sort(byId))
  assert.strictEqual(totals.batches, 6, 'the unfiltered totals still count every lot')
})

check('empty from/to strings are treated as no range at all', () => {
  assert.deepStrictEqual(run(sqlite, { from: '', to: '' }).ids, run(sqlite, {}).ids)
})

check('both edge days are inside the window', () => {
  const { ids } = run(sqlite, { from: '2026-09-01', to: '2026-09-07' })
  assert.deepStrictEqual(ids, [sep01, sep07, nameOnly].sort(byId),
    'a bound that shifted by the business timezone would drop 09-01 or 09-07')
})

check('a lot with no recorded date is excluded by a bound, not silently counted', () => {
  assert.ok(!run(sqlite, { from: '2026-01-01' }).ids.includes(undated))
  assert.ok(!run(sqlite, { to: '2026-12-31' }).ids.includes(undated))
  assert.ok(run(sqlite, {}).ids.includes(undated), 'it is still reachable with no range set')
})

check('a one-sided bound leaves the other side open', () => {
  assert.deepStrictEqual(run(sqlite, { from: '2026-09-08' }).ids, [sep30])
  assert.deepStrictEqual(run(sqlite, { to: '2026-08-31' }).ids, [aug19])
})

check('a timestamped received_at is compared by its calendar day', () => {
  assert.deepStrictEqual(run(sqlite, { from: '2026-09-07', to: '2026-09-07' }).ids, [sep07],
    '09-07 09:10 must match the 09-07 window even though it carries a time')
})

check('name-only attribution stays inside the window', () => {
  const { ids } = run(sqlite, { from: '2026-09-02', to: '2026-09-02' })
  assert.deepStrictEqual(ids, [nameOnly], 'a lot linked by typed name is a purchase from the same supplier')
})

check('the totals describe the filtered rows, not the whole history', () => {
  const { totals } = run(sqlite, { from: '2026-09-01', to: '2026-09-02' })
  assert.strictEqual(totals.batches, 2, 'two lots in the window')
  assert.strictEqual(totals.products, 2, 'across two products')
  assert.strictEqual(totals.units_received, 4)
  assert.strictEqual(Math.round(totals.cost_usd * 100) / 100, 20)
})

check('a window with nothing in it returns nothing, not everything', () => {
  const { ids, totals } = run(sqlite, { from: '2027-01-01', to: '2027-01-31' })
  assert.deepStrictEqual(ids, [])
  assert.strictEqual(totals.batches, 0)
})

check('an over-long date param is truncated to a calendar day', () => {
  assert.deepStrictEqual(run(sqlite, { from: '2026-09-30T23:59:59Z' }).ids, [sep30])
})

check('positive control: the builder really is the route source', () => {
  assert.ok(/rangeConditions\.push/.test(route), 'the route composes its range conditions')
  assert.strictEqual((route.match(/WHERE \$\{purchasesWhere\}/g) || []).length, 2, 'totals AND rows are filtered')
})

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1) }
console.log('PASS supplier purchases honour Start->End bounds only when sent')
