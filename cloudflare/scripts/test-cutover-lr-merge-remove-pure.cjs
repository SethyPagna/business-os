// CUTOVER-LR item 13: product merge and product remove walk every stored branch_stock / branch_batch_stock row of a
// product, Old Shop's included. After the cutover Old Shop holds exactly 0 of everything, and both writers skip a
// zero row (routes/products.ts mergeDuplicateGroup `if (!qty) continue`; lib/productDelete.ts write_off rows
// `WHERE quantity > 0`), so neither posts a movement at Old Shop nor leaves it holding anything. Fixtures:
// scripts/harness/cutover_lr_world.cjs plus product 30, a duplicate of 10 (same name and barcode) holding 2 at LC
// Store and an empty row at Old Shop.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-merge-remove-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const products = W.makeWorld(null).load('routes/products.ts').default
const oldShopTotals = (db) => W.plain(db.prepare(`SELECT
    (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE branch_id=2) AS stock,
    (SELECT COALESCE(SUM(quantity),0) FROM branch_batch_stock WHERE branch_id=2) AS lots,
    (SELECT COUNT(*) FROM inventory_movements WHERE branch_id=2) AS movements`).get())

function withDuplicate(db) {
  db.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES(30,'Powder','POWDER-2','8850001',2,9.5,4,1)`).run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd) VALUES(800,30,'2026-09-05','POWDER-X','2026-09-05',1,1,4)`).run()
  db.exec(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(30,1,2),(30,2,0);
           INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(800,1,2),(800,2,0);`)
  return db
}

async function main() {
  await W.check('merge: folding a duplicate with an empty Old Shop row moves nothing into Old Shop and posts no movement there', async () => {
    const db = withDuplicate(W.build('after'))
    const res = await W.call(products, db, 'POST', '/merge-duplicates', {})
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(db.prepare('SELECT COUNT(*) n FROM products WHERE is_active=1 AND name=?').get(['Powder']).n, 1, 'the duplicate was merged')
    assert.deepEqual(oldShopTotals(db), { stock: 0, lots: 0, movements: 0 })
    assert.ok(W.movements(db).length > 0 && W.movements(db).every((m) => m.branch_id === 1), 'the merge movements are all at LC Store')
  })

  await W.check('remove: removing a product with an empty Old Shop row books its write-off at LC Store only', async () => {
    const db = W.build('after')
    const res = await W.call(products, db, 'DELETE', '/10', { reason: 'discontinued' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(W.movements(db).map((m) => [m.branch_id, m.movement_type, m.quantity]), [[1, 'write_off', 15]])
    assert.deepEqual(oldShopTotals(db), { stock: 0, lots: 0, movements: 0 })
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
