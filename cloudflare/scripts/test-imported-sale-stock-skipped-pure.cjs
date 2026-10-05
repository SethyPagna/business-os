// RET-B F4 / LH-2 (5 Oct 2026): imported sales never move stock they never took.
//
// Transition table pinned here (per sale line, quantity q, imported returned r):
//
//   import, live status            -> 0           (unchanged: history, not an event)
//   import, return status          -> +r          (unchanged: goods came back)
//   same import row applied again  -> 0           (import_sales_commits ledger)
//   imported sale cancel/un-cancel -> 0 / 0       (was +q / -q: phantom stock)
//   held() of an imported line     -> q - r       (was q: r looked still "out")
//   new return on an imported line -> cap q - r   (capacity helper for RET-A)
//
// Migration 0235 (the backfill) has its own test:
// test-migration-0235-imported-sales-stock-skipped-pure.cjs.
//
// Run (from cloudflare/): node scripts/test-imported-sale-stock-skipped-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const cache = new Map()
function loadLib(rel) {
  const file = path.join(SRC, rel.endsWith('.ts') ? rel : `${rel}.ts`)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const localRequire = (request) => {
    if (request === './db') return {}
    if (request.startsWith('./')) return loadLib(path.join(path.dirname(path.relative(SRC, file)), request.slice(2)))
    return require(request)
  }
  new Function('exports', 'require', 'module', out)(mod.exports, localRequire, mod)
  return mod.exports
}

const importCommit = loadLib('lib/salesImportCommit')
const transitions = loadLib('lib/saleTransitions')
const imported = transitions
const capacity = loadLib('lib/returnCreateAction')

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

function filterParams(sql, params = {}) {
  if (Array.isArray(params)) return params
  const filtered = {}
  for (const match of sql.matchAll(/@(\w+)/g)) filtered[match[1]] = params[match[1]] ?? null
  return filtered
}

