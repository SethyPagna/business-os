// Real Hono transfer routes + action-history undo/redo on production
// migrations: fractional lots whose float sum is not exact must not refuse a
// transfer the stock fully covers (U-transfer3, refuter R-transfer2 F2,
// 27 Sep 2026).
//
// transferEffectStatements' untracked guard compares, in SQL,
//   MAX(branch_stock - SUM(lot rows), 0)  <  untracked - 1e-9   -> refuse
// For branch 10 with lots 0.1 + 0.2, SQLite's SUM is 0.30000000000000004, so
// the left side is 9.7; the planner's FIFO leaves untracked = 10 - 0.1 - 0.2 =
// 9.700000000000001. The two differ by 1.8e-15 of float noise. With the 1e-9
// tolerance the guard passes; with an EXACT comparison (`< m.untracked`) it
// trips the NOT NULL sentinel and a transfer of exactly the branch stock is
// refused 409 transfer_stock_changed -- on every Retry, the lock U-transfer3
// fixes on the client. The existing 0.5 + 0.3 case in
// test-transfer-lots-exceed-branch-pure.cjs does not catch that mutant: there
// the lots cover the whole quantity, untracked is 0 and the guard's
// `m.untracked > 1e-9` short-circuits before the comparison.
//
// Transition table. S = source Warehouse (2), D = destination Shop (1),
// B = branch_stock, L = sum of lot rows, U = untracked part of q.
//   case                           q    S.B     S.L     D.B     D.L    U
//   lots 0.1 + 0.2, B 10          10   10->0   0.3->0  0->10   0->0.3 9.7
//   replay same key                     no second movement
//   undo                                exact inverse (the same guard runs at D)
//   repeated undo                       moves nothing
//   redo                                the forward row again
//
// Mutant check (not part of the gate): in cloudflare/src/lib/transferOperation.ts
// change `<m.untracked-${QUANTITY_EPSILON})` to `<m.untracked)` and this file
// goes red on all three routes.
//
// Run: node scripts/test-transfer-lots-fractional-exact-pure.cjs
const assert = require('node:assert/strict')
const h = require('./test-transfer-operation-receipt-pure.cjs')
h.apps.history = h.load('routes/actionHistory.ts').default
h.apps.history.onError((error, c) => c.json({ error: error.message }, 500))

const S = 2
const D = 1
const ROUTES = [['branches', '/transfer'], ['branches', '/transfer-bulk'], ['inventory', '/transfer']]
const sql = () => h.getDb()
const round = (value) => Math.round(value * 1e9) / 1e9
const branchQty = (product, branch) => sql().prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(product, branch)?.quantity ?? 0
const lotsAt = (product, branch) => sql().prepare(`SELECT COALESCE(SUM(bs.quantity),0) AS n FROM branch_batch_stock bs
  JOIN product_batches b ON b.id=bs.batch_id WHERE b.variant_product_id=? AND bs.branch_id=?`).get(product, branch).n
