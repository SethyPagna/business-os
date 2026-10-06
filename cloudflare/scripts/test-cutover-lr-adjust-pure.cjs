// CUTOVER-LR: POST /api/inventory/adjust (add, remove, explicit-lot remove, legacy Set, scoped lot Set, tagged
// remove) and POST /api/inventory/fast-stock-in/commit addressed to a disabled branch. The REAL routes run against
// SQLite with every migration (scripts/harness/cutover_lr_world.cjs).
//
//   before  both branches active: byte-identical write statements and ledgers vs the eb5dd0ba3 oracle.
//   after   Old Shop (2) disabled, successor LC Store (1): no header -> 409 branch_redirect_required, a target that is
//           the disabled branch or unknown -> 409 branch_redirect_target_invalid, nothing written; with the confirmed
//           target the effect lands at LC Store in branch_stock AND branch_batch_stock, every movement row says
//           branch 1 / addressed 'Old Shop', and Old Shop rows stay 0. A target disabled between plan and commit
//           aborts the write batch.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-adjust-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const inventory = (world) => world.load('routes/inventory.ts').default
const fastStockIn = (world) => world.load('routes/stockInCommit.ts').default

const add = (branchId, extra = {}) => ({ productId: 10, branchId, type: 'add', quantity: 4, reason: 'delivery', supplierId: 5, supplierName: 'Acme', unitCostUsd: 4, receivedDate: '03/10/2026', ...extra })
const remove = (branchId, extra = {}) => ({ productId: 10, branchId, type: 'remove', quantity: 3, reason: 'broken jar', ...extra })
const scopedSet = (branchId, extra = {}) => ({ productId: 10, branchId, type: 'set', setScope: 'lot', batchId: 500, quantity: 12, reason: 'count', ...extra })