function setup(migrations = loadAll()) {
  const sqlite = new Database(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)`).run()
  sqlite.prepare(`INSERT INTO products (id, name, sku, stock_quantity, cost_price_usd) VALUES (10, 'Widget', 'SKU-1', 5, 3)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 5)`).run()
  const db = {
    prepare(sql) { return { get(params) { return Promise.resolve(sqlite.prepare(sql).get(filterParams(sql, params))) } } },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(filterParams(sql, params))))
      return Promise.resolve(run())
    },
  }
  return { sqlite, db }
}

function saleData(overrides = {}) {
  return {
    receipt_number: 'R-100', cashier_id: null, cashier_name: 'Admin', branch_id: 1, branch_name: 'Shop',
    customer_id: null, customer_name: 'Dara', customer_phone: '012345678', customer_address: null,
    payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, notes: null,
    subtotal_usd: 15, subtotal_khr: 61500, discount_usd: 0, discount_khr: 0, tax_usd: 0, tax_khr: 0,
    total_usd: 15, total_khr: 61500, amount_paid_usd: 15, amount_paid_khr: 0, change_usd: 0, change_khr: 0,
    membership_discount_usd: 0, membership_discount_khr: 0, membership_points_redeemed: 0,
    is_delivery: 0, delivery_contact_id: null, delivery_contact_name: null, delivery_contact_phone: null,
    delivery_contact_address: null, delivery_fee_usd: 0, delivery_fee_khr: 0, delivery_fee_paid_by: 'customer',
    sale_status: 'completed', created_at: '2026-08-28T07:30:00.000Z',
    items: [{
      product_id: 10, product_name: 'Widget', sku: 'SKU-1', quantity: 3,
      applied_price_usd: 5, applied_price_khr: 20500, total_usd: 15, total_khr: 61500,
      cost_price_usd: 3, cost_price_khr: 12300, base_price_usd: 5, base_price_khr: 20500,
      product_discount_type: null, product_discount_label: null, product_discount_usd: 0, product_discount_khr: 0,
      manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, manual_discount_khr: 0,
      branch_id: 1, batch_id: null, batch_label: null, batch_expiry_date: null, returned_quantity: 0,
    }],
    ...overrides,
  }
}

const onHand = (sqlite) => sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1').get().quantity
const actor = { id: 41, username: 'importer' }

// What routes/sales.ts PATCH /:id/status does with a sale row: the sticky
// flag decides skipStock, held() decides the delta.
function cancelPlan(sqlite, saleId, { oldStatus, newStatus = 'cancelled', countImported = true }) {
  const sale = sqlite.prepare('SELECT stock_skipped FROM sales WHERE id = ?').get(saleId)
  const items = sqlite.prepare('SELECT id, product_id, product_name, quantity, cost_price_usd, cost_price_khr, branch_id, batch_id, returned_quantity FROM sale_items WHERE sale_id = ?').all(saleId)
  const itemLevel = new Map()
  if (countImported) imported.addImportedReturnedQuantities(itemLevel, items)
  const returnedByItem = transitions.allocateReturnedQuantities(items, itemLevel, new Map())
  return transitions.planSaleStockTransition({
    saleId, oldStatus, newStatus, items, returnedByItem, reason: 'test', userId: 1, userName: 'tester',
    skipStock: Number(sale.stock_skipped) === 1,
  })
}

;(async () => {
  await check('an imported sale is born stock_skipped; a live import moves no stock, and re-applying is a no-op', async () => {
    const { sqlite, db } = setup()
    const input = { jobId: 'job-1', rowNumber: 2, data: saleData(), nowIso: '2026-10-05T08:00:00.000Z', actor }
    assert.equal((await importCommit.applyHistoricalSaleImport(db, input)).alreadyApplied, false)
    assert.equal((await importCommit.applyHistoricalSaleImport(db, input)).alreadyApplied, true)
    const sale = sqlite.prepare("SELECT stock_skipped, stock_skipped_at, stock_skipped_by_name FROM sales WHERE client_request_id = 'sales-import:job-1:2'").get()
    assert.deepEqual({ ...sale }, { stock_skipped: 1, stock_skipped_at: input.nowIso, stock_skipped_by_name: 'importer' })
    assert.equal(onHand(sqlite), 5)
  })

  await check('cancel and un-cancel of an imported sale move 0 (control: an unflagged one invents 3)', async () => {
    const { sqlite, db } = setup()
    await importCommit.applyHistoricalSaleImport(db, { jobId: 'job-1', rowNumber: 2, data: saleData(), nowIso: '2026-10-05T08:00:00.000Z', actor })
    const id = sqlite.prepare("SELECT id FROM sales WHERE client_request_id = 'sales-import:job-1:2'").get().id
    const cancel = cancelPlan(sqlite, id, { oldStatus: 'completed' })
    assert.equal(cancel.statements.length, 0)
    assert.equal(cancel.restoredUnits, 0)
    assert.equal(cancel.skippedUnits, 3, 'the skip is recorded, not silent')
    const uncancel = cancelPlan(sqlite, id, { oldStatus: 'cancelled', newStatus: 'completed' })
    assert.equal(uncancel.statements.length, 0)
    assert.equal(uncancel.deductedUnits, 0)
    // Positive control: the same sale without the flag is the LH-2 defect.
    sqlite.prepare('UPDATE sales SET stock_skipped = 0 WHERE id = ?').run(id)
    assert.equal(cancelPlan(sqlite, id, { oldStatus: 'completed' }).restoredUnits, 3)
  })

  await check('a return-status import restocks r once; held() counts r, so cancel/un-cancel balance on q - r', async () => {
    const { sqlite, db } = setup()
    const data = saleData({ sale_status: 'partial_return', items: [{ ...saleData().items[0], returned_quantity: 2 }] })
    const input = { jobId: 'job-2', rowNumber: 5, data, nowIso: '2026-10-05T08:00:00.000Z', actor }
    await importCommit.applyHistoricalSaleImport(db, input)
    await importCommit.applyHistoricalSaleImport(db, input)
    assert.equal(onHand(sqlite), 7, 'the 2 returned units come back exactly once')
    const id = sqlite.prepare("SELECT id FROM sales WHERE client_request_id = 'sales-import:job-2:5'").get().id
    assert.equal(cancelPlan(sqlite, id, { oldStatus: 'partial_return' }).restoredUnits, 0, 'flagged: nothing moves')
    // held() itself, for an import the backfill cannot link (flag absent):
    sqlite.prepare('UPDATE sales SET stock_skipped = 0 WHERE id = ?').run(id)
    const cancel = cancelPlan(sqlite, id, { oldStatus: 'partial_return' })
    const uncancel = cancelPlan(sqlite, id, { oldStatus: 'cancelled', newStatus: 'partial_return' })
    assert.equal(cancel.restoredUnits, 1, 'only q - r = 1 is still out with the sale')
    assert.equal(uncancel.deductedUnits, 1, 'the reversal takes back exactly what the cancel gave')
    // Control: without the imported quantity, cancel hands back all 3 -- the 2
    // returned units a second time.
    assert.equal(cancelPlan(sqlite, id, { oldStatus: 'partial_return', countImported: false }).restoredUnits, 3)
  })

  await check('return capacity: importedReturnLines makes the imported r count as already returned', () => {
    const sold = [{ id: 7, product_id: 10, quantity: 3, product_name: 'Widget', returned_quantity: 2 }]
    const lines = imported.importedReturnLines(sold)
    assert.deepEqual(lines, [{ sale_item_id: 7, product_id: 10, quantity: 2 }])
    assert.doesNotThrow(() => capacity.assertReturnCreateCapacity(sold, lines, [{ sale_item_id: 7, quantity: 1 }]))
    assert.throws(() => capacity.assertReturnCreateCapacity(sold, lines, [{ sale_item_id: 7, quantity: 2 }]), /Cannot return 4/)
    // Control: the same request passes when the import is invisible -- LH-2b.
    assert.doesNotThrow(() => capacity.assertReturnCreateCapacity(sold, [], [{ sale_item_id: 7, quantity: 2 }]))
    assert.equal(imported.importedReturnedQuantity({ returned_quantity: -1 }), 0)
    assert.equal(imported.importedReturnedQuantity({ returned_quantity: 'x' }), 0)
    assert.equal(imported.importedReturnedQuantitySql('si'), 'MAX(COALESCE(si.returned_quantity, 0), 0)')
  })

  await check('both held() readers add the imported quantity before allocating returns', () => {
    for (const rel of ['routes/sales.ts', 'lib/saleBulkStatus.ts']) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      const add = src.indexOf('addImportedReturnedQuantities(')
      const allocate = src.indexOf('allocateReturnedQuantities(', add)
      assert.ok(add > 0 && allocate > add, `${rel} counts imported returns in held()`)
    }
    const route = fs.readFileSync(path.join(SRC, 'routes/sales.ts'), 'utf8')
    assert.match(route, /damaged_lot_id, returned_quantity FROM sale_items WHERE sale_id = \?/, 'the status route reads the column')
  })

  console.log(`\n${passed} check(s) passed.`)
})().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : error)
  process.exitCode = 1
})
