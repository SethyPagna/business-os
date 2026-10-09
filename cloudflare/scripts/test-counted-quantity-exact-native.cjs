const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const helperFile = path.join(__dirname, 'test-counted-set-native.cjs')
const helper = new Module(helperFile, module)
helper.filename = helperFile; helper.paths = module.paths
helper._compile(fs.readFileSync(helperFile, 'utf8').split('async function main() {')[0] + '\nmodule.exports={world,bundle,loadStockSession}', helperFile)
const { world, bundle, loadStockSession } = helper.exports

function tag(f, quantity, batch, key) {
  return f.call('/inventory/adjust', { type: 'remove', productId: 1, branchId: 1, ...(batch ? { batchId: 1 } : {}),
    quantity, conditionTag: 'damaged', reason: 'Exact decimal tag', client_request_id: key })
}
function clear(f, quantity, key, action = 'restore') {
  return f.call('/inventory/tagged-lots/' + action, { productId: 1, branchId: 1, quantity,
    conditionTag: 'damaged', reason: 'Exact decimal clear', client_request_id: key })
}
function seed(physical, batch) {
  return sql => sql.exec(`UPDATE products SET stock_quantity=${physical} WHERE id=1;
    UPDATE branch_stock SET quantity=${physical} WHERE product_id=1 AND branch_id=1;
    UPDATE branch_batch_stock SET quantity=${batch ? physical : 0} WHERE batch_id=1 AND branch_id=1;`)
}
function quantities(f) {
  return { physical: f.state().physical, cache: f.state().cache, tags: f.state().tags.map(row => row.quantity_remaining) }
}
async function replay(f, direction) {
  const h = f.sql.prepare("SELECT id,undo_payload,redo_payload FROM action_history WHERE entity='stock_condition' ORDER BY id DESC LIMIT 1").get()
  const pointer = JSON.parse(h[direction + '_payload'])
  return f.call(`/action-history/${h.id}/${direction}`, { expected_generation: pointer.generation })
}

async function proveStaleCount(c) {
  const before = c.state()
  const stale = await clear(c, 0.4, 'quantity-stale-count')
  assert.equal(stale.status, 409)
  assert.equal(stale.json.code, 'tagged_lot_conflict')
  assert.deepEqual(c.state(), before)
  assert.equal(c.sql.prepare("SELECT COUNT(*) n FROM stock_mutation_receipts WHERE request_id='quantity-stale-count'").get().n, 0)
  assert.equal((await clear(c, 0.1, 'quantity-stale-count')).status, 200)
  assert.equal((await replay(c, 'undo')).status, 200)
  assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.3] })
  console.log('PASS stale quantity coded409/no effects/released receipt/corrected same-id retry')
}

