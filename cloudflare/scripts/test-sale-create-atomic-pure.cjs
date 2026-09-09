// Regression coverage for sale creation against the real Hono route and the
// complete migrated SQLite schema. The wrapper deliberately reports the
// trigger-inclusive D1 changes count for INSERT sales: migration 0120's
// sale_revision_sales_insert trigger makes a successful production write 2.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
const USER = {
  id: 71,
  username: 'sale_cashier',
  name: 'Sale Cashier',
  permissions: JSON.stringify({ pos: true }),
}
let currentUser = USER

const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
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

function routeDb(db, hooks = {}) {
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => statement.get(params),
        run: async (params) => {
          const result = statement.run(params)
          const directChanges = Number(result.meta?.changes || 0)
          return {
            ...result,
            // Native D1 includes sale_revision_sales_insert's write in this
            // metadata. node:sqlite reports only the direct INSERT.
            changes: /INSERT\s+INTO\s+sales\s*\(/i.test(sql) && directChanges > 0
              ? directChanges + 1
              : directChanges,
            lastInsertRowid: Number(result.meta?.last_row_id || 0),
          }
        },
      }
    },
    batch: async (statements) => {
      if (hooks.beforeBatch) await hooks.beforeBatch(db, statements)
      const results = await db.batch(statements)
      if (hooks.afterBatchThrow) throw new Error('simulated lost D1 batch response')
      return results.map((result, index) => {
        const directChanges = Number(result.meta?.changes || 0)
        return /INSERT\s+INTO\s+sales\s*\(/i.test(statements[index].sql) && directChanges > 0
          ? { ...result, meta: { ...result.meta, changes: directChanges + 1 } }
          : result
      })
    },
    exec: (sql) => db.exec(sql),
  }
  api.staging = api
  return api
}

