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
for (const context of [{ funding_version: 2 }, { return_scope: 'supplier' }, { returnScope: 'supplier' }, { source_id: 'stock-source', kind: 'hold' }]) {
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
const supplierAlias = access.projectAcquisitionCosts({ returnScope: 'supplier', total_usd: 12, paid_usd: 8, line_total_usd: 12 }, cashier)
assert.deepEqual(supplierAlias, { returnScope: 'supplier' }, 'normalized supplier alias protects ordinary supplier money too')
for (const json of ['{', JSON.stringify({ version: 1, amounts: { gross_usd: 123 } }), original.replace('"gross_usd":30', '"gross_usd":31')]) {
  const projected = access.projectAcquisitionCosts({ pricing_snapshot_json: json }, cashier, false, pricing.parseSaleItemPricing)
  assert.ok(projected.pricing_snapshot_json === null || JSON.parse(projected.pricing_snapshot_json).amounts.gross_usd === undefined)
}
const supplierFields = ['line_total_usd','total_usd','paid_usd','outstanding_usd','taxable_amount_usd','vat_amount_usd','total_amount_usd','amount_paid_usd','outstanding_balance_usd','total_khr','total_refund_usd','total_refund_khr','applied_price_usd','applied_price_khr','supplier_compensation_usd','supplier_compensation_khr','supplier_loss_usd','supplier_loss_khr','refund_usd','refund_khr']
const moneyAliases = Object.fromEntries(supplierFields.flatMap(field => [[field, 12], [field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), 12]]))
for (const marker of [{ scope: 'supplier' }, { return_scope: 'supplier' }, { returnScope: 'supplier' }]) {
  const original = { ...marker, ...moneyAliases, delivery_actual_cost_usd: 3, product_name: 'Khmer ខូច' }
  assert.deepEqual(access.projectAcquisitionCosts(original, cashier), { ...marker, delivery_actual_cost_usd: 3, product_name: 'Khmer ខូច' }, 'supplier money aliases remain private')
  assert.deepEqual(access.projectAcquisitionCosts({ nested: original }, cashier), { nested: { ...marker, delivery_actual_cost_usd: 3, product_name: 'Khmer ខូច' } })
  const before = JSON.stringify(original)
  assert.equal(access.projectAcquisitionCosts(original, { role_code: 'admin' }), original)
  assert.equal(JSON.stringify(original), before)
}
const ordinaryMoney = { scope: 'customer', totalUsd: 12, paidUsd: 8, refundUsd: 1, total_usd: 12, paid_usd: 8 }
assert.deepEqual(access.projectAcquisitionCosts(ordinaryMoney, cashier), ordinaryMoney)
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
.then(() => { if (!process.exitCode) return supplierResponseContext() })

