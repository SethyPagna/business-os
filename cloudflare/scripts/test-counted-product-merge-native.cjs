const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function costCaptureRivals(worker, modes = ['keeper-cost', 'duplicate-cost', 'keeper-baseline', 'duplicate-baseline', 'older-metadata', 'new-latest', 'empty-keeper']) {
  for (const mode of modes) {
    const f = await h.world(worker, 'paid', 'zero', sql => {
      h.seed(1, true)(sql)
      sql.exec(`UPDATE products SET name='Merge twin',barcode='MERGE-1' WHERE id=1;
        INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd) VALUES(2,'Merge twin','MERGE-1',1,2,2);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2);
        INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active) VALUES(2,2,'set-first','2026-10-09',2,1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,2);
        INSERT INTO product_cost_entries(id,product_id,cost_usd,cost_khr,source,user_id,user_name,baseline_batch_id,created_at,previous_cost_usd)
          VALUES(10,1,2,8000,'manual',7,'admin',0,'2026-09-01',NULL),(11,1,2,8000,'manual',7,'admin',1,'2026-10-01',2),
            (20,2,2,8000,'manual',7,'admin',0,'2026-09-01',NULL),(21,2,2,8000,'manual',7,'admin',2,'2026-10-01',2);`)
      if (mode === 'empty-keeper') sql.exec('DELETE FROM product_cost_entries WHERE product_id=1')
    })
    try {
      const protectedState = () => Object.fromEntries(['products', 'product_batches', 'branch_stock', 'branch_batch_stock',
        'inventory_movements', 'action_history', 'undo_snapshots', 'audit_logs'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
      const before = protectedState()
      const rival = mode === 'keeper-cost' ? 'UPDATE product_cost_entries SET cost_usd=1.0000000000000002 WHERE id=11'
        : mode === 'duplicate-cost' ? 'UPDATE product_cost_entries SET cost_usd=1.0000000000000002 WHERE id=21'
        : mode === 'keeper-baseline' ? 'UPDATE product_cost_entries SET baseline_batch_id=0 WHERE id=11'
        : mode === 'duplicate-baseline' ? 'UPDATE product_cost_entries SET baseline_batch_id=0 WHERE id=21'
        : mode === 'older-metadata' ? "UPDATE product_cost_entries SET source='historical-rival',previous_cost_usd=.30000000000000004 WHERE id=10"
        : "INSERT INTO product_cost_entries(id,product_id,cost_usd,cost_khr,source,baseline_batch_id) VALUES(99,1,2,8000,'manual',1)"
      let injected = false
      const raw = f.env.DB
      f.env.DB = new Proxy(raw, { get(target, key) {
        if (key === 'batch') return async statements => {
          if (!injected && statements.some(statement => /INSERT INTO system_flags/.test(statement.text) && /stock_transaction_permit/.test(statement.text))) {
            injected = true
            f.competeBeforeCommit([{ sql: rival }])
          }
          return target.batch(statements)
        }
        return target[key]
      } })
      const result = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      assert.equal(injected, true, mode + ' rival must land after coherent capture')
      assert.equal(result.status, 409, mode + ' manual history must invalidate capture')
      assert.equal(result.json.code, 'merge_conflict_retry')
      assert.deepEqual(protectedState(), before, mode + ' leaves every merge domain row unchanged')
      if (mode.endsWith('-cost')) assert.equal(f.sql.prepare('SELECT cost_usd FROM product_cost_entries WHERE id=?').get(mode.startsWith('keeper') ? 11 : 21).cost_usd, 1.0000000000000002)
      else if (mode.endsWith('-baseline')) assert.equal(f.sql.prepare('SELECT baseline_batch_id FROM product_cost_entries WHERE id=?').get(mode.startsWith('keeper') ? 11 : 21).baseline_batch_id, 0)
      else if (mode === 'older-metadata') assert.equal(f.sql.prepare('SELECT previous_cost_usd FROM product_cost_entries WHERE id=10').get().previous_cost_usd, .30000000000000004)
      else assert.equal(f.sql.prepare('SELECT product_id FROM product_cost_entries WHERE id=99').get().product_id, 1)
    } finally { f.sql.close() }
  }
  console.log('PASS complete manual cost history: ' + modes.length + ' Paid captured-row/baseline/older/newlatest/empty-source rivals')
}

async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  if (process.argv.includes('--cost-only')) return costCaptureRivals(worker)
  for (const { receipt, first, second, total } of [
    { receipt: false, first: 1, second: 2, total: 3 }, { receipt: true, first: 1, second: 2, total: 3 },
    { receipt: false, first: 0.1, second: 0.2, total: 0.3 }, { receipt: true, first: 0.1, second: 0.2, total: 0.3 },
    { receipt: 'move', first: 0.1, second: 0.2, total: 0.3 }, { receipt: false, first: 0, second: 0, total: 0 },
  ]) {
    const f = await h.world(worker, 'paid', 'zero', sql => {
      h.seed(first, receipt)(sql)
      sql.exec(`UPDATE products SET name='Merge twin',barcode='MERGE-1' WHERE id=1;
        INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,cost_price_khr)
          VALUES(2,'Merge twin','MERGE-1',1,${second},2,8000);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,${second});`)
      if (receipt) sql.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
        VALUES(2,2,'${receipt === 'move' ? 'move-other' : 'set-first'}','2026-10-09',2,1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,${second});`)
    })
    try {
      const result = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      assert.equal(result.status, 200)
      assert.deepEqual(f.sql.prepare('SELECT id,is_active,stock_quantity FROM products ORDER BY id').all(), [
        { id: 1, is_active: 1, stock_quantity: total }, { id: 2, is_active: 0, stock_quantity: 0 },
      ])
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, total)
      if (receipt) assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().quantity, receipt === 'move' ? first : total)
      if (receipt === 'move') {
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=2 AND branch_id=1').get().quantity, second)
        assert.equal(f.sql.prepare('SELECT variant_product_id FROM product_batches WHERE id=2').get().variant_product_id, 1)
        assert.equal(f.sql.prepare('SELECT received_at FROM product_batches WHERE id=2').get().received_at, '2026-10-09')
      }
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge' AND status='applied'").get().n, 1)
    } finally { f.sql.close() }
  }
  const multiple = await h.world(worker, 'paid', 'zero', sql => {
    h.seed(0.1, false)(sql)
    sql.exec(`UPDATE products SET name='Merge twin',barcode='MERGE-1',stock_quantity=0.3 WHERE id=1;
      INSERT INTO branches(id,name,is_active) VALUES(2,'Other',1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0.2);
      INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd) VALUES(2,'Merge twin','MERGE-1',1,0.3,2);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0.2),(2,2,0.1);`)
  })
  try {
    assert.equal((await multiple.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })).status, 200)
    assert.equal(multiple.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 0.6)
    assert.deepEqual(multiple.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 ORDER BY branch_id').all(), [{ quantity: 0.3 }, { quantity: 0.3 }])
  } finally { multiple.sql.close() }
  for (const fault of ['keeper-redistribution', 'zero-membership', 'late-audit-failure']) {
    const f = await h.world(worker, 'paid', 'zero', sql => {
      h.seed(0.1, false)(sql)
      sql.exec(`UPDATE products SET name='Merge twin',barcode='MERGE-1',stock_quantity=0.3 WHERE id=1;
        INSERT INTO branches(id,name,is_active) VALUES(2,'Other',1);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0.2);
        INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd) VALUES(2,'Merge twin','MERGE-1',1,0.2,2);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0.2);`)
    })
    try {
      const read = () => ({
        products: f.sql.prepare('SELECT * FROM products ORDER BY id').all(),
        stock: f.sql.prepare('SELECT * FROM branch_stock ORDER BY product_id,branch_id').all(),
        receipts: f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),
        receiptStock: f.sql.prepare('SELECT * FROM branch_batch_stock ORDER BY id').all(),
        movements: f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all(),
        history: f.sql.prepare('SELECT * FROM action_history ORDER BY id').all(),
        snapshots: f.sql.prepare('SELECT * FROM undo_snapshots ORDER BY id').all(),
        audits: f.sql.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
      })
      const before = read()
      let injected = false
      const raw = f.env.DB
      if (fault === 'late-audit-failure') f.failWhenSqlMatches(/INSERT INTO audit_logs/)
      else f.env.DB = new Proxy(raw, { get(target, key) {
        if (key === 'batch') return async statements => {
          if (!injected && statements.some(statement => /INSERT INTO system_flags/.test(statement.text) && /stock_transaction_permit/.test(statement.text))) {
            injected = true
            f.competeBeforeCommit(fault === 'keeper-redistribution'
              ? [{ sql: 'UPDATE branch_stock SET quantity=0.15 WHERE product_id=1' }]
              : [{ sql: "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(99,2,'new-zero-member',1)" }])
          }
          return target.batch(statements)
        }
        return target[key]
      } })
      const result = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      if (fault === 'late-audit-failure') {
        assert.equal(result.status, 409)
        assert.equal(result.json.code, 'merge_failed', 'a confirmed rollback retains the existing merge refusal contract')
        assert.deepEqual(read(), before)
      } else {
        assert.equal(injected, true, 'rival lands after capture and before the physical transaction')
        assert.equal(result.status, 409)
        assert.equal(result.json.code, 'merge_conflict_retry')
        assert.deepEqual(read().products, before.products)
        assert.deepEqual(read().movements, before.movements)
        assert.deepEqual(read().history, before.history)
        if (fault === 'keeper-redistribution') assert.deepEqual(read().stock.filter(row => row.product_id === 1).map(row => row.quantity), [0.15, 0.15])
        else assert.equal(f.sql.prepare('SELECT variant_product_id FROM product_batches WHERE id=99').get().variant_product_id, 2)
      }
    } finally { f.sql.close() }
  }
  for (const fault of ['keeper-tag-cost', 'duplicate-tag-cost', 'duplicate-received-date', 'keeper-zero-tag']) {
    const f = await h.world(worker, 'paid', 'zero', sql => {
      h.seed(1, true)(sql)
      sql.exec(`UPDATE products SET name='Merge twin',barcode='MERGE-1' WHERE id=1;
        INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd) VALUES(2,'Merge twin','MERGE-1',1,2,2);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2);
        INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
          VALUES(2,2,'set-first','2026-10-09',2,1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,2);
        INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
          VALUES(1,1,1,1,1,1,'damaged','remove',2),(2,2,1,2,1,1,'damaged','remove',2);`)
    })
    try {
      const protectedState = () => Object.fromEntries(['products', 'branch_stock', 'branch_batch_stock',
        'inventory_movements', 'action_history', 'undo_snapshots', 'audit_logs'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
      const before = protectedState()
      let injected = false
      const raw = f.env.DB
      const rival = fault === 'duplicate-received-date'
        ? "UPDATE product_batches SET received_at='2026-10-10' WHERE id=2"
        : fault === 'keeper-zero-tag'
        ? "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,unit_cost_usd) VALUES(99,1,1,1,0,0,'damaged',2)"
        : `UPDATE damaged_stock_lots SET unit_cost_usd=1.0000000000000002 WHERE id=${fault === 'keeper-tag-cost' ? 1 : 2}`
      f.env.DB = new Proxy(raw, { get(target, key) {
        if (key === 'batch') return async statements => {
          if (!injected && statements.some(statement => /INSERT INTO system_flags/.test(statement.text) && /stock_transaction_permit/.test(statement.text))) {
            injected = true
            f.competeBeforeCommit([{ sql: rival }])
          }
          return target.batch(statements)
        }
        return target[key]
      } })
      const result = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      assert.equal(injected, true)
      assert.equal(result.status, 409, `${fault} must invalidate the captured provenance`)
      assert.equal(result.json.code, 'merge_conflict_retry')
      assert.deepEqual(protectedState(), before)
      if (fault === 'duplicate-received-date') assert.equal(f.sql.prepare('SELECT received_at FROM product_batches WHERE id=2').get().received_at, '2026-10-10')
      else if (fault === 'keeper-zero-tag') assert.equal(f.sql.prepare('SELECT product_id FROM damaged_stock_lots WHERE id=99').get().product_id, 1)
      else assert.equal(f.sql.prepare('SELECT unit_cost_usd FROM damaged_stock_lots WHERE id=?').get(fault === 'keeper-tag-cost' ? 1 : 2).unit_cost_usd, 1.0000000000000002)
    } finally { f.sql.close() }
  }
  await costCaptureRivals(worker)
  console.log('PASS merge exact forward: 14 Paid integer/fractional/multi-branch/zero/race/provenance/rollback worlds; history/replay/Free closure remains separate')
}

module.exports = { costCaptureRivals }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
