const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.resolve(__dirname, '../src')
function loadAccess(transform = source => source) {
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
  return load(path.join(root, 'lib/acquisitionCostAccess.ts'))
}
const actor = (own = {}, role = {}, role_code = 'manager') => ({ role_code, permissions: JSON.stringify(own), role_permissions: JSON.stringify(role) })
const denied = actor({ products: true, inventory: true, sales: true, product_cost_view: false, product_cost_edit: false }, { product_cost_view: true, product_cost_edit: true })
const viewer = actor({}, { product_cost_view: true })
const editor = actor({ product_cost_edit: true })
const access = loadAccess()
const funding = { funding_version: 2, source_id: 'paid-source', event_id: 'accept', generation: 1, kind: 'accept',
  gross4: 1000000, paid4: 800000, debt4: 0, credit4: 300000, asset4: 100000,
  cash_in4: 0, cash_out4: 0, shipping4: 17000, claim_id: 'agreement', fee_id: null }
const held = { segment_id: 'held', allocation_id: 'held-allocation', fate: 'held', quantity: '2', gross4: 500000, coverage4: 150000, loss4: 0, recovery4: 0, reason: 'broken' }
const disposed = { segment_id: 'disposed', allocation_id: 'disposed-allocation', fate: 'disposed', quantity: '1', gross4: 250000, coverage4: 150000, loss4: 250000, recovery4: 150000, reason: 'broken' }
const valuation = { valuation_version: 3, source_id: 'paid-source', event_id: 'v-accept', revision: 3, kind: 'accept', funding,
  segments: [held, disposed], totals: { sellable_quantity: '1', held_quantity: '2', sellable_net4: 250000,
    held_net4: 350000, historical_loss4: 250000, recovery4: 150000, coverage4: 300000 }, pending4: 300000 }
const disposition = { entity: 'stock_disposition', event_id: 'dispose', allocation_id: 'held-allocation', source_id: 'paid-source',
  generation: 1, kind: 'dispose', quantity: '1', gross4: 250000, coverage4: 150000, coverage_state: 'allocated_accepted_credit', net4: 100000, recognized4: 100000,
  remaining_quantity: '1', remaining_gross4: 250000, remaining_coverage4: 0, extra_fee4: 17000 }
const aliases = { openingPaid4: 800000, openingDebt4: 200000, remainingGross4: 250000, remainingCoverage4: 150000,
  remainingNet4: 100000, cashIn4: 100000, cashOut4: 800000, purchase_gross4: 1000000, sellable_gross4: 250000,
  held_gross4: 500000, held_net4: 350000, accepted_credit4: 300000, recognized_loss4: 250000,
  extra_cash_fee4: 17000, current_debt4: 0, current_paid4: 800000, refund_asset4: 100000 }
const shares = [{ segment_id: 'held', amount_usd: 15, amount4: 150000 }, { segment_id: 'disposed', amount_usd: 15, amount4: 150000 }]
const ordinary = { scope: 'customer', sale_id: 9, paid_usd: 80, amount_paid_usd: 80, total_amount_usd: 100,
  amount_usd: 20, amount_khr: 80000, refund_usd: 20, revenue_usd: 100, shares: [{ amount4: 120000, amount_usd: 12 }],
  fees: [{ fee_id: 2, amount_usd: 1.7, amount_khr: 0 }], delivery_actual_cost_usd: 3, actual_cost_usd: 3 }
const cache = { records: [funding, valuation, disposition, aliases, ordinary],
  details: JSON.stringify(valuation), old_value: JSON.stringify({ entity: 'stock_funding', amount4: 300000 }),
  new_value: JSON.stringify(disposition), undo_payload: { applier: 'stock_valuation.accept', before: { amount_usd: 30, shares } },
  redo_payload: JSON.stringify({ applier: 'stock_funding.payment', after: { amount_usd: 80 } }),
  request_json: JSON.stringify({ source_id: 'paid-source', kind: 'pending', amount_usd: 30, targets: shares }),
  changes: [{ field: 'remainingGross4', before: 500000, after: 250000 }],
  note: JSON.stringify(valuation) }
