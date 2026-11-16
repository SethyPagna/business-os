'use strict'
// Owner ruling, 16 Nov 2026: a merged duplicate's lots integrate with the merge BY RECEIVED DATE.
//   "merged duplicate row should integrate with the merge. so there shouldn't be any so called merged duplicate row left.
//    it will create a batch if there isn't a match date or add stock to batch if there is."
//   Same date, different cost or expiry: "Always add on same date".
//
// A seeded world on the REAL products route over the full migration chain (the route harness), through the real
// POST /possible-duplicates/merge and the real action-history undo / redo. Every figure below is derived by hand in
// the comment above the fixture, and every mutant in mutants-merge-lots-by-date.cjs turns at least one of them red.
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const K = 1 // keeper
const D = 2 // discarded twin
let passed = 0
let failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
}
const plain = (rows) => (Array.isArray(rows) ? rows.map((row) => ({ ...row })) : rows == null ? rows : { ...rows })

function fixtureWrite(h, run) {
  h.raw.db.exec("BEGIN; INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  try {
    run()
    h.raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT")
  } catch (error) { h.raw.db.exec('ROLLBACK'); throw error }
}

// ---------------------------------------------------------------------------------------------------------------
// The world. Three branches (1 Shop, 2 Warehouse, 3 Store). Business day = UTC+7.
//
//   KEEPER lots (product 1)                                  DISCARDED lots (product 2)
//   101 K1  3 Nov  $2.00 exp 2027-01-31  br1 5, br2 2        201 D1  3 Nov           $2.40 exp 2027-03-31  br1 3, br3 2
//   102 K2 10 Nov  $3.00 exp 2027-04-30  br1 4                207 D7  3 Nov           $2.40 exp 2027-12-31  br2 1, br3 1
//   103 K3 10 Nov  $3.50 (second 10 Nov lot)  br1 6          202 D2 10 Nov           $3.00 no expiry       br2 4
//   104 K4 12 Nov  $5.00 exp 2027-06-30  br2 3                203 D3 12 Nov           $5.00 exp 2027-02-28  br1 1
//   105 K5  4 Nov  $4.00 no expiry  br1 2, br3 1              206 D6  3 Nov 23:30 UTC $0    exp 2027-05-31  br1 1
//                                                             204 D4 20 Nov (no kept lot that day) $6.00    br1 2, br2 2
//   Branch stock: br1 18 (1 untracked), br2 5, br3 1          205 D5 no received date $0, key = K1's key    br3 3
//                                                             Branch stock: br1 7, br2 8 (1 untracked), br3 6
//
//   D1 and D7 are both 3 Nov: two discarded lots into ONE kept lot (K1), cost {2.00, 2.40, 2.40} -> weighted mean 2.20
//   (a per-lot mean is 2.2667), expiry the earliest of 2027-01-31 / 03-31 / 12-31.
//   D6 was received at 23:30 UTC on 3 Nov = 4 Nov in the shop, so it meets K5 (4 Nov), not K1 (3 Nov, the UTC day).
//   Its $0 is not part of K5's mean (K5 stays $4.00); K5 takes its expiry (it had none).
//   D2 meets K2, the LOWER batch_number of the two 10 Nov kept lots. D3 meets K4 at an equal cost, an earlier expiry.
//   D4 has no same-day kept lot and D5 has no date: each is created as a lot of the keeper (batch numbers 6 and 7).
//   D5's batch_key equals K1's: UNIQUE(variant_product_id, batch_key) would refuse the move, so it takes a key of its own.
// ---------------------------------------------------------------------------------------------------------------
function world() {
  const h = createProductsRouteHarness({ user: ADMIN })
  fixtureWrite(h, () => {
    const db = h.raw.db
    db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0),(3,'Store',1,0);
      INSERT INTO suppliers(id,name) VALUES(1,'Sup K'),(2,'Sup D');
      INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,wholesale_price_usd)
        VALUES(${K},'Twin Serum','777',1,24,3,3,10,8),(${D},'Twin Serum','777',1,21,3,3,10,8);`)
    const lot = db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,
      is_active,supplier_id,supplier_name,payment_status,credit_due_date,received_quantity,received_cost_usd,received_branch_id,received_branch_name)
      VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`)
    const L = (id, product, key, number, code, received, expiry, cost, supplier, pay, due, qty, money) =>
      lot.run(id, product, key, number, code, received, expiry, cost, supplier, supplier ? `Sup ${supplier === 1 ? 'K' : 'D'}` : null, pay, due, qty, money, 1, 'Shop')
    L(101, K, 'K-KEY-1', 1, 'K-LOT-1', '2026-11-03', '2027-01-31', 2.0, 1, 'paid', null, 7, 14)
    L(102, K, 'K-KEY-2', 2, 'K-LOT-2', '2026-11-10', '2027-04-30', 3.0, 1, 'paid', null, 4, 12)
    L(103, K, 'K-KEY-3', 3, 'K-LOT-3', '2026-11-10', null, 3.5, 1, 'credit', '2026-12-10', 6, 21)
    L(104, K, 'K-KEY-4', 4, 'K-LOT-4', '2026-11-12', '2027-06-30', 5.0, 1, 'paid', null, 3, 15)
    L(105, K, 'K-KEY-5', 5, 'K-LOT-5', '2026-11-04', null, 4.0, 1, 'paid', null, 3, 12)
    L(201, D, 'D-KEY-1', 1, 'D-LOT-1', '2026-11-03', '2027-03-31', 2.4, 2, 'credit', '2026-12-03', 5, 12)
    L(207, D, 'D-KEY-7', 2, 'D-LOT-7', '2026-11-03', '2027-12-31', 2.4, 2, 'paid', null, 2, 4.8)
    L(202, D, 'D-KEY-2', 3, 'D-LOT-2', '2026-11-10', null, 3.0, 2, 'paid', null, 4, 12)
    L(203, D, 'D-KEY-3', 4, 'D-LOT-3', '2026-11-12', '2027-02-28', 5.0, 2, 'credit', '2026-12-12', 1, 5)
    L(206, D, 'D-KEY-6', 5, 'D-LOT-6', '2026-11-03 23:30:00', '2027-05-31', 0, 2, 'paid', null, 1, 0)
    L(204, D, 'D-KEY-4', 6, 'D-LOT-4', '2026-11-20', null, 6.0, 2, 'paid', null, 4, 24)
    L(205, D, 'K-KEY-1', 7, 'D-LOT-5', null, null, 0, 2, 'paid', null, 3, 0)
    const stock = db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
    for (const [p, b, q] of [[K, 1, 18], [K, 2, 5], [K, 3, 1], [D, 1, 7], [D, 2, 8], [D, 3, 6]]) stock.run(p, b, q)
    const lotStock = db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)')
    for (const [l, b, q] of [[101, 1, 5], [101, 2, 2], [102, 1, 4], [103, 1, 6], [104, 2, 3], [105, 1, 2], [105, 3, 1],
      [201, 1, 3], [201, 3, 2], [207, 2, 1], [207, 3, 1], [202, 2, 4], [203, 1, 1], [206, 1, 1], [204, 1, 2], [204, 2, 2], [205, 3, 3]]) lotStock.run(l, b, q)
    // History before the merge. Sale 500: line 600 drew from D1 (1) and D2 (1); line 601 drew from D6 (1), single lot.
    // Return 700 gave one unit of line 600 back into D1.
    db.exec(`INSERT INTO sales(id,receipt_number) VALUES(500,'20261105-100000');
      INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(600,500,${D},'Twin Serum',2,NULL),(601,500,${D},'Twin Serum',1,206);
      INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity)
        VALUES(1,600,201,1,1,0),(2,600,202,2,1,0),(3,601,206,1,1,0);
      INSERT INTO returns(id,return_number,sale_id) VALUES(700,'RET-1',500);
      INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(710,700,${D},'Twin Serum',1,201);
      INSERT INTO return_item_batch_allocations(id,return_item_id,sale_item_id,batch_id,branch_id,quantity) VALUES(1,710,600,201,1,1);
      INSERT INTO inventory_movements(id,product_id,product_name,branch_id,movement_type,quantity,reason,batch_id,unit_cost_usd,total_cost_usd) VALUES
        (801,${D},'Twin Serum',1,'write_off',1,'damaged',201,NULL,NULL),
        (802,${K},'Twin Serum',1,'write_off',1,'damaged',101,NULL,NULL),
        (803,${D},'Twin Serum',2,'write_off',1,'damaged',202,9,NULL);`)
  })
  return h
}

