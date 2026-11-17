'use strict'
// B2 (16 Nov 2026, round-2 review): after a merge, a return of a sale line drawn from an ALREADY-INACTIVE, stock-less lot of the discarded
// product was refused (409 "A selected received date is no longer active for this product"): the lot stayed on the discarded product while
// the line's product_id moved to the keeper, and returns.ts / saleBulkStatus.ts refuse a lot owned by another product.
//
// Lead ruling (amends M2): an already-inactive discarded lot is RE-POINTED onto the keeper (variant_product_id = keeper), as base does for
// a lot with no collision. Nothing else about it changes: it stays inactive, unmarked, unfolded and stock-less; undo restores its owner and
// batch number exactly. This test drives the real merge route, the real returns route, the real sale cancel (POST /bulk-status) and the real
// undo, and checks the unit lands in the line's OWN lot, never in the kept lot.
// Run (from cloudflare/): node scripts/test-merge-inactive-lot-return-native.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const ctx = { waitUntil() {}, passThroughOnException() {} }
const K = 1
const D = 2
let passed = 0
let failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
}
const plain = (rows) => (Array.isArray(rows) ? rows.map((row) => ({ ...row })) : rows == null ? rows : { ...rows })
function fixtureWrite(h, run) {
  h.raw.db.exec("BEGIN; INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  try { run(); h.raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT") } catch (e) { h.raw.db.exec('ROLLBACK'); throw e }
}

