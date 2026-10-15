const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// Cost-unknown slice S2: stock value, product COGS and the integrity check.
//
// Owner, 14 Oct 2026: "if cost is 0$ then it is 0 for loss. if it is none, it
// should also be unknown. flag it." A recorded $0 is a real $0; a NULL cost is
// UNKNOWN: left out of the dollar figure, counted beside it, never priced from
// the catalog, another lot or a later price. (The loss side lives in
// test-removal-losses-pure.cjs; this file covers the other three S2 readers.)
//
//  1. STOCK VALUE (familyStockStats.ts, the Dashboard / Inventory / Branches
//     tile): products {cost NULL, qty 5}, {cost 0, qty 5}, {cost 2, qty 5}
//     value to $10 with exactly ONE unknown product / 5 unknown units. The old
//     COALESCE(cost,0) reported the same $10 with no way to tell the NULL from
//     the free one; a NULLIF(cost,0) implementation reports TWO unknowns, so the
//     count is the discriminator on both sides.
//  2. PER-PRODUCT COGS (productSalesLedger.ts): a NULL sale line is counted in
//     cogs_unknown_lines and a recorded $0 line is not; the known COGS is the
//     sum of the known lines only.
//  3. BRANCH STOCK LIST (routes/branches.ts GET /:id/stock): the positive-stock
//     value prices a product from purchase_price_usd (a DEFAULT-0 mirror, so a
//     0 there defers to the catalog cost) and counts the products it cannot.
//  4. INTEGRITY (dataIntegrity.ts): the cost check only REPORTS. A $0 snapshot
//     stays $0 and a NULL one stays NULL after a repair run; the old repair wrote
//     today's catalog cost over both.
//
// Run (from cloudflare/): node scripts/test-cost-unknown-s2-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

function load(rel, overrides = {}) {
  const filename = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name.startsWith('.')) throw new Error(`${rel}: unexpected dependency ${name}`)
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

function loadWithProxyFallback(relativePath, exactStubs = {}) {
  const filePath = path.join(SRC, relativePath)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const fallback = new Proxy({}, { get: (_t, property) => property === 'default' ? {} : () => undefined })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(exactStubs, request)) return exactStubs[request]
    if (request.startsWith('.')) return fallback
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

function adapter(d1) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get: async (params) => statement.get(params || {}) ?? null,
        all: async (params) => statement.all(params || {}),
        run: async (params) => statement.run(params || {}),
      }
    },
    batch: (statements) => d1.batch(statements),
  }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log('PASS', name) }

const LOW = { enabled: true, mode: 'product', threshold: 10 }

