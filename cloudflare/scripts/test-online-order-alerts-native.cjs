// KHQR S4: the Telegram notices for online orders, through the REAL store, routes, alert composers and lib/telegram.ts on the real migration chain.
// Only the network is scripted: PayWay by the harness transport, Telegram by a captured global fetch. Nothing leaves the machine.
//
// Run: node scripts/test-online-order-alerts-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)
const MIN = 60_000
const PHONE = '012 345 678'
const KHMER = /[ក-៿]/

const sent = []
let telegramDown = false
const realFetch = global.fetch
global.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.telegram.org/')) throw new Error(`unexpected network call: ${url}`)
  if (telegramDown) throw new Error('telegram unreachable')
  const body = JSON.parse(init.body)
  sent.push({ text: body.text, thread: body.message_thread_id ?? null })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

function world(settings = {}) {
  const h = createOrdersHarness({
    switchOn: true, spreadNetworks: true, nowMs: T0, env: { TELEGRAM_BOT_TOKEN: '123456:test-token' },
    settings: { telegram_chat_id: '-1001', telegram_topic_sales: '77', ...settings },
  })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 50)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 50)', id)
  })
  sent.length = 0
  return h
}
let phoneSeq = 0
const place = async (h, over = {}) => {
  const { ip, ...fields } = over // `ip`: which network the order comes from (one network may hold only a few open orders)
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: fields.phone || `0${12000000 + (phoneSeq += 1)}`, fulfilment: 'pickup', ...fields }, ip ? { ip } : undefined)
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res
}
const tranOf = (h, orderId = 1) => h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', orderId).tran_id
const textOf = (message) => message.text

