const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { openDb } = require('./harness/d1compat.cjs')

async function loadKernel() {
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/customerReturnEntitlement'; export * from './src/lib/saleItemPricing';", resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022',
  })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function loadReturnRoute() {
  const bundle = await build({ entryPoints: [path.resolve(__dirname, '../src/routes/returns.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}

function pool(lines, rate = 4000) {
  return {
    version: 1, pool_key: 'pool-1', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: rate, rules: [],
    lines: lines.map(line => ({ line_key: line.key, source: 'selling',
      product: { id: line.id, selling_price_usd: line.price, selling_price_khr: line.price * rate,
        wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0,
        discount_amount_khr: 0, discount_percent: 0 },
      selling_price_input_usd: null, manual: { type: 'none', value: 0 } })),
  }
}

function source(m, definitions, allocation, saleTotal, delivery = 0) {
  const pricingPool = pool(definitions)
  const quantities = Object.fromEntries(definitions.map(line => [line.key, line.quantity]))
  const rows = definitions.map(line => {
    const pricing = m.serializeSaleItemPricing(pricingPool, quantities, line.key, allocation)
    return { id: line.id, product_id: line.id, quantity: line.quantity,
      total_usd: m.parseSaleItemPricing(pricing).amounts.total_usd,
      pricing_snapshot_json: pricing, pricing_snapshot_digest: String(line.id).padStart(64, '0') }
  })
  const product = rows.reduce((sum, row) => sum + m.parseSaleItemPricing(row.pricing_snapshot_json).receipt_allocation.net_entitlement_usd, 0)
  return { sale_id: 1, sale_revision: 7, money_precision_version: 1,
    calculated_total_usd: +(product + delivery).toFixed(4), total_usd: saleTotal,
    exchange_rate: 4000, customer_delivery_fee_usd: delivery, lines: rows }
}

async function main() {
  const m = await loadKernel()
  assert.equal(m.prorateCustomerReturnMoney4(10.005, 1, 3), 3.335)
  assert.equal(m.prorateCustomerReturnMoney4(10.005, 2, 3), 6.67)
  assert.throws(() => m.prorateCustomerReturnMoney4(1, 4, 3), /customer_return_quantity_invalid/)

  const basket = [{ id: 1, key: 'A', price: 10, quantity: 1 }, { id: 2, key: 'B', price: 20, quantity: 1 }]
  const context = { version: 1, lines: basket.map(line => ({ line_key: line.key, amount: line.price })),
    discount_usd: 3, membership_discount_usd: 0, tax_usd: 2 }
  const quote = m.buildCustomerReturnQuoteV1({ sale: source(m, basket, context, 29),
    requested: [{ sale_item_id: 2, quantity: 1 }, { sale_item_id: 1, quantity: 1 }], previous: [] })
  assert.equal(quote.product_entitlement_usd, 29)
  assert.equal(quote.calculated_refund_usd, 29)
  assert.equal(quote.total_refund_usd, 29)
  assert.deepEqual(quote.items.map(line => [line.sale_item_id, line.total_usd]), [[2, 19.3333], [1, 9.6667]])
  quote.items.forEach(line => assert.equal(m.parseCustomerReturnRefundSnapshot(line.refund_snapshot_json).calculated_refund_usd, line.total_usd))

  const one = [{ id: 1, key: 'A', price: 10.01, quantity: 3 }]
  const oneContext = { version: 1, lines: [{ line_key: 'A', amount: 30.03 }],
    discount_usd: 20.025, membership_discount_usd: 0, tax_usd: 0 }
  const sale = source(m, one, oneContext, 10.01)
  const prior = []
  const payouts = []
  for (let id = 1; id <= 3; id += 1) {
    const next = m.buildCustomerReturnQuoteV1({ sale, requested: [{ sale_item_id: 1, quantity: 1 }], previous: prior })
    payouts.push(next.total_refund_usd)
    prior.push({ id, money_precision_version: 1, calculated_refund_usd: next.calculated_refund_usd,
      rounding_adjustment_usd: next.rounding_adjustment_usd, total_refund_usd: next.total_refund_usd,
      items: next.items.map(item => ({ sale_item_id: item.sale_item_id, quantity: item.quantity,
        total_usd: item.total_usd, refund_snapshot_json: item.refund_snapshot_json })) })
  }
  assert.deepEqual(payouts, [3.34, 3.33, 3.34])
  assert.equal(prior.reduce((sum, row) => sum + row.total_refund_usd, 0), 10.01)
  assert.throws(() => m.buildCustomerReturnQuoteV1({ sale, requested: [{ sale_item_id: 1, quantity: 1 }], previous: prior }), /quantity_exceeded/)
  const tampered = JSON.parse(prior[0].items[0].refund_snapshot_json)
  tampered.calculated_refund_usd += 0.0001
  assert.throws(() => m.parseCustomerReturnRefundSnapshot(JSON.stringify(tampered)), /snapshot_invalid/)
  assert.throws(() => m.buildCustomerReturnQuoteV1({ sale, requested: [{ sale_item_id: 1, quantity: 1 }],
    previous: [{ ...prior[0], items: [{ ...prior[0].items[0], refund_snapshot_json: null }] }] }), /legacy_refund_review_needed/)
  console.log('PASS customer-return v1 pure entitlement: basket allocation, exact cumulative residual, cap, malformed and legacy refusal')

  const migrationDir = path.resolve(__dirname, '../migrations')
  const beforeMigrations = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql') && name < '0160').sort()
    .map(name => fs.readFileSync(path.join(migrationDir, name), 'utf8'))
  const migration = fs.readFileSync(path.join(migrationDir, '0160_customer_return_refund_snapshot.sql'), 'utf8')
  assert.ok(!migration.includes('\r'), 'migration must be LF-only')
  assert.doesNotMatch(migration.replace(/^\s*--.*$/gm, ''), /\bUPDATE\b/i)
  const { db } = openDb(beforeMigrations)
  db.exec("INSERT INTO returns(id,total_refund_usd) VALUES(1,1.234567); INSERT INTO return_items(id,return_id,total_usd,total_khr) VALUES(1,1,1.234567,5000.1234)")
  const before = db.prepare('SELECT * FROM return_items').all()
  db.exec(migration)
  const after = db.prepare('SELECT * FROM return_items').all()
  assert.equal(after[0].refund_snapshot_json, null)
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(before[0]).map(key => [key, after[0][key]])))), JSON.parse(JSON.stringify(before[0])))
  db.exec("INSERT INTO return_items(return_id,total_usd,refund_snapshot_json) VALUES(1,2.3456,'{\"version\":1}')")
  assert.equal(db.prepare('SELECT refund_snapshot_json FROM return_items WHERE id=2').get().refund_snapshot_json, '{"version":1}')
  const route = await loadReturnRoute()
  const routeBasket = [{ id: 11, key: 'quote-A', price: 10, quantity: 1 }, { id: 12, key: 'quote-B', price: 20, quantity: 1 }]
  const routeContext = { version: 1, lines: routeBasket.map(line => ({ line_key: line.key, amount: line.price })),
    discount_usd: 3, membership_discount_usd: 0, tax_usd: 2 }
  const routePool = pool(routeBasket)
  const routeQuantities = Object.fromEntries(routeBasket.map(line => [line.key, line.quantity]))
  db.prepare(`INSERT INTO sales(id,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd,
    exchange_rate,is_delivery,delivery_fee_usd,delivery_fee_paid_by) VALUES(2,29,1,29,0,4000,0,0,'customer')`).run()
  for (const line of routeBasket) db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,quantity,total_usd,pricing_snapshot_json)
    VALUES(?,?,?,1,?,?)`).run(line.id, 2, line.id, line.price,
      m.serializeSaleItemPricing(routePool, routeQuantities, line.key, routeContext))
  const compat = { prepare(sql) { return { get: async params => db.prepare(sql).get(params), all: async params => db.prepare(sql).all(params) } } }
  const loadedQuote = await route.customerReturnQuoteFromDb(compat, 2, [{ sale_item_id: 11, quantity: 1 }])
  assert.equal(loadedQuote.calculated_refund_usd, 9.6667)
  assert.equal(loadedQuote.items[0].refund_snapshot_json.includes('source_pricing_snapshot_digest'), true)
  assert.equal(Object.hasOwn(route.publicCustomerReturnQuote(loadedQuote).items[0], 'refund_snapshot_json'), false)
  db.close()
  console.log('PASS migration 0160 and actual quote loader: additive nullable provenance, exact legacy invariance, server snapshot hidden')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
