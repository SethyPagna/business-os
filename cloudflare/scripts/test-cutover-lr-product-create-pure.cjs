// CUTOVER-LR: opening stock of a new product addressed to a disabled branch -- POST /api/products, POST
// /api/products/variant, and the approval of a queued create (POST /api/review-queue/:id/approve, the approver's
// X-Branch-Redirect). The opening stock is received at the confirmed active branch; the product create writes no
// movement row, so there is no addressed label to carry. Fixtures: scripts/harness/cutover_lr_world.cjs.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-product-create-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const products = (world) => world.load('routes/products.ts').default
const reviewQueue = (world) => world.load('routes/reviewQueue.ts').default

const createBody = (branchId, extra = {}) => ({ name: 'Toner', barcode: '8850009', stock_quantity: 5, branch_id: branchId, selling_price_usd: 3, ...extra })
const opening = (db) => W.plain(db.prepare(`SELECT bs.branch_id, bs.quantity, (SELECT SUM(quantity) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
    WHERE pb.variant_product_id=p.id AND bbs.branch_id=bs.branch_id) AS lots FROM products p JOIN branch_stock bs ON bs.product_id=p.id WHERE p.name='Toner' ORDER BY bs.branch_id`).all())

function queue(db, branchId) {
  db.prepare(`INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,summary,status,requested_by,requested_by_name)
    VALUES(50,'products','create','product',?,'Create product "Toner"','open',99,'Requester')`).run([JSON.stringify(createBody(branchId))])
  return db
}

async function main() {
  await W.check('before: create and variant with opening stock write byte-identical statements to the eb5dd0ba3 oracle', async () => {
    for (const url of ['/', '/variant']) {
      const dbNew = W.build('before'); const dbOld = W.build('before')
      const capNew = []; const capOld = []
      const a = await W.call(products(fresh), dbNew, 'POST', url, createBody(2), { capture: capNew, redirect: 1 })
      const b = await W.call(products(oracle), dbOld, 'POST', url, createBody(2), { capture: capOld })
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(W.normalised(a), W.normalised(b), url)
      assert.equal(W.normalised(capNew), W.normalised(capOld), url)
      assert.deepEqual(opening(dbNew), [{ branch_id: 1, quantity: 0, lots: null }, { branch_id: 2, quantity: 5, lots: 5 }])
    }
    const dbNew = queue(W.build('before'), 2); const dbOld = queue(W.build('before'), 2)
    const capNew = []; const capOld = []
    const a = await W.call(reviewQueue(fresh), dbNew, 'POST', '/50/approve', {}, { capture: capNew, redirect: 1 })
    const b = await W.call(reviewQueue(oracle), dbOld, 'POST', '/50/approve', {}, { capture: capOld })
    assert.equal(a.status, 200, JSON.stringify(a.body))
    assert.equal(W.normalised(a), W.normalised(b))
    assert.equal(W.normalised(capNew), W.normalised(capOld), 'approval: same write statements')
  })

  await W.check('control: the oracle refused opening stock at the disabled branch with receiving_branch_inactive (no way through)', async () => {
    const db = W.build('after')
    const old = await W.call(products(oracle), db, 'POST', '/', createBody(2))
    assert.deepEqual([old.status, old.body.code], [409, 'receiving_branch_inactive'])
  })

  for (const url of ['/', '/variant']) {
    await W.check(`after: POST ${url}: refused without a valid confirmation; with it the opening stock lands at LC Store`, async () => {
      const db = W.build('after')
      await W.assertRefusals(db, (redirect) => W.call(products(fresh), db, 'POST', url, createBody(2), { redirect }), url)
      const ok = await W.call(products(fresh), db, 'POST', url, createBody(2), { redirect: 1 })
      assert.equal(ok.status, 200, JSON.stringify(ok.body))
      assert.deepEqual(opening(db), [{ branch_id: 1, quantity: 5, lots: 5 }], 'stock and its lot at LC Store; no row at Old Shop')
      assert.deepEqual(W.oldShop(db), [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }])
    })
  }

  await W.check('after: approving a create queued for Shop asks the approver, then receives at the confirmed branch', async () => {
    const db = queue(W.build('after'), 2)
    await W.assertRefusals(db, (redirect) => W.call(reviewQueue(fresh), db, 'POST', '/50/approve', {}, { redirect }), 'approve')
    assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id=50').get().status, 'open', 'the request stays open after a refusal')
    const ok = await W.call(reviewQueue(fresh), db, 'POST', '/50/approve', {}, { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.deepEqual(opening(db), [{ branch_id: 1, quantity: 5, lots: 5 }])
    assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id=50').get().status, 'approved')
  })

  await W.check('race: the target disabled between plan and commit aborts the create, nothing written', async () => {
    const db = W.build('after')
    db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
    const before = W.ledger(db)
    const res = await W.callWith(products(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), 'POST', '/', createBody(2), 1)
    db.exec('UPDATE branches SET is_active=1 WHERE id=1')
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.code, 'branch_redirect_target_invalid')
    assert.equal(W.ledger(db), before)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE name='Toner'").get().n, 0)
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