function fixture(hooks = {}) {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  db.prepare(`INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
              VALUES(10,'Powder','POWDER',10,9.5,38000,4,16000,1)`).run()
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)').run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
              VALUES(500,10,'powder-lot','POWDER-LOT','2027-06-01','2026-09-01',1,1)`).run()
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)').run()
  return { raw: db, route: routeDb(db, hooks) }
}

function request(clientRequestId) {
  return {
    branch_id: 1,
    items: [{ product_id: 10, quantity: 1, branch_id: 1, batch_id: 500, applied_price_usd: 9.5 }],
    exchange_rate: 4000,
    payment_method: 'Cash',
    payment_currency: 'USD',
    amount_paid_usd: 9.5,
    client_request_id: clientRequestId,
  }
}

async function postSale(db, body) {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db }, executionCtx)
  return { status: response.status, body: await response.json() }
}

function creationState(db) {
  return {
    sales: Number(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n),
    items: Number(db.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n),
    allocations: Number(db.prepare('SELECT COUNT(*) AS n FROM sale_item_batch_allocations').get().n),
    movements: Number(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n),
    audits: Number(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='sale_creation'").get().n),
    revisions: Number(db.prepare('SELECT COUNT(*) AS n FROM sale_write_revisions').get().n),
    product: Number(db.prepare('SELECT stock_quantity AS n FROM products WHERE id=10').get().n),
    branch: Number(db.prepare('SELECT quantity AS n FROM branch_stock WHERE product_id=10 AND branch_id=1').get().n),
    batch: Number(db.prepare('SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().n),
  }
}

async function assertNativeD1TriggerMetadata() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    await db.prepare('CREATE TABLE sales(id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT)').run()
    await db.prepare('CREATE TABLE sale_write_revisions(sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0)').run()
    await db.prepare(`CREATE TRIGGER sale_revision_sales_insert AFTER INSERT ON sales BEGIN
      INSERT INTO sale_write_revisions(sale_id,revision) VALUES(NEW.id,1);
    END`).run()
    const result = await db.prepare("INSERT INTO sales(receipt_number) VALUES('native-trigger')").run()
    assert.equal(result.success, true)
    assert.equal(result.meta.changes, 2, 'native D1 counts the sale row and its revision-trigger row')
    assert.equal(result.meta.last_row_id, 1)
    console.log('PASS native Miniflare D1 reports changes=2 for the triggered sale insert')
  } finally {
    await mf.dispose()
  }
}

;(async () => {
  await assertNativeD1TriggerMetadata()
  {
    const f = fixture()
    currentUser = { ...USER, permissions: '{}' }
    const denied = await postSale(f.route, request('permission-denied'))
    currentUser = USER
    assert.equal(denied.status, 403, JSON.stringify(denied.body))
    assert.deepEqual(creationState(f.raw), {
      sales: 0, items: 0, allocations: 0, movements: 0, audits: 0, revisions: 0,
      product: 10, branch: 10, batch: 10,
    })
    console.log('PASS POS permission is enforced before every creation effect')
  }

  {
    const f = fixture()
    f.raw.prepare("UPDATE branches SET name='Warehouse' WHERE id=1").run()
    const refused = await postSale(f.route, request('warehouse-refused'))
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.match(refused.body.error, /Shop/)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0)
    console.log('PASS branch-role guard still rejects Warehouse creation before writes')
  }

  {
    const f = fixture()
    const legacyRequest = request('unused')
    delete legacyRequest.client_request_id
    const created = await postSale(f.route, legacyRequest)
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.match(f.raw.prepare('SELECT client_request_id FROM sales').get().client_request_id, /^server:/)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 1)
    console.log('PASS legacy callers without a client request id remain supported through an internal atomic write key')
  }

  {
    const f = fixture()
    const created = await postSale(f.route, request('trigger-inclusive-create'))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_item_batch_allocations').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_write_revisions').get().n, 1)
    assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='sale_creation' AND action='create'").get().n, 1)
    const creationAudit = JSON.parse(f.raw.prepare("SELECT details FROM audit_logs WHERE entity='sale_creation'").get().details)
    assert.deepEqual(Object.keys(creationAudit).sort(), ['itemCount', 'kind', 'origin', 'receiptNumber', 'saleStatus', 'totalUsd'])
    assert.equal(creationAudit.itemCount, 1)
    assert.equal(creationAudit.totalUsd, 9.5)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 9)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity, 9)
    console.log('PASS trigger-inclusive D1 batch metadata does not reject a successful atomic sale')

    const replay = await postSale(f.route, request('trigger-inclusive-create'))
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.duplicate, true)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 1)
    assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='sale_creation'").get().n, 1)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 9)
    console.log('PASS complete idempotent replay returns the original sale without applying stock twice')
  }

  {
    const f = fixture()
    f.raw.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,branch_name,cashier_name,payment_method,total_usd,sale_status)
                   VALUES('ORPHAN','orphan-replay',1,'Shop','Sale Cashier','Cash',9.5,'completed')`).run()
    const replay = await postSale(f.route, request('orphan-replay'))
    assert.equal(replay.status, 409, JSON.stringify(replay.body))
    assert.equal(replay.body.code, 'sale_incomplete')
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 0)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 10)
    console.log('PASS an itemless header is never reported as a completed idempotent replay')
  }

  {
    const f = fixture({ afterBatchThrow: true })
    const uncertain = await postSale(f.route, request('lost-batch-response'))
    assert.equal(uncertain.status, 200, JSON.stringify(uncertain.body))
    assert.equal(uncertain.body.duplicate, true)
    const stored = f.raw.prepare('SELECT id,receipt_number FROM sales').get()
    assert.deepEqual({ id: uncertain.body.id, receiptNumber: uncertain.body.receiptNumber }, {
      id: Number(stored.id), receiptNumber: stored.receipt_number,
    })
    assert.deepEqual(creationState(f.raw), {
      sales: 1, items: 1, allocations: 1, movements: 1, audits: 1, revisions: 1,
      product: 9, branch: 9, batch: 9,
    })
    console.log('PASS a lost batch response reconciles only the fully committed sale and returns its stored identity')
  }

  {
    const f = fixture({
      beforeBatch(db) {
        db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=20').run()
      },
    })
    f.raw.prepare("INSERT INTO customers(id,name,is_anonymous) VALUES(20,'Changed Customer',0)").run()
    const raced = await postSale(f.route, { ...request('customer-race'), customer_id: 20 })
    assert.equal(raced.status, 409, JSON.stringify(raced.body))
    assert.equal(raced.body.code, 'customer_state_conflict')
    assert.deepEqual(creationState(f.raw), {
      sales: 0, items: 0, allocations: 0, movements: 0, audits: 0, revisions: 0,
      product: 10, branch: 10, batch: 10,
    })
    console.log('PASS customer identity race aborts the complete create batch with its typed 409')
  }

  const injectedFailures = [
    ['header', "CREATE TRIGGER fail_create_effect BEFORE INSERT ON sales BEGIN SELECT RAISE(ABORT,'forced header'); END"],
    ['line', "CREATE TRIGGER fail_create_effect BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT,'forced line'); END"],
    ['allocation', "CREATE TRIGGER fail_create_effect BEFORE INSERT ON sale_item_batch_allocations BEGIN SELECT RAISE(ABORT,'forced allocation'); END"],
    ['batch stock', "CREATE TRIGGER fail_create_effect BEFORE UPDATE ON branch_batch_stock BEGIN SELECT RAISE(ABORT,'forced batch stock'); END"],
    ['branch stock', "CREATE TRIGGER fail_create_effect BEFORE UPDATE ON branch_stock BEGIN SELECT RAISE(ABORT,'forced branch stock'); END"],
    ['movement', "CREATE TRIGGER fail_create_effect BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'forced movement'); END"],
    ['product stock', "CREATE TRIGGER fail_create_effect BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT,'forced product stock'); END"],
    ['creation audit', "CREATE TRIGGER fail_create_effect BEFORE INSERT ON audit_logs WHEN NEW.entity='sale_creation' BEGIN SELECT RAISE(ABORT,'forced audit'); END"],
  ]
  for (const [label, trigger] of injectedFailures) {
    const f = fixture()
    const before = creationState(f.raw)
    f.raw.exec(trigger)
    const failed = await postSale(f.route, request(`forced-${label.replace(/\s+/g, '-')}`))
    assert.notEqual(failed.status, 200, `${label}: ${JSON.stringify(failed.body)}`)
    assert.deepEqual(creationState(f.raw), before, `${label} failure must roll back every creation effect`)
  }
  console.log(`PASS ${injectedFailures.length} injected header/item/allocation/stock/movement/audit failures roll back the whole sale`)

  {
    const f = fixture()
    f.raw.prepare(`INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,quantity,quantity_remaining)
                   VALUES(600,10,'Powder',1,2,2)`).run()
    f.raw.exec("CREATE TRIGGER fail_damaged_create_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='sale_creation' BEGIN SELECT RAISE(ABORT,'forced damaged audit'); END")
    const damagedRequest = request('damaged-rollback')
    damagedRequest.items = [{ product_id: 10, quantity: 1, branch_id: 1, damaged_lot_id: 600, applied_price_usd: 9.5 }]
    const failed = await postSale(f.route, damagedRequest)
    assert.notEqual(failed.status, 200, JSON.stringify(failed.body))
    assert.equal(f.raw.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=600').get().quantity_remaining, 2)
    assert.deepEqual(creationState(f.raw), {
      sales: 0, items: 0, allocations: 0, movements: 0, audits: 0, revisions: 0,
      product: 10, branch: 10, batch: 10,
    })
    console.log('PASS damaged-lot consumption rolls back with a later creation-audit failure')
  }
})().catch((error) => { console.error(error); process.exit(1) })
