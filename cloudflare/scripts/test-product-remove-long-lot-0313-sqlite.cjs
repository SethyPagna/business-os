'use strict'
// M1 (round 4): a product removed BEFORE 0313 while a lot held a cost over 4 places. 0313 then rounds that (inactive) lot.
// Undo / redo / queued apply must still work, and a REAL concurrent lot change must still be refused.
const fs = require('node:fs'), path = require('node:path')
const assert = require('node:assert/strict')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { loadRoute, loadTs, seed } = require('./test-product-conflict-action-groups-sqlite.cjs')
const text0313 = fs.readFileSync(path.join(__dirname, '../migrations/0313_cost_4dp_repair.sql'), 'utf8')
const owner = { id: 900, username: 'owner' }
const LONG = 'UPDATE product_batches SET unit_cost_usd=4.123456,received_cost_usd=20.61728 WHERE id=99001; UPDATE products SET cost_price_usd=4.123456,purchase_price_usd=4.123456 WHERE id=10000;'
const SHORT = 'UPDATE product_batches SET unit_cost_usd=4.1235,received_cost_usd=20.6175 WHERE id=99001; UPDATE products SET cost_price_usd=4.1235,purchase_price_usd=4.1235 WHERE id=10000;'

async function remove(app, productId, body, user = owner) {
  return app.deletes.get('/:id')({ env: {}, get: () => user, req: { param: () => String(productId), json: async () => body }, json: (payload, status = 200) => ({ status, body: payload }), executionCtx: { waitUntil: () => {} } })
}
function setup(lotSql) {
  const { d1 } = seed(1)
  d1.db.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(902,'requester','Requester','x','{}',1),(903,'reviewer','Reviewer','x','{}',1)").run()
  seedStockFixture(d1.db, () => d1.db.exec('UPDATE branch_stock SET quantity=0 WHERE product_id=10000; UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id=10000); UPDATE products SET stock_quantity=0 WHERE id=10000;'))
  seedStockFixture(d1.db, () => d1.db.exec(lotSql))
  const loaded = loadRoute(d1, true)
  Object.assign(loaded.controls, { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0, writeBatches: 0, beforeNextWriteBatch: null, beforeWriteBatch: null, stockAdmissionPairs: [] })
  return { d1, ...loaded }
}
const lot = (f) => ({ ...f.d1.db.prepare('SELECT unit_cost_usd u, received_cost_usd r FROM product_batches WHERE id=99001').get() })
const active = (f) => f.d1.db.prepare('SELECT is_active a FROM products WHERE id=10000').get().a
async function replay(f, direction, generation) {
  const history = f.d1.db.prepare("SELECT id,undo_payload,redo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.remove'").get()
  const payload = JSON.parse(direction === 'undo' ? history.undo_payload : history.redo_payload)
  return f.undo.resolveUndoApplier(payload).run(payload, { env: {}, user: owner, direction, historyId: history.id, generation })
}
let counter = 0
async function removed(lotSql, run0313) {
  const f = setup(lotSql)
  const r = await remove(f.app, 10000, { reason: 'probe', expectedUpdatedAt: '2026-09-08 01:00:00', client_request_id: 'probe_remove_long_lot_' + (counter += 1) })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  if (run0313) f.d1.db.exec(text0313)
  return f
}
function reviewApplyFor(f) {
  return loadTs('lib/reviewApply.ts', {
    './db': { getDb: () => f.db }, './audit': { audit: async () => {} }, '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './cache': { bumpVersion: async () => {} }, './productWrites': {}, './branchWrites': {}, './canonicalBranchIdentity': {}, './permissions': f.permissions,
    './productImagePermission': {}, './auth': {}, './pendingActions': {}, '../index': {}, './productDelete': f.productDelete,
  })
}
const reviewer = { id: 903, username: 'reviewer', name: 'Reviewer', organization_id: null, role_id: null, permissions: '{}', is_active: 1 }

