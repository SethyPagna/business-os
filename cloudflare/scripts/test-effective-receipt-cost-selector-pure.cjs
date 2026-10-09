const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const base = '6d901946c5d0be17f5d545430db2411302a1bd49'
const src = path.resolve(__dirname, '../src')
function loadCost(source) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const text = file === 'lib/catalogCostRecompute.ts' ? source : fs.readFileSync(path.join(src, file), 'utf8')
    const mod = { exports: {} }
    cache.set(file, mod.exports)
    const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const req = id => id === './db' ? {} : id.startsWith('.') ? load(path.posix.join(path.posix.dirname(file), id + '.ts')) : require(id)
    new Function('module', 'exports', 'require', code)(mod, mod.exports, req)
    cache.set(file, mod.exports)
    return mod.exports
  }
  return load('lib/catalogCostRecompute.ts')
}
const source = fs.readFileSync(path.join(src, 'lib/catalogCostRecompute.ts'), 'utf8')
const costs = loadCost(source)
const parent = loadCost(execFileSync('git', ['show', base + ':cloudflare/src/lib/catalogCostRecompute.ts'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }))
const receipt = (id, cost, quantity = 1, active = 1, date = '2026-10-01') => ({ id, unit_cost_usd: cost, remaining_quantity: quantity, is_active: active, received_at: date, batch_number: id, lot_code: 'lot-' + id, branch_name: 'Shop' })
const manual = (id, cost, baseline) => ({ id, cost_usd: cost, cost_khr: 123.45, baseline_batch_id: baseline, created_at: '2026-10-01', user_name: 'Original actor', previous_cost_usd: 2 })
let unitCases = 0
for (const active of [1, 0, null, true, false]) for (const value of [null, 0, -2, 2, 1.0000000000000002, 0.30000000000000004, NaN, Infinity]) {
  for (const entry of [null, manual(9, 4, 10), manual(9, 0, 10), manual(9, null, 10), manual(9, -1, 10), manual(9, NaN, 10), manual(9, Infinity, 10), manual(9, 1.0000000000000002, 10)]) for (const id of [9, 10, 11]) {
    const lot = receipt(id, value, 0, active)
    const frozen = JSON.stringify([lot, entry])
    const selected = costs.selectEffectiveReceiptCost(lot, entry)
    const overridden = entry !== null && id <= 10
    const term = overridden ? entry.cost_usd : value
    const included = !!active && term !== null && Number.isFinite(term) && term > 0
    assert.deepEqual(selected, { effectiveUnitCostUsd: included ? term : null, source: included ? overridden ? 'manual' : 'receipt' : 'excluded', manualEntryId: included && overridden ? 9 : null })
    assert.equal(JSON.stringify([lot, entry]), frozen)
    unitCases++
  }
}
const worlds = []
for (const active of [1, 0]) for (const value of [null, 0, -1, 2, 1.0000000000000002]) for (const override of [null, 0, -1, 4]) for (const quantity of [0, 0.1, 1]) {
  const productId = 10000 + worlds.length
  const id = 100000 + worlds.length * 10
  const lots = [receipt(id, value, active ? quantity : 0, active, '2026-09-02'), receipt(id + 1, 6, quantity, 1, '2026-09-01'), receipt(id + 2, 3, quantity, 1, '2026-09-01')]
  const entries = override === null ? [] : [manual(id + 10, 99, id + 2), manual(id + 11, override, id + 1)]
  worlds.push({ productId, lots, entries, product: { cost_price_usd: 99, cost_price_khr: 123.45 } })
}
worlds.push({ productId: 11000, lots: [receipt(110000, 10.00005)], entries: [], product: { cost_price_usd: 99, cost_price_khr: 777 } })
worlds.push({ productId: 11001, lots: [], entries: [manual(110020, 4, 0)], product: { cost_price_usd: 99, cost_price_khr: 777 } })
worlds.push({ productId: 11002, lots: [receipt(110030, 2, 0.1), receipt(110031, 5, 0.2)], entries: [], product: { cost_price_usd: 99, cost_price_khr: 777 } })
const d1 = openDb(loadAll({ through: 242 }))
const raw = d1.db
raw.exec("INSERT INTO branches(id,name) VALUES(901,'Shop')")
for (const { productId, lots, entries, product } of worlds) {
  const sum = lots.reduce((sum, lot) => sum + lot.remaining_quantity, 0)
  raw.prepare('INSERT INTO products(id,name,is_active,cost_price_usd,cost_price_khr,purchase_price_usd,stock_quantity) VALUES(?,?,1,?,?,99,?)').run(productId, 'Cost ' + productId, product.cost_price_usd, product.cost_price_khr, sum)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,901,?)').run(productId, sum)
  for (const lot of lots) {
    raw.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,is_active,unit_cost_usd,received_at) VALUES(?,?,?,?,?,?,?,?)').run(lot.id, productId, 'key-' + lot.id, lot.batch_number, lot.lot_code, lot.is_active, lot.unit_cost_usd, lot.received_at)
    raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,901,?)').run(lot.id, lot.remaining_quantity)
  }
  for (const entry of entries) raw.prepare("INSERT INTO product_cost_entries(id,product_id,cost_usd,cost_khr,baseline_batch_id,source,user_name,created_at,previous_cost_usd) VALUES(?,?,?,?,?,'manual',?,?,?)").run(entry.id, productId, entry.cost_usd, entry.cost_khr, entry.baseline_batch_id, entry.user_name, entry.created_at, entry.previous_cost_usd)
}
const migrations = path.join(__dirname, '../migrations')
for (const file of fs.readdirSync(migrations).filter(file => file.endsWith('.sql') && Number(file.slice(0, 4)) > 242).sort()) {
  if (file.startsWith('0246_')) raw.exec(`BEGIN;
    INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1');
    INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"counted_conversion","token":"cost-selector-fixture"}');
    DELETE FROM system_flags WHERE key='stock_transaction_permit';`)
  raw.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
  if (file.startsWith('0246_')) raw.exec("DELETE FROM system_flags WHERE key='maintenance'; COMMIT;")
}
assert.equal(raw.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get().value, 'counted-tagged-subset-v1')
assert.throws(() => raw.prepare('UPDATE branch_batch_stock SET quantity=quantity+1 WHERE batch_id=?').run(worlds[0].lots[0].id), /stock_transaction_required/)
assert.equal(costs.CATALOG_COST_DERIVE_SQL, parent.CATALOG_COST_DERIVE_SQL)
for (const name of ['catalogCostOnHandTriggerSql', 'catalogCostRecomputeStatement', 'catalogCostRecomputeIfChangedStatement']) assert.deepEqual(costs[name](1), parent[name](1))
const financialBefore = raw.prepare('SELECT * FROM product_cost_entries ORDER BY id').all()
const receiptBefore = raw.prepare('SELECT * FROM product_batches ORDER BY id').all()
const stockBefore = raw.prepare('SELECT * FROM branch_batch_stock ORDER BY batch_id,branch_id').all()
for (const world of worlds) {
  const inputBefore = JSON.stringify(world)
  const current = costs.buildCatalogCostBreakdown(world.productId, world.product, world.lots, world.entries)
  assert.deepEqual(current, parent.buildCatalogCostBreakdown(world.productId, world.product, world.lots, world.entries), 'complete frozen-parent breakdown parity')
  assert.equal(JSON.stringify(world), inputBefore, 'input mutation parity')
  const derived = raw.prepare('SELECT ' + costs.CATALOG_COST_DERIVE_SQL + ' AS cost FROM products WHERE id=?').get(world.productId).cost
  assert.ok(Math.abs(current.result_usd - (derived ?? world.product.cost_price_usd)) < 0.0000001, 'SQL/UI cost parity')
  assert.equal(current.result_khr, world.product.cost_price_khr)
  const statement = costs.catalogCostRecomputeIfChangedStatement(world.productId)
  d1.prepare(statement.sql).run(statement.params)
  const stored = raw.prepare('SELECT cost_price_usd,purchase_price_usd,cost_price_khr FROM products WHERE id=?').get(world.productId)
  assert.equal(stored.cost_price_usd, derived ?? world.product.cost_price_usd)
  assert.equal(stored.purchase_price_usd, stored.cost_price_usd)
  assert.equal(stored.cost_price_khr, world.product.cost_price_khr)
  assert.equal(d1.prepare(statement.sql).run(statement.params).meta.changes, 0, 'same recompute no duplicate mutation')
}
assert.deepEqual(raw.prepare('SELECT * FROM product_cost_entries ORDER BY id').all(), financialBefore)
assert.deepEqual(raw.prepare('SELECT * FROM product_batches ORDER BY id').all(), receiptBefore)
assert.deepEqual(raw.prepare('SELECT * FROM branch_batch_stock ORDER BY batch_id,branch_id').all(), stockBefore)
assert.equal(costs.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [receipt(1, 10.00005)]).result_usd, 10.0001)
const sourceReceipt = receipt(10, 2)
const selected = costs.selectEffectiveReceiptCost(sourceReceipt, manual(12, 4, 10))
assert.deepEqual(selected, { effectiveUnitCostUsd: 4, source: 'manual', manualEntryId: 12 })
assert.equal(costs.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [receipt(1, 6), receipt(11, selected.effectiveUnitCostUsd)]).result_usd, 5)
assert.equal(costs.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [receipt(1, 6), receipt(11, sourceReceipt.unit_cost_usd)]).result_usd, 4, 'raw historical clone is discriminated')
const fallback = costs.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [receipt(3, 3, 0, 1, '2026-09-01'), receipt(1, 5, 0, 1, '2026-09-02'), receipt(2, 7, 0, 1, '2026-09-02')])
assert.equal(fallback.result_usd, 7, 'received date first, then ID tie')
assert.equal(costs.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [receipt(10, 2, 0)], [manual(12, 4, 10)]).result_usd, 99, 'manual unit term does not invent depleted fallback')
const mutant = loadCost(source.replace('latestManualEntry !== null && receipt.id <= (Number(latestManualEntry.baseline_batch_id) || 0)', 'false'))
assert.notDeepEqual(mutant.selectEffectiveReceiptCost(sourceReceipt, manual(12, 4, 10)), selected)
assert.notDeepEqual(mutant.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [sourceReceipt], [manual(12, 4, 10)]), costs.buildCatalogCostBreakdown(1, {cost_price_usd:99,cost_price_khr:777}, [sourceReceipt], [manual(12, 4, 10)]), 'real breakdown consumes shared selector')
raw.close()
console.log(JSON.stringify({status:'PASS',unitCases,fullSchemaSqlUiParentMutationWorlds:worlds.length,originalManual6and4Result:5,wrongRawCloneResult:4,fallbackAnd4dp:true,wrongSelectorDiscriminated:true,addedQueries:0}))
