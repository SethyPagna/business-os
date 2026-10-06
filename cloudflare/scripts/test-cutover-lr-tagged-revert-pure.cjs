// CUTOVER-LR: the tagged-row actions (POST /api/inventory/tagged-lots/restore and /dispose) on units held at a
// disabled branch, and the ledger Revert (POST /api/inventory/movements/:id/revert) of a Stock Changes row recorded
// there (owner ruling REVERT-SET Q4: the same redirect rule). Same contract and fixtures as
// test-cutover-lr-adjust-pure.cjs (scripts/harness/cutover_lr_world.cjs).
//
// The held lots stay the record of the branch they were held at (a consolidation never moves them): a Restore
// takes the units out of Old Shop's held row and puts them on sale at the confirmed branch; a Dispose books the
// loss there. A Revert moves the stock at the confirmed branch on the lot as it exists there now, while the
// purchase figures stay on the lot that was received.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-tagged-revert-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const inventory = (world) => world.load('routes/inventory.ts').default
const OLD_SHOP_ZERO = [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }]

function withHeldLot(db, branchId) {
  db.prepare(`INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,quantity,quantity_remaining,reason,condition_tag,source,unit_cost_usd)
    VALUES(900,10,'Powder',?,500,3,3,'dropped','broken','remove',4)`).run([branchId])
  return db
}
// A Shop-era receipt of 4 into lot 500 (recorded before the cutover, its units since moved to LC Store).
function withShopReceipt(db) {
  db.prepare(`INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,user_id,user_name,batch_id)
    VALUES(4000,10,'Powder',2,'Shop','add',4,4,16,'delivery',71,'Owner',500)`).run()
  return db
}
const tagged = (extra = {}) => ({ productId: 10, branchId: 2, conditionTag: 'broken', quantity: 2, reason: 'checked', ...extra })

async function main() {
  await W.check('before: restore, dispose and revert write byte-identical statements to the eb5dd0ba3 oracle', async () => {
    for (const [url, body, setup] of [['/tagged-lots/restore', tagged(), (db) => withHeldLot(db, 2)], ['/tagged-lots/dispose', tagged(), (db) => withHeldLot(db, 2)], ['/movements/4000/revert', {}, withShopReceipt]]) {
      const dbNew = setup(W.build('before')); const dbOld = setup(W.build('before'))
      const capNew = []; const capOld = []
      const a = await W.call(inventory(fresh), dbNew, 'POST', url, body, { capture: capNew, redirect: 1 })
      const b = await W.call(inventory(oracle), dbOld, 'POST', url, body, { capture: capOld })
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(W.normalised(a), W.normalised(b), url)
      assert.equal(W.normalised(capNew), W.normalised(capOld), url)
      assert.equal(W.normalised(W.ledger(dbNew)), W.normalised(W.ledger(dbOld)), url)
    }
  })

  await W.check('control: the oracle restores held units into the disabled branch and reverts a Shop receipt there', async () => {
    const db = withShopReceipt(withHeldLot(W.build('after'), 2))
    db.exec('UPDATE branch_stock SET quantity=4 WHERE branch_id=2 AND product_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE branch_id=2 AND batch_id=500')
    assert.equal((await W.call(inventory(oracle), db, 'POST', '/tagged-lots/restore', tagged())).status, 200)
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 2), 6, 'sellable stock appeared at Old Shop')
  })

  await W.check('after: restore: refused without a valid confirmation; with it the units go on sale at LC Store (lot 500 -> survivor 600)', async () => {
    const db = withHeldLot(W.build('after'), 2)
    await W.assertRefusals(db, (redirect) => W.call(inventory(fresh), db, 'POST', '/tagged-lots/restore', tagged(), { redirect }), 'restore')
    const ok = await W.call(inventory(fresh), db, 'POST', '/tagged-lots/restore', tagged(), { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=900').get().quantity_remaining, 1, 'the held row at Old Shop gave up 2')
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 17)
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 17)
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 500, 1), null, 'the folded lot is not re-created at LC Store')
    assert.deepEqual(W.movements(db).map((m) => [m.branch_id, m.branch_name, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'LC Store', 'Old Shop', 'in', 2]])
    assert.deepEqual(W.oldShop(db), OLD_SHOP_ZERO)
  })

  await W.check('after: dispose: refused without a valid confirmation; with it the loss is booked at LC Store, addressed to Old Shop', async () => {
    const db = withHeldLot(W.build('after'), 2)
    await W.assertRefusals(db, (redirect) => W.call(inventory(fresh), db, 'POST', '/tagged-lots/dispose', tagged(), { redirect }), 'dispose')
    const ok = await W.call(inventory(fresh), db, 'POST', '/tagged-lots/dispose', tagged(), { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=900').get().quantity_remaining, 1)
    assert.deepEqual(W.movements(db).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'Old Shop', 'write_off', 2]])
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 15, 'a disposal moves no sellable stock')
    assert.deepEqual(W.oldShop(db), OLD_SHOP_ZERO)
  })

  await W.check('after: revert of a Shop receipt: refused without a valid confirmation; with it the units leave the survivor lot at LC Store', async () => {
    const db = withShopReceipt(W.build('after'))
    await W.assertRefusals(db, (redirect) => W.call(inventory(fresh), db, 'POST', '/movements/4000/revert', {}, { redirect }), 'revert')
    const ok = await W.call(inventory(fresh), db, 'POST', '/movements/4000/revert', {}, { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 11)
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 11)
    const lots = W.plain(db.prepare('SELECT id, received_quantity, received_cost_usd FROM product_batches WHERE id IN (500,600) ORDER BY id').all())
    assert.deepEqual(lots, [{ id: 500, received_quantity: 6, received_cost_usd: 24 }, { id: 600, received_quantity: 5, received_cost_usd: 20 }],
      'the purchase figures come off the lot that was received (500), not the survivor')
    assert.deepEqual(W.movements(db, 4000).map((m) => [m.branch_id, m.branch_name, m.addressed_branch_name, m.movement_type, m.quantity, m.batch_id]),
      [[1, 'LC Store', 'Old Shop', 'remove', 4, 600]])
    assert.deepEqual(W.oldShop(db), OLD_SHOP_ZERO)
    const again = await W.call(inventory(fresh), db, 'POST', '/movements/4000/revert', {}, { redirect: 1 })
    assert.deepEqual([again.status, again.body.code], [409, 'already_reverted'])
  })

  await W.check('after: a Shop row that cannot be reverted keeps its own refusal (no redirect question first)', async () => {
    const db = W.build('after')
    db.prepare(`INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,movement_type,quantity,reason) VALUES(4001,10,'Powder',2,'Shop','transfer_out',-1,'x')`).run()
    const res = await W.call(inventory(fresh), db, 'POST', '/movements/4001/revert', {})
    assert.equal(res.status, 400)
    assert.notEqual(res.body.code, 'branch_redirect_required')
  })

  for (const [label, url, body, setup] of [['restore', '/tagged-lots/restore', tagged(), (db) => withHeldLot(db, 2)], ['revert', '/movements/4000/revert', {}, withShopReceipt]]) {
    await W.check(`race: ${label}: the target disabled between plan and commit aborts the batch, nothing written`, async () => {
      const db = setup(W.build('after'))
      db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
      const before = W.ledger(db)
      const res = await W.callWith(inventory(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), 'POST', url, body, 1)
      db.exec('UPDATE branches SET is_active=1 WHERE id=1')
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.equal(res.body.code, 'branch_redirect_target_invalid')
      assert.equal(W.ledger(db), before)
    })
  }

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
