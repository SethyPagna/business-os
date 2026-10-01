const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name).exports
  const file = path.resolve(__dirname, '../src/lib', name + '.ts')
  const mod = { exports: {} }
  cache.set(name, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(id => id.startsWith('./') ? load(id.slice(2)) : require(id), mod, mod.exports)
  return mod.exports
}
const access = load('acquisitionCostAccess')
const pricing = load('saleItemPricing')
const cashier = { role_code: 'cashier', permissions: JSON.stringify({ pos: true, product_cost_view: false, product_cost_edit: false }), role_permissions: '{}' }
const pool = { version: 1, pool_key: 'receipt-pool', evaluation_time: '2026-10-01T00:00:00.000Z', exchange_rate: 4000, rules: [], lines: [{
  line_key: 'retail-line', source: 'selling', product: pricing.capturePricingProduct({ id: 10, selling_price_usd: 10, cost_price_usd: 4 }), selling_price_input_usd: null, manual: { type: 'none', value: 0 }
}] }
const original = pricing.serializeSaleItemPricing(pool, { 'retail-line': 3 }, 'retail-line', { version: 1, lines: [{ line_key: 'retail-line', amount: 30 }], discount_usd: 1, membership_discount_usd: 0, tax_usd: 0 })
const row = { id: 1, pricing_snapshot_json: original, gross_usd: 12, cost_price_usd: 4, total_usd: 30 }
assert.equal(pricing.parseSaleItemPricing(original).amounts.gross_usd, 30)
assert.equal(access.canViewAcquisitionCosts(cashier), false)
const generic = access.projectAcquisitionCosts(row, cashier)
assert.equal(JSON.parse(generic.pricing_snapshot_json).amounts.gross_usd, undefined)
const actual = access.projectAcquisitionCosts(row, cashier, false, pricing.parseSaleItemPricing)
assert.deepEqual(pricing.parseSaleItemPricing(actual.pricing_snapshot_json), pricing.parseSaleItemPricing(original), 'cashier retail snapshot retains the canonical receipt parser contract')
assert.equal(actual.pricing_snapshot_json, original, 'canonical serialized receipt bytes and key ordering survive response projection')
assert.equal(actual.gross_usd, undefined)
assert.equal(actual.cost_price_usd, undefined)
assert.equal(actual.total_usd, 30)
assert.equal(row.pricing_snapshot_json, original)
assert.equal(access.hasAcquisitionCostInput(row, cashier), true)
for (const envelope of ['details', 'request_json', 'old_value', 'undo_payload']) {
  const out = access.projectAcquisitionCosts({ [envelope]: original }, cashier, false, pricing.parseSaleItemPricing)
  assert.equal(JSON.parse(out[envelope]).amounts.gross_usd, undefined, envelope)
}
for (const extra of [false, true]) {
  const document = JSON.parse(original)
  document.gross_usd = 12
  document.amounts.cost_price_usd = 4
  document.pool.lines[0].product.cost_price_usd = 4
  if (extra) {
    document.amounts.source_id = 'stock-source'
    document.amounts.kind = 'hold'
  }
  const projected = access.projectAcquisitionCosts({ pricing_snapshot_json: JSON.stringify(document) }, cashier, false, pricing.parseSaleItemPricing)
  const parsed = JSON.parse(projected.pricing_snapshot_json)
  assert.equal(parsed.gross_usd, undefined)
  assert.equal(parsed.amounts.cost_price_usd, undefined)
  assert.equal(parsed.pool.lines[0].product.cost_price_usd, undefined)
  assert.equal(parsed.amounts.gross_usd, extra ? undefined : 30)
}
for (const context of [{ funding_version: 2 }, { return_scope: 'supplier' }, { source_id: 'stock-source', kind: 'hold' }]) {
  const projected = access.projectAcquisitionCosts({ ...context, pricing_snapshot_json: original }, cashier, false, pricing.parseSaleItemPricing)
  assert.equal(JSON.parse(projected.pricing_snapshot_json).amounts.gross_usd, undefined)
}
for (const context of [{ valuation_version: 1 }, { scope: 'supplier' }, { returnScope: 'supplier' }, { source_id: 'stock-source', kind: 'hold' }]) {
  for (const position of ['document', 'amounts']) {
    const document = JSON.parse(original)
    Object.assign(position === 'document' ? document : document.amounts, context)
    const projected = access.projectAcquisitionCosts({ pricing_snapshot_json: JSON.stringify(document) }, cashier, false, pricing.parseSaleItemPricing)
    assert.equal(JSON.parse(projected.pricing_snapshot_json).amounts.gross_usd, undefined)
  }
}
const alternateKey = access.projectAcquisitionCosts({ pricingSnapshotJson: original }, cashier, false, pricing.parseSaleItemPricing)
assert.equal(JSON.parse(alternateKey.pricingSnapshotJson).amounts.gross_usd, undefined)
for (const json of ['{', JSON.stringify({ version: 1, amounts: { gross_usd: 123 } }), original.replace('"gross_usd":30', '"gross_usd":31')]) {
  const projected = access.projectAcquisitionCosts({ pricing_snapshot_json: json }, cashier, false, pricing.parseSaleItemPricing)
  assert.ok(projected.pricing_snapshot_json === null || JSON.parse(projected.pricing_snapshot_json).amounts.gross_usd === undefined)
}
async function middleware() {
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user', cashier); await next() })
  app.use('*', access.createAcquisitionCostResponses ? access.createAcquisitionCostResponses(pricing.parseSaleItemPricing) : access.acquisitionCostResponses)
  app.get('/', c => c.json(row))
  const response = await app.request('/')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const returned = await response.json()
  assert.deepEqual(pricing.parseSaleItemPricing(returned.pricing_snapshot_json), pricing.parseSaleItemPricing(original))
  assert.equal(returned.gross_usd, undefined)
  assert.equal(returned.cost_price_usd, undefined)
  console.log('PASS actual serializer/parser and Hono cashier response retain retail gross only; private aliases, supplier/lifecycle, malformed and audit contexts stay redacted')
}
middleware().catch(error => { console.error(error); process.exitCode = 1 })