async function main() {
  await W.check('before: every adjust kind writes byte-identical statements and ledgers to the eb5dd0ba3 oracle', async () => {
    const bodies = [
      add(2), remove(2), remove(2, { batchId: 500 }), { productId: 10, branchId: 2, type: 'set', quantity: 6, reason: 'count' },
      scopedSet(2, { quantity: 4 }), remove(2, { quantity: 1, conditionTag: 'broken' }), add(1, { productId: 20 }),
    ]
    for (const body of bodies) {
      const dbNew = W.build('before'); const dbOld = W.build('before')
      const capNew = []; const capOld = []
      const a = await W.call(inventory(fresh), dbNew, 'POST', '/adjust', body, { capture: capNew, redirect: 1 })
      const b = await W.call(inventory(oracle), dbOld, 'POST', '/adjust', body, { capture: capOld })
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(W.normalised({ status: a.status, body: a.body }), W.normalised({ status: b.status, body: b.body }), `${JSON.stringify(body)}: same answer`)
      assert.ok(capNew.length > 0)
      assert.equal(W.normalised(capNew), W.normalised(capOld), `${JSON.stringify(body)}: same write statements (a header is never read for an active branch)`)
      assert.equal(W.normalised(W.ledger(dbNew)), W.normalised(W.ledger(dbOld)), `${JSON.stringify(body)}: same ledgers`)
    }
  })

  await W.check('control: on the post-cutover world the oracle writes a decrease into the disabled branch (the defect)', async () => {
    const db = W.build('after')
    db.exec('UPDATE branch_stock SET quantity=3 WHERE branch_id=2 AND product_id=10; UPDATE branch_batch_stock SET quantity=3 WHERE branch_id=2 AND batch_id=500')
    const old = await W.call(inventory(oracle), db, 'POST', '/adjust', remove(2, { quantity: 1 }))
    assert.equal(old.status, 200, 'the oracle accepted a removal at Old Shop')
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 2), 2)
  })

  for (const [label, body, extraAsserts] of [
    ['add (receipt)', add(2), (db, since) => {
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 19)
      const moves = W.movements(db, since)
      assert.deepEqual(moves.map((m) => [m.branch_id, m.branch_name, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'LC Store', 'Old Shop', 'add', 4]])
      const lot = db.prepare('SELECT received_branch_id FROM product_batches WHERE id=?').get([moves[0].batch_id])
      assert.ok(W.qty(db, 'branch_batch_stock', 'batch_id', moves[0].batch_id, 1) >= 4, 'the received lot holds the units at LC Store')
      assert.notEqual(lot, undefined)
    }],
    ['auto FIFO remove', remove(2), (db, since) => {
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 12)
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 12)
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity, m.batch_id]), [[1, 'Old Shop', 'remove', 3, 600]])
    }],
    ['explicit-lot remove names the folded lot 500; it lands on its survivor 600', remove(2, { batchId: 500 }), (db, since) => {
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 12)
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 500, 1), null, 'the folded lot is not re-created at LC Store')
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.batch_id]), [[1, 'Old Shop', 600]])
    }],
    ['legacy Set (no setScope)', { productId: 10, branchId: 2, type: 'set', quantity: 11, reason: 'count' }, (db, since) => {
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 11, 'the Set is evaluated at the confirmed branch')
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 11)
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'Old Shop', 'remove', 4]])
    }],
    ['scoped lot Set of the folded lot 500 lands on 600', scopedSet(2), (db, since) => {
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 12)
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 12)
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity, m.batch_id]), [[1, 'Old Shop', 'remove', 3, 600]])
      const op = db.prepare('SELECT request_json, before_json FROM stock_lot_adjustment_operations').get()
      assert.equal(JSON.parse(op.request_json).branchId, 2, 'the stored request is the one that was sent (addressed to Old Shop)')
      assert.deepEqual([JSON.parse(op.before_json).branchId, JSON.parse(op.before_json).batchId], [1, 600], 'its snapshots (and its undo) are at the confirmed branch and lot')
    }],
    ['tagged remove (hold as broken)', remove(2, { quantity: 2, conditionTag: 'broken' }), (db, since) => {
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 13)
      const held = W.plain(db.prepare('SELECT branch_id, quantity_remaining FROM damaged_stock_lots').all())
      assert.deepEqual(held, [{ branch_id: 1, quantity_remaining: 2 }], 'the held row is created at the branch the units left')
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type]), [[1, 'Old Shop', 'damage_out']])
    }],
  ]) {
    await W.check(`after: ${label}: refused without a valid confirmation, lands at LC Store with it`, async () => {
      const db = W.build('after')
      await W.assertRefusals(db, (redirect) => W.call(inventory(fresh), db, 'POST', '/adjust', body, { redirect }), label)
      const since = W.maxMovement(db)
      const ok = await W.call(inventory(fresh), db, 'POST', '/adjust', body, { redirect: 1 })
      assert.equal(ok.status, 200, JSON.stringify(ok.body))
      assert.equal(ok.body.branchId, 1)
      extraAsserts(db, since)
      assert.ok(W.movements(db, since).every((m) => m.branch_id === 1 && m.addressed_branch_name === 'Old Shop'), 'every new movement names LC Store and is addressed to Old Shop')
      assert.deepEqual(W.oldShop(db), [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }], 'Old Shop rows stay exactly 0')
    })
  }

  await W.check('after: a scoped Set carrying the figures the operator saw at Old Shop is refused at LC Store (stale), nothing written', async () => {
    const db = W.build('after')
    const before = W.ledger(db)
    const res = await W.call(inventory(fresh), db, 'POST', '/adjust', scopedSet(2, { expectedLotQuantity: 0, expectedBranchQuantity: 0 }), { redirect: 1 })
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'stock_conflict')
    assert.equal(W.ledger(db), before)
  })

  await W.check('after: an active branch is never redirected and never reads the header; an unknown branch keeps receiving_branch_inactive', async () => {
    const db = W.build('after')
    const direct = await W.call(inventory(fresh), db, 'POST', '/adjust', add(1), { redirect: 2 })
    assert.equal(direct.status, 200, JSON.stringify(direct.body))
    assert.deepEqual(W.movements(db).map((m) => [m.branch_id, m.addressed_branch_name]), [[1, null]])
    const before = W.ledger(db)
    const unknown = await W.call(inventory(fresh), db, 'POST', '/adjust', add(99), { redirect: 1 })
    assert.deepEqual([unknown.status, unknown.body.code], [409, 'receiving_branch_inactive'])
    assert.equal(W.ledger(db), before)
  })

  await W.check('orphan: a disabled branch no active branch can take is refused branch_retired_no_successor', async () => {
    const db = W.build('orphan')
    db.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before = W.ledger(db)
    const res = await W.call(inventory(fresh), db, 'POST', '/adjust', remove(2), { redirect: 1 })
    assert.deepEqual([res.status, res.body.code], [409, 'branch_retired_no_successor'])
    assert.equal(W.ledger(db), before)
  })

  for (const [label, body] of [['auto FIFO remove', remove(2)], ['scoped lot Set', scopedSet(2)], ['tagged remove', remove(2, { quantity: 1, conditionTag: 'expired' })]]) {
    await W.check(`race: ${label}: the target disabled between plan and commit aborts the batch, nothing written`, async () => {
      const db = W.build('after')
      db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
      const before = W.ledger(db)
      const res = await W.callWith(inventory(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), 'POST', '/adjust', body, 1)
      db.exec('UPDATE branches SET is_active=1 WHERE id=1')
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.equal(res.body.code, 'branch_redirect_target_invalid')
      assert.deepEqual(res.body.redirect.targets, [{ id: 3, name: 'Annex' }], 'the refusal offers the branches that are active now')
      assert.equal(W.ledger(db), before)
    })
  }

  await W.check('fast stock-in: a line addressed to Old Shop carries the redirect detail; the confirmed re-send lands at LC Store', async () => {
    const db = W.build('after')
    const lines = [{ key: 'a', wire: 'adjust', body: add(2) }, { key: 'b', wire: 'receive', body: { product_id: 20, branch_id: 2, quantity: 2, unit_cost_usd: 3, supplier_id: 5, supplier_name: 'Acme', reason: 'delivery' } }]
    const before = W.ledger(db)
    const asked = await W.call(fastStockIn(fresh), db, 'POST', '/commit', { lines })
    assert.equal(asked.status, 200)
    assert.deepEqual(asked.body.results.map((r) => [r.ok, r.code, r.redirect && r.redirect.successor_branch_id]), [[false, 'branch_redirect_required', 1], [false, 'branch_redirect_required', 1]])
    assert.equal(W.ledger(db), before)
    const since = W.maxMovement(db)
    const ok = await W.call(fastStockIn(fresh), db, 'POST', '/commit', { lines }, { redirect: 1 })
    assert.deepEqual(ok.body.results.map((r) => r.ok), [true, true], JSON.stringify(ok.body))
    assert.deepEqual(W.movements(db, since).map((m) => [m.product_id, m.branch_id, m.addressed_branch_name, m.quantity]), [[10, 1, 'Old Shop', 4], [20, 1, 'Old Shop', 2]])
    assert.deepEqual(W.oldShop(db), [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }])
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
