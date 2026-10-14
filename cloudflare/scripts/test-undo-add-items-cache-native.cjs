'use strict'
// An Action History undo or redo of "add items" rewrites sale lines, so the 20 s Dashboard ranking cache and the Sales
// list cache must turn over exactly as they do after a normal add-items: the lists a person opens next equal the
// Dashboard card (always a fresh snapshot) and the Sales list equals D1. Real routes, D1 and cache; the order is the
// one that exposes a stale entry: open the lists and the card first (so the cache holds the pre-undo rows), then
// replay, then read the lists before the card.
//
// Run (from cloudflare/):  node scripts/test-undo-add-items-cache-native.cjs
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const QUOTE = (total) => ({ gross_usd: total, product_discount_usd: 0, manual_discount_usd: 0, total_usd: total, total_khr: total * 4000 })
const businessDay = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const RANGE = `startDate=${businessDay}&endDate=${businessDay}`
const pick = (rows, fields) => rows.map(row => fields.map(field => row[field]))

async function main() {
  const h = await H.startWorker({})
  try {
    await H.seedProduct(h, 801, 'UAC Serum', 10, 1000, 1)
    await H.seedProduct(h, 802, 'UAC Wipes', 2, 1000, 1)
    await h.db.prepare("INSERT INTO customers(id,name,phone) VALUES(51001,'UAC Ann','0125001')").run()
    const sale = await H.createSale(h, { key: 'uac-1', customerId: 51001, lines: [{ productId: 802, quantity: 10, quote: QUOTE(20) }],
      paymentDetails: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }] })
    const other = await H.createSale(h, { key: 'uac-2', lines: [{ productId: 801, quantity: 1, quote: QUOTE(10) }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }] })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 200))
    assert.equal(other.status, 200, JSON.stringify(other.body).slice(0, 200))

    const list = async (insight) => (await h.call('GET', H.fresh(`/api/dashboard/insight-list?${RANGE}&insight=${insight}`), undefined, `list ${insight}`)).body.items
    const card = async () => (await h.call('GET', H.fresh(`/api/analytics?${RANGE}&granularity=day`), undefined, 'card')).body
    const salesTotal = async () => {
      const body = (await h.call('GET', `/api/sales?${RANGE}`, undefined, 'sales list')).body
      const rows = Array.isArray(body) ? body : body.items || body.sales || []
      return Number(rows.find(row => row.id === sale.body.id)?.total_usd)
    }
    const agree = async (label) => {
      const products = await list('top_products')
      const customers = await list('top_customers')
      const listed = await salesTotal()
      const fresh = await card()
      assert.deepEqual(pick(products, ['product_name', 'qty_sold', 'revenue_usd']), pick(fresh.topProducts, ['product_name', 'qty_sold', 'revenue_usd']),
        `${label}: the top-products list is the card's ranking`)
      assert.deepEqual(pick(customers, ['customer_name', 'net_revenue_usd']), pick(fresh.topCustomers, ['customer_name', 'net_revenue_usd']),
        `${label}: the top-customers list is the card's ranking`)
      const stored = Number((await h.one('SELECT total_usd FROM sales WHERE id=?', sale.body.id)).total_usd)
      assert.equal(listed, stored, `${label}: the Sales list shows what D1 holds`)
      return { stored, products }
    }

    await card(); await salesTotal()
    const add = await H.addSaleItems(h, sale.body.id, 'uac-items-1', [{ productId: 801, quantity: 5 }], 'add items')
    assert.equal(add.status, 200, JSON.stringify(add.body).slice(0, 300))
    const afterAdd = await agree('after add items')
    assert.equal(afterAdd.stored, 70)
    const id = add.body.undoActionId || add.body.actionHistoryId
    assert.ok(id, 'the add-items answer names its Action History row')

    await card(); await salesTotal(); await list('top_products'); await list('top_customers')
    const undo = await h.call('POST', `/api/action-history/${id}/undo`, { expected_generation: 0 }, 'undo add items')
    assert.equal(undo.status, 200, JSON.stringify(undo.body).slice(0, 300))
    assert.equal(undo.body.applied, true)
    const afterUndo = await agree('after UNDO of add items')
    assert.equal(afterUndo.stored, 20, 'the undo really removed the added lines')

    await card(); await salesTotal(); await list('top_products'); await list('top_customers')
    const redo = await h.call('POST', `/api/action-history/${id}/redo`, { expected_generation: 1 }, 'redo add items')
    assert.equal(redo.status, 200, JSON.stringify(redo.body).slice(0, 300))
    const afterRedo = await agree('after REDO of add items')
    assert.equal(afterRedo.stored, 70, 'the redo really re-added the lines')

    console.log('PASS undo and redo of added items turn the Dashboard ranking cache and the Sales list cache over')
  } finally { await h.mf.dispose?.() }
}

