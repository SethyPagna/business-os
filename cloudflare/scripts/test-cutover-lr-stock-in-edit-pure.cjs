// CUTOVER-LR: POST /api/inventory/stock-in-lines/:movementId/edit on a line received at Shop before the cutover.
// A quantity (or received-date) change moves stock, so it follows the redirect contract: refused until the
// operator confirms an active branch, then the delta lands there with the line's lot, addressed to Old Shop. A cost
// or supplier edit moves no stock and asks nothing. Fixtures: scripts/harness/cutover_lr_world.cjs plus lot 701
// (product 20, received at Shop on 2026-08-20, 3 units; after the cutover those units sit at LC Store, unfolded).
//
// Run (from cloudflare/): node scripts/test-cutover-lr-stock-in-edit-pure.cjs
const assert = require('node:assert/strict')
function withoutProductAdmission(value) {
  const normalize = sql => sql.replace(/@[A-Za-z_]+|\?[0-9]*/g, '?').replace(/\s+/g, ' ').trim()
  const allowed = normalize(require('./harness/product_stock_guard.cjs').productStockGuardStatement([1], 'active').sql)
  const walk = entry => {
    if (Array.isArray(entry)) return entry.map(walk).filter(v => v !== undefined)
    let statement = entry
    if (typeof entry === 'string') { try { statement = JSON.parse(entry) } catch {} }
    if (statement && typeof statement.sql === 'string' && statement.sql.includes('$[product_has_stock]')) {
      const single = normalize("SELECT CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=@productId AND is_active IS NOT 1) THEN json_extract('[]','$[product_has_stock]') ELSE 1 END")
      const batch = normalize("SELECT CASE WHEN EXISTS(SELECT 1 FROM product_batches pb JOIN products p ON p.id=pb.variant_product_id WHERE pb.id=@batchId AND p.is_active IS NOT 1) THEN json_extract('[]','$[product_has_stock]') ELSE 1 END")
      assert.ok([allowed, single, batch].includes(normalize(statement.sql)), 'only exact active-product admission guards may differ from historical SQL: '+statement.sql)
      const bound = Array.isArray(statement.params) ? statement.params[0] : statement.params.productIds
      const ids = bound === undefined ? [Number(statement.params.productId ?? statement.params.batchId)] : (typeof bound === 'number' ? [bound] : JSON.parse(bound))
      assert.ok(ids.length && ids.every(id => Number.isSafeInteger(id) && id > 0), 'guard names real product identities')
      return undefined
    }
    return entry
  }
  return walk(value)
}

const W = require('./harness/cutover_lr_world.cjs')

const fresh = W.makeWorld(null)
const oracle = W.makeWorld(W.ORACLE)
const inventory = (world) => world.load('routes/inventory.ts').default

