// CUTOVER-LR: POST /api/batches (Receive), PATCH /api/batches/:id/branches/:branchId (lot Set) and POST
// /api/inventory/move-row addressed to a disabled branch. Same contract and fixtures as
// test-cutover-lr-adjust-pure.cjs (scripts/harness/cutover_lr_world.cjs).
//
// Run (from cloudflare/): node scripts/test-cutover-lr-batches-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const batches = (world) => world.load('routes/batches.ts').default
const inventory = (world) => world.load('routes/inventory.ts').default

let receiveSeq = 0
const receive = (branchId, extra = {}) => ({ client_request_id: `cutover_receive_${++receiveSeq}`, product_id: 10, branch_id: branchId, quantity: 4, unit_cost_usd: 4, supplier_id: 5, supplier_name: 'Acme', reason: 'delivery', received_date: '2026-10-03', ...extra })
const moveRow = (branchId, extra = {}) => ({ sourceProductId: 10, destinationProductId: 20, branchId, quantity: 2, reason: 'relabel', ...extra })
const OLD_SHOP_ZERO = [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }]


function assertComposedWrites(current, previous, db) {
  const receipt = (s) => /stock_mutation_receipts/.test(s.sql)
  const movement = (s) => /INSERT INTO inventory_movements/.test(s.sql)
  const cost = (s) => /UPDATE products SET\s+cost_price_usd/.test(s.sql)
  const physical = (s) => /(?:INSERT INTO|UPDATE) branch_(?:batch_)?stock/.test(s.sql)
  const writes = current.flat(), oldWrites = previous.flat()
  const business = (rows) => rows.filter(s => !receipt(s) && !movement(s) && !cost(s))
  assert.equal(W.normalised(business(writes)), W.normalised(business(oldWrites)), 'same ordered business guards, stock metadata, quantities and history statements')
  assert.equal(W.normalised(writes.filter(cost)), W.normalised(oldWrites.filter(cost)), 'same catalog cost expression and bindings')
  assert.equal(writes.filter(movement).length, oldWrites.filter(movement).length, 'same movement count; complete movement values are compared in the ledger')
  const completion = writes.find(s => /UPDATE stock_mutation_receipts SET response_status/.test(s.sql))
  if (!completion) return
  const batch = current.find(rows => rows.some(physical))
  assert.ok(batch, 'stock effects are captured in a transaction')
  const marks = batch.filter(s => /UPDATE stock_mutation_receipts SET written=1/.test(s.sql))
  if (!marks.length) {
    const unchangedGroups = rows => rows.map(group => group.filter(s => !receipt(s))).filter(group => group.length)
    assert.equal(W.normalised(unchangedGroups(current)), W.normalised(unchangedGroups(previous)), 'legacy explicit-lot path retains its existing transaction grouping')
    assert.ok(writes.some(s => /UPDATE stock_mutation_receipts SET written=1/.test(s.sql)))
    return
  }
  assert.equal(marks.length, 1, 'required written receipt shares the stock transaction')
  assert.ok(batch.some(movement), 'movement shares the stock transaction')
  if (writes.some(cost)) {
    assert.ok(batch.some(cost), 'catalog cost shares the intake transaction')
    assert.ok(batch.findIndex(movement) < batch.findIndex(cost), 'intake history precedes derived catalog cost')
  }
  assert.ok(current.indexOf(batch) < current.findIndex(rows => rows.includes(completion)), 'receipt completion follows the atomic stock transaction')
  const rows = db.prepare('SELECT written,completed_at,response_status FROM stock_mutation_receipts').all()
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].written, rows[0].response_status], [1, 200])
  assert.ok(rows[0].completed_at, 'receipt is durably completed')
}

