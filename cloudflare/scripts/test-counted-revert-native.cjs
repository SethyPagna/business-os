const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const filename = path.join(__dirname, 'test-counted-set-native.cjs')
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = module.paths
mod._compile(fs.readFileSync(filename, 'utf8').split('async function main() {')[0] + '\nmodule.exports={world,bundle}', filename)

async function verifyRedirectHistory() {
  const { fixture, loadStockSession } = require('./test-stock-session-atomic.cjs')
  const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
  for (const originalBranch of [1, null]) for (const folded of [false, true]) {
    const f = fixture(sql => sql.exec(`
      INSERT INTO branches(id,name,is_active) VALUES(2,'Landing',1);
      UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1;
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0);
      INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity,received_cost_usd,
        received_branch_id,received_branch_name,supplier_name,payment_status,credit_due_date)
        VALUES(1,1,'old-receipt',0,2,0,0,${originalBranch ?? 'NULL'},${originalBranch === null ? 'NULL' : "'Original shop'"},'Original supplier','credit','2026-11-01');
      ${folded ? `INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity,received_cost_usd)
        VALUES(2,1,'survivor',1,2,0,0);
        INSERT INTO audit_logs(action,entity,entity_id,details) VALUES('branch_cutover_lot_fold','branch',2,'{"branchId":2,"survivorBatchId":2,"foldedBatchIds":[1]}');` : ''}
      INSERT INTO inventory_movements(id,product_id,branch_id,branch_name,movement_type,quantity,batch_id,unit_cost_usd,total_cost_usd,reference_id)
        VALUES(101,1,1,'Original shop','add',1,1,2,2,NULL),(102,1,1,'Original shop','remove',1,1,2,2,'revert:101');`))
    try {
      const db = loadStockSession('lib/db.ts').getDb(f.env)
      const before = f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get()
      let movement = f.sql.prepare('SELECT * FROM inventory_movements WHERE id=102').get()
      const originals = f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all()
      for (const expected of [1, 0, 1]) {
        assert.equal((await applyMovementRevert(db, movement, { userId: null, userName: 'Test' }, 2)).ok, true)
        const after = f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get()
        for (const key of ['supplier_id', 'supplier_name', 'payment_status', 'credit_due_date', 'unit_cost_usd', 'received_branch_id', 'received_branch_name']) {
          assert.equal(after[key], before[key], key + ' remains historical across redirected counters')
        }
        assert.equal(after.received_quantity, expected)
        assert.equal(after.received_cost_usd, expected * 2)
        const counter = f.sql.prepare('SELECT * FROM inventory_movements WHERE reference_id=?').get(`revert:${movement.id}`)
        assert.equal(counter.batch_id, folded ? 2 : 1)
        assert.equal(counter.branch_id, 2)
        if (movement.id === 102) assert.equal(counter.addressed_branch_name, 'Shop')
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity, expected)
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 0)
        assert.deepEqual(f.sql.prepare('SELECT * FROM inventory_movements WHERE id<=102 ORDER BY id').all(), originals)
        movement = counter
      }
    } finally { f.sql.close() }
  }
  console.log('PASS four redirect/folded receipt worlds, three compensation generations, historical NULL attribution')
}

