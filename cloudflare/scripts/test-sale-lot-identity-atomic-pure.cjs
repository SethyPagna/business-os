// Drives POST /api/sales against the real route and fully migrated SQLite.
// It proves two checkout invariants that a planner-only test cannot:
//   1. an explicit batch belongs to the line's product + Shop branch, and
//      only authoritative lot metadata reaches sale_items;
//   2. allocation lineage commits in the same D1 batch as the line, stock,
//      product rollup, and movement. A forced allocation failure leaves none.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
const USER = {
  id: 51,
  username: 'lot_cashier',
  name: 'Lot Cashier',
  permissions: JSON.stringify({ pos: true }),
}

const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': {
    requireAuth: async (c, next) => {
      c.set('user', USER)
      return next()
    },
  },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
  },
  '../lib/paymentMethodRegistry': {
    saleMethodsUsed: () => [],
    parseConfiguredMethods: () => [],
    mergePaymentMethods: (methods) => ({ methods, added: [], changed: false }),
  },
  '../lib/telegram': {
    formatSaleTelegramLines: () => [],
    sendTelegramEvent: async () => {},
    telegramMoney: (value) => String(value ?? ''),
  },
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/sales.ts').default
const executionCtx = {
  waitUntil(promise) { promise?.catch?.(() => {}) },
  passThroughOnException() {},
}

function run(db, sql, params = {}) { return db.prepare(sql).run(params) }
function get(db, sql, params = {}) { return db.prepare(sql).get(params) }
function all(db, sql, params = {}) { return db.prepare(sql).all(params) }

// The shared node:sqlite shim exposes D1's raw meta shape. Production's
// getDb wrapper promotes changes/last_row_id to the D1Compat result fields
// routes consume, so mirror that thin boundary here while keeping the real
// SQL engine and transactional batch underneath.
function routeDb(db) {
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => statement.get(params),
        run: async (params) => {
          const result = statement.run(params)
          return {
            ...result,
            changes: Number(result.meta?.changes || 0),
            lastInsertRowid: Number(result.meta?.last_row_id || 0),
          }
        },
      }
    },
    batch: (statements) => db.batch(statements),
    exec: (sql) => db.exec(sql),
  }
  api.staging = api
  return api
}

async function postSale(db, items, suffix, overrides = {}) {
  const body = {
    branch_id: 1,
    items,
    exchange_rate: 4000,
    payment_method: 'Cash',
    payment_currency: 'USD',
    amount_paid_usd: 100,
    client_request_id: `lot-atomic-${suffix}`,
    ...overrides,
  }
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: routeDb(db) }, executionCtx)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function fixture() {
  const db = openDb(loadAll())
  run(db, `INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)`)
  run(db, `INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
           VALUES(10,'Serum','SERUM',10,5,20000,2,8000,1)`)
  run(db, `INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
           VALUES(11,'Cream','CREAM',10,6,24000,3,12000,1)`)
  run(db, `INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)`)
  run(db, `INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,1,10)`)
  run(db, `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
           VALUES(500,10,'serum-old','SERUM-OLD','2027-01-01','2026-08-01',1,1)`)
  run(db, `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
           VALUES(502,10,'serum-new','SERUM-NEW','2027-06-01','2026-08-15',1,2)`)
  run(db, `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
           VALUES(501,11,'cream-only','CREAM-LOT','2028-01-01','2026-08-01',1,1)`)
  run(db, `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,2)`)
  run(db, `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(502,1,5)`)
  run(db, `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,10)`)
  return db
}

function counts(db) {
  return {
    sales: get(db, 'SELECT COUNT(*) AS n FROM sales').n,
    items: get(db, 'SELECT COUNT(*) AS n FROM sale_items').n,
    allocations: get(db, 'SELECT COUNT(*) AS n FROM sale_item_batch_allocations').n,
    movements: get(db, 'SELECT COUNT(*) AS n FROM inventory_movements').n,
    product: get(db, 'SELECT stock_quantity AS n FROM products WHERE id=10').n,
    branch: get(db, 'SELECT quantity AS n FROM branch_stock WHERE product_id=10 AND branch_id=1').n,
    oldLot: get(db, 'SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').n,
    newLot: get(db, 'SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=502 AND branch_id=1').n,
  }
}

