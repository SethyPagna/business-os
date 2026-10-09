const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  for (const receipt of [false, true]) {
    const f = await h.world(worker, 'paid', 'zero', sql => {
      h.seed(1, receipt)(sql)
      sql.exec(`UPDATE products SET name='Merge twin',barcode='MERGE-1' WHERE id=1;
        INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,cost_price_khr)
          VALUES(2,'Merge twin','MERGE-1',1,2,2,8000);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2);`)
      if (receipt) sql.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
        VALUES(2,2,'set-first','2026-10-09',2,1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,2);`)
    })
    try {
      const result = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      assert.equal(result.status, 200)
      assert.deepEqual(f.sql.prepare('SELECT id,is_active,stock_quantity FROM products ORDER BY id').all(), [
        { id: 1, is_active: 1, stock_quantity: 3 }, { id: 2, is_active: 0, stock_quantity: 0 },
      ])
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 3)
      if (receipt) assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().quantity, 3)
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge' AND status='applied'").get().n, 1)
    } finally { f.sql.close() }
  }
  console.log('PASS merge capture current authenticated caller: 2 Paid integer worlds; exact fractional/replay/Free closure remains separate')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
