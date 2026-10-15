const assert = require('node:assert/strict')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')

const compiled = buildSync({
  stdin: { contents: "export * from './productMergeCostPreview'; export { CATALOG_COST_DERIVE_SQL } from './catalogCostRecompute'", resolveDir: path.join(__dirname, '../src/lib'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text
const loaded = { exports: {} }
new Function('module', 'exports', 'require', compiled)(loaded, loaded.exports, require)
const { previewMergeCosts, projectMergeCostGraph, CATALOG_COST_DERIVE_SQL } = loaded.exports
const plans = [{ keepId: 1, steps: [{ mergeId: 2, stock: 'merge' }] }]

function graph(costs = [4, 6], quantities = [2, 3]) {
  return {
    products: [1, 2].map(id => ({ id, cost_price_usd: 9, cost_price_khr: null })),
    batches: costs.map((unit_cost_usd, index) => ({ id: index + 10, variant_product_id: index + 1, batch_key: String(index), is_active: 1, unit_cost_usd, received_at: `2026-09-0${index + 1}` })),
    batchStock: quantities.map((quantity, index) => ({ batch_id: index + 10, branch_id: 1, quantity })),
    currentCostEntries: [],
  }
}

async function check(name, input, expected, source = 'received_lot') {
  const sqlite = new DatabaseSync(':memory:')
  let previewSql
  const db = { prepare: sql => ({ all: params => { previewSql = sql; return sqlite.prepare(sql).all(params) } }) }
  try {
    const before = JSON.stringify(input)
    const [actual] = await previewMergeCosts(db, input, plans)
    const projected = projectMergeCostGraph(input, plans)
    const cte = previewSql.slice(0, previewSql.indexOf('\nSELECT products.id keeperId,'))
    const types = sqlite.prepare(cte + ' SELECT typeof(quantity) type FROM branch_batch_stock').all({ graph: JSON.stringify(projected) })
    console.log(name, JSON.stringify({ actual, quantityTypes: types.map(row => row.type) }))
    assert.equal(actual.cost_price_usd, expected)
    assert.equal(actual.source, source)
    assert.equal(actual.needsReview, source !== 'received_lot')
    assert.equal(JSON.stringify(input), before)
    assert.deepEqual(types.map(row => row.type), projected.batchStock.map(row => row.quantity === null ? 'null' : typeof row.quantity === 'number' ? 'real' : 'text'))
    sqlite.exec('CREATE TABLE products(id INTEGER, cost_price_usd REAL); CREATE TABLE product_batches(id INTEGER, variant_product_id INTEGER, is_active INTEGER, unit_cost_usd REAL, received_at TEXT); CREATE TABLE branch_batch_stock(batch_id INTEGER, quantity REAL); CREATE TABLE product_cost_entries(id INTEGER, product_id INTEGER, cost_usd REAL, baseline_batch_id INTEGER)')
    for (const row of projected.products) sqlite.prepare('INSERT INTO products VALUES(?,?)').run(row.id, row.cost_price_usd)
    for (const row of projected.batches) sqlite.prepare('INSERT INTO product_batches VALUES(?,?,?,?,?)').run(row.id, row.variant_product_id, row.is_active, row.unit_cost_usd, row.received_at)
    for (const row of projected.batchStock) sqlite.prepare('INSERT INTO branch_batch_stock VALUES(?,?)').run(row.batch_id, row.quantity)
    for (const row of projected.currentCostEntries) sqlite.prepare('INSERT INTO product_cost_entries VALUES(?,?,?,?)').run(row.id, row.product_id, row.cost_usd, row.baseline_batch_id)
    const derived = sqlite.prepare(`SELECT COALESCE(${CATALOG_COST_DERIVE_SQL},cost_price_usd) cost FROM products`).get().cost
    assert.equal(actual.cost_price_usd, derived, 'JSON projection must equal the real-affinity table formula')
  } finally { sqlite.close() }
}

async function main() {
  await check('integer weighted inputs', graph(), 5.2)
  const folded = graph(); folded.batches[1].batch_key = folded.batches[0].batch_key
  await check('same-key keeper cost', folded, 4)
  const manual = graph(); manual.currentCostEntries.push({ id: 1, product_id: 1, cost_usd: 7, baseline_batch_id: 10 })
  await check('manual baseline plus new lot', manual, 6.4)
  await check('zero cost excluded', graph([0, 6]), 6)
  await check('null cost excluded', graph([null, 6]), 6)
  await check('invalid text cost excluded', graph(['invalid', 6]), 6)
  await check('unknown lots preserve fallback', graph([null, 0]), 9, 'keeper_fallback')
  for (const fallback of [null, 0, 5.123456789012345]) {
    const input = graph([null, 0]); input.products[0].cost_price_usd = fallback
    await check('nullable raw fallback ' + fallback, input, fallback, 'keeper_fallback')
  }
  await check('four-place rounding', graph([1.0001, 1.0002]), 1.0002)
  await check('fractional quantities', graph([4, 6], [0.2, 0.3]), 5.2)
  await check('null quantity stays null', graph([4, 6], [null, 3]), 6)
  await check('invalid quantity stays text', graph([4, 6], ['invalid', 3]), 6)
  await check('sold out latest received cost', graph([4, 6], [0, 0]), 6)
  for (const invalid of [Infinity, -Infinity, NaN]) {
    await assert.rejects(() => previewMergeCosts({ prepare() { throw Error('invalid graph reached SQL') } }, graph([invalid, 6]), plans), /review limits/)
  }
  console.log('PASS 15 REAL-affinity projection controls and three nonfinite refusals')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