;(async () => {
  // Another product's live batch at the same branch is not this line's lot.
  // The refusal occurs before the sale header, items, or stock can be written.
  {
    const db = fixture()
    const before = counts(db)
    const result = await postSale(db, [{
      product_id: 10,
      quantity: 1,
      branch_id: 1,
      batch_id: 501,
      batch_label: 'forged serum label',
      batch_expiry_date: '2099-01-01',
    }], 'wrong-product')
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.match(result.body.error, /not an active, available lot/i)
    assert.deepEqual(counts(db), before)
  }
  console.log('PASS 1 -- explicit batches are product + Shop branch identities')

  // A valid explicit pick persists the database's own label and expiry, not
  // the caller's text, and records allocation before checkout succeeds.
  {
    const db = fixture()
    const result = await postSale(db, [{
      product_id: 10,
      quantity: 1,
      branch_id: 1,
      batch_id: 500,
      batch_label: 'forged label',
      batch_expiry_date: '2099-01-01',
    }], 'authoritative')
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual({ ...get(db, `SELECT product_id,batch_id,batch_label,batch_expiry_date FROM sale_items`) }, {
      product_id: 10,
      batch_id: 500,
      batch_label: 'SERUM-OLD',
      batch_expiry_date: '2027-01-01',
    })
    assert.deepEqual({ ...get(db, `SELECT batch_id,branch_id,quantity,lot_code,expiry_date,released_quantity,released_at
                                  FROM sale_item_batch_allocations`) }, {
      batch_id: 500,
      branch_id: 1,
      quantity: 1,
      lot_code: 'SERUM-OLD',
      expiry_date: '2027-01-01',
      released_quantity: 0,
      released_at: null,
    })
    assert.equal(get(db, `SELECT quantity FROM branch_batch_stock WHERE batch_id=500`).quantity, 1)
  }
  console.log('PASS 2 -- server-owned lot metadata and allocation are stored')

  // FIFO spanning two lots stays attributable through two allocation rows;
  // neither the line nor its movement falsely claims one batch.
  {
    const db = fixture()
    const result = await postSale(db, [{
      product_id: 10,
      quantity: 4,
      branch_id: 1,
      // Metadata without an id is not identity and must not survive.
      batch_label: 'forged unowned label',
      batch_expiry_date: '2099-01-01',
    }], 'multi-lot')
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual({ ...get(db, 'SELECT batch_id,batch_label,batch_expiry_date FROM sale_items') }, {
      batch_id: null,
      batch_label: null,
      batch_expiry_date: null,
    })
    assert.equal(get(db, "SELECT batch_id FROM inventory_movements WHERE movement_type='sale'").batch_id, null)
    assert.deepEqual(all(db, `SELECT batch_id,quantity,lot_code FROM sale_item_batch_allocations ORDER BY id`).map((row) => ({ ...row })), [
      { batch_id: 500, quantity: 2, lot_code: 'SERUM-OLD' },
      { batch_id: 502, quantity: 2, lot_code: 'SERUM-NEW' },
    ])
    assert.deepEqual({ oldLot: counts(db).oldLot, newLot: counts(db).newLot }, { oldLot: 0, newLot: 3 })
  }
  console.log('PASS 3 -- multi-lot FIFO keeps exact per-lot lineage')

  // This trigger simulates any allocation-table failure. Because allocation
  // is in the existing item/stock/movement batch, every sibling write rolls
  // back and the route's established compensation removes the header.
  {
    const db = fixture()
    run(db, `CREATE TRIGGER force_allocation_failure BEFORE INSERT ON sale_item_batch_allocations
             BEGIN SELECT RAISE(ABORT, 'forced allocation failure'); END`)
    const before = counts(db)
    const result = await postSale(db, [{ product_id: 10, quantity: 1, branch_id: 1, batch_id: 500 }], 'forced-failure')
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.match(result.body.error, /forced allocation failure/i)
    assert.deepEqual(counts(db), before)
  }
  console.log('PASS 4 -- allocation failure rolls back item, stock, movement, and header')

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  assert.ok(source.includes('resolveExplicitSaleLineBatches'), 'the shared authoritative resolver is wired')
  assert.ok(!source.includes('failed to record sale_item_batch_allocations (stock already deducted correctly)'), 'the lineage failure is no longer swallowed')
  assert.ok(!source.includes('saleItemStatementIndexByItemIndex'), 'no post-commit last_row_id pass remains')
  console.log('PASS 5 -- source lock excludes the old best-effort lineage pass')

  console.log('\nAll sale lot identity/atomicity tests passed')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