const LOT_COLUMNS = 'merge_deactivated_at IS NOT NULL AS merge_marked,id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,payment_status,credit_due_date,received_quantity,received_cost_usd,received_branch_id'
function lots(h) { return plain(h.raw.prepare(`SELECT ${LOT_COLUMNS} FROM product_batches ORDER BY id`).all()) }
function lot(h, id) { return lots(h).find((row) => row.id === id) }
function lotStock(h) {
  const out = {}
  for (const row of h.raw.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE quantity<>0 ORDER BY batch_id,branch_id').all()) (out[row.batch_id] ??= {})[row.branch_id] = row.quantity
  return out
}
function branchStock(h, product) {
  const out = {}
  for (const row of h.raw.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=? ORDER BY branch_id').all([product])) out[row.branch_id] = row.quantity
  return out
}
// Everything undo must put back, ids of rows that undo recreates left out.
function state(h) {
  const q = (sql) => plain(h.raw.prepare(sql).all())
  return JSON.stringify({
    lots: lots(h),
    lotStock: lotStock(h),
    branchStock: q('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id'),
    products: q('SELECT id,is_active,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,wholesale_price_usd FROM products ORDER BY id'),
    saleAllocations: q('SELECT id,sale_item_id,batch_id,branch_id,quantity,released_quantity FROM sale_item_batch_allocations ORDER BY id'),
    returnAllocations: q('SELECT id,return_item_id,sale_item_id,batch_id,branch_id,quantity FROM return_item_batch_allocations ORDER BY id'),
    saleItems: q('SELECT id,product_id,batch_id FROM sale_items ORDER BY id'),
    returnItems: q('SELECT id,product_id,batch_id FROM return_items ORDER BY id'),
  })
}
const merge = (h) => h.request('POST', '/possible-duplicates/merge', { keepId: K, mergeId: D, stock: 'merge' })

async function historyAction(h, direction) {
  const history = h.raw.prepare("SELECT id,scope FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge' ORDER BY id DESC LIMIT 1").get()
  assert.ok(history, 'the merge recorded an undoable action')
  const app = h.load('routes/actionHistory.ts').default
  const env = { DB: h.raw }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const listed = await app.request(`http://local/?scope=${encodeURIComponent(history.scope)}`, {}, env, ctx)
  assert.equal(listed.status, 200)
  const current = (await listed.json()).items.find((row) => row.id === history.id)
  assert.ok(current, 'the history row is visible')
  const pointer = current[`${direction}_payload`]
  const response = await app.request(`http://local/${history.id}/${direction}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ require_applied: true, expected_generation: pointer.generation }),
  }, env, ctx)
  return { status: response.status, json: await response.json().catch(() => null) }
}

async function main() {
  // ---- before figures (shared by the reader checks) ------------------------------------------------------------
  const probe = world()
  const stateBefore = state(probe)
  const supplierReport = async (h) => {
    const app = h.load('routes/contacts.ts').default
    const response = await app.request('http://local/suppliers/reports/stock-in-invoices?page_size=100', {}, { DB: h.raw }, { waitUntil() {}, passThroughOnException() {} })
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  const purchases = async (h, supplier) => {
    const app = h.load('routes/contacts.ts').default
    const response = await app.request(`http://local/suppliers/${supplier}/purchases?page_size=100`, {}, { DB: h.raw }, { waitUntil() {}, passThroughOnException() {} })
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  const invoicesBefore = await supplierReport(probe)
  const purchasesBefore = { 1: await purchases(probe, 1), 2: await purchases(probe, 2) }
  const breakdownBefore = async (h, id) => {
    const app = h.load('routes/productCost.ts').default
    const response = await app.request(`http://local/${id}/cost-breakdown`, {}, { DB: h.raw }, { waitUntil() {}, passThroughOnException() {} })
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  const creditRows = (h) => plain(h.raw.prepare(`SELECT id FROM product_batches pb WHERE pb.is_active=1 AND pb.payment_status='credit'
    AND (pb.received_quantity IS NULL OR pb.received_quantity>0 OR COALESCE(pb.received_cost_usd,0)>0) AND pb.credit_due_date IS NOT NULL ORDER BY id`).all()).map((row) => row.id)

  const h = world()
  const result = await merge(h)
  const after = state(h)
  const lotsAfter = lots(h)
  const byId = (id) => lotsAfter.find((row) => row.id === id)

  await check('the merge succeeds and the discarded product is deactivated', () => {
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(h.raw.prepare('SELECT is_active FROM products WHERE id=?').get([D]).is_active, 0)
    assert.equal(h.raw.prepare('SELECT is_active FROM products WHERE id=?').get([K]).is_active, 1)
  })

  await check('same date, different cost and expiry: stock is ADDED into the kept lot, per branch, with the distinct non-zero mean and the earliest expiry', () => {
    // K1 + D1 + D7: br1 5+3, br2 2+1, br3 0+2+1.
    assert.deepEqual(lotStock(h)[101], { 1: 8, 2: 3, 3: 3 })
    assert.equal(byId(101).unit_cost_usd, 2.2, 'mean of the distinct costs {2.00, 2.40}; D7 repeats 2.40 and a per-lot mean would give 2.2667')
    assert.equal(byId(101).expiry_date, '2027-01-31', 'the earliest of 2027-01-31, 2027-03-31, 2027-12-31')
    assert.equal(byId(101).variant_product_id, K)
  })

  await check('same date, equal cost: the cost stands, and an earlier expiry wins', () => {
    assert.deepEqual(lotStock(h)[104], { 1: 1, 2: 3 })
    assert.equal(byId(104).unit_cost_usd, 5)
    assert.equal(byId(104).expiry_date, '2027-02-28', 'D3 expires earlier than K4 (2027-06-30)')
  })

  await check('the kept product has two lots on the day: the LOWER batch_number takes it, the other is untouched', () => {
    assert.deepEqual(lotStock(h)[102], { 1: 4, 2: 4 })
    assert.deepEqual(lotStock(h)[103], { 1: 6 })
    assert.equal(byId(102).unit_cost_usd, 3)
    assert.equal(byId(103).unit_cost_usd, 3.5)
    assert.equal(byId(102).expiry_date, '2027-04-30')
  })

  await check('the business day decides: a 23:30 UTC receipt meets the 4 Nov kept lot, not the 3 Nov one; its $0 is not averaged in', () => {
    assert.deepEqual(lotStock(h)[105], { 1: 3, 3: 1 }, 'D6 (1 at br1) is in K5')
    assert.equal(byId(105).unit_cost_usd, 4, 'a zero cost is excluded from the mean')
    assert.equal(byId(105).expiry_date, '2027-05-31', 'K5 had no expiry and takes the one the added lot has')
    assert.equal(lotStock(h)[101][1], 8, 'K1 did not also take D6')
  })

  await check('supplier, lot code, payment status and credit due date of a kept lot stay its own', () => {
    for (const [id, expected] of [[101, ['K-LOT-1', 1, 'paid', null]], [102, ['K-LOT-2', 1, 'paid', null]], [103, ['K-LOT-3', 1, 'credit', '2026-12-10']],
      [104, ['K-LOT-4', 1, 'paid', null]], [105, ['K-LOT-5', 1, 'paid', null]]]) {
      assert.deepEqual([byId(id).lot_code, byId(id).supplier_id, byId(id).payment_status, byId(id).credit_due_date], expected, `lot ${id}`)
    }
    for (const id of [101, 102, 103, 104, 105]) assert.deepEqual([byId(id).received_quantity, byId(id).received_cost_usd], [{ 101: 7, 102: 4, 103: 6, 104: 3, 105: 3 }[id], { 101: 14, 102: 12, 103: 21, 104: 15, 105: 12 }[id]], `received figures of ${id} are not summed`)
  })

  await check('a date only on the duplicate, and no date at all, are CREATED as lots of the keeper (next batch numbers, own cost)', () => {
    assert.equal(byId(204).variant_product_id, K)
    assert.equal(byId(205).variant_product_id, K)
    assert.deepEqual([byId(204).batch_number, byId(205).batch_number], [6, 7])
    assert.deepEqual([byId(204).unit_cost_usd, byId(205).unit_cost_usd], [6, 0])
    assert.deepEqual([byId(204).is_active, byId(205).is_active], [1, 1])
    assert.deepEqual(lotStock(h)[204], { 1: 2, 2: 2 })
    assert.deepEqual(lotStock(h)[205], { 3: 3 })
    assert.equal(byId(205).received_at, null, 'a lot with no date stays without one')
  })

  await check('a created lot whose batch_key the keeper already owns takes a key of its own and keeps its lot code', () => {
    assert.equal(byId(205).batch_key, ' merged-from-lot:205')
    assert.equal(byId(205).lot_code, 'D-LOT-5')
    assert.equal(byId(101).batch_key, 'K-KEY-1')
    assert.equal(new Set(lotsAfter.filter((row) => row.variant_product_id === K).map((row) => row.batch_key)).size, 7)
  })

  await check('every source lot is KEPT as an inactive record, empty, still its own supplier and money', () => {
    for (const [id, expected] of [[201, ['D-LOT-1', 2, 'credit', '2026-12-03', 5, 12]], [207, ['D-LOT-7', 2, 'paid', null, 2, 4.8]], [202, ['D-LOT-2', 2, 'paid', null, 4, 12]],
      [203, ['D-LOT-3', 2, 'credit', '2026-12-12', 1, 5]], [206, ['D-LOT-6', 2, 'paid', null, 1, 0]]]) {
      const row = byId(id)
      assert.equal(row.is_active, 0, `lot ${id} inactive`)
      assert.equal(row.variant_product_id, D, `lot ${id} stays on the discarded product`)
      assert.deepEqual([row.lot_code, row.supplier_id, row.payment_status, row.credit_due_date, row.received_quantity, row.received_cost_usd], expected, `lot ${id}`)
      assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM branch_batch_stock WHERE batch_id=? AND quantity<>0').get([id]).n, 0, `lot ${id} holds nothing`)
    }
    assert.equal(lotsAfter.length, 12, 'no lot row was deleted')
  })

  await check('branch_stock and products.stock_quantity: exact per-branch totals on the keeper, none on the twin', () => {
    assert.deepEqual(branchStock(h, K), { 1: 25, 2: 13, 3: 7 })
    assert.deepEqual(branchStock(h, D), {})
    assert.equal(h.raw.prepare('SELECT stock_quantity FROM products WHERE id=?').get([K]).stock_quantity, 45)
    assert.equal(h.raw.prepare('SELECT stock_quantity FROM products WHERE id=?').get([D]).stock_quantity, 0)
    // The two ledgers still reconcile: lots never exceed the branch shelf, the gap is the untracked units.
    const perBranch = {}
    for (const [lotId, branches] of Object.entries(lotStock(h))) for (const [b, q] of Object.entries(branches)) {
      if (byId(Number(lotId)).variant_product_id === K) perBranch[b] = (perBranch[b] || 0) + q
    }
    assert.deepEqual(perBranch, { 1: 24, 2: 12, 3: 7 })
  })

  await check('sale and return allocations follow the lot the stock went into', () => {
    assert.deepEqual(plain(h.raw.prepare('SELECT id,batch_id FROM sale_item_batch_allocations ORDER BY id').all()),
      [{ id: 1, batch_id: 101 }, { id: 2, batch_id: 102 }, { id: 3, batch_id: 105 }])
    assert.deepEqual(plain(h.raw.prepare('SELECT id,batch_id FROM return_item_batch_allocations ORDER BY id').all()), [{ id: 1, batch_id: 101 }])
    assert.deepEqual(plain(h.raw.prepare('SELECT id,product_id FROM sale_items ORDER BY id').all()), [{ id: 600, product_id: K }, { id: 601, product_id: K }])
  })

  await check('a RETURN after the merge of a pre-merge sale restocks the kept lot the allocation now points to', async () => {
    const r = world()
    assert.equal((await merge(r)).status, 200)
    const { planReturnLot } = r.load('lib/returnsStock.ts')
    const allocations = plain(r.raw.prepare(`SELECT batch_id, quantity-released_quantity AS outstanding FROM sale_item_batch_allocations WHERE sale_item_id=600 ORDER BY id`).all())
    const plan = planReturnLot({ allocations, saleLineBatchId: null, operatorBatchId: null, quantity: 2, lotTracked: true })
    assert.deepEqual(plan.splits, [{ batchId: 102, quantity: 1 }, { batchId: 101, quantity: 1 }], 'last drawn first, into the KEPT lots')
    const before = lotStock(r)
    fixtureWrite(r, () => {
      for (const split of plan.splits) {
        const branch = r.raw.prepare('SELECT branch_id FROM sale_item_batch_allocations WHERE sale_item_id=600 AND batch_id=?').get([split.batchId]).branch_id
        r.raw.db.prepare('UPDATE branch_batch_stock SET quantity=quantity+? WHERE batch_id=? AND branch_id=?').run(split.quantity, split.batchId, branch)
        r.raw.db.prepare('UPDATE branch_stock SET quantity=quantity+? WHERE product_id=? AND branch_id=?').run(split.quantity, K, branch)
      }
      r.raw.db.prepare('UPDATE products SET stock_quantity=(SELECT SUM(quantity) FROM branch_stock WHERE product_id=?) WHERE id=?').run(K, K)
    })
    const now = lotStock(r)
    assert.equal(now[101][1], before[101][1] + 1)
    assert.equal(now[102][2], before[102][2] + 1)
    assert.equal(r.raw.prepare('SELECT COUNT(*) n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.is_active=0 AND bbs.quantity<>0').get().n, 0,
      'nothing was restocked onto an inactive source lot')
    assert.deepEqual(branchStock(r, K), { 1: 25 + 1, 2: 13 + 1, 3: 7 }, 'the shelf totals move by exactly what the lots took')
  })

  await check('the product cost follows the lots through the existing quantity-weighted rule (no second formula)', () => {
    const rows = lotsAfter.filter((row) => row.variant_product_id === K && row.is_active === 1 && row.unit_cost_usd > 0)
    const stock = lotStock(h)
    let numerator = 0
    let weight = 0
    for (const row of rows) {
      const quantity = Object.values(stock[row.id] || {}).reduce((sum, value) => sum + value, 0)
      numerator += quantity * row.unit_cost_usd
      weight += quantity
    }
    const expected = Math.round(numerator / weight * 10000) / 10000
    assert.equal(h.raw.prepare('SELECT cost_price_usd FROM products WHERE id=?').get([K]).cost_price_usd, expected)
    assert.equal(h.raw.prepare('SELECT purchase_price_usd FROM products WHERE id=?').get([K]).purchase_price_usd, expected, 'the twin column moves with it')
    assert.notEqual(expected, 3.95, 'not the mean of distinct lot costs: the Sep 25 ruling superseded it')
  })

  await check('the audit entry says which lots were added to and which were created', () => {
    const rows = plain(h.raw.prepare("SELECT action,details FROM audit_logs WHERE entity='product' OR action LIKE 'merge%' ORDER BY id").all())
    const parsed = rows.map((row) => { try { return JSON.parse(row.details) } catch { return null } }).filter(Boolean)
    const detail = parsed.find((entry) => Array.isArray(entry.lotsAddedTo))
    assert.ok(detail, `the merge audit entry carries lotsAddedTo: ${rows.map((row) => String(row.details).slice(0, 120)).join(' | ')}`)
    assert.deepEqual(detail.lotsAddedTo.map((row) => row.lotId), [101, 102, 104, 105])
    assert.deepEqual(detail.lotsAddedTo.find((row) => row.lotId === 101), {
      lotId: 101, receivedDate: '2026-11-03', addedFromLotIds: [201, 207], cost: { from: 2, to: 2.2 },
    })
    assert.deepEqual(detail.lotsCreated.map((row) => [row.lotId, row.batchNumber, row.receivedDate]), [[204, 6, '2026-11-20'], [205, 7, null]])
  })

  await check('supplier invoices, supplier purchases and credit: same lines, same money before and after (no line lost, none doubled)', async () => {
    const invoicesAfter = await supplierReport(h)
    assert.equal(invoicesBefore.status, 200, JSON.stringify(invoicesBefore.json))
    assert.equal(invoicesAfter.status, 200)
    assert.deepEqual(invoicesAfter.json, invoicesBefore.json)
    for (const supplier of [1, 2]) {
      const now = await purchases(h, supplier)
      assert.equal(purchasesBefore[supplier].status, 200, JSON.stringify(purchasesBefore[supplier].json))
      const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'remaining_quantity' || key === 'product_name' || key === 'products' ? undefined : v)))
      assert.deepEqual(strip(now.json.totals), strip(purchasesBefore[supplier].json.totals), `supplier ${supplier} totals (payables included) unchanged`)
      // The one figure that moves: "products" counts DISTINCT product rows a supplier's lots hang off. Supplier 2 sold the
      // twin; two of its lots were created on the keeper and five stay on the twin as inactive records, so it reads 2.
      assert.equal(purchasesBefore[supplier].json.totals.products, 1)
      assert.equal(now.json.totals.products, supplier === 2 ? 2 : 1)
      assert.equal(now.json.batches?.length ?? now.json.purchases?.length ?? 0, purchasesBefore[supplier].json.batches?.length ?? purchasesBefore[supplier].json.purchases?.length ?? 0)
    }
  })

  const removalLoss = (world) => {
    const rl = world.load('lib/removalLosses.ts')
    const rows = plain(world.raw.prepare(`SELECT ${rl.REMOVAL_LOSS_SELECT} ${rl.REMOVAL_LOSS_FROM} WHERE m.movement_type='write_off' ORDER BY m.id`).all())
    return rows.map((row) => rl.removalRowLossUsd(row))
  }
  await check('removal loss: priced from its own snapshot, or from a source lot that keeps its cost, it does not move; priced from a kept lot whose cost was re-derived, it moves with it (pinned)', () => {
    // 801 drew from source lot D1 (no snapshot): the inactive source lot keeps $2.40. 802 drew from kept lot K1 (no snapshot):
    // K1 was $2.00 and is now the $2.20 mean. 803 carries its own $9 snapshot.
    assert.deepEqual(removalLoss(probe), [2.4, 2, 9])
    assert.deepEqual(removalLoss(h), [2.4, 2.2, 9])
  })

  await check('cost-breakdown lists every lot of the keeper, the emptied source lots as inactive, and agrees with the stored cost', async () => {
    const response = await breakdownBefore(h, K)
    assert.equal(response.status, 200, JSON.stringify(response.json))
    const lotRows = response.json.inputs.filter((row) => row.source === 'lot')
    assert.equal(lotRows.length, 7, 'the seven lots the keeper now owns; the five emptied source lots stay with the twin')
    assert.equal(response.json.result_usd, h.raw.prepare('SELECT cost_price_usd FROM products WHERE id=?').get([K]).cost_price_usd)
    const folded = lotRows.find((row) => row.cost_usd === 2.2)
    assert.ok(folded && folded.excluded === null && folded.remaining_quantity === 14, 'the folded lot counts, with its summed on-hand quantity')
    // The route answers only for an ACTIVE product; the twin's own breakdown is read through the same function the route calls.
    const twin = await h.load('lib/catalogCostRecompute.ts').getCatalogCostBreakdown(h.db, D)
    const twinLots = twin.inputs.filter((row) => row.source === 'lot')
    assert.equal(twinLots.length, 5)
    assert.ok(twinLots.every((row) => row.excluded === 'inactive'), 'the source lots are shown, as inactive')
  })

  await check('FINDING pinned: the supplier credit reminder lists only ACTIVE lots, so an emptied source lot that was on credit leaves it', () => {
    // Before: 103 (K, credit, due 10 Dec), 201 (D, credit) and 203 (D, credit) are active credit lots.
    assert.deepEqual(creditRows(probe), [103, 201, 203])
    // After: 201 and 203 were added into paid kept lots and are inactive, so their credit is no longer reminded.
    assert.deepEqual(creditRows(h), [103])
  })

  await check('UNDO restores the exact prior state: lots (cost, expiry, activity, key, number), stock, allocations, products', async () => {
    const undone = await historyAction(h, 'undo')
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.equal(state(h), stateBefore)
    assert.equal(lot(h, 101).unit_cost_usd, 2)
    assert.equal(lot(h, 101).expiry_date, '2027-01-31')
    assert.equal(lot(h, 104).expiry_date, '2027-06-30')
    assert.equal(lot(h, 105).expiry_date, null)
    assert.equal(lot(h, 205).batch_key, 'K-KEY-1', 'the created lot gets its original key back')
    assert.equal(lot(h, 205).variant_product_id, D)
  })

  await check('UNDO twice changes nothing more', async () => {
    const again = await historyAction(h, 'undo')
    assert.notEqual(again.status, 200)
    assert.equal(state(h), stateBefore)
  })

  await check('REDO repeats the merge exactly', async () => {
    const redone = await historyAction(h, 'redo')
    assert.equal(redone.status, 200, JSON.stringify(redone.json))
    assert.equal(state(h), after)
  })

  await check('APPLYING THE SAME MERGE AGAIN adds nothing (the twin is already merged away)', async () => {
    const again = await merge(h)
    assert.notEqual(again.status, 200, JSON.stringify(again))
    assert.equal(state(h), after)
  })

  await check('a second undo of the redo also restores the exact prior state', async () => {
    const undone = await historyAction(h, 'undo')
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.equal(state(h), stateBefore)
  })

  // ---- undo of a create alone and of a same-date add alone -------------------------------------------------------
  for (const [name, keep, extra] of [
    ['same-date add only', [201]],
    ['create only', [204]],
    // Lead ruling 16 Nov 2026 (M1): an archived kept lot on the same day is NOT a match target and is never reactivated; the source lot is created.
    ['same date as an archived kept lot (not a target: the source lot is created)', [204], (w) => {
      w.raw.db.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,received_quantity)
        VALUES(106,${K},'K-KEY-6',6,'K-LOT-6','2026-11-20','2027-08-31',6,0,1,'Sup K',0);
        UPDATE product_batches SET expiry_date='2027-02-28' WHERE id=204;`)
    }],
  ]) {
    await check(`undo round trip, ${name}`, async () => {
      const w = world()
      fixtureWrite(w, () => {
        const drop = [201, 207, 202, 203, 206, 204, 205].filter((id) => !keep.includes(id))
        for (const id of drop) {
          w.raw.db.prepare('DELETE FROM branch_batch_stock WHERE batch_id=?').run(id)
          w.raw.db.prepare('DELETE FROM sale_item_batch_allocations WHERE batch_id=?').run(id)
          w.raw.db.prepare('DELETE FROM return_item_batch_allocations WHERE batch_id=?').run(id)
          w.raw.db.prepare('DELETE FROM product_batches WHERE id=?').run(id)
        }
        w.raw.db.prepare('DELETE FROM branch_stock WHERE product_id=?').run(D)
        const rows = w.raw.prepare('SELECT bbs.branch_id,SUM(bbs.quantity) q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=? GROUP BY bbs.branch_id').all([D])
        for (const row of rows) w.raw.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(D, row.branch_id, row.q)
        w.raw.db.prepare('UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=?) WHERE id=?').run(D, D)
        if (extra) extra(w)
      })
      const prior = state(w)
      assert.equal((await merge(w)).status, 200)
      assert.notEqual(state(w), prior)
      if (extra) {
        assert.equal(lot(w, 106).is_active, 0, 'the archived kept lot is never reactivated')
        assert.equal(lot(w, 106).expiry_date, '2027-08-31', 'and takes no expiry')
        assert.deepEqual(lotStock(w)[106] || {}, {}, 'and no stock')
        assert.deepEqual([lot(w, 204).variant_product_id, lot(w, 204).is_active, lot(w, 204).merge_marked], [K, 1, 0], 'the source lot is created active on the keeper, unmarked')
        assert.deepEqual(lotStock(w)[204], { 1: 2, 2: 2 }, 'with its own stock')
      }
      assert.equal((await historyAction(w, 'undo')).status, 200)
      assert.equal(state(w), prior)
    })
  }

  // ---- supplier payables: a credit owed on a lot the merge deactivated still reminds, once --------------------------------
  // Lots 103 (kept, credit), 201 and 203 (discarded, credit; both fold into kept lots) are the three open credits.
  const reminderIds = async (w, days) => {
    const app = w.load('routes/notifications.ts').default
    const response = await app.request('http://local/summary', {}, { DB: w.raw }, { waitUntil() {}, passThroughOnException() {} })
    assert.equal(response.status, 200)
    const json = await response.json()
    const section = json.sections.find((row) => row.id === 'supplier_credit')
    return section ? { count: section.count, ids: section.items.map((item) => Number(String(item.id).replace('supplier-credit-', ''))).sort((a, b) => a - b) } : { count: 0, ids: [] }
  }
  const creditWorld = () => {
    const w = world()
    fixtureWrite(w, () => w.raw.db.exec("UPDATE product_batches SET credit_due_date=date('now','+3 day') WHERE payment_status='credit'"))
    return w
  }
  await check('payables: the merge marks exactly the lots it deactivated (folded and written-off), never a created lot, and undo clears it', async () => {
    const w = creditWorld()
    assert.equal((await merge(w)).status, 200)
    const marked = lots(w).filter((row) => row.merge_marked === 1).map((row) => row.id)
    const inactive = lots(w).filter((row) => row.is_active === 0).map((row) => row.id)
    assert.deepEqual(marked, inactive, 'every merge-deactivated lot is marked and no other lot is')
    assert.ok(marked.includes(201) && marked.includes(203), 'the discarded credit lots are marked')
    assert.ok(!marked.includes(204) && !marked.includes(205), 'a created lot stays an active lot of the keeper, unmarked')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.deepEqual(lots(w).filter((row) => row.merge_marked === 1), [], 'undo clears every marker')
  })
  await check('payables: the credit reminder counts a credit on a merged-away lot, once, beside the kept lot (and undo does not double it)', async () => {
    const w = creditWorld()
    assert.deepEqual(await reminderIds(w), { count: 3, ids: [103, 201, 203] }, 'before the merge')
    assert.equal((await merge(w)).status, 200)
    assert.equal(lot(w, 201).is_active, 0)
    assert.equal(lot(w, 203).is_active, 0)
    assert.deepEqual(await reminderIds(w), { count: 3, ids: [103, 201, 203] }, 'after the merge: the same three credits, each once, none lost')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.deepEqual(await reminderIds(w), { count: 3, ids: [103, 201, 203] }, 'after undo')
  })
  await check('payables: a lot deactivated by something other than a merge keeps its own intent (control: not reminded)', async () => {
    const w = creditWorld()
    assert.equal((await merge(w)).status, 200)
    fixtureWrite(w, () => w.raw.db.exec('DELETE FROM branch_batch_stock WHERE batch_id=103; UPDATE product_batches SET is_active=0 WHERE id=103'))
    assert.deepEqual(await reminderIds(w), { count: 2, ids: [201, 203] }, 'a manually deactivated kept lot drops out; the merge-deactivated ones stay')
  })

  // ---- owner rules 5 and 6 Oct: cost = quantity-weighted average (a $0 or unknown cost not weighted), 4 places --------------
  await check('the kept lot cost is the quantity-weighted average at 4 places, and undo restores the exact previous cost', async () => {
    const w = world()
    // Kept lot 101 holds 7 at an exact 5-place $2.33333; discarded 201 holds 5 at $3.00 and 207 holds 2 at $2.40, all 3 Nov:
    // (7 x 2.33333 + 5 x 3 + 2 x 2.4) / 14 = 36.13331 / 14 = 2.58095... -> 2.581 (4 places: 2.5810). A plain mean of the three
    // costs is 2.5778; only the stock weights give 2.581.
    fixtureWrite(w, () => w.raw.db.exec('UPDATE product_batches SET unit_cost_usd=2.33333 WHERE id=101; UPDATE product_batches SET unit_cost_usd=3 WHERE id=201'))
    const prior = state(w)
    assert.equal((await merge(w)).status, 200)
    const stored = lot(w, 101).unit_cost_usd
    assert.equal(stored, 2.581, 'weighted by the stock combined, stored at 4 places (2.58095... is never stored raw)')
    assert.equal(stored, Math.round(stored * 10000) / 10000)
    const snap = JSON.parse(w.raw.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC LIMIT 1").get().payload_json)
    assert.equal(snap.foldedBatches.find((fb) => fb.keeperBatchId === 101).keeperLotBefore.unit_cost_usd, 2.33333, 'the snapshot keeps the exact previous value')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.equal(lot(w, 101).unit_cost_usd, 2.33333, 'undo restores the exact previous cost')
    assert.equal(state(w), prior)
  })

  await check('a $0 lot is not weighted: the kept lot takes the real cost; and two $0 lots leave the kept lot at $0', async () => {
    const w = world()
    // Lot 105 (kept, $4.00, 3 units) meets 206 (discarded, $0, 1 unit): the real cost stands, not (3 x 4 + 1 x 0) / 4 = 3.
    assert.equal((await merge(w)).status, 200)
    assert.equal(lot(w, 105).unit_cost_usd, 4)
    // Kept $0 meets a real cost: the real cost wins.
    const v = world()
    fixtureWrite(v, () => v.raw.db.exec('UPDATE product_batches SET unit_cost_usd=0 WHERE id=105; UPDATE product_batches SET unit_cost_usd=6.5 WHERE id=206'))
    assert.equal((await merge(v)).status, 200)
    assert.equal(lot(v, 105).unit_cost_usd, 6.5, 'a $0 kept lot takes the real cost of the lot added to it')
    // Both $0: stays $0.
    const z = world()
    fixtureWrite(z, () => z.raw.db.exec('UPDATE product_batches SET unit_cost_usd=0 WHERE id=105'))
    assert.equal((await merge(z)).status, 200)
    assert.equal(lot(z, 105).unit_cost_usd, 0, 'both $0 stays $0')
  })

  // ---- lead ruling 16 Nov: the kept lot NEVER takes a duplicate's supplier; the payable stays on the source lot -------------
  // Payables are counted per receipt. Kept lot 105 has no supplier (paid, received 3 for $12). The lot added to it, 206, is on credit
  // from supplier 2 (received 1 for $6, due in 3 days). Supplier 2's payable is exactly 206's $6, counted once, and 105's own
  // $12 receipt is never attributed to supplier 2.
  const supplierWorld = () => {
    const w = world()
    fixtureWrite(w, () => w.raw.db.exec(`UPDATE product_batches SET supplier_id=NULL, supplier_name=NULL, payment_status='paid', credit_due_date=NULL WHERE id=105;
      UPDATE product_batches SET payment_status='credit', received_quantity=1, received_cost_usd=6 WHERE id=206;
      UPDATE product_batches SET credit_due_date=date('now','+3 day') WHERE payment_status='credit'`))
    return w
  }
  const ownFields = (row) => ({ supplier_id: row.supplier_id, supplier_name: row.supplier_name, payment_status: row.payment_status, credit_due_date: row.credit_due_date })
  const supplierFigures = async (w) => {
    const invoices = await supplierReport(w)
    assert.equal(invoices.status, 200, JSON.stringify(invoices.json))
    const bought = await purchases(w, 2)
    assert.equal(bought.status, 200, JSON.stringify(bought.json))
    return { invoices: invoices.json, totals: bought.json.totals }
  }
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'remaining_quantity' || key === 'product_name' || key === 'products' ? undefined : v)))
  await check('supplier: the kept lot keeps its own supplier, payment status and due date (empty stays empty); the duplicate keeps its own on the inactive source lot', async () => {
    const w = supplierWorld()
    const keptBefore = ownFields(lot(w, 105))
    const sourceBefore = ownFields(lot(w, 206))
    assert.deepEqual(keptBefore, { supplier_id: null, supplier_name: null, payment_status: 'paid', credit_due_date: null })
    assert.equal(sourceBefore.supplier_id, 2)
    assert.equal((await merge(w)).status, 200)
    assert.deepEqual(ownFields(lot(w, 105)), keptBefore, 'kept lot still has no supplier and is still paid')
    assert.equal(lot(w, 105).received_cost_usd, 12, 'its own receipt is untouched')
    assert.deepEqual(ownFields(lot(w, 206)), sourceBefore, 'the source lot keeps supplier 2 and its credit')
    assert.equal(lot(w, 206).is_active, 0)
    assert.equal(lot(w, 206).merge_marked, 1)
    // 101 already had supplier 1 and 201 (supplier 2, credit) folded into it: 101 keeps supplier 1, paid.
    assert.equal(lot(w, 101).supplier_id, 1)
    assert.equal(lot(w, 101).payment_status, 'paid')
  })
  await check('supplier: payables total, stock-in invoice report and credit reminder count the duplicate receipt exactly once, and the kept lot stays unattributed', async () => {
    const w = supplierWorld()
    const prior = state(w)
    const before = await supplierFigures(w)
    // Supplier 2's open credit: lots 201 ($12), 203 ($5) and 206 ($6). Lot 105 ($12, no supplier) is not among them.
    assert.equal(before.totals.credit_open_usd, 23)
    assert.equal(before.totals.credit_batches, 3)
    assert.deepEqual(await reminderIds(w), { count: 4, ids: [103, 201, 203, 206] })
    assert.equal((await merge(w)).status, 200)
    const after = await supplierFigures(w)
    assert.equal(after.totals.credit_open_usd, 23, 'payables total: 206 counted once, 105 never added')
    assert.equal(after.totals.credit_batches, 3)
    assert.deepEqual(strip(after.totals), strip(before.totals), 'every supplier 2 total is unchanged by the merge')
    assert.deepEqual(after.invoices, before.invoices, 'the stock-in invoice report is unchanged: the kept lot is not a supplier 2 line')
    const attributed = plain(w.raw.prepare("SELECT id FROM product_batches WHERE supplier_id = 2 AND payment_status = 'credit' ORDER BY id").all()).map((row) => row.id)
    assert.deepEqual(attributed, [201, 203, 206], 'the credit lots of supplier 2 are the three source records; 105 is not one')
    assert.deepEqual(await reminderIds(w), { count: 4, ids: [103, 201, 203, 206] }, 'the reminder counts 206 once through its marker; 105 never reminds')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.equal(lot(w, 206).merge_marked, 0, 'undo clears the marker')
    assert.deepEqual(ownFields(lot(w, 105)), { supplier_id: null, supplier_name: null, payment_status: 'paid', credit_due_date: null })
    assert.deepEqual(await reminderIds(w), { count: 4, ids: [103, 201, 203, 206] }, 'after undo')
    assert.equal(state(w), prior, 'undo restores the exact prior state')
    assert.deepEqual(await supplierFigures(w), before)
  })
  await check('supplier: merging the same world twice (double apply) never moves a payable onto the kept lot', async () => {
    const w = supplierWorld()
    assert.equal((await merge(w)).status, 200)
    const once = state(w)
    const again = await merge(w)
    assert.notEqual(again.status, 500, JSON.stringify(again.json))
    assert.deepEqual(ownFields(lot(w, 105)), { supplier_id: null, supplier_name: null, payment_status: 'paid', credit_due_date: null })
    assert.deepEqual(await reminderIds(w), { count: 4, ids: [103, 201, 203, 206] })
    if (again.status !== 200) assert.equal(state(w), once, 'a refused second apply writes nothing')
  })

  // ---- a later edit of a lot the merge rewrote must not be overwritten by undo's before-image ---------------------------
  await check('undo is REFUSED once the kept lot cost or expiry was edited after the merge, and nothing changes', async () => {
    for (const [column, value] of [['expiry_date', '2027-01-01'], ['unit_cost_usd', 2.5]]) {
      const w = world()
      assert.equal((await merge(w)).status, 200)
      fixtureWrite(w, () => w.raw.db.prepare(`UPDATE product_batches SET ${column}=?, updated_at=CURRENT_TIMESTAMP WHERE id=101`).run(value))
      const edited = state(w)
      const undone = await historyAction(w, 'undo')
      assert.equal(undone.status, 409, `${column}: ${JSON.stringify(undone.json)}`)
      assert.equal(state(w), edited, `${column}: the edit and the merge both stand`)
    }
  })

  // ---- a snapshot written BEFORE this change has no keeperLotBefore: undo must not zero the kept lot's columns -----
  await check('undo of a snapshot written before keeperLotBefore existed leaves the kept lot columns alone (tolerant restore)', async () => {
    const w = world()
    assert.equal((await merge(w)).status, 200)
    const snap = w.raw.prepare("SELECT id,payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC LIMIT 1").get()
    const payload = JSON.parse(snap.payload_json)
    for (const folded of payload.foldedBatches) { delete folded.keeperLotBefore; delete folded.receivedDate }
    w.raw.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(payload), snap.id)
    const undone = await historyAction(w, 'undo')
    // The restore either refuses (its safety fingerprint no longer matches the edited record) or runs without the new
    // fields; it must never null the cost and expiry of a kept lot.
    for (const id of [101, 104, 105]) assert.notEqual(lot(w, id).unit_cost_usd, null, `lot ${id} cost survives (undo status ${undone.status})`)
  })

  // ---- lead rulings 16 Nov 2026: M2 (an already-inactive lot is left as it was), M3 (one new lot per date), B3 (undo order) ---------------
  await check('M2: an already-inactive credit lot on the discarded product is not folded, not marked, not reminded, and undo leaves it exactly as it was', async () => {
    const w = creditWorld()
    // Lot 208: manually deactivated, on credit from supplier 2, received the day lot 102 of the keeper arrived (2026-11-10), no stock.
    fixtureWrite(w, () => w.raw.db.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,credit_due_date,received_quantity,received_cost_usd,unit_cost_usd)
      VALUES(208,${D},'D-KEY-8',8,'D-LOT-8','2026-11-10',0,2,'Sup D','credit',date('now','+3 day'),2,8,4)`))
    const reminders = await reminderIds(w)
    assert.ok(!reminders.ids.includes(208), 'an unmarked inactive lot does not remind')
    const prior = state(w)
    assert.equal((await merge(w)).status, 200)
    assert.deepEqual({ ...lot(w, 208), }, { ...lots(w).find((row) => row.id === 208) })
    assert.deepEqual([lot(w, 208).is_active, lot(w, 208).merge_marked, lot(w, 208).variant_product_id], [0, 0, D], 'not folded, not marked, still on the discarded product')
    assert.ok(!(await reminderIds(w)).ids.includes(208), 'still not reminded after the merge')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.equal(state(w), prior, 'undo restores the exact prior state; the lot is still inactive')
  })
  await check('M3: two discarded lots on a date the kept product lacks end as ONE new lot (weighted cost, earliest expiry), and undo is exact', async () => {
    const w = world()
    fixtureWrite(w, () => {
      w.raw.db.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,payment_status,received_quantity,received_cost_usd)
        VALUES(209,${D},'D-KEY-9',8,'D-LOT-9','2026-11-20','2027-05-01',3,1,2,'Sup D','paid',3,9);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(209,1,3);
        UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=${D} AND branch_id=1;
        UPDATE products SET stock_quantity=stock_quantity+3 WHERE id=${D};`)
    })
    const prior = state(w)
    assert.equal((await merge(w)).status, 200)
    const onDate = lots(w).filter((row) => row.variant_product_id === K && row.is_active === 1 && String(row.received_at).startsWith('2026-11-20'))
    assert.deepEqual(onDate.map((row) => row.id), [204], 'one active lot for 2026-11-20 on the keeper: the first (lowest batch_number) of the two')
    assert.equal(lot(w, 204).unit_cost_usd, 4.7143, '(4 x 6 + 3 x 3) / 7 = 4.7143')
    assert.equal(lot(w, 204).expiry_date, '2027-05-01', 'the earliest non-null expiry')
    assert.deepEqual(lotStock(w)[204], { 1: 5, 2: 2 })
    assert.deepEqual([lot(w, 209).is_active, lot(w, 209).merge_marked, lot(w, 209).variant_product_id], [0, 1, D], 'the second lot is folded into the first and kept as an inactive marked record')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.equal(state(w), prior, 'undo restores both lots exactly')
  })
  await check('B3: undo restores a kept lot that was archived before a fold only AFTER every folded lot has given its stock back (two lots into one)', async () => {
    const w = world()
    // Kept lot 107: empty, received 2026-11-25. Discarded lots 211 and 212 arrived the same day, each with stock: both fold into 107.
    fixtureWrite(w, () => w.raw.db.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,payment_status,received_quantity,received_cost_usd)
      VALUES(107,${K},'K-KEY-7',7,'K-LOT-7','2026-11-25',NULL,5,1,1,'Sup K','paid',0,0),
            (211,${D},'D-KEY-11',8,'D-LOT-11','2026-11-25','2027-03-01',2,1,2,'Sup D','paid',1,2),
            (212,${D},'D-KEY-12',9,'D-LOT-12','2026-11-25','2027-04-01',4,1,2,'Sup D','paid',2,8);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(211,1,1),(212,1,2);
      UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=${D} AND branch_id=1;
      UPDATE products SET stock_quantity=stock_quantity+3 WHERE id=${D};`))
    assert.equal((await merge(w)).status, 200)
    assert.deepEqual(lotStock(w)[107], { 1: 3 }, 'both discarded lots folded into kept lot 107')
    // A snapshot written before the M1 ruling could carry an ARCHIVED kept lot in keeperLotBefore (is_active 0, empty): replay one as an older
    // action recorded it. The restore used to run per folded lot, archiving the kept lot while the second lot's stock still sat on it.
    const snap = w.raw.prepare("SELECT id,payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC LIMIT 1").get()
    const payload = JSON.parse(snap.payload_json)
    const into107 = payload.foldedBatches.filter((fb) => fb.keeperBatchId === 107)
    assert.equal(into107.length, 2)
    for (const fb of into107) { fb.keeperLotBefore.is_active = 0; fb.keeperStockBefore = [] }
    w.raw.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(payload), snap.id)
    const undone = await historyAction(w, 'undo')
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.equal(lot(w, 107).is_active, 0, 'the kept lot is archived again once nothing sits on it')
    assert.deepEqual(lotStock(w)[107] || {}, {}, 'and nothing sits on it')
    for (const id of [211, 212]) assert.deepEqual([lot(w, id).is_active, lot(w, id).merge_marked, lot(w, id).variant_product_id], [1, 0, D], `discarded lot ${id} is back`)
  })
  await check('M10: two same-day kept lots: the LOWEST BATCH NUMBER takes the stock, not the lowest id', async () => {
    const w = world()
    // Kept lots 102 (batch 2) and 103 (batch 3) both arrived 2026-11-10. Swap their numbers: 103 is now first by number, 102 first by id.
    fixtureWrite(w, () => w.raw.db.exec('UPDATE product_batches SET batch_number=9 WHERE id=102; UPDATE product_batches SET batch_number=1 WHERE id=103'))
    assert.equal((await merge(w)).status, 200)
    assert.equal(lot(w, 202).is_active, 0)
    assert.deepEqual(lotStock(w)[103], { 1: 6, 2: 4 }, 'discarded lot 202 (2026-11-10, 4 at branch 2) was added into 103, the lowest batch number')
    assert.deepEqual(lotStock(w)[102], { 1: 4 }, 'and 102 (lowest id) is untouched')
  })
  await check('M17: a write-off merge marks exactly the lots it deactivated that were active, and undo clears it', async () => {
    const w = creditWorld()
    const prior = state(w)
    const res = await w.request('POST', '/possible-duplicates/merge', { keepId: K, mergeId: D, stock: 'write_off' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const writtenOff = lots(w).filter((row) => row.variant_product_id === D && row.is_active === 0)
    assert.ok(writtenOff.length >= 5, 'the discarded product lots are deactivated in place')
    assert.ok(writtenOff.every((row) => row.merge_marked === 1), 'each is marked as merge-deactivated (and so keeps reminding while a credit is owed)')
    assert.equal((await historyAction(w, 'undo')).status, 200)
    assert.deepEqual(lots(w).filter((row) => row.merge_marked === 1), [])
    assert.equal(state(w), prior)
  })

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
