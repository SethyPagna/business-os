'use strict'
// Exact-decimal return capacity, end to end on the whole Worker (harness:
// test-al-money-c-native.cjs). The pure test
// (test-return-capacity-exact-decimal-pure.cjs) proves the arithmetic; this
// file proves the ROUTE accepts it, because a legacy return passes two
// capacity reads -- assertReturnableItems (routes/returns.ts) and then
// assertReturnCreateCapacity -- and either one summing binary floats refuses
// the last 0.1 of a 0.3 line ("only 0.09999999999999998 remaining").
//
// Fixture: legacy (v0) sales of one 0.3-unit line, written by the real
// sales-import writer (POST /api/sales is v1-only; v1 returns already use
// the exact entitlement).
//
//   path                          sequence on a 0.3 line      expected
//   create by sale line           0.2, then 0.1                both 200, sale Completed + 'full' tag (6.0.905)
//   control                       ... then 0.1 more            refused, nothing written
//   create by product             0.2 by line, 0.1 by product  both 200
//   edit                          0.2 + 0.05, edit 0.05->0.1   200 (exactly full)
//   control                       edit 0.1 -> 0.1000001        refused, return keeps 0.1
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('exact-decimal')
  try {
    for (const [id, name] of [[901, 'Exact Serum'], [902, 'Exact Toner'], [903, 'Exact Mask']]) await H.seedProduct(h, id, name, 10, 20)
    const sale = (row, productId, name) => H.importSale(h, row, 'completed', [{ productId, name, quantity: 0.3, price: 10 }])
    const legacyReturn = (fixture, key, item) => h.call('POST', '/api/returns', { client_request_id: key, sale_id: fixture.sale.id,
      reason: 'exact decimal probe', return_type: 'restock', items: [{ applied_price_usd: 10, stock_action: 'restock', branch_id: 1, ...item }] }, key)
    const recorded = async saleId => (await h.all(`SELECT ri.quantity FROM return_items ri JOIN returns rr ON rr.id=ri.return_id
      WHERE rr.sale_id=? AND COALESCE(rr.status,'completed')<>'cancelled' ORDER BY ri.id`, saleId)).map(row => row.quantity)

    // 1. By sale line.
    const a = await sale(31, 901, 'Exact Serum')
    const a1 = await legacyReturn(a, 'exact-a-1', { sale_item_id: a.items[0].id, product_id: 901, quantity: 0.2 })
    const a2 = await legacyReturn(a, 'exact-a-2', { sale_item_id: a.items[0].id, product_id: 901, quantity: 0.1 })
    const aStatus = (await h.one("SELECT sale_status || '/' || COALESCE(return_state,'-') AS state FROM sales WHERE id=?", a.sale.id)).state
    r.check(`by sale line: 0.2 then 0.1 of a 0.3 line are both recorded (got ${a1.status}, ${a2.status} ${a2.body.error || ''}; sale ${aStatus})`, () => {
      assert.equal(a1.status, 200, JSON.stringify(a1.body))
      assert.equal(a2.status, 200, JSON.stringify(a2.body))
      assert.equal(aStatus, 'completed/full')
    })
    const a3 = await legacyReturn(a, 'exact-a-3', { sale_item_id: a.items[0].id, product_id: 901, quantity: 0.1 })
    const aRows = await recorded(a.sale.id)
    r.check(`control: a further 0.1 is refused and nothing is written (got ${a3.status} ${a3.body.error || ''}; recorded ${JSON.stringify(aRows)})`, () => {
      assert.ok([400, 409].includes(a3.status))
      assert.deepEqual(aRows, [0.2, 0.1])
    })

    // 2. By product (no sale_item_id on the second return).
    const b = await sale(32, 902, 'Exact Toner')
    const b1 = await legacyReturn(b, 'exact-b-1', { sale_item_id: b.items[0].id, product_id: 902, quantity: 0.2 })
    const b2 = await legacyReturn(b, 'exact-b-2', { product_id: 902, quantity: 0.1 })
    r.check(`by product: 0.2 by line then 0.1 by product fills the line (got ${b1.status}, ${b2.status} ${b2.body.error || ''})`, () => {
      assert.equal(b1.status, 200, JSON.stringify(b1.body))
      assert.equal(b2.status, 200, JSON.stringify(b2.body))
    })

    // 3. Edit: 0.2 and 0.05 recorded, then the 0.05 is edited to 0.1 (exactly full).
    const c = await sale(33, 903, 'Exact Mask')
    const c1 = await legacyReturn(c, 'exact-c-1', { sale_item_id: c.items[0].id, product_id: 903, quantity: 0.2 })
    const c2 = await legacyReturn(c, 'exact-c-2', { sale_item_id: c.items[0].id, product_id: 903, quantity: 0.05 })
    const edit = async (key, quantity) => {
      const target = await h.one('SELECT id,updated_at FROM returns WHERE id=?', Number(c2.body.id))
      return h.call('PATCH', `/api/returns/${target.id}`, { client_request_id: key, expected_updated_at: target.updated_at,
        reason: 'exact decimal edit', return_type: 'restock', branch_id: 1,
        items: [{ sale_item_id: c.items[0].id, product_id: 903, quantity, applied_price_usd: 10, stock_action: 'restock', branch_id: 1 }] }, key)
    }
    const e1 = await edit('exact-c-edit-1', 0.1)
    const cStatus = (await h.one("SELECT sale_status || '/' || COALESCE(return_state,'-') AS state FROM sales WHERE id=?", c.sale.id)).state
    r.check(`edit: raising 0.05 to 0.1 beside 0.2 on a 0.3 line is accepted (fixture ${c1.status}/${c2.status}; edit ${e1.status} ${e1.body.error || ''}; sale ${cStatus})`, () => {
      assert.equal(c1.status, 200); assert.equal(c2.status, 200)
      assert.equal(e1.status, 200, JSON.stringify(e1.body))
      assert.equal(cStatus, 'completed/full', 'the edit projection is exact too')
    })
    const e2 = await edit('exact-c-edit-2', 0.1000001)
    const cRows = await recorded(c.sale.id)
    r.check(`control: editing it to 0.1000001 is refused and the return keeps 0.1 (got ${e2.status} ${e2.body.error || ''}; recorded ${JSON.stringify(cRows)})`, () => {
      assert.ok([400, 409].includes(e2.status))
      assert.deepEqual(cRows, [0.2, 0.1])
    })

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} exact-decimal legacy return capacity: ${r.results.length - failed.length}/${r.results.length}`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
