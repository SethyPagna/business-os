// S7 / H-stock 7 (2026-09-27): products.stock_quantity is the all-branches
// rollup of branch_stock. Every writer that moves branch_stock must leave
// stock_quantity = SUM(branch_stock) for that product.
//
// Production (forensics S7) held one product, inactive, stock_quantity 8 with
// no branch_stock rows: the shape the duplicate-merge fold left before
// b13b57b4 (Sep 7) recomputed the discarded row (locked by
// test-merge-duplicates-stock-choice-pure.cjs). The writers that were still
// live and could carry or ratchet a drift were the ones that moved the rollup
// by a DELTA with an asymmetric clamp -- deduct MAX(0, P - q), restore P + q:
//   lib/saleTransitions.ts   planSaleStockTransition (deduct and restore)
//   routes/sales.ts          POST /sales rollup statement
//   lib/productBatches.ts    removeStockFromBatch, removeStockAcrossBatches
//   lib/saleAmendments.ts    planLineQuantityIncrease / planLineQuantityDecrease
//   lib/saleLineAddition.ts  planSaleLineAddition / planSaleLineRemoval (its undo)
// With P below the branch sum, a cancel / un-cancel cycle moved P by a
// different amount each way. They now recompute P from branch_stock in the
// same batch, so a drift cannot survive, grow or be created by them.
//
// Discriminating: every "drifted" case fails on the delta code (P stays off
// the branch sum, or is floored at 0 while the shelf holds units), and the
// no-drift control passes on both, proving the fixture is not rigged.
//
// Run (from cloudflare/): node scripts/test-product-rollup-drift-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const cache = new Map()
function loadReal(abs) {
  if (cache.has(abs)) return cache.get(abs).exports
  const source = fs.readFileSync(abs, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  })
  const mod = new Module(abs, module)
  mod.filename = abs
  mod.paths = Module._nodeModulePaths(path.dirname(abs))
  cache.set(abs, mod)
  const parentRequire = mod.require.bind(mod)
  mod.require = (id) => {
    if (id.startsWith('.')) {
      let target = path.resolve(path.dirname(abs), id)
      if (!target.endsWith('.ts')) target += '.ts'
      if (fs.existsSync(target)) return loadReal(target)
    }
    return parentRequire(id)
  }
  mod._compile(outputText, abs)
  return mod.exports
}
const { planSaleStockTransition } = loadReal(path.join(SRC, 'lib', 'saleTransitions.ts'))
const { removeStockFromBatch, removeStockAcrossBatches } = loadReal(path.join(SRC, 'lib', 'productBatches.ts'))
const { planLineQuantityIncrease, planLineQuantityDecrease } = loadReal(path.join(SRC, 'lib', 'saleAmendments.ts'))
const { allocateNewSaleLines, planSaleLineAddition, planSaleLineRemoval } = loadReal(path.join(SRC, 'lib', 'saleLineAddition.ts'))

function freshDb() {
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (params) => stmt.get(params),
        all: async (params) => stmt.all(params) ?? [],
        run: async (params) => { const r = stmt.run(params); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    async batch(items) { return rawDb.batch(items) },
    async transaction(fn) { return fn(this) },
  }
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1), (2, 'Warehouse', 1, 0)").run()
  return { rawDb, db }
}

