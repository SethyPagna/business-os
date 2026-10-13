'use strict'
// Finding C, display sibling: the Sales list (GET /api/sales, which the till's
// Returns screen also reads by id) must report the units an imported sale
// says already came back.
//
// routes/sales.ts re-projects sale_items.returned_quantity from return_items
// only, shadowing the imported column, so an imported 3-unit line with 2
// returned showed 0 returned (and 3 returnable) on the till. Pinned here on
// the whole Worker (harness: test-al-money-c-native.cjs):
//
//   line                          returned_quantity   imported_returned_quantity
//   imported 3, 2 returned        2                   2
//   + app return of the last 1    3                   2   (sale now 'returned')
//   POS sale 2, nothing returned  0                   0   (control)
//
// The capacity half of C is pinned by test-al-money-c-native.cjs.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('C-surfaces')
  try {
    await H.seedProduct(h, 801, 'Surface Imported Serum', 5, 20)
    await H.seedProduct(h, 802, 'Surface POS Toner', 5, 20)
    const imported = await H.importSale(h, 11, 'partial_return', [{ productId: 801, name: 'Surface Imported Serum', quantity: 3, price: 5, returned: 2 }])
    const line = async (saleId) => {
      const read = await h.call('GET', H.fresh(`/api/sales?id=${saleId}`), undefined, `GET /api/sales?id=${saleId}`, { observe: true })
      const sale = (Array.isArray(read.body) ? read.body : read.body.sales || read.body.rows || []).find(row => Number(row.id) === Number(saleId))
      const items = sale ? (typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items) : []
      return { status: read.status, sale_status: sale && sale.sale_status, item: items[0] || {} }
    }
    const before = await line(imported.sale.id)
    r.check(`an imported line reports its imported returned units (returned ${before.item.returned_quantity}, imported ${before.item.imported_returned_quantity})`, () => {
      assert.equal(before.status, 200)
      assert.equal(Number(before.item.returned_quantity), 2)
      assert.equal(Number(before.item.imported_returned_quantity), 2)
    })
    const last = await h.call('POST', '/api/returns', { client_request_id: 'surface-last-unit', sale_id: imported.sale.id, reason: 'surface probe',
      return_type: 'restock', items: [{ sale_item_id: imported.items[0].id, product_id: 801, quantity: 1, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }] }, 'return the last imported unit')
    const after = await line(imported.sale.id)
    r.check(`after the last unit is returned the line reads 3 returned, 2 of them imported, and the sale is returned (create ${last.status}; ${after.item.returned_quantity}/${after.item.imported_returned_quantity}; ${after.sale_status})`, () => {
      assert.equal(last.status, 200, JSON.stringify(last.body).slice(0, 200))
      assert.equal(Number(after.item.returned_quantity), 3)
      assert.equal(Number(after.item.imported_returned_quantity), 2)
      assert.equal(after.sale_status, 'returned', 'the status projection counts the imported units too')
    })
    const pos = await H.createSale(h, { key: 'surface-pos', status: 'completed', lines: [{ productId: 802, quantity: 2 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'POS control sale' })
    const control = await line(pos.body.id)
    r.check(`control: a POS line with no returns reads 0 / 0 (got ${control.item.returned_quantity} / ${control.item.imported_returned_quantity})`, () => {
      assert.equal(pos.status, 200)
      assert.equal(Number(control.item.returned_quantity), 0)
      assert.equal(Number(control.item.imported_returned_quantity), 0)
    })
    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} imported returned quantity on the Sales list: ${r.results.length - failed.length}/${r.results.length}`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
