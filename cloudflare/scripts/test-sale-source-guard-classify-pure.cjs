const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// A sale write opens with pricingSourceGuard: a SELECT that aborts the batch when the product rows (and the active
// promotion rules) it read before the write are no longer exactly what is stored. It compares EVERY column of the product
// rows, so a stock movement that lands in the write window (a Remove, another till's sale: stock_quantity, updated_at)
// trips it as surely as a price change does -- and the routes then answered "Pricing changed ... Review the current
// quote." for both, which sent the cashier to re-check a quote that was fine.
//
// classifyPricingSourceConflict (lib/saleItemPricing.ts) is what the catch now calls: ONE read-only statement that makes the
// same comparison but answers instead of raising -- 'pricing' when a column that prices a line (the subset
// capturePricingProduct hands the evaluator) or the active rules differ, 'stock' when only the other columns differ, null when
// nothing differs any more. One statement keeps a refused sale at the D1 budget it always had. Run against the REAL migration
// schema and the REAL bundled source.
const path = require('path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { buildSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')

async function main() {
  const built = buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'lib', 'saleItemPricing.ts')], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require)
  const { classifyPricingSourceConflict } = mod.exports
  assert.equal(typeof classifyPricingSourceConflict, 'function', 'lib/saleItemPricing.ts exports classifyPricingSourceConflict')

  const sqlite = new Database(':memory:')
  for (const migration of loadAll()) sqlite.exec(migration)
assert.throws(() => sqlite.prepare("INSERT INTO products(name) VALUES('unadmitted guard control')").run(), /stock_transaction_required/)
  // The slice of D1Compat the classifier uses: prepare(sql).get(params), rejecting with SQLite's own error text.
  let prepared = 0
  const db = { prepare: (sql) => { prepared += 1; return { get: async (params) => sqlite.prepare(sql).get(params || {}) } } }
  const seedProduct = (id, name, sku, stock, price, khr, cost) => seedStockFixture(sqlite, () => sqlite.prepare(`INSERT INTO products (id, name, sku, stock_quantity, selling_price_usd, selling_price_khr, cost_price_usd, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(id, name, sku, stock, price, khr, cost))
  seedProduct(1, 'Powder', 'P-1', 10, 9.5, 38000, 4)
  seedProduct(2, 'Toner', 'P-2', 5, 5, 20000, 2)
  const readProducts = () => sqlite.prepare('SELECT * FROM products WHERE id IN (1,2) ORDER BY id').all()
  const readRules = () => sqlite.prepare('SELECT * FROM promotion_rules WHERE is_active=1 ORDER BY id LIMIT 101').all()
  // Read what the route reads, apply the concurrent write, then ask the classifier what the catch asks.
  const classify = async (mutate, undo) => {
    const products = readProducts(), rules = readRules()
    mutate()
    prepared = 0
    try { return await classifyPricingSourceConflict(db, products, rules) } finally { assert.equal(prepared, 1, 'the classifier is one D1 statement'); if (undo) undo() }
  }
  const run = (sql) => () => sqlite.prepare(sql).run()

  assert.equal(await classify(() => {}), null, 'no change: the failure came from some other guard, so null')
  // The reason this exists: a stock Remove / another till's sale moves only stock_quantity and updated_at.
  assert.equal(await classify(() => seedStockFixture(sqlite, () => run("UPDATE products SET stock_quantity=stock_quantity-3, updated_at='2026-10-13 10:00:00' WHERE id=1")()), () => seedStockFixture(sqlite, () => run('UPDATE products SET stock_quantity=10 WHERE id=1')())), 'stock', 'a stock movement alone: stock')
  assert.equal(await classify(() => seedStockFixture(sqlite, () => run("UPDATE products SET updated_at='2026-10-13 11:00:00' WHERE id=2")())), 'stock', 'a bare updated_at touch: stock')
  assert.equal(await classify(() => seedStockFixture(sqlite, () => run("UPDATE products SET name='Powder 2' WHERE id=1")()), () => seedStockFixture(sqlite, () => run("UPDATE products SET name='Powder' WHERE id=1")())), 'stock', 'a non-pricing column (name): not a pricing change')
  // Pricing changes stay pricing, alone or together with a stock movement.
  assert.equal(await classify(() => seedStockFixture(sqlite, () => run('UPDATE products SET selling_price_usd=10 WHERE id=1')()), () => seedStockFixture(sqlite, () => run('UPDATE products SET selling_price_usd=9.5 WHERE id=1')())), 'pricing', 'a selling price change: pricing')
  assert.equal(await classify(() => seedStockFixture(sqlite, () => run("UPDATE products SET discount_enabled=1, discount_type='percent', discount_percent=10 WHERE id=2")()),
    () => seedStockFixture(sqlite, () => run('UPDATE products SET discount_enabled=0, discount_type=NULL, discount_percent=NULL WHERE id=2')())), 'pricing', 'a product discount switched on: pricing')
  assert.equal(await classify(() => seedStockFixture(sqlite, () => run('UPDATE products SET stock_quantity=1, selling_price_usd=11 WHERE id=1')()), () => seedStockFixture(sqlite, () => run('UPDATE products SET stock_quantity=10, selling_price_usd=9.5 WHERE id=1')())), 'pricing',
    'price AND stock moved: pricing wins (the cashier must re-review the quote)')
  assert.equal(await classify(() => seedStockFixture(sqlite, () => sqlite.exec('UPDATE products SET stock_quantity=0 WHERE id=2; DELETE FROM products WHERE id=2'))), 'pricing', 'a captured product that no longer exists: pricing (the line cannot be priced)')
  seedProduct(2, 'Toner', 'P-2', 5, 5, 20000, 2)
  // An active promotion rule switched off in the window changes what the line costs.
  sqlite.prepare("INSERT INTO promotion_rules (title, rule_type, percent_off, scope_type, product_ids, is_active) VALUES ('Weekend 10%', 'percent_off', 10, 'products', '[1]', 1)").run()
  assert.equal(await classify(run('UPDATE promotion_rules SET is_active=0'), run('UPDATE promotion_rules SET is_active=1')), 'pricing', 'a promotion rule switched off in the window: pricing')
  assert.equal(await classify(run("INSERT INTO promotion_rules (title, rule_type, percent_off, scope_type, product_ids, is_active) VALUES ('New', 'percent_off', 5, 'products', '[2]', 1)")), 'pricing', 'a new active rule in the window: pricing')

  console.log('PASS pricing-source conflict classification: a stock-only movement is "stock", any pricing change stays "pricing"')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
