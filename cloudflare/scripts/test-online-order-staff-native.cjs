// KHQR S5: the staff API for online orders (routes/onlineOrders.ts + lib/onlineOrderStaff.ts) on the real migration chain, with PayWay scripted. Each scenario
// names the wrong implementation it must turn red on; the mutation run is recorded in LANE-KHQR.md.
//
// Run: node scripts/test-online-order-staff-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)
const MIN = 60_000
const PHONE = '012 345 678'

const user = (id, name, permissions, extra = {}) => ({ id, name, username: name.toLowerCase(), permissions: JSON.stringify(permissions), role_permissions: null, role_code: null, ...extra })
const ADMIN = user(1, 'Owner', { all: true }, { role_code: 'admin' })
const VIEWER = user(2, 'Viewer', { online_orders: true, 'online_orders:decide': false, 'online_orders:refund': false })
const DECIDER = user(3, 'Decider', { online_orders: true, 'online_orders:refund': false })
const REFUNDER = user(4, 'Refunder', { online_orders: true, 'online_orders:decide': false })
const FULL = user(5, 'Full', { online_orders: true })
const NOBODY = user(6, 'Nobody', { pos: true })
const DECIDE_ONLY = user(7, 'DecideOnly', { 'online_orders:decide': true })

function world(options = {}) {
  const h = createOrdersHarness({ switchOn: true, spreadNetworks: true, nowMs: T0, ...options })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    for (const [name, price, stock] of [['Serum', 12.5, 50], ['Toner', 8, 3]]) {
      const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, ?)', name, price, price * 4000, stock).lastInsertRowid)
      h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, ?)', id, stock)
    }
  })
  return h
}
let phoneSeq = 0
const place = async (h, over = {}) => {
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: over.phone || `0${12000000 + (phoneSeq += 1)}`, fulfilment: 'pickup', ...over })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res
}
const tranOf = (h, orderId = 1) => h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', orderId).tran_id
const paidOrder = async (h, over = {}) => { const res = await place(h, over); h.script.check = () => h.approved(25); await h.callback(tranOf(h, h.one('SELECT MAX(id) id FROM online_orders').id)); return res }
const order = (h, id = 1) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
const events = (h, id = 1) => h.all('SELECT * FROM online_order_events WHERE order_id = ? ORDER BY id', id)
const names = (h, id = 1) => events(h, id).map((e) => e.event)
const state = (h, id = 1) => order(h, id).state
const money = (h, id = 1) => h.orders.orderMoney(order(h, id), h.all('SELECT * FROM online_order_payments WHERE order_id = ?', id), h.all('SELECT * FROM online_order_events WHERE order_id = ?', id), null)
const ask = (h, as, pathname, method = 'GET', body) => h.staff(pathname, method, body, { as })