async function main() {
  // B: long lot, 0313 between removal and undo -> undo AND redo complete.
  {
    const f = await removed(LONG, true)
    assert.deepEqual(lot(f), { u: 4.1235, r: 20.6173 }, '0313 rounded the removed lot')
    assert.equal((await replay(f, 'undo', 0)).complete, true)
    assert.equal(active(f), 1, 'the product is restored')
    assert.equal((await replay(f, 'redo', 1)).complete, true)
    assert.equal(active(f), 0, 'redo removes it again')
  }
  // B2 (round 7): near-tie costs, where roundMoney4 and 0313's HALF_UP_4DP differ (21.398249999999997 is 21.3982 and 21.3983). 0313 leaves the HALF_UP_4DP form,
  // (the product's USD cost equals its lot cost: the on-hand triggers re-derive it from the lots) so the removal guards accept it as well as roundMoney4's, on the product row and on the lot, and still refuse any other value.
  {
    const NEAR_TIE = 'UPDATE product_batches SET unit_cost_usd=21.398249999999997,received_cost_usd=0.6551499999999999 WHERE id=99001; UPDATE products SET cost_price_usd=21.398249999999997,purchase_price_usd=21.398249999999997,cost_price_khr=57310.638249999996,purchase_price_khr=57310.638249999996 WHERE id=10000;'
    const f = await removed(NEAR_TIE, true)
    assert.deepEqual(lot(f), { u: 21.3983, r: 0.6552 }, '0313 rounded the near-tie lot by HALF_UP_4DP (roundMoney4 would say 21.3982 and 0.6551)')
    assert.equal((await replay(f, 'undo', 0)).complete, true, 'undo accepts the HALF_UP_4DP form')
    assert.equal(active(f), 1, 'the product is restored')
    assert.equal((await replay(f, 'redo', 1)).complete, true)
    assert.equal(active(f), 0)
    // the roundMoney4 form is accepted too (a lot stored by the write path), and any other value is refused
    for (const [value, accepted] of [['21.3982', true], ['21.3983', true], ['21.3984', false], ['21.39825', false], ['NULL', false]]) {
      const g = await removed(NEAR_TIE, false)
      seedStockFixture(g.d1.db, () => g.d1.db.exec('UPDATE product_batches SET unit_cost_usd=' + value + ' WHERE id=99001'))
      if (accepted) { assert.equal((await replay(g, 'undo', 0)).complete, true, 'live lot ' + value + ' is a rounding of the saved cost'); assert.equal(active(g), 1) }
      else { await assert.rejects(() => replay(g, 'undo', 0), undefined, 'live lot ' + value + ' is not'); assert.equal(active(g), 0) }
    }
    for (const [column, value, accepted] of [['cost_price_usd', '21.3982', true], ['cost_price_usd', '21.3983', true], ['cost_price_usd', '21.3984', false], ['cost_price_khr', '57310.6382', true], ['cost_price_khr', '57310.6383', true], ['purchase_price_khr', '57310.6384', false]]) {
      const g = await removed(NEAR_TIE, false)
      seedStockFixture(g.d1.db, () => g.d1.db.exec('UPDATE products SET ' + column + '=' + value + ' WHERE id=10000'))
      if (accepted) { assert.equal((await replay(g, 'undo', 0)).complete, true, column + ' ' + value + ' is a rounding of the saved cost'); assert.equal(active(g), 1) }
      else { await assert.rejects(() => replay(g, 'undo', 0), undefined, column + ' ' + value + ' is not'); assert.equal(active(g), 0) }
    }
  }
  // A control: no 0313, long lot untouched.
  { const f = await removed(LONG, false); assert.equal((await replay(f, 'undo', 0)).complete, true); assert.equal(active(f), 1) }
  // C control: 4-place lot, 0313 runs.
  { const f = await removed(SHORT, true); assert.equal((await replay(f, 'undo', 0)).complete, true); assert.equal(active(f), 1) }
  // A real concurrent change is still refused, per column, with and without 0313.
  for (const column of ['unit_cost_usd', 'received_cost_usd']) {
    for (const run0313 of [true, false]) {
      for (const value of ['4.1234', '4.1236', 'NULL', '0', '4.12346']) {
        const f = await removed(LONG, run0313)
        seedStockFixture(f.d1.db, () => f.d1.db.exec('UPDATE product_batches SET ' + column + '=' + value + ' WHERE id=99001'))
        await assert.rejects(() => replay(f, 'undo', 0), undefined, column + '=' + value + ' (0313 ' + run0313 + ') refuses undo')
        assert.equal(active(f), 0, 'a refused undo restores nothing')
      }
    }
  }
  // Another lot column changing is still refused even when the cost twin matches.
  { const f = await removed(LONG, true); seedStockFixture(f.d1.db, () => f.d1.db.exec("UPDATE product_batches SET supplier_name='Changed' WHERE id=99001")); await assert.rejects(() => replay(f, 'undo', 0)); assert.equal(active(f), 0) }
  // Queued removal approved after 0313 (apply path).
  {
    const f = setup(LONG)
    const queued = await remove(f.app, 10000, { reason: 'queued', client_request_id: 'queued_long_lot_one' }, { id: 902, username: 'requester', reviewDelete: true })
    assert.equal(queued.status, 202, JSON.stringify(queued.body))
    f.d1.db.exec(text0313)
    assert.deepEqual(lot(f), { u: 4.1235, r: 20.6173 })
    const pending = { ...f.d1.db.prepare("SELECT * FROM pending_actions WHERE status='open'").get() }
    const approved = await reviewApplyFor(f).applyApprovedPendingAction({}, pending, { id: 903, name: 'Reviewer' }, reviewer)
    assert.equal(approved.pendingActionMarkedAtomically, true)
    assert.equal(active(f), 0, 'the queued removal applied after 0313 rounded the lot')
  }
  // Queued removal, REAL change between queue and approve -> still refused.
  for (const value of ['4.1234', '4.1236', 'NULL', '0']) {
    const f = setup(LONG)
    await remove(f.app, 10000, { reason: 'queued', client_request_id: 'queued_long_lot_' + value.replace(/\W/g, '_') }, { id: 902, username: 'requester', reviewDelete: true })
    f.d1.db.exec(text0313)
    seedStockFixture(f.d1.db, () => f.d1.db.exec('UPDATE product_batches SET unit_cost_usd=' + value + ' WHERE id=99001'))
    const pending = { ...f.d1.db.prepare("SELECT * FROM pending_actions WHERE status='open'").get() }
    await assert.rejects(() => reviewApplyFor(f).applyApprovedPendingAction({}, pending, { id: 903, name: 'Reviewer' }, reviewer))
    assert.equal(active(f), 1)
  }
  console.log('product remove long lot vs 0313: undo, redo and queued apply accept the rounded lot; real changes still refused')
}
main().catch((e) => { console.error(e); process.exit(1) })
