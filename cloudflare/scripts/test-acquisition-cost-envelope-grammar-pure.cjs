const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.resolve(__dirname, '../src')
function loadAccess(transform = source => source, entry = 'acquisitionCostAccess.ts') {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }; cache.set(file, mod)
    const source = fs.readFileSync(file, 'utf8')
    const code = ts.transpileModule(file.endsWith('acquisitionCostAccess.ts') ? transform(source) : source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    new Function('require', 'module', 'exports', code)(name => name.startsWith('.')
      ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name), mod, mod.exports)
    return mod.exports
  }
  return load(path.join(root, 'lib', entry))
}
const actor = (own = {}, role = {}, role_code = 'manager') => ({ role_code, permissions: JSON.stringify(own), role_permissions: JSON.stringify(role) })
const denied = actor({ products: true, inventory: true, sales: true, product_cost_view: false, product_cost_edit: false }, { product_cost_view: true, product_cost_edit: true })
const viewer = actor({}, { product_cost_view: true })
const editor = actor({ product_cost_edit: true })
const access = loadAccess()
const encode = (value, layers = 1) => { while (layers-- > 0) value = JSON.stringify(value); return value }
const envelopes = ['details', 'old_value', 'new_value', 'undo_payload', 'redo_payload', 'request_json', 'response_json', 'receipt_json', 'targets_json', 'pricing_snapshot_json', 'payload_json', 'source_json', 'allocations_json', 'physical_json', 'snapshot_json', 'steps_json', 'baseline_json', 'repair_json', 'original_json', 'custom_json']
const rows = ['records', 'rows', 'items', 'events', 'segments', 'invoices', 'changes', 'targets', 'allocations', 'shares', 'lines', 'native_sources']
const keys = [...new Set([...envelopes, ...rows, ...rows.map(key => key + '_json'), 'DETAILS', 'UNDOPAYLOAD', 'OLDVALUE', 'itemsJson', 'PERIOD_SUPPLIER_RETURNS', 'periodSupplierReturns'])]
const shapes = {
 object: row => row, arrayObjects: row => [row], arrayStrings: row => [encode(row)], arrayDoubleStrings: row => [encode(row, 2)],
 nestedArrayStrings: row => [[encode(row)]], mixedArray: row => [{ count: 1 }, [encode(row)]], encodedObject: row => encode(row),
 doubleEncodedObject: row => encode(row, 2), encodedArrayObjects: row => encode([row]), encodedArrayStrings: row => encode([encode(row)]),
 doubleEncodedArrayStrings: row => encode([encode(row)], 2), encodedNestedArrayStrings: row => encode([[encode(row, 2)]]), objectKnownChild: row => ({ records: [encode(row, 2)] }),
}
const routeSpecimens = [
 [{ details: encode([encode({ cost_price_usd: 73129, count: 2 })]) }, { details: encode([encode({ count: 2 })]) }],
 [{ scope: 'supplier', details: [encode({ total_usd: 91329, count: 2 })] }, { scope: 'supplier', details: [encode({ count: 2 })] }],
 [{ undo_payload: encode([encode({ cost_price_usd: 73129, count: 2 })]) }, { undo_payload: encode([encode({ count: 2 })]) }],
]
function checkGenericEnvelopeGrammar(api, denied, viewer) {
 const contexts = [{ name: 'protectedKey', outer: {}, row: { cost_price_usd: 73129, count: 2 } }, { name: 'supplier', outer: { scope: 'supplier' }, row: { total_usd: 91329, count: 2 } }]
 const observations = []
 for (const context of contexts) for (const key of keys) for (const [shape, build] of Object.entries(shapes)) {
  const value = { ...context.outer, [key]: build(context.row) }, expected = { ...context.outer, [key]: build({ count: 2 }) }, before = JSON.stringify(value)
  const correct = JSON.stringify(api.projectAcquisitionCosts(value, denied)) === JSON.stringify(expected), blocks = api.hasAcquisitionCostInput(value, denied)
  observations.push({ context: context.name, key, shape, correct, blocks })
  assert.equal(JSON.stringify(value), before)
  assert.equal(api.projectAcquisitionCosts(value, viewer), value)
 }
 const failures = observations.filter(row => !row.correct || !row.blocks)
 console.log('PORTABLE_GENERIC_MATRIX', JSON.stringify({ cases: observations.length, failures: failures.length, firstFailures: failures.slice(0, 4) }))
 assert.equal(failures.length, 0)
 const literalFields = ['names', 'product_names', 'merged_names', 'labels', 'tags', 'categories', 'brands', 'source_ids']
 const literals = Object.fromEntries(literalFields.flatMap(key => [key, key.toUpperCase(), key.replaceAll('_', '').toUpperCase()]).map(key => [key, ['ខូច', encode({ cost_price_usd: 73129 })]]))
 const ordinary = { scope: 'customer', details: { nested: { ...literals, note: '{literal}', product_name: encode({ cost_price_usd: 73129 }), paid_usd: 5, amount_usd: 8, delivery_actual_cost_usd: 3 } } }
 assert.deepEqual(api.projectAcquisitionCosts(ordinary, denied), ordinary)
 assert.equal(api.hasAcquisitionCostInput(ordinary, denied), false)
 for (const [value, expected] of routeSpecimens) { assert.deepEqual(api.projectAcquisitionCosts(value, denied), expected); assert.equal(api.hasAcquisitionCostInput(value, denied), true) }
 return { cases: observations.length, failures: failures.length }
}
checkGenericEnvelopeGrammar(access, denied, viewer)