const original = JSON.stringify(cache)
function checkEconomicProjection(api) {
  const projected = api.projectAcquisitionCosts(cache, denied)
  assert.deepEqual(projected.records[0], { funding_version: 2, source_id: 'paid-source', event_id: 'accept', generation: 1, kind: 'accept', claim_id: 'agreement', fee_id: null })
  assert.deepEqual(projected.records[1].segments, [held, disposed].map(({ gross4, coverage4, loss4, recovery4, ...physical }) => physical))
  assert.deepEqual(projected.records[1].totals, { sellable_quantity: '1', held_quantity: '2' })
  assert.deepEqual(projected.records[3], {})
  assert.deepEqual(JSON.parse(projected.details), projected.records[1])
  assert.deepEqual(JSON.parse(projected.old_value), { entity: 'stock_funding' })
  assert.deepEqual(JSON.parse(projected.new_value), projected.records[2])
  assert.deepEqual(projected.undo_payload.before, { shares: [{ segment_id: 'held' }, { segment_id: 'disposed' }] })
  assert.deepEqual(JSON.parse(projected.redo_payload).after, {})
  assert.deepEqual(JSON.parse(projected.request_json), { source_id: 'paid-source', kind: 'pending', targets: [{ segment_id: 'held' }, { segment_id: 'disposed' }] })
  assert.deepEqual(projected.changes, [{ field: 'remainingGross4', redacted: true }])
  assert.deepEqual(projected.records[4], ordinary)
  assert.equal(projected.note, cache.note)
  assert.equal(JSON.stringify(cache), original)
}
checkEconomicProjection(access)
for (const user of [viewer, actor({}, {}, ' AdMiN '), actor({ all: true }), actor({}, { all: true })]) {
  assert.equal(access.projectAcquisitionCosts(cache, user), cache)
}
assert.equal(access.canViewAcquisitionCosts(denied), false)
assert.equal(access.canEditAcquisitionCosts(denied), false)
assert.equal(access.canViewAcquisitionCosts(editor), false)
assert.equal(access.canEditAcquisitionCosts(editor), true)
const current = actor({}, { product_cost_view: true, product_cost_edit: true })
assert.equal(access.projectAcquisitionCosts(cache, current), cache)
current.permissions = JSON.stringify({ product_cost_view: false, product_cost_edit: false })
assert.notEqual(access.projectAcquisitionCosts(cache, current), cache)
for (const input of [funding, valuation, disposition, aliases, cache, { table_name: 'stock_valuation_agreements', targets_json: JSON.stringify(shares), amount4: 300000 }]) {
  assert.equal(access.hasAcquisitionCostInput(input, denied), true)
  assert.equal(access.hasAcquisitionCostInput(input, editor), false)
}
assert.equal(access.hasAcquisitionCostInput(ordinary, denied), false)
assert.equal(access.hasAcquisitionCostInput({ details: JSON.stringify(ordinary) }, denied), false)
const isolatedShares = { shares: [{ segment_id: 'held', amount4: 150000, amount_usd: 15 }] }
assert.deepEqual(access.projectAcquisitionCosts(isolatedShares, denied), { shares: [{ segment_id: 'held' }] })
assert.deepEqual(access.projectAcquisitionCosts({ entity: 'stock_valuation', fees: ordinary.fees, sales: [ordinary] }, denied), { entity: 'stock_valuation', fees: ordinary.fees, sales: [ordinary] })
const ap = { funding_version: 2, scope: 'disabled_funding_projection', invoices: [{ id: 1, supplier_id: 7,
  total_amount_usd: 100, amount_paid_usd: 80, outstanding_balance_usd: 20, current_debt4: 200000, current_paid4: 800000,
  accepted_credit4: 300000, refund_asset4: 100000, source_ids: ['paid-source'] }], native_sources: [], debt4: 200000, refund_asset4: 100000 }
