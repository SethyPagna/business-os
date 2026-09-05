// Reuse the sibling's actual Hono/D1Compat/SQLite fixture without running its
// suite. Only the dependency loader gains the real damaged-stock/money helpers
// and an inert notification adapter. No production or network access.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const fixturePath = path.join(__dirname, 'test-sale-bulk-status-pure.cjs')
let fixtureSource = fs.readFileSync(fixturePath, 'utf8')
const end = fixtureSource.indexOf('async function run() {')
assert.ok(end > 0, 'sibling fixture boundary must exist')
fixtureSource = fixtureSource.slice(0, end)
const loaderAnchor = "const sales = load('routes/sales.ts').default"
assert.ok(fixtureSource.includes(loaderAnchor))
fixtureSource = fixtureSource.replace(loaderAnchor, "actual.add('returnsStock'); actual.add('saleTotals');\n" + loaderAnchor)
const importAnchor = "if (name==='hono') return require(name)"
assert.ok(fixtureSource.includes(importAnchor))
fixtureSource = fixtureSource.replace(importAnchor, importAnchor + "\n    if (name.endsWith('/telegram')) return { sendTelegramEvent: async()=>{} }")
const { fixture, seed, sales, request, snapshot, setUser } = new Function('require', '__dirname',
  fixtureSource + '\nreturn { fixture, seed, sales, request, snapshot, setUser(value) { user=value } }')(require, __dirname)
sales.onError((error, c) => c.json({ error: error.message }, 500))