for (const value of ['{broken', '2', 'null', '"scalar"', '""']) {
  const input = { details: value }
  assert.equal(access.hasAcquisitionCostInput(input, denied), true)
  assert.deepEqual(access.projectAcquisitionCosts(input, denied), { details: null })
}
assert.deepEqual(access.projectAcquisitionCosts({ details: ['', '{broken'] }, denied), { details: [null, null] })
assert.equal(access.hasAcquisitionCostInput({ details: ['', '{broken'] }, denied), true)
assert.deepEqual(access.projectAcquisitionCosts({ details: '  ' }, denied), { details: '  ' })
assert.equal(access.hasAcquisitionCostInput({ details: '  ' }, denied), false)
const exactLayer = JSON.stringify({ note: 'x'.repeat(2_000_000 - JSON.stringify({ note: '' }).length) })
assert.equal(exactLayer.length, 2_000_000)
assert.deepEqual(access.projectAcquisitionCosts({ details: exactLayer }, denied), { details: exactLayer })
assert.equal(access.hasAcquisitionCostInput({ details: exactLayer }, denied), false)
const oversized = exactLayer.slice(0, -2) + 'x"}'
assert.equal(oversized.length, 2_000_001)
assert.deepEqual(access.projectAcquisitionCosts({ details: oversized }, denied), { details: null })
assert.equal(access.hasAcquisitionCostInput({ details: oversized }, denied), true)
const multibyte = JSON.stringify({ note: 'ខ'.repeat(400_000) })
const budgetRows = { rows: Array(14).fill(multibyte) }
const budgetBefore = JSON.stringify(budgetRows)
const budgetOut = access.projectAcquisitionCosts(budgetRows, denied)
assert.ok(Buffer.byteLength(multibyte) * 13 < 16 * 1024 * 1024)
assert.ok(Buffer.byteLength(multibyte) * 14 > 16 * 1024 * 1024)
assert.deepEqual(budgetOut.rows.slice(0, 13), Array(13).fill(multibyte))
assert.equal(budgetOut.rows[13], null)
assert.equal(access.hasAcquisitionCostInput(budgetRows, denied), true)
assert.equal(JSON.stringify(budgetRows), budgetBefore)
assert.equal(access.projectAcquisitionCosts(budgetRows, viewer), budgetRows)
assert.equal(access.hasAcquisitionCostInput(budgetRows, editor), false)
let tooDeep = { count: 2 }
for (let depth = 0; depth < 33; depth++) tooDeep = { nested: tooDeep }
assert.equal(access.hasAcquisitionCostInput({ details: tooDeep }, denied), true)
assert.match(JSON.stringify(access.projectAcquisitionCosts({ details: tooDeep }, denied)), /null/)
for (const payload of [{ field: 'cost_price_usd', before: 3, after: 4 }, { scope: 'supplier', field: 'total_usd', before: 3, after: 4 }]) {
  assert.equal(access.hasAcquisitionCostInput(payload, denied), true)
  assert.deepEqual(access.projectAcquisitionCosts(payload, denied), { field: payload.field, redacted: true })
}
const provenance = { details: { source_ids_json: JSON.stringify(['source-1', '{literal}']), tags: [{ cost_price_usd: 7, name: 'ខូច' }] } }
assert.deepEqual(access.projectAcquisitionCosts(provenance, denied), { details: { source_ids_json: JSON.stringify(['source-1', '{literal}']), tags: [{ name: 'ខូច' }] } })
assert.equal(access.hasAcquisitionCostInput(provenance, denied), true)

async function checkRetailBasket() {
  const pricing = loadAccess(source => source, 'saleItemPricing.ts')
  const lines = Array.from({ length: 200 }, (_, index) => ({ line_key: 'line-' + index, source: 'selling',
    product: pricing.capturePricingProduct({ id: index + 1, name: 'ផលិតផល ' + index, selling_price_usd: 10, cost_price_usd: 4 }),
    selling_price_input_usd: null, manual: { type: 'none', value: 0 } }))
  const pool = { version: 1, pool_key: 'receipt-pool', evaluation_time: '2026-10-01T00:00:00.000Z', exchange_rate: 4000, rules: [], lines }
  const quantities = Object.fromEntries(lines.map(line => [line.line_key, 3]))
  const header = { version: 1, lines: lines.map(line => ({ line_key: line.line_key, amount: 30 })), discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
  const items = lines.map(line => ({ pricing_snapshot_json: pricing.serializeSaleItemPricing(pool, quantities, line.line_key, header), gross_usd: 30, total_usd: 30 }))
  const payload = { items }, original = JSON.stringify(payload)
  const projected = access.projectAcquisitionCosts(payload, denied)
  assert.equal(JSON.stringify(projected), original)
  assert.equal(access.hasAcquisitionCostInput(payload, denied), false)
  for (const item of projected.items) assert.equal(pricing.parseSaleItemPricing(item.pricing_snapshot_json).amounts.gross_usd, 30)
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user', denied); await next() })
  app.use('*', access.acquisitionCostResponses)
  app.get('/', c => c.json(payload))
  const response = await app.request('/')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(await response.text(), original)
  assert.equal(JSON.stringify(payload), original)
  console.log('PASS bounded decode, UTF8 shared budget, literal provenance, private selectors and real 200-line retail basket', JSON.stringify({ responseBytes: Buffer.byteLength(original) }))
}
checkRetailBasket().catch(error => { console.error(error); process.exitCode = 1 })
