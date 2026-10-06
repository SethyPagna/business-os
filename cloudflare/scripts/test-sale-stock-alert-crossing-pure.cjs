// NOTIF-V2: a sale writes a stock notification ONLY when it carries a product
// family into a worse stock state (lib/saleStockAlerts.ts).
//
// Runs the REAL statement against an in-memory SQLite database with every
// migration applied (so migration 0239 is exercised too), through the D1
// harness's atomic batch(). Only the module loader is local; nothing in the
// logic under test is reimplemented -- the oracle below is a SECOND, plain-JS
// statement of the Dashboard's best-status-wins rule used to check the SQL on a
// randomised sweep.
//
// What each case is discriminating against:
//   * the OLD bell listed every product at or under its threshold on every call
//     -> "already low stays silent" fails on any "is below" implementation;
//   * a per-ROW crossing (instead of the Dashboard's per-FAMILY rank) would
//     notify for a low variant whose sibling is healthy, a product the
//     Dashboard's Low stock card does not list;
//   * computing "before" from a second read after the commit would miss the
//     crossing when two sales race; here before = after + this batch's units.
//
// Run: node scripts/test-sale-stock-alert-crossing-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path.join(SRC, rel),
  }).outputText
  const mod = { exports: {} }
  modules.set(rel, mod)
  const localRequire = (request) => {
    if (request === './db') return { getDb: () => { throw new Error('getDb is not reachable from the pure paths under test') } }
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const alerts = load('lib/saleStockAlerts.ts')
const lowStockLib = load('lib/lowStockSettings.ts')

const checks = []
const check = (name, fn) => checks.push([name, fn])

const DEFAULT_CONFIG = { enabled: true, mode: 'product', threshold: 10 }
let db
let rawDb
function fresh() {
  db = openDb(loadAll())
  rawDb = db.db
}
function product(fields) {
  const row = { name: 'P', stock_quantity: 0, low_stock_threshold: 10, out_of_stock_threshold: 0, is_active: 1, is_group: 0, parent_id: null, ...fields }
  const info = rawDb.prepare(`INSERT INTO products (name, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active, is_group, parent_id, barcode)
    VALUES (@name, @stock_quantity, @low_stock_threshold, @out_of_stock_threshold, @is_active, @is_group, @parent_id, @barcode)`).run({ barcode: null, ...row })
  return Number(info.lastInsertRowid)
}
const events = () => rawDb.prepare('SELECT * FROM stock_alert_events ORDER BY id').all()
const stock = (id) => rawDb.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(id).stock_quantity

// One sale batch, shaped like the routes: the alert INSERT goes in AHEAD of the first stock statement (insertStockAlertStatement),
// the deductions clamp the rollup at 0 exactly as routes/sales.ts does for units taken.
async function sell(lines, { config = DEFAULT_CONFIG, sale = { saleId: 1 }, failAfter = false } = {}) {
  const statements = lines.map((line) => ({
    sql: line.quantity > 0
      ? 'UPDATE products SET stock_quantity = MAX(0, stock_quantity - @quantity) WHERE id = @id'
      : 'UPDATE products SET stock_quantity = stock_quantity - @quantity WHERE id = @id',
    params: { id: line.product_id, quantity: line.quantity },
  }))
  alerts.insertStockAlertStatement(statements, 0, alerts.planSaleStockAlertStatement({ lines, lowStock: config, sale }))
  if (failAfter) statements.push({ sql: 'INSERT INTO no_such_table VALUES (1)', params: {} })
  const before = events().length
  await db.batch(statements)
  return events().slice(before)
}
const L = (product_id, quantity, branch_id = 1) => ({ product_id, branch_id, quantity })

check('above -> low notifies once, with the family quantity left', async () => {
  fresh()
  const a = product({ name: 'Serum', stock_quantity: 12 })
  const created = await sell([L(a, 3)])
  assert.equal(created.length, 1)
  assert.equal(created[0].alert_state, 'low')
  assert.equal(created[0].product_id, a)
  assert.equal(created[0].quantity_after, 9)
  assert.equal(created[0].sale_id, 1)
  assert.equal(created[0].branch_name, null, 'this fixture has no branches row to name')
})

check('the table carries NO branch id column: the branch cutover refuses unclassified *_branch_id columns', () => {
  fresh()
  const columns = rawDb.prepare('PRAGMA table_info(stock_alert_events)').all().map((column) => column.name)
  assert.deepEqual(columns.filter((name) => name === 'branch_id' || name.endsWith('_branch_id')), [], columns.join(','))
  assert.ok(columns.includes('branch_name'), 'the branch is a name snapshot')
})

check('the threshold itself is low (qty <= threshold), one unit above is not', async () => {
  fresh()
  const above = product({ name: 'Above', stock_quantity: 12 })
  assert.equal((await sell([L(above, 1)])).length, 0, '12 -> 11 stays healthy')
  const edge = product({ name: 'Edge', stock_quantity: 11 })
  const created = await sell([L(edge, 1)])
  assert.equal(created.length, 1, '11 -> 10 reaches the threshold and crosses')
  assert.equal(created[0].alert_state, 'low')
})

check('low -> lower low stays silent; low -> out notifies; out cannot notify twice', async () => {
  fresh()
  const a = product({ name: 'Cream', stock_quantity: 8 })
  assert.equal((await sell([L(a, 2)])).length, 0, 'already low: a later sale does not re-notify')
  assert.equal((await sell([L(a, 2)])).length, 0)
  const out = await sell([L(a, 4)])
  assert.equal(out.length, 1)
  assert.equal(out[0].alert_state, 'out')
  assert.equal(stock(a), 0)
  // The sale of an already-out product cannot happen in the till, but the statement must still be inert.
  assert.equal((await sell([L(a, 1)])).length, 0, 'out -> out is not a crossing')
})

check('healthy -> out in one sale is ONE out event, not a low and an out', async () => {
  fresh()
  const a = product({ name: 'Mask', stock_quantity: 30 })
  const created = await sell([L(a, 30)])
  assert.deepEqual(created.map((row) => row.alert_state), ['out'])
})

check('restock re-arms: the next crossing notifies again', async () => {
  fresh()
  const a = product({ name: 'Toner', stock_quantity: 12 })
  assert.equal((await sell([L(a, 5)])).length, 1, 'first crossing')
  assert.equal((await sell([L(a, 1)])).length, 0, 'still low')
  rawDb.prepare('UPDATE products SET stock_quantity = 40 WHERE id = ?').run(a)
  const again = await sell([L(a, 32)])
  assert.equal(again.length, 1, 'restocked above the threshold, so selling back down is a new crossing')
  assert.equal(again[0].alert_state, 'low')
  assert.equal(events().length, 2)
})

check('a per-product out-of-stock threshold decides "out", not zero', async () => {
  fresh()
  const a = product({ name: 'Perfume', stock_quantity: 5, out_of_stock_threshold: 2 })
  const created = await sell([L(a, 3)])
  assert.equal(created.length, 1)
  assert.equal(created[0].alert_state, 'out', '5 (low) -> 2 is at the out threshold 2')
})

check('a sibling in the same name family keeps the family healthy: no event for a row the Dashboard does not list', async () => {
  fresh()
  const low = product({ name: 'Lipstick', barcode: 'A', stock_quantity: 3 })
  const healthy = product({ name: 'Lipstick', barcode: 'B', stock_quantity: 20 })
  assert.equal((await sell([L(low, 3)])).length, 0, 'the 3 -> 0 row is out, but the family is healthy via its sibling')
  const created = await sell([L(healthy, 18)])
  assert.equal(created.length, 1, 'now the last healthy row drops to 2: the family crosses healthy -> low')
  assert.equal(created[0].alert_state, 'low')
  assert.equal(created[0].product_id, healthy)
  assert.equal(created[0].quantity_after, 2, 'family quantity (0 + 2), as the Dashboard card shows it')
  const out = await sell([L(healthy, 2)])
  assert.deepEqual(out.map((row) => row.alert_state), ['out'])
})

check('two lines of one product and two products of one family are one crossing', async () => {
  fresh()
  const a = product({ name: 'Soap', barcode: 'A', stock_quantity: 14 })
  const b = product({ name: 'Soap', barcode: 'B', stock_quantity: 0 })
  const split = await sell([L(a, 2), L(a, 2)])
  assert.equal(split.length, 1, 'merged: 14 -> 10 is one crossing')
  fresh()
  const c = product({ name: 'Soap', barcode: 'A', stock_quantity: 14 })
  const d = product({ name: 'Soap', barcode: 'B', stock_quantity: 14 })
  const family = await sell([L(c, 5), L(d, 5)])
  assert.equal(family.length, 1, 'one family, one event, not one per row')
  assert.equal(family[0].quantity_after, 18)
  assert.equal(family[0].alert_state, 'low')
  void a; void b
})

check('a parent-linked variant family is classified together', async () => {
  fresh()
  const parent = product({ name: 'Palette', is_group: 1, stock_quantity: 0 })
  const red = product({ name: 'Palette Red', parent_id: parent, stock_quantity: 11 })
  product({ name: 'Palette Blue', parent_id: parent, stock_quantity: 40 })
  assert.equal((await sell([L(red, 5)])).length, 0, 'Blue keeps the family healthy even though Red is now low')
})

check('alerts switched off: only out-of-stock crosses', async () => {
  fresh()
  const config = { enabled: false, mode: 'product', threshold: 10 }
  const a = product({ name: 'Gloss', stock_quantity: 12 })
  assert.equal((await sell([L(a, 10)], { config })).length, 0, '12 -> 2 is not an alert with the low alert off')
  const out = await sell([L(a, 2)], { config })
  assert.deepEqual(out.map((row) => row.alert_state), ['out'])
})

check('global threshold mode overrides the per-product column', async () => {
  fresh()
  const config = { enabled: true, mode: 'global', threshold: 20 }
  const a = product({ name: 'Wash', stock_quantity: 25, low_stock_threshold: 3 })
  const created = await sell([L(a, 6)], { config })
  assert.equal(created.length, 1, '25 -> 19 crosses the global 20 although the row says 3')
  assert.equal(created[0].alert_state, 'low')
})

check('the sale is found by its write key inside the creating batch', async () => {
  fresh()
  rawDb.prepare(`INSERT INTO sales (id, receipt_number, client_request_id) VALUES (77, 'R-77', 'write-key-77')`).run()
  const a = product({ name: 'Brush', stock_quantity: 11 })
  const created = await sell([L(a, 1)], { sale: { saleWriteKey: 'write-key-77' } })
  assert.equal(created[0].sale_id, 77)
})

check('a rolled-back sale leaves no event', async () => {
  fresh()
  const a = product({ name: 'Comb', stock_quantity: 11 })
  await assert.rejects(() => sell([L(a, 1)], { failAfter: true }))
  assert.equal(events().length, 0)
  assert.equal(stock(a), 11, 'the deduction rolled back with it')
})

check('a rollup the clamp held at 0 is not a crossing: it was already out and stays out', async () => {
  fresh()
  // products.stock_quantity drifted to 0 while a branch still holds units; the sale of 3 is clamped at 0.
  const a = product({ name: 'Drifted', stock_quantity: 0 })
  const created = await sell([L(a, 3)])
  assert.deepEqual(created, [], 'already out (rollup 0) -> still out: nothing happened to the card, nothing is announced')
  assert.equal(stock(a), 0)
  const b = product({ name: 'Short Rollup', stock_quantity: 2 })
  const crossed = await sell([L(b, 5)])
  assert.equal(crossed.length, 1, 'rollup 2 (low) taken to 0 by a larger sale is a real low -> out crossing')
  assert.equal(crossed[0].alert_state, 'out')
})

check('a replace that gives one product back and takes another nets per product', async () => {
  fresh()
  const give = product({ name: 'Given Back', stock_quantity: 4 })
  const take = product({ name: 'Taken', stock_quantity: 12 })
  const created = await sell([L(give, -6), L(take, 3)])
  assert.deepEqual(created.map((row) => [row.product_name, row.alert_state]), [['Taken', 'low']])
  assert.equal(stock(give), 10)
})

check('insertStockAlertStatement puts the alert ahead of the stock block and leaves earlier statements where they were', () => {
  const list = [{ sql: 'a', params: {} }, { sql: 'b', params: {} }, { sql: 'stock', params: {} }]
  alerts.insertStockAlertStatement(list, 2, { sql: 'alert', params: {} })
  assert.deepEqual(list.map((statement) => statement.sql), ['a', 'b', 'alert', 'stock'])
  alerts.insertStockAlertStatement(list, 0, null)
  assert.equal(list.length, 4, 'no alert, no change')
})

check('no sold lines, no statement', () => {
  assert.equal(alerts.planSaleStockAlertStatement({ lines: [], lowStock: DEFAULT_CONFIG, sale: { saleId: 1 } }), null)
  assert.equal(alerts.planSaleStockAlertStatement({ lines: [{ product_id: 5, branch_id: 1, quantity: 0 }], lowStock: DEFAULT_CONFIG, sale: { saleId: 1 } }), null)
})

check('one statement and three bound values however many products the sale carries', () => {
  const lines = Array.from({ length: 400 }, (_, index) => L(index + 1, 1))
  const statement = alerts.planSaleStockAlertStatement({ lines, lowStock: DEFAULT_CONFIG, sale: { saleId: 9 } })
  assert.ok(statement)
  assert.deepEqual(Object.keys(statement.params).sort(), ['alert_lines', 'alert_sale_id'])
  assert.equal(JSON.parse(statement.params.alert_lines).length, 400)
  assert.ok(!statement.sql.includes('\r'))
})

check('the statement reaches the families through indexes, never a scan of products', async () => {
  fresh()
  const a = product({ name: 'Serum', stock_quantity: 12 })
  const statement = alerts.planSaleStockAlertStatement({ lines: [L(a, 3)], lowStock: DEFAULT_CONFIG, sale: { saleId: 1 } })
  const plan = rawDb.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all({ alert_lines: statement.params.alert_lines, alert_sale_id: 1 }).map((row) => row.detail)
  // Every touch of a products alias must be a key probe: the primary key, name_key or parent_id. A SCAN, or a SEARCH through
  // any other index (idx_products_active_grouped_pg walked every active product before the CROSS JOIN pin), reads the catalog.
  const productTouches = plan.filter((detail) => /^(SCAN|SEARCH) (products|p|c|par|parent)\b/.test(detail))
  assert.ok(productTouches.length >= 4, `the plan names the products probes:\n${plan.join('\n')}`)
  const wide = productTouches.filter((detail) => /^SCAN\b/.test(detail) || !/\((rowid|name_key|parent_id)=\?\)/.test(detail))
  assert.deepEqual(wide, [], `no product is reached except by key; plan was:\n${plan.join('\n')}`)
  assert.ok(!plan.some((detail) => /AUTOMATIC .*INDEX \(id=\?\)/.test(detail)), 'no automatic index is built over the candidate list')
})

// ---- the bell's feed ---------------------------------------------------------------------------------
const feed = (config = DEFAULT_CONFIG, since = '2000-01-01 00:00:00') =>
  rawDb.prepare(alerts.stockAlertFeedSql(config)).all({ since, limit: 50 })

check('feed: newest event per family, out before low, only while the family is still in that state', async () => {
  fresh()
  const low = product({ name: 'Low One', stock_quantity: 12 })
  const out = product({ name: 'Out One', stock_quantity: 12 })
  const worse = product({ name: 'Worse', stock_quantity: 12 })
  await sell([L(low, 4)])
  await sell([L(out, 12)])
  await sell([L(worse, 4)])
  await sell([L(worse, 8)])
  const rows = feed()
  assert.deepEqual(rows.map((row) => [row.product_name, row.alert_state]), [['Worse', 'out'], ['Out One', 'out'], ['Low One', 'low']],
    'Worse shows only its newest (out) event; out rows first, newest first')
  assert.equal(rows[0].matched_total, 3)
  assert.equal(rows[0].out_total, 2)
  rawDb.prepare('UPDATE products SET stock_quantity = 50 WHERE id = ?').run(low)
  assert.deepEqual(feed().map((row) => row.product_name), ['Worse', 'Out One'], 'a restocked family drops out of the feed')
})

check('feed: a manual adjustment cannot create an event, and an event the family has moved on from is hidden', async () => {
  fresh()
  const a = product({ name: 'Adjusted', stock_quantity: 12 })
  await sell([L(a, 4)])
  rawDb.prepare('UPDATE products SET stock_quantity = 0 WHERE id = ?').run(a)
  assert.equal(events().length, 1, 'the manual zero wrote nothing')
  assert.deepEqual(feed(), [], 'the low event no longer describes a family that is now out')
})

check('feed: the window hides old events and carries receipt and branch names', async () => {
  fresh()
  rawDb.prepare(`INSERT INTO branches (id, name) VALUES (1, 'Main Store')`).run()
  rawDb.prepare(`INSERT INTO sales (id, receipt_number) VALUES (1, 'R-1')`).run()
  const a = product({ name: 'Dated', stock_quantity: 12 })
  await sell([L(a, 4)])
  const [row] = feed()
  assert.equal(row.receipt_number, 'R-1')
  assert.equal(row.branch_name, 'Main Store')
  rawDb.prepare("UPDATE branches SET name = 'Renamed Later' WHERE id = 1").run()
  assert.equal(feed()[0].branch_name, 'Main Store', 'the label is the snapshot taken at the sale, not a live join')
  assert.equal(row.total_now, 8)
  assert.deepEqual(feed(DEFAULT_CONFIG, '2999-01-01 00:00:00'), [], 'since is a hard lower bound')
})

// ---- randomised sweep against the plain-JS oracle ----------------------------------------------------
function oracleRank(members) {
  const healthy = members.some((m) => m.qty > m.out && m.qty > m.low)
  if (healthy) return 2
  return members.some((m) => m.qty > m.out && m.qty <= m.low) ? 1 : 0
}
check('randomised sweep: the SQL agrees with the plain-JS rule on 300 sales', async () => {
  fresh()
  let seed = 20261006
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps']
  const rows = []
  for (const name of names) {
    for (let k = 0; k < 1 + rand(3); k += 1) {
      const stockQty = 5 + rand(30)
      const low = [10, 4, 15][rand(3)]
      const out = [0, 0, 2][rand(3)]
      rows.push({ id: product({ name, barcode: `${name}${k}`, stock_quantity: stockQty, low_stock_threshold: low, out_of_stock_threshold: out }), name, low, out })
    }
  }
  let expectedEvents = 0
  for (let step = 0; step < 300; step += 1) {
    const target = rows[rand(rows.length)]
    if (rand(7) === 0) { rawDb.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(10 + rand(40), target.id); continue }
    const have = stock(target.id)
    if (have <= 0) continue
    const qty = 1 + rand(Math.min(have, 9))
    const family = rows.filter((row) => row.name === target.name)
    const snapshot = (adjust) => family.map((row) => ({ qty: stock(row.id) + (row.id === target.id ? adjust : 0), out: row.out, low: row.low }))
    const rankBefore = oracleRank(snapshot(0))
    const rankAfter = oracleRank(snapshot(-qty))
    const created = await sell([L(target.id, qty)])
    if (rankAfter < rankBefore) {
      expectedEvents += 1
      assert.equal(created.length, 1, `step ${step}: ${target.name} rank ${rankBefore} -> ${rankAfter} must notify`)
      assert.equal(created[0].alert_state, rankAfter === 0 ? 'out' : 'low')
    } else {
      assert.equal(created.length, 0, `step ${step}: ${target.name} rank ${rankBefore} -> ${rankAfter} must stay silent`)
    }
  }
  assert.ok(expectedEvents > 10, `the sweep must actually cross (saw ${expectedEvents})`)
})

// ---- structure ---------------------------------------------------------------------------------------
check('only the sale routes write stock alerts, and migration 0239 is the single claim on its number', () => {
  const callers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(path.join(dir, entry.name)); continue }
      if (!entry.name.endsWith('.ts')) continue
      const full = path.join(dir, entry.name)
      if (entry.name === 'saleStockAlerts.ts') continue
      if (/planSaleStockAlertStatement|INSERT INTO stock_alert_events/.test(fs.readFileSync(full, 'utf8'))) callers.push(path.relative(SRC, full).replaceAll('\\', '/'))
    }
  }
  walk(SRC)
  // The sale writers (the full classification of every stock writer lives in test-sale-stock-alert-writers-pure.cjs): POS
  // create / status / add-items / amendments, bulk status and its replay, the redo of added items, and a return exchange's replacement sale.
  assert.deepEqual(callers.sort(), ['lib/saleBulkStatus.ts', 'lib/undoAppliers.ts', 'routes/returns.ts', 'routes/sales.ts'].sort(),
    'stock adjustments, transfers and imports must not write alerts; only sale writers do')
  const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter((f) => f.startsWith('0239'))
  assert.deepEqual(migrations, ['0239_stock_alert_events.sql'])
  assert.ok(!fs.readFileSync(path.join(__dirname, '../migrations/0239_stock_alert_events.sql'), 'utf8').includes('\r'), '0239 is LF-only')
  assert.equal(alerts.STOCK_ALERT_WINDOW_DAYS < alerts.STOCK_ALERT_RETENTION_DAYS, true)
  void lowStockLib
})

;(async () => {
  let failed = 0
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`) }
  }
  if (failed) { console.log(`\n${failed} of ${checks.length} failed`); process.exit(1) }
  console.log(`\nall ${checks.length} checks passed`)
})()