async function main() {
  await check('a new order is announced once, in both languages, to the Sales topic, with the FULL customer phone (owner ruling 10 Nov) and no secret in the text', async () => {
    const h = world()
    const res = await place(h, { phone: PHONE })
    assert.equal(sent.length, 1)
    const text = textOf(sent[0])
    assert.match(text, /Online order/); assert.match(text, KHMER, 'the Khmer half is there')
    assert.match(text, /LB-|\d{6,}/, 'it names the order number'); assert.ok(text.includes(h.one('SELECT order_no FROM online_orders').order_no))
    assert.match(text, /Dara/); assert.match(text, /\$25\.00/); assert.equal(sent[0].thread, 77, 'the Sales topic, never General')
    assert.ok(text.replace(/\s/g, '').includes('012345678'), 'the full phone is in the alert: ' + text)
    assert.ok(!/\*\*\*/.test(text), 'not masked')
    for (const secret of [res.body.token, tranOf(h), 'APV', 'qr', 'abamobilebank']) assert.ok(!text.includes(secret), `no ${secret}`)
    assert.ok(text.split('\n').every((line) => line.length <= 80), 'short rows')
    assert.ok(!text.includes('—'), 'no em dash')
  })

  await check('the full phone is the ONLY customer detail an alert adds: address, social handles and the order note never appear, in any message of a delivery order from creation to payment (plan section 8)', async () => {
    const h = world()
    await place(h, { phone: PHONE, fulfilment: 'delivery', address: 'House 77 Hidden Street Phnom Penh', note: 'leave-with-the-guard', contacts: { telegram: '@hidden_handle', instagram: 'hidden.insta', facebook: 'hidden.fb', tiktok: 'hidden_tik', whatsapp: '85512999888', other: 'hidden-other' } })
    h.script.check = () => h.approved(25); await h.callback(tranOf(h))
    assert.ok(sent.length >= 2, 'created and paid were announced')
    for (const message of sent) {
      const text = textOf(message)
      assert.ok(text.replace(/s/g, '').includes('012345678'), 'full phone in every order notice: ' + text)
      for (const leak of ['Hidden Street', 'House 77', 'hidden_handle', 'hidden.insta', 'hidden.fb', 'hidden_tik', '12999888', 'hidden-other', 'leave-with-the-guard']) assert.ok(!text.includes(leak), 'leaked ' + leak)
    }
  })

  await check('paid: exactly one message per guarded transition, however many callbacks, polls or sweeps arrive after it (a wrong build announces every check)', async () => {
    const h = world(); const res = await place(h); const token = res.body.token; const tran = tranOf(h)
    sent.length = 0
    h.script.check = () => h.approved(25)
    await h.callback(tran); await h.callback(tran); await h.callback(tran)
    h.advance(20 * MIN); await h.sweep()
    assert.equal(sent.length, 1, sent.map(textOf).join('\n---\n'))
    assert.match(textOf(sent[0]), /paid/i); assert.match(textOf(sent[0]), /\$25\.00/); assert.match(textOf(sent[0]), KHMER)
    assert.ok(!textOf(sent[0]).includes(tran))
    void token
  })

  await check('a mismatch is announced as needing review, once', async () => {
    const h = world(); await place(h); sent.length = 0
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20 } })
    await h.callback(tranOf(h)); await h.callback(tranOf(h))
    assert.equal(sent.length, 1); assert.match(textOf(sent[0]), /review/i); assert.match(textOf(sent[0]), KHMER)
  })

  await check('the sweep sends ONE digest for every order that ran out in a tick, capped, never one message each', async () => {
    const h = world()
    for (let i = 0; i < 11; i += 1) await place(h, { ip: `10.4.0.${i + 1}` })
    sent.length = 0
    h.advance(20 * MIN); h.script.check = () => h.pending()
    const s = await h.sweep(); assert.equal(s.expired.length, 11, 'the paid plan checks 25 per tick')
    assert.equal(sent.length, 1, 'one digest, not eleven'); const text = textOf(sent[0])
    assert.match(text, /not paid in time/i); assert.match(text, KHMER)
    assert.equal(text.split('\n').filter((line) => /\$25\.00/.test(line)).length, 8, 'capped rows')
    assert.match(text, /\+ 3 /, 'and a count of the rest')
    sent.length = 0
    await h.sweep()
    assert.equal(sent.length, 0, 'an idle tick says nothing')
  })

  await check('a change request is announced with its kind and the customer words cut short; a refused request announces nothing', async () => {
    const h = world(); const res = await place(h, { phone: PHONE }); h.script.check = () => h.approved(25); await h.callback(tranOf(h)); sent.length = 0
    const long = 'please '.repeat(40)
    const ok = await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: PHONE, comment: long, after: { note: 'gate' } })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(sent.length, 1); const text = textOf(sent[0])
    assert.match(text, /Change note/); assert.match(text, KHMER); assert.ok(text.length < 700, 'the comment is cut')
    sent.length = 0
    const refused = await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: '012 999 999', after: { note: 'x' } })
    assert.equal(refused.status, 403); assert.equal(sent.length, 0, 'a refused request announces nothing')
  })

  await check('switches: the category and each sub-switch silence only their own family; unset means on', async () => {
    const off = async (settings, expectations) => {
      const h = world(settings)
      const res = await place(h); const created = sent.length
      h.script.check = () => h.approved(25); await h.callback(tranOf(h)); const paid = sent.length - created
      await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: res.body.order?.phone || undefined, after: { note: 'x' } })
      return { created, paid, h, res }
    }
    const all = await off({}); assert.equal(all.created, 1); assert.equal(all.paid, 1)
    const category = await off({ telegram_online_orders_enabled: 'false' }); assert.equal(category.created + category.paid, 0, 'the category switch silences all')
    const news = await off({ telegram_online_orders_new_enabled: 'false' }); assert.equal(news.created + news.paid, 0, 'new + paid sit under the new switch')
    // requests and expired
    for (const [key, family] of [['telegram_online_orders_requests_enabled', 'request'], ['telegram_online_orders_expired_enabled', 'expired']]) {
      const h = world({ [key]: 'false' }); const res = await place(h); h.script.check = () => h.approved(25); await h.callback(tranOf(h))
      sent.length = 0
      if (family === 'request') await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: '012 345 678', after: { note: 'x' } })
      else { const h2 = world({ [key]: 'false' }); await place(h2); sent.length = 0; h2.advance(20 * MIN); h2.script.check = () => h2.pending(); await h2.sweep() }
      assert.equal(sent.length, 0, `${family} is silent when its switch is false`)
    }
    const keepNew = world({ telegram_online_orders_expired_enabled: 'false' }); await place(keepNew)
    assert.equal(sent.length, 1, 'another family still speaks')
    const noAuto = world({ telegram_automation_enabled: 'false' }); await place(noAuto); assert.equal(sent.length, 0, 'the master switch silences it')
  })

  await check('a Telegram outage or a missing chat id never fails or slows the order: the order is still created and paid', async () => {
    const h = world(); telegramDown = true
    try {
      const res = await place(h); h.script.check = () => h.approved(25)
      assert.equal((await h.callback(tranOf(h))).status, 200)
      assert.equal(h.one('SELECT state FROM online_orders').state, 'paid'); assert.ok(res.body.token)
    } finally { telegramDown = false }
    const noChat = createOrdersHarness({ switchOn: true, nowMs: T0, env: { TELEGRAM_BOT_TOKEN: '1:x' } })
    noChat.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
    seedStockFixture(noChat.raw.db, () => { const id = Number(noChat.run('INSERT INTO products (name, selling_price_usd, is_active, stock_quantity) VALUES (?, ?, 1, 9)', 'Serum', 12.5).lastInsertRowid); noChat.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 9)', id) })
    sent.length = 0; await place(noChat); assert.equal(sent.length, 0)
  })

  await check('a customer edit, a cancel, a withdrawal and a failed QR each announce once; a re-issued QR announces nothing to the chat', async () => {
    const h = world(); const res = await place(h, { phone: PHONE }); const token = res.body.token
    sent.length = 0
    await h.request(`/${token}/edit`, 'POST', { name: 'Dara Two' })
    assert.equal(sent.length, 1); assert.match(textOf(sent[0]), /edited/i); assert.match(textOf(sent[0]), KHMER); assert.match(textOf(sent[0]), /Dara Two/)
    await h.request(`/${token}/edit`, 'POST', { name: 'Dara Two' })
    assert.equal(sent.length, 1, 'an edit that changes nothing announces nothing')
    sent.length = 0
    await h.request(`/${token}/cancel`, 'POST', {})
    assert.equal(sent.length, 1); assert.match(textOf(sent[0]), /cancelled/i); assert.match(textOf(sent[0]), KHMER)
    await h.request(`/${token}/cancel`, 'POST', {})
    assert.equal(sent.length, 1, 'cancelling twice announces once')
    // a failed QR at creation
    const f = world(); f.script.generate = () => ({ status: { code: '5' } }); sent.length = 0
    const failed = await f.request('/', 'POST', { lines: [{ product_id: 1, quantity: 1 }], name: 'Sok', phone: '012600001', fulfilment: 'pickup' })
    assert.equal(failed.status, 502)
    assert.equal(sent.length, 1); assert.match(textOf(sent[0]), /could not start/i); assert.match(textOf(sent[0]), KHMER)
    // withdraw
    const w = world(); const wr = await place(w, { phone: PHONE }); w.script.check = () => w.approved(25); await w.callback(tranOf(w))
    await w.request(`/${wr.body.token}/requests`, 'POST', { kind: 'note', phone: PHONE, after: { note: 'gate' } }); sent.length = 0
    const rid = w.one('SELECT MAX(id) id FROM online_order_requests').id
    await w.request(`/${wr.body.token}/requests/${rid}/withdraw`, 'POST', { phone: PHONE })
    assert.equal(sent.length, 1); assert.match(textOf(sent[0]), /withdrawn/i); assert.match(textOf(sent[0]), /Change note/)
    // a declined check: the screens move AND the chat is told once, however many callbacks follow
    const d = world(); await place(d, { phone: PHONE }); sent.length = 0; d.bumps.length = 0
    d.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 3, original_amount: 25 } })
    await d.callback(tranOf(d)); await d.callback(tranOf(d))
    assert.equal(sent.length, 1, sent.map(textOf).join(' | ')); assert.match(textOf(sent[0]), /declined/i); assert.match(textOf(sent[0]), KHMER); assert.equal(d.bumps.length, 1)
  })

  await check('a payment on a QR the customer had replaced is announced ONCE as review, saying so, with what was paid and the order total', async () => {
    const h = world(); const res = await place(h, { phone: PHONE }); const first = tranOf(h)
    await h.request(`/${res.body.token}/edit`, 'POST', { lines: [{ product_id: 1, quantity: 3 }] }); sent.length = 0
    h.script.check = () => h.approved(25)
    await h.callback(first); h.advance(MIN); await h.callback(first)
    assert.equal(sent.length, 1, sent.map(textOf).join(' | ')); const text = textOf(sent[0])
    assert.match(text, /replaced QR/i); assert.match(text, KHMER); assert.match(text, /[$]25[.]00/)
    assert.ok(!text.includes(first), 'no transaction id')
  })

  await check('a valid callback for a transaction this shop has no record of raises ONE alert per transaction per day and writes nothing; only the tail of the id is shown', async () => {
    const h = world(); await place(h); sent.length = 0
    h.sweepModule.resetUnknownAlertsForTests()
    const tran = 'WNEVERISSUED000042'
    const token = (await h.paywayModule.callbackUrlFor(h.env, 'https://shop.example.test', tran)).split('s=')[1]
    const before = h.one('SELECT (SELECT COUNT(*) FROM online_orders) o, (SELECT COUNT(*) FROM online_order_payments) p, (SELECT COUNT(*) FROM online_order_events) e')
    for (let i = 0; i < 3; i += 1) assert.equal((await h.callback(tran, { token })).status, 200)
    assert.equal(sent.length, 1); assert.match(textOf(sent[0]), /not recognised/i); assert.match(textOf(sent[0]), KHMER)
    assert.ok(textOf(sent[0]).includes('...D000042') || textOf(sent[0]).includes('...000042'), 'the tail only'); assert.ok(!textOf(sent[0]).includes(tran))
    assert.deepEqual(h.one('SELECT (SELECT COUNT(*) FROM online_orders) o, (SELECT COUNT(*) FROM online_order_payments) p, (SELECT COUNT(*) FROM online_order_events) e'), before, 'no order write')
    h.advance(24 * 60 * MIN); await h.callback(tran, { token })
    assert.equal(sent.length, 2, 'the next day is a new alert')
  })

  await check('F5: new-order notices are a digest under a flood: the allowance goes one by one, the next order sends ONE digest line with counts only, the rest are quiet, and the next window starts fresh', async () => {
    const h = world()
    const allowance = h.load('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'paid' }).onlineOrderCreatedAlertsPerWindow
    const flood = async (i) => h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 1 }], name: `Spam ${i}`, phone: `0${13000000 + i}`, fulfilment: 'pickup' }, { ip: `10.3.0.${i + 1}` })
    for (let i = 0; i < allowance; i += 1) assert.equal((await flood(i)).status, 201)
    assert.equal(sent.length, allowance, 'within the allowance every order is announced')
    assert.ok(sent.every((m) => /Online order\b/.test(m.text) && !/arriving fast/.test(m.text)))
    assert.equal((await flood(allowance)).status, 201)
    assert.equal(sent.length, allowance + 1, 'the first order past the allowance sends one digest')
    const digest = sent.at(-1).text
    assert.match(digest, /arriving fast/); assert.match(digest, new RegExp(`${allowance + 1}`)); assert.ok(!/Spam|\b0\d{8}\b/.test(digest), 'a digest names nobody: ' + digest)
    for (let i = allowance + 1; i < allowance + 6; i += 1) assert.equal((await flood(i)).status, 201)
    assert.equal(sent.length, allowance + 1, 'the rest of the window is quiet however many more arrive')
    h.advance(11 * MIN)
    assert.equal((await flood(allowance + 6)).status, 201)
    assert.equal(sent.length, allowance + 2); assert.match(sent.at(-1).text, /Online order\b/); assert.ok(!/arriving fast/.test(sent.at(-1).text), 'a new window announces orders one by one again')
  })

  await check('the exchange-rate fallback is never silent: a missing exchange_rate setting is logged once, named in the new-order notice and flagged on the created Record; a configured rate says nothing', async () => {
    const logged = []
    const realError = console.error
    console.error = (...args) => { logged.push(args.map(String).join(' ')); }
    try {
      const h = world()
      h.store.resetRateFallbackLogForTests()
      // control first: the configured rate (the migration chain seeds one) is silent
      h.run("INSERT INTO settings (key, value) VALUES ('exchange_rate', '4000') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      await place(h, { ip: '10.5.0.1' })
      assert.ok(!/Rate:/.test(sent.at(-1).text), 'a configured rate adds no line'); assert.equal(logged.filter((l) => /exchange_rate/.test(l)).length, 0)
      h.run("DELETE FROM settings WHERE key = 'exchange_rate'")
      await place(h, { ip: '10.5.0.2' })
      assert.match(sent.at(-1).text, /Rate: default/, 'the notice says the default rate was used: ' + sent.at(-1).text)
      assert.equal(h.one('SELECT exchange_rate FROM online_orders WHERE id = 2').exchange_rate, h.load('lib/planTier.ts').ONLINE_ORDER_FALLBACK_EXCHANGE_RATE)
      assert.equal(JSON.parse(h.one("SELECT detail_json FROM online_order_events WHERE order_id = 2 AND event = 'created'").detail_json).rate_fallback, true)
      assert.equal(JSON.parse(h.one("SELECT detail_json FROM online_order_events WHERE order_id = 1 AND event = 'created'").detail_json).rate_fallback, undefined)
      await place(h, { ip: '10.5.0.3' })
      assert.equal(logged.filter((l) => /exchange_rate/.test(l)).length, 1, 'logged once per isolate, not once per order')
    } finally { console.error = realError }
  })

  global.fetch = realFetch
  console.log(`online order alerts: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
