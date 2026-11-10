// KHQR S5: the bell section for online orders (routes/notifications.ts buildOnlineOrdersSection) on the real migration chain.
// Each scenario names the wrong implementation it must turn red on.
//
// Run: node scripts/test-online-order-bell-native.cjs
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
const user = (id, name, permissions, extra = {}) => ({ id, name, username: name.toLowerCase(), permissions: JSON.stringify(permissions), role_permissions: null, role_code: null, ...extra })
const ADMIN = user(1, 'Owner', { all: true }, { role_code: 'admin' })
const VIEWER = user(2, 'Viewer', { online_orders: true })
const NOBODY = user(3, 'Nobody', { pos: true })
const DECIDE_ONLY = user(4, 'DecideOnly', { 'online_orders:decide': true })

function world() {
  const h = createOrdersHarness({ switchOn: true, spreadNetworks: true, nowMs: T0 })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 50)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 50)', id)
  })
  return h
}
let phoneSeq = 0
const place = async (h) => {
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara Private', phone: `0${12000000 + (phoneSeq += 1)}`, fulfilment: 'pickup' })
  assert.equal(res.status, 201, JSON.stringify(res.body)); return res
}
const tranOf = (h, orderId) => h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', orderId).tran_id
const orderId = (h) => h.one('SELECT MAX(id) id FROM online_orders').id
const pay = async (h) => { await place(h); const id = orderId(h); h.script.check = () => h.approved(25); await h.callback(tranOf(h, id)); return id }
const review = async (h) => { await place(h); const id = orderId(h); h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20 } }); await h.callback(tranOf(h, id)); return id }

async function summary(h, as) {
  h.state.user = as
  const app = h.load('routes/notifications.ts').default
  const response = await app.request('/summary', { method: 'GET' }, h.env, { waitUntil() {}, passThroughOnException() {} })
  return { status: response.status, body: await response.json() }
}
const section = (res) => (res.body.sections || []).find((s) => s.id === 'online_orders')