// A product merge folds the twin's sales onto the keeper, and its Action History undo/redo moves them back and forth: the
// Dashboard product ranking is keyed on the products version, so the replay must bump it as the merge itself does.
async function mergeScenario() {
  const h = await H.startWorker({})
  try {
    await H.seedProduct(h, 901, 'UAC Cream', 10, 1000, 1)
    await H.seedProduct(h, 902, 'UAC Cream', 10, 1000, 1)
    await h.db.prepare('UPDATE products SET barcode=(SELECT barcode FROM products WHERE id=901) WHERE id=902').run()
    for (const [key, productId, quantity] of [['uac-m-1', 901, 1], ['uac-m-2', 902, 2]]) {
      const sold = await H.createSale(h, { key, lines: [{ productId, quantity, quote: QUOTE(10 * quantity) }],
        paymentDetails: [{ method: 'Cash', amount_usd: 10 * quantity, amount_khr: 0 }] })
      assert.equal(sold.status, 200, JSON.stringify(sold.body).slice(0, 200))
    }
    const merge = await h.call('POST', '/api/products/merge-duplicates', { client_request_id: 'uac-merge-1' }, 'merge')
    assert.equal(merge.status, 200, JSON.stringify(merge.body).slice(0, 300))
    assert.equal(merge.body.mergedProducts, 1)
    const historyId = merge.body.actionHistoryIds[0]
    const list = async () => (await h.call('GET', H.fresh(`/api/dashboard/insight-list?${RANGE}&insight=top_products`), undefined, 'list')).body.items
    const card = async () => (await h.call('GET', H.fresh(`/api/analytics?${RANGE}&granularity=day`), undefined, 'card')).body
    const rows = (items) => pick(items, ['product_id', 'qty_sold', 'revenue_usd']).sort((x, y) => x[0] - y[0])
    await card(); await list()
    assert.equal((await list()).length, 1, 'merged: one ranking row')
    const undo = await h.call('POST', `/api/action-history/${historyId}/undo`, { expected_generation: 0 }, 'undo merge')
    assert.equal(undo.status, 200, JSON.stringify(undo.body).slice(0, 300))
    const afterUndo = await list()
    assert.deepEqual(rows(afterUndo), rows((await card()).topProducts), 'after UNDO of the merge: the list is the card ranking')
    assert.equal(afterUndo.length, 2, 'the undo split the sales back onto two products')
    await card(); await list()
    const redo = await h.call('POST', `/api/action-history/${historyId}/redo`, { expected_generation: 1 }, 'redo merge')
    assert.equal(redo.status, 200, JSON.stringify(redo.body).slice(0, 300))
    const afterRedo = await list()
    assert.deepEqual(rows(afterRedo), rows((await card()).topProducts), 'after REDO of the merge: the list is the card ranking')
    assert.equal(afterRedo.length, 1)
    console.log('PASS undo and redo of a product merge turn the Dashboard product ranking cache over')
  } finally { await h.mf.dispose?.() }
}
main().then(mergeScenario).then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
