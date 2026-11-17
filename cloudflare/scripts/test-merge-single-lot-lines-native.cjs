'use strict'
// Owner rules: batch identity (in same batch, out same batch, return same batch) and "no disabled stock" (7 Oct).
// A sale line drawn from ONE lot records that lot in sale_items.batch_id and writes no sale_item_batch_allocations row.
// When a product merge folds that lot into the kept product's same-day lot (or moves it), a later return of the line
// must restock the lot that now holds that stock: active, on the kept product, exact per-branch / branch_stock /
// products.stock_quantity figures. Real products route (merge) and real returns route over one migrated SQLite world.
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
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
const ctx = { waitUntil() {}, passThroughOnException() {} }

// World. Products 1 (keeper K), 2 (twin D), 3 (a third twin M, for the second merge). Branches 1 Shop, 2 Warehouse.
//   Lot 101  K  3 Nov  br1 4
//   Lot 201  D  3 Nov  br1 2, br2 1      (received 6: sale 500 took 3 from br1)
//   Lot 202  D 10 Nov  br1 1             (received 2: sale 501 took 1; no kept lot that day -> the merge CREATES it on K)
//   Lot 301  M  3 Nov  br1 5
// Sale 500: one line (601), product 2, qty 3, batch_id 201, NO allocation rows. Sale 501: line 602, product 2, qty 1, batch_id 202.
function world() {
  const h = createProductsRouteHarness({ user: ADMIN })
  const pricing = h.load('lib/saleItemPricing.ts')
  const priced = (lineKey, id, productId, quantity) => {
    const pool = { version: 1, pool_key: `pool-${lineKey}`, evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [], lines: [{ line_key: lineKey, source: 'selling',
      product: { id: productId, selling_price_usd: 10, selling_price_khr: 40000, wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
      selling_price_input_usd: null, manual: { type: 'none', value: 0 } }] }
    return pricing.materializeCapturedPricingRow({ id, product_id: productId }, pool, { [lineKey]: quantity }, lineKey,
      { version: 1, lines: [{ line_key: lineKey, amount: 10 * quantity }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 })
  }
  fixtureWrite(h, () => {
    const db = h.raw.db
    db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);
      INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,wholesale_price_usd) VALUES
        (1,'Twin Serum','777',1,4,2,2,10,8),(2,'Twin Serum','777',1,4,2.4,2.4,10,8),(3,'Twin Serum','777',1,5,2,2,10,8);
      INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,unit_cost_usd,is_active,received_quantity) VALUES
        (101,1,'K-1',1,'K-1','2026-11-03',2,1,4),(201,2,'D-1',1,'D-1','2026-11-03',2.4,1,6),(202,2,'D-2',2,'D-2','2026-11-10',2.4,1,2),(301,3,'M-1',1,'M-1','2026-11-03',2,1,5);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,4),(2,1,3),(2,2,1),(3,1,5);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(101,1,4),(201,1,2),(201,2,1),(202,1,1),(301,1,5);`)
    for (const [saleId, receipt, itemId, key, lot, qty] of [[500, 'R-500', 601, 'line-a', 201, 3], [501, 'R-501', 602, 'line-b', 202, 1]]) {
      const p = priced(key, itemId, 2, qty)
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status)
        VALUES(?,?,1,'Shop',4000,?,0,0,0,?,0,?,1,'completed')`).run(saleId, receipt, 10 * qty, 10 * qty, 10 * qty)
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,cost_price_khr,total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,
        product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)
        VALUES(?,?,2,'Twin Serum',?,1,?,2.4,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(itemId, saleId, qty, lot, p.total_usd, p.total_khr, p.base_price_usd, p.base_price_khr, p.applied_price_usd, p.applied_price_khr,
        p.product_discount_usd, p.product_discount_khr, p.product_discount_type, p.product_discount_label, p.manual_discount_usd, p.manual_discount_khr, p.manual_discount_type, p.manual_discount_value, p.price_mode, p.pricing_snapshot_json)
    }
  })
  return h
}
const mergeInto = (h, keepId, mergeId) => h.request('POST', '/possible-duplicates/merge', { keepId, mergeId, stock: 'merge' })