const ledger = (product) => ({ S: [round(branchQty(product, S)), round(lotsAt(product, S))], D: [round(branchQty(product, D)), round(lotsAt(product, D))] })
function stockState() {
  return {
    branch: sql().prepare('SELECT product_id,branch_id,ROUND(quantity,9) q FROM branch_stock WHERE ABS(quantity)>0.000000001 ORDER BY product_id,branch_id').all(),
    lots: sql().prepare('SELECT batch_id,branch_id,ROUND(quantity,9) q FROM branch_batch_stock WHERE ABS(quantity)>0.000000001 ORDER BY batch_id,branch_id').all(),
    totals: sql().prepare('SELECT id,ROUND(stock_quantity,9) q FROM products ORDER BY id').all(),
  }
}
function snapshot() {
  return Object.fromEntries(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'transfer_operation_receipts', 'transfer_operation_members',
    'stock_transfers', 'inventory_movements', 'action_history', 'audit_logs'].map((table) => [table, sql().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function body(route, key, line) {
  const common = { transfer_provenance_version: 1, fromBranchId: S, toBranchId: D, reason: 'Restock', client_request_id: key }
  return route === '/transfer-bulk' ? { ...common, items: [line] } : { ...common, ...line }
}
const reverse = (id, direction, generation) => h.request('history', `/${id}/${direction}`, { require_applied: true, expected_generation: generation })
const productTotalsMatchBranches = () => {
  for (const row of sql().prepare('SELECT id,stock_quantity FROM products').all()) {
    const sum = sql().prepare('SELECT COALESCE(SUM(quantity),0) n FROM branch_stock WHERE product_id=?').get(row.id).n
    assert.equal(round(row.stock_quantity), round(sum), `products.stock_quantity of #${row.id} must stay the branch sum`)
  }
}

let checks = 0
async function main() {
  const failures = []
  for (const [app, route] of ROUTES) {
    const name = `${app}${route}: branch 10 with lots 0.1 + 0.2, lot-less q=10 moves all 10 (9.7 untracked), once; undo/redo exact`
    try {
    h.fresh(1, S)
    sql().exec(`UPDATE branch_batch_stock SET quantity=0.1 WHERE batch_id=1 AND branch_id=${S};
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES (61,1,'newer','newer','2026-09-02',1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES (61,${S},0.2)`)
    // The premise: SQL's lot sum is not exact, and differs from the planner's residue.
    const sqlGap = 10 - lotsAt(1, S)
    const plannerUntracked = 10 - 0.1 - 0.2
    assert.notEqual(sqlGap, plannerUntracked, 'the fixture must put float noise between the guard\'s two sides')
    assert.ok(sqlGap < plannerUntracked && plannerUntracked - sqlGap < 1e-9, `gap ${sqlGap} vs untracked ${plannerUntracked}`)

    const start = stockState()
    const request = body(route, `fraction_${app}_${route.replace(/\W/g, '_')}`, { productId: 1, quantity: 10 })
    const result = await h.request(app, route, request)
    assert.equal(result.status, 200, `${name}: forward ${JSON.stringify(result.body)}`)
    assert.deepEqual(ledger(1), { S: [0, 0], D: [10, 0.3] }, `${name}: forward ledger`)
    const member = sql().prepare('SELECT quantity,untracked_quantity FROM transfer_operation_members').get()
    assert.equal(member.quantity, 10)
    assert.equal(round(member.untracked_quantity), 9.7)
    productTotalsMatchBranches()

    const afterForward = snapshot()
    const replay = await h.request(app, route, request)
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.replayed, true)
    assert.deepEqual(snapshot(), afterForward, `${name}: the same request applied twice moves stock once`)

    const historyId = result.body.action_history_id
    let reversal = await reverse(historyId, 'undo', 0)
    assert.equal(reversal.status, 200, `${name}: undo ${JSON.stringify(reversal.body)}`)
    assert.deepEqual(stockState(), start, `${name}: undo restores both ledgers exactly`)
    productTotalsMatchBranches()
    const afterUndo = snapshot()
    reversal = await reverse(historyId, 'undo', 0)
    assert.equal(reversal.status, 200, JSON.stringify(reversal.body))
    assert.deepEqual(snapshot(), afterUndo, `${name}: a repeated undo restores nothing twice`)
    reversal = await reverse(historyId, 'redo', 1)
    assert.equal(reversal.status, 200, `${name}: redo ${JSON.stringify(reversal.body)}`)
    assert.deepEqual(ledger(1), { S: [0, 0], D: [10, 0.3] }, `${name}: redo ledger`)
    productTotalsMatchBranches()
    checks += 1
    console.log(`PASS ${name}`)
    } catch (error) {
      // Each route is reported on its own, so one red cannot hide the others.
      failures.push(name)
      console.log(`RED  ${String(error.message).split('\n')[0]}`)
    }
  }
  assert.deepEqual(failures, [], `${failures.length} route(s) refused a fully covered transfer`)
  assert.equal(checks, 3, 'all three transfer routes ran')
  console.log(`${checks} fractional-lot transfer checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
