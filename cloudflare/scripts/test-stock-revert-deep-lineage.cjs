const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
const kernel = loadStockSession('lib/stockRevert.ts')
const getDb = loadStockSession('lib/db.ts').getDb
const actor = { userId: user.id, userName: user.name }
const latest = f => f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id DESC LIMIT 1').get()
const state = f => JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','inventory_movements'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
function seed(f, type = 'add') {
  f.sql.exec(`UPDATE products SET stock_quantity=10 WHERE id=1; UPDATE branch_stock SET quantity=10 WHERE product_id=1 AND branch_id=1;
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,payment_status,received_quantity,received_branch_id,received_cost_usd)
      VALUES(7001,1,'20260930-chain','fixture-chain','2026-09-30',1,1,4,'paid',10,1,40);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(7001,1,10)`)
  return Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,batch_id)
    VALUES(1,1,?,10,4,40,'Synthetic direct stock action',7001)`).run(type).lastInsertRowid)
}
function appendChain(f, root, depth) {
  let parent = root
  for (let i = 1; i <= depth; i++) parent = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,batch_id)
    VALUES(1,1,?,10,4,40,?,7001)`).run(i % 2 ? 'remove' : 'add', `revert:${parent}`).lastInsertRowid)
  return latest(f)
}
async function main() {
  const receipt = fixture()
  try {
    seed(receipt)
    const db = getDb(receipt.env)
    for (let generation = 0; generation <= 34; generation++) {
      const lot = receipt.sql.prepare('SELECT received_quantity,received_cost_usd,is_active FROM product_batches WHERE id=7001').get()
      const remaining = generation % 2 ? 0 : 10
      assert.equal(receipt.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, remaining)
      assert.equal(lot.received_quantity, remaining, `receipt purchase quantity generation ${generation}`)
      assert.equal(lot.received_cost_usd, remaining * 4, `receipt purchase money generation ${generation}`)
      assert.equal(lot.is_active, remaining ? 1 : 0)
      if (generation === 34) break
      const result = await kernel.applyMovementRevert(db, latest(receipt), actor)
      assert.equal(result.ok, true, JSON.stringify(result))
    }
    assert.equal(receipt.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 35)
    console.log('PASS actual receipt reversals through generation34 keep stock, received quantity, purchase cost, active state and audit in parity')
  } finally { receipt.sql.close() }

  for (const type of ['add', 'remove', 'adjustment', 'out']) {
    const f = fixture()
    try {
      const root = seed(f, type)
      const db = getDb(f.env)
      const queries = []
      const counted = { prepare: text => { queries.push(text); return db.prepare(text) } }
      assert.deepEqual(await kernel.revertRootMovement(counted, latest(f)), { id: root, movement_type: type })
      assert.equal(queries.length, 0, 'ordinary root needs no additional database read')
      const end = appendChain(f, root, 1000)
      assert.deepEqual(await kernel.revertRootMovement(counted, end), { id: root, movement_type: type })
      assert.equal(queries.length, 1, 'deep ancestry uses one indexed statement, never one roundtrip per hop')
      const plan = f.sql.prepare('EXPLAIN QUERY PLAN ' + queries[0]).all({ id: end.id })
      assert.ok(plan.filter(row => /SEARCH .* USING INTEGER PRIMARY KEY/.test(row.detail)).length >= 2, JSON.stringify(plan))
      assert.ok(plan.every(row => !/SCAN (parent|inventory_movements)\b/.test(row.detail)), JSON.stringify(plan))
      const applied = await kernel.applyMovementRevert(db, end, actor)
      assert.equal(applied.ok, true, JSON.stringify(applied))
      const lot = f.sql.prepare('SELECT received_quantity,received_cost_usd FROM product_batches WHERE id=7001').get()
      assert.deepEqual(lot, type === 'add' ? { received_quantity: 0, received_cost_usd: 0 } : { received_quantity: 10, received_cost_usd: 40 }, 'only receipt-root chains change purchase accounting')
    } finally { f.sql.close() }
  }
  console.log('PASS depth1000 indexed ancestry and receipt versus removal/correction/import financial controls')

  for (const malformed of ['missing', 'nonnumeric', 'fractional', 'noncanonical', 'zero', 'negative', 'self', 'forward', 'cycle']) {
    const f = fixture()
    try {
      const root = seed(f)
      const end = appendChain(f, root, 2)
      const reference = { missing: 'revert:999999', nonnumeric: 'revert:no-id', fractional: `revert:${root}.5`, noncanonical: `revert:0${root}`, zero: 'revert:0', negative: 'revert:-1', self: `revert:${end.id}`, forward: `revert:${end.id+1}`, cycle: `revert:${end.id-1}` }[malformed]
      f.sql.prepare('UPDATE inventory_movements SET reference_id=? WHERE id=?').run(reference, end.id)
      if (malformed === 'zero' || malformed === 'negative') f.sql.prepare("INSERT INTO inventory_movements(id,product_id,branch_id,movement_type,quantity) VALUES(?,1,1,'add',10)").run(malformed === 'zero' ? 0 : -1)
      if (malformed === 'forward') appendChain(f, root, 1)
      if (malformed === 'cycle') f.sql.prepare('UPDATE inventory_movements SET reference_id=? WHERE id=?').run(`revert:${end.id}`, end.id-1)
      const selected = f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(end.id)
      const before = state(f)
      assert.equal(await kernel.revertRootMovement(getDb(f.env), selected), null, malformed)
      const result = await kernel.applyMovementRevert(getDb(f.env), selected, actor)
      assert.equal(result.ok, false, malformed)
      assert.equal(result.status, 409, malformed)
      assert.deepEqual(state(f), before, `${malformed} lineage cannot silently become a stock-only mutation`)
    } finally { f.sql.close() }
  }
  console.log('PASS missing, malformed, self, forward and cyclic ancestry fail closed with every stock/purchase row unchanged')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