async function supplierResponseContext() {
  console.log('[ORIGINAL_CHECKS_COMPLETE]')
  let cases = 0
  const aliases = field => [...new Set([field, field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), field.replace(/(^|_)([a-z])/g, (_, prefix, letter) => letter.toUpperCase()), field.toUpperCase(), field.toUpperCase().replaceAll('_', '')])]
  const markers = ['scope', 'Scope', 'SCOPE', 'return_scope', 'returnScope', 'ReturnScope', 'RETURN_SCOPE', 'RETURNSCOPE']
  const selectors = ['field', 'Field', 'FIELD']
  const verify = (input, expected, label) => {
    const before = JSON.stringify(input)
    assert.deepEqual(access.projectAcquisitionCosts(input, cashier, false, pricing.parseSaleItemPricing), expected, label)
    assert.equal(JSON.stringify(input), before, 'response projection preserves actor-neutral source bytes')
    assert.equal(access.projectAcquisitionCosts(input, { role_code: 'admin', permissions: '{"product_cost_view":false}' }), input)
    assert.equal(access.projectAcquisitionCosts(input, { role_code: 'staff', permissions: '{"product_cost_view":true}' }), input)
    cases += 1
  }
  for (const marker of markers) {
    for (const context of ['supplier', ' SUPPLIER ']) {
      for (const selector of selectors) {
        for (const field of supplierFields.flatMap(aliases)) {
          const input = { [marker]: context, [selector]: field, old_value: 88, new_value: 99, retained_label: 'ខូច' }
          const expected = { field, redacted: true }
          verify(input, expected, 'supplier field diff ' + marker + '/' + context + '/' + selector + '/' + field)
          verify({ details: JSON.stringify(input) }, { details: JSON.stringify(expected) }, 'serialized supplier field diff')
        }
      }
    }
  }
  for (const selector of selectors) {
    verify({ [selector]: 'costPriceUsd', old_value: 88, new_value: 99 }, { field: 'costPriceUsd', redacted: true }, 'normalized acquisition selector')
    verify({ entity: 'stock_funding', [selector]: 'amountUsd', old_value: 88, new_value: 99 }, { field: 'amountUsd', redacted: true }, 'normalized lifecycle selector')
  }
  verify({ scope: 'supplier', FIELD: ' totalUsd ', old_value: 88, new_value: 99 }, { field: ' totalUsd ', redacted: true }, 'trim selector classification retains field label')
  verify({ field: 'product_name', FIELD: 'costPriceUsd', old_value: 88, new_value: 99 }, { field: 'costPriceUsd', redacted: true }, 'all selector aliases are inspected before keeping a benign alias')
  verify({ field: 'totalUsd', Scope: 'supplier', return_scope: 'customer', old_value: 88, new_value: 99 }, { field: 'totalUsd', redacted: true }, 'conflicting supplier marker remains private')
  const groups = ['periodSupplierReturns', 'period_supplier_returns', 'PeriodSupplierReturns', 'PERIOD_SUPPLIER_RETURNS', 'PERIODSUPPLIERRETURNS']
  const groupedMoney = Object.fromEntries(supplierFields.flatMap(aliases).map(field => [field, 99]))
  for (const group of groups) {
    const input = { [group]: [{ ...groupedMoney, count: 3, product_name: 'ខូច', delivery_actual_cost_usd: 4 }], ordinary: ordinaryMoney }
    const expected = { [group]: [{ count: 3, product_name: 'ខូច', delivery_actual_cost_usd: 4 }], ordinary: ordinaryMoney }
    verify(input, expected, 'normalized supplier group ' + group)
    verify({ details: JSON.stringify(input) }, { details: JSON.stringify(expected) }, 'serialized supplier group ' + group)
    const projected = access.projectAcquisitionCosts({ [group]: [{ pricing_snapshot_json: original }] }, cashier, false, pricing.parseSaleItemPricing)
    assert.equal(JSON.parse(projected[group][0].pricing_snapshot_json).amounts.gross_usd, undefined, 'supplier group never receives retail gross exemption')
  }
  for (const scope of ['customer', 'retail', 'delivery']) {
    for (const selector of selectors) {
      const input = { scope, [selector]: 'totalUsd', old_value: 88, new_value: 99, delivery_actual_cost_usd: 4 }
      verify(input, input, 'ordinary monetary field diff survives ' + scope + '/' + selector)
    }
  }
  verify({ scope: 'customer', field: 'deliveryActualCostUsd', old_value: 4, new_value: 5 }, { scope: 'customer', field: 'deliveryActualCostUsd', old_value: 4, new_value: 5 }, 'courier amendment exception remains')
  verify({ field: 'sellingPriceUsd', old_value: 88, new_value: 99 }, { field: 'sellingPriceUsd', old_value: 88, new_value: 99 }, 'retail selling price diff survives')
  assert.equal(access.hasAcquisitionCostInput({ scope: 'customer', totalUsd: 99 }, cashier), false)
  assert.equal(access.hasAcquisitionCostInput({ field: 'costPriceUsd', old_value: 88, new_value: 99 }, cashier), true)
  let user = cashier
  const payload = { changes: [{ SCOPE: 'SUPPLIER', FIELD: 'totalUsd', old_value: 88, new_value: 99 }], PERIOD_SUPPLIER_RETURNS: [{ totalUsd: 99, count: 3 }], ordinary: ordinaryMoney, pricing_snapshot_json: original }
  const expected = { changes: [{ field: 'totalUsd', redacted: true }], PERIOD_SUPPLIER_RETURNS: [{ count: 3 }], ordinary: ordinaryMoney, pricing_snapshot_json: original }
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user', user); return next() })
  app.use('*', access.createAcquisitionCostResponses(pricing.parseSaleItemPricing))
  app.get('/api/system/audit-logs', c => c.json(payload, 201, { 'X-context': 'supplier' }))
  const before = JSON.stringify(payload), denied = await app.request('/api/system/audit-logs')
  assert.equal(denied.status, 201)
  assert.equal(denied.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(denied.headers.get('X-context'), 'supplier')
  assert.deepEqual(await denied.json(), expected)
  user = { role_code: 'admin', permissions: '{"product_cost_view":false}' }
  assert.deepEqual(await (await app.request('/api/system/audit-logs')).json(), payload)
  assert.equal(JSON.stringify(payload), before)
  console.log('PASS supplier response context matrix ' + cases + ' cases; actual Hono aliases, canonical redacted shape, ordinary amounts, admin grant and immutable retail snapshots')
}