function withShopLine(db, state) {
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,supplier_id,supplier_name,received_quantity,received_cost_usd,received_branch_id)
    VALUES(701,20,'2026-08-20','CREAM-S','2026-08-20',1,2,3,5,'Acme',3,9,2)`).run()
  const at = state === 'before' ? 2 : 1
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(701,?,3)').run([at])
  if (state === 'before') db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(20,2,3)').run()
  else db.prepare('UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=20 AND branch_id=1').run()
  db.prepare('UPDATE products SET stock_quantity=stock_quantity+3 WHERE id=20').run()
  db.prepare(`INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,user_id,user_name,batch_id)
    VALUES(4000,20,'Cream',2,'Shop','add',3,3,9,'delivery',71,'Owner',701)`).run()
  return db
}
const revision = (db) => Number(db.prepare("SELECT COALESCE(MAX(revision),0) r FROM stock_session_revisions WHERE entity_type='batch' AND entity_key='701'").get()?.r ?? 0)
const edit = (db, key, extra) => ({ client_request_id: key, quantity: 5, expected_quantity: 3, expected_batch_id: 701, expected_batch_revision: revision(db), reason: 'recount', ...extra })

async function main() {
  await W.check('before: a quantity edit and a cost edit write equal business statements apart from verified admission to the eb5dd0ba3 oracle', async () => {
    for (const extra of [{}, { quantity: 3, unit_cost_usd: 3.5 }, { quantity: 1 }]) {
      const dbNew = withShopLine(W.build('before'), 'before'); const dbOld = withShopLine(W.build('before'), 'before')
      const capNew = []; const capOld = []
      const a = await W.call(inventory(fresh), dbNew, 'POST', '/stock-in-lines/4000/edit', edit(dbNew, 'edit-before-0001', extra), { capture: capNew, redirect: 1 })
      const b = await W.call(inventory(oracle), dbOld, 'POST', '/stock-in-lines/4000/edit', edit(dbOld, 'edit-before-0001', extra), { capture: capOld })
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(W.normalised(a), W.normalised(b))
      assert.equal(W.normalised(withoutProductAdmission(capNew)), W.normalised(withoutProductAdmission(capOld)))
      assert.equal(W.normalised(W.ledger(dbNew)), W.normalised(W.ledger(dbOld)))
    }
  })

  await W.check('control: the oracle adds the edited units into the disabled branch', async () => {
    const db = withShopLine(W.build('after'), 'after')
    const old = await W.call(inventory(oracle), db, 'POST', '/stock-in-lines/4000/edit', edit(db, 'edit-oracle-0001'))
    assert.equal(old.status, 200, JSON.stringify(old.body))
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 20, 2), 2, 'two units appeared at Old Shop')
  })

  await W.check('after: a quantity increase asks, refuses invalid targets, writes nothing; confirmed it lands at LC Store on lot 701', async () => {
    const db = withShopLine(W.build('after'), 'after')
    await W.assertRefusals(db, (redirect) => W.call(inventory(fresh), db, 'POST', '/stock-in-lines/4000/edit', edit(db, 'edit-after-0001'), { redirect }), 'edit')
    const ok = await W.call(inventory(fresh), db, 'POST', '/stock-in-lines/4000/edit', edit(db, 'edit-after-0001'), { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 701, 1), 5)
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 20, 1), 11)
    assert.equal(W.qty(db, 'branch_stock', 'product_id', 20, 2), null, 'nothing at Old Shop')
    assert.deepEqual(W.movements(db, 4000).map((m) => [m.branch_id, m.branch_name, m.addressed_branch_name, m.movement_type, m.quantity, m.batch_id]),
      [[1, 'LC Store', 'Old Shop', 'add', 2, 701]])
    assert.equal(JSON.parse(db.prepare('SELECT revision_json FROM stock_lot_adjustment_operations').get().revision_json).branchId, 1, 'its undo replays at LC Store')
    assert.deepEqual(W.oldShop(db), [{ t: 'branch_batch_stock', k: 500, quantity: 0 }, { t: 'branch_stock', k: 10, quantity: 0 }])
  })

  await W.check('after: a quantity decrease confirmed takes the units off lot 701 at LC Store', async () => {
    const db = withShopLine(W.build('after'), 'after')
    const ok = await W.call(inventory(fresh), db, 'POST', '/stock-in-lines/4000/edit', edit(db, 'edit-after-0002', { quantity: 1 }), { redirect: 1 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(W.qty(db, 'branch_batch_stock', 'batch_id', 701, 1), 1)
    assert.deepEqual(W.movements(db, 4000).map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'Old Shop', 'remove', -2]])
  })

  await W.check('after: a cost-only edit moves no stock and asks nothing', async () => {
    const db = withShopLine(W.build('after'), 'after')
    const stockBefore = W.plain(db.prepare('SELECT * FROM branch_stock ORDER BY rowid').all())
    const ok = await W.call(inventory(fresh), db, 'POST', '/stock-in-lines/4000/edit', edit(db, 'edit-after-0003', { quantity: 3, unit_cost_usd: 3.5 }))
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.deepEqual(W.plain(db.prepare('SELECT * FROM branch_stock ORDER BY rowid').all()), stockBefore)
    assert.equal(db.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=701').get().unit_cost_usd, 3.5)
  })

  await W.check('race: the target disabled between plan and commit aborts the edit, nothing written', async () => {
    const db = withShopLine(W.build('after'), 'after')
    db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(3,'Annex','shop',0,1)").run()
    const before = W.ledger(db)
    const res = await W.callWith(inventory(fresh), W.raceBinding(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1')), 'POST', '/stock-in-lines/4000/edit', edit(db, 'edit-race-0001'), 1)
    db.exec('UPDATE branches SET is_active=1 WHERE id=1')
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.code, 'branch_redirect_target_invalid')
    assert.equal(W.ledger(db), before)
  })

  W.done()
}

main().catch((error) => { console.error(error); process.exit(1) })