async function main() {
  // --------------------------------------------------------------------------------------------------------------- permissions
  await check('permission matrix: every route answers 401 signed out, 403 without the grant, and exactly the right action tier opens each (a wrong build opens all routes to view)', async () => {
    const h = world(); await paidOrder(h)
    const routes = [
      ['GET', '/', undefined, 'view'], ['GET', '/1', undefined, 'view'], ['POST', '/1/recheck', {}, 'view'], ['POST', '/1/note', { note: 'x' }, 'view'],
      ['POST', '/1/cancel', { reason: 'x', revision: 999 }, 'decide'], ['POST', '/1/resolve', { revision: 999 }, 'decide'], ['POST', '/1/refund-note', { amount_usd: 1 }, 'refund'],
      ['POST', '/1/requests/1/decide', { decision: 'accept' }, 'decide'], ['POST', '/1/requests/1/apply', {}, 'decide'],
    ]
    const tiers = { view: [ADMIN, VIEWER, DECIDER, REFUNDER, FULL], decide: [ADMIN, DECIDER, FULL], refund: [ADMIN, REFUNDER, FULL] }
    for (const [method, pathname, body, need] of routes) {
      assert.equal((await ask(h, null, pathname, method, body)).status, 401, `${method} ${pathname} signed out`)
      for (const who of [NOBODY, DECIDE_ONLY]) assert.equal((await ask(h, who, pathname, method, body)).status, 403, `${method} ${pathname} for ${who.name}: an action without the grant opens nothing`)
      for (const who of [ADMIN, VIEWER, DECIDER, REFUNDER, FULL]) {
        const res = await ask(h, who, pathname, method, body)
        if (tiers[need].includes(who)) assert.notEqual(res.status, 403, `${method} ${pathname} must open for ${who.name}`)
        else assert.equal(res.status, 403, `${method} ${pathname} must stay closed for ${who.name}`)
      }
    }
  })

  await check('parity: the access tier each route asks for is written in the route file, and every route has one (a new route cannot slip in unguarded)', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'onlineOrders.ts'), 'utf8')
    const found = [...source.matchAll(/app\.(get|post)\('([^']+)', guard\('(view|decide|refund)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]} ${m[3]}`).sort()
    assert.deepEqual(found, [
      'GET / view', 'GET /:id view', 'POST /:id/cancel decide', 'POST /:id/note view', 'POST /:id/recheck view', 'POST /:id/refund-note refund',
      'POST /:id/requests/:rid/apply decide', 'POST /:id/requests/:rid/decide decide', 'POST /:id/resolve decide',
    ])
    assert.equal((source.match(/app\.(get|post|put|patch|delete)\(/g) || []).length, found.length, 'every route is guarded')
  })

  // --------------------------------------------------------------------------------------------------------------- list
  await check('the list is a keyset page (newest first), never a count: pages join without a gap or a repeat, attention shows paid and review only, the cursor is validated', async () => {
    const h = world()
    for (let i = 0; i < 7; i += 1) { await place(h); h.advance(MIN) }
    h.script.check = () => h.approved(25)
    for (const id of [1, 3, 5]) await h.callback(h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ?', id).tran_id)
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20 } })
    h.advance(MIN); await h.callback(h.one('SELECT tran_id FROM online_order_payments WHERE order_id = 7').tran_id)
    const attention = await ask(h, FULL, '/?filter=attention')
    assert.deepEqual(attention.body.rows.map((r) => r.id), [7, 5, 3, 1]); assert.deepEqual(attention.body.rows.map((r) => r.state), ['review', 'paid', 'paid', 'paid'])
    assert.equal(attention.body.rows[0].held_review, 1)
    const pages = []; let cursor = null
    for (let i = 0; i < 6; i += 1) {
      const res = await ask(h, FULL, `/?filter=all&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      assert.equal(res.status, 200); pages.push(...res.body.rows.map((r) => r.id)); cursor = res.body.next_cursor
      if (!cursor) break
    }
    assert.deepEqual(pages, [7, 6, 5, 4, 3, 2, 1], 'no gap, no repeat')
    assert.deepEqual((await ask(h, FULL, '/?filter=awaiting_payment')).body.rows.map((r) => r.id), [6, 4, 2])
    assert.equal((await ask(h, FULL, '/?filter=all&cursor=garbage')).status, 400)
    h.clearStatements(); await ask(h, FULL, '/?filter=attention')
    assert.ok(!h.statements.some((s) => /COUNT\(\*\)/i.test(s) && /FROM online_orders\b/.test(s) && !/online_order_/.test(s.replace(/online_orders o/g, ''))), 'the total is never counted')
    assert.match(h.statements[0], /INDEXED BY idx_online_orders_attention/)
    const row = attention.body.rows[1]
    assert.ok(!('token_hash' in row))
  })

  await check('the list says which orders carry a pending request', async () => {
    const h = world(); const res = await paidOrder(h)
    await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: '+855 12 000 001', after: { note: 'gate' } })
    const phone = h.one('SELECT customer_phone p FROM online_orders').p
    const ok = await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone, after: { note: 'gate' } })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal((await ask(h, FULL, '/')).body.rows[0].pending_requests, 1)
  })

  // --------------------------------------------------------------------------------------------------------------- detail
  await check('the detail never carries the link token hash, a QR string or a deeplink; shows payments, Records with the actor, the money read and chips; an unknown or malformed id is 404', async () => {
    const h = world(); await paidOrder(h)
    const res = await ask(h, FULL, '/1')
    assert.equal(res.status, 200)
    const text = JSON.stringify(res.body)
    for (const secret of [order(h).token_hash, '000201KHQR', 'abamobilebank', 'network_key']) assert.ok(!text.includes(secret), `no ${secret}`)
    assert.equal(res.body.status, 'paid'); assert.equal(res.body.money.onlineInUsd, 25)
    assert.deepEqual(res.body.events.map((e) => e.event), ['created', 'qr_issued', 'verified_paid'])
    for (const id of ['0', '999', 'abc', '-1', '1.5']) assert.equal((await ask(h, FULL, `/${id}`)).status, 404, id)
  })

  await check('phones: the number is masked unless the caller may see full numbers, including a phone typed into a social field (a wrong build leaves contact_whatsapp raw)', async () => {
    const h = world(); const res = await place(h, { phone: PHONE, contacts: { whatsapp: '+855 12 345 678', instagram: 'dara.shop' } })
    void res
    const phoneAccess = h.load('lib/phoneAccess.ts')
    const as = (permissions) => user(9, 'U', { online_orders: true, ...permissions })
    const masked = phoneAccess.projectPhones((await ask(h, as({}), '/1')).body, as({}))
    assert.ok(!JSON.stringify(masked).includes('345 678') && !JSON.stringify(masked).includes('345678'), JSON.stringify(masked.order).slice(0, 400))
    assert.equal(masked.order.contact_instagram, 'dara.shop', 'a handle that is not a phone is shown')
    const fullUser = as({ contacts_full_phone: true })
    const full = phoneAccess.projectPhones((await ask(h, fullUser, '/1')).body, fullUser)
    assert.ok(JSON.stringify(full).includes('345 678') || JSON.stringify(full).includes('12 345'), 'with the permission the number is there')
    const list = phoneAccess.projectPhones((await ask(h, as({}), '/?filter=all')).body, as({}))
    assert.ok(!JSON.stringify(list).includes('345 678') && !JSON.stringify(list).includes('345678'))
  })

  await check('F7: a refund note priced before an ABA return of the same sale landed is refused (409 order_changed), so a return and a note cannot both spend the same money', async () => {
    const h = world(); await paidOrder(h)
    h.run("INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, sale_status, created_at, exchange_rate, money_precision_version) VALUES (50, 'R50', 25, 25, 25, 'cancelled', '2026-11-09 05:00:00', 4000, 1)")
    h.run("UPDATE online_orders SET state = 'fulfilled', sale_id = 50 WHERE id = 1")
    // The ABA return lands between the note's pricing read and its write.
    h.hooks.beforeBatch = (items) => {
      if (!items.some((item) => /'refund_noted'/.test(item.sql))) return
      h.hooks.beforeBatch = null
      h.run("INSERT INTO returns (return_number, sale_id, return_scope, status, total_refund_usd, total_refund_khr, refund_channel, created_at) VALUES ('RX1', 50, 'customer', 'completed', 25, 0, 'aba', '2026-11-09 05:30:00')")
    }
    const raced = await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 10, reference: 'ABA-RACE' })
    assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'order_changed')
    assert.equal(names(h).filter((e) => e === 'refund_noted').length, 0, 'nothing was noted')
    // Control: the same note with no competing return is accepted.
    const c = world(); await paidOrder(c)
    c.run("INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, sale_status, created_at, exchange_rate, money_precision_version) VALUES (50, 'R50', 25, 25, 25, 'cancelled', '2026-11-09 05:00:00', 4000, 1)")
    c.run("UPDATE online_orders SET state = 'fulfilled', sale_id = 50 WHERE id = 1")
    const ok = await ask(c, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 10, reference: 'ABA-OK' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
  })

  await check('F6: a phone typed into a social field inside a change request is masked in before_json and after_json without the full-phone permission, and whole with it', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE, contacts: { whatsapp: '+855 12 345 678', instagram: 'dara.shop' } })
    const out = await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'contact', phone: h.one('SELECT customer_phone p FROM online_orders WHERE id = 1').p, after: { name: 'Dara K', contacts: { whatsapp: '098 765 432', instagram: 'dara_k' } } })
    assert.equal(out.status, 201, JSON.stringify(out.body))
    const as = (permissions) => user(9, 'U', { online_orders: true, ...permissions })
    const masked = (await ask(h, as({}), '/1')).body.requests[0]
    for (const text of [masked.before_json, masked.after_json]) assert.ok(!/345\s?678|765\s?432/.test(text), 'no full number: ' + text)
    assert.equal(JSON.parse(masked.after_json).contacts.instagram, 'dara_k', 'a handle that is not a phone stays readable'); assert.equal(JSON.parse(masked.after_json).name, 'Dara K')
    const full = (await ask(h, as({ contacts_full_phone: true }), '/1')).body.requests[0]
    assert.ok(/345\s?678/.test(full.before_json) && /765\s?432/.test(full.after_json), 'with the permission the numbers are there')
  })

  await check('R3-7: a phone typed into a top-level contact_whatsapp key of a change request is masked in before_json and after_json without the full-phone permission, and whole with it (a build whose pattern reads contact_w+ leaves it raw)', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE })
    void res
    h.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json) VALUES (1, 'contact', 'paid', '{\"contact_whatsapp\":\"012 345 678\"}', '{\"contact_whatsapp\":\"098 765 432\",\"contact_instagram\":\"dara_k\"}')")
    const as = (permissions) => user(9, 'U', { online_orders: true, ...permissions })
    const masked = (await ask(h, as({}), '/1')).body.requests[0]
    for (const text of [masked.before_json, masked.after_json]) assert.ok(!/345\s?678|765\s?432/.test(text), 'no full number: ' + text)
    assert.equal(JSON.parse(masked.after_json).contact_instagram, 'dara_k', 'a handle that is not a phone stays readable: ' + masked.after_json)
    const full = (await ask(h, as({ contacts_full_phone: true }), '/1')).body.requests[0]
    assert.ok(/345\s?678/.test(full.before_json) && /765\s?432/.test(full.after_json), 'with the permission the numbers are there')
  })

  await check('N9: a phone number inside longer contact text (a wa.me link, "call 012...") is masked in the order and in request JSON without the full-phone permission, and whole with it (a wrong build masks only a value that is wholly a number)', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE, contacts: { whatsapp: 'https://wa.me/85512345678', telegram: 't.me/+85598765432', other: 'call me 077 111 222 after 5pm', instagram: 'dara.shop' } })
    const as = (permissions) => user(9, 'U', { online_orders: true, ...permissions })
    const out = await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'contact', phone: h.one('SELECT customer_phone p FROM online_orders WHERE id = 1').p, after: { contacts: { whatsapp: 'wa.me/85587654321', instagram: 'dara_k' } } })
    assert.equal(out.status, 201, JSON.stringify(out.body))
    const masked = (await ask(h, as({}), '/1')).body
    const shown = JSON.stringify([masked.order.contact_whatsapp, masked.order.contact_telegram, masked.order.contact_other, masked.requests[0].before_json, masked.requests[0].after_json])
    for (const digits of ['12345678', '98765432', '077 111 222', '87654321']) assert.ok(!shown.includes(digits), `${digits} is hidden: ${shown}`)
    assert.match(masked.order.contact_whatsapp, /wa\.me\//, 'the link around the number stays readable'); assert.equal(masked.order.contact_instagram, 'dara.shop')
    const full = (await ask(h, as({ contacts_full_phone: true }), '/1')).body
    assert.ok(full.order.contact_whatsapp.includes('85512345678') && full.requests[0].after_json.includes('87654321'), 'with the permission the text is whole')
  })

  await check('D6 (owner 10 Nov): text the buyer typed (order note, delivery address, a typed request note or address) shows as typed to staff without the full-phone permission; only structured phone fields stay masked', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE, fulfilment: 'delivery', address: 'House 5, call 077 111 222 at the gate', note: 'ring 098 765 432 when you arrive', contacts: { whatsapp: '+855 12 345 678' } })
    const as = (permissions) => user(9, 'U', { online_orders: true, ...permissions })
    const typed = h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: h.one('SELECT customer_phone p FROM online_orders WHERE id = 1').p, after: { note: 'my cousin is 011 222 333' } })
    assert.equal((await typed).status, 201)
    const seen = (await ask(h, as({}), '/1')).body
    assert.ok(seen.order.customer_address.includes('077 111 222'), 'the address shows as typed: ' + seen.order.customer_address)
    assert.ok(seen.order.note.includes('098 765 432'), 'the note shows as typed: ' + seen.order.note)
    assert.ok(seen.requests[0].after_json.includes('011 222 333'), 'a typed request note shows as typed: ' + seen.requests[0].after_json)
    assert.ok(!JSON.stringify(seen.order.contact_whatsapp).includes('345 678'), 'the structured contact stays masked: ' + seen.order.contact_whatsapp)
    assert.ok(!JSON.stringify(seen.order.customer_phone).includes('345 678'), 'the phone field stays masked')
  })

  await check('N5 + owner ruling 10 Nov: a signed-in buyer links their own customer (auto); a typed phone AND name only SUGGESTS exactly one customer; a shared number with another name, two matches, six rows, a sold order or no customer name nobody; a zero-width space in the name does not hide a match', async () => {
    const h = world(); await paidOrder(h, { phone: '+855 12 777 888', name: 'Dara' })
    const as = (id) => ask(h, FULL, `/${id}`).then((res) => res.body.customer_match)
    assert.equal(await as(1), null, 'no customer yet')
    h.run("INSERT INTO customers (name, phone, phone_normalized) VALUES ('Sok', '012 777 888', '012777888')")
    assert.equal(await as(1), null, 'the number belongs to someone else: a conflict for a person, never a silent link')
    h.run("INSERT INTO customers (name, phone, phone_normalized) VALUES (' dara ', '012 777 888', '012777888')")
    assert.deepEqual(await as(1), { id: 2, name: ' dara ', auto: false }, 'phone (855 folded to 0) and name (case and spacing ignored) SUGGEST one customer; the cashier confirms')
    h.run("INSERT INTO customers (name, phone, phone_normalized) VALUES ('Dara', '012777888', '012777888')")
    assert.equal(await as(1), null, 'two customers match: nothing is guessed')
    h.run("DELETE FROM customers WHERE id = 3")
    h.run("INSERT INTO customers (name, phone, phone_normalized, is_anonymous) VALUES ('Dara', '012777888', '012777888', 1)")
    assert.deepEqual(await as(1), { id: 2, name: ' dara ', auto: false }, 'the anonymous General customer never counts')
    h.run("DELETE FROM customers WHERE id = 4")
    h.run("UPDATE customers SET name = 'Dara' || char(8203) WHERE id = 2")
    assert.deepEqual(await as(1), { id: 2, name: 'Dara​', auto: false }, 'a zero-width space in the stored name still matches')
    for (let i = 0; i < 5; i += 1) h.run("INSERT INTO customers (name, phone, phone_normalized) VALUES ('Other' || ?, '012777888', '012777888')", i)
    assert.equal(await as(1), null, 'six customers share the number: nobody is named')
    h.run("DELETE FROM customers WHERE name LIKE 'Other%'")
    h.run("INSERT INTO customers (name, phone, phone_normalized) VALUES ('Mum', '011 000 000', '011000000')")
    const mum = h.one("SELECT id FROM customers WHERE name = 'Mum'").id
    h.run("INSERT INTO portal_accounts (membership_id, name, phone, password_hash, contact_id) VALUES ('M1', 'Whoever', '099000000', 'x', ?)", mum)
    h.run('UPDATE online_orders SET portal_account_id = ? WHERE id = 1', h.one("SELECT id FROM portal_accounts WHERE membership_id = 'M1'").id)
    assert.deepEqual(await as(1), { id: mum, name: 'Mum', auto: true }, 'a signed-in buyer links the customer their account points at, whatever name or phone was typed')
    h.run('UPDATE online_orders SET portal_account_id = NULL WHERE id = 1')
    h.run("INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, sale_status, created_at, exchange_rate, money_precision_version) VALUES (50, 'R50', 25, 25, 25, 'completed', '2026-11-09 05:00:00', 4000, 1)")
    h.run("UPDATE online_orders SET state = 'fulfilled', sale_id = 50 WHERE id = 1")
    assert.equal(await as(1), null, 'an order that already has a sale has nothing to fulfil')
  })

  // --------------------------------------------------------------------------------------------------------------- cancel
  await check('cancel a paid order: cancelled by staff with the actor and reason, live QRs cancelled and closed at ABA, the money stays and reads as refund due; a stale revision, a sale, an unpaid order and a second cancel are refused', async () => {
    const h = world(); await paidOrder(h)
    const rev = order(h).revision
    assert.equal((await ask(h, DECIDER, '/1/cancel', 'POST', { reason: 'out of stock', revision: rev - 1 })).status, 409, 'stale revision')
    assert.equal(state(h), 'paid')
    h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, qr_string, expires_at, revision, created_at) VALUES (1, 'WLIVE0000000000001', 'order', 25, 'USD', 'awaiting', '000201X', '2026-11-09 03:15:00', 0, '2026-11-09 03:00:00')")
    h.calls.length = 0
    const res = await ask(h, DECIDER, '/1/cancel', 'POST', { reason: 'out of stock', revision: rev })
    assert.equal(res.status, 200, JSON.stringify(res.body)); assert.equal(state(h), 'cancelled')
    const ev = events(h).find((e) => e.event === 'cancelled'); assert.equal(ev.source, 'staff'); assert.equal(ev.actor_id, 3); assert.equal(ev.actor_name, 'Decider'); assert.equal(ev.internal_note, 'out of stock')
    assert.equal(h.one("SELECT state FROM online_order_payments WHERE tran_id = 'WLIVE0000000000001'").state, 'cancelled')
    assert.deepEqual(h.calls.filter((c) => c.op === 'close').map((c) => c.body.tran_id), ['WLIVE0000000000001'])
    assert.equal(money(h).refundDueUsd, 25, 'the paid money is now refundable')
    assert.equal((await ask(h, DECIDER, '/1/cancel', 'POST', {})).status, 409, 'a second cancel')
    assert.equal(h.audits.at(-1).action, 'online_order_cancel')
    const unpaid = await place(h); void unpaid
    assert.equal((await ask(h, DECIDER, '/2/cancel', 'POST', {})).body.code, 'order_not_cancellable_here')
    const sold = world(); await paidOrder(sold)
    sold.run("INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, sale_status, created_at, exchange_rate, money_precision_version) VALUES (50, 'R50', 25, 25, 25, 'completed', '2026-11-09 05:00:00', 4000, 1)")
    sold.run("UPDATE online_orders SET state = 'fulfilled', sale_id = 50 WHERE id = 1")
    assert.equal((await ask(sold, DECIDER, '/1/cancel', 'POST', {})).body.code, 'order_has_sale')
  })

  await check('cancel a review order: allowed, and the money PayWay took (held in review) becomes refundable', async () => {
    const h = world(); await place(h)
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20 } })
    await h.callback(tranOf(h)); assert.equal(state(h), 'review')
    assert.equal((await ask(h, DECIDER, '/1/cancel', 'POST', { reason: 'short' })).status, 200)
    assert.equal(money(h).refundDueUsd, 20)
  })

  // --------------------------------------------------------------------------------------------------------------- resolve
  await check('resolve a review: the payment becomes paid with its REAL amount (not the order price), the order becomes paid, one Records row with the actor; nothing to resolve, a payment without an amount and a stale revision are refused', async () => {
    const h = world(); await place(h)
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20, apv: 'A1' } })
    await h.callback(tranOf(h))
    assert.equal((await ask(h, DECIDER, '/1/resolve', 'POST', { revision: order(h).revision - 1 })).status, 409)
    assert.equal(state(h), 'review')
    const res = await ask(h, DECIDER, '/1/resolve', 'POST', { note: 'customer confirmed', revision: order(h).revision })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const p = h.one('SELECT * FROM online_order_payments WHERE id = 1')
    assert.equal(p.state, 'paid'); assert.equal(p.paid_amount, 20); assert.ok(p.paid_at); assert.equal(state(h), 'paid')
    const ev = events(h).filter((e) => e.event === 'resolved'); assert.equal(ev.length, 1); assert.equal(ev[0].actor_name, 'Decider'); assert.equal(ev[0].amount_usd, 20); assert.equal(ev[0].from_state, 'review'); assert.equal(ev[0].to_state, 'paid')
    assert.equal(money(h).onlineInUsd, 20, 'the real amount counts as paid money'); assert.equal(money(h).heldInReviewUsd, 0)
    assert.equal((await ask(h, DECIDER, '/1/resolve', 'POST', {})).body.code, 'nothing_to_resolve')
    // G7: a short payment resolved as received is NOT "paid, to fulfil": the order reads balance due ($5 of $25 still owed), the money view says so, and Fulfil collects it.
    const shown = await ask(h, VIEWER, '/1')
    assert.equal(shown.status, 200, JSON.stringify(shown.body))
    assert.equal(shown.body.status, 'balance_due'); assert.ok(shown.body.chips.includes('balance_due')); assert.equal(shown.body.money.balanceDueUsd, 5)
    assert.equal(shown.body.money.refundDueUsd, 0, 'nothing is refundable: the customer owes, not the shop')
    const full = world(); const fr = await place(full); full.script.check = () => full.approved(25); await full.callback(tranOf(full))
    const fullShown = await ask(full, VIEWER, '/1')
    assert.equal(fullShown.body.status, 'paid'); assert.ok(!fullShown.body.chips.includes('balance_due')); assert.equal(fullShown.body.money.balanceDueUsd, 0)
    void fr
    const legacy = world(); await place(legacy)
    legacy.run("UPDATE online_order_payments SET state = 'review', paid_amount = NULL WHERE id = 1"); legacy.run("UPDATE online_orders SET state = 'review' WHERE id = 1")
    assert.equal((await ask(legacy, DECIDER, '/1/resolve', 'POST', {})).body.code, 'no_amount_held')
  })

  await check('resolving a mismatched top-up pays that payment and leaves the order paid', async () => {
    const h = world(); await paidOrder(h)
    h.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json, created_at) VALUES (1, 'items', 'paid', '{}', '{}', '2026-11-09 03:01:00')")
    h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state, qr_string, expires_at, revision, created_at) VALUES (1, 'WTOPUP0000000000001', 'top_up', 1, 5, 'USD', 'awaiting', '000201T', '2026-11-09 03:30:00', 0, '2026-11-09 03:05:00')")
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 3 } })
    h.advance(MIN); await h.callback('WTOPUP0000000000001')
    assert.equal(h.one('SELECT state FROM online_order_payments WHERE id = 2').state, 'review')
    assert.equal((await ask(h, DECIDER, '/1/resolve', 'POST', {})).status, 200)
    assert.equal(h.one('SELECT state FROM online_order_payments WHERE id = 2').state, 'paid'); assert.equal(state(h), 'paid')
    assert.equal(money(h).onlineInUsd, 28)
  })

  // --------------------------------------------------------------------------------------------------------------- refund note
  await check('refund note: never more than is due, never a second note for the same money, whole cents only; it records the actor and the ABA reference (a wrong build lets two notes refund the same $25 twice)', async () => {
    const h = world(); await paidOrder(h)
    assert.equal((await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 5 })).body.code, 'refund_over_due', 'nothing is due on a paid, uncancelled order')
    await ask(h, DECIDER, '/1/cancel', 'POST', {})
    for (const bad of [0, -1, 'abc', null, 0.001, 25.01]) {
      const res = await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: bad })
      assert.ok([400, 409].includes(res.status), `${bad}: ${res.status}`)
    }
    assert.equal(names(h).filter((e) => e === 'refund_noted').length, 0)
    const first = await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 10, reference: 'ABA-REF-1', note: 'half' })
    assert.equal(first.status, 201, JSON.stringify(first.body)); assert.equal(first.body.due_after_usd, 15)
    const ev = events(h).find((e) => e.event === 'refund_noted'); assert.equal(ev.amount_usd, 10); assert.equal(ev.reference, 'ABA-REF-1'); assert.equal(ev.actor_name, 'Refunder'); assert.equal(ev.source, 'staff')
    assert.equal((await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 15.01 })).body.code, 'refund_over_due')
    assert.equal((await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 15 })).status, 201)
    assert.equal(money(h).refundDueUsd, 0)
    assert.equal((await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 0.01 })).body.code, 'refund_over_due', 'the same money cannot be refunded twice')
    assert.equal((await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 1, reference: 'x'.repeat(61) })).status, 400)
  })

  // --------------------------------------------------------------------------------------------------------------- requests
  const request = async (h, res, kind, after, extra = {}) => {
    const phone = h.one('SELECT customer_phone p FROM online_orders WHERE id = 1').p
    const out = await h.request(`/${res.body.token}/requests`, 'POST', { kind, phone, after, ...extra })
    assert.equal(out.status, 201, JSON.stringify(out.body))
    return h.one('SELECT MAX(id) id FROM online_order_requests').id
  }

  await check('decide: accept or reject once, with a public comment the customer can read and an internal note they cannot; a second decision, a withdrawn request and bad input are refused', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE })
    const rid = await request(h, res, 'note', { note: 'gate' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'maybe' })).body.code, 'decision_invalid')
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'accept', public_comment: 'x'.repeat(301) })).status, 400)
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'accept', attachments: ['/uploads/nope.png'] })).body.code, 'attachments_invalid')
    const ok = await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'accept', public_comment: 'Fine, we will leave it at the gate', internal_note: 'owner said yes' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    const ev = events(h).find((e) => e.event === 'request_accepted'); assert.equal(ev.actor_name, 'Decider'); assert.equal(ev.internal_note, 'owner said yes')
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'reject' })).body.code, 'request_not_pending')
    const customer = await h.request(`/${res.body.token}`, 'GET')
    assert.ok(JSON.stringify(customer.body).includes('leave it at the gate'), 'the customer reads the public comment')
    assert.ok(!JSON.stringify(customer.body).includes('owner said yes'), 'never the internal note')
    const rid2 = await request(h, res, 'note', { note: 'again' }).catch(() => null)
    void rid2
    const w = world(); const wr = await paidOrder(w, { phone: PHONE }); const wid = await request(w, wr, 'note', { note: 'x' })
    await w.request(`/${wr.body.token}/requests/${wid}/withdraw`, 'POST', { phone: PHONE })
    assert.equal((await ask(w, DECIDER, `/1/requests/${wid}/decide`, 'POST', { decision: 'accept' })).body.code, 'request_not_pending')
    assert.equal((await ask(w, DECIDER, '/1/requests/999/decide', 'POST', { decision: 'accept' })).status, 404)
  })

  await check('apply a note, address, fulfilment and contact request: copied from what the customer proposed, once, with a Records row; an unaccepted, rejected or already applied request is refused', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE })
    const rid = await request(h, res, 'note', { note: 'leave at gate' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/apply`, 'POST', {})).body.code, 'request_not_accepted', 'not accepted yet')
    await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'accept' })
    const applied = await ask(h, DECIDER, `/1/requests/${rid}/apply`, 'POST', {})
    assert.equal(applied.status, 200, JSON.stringify(applied.body)); assert.equal(order(h).note, 'leave at gate')
    const ev = events(h).filter((e) => e.event === 'request_applied'); assert.equal(ev.length, 1); assert.equal(ev[0].actor_name, 'Decider')
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/apply`, 'POST', {})).body.code, 'request_not_accepted', 'a second apply')
    const rid2 = await request(h, res, 'address', { address: 'Street 9, Phnom Penh' }); await ask(h, DECIDER, `/1/requests/${rid2}/decide`, 'POST', { decision: 'accept' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid2}/apply`, 'POST', {})).status, 200); assert.equal(order(h).customer_address, null, 'F9: an address applied to a PICKUP order is not kept')
    const rid3 = await request(h, res, 'fulfilment', { fulfilment: 'delivery', address: 'Street 9, Phnom Penh' }); await ask(h, DECIDER, `/1/requests/${rid3}/decide`, 'POST', { decision: 'accept' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid3}/apply`, 'POST', {})).status, 200); assert.equal(order(h).fulfilment, 'delivery'); assert.equal(order(h).customer_address, 'Street 9, Phnom Penh', 'moving to delivery keeps the address typed with it')
    const rid4 = await request(h, res, 'contact', { name: 'Dara K', contacts: { instagram: 'dara_k' } }); await ask(h, DECIDER, `/1/requests/${rid4}/decide`, 'POST', { decision: 'accept' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid4}/apply`, 'POST', {})).status, 200); assert.equal(order(h).customer_name, 'Dara K'); assert.equal(order(h).contact_instagram, 'dara_k')
    const rej = await request(h, res, 'note', { note: 'no' }); await ask(h, DECIDER, `/1/requests/${rej}/decide`, 'POST', { decision: 'reject' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rej}/apply`, 'POST', {})).body.code, 'request_not_accepted', 'a rejected request is never applied')
  })

  await check('apply an items request: a higher total adds a top-up payment for exactly the difference (awaiting, linked to the request) the customer can pay; a lower total adds none and makes the difference refundable; no stock is refused; the order total follows', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE })
    const up = await request(h, res, 'items', { lines: [{ product_id: 1, quantity: 3 }] })
    await ask(h, DECIDER, `/1/requests/${up}/decide`, 'POST', { decision: 'accept' })
    const r = await ask(h, DECIDER, `/1/requests/${up}/apply`, 'POST', {})
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.top_up_usd, 12.5)
    assert.equal(order(h).goods_total_usd, 37.5)
    const top = h.one("SELECT * FROM online_order_payments WHERE purpose = 'top_up'")
    assert.equal(top.amount, 12.5); assert.equal(top.state, 'awaiting'); assert.equal(top.request_id, up); assert.equal(top.qr_string, null)
    // G3: the customer's page lists the unpaid top-up on its own, with no QR yet, so it can offer "Pay $12.50 more" without anyone calling /topup by hand.
    const before = await h.request(`/${res.body.token}`, 'GET')
    assert.equal(before.status, 200, JSON.stringify(before.body))
    assert.deepEqual(before.body.order.top_ups.map((t) => [t.request_id, t.amount, t.state, t.qr_string, t.deeplink]), [[up, 12.5, 'awaiting', null, null]])
    const issued = await h.request(`/${res.body.token}/topup`, 'POST', { request_id: up })
    const after = await h.request(`/${res.body.token}`, 'GET')
    assert.equal(after.body.order.top_ups.length, 1, 'one entry per request, the QR now filled'); assert.ok(after.body.order.top_ups[0].qr_string)
    assert.equal(issued.status, 200, JSON.stringify(issued.body))
    assert.equal(events(h).find((e) => e.event === 'request_applied').amount_usd, 12.5)
    // lower total: no top-up, the difference is refundable
    const l = world(); const lr = await paidOrder(l, { phone: PHONE })
    const down = await request(l, lr, 'items', { lines: [{ product_id: 1, quantity: 1 }] })
    await ask(l, DECIDER, `/1/requests/${down}/decide`, 'POST', { decision: 'accept' })
    const lowered = await ask(l, DECIDER, `/1/requests/${down}/apply`, 'POST', {})
    assert.equal(lowered.body.top_up_usd, 0); assert.equal(l.one("SELECT COUNT(*) n FROM online_order_payments WHERE purpose = 'top_up'").n, 0)
    assert.equal(order(l).goods_total_usd, 12.5); assert.equal(money(l).refundDueUsd, 12.5)
    // out of stock
    const s = world(); const sr = await paidOrder(s, { phone: PHONE })
    const big = await request(s, sr, 'items', { lines: [{ product_id: 2, quantity: 9 }] })
    await ask(s, DECIDER, `/1/requests/${big}/decide`, 'POST', { decision: 'accept' })
    const refused = await ask(s, DECIDER, `/1/requests/${big}/apply`, 'POST', {})
    assert.ok(refused.status >= 400, JSON.stringify(refused.body)); assert.equal(order(s).goods_total_usd, 25)
    assert.equal(s.one("SELECT COUNT(*) n FROM online_order_events WHERE event = 'request_applied'").n, 0)
  })

  await check('apply a cancel request cancels the order and its live QRs; a request that belongs to the sale (after_sale stage, a return) is refused here', async () => {
    const h = world(); const res = await paidOrder(h, { phone: PHONE })
    const rid = await request(h, res, 'cancel', {}); await ask(h, DECIDER, `/1/requests/${rid}/decide`, 'POST', { decision: 'accept' })
    assert.equal((await ask(h, DECIDER, `/1/requests/${rid}/apply`, 'POST', {})).status, 200); assert.equal(state(h), 'cancelled'); assert.equal(money(h).refundDueUsd, 25)
    assert.ok(names(h).includes('request_applied'))
    const a = world(); const ar = await paidOrder(a, { phone: PHONE })
    a.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json, created_at) VALUES (1, 'return', 'after_sale', '{}', '{}', '2026-11-09 03:05:00')")
    a.run("INSERT INTO online_order_events (order_id, request_id, event, source) VALUES (1, 1, 'request_accepted', 'staff')")
    assert.equal((await ask(a, DECIDER, '/1/requests/1/apply', 'POST', {})).body.code, 'apply_on_sale'); void ar
  })

  // --------------------------------------------------------------------------------------------------------------- recheck, note, refresh
  await check('recheck asks PayWay about this order only and settles it exactly like a poll; a note is a Records row with the actor; every staff write bumps the live-refresh version', async () => {
    const h = world(); await place(h)
    h.script.check = () => h.approved(25); h.calls.length = 0; h.bumps.length = 0
    const res = await ask(h, VIEWER, '/1/recheck', 'POST', {})
    assert.equal(res.status, 200, JSON.stringify(res.body)); assert.deepEqual(res.body.outcomes, ['paid']); assert.equal(state(h), 'paid')
    assert.equal(h.calls.filter((c) => c.op === 'check').length, 1)
    assert.equal((await ask(h, VIEWER, '/1/note', 'POST', { note: '' })).status, 400)
    assert.equal((await ask(h, VIEWER, '/1/note', 'POST', { note: 'x'.repeat(501) })).status, 400)
    h.bumps.length = 0
    assert.equal((await ask(h, VIEWER, '/1/note', 'POST', { note: 'called the customer' })).status, 201)
    const ev = events(h).find((e) => e.event === 'note'); assert.equal(ev.internal_note, 'called the customer'); assert.equal(ev.actor_name, 'Viewer')
    assert.deepEqual(h.bumps, ['online_orders'])
    h.bumps.length = 0; await ask(h, DECIDER, '/1/cancel', 'POST', {}); await ask(h, REFUNDER, '/1/refund-note', 'POST', { amount_usd: 5 })
    assert.equal(h.bumps.length, 2, 'cancel and refund note each refresh the screens once')
    const none = await h.staff('/1/recheck', 'POST', {}, { as: VIEWER, envOverride: { PAYWAY_API_KEY: undefined } })
    assert.equal(none.body.code, 'payway_not_configured')
  })

  await check('every staff action is in the audit trail with the actor; the staff routes ignore the customer read switch (money already taken is always handled)', async () => {
    const h = world(); await paidOrder(h); h.state.switchOn = false
    await ask(h, FULL, '/1/note', 'POST', { note: 'n' }); await ask(h, FULL, '/1/cancel', 'POST', {}); await ask(h, FULL, '/1/refund-note', 'POST', { amount_usd: 5 })
    assert.deepEqual(h.audits.map((a) => a.action), ['online_order_note', 'online_order_cancel', 'online_order_refund_note'])
    assert.ok(h.audits.every((a) => a.userId === 5 && a.entity === 'online_order' && a.entityId === 1))
    assert.equal((await ask(h, FULL, '/1')).status, 200)
  })

  console.log(`online order staff: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