async function main() {
  // -------------------------------------------------------------------------
  // 1. Stock value: known cost only, with the unknowns counted.
  // -------------------------------------------------------------------------
  const migrations = loadAll()
  await check('stock value: {NULL,5} {0,5} {2,5} -> $10 with exactly one unknown product (5 units)', async () => {
    const d1 = openDb(migrations)
    const insert = d1.prepare(`INSERT INTO products (id, name, stock_quantity, cost_price_usd, cost_price_khr, is_active, is_group)
      VALUES (@id, @name, @qty, @usd, @khr, @active, 0)`)
    seedStockFixture(d1.db, () => insert.run({ id: 1, name: 'Unknown cost', qty: 5, usd: null, khr: null, active: 1 }))
    seedStockFixture(d1.db, () => insert.run({ id: 2, name: 'Free goods', qty: 5, usd: 0, khr: 0, active: 1 }))
    seedStockFixture(d1.db, () => insert.run({ id: 3, name: 'Costed', qty: 5, usd: 2, khr: 8000, active: 1 }))
    seedStockFixture(d1.db, () => insert.run({ id: 4, name: 'Unknown but empty shelf', qty: 0, usd: null, khr: null, active: 1 }))
    assert.throws(() => d1.db.exec('UPDATE products SET stock_quantity=stock_quantity+1'), /stock_transaction_required/)
    const cdb = adapter(d1)
    const pagination = load('lib/familyPagination.ts', { './db': { getDb: () => cdb } })
    const lowStock = load('lib/lowStockSettings.ts', { './db': { getDb: () => cdb } })
    const stats = load('lib/familyStockStats.ts', { './familyPagination': pagination, './lowStockSettings': lowStock, './productStockGuard': loadProductStockGuard() })
    const options = { db: cdb, lowStock: LOW, joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: 'COALESCE(p.stock_quantity, 0)' }

    const one = await stats.getFamilyStockStats(options)
    assert.equal(one.stock_value_usd, 10, 'only the $2 x 5 product is valued; $0 adds nothing; NULL is not priced')
    assert.equal(one.stock_value_khr, 40000)
    assert.equal(one.stock_value_unknown_products, 1, 'exactly the NULL product: not the free one (a NULLIF(cost,0) build says 2), not the empty shelf')
    assert.equal(one.stock_value_unknown_quantity, 5)
    assert.equal(one.stock_quantity, 15, 'the quantity figure is unchanged')

    const overview = await stats.getFamilyStockOverview({ db: cdb, lowStock: LOW, previewSize: 5 })
    assert.deepEqual(
      { v: overview.stats.stock_value_usd, p: overview.stats.stock_value_unknown_products, q: overview.stats.stock_value_unknown_quantity },
      { v: 10, p: 1, q: 5 }, 'the Dashboard one-pass overview agrees with the stats helper',
    )
    const branchScoped = await stats.getFamilyStockStats({
      ...options,
      joinSql: 'JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId',
      params: { branchId: 1 },
      qtyExpr: 'COALESCE(bs.quantity, 0)',
    })
    assert.equal(branchScoped.stock_value_unknown_products, 0, 'a branch-scoped call counts the branch quantity: no rows join, nothing unknown')

    // Discriminators: re-derive the OLD and a NULLIF reading from the same rows.
    const rows = d1.prepare('SELECT stock_quantity AS q, cost_price_usd AS c FROM products WHERE is_active = 1 AND stock_quantity > 0').all()
    const nullif = rows.filter((r) => !r.c).length
    const coalesce0 = rows.reduce((sum, r) => sum + r.q * (r.c ?? 0), 0)
    assert.equal(nullif, 2, 'a NULLIF(cost,0) implementation would report 2 unknown products')
    assert.equal(coalesce0, 10, 'the old COALESCE(cost,0) implementation reports $10 too -- and no unknown count at all')
    assert.equal(Object.hasOwn(one, 'stock_value_unknown_products'), true)
  })

  await check('stock value: every product unknown -> $0 known and every product counted (never a clean $0)', async () => {
    const d1 = openDb(migrations)
    const insert = d1.prepare(`INSERT INTO products (id, name, stock_quantity, cost_price_usd, cost_price_khr, is_active, is_group) VALUES (@id, @name, @qty, NULL, NULL, 1, 0)`)
    seedStockFixture(d1.db, () => insert.run({ id: 1, name: 'A', qty: 2 })); seedStockFixture(d1.db, () => insert.run({ id: 2, name: 'B', qty: 3 }))
    const cdb = adapter(d1)
    const stats = load('lib/familyStockStats.ts', {
      './familyPagination': load('lib/familyPagination.ts', { './db': { getDb: () => cdb } }),
      './lowStockSettings': load('lib/lowStockSettings.ts', { './db': { getDb: () => cdb } }),
      './productStockGuard': loadProductStockGuard(),
    })
    const out = await stats.getFamilyStockStats({ db: cdb, lowStock: LOW, joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: 'COALESCE(p.stock_quantity, 0)' })
    assert.equal(out.stock_value_usd, 0)
    assert.equal(out.stock_value_unknown_products, 2)
    assert.equal(out.stock_value_unknown_quantity, 5)
  })

  function loadProductStockGuard() {
    return load('lib/productStockGuard.ts')
  }

  // -------------------------------------------------------------------------
  // 2. Per-product COGS: the unknown lines are counted, not silently skipped.
  // -------------------------------------------------------------------------
  await check('product COGS: a NULL sale line is counted in cogs_unknown_lines; a recorded $0 line is not', async () => {
    const businessDateWindow = loadWithProxyFallback('lib/businessDateWindow.ts')
    const salesAnalytics = loadWithProxyFallback('lib/salesAnalytics.ts', { './removalLosses': loadWithProxyFallback('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow })
    const ledger = loadWithProxyFallback('lib/productSalesLedger.ts', { './salesAnalytics': salesAnalytics })
    const d1 = openDb([])
    d1.exec(`
      CREATE TABLE sales (id INTEGER PRIMARY KEY, branch_id INTEGER, sale_status TEXT, created_at TEXT,
        subtotal_usd REAL, subtotal_khr REAL, discount_usd REAL, discount_khr REAL,
        membership_discount_usd REAL, membership_discount_khr REAL);
      CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, branch_id INTEGER,
        quantity REAL, total_usd REAL, total_khr REAL, cost_price_usd REAL, cost_price_khr REAL);
      CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, branch_id INTEGER, status TEXT, return_scope TEXT, created_at TEXT);
      CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER, branch_id INTEGER,
        quantity REAL, total_usd REAL, total_khr REAL, cost_price_usd REAL, cost_price_khr REAL, return_to_stock INTEGER, stock_action TEXT);
      -- product 1: one NULL line and one $3 line on separate sales; product 2: a recorded $0 line; product 3: all NULL.
      INSERT INTO sales VALUES (1,1,'completed','2026-09-05 03:00:00',10,40000,0,0,0,0),(2,1,'completed','2026-09-05 03:00:00',10,40000,0,0,0,0),
                               (3,1,'completed','2026-09-05 03:00:00',10,40000,0,0,0,0),(4,1,'completed','2026-09-05 03:00:00',10,40000,0,0,0,0);
      INSERT INTO sale_items VALUES (1,1,1,1,2,10,40000,NULL,NULL),(2,2,1,1,2,10,40000,3,12000),(3,3,2,1,2,10,40000,0,0),(4,4,3,1,2,10,40000,NULL,NULL);
    `)
    for (const branchScoped of [false, true]) {
      const sql = ledger.buildProductSalesLedgerSql({ branchScoped })
      const rows = d1.prepare(sql).all(branchScoped ? { branchId: 1 } : {})
      const at = (id) => rows.find((r) => Number(r.product_id) === id)
      const label = branchScoped ? 'branch-scoped' : 'unscoped'
      assert.equal(Number(at(1).cogs_unknown_lines), 1, `${label}: one NULL line counted`)
      assert.equal(Number(at(1).cogs_usd), 6, `${label}: COGS is the known line only, 2 x $3`)
      assert.equal(Number(at(2).cogs_unknown_lines), 0, `${label}: a recorded $0 line is known, not counted`)
      assert.equal(Number(at(2).cogs_usd), 0, `${label}: and its COGS is a real $0`)
      assert.equal(Number(at(3).cogs_unknown_lines), 1, `${label}: an all-unknown product counts its line`)
      assert.equal(at(3).cogs_usd, null, `${label}: and has no COGS figure at all`)
      assert.equal(Number(at(1).gross_cogs_usd), 6)
    }
  })

  // -------------------------------------------------------------------------
  // 3. Branch stock list: the positive-stock value and its unknown count.
  // -------------------------------------------------------------------------
  await check('branch stock list: purchase price 0 defers to the catalog cost; NULL cost is counted, never $0', async () => {
    const source = read('routes/branches.ts')
    const unitCost = source.match(/const positiveUnitCostSql = '([^']+)'/)
    assert.ok(unitCost, 'the unit-cost expression is one named constant')
    const queryAt = source.indexOf('AS positive_value_usd')
    assert.ok(queryAt > 0)
    const query = source.slice(source.lastIndexOf('db.prepare(`', queryAt), source.indexOf('`).get(summaryWhere.params)', queryAt))
    assert.doesNotMatch(query, /NULLIF/i, 'no NULLIF(purchase_price_usd,0) tier')
    assert.doesNotMatch(query, /,\s*0\)\s*\*/, 'no ", 0" fallback on the cost')
    assert.match(query, /positive_stock_value_unknown_products/)
    assert.equal(query.split('${positiveUnitCostSql}').length - 1, 3, 'one expression drives the value and the count')
    assert.match(source, /total_value_usd: familyStats\.stock_value_usd,\s*stock_value_unknown_products: familyStats\.stock_value_unknown_products,\s*stock_value_unknown_quantity: familyStats\.stock_value_unknown_quantity/)
    assert.match(source, /stock_value_usd: familyStats\.stock_value_usd,\s*stock_value_unknown_products: familyStats\.stock_value_unknown_products,\s*stock_value_unknown_quantity: familyStats\.stock_value_unknown_quantity,\s*branch_count/)

    const d1 = openDb([])
    d1.exec(`CREATE TABLE p (id INTEGER PRIMARY KEY, purchase_price_usd REAL DEFAULT 0, cost_price_usd REAL, q REAL);
      INSERT INTO p VALUES (1,0,2,5),(2,0,NULL,5),(3,0,0,5),(4,3,NULL,5),(5,4,2,5),(6,0,NULL,0);`)
    const rows = d1.prepare(`SELECT id, ${unitCost[1]} AS unit FROM p ORDER BY id`).all()
    const by = Object.fromEntries(rows.map((r) => [r.id, r.unit]))
    assert.equal(by[1], 2, 'purchase 0 is the unfilled mirror: the catalog cost $2 prices it (a COALESCE(purchase,cost) build says $0)')
    assert.equal(by[2], null, 'purchase 0 + NULL cost stays UNKNOWN (a COALESCE(purchase,cost) build says a clean $0)')
    assert.equal(by[3], 0, 'a recorded $0 catalog cost is a real $0')
    assert.equal(by[4], 3)
    assert.equal(by[5], 4, 'a positive purchase price still wins')
  })

  // -------------------------------------------------------------------------
  // 4. Integrity: the cost check reports and never repairs.
  // -------------------------------------------------------------------------
  await check('integrity: repair leaves a $0 snapshot at 0 and a NULL one NULL; the unknowns are counted', async () => {
    const d1 = openDb([])
    d1.exec(`
      CREATE TABLE products (id INTEGER PRIMARY KEY, stock_quantity REAL, cost_price_usd REAL, cost_price_khr REAL);
      CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL);
      CREATE TABLE sales (id INTEGER PRIMARY KEY, sale_status TEXT);
      CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, quantity REAL, cost_price_usd REAL, cost_price_khr REAL);
      CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, status TEXT);
      CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER, quantity REAL);
      CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, product_id INTEGER, movement_type TEXT, unit_cost_usd REAL, unit_cost_khr REAL);
      INSERT INTO products VALUES (1,0,9,36000);
      INSERT INTO sales VALUES (1,'completed');
      INSERT INTO sale_items VALUES (1,1,1,1,0,0),(2,1,1,1,NULL,NULL),(3,1,1,1,4,16000);
      INSERT INTO inventory_movements VALUES (1,1,'sale',0,0),(2,1,'sale',NULL,NULL),(3,1,'return',NULL,NULL),(4,1,'sale',4,16000),(5,1,'add',NULL,NULL);
    `)
    const cdb = adapter(d1)
    const integrity = load('lib/dataIntegrity.ts', {
      './stockTransaction': load('lib/stockTransaction.ts'),
      './db': { getDb: () => cdb },
      './productStockGuard': { assertProductsActive: async () => {}, productStockGuardError: () => null, productStockGuardStatement: () => ({ sql: 'SELECT 1' }) },
    })
    for (const repair of [false, true]) {
      const result = await integrity.runDataIntegrityCheck({}, repair)
      assert.equal(result.sale_items_unknown_cost, 1, `repair=${repair}: one NULL sale line is flagged, the recorded $0 is not`)
      assert.equal(result.movements_unknown_cost, 2, `repair=${repair}: the NULL sale and return movements are flagged; an add is not a sale cost`)
      assert.equal(result.details.costPrices.repairs, 0, `repair=${repair}: the cost check never repairs`)
      assert.equal(result.repairs, 0)
      assert.deepEqual(d1.prepare('SELECT id, cost_price_usd AS usd, cost_price_khr AS khr FROM sale_items ORDER BY id').all().map((r) => [r.id, r.usd, r.khr]),
        [[1, 0, 0], [2, null, null], [3, 4, 16000]], `repair=${repair}: sale snapshots are exactly as recorded (the old repair wrote the catalog's $9 over the 0 and the NULL)`)
      assert.deepEqual(d1.prepare('SELECT id, unit_cost_usd AS usd FROM inventory_movements ORDER BY id').all().map((r) => [r.id, r.usd]),
        [[1, 0], [2, null], [3, null], [4, 4], [5, null]], `repair=${repair}: movement snapshots are untouched`)
    }
    assert.match(read('lib/dataIntegrity.ts'), /unknown cost/i)
    assert.doesNotMatch(read('lib/dataIntegrity.ts'), /UPDATE sale_items|UPDATE inventory_movements/, 'no statement in the integrity check writes a cost')
  })

  console.log(`\nOK - ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