async function main() {
  await W.check('before: receive, lot top-up, lot Set and move-row preserve business statements and atomic receipts to the eb5dd0ba3 oracle', async () => {
    const cases = [
      [batches, 'POST', '/', receive(2)],
      [batches, 'POST', '/', receive(2, { batch_id: 500 })],
      [batches, 'PATCH', '/500/branches/2', { quantity: 7, reason: 'count' }],
      [inventory, 'POST', '/move-row', moveRow(2)],
    ]
    for (const [app, method, url, body] of cases) {
      const dbNew = W.build('before'); const dbOld = W.build('before')
      const capNew = []; const capOld = []
      const a = await W.call(app(fresh), dbNew, method, url, body, { capture: capNew, redirect: 1 })
      const b = await W.call(app(oracle), dbOld, method, url, body, { capture: capOld })
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(W.normalised(a), W.normalised(b), `${url}: same answer`)
      assertComposedWrites(capNew, capOld, dbNew)
      if (capNew.flat().some(s => /UPDATE products SET\s+cost_price_usd/.test(s.sql))) {
        for (const [label, pattern] of [
          ['missing atomic receipt', /UPDATE stock_mutation_receipts SET written=1/],
          ['missing movement', /INSERT INTO inventory_movements/],
          ['missing cost', /UPDATE products SET\s+cost_price_usd/],
          ['missing business guard', /INSERT INTO stock_session_guards/],
        ]) {
          const mutant = capNew.map(rows => rows.filter(s => !pattern.test(s.sql)))
          assert.throws(() => assertComposedWrites(mutant, capOld, dbNew), undefined, label)
        }
        const separated = capNew.map(rows => rows.filter(s => !/UPDATE products SET\s+cost_price_usd/.test(s.sql)))
        separated.push(capNew.flat().filter(s => /UPDATE products SET\s+cost_price_usd/.test(s.sql)))
        assert.throws(() => assertComposedWrites(separated, capOld, dbNew), undefined, 'cost outside stock transaction')
      }
      assert.equal(W.normalised(W.ledger(dbNew)), W.normalised(W.ledger(dbOld)), `${url}: same ledgers`)
    }
  })

  await W.check('control: the oracle Set a lot at the disabled branch (a decrease never asked)', async () => {
    const db = W.build('after')
    db.exec('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=500 AND branch_id=2; UPDATE branch_stock SET quantity=3 WHERE product_id=10 AND branch_id=2')
    const old = await W.call(batches(oracle), db, 'PATCH', '/500/branches/2', { quantity: 1 })
    assert.equal(old.status, 200)
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 500, 2), 1)
  })

  const cases = [
    ['receive (new lot)', batches, 'POST', '/', receive(2), (db, since) => {
      const [move] = W.movements(db, since)
      assert.deepEqual([move.branch_id, move.branch_name, move.addressed_branch_name, move.quantity], [1, 'LC Store', 'Old Shop', 4])
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', move.batch_id, 1), 4)
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 19)
    }],
    ['receive top-up of the folded lot 500 lands on its survivor 600', batches, 'POST', '/', receive(2, { batch_id: 500 }), (db, since) => {
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 19)
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 500, 1), null)
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.batch_id]), [[1, 'Old Shop', 600]])
    }],
    ['PATCH lot Set of 500 at Old Shop sets the survivor 600 at LC Store', batches, 'PATCH', '/500/branches/2', { quantity: 9 }, (db, since) => {
      assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 9)
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 9)
      assert.deepEqual(W.movements(db, since).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'Old Shop', 'remove', 6]])
    }],
    ['move-row', inventory, 'POST', '/move-row', moveRow(2), (db, since) => {
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 13)
      assert.equal(W.qty(db, 'branch_stock', 'product_id', 20, 1), 8)
      assert.deepEqual(W.movements(db, since).map((m) => [m.product_id, m.branch_id, m.addressed_branch_name, m.movement_type]), [[10, 1, 'Old Shop', 'move_out'], [20, 1, 'Old Shop', 'move_in']])
      assert.equal(db.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=20 AND branch_id=2').get().n, 0, 'nothing arrives at Old Shop')
    }],
  ]
  for (const [label, app, method, url, body, verify] of cases) {
    await W.check(`after: ${label}: refused without a valid confirmation, lands at LC Store with it`, async () => {
      const db = W.build('after')
      await W.assertRefusals(db, (redirect) => W.call(app(fresh), db, method, url, body, { redirect }), label)
      const since = W.maxMovement(db)
      const ok = await W.call(app(fresh), db, method, url, body, { redirect: 1 })
      assert.equal(ok.status, 200, JSON.stringify(ok.body))
      verify(db, since)
      assert.ok(W.movements(db, since).every((m) => m.branch_id === 1 && m.addressed_branch_name === 'Old Shop'))
      assert.deepEqual(W.oldShop(db), OLD_SHOP_ZERO, 'Old Shop rows stay exactly 0')
    })
  }

  for (const [label, app, method, url, body] of [['receive', batches, 'POST', '/', receive(2)], ['move-row', inventory, 'POST', '/move-row', moveRow(2)], ['PATCH lot Set', batches, 'PATCH', '/500/branches/2', { quantity: 9 }]]) {
    await W.check(`race: ${label}: the target disabled between plan and commit aborts the batch, nothing written`, async () => {
      const db = W.build('after')
      db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
      const before = W.ledger(db)
      const res = await W.callWith(app(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), method, url, body, 1)
      db.exec('UPDATE branches SET is_active=1 WHERE id=1')
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.ok(['branch_redirect_target_invalid', 'receiving_branch_inactive'].includes(res.body.code), JSON.stringify(res.body))
      assert.equal(W.ledger(db), before)
    })
  }

  await W.check('after: an unknown branch is still receiving_branch_inactive on every receive wire', async () => {
    const db = W.build('after')
    const before = W.ledger(db)
    for (const [app, url, body] of [[batches, '/', receive(99)], [inventory, '/move-row', moveRow(99)]]) {
      const res = await W.call(app(fresh), db, 'POST', url, body, { redirect: 1 })
      assert.deepEqual([res.status, res.body.code], [409, 'receiving_branch_inactive'], url)
    }
    assert.equal(W.ledger(db), before)
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
