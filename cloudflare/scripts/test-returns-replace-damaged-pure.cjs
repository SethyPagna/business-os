// K2 (Part 410, 11.12/11.13): lib/returnsStock.ts against a REAL sqlite
// database with the REAL migrations (0074's damaged_stock_lots /
// return_replacement_items / stock_action land via load_migrations), plus
// route-wiring pins on routes/returns.ts. Covers:
//   - normalizeStockAction: explicit three-way wins; the historical
//     return_to_stock boolean keeps its exact default (absent = restock)
//   - computeSettlement: even exchange only at a zero gap; price
//     difference is signed and needs full access
//   - replacement selection is not restricted by product name; the route
//     records a linked sale/receipt for any chosen catalog item
//   - damaged lots: created traceable (return/branch/batch), never touch
//     sellable branch_stock; reversal deletes untouched lots and REFUSES
//     once any quantity was drawn (ConsumedDamagedStockError)
//   - replacement stock drain: plain path validates-then-decrements
//     branch_stock + writes the replacement_out movement; batch path
//     drains the exact lot via removeStockFromBatch (all three stores in
//     step); insufficiency throws before any write
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const sqlBinding = loadReal('lib/sqlBinding.ts', { './db': {} })
const batchCode = loadReal('lib/batchCode.ts', { './db': {} })
const productBatches = loadReal('lib/productBatches.ts', { './db': {}, './batchCode': batchCode, './sqlBinding': sqlBinding })
const kernel = loadReal('lib/returnsStock.ts', { './db': {}, './productBatches': productBatches, './sqlBinding': sqlBinding })

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function seed(db) {
  const rows = [
    { name: 'Twin Cream', barcode: 'tc1' },
    { name: 'Twin Cream', barcode: 'tc2' },
    { name: 'Other Serum', barcode: 'os1' },
  ]
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO products (name, barcode, is_active, stock_quantity, out_of_stock_threshold, selling_price_usd)
      VALUES (@name, @barcode, 1, 0, 0, 10)
    `).run(row)
  }
  const idOf = async (barcode) => (await db.prepare('SELECT id FROM products WHERE barcode = ?').get([barcode])).id
  const ids = { tc1: await idOf('tc1'), tc2: await idOf('tc2'), os1: await idOf('os1') }
  for (const pid of Object.values(ids)) {
    await db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 10)').run([pid])
    await db.prepare('UPDATE products SET stock_quantity = 10 WHERE id = ?').run([pid])
  }
  await db.prepare(`
    INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number)
    VALUES (@id, 'lotA', '08012026', '2026-08-01', 1, 1)
  `).run({ id: ids.tc2 })
  const batchId = (await db.prepare('SELECT id FROM product_batches WHERE variant_product_id = ?').get([ids.tc2])).id
  await db.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 1, 6)').run([batchId])
  return { ids, batchId }
}

async function run() {
  const db = openDb(MIGRATION_SQLS)
  const { ids, batchId } = await seed(db)

  await check('normalizeStockAction: explicit three-way wins, boolean keeps its historical default', async () => {
    assert.equal(kernel.normalizeStockAction({ stock_action: 'damaged', return_to_stock: true }), 'damaged')
    assert.equal(kernel.normalizeStockAction({ stock_action: 'none' }), 'none')
    assert.equal(kernel.normalizeStockAction({ stock_action: 'RESTOCK' }), 'restock')
    // the pre-0074 wire shape, byte for byte
    assert.equal(kernel.normalizeStockAction({}), 'restock')
    assert.equal(kernel.normalizeStockAction({ return_to_stock: false }), 'none')
    assert.equal(kernel.normalizeStockAction({ stock_action: 'garbage', return_to_stock: false }), 'none')
  })

  await check('computeSettlement: even exchange only at zero gap; price difference is signed + full-access', async () => {
    const even = kernel.computeSettlement({ returnedTotalUsd: 20, returnedTotalKhr: 82000, replacementTotalUsd: 20, replacementTotalKhr: 82000 })
    assert.equal(even.mode, 'even_exchange')
    assert.equal(even.evenExchangeBlocked, false)
    assert.equal(even.needsFullAccess, false)
    const uneven = kernel.computeSettlement({ returnedTotalUsd: 20, returnedTotalKhr: 0, replacementTotalUsd: 25.5, replacementTotalKhr: 0 })
    assert.equal(uneven.evenExchangeBlocked, true)
    const diff = kernel.computeSettlement({ mode: 'price_difference', returnedTotalUsd: 20, returnedTotalKhr: 0, replacementTotalUsd: 25.5, replacementTotalKhr: 0 })
    assert.equal(diff.needsFullAccess, true)
    assert.equal(diff.evenExchangeBlocked, false)
    assert.equal(diff.diffUsd, 5.5) // positive = customer owes
    const refundSide = kernel.computeSettlement({ mode: 'price_difference', returnedTotalUsd: 30, returnedTotalKhr: 0, replacementTotalUsd: 25, replacementTotalKhr: 0 })
    assert.equal(refundSide.diffUsd, -5)
  })

  await check('damaged lot: traceable, never sellable stock; open-lot listing sees it', async () => {
    const before = (await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get([ids.tc1])).quantity
    await kernel.createDamagedLot(db, {
      productId: ids.tc1, productName: 'Twin Cream', branchId: 1, batchId: null,
      returnId: 501, quantity: 2, reason: 'crushed box', userId: 1, userName: 'Tester',
    })
    const after = (await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get([ids.tc1])).quantity
    assert.equal(after, before) // damaged stock NEVER enters branch_stock
    const lots = await kernel.listOpenDamagedLots(db, { productId: ids.tc1, branchId: 1 })
    assert.equal(lots.length, 1)
    assert.equal(lots[0].return_id, 501)
    assert.equal(lots[0].quantity_remaining, 2)
    assert.ok(!('cost_price_usd' in lots[0])) // damage listing carries no cost
  })

  await check('reverseDamagedLots: untouched lots reverse; a drawn-from lot blocks the edit', async () => {
    const reversed = await kernel.reverseDamagedLots(db, 501)
    assert.equal(reversed.length, 1)
    assert.equal(reversed[0].quantity, 2)
    assert.equal((await kernel.listOpenDamagedLots(db, { productId: ids.tc1 })).length, 0)

    await kernel.createDamagedLot(db, {
      productId: ids.tc1, productName: 'Twin Cream', branchId: 1, batchId: null,
      returnId: 502, quantity: 3, reason: 'leaked', userId: 1, userName: 'Tester',
    })
    await db.prepare('UPDATE damaged_stock_lots SET quantity_remaining = 2 WHERE return_id = 502').run([])
    await assert.rejects(
      () => kernel.reverseDamagedLots(db, 502),
      (err) => err.name === 'ConsumedDamagedStockError' && /already been drawn/.test(err.message),
    )
    // the blocked reversal left the lot in place
    assert.equal((await kernel.listOpenDamagedLots(db, { productId: ids.tc1 })).length, 1)
  })

  await check('replacement drain, plain path: validated decrement + replacement_out movement', async () => {
    await kernel.applyReplacementStock(db, {
      productId: ids.tc1, productName: 'Twin Cream', branchId: 1, batchId: null,
      quantity: 4, unitCostUsd: 3, unitCostKhr: 12300, returnId: 601, returnNumber: 'RET-TEST',
      userId: 1, userName: 'Tester',
    })
    const stock = (await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get([ids.tc1])).quantity
    assert.equal(stock, 6)
    const move = await db.prepare(`SELECT movement_type, quantity, reason FROM inventory_movements WHERE product_id = ? AND movement_type = 'replacement_out'`).get([ids.tc1])
    assert.equal(move.quantity, -4)
    assert.match(move.reason, /RET-TEST/)
    await assert.rejects(
      () => kernel.applyReplacementStock(db, {
        productId: ids.tc1, productName: 'Twin Cream', branchId: 1, batchId: null,
        quantity: 99, unitCostUsd: 0, unitCostKhr: 0, returnId: 602, returnNumber: null,
        userId: null, userName: null,
      }),
      (err) => err.name === 'InsufficientReplacementStockError' && /99/.test(err.message),
    )
    // the refused drain wrote nothing
    assert.equal((await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get([ids.tc1])).quantity, 6)
  })

  await check('replacement drain, batch path: the exact lot drains and all three stores stay in step', async () => {
    await kernel.applyReplacementStock(db, {
      productId: ids.tc2, productName: 'Twin Cream', branchId: 1, batchId,
      quantity: 2, unitCostUsd: 3, unitCostKhr: 12300, returnId: 603, returnNumber: 'RET-BATCH',
      userId: 1, userName: 'Tester',
    })
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1').get([batchId])).quantity, 4)
    assert.equal((await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get([ids.tc2])).quantity, 8)
    assert.equal((await db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get([ids.tc2])).stock_quantity, 8)
    // a lot that can't cover the ask refuses BEFORE writing (its own error)
    await assert.rejects(
      () => kernel.applyReplacementStock(db, {
        productId: ids.tc2, productName: 'Twin Cream', branchId: 1, batchId,
        quantity: 50, unitCostUsd: 0, unitCostKhr: 0, returnId: 604, returnNumber: null,
        userId: null, userName: null,
      }),
    )
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1').get([batchId])).quantity, 4)
  })

  await check('11.9: consumeDamagedLot draws strictly, refuses shortfalls and wrong products', async () => {
    await kernel.createDamagedLot(db, {
      productId: ids.tc2, productName: 'Twin Cream', branchId: 1, batchId: null,
      returnId: 701, quantity: 4, reason: 'POS damage source test', userId: 1, userName: 'Tester',
    })
    const lot = (await kernel.listOpenDamagedLots(db, { productId: ids.tc2 })).find((row) => row.return_id === 701)
    const drawn = await kernel.consumeDamagedLot(db, { lotId: lot.id, productId: ids.tc2, quantity: 3 })
    assert.equal(drawn.productName, 'Twin Cream')
    assert.equal((await db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id = ?').get([lot.id])).quantity_remaining, 1)
    // a draw the lot can't cover throws WITHOUT writing
    await assert.rejects(
      () => kernel.consumeDamagedLot(db, { lotId: lot.id, productId: ids.tc2, quantity: 2 }),
      (err) => err.name === 'DamagedLotShortfallError' && err.available === 1,
    )
    assert.equal((await db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id = ?').get([lot.id])).quantity_remaining, 1)
    // a different product's id never draws from this lot
    await assert.rejects(
      () => kernel.consumeDamagedLot(db, { lotId: lot.id, productId: ids.os1, quantity: 1 }),
      /does not belong to this product/,
    )
    // restore comes back but clamps at the lot's original quantity
    await kernel.restoreDamagedLot(db, { lotId: lot.id, quantity: 3 })
    assert.equal((await db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id = ?').get([lot.id])).quantity_remaining, 4)
    await kernel.restoreDamagedLot(db, { lotId: lot.id, quantity: 99 })
    assert.equal((await db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id = ?').get([lot.id])).quantity_remaining, 4)
  })

  await check('11.9: sales route + POS lookup wiring pins', async () => {
    const salesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
    // damaged lines skip the sellable-stock checks and deductions...
    assert.match(salesSource, /shouldDeductStock && !item\.damaged_lot_id\)/)
    // ...draw their lot up front with compensation on every later failure...
    assert.match(salesSource, /await consumeDamagedLot\(db, \{ lotId: Number\(item\.damaged_lot_id\)/)
    assert.match(salesSource, /await restoreConsumedDamagedLots\(\)\s+await db\.prepare\('DELETE FROM sales WHERE id = \?'\)/)
    // ...record which lot on the sale line, and ledger the draw
    assert.match(salesSource, /@batch_id, @batch_label, @batch_expiry_date, @damaged_lot_id/)
    assert.match(salesSource, /DAMAGE_OUT_MOVEMENT/)
    // status transitions run damaged lines on the SAME heldQuantity state
    // machine, outside the branch-stock plan
    assert.match(salesSource, /const regularItems = items\.filter\(\(item\) => !item\.damaged_lot_id\)/)
    assert.match(salesSource, /heldQuantity\(saleStatus, item\.quantity, returned\) - heldQuantity\(oldStatus, item\.quantity, returned\)/)
    const batchesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'batches.ts'), 'utf8')
    assert.match(batchesSource, /app\.get\('\/damaged-lots'/)
    assert.ok(batchesSource.indexOf(`app.get('/damaged-lots'`) < batchesSource.indexOf(`// GET /api/batches?productId=`))
    const migration75 = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0075_sale_items_damaged_lot.sql'), 'utf8')
    assert.match(migration75, /ALTER TABLE sale_items ADD COLUMN damaged_lot_id INTEGER/)
  })

  await check('route + migration wiring pins', async () => {
    const routeSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'returns.ts'), 'utf8')
    // three-way action drives both create and edit re-apply, and the
    // column is written on both INSERT INTO return_items statements
    assert.match(routeSource, /const stockAction = normalizeStockAction\(item\)/)
    assert.equal((routeSource.match(/@return_to_stock, @stock_action, @branch_id/g) || []).length, 2)
    // damaged lots reverse (and can block) before an edit re-applies
    assert.match(routeSource, /const reversedLots = await reverseDamagedLots\(db, id\)/)
    assert.match(routeSource, /instanceof ConsumedDamagedStockError/)
    // replacements: any catalog item is accepted, the settlement gate still
    // applies, a linked sale/receipt is written, and the damaged-lots endpoint sits
    // above the /:id param route
    assert.doesNotMatch(routeSource, /assertReplacementsSameName/)
    assert.match(routeSource, /code: 'uneven_exchange'/)
    assert.match(routeSource, /Settling a price difference on a replacement requires Full Access/)
    assert.match(routeSource, /INSERT INTO sales \(/)
    assert.match(routeSource, /source_return_id/)
    assert.match(routeSource, /INSERT INTO sale_items \(/)
    assert.match(routeSource, /replacementReceiptNumber/)
    assert.ok(routeSource.indexOf(`app.get('/damaged-lots'`) < routeSource.indexOf(`app.get('/:id'`))
    // failed creates clean up ALL of this return's rows
    assert.match(routeSource, /DELETE FROM damaged_stock_lots WHERE return_id = \?/)
    assert.match(routeSource, /DELETE FROM return_replacement_items WHERE return_id = \?/)
    const migration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0074_returns_replace_damaged.sql'), 'utf8')
    assert.match(migration, /CREATE TABLE IF NOT EXISTS damaged_stock_lots/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS return_replacement_items/)
    assert.match(migration, /ALTER TABLE return_items ADD COLUMN stock_action TEXT/)
    assert.match(migration, /WHEN COALESCE\(return_to_stock, 0\) = 1 THEN 'restock' ELSE 'none'/)
    const replacementSaleMigration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0106_return_replacement_sales.sql'), 'utf8')
    assert.match(replacementSaleMigration, /ALTER TABLE returns ADD COLUMN replacement_sale_id INTEGER/)
    assert.match(replacementSaleMigration, /ALTER TABLE sales ADD COLUMN source_return_id INTEGER/)
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