// P = the stored rollup; shop/warehouse = branch_stock; lot = one lot at the shop.
function seed(rawDb, { P, shop, warehouse = 0, lot = null }) {
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Serum', 1, @P)").run({ P })
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, @shop), (1, 2, @warehouse)').run({ shop, warehouse })
  if (lot != null) {
    rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, received_quantity)
      VALUES (7, 1, '09012026', '09012026', '2026-09-01', 1, 1, @lot)`).run({ lot })
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (7, 1, @lot)').run({ lot })
  }
}

function state(rawDb) {
  const P = rawDb.prepare('SELECT stock_quantity AS P FROM products WHERE id = 1').get().P
  const sum = rawDb.prepare('SELECT COALESCE(SUM(quantity), 0) AS s FROM branch_stock WHERE product_id = 1').get().s
  const shop = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
  return { P, sum, shop }
}

let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed += 1 } catch (err) { console.log(`FAIL ${name}`); console.log(err.stack || err); failed += 1 }
}

const ITEM = { id: 11, product_id: 1, product_name: 'Serum', quantity: 5, cost_price_usd: 4, cost_price_khr: 0, branch_id: 1, batch_id: null }
function transition(rawDb, oldStatus, newStatus) {
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus, newStatus, items: [ITEM], returnedByItem: new Map([[11, 0]]),
    reason: 'test', userId: 1, userName: 'admin',
  })
  rawDb.batch(plan.statements)
}

async function main() {
  // A completed sale of 5 already took its units: shop 10, warehouse 4.
  for (const [label, P] of [['no drift (control)', 14], ['rollup drifted below the branches', 1], ['rollup drifted above the branches', 30]]) {
    await test(`sale cancel -> un-cancel -> cancel keeps the rollup on the branch sum, ${label}`, async () => {
      const { rawDb } = freshDb()
      seed(rawDb, { P, shop: 10, warehouse: 4 })
      const trail = []
      for (const [from, to, shop] of [['completed', 'cancelled', 15], ['cancelled', 'completed', 10], ['completed', 'cancelled', 15]]) {
        transition(rawDb, from, to)
        const s = state(rawDb)
        trail.push(`${from}->${to}: P=${s.P} sum=${s.sum}`)
        assert.strictEqual(s.shop, shop, `branch moved by the held delta (${trail.join('; ')})`)
        assert.strictEqual(s.P, s.sum, `rollup equals branch sum after ${from}->${to} (${trail.join('; ')})`)
      }
    })
  }

  await test('reversal: un-cancel after cancel lands exactly where the sale started, rollup included', async () => {
    const { rawDb } = freshDb()
    seed(rawDb, { P: 14, shop: 10, warehouse: 4 })
    transition(rawDb, 'completed', 'cancelled')
    transition(rawDb, 'cancelled', 'completed')
    assert.deepStrictEqual(state(rawDb), { P: 14, sum: 14, shop: 10 })
  })

  for (const [label, P] of [['no drift (control)', 14], ['rollup drifted below the removal', 1]]) {
    await test(`removeStockFromBatch keeps the rollup on the branch sum, ${label}`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { P, shop: 10, warehouse: 4, lot: 10 })
      await removeStockFromBatch(db, { batchId: 7, productId: 1, branchId: 1, quantity: 3 })
      assert.deepStrictEqual(state(rawDb), { P: 11, sum: 11, shop: 7 })
    })

    await test(`removeStockAcrossBatches keeps the rollup on the branch sum, ${label}`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { P, shop: 10, warehouse: 4, lot: 10 })
      await removeStockAcrossBatches(db, { productId: 1, branchId: 1, quantity: 3 })
      assert.deepStrictEqual(state(rawDb), { P: 11, sum: 11, shop: 7 })
    })
  }

  // Sale amendments (quantity up / down on a recorded sale) and added lines
  // (add items / its undo) moved the rollup by the same asymmetric pair.
  // No lots: every unit rides branch_stock, the legacy-stock shape.
  const SALE = { sale_status: 'completed', stock_skipped: 0, is_delivery: 0 }
  const LINE = { id: 11, product_id: 1, product_name: 'Serum', quantity: 5, applied_price_usd: 3, cost_price_usd: 1.5, cost_price_khr: 6000, branch_id: 1 }
  const ADDED = { productId: 1, productName: 'Serum', quantity: 3, branchId: 1, unitPriceUsd: 3, costPriceUsd: 1.5, costPriceKhr: 6000, batchId: null, batchLabel: null, batchExpiryDate: null }
  const increase = (rawDb) => rawDb.batch(planLineQuantityIncrease({
    saleId: 1, sale: SALE, line: LINE, addedQuantity: 3, lots: [], exchangeRate: 4100, userId: 1, userName: 'admin',
  }).statements)
  const decrease = (rawDb, line = LINE) => rawDb.batch(planLineQuantityDecrease({
    saleId: 1, sale: SALE, line, removedQuantity: 3, allocations: [], exchangeRate: 4100, reason: 'test', userId: 1, userName: 'admin',
  }).statements)
  const addLine = (rawDb) => {
    const lines = allocateNewSaleLines([ADDED], new Map(), 'completed')
    assert.strictEqual(lines[0].heldUnits, 3, 'the added line holds its units')
    rawDb.batch(planSaleLineAddition({ saleId: 1, saleStatus: 'completed', lines, exchangeRate: 4100, userId: 1, userName: 'admin' }).statements)
    return lines[0]
  }
  const removeLine = (rawDb, planned) => rawDb.batch(planSaleLineRemoval({
    saleId: 1, reason: 'Undo', userId: 1, userName: 'admin',
    lines: [{ saleItemId: 99, productId: 1, productName: 'Serum', quantity: 3, branchId: 1, heldUnits: planned.heldUnits,
      unitPriceUsd: 3, lineTotalUsd: 9, costPriceUsd: 1.5, costPriceKhr: 6000, takes: planned.takes }],
  }).statements)

  for (const [label, P] of [['no drift (control)', 14], ['rollup drifted below the branches', 1]]) {
    await test(`sale amendment quantity increase keeps the rollup on the branch sum, ${label}`, async () => {
      const { rawDb } = freshDb()
      seed(rawDb, { P, shop: 10, warehouse: 4 })
      increase(rawDb)
      assert.deepStrictEqual(state(rawDb), { P: 11, sum: 11, shop: 7 })
    })

    await test(`sale amendment quantity decrease keeps the rollup on the branch sum, ${label}`, async () => {
      const { rawDb } = freshDb()
      seed(rawDb, { P, shop: 10, warehouse: 4 })
      decrease(rawDb)
      assert.deepStrictEqual(state(rawDb), { P: 17, sum: 17, shop: 13 })
    })

    await test(`adding a line to a sale, and its undo, keep the rollup on the branch sum, ${label}`, async () => {
      const { rawDb } = freshDb()
      seed(rawDb, { P, shop: 10, warehouse: 4 })
      const planned = addLine(rawDb)
      assert.deepStrictEqual(state(rawDb), { P: 11, sum: 11, shop: 7 }, 'after the addition')
      removeLine(rawDb, planned)
      assert.deepStrictEqual(state(rawDb), { P: 14, sum: 14, shop: 10 }, 'after its undo')
    })
  }

  await test('reversal: an amendment increase then the matching decrease lands exactly where the sale started', async () => {
    const { rawDb } = freshDb()
    seed(rawDb, { P: 14, shop: 10, warehouse: 4 })
    increase(rawDb)
    decrease(rawDb, { ...LINE, quantity: 8 })
    assert.deepStrictEqual(state(rawDb), { P: 14, sum: 14, shop: 10 })
  })

  await test('POST /sales recomputes the rollup from branch_stock; no delta-with-clamp writer is left in the sale/lot paths', async () => {
    const files = ['routes/sales.ts', 'lib/saleTransitions.ts', 'lib/productBatches.ts', 'lib/saleAmendments.ts', 'lib/saleLineAddition.ts']
      .map((f) => [f, fs.readFileSync(path.join(SRC, f), 'utf8')])
    for (const [f, src] of files) {
      assert.ok(!/stock_quantity\s*=\s*MAX\(0,/.test(src), `${f} still clamps the rollup by a delta`)
      assert.ok(!/stock_quantity\s*=\s*stock_quantity\s*\+\s*@quantity/.test(src), `${f} still restores the rollup by a delta`)
    }
    const sales = files[0][1]
    const deduct = sales.indexOf('DO UPDATE SET quantity = branch_stock.quantity - @quantity')
    const rollup = sales.indexOf('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @product_id)', deduct)
    assert.ok(deduct > 0, 'found the POST /sales branch_stock deduction')
    assert.ok(rollup > deduct, 'POST /sales writes the rollup as a recompute, after the branch_stock deduction in the batch')
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
