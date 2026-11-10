// KHQR round 3 R3-4 and R3-5: the two batch guards that keep a refund note and a Fulfil from spending the same money, each proved by a race made through the harness's source
// patch hook and by the same race with the guard removed (the control: the instrument sees the race, so a refusal is the guard's doing).
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-race-guards
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
let n = 0

const NOTE_DURING_FULFIL = { name: 'note-during-fulfil', file: 'src/lib/onlineOrderFulfil.ts', from: '`).get<OrderForFulfil>({ id: orderId })\n  return row ?? null',
  to: '`).get<OrderForFulfil>({ id: orderId })\n  await db.prepare("INSERT INTO online_order_events (order_id, event, source, amount_usd, created_at) VALUES (@id, \'refund_noted\', \'staff\', 25, \'2026-11-10 00:00:00\')").run({ id: orderId })\n  return row ?? null' }
const NO_FULFIL_GUARD = { name: 'no-fulfil-guard', file: 'src/lib/onlineOrderFulfil.ts',
  from: "\n              AND (SELECT COALESCE(SUM(CAST(ROUND(amount_usd * 100) AS INTEGER)), 0) FROM online_order_events WHERE order_id = @oid AND event = 'refund_noted') = @notedCents`", to: '`' }
const FULFIL_DURING_NOTE = { name: 'fulfil-during-note', file: 'src/lib/onlineOrderStaff.ts', from: '  const cents = Math.round(amount * 100)\n  const noted = bundle.events',
  to: '  await deps.db.prepare("UPDATE online_orders SET state = \'fulfilled\', sale_id = (SELECT MAX(id) FROM sales), revision = revision + 1 WHERE id = @id").run({ id: order.id })\n  const cents = Math.round(amount * 100)\n  const noted = bundle.events' }
const NO_NOTE_SALE_GUARD = { name: 'no-note-sale-guard', file: 'src/lib/onlineOrderStaff.ts', from: '\n            AND (SELECT sale_id FROM online_orders WHERE id = @oid) IS @sale`', to: '`' }

async function world(patches) {
  const h = await H.startWorker({ patches })
  await H.seedProduct(h, 12, 'Race Serum', 12.5, 500, 2)
  await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  return h
}
async function paidOrder(h, payments) {
  n += 1
  await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
    VALUES (?, ?, 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).bind('LB-G' + n, 'race-guard-' + n).run()
  const id = (await h.one('SELECT MAX(id) id FROM online_orders')).id
  let k = 0
  for (const amount of payments) {
    k += 1
    await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
      VALUES (?, ?, 'order', ?, 'USD', 'paid', ?, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(id, `WGUARD${k}X${String(n).padStart(10, '0')}`, amount, amount).run()
  }
  return id
}
const fulfil = (h, orderId, key) => H.createSale(h, { key, lines: [{ productId: 12, quantity: 4 }], status: 'completed', paymentDetails: [{ method: 'ABA', amount_usd: 50, amount_khr: 0 }], extra: { online_order_id: orderId } })
const note = (h, orderId, amount) => h.call('POST', '/api/online-orders/' + orderId + '/refund-note', { amount_usd: amount, reference: `ABA-${orderId}-${amount}` }, 'refund note')

async function main() {
  {
    const h = await world([NOTE_DURING_FULFIL])
    try {
      const orderId = await paidOrder(h, [25, 25])
      const sales = (await h.one('SELECT COUNT(*) c FROM sales')).c
      const raced = await fulfil(h, orderId, 'race-fulfil-a')
      assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'online_order_changed', 'its own code, never stock_conflict: ' + JSON.stringify(raced.body))
      assert.equal((await h.one('SELECT COUNT(*) c FROM sales')).c, sales, 'the refused Fulfil left no sale')
      assert.deepEqual(await h.one('SELECT state, sale_id FROM online_orders WHERE id = ?', orderId), { state: 'paid', sale_id: null })
      console.log('PASS a refund note that lands during Fulfil refuses the Fulfil with online_order_changed and leaves no sale')
    } finally { await h.mf.dispose() }
  }
  {
    const h = await world([NOTE_DURING_FULFIL, NO_FULFIL_GUARD])
    try {
      const orderId = await paidOrder(h, [25, 25])
      const through = await fulfil(h, orderId, 'race-fulfil-control')
      assert.equal(through.status, 200, 'control: without the guard the same race lets a Fulfil priced before the note go through: ' + JSON.stringify(through.body))
      console.log('PASS control: with the Fulfil guard removed the same race records the sale (so the refusal above is the guard)')
    } finally { await h.mf.dispose() }
  }
  {
    const h = await world([FULFIL_DURING_NOTE])
    try {
      const orderId = await paidOrder(h, [25, 25])
      const plain = await H.createSale(h, { key: 'race-plain', lines: [{ productId: 12, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }] })
      assert.equal(plain.status, 200, JSON.stringify(plain.body))
      const raced = await note(h, orderId, 25)
      assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'order_changed')
      assert.equal((await h.one("SELECT COUNT(*) c FROM online_order_events WHERE order_id = ? AND event = 'refund_noted'", orderId)).c, 0, 'nothing was noted')
      console.log('PASS a Fulfil that lands during a refund note refuses the note with order_changed and writes nothing')
    } finally { await h.mf.dispose() }
  }
  {
    const h = await world([FULFIL_DURING_NOTE, NO_NOTE_SALE_GUARD])
    try {
      const orderId = await paidOrder(h, [25, 25])
      await H.createSale(h, { key: 'race-plain-2', lines: [{ productId: 12, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }] })
      const through = await note(h, orderId, 25)
      assert.equal(through.status, 201, 'control: without the guard the note priced before the Fulfil is written: ' + JSON.stringify(through.body))
      console.log('PASS control: with the note guard removed the same race writes the note (so the refusal above is the guard)')
    } finally { await h.mf.dispose() }
  }
}
main().then(() => { console.log('online order race guards: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
