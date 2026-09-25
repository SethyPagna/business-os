// I4-4: the report's sale-item reader walks only the id band of the window.
//
// readSalesReportPass used to read items with a keyset walk driven from the
// sale_items rowid, probing `sales` per item -- every item ever sold, even for
// a one-day window. With a date/shift window it now reads the exact MIN/MAX
// item id of the matching sales first and walks only inside that band.
//
// Against every migration applied verbatim (real indexes), this proves:
//   1. identical item rows, in identical order, to the plain full walk for a
//      range of windows -- including an item ADDED LATER to an old sale (its
//      id sits far above its sale's other items; a band derived from sale
//      order instead of the exact MIN/MAX would drop it), an empty window, a
//      shift window, a branch filter and a list-filter scope;
//   2. the band read is used exactly when there is a date/shift window;
//   3. the band read's plan uses the date index and the covering item index.
//
// Run: node scripts/test-report-item-band-native.cjs

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

// --- fixture: 240 sales over 60 business days, 1-3 items each ----------
const insertSale = sql.prepare(`INSERT INTO sales (id, receipt_number, created_at, sale_status, branch_id, subtotal_usd, total_usd, cashier_id, cashier_name, payment_method)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'Cashier', 'Cash')`)
const insertItem = sql.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, total_usd, cost_price_usd)
  VALUES (?, ?, ?, ?, ?, 0.5)`)
let itemCount = 0
for (let i = 1; i <= 240; i += 1) {
  const day = String(1 + Math.floor((i - 1) / 4)).padStart(2, '0')
  const month = i <= 120 ? '07' : '08'
  const dayOfMonth = String(((Number(day) - 1) % 30) + 1).padStart(2, '0')
  const status = i % 17 === 0 ? 'cancelled' : 'completed'
  insertSale.run(i, `R${i}`, `2026-${month}-${dayOfMonth} 0${i % 10}:15:00`, status, 1 + (i % 2), 10, 10)
  for (let k = 0; k <= i % 3; k += 1) { insertItem.run(i, 100 + k, `P${k}`, 1 + k, 1 + k); itemCount += 1 }
}
// An item added LATER to an early sale (sale 5, 2026-07-02): highest id in the table.
insertItem.run(5, 999, 'Late amendment', 1, 3)
const lateItemId = sql.prepare('SELECT MAX(id) AS id FROM sale_items').get().id

const captured = []
function adapter(hook) {
  return { prepare(query) { const stmt = sql.prepare(query); return {
    all(params = {}) { hook(query); return stmt.all(params) },
    get(params = {}) { hook(query); return stmt.get(params) },
  } } }
}
const db = adapter((query) => captured.push(query))
const lib = load('src/lib/salesAnalytics.ts', {
  './db': { getDb: () => db },
  './removalLosses': load('src/lib/removalLosses.ts'),
  './businessDateWindow': load('src/lib/businessDateWindow.ts'),
  './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': load('src/lib/moneyPrecision.ts') }),
})

// The reference: the plain full walk over the whole table, no band.
function referenceItems(f, scopeSql = '', scopeParams = {}) {
  const primary = lib.whereActiveSales('s', f)
  const where = scopeSql ? `(${primary.sql}) AND (${scopeSql})` : primary.sql
  return sql.prepare(`SELECT si.id,si.sale_id,si.product_id,si.product_name,si.quantity,si.total_usd,si.cost_price_usd,si.product_discount_usd,si.manual_discount_usd
    FROM sale_items si WHERE EXISTS(SELECT 1 FROM sales s WHERE s.id=si.sale_id AND ${where}) ORDER BY si.id`).all({ ...primary.params, ...scopeParams })
}

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

;(async () => {
  const windows = [
    ['one business day', { startDate: '2026-07-03', endDate: '2026-07-03' }, true],
    ['30 days', { startDate: '2026-07-01', endDate: '2026-07-30' }, true],
    ['window holding the late-amended sale only', { startDate: '2026-07-02', endDate: '2026-07-02' }, true],
    ['start date only', { startDate: '2026-08-20' }, true],
    ['end date only', { endDate: '2026-07-05' }, true],
    ['empty window', { startDate: '2020-01-01', endDate: '2020-01-02' }, true],
    ['branch filter + window', { startDate: '2026-07-01', endDate: '2026-08-30', branchId: 2 }, true],
    ['cancelled status + window', { startDate: '2026-07-01', endDate: '2026-08-30', status: 'cancelled' }, true],
    ['shift window', { createdFrom: '2026-07-02 00:00:00', createdTo: '2026-07-04 00:00:00' }, true],
    ['all time (no window)', {}, false],
  ]
  for (const [label, f, banded] of windows) {
    await check(`identical items vs full walk: ${label}`, async () => {
      captured.length = 0
      const snapshot = await lib.readSalesReportSnapshot({}, f)
      const expected = referenceItems(f)
      assert.equal(JSON.stringify(snapshot.items), JSON.stringify(expected))
      if (label !== 'empty window') assert.ok(expected.length > 0, 'window must hold items or it proves nothing')
      const bandReads = captured.filter((q) => /MIN\(si\.id\) AS lo/.test(q)).length
      assert.equal(bandReads > 0, banded, `band read ${banded ? 'expected' : 'not expected'} (saw ${bandReads})`)
      if (banded && expected.length) assert.ok(captured.some((q) => /si\.id <= @reportItemIdMax/.test(q)), 'the walk must be bounded above')
    })
  }

  await check('the late-amended item is in its sale\'s window (discriminates a sale-order band)', async () => {
    const snapshot = await lib.readSalesReportSnapshot({}, { startDate: '2026-07-02', endDate: '2026-07-02' })
    const ids = snapshot.items.map((row) => row.id)
    assert.ok(ids.includes(lateItemId), `late item ${lateItemId} missing from ${ids}`)
    assert.ok(ids[ids.length - 1] - ids[0] > 50, 'fixture must put the late item far outside its sale\'s original band')
  })

  await check('list-filter scope + window: identical items', async () => {
    const scope = lib.salesListFilterReportScope(['1=1', 's.branch_id = @branchId'], { branchId: 1 })
    const f = { startDate: '2026-07-01', endDate: '2026-07-20' }
    const snapshot = await lib.readSalesReportSnapshot({}, f, false, scope)
    const captured1 = scope('s')
    assert.equal(JSON.stringify(snapshot.items), JSON.stringify(referenceItems(f, captured1.sql, captured1.params)))
  })

  await check('band read plan: date index for sales, covering item index for the band', async () => {
    const primary = lib.whereActiveSales('s', { startDate: '2026-07-03', endDate: '2026-07-03' })
    const plan = sql.prepare(`EXPLAIN QUERY PLAN SELECT MIN(si.id) AS lo, MAX(si.id) AS hi FROM sale_items si
      WHERE si.sale_id IN (SELECT s.id FROM sales s WHERE ${primary.sql})`).all(primary.params).map((r) => r.detail).join(' | ')
    assert.match(plan, /SEARCH s USING INDEX idx_sales_created/)
    assert.match(plan, /SEARCH si USING COVERING INDEX idx_sale_items_sale_id/)
  })

  assert.ok(itemCount > 400)
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
