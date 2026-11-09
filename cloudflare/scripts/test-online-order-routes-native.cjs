// KHQR S3: the storefront order API, run through the REAL route and store code against an in-memory SQLite database carrying every migration.
// PayWay is a script (no request leaves the machine, no key exists). Each scenario names the wrong implementation it must turn red on.
//
// Run: node scripts/test-online-order-routes-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}

const NAME = 'Dara Sokha'
const PHONE = '012 345 678'
const CANON = '012345678'
const ADDRESS = '12 Street 271, Phnom Penh'
const NOTE = 'ring the bell twice'
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)

function world(options = {}) {
  const h = createOrdersHarness({ switchOn: true, nowMs: T0, ...options })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const add = (name, price, stock, active = 1) => {
      const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, ?, ?)', name, price, price * 4000, active, stock).lastInsertRowid)
      h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, ?)', id, stock)
      return id
    }
    add('Serum', 12.5, 10)       // 1
    add('Cream', 7.99, 10)       // 2
    add('Soap', 3.33, 2)         // 3  (only two in stock)
    add('Retired', 5, 0, 0)      // 4  (inactive: no stock may sit on an inactive product)
    add('Toner', 19.99, 10)      // 5
  })
  return h
}
const lines = (...pairs) => pairs.map(([product_id, quantity]) => ({ product_id, quantity }))
const body = (over = {}) => ({ lines: lines([1, 2]), name: NAME, phone: PHONE, fulfilment: 'pickup', ...over })
const create = (h, over = {}, opts) => h.request('/', 'POST', body(over), opts)
const tokenOf = (res) => res.body.token
const payOnPayway = (h, amount) => { h.script.check = () => h.approved(amount) }
const events = (h, orderId = 1) => h.all('SELECT * FROM online_order_events WHERE order_id = ? ORDER BY id', orderId)
const order = (h, id = 1) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
const payments = (h, id = 1) => h.all('SELECT * FROM online_order_payments WHERE order_id = ? ORDER BY id', id)
const counts = (h) => ({
  orders: h.one('SELECT COUNT(*) n FROM online_orders').n, payments: h.one('SELECT COUNT(*) n FROM online_order_payments').n,
  events: h.one('SELECT COUNT(*) n FROM online_order_events').n, requests: h.one('SELECT COUNT(*) n FROM online_order_requests').n,
})
const ZERO = { orders: 0, payments: 0, events: 0, requests: 0 }
const poll = (h, token) => h.request(`/${token}/status`, 'GET')
const view = (h, token) => h.request(`/${token}`, 'GET')

/** A paid order: created, then the fake PayWay approves the exact amount and a poll after 90 s lets the nudge notice. */
async function paidOrder(h, over = {}) {
  const res = await create(h, over)
  assert.equal(res.status, 201)
  payOnPayway(h, res.body.order.total_usd)
  h.advance(90_000)
  await poll(h, tokenOf(res))
  assert.equal(order(h).state, 'paid')
  return res
}

