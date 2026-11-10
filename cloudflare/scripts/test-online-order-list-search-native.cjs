// KHQR S6: the staff Orders list (GET /api/online-orders) on the REAL Worker with every migration: search `q` (order number prefix, phone prefix in its canonical form),
// the `requests` and `refund_due` filters, and the refund-due flag on every row (read by the same money function as the order screen).
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-list-search
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

let n = 0
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'List Serum', 12.5, 100, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
    /** One order; `paid` adds a paid payment of that many dollars; `age` is days since it was created. */
    async function order({ no, phone, state = 'paid', paid = 25, age = 1 }) {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES (?, ?, ?, 'pickup', 1, 'Dara', ?, 'USD', 25, '[]', 1, 3, ?, ?, ?)`).bind(no, `list-hash-${n}`, state, phone, paid ? daysAgo(age) : null, daysAgo(age), daysAgo(age)).run()
      const id = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      if (paid) await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
        VALUES (?, ?, 'order', ?, 'USD', 'paid', ?, 'USD', ?, 'QR', 1, ?)`).bind(id, `WLIST${String(n).padStart(11, '0')}`, paid, paid, daysAgo(age), daysAgo(age)).run()
      return id
    }
    const list = async (query) => (await h.call('GET', H.fresh(`/api/online-orders?${query}`), undefined, `list ${query}`))
    const nos = (res) => res.body.rows.map((r) => r.order_no)

    const A = await order({ no: 'W261109AB12', phone: '012345678' })
    const B = await order({ no: 'W261109CD34', phone: '098765432', state: 'cancelled', age: 0.5 })
    await order({ no: 'W261108EF56', phone: '012999888', state: 'awaiting_payment', paid: 0, age: 2 })
    const D = await order({ no: 'W261107GH78', phone: '077111222', age: 0.2 })
    const E = await order({ no: 'W261106JK90', phone: '011000111', age: 3 })
    await order({ no: 'W260901MN12', phone: '096555444', state: 'cancelled', age: 60 })
    const G = await order({ no: 'W261105PQ34', phone: '078222333', age: 0.1 })
    await h.db.prepare("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json, customer_comment) VALUES (?, 'note', 'paid', '{}', '{}', 'please gift wrap')").bind(E).run()

    // Two Fulfils through the real route: D with fewer lines (half of the money is refundable), G with exactly the order's lines (nothing is due).
    const fulfil = (key, orderId, quantity, khqr) => H.createSale(h, { key, lines: [{ productId: 12, quantity }], paymentDetails: [{ method: 'ABA', amount_usd: khqr, amount_khr: 0 }], extra: { online_order_id: orderId } })
    assert.equal((await fulfil('list-fulfil-d', D, 1, 12.5)).status, 200)
    assert.equal((await fulfil('list-fulfil-g', G, 2, 25)).status, 200)

    // ---- search by order number: prefix, case and separators forgiven
    assert.deepEqual((await list('q=W261109')).body.rows.map((r) => r.order_no).sort(), ['W261109AB12', 'W261109CD34'])
    assert.deepEqual(nos(await list('q=w261109-cd')), ['W261109CD34'], 'case and a dash are forgiven')
    assert.deepEqual(nos(await list('q=W261109AB12')), ['W261109AB12'], 'the whole number finds exactly one order')
    assert.equal((await list('q=W9999')).body.rows.length, 0)
    // ---- search by phone: a prefix of the canonical form, typed any way
    assert.deepEqual(nos(await list('q=0123')), ['W261109AB12'])
    assert.deepEqual(nos(await list('q=012 345')), ['W261109AB12'], 'spaces are forgiven')
    assert.deepEqual(nos(await list('q=' + encodeURIComponent('+855 12 345 678'))), ['W261109AB12'], 'a +855 number finds the 0-leading stored number')
    assert.deepEqual((await list('q=012')).body.rows.map((r) => r.order_no).sort(), ['W261108EF56', 'W261109AB12'], 'a short phone prefix lists every match, every state')
    // a search spans every state unless a filter is also given; with a filter it narrows
    assert.deepEqual(nos(await list('q=012&filter=paid')), ['W261109AB12'])
    // too short is refused with a code, not answered with a table scan
    const short = await list('q=ab'); assert.equal(short.status, 400); assert.equal(short.body.code, 'search_too_short')
    const shortPhone = await list('q=01'); assert.equal(shortPhone.status, 400); assert.equal(shortPhone.body.code, 'search_too_short')
    console.log('PASS search q: order number prefix (case/dash forgiven), phone prefix in canonical form (+855 folded), every state unless a filter narrows, short input refused')

    // ---- staff without "See full phone numbers" (owner ruling 10 Nov 2026): a part of a number finds the order, the number stays masked
    const clerk = await h.addEmployee(962, 'list_clerk', { online_orders: true })
    const asClerk = await h.call('GET', H.fresh('/api/online-orders?q=0123'), undefined, 'clerk search', { cookie: clerk })
    assert.equal(asClerk.status, 200, JSON.stringify(asClerk.body)); assert.deepEqual(nos(asClerk), ['W261109AB12'], 'a fragment finds the order without the grant')
    assert.ok(!JSON.stringify(asClerk.body).includes('012345678') && asClerk.body.rows[0].customer_phone.includes('*'), 'the number stays masked on screen: ' + asClerk.body.rows[0].customer_phone)
    console.log('PASS staff without the full-phone grant search by part of a number and read it masked')

    // ---- requests filter
    const requests = await list('filter=requests')
    assert.deepEqual(nos(requests), ['W261106JK90']); assert.equal(requests.body.rows[0].pending_requests, 1)
    console.log('PASS filter requests lists only orders with an undecided request')

    // ---- refund_due filter and the flag on every row
    const due = await list('filter=refund_due')
    assert.deepEqual(due.body.rows.map((r) => r.order_no).sort(), ['W261107GH78', 'W261109CD34'], 'the cancelled paid order and the Fulfil with fewer lines; not the full Fulfil, not the old one')
    assert.equal(due.body.rows.find((r) => r.id === B).refund_due_usd, 25); assert.equal(due.body.rows.find((r) => r.id === D).refund_due_usd, 12.5)
    const all = await list('filter=all&limit=50')
    const flag = (id) => all.body.rows.find((r) => r.id === id)
    assert.equal(flag(B).refund_due, true); assert.equal(flag(D).refund_due, true); assert.equal(flag(A).refund_due, false); assert.equal(flag(G).refund_due, false)
    assert.equal(flag(G).refund_due_usd, 0)
    assert.ok(all.body.rows.every((r) => typeof r.refund_due === 'boolean' && typeof r.refund_due_usd === 'number'), 'every row carries the flag')
    // keyset paging across the filter: one row a page, no duplicates, and it ends
    const first = await list('filter=refund_due&limit=1'); assert.equal(first.body.rows.length, 1); assert.ok(first.body.next_cursor)
    const second = await list(`filter=refund_due&limit=1&cursor=${encodeURIComponent(first.body.next_cursor)}`); assert.equal(second.body.rows.length, 1)
    assert.notEqual(first.body.rows[0].id, second.body.rows[0].id)
    const third = await list(`filter=refund_due&limit=1&cursor=${encodeURIComponent(second.body.next_cursor ?? '')}`)
    assert.ok(second.body.next_cursor === null || third.body.rows.length === 0, 'the filter ends after its last match')
    // a refund noted for the cancelled order clears it from the filter and the flag
    await h.db.prepare("INSERT INTO online_order_events (order_id, event, source, amount_usd) VALUES (?, 'refund_noted', 'staff', 25)").bind(B).run()
    assert.deepEqual(nos(await list('filter=refund_due')), ['W261107GH78'], 'a noted refund clears the order from refund_due')
    console.log('PASS filter refund_due: exact (same money function), window-bound, a noted refund clears it, paging by cursor; every row carries refund_due and refund_due_usd')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online order list search: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
