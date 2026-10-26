'use strict'
// The sale route's crossing alert, driven through the REAL POST /api/sales (routes/sales.ts) against the full migrated
// SQLite schema, with the REAL lib/stockCrossingAlert.ts behind it. Only the Telegram transport is replaced (a
// recorder), so no message can leave this process and no token is read.
//
//   crossing   a sale that takes stock 12 -> 9 (low threshold 10) sends one message; 12 -> 11 sends none
//   replay     the same client_request_id again is a duplicate and sends nothing more
//   lost       a lost batch response (the sale committed, the reply did not arrive) still alerts, once
//   race       two sales commit before either hook reads (13 -> 11 -> 9): exactly one message, and it says On hand 9,
//              the real value, not the 11 a stale pre-commit read would print
//   response   the hook adds no D1 read in front of the response
//
// Run (from cloudflare/scripts): node test-stock-crossing-sale-route-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const USER = { id: 71, username: 'sale_cashier', name: 'Sale Cashier', permissions: JSON.stringify({ pos: true }) }
const sent = []
let gate = null // when set, the crossing hook waits for it before its first read of branch quantities
const hookReads = []
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  './db': { getDb: (env) => ({
    prepare(sql) {
      const inner = env.DB.prepare(sql)
      const isStateRead = /FROM products p JOIN branch_stock bs/.test(sql)
      return {
        all: async (params) => { if (isStateRead) { hookReads.push(sql); if (gate) await gate }; return inner.all(params) },
        get: (params) => inner.get(params),
        run: (params) => inner.run(params),
      }
    },
  }) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, getVersionWithFallback: async () => 0, cachedJsonResponse: async (_r, _c, _k, _t, loader) => loader() },
  '../lib/telegram': { formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [], sendTelegramEvent: async () => {}, telegramMoney: (v) => String(v ?? '') },
  './telegram': { sendTelegramEvent: async (_env, event) => { sent.push(event); return true } },
}
const moduleCache = new Map()
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
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
const pending = []
const executionCtx = { waitUntil(promise) { pending.push(Promise.resolve(promise).catch(() => {})) }, passThroughOnException() {} }
const flush = async () => { await Promise.all(pending.splice(0)) }