async function proveMultiBranch(makeWorker) {
  const counted = loadStockSession('lib/countedDamagedStock.ts')
  const stock = loadStockSession('lib/stockTransaction.ts')
  const getDb = loadStockSession('lib/db.ts').getDb
  for (const tier of ['free', 'paid']) for (const deferred of [false, true]) {
    const f = await world(makeWorker, tier, 'zero', sql => {
      seed(0.3, false)(sql)
      sql.exec("INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.2);UPDATE products SET stock_quantity=0.5 WHERE id=1")
    })
    try {
      assert.equal((await tag(f, 0.3, false, 'quantity-multi-seed')).status, 200)
      const db = getDb(f.env)
      const capture = () => db.prepare(`SELECT value AS branchId,${counted.countedStockFactsSql('1', 'CAST(value AS INTEGER)')} AS facts FROM json_each('[1,2]') ORDER BY value`).all()
      const before = await capture()
      const group = new counted.CountedStockBatchPlan(before, { deferPhysicalWrites: deferred })
      const first = group.get(1, 1), second = group.get(1, 2)
      const identity = { lotId: 1, productId: 1, branchId: 1, batchId: null }
      const statements = [
        ...group.takePreimageGuards(),
        ...counted.planExactCountedTaggedChange(first, identity, 0.1, 'clear'),
        ...counted.planExactCountedOrdinaryChange(second, null, 0.1, 'consume'),
        ...counted.planExactCountedTaggedChange(first, identity, 0.1, 'consume'),
        ...counted.planExactCountedOrdinaryChange(second, null, 0.1, 'receive'),
        ...counted.planExactCountedTaggedChange(first, identity, 0.1, 'restore'),
        ...counted.planExactCountedTaggedChange(first, identity, 0.1, 'retag'),
        ...group.takeFinalPhysicalWrites(),
      ]
      assert.equal(statements.filter(row => row.sql.startsWith('SELECT CASE WHEN')).length, 2)
      assert.ok(statements.slice(0, 2).every(row => row.sql.startsWith('SELECT CASE WHEN')))
      await stock.executeStockTransaction(db, statements, 'once')
      assert.deepEqual(f.sql.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=1 ORDER BY branch_id').all(), [{ branch_id: 1, quantity: 0.3 }, { branch_id: 2, quantity: 0.2 }])
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.5, tags: [0.3] })

      const stale = new counted.CountedStockBatchPlan(await capture(), { deferPhysicalWrites: deferred })
      const refused = [
        ...stale.takePreimageGuards(),
        ...counted.planExactCountedOrdinaryChange(stale.get(1, 2), null, 0.1, 'consume'),
        ...counted.planExactCountedTaggedChange(stale.get(1, 1), identity, 0.1, 'consume'),
        ...stale.takeFinalPhysicalWrites(),
      ]
      f.competeBeforeCommit([{ sql: 'UPDATE branch_stock SET quantity=0.1 WHERE product_id=1 AND branch_id=2' }, { sql: 'UPDATE products SET stock_quantity=0.4 WHERE id=1' }])
      await assert.rejects(stock.executeStockTransaction(db, refused, 'once'), error => counted.isCountedStockConflict(error))
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.4, tags: [0.3] })
      const mixed = await capture()
      await stock.executeStockTransaction(db, [{ sql: 'UPDATE branch_stock SET quantity=0.2 WHERE product_id=1 AND branch_id=2', params: {} }, { sql: 'UPDATE products SET stock_quantity=0.5 WHERE id=1', params: {} }], 'once')
      const fresh = await capture()
      assert.throws(() => new counted.CountedStockBatchPlan([mixed[0], fresh[1]]), error => counted.isCountedStockConflict(error))

      const emptyReceipt = await db.prepare(`SELECT ${counted.countedStockFactsSql('1', '2', "'[1]'")} AS facts`).get()
      assert.equal(JSON.parse(emptyReceipt.facts).receipts[0][3], null)
      const receiptGroup = new counted.CountedStockBatchPlan([{facts:emptyReceipt.facts,branchId:2}], {deferPhysicalWrites:deferred})
      const receipt = receiptGroup.get(1, 2)
      await stock.executeStockTransaction(db, [
        ...counted.planExactCountedOrdinaryChange(receipt, 1, 0.1, 'receive'),
        ...counted.planExactCountedOrdinaryChange(receipt, 1, 0.1, 'consume'),
        ...receiptGroup.takeFinalPhysicalWrites(),
      ], 'once')
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=2').get().quantity, 0)
      assert.equal(f.state().cache, 0.5)
      console.log('PASS genuine NULL receipt ledger preimage creates exact known active receipt and consumes in one batch ' + tier + ' deferred=' + deferred)

      await stock.executeStockTransaction(db, [{ sql: "INSERT INTO branches(id,name,is_active)VALUES(3,'New',1)", params: {} }], 'once')
      const newBranch = await db.prepare(`SELECT ${counted.countedStockFactsSql('1', '3')} AS facts`).get()
      const missing = new counted.CountedStockPlan(newBranch.facts, 3)
      assert.throws(() => counted.planExactCountedOrdinaryChange(missing, null, 0.1, 'consume'), error => counted.isCountedStockConflict(error))
      const create = new counted.CountedStockPlan(newBranch.facts, 3)
      await stock.executeStockTransaction(db, counted.planExactCountedOrdinaryChange(create, null, 0.1, 'receive'), 'once')
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=3').get().quantity, 0.1)
      assert.equal(f.state().cache, 0.6)
      await stock.executeStockTransaction(db,[{sql:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd)VALUES(2,1,'over-ledger',1,2)"},{sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,1,0.4)'}],'once')
      const overLedger = await db.prepare(`SELECT ${counted.countedStockFactsSql('1','1')} facts`).get()
      const invalid = new counted.CountedStockBatchPlan([{facts:overLedger.facts,branchId:1}], {deferPhysicalWrites:deferred})
      const invalidBefore = f.state()
      assert.throws(()=>counted.planExactCountedTaggedChange(invalid.get(1,1),identity,0.1,'consume'),error=>counted.isCountedStockConflict(error))
      assert.deepEqual(f.state(),invalidBefore)
      console.log('PASS same-product multi-branch mixed tag/ordinary batch, rivals, generation and positive missing-branch receive ' + tier + ' deferred=' + deferred)
    } finally { f.sql.close() }
  }
}

