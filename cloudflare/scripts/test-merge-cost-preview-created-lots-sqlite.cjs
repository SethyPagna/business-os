'use strict'
// M1 (deploy 4 compose review): the reviewed cost preview disagreed with the stored cost when a duplicate holds TWO or more lots on a received date the
// keeper lacks. The fold creates ONE lot on the keeper for that date (the first of them, lowest batch number then id) and folds the others into it, writing
// the quantity-weighted cost to it (productMergeLots.ts planFoldedLotMetadata). The preview applied that cost only to a lot already on the keeper, so it skipped
// the very lot the fold writes (a duplicate's lot) and showed the unfolded cost (the reviewer: 5.3333 shown, 4.50 stored).
// Rule: the preview applies exactly the fold's lot plan to every folded target, whichever product the target came from.
// Real routes (reviewed group merge: preview, finalize, apply): the cost shown at finalize == the keeper's stored catalog cost == the weighted mean of
// the stored active lots, and the stored lot costs are the ones the fold's rule gives.
const assert = require('node:assert/strict')
const w = require('./harness/merge-group-world.cjs')

let lotId = 99100
const lotSql = (owner, { date, qty, cost }) => {
  lotId += 1
  return `INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
      VALUES (${lotId},${owner},'extra-${lotId}','LOT-${lotId}','2027-06-01','${date}',1,'extra lot',${lotId - 99000},41,'Supplier X',${cost},'paid',NULL,${qty},1,${qty * cost});
    INSERT INTO branch_batch_stock (batch_id,branch_id,quantity) VALUES (${lotId},1,${qty});
    UPDATE branch_stock SET quantity = quantity + ${qty} WHERE product_id = ${owner} AND branch_id = 1;
    UPDATE products SET stock_quantity = stock_quantity + ${qty} WHERE id = ${owner};`
}
const round4 = (value) => Math.round((value + Number.EPSILON) * 1e4) / 1e4

// keeper: lot 99001 on 2026-09-01 (3 @ 4). duplicate A: lot 99002 on `first.date` plus `extra` lots.
async function world(label, first, extra) {
  const { d1, ids } = w.seedWorld({
    lots: [{ qty: 3, cost: 4, date: '2026-09-01' }, { qty: first.qty, cost: first.cost, date: first.date }],
    extra: extra.map((lot) => lotSql(10001, lot)).join('\n'),
  })
  const f = { d1, ...w.loadRoute(d1, true) }
  const { projected } = await w.applyGroup(d1, f, ids, label)
  const shown = projected.costAuthority.cost_price_usd
  const stored = d1.db.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id = 10000').get()
  const lots = w.rows(d1.db, `SELECT pb.id, pb.variant_product_id v, pb.is_active a, pb.unit_cost_usd c, pb.received_at d,
    COALESCE((SELECT SUM(quantity) FROM branch_batch_stock WHERE batch_id = pb.id), 0) q FROM product_batches pb ORDER BY pb.id`)
  const active = lots.filter((lot) => lot.a === 1 && lot.q > 0)
  const weighted = round4(active.reduce((sum, lot) => sum + lot.c * lot.q, 0) / active.reduce((sum, lot) => sum + lot.q, 0))
  assert.equal(projected.costAuthority.source, 'received_lot', `${label}: the cost comes from the received lots`)
  assert.equal(shown, stored.c, `${label}: the cost shown at finalize (${shown}) is the keeper's stored catalog cost (${stored.c})`)
  assert.equal(stored.c, weighted, `${label}: the stored catalog cost is the weighted mean of the stored active lots (${weighted})`)
  return { lots, shown, stored }
}
const lotOf = (lots, id) => lots.find((lot) => lot.id === id)

async function main() {
  // The reviewer's shape: A holds two lots on a date the keeper lacks: 2 @ 4 (99002) and 4 @ 4.75. One lot is created for the date, carrying (2*4 + 4*4.75)/6 = 4.5.
  const two = await world('two duplicate lots on a date the keeper lacks', { date: '2026-09-02', qty: 2, cost: 4 }, [{ date: '2026-09-02', qty: 4, cost: 4.75 }])
  assert.equal(lotOf(two.lots, 99002).c, 4.5, 'the created lot carries the weighted cost of the lots folded into it')
  assert.equal(lotOf(two.lots, 99002).q, 6, 'and their combined stock')
  assert.equal(lotOf(two.lots, 99002).v, 10000, 'and sits on the keeper')
  assert.equal(two.shown, round4((3 * 4 + 6 * 4.5) / 9), 'shown = (keeper 3 @ 4 + created 6 @ 4.5) / 9')
  // Three duplicate lots on that date.
  const three = await world('three duplicate lots on a date the keeper lacks', { date: '2026-09-02', qty: 2, cost: 4 }, [{ date: '2026-09-02', qty: 4, cost: 4.75 }, { date: '2026-09-02', qty: 1, cost: 9 }])
  assert.equal(lotOf(three.lots, 99002).c, round4((2 * 4 + 4 * 4.75 + 1 * 9) / 7), 'three lots: one weighted mean')
  // Mixed dates: two on a date the keeper lacks, one on the keeper's date (folds into the keeper's own lot), one on another date (created alone).
  const mixed = await world('mixed dates', { date: '2026-09-02', qty: 2, cost: 4 },
    [{ date: '2026-09-02', qty: 4, cost: 4.75 }, { date: '2026-09-01', qty: 1, cost: 10 }, { date: '2026-09-03', qty: 2, cost: 6 }])
  assert.equal(lotOf(mixed.lots, 99002).c, 4.5, 'mixed: the two-lot date')
  assert.equal(lotOf(mixed.lots, 99001).c, round4((3 * 4 + 1 * 10) / 4), 'mixed: the keeper lot takes the lot of its own date')
  // Controls: one duplicate lot on a date the keeper lacks (created as it is); two on the keeper's date (folded into the keeper's lot).
  const one = await world('control: one duplicate lot on a new date', { date: '2026-09-02', qty: 2, cost: 8 }, [])
  assert.equal(lotOf(one.lots, 99002).c, 8)
  const kept = await world('control: two duplicate lots on the keeper date', { date: '2026-09-01', qty: 2, cost: 8 }, [{ date: '2026-09-01', qty: 4, cost: 5 }])
  assert.equal(lotOf(kept.lots, 99001).c, round4((3 * 4 + 2 * 8 + 4 * 5) / 9), 'the keeper lot carries the weighted mean of all three')
  console.log('merge cost preview, created lots (group path): the cost shown equals the cost stored in every shape')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