function routeDb(db, hooks = {}) {
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => statement.get(params),
        run: async (params) => {
          const result = statement.run(params)
          const direct = Number(result.meta?.changes || 0)
          return { ...result, changes: /INSERT\s+INTO\s+sales\s*\(/i.test(sql) && direct > 0 ? direct + 1 : direct, lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    batch: async (statements) => {
      const results = await db.batch(statements)
      if (hooks.afterBatchThrow) throw new Error('simulated lost D1 batch response')
      return results.map((result, index) => {
        const direct = Number(result.meta?.changes || 0)
        return /INSERT\s+INTO\s+sales\s*\(/i.test(statements[index].sql) && direct > 0 ? { ...result, meta: { ...result.meta, changes: direct + 1 } } : result
      })
    },
    exec: (sql) => db.exec(sql),
  }
  api.staging = api
  return api
}

function fixture(stock, hooks = {}) {
  const db = openDb(loadAll())
  seedStockFixture(db.db, () => {
    db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
    db.prepare(`INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,low_stock_threshold,out_of_stock_threshold)
                VALUES(10,'Powder','POWDER',${Number(stock)},9.5,38000,4,16000,1,10,0)`).run()
    db.prepare(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,${Number(stock)})`).run()
    db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
                VALUES(500,10,'powder-lot','POWDER-LOT','2027-06-01','2026-09-01',1,1)`).run()
    db.prepare(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,${Number(stock)})`).run()
  })
  return { raw: db, route: routeDb(db, hooks) }
}

function request(clientRequestId, quantity) {
  const total = 9.5 * quantity
  return {
    branch_id: 1, money_precision_version: 1,
    items: [{
      product_id: 10, quantity, branch_id: 1, batch_id: 500, applied_price_usd: 9.5, client_line_key: 'line', pricing_source: 'selling',
      pricing_quote: { gross_usd: total, product_discount_usd: 0, manual_discount_usd: 0, total_usd: total, total_khr: total * 4000 },
    }],
    exchange_rate: 4000, payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: total, client_request_id: clientRequestId,
    offline_owner: { version: 1, actor_id: USER.id, organization_id: null, authority: 'http://localhost', runtime: 'cloudflare-workers' },
  }
}
async function postSale(db, body) {
  const response = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, executionCtx)
  return { status: response.status, body: await response.json() }
}
const rows = (f) => f.raw.prepare('SELECT product_id, tier, sale_id, quantity_before, quantity_after, telegram_status FROM stock_crossing_alerts ORDER BY id').all().map((r) => ({ ...r }))

let passed = 0
async function check(name, fn) {
  sent.length = 0; hookReads.length = 0; gate = null
  await fn()
  await flush()
  passed += 1
  console.log(`PASS ${name}`)
}

;(async () => {
  await check('a sale that crosses the low threshold alerts once, with the real quantity left; a sale that stays above sends none', async () => {
    const f = fixture(12)
    const above = await postSale(f.route, request('stay-above', 1)) // 12 -> 11
    assert.equal(above.status, 200, JSON.stringify(above.body))
    await flush()
    assert.equal(sent.length, 0)
    assert.deepEqual(rows(f), [])
    const crossing = await postSale(f.route, request('crosses', 2)) // 11 -> 9
    assert.equal(crossing.status, 200, JSON.stringify(crossing.body))
    await flush()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'stock_alert')
    assert.equal(sent[0].heading, '⚠️ Low stock')
    assert.deepEqual(sent[0].lines, ['Product: Powder', 'Branch: Shop', 'On hand: 9'])
    assert.deepEqual(rows(f).map((r) => [r.tier, r.sale_id, r.quantity_before, r.quantity_after, r.telegram_status]), [['low', Number(crossing.body.id), 11, 9, 'sent']])
  })

  await check('the same client_request_id again is a duplicate and sends nothing more', async () => {
    const f = fixture(12)
    assert.equal((await postSale(f.route, request('once', 3))).status, 200)
    await flush()
    assert.equal(sent.length, 1)
    const replay = await postSale(f.route, request('once', 3))
    await flush()
    assert.equal(replay.body.duplicate, true)
    assert.equal(sent.length, 1, 'still one')
    assert.equal(rows(f).length, 1)
  })

  await check('a lost batch response (the sale committed, the reply did not arrive) still alerts, once', async () => {
    const f = fixture(12, { afterBatchThrow: true })
    const uncertain = await postSale(f.route, request('lost', 3))
    assert.equal(uncertain.status, 200, JSON.stringify(uncertain.body))
    assert.equal(uncertain.body.duplicate, true)
    await flush()
    assert.equal(sent.length, 1, 'the recovered path runs the hook too')
    assert.deepEqual(sent[0].lines, ['Product: Powder', 'Branch: Shop', 'On hand: 9'])
    assert.equal(rows(f).length, 1)
  })

  await check('two sales that commit before either hook reads (13 -> 11 -> 9, threshold 10): exactly one message, On hand is the real 9', async () => {
    const f = fixture(13)
    let open
    gate = new Promise((resolve) => { open = resolve })
    assert.equal((await postSale(f.route, request('race-a', 2))).status, 200)
    assert.equal((await postSale(f.route, request('race-b', 2))).status, 200)
    assert.equal(sent.length, 0, 'both hooks are still waiting')
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10').get().quantity, 9)
    open()
    await flush()
    assert.equal(sent.length, 1, JSON.stringify(sent))
    assert.deepEqual(sent[0].lines, ['Product: Powder', 'Branch: Shop', 'On hand: 9'])
    assert.equal(rows(f).length, 1)
  })

  await check('13 -> 10 -> 7 (threshold 10), both hooks after both commits: exactly one message, from the quantity the first sale LEFT', async () => {
    const f = fixture(13)
    let open
    gate = new Promise((resolve) => { open = resolve })
    assert.equal((await postSale(f.route, request('race-c', 3))).status, 200)
    assert.equal((await postSale(f.route, request('race-d', 3))).status, 200)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10').get().quantity, 7)
    open()
    await flush()
    assert.equal(sent.length, 1, 'a read after both commits sees 7 and would find no crossing at all: ' + JSON.stringify(sent))
    assert.deepEqual(sent[0].lines, ['Product: Powder', 'Branch: Shop', 'On hand: 10'])
    assert.equal(rows(f).length, 1)
  })

  await check('the deduction batch itself carries the quantity: the stock upsert RETURNs it, and it adds no statement', async () => {
    const f = fixture(12)
    const seen = []
    const real = f.route.batch
    f.route.batch = async (statements) => { seen.push(statements.map((s) => s.sql)); return real(statements) }
    assert.equal((await postSale(f.route, request('returning', 3))).status, 200)
    const upserts = seen.flat().filter((sql) => /INSERT INTO branch_stock/.test(sql))
    assert.equal(upserts.length, 1)
    assert.match(upserts[0], /RETURNING quantity/)
    await flush()
    assert.equal(hookReads.length, 1, 'the one read in waitUntil is for the product name and thresholds; the quantity came from the batch')
  })

  await check('the response never waits for the crossing read: the state read happens only after the sale has answered', async () => {
    const f = fixture(12)
    let open
    gate = new Promise((resolve) => { open = resolve })
    const answered = await postSale(f.route, request('fast', 3))
    assert.equal(answered.status, 200)
    assert.equal(sent.length, 0)
    open()
    await flush()
    assert.equal(sent.length, 1)
    assert.equal(hookReads.length, 1, 'one extra read, inside waitUntil')
  })

  console.log(`\n${passed} checks passed`)
})().catch((error) => { console.error(error); process.exit(1) })