async function main() {
  await check('the section lists orders that are paid (to fulfil) or in review, review first; unpaid, expired and cancelled orders are not in it (a wrong build counts every order)', async () => {
    const h = world()
    const paid = await pay(h)
    const held = await review(h)
    await place(h) // awaiting payment: not in the queue
    const res = await summary(h, ADMIN)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const s = section(res)
    assert.ok(s, 'the section is present')
    assert.equal(s.count, 2)
    assert.deepEqual(s.items.map((i) => i.kind), ['online_order_review', 'online_order_to_fulfil'])
    assert.deepEqual(s.items.map((i) => i.id), [`online-order-${held}`, `online-order-${paid}`])
    assert.equal(s.summaryKey, 'notification_online_orders_summary')
    assert.deepEqual(s.summaryParams, { reviewCount: 1, toFulfilCount: 1, partPaidCount: 0 })
    assert.equal(s.items[0].metaKey, 'notification_online_orders_review'); assert.equal(s.items[1].metaKey, 'notification_online_orders_to_fulfil')
    for (const item of s.items) { assert.equal(item.pageId, 'sales'); assert.equal(item.anchor, 'hub:sales:orders', 'a bell row opens the Sales hub on its Orders tab') }
    assert.match(s.summary, /1 payment to review/); assert.match(s.summary, /1 paid, to fulfil/)
    assert.equal(s.enabledKey, undefined, 'a queue someone must act on has no mute switch')
    assert.ok(res.body.unreadCount >= 2, 'the bell badge counts it')
    h.run("UPDATE online_orders SET state = 'cancelled' WHERE id = ?", paid)
    assert.equal(section(await summary(h, ADMIN)).count, 1, 'a cancelled order leaves the queue')
    h.run("UPDATE online_orders SET state = 'cancelled' WHERE id = ?", held)
    assert.equal(section(await summary(h, ADMIN)), undefined, 'an empty queue shows no section')
  })

  await check('G7: a paid order that is only part paid (a short payment resolved as received) reads Part paid with the amount to collect, never Paid, to fulfil', async () => {
    const h = world()
    const short = await review(h)
    h.run("UPDATE online_order_payments SET state = 'paid', paid_at = '2026-11-09 04:00:00' WHERE order_id = ?", short)
    h.run("UPDATE online_orders SET state = 'paid', paid_at = '2026-11-09 04:00:00' WHERE id = ?", short)
    const whole = await pay(h)
    const s = section(await summary(h, ADMIN))
    assert.equal(s.count, 2)
    const byId = Object.fromEntries(s.items.map((i) => [i.id, i]))
    assert.equal(byId[`online-order-${short}`].kind, 'online_order_part_paid'); assert.equal(byId[`online-order-${short}`].metaKey, 'notification_online_orders_part_paid'); assert.deepEqual(byId[`online-order-${short}`].metaParams, { totalUsd: '5.00' })
    assert.equal(byId[`online-order-${whole}`].kind, 'online_order_to_fulfil')
    assert.deepEqual(s.summaryParams, { reviewCount: 0, toFulfilCount: 1, partPaidCount: 1 })
    assert.match(s.summary, /1 part paid/); assert.match(s.summary, /1 paid, to fulfil/)
  })

  await check('only people who may VIEW online orders see the section; the decide action alone does not open it (a wrong build shows it to everyone)', async () => {
    const h = world(); await pay(h)
    assert.ok(section(await summary(h, ADMIN)), 'admin')
    assert.ok(section(await summary(h, VIEWER)), 'online_orders view')
    assert.equal(section(await summary(h, NOBODY)), undefined, 'no grant')
    assert.equal(section(await summary(h, DECIDE_ONLY)), undefined, 'decide without view')
  })

  await check('rows carry the order number and total only: no customer name, phone or address ever reaches the bell body', async () => {
    const h = world(); await pay(h)
    const text = JSON.stringify(section(await summary(h, VIEWER)))
    assert.ok(!text.includes('Dara Private'), 'no name'); assert.ok(!/012\d{6}/.test(text.replace(/\s/g, '')), 'no phone')
    assert.match(text, /\$25\.00/)
  })

  await check('the queue is ONE bounded statement over the partial attention index, whatever the number of orders (EXPLAIN), and the preview is capped while the count stays true', async () => {
    const h = world()
    for (let i = 0; i < 3; i += 1) await pay(h)
    h.clearStatements()
    await summary(h, ADMIN)
    const queue = h.statements.filter((sql) => /FROM online_orders o INDEXED BY idx_online_orders_attention/.test(sql))
    assert.equal(queue.length, 1, 'exactly one statement reads the queue')
    const plan = h.all('EXPLAIN QUERY PLAN ' + queue[0]).map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_online_orders_attention/); assert.doesNotMatch(plan, /SCAN o(?! USING)/)
    // 60 paid orders: 50 rows come back, the count is 60
    const cols = h.all('PRAGMA table_info(online_orders)').map((c) => c.name).filter((n) => n !== 'id' && n !== 'order_no' && n !== 'token_hash' && n !== 'client_request_id')
    for (let i = 0; i < 57; i += 1) h.run(`INSERT INTO online_orders (order_no, token_hash, ${cols.join(',')}) SELECT ?, ?, ${cols.join(',')} FROM online_orders WHERE id = 1`, `LB-BULK-${i}`, `hash-${i}`)
    const s = section(await summary(h, ADMIN))
    assert.equal(s.count, 60); assert.equal(s.items.length, 50)
    assert.ok(!s.truncated, 'no show-all offer: that endpoint only knows inventory')
  })

  await check('both language packs name the section, its summary and its rows (no English placeholder in km)', async () => {
    const root = path.join(__dirname, '..', '..', 'frontend', 'src')
    const en = JSON.parse(fs.readFileSync(path.join(root, 'lang', 'en.json'), 'utf8')); const km = JSON.parse(fs.readFileSync(path.join(root, 'lang', 'km.json'), 'utf8'))
    for (const key of ['notification_online_orders']) { assert.ok(en[key], `en ${key}`); assert.ok(km[key] && km[key] !== en[key], `km ${key} is Khmer`) }
    const source = fs.readFileSync(path.join(root, 'components', 'shared', 'NotificationCenter.tsx'), 'utf8')
    for (const key of ['notification_online_orders_summary', 'notification_online_orders_review', 'notification_online_orders_to_fulfil']) assert.ok(source.includes(key), `the panel has copy for ${key}`)
    assert.match(source, /SECTION_LABEL_KEYS\.online_orders = \['notification_online_orders'/)
  })

  console.log(`online order bell: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
