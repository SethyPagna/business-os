// NOTIF-V2: every writer that takes SELLABLE stock out of the shelf either records exactly one stock_alert_events
// crossing or is deliberately excluded by the owner's rule ("when a sale makes the stock low or out" -- sales only;
// manual adjustments, transfers, imports and maintenance never notify).
//
//   A. THE REGISTRY. Every source file that writes branch_stock / products.stock_quantity / lot stock is listed below
//      with its verdict. The scan finds the files; a file that is not in the registry fails the test, so a new stock
//      writer cannot ship without somebody deciding which side of the rule it is on. Sale writers must contain the
//      alert call sites the registry names; excluded writers must contain none.
//   B. THE REPLAYS. The redo of added sale items re-takes stock and records a crossing (atomic server-managed path and
//      the legacy snapshot path); the undo, which gives stock back, records none.
//
// (The status change, bulk status and its replay, add-items, amendments and the return exchange are driven in
//  test-sale-stock-alert-crossing-pure.cjs, test-sale-bulk-status-pure.cjs and test-return-exchange-stock-alert-native.cjs.)
//
// Run: node scripts/test-sale-stock-alert-writers-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const SRC = path.join(__dirname, '..', 'src')

// ---------------------------------------------------------------------------------------------------------------
// A. the registry
// ---------------------------------------------------------------------------------------------------------------
// `sale`: the file builds a SALE batch; `alerts` is how many planSaleStockAlertStatement( call sites it must hold.
// `kernel`: statement builders only; the sale callers above own the alert. `excluded`: not a sale, with the reason.
const REGISTRY = {
  'routes/sales.ts': { verdict: 'sale', alerts: 4, what: 'POS create, status change that deducts (un-cancel), add-items, amendments (quantity up, line add, replace)' },
  'lib/saleBulkStatus.ts': { verdict: 'sale', alerts: 1, what: 'bulk status apply and its undo/redo replay (one planStockAlert helper for both)' },
  // One planner helper (loaded on demand), called by both redo replays.
  'lib/undoAppliers.ts': { verdict: 'sale', alerts: 1, helperCalls: 2, what: 'REDO of added sale items: atomic server-managed replay and the legacy snapshot replay' },
  'routes/returns.ts': { verdict: 'sale', alerts: 1, what: 'return EXCHANGE: the replacement sale hands stock to the customer (plain returns only restock)' },

  'lib/saleTransitions.ts': { verdict: 'kernel', what: 'status-transition statements; planned by routes/sales.ts and lib/saleBulkStatus.ts' },
  'lib/saleLineAddition.ts': { verdict: 'kernel', what: 'add-items statements; planned by routes/sales.ts and lib/undoAppliers.ts' },
  'lib/saleAmendments.ts': { verdict: 'kernel', what: 'amendment statements; planned by routes/sales.ts' },
  'lib/returnsStock.ts': { verdict: 'kernel', what: 'replacement-stock statements; planned by routes/returns.ts' },
  'lib/productBatches.ts': { verdict: 'kernel', what: 'lot decrement helpers used by every deducting writer, sale and manual alike' },

  'lib/stockSession.ts': { verdict: 'excluded', why: 'manual Add / Remove / Set stock session' },
  'lib/stockActionCommit.ts': { verdict: 'excluded', why: 'unified stock import (receipts)' },
  'lib/stockLotAdjustment.ts': { verdict: 'excluded', why: 'manual lot adjustment' },
  'lib/stockInLineEdit.ts': { verdict: 'excluded', why: 'correction of a stock-in receipt' },
  'lib/stockRevert.ts': { verdict: 'excluded', why: 'Revert of a stock record: a compensating record, not a sale' },
  'lib/transferOperation.ts': { verdict: 'excluded', why: 'branch transfer (owner: transfers do not trigger)' },
  'routes/branches.ts': { verdict: 'excluded', why: 'branch transfer route' },
  'routes/inventory.ts': { verdict: 'excluded', why: 'manual stock adjust / remove (owner: manual adjustments do not trigger)' },
  'routes/products.ts': { verdict: 'excluded', why: 'product editor stock fields and manual stock writes' },
  'lib/productWrites.ts': { verdict: 'excluded', why: 'product create / edit stock fields' },
  'lib/productDelete.ts': { verdict: 'excluded', why: 'product removal zeroes its stock' },
  'lib/damagedLotActions.ts': { verdict: 'excluded', why: 'damaged-lot disposal (manual)' },
  'lib/datedStockCountApply.ts': { verdict: 'excluded', why: 'dated stock-count apply (inventory count)' },
  'lib/importEngine.ts': { verdict: 'excluded', why: 'product / stock import' },
  'lib/salesImportCommit.ts': { verdict: 'excluded', why: 'historical sales import: no live shelf moves, imports never notify' },
  'lib/returnBulkAction.ts': { verdict: 'excluded', why: 'return status replay: restock / reversal of a return, not a sale' },
  'lib/saleNotPaidStockRecovery.ts': { verdict: 'excluded', why: 'one-off maintenance repair behind a typed confirmation (system route)' },
  'routes/system.ts': { verdict: 'excluded', why: 'reset / repair / restore maintenance' },
  'lib/coreDataInvariants.ts': { verdict: 'excluded', why: 'reset / invariant maintenance statements' },
  'lib/dataIntegrity.ts': { verdict: 'excluded', why: 'integrity repair' },
}