assert.deepEqual(access.projectAcquisitionCosts(ap, denied), { funding_version: 2, scope: 'disabled_funding_projection',
  invoices: [{ id: 1, supplier_id: 7, source_ids: ['paid-source'] }], native_sources: [] })
assert.equal(access.hasAcquisitionCostInput(ap, denied), true)
const dispositionSummary = { purchase_quantity: '4', free_quantity: '0', purchase_gross4: 1000000, sellable_quantity: '1',
  held_quantity: '2', physical_quantity: '3', sellable_gross4: 250000, held_gross4: 500000, held_net4: 350000,
  accepted_credit4: 300000, debt4: 0, recognized_loss4: 250000, extra_cash_fee4: 17000 }
assert.deepEqual(access.projectAcquisitionCosts(dispositionSummary, denied), { purchase_quantity: '4', free_quantity: '0',
  sellable_quantity: '1', held_quantity: '2', physical_quantity: '3' })
for (const envelope of [funding, valuation, disposition, dispositionSummary, ap]) {
  assert.equal(access.projectAcquisitionCosts(envelope, viewer), envelope)
  assert.equal(access.hasAcquisitionCostInput(envelope, denied), true)
}
assert.deepEqual(access.projectAcquisitionCosts({ entity: 'stock_valuation', changes: [{ field: 'amount4', before: 150000, after: 300000 }] }, denied),
  { entity: 'stock_valuation', changes: [{ field: 'amount4', redacted: true }] })
assert.equal(access.hasAcquisitionCostInput({ entity: 'stock_valuation', changes: [{ field: 'amount4', after: 300000 }] }, denied), true)
assert.deepEqual(access.projectAcquisitionCosts({ oldValue: JSON.stringify(aliases), receiptJson: JSON.stringify(valuation) }, denied),
  { oldValue: '{}', receiptJson: JSON.stringify(access.projectAcquisitionCosts(valuation, denied)) })
const broken = { details: '{broken', old_value: '7', new_value: 'x'.repeat(2000001) }
assert.deepEqual(access.projectAcquisitionCosts(broken, denied), { details: null, old_value: null, new_value: null })
let deep = { gross4: 1000000 }; for (let i = 0; i < 34; i++) deep = { nested: deep }
assert.equal(JSON.stringify(access.projectAcquisitionCosts({ details: JSON.stringify(deep) }, denied)).includes('1000000'), false)
assert.equal(access.hasAcquisitionCostInput(deep, denied), true)
for (const [name, transform] of [
  ['serialized bypass', source => source.replaceAll("typeof child === 'string' && isSerializedCostEnvelope(key)", 'false')],
  ['nested bypass', source => source.replace("result[key] = project(child, depth + 1, supplier || key === 'periodSupplierReturns', childLifecycle)", 'result[key] = child')],
  ['integer4 alias omission', source => source.replace('ECONOMIC_COST_FIELDS.has(normalized)', 'false')],
  ['camel alias normalization omission', source => source.replace("return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()", 'return key.toLowerCase()')],
]) {
  assert.throws(() => checkEconomicProjection(loadAccess(transform)), assert.AssertionError, name)
}
async function main() {
  let user = viewer
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user', user); return next() })
  app.use('*', access.acquisitionCostResponses)
  app.get('/api/system/audit-logs', c => c.json(cache, 201, { 'X-fixture': 'economic-cache' }))
  let response = await app.request('/api/system/audit-logs')
  assert.deepEqual(await response.json(), cache)
  user = current
  response = await app.request('/api/system/audit-logs')
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('X-fixture'), 'economic-cache')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(await response.json(), access.projectAcquisitionCosts(cache, denied))
  assert.equal(JSON.stringify(cache), original)
  console.log('PASS stock economic privacy: real current permissions, integer4 aliases, direct/serialized audits, edit denial, ordinary revenue/fees, immutable caches, fail-closed bounds, middleware and 4 wrong controls')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
