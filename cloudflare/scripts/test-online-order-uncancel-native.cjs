// KHQR S6a: once an ABA refund is noted for a cancelled linked sale, no path may reopen it (migration 0298 trigger + the shared 409 classifier). Three paths: the Sales page
// status change, the bulk status action, and the history Undo of the cancellation. Control: without a refund Record the same reopen works on every path.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-uncancel
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
let n = 0
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Reopen Serum', 12.5, 100, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const historyIds = new Map()
    async function cancelledLinkedSale({ refundNoted }) {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES ('LB-U${n}', 'uncancel-${n}', 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).run()
      const orderId = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
        VALUES (?, ?, 'order', 25, 'USD', 'paid', 25, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(orderId, `WUNCANCEL${String(n).padStart(8, '0')}`).run()
      const made = await H.createSale(h, { key: `uncancel-sale-${n}`, lines: [{ productId: 12, quantity: 2 }], paymentDetails: [{ method: 'ABA', amount_usd: 25, amount_khr: 0 }], extra: { online_order_id: orderId } })
      assert.equal(made.status, 200, JSON.stringify(made.body))
      const saleId = made.body.id
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', saleId)
      const cancel = await h.call('POST', '/api/sales/bulk-status', { client_request_id: `uncancel-cancel-${n}`, target_status: 'cancelled', items: [{ id: saleId, expected_status: 'completed', expected_updated_at: row.updated_at, cancel: { reason: 'mistake' } }] }, 'cancel')
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body))
      if (refundNoted) await h.db.prepare("INSERT INTO online_order_events (order_id, event, source, amount_usd) VALUES (?, 'refund_noted', 'staff', 25)").bind(orderId).run()
      historyIds.set(saleId, Number((await h.one("SELECT id FROM action_history WHERE entity = 'sale' ORDER BY id DESC LIMIT 1"))?.id))
      return saleId
    }
    const status = async (id) => (await h.one('SELECT sale_status FROM sales WHERE id = ?', id)).sale_status
    const reopenPatch = async (id) => {
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id)
      return h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', expected_updated_at: row.updated_at, client_request_id: `reopen-${id}-${++n}` }, 'reopen')
    }
    const reopenBulk = async (id) => {
      const row = await h.one('SELECT sale_status, updated_at FROM sales WHERE id = ?', id)
      return h.call('POST', '/api/sales/bulk-status', { client_request_id: `reopen-bulk-${id}-${++n}`, source_status: 'cancelled', target_status: 'completed', items: [{ id, expected_status: row.sale_status, expected_updated_at: row.updated_at }] }, 'reopen bulk')
    }
    const undoCancel = async (id) => {
      assert.ok(historyIds.get(id) > 0, 'the cancel recorded a history row')
      return H.historyStep(h, historyIds.get(id), 'undo', 0, 'undo cancel')
    }

    // Blocked: a refund was noted.
    for (const [name, reopen] of [['status change', reopenPatch], ['bulk status', reopenBulk], ['history undo', undoCancel]]) {
      const id = await cancelledLinkedSale({ refundNoted: true })
      const result = await reopen(id)
      assert.equal(result.status, 409, `${name}: ${JSON.stringify(result.body)}`)
      assert.equal(result.body.code, 'online_refund_noted', `${name}: ${JSON.stringify(result.body)}`)
      assert.equal(await status(id), 'cancelled', `${name}: the sale stays cancelled`)
      console.log(`PASS ${name}: reopening a cancelled sale after an ABA refund was noted is refused (409 online_refund_noted)`)
    }
    // Control: the same three paths reopen a cancelled linked sale that has no refund Record.
    for (const [name, reopen] of [['status change', reopenPatch], ['bulk status', reopenBulk], ['history undo', undoCancel]]) {
      const id = await cancelledLinkedSale({ refundNoted: false })
      const result = await reopen(id)
      assert.equal(result.status, 200, `control ${name}: ${JSON.stringify(result.body)}`)
      assert.notEqual(await status(id), 'cancelled', `control ${name}: reopened`)
      console.log(`PASS control ${name}: with no refund Record the cancelled linked sale reopens`)
    }
    // Screens: a status change on a sale that fulfilled an order moves the online_orders cache version (the staff Orders list and the bell re-read); a plain sale does not.
    const kv = await h.mf.getKVNamespace('CACHE')
    const version = async () => await kv.get('v2:online_orders')
    const wait = async (before) => { for (let i = 0; i < 40 && (await version()) === before; i += 1) await new Promise((r) => setTimeout(r, 50)); return version() }
    const linked = await cancelledLinkedSale({ refundNoted: false })
    const v0 = await version()
    assert.equal((await reopenPatch(linked)).status, 200)
    const v1 = await wait(v0)
    assert.notEqual(v1, v0, 'reopening a linked sale refreshes the online order screens')
    const plainSale = await H.createSale(h, { key: 'plain-hook', lines: [{ productId: 12, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }] })
    const plainRow = await h.one('SELECT updated_at FROM sales WHERE id = ?', plainSale.body.id)
    assert.equal((await h.call('PATCH', '/api/sales/' + plainSale.body.id + '/status', { sale_status: 'cancelled', cancel_reason: 'mistake', expected_updated_at: plainRow.updated_at, client_request_id: 'plain-hook-cancel' }, 'plain cancel')).status, 200)
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(await version(), v1, 'control: a plain sale change does not touch the online order screens')
    console.log('PASS a status change on a linked sale refreshes the online order screens; a plain sale does not')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online order uncancel: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