async function verifyTaggedReceiptOwnership(makeWorker) {
  const { loadStockSession } = require('./test-stock-session-atomic.cjs')
  for (const tier of ['free', 'paid']) for (const timing of ['before-facts', 'before-commit']) {
    for (const shape of ['current', 'legacy', 'null', 'source-reason', 'source-reference', 'reference', 'product', 'branch', 'batch', 'reason', 'legacy-quantity', 'earlier']) {
      const edited = shape.startsWith('source-')
      const owns = edited || ['current', 'legacy', 'null'].includes(shape)
      const undated = shape === 'null'
      const f = await mod.exports.world(makeWorker, tier, 'zero', sql => sql.exec(`
        INSERT INTO branches(id,name,is_active) VALUES(2,'Other',1);
        INSERT INTO products(id,name,stock_quantity,is_active) VALUES(2,'Other product',0,1);
        INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(2,1,'Other receipt',1);
        UPDATE products SET stock_quantity=2 WHERE id=1;
        UPDATE branch_stock SET quantity=2 WHERE product_id=1 AND branch_id=1;
        UPDATE branch_batch_stock SET quantity=${undated ? 0 : 2} WHERE batch_id=1 AND branch_id=1;
        UPDATE product_batches SET received_quantity=2,received_cost_usd=4 WHERE id=1;
        INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity,batch_id,reference_id,reason,unit_cost_usd,total_cost_usd)
          VALUES(101,1,1,'add',1,${undated ? 'NULL' : 1},'55','  box crushed  ',2,2);`))
      try {
        let fired = false, rivalState
        const raw = f.env.DB
        const db = loadStockSession('lib/db.ts').getDb({ DB: raw })
        const legacy = shape === 'legacy' || shape === 'legacy-quantity'
        const rival = async () => {
          if (fired) return
          fired = true
          const statements = owns ? [{ sql: `INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)
            VALUES(30,1,1,${undated ? 'NULL' : 1},1,1,'damaged','restock')` }] : []
          if (edited) statements.push({ sql: shape === 'source-reason'
            ? "UPDATE inventory_movements SET reason='Changed intake reason' WHERE id=101"
            : "UPDATE inventory_movements SET reference_id='77' WHERE id=101" })
          statements.push({ sql: `INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity,batch_id,reference_id,reason)
            VALUES(${shape === 'earlier' ? 100 : 102},${shape === 'product' ? 2 : 1},${shape === 'branch' ? 2 : 1},
              '${legacy ? 'damage_out' : 'condition_tag'}',${legacy ? shape === 'legacy-quantity' ? -2 : -1 : 0},
              ${undated ? 'NULL' : shape === 'batch' ? 2 : 1},'${shape === 'reference' ? '9002' : shape === 'source-reference' ? '77' : '55'}',
              '${shape === 'reason' ? 'damaged: unrelated' : shape === 'source-reason' ? 'damaged: Changed intake reason' : 'damaged: box crushed'}')` })
          await loadStockSession('lib/stockTransaction.ts').executeStockTransaction(db, statements, 'once')
          rivalState = f.state()
        }
        if (timing === 'before-commit') f.beforeCommit(rival)
        else f.env.DB = new Proxy(raw, { get(target, key) {
          if (key !== 'prepare') return target[key]
          return query => {
            const wrap = statement => new Proxy(statement, { get(s, name) {
              if (name === 'bind') return (...values) => wrap(s.bind(...values))
              if (name === 'all' && query.includes('SELECT reason FROM inventory_movements') && query.includes('condition_tag')) {
                return async (...args) => { const result = await s.all(...args); await rival(); return result }
              }
              return s[name]
            } })
            return wrap(target.prepare(query))
          }
        } })
        const result = await f.call('/inventory/movements/101/revert', {})
        assert.equal(fired, true, timing + '/' + shape)
        assert.equal(result.status, owns ? 409 : 200, timing + '/' + shape)
        if (owns) {
          assert.equal(result.json.code, edited ? 'stock_changed' : 'revert_tagged_row')
          assert.deepEqual(f.state(), rivalState, 'ownership refusal leaves only rival history and physical stock')
          assert.equal((await f.call('/inventory/movements/101/revert', {})).json.code, 'revert_tagged_row')
          assert.deepEqual(f.state(), rivalState, 'fresh ownership remains authoritative')
        } else {
          assert.equal(f.state().physical, 1)
          const counter = f.sql.prepare("SELECT * FROM inventory_movements WHERE reference_id='revert:101'").get()
          assert.equal(counter.total_cost_usd, 2)
          assert.equal(counter.batch_id, undated ? null : 1)
          const committed = f.state()
          assert.equal((await f.call('/inventory/movements/101/revert', {})).json.code, 'already_reverted')
          assert.deepEqual(f.state(), committed)
        }
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
      } finally { f.sql.close() }
    }
  }
  console.log('PASS 48 authenticated intake history ownership worlds: fresh-facts/late, current/legacy/NULL, source edits, unrelated identities, immutable counters and retry')
}

async function main() {
  if (process.argv.includes('--ownership-only')) {
    await verifyTaggedReceiptOwnership(await mod.exports.bundle.exports.bundleWorker())
    return
  }
  await verifyRedirectHistory()
  if (process.argv.includes('--redirect-only')) return
  const { world, bundle } = mod.exports
  const makeWorker = await bundle.exports.bundleWorker()
  await verifyTaggedReceiptOwnership(makeWorker)
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