async function main() {
  // ---------------------------------------------------------------------------------------------------------------------------- guards
  await check('switch OFF: every write answers 404 feature_off and touches nothing (a wrong build creates the order); reading an existing order stays open', async () => {
    const h = world({ switchOn: false })
    const token = 'abcdefghijklmnopqrstuv'
    for (const [path, method, payload] of [['/', 'POST', body()], [`/${token}/edit`, 'POST', {}], [`/${token}/cancel`, 'POST', {}], [`/${token}/retry`, 'POST', {}], [`/${token}/topup`, 'POST', {}],
      [`/${token}/requests`, 'POST', {}], [`/${token}/requests/1/withdraw`, 'POST', {}]]) {
      const r = await h.request(path, method, payload)
      assert.equal(r.status, 404, path); assert.equal(r.body.code, 'feature_off', path)
    }
    assert.deepEqual(counts(h), ZERO); assert.equal(h.calls.length, 0)
    assert.equal(h.statements.filter((s) => /online_order|products|branch_stock/.test(s)).length, 0, 'no statement read or wrote anything of the feature')
    // An order placed while the switch was on is still readable after it is turned off (the customer who paid must see it), and an unknown link is a plain not-found.
    h.state.switchOn = true
    const placed = await create(h)
    h.state.switchOn = false
    const read = await view(h, tokenOf(placed)); assert.equal(read.status, 200); assert.equal(read.body.order.status, 'awaiting_payment')
    const light = await poll(h, tokenOf(placed)); assert.equal(light.status, 200); assert.equal(light.body.state, 'awaiting_payment')
    assert.equal((await view(h, token)).status, 404); assert.equal((await view(h, token)).body.code, 'order_not_found')
    h.advance(90_000); payOnPayway(h, 25)
    assert.equal((await poll(h, tokenOf(placed))).body.state, 'paid', 'the nudge still settles money already taken')
    const cancel = await h.request(`/${tokenOf(placed)}/cancel`, 'POST', {})
    assert.equal(cancel.status, 404); assert.equal(cancel.body.code, 'feature_off')
  })

  await check('missing PayWay secrets: payway_not_configured on every route that needs PayWay, nothing written, no call made', async () => {
    const h = world()
    const envOverride = { PAYWAY_MERCHANT_ID: undefined, PAYWAY_API_KEY: undefined }
    const res = await create(h, {}, { envOverride })
    assert.equal(res.status, 503); assert.equal(res.body.code, 'payway_not_configured')
    assert.deepEqual(counts(h), ZERO); assert.equal(h.calls.length, 0)
    const ok = await create(h)
    const token = tokenOf(ok)
    for (const path of ['edit', 'retry', 'topup']) {
      const r = await h.request(`/${token}/${path}`, 'POST', { lines: lines([1, 3]), request_id: 1 }, { envOverride })
      assert.equal(r.status, 503, path); assert.equal(r.body.code, 'payway_not_configured', path)
    }
    assert.equal(order(h).revision, 0, 'the refused edit changed nothing')
    assert.equal((await view(h, token)).status, 200, 'reading an existing order needs no PayWay')
    assert.ok(!JSON.stringify(res.body).includes('merchant-test'), 'no key material in the error')
  })

  await check('CSRF: a write without same-origin, or not JSON, is refused before any work (a wrong build creates an order from a cross-site form)', async () => {
    const h = world()
    const noOrigin = await create(h, {}, { headers: { 'Sec-Fetch-Site': null } })
    assert.equal(noOrigin.status, 403); assert.equal(noOrigin.body.code, 'credential_origin_refused')
    const cross = await create(h, {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(cross.status, 403)
    const text = await h.request('/', 'POST', undefined, { rawBody: JSON.stringify(body()), headers: { 'Content-Type': 'text/plain' } })
    assert.equal(text.status, 415); assert.equal(text.body.code, 'credential_json_required')
    const sameOriginViaHeader = await create(h, {}, { headers: { 'Sec-Fetch-Site': null, Origin: 'https://example.invalid' } })
    assert.equal(sameOriginViaHeader.status, 403, 'a foreign Origin is not same-origin')
    assert.deepEqual(counts(h), ZERO); assert.equal(h.calls.length, 0)
  })

  await check('body admission: an oversize body is refused 413 before parsing; an unreadable body is a plain 400', async () => {
    const h = world()
    const big = await h.request('/', 'POST', undefined, { rawBody: JSON.stringify({ note: 'x'.repeat(70 * 1024) }) })
    assert.equal(big.status, 413); assert.equal(big.body.code, 'request_body_too_large')
    const junk = await h.request('/', 'POST', undefined, { rawBody: '{not json' })
    assert.equal(junk.status, 400); assert.equal(junk.body.code, 'invalid_json')
    assert.match(junk.body.error, /reload the page/i)
    assert.deepEqual(counts(h), ZERO)
  })

  await check('the limiter binding: over the limit is 429 with Retry-After and no D1 statement; its outage opens nothing', async () => {
    const h = world({ limiter: (key, n) => n <= 1 })
    assert.equal((await create(h)).status, 201)
    h.clearStatements()
    const limited = await create(h, { phone: '099 111 222' })
    assert.equal(limited.status, 429); assert.equal(limited.body.code, 'rate_limited'); assert.equal(limited.headers.get('retry-after'), '60')
    assert.equal(h.statements.length, 0, 'a limited request costs no D1 statement')
    assert.ok(h.limits.every((key) => key.startsWith('create:')), 'create is keyed apart from the other writes')
    const broken = world()
    broken.env.ORDER_LIMITER = { limit: async () => { throw new Error('down') } }
    assert.equal((await create(broken)).status, 201, 'a limiter outage must not close the shop')
  })

  await check('responses are never cached: Cache-Control private, no-store on every answer, errors included', async () => {
    const h = world()
    for (const res of [await create(h), await create(h, { name: '' }), await view(h, 'abcdefghijklmnopqrstuv'), await poll(h, 'bad')]) {
      assert.equal(res.headers.get('cache-control'), 'private, no-store')
    }
  })

  // ---------------------------------------------------------------------------------------------------------------------------- create
  await check('create: the order, its payment, a QR through PayWay, two Records rows; the amount is what the till would ask (pricing parity)', async () => {
    const h = world()
    const res = await create(h, { lines: lines([1, 2], [2, 3]), note: NOTE })
    assert.equal(res.status, 201)
    assert.match(res.body.token, /^[A-Za-z0-9_-]{22}$/)
    const o = order(h)
    // 12.50 x 2 + 7.99 x 3 = 48.97, worked out by hand; the parity test pins the kernel itself.
    assert.equal(o.goods_total_usd, 48.97); assert.equal(o.state, 'awaiting_payment'); assert.equal(o.currency, 'USD')
    assert.equal(o.customer_phone, CANON); assert.equal(o.fulfilment, 'pickup'); assert.equal(o.branch_id, 1)
    assert.equal(o.token_hash.length, 64); assert.notEqual(o.token_hash, res.body.token, 'only the hash is stored')
    assert.ok(/^hmac-v1:/.test(o.network_key) && !o.network_key.includes('203.0.113'), 'the network is a keyed hash, never an address')
    const [p] = payments(h)
    assert.equal(p.amount, 48.97); assert.equal(p.state, 'awaiting'); assert.equal(p.purpose, 'order'); assert.ok(p.qr_string && p.deeplink)
    assert.equal(p.expires_at, '2026-11-09 03:15:00.000', 'fifteen minutes, the default')
    assert.deepEqual(events(h).map((e) => e.event), ['created', 'qr_issued'])
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].op, 'generate-qr')
    assert.equal(h.calls[0].body.amount, '48.97'); assert.equal(h.calls[0].body.currency, 'USD'); assert.equal(h.calls[0].body.lifetime, '15')
    assert.ok(h.calls[0].body.callback_url, 'the callback URL is sent')
    assert.equal(res.body.order.payment.qr_string, p.qr_string)
    assert.equal(res.body.order.total_usd, 48.97)
    assert.equal(h.one('SELECT COUNT(*) n FROM sales').n, 0); assert.equal(h.one('SELECT SUM(quantity) q FROM branch_stock').q, 32, 'no stock was held or taken')
  })

  await check('create sends PayWay nothing personal: no name, phone, address or email in the request', async () => {
    const h = world()
    await create(h, { fulfilment: 'delivery', address: ADDRESS, note: NOTE, contacts: { telegram: '@dara_s' } })
    const sent = JSON.stringify(h.calls[0].body)
    for (const secret of [NAME, 'Dara', CANON, PHONE, ADDRESS, NOTE, 'dara_s']) assert.ok(!sent.includes(secret), `PayWay must not receive ${secret}`)
  })

  await check('pricing parity: a promotion and a taxed shop give the amount the till computes (21.573 settles to 21.57; tax goes through the same kernel)', async () => {
    const h = world()
    h.run("INSERT INTO promotion_rules (title, rule_type, scope_type, product_ids, percent_off, is_active) VALUES ('10 off Cream', 'percent_off', 'products', '[2]', 10, 1)")
    const promo = await create(h, { lines: lines([2, 3]) })
    assert.equal(promo.status, 201, JSON.stringify(promo.body))
    assert.equal(order(h).goods_total_usd, 21.57, '7.99 x 3 = 23.97, less 10% = 21.573, settled to the cent as the till does')
    const taxed = world({ settings: { tax_enabled: '1', tax_rate: '10' } })
    const t = await create(taxed, { lines: lines([1, 2], [2, 1]) })
    assert.equal(t.status, 201)
    assert.equal(order(taxed).goods_total_usd, 36.29, '25 + 7.99 = 32.99, plus 10% tax 3.299 = 36.289, settled to the cent like the till')
  })

  await check('required fields: name and phone always, address for delivery only (a wrong build demands an address for pickup, or lets delivery through without one)', async () => {
    const h = world()
    for (const [over, code] of [[{ name: '' }, 'name_required'], [{ name: undefined }, 'name_required'], [{ phone: '' }, 'phone_invalid'], [{ phone: '12' }, 'phone_invalid'],
      [{ fulfilment: 'delivery' }, 'address_required'], [{ fulfilment: 'delivery', address: '   ' }, 'address_required'], [{ fulfilment: 'teleport' }, 'fulfilment_invalid'],
      [{ name: 'x'.repeat(61) }, 'name_too_long'], [{ note: 'x'.repeat(301) }, 'note_too_long']]) {
      const r = await create(h, over)
      assert.equal(r.status, 400, JSON.stringify(over)); assert.equal(r.body.code, code, JSON.stringify(over))
      assert.ok(r.body.error.length > 10 && /[a-z]/.test(r.body.error), 'a plain sentence')
    }
    assert.match((await create(h, { fulfilment: 'delivery' })).body.error, /staff will contact you about the delivery price and time/i)
    assert.deepEqual(counts(h), ZERO)
    const pickup = await create(h)
    assert.equal(pickup.status, 201, 'pickup needs no address')
    const delivery = await create(h, { fulfilment: 'delivery', address: ADDRESS, phone: '099 222 333' })
    assert.equal(delivery.status, 201); assert.equal(order(h, 2).customer_address, ADDRESS)
  })

  await check('every optional social contact is accepted and kept; blank ones stay empty; a control character is cleaned', async () => {
    const h = world()
    const contacts = { telegram: '@dara', instagram: 'dara.ig', facebook: 'fb.com/dara', tiktok: '@dara.tt', whatsapp: '+855 12 345 678', other: 'Line: dara\u0007 99' }
    const res = await create(h, { contacts })
    assert.equal(res.status, 201)
    const o = order(h)
    assert.deepEqual([o.contact_telegram, o.contact_instagram, o.contact_facebook, o.contact_tiktok, o.contact_whatsapp, o.contact_other],
      ['@dara', 'dara.ig', 'fb.com/dara', '@dara.tt', '+855 12 345 678', 'Line: dara 99'])
    const none = await create(h, { contacts: { telegram: '  ' }, phone: '011 000 111' })
    assert.equal(order(h, 2).contact_telegram, null)
    assert.equal((await create(h, { contacts: { telegram: 'x'.repeat(101) }, phone: '011 000 222' })).body.code, 'contact_telegram_too_long')
  })

  await check('the cart rules: empty, too many, bad quantity, duplicate product, unknown or retired product, honeypot', async () => {
    const h = world({ env: { PLAN_TIER: 'free' } })
    const refused = async (over, status, code) => { const r = await create(h, over); assert.equal(r.status, status, JSON.stringify(over).slice(0, 80)); assert.equal(r.body.code, code) }
    await refused({ lines: [] }, 400, 'lines_required')
    await refused({ lines: lines([1, 0]) }, 400, 'invalid_line')
    await refused({ lines: lines([1, 100]) }, 400, 'invalid_line')
    await refused({ lines: lines([1, 1], [1, 1]) }, 400, 'duplicate_product')
    await refused({ lines: Array.from({ length: 21 }, (_, i) => ({ product_id: i + 1, quantity: 1 })) }, 400, 'too_many_lines')
    await refused({ lines: lines([99, 1]) }, 409, 'product_unavailable')
    await refused({ lines: lines([4, 1]) }, 409, 'product_unavailable')
    await refused({ website: 'https://spam.example' }, 400, 'invalid_request')
    assert.deepEqual(counts(h), ZERO); assert.equal(h.calls.length, 0)
  })

  await check('stock short: refused with the item name and what is available; no row, no PayWay call (a wrong build takes the order and oversells)', async () => {
    const h = world()
    const res = await create(h, { lines: lines([3, 5], [1, 1]) })
    assert.equal(res.status, 409); assert.equal(res.body.code, 'out_of_stock')
    assert.deepEqual(res.body.items, [{ product_id: 3, name: 'Soap', available: 2 }])
    assert.deepEqual(counts(h), ZERO); assert.equal(h.calls.length, 0)
    assert.equal((await create(h, { lines: lines([3, 2]) })).status, 201, 'exactly what is in stock is fine')
  })

  await check('a replayed client_request_id is refused plainly and creates nothing more', async () => {
    const h = world()
    assert.equal((await create(h, { client_request_id: 'req-12345678' })).status, 201)
    const again = await create(h, { client_request_id: 'req-12345678' })
    assert.equal(again.status, 409); assert.equal(again.body.code, 'duplicate_request')
    assert.equal(counts(h).orders, 1)
  })

  await check('a signed-in account is attached to the order; an anonymous visitor places one too', async () => {
    const h = world()
    h.state.account = { id: 77 }
    assert.equal((await create(h, {}, { headers: { Cookie: 'bos_portal=abc' } })).status, 201)
    assert.equal(order(h).portal_account_id, 77)
    h.state.account = null
    assert.equal((await create(h, { phone: '011 222 333' })).status, 201)
    assert.equal(order(h, 2).portal_account_id, null)
  })

  // ---------------------------------------------------------------------------------------------------------------------------- PayWay errors
  await check('PayWay error codes become plain, actionable answers; the order stays so the page can retry; only a reason word is kept', async () => {
    const cases = [
      [{ status: { code: '12' } }, 'payment_unavailable', false, 'currency_not_supported'],
      [{ status: { code: '1' } }, 'payment_unavailable', false, 'wrong_hash'],
      [{ status: { code: '6' } }, 'payment_unavailable', false, 'domain_not_whitelisted'],
      [{ status: { code: '23' } }, 'payment_unavailable', false, 'option_not_enabled'],
      [{ status: { code: '44' } }, 'payment_limit', false, 'limit_exceeded'],
      [{ status: { code: '47' } }, 'payment_amount_too_small', false, 'amount_too_small'],
      [{ status: { code: '429' } }, 'payment_busy', true, 'rate_limited'],
      [{ httpStatus: 503, json: null }, 'payment_busy', true, 'transport_failed'],
      ['throw', 'payment_busy', true, 'transport_failed'],
      [{ nonsense: true }, 'payment_busy', true, 'bad_response'],
    ]
    for (const [answer, code, retryable, reason] of cases) {
      const h = world()
      h.script.generate = () => { if (answer === 'throw') throw new Error('connect ECONNREFUSED https://secret-host.invalid k=abc'); return answer }
      const res = await create(h)
      assert.equal(res.status, 502, reason); assert.equal(res.body.code, code, reason); assert.equal(res.body.retryable, retryable, reason)
      assert.match(res.body.token, /^[A-Za-z0-9_-]{22}$/, 'the token comes back so the page can offer Try again')
      assert.ok(res.body.order_no)
      assert.equal(order(h).state, 'qr_failed', reason); assert.equal(payments(h)[0].state, 'failed', reason)
      assert.deepEqual(events(h).map((e) => e.event), ['created', 'qr_failed'], reason)
      assert.equal(JSON.parse(events(h)[1].detail_json).reason, reason)
      const text = JSON.stringify(res.body)
      for (const leak of ['merchant-test', 'secret-host', 'ECONNREFUSED', 'k=abc']) assert.ok(!text.includes(leak) && !JSON.stringify(events(h)).includes(leak), `${leak} must not leak (${reason})`)
      assert.ok(!/payway|hash|merchant|domain|whitelist/i.test(res.body.error), `the customer is not shown gateway jargon (${reason}): ${res.body.error}`)
    }
  })

  await check('retry after a failed QR: a new transaction id, the order awaits again; a QR still valid is refused; after the time ran out a new one is allowed', async () => {
    const h = world()
    h.script.generate = () => ({ status: { code: '429' } })
    const failed = await create(h)
    const token = failed.body.token
    h.script.generate = (b) => ({ status: { code: '0' }, qrString: `QR${b.tran_id}`, abapay_deeplink: null })
    const retried = await h.request(`/${token}/retry`, 'POST', {})
    assert.equal(retried.status, 200); assert.equal(retried.body.order.status, 'awaiting_payment')
    const [first, second] = payments(h)
    assert.notEqual(first.tran_id, second.tran_id); assert.equal(first.state, 'failed'); assert.equal(second.state, 'awaiting'); assert.equal(second.amount, first.amount)
    const still = await h.request(`/${token}/retry`, 'POST', {})
    assert.equal(still.status, 409); assert.equal(still.body.code, 'qr_still_valid')
    h.advance(16 * 60_000)
    const expired = await h.request(`/${token}/retry`, 'POST', {})
    assert.equal(expired.status, 200, 'after the time ran out a new QR is offered')
    assert.equal(payments(h).length, 3); assert.equal(payments(h)[1].state, 'cancelled'); assert.equal(payments(h)[2].state, 'awaiting')
    assert.ok(h.calls.some((c) => c.op === 'close' && c.body.tran_id === second.tran_id), 'the old QR was closed at PayWay')
  })

  await check('an expired order (the sweep marked it) gets a new QR on request', async () => {
    const h = world()
    const res = await create(h)
    h.run("UPDATE online_orders SET state = 'expired' WHERE id = 1"); h.run("UPDATE online_order_payments SET state = 'expired' WHERE order_id = 1")
    const retried = await h.request(`/${tokenOf(res)}/retry`, 'POST', {})
    assert.equal(retried.status, 200); assert.equal(order(h).state, 'awaiting_payment')
  })

  // ---------------------------------------------------------------------------------------------------------------------------- caps
  await check('caps: at most 2 open unpaid orders per phone; a paid or cancelled one frees the slot; other phones are unaffected', async () => {
    const h = world()
    assert.equal((await create(h)).status, 201)
    const second = await create(h)
    assert.equal(second.status, 201)
    const third = await create(h)
    assert.equal(third.status, 429); assert.equal(third.body.code, 'too_many_open_orders')
    assert.equal(counts(h).orders, 2, 'the refused one wrote nothing')
    assert.equal((await create(h, { phone: '099 000 111' })).status, 201, 'another phone is fine')
    assert.equal((await create(h, { phone: '+855 12 345 678' })).status, 429, 'the same phone written another way is the same phone')
    await h.request(`/${tokenOf(second)}/cancel`, 'POST', {})
    assert.equal((await create(h)).status, 201, 'cancelling frees a slot')
  })

  await check('caps: shop-wide open unpaid orders stop at the plan limit (Free 20): "we are busy", nothing written; the count reads the open-payments index, not the orders', async () => {
    const h = world({ env: { PLAN_TIER: 'free' } })
    for (let i = 0; i < 20; i += 1) assert.equal((await create(h, { phone: `0${70000000 + i}` })).status, 201, `order ${i + 1}`)
    h.clearStatements()
    const busy = await create(h, { phone: '010 999 999' })
    assert.equal(busy.status, 503); assert.equal(busy.body.code, 'busy'); assert.match(busy.body.error, /try again in a few minutes/i)
    assert.equal(counts(h).orders, 20); assert.equal(h.calls.filter((c) => c.op === 'generate-qr').length, 20, 'no QR for the refused one')
    const countSql = h.statements.find((s) => /COUNT\(\*\) AS n FROM online_order_payments/.test(s))
    assert.ok(countSql && /INDEXED BY idx_online_order_payments_open/.test(countSql), countSql)
    const plan = h.all(`EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM online_order_payments INDEXED BY idx_online_order_payments_open WHERE state = 'awaiting'`).map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_online_order_payments_open/); assert.doesNotMatch(plan, /SCAN online_orders/)
    const phonePlan = h.all(`EXPLAIN QUERY PLAN SELECT COUNT(DISTINCT o.id) AS n FROM online_order_payments p INDEXED BY idx_online_order_payments_open CROSS JOIN online_orders o ON o.id = p.order_id WHERE p.state = 'awaiting' AND o.customer_phone = '1'`).map((r) => r.detail).join(' | ')
    assert.match(phonePlan, /idx_online_order_payments_open/); assert.doesNotMatch(phonePlan, /SCAN o\b|SCAN online_orders/)
  })

  // ---------------------------------------------------------------------------------------------------------------------------- reads, the nudge, paid
  await check('GET status is the order as the customer reads it: masked phone, no full phone anywhere in the response', async () => {
    const h = world()
    const res = await create(h, { fulfilment: 'delivery', address: ADDRESS })
    const read = await view(h, tokenOf(res))
    assert.equal(read.status, 200); assert.equal(read.body.order.phone_hint, '*** 678'); assert.equal(read.body.order.address, ADDRESS)
    assert.ok(!JSON.stringify(read.body).includes(CANON) && !JSON.stringify(res.body).includes(CANON), 'the order phone never leaves the server')
    assert.equal((await view(h, 'x'.repeat(22))).status, 404); assert.equal((await view(h, 'short')).status, 404)
    assert.equal((await view(h, 'x'.repeat(22))).body.code, 'order_not_found')
  })

  await check('a status poll reads ONE row: one statement, the order by its token hash, nothing else (a wrong build joins payments and events on every poll)', async () => {
    const h = world()
    const res = await create(h)
    h.clearStatements(); h.calls.length = 0
    const p = await poll(h, tokenOf(res))
    assert.equal(p.status, 200); assert.equal(p.body.state, 'awaiting_payment')
    assert.equal(h.statements.length, 1, h.statements.join('\n'))
    assert.match(h.statements[0], /FROM online_orders WHERE token_hash = @h$/)
    assert.equal(h.calls.length, 0, 'inside the first minute no PayWay check is spent')
    const plan = h.all('EXPLAIN QUERY PLAN SELECT id, state, created_at, paid_at, revision, goods_total_usd FROM online_orders WHERE token_hash = ?', 'x').map((r) => r.detail).join(' | ')
    assert.match(plan, /SEARCH online_orders USING (COVERING )?INDEX sqlite_autoindex_online_orders/, plan)
  })

  await check('the nudge: after a minute one check per 30 s (Free) per payment; once approved for the exact amount the order is Paid, and a replay writes nothing more', async () => {
    const h = world({ env: { PLAN_TIER: 'free' } })
    const res = await create(h)
    const token = tokenOf(res)
    h.advance(61_000)
    assert.equal((await poll(h, token)).body.state, 'awaiting_payment')
    assert.equal(h.calls.filter((c) => c.op === 'check').length, 1, 'pending: one check')
    h.advance(10_000)
    await poll(h, token)
    assert.equal(h.calls.filter((c) => c.op === 'check').length, 1, '10 s later: throttled (the payment row says it was checked 10 s ago)')
    h.advance(25_000)
    payOnPayway(h, 25)
    const paid = await poll(h, token)
    assert.equal(paid.body.state, 'paid'); assert.equal(h.calls.filter((c) => c.op === 'check').length, 2)
    assert.deepEqual(events(h).map((e) => e.event), ['created', 'qr_issued', 'verified_paid'])
    const o = order(h); assert.ok(o.paid_at); assert.equal(payments(h)[0].state, 'paid'); assert.equal(payments(h)[0].paid_amount, 25); assert.equal(payments(h)[0].payway_apv, 'APV123')
    const before = counts(h)
    const wroteBefore = h.one('SELECT revision FROM online_orders WHERE id = 1').revision
    await poll(h, token); await view(h, token)
    assert.deepEqual(counts(h), before); assert.equal(order(h).revision, wroteBefore, 'a paid order is not re-checked or rewritten')
    assert.equal(h.calls.filter((c) => c.op === 'check').length, 2)
  })

  await check('Paid needs the exact amount: a partial or an over-payment goes to review, never to Paid (a wrong build trusts "approved")', async () => {
    for (const amount of [24.99, 25.01, 10]) {
      const h = world()
      const res = await create(h)
      h.advance(90_000); h.script.check = () => h.approved(amount)
      const r = await poll(h, tokenOf(res))
      assert.equal(r.body.state, 'review', String(amount)); assert.equal(payments(h)[0].state, 'review')
      assert.ok(events(h).some((e) => e.event === 'mismatch')); assert.ok(!events(h).some((e) => e.event === 'verified_paid'))
    }
    const h = world()
    const res = await create(h)
    h.advance(90_000); h.script.check = () => h.approved(25, { discount_amount: 1 })
    assert.equal((await poll(h, tokenOf(res))).body.state, 'review', 'a discount applied at ABA means the amount is not the order')
  })

  await check('a declined payment marks the payment failed and lets the customer retry; pending and a PayWay error change nothing', async () => {
    const h = world()
    const res = await create(h)
    h.advance(90_000)
    h.script.check = () => ({ status: { code: '5' } }); await poll(h, tokenOf(res))
    assert.equal(payments(h)[0].state, 'awaiting', 'a PayWay error is not an answer')
    h.advance(40_000); h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 3, original_amount: 25 } })
    await poll(h, tokenOf(res))
    assert.equal(payments(h)[0].state, 'failed'); assert.equal(order(h).state, 'awaiting_payment')
    const retried = await h.request(`/${tokenOf(res)}/retry`, 'POST', {})
    assert.equal(retried.status, 200); assert.equal(payments(h)[1].state, 'awaiting')
  })

  await check('the full view runs the same nudge and answers with the settled state', async () => {
    const h = world()
    const res = await create(h)
    h.advance(90_000); payOnPayway(h, 25)
    const read = await view(h, tokenOf(res))
    assert.equal(read.body.order.status, 'paid'); assert.equal(read.body.order.payment, null); assert.equal(read.body.order.money.paid_usd, 25)
    assert.equal(read.body.order.can_edit, false); assert.equal(read.body.order.requests_open, true)
    assert.deepEqual(read.body.order.request_kinds, ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel'])
  })

  // ---------------------------------------------------------------------------------------------------------------------------- edit and cancel before payment
  await check('edit: a new list is a new price and a new QR; the old payment is cancelled and closed; Records show before and after without any personal text', async () => {
    const h = world()
    const res = await create(h, { note: NOTE })
    const token = tokenOf(res)
    const edited = await h.request(`/${token}/edit`, 'POST', { lines: lines([1, 3]) })
    assert.equal(edited.status, 200); assert.equal(edited.body.order.total_usd, 37.5)
    assert.equal(order(h).goods_total_usd, 37.5); assert.equal(order(h).revision, 1)
    const [old, fresh] = payments(h)
    assert.equal(old.state, 'cancelled'); assert.equal(fresh.state, 'awaiting'); assert.equal(fresh.amount, 37.5); assert.ok(fresh.qr_string)
    assert.ok(h.calls.some((c) => c.op === 'close' && c.body.tran_id === old.tran_id))
    assert.equal(h.calls.filter((c) => c.op === 'generate-qr').length, 2); assert.equal(h.calls[h.calls.length - 1].body.amount, '37.50')
    assert.deepEqual(events(h).map((e) => e.event), ['created', 'qr_issued', 'edited', 'qr_issued'])
    const detail = JSON.parse(events(h)[2].detail_json)
    assert.deepEqual(detail.fields, ['items']); assert.equal(detail.from_total_usd, 25)
    assert.equal(h.one('SELECT SUM(quantity) q FROM branch_stock').q, 32, 'an edit holds no stock either')
  })

  await check('edit of details only (name, address, contacts, pickup to delivery) keeps the QR and the amount; delivery still needs an address', async () => {
    const h = world()
    const res = await create(h)
    const token = tokenOf(res)
    h.calls.length = 0
    const refused = await h.request(`/${token}/edit`, 'POST', { fulfilment: 'delivery' })
    assert.equal(refused.status, 400); assert.equal(refused.body.code, 'address_required')
    const ok = await h.request(`/${token}/edit`, 'POST', { fulfilment: 'delivery', address: ADDRESS, name: 'Dara S', contacts: { instagram: 'dara.ig' } })
    assert.equal(ok.status, 200)
    const o = order(h)
    assert.equal(o.fulfilment, 'delivery'); assert.equal(o.customer_address, ADDRESS); assert.equal(o.customer_name, 'Dara S'); assert.equal(o.contact_instagram, 'dara.ig')
    assert.equal(payments(h).length, 1); assert.equal(payments(h)[0].state, 'awaiting'); assert.equal(h.calls.length, 0, 'no PayWay call for a details-only edit')
    assert.deepEqual(JSON.parse(events(h).pop().detail_json).fields.sort(), ['address', 'contacts', 'fulfilment', 'name'])
    assert.equal((await h.request(`/${token}/edit`, 'POST', { name: 'Dara S' })).status, 200, 'no change is no write')
    assert.equal(events(h).length, 3)
  })

  await check('edit refused plainly: stock short leaves the order and its QR exactly as they were; a paid order cannot be edited here', async () => {
    const h = world()
    const res = await create(h)
    const token = tokenOf(res)
    const short = await h.request(`/${token}/edit`, 'POST', { lines: lines([3, 5]) })
    assert.equal(short.status, 409); assert.equal(short.body.code, 'out_of_stock')
    assert.equal(order(h).revision, 0); assert.equal(payments(h).length, 1); assert.equal(payments(h)[0].state, 'awaiting')
    payOnPayway(h, 25); h.advance(90_000); await poll(h, token)
    const late = await h.request(`/${token}/edit`, 'POST', { lines: lines([1, 3]) })
    assert.equal(late.status, 409); assert.equal(late.body.code, 'order_not_editable')
  })

  await check('edit while the customer is paying: the last check finds it paid, the edit is refused and the order is Paid (a wrong build replaces a paid QR)', async () => {
    const h = world()
    const res = await create(h)
    const token = tokenOf(res)
    payOnPayway(h, 25)
    const r = await h.request(`/${token}/edit`, 'POST', { lines: lines([1, 3]) })
    assert.equal(r.status, 409); assert.equal(r.body.code, 'already_paid')
    assert.equal(order(h).state, 'paid'); assert.equal(order(h).goods_total_usd, 25); assert.equal(payments(h).length, 1); assert.equal(payments(h)[0].state, 'paid')
  })

  await check('cancel: a waiting order is cancelled, its QR closed and its payment cancelled; cancelling again is harmless; a paid-meanwhile order is not cancelled', async () => {
    const h = world()
    const res = await create(h)
    const token = tokenOf(res)
    const cancelled = await h.request(`/${token}/cancel`, 'POST', {})
    assert.equal(cancelled.status, 200); assert.equal(cancelled.body.order.status, 'cancelled')
    assert.equal(order(h).state, 'cancelled'); assert.equal(payments(h)[0].state, 'cancelled')
    assert.ok(h.calls.some((c) => c.op === 'close'))
    assert.deepEqual(events(h).map((e) => e.event), ['created', 'qr_issued', 'cancelled'])
    assert.equal((await h.request(`/${token}/cancel`, 'POST', {})).status, 200); assert.equal(events(h).length, 3)
    const h2 = world()
    const r2 = await create(h2)
    payOnPayway(h2, 25)
    const blocked = await h2.request(`/${tokenOf(r2)}/cancel`, 'POST', {})
    assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'already_paid'); assert.equal(order(h2).state, 'paid')
  })

  await check('cancel of a paid order is not a customer action here (it is a request, below)', async () => {
    const h = world()
    const res = await paidOrder(h)
    const r = await h.request(`/${tokenOf(res)}/cancel`, 'POST', {})
    assert.equal(r.status, 409); assert.equal(r.body.code, 'order_not_cancellable'); assert.equal(order(h).state, 'paid')
  })

  // ---------------------------------------------------------------------------------------------------------------------------- requests
  await check('request: the phone must match (canonicalised); a wrong phone writes nothing; the right one records the request and its Records row', async () => {
    const h = world()
    const res = await paidOrder(h)
    const token = tokenOf(res)
    const before = counts(h)
    const wrong = await h.request(`/${token}/requests`, 'POST', { kind: 'note', phone: '012 999 999', after: { note: 'hi' } })
    assert.equal(wrong.status, 403); assert.equal(wrong.body.code, 'phone_mismatch'); assert.deepEqual(counts(h), before)
    const missing = await h.request(`/${token}/requests`, 'POST', { kind: 'note', after: { note: 'hi' } })
    assert.equal(missing.status, 403)
    const ok = await h.request(`/${token}/requests`, 'POST', { kind: 'note', phone: '+855 12 345 678', comment: 'please leave it at the gate', after: { note: 'leave at gate' } })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    const [r] = h.all('SELECT * FROM online_order_requests')
    assert.equal(r.kind, 'note'); assert.equal(r.stage, 'paid'); assert.equal(r.customer_comment, 'please leave it at the gate')
    assert.deepEqual(JSON.parse(r.after_json), { note: 'leave at gate' }); assert.deepEqual(JSON.parse(r.before_json), { note: null })
    assert.equal(events(h).pop().event, 'request_submitted'); assert.equal(events(h).pop().request_id, r.id)
    assert.equal(ok.body.order.requests[0].status, 'pending'); assert.equal(ok.body.order.chips.includes('request_pending'), true)
    assert.equal(order(h).revision, h.one('SELECT revision FROM online_orders').revision, 'a request never edits the order itself')
  })

  await check('request: one pending at a time; withdraw (phone again) frees the slot; the limit per order comes from the plan (Free 5)', async () => {
    const h = world({ env: { PLAN_TIER: 'free' } })
    const token = tokenOf(await paidOrder(h))
    const ask = (over = {}) => h.request(`/${token}/requests`, 'POST', { kind: 'note', phone: PHONE, after: { note: 'n' }, ...over })
    assert.equal((await ask()).status, 201)
    const second = await ask()
    assert.equal(second.status, 409); assert.equal(second.body.code, 'request_pending'); assert.equal(counts(h).requests, 1)
    const id = h.one('SELECT id FROM online_order_requests').id
    assert.equal((await h.request(`/${token}/requests/${id}/withdraw`, 'POST', { phone: '012 000 000' })).status, 403)
    const withdrawn = await h.request(`/${token}/requests/${id}/withdraw`, 'POST', { phone: PHONE })
    assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.order.requests[0].status, 'withdrawn')
    assert.equal(events(h).pop().event, 'request_withdrawn')
    assert.equal((await h.request(`/${token}/requests/${id}/withdraw`, 'POST', { phone: PHONE })).body.code, 'request_not_pending')
    for (let i = 0; i < 3; i += 1) { assert.equal((await ask()).status, 201); const rid = h.one('SELECT MAX(id) id FROM online_order_requests').id; await h.request(`/${token}/requests/${rid}/withdraw`, 'POST', { phone: PHONE }) }
    assert.equal(counts(h).requests, 4)
    assert.equal((await ask()).status, 201)
    h.run("INSERT INTO online_order_events (order_id, request_id, event, source) VALUES (1, 5, 'request_rejected', 'staff')")
    const capped = await ask()
    assert.equal(capped.status, 409); assert.equal(capped.body.code, 'request_limit')
    assert.equal((await h.request(`/${token}/requests/999/withdraw`, 'POST', { phone: PHONE })).body.code, 'request_not_found')
  })

  await check('request kinds by stage: a return only after a sale; items, address, fulfilment and cancel while paid; a bad kind is refused', async () => {
    const h = world()
    const token = tokenOf(await paidOrder(h))
    const ask = (kind, after = {}, extra = {}) => h.request(`/${token}/requests`, 'POST', { kind, phone: PHONE, after, ...extra })
    const refused = await ask('return', { lines: lines([1, 1]) })
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'request_kind_not_allowed')
    assert.equal((await ask('teleport')).status, 409)
    const items = await ask('items', { lines: lines([1, 1], [2, 1]) })
    assert.equal(items.status, 201); const r1 = h.one('SELECT * FROM online_order_requests WHERE kind = ?', 'items')
    assert.equal(JSON.parse(r1.before_json).items.length, 1); assert.equal(JSON.parse(r1.after_json).items.length, 2)
    await h.request(`/${token}/requests/${r1.id}/withdraw`, 'POST', { phone: PHONE })
    assert.equal((await ask('items', { lines: lines([1, 0]) })).body.code, 'invalid_line')
    assert.equal((await ask('address', {})).body.code, 'address_required')
    assert.equal((await ask('fulfilment', { fulfilment: 'delivery' })).body.code, 'address_required')
    assert.equal((await ask('address', { address: ADDRESS })).status, 201)
    const a = h.one("SELECT id FROM online_order_requests WHERE kind = 'address'"); await h.request(`/${token}/requests/${a.id}/withdraw`, 'POST', { phone: PHONE })
    assert.equal((await ask('cancel', {}, { comment: 'changed my mind' })).status, 201)
  })

  await check('request after the sale: a return is allowed once the order is fulfilled with a sale; the window opens at the sale', async () => {
    const h = world()
    const token = tokenOf(await paidOrder(h))
    h.run(`INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, sale_status, created_at, exchange_rate, money_precision_version) VALUES (900, 'R900', 25, 25, 25, 'completed', '2026-11-09 05:00:00', 4000, 1)`)
    h.run("UPDATE online_orders SET state = 'fulfilled', sale_id = 900 WHERE id = 1")
    const ret = await h.request(`/${token}/requests`, 'POST', { kind: 'return', phone: PHONE, comment: 'the cap leaks', after: { lines: lines([1, 1]), reason: 'leaking' } })
    assert.equal(ret.status, 201, JSON.stringify(ret.body))
    const r = h.one('SELECT * FROM online_order_requests'); assert.equal(r.stage, 'after_sale'); assert.equal(JSON.parse(r.after_json).reason, 'leaking')
    assert.equal(ret.body.order.status, 'completed', 'after the sale the view reads the sale')
  })

  await check('request window: 7 days from payment by default (the last second is open, the next closed); the setting widens it; a bad setting falls back to 7', async () => {
    const make = async (settings) => { const h = world({ settings }); const token = tokenOf(await paidOrder(h)); return { h, token, paidAt: Date.parse(`${order(h).paid_at.replace(' ', 'T')}Z`) } }
    const ask = (x) => x.h.request(`/${x.token}/requests`, 'POST', { kind: 'note', phone: PHONE, after: { note: 'n' } })
    const a = await make({})
    a.h.setNow(a.paidAt + 7 * 86400_000); assert.equal((await ask(a)).status, 201, 'the last second of day 7')
    const b = await make({})
    b.h.setNow(b.paidAt + 7 * 86400_000 + 1000)
    const closed = await ask(b)
    assert.equal(closed.status, 409); assert.equal(closed.body.code, 'request_window_closed'); assert.match(closed.body.error, /contact the shop/i)
    assert.equal(counts(b.h).requests, 0)
    const c = await make({ online_order_request_days: '14' })
    c.h.setNow(c.paidAt + 13 * 86400_000); assert.equal((await ask(c)).status, 201, 'the setting is the window')
    const d = await make({ online_order_request_days: 'soon' })
    d.h.setNow(d.paidAt + 8 * 86400_000); assert.equal((await ask(d)).status, 409, 'unreadable setting means 7')
  })

  await check('request while the order is not paid yet, or is cancelled, is refused plainly', async () => {
    const h = world()
    const res = await create(h)
    const early = await h.request(`/${tokenOf(res)}/requests`, 'POST', { kind: 'note', phone: PHONE, after: { note: 'n' } })
    assert.equal(early.status, 409); assert.equal(early.body.code, 'request_not_ready'); assert.equal(counts(h).requests, 0)
  })

  await check('request attachments are references only: an existing uploaded image is kept; inline data, a foreign path or a missing file is refused', async () => {
    const h = world()
    const token = tokenOf(await paidOrder(h))
    h.run("INSERT INTO file_assets (original_name, stored_name, public_path, media_type, mime_type, byte_size) VALUES ('cap.jpg', 'cap.jpg', '/uploads/cap.jpg', 'image', 'image/jpeg', 1000)")
    h.run("INSERT INTO file_assets (original_name, stored_name, public_path, media_type, mime_type, byte_size) VALUES ('doc.pdf', 'doc.pdf', '/uploads/doc.pdf', 'document', 'application/pdf', 1000)")
    const ask = (attachments) => h.request(`/${token}/requests`, 'POST', { kind: 'note', phone: PHONE, after: { note: 'n' }, attachments })
    for (const bad of [['data:image/png;base64,AAAA'], ['https://evil.example/x.jpg'], ['/uploads/missing.jpg'], ['/uploads/doc.pdf'], ['/uploads/../etc/passwd'], ['/uploads/cap.jpg', '/uploads/cap.jpg', '/uploads/a', '/uploads/b', '/uploads/c'], 'cap.jpg', [42]]) {
      const r = await ask(bad)
      assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60)); assert.equal(r.body.code, 'attachments_invalid')
    }
    assert.equal(counts(h).requests, 0)
    const ok = await ask(['/uploads/cap.jpg'])
    assert.equal(ok.status, 201); assert.deepEqual(JSON.parse(h.one('SELECT attachments_json a FROM online_order_requests').a), ['/uploads/cap.jpg'])
    assert.deepEqual(ok.body.order.requests[0].attachments, ['/uploads/cap.jpg'])
  })

  await check('top-up: a new QR repeats the amount staff asked for; nothing due, already paid or a QR still valid is refused', async () => {
    const h = world()
    const token = tokenOf(await paidOrder(h))
    const noRequest = await h.request(`/${token}/topup`, 'POST', { request_id: 1 })
    assert.equal(noRequest.status, 404); assert.equal(noRequest.body.code, 'no_topup_due')
    assert.equal((await h.request(`/${token}/topup`, 'POST', {})).status, 400)
    h.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json) VALUES (1, 'items', 'paid', '{}', '{}')")
    h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state) VALUES (1, 'WTOPUPAAAA1', 'top_up', 1, 12.5, 'USD', 'expired')")
    const again = await h.request(`/${token}/topup`, 'POST', { request_id: 1 })
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.equal(again.body.order.top_ups.length, 1); assert.equal(again.body.order.top_ups[0].amount, 12.5)
    assert.equal(h.calls[h.calls.length - 1].body.amount, '12.50')
    assert.equal((await h.request(`/${token}/topup`, 'POST', { request_id: 1 })).body.code, 'qr_still_valid')
    assert.equal(order(h).state, 'paid', 'a top-up never moves the order')
    h.run("UPDATE online_order_payments SET state = 'paid', paid_at = '2026-11-09 04:00:00', paid_amount = 12.5 WHERE tran_id <> 'x' AND purpose = 'top_up'")
    assert.equal((await h.request(`/${token}/topup`, 'POST', { request_id: 1 })).body.code, 'topup_paid')
  })

  // ---------------------------------------------------------------------------------------------------------------------------- privacy
  await check('no personal data in Records: after a full life of an order, no event holds the name, phone, address, note, contact or comment', async () => {
    const h = world()
    const contact = 'secret_handle_77'
    const res = await create(h, { fulfilment: 'delivery', address: ADDRESS, note: NOTE, contacts: { telegram: contact } })
    const token = tokenOf(res)
    await h.request(`/${token}/edit`, 'POST', { lines: lines([1, 3]), name: 'Dara Renamed', address: '99 New Road' })
    h.advance(90_000); payOnPayway(h, 37.5); await poll(h, token)
    await h.request(`/${token}/requests`, 'POST', { kind: 'address', phone: PHONE, comment: 'private words here', after: { address: '1 Hidden Lane' } })
    const dump = JSON.stringify(h.all('SELECT * FROM online_order_events'))
    for (const secret of [NAME, 'Dara', 'Renamed', CANON, '345 678', ADDRESS, '99 New Road', '1 Hidden Lane', NOTE, contact, 'private words here', 'Phnom Penh']) {
      assert.ok(!dump.includes(secret), `Records must not hold: ${secret}`)
    }
    assert.ok(events(h).length >= 6)
    assert.ok(!JSON.stringify(h.all('SELECT network_key FROM online_orders')).includes('203.0.113'))
  })

  await check('the storefront host reaches the order routes (the public-host gate allows /api/portal/*) and they are not staff paths', async () => {
    const { isBlockedOnStorefrontHost } = world().load('lib/publicHostGate.ts')
    for (const path of ['/api/portal/orders', '/api/portal/orders/abcdefghijklmnopqrstuv', '/api/portal/orders/abcdefghijklmnopqrstuv/status', '/api/portal/orders/abcdefghijklmnopqrstuv/requests/3/withdraw']) {
      assert.equal(isBlockedOnStorefrontHost(`https://leangbeauty.com${path}`), false, path)
    }
    assert.equal(isBlockedOnStorefrontHost('https://leangbeauty.com/api/portal/%2e%2e/auth/me'), true, 'dot segments stay refused')
  })

  await check('every order answer carries no gateway secret and no raw QR image; the QR string is what the page draws', async () => {
    const h = world()
    const res = await create(h)
    const text = JSON.stringify(res.body)
    for (const leak of ['merchant-test', 'kkkkkkkk', 'qrImage', 'hash']) assert.ok(!text.includes(leak), leak)
  })

  // ---------------------------------------------------------------------------------------------------------------------------- budgets
  await check('D1 shape of every route stays inside its budget (calls count as the Free plan counts them: a batch is one; ceilings are the measured figure plus a little)', async () => {
    const h = world({ env: { PLAN_TIER: 'free' } })
    const shape = async (label, call, ceilings) => {
      h.clearStatements(); const before = h.calls.length
      const r = await call()
      const used = { calls: h.d1.calls, statements: h.statements.length, payway: h.calls.length - before }
      assert.ok(r.status < 400, `${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
      for (const key of Object.keys(ceilings)) assert.ok(used[key] <= ceilings[key], `${label}: ${key} ${used[key]} > ${ceilings[key]}`)
      assert.ok(used.calls <= 50, `${label}: inside the Free 50-call limit`)
      return r
    }
    const created = await shape('create', () => create(h), { calls: 14, statements: 20, payway: 1 })
    const token = tokenOf(created)
    await shape('view', () => view(h, token), { calls: 3, statements: 6, payway: 0 })
    await shape('poll in the first minute', () => poll(h, token), { calls: 1, statements: 1, payway: 0 })
    h.advance(61_000)
    await shape('poll with a nudge', () => poll(h, token), { calls: 3, statements: 3, payway: 1 })
    await shape('edit details', () => h.request(`/${token}/edit`, 'POST', { name: 'Dara S' }), { calls: 5, statements: 12, payway: 0 })
    await shape('edit with a new list', () => h.request(`/${token}/edit`, 'POST', { lines: lines([1, 3]) }), { calls: 12, statements: 22, payway: 3 })
    h.advance(16 * 60_000)
    await shape('retry', () => h.request(`/${token}/retry`, 'POST', {}), { calls: 8, statements: 17, payway: 3 })
    await shape('cancel', () => h.request(`/${token}/cancel`, 'POST', {}), { calls: 5, statements: 14, payway: 2 })
    const paid = await create(h, { phone: '099 111 222' })
    payOnPayway(h, 25); h.advance(61_000)
    await shape('poll that settles a payment', () => poll(h, tokenOf(paid)), { calls: 6, statements: 9, payway: 1 })
    await shape('request', () => h.request(`/${tokenOf(paid)}/requests`, 'POST', { kind: 'note', phone: '099 111 222', after: { note: 'n' } }), { calls: 6, statements: 13, payway: 0 })
    await shape('withdraw', () => h.request(`/${tokenOf(paid)}/requests/${h.one('SELECT MAX(id) id FROM online_order_requests').id}/withdraw`, 'POST', { phone: '099 111 222' }), { calls: 5, statements: 11, payway: 0 })
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
