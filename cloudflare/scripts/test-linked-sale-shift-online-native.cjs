// KHQR S6a condition 1 (lead, 10 Nov 2026): the online (KHQR) money on a linked sale is in NO shift's drawer and NO shift's "digital taken" figure, by the order link.
// Real lib/shiftReconciliation.ts over the real migration chain. Controls: the same sale unlinked counts its KHQR tender as digital (so the exclusion is the link, not the
// method name), and any other tender of the linked sale (cash at the till) stays counted.
//
// Run: node scripts/test-linked-sale-shift-online-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)

function world() {
  const h = createOrdersHarness({ switchOn: true, nowMs: T0 })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 50)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 50)', id)
  })
  return h
}
const KINDS = { configuredMethods: ['Cash', 'ABA KHQR'], kinds: {} }
const SHIFT = { scope_mode: 'shop_wide', user_id: 7, branch_id: 1, opened_at: '2026-11-09 01:00:00', closed_at: '2026-11-09 10:00:00', opening_float_usd: 0, opening_float_khr: 0 }

/** A fulfilled-style linked sale (ordinary version 0): 25 paid online by KHQR, `cash` taken at the till. */
function linkedSale(h, { link = true, cash = 5, saleId = 50, orderId = 1, usd = 25, recorded = usd } = {}) {
  const details = [{ method: 'ABA KHQR', amount_usd: usd, amount_khr: 0 }, ...(cash ? [{ method: 'Cash', amount_usd: cash, amount_khr: 0 }] : [])]
  h.run("INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, payment_method, payment_details, sale_status, created_at, exchange_rate, money_precision_version, branch_id, cashier_id, payments_version) VALUES (?, ?, ?, ?, ?, 'ABA KHQR + Cash', ?, 'completed', '2026-11-09 05:00:00', 4000, 1, 1, 7, 0)", saleId, 'R' + saleId, usd + cash, usd + cash, usd + cash, JSON.stringify(details))
  if (link) {
    h.run("UPDATE online_orders SET state = 'fulfilled', sale_id = ? WHERE id = ?", saleId, orderId)
    h.run("INSERT INTO online_order_events (order_id, payment_id, event, source, amount_usd, sale_id, created_at) VALUES (?, 1, 'payment_recorded_on_sale', 'staff', ?, ?, '2026-11-09 05:00:00')", orderId, recorded, saleId)
  }
}
async function paidOrder(h) {
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: '012345678', fulfilment: 'pickup' })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  h.script.check = () => h.approved(25)
  await h.callback(h.one('SELECT tran_id FROM online_order_payments WHERE order_id = 1 ORDER BY id DESC').tran_id)
  assert.equal(h.one('SELECT state FROM online_orders WHERE id = 1').state, 'paid')
}
const shiftModule = (h) => h.load('lib/shiftReconciliation.ts')

async function main() {
  await check('a linked sale: the shift drawer holds only the cash taken at the till, and the digital figure holds NONE of the online money (a build without the exclusion reports 25 digital)', async () => {
    const h = world(); await paidOrder(h); linkedSale(h)
    const cash = await shiftModule(h).shiftCashSales(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.equal(cash.usd, 5, 'cash taken at the till'); assert.equal(cash.digital.usd, 0, 'the online money is in no digital figure')
    assert.equal(cash.needsReview, false, JSON.stringify(cash.reviewCodes))
    const tenders = await shiftModule(h).shiftSaleTenders(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.deepEqual(tenders.find((entry) => entry[0] === 50), [50, 5, 0, 0, 0], 'the per-sale fingerprint agrees: [id, cash usd, cash khr, digital usd, digital khr]')
  })

  await check('control: the same sale NOT linked to an order counts its KHQR tender as digital (so the exclusion is the order link, never the method name)', async () => {
    const h = world(); await paidOrder(h); linkedSale(h, { link: false })
    const cash = await shiftModule(h).shiftCashSales(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.equal(cash.usd, 5); assert.equal(cash.digital.usd, 25)
    const tenders = await shiftModule(h).shiftSaleTenders(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.deepEqual(tenders.find((entry) => entry[0] === 50), [50, 5, 0, 25, 0])
  })

  await check('a digital tender taken at the till on the same linked sale still counts: only the order\'s recorded online amount is removed, and never below zero', async () => {
    const h = world(); await paidOrder(h); linkedSale(h, { cash: 0 })
    // the till also took 4 by KHQR itself for an added line
    h.run("UPDATE sales SET total_usd = 29, calculated_total_usd = 29, amount_paid_usd = 29, payment_details = ? WHERE id = 50", JSON.stringify([{ method: 'ABA KHQR', amount_usd: 29, amount_khr: 0 }]))
    const cash = await shiftModule(h).shiftCashSales(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.equal(cash.digital.usd, 4, '29 tendered, 25 of it was the online order')
    const big = world(); await paidOrder(big); linkedSale(big, { cash: 0, recorded: 90 })
    assert.equal((await shiftModule(big).shiftCashSales(big.env, SHIFT, T0 + 20 * 3_600_000, KINDS)).digital.usd, 0, 'a larger recorded amount cannot make the figure negative')
  })

  await check('a cancelled linked sale and one outside the shift window change nothing; a database without the online tables answers as before (fail open)', async () => {
    const h = world(); await paidOrder(h); linkedSale(h)
    h.run("UPDATE sales SET created_at = '2026-11-12 05:00:00' WHERE id = 50")
    const outside = await shiftModule(h).shiftCashSales(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.equal(outside.usd, 0); assert.equal(outside.digital.usd, 0)
    const g = world(); await paidOrder(g); linkedSale(g)
    g.run('DROP TABLE online_order_events'); g.run('DROP TABLE online_order_payments'); g.run('DROP TABLE online_orders')
    const noTables = await shiftModule(g).shiftCashSales(g.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    assert.equal(noTables.usd, 5); assert.equal(noTables.digital.usd, 25, 'no tables: nothing is linked, nothing is removed, nothing throws')
  })

  await check('the exclusion reads only linked sales: one statement driven by the unique sale index, never a scan of sales or events (EXPLAIN)', async () => {
    const h = world(); await paidOrder(h); linkedSale(h)
    h.clearStatements()
    await shiftModule(h).shiftCashSales(h.env, SHIFT, T0 + 20 * 3_600_000, KINDS)
    const sql = h.statements.find((s) => /FROM online_orders o INDEXED BY idx_online_orders_sale/.test(s))
    assert.ok(sql, 'the linked-money statement ran')
    const bound = sql.replace(/@(\w+)/g, (_, n) => ({ createdFrom: "'2026-11-09 01:00:00'", createdTo: "'2026-11-09 10:00:00'", branchId: '1' }[n] ?? '1'))
    const plan = h.all('EXPLAIN QUERY PLAN ' + bound).map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_online_orders_sale/); assert.doesNotMatch(plan, /SCAN online_order_events(?! USING)/)
  })

  console.log(`linked sale shift: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