async function proveReceiptActivation(makeWorker) {
  const counted = loadStockSession('lib/countedDamagedStock.ts')
  const stock = loadStockSession('lib/stockTransaction.ts')
  const getDb = loadStockSession('lib/db.ts').getDb
  for (const tier of ['free', 'paid']) for (const deferred of [false, true]) {
    const f = await world(makeWorker, tier, 'zero', sql => {
      sql.exec("UPDATE product_batches SET is_active=0 WHERE id=1;INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0);INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Unrelated',0,1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,0);INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(2,2,'unrelated',0)")
    })
    try {
      const db = getDb(f.env)
      const capture = () => db.prepare(`SELECT value AS branchId,${counted.countedStockFactsSql('1', 'CAST(value AS INTEGER)', "'[1]'")} AS facts FROM json_each('[1,2]') ORDER BY value`).all()
      const prepare = async () => {
        const group = new counted.CountedStockBatchPlan(await capture(), { deferPhysicalWrites: deferred })
        const first = group.get(1, 1), second = group.get(1, 2)
        assert.throws(() => counted.planExactCountedOrdinaryChange(first, 1, 0.1, 'consume'), error => counted.isCountedStockConflict(error))
        assert.throws(() => counted.planExactCountedOrdinaryChange(first, 1, 0.1, 'receive'), error => counted.isCountedStockConflict(error))
        assert.throws(() => counted.planExactCountedOrdinaryChange(first, 2, 0.1, 'activateAndReceive'), error => counted.isCountedStockConflict(error))
        const out = [...group.takePreimageGuards(), ...counted.planExactCountedOrdinaryChange(first, 1, 0.1, 'activateAndReceive')]
        assert.equal(second.requiresReceiptActivation(1), false)
        return [...out, ...counted.planExactCountedOrdinaryChange(second, 1, 0.2, 'receive'), ...group.takeFinalPhysicalWrites()]
      }
      const before = f.state()
      await assert.rejects(stock.executeStockTransaction(db, [...await prepare(), { sql: 'SELECT unknown_late_receipt_column', params: {} }], 'once'), error => !counted.isCountedStockConflict(error))
      assert.deepEqual(f.state(), before)
      assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, 0)
      for (const mutation of ['active', 'owner']) {
        const statements = await prepare()
        f.competeBeforeCommit([{ sql: mutation === 'active' ? 'UPDATE product_batches SET is_active=1 WHERE id=1' : 'UPDATE product_batches SET variant_product_id=2 WHERE id=1' }])
        await assert.rejects(stock.executeStockTransaction(db, statements, 'once'), error => counted.isCountedStockConflict(error))
        assert.deepEqual(f.state(), before)
        await stock.executeStockTransaction(db, [{ sql: 'UPDATE product_batches SET is_active=0,variant_product_id=1 WHERE id=1', params: {} }], 'once')
      }
      await stock.executeStockTransaction(db, await prepare(), 'once')
      assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, 1)
      assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=2').get().is_active, 0)
      assert.equal(f.state().cache, 0.3)
      assert.deepEqual(f.sql.prepare('SELECT branch_id,quantity FROM branch_batch_stock WHERE batch_id=1 ORDER BY branch_id').all(), [{ branch_id: 1, quantity: 0.1 }, { branch_id: 2, quantity: 0.2 }])
      console.log('PASS explicit original receipt activation across two branches, unrelated/inactive consumption refusal, owner/active rivals and late rollback ' + tier + ' deferred=' + deferred)
    } finally { f.sql.close() }
  }
}