async function returnLine(h, saleId, saleItemId, quantity, key) {
  const app = h.load('routes/returns.ts').default
  const call = async (path, body) => {
    const response = await app.request(`http://local${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: h.raw }, ctx)
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  const quote = await call('/quote', { sale_id: saleId, items: [{ sale_item_id: saleItemId, quantity }] })
  assert.equal(quote.status, 200, JSON.stringify(quote.json))
  const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expectedQuote } = quote.json
  return call('', { client_request_id: key, money_precision_version: 1, sale_id: saleId, reason: 'test', expected_quote: expectedQuote,
    items: [{ sale_item_id: saleItemId, product_id: h.raw.prepare('SELECT product_id FROM sale_items WHERE id=?').get([saleItemId]).product_id, quantity, stock_action: 'restock', branch_id: 1 }] })
}

const lotsOf = (h) => plain(h.raw.prepare('SELECT id,variant_product_id AS p,is_active AS a FROM product_batches ORDER BY id').all())
function figures(h) {
  const q = (sql) => plain(h.raw.prepare(sql).all())
  return {
    lotStock: Object.fromEntries(q('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE quantity<>0 ORDER BY batch_id,branch_id').map((r) => [`${r.batch_id}/${r.branch_id}`, r.quantity])),
    branchStock: Object.fromEntries(q('SELECT product_id,branch_id,quantity FROM branch_stock WHERE quantity<>0 ORDER BY product_id,branch_id').map((r) => [`${r.product_id}/${r.branch_id}`, r.quantity])),
    products: Object.fromEntries(q('SELECT id,stock_quantity FROM products ORDER BY id').map((r) => [r.id, r.stock_quantity])),
    saleItemLots: Object.fromEntries(q('SELECT id,batch_id FROM sale_items ORDER BY id').map((r) => [r.id, r.batch_id])),
    returnItemLots: q('SELECT id,batch_id FROM return_items ORDER BY id').map((r) => r.batch_id),
  }
}

async function main() {
  await check('control: with no merge a return of the single-lot line restocks the lot it came from', async () => {
    const h = world()
    const res = await returnLine(h, 500, 601, 1, 'ctl-1')
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const f = figures(h)
    assert.equal(f.lotStock['201/1'], 3)
    assert.equal(f.products[2], 5)
    assert.deepEqual(f.returnItemLots, [201])
  })

  await check('control: without a merge, 1 then 2 returned of a line of 3 are both accepted (the capacity rule itself)', async () => {
    const h = world()
    assert.equal((await returnLine(h, 500, 601, 1, 'k-1')).status, 200)
    const second = await returnLine(h, 500, 601, 2, 'k-2')
    assert.equal(second.status, 200, JSON.stringify(second.json))
  })

  const ok = (res, label) => assert.equal(res.status, 200, `${label}: ${JSON.stringify(res.json)}`)
  const merged = async (h, keep, drop) => ok(await mergeInto(h, keep, drop), `merge ${drop} into ${keep}`)
  // After the first merge (2 into 1): lot 201 folded into 101, lot 202 moved onto product 1 under its own id.
  const AFTER_MERGE = { lotStock: { '101/1': 6, '101/2': 1, '202/1': 1, '301/1': 5 }, branchStock: { '1/1': 7, '1/2': 1, '3/1': 5 }, products: { 1: 8, 2: 0, 3: 5 } }

  await check('merge: the single-lot lines follow the stock (601 -> kept lot 101; 602 keeps its moved lot 202); no stock sits on the inactive lot or product', async () => {
    const h = world()
    await merged(h, 1, 2)
    const f = figures(h)
    assert.deepEqual({ lotStock: f.lotStock, branchStock: f.branchStock, products: f.products }, AFTER_MERGE)
    assert.deepEqual(f.saleItemLots, { 601: 101, 602: 202 })
    assert.deepEqual(lotsOf(h), [{ id: 101, p: 1, a: 1 }, { id: 201, p: 2, a: 0 }, { id: 202, p: 1, a: 1 }, { id: 301, p: 3, a: 1 }])
  })

  await check('return after the merge: a partial return of the folded single-lot line lands on the kept lot, exact per-branch / branch_stock / product totals', async () => {
    const h = world()
    await merged(h, 1, 2)
    ok(await returnLine(h, 500, 601, 1, 'a-1'), 'return 1 of 3')
    const f = figures(h)
    assert.deepEqual(f.lotStock, { '101/1': 7, '101/2': 1, '202/1': 1, '301/1': 5 })
    assert.deepEqual(f.branchStock, { '1/1': 8, '1/2': 1, '3/1': 5 })
    assert.deepEqual(f.products, { 1: 9, 2: 0, 3: 5 })
    assert.deepEqual(f.returnItemLots, [101])
    assert.equal(lotsOf(h).find((row) => row.id === 201).a, 0, 'the source lot stays inactive and gets nothing')
  })

  await check('second partial return, then the rest, then an over-return: each lands on the kept lot; the over-return is refused and changes nothing', async () => {
    const h = world()
    await merged(h, 1, 2)
    ok(await returnLine(h, 500, 601, 1, 'b-1'), 'first')
    ok(await returnLine(h, 500, 601, 2, 'b-2'), 'second, the rest')
    const f = figures(h)
    assert.deepEqual(f.lotStock, { '101/1': 9, '101/2': 1, '202/1': 1, '301/1': 5 })
    assert.deepEqual(f.products, { 1: 11, 2: 0, 3: 5 })
    assert.deepEqual(f.returnItemLots, [101, 101])
    const before = JSON.stringify(figures(h))
    await assert.rejects(returnLine(h, 500, 601, 1, 'b-3'), /customer_return_quantity_exceeded/, 'a fourth unit was never sold: the quote refuses it')
    assert.equal(JSON.stringify(figures(h)), before, 'the refusal wrote nothing')
  })

  await check('a line from a lot the merge only MOVED (no same-day lot: created on the keeper) returns into that lot, active on the kept product', async () => {
    const h = world()
    await merged(h, 1, 2)
    ok(await returnLine(h, 501, 602, 1, 'c-1'), 'return of 602')
    const f = figures(h)
    assert.deepEqual(f.lotStock, { '101/1': 6, '101/2': 1, '202/1': 2, '301/1': 5 })
    assert.deepEqual(f.branchStock, { '1/1': 8, '1/2': 1, '3/1': 5 })
    assert.deepEqual(f.products, { 1: 9, 2: 0, 3: 5 })
    assert.deepEqual(f.returnItemLots, [202])
  })

  await check('return after a SECOND merge (kept product merged into a third): the line has followed its stock twice and the return lands on the final lot', async () => {
    const h = world()
    await merged(h, 1, 2)
    await merged(h, 3, 1)
    let f = figures(h)
    assert.equal(f.saleItemLots[601], 301, 'the line followed 201 -> 101 -> 301')
    assert.deepEqual(f.products, { 1: 0, 2: 0, 3: 13 })
    ok(await returnLine(h, 500, 601, 1, 'd-1'), 'return after the second merge')
    f = figures(h)
    assert.equal(f.lotStock['301/1'], 12)
    assert.equal(f.lotStock['101/1'], undefined, 'nothing on the twice-removed lot')
    assert.equal(f.lotStock['201/1'], undefined)
    assert.equal(f.products[3], 14)
    assert.equal(f.branchStock['3/1'], 13)
    assert.deepEqual(f.returnItemLots, [301])
    assert.deepEqual(lotsOf(h).filter((row) => row.a === 0).map((row) => row.id), [101, 201])
  })

  // A return recorded BEFORE the merge, then reversed and restored AFTER it: the reversal must take the unit back out of the lot that holds it now.
  async function cancelOrRestore(h, source, target, key) {
    const app = h.load('routes/returns.ts').default
    const row = h.raw.prepare('SELECT id,status,return_type,updated_at FROM returns ORDER BY id DESC LIMIT 1').get()
    const response = await app.request('http://local/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      client_request_id: key, field: 'status', source, target, items: [{ id: row.id, expected_status: row.status, expected_method: row.return_type, expected_updated_at: row.updated_at }] }) }, { DB: h.raw }, ctx)
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  await check('a return made before the merge is reversed after it: the unit comes out of the kept lot, and restoring it puts it back there', async () => {
    const h = world()
    ok(await returnLine(h, 500, 601, 1, 'e-1'), 'return before the merge')
    assert.equal(figures(h).lotStock['201/1'], 3)
    await merged(h, 1, 2)
    let f = figures(h)
    assert.equal(f.lotStock['101/1'], 7)
    assert.deepEqual(f.returnItemLots, [101], 'the return line followed the lot')
    ok(await cancelOrRestore(h, 'completed', 'cancelled', 'e-cancel'), 'cancel')
    f = figures(h)
    assert.equal(f.lotStock['101/1'], 6, 'the cancel took the unit out of the kept lot')
    assert.equal(f.lotStock['201/1'], undefined)
    assert.equal(f.products[1], 8)
    assert.equal(f.products[2], 0, 'the inactive twin never goes negative or holds stock')
    ok(await cancelOrRestore(h, 'cancelled', 'completed', 'e-restore'), 'restore')
    f = figures(h)
    assert.equal(f.lotStock['101/1'], 7)
    assert.equal(f.products[1], 9)
  })

  // Undo of the merge puts every re-pointed line back, exactly.
  async function undoMerge(h) {
    const history = h.raw.prepare("SELECT id,scope FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge' ORDER BY id DESC LIMIT 1").get()
    assert.ok(history, 'the merge recorded an undoable action')
    const app = h.load('routes/actionHistory.ts').default
    const env = { DB: h.raw }
    const listed = await app.request(`http://local/?scope=${encodeURIComponent(history.scope)}`, {}, env, ctx)
    const current = (await listed.json()).items.find((row) => row.id === history.id)
    const response = await app.request(`http://local/${history.id}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ require_applied: true, expected_generation: current.undo_payload.generation }) }, env, ctx)
    return { status: response.status, json: await response.json().catch(() => null) }
  }
  const fullState = (h) => JSON.stringify({ figures: figures(h), lots: lotsOf(h),
    allocations: plain(h.raw.prepare('SELECT id,sale_item_id,batch_id FROM sale_item_batch_allocations ORDER BY id').all()),
    returnAllocations: plain(h.raw.prepare('SELECT id,return_item_id,batch_id FROM return_item_batch_allocations ORDER BY id').all()) })
  await check('undo of the merge puts every re-pointed sale and return line back on its original lot (an add and a create in one merge)', async () => {
    const h = world()
    ok(await returnLine(h, 500, 601, 1, 'f-1'), 'a return on the lot before the merge')
    const before = fullState(h)
    await merged(h, 1, 2)
    assert.equal(figures(h).saleItemLots[601], 101)
    const undone = await undoMerge(h)
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.equal(fullState(h), before, 'sale_items.batch_id, return_items.batch_id, lots and every stock figure are exactly as before the merge')
    assert.deepEqual(figures(h).saleItemLots, { 601: 201, 602: 202 })
    assert.deepEqual(figures(h).returnItemLots, [201])
  })

  await check('undo of a merge snapshot written before saleItemIds existed re-points nothing and does not fail', async () => {
    const h = world()
    await merged(h, 1, 2)
    const snap = h.raw.prepare("SELECT id,payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC LIMIT 1").get()
    const payload = JSON.parse(snap.payload_json)
    for (const folded of payload.foldedBatches) { delete folded.saleItemIds; delete folded.returnItemIds }
    h.raw.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(payload), snap.id)
    const undone = await undoMerge(h)
    assert.ok(undone.status === 200 || undone.status === 409, `undo ran or refused cleanly: ${undone.status}`)
    assert.equal(figures(h).saleItemLots[601], 101, 'an old snapshot cannot say which lines moved, so they stay (no guessing)')
  })

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