const WRITES_STOCK = [
  /UPDATE branch_stock/, /INSERT INTO branch_stock/, /INSERT OR IGNORE INTO branch_stock/,
  /UPDATE products\s+SET\s+stock_quantity/, /decrementBatchStockStrictStatement\(/, /planRemoveStockFromBatch\(/, /UPDATE branch_batch_stock/,
]
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}
const rel = (file) => path.relative(SRC, file).split(path.sep).join('/')
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8')
const countAlerts = (text) => (text.match(/planSaleStockAlertStatement\(/g) || []).length

const scanned = walk(SRC).map(rel).filter((file) => WRITES_STOCK.some((pattern) => pattern.test(read(file)))).sort()
const registered = Object.keys(REGISTRY).sort()
const unclassified = scanned.filter((file) => !REGISTRY[file] && file !== 'lib/saleStockAlerts.ts')
assert.deepEqual(unclassified, [], `a stock writer is not classified (sale / kernel / excluded) in this test's REGISTRY:\n  ${unclassified.join('\n  ')}`)
const stale = registered.filter((file) => !fs.existsSync(path.join(SRC, file)))
assert.deepEqual(stale, [], 'the registry names a file that no longer exists')
console.log(`PASS A1 every one of the ${scanned.length} stock-writing source files is classified (${registered.length} registered)`)

for (const [file, entry] of Object.entries(REGISTRY)) {
  const alerts = countAlerts(read(file))
  if (entry.verdict === 'sale') {
    assert.equal(alerts, entry.alerts, `${file}: ${entry.what} -- expected ${entry.alerts} alert call site(s), found ${alerts}`)
    if (entry.helperCalls) assert.equal((read(file).match(/planRedoStockAlert\(ctx\.env/g) || []).length, entry.helperCalls, `${file}: both redo replays must call the helper`)
  }
  else assert.equal(alerts, 0, `${file} is ${entry.verdict} but records stock alerts`)
}
console.log('PASS A2 sale writers hold exactly the registered alert call sites; kernels and excluded writers hold none')

// A deducting PLANNER may only be called from a file registered as a sale writer: nobody can start taking sale stock
// through saleTransitions / saleLineAddition / saleAmendments without also owning the alert.
const PLANNERS = /\b(planSaleStockTransition|planSaleLineAddition|planLineQuantityIncrease|planReplacementStock)\(/
const callers = walk(SRC).map(rel).filter((file) => !/^lib\/(saleTransitions|saleLineAddition|saleAmendments|returnsStock)\.ts$/.test(file))
  .filter((file) => PLANNERS.test(read(file).replace(/\/\/.*$/gm, '')))
const strangers = callers.filter((file) => REGISTRY[file]?.verdict !== 'sale')
assert.deepEqual(strangers, [], `a deducting planner is called from a file that is not a registered sale writer: ${strangers.join(', ')}`)
console.log(`PASS A3 deducting planners are called only from registered sale writers (${callers.join(', ')})`)

// Placement: in every in-batch site the alert statement is queued BEFORE the stock statements it reads against.
{
  const sales = read('routes/sales.ts')
  assert.match(sales, /insertStockAlertStatement\(statements, stockAlertStart,/, 'create and amendments splice the alert ahead of the first stock statement')
  assert.match(sales, /statementsForPlan\.unshift\(addItemsStockAlert\)/, 'add-items leads the plan with the alert')
  assert.ok(sales.indexOf('if (stockAlert) statements.push(stockAlert)') < sales.indexOf('statements.push(...plan.statements)', sales.indexOf('if (stockAlert) statements.push(stockAlert)') - 400),
    'the status change pushes the alert before plan.statements')
  const bulk = read('lib/saleBulkStatus.ts')
  assert.ok(bulk.indexOf('statements.push(stockAlert)') < bulk.indexOf('statements.push(...memberStatements(m, 1, user, stamp))', bulk.indexOf('const stockAlert = await planStockAlert(env, members, 1)')), 'bulk apply: alert first')
  assert.ok(bulk.indexOf('statements.push(replayAlert)') < bulk.indexOf('statements.push(...memberStatements(m, sign, user, stamp))', bulk.indexOf('const replayAlert')), 'bulk replay: alert first')
  const undo = read('lib/undoAppliers.ts')
  assert.ok(undo.indexOf('statements.push(redoStockAlert)') < undo.indexOf('for (const [statementIndex, statement] of plan.statements.entries())', undo.indexOf('const redoStockAlert')), 'atomic redo: alert before the plan statements')
  assert.ok(undo.indexOf('legacyRedoAlert ? [legacyRedoAlert]') < undo.indexOf('...plan.statements,', undo.indexOf('const legacyRedoAlert')), 'legacy redo: alert before the plan statements')
  const returns = read('routes/returns.ts')
  assert.ok(returns.indexOf('if (exchangeAlert) statements.push(exchangeAlert)') < returns.indexOf('const replacementPlan = planReplacementStock('), 'exchange: alert before the replacement stock statements')
  console.log('PASS A4 every in-batch site queues the alert ahead of the stock statements it reads against')
}

// ---------------------------------------------------------------------------------------------------------------
// B. redo of added sale items re-takes stock and records the crossing; undo records none
// ---------------------------------------------------------------------------------------------------------------
async function atomicRedo() {
  // The real create/add routes and the real server-managed replay over a migrated schema (same harness as
  // test-sale-money-writers-native.cjs): the add crosses, the undo gives units back, the redo takes them again.
  const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
  const source = fs.readFileSync(file, 'utf8')
  const boundary = source.indexOf(';(async () => {')
  assert.ok(boundary > 0)
  const harness = new Module(file, module); harness.filename = file; harness.paths = module.paths
  harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
    + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,setUser(value){currentUser=value},load};', file)
  const h = harness.exports
  const kernel = h.load('lib/moneyPrecision.ts')
  const intent = (key, base, quantity) => {
    const gross = kernel.multiplyMoney4(base, quantity)
    return { product_id: 10, quantity, branch_id: 1, batch_id: 500, client_line_key: key, pricing_source: 'manual', selling_price_input_usd: base,
      manual_discount_type: null, manual_discount_value: 0,
      pricing_quote: { gross_usd: gross, product_discount_usd: 0, manual_discount_usd: 0, total_usd: gross, total_khr: kernel.multiplyMoney4(gross, 4000) } }
  }
  const originalRequest = h.request
  h.request = (id) => ({ ...originalRequest(id), items: [intent(`${id}-line`, 9.5, 1)] })
  h.setUser({ ...h.USER, permissions: '{"all":true,"product_cost_view":true}' })
  const f = h.fixture()
  // Powder: 10 on hand, low at 5. The sale of 1 leaves 9 (healthy); the add of 4 takes it to 5 (low).
  f.raw.prepare('UPDATE products SET low_stock_threshold = 5, out_of_stock_threshold = 0 WHERE id = 10').run()
  const sale = await h.postSale(f.route, { ...h.request('writers-sale'), money_precision_version: 1 })
  assert.equal(sale.status, 200, JSON.stringify(sale.body))
  const events = () => f.raw.prepare('SELECT alert_state, quantity_after, sale_id FROM stock_alert_events ORDER BY id').all().map((row) => ({ ...row }))
  const stock = () => f.raw.prepare('SELECT stock_quantity AS n FROM products WHERE id = 10').get().n
  assert.equal(stock(), 9)
  assert.deepEqual(events(), [], 'the opening sale leaves the family healthy: nothing recorded')

  const requestAdd = async (payload) => {
    const response = await h.app.request(`/${sale.body.id}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, { DB: f.route }, h.executionCtx)
    return { status: response.status, body: await response.json() }
  }
  // The harness quotes the header first (a 409 review) exactly as the sibling test's client does.
  let added = await requestAdd({ money_precision_version: 1, client_request_id: 'writers-add', expected_exchange_rate: 4000, items: [intent('writers-add-line', 1, 4)] })
  if (added.status === 409 && added.body.code === 'sale_header_quote_conflict') {
    added = await requestAdd({ money_precision_version: 1, client_request_id: 'writers-add', expected_exchange_rate: 4000, expected_header_quote: added.body.header_quote, items: [intent('writers-add-line', 1, 4)] })
  }
  assert.equal(added.status, 200, JSON.stringify(added.body))
  assert.equal(stock(), 5)
  assert.deepEqual(events().map((row) => [row.alert_state, row.quantity_after]), [['low', 5]], 'the add itself crosses healthy -> low: one event')

  const replay = async (direction) => {
    const history = f.raw.prepare('SELECT * FROM action_history WHERE id = @id').get({ id: added.body.actionHistoryId })
    const payload = JSON.parse(history[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
    await h.load('lib/undoAppliers.ts').resolveUndoApplier(payload).run(payload, {
      env: { DB: f.route }, user: { ...h.USER, permissions: '{"all":true}' }, direction, historyId: history.id, generation: payload.generation,
    })
  }
  await replay('undo')
  assert.equal(stock(), 9, 'the undo gave the units back')
  assert.equal(events().length, 1, 'giving stock back records no crossing')
  await replay('redo')
  assert.equal(stock(), 5, 'the redo took them again')
  assert.deepEqual(events().map((row) => [row.alert_state, row.quantity_after, row.sale_id]), [['low', 5, sale.body.id], ['low', 5, sale.body.id]],
    'the redo carries the family healthy -> low again: exactly one NEW crossing, on the same sale')
  await replay('undo')
  assert.equal(events().length, 2, 'a second undo records nothing either')
  console.log('PASS B1 atomic add-items: the add crosses once, the undo records none, the redo records the new crossing')
}

async function legacyRedo() {
  const { openDb } = require('./harness/d1compat.cjs')
  const { loadAll } = require('./harness/load_migrations.cjs')
  const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')
  const d1 = openDb(loadAll())
  const { undoAppliers } = loadUndoAppliers(d1, { realSaleModules: true })
  const run = (sql, params) => d1.db.prepare(sql).run(params == null ? {} : params)
  const get = (sql, params) => d1.db.prepare(sql).get(params == null ? {} : params)
  const RATE = 4000
  const SALE = 77
  run("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)")
  // Serum: 8 on hand now (the 5 added units are already out), low at 8.
  run("INSERT INTO products (id, name, is_active, stock_quantity, low_stock_threshold, out_of_stock_threshold) VALUES (100, 'Serum', 1, 8, 8, 0)")
  run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (100, 1, 8)')
  run(`INSERT INTO sales (id, receipt_number, sale_status, branch_id, subtotal_usd, subtotal_khr, total_usd, total_khr, change_usd, change_khr, exchange_rate, money_precision_version)
    VALUES (${SALE}, 'R-77', 'completed', 1, 35, ${35 * RATE}, 35, ${35 * RATE}, 0, 0, ${RATE}, 0)`)
  run(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, applied_price_usd, total_usd, branch_id) VALUES (${SALE}, 100, 'Serum', 1, 10, 10, 1)`)
  const added = Number(run(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, applied_price_usd, total_usd, branch_id) VALUES (${SALE}, 100, 'Serum', 5, 5, 25, 1)`).lastInsertRowid)
  const money = (usd) => ({ subtotal_usd: usd, subtotal_khr: usd * RATE, total_usd: usd, total_khr: usd * RATE, change_usd: 0, change_khr: 0 })
  const reversal = {
    saleId: SALE, receiptNumber: 'R-77', saleStatus: 'completed', exchangeRate: RATE, moneyBefore: money(10), moneyAfter: money(35),
    lines: [{ saleItemId: added, productId: 100, productName: 'Serum', quantity: 5, branchId: 1, heldUnits: 5, unitPriceUsd: 5, lineTotalUsd: 25, costPriceUsd: null, costPriceKhr: null, takes: [] }],
  }
  const snapshotId = Number(run("INSERT INTO undo_snapshots (kind, status, payload_json) VALUES ('sale.add_items', 'applied', @p)", { p: JSON.stringify(reversal) }).lastInsertRowid)
  const replay = (direction) => {
    const payload = { applier: 'sale.add_items', snapshot_id: snapshotId }
    return undoAppliers.resolveUndoApplier(payload).run(payload, { env: {}, user: { id: 1, username: 'u', name: 'U', permissions: '{"all":true}' }, direction, historyId: 1 })
  }
  const events = () => d1.db.prepare('SELECT alert_state, quantity_after, sale_id FROM stock_alert_events ORDER BY id').all().map((row) => ({ ...row }))
  const stock = () => get('SELECT stock_quantity AS n FROM products WHERE id = 100').n
  await replay('undo')
  assert.equal(stock(), 13, 'the legacy undo gave the 5 units back (8 -> 13: healthy again)')
  assert.deepEqual(events(), [], 'the undo records nothing')
  await replay('redo')
  assert.equal(stock(), 8, 'the legacy redo took them again')
  assert.deepEqual(events().map((row) => [row.alert_state, row.quantity_after, row.sale_id]), [['low', 8, SALE]], 'the legacy redo records the healthy -> low crossing on its sale')
  console.log('PASS B2 legacy add-items snapshot: the undo records none, the redo records the crossing')
}

;(async () => {
  await atomicRedo()
  await legacyRedo()
  console.log('\nall sale-writer stock-alert checks passed')
})().catch((error) => { console.error(error); process.exit(1) })