async function proveBulkReturns(makeWorker, oversized = false, multipleReceipts = false) {
  const stock = loadStockSession('lib/stockTransaction.ts')
  const getDb = loadStockSession('lib/db.ts').getDb
  for (const tier of ['free', 'paid']) for (const receipt of [true, false]) for (const splitBranch of [false, true]) for (const shape of ['tagged', 'mixed', 'ordinary']) {
    if (multipleReceipts && (!receipt || splitBranch || shape !== 'ordinary')) continue
    if (oversized && (tier !== 'free' || !receipt || !splitBranch || shape !== 'tagged')) continue
    const f = await world(makeWorker, tier, 'zero', sql => {
      seed(0.3, receipt)(sql)
      if (multipleReceipts) sql.exec("UPDATE branch_batch_stock SET quantity=0.1 WHERE batch_id=1;INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity)VALUES(2,1,'second-source',1,2,0.2);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,1,0.2)")
      if (splitBranch) sql.exec(`INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1);UPDATE branch_stock SET quantity=0.1 WHERE product_id=1 AND branch_id=1;INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.2);UPDATE branch_batch_stock SET quantity=${receipt ? 0.1 : 0} WHERE batch_id=1 AND branch_id=1;${receipt ? 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,2,0.2);' : ''}`)
      for (const [index, quantity] of [0.1, 0.2].entries()) {
        const id = index + 1, branch = splitBranch && index ? 2 : 1
        const tagged = shape === 'tagged' || (shape === 'mixed' && !index)
        if (oversized) sql.prepare("INSERT INTO returns(id,return_number,return_scope,status,return_type,branch_id,updated_at)VALUES(?,?,'customer','completed','restock',?,'bulk-quantity-v1')").run(id,'RET-Q-'+id,branch)
        else if (!index) sql.prepare("INSERT INTO returns(id,return_number,return_scope,status,return_type,branch_id,updated_at)VALUES(1,'RET-Q-1','customer','completed','restock',1,'bulk-quantity-v1')").run()
        sql.prepare('INSERT INTO return_items(id,return_id,product_id,product_name,branch_id,batch_id,quantity,cost_price_usd,return_to_stock,stock_action)VALUES(?,?,1,?,?,?, ?,2,1,?)')
          .run(id, oversized ? id : 1, 'Serum', branch, receipt ? multipleReceipts ? id : 1 : null, quantity, tagged ? 'damaged' : 'restock')
      }
    })
    try {
      const setup = []
      for (const [index, quantity] of [0.1, 0.2].entries()) {
        const id = index + 1, branch = splitBranch && index ? 2 : 1
        const tagged = shape === 'tagged' || (shape === 'mixed' && !index)
        setup.push({ sql: 'UPDATE return_items SET stock_condition=@condition WHERE id=@id', params: { id, condition: tagged ? 'damaged' : 'ordinary' } })
        if (tagged) setup.push({ sql: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,return_id,return_item_id,unit_cost_usd)VALUES(@id,1,@branch,@batch,@quantity,@quantity,'damaged','return',@returnId,@id,2)", params: { id, returnId: oversized ? id : 1, branch, batch: receipt ? 1 : null, quantity } })
      }
      await stock.executeStockTransaction(getDb(f.env), setup, 'once')
      const body = { client_request_id: 'quantity-bulk-cancel', field: 'status', source: 'completed', target: 'cancelled', items: f.sql.prepare('SELECT id,status AS expected_status,return_type AS expected_method,updated_at AS expected_updated_at FROM returns ORDER BY id').all() }
      const before = f.state()
      if (oversized) {
        const refused = await f.call('/returns/bulk',body)
        assert.equal(refused.status,400)
        assert.equal(refused.json.code,'customer_return_over_plan_budget')
        assert.deepEqual(f.state(),before)
        assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM return_bulk_operations').get().n,0)
        console.log('PASS larger two-header Free admission refuses atomically with unchanged reserve')
        continue
      }
      const receiptIdentity = f.sql.prepare('SELECT id,unit_cost_usd,received_quantity FROM product_batches ORDER BY id').all()
      if (shape === 'tagged' && splitBranch && receipt) for (const rival of ['cost','identity']) {
        f.competeBeforeCommit([{sql:rival==='cost'?'UPDATE product_batches SET unit_cost_usd=3 WHERE id=1':'UPDATE damaged_stock_lots SET return_item_id=2 WHERE id=1'}])
        const refused = await f.call('/returns/bulk',body)
        assert.equal(refused.status,409)
        assert.equal(refused.json.code,'write_conflict')
        assert.deepEqual(f.state(),before)
        await stock.executeStockTransaction(getDb(f.env),[{sql:rival==='cost'?'UPDATE product_batches SET unit_cost_usd=2 WHERE id=1':'UPDATE damaged_stock_lots SET return_item_id=1 WHERE id=1'}],'once')
      }
      if (shape === 'mixed' && !splitBranch) {
        f.failWhenSqlMatches(/UPDATE return_bulk_operations SET history_id=/)
        assert.equal((await f.call('/returns/bulk', body)).status, 500)
        assert.deepEqual(f.state(), before)
        assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM return_bulk_operations').get().n, 0)
      }
      if (shape === 'ordinary' && !splitBranch) f.loseNextCommitAcknowledgement()
      const saved = await f.call('/returns/bulk', body)
      assert.equal(saved.status, 200, tier + '/' + receipt + '/' + splitBranch + '/' + shape + ' ' + JSON.stringify(saved.json))
      assert.equal(f.state().cache, 0)
      assert.ok(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').all().every(row => row.quantity === 0))
      assert.ok(f.state().tags.every(row => row.quantity_remaining === 0))
      const committed = f.state()
      assert.equal((await f.call('/returns/bulk', body)).status, 200)
      assert.deepEqual(f.state(), committed)
      if (shape === 'ordinary' && receipt) await stock.executeStockTransaction(getDb(f.env), [{ sql: 'UPDATE product_batches SET is_active=0 WHERE id=1', params: {} }], 'once')
      let history = f.sql.prepare('SELECT id,undo_payload FROM action_history WHERE id=?').get(saved.json.actionHistoryId)
      assert.equal((await f.call(`/action-history/${history.id}/undo`, { expected_generation: JSON.parse(history.undo_payload).generation })).status, 200)
      assert.equal(f.state().cache, 0.3)
      assert.deepEqual(f.sql.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=1 ORDER BY branch_id').all(), splitBranch ? [{ branch_id: 1, quantity: 0.1 }, { branch_id: 2, quantity: 0.2 }] : [{ branch_id: 1, quantity: 0.3 }])
      assert.deepEqual(f.state().tags, before.tags)
      assert.deepEqual(f.state().lots, before.lots)
      const coherence = loadStockSession('lib/countedDamagedStock.ts')
      for (const branchId of splitBranch ? [1,2] : [1]) {
        const observed = await getDb(f.env).prepare(`SELECT ${coherence.countedStockFactsSql('1',String(branchId))} facts`).get()
        assert.ok(new coherence.CountedStockPlan(observed.facts,branchId).ordinaryQuantity(receipt ? 1 : null)>=0)
      }
      if (receipt) assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, 1)
      history = f.sql.prepare('SELECT id,redo_payload FROM action_history WHERE id=?').get(history.id)
      assert.equal((await f.call(`/action-history/${history.id}/redo`, { expected_generation: JSON.parse(history.redo_payload).generation })).status, 200)
      assert.equal(f.state().cache, 0)
      assert.deepEqual(f.sql.prepare('SELECT id,unit_cost_usd,received_quantity FROM product_batches ORDER BY id').all(),receiptIdentity)
      const exactFacts = loadStockSession('lib/countedDamagedStock.ts')
      for (const branchId of splitBranch ? [1,2] : [1]) {
        const observed = await getDb(f.env).prepare(`SELECT ${exactFacts.countedStockFactsSql('1',String(branchId))} facts`).get()
        const context = new exactFacts.CountedStockPlan(observed.facts,branchId)
        assert.equal(context.ordinaryQuantity(receipt ? 1 : null),0)
      }
      if (multipleReceipts) {
        await stock.executeStockTransaction(getDb(f.env),[{sql:'DELETE FROM branch_batch_stock WHERE batch_id IN(1,2)'},{sql:'UPDATE product_batches SET is_active=0 WHERE id IN(1,2)'}],'once')
        const restored = await f.call('/returns/bulk',{...body,client_request_id:'quantity-missing-original-receipts',source:'cancelled',target:'completed',items:f.sql.prepare('SELECT id,status AS expected_status,return_type AS expected_method,updated_at AS expected_updated_at FROM returns ORDER BY id').all()})
        assert.equal(restored.status,200,JSON.stringify(restored.json))
        assert.equal(f.state().cache,0.3)
        assert.deepEqual(f.sql.prepare('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id').all(),[{batch_id:1,quantity:0.1},{batch_id:2,quantity:0.2}])
        assert.deepEqual(f.sql.prepare('SELECT id,unit_cost_usd,received_quantity FROM product_batches ORDER BY id').all(),receiptIdentity)
        console.log('PASS two distinct original missing ledgers captured consistently across repeated product items '+tier)
      }
      console.log('PASS actual grouped decimal cancel/replay/UndoRedo, exact same-product projected cache and archived ordinary receipt restore ' + JSON.stringify({ tier, receipt, splitBranch, shape }))
    } finally { f.sql.close() }
  }
}

async function main() {
  const bounded = loadStockSession('lib/countedDamagedStock.ts')
  assert.equal(bounded.sumCountedQuantities(Array(10_001).fill(0.00001)), 0.10001)
  assert.equal(bounded.subtractCountedQuantity(0.20001, Array(10_001).fill(0.00001)), 0.1)
  console.log('PASS bounded exact intermediate strings across separate 10k term groups')
  const makeWorker = await bundle.exports.bundleWorker()
  await proveMultiBranch(makeWorker)
  await proveReceiptActivation(makeWorker)
  await proveBulkReturns(makeWorker)
  await proveBulkReturns(makeWorker,true)
  await proveBulkReturns(makeWorker,false,true)
  for (const tier of ['free', 'paid']) for (const batch of [true, false]) {
    const f = await world(makeWorker, tier, 'zero', seed(0.3, batch))
    try {
      assert.equal((await tag(f, 0.1, batch, 'quantity-first-tag')).status, 200)
      assert.equal((await tag(f, 0.2, batch, 'quantity-second-tag')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0.1, 0.2] })
      assert.equal((await tag(f, 0.01, batch, 'quantity-over-tag')).status, 409)
      assert.equal((await clear(f, 0.3, 'quantity-full-clear')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0, 0] })
      assert.equal((await replay(f, 'undo')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0.1, 0.2] })
      assert.equal((await replay(f, 'redo')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0, 0] })
      console.log('PASS exact sequential tags/FIFO multi-lot clear/UndoRedo ' + tier + ' receipt=' + batch)
    } finally { f.sql.close() }

    const c = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(c, 0.3, batch, 'quantity-clear-tag')).status, 200)
      await proveStaleCount(c)
      assert.equal((await clear(c, 0.1, 'quantity-clear-first')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.2] })
      assert.equal((await clear(c, 0.2, 'quantity-clear-second')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0] })
      assert.equal((await replay(c, 'undo')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.2] })
      assert.equal((await clear(c, 0.2, 'quantity-exact-dispose', 'dispose')).status, 200)
      assert.deepEqual(quantities(c), { physical: 0.8, cache: 0.8, tags: [0] })
      assert.equal((await replay(c, 'undo')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.2] })
      console.log('PASS exact partial clear/dispose/physical cache/Undo ' + tier + ' receipt=' + batch)
    } finally { c.sql.close() }

    for (const mutation of ['cache', 'receipt', 'metadata', 'receipt-owner', 'receipt-inactive', 'tag-insert', 'tag-zero-insert', 'tag-delete', 'tag-identity', 'clear-rival']) {
      for (const action of ['tag', 'clear', 'dispose']) {
        const r = await world(makeWorker, tier, 'zero', seed(0.3, batch))
        try {
          assert.equal((await tag(r, 0.1, batch, 'quantity-race-seed')).status, 200)
          const before = r.state()
          let rival
          if (mutation === 'cache') rival = [{ sql: 'UPDATE products SET stock_quantity=0.4 WHERE id=1' }]
          if (mutation === 'receipt') rival = [{ sql: 'UPDATE branch_batch_stock SET quantity=@quantity WHERE batch_id=1 AND branch_id=1', params: { quantity: batch ? 0.2 : 0.1 } }]
          if (mutation === 'metadata') rival = [{ sql: 'UPDATE product_batches SET unit_cost_usd=3 WHERE id=1' }]
          if (mutation === 'receipt-owner') rival = [{ sql: "INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Rival',0,1)" }, { sql: 'UPDATE product_batches SET variant_product_id=2 WHERE id=1' }]
          if (mutation === 'receipt-inactive') rival = [{ sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=1' }, { sql: 'UPDATE product_batches SET is_active=0 WHERE id=1' }]
          if (mutation === 'tag-insert') rival = [{ sql: "INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,@batch,0.05,0.05,'damaged','remove')", params: { batch: batch ? 1 : null } }]
          if (mutation === 'tag-zero-insert') rival = [{ sql: "INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,@batch,0.05,0,'opened','remove')", params: { batch: batch ? 1 : null } }]
          if (mutation === 'tag-delete') rival = [{ sql: 'DELETE FROM damaged_stock_lots WHERE id=1' }]
          if (mutation === 'tag-identity') rival = [{ sql: "UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1" }]
          if (mutation === 'clear-rival') rival = [{ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0.05 WHERE id=1' }]
          r.competeBeforeCommit(rival)
          const result = action === 'tag' ? await tag(r, 0.1, batch, 'quantity-race-request') : await clear(r, 0.1, 'quantity-race-request', action === 'dispose' ? 'dispose' : 'restore')
          assert.equal(result.status, 409, mutation + '/' + action)
          assert.ok(['counted_quantity_conflict', 'tagged_lot_conflict'].includes(result.json.code))
          assert.doesNotMatch(JSON.stringify(result.json), /json_extract|bad JSON path|SQLITE/)
          assert.deepEqual(r.state().history, before.history)
          assert.deepEqual(r.state().movements, before.movements)
          assert.equal(r.sql.prepare('SELECT COUNT(*) n FROM stock_session_guards').get().n, 0)
          console.log('PASS actual rival transaction refused ' + tier + ' receipt=' + batch + ' ' + mutation + '/' + action)
        } finally { r.sql.close() }
      }
    }

    const failure = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(failure, 0.3, batch, 'quantity-failure-seed')).status, 200)
      const before = failure.state()
      const rawDb = failure.env.DB
      let failFacts = true
      failure.env.DB = new Proxy(rawDb, { get(target, key) {
        if (key === 'prepare') return sql => {
          if (failFacts && sql.includes("'product',json_array")) { failFacts = false; throw new Error('injected unknown facts driver') }
          return target.prepare(sql)
        }
        return target[key]
      } })
      assert.equal((await clear(failure, 0.1, 'quantity-unknown-facts')).status, 500)
      assert.deepEqual(failure.state(), before, 'unknown read error cannot become a stock conflict')
      failure.failWhenSqlMatches(/UPDATE damaged_stock_lots SET quantity_remaining=/)
      const unknown = await clear(failure, 0.1, 'quantity-unknown-driver')
      assert.equal(unknown.status, 503)
      assert.equal(unknown.json.code, 'stock_request_outcome_unknown', 'the existing receipt contract handles unknown dispatched failures')
      assert.deepEqual(failure.state(), before, 'unexpected driver exception rolls back the whole clear/history batch')
      assert.equal((await clear(failure, 0.1, 'quantity-unknown-driver')).status, 200)
      failure.loseNextCommitAcknowledgement()
      assert.equal((await clear(failure, 0.2, 'quantity-lost-ack')).status, 503)
      const committed = failure.state()
      const unresolved = await clear(failure, 0.2, 'quantity-lost-ack')
      assert.equal(unresolved.status, 409)
      assert.equal(unresolved.json.code, 'stock_request_partially_applied')
      assert.deepEqual(failure.state(), committed, 'the original unknown-outcome receipt never applies a second time')
      assert.deepEqual(quantities(failure), { physical: 1, cache: 1, tags: [0] })
      console.log('PASS unknown read500/dispatched503 atomic rollback/retry and exact lost-ACK replay ' + tier + ' receipt=' + batch)
    } finally { failure.sql.close() }

    const ordered = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(ordered, 0.3, batch, 'quantity-ordered-seed')).status, 200)
      const counted = loadStockSession('lib/countedDamagedStock.ts')
      const stock = loadStockSession('lib/stockTransaction.ts')
      const db = loadStockSession('lib/db.ts').getDb(ordered.env)
      const observed = await db.prepare(`SELECT ${counted.countedStockFactsSql('@product', '@branch')} facts`).get({ product: 1, branch: 1 })
      const exact = new counted.CountedStockPlan(observed.facts, 1)
      const identity = { lotId: 1, productId: 1, branchId: 1, batchId: batch ? 1 : null }
      await stock.executeStockTransaction(db, [
        ...counted.planExactCountedTaggedChange(exact, identity, 0.1, 'clear'),
        ...counted.planExactCountedTaggedChange(exact, identity, 0.1, 'consume'),
        ...counted.planExactCountedTaggedChange(exact, identity, 0.1, 'restore'),
      ], 'once')
      assert.deepEqual(quantities(ordered), { physical: 1, cache: 1, tags: [0.2] })
      console.log('PASS projected clear/consume/restore in ONE real atomic batch ' + tier + ' receipt=' + batch)
    } finally { ordered.sql.close() }

    for (const direction of ['undo', 'redo']) {
      const h = await world(makeWorker, tier, 'zero', seed(1, batch))
      try {
        assert.equal((await tag(h, 0.3, batch, 'quantity-history-seed')).status, 200)
        assert.equal((await clear(h, 0.1, 'quantity-history-clear')).status, 200)
        if (direction === 'redo') assert.equal((await replay(h, 'undo')).status, 200)
        const before = h.state()
        h.competeBeforeCommit([{ sql: "INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,@batch,0.05,0.05,'opened','remove')", params: { batch: batch ? 1 : null } }])
        assert.equal((await replay(h, direction)).status, 409)
        assert.deepEqual(h.state().movements, before.movements)
        assert.deepEqual(h.state().history, before.history)
        assert.equal(h.state().tags.length, 2, 'rival row remains, replay membership guard refuses')
        console.log('PASS whole membership rival UndoRedo refusal ' + tier + ' receipt=' + batch + ' ' + direction)
      } finally { h.sql.close() }
    }

    const authority = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(authority, 0.3, batch, 'quantity-authority-seed')).status, 200)
      const before = authority.state()
      authority.sql.exec("INSERT INTO roles(id,code,name,permissions)VALUES(900,'quantity-denied','Denied','{}');UPDATE users SET role_id=900,permissions='{}' WHERE id=7")
      assert.equal((await clear(authority, 0.1, 'quantity-authority-clear')).status, 403)
      assert.equal((await tag(authority, 0.1, batch, 'quantity-authority-tag')).status, 403)
      assert.deepEqual(authority.state(), before)
      console.log('PASS same-session live authority revocation refuses tag/clear ' + tier + ' receipt=' + batch)
    } finally { authority.sql.close() }
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { world, bundle, loadStockSession, tag, clear, seed, quantities, replay, proveStaleCount, proveMultiBranch, proveReceiptActivation, proveBulkReturns }
