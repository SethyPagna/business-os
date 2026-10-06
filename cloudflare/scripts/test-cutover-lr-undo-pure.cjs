// CUTOVER-LR item 12: Undo/Redo replays that write at a stored branch. An Undo cannot carry a confirmed redirect
// (owner: Undo of pre-cutover Shop work is closed), so a replay whose stored branch has since been disabled is
// refused with the coded 409 undo_closed_branch_retired and writes nothing -- even for a row the cutover's own
// history closure did not reach (lib/branchCutoverHistory.ts closes every such row it finds; this is the backstop).
// A redirected write made after the cutover records the confirmed branch, so its Undo replays there.
// Fixtures: scripts/harness/cutover_lr_world.cjs; replays go through the real routes/actionHistory.ts.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-undo-pure.cjs
const assert = require('node:assert/strict')
const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const inventory = (world) => world.load('routes/inventory.ts').default
const history = (world) => world.load('routes/actionHistory.ts').default

const stockOnly = (db) => JSON.stringify(['branch_stock', 'branch_batch_stock', 'products', 'inventory_movements', 'damaged_stock_lots']
  .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))

// The cutover's end state applied to a world that recorded work at Shop (2) while it was active: Shop becomes the
// disabled Old Shop and whatever it still held moves to LC Store (1). The history rows are deliberately NOT closed.
function cutOver(db) {
  db.exec(`UPDATE branch_stock SET quantity = quantity + COALESCE((SELECT o.quantity FROM branch_stock o WHERE o.product_id=branch_stock.product_id AND o.branch_id=2),0) WHERE branch_id=1;
           UPDATE branch_stock SET quantity = 0 WHERE branch_id=2;
           INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT batch_id,1,quantity FROM branch_batch_stock WHERE branch_id=2 AND quantity>0
             ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity;
           UPDATE branch_batch_stock SET quantity = 0 WHERE branch_id=2;
           UPDATE branches SET name='LC Store', role='shop', is_default=1 WHERE id=1;
           UPDATE branches SET name='Old Shop', role='shop', is_default=0, is_active=0, successor_branch_id=1 WHERE id=2;`)
  return db
}

async function setAtShopThenCutOver(world) {
  const db = W.build('before')
  const set = await W.call(inventory(world), db, 'POST', '/adjust', { productId: 10, branchId: 2, type: 'set', setScope: 'lot', batchId: 500, quantity: 0, reason: 'count' })
  assert.equal(set.status, 200, JSON.stringify(set.body))
  return { db: cutOver(db), historyId: set.body.action_history_id }
}

async function main() {
  await W.check('control: the oracle Undo of a Shop-era Set writes its inverse back into the disabled branch', async () => {
    const { db, historyId } = await setAtShopThenCutOver(oracle)
    const undo = await W.call(history(oracle), db, 'POST', `/${historyId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 500, 2), 10, 'ten units re-appeared at Old Shop')
  })

  await W.check('stock.quantity_set: the Undo of a Shop-era Set is refused undo_closed_branch_retired and writes nothing', async () => {
    const { db, historyId } = await setAtShopThenCutOver(fresh)
    const before = stockOnly(db)
    const undo = await W.call(history(fresh), db, 'POST', `/${historyId}/undo`, { require_applied: true, expected_generation: 0 }, { redirect: 1 })
    assert.deepEqual([undo.status, undo.body.code], [409, 'undo_closed_branch_retired'], JSON.stringify(undo.body))
    assert.equal(stockOnly(db), before)
  })

  await W.check('stock.session_line_edit: the Undo of a Shop-era line edit is refused undo_closed_branch_retired and writes nothing', async () => {
    const db = W.build('before')
    db.prepare(`INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,user_id,user_name,batch_id)
      VALUES(4000,10,'Powder',2,'Shop','add',10,4,40,'delivery',71,'Owner',500)`).run()
    const rev = Number(db.prepare("SELECT COALESCE(MAX(revision),0) r FROM stock_session_revisions WHERE entity_type='batch' AND entity_key='500'").get()?.r ?? 0)
    const edited = await W.call(inventory(fresh), db, 'POST', '/stock-in-lines/4000/edit', { client_request_id: 'edit-undo-0001', quantity: 0, expected_quantity: 10, expected_batch_id: 500, expected_batch_revision: rev })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    cutOver(db)
    const before = stockOnly(db)
    const undo = await W.call(history(fresh), db, 'POST', `/${edited.body.action_history_id}/undo`, { require_applied: true, expected_generation: 0 }, { redirect: 1 })
    assert.deepEqual([undo.status, undo.body.code], [409, 'undo_closed_branch_retired'], JSON.stringify(undo.body))
    assert.equal(stockOnly(db), before)
  })

  await W.check('stock.session: the Undo of a Shop-era stock-in session is refused by its in-batch active-branch assertion, nothing written', async () => {
    const db = W.build('before')
    const committed = await W.call(inventory(fresh), db, 'POST', '/sessions', { client_request_id: 'cutover-lr-undo-session', mode: 'stock_in',
      items: [{ line_id: 'a', kind: 'receive', product_id: 20, branch_id: 2, quantity: 2, unit_cost_usd: 3, supplier_id: 5, supplier_name: 'Acme', received_date: '2026-10-03' }] })
    assert.equal(committed.status, 200, JSON.stringify(committed.body))
    cutOver(db)
    const before = stockOnly(db)
    const undo = await W.call(history(fresh), db, 'POST', `/${committed.body.actionHistoryId}/undo`, { require_applied: true, expected_generation: 0 }, { redirect: 1 })
    assert.equal(undo.status, 409, JSON.stringify(undo.body))
    assert.equal(stockOnly(db), before)
  })

  await W.check('a closed row (the cutover marker) answers undo_closed_branch_retired before any applier runs', async () => {
    const { db, historyId } = await setAtShopThenCutOver(fresh)
    db.prepare("UPDATE action_history SET status='recorded', reversible=0, last_error='undo_closed:branch_retired' WHERE id=?").run([historyId])
    const undo = await W.call(history(fresh), db, 'POST', `/${historyId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.deepEqual([undo.status, undo.body.code], [409, 'undo_closed_branch_retired'])
  })

  await W.check('a redirected Set made after the cutover undoes and redoes at LC Store; Old Shop stays 0', async () => {
    const db = W.build('after')
    const set = await W.call(inventory(fresh), db, 'POST', '/adjust', { productId: 10, branchId: 2, type: 'set', setScope: 'lot', batchId: 500, quantity: 12, reason: 'count' }, { redirect: 1 })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 12)
    const undo = await W.call(history(fresh), db, 'POST', `/${set.body.action_history_id}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 15)
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 10, 1), 15)
    const redo = await W.call(history(fresh), db, 'POST', `/${set.body.action_history_id}/redo`, { require_applied: true, expected_generation: 1 })
    assert.equal(redo.status, 200, JSON.stringify(redo.body))
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 600, 1), 12)
    assert.deepEqual(W.oldShop(db), [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }])
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