function damagedFixture(count = 2) {
  const f = fixture()
  seed(f, count)
  f.sql.exec(`
    INSERT OR IGNORE INTO users(id,username,password,name) VALUES(1,'test-admin','unused','Admin');
    INSERT INTO damaged_stock_lots(id,product_id,branch_id,quantity,quantity_remaining) VALUES(1,1,1,10,0);
    UPDATE sale_items SET damaged_lot_id=1;
    UPDATE sales SET sale_status='cancelled',status_before_cancel='awaiting_delivery' WHERE id=2;
    UPDATE sale_items SET quantity=4 WHERE id=2;
  `)
  f.sql.pragma('foreign_keys = ON')
  assert.deepEqual(f.sql.pragma('foreign_key_check'), [])
  return f
}
const stock = f => f.sql.prepare('SELECT quantity_remaining q FROM damaged_stock_lots WHERE id=1').get().q
const movements = f => f.sql.prepare("SELECT COALESCE(SUM(quantity),0) q FROM inventory_movements WHERE movement_type IN ('damage_in','damage_out')").get().q
const single = (f, id, target, extra = {}) => f.call(sales, `/${id}/status`, {
  sale_status: target, ...(target === 'cancelled' ? { cancel_reason: 'mistake' } : {}),
  expected_updated_at: f.sql.prepare('SELECT updated_at FROM sales WHERE id=?').get(id).updated_at,
  ...extra,
}, 'PATCH')
function pause(f) {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  f.barrier(async () => { entered(); await gate })
  return { ready, release }
}
async function run() {
  let f = damagedFixture()
  const barrier = pause(f)
  const cancelling = single(f, 1, 'cancelled')
  await barrier.ready
  let grouped, consumer, committed, provisional
  try {
    provisional = stock(f)
    const req = request(f, 'cancelled')
    req.items = req.items.filter(item => item.id === 1)
    grouped = await f.call(sales, '/bulk-status', req)
    consumer = await single(f, 2, 'awaiting_delivery')
    committed = snapshot(f)
  } finally { barrier.release() }
  const stale = await cancelling
  assert.equal(provisional, 0, 'paused status must not expose provisional damaged units')
  assert.equal(grouped.status, 200, JSON.stringify(grouped))
  assert.equal(consumer.status, 409, 'consumer cannot spend the same restored units twice')
  assert.equal(stale.status, 409, JSON.stringify(stale))
  assert.equal(snapshot(f), committed, 'stale cancellation causes no compensation or other writes')
  assert.equal(stock(f), 2)
  assert.equal(movements(f), 2)
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=2').get().sale_status, 'cancelled')
  f.sql.close()
  console.log('PASS actual single/bulk/consumer barrier rejects provisional-stock oversell and preserves ledger parity')

  // Two independently prepared draws from the same lot: one succeeds, and
  // the other rolls back its status and every preceding regular-stock write.
  f = damagedFixture()
  f.sql.exec("UPDATE sales SET sale_status='cancelled',status_before_cancel='awaiting_delivery' WHERE id=1; UPDATE sale_items SET quantity=4 WHERE id=1; UPDATE damaged_stock_lots SET quantity_remaining=4")
  const drawBarrier = pause(f)
  const draw = single(f, 1, 'awaiting_delivery')
  await drawBarrier.ready
  let winner, afterWinner
  try { winner = await single(f, 2, 'awaiting_delivery'); afterWinner = snapshot(f) }
  finally { drawBarrier.release() }
  assert.equal(winner.status, 200, JSON.stringify(winner))
  assert.equal((await draw).status, 409)
  assert.equal(snapshot(f), afterWinner)
  assert.equal(stock(f), 0)
  assert.equal(movements(f), -4)
  f.sql.close()
  console.log('PASS competing actual single-status draws cannot underflow the shared damaged lot')

  function mixedFixture(cancelled = false) {
    const mixed = damagedFixture(1)
    mixed.sql.exec(`
      INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,damaged_lot_id) VALUES(2,1,1,'A',1,1,1),(3,1,1,'A',2,1,NULL);
      INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1,1,'fixture');
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,20);
      UPDATE sale_items SET batch_id=1 WHERE id=3;
      INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,3,1,1,2,0);
    `)
    if (cancelled) mixed.sql.exec("UPDATE sales SET sale_status='cancelled',status_before_cancel='awaiting_delivery' WHERE id=1; UPDATE damaged_stock_lots SET quantity_remaining=3; UPDATE sale_item_batch_allocations SET released_quantity=2")
    return mixed
  }
  for (const cancelled of [false, true]) {
    // Abort after EACH damaged movement, including after earlier damaged and
    // regular operations have executed, using an actual SQLite trigger.
    for (const nth of [1, 2]) {
      f = mixedFixture(cancelled)
      f.sql.exec(`CREATE TEMP TRIGGER fail_after_damage AFTER INSERT ON inventory_movements
        WHEN NEW.movement_type IN ('damage_in','damage_out')
          AND (SELECT COUNT(*) FROM inventory_movements WHERE movement_type IN ('damage_in','damage_out')) = ${nth}
        BEGIN SELECT RAISE(ABORT, 'injected failure after damaged movement'); END;`)
      const before = snapshot(f)
      const result = await single(f, 1, cancelled ? 'awaiting_delivery' : 'cancelled')
      assert.equal(result.status, 500, JSON.stringify(result))
      assert.equal(snapshot(f), before, `rollback after movement ${nth}, cancelled=${cancelled}`)
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sale_bulk_guards').get().n, 0)
      f.sql.close()
    }
  }
  console.log('PASS injected failure after each damaged movement rolls back mixed regular/batch/allocation/status/lot state in both directions')

  for (const mutation of [
    'UPDATE damaged_stock_lots SET quantity_remaining=9', // would over-restore
    'UPDATE damaged_stock_lots SET product_id=2',
    'UPDATE damaged_stock_lots SET branch_id=2',
    'DELETE FROM damaged_stock_lots',
  ]) {
    f = damagedFixture(1)
    f.sql.pragma('foreign_keys = OFF') // Permit a corrupted/deleted legacy lot reference.
    let changed
    f.barrier(() => { f.sql.exec(mutation); changed = snapshot(f) })
    assert.equal((await single(f, 1, 'cancelled')).status, 409, mutation)
    assert.equal(snapshot(f), changed, mutation)
    f.sql.close()
  }
  console.log('PASS commit-time identity, missing-lot and upper-bound conflicts refuse without partial writes')

  f = mixedFixture()
  f.sql.exec('INSERT INTO returns(id,sale_id) VALUES(1,1); INSERT INTO return_items(return_id,sale_item_id,product_id,quantity) VALUES(1,1,1,1)')
  assert.equal((await single(f, 1, 'cancelled')).status, 200)
  assert.equal(stock(f), 2, 'already returned damaged unit is not restored twice')
  assert.equal(movements(f), 2)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 52)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').get().quantity, 22)
  assert.equal((await single(f, 1, 'awaiting_payment')).status, 200)
  assert.equal(stock(f), 0)
  assert.equal(movements(f), 0)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 50)
  assert.equal(f.sql.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE id=1').get().released_quantity, 0)
  assert.deepEqual(f.sql.pragma('foreign_key_check'), [])
  f.sql.close()
  console.log('PASS mixed damaged/regular/batch/partial-return cancel and resume preserves stock parity with foreign keys enabled')

  f = mixedFixture()
  assert.equal((await single(f, 1, 'cancelled', { skip_stock: true })).status, 200)
  assert.equal((await single(f, 1, 'awaiting_payment')).status, 200)
  assert.equal(stock(f), 0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 0)
  assert.equal(f.sql.prepare('SELECT stock_skipped FROM sales WHERE id=1').get().stock_skipped, 1)
  const before = snapshot(f)
  assert.equal((await single(f, 1, 'awaiting_payment')).status, 200)
  assert.equal(snapshot(f), before, 'no-op stays read only')
  setUser({ id: 2, name: 'Clerk', role_code: 'user', permissions: { sales: 'view' } })
  assert.equal((await single(f, 1, 'cancelled')).status, 403)
  assert.equal(snapshot(f), before)
  f.sql.close()
  console.log('PASS sticky skip, no-op and permission behavior preserved')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
