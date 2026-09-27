// I4-2: unfiltered GET /api/sales/stats carries no report scope.
//
// The route turns the Sales list filter into a report scope
// (`s.id IN (SELECT matched_sale.id ... WHERE <list filter>)`). With no filter
// the list's `where` is only its '1=1' seed, and the scope used to be emitted
// anyway -- `IN (... WHERE 1=1)` -- which filters nothing but makes SQLite
// scan every sale and temp-sort the remaining items on every 2,000-row keyset
// page (681 -> 48 ms for the all-time walk on the seeded lab DB).
//
// Proves: no scope without a filter; a real filter still scopes (and still
// narrows); the unscoped snapshot is identical to the old `WHERE 1=1` one;
// and the route builds its scope through salesListFilterReportScope.
//
// Run: node scripts/test-sales-stats-unfiltered-scope-native.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(relative, overrides = {}) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts', overrides)
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

const sql = new Database(':memory:')
sql.pragma('foreign_keys = OFF')
for (const migration of loadAll()) sql.exec(migration)
const insertSale = sql.prepare(`INSERT INTO sales (id, receipt_number, created_at, sale_status, branch_id, subtotal_usd, total_usd, cashier_id, cashier_name, payment_method)
  VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, 'Cash')`)
const insertItem = sql.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, total_usd, cost_price_usd) VALUES (?, 1, ?, 1, ?, 0.4)')
for (let i = 1; i <= 60; i += 1) {
  insertSale.run(i, `R${i}`, `2026-09-${String(1 + (i % 25)).padStart(2, '0')} 03:00:00`, i % 11 === 0 ? 'cancelled' : i % 7 === 0 ? 'awaiting_payment' : 'completed', 5 + i, 5 + i, i % 2 ? 'Dara' : 'Sokha')
  insertItem.run(i, `P${i}`, 5 + i)
}

const captured = []
const db = { prepare(query) { const stmt = sql.prepare(query); return {
  all(params = {}) { captured.push(query); return stmt.all(params) },
  get(params = {}) { captured.push(query); return stmt.get(params) },
} } }
const lib = load('src/lib/salesAnalytics.ts', {
  './db': { getDb: () => db },
  './removalLosses': load('src/lib/removalLosses.ts'),
  './businessDateWindow': load('src/lib/businessDateWindow.ts'),
  './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': load('src/lib/moneyPrecision.ts') }),
})

// The scope the route used to pass unconditionally, verbatim.
const oldAlwaysScope = (where) => (alias) => ({
  sql: `${alias}.id IN (SELECT matched_sale.id FROM sales matched_sale LEFT JOIN customers c ON c.id=matched_sale.customer_id WHERE ${where.join(' AND ')})`,
  params: {},
})

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

;(async () => {
  await check('no filter -> no scope', async () => {
    assert.equal(lib.salesListFilterReportScope(['1=1'], {}), undefined)
  })

  await check('a real filter still scopes, with prefixed params', async () => {
    const scope = lib.salesListFilterReportScope(['1=1', 's.cashier_name LIKE @cashier'], { cashier: '%Dara%' })
    assert.ok(scope, 'expected a scope')
    const captured1 = scope('s')
    assert.match(captured1.sql, /matched_sale\.cashier_name LIKE @reportScope_cashier/)
    assert.deepEqual(captured1.params, { reportScope_cashier: '%Dara%' })
  })

  await check('unscoped snapshot is identical to the old WHERE 1=1 scope, and emits no 1=1 subquery', async () => {
    captured.length = 0
    const now = await lib.readSalesReportSnapshot({}, {}, false, lib.salesListFilterReportScope(['1=1'], {}))
    assert.ok(!captured.some((q) => /WHERE 1=1/.test(q)), 'an unfiltered read must not carry the WHERE 1=1 subquery')
    const before = await lib.readSalesReportSnapshot({}, {}, false, oldAlwaysScope(['1=1']))
    assert.ok(now.sales.length > 40 && now.items.length > 40 && now.voidSales.length > 0, 'fixture must be non-trivial')
    assert.equal(JSON.stringify(now), JSON.stringify(before))
    assert.deepEqual(lib.salesTotalsFromSnapshot(now), lib.salesTotalsFromSnapshot(before))
  })

  await check('filtered snapshot still narrows (control: the scope is not simply dropped)', async () => {
    const all = await lib.readSalesReportSnapshot({}, {}, false, lib.salesListFilterReportScope(['1=1'], {}))
    const dara = await lib.readSalesReportSnapshot({}, {}, false, lib.salesListFilterReportScope(['1=1', 's.cashier_name LIKE @cashier'], { cashier: '%Dara%' }))
    assert.ok(dara.sales.length > 0 && dara.sales.length < all.sales.length)
    assert.ok(dara.sales.every((row) => row.cashier_name === 'Dara'))
  })

  await check('GET /stats builds its scope through salesListFilterReportScope', async () => {
    const src = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8')
    const block = src.match(/app\.get\('\/stats'[\s\S]*?\n\}\)/)?.[0] || ''
    assert.match(block, /readSalesReportSnapshot\(c\.env,\{\},false,salesListFilterReportScope\(where,params\)\)/)
    assert.ok(!/matched_sale/.test(block), 'the route must not build its own copy of the scope')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
