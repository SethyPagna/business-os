// CUTOVER-LR: POST /api/inventory/sessions (stock-in sessions) with lines addressed to a disabled branch. Same
// contract and fixtures as test-cutover-lr-adjust-pure.cjs (scripts/harness/cutover_lr_world.cjs). A line at an
// active branch in the same session is never relabelled.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-sessions-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const inventory = (world) => world.load('routes/inventory.ts').default

const line = (id, productId, branchId, extra = {}) => ({ line_id: id, kind: 'receive', product_id: productId, branch_id: branchId, quantity: 4, unit_cost_usd: 4, supplier_id: 5, supplier_name: 'Acme', received_date: '2026-10-03', ...extra })
const session = (key, items) => ({ client_request_id: key, mode: 'stock_in', items })

async function main() {
  await W.check('before: a session (new lot, explicit top-up, two branches) writes byte-identical statements to the eb5dd0ba3 oracle', async () => {
    for (const body of [session('cutover-lr-session-before', [line('a', 10, 2), line('c', 20, 1)]), session('cutover-lr-session-before-2', [line('b', 10, 2, { batch_id: 500, supplier_name: null, supplier_id: null })])]) {
    const dbNew = W.build('before'); const dbOld = W.build('before')
    const capNew = []; const capOld = []
    const a = await W.call(inventory(fresh), dbNew, 'POST', '/sessions', body, { capture: capNew, redirect: 1 })
    const b = await W.call(inventory(oracle), dbOld, 'POST', '/sessions', body, { capture: capOld })
    assert.equal(a.status, 200, JSON.stringify(a.body))
    assert.equal(W.normalised(a), W.normalised(b))
    assert.equal(W.normalised(capNew), W.normalised(capOld))
    assert.equal(W.normalised(W.ledger(dbNew)), W.normalised(W.ledger(dbOld)))
    }
  })

  await W.check('after: a session with an Old Shop line asks, refuses invalid targets, writes nothing', async () => {
    const db = W.build('after')
    await W.assertRefusals(db, (redirect) => W.call(inventory(fresh), db, 'POST', '/sessions', session('cutover-lr-session-ask', [line('a', 10, 2), line('c', 20, 1)]), { redirect }), 'session')
  })

  await W.check('after: confirmed, the Old Shop lines land at LC Store (the folded lot on its survivor); the LC Store line is not relabelled', async () => {
    const db = W.build('after')
    const body = session('cutover-lr-session-ok', [line('b', 10, 2, { batch_id: 500, supplier_name: null, supplier_id: null, quantity: 1 }), line('c', 20, 1, { quantity: 2 })])
    const ok = await W.call(inventory(fresh), db, 'POST', '/sessions', body, { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.deepEqual(W.movements(db).map((m) => [m.product_id, m.branch_id, m.addressed_branch_name, m.quantity, m.product_id === 10 ? m.batch_id : null]),
      [[10, 1, 'Old Shop', 1, 600], [20, 1, null, 2, null]])
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 16, 'the top-up of folded lot 500 landed on survivor 600')
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 16)
    const fresh2 = await W.call(inventory(fresh), db, 'POST', '/sessions', session('cutover-lr-session-new-lot', [line('a', 20, 2)]), { redirect: 1 })
    assert.equal(fresh2.status, 200, JSON.stringify(fresh2.body))
    const [newLot] = W.movements(db).slice(-1)
    assert.deepEqual([newLot.branch_id, newLot.addressed_branch_name, newLot.quantity], [1, 'Old Shop', 4])
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', newLot.batch_id, 1), 6, 'the Old Shop line joins the same-day lot the LC Store line opened at LC Store')
    assert.deepEqual(W.plain(db.prepare('SELECT DISTINCT branch_id FROM stock_session_members').all()), [{ branch_id: 1 }], 'the members (and the session undo) are at LC Store')
    assert.deepEqual(W.oldShop(db), [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }])
    const replay = await W.call(inventory(fresh), db, 'POST', '/sessions', body)
    assert.equal(replay.body.replayed, true, 'the same request id replays the stored receipt')
  })

  await W.check('race: the target disabled between plan and commit aborts the session, nothing written', async () => {
    const db = W.build('after')
    db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
    const before = W.ledger(db)
    const res = await W.callWith(inventory(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), 'POST', '/sessions', session('cutover-lr-session-race', [line('a', 10, 2)]), 1)
    db.exec('UPDATE branches SET is_active=1 WHERE id=1')
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.code, 'branch_redirect_target_invalid', JSON.stringify(res.body))
    assert.equal(W.ledger(db), before)
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
