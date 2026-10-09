const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const filename = path.join(__dirname, 'test-counted-set-native.cjs')
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = module.paths
mod._compile(fs.readFileSync(filename, 'utf8').split('async function main() {')[0] + '\nmodule.exports={world,bundle}', filename)

async function main() {
  const { world, bundle } = mod.exports
  const makeWorker = await bundle.exports.bundleWorker()
  const counter = (f, id) => f.sql.prepare('SELECT * FROM inventory_movements WHERE reference_id=?').get(`revert:${id}`)
  const revert = (f, id) => f.call(`/inventory/movements/${id}/revert`, {})
  for (const tier of ['free', 'paid']) {
    for (const receipt of [false, true]) for (const decimal of [false, true]) for (const purchase of [false, true]) {
      const total = decimal ? 0.3 : 3, first = decimal ? 0.1 : 1, second = decimal ? 0.2 : 2
      const f = await world(makeWorker, tier, 'zero', sql => sql.exec(`
        UPDATE products SET stock_quantity=${total} WHERE id=1;
        UPDATE branch_stock SET quantity=${total} WHERE product_id=1 AND branch_id=1;
        UPDATE branch_batch_stock SET quantity=${receipt ? total : 0} WHERE batch_id=1 AND branch_id=1;
        UPDATE product_batches SET received_quantity=${total},received_cost_usd=${decimal ? 0.6 : 6},supplier_name='Synthetic supplier',payment_status='credit',credit_due_date='2026-11-01' WHERE id=1;
        INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,movement_type,quantity,batch_id,reason,unit_cost_usd,total_cost_usd)
          VALUES(101,1,'Serum',1,'Shop','${purchase ? 'add' : 'adjustment'}',${first},${receipt ? 1 : 'NULL'},'Original one',2,${decimal ? 0.2 : 2}),
                (102,1,'Serum',1,'Shop','${purchase ? 'add' : 'adjustment'}',${second},${receipt ? 1 : 'NULL'},'Original two',2,${decimal ? 0.4 : 4});`))
      try {
        const originals = f.state().movements
        const attribution = () => f.sql.prepare('SELECT supplier_id,supplier_name,payment_status,credit_due_date,received_branch_id,received_branch_name FROM product_batches WHERE id=1').get()
        const originalAttribution = attribution()
        assert.equal((await revert(f, 101)).status, 200)
        assert.equal(f.state().physical, second, 'decimal subtraction stores the exact remaining units')
        assert.equal(f.state().cache, second)
        assert.equal((await revert(f, 102)).status, 200, 'remaining decimal stock is usable')
        assert.equal(f.state().physical, 0)
        assert.equal(f.state().cache, 0)
        if (receipt && purchase) {
          const row = f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get()
          assert.equal(row.received_quantity, 0)
          assert.equal(row.received_cost_usd, 0)
          assert.equal(row.is_active, 0)
          assert.equal(row.supplier_name, 'Synthetic supplier')
          assert.deepEqual(attribution(), originalAttribution, 're-receive preserves original attribution including NULL')
        }
        const empty = f.state()
        assert.equal((await revert(f, 101)).json.code, 'already_reverted')
        assert.deepEqual(f.state(), empty)
        assert.equal((await revert(f, counter(f, 102).id)).status, 200)
        assert.equal((await revert(f, counter(f, 101).id)).status, 200)
        assert.equal(f.state().physical, total)
        assert.equal(f.state().cache, total)
        assert.equal(f.state().lots[0].quantity, receipt ? total : 0)
        assert.deepEqual(f.state().movements.slice(0, 2), originals)
        assert.equal(f.state().movements.length, 6)
        assert.equal(counter(f, 101).batch_id, receipt ? 1 : null)
        assert.equal(counter(f, 101).total_cost_usd, originals[0].total_cost_usd)
        if (receipt && purchase) {
          const row = f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get()
          assert.equal(row.received_quantity, total)
          assert.equal(row.received_cost_usd, decimal ? 0.6 : 6)
          assert.equal(row.payment_status, 'credit')
          assert.equal(row.credit_due_date, '2026-11-01')
          assert.equal(row.supplier_name, 'Synthetic supplier')
        }
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
      } finally { f.sql.close() }
    }
    for (const receipt of [false, true]) {
      const f = await world(makeWorker, tier, 'zero', sql => sql.exec(`
        UPDATE products SET stock_quantity=0.8 WHERE id=1;
        UPDATE branch_stock SET quantity=0.8 WHERE product_id=1 AND branch_id=1;
        UPDATE branch_batch_stock SET quantity=${receipt ? 0.8 : 0} WHERE batch_id=1 AND branch_id=1;
        INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)
          VALUES(1,1,1,${receipt ? 1 : 'NULL'},0.2,0.2,'damaged','remove');
        INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity,batch_id)
          VALUES(101,1,1,'adjustment',0.9,${receipt ? 1 : 'NULL'}),(102,1,1,'adjustment',0.8,${receipt ? 1 : 'NULL'});`))
      try {
        const before = f.state()
        assert.equal(before.physical, 1, 'legacy conversion keeps this control exact')
        assert.equal((await revert(f, 101)).status, 400, 'ordinary revert cannot consume damaged units')
        assert.deepEqual(f.state(), before)
        assert.equal((await revert(f, 102)).status, 200)
        assert.equal(f.state().physical, 0.2)
        assert.equal(f.state().tags[0].quantity_remaining, 0.2)
      } finally { f.sql.close() }
    }
    for (const race of ['physical', 'other-branch', 'tag', 'receipt', 'supplier']) {
      const f = await world(makeWorker, tier, 'zero', sql => sql.exec(`
        INSERT INTO branches(id,name,is_active) VALUES(2,'Other',1);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0.6);
        UPDATE products SET stock_quantity=0.9 WHERE id=1;
        UPDATE branch_stock SET quantity=0.3 WHERE product_id=1 AND branch_id=1;
        UPDATE branch_batch_stock SET quantity=0.3 WHERE batch_id=1 AND branch_id=1;
        UPDATE product_batches SET received_quantity=0.3,received_cost_usd=0.6 WHERE id=1;
        INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity,batch_id,unit_cost_usd,total_cost_usd)
          VALUES(101,1,1,'add',0.1,1,2,0.2);`))
      try {
        const stock = f.state(), original = stock.movements
        const changes = race === 'tag'
          ? ["INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source) VALUES(1,1,1,1,0.1,0.1,'damaged','remove')"]
          : race === 'receipt' ? ['UPDATE product_batches SET received_quantity=0.4 WHERE id=1']
          : race === 'supplier' ? ["UPDATE product_batches SET supplier_name='Concurrent supplier' WHERE id=1"]
          : race === 'physical' ? ['UPDATE branch_stock SET quantity=0.4 WHERE product_id=1 AND branch_id=1', 'UPDATE branch_batch_stock SET quantity=0.4 WHERE batch_id=1 AND branch_id=1', 'UPDATE products SET stock_quantity=1 WHERE id=1']
          : ['UPDATE branch_stock SET quantity=0.7 WHERE product_id=1 AND branch_id=2', 'UPDATE products SET stock_quantity=1 WHERE id=1']
        f.competeBeforeCommit(changes.map(sql => ({ sql })))
        const result = await revert(f, 101)
        assert.equal(result.status, 409, race)
        assert.equal(result.json.code, 'stock_changed', race)
        assert.deepEqual(f.state().movements, original)
        assert.equal(f.state().physical, race === 'physical' ? 0.4 : 0.3, 'only the rival writes remain')
        assert.equal((await revert(f, 101)).status, 200, 'fresh same action remains usable after known refusal')
        assert.equal(counter(f, 101).quantity, 0.1)
      } finally { f.sql.close() }
    }
    for (const failure of ['ack', 'late-check', 'late-error']) {
      const f = await world(makeWorker, tier, 'zero', sql => sql.exec(`
        UPDATE products SET stock_quantity=0.3 WHERE id=1;
        UPDATE branch_stock SET quantity=0.3 WHERE product_id=1 AND branch_id=1;
        UPDATE branch_batch_stock SET quantity=0.3 WHERE batch_id=1 AND branch_id=1;
        INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity,batch_id)
          VALUES(101,1,1,'adjustment',0.1,1);`))
      try {
        const before = f.state()
        if (failure === 'ack') f.loseNextCommitAcknowledgement()
        else if (failure === 'late-error') f.failWhenSqlMatches(/INSERT INTO inventory_movements/)
        else f.sql.exec("CREATE TRIGGER fail_revert_test BEFORE INSERT ON inventory_movements BEGIN INSERT INTO stock_session_guards(guard_value) VALUES(0); END")
        const result = await revert(f, 101)
        if (failure === 'ack') {
          assert.equal(result.json.code, 'already_reverted', 'original committed counter reconciles lost ACK')
          assert.equal(f.state().physical, 0.2)
          const committed = f.state()
          assert.equal((await revert(f, 101)).json.code, 'already_reverted')
          assert.deepEqual(f.state(), committed)
        } else {
          assert.equal(result.status, failure === 'late-check' ? 409 : 500)
          assert.deepEqual(f.state(), before, 'late failure rolls back every physical write')
          if (failure === 'late-check') f.sql.exec('DROP TRIGGER fail_revert_test')
          assert.equal((await revert(f, 101)).status, 200)
          assert.equal(f.state().physical, 0.2)
        }
      } finally { f.sql.close() }
    }
    const removed = await world(makeWorker, tier, 'zero', sql => sql.exec(`
      UPDATE products SET is_active=0 WHERE id=1;
      INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity,batch_id) VALUES(101,1,1,'remove',1,NULL);`))
    try {
      const before = removed.state()
      assert.equal((await revert(removed, 101)).json.code, 'product_has_stock')
      assert.deepEqual(removed.state(), before)
    } finally { removed.sql.close() }
  }
  console.log('PASS authenticated exact fractional/integer receipt/NULL reverts, purchases, immutable counters, retry and tagged subset')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
