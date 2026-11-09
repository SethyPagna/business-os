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
    switchOn: true, nowMs: T0, env: { TELEGRAM_BOT_TOKEN: '123456:test-token' },
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
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: over.phone || `0${12000000 + (phoneSeq += 1)}`, fulfilment: 'pickup', ...over })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res
}
const tranOf = (h, orderId = 1) => h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', orderId).tran_id
const textOf = (message) => message.text

async function main() {
  await check('a new order is announced once, in both languages, to the Sales topic, with the phone masked and no secret in the text', async () => {
    const h = world()
    const res = await place(h, { phone: PHONE })
    assert.equal(sent.length, 1)
    const text = textOf(sent[0])
    assert.match(text, /Online order/); assert.match(text, KHMER, 'the Khmer half is there')
    assert.match(text, /LB-|\d{6,}/, 'it names the order number'); assert.ok(text.includes(h.one('SELECT order_no FROM online_orders').order_no))
    assert.match(text, /Dara/); assert.match(text, /\$25\.00/); assert.equal(sent[0].thread, 77, 'the Sales topic, never General')
    assert.ok(!text.includes('345 678') && !text.includes('012345678'), 'the phone is masked')
    assert.match(text, /\*\*\*/)
    for (const secret of [res.body.token, tranOf(h), 'APV', 'qr', 'abamobilebank']) assert.ok(!text.includes(secret), `no ${secret}`)
    assert.ok(text.split('\n').every((line) => line.length <= 80), 'short rows')
    assert.ok(!text.includes('—'), 'no em dash')
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
    for (let i = 0; i < 11; i += 1) await place(h)
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

  await check('a change request is announced with its kind and the customer words cut short; a withdrawal sends nothing', async () => {
    const h = world(); const res = await place(h, { phone: PHONE }); h.script.check = () => h.approved(25); await h.callback(tranOf(h)); sent.length = 0
    const long = 'please '.repeat(40)
    const ok = await h.request(`/${res.body.token}/requests`, 'POST', { kind: 'note', phone: PHONE, comment: long, after: { note: 'gate' } })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(sent.length, 1); const text = textOf(sent[0])
    assert.match(text, /Change note/); assert.match(text, KHMER); assert.ok(text.length < 700, 'the comment is cut')
    sent.length = 0
    const rid = h.one('SELECT MAX(id) id FROM online_order_requests').id
    await h.request(`/${res.body.token}/requests/${rid}/withdraw`, 'POST', { phone: PHONE })
    assert.equal(sent.length, 0)
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

  global.fetch = realFetch
  console.log(`online order alerts: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
