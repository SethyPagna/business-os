const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

function compileSubject() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'salesImportCommit.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => {
    if (request === './db') return {}
    if (request === './salesStatus') return { RETURN_STATUSES: new Set(['returned', 'partial_return']) }
    return require(request)
  }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

function filterParams(sql, params = {}) {
  const filtered = {}
  for (const match of sql.matchAll(/@(\w+)/g)) filtered[match[1]] = params[match[1]] ?? null
  return filtered
}

function setup() {
  const sqlite = new Database(':memory:')
  for (const migration of loadAll()) sqlite.exec(migration)
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Main Branch', 1)`).run()
  sqlite.prepare(`INSERT INTO products (id, name, sku, stock_quantity, cost_price_usd) VALUES (10, 'Widget', 'SKU-1', 5, 3)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 5)`).run()
  sqlite.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, is_active, batch_number) VALUES (20, 10, 'lot-a', 'LOT-A', 1, 1)`).run()
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (20, 1, 5)`).run()

  const db = {
    prepare(sql) {
      return {
        get(params) { return Promise.resolve(sqlite.prepare(sql).get(filterParams(sql, params))) },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(filterParams(sql, params))))
      return Promise.resolve(run())
    },
  }
  return { sqlite, db }
}

function saleData(overrides = {}) {
  return {
    receipt_number: 'R-100', cashier_id: null, cashier_name: 'Admin', branch_id: 1, branch_name: 'Main Branch',
    customer_id: null, customer_name: 'Dara', customer_phone: '012345678', customer_address: null,
    payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, notes: null,
    subtotal_usd: 10, subtotal_khr: 41000, discount_usd: 0, discount_khr: 0, tax_usd: 0, tax_khr: 0,
    total_usd: 10, total_khr: 41000, amount_paid_usd: 10, amount_paid_khr: 0, change_usd: 0, change_khr: 0,
    membership_discount_usd: 0, membership_discount_khr: 0, membership_points_redeemed: 0,
    is_delivery: 0, delivery_contact_id: null, delivery_contact_name: null, delivery_contact_phone: null,
    delivery_contact_address: null, delivery_fee_usd: 0, delivery_fee_khr: 0, delivery_fee_paid_by: 'customer',
    sale_status: 'completed', created_at: '2026-08-28T07:30:00.000Z',
    items: [{
      product_id: 10, product_name: 'Widget', sku: 'SKU-1', quantity: 2,
      applied_price_usd: 5, applied_price_khr: 20500, total_usd: 10, total_khr: 41000,
      cost_price_usd: 3, cost_price_khr: 12300, base_price_usd: 5, base_price_khr: 20500,
      product_discount_type: null, product_discount_label: null, product_discount_usd: 0, product_discount_khr: 0,
      manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, manual_discount_khr: 0,
      branch_id: 1, batch_id: 20, batch_label: 'LOT-A', batch_expiry_date: null, returned_quantity: 0,
    }],
    ...overrides,
  }
}

;(async () => {
  const subject = compileSubject()

  // Existing concurrent-looking row proves line linkage uses the import's
  // deterministic key, never "latest id" ordering.
  const normal = setup()
  normal.sqlite.prepare(`INSERT INTO sales (receipt_number, client_request_id) VALUES ('OTHER', 'other-request')`).run()
  const input = { jobId: 'job-1', rowNumber: 2, data: saleData(), nowIso: '2026-08-28T08:00:00.000Z' }
  const first = await subject.applyHistoricalSaleImport(normal.db, input)
  const retry = await subject.applyHistoricalSaleImport(normal.db, input)
  assert.equal(first.alreadyApplied, false)
  assert.equal(retry.alreadyApplied, true)
  assert.equal(normal.sqlite.prepare(`SELECT COUNT(*) n FROM sales WHERE receipt_number = 'R-100'`).get().n, 1)
  assert.equal(normal.sqlite.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 1)
  assert.equal(normal.sqlite.prepare(`SELECT s.receipt_number FROM sale_items si JOIN sales s ON s.id = si.sale_id`).get().receipt_number, 'R-100')
  assert.equal(normal.sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 5, 'ordinary history import never deducts current stock')
  assert.equal(normal.sqlite.prepare(`SELECT status FROM import_sales_commits`).get().status, 'applied')

  const returned = setup()
  const returnedData = saleData({ sale_status: 'partial_return', items: [{ ...saleData().items[0], returned_quantity: 1 }] })
  const returnedInput = { jobId: 'job-return', rowNumber: 8, data: returnedData, nowIso: '2026-08-28T08:00:00.000Z' }
  await subject.applyHistoricalSaleImport(returned.db, returnedInput)
  await subject.applyHistoricalSaleImport(returned.db, returnedInput)
  assert.equal(returned.sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 6)
  assert.equal(returned.sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1`).get().quantity, 6)
  assert.equal(returned.sqlite.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id = 20 AND branch_id = 1`).get().quantity, 6)
  assert.equal(returned.sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE movement_type = 'return'`).get().n, 1)

  // Any failure in the last write rolls back header, items, stock, movement,
  // and ledger together; this is the atomicity property the old path lacked.
  const failed = setup()
  failed.sqlite.exec(`CREATE TRIGGER reject_import_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT, 'forced movement failure'); END;`)
  await assert.rejects(() => subject.applyHistoricalSaleImport(failed.db, returnedInput), /forced movement failure/)
  assert.equal(failed.sqlite.prepare(`SELECT COUNT(*) n FROM sales`).get().n, 0)
  assert.equal(failed.sqlite.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 0)
  assert.equal(failed.sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 5)
  assert.equal(failed.sqlite.prepare(`SELECT COUNT(*) n FROM import_sales_commits`).get().n, 0)

  const tooMany = Array.from({ length: subject.MAX_HISTORICAL_SALE_LINES + 1 }, () => ({ ...saleData().items[0] }))
  await assert.rejects(
    () => subject.applyHistoricalSaleImport(setup().db, { ...input, data: saleData({ items: tooMany }) }),
    /-line safety limit/,
  )

  console.log('PASS historical sales import is atomic, retry-idempotent, concurrency-safe, return-safe, and line-bounded')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