// Keeper 1: lot 101 (3 Nov, 4 units). Discarded 2: lot 201 (3 Nov, 3 units: folds into 101) and lot 203 (5 Nov, ARCHIVED, no stock) whose
// one unit was sold on sale 502 (line 603, single-lot line on lot 203). Sale 503 / line 604 sold one unit from lot 201 (the control: a lot
// that folds). Both sales are completed.
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
        (1,'Twin Serum','777',1,4,2,2,10,8),(2,'Twin Serum','777',1,3,2.4,2.4,10,8);
      INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,unit_cost_usd,is_active,received_quantity) VALUES
        (101,1,'K-1',1,'K-1','2026-11-03',2,1,4),(201,2,'D-1',1,'D-1','2026-11-03',2.4,1,6),(203,2,'D-3',3,'D-3','2026-11-05',2.4,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,4),(2,1,3);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(101,1,4),(201,1,3);`)
    for (const [saleId, receipt, itemId, key, lot, qty] of [[502, 'R-502', 603, 'line-c', 203, 1], [503, 'R-503', 604, 'line-d', 201, 1]]) {
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
async function returnLine(h, saleId, saleItemId, quantity, key) {
  const app = h.load('routes/returns.ts').default
  const call = async (path, body) => {
    const r = await app.request(`http://local${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: h.raw }, ctx)
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  const quote = await call('/quote', { sale_id: saleId, items: [{ sale_item_id: saleItemId, quantity }] })
  if (quote.status !== 200) return { stage: 'quote', ...quote }
  const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expectedQuote } = quote.json
  return call('', { client_request_id: key, money_precision_version: 1, sale_id: saleId, reason: 'test', expected_quote: expectedQuote,
    items: [{ sale_item_id: saleItemId, product_id: h.raw.prepare('SELECT product_id FROM sale_items WHERE id=?').get([saleItemId]).product_id, quantity, stock_action: 'restock', branch_id: 1 }] })
}
async function cancelSale(h, saleId, key) {
  const app = h.load('routes/sales.ts').default
  const row = h.raw.prepare('SELECT sale_status,updated_at FROM sales WHERE id=?').get([saleId])
  const r = await app.request('http://local/bulk-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    client_request_id: key, source_status: row.sale_status, target_status: 'cancelled', cancel_reason: 'mistake',
    items: [{ id: saleId, expected_status: row.sale_status, expected_updated_at: row.updated_at ?? null }] }) }, { DB: h.raw }, ctx)
  return { status: r.status, json: await r.json().catch(() => null) }
}
const lots = (h) => plain(h.raw.prepare('SELECT id,variant_product_id,batch_number,batch_key,is_active,merge_deactivated_at IS NOT NULL AS marked,received_at,unit_cost_usd FROM product_batches ORDER BY id').all())
const stock = (h) => {
  const out = {}
  for (const row of h.raw.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE quantity<>0 ORDER BY batch_id,branch_id').all()) (out[row.batch_id] ??= {})[row.branch_id] = row.quantity
  return out
}
const lot = (h, id) => lots(h).find((row) => row.id === id)
const merge = (h) => h.request('POST', '/possible-duplicates/merge', { keepId: K, mergeId: D, stock: 'merge' })
function state(h) {
  const q = (sql) => plain(h.raw.prepare(sql).all())
  return JSON.stringify({ lots: lots(h), stock: stock(h), shelf: q('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY 1,2'),
    products: q('SELECT id,is_active,stock_quantity FROM products ORDER BY id'), lines: q('SELECT id,product_id,batch_id FROM sale_items ORDER BY id') })
}
async function undoMerge(h) {
  const history = h.raw.prepare("SELECT id,scope FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge' ORDER BY id DESC LIMIT 1").get()
  assert.ok(history)
  const app = h.load('routes/actionHistory.ts').default
  const listed = await app.request(`http://local/?scope=${encodeURIComponent(history.scope)}`, {}, { DB: h.raw }, ctx)
  const current = (await listed.json()).items.find((row) => row.id === history.id)
  const response = await app.request(`http://local/${history.id}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ require_applied: true, expected_generation: current.undo_payload.generation }) }, { DB: h.raw }, ctx)
  return { status: response.status, json: await response.json().catch(() => null) }
}

async function main() {
  await check('CONTROL: without a merge the return of the archived-lot line is accepted and the unit lands in its own lot', async () => {
    const h = world()
    const r = await returnLine(h, 502, 603, 1, 'ctl-return-0001')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(stock(h)[203], { 1: 1 }, 'the unit went back into lot 203')
    assert.deepEqual(stock(h)[101], { 1: 4 })
  })

  await check('B2: the merge re-points the archived stock-less lot onto the keeper, leaving it inactive, unmarked and unfolded', async () => {
    const h = world()
    const before = lot(h, 203)
    const res = await merge(h)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const after = lot(h, 203)
    assert.equal(after.variant_product_id, K, 'it follows its sale lines to the keeper')
    assert.deepEqual([after.is_active, after.marked], [0, 0], 'still inactive and unmarked')
    assert.deepEqual(stock(h)[203] || {}, {}, 'no stock was put on it')
    assert.equal(after.received_at, before.received_at)
    assert.equal(after.unit_cost_usd, before.unit_cost_usd)
    // The lot that has stock and a same-date kept lot still folds as before.
    assert.deepEqual([lot(h, 201).is_active, lot(h, 201).marked, lot(h, 201).variant_product_id], [0, 1, D], 'lot 201 is folded into 101 and marked')
    assert.deepEqual(stock(h)[101], { 1: 7 })
    assert.equal(h.raw.prepare('SELECT product_id FROM sale_items WHERE id=603').get().product_id, K, 'the sale line moved to the keeper')
  })

  await check('B2: AFTER the merge the return of that line is accepted (200) and the unit lands in its OWN lot 203, not in kept lot 101', async () => {
    const h = world()
    assert.equal((await merge(h)).status, 200)
    const kept = stock(h)[101]
    const r = await returnLine(h, 502, 603, 1, 'after-return-0001')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(stock(h)[203], { 1: 1 }, 'the unit went back into lot 203 (same batch in, out, back)')
    assert.deepEqual(stock(h)[101], kept, 'and the kept lot did not take it')
    assert.equal(lot(h, 203).variant_product_id, K)
  })

  await check('B2: the return of a line whose lot FOLDED lands in the kept lot it was folded into (unchanged behaviour)', async () => {
    const h = world()
    assert.equal((await merge(h)).status, 200)
    const r = await returnLine(h, 503, 604, 1, 'after-return-0002')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(stock(h)[101], { 1: 8 }, 'the unit joined kept lot 101, where the stock of lot 201 now is')
  })

  await check('B2: AFTER the merge cancelling that sale restocks its unit into the archived lot (the sale-cancel ownership check passes)', async () => {
    const h = world()
    assert.equal((await merge(h)).status, 200)
    const kept = stock(h)[101]
    const cancelled = await cancelSale(h, 502, 'cancel-after-merge-1')
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json))
    assert.equal(h.raw.prepare('SELECT sale_status FROM sales WHERE id=502').get().sale_status, 'cancelled')
    assert.deepEqual(stock(h)[203], { 1: 1 }, 'the cancelled unit went back into its own lot')
    assert.deepEqual(stock(h)[101], kept)
  })

  await check('CONTROL: the same cancel without a merge restocks lot 203 too', async () => {
    const h = world()
    const cancelled = await cancelSale(h, 502, 'cancel-no-merge-0001')
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json))
    assert.deepEqual(stock(h)[203], { 1: 1 })
  })

  await check('B2: undo restores the archived lot exactly (owner, batch number, key, state) and every other table', async () => {
    const h = world()
    const prior = state(h)
    assert.equal((await merge(h)).status, 200)
    assert.notEqual(state(h), prior)
    const undone = await undoMerge(h)
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.equal(state(h), prior, 'exact undo')
    assert.deepEqual([lot(h, 203).variant_product_id, lot(h, 203).batch_number, lot(h, 203).is_active, lot(h, 203).marked], [D, 3, 0, 0])
  })

  await check('B2: a return after the merge makes the merge undo refuse (later stock activity) and writes nothing', async () => {
    const h = world()
    assert.equal((await merge(h)).status, 200)
    assert.equal((await returnLine(h, 502, 603, 1, 'after-return-0003')).status, 200)
    const state1 = state(h)
    const undone = await undoMerge(h)
    assert.equal(undone.status, 409, JSON.stringify(undone.json))
    assert.equal(state(h), state1)
  })

  await check('B2: a batch_key clash is resolved: the re-pointed archived lot takes a key of its own and undo gives the key back', async () => {
    const h = world()
    fixtureWrite(h, () => h.raw.db.exec("UPDATE product_batches SET batch_key='K-1' WHERE id=203"))
    const prior = state(h)
    assert.equal((await merge(h)).status, 200)
    assert.notEqual(lot(h, 203).batch_key, 'K-1', 'UNIQUE(variant_product_id, batch_key) would have refused the move')
    assert.equal(lot(h, 203).variant_product_id, K)
    assert.equal((await undoMerge(h)).status, 200)
    assert.equal(state(h), prior)
  })

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
