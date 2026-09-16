// P10-5 writer 4 (Sep 16 2026 owner ruling): a Fast Stock-In create_receive
// line that identifies as an EXISTING product folds into it instead of
// 409ing -- real barcode wins, stored barcode loses a leading zero, and the
// received lot lands on the survivor with cost re-derived through the
// SAME catalogCostRecomputeStatement every other receive line already gets.
//
// This file is the UNDO half: the fold happens INSIDE the same atomic
// stock-session batch as the receipt, so its own undo_snapshot must put the
// barcode, cost, lot and branch stock back exactly -- not leave the survivor
// permanently mutated by an action the operator then undid.
//
// Run (from cloudflare/): node scripts/test-stock-session-fold-undo-native.cjs
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')

const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}

function payload(f, receipt) {
  return JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId).undo_payload)
}

async function main() {
  const api = loadStockSession()

  await check('undo puts back the survivor\'s pre-fold barcode, cost, lot and branch stock exactly', async () => {
    const f = fixture()
    // A real, padded barcode on the existing row -- product id 1 from the
    // shared fixture ("Serum", "SER-1") is not a real barcode at all, so use
    // a fresh row here for a clean, discriminating leading-zero fold.
    f.sql.exec(`
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active)
        VALUES(2,'Rose Lip Oil','03614274226546',5,0,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,3);
    `)
    const before = f.sql.prepare('SELECT * FROM products WHERE id=2').get()
    const beforeStock = f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1').get().quantity

    const request = {
      client_request_id: 'fold-undo-request-001', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-06', supplier_name: 'Bong Long' },
      items: [{
        line_id: 'fold-undo-line', kind: 'create_receive', quantity: 4, unit_cost_usd: 8,
        product: { name: 'Rose Lip Oil', barcode: '3614274226546', cost_price_usd: 8, cost_price_khr: 0, selling_price_usd: 14, stock_quantity: 4, branch_id: 1 },
      }],
    }
    const receipt = await api.commitStockSession(f.env, user, request)
    assert.equal(receipt.success, true)
    assert.equal(receipt.createdCount, 0, 'this folded onto row 2 -- nothing new was created')
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2, 'still exactly 2 rows (the fixture Serum + this one) -- no twin')

    const afterFold = f.sql.prepare('SELECT * FROM products WHERE id=2').get()
    assert.equal(afterFold.barcode, '3614274226546', 'the real barcode won, leading zero stripped')
    assert.equal(afterFold.cost_price_usd, 8, 'catalogCostRecomputeStatement derived cost from the one active lot')
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1').get().quantity, beforeStock + 4)
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM product_batches WHERE variant_product_id=2').get().c, 1)

    await api.replayStockSession(f.env, user, 'undo', receipt.actionHistoryId, 0, payload(f, receipt))

    const afterUndo = f.sql.prepare('SELECT * FROM products WHERE id=2').get()
    assert.equal(afterUndo.barcode, before.barcode, 'undo restored the padded barcode exactly')
    assert.equal(afterUndo.cost_price_usd, before.cost_price_usd, 'undo restored the pre-fold cost exactly')
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1').get().quantity, beforeStock,
      'undo restored the pre-receipt branch stock exactly -- the arithmetic balances back to zero net')
    assert.equal(f.sql.prepare("SELECT COUNT(*) c FROM product_batches WHERE variant_product_id=2 AND is_active=1").get().c, 0,
      'the lot opened by the fold was deactivated by undo, not left dangling')
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2, 'undo did not resurrect or mint a second row either')

    // Redo re-applies the exact same fold (idempotent replay, not a second
    // application on top of the first -- the whole point of a snapshot-based
    // undo/redo pair over a naive "run the inverse of the inverse" scheme).
    await api.replayStockSession(f.env, user, 'redo', receipt.actionHistoryId, 1, payload(f, receipt))
    const afterRedo = f.sql.prepare('SELECT * FROM products WHERE id=2').get()
    assert.equal(afterRedo.barcode, '3614274226546')
    assert.equal(afterRedo.cost_price_usd, 8)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1').get().quantity, beforeStock + 4,
      'redo applied the fold once -- not doubled on top of whatever undo left behind')
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2)
  })

  await check('undo of a quantity=0 fold (barcode-only, no lot) restores the barcode without touching stock', async () => {
    const f = fixture()
    f.sql.exec(`
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active)
        VALUES(2,'Amber Balm','09001234567890',3,0,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0);
    `)
    const beforeBarcode = f.sql.prepare('SELECT barcode FROM products WHERE id=2').get().barcode
    const request = {
      client_request_id: 'fold-undo-request-zero-001', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-06', supplier_name: 'Bong Long' },
      items: [{
        line_id: 'fold-undo-zero-line', kind: 'create_receive', quantity: 0,
        product: { name: 'Amber Balm', barcode: '9001234567890', cost_price_usd: 0, cost_price_khr: 0, selling_price_usd: 9, stock_quantity: 0, branch_id: 1 },
      }],
    }
    const receipt = await api.commitStockSession(f.env, user, request)
    assert.equal(receipt.success, true)
    assert.equal(f.sql.prepare('SELECT barcode FROM products WHERE id=2').get().barcode, '9001234567890')
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2)

    await api.replayStockSession(f.env, user, 'undo', receipt.actionHistoryId, 0, payload(f, receipt))
    assert.equal(f.sql.prepare('SELECT barcode FROM products WHERE id=2').get().barcode, beforeBarcode, 'the barcode cleanup itself was undone')
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1').get().quantity, 0, 'no stock was ever moved for this line, undo left it at zero')
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2, 'still no second row')
  })

  if (failures.length) {
    console.error(`\n${failures.length} failing: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nAll stock-session fold undo/redo tests passed')
}

main()
