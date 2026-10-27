'use strict'
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// GET /api/notifications/summary: the version-keyed sections (expiry, supplier credit, loyalty) answered from the
// Cache API between writes, the sales queues live, and NO standing low/out-of-stock list (the bell's inventory section is
// the recorded crossings: scripts/test-notifications-stock-alerts-pure.cjs).
//
// Loads the REAL routes/notifications.ts and the REAL lib/cache.ts against an in-memory SQLite database with every
// migration applied. Only Worker seams are stubbed: the session, the Cache API (a Map keyed by URL, like caches.default)
// and KV (a Map holding the cache version counters). The database handle counts every statement and every row it returns.
//
// Run: node scripts/test-notifications-summary-trim-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

// ---- database with statement + row accounting ---------------------------------------------------
const raw = openDb(loadAll())
assert.throws(() => raw.db.prepare("INSERT INTO products(name) VALUES('unadmitted guard control')").run(), /stock_transaction_required/)
raw.db.limits.exprDepth = 100
const ledger = []
function category(sql) {
  if (/out_of_stock_threshold/.test(sql) && /FROM products/.test(sql)) return 'inventory'
  if (/expiry_date/.test(sql) && /FROM products/.test(sql)) return 'expiry'
  if (/credit_due_date/.test(sql) && /FROM product_batches/.test(sql)) return 'supplier_credit'
  if (/loyalty-ledger|GROUP BY customer_id/.test(sql) || /FROM customers WHERE id IN/.test(sql)) return 'loyalty'
  if (/loyalty_points_enabled'/.test(sql)) return 'loyalty'
  if (/FROM sales/.test(sql)) return 'sales'
  if (/cache_versions/.test(sql)) return 'versions'
  if (/FROM settings/.test(sql)) return 'settings'
  return 'other'
}
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    const note = (values) => ledger.push({ category: category(sql), rows: values.length, bytes: Buffer.byteLength(JSON.stringify(values)), sql })
    return {
      all: async (params) => { const rows = stmt.all(params) ?? []; note(rows); return rows },
      get: async (params) => { const row = stmt.get(params) ?? null; note(row ? [row] : []); return row },
      run: async (params) => { const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
  // The summary's sections are read in one db.batch: each statement still counts, under its own category.
  batch: async (items) => {
    const results = await raw.batch(items)
    items.forEach((item, index) => {
      const rows = results[index].results ?? []
      ledger.push({ category: category(item.sql), rows: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows)), sql: item.sql })
    })
    return results
  },
  exec: (sql) => raw.exec(sql),
}
const statements = (name) => ledger.filter((entry) => entry.category === name).length
const rowsOf = (name) => ledger.filter((entry) => entry.category === name).reduce((sum, entry) => sum + entry.rows, 0)

// ---- module loader (relative requires resolved from src/, like the other route harnesses) --------
let currentUser = null
const overrides = {
  '../lib/db': { getDb: () => db },
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() }, prefetchWithSession: () => {}, takePrefetched: () => undefined },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  './telegram': { sendTelegramEvent: async () => false },
}
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path.join(SRC, rel),
  }).outputText
  const mod = { exports: {} }
  modules.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

// ---- Cache API + KV stand-ins ---------------------------------------------------------------------
const cacheStore = new Map()
globalThis.caches = {
  default: {
    async match(request) { const hit = cacheStore.get(request.url); return hit ? hit.clone() : undefined },
    async put(request, response) { cacheStore.set(request.url, response) },
  },
}
const kv = new Map()
let kvReads = 0
const env = {
  DB: raw,
  PLAN_TIER: process.env.TEST_PLAN_TIER === 'free' ? 'free' : 'paid',
  CACHE: {
    async get(key) { kvReads += 1; return kv.has(key) ? kv.get(key) : null },
    async put(key, value) { kv.set(key, String(value)) },
    async delete(key) { kv.delete(key) },
  },
}
const pending = []
const executionCtx = { waitUntil: (promise) => { pending.push(Promise.resolve(promise).catch(() => {})) }, passThroughOnException() {} }
const app = load('routes/notifications.ts').default
const cacheModule = load('lib/cache.ts')

async function call(method, pathname, user) {
  currentUser = user
  ledger.length = 0
  const res = await app.request(`http://local${pathname}`, { method }, env, executionCtx)
  await Promise.all(pending.splice(0))
  const text = await res.text()
  return { status: res.status, bytes: Buffer.byteLength(text), json: text ? JSON.parse(text) : null }
}
const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}' }
const CASHIER = { id: 2, username: 'cashier', name: 'Cashier', role_code: 'staff', permissions: JSON.stringify({ sales: true }) }
const STOCK_ONLY = { id: 3, username: 'stock', name: 'Stock', role_code: 'staff', permissions: JSON.stringify({ inventory: true }) }
const summary = (user = ADMIN) => call('GET', '/summary', user)
const section = (body, id) => (body.json.sections || []).find((entry) => entry.id === id)

// ---- fixtures ---------------------------------------------------------------------------------------
// 330 flagged products with deliberate ties (equal quantity, different names; an out-of-stock row
// whose own threshold lifts it above the global one) plus 40 healthy and 5 inactive ones.
function seedProducts() {
  return seedStockFixture(raw.db, () => {
  const insert = raw.db.prepare('INSERT INTO products (name, stock_quantity, out_of_stock_threshold, low_stock_threshold, is_active) VALUES (?, ?, ?, ?, ?)')
  for (let i = 0; i < 120; i += 1) insert.run(`Out ${String(i).padStart(3, '0')}`, i % 3, 2, 10, 1) // qty 0..2, own out threshold 2 -> out
  for (let i = 0; i < 210; i += 1) insert.run(`Low ${String(i).padStart(3, '0')}`, 3 + (i % 8), 0, 10, 1) // qty 3..10 -> low
  for (let i = 0; i < 40; i += 1) insert.run(`Healthy ${i}`, 50 + i, 0, 10, 1)
  for (let i = 0; i < 5; i += 1) insert.run(`Retired ${i}`, 0, 0, 10, 0) // inactive: never listed
  })
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  seedProducts()
  let first
  await check('no standing list: 330 low and out-of-stock products with no recorded crossing give the bell no inventory section', async () => {
    first = await summary()
    assert.equal(first.status, 200)
    assert.equal(section(first, 'inventory'), undefined)
    assert.equal(first.json.unreadCount, first.json.sections.reduce((total, entry) => total + entry.count, 0))
    assert.equal(rowsOf('inventory'), 0, 'and the catalog is not read for it')
  })

  await check('the public shape is otherwise unchanged: preferences carry no cache-only fields', () => {
    assert.ok(!('loyaltyPointsEnabled' in first.json.preferences))
    assert.deepEqual(Object.keys(first.json.preferences).sort(), [
      'driveSyncConnected', 'driveSyncEnabled', 'expiryDays', 'expiryEnabled', 'inventoryEnabled', 'loyaltyEnabled', 'loyaltyThreshold',
      'portalEnabled', 'realertMinutes', 'salesEnabled', 'supplierCreditDays', 'supplierCreditEnabled', 'systemEnabled',
    ])
    assert.equal(first.json.unread, first.json.unreadCount)
  })

  await check('a second call is a cache hit: zero expiry and loyalty statements, identical answer', async () => {
    kvReads = 0
    const again = await summary()
    assert.ok(kvReads <= 7, `each of the six data versions is read once per request, not once per section, plus at most one low-stock memo re-confirmation (${kvReads} KV reads; 9 before the per-request memo)`)
    assert.ok(statements('versions') <= 6, 'and the D1 fallback for a never-bumped version is likewise once each')
    assert.equal(statements('expiry'), 0)
    assert.equal(statements('loyalty'), 0)
    assert.deepEqual(again.json.sections, first.json.sections)
  })

  await check("a product edit ('products' bump) re-runs expiry but not loyalty", async () => {
    await cacheModule.bumpVersion(env, 'products')
    await summary()
    assert.equal(statements('inventory'), 0)
    assert.equal(statements('expiry'), 1)
    assert.equal(statements('loyalty'), 0)
  })

  await check('supplier credit is answered from the cache between writes: a second call reads no lots, a lot or product change re-reads them', async () => {
    seedStockFixture(raw.db, () => {
      const productId = raw.db.prepare("SELECT id FROM products WHERE name = 'Healthy 0'").get().id
      raw.db.prepare(`INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, supplier_name, payment_status, credit_due_date, unit_cost_usd, received_cost_usd, received_quantity)
        VALUES (?, 'sc1', 'SC1', '2026-09-01', 1, 'Bong Long', 'credit', date('now', '-3 day'), 5, 25, 5)`).run(productId)
    })
    await cacheModule.bumpVersion(env, 'products')
    const cold = await summary()
    assert.equal(statements('supplier_credit'), 1, 'first call reads the lots once')
    assert.equal(section(cold, 'supplier_credit').count, 1)
    const warm = await summary()
    assert.equal(statements('supplier_credit'), 0, 'second call: zero lot statements (was one full lot scan every refresh)')
    assert.deepEqual(section(warm, 'supplier_credit'), section(cold, 'supplier_credit'))
    seedStockFixture(raw.db, () => raw.db.prepare("UPDATE product_batches SET payment_status = 'paid', credit_due_date = NULL WHERE lot_code = 'SC1'").run())
    assert.equal(section(await summary(), 'supplier_credit').count, 1, 'control: not visible before the version bump -- the cache is real')
    await cacheModule.bumpVersion(env, 'products') // what PATCH /api/batches/:id does
    const paid = await summary()
    assert.equal(statements('supplier_credit'), 1, 'the bump re-read the lots')
    assert.equal(section(paid, 'supplier_credit'), undefined, 'marking the lot paid clears the reminder')
    seedStockFixture(raw.db, () => raw.db.prepare("UPDATE product_batches SET payment_status = 'credit', credit_due_date = date('now', '-3 day') WHERE lot_code = 'SC1'").run())
    await cacheModule.bumpVersion(env, 'products')
    assert.equal(section(await summary(), 'supplier_credit').count, 1)
    assert.equal(section(await summary(CASHIER), 'supplier_credit'), undefined, 'the cache never serves it to a non-admin')
  })

  // Since 6.0.888 the loyalty section costs nothing while the programme is off, so these two cases switch it on.
  await check("a sale/return/customer edit re-runs loyalty only (and does not touch inventory)", async () => {
    seedStockFixture(raw.db, () => raw.db.prepare("INSERT INTO settings (key, value) VALUES ('loyalty_points_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    await cacheModule.bumpVersion(env, 'settings')
    await summary()
    for (const namespace of ['sales', 'returns', 'customers']) {
      await cacheModule.bumpVersion(env, namespace)
      await summary()
      assert.ok(statements('loyalty') >= 1, `${namespace} bump re-ran loyalty`)
      assert.equal(statements('inventory'), 0, `${namespace} bump left inventory cached`)
    }
  })

  await check("a settings save re-runs the version-keyed sections", async () => {
    await cacheModule.bumpVersion(env, 'settings')
    await summary()
    assert.equal(statements('inventory'), 0)
    assert.equal(statements('expiry'), 1)
    assert.ok(statements('loyalty') >= 1)
    seedStockFixture(raw.db, () => raw.db.prepare("INSERT INTO settings (key, value) VALUES ('loyalty_points_enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    await cacheModule.bumpVersion(env, 'settings')
    await summary()
  })

  await check('users never see each other\'s sections through the shared cache', async () => {
    await summary(ADMIN) // warm every cached section as an administrator
    const cashier = await summary(CASHIER)
    assert.equal(section(cashier, 'inventory'), undefined, 'a cashier without inventory access gets no inventory section')
    assert.equal(section(cashier, 'expiry'), undefined)
    assert.equal(section(cashier, 'loyalty'), undefined)
    const stockOnly = await summary(STOCK_ONLY)
    assert.equal(section(stockOnly, 'inventory'), undefined, 'no crossing, no inventory section, whatever the stock')
    assert.equal(section(stockOnly, 'supplier_credit'), undefined, 'supplier credit stays admin-only')
    assert.equal(section(stockOnly, 'security'), undefined)
  })

  await check('the sales section follows the sales READ rule: view-only sees it, a full user with sales:view off does not', async () => {
    seedStockFixture(raw.db, () => raw.db.prepare("INSERT INTO sales (receipt_number, total_usd, sale_status) VALUES ('R-1', 12.5, 'awaiting_payment')").run())
    const viewOnly = { id: 4, username: 'viewer', name: 'Viewer', role_code: 'staff', permissions: JSON.stringify({ sales: 'view' }) }
    const fullButHidden = { id: 5, username: 'hidden', name: 'Hidden', role_code: 'staff', permissions: JSON.stringify({ sales: true, 'sales:view': false }) }
    const full = { id: 6, username: 'full', name: 'Full', role_code: 'staff', permissions: JSON.stringify({ sales: true }) }
    assert.equal(section(await summary(ADMIN), 'sales').count, 1, 'control: an administrator sees the row')
    assert.equal(section(await summary(full), 'sales').count, 1, 'a full sales user sees it')
    assert.equal(section(await summary(viewOnly), 'sales').count, 1, 'a view-only user sees it (hasPermission would have hidden it)')
    assert.equal(section(await summary(fullButHidden), 'sales'), undefined, 'sales:view switched off hides it (hasPermission would have shown it)')
    assert.equal(JSON.stringify(await summary(fullButHidden)).includes('R-1'), false, 'and the receipt number is nowhere in the body')
  })

  // 0263 (6.0.890): a delivery order is Completed (or Not Paid) with the delivery_pending tag, not the retired word.
  await check('the delivery queue reads the delivery tag: a tagged sale is listed, a cancelled one is not', async () => {
    seedStockFixture(raw.db, () => raw.db.exec(`INSERT INTO sales (receipt_number, total_usd, sale_status, delivery_pending) VALUES
      ('R-D1', 9, 'completed', 1), ('R-D2', 9, 'cancelled', 1), ('R-D3', 9, 'completed', 0)`))
    const ids = (section(await summary(ADMIN), 'sales').items || []).map((item) => item.label)
    assert.ok(ids.includes('R-D1'), `a Completed sale with the delivery tag is in the delivery queue (${ids})`)
    assert.ok(!ids.includes('R-D2') && !ids.includes('R-D3'), 'a cancelled tagged sale and an untagged sale are not')
  })

  await check('expiry: the index-assisted statement lists exactly what the removed full scan listed, boundaries and a legacy inactive-with-stock row included', async () => {
    const visible = load('lib/productStockGuard.ts').stockVisibleProductSql()
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
    // A product that is inactive but still holds stock cannot be written any more (migration 0242), but production
    // holds such legacy rows and the old rule listed them. Seed one by lifting the guard for this one statement.
    seedStockFixture(raw.db, () => {
      const insert = raw.db.prepare('INSERT INTO products (name, stock_quantity, out_of_stock_threshold, low_stock_threshold, is_active, expiry_date) VALUES (?, ?, 0, 10, ?, ?)')
      insert.run('Exp past', 20, 1, '2020-01-01')
      insert.run('Exp edge in', 20, 1, day(30))
      insert.run('Exp edge out', 20, 1, day(32))
      insert.run('Exp timed in', 20, 1, day(29) + ' 23:30:00')
      insert.run('Exp timed out', 20, 1, day(30) + ' 23:59:00')
      insert.run('Exp blank', 20, 1, '   ')
      insert.run('Exp junk', 20, 1, 'not a date')
      insert.run('Exp retired empty', 0, 0, '2020-03-03')
      insert.run('Exp null empty', 0, null, '2020-05-05')
      insert.run('Exp legacy stocked', 5, 1, '2020-02-02')
      insert.run('Exp legacy null stocked', 5, 1, '2020-02-03')
      // is_active has no CHECK, so every storable value is covered: 2 (above 1), a fraction and a negative (below 1), text, and an EMPTY one of each kind.
      for (const [name, value, stocked] of [['Exp legacy two', 2, 5], ['Exp legacy half', 0.5, 5], ['Exp legacy neg', -1, 5], ['Exp legacy text', 'x', 5], ['Exp empty two', 2, 0]]) {
        insert.run(name, stocked, 1, '2020-02-0' + (4 + [...'abcde'].length % 3))
      }
      const triggers = raw.db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('product_deactivate_stock_0242', 'product_cache_stock_0242')").all()
      for (const trigger of triggers) raw.db.exec(`DROP TRIGGER ${trigger.name}`)
      raw.db.prepare("UPDATE products SET is_active = 0 WHERE name = 'Exp legacy stocked'").run()
      raw.db.prepare("UPDATE products SET is_active = NULL WHERE name = 'Exp legacy null stocked'").run()
      for (const [name, value] of [['Exp legacy two', 2], ['Exp legacy half', 0.5], ['Exp legacy neg', -1], ['Exp legacy text', 'x'], ['Exp empty two', 2]]) {
        if (name === 'Exp empty two') raw.db.prepare('UPDATE products SET stock_quantity = 0 WHERE name = ?').run(name)
        raw.db.prepare('UPDATE products SET is_active = ? WHERE name = ?').run(value, name)
      }
      for (const trigger of triggers) raw.db.exec(trigger.sql)
    })
    const removedFullScan = (days) => raw.db.prepare(`SELECT id FROM products p
      WHERE ${visible} AND expiry_date IS NOT NULL AND trim(expiry_date) != '' AND julianday(expiry_date) - julianday('now') <= @days
      ORDER BY expiry_date ASC LIMIT 50`).all({ days }).map((row) => row.id)
    for (const days of [0, 7, 30, 90]) {
      seedStockFixture(raw.db, () => raw.db.prepare("INSERT INTO settings (key, value) VALUES ('notifications_expiry_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(days)))
      await cacheModule.bumpVersion(env, 'settings')
      const listed = (section(await summary(), 'expiry')?.items || []).map((item) => Number(item.id.replace('expiry-', '')))
      assert.deepEqual(listed, removedFullScan(days), `days=${days}: same rows in the same order`)
    }
    const names = (section(await summary(), 'expiry')?.items || []).map((item) => item.label)
    assert.ok(names.includes('Exp past') && names.includes('Exp legacy stocked') && names.includes('Exp legacy null stocked'), 'the legacy inactive rows with stock are listed: ' + names.join(','))
    for (const name of ['Exp legacy two', 'Exp legacy half', 'Exp legacy neg', 'Exp legacy text']) assert.ok(names.includes(name), `${name}: any is_active other than 1, holding stock, is visible exactly as the old rule said: ` + names.join(','))
    assert.ok(!names.includes('Exp empty two'), 'an empty product with is_active 2 is not')
    assert.ok(!names.includes('Exp retired empty') && !names.includes('Exp null empty'), 'empty inactive rows are not')
    const plan = raw.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM products p WHERE p.is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+30 day')").all().map((row) => row.detail).join(' | ')
    assert.match(plan, /idx_products_active_expiry_day/, plan)
  })


  const failures = []
  const loyaltyCheck = async (name, fn) => {
    try { await check(name, fn) } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`) }
  }
  const setting = (key, value) => seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)))
  const resetLoyaltyCache = () => cacheModule.bumpVersion(env, 'customers')
  const loyalty = async (user = ADMIN) => section(await summary(user), 'loyalty')
  const pointsOf = (value, id) => Number(value?.items.find(item => item.id === `loyalty-${id}`)?.meta.split(' ')[0])
  setting('loyalty_points_enabled', 'true')
  setting('notifications_loyalty_threshold', 100)
  await cacheModule.bumpVersion(env, 'settings')
  for (let id = 5101; id <= 5109; id += 1) seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO customers(id,name) VALUES (?,?)').run(id, `Loyalty customer ${id}`))
  seedStockFixture(raw.db, () => raw.db.exec(`
    INSERT INTO loyalty_point_adjustments(customer_id,points) VALUES (5101,125),(5102,900);
    UPDATE loyalty_point_adjustments SET voided_at='2026-01-01' WHERE customer_id=5102;
    INSERT INTO customer_share_submissions(id,customer_id,status,reward_points,reward_points_voided_at,loyalty_eligible)
      VALUES (5103,5103,'approved',150,NULL,1),(5104,5104,'pending',1000,NULL,1),(5105,5105,'approved',1000,'2026-01-01',1),
        (5108,5108,'approved',1000,NULL,0),(5100,5109,'approved',1000,NULL,1);
    UPDATE system_flags SET value=json_set(value,'$.submissions',5100) WHERE key='loyalty_points_reset';
  `))
  await resetLoyaltyCache()
  await loyaltyCheck('loyalty includes manual and reward-only customers, excluding voided, pending, ineligible and pre-reset awards', async () => {
    const value = await loyalty()
    assert.equal(value?.count, 2)
    assert.equal(pointsOf(value, 5101), 125)
    assert.equal(pointsOf(value, 5103), 150)
    assert.ok(!value.items.some(item => ['loyalty-5102', 'loyalty-5104', 'loyalty-5105', 'loyalty-5108', 'loyalty-5109'].includes(item.id)))
    assert.equal(raw.db.prepare('SELECT loyalty_eligible FROM customer_share_submissions WHERE id=5108').get().loyalty_eligible, 0)
    assert.equal(raw.db.prepare("SELECT json_extract(value,'$.submissions') AS checkpoint FROM system_flags WHERE key='loyalty_points_reset'").get().checkpoint, 5100)
  })

  seedStockFixture(raw.db, () => raw.db.exec(`
    INSERT INTO sales(receipt_number,customer_id,sale_status,total_usd,total_khr,membership_points_redeemed,loyalty_accrual) VALUES
      ('LOY-PAID',5106,'completed',80,320000,0,1),
      ('LOY-NP',5106,'awaiting_payment',900,900000,25,1),
      ('LOY-NONACCRUAL',5106,'completed',700,700000,5,0),
      ('LOY-CANCELLED',5106,'cancelled',800,800000,500,1);
    INSERT INTO returns(return_number,customer_id,status,return_scope,total_refund_usd,total_refund_khr) VALUES
      ('LOY-RETURN',5106,'completed','customer',10,40000),
      ('LOY-SUPPLIER',5106,'completed','supplier',700,700000),
      ('LOY-VOIDRETURN',5106,'cancelled','customer',700,700000);
    INSERT INTO loyalty_point_adjustments(customer_id,points) VALUES (5106,20.126);
    INSERT INTO customer_share_submissions(customer_id,status,reward_points,loyalty_eligible) VALUES (5106,'approved',5,1);
  `))
  setting('customer_portal_points_basis', 'usd')
  setting('customer_portal_points_per_usd', 2)
  await cacheModule.bumpVersion(env, 'settings')
  await loyaltyCheck('loyalty uses the configured USD rate and all eligible ledger terms with final rounding', async () => {
    assert.equal(pointsOf(await loyalty(), 5106), 135.13)
  })
  setting('customer_portal_points_basis', 'khr')
  setting('customer_portal_points_per_khr', 0.001)
  await cacheModule.bumpVersion(env, 'settings')
  await loyaltyCheck('loyalty uses configured KHR rather than USD, excluding supplier and cancelled returns', async () => {
    assert.equal(pointsOf(await loyalty(), 5106), 275.13)
  })
  seedStockFixture(raw.db, () => raw.db.prepare("DELETE FROM settings WHERE key='customer_portal_points_per_khr'").run())
  setting('exchange_rate', 4000)
  setting('customer_portal_points_per_usd', 4)
  await cacheModule.bumpVersion(env, 'settings')
  await loyaltyCheck('loyalty derives the missing KHR rate from the same exchange-rate configuration as checkout', async () => {
    assert.equal(pointsOf(await loyalty(), 5106), 275.13)
  })
  setting('notifications_loyalty_threshold', 1)
  setting('customer_portal_points_basis', 'usd')
  setting('customer_portal_points_per_usd', 0)
  await cacheModule.bumpVersion(env, 'settings')
  await loyaltyCheck('zero earning rates do not resurrect spent points and negative balances stay below the threshold', async () => {
    const value = await loyalty()
    assert.equal(pointsOf(value, 5101), 125)
    assert.ok(!value.items.some(item => item.id === 'loyalty-5106'))
  })
  await loyaltyCheck('loyalty read permission is checked even when an administrator warmed the shared cache', async () => {
    await loyalty()
    const viewer = { id: 8, role_code: 'staff', permissions: JSON.stringify({ contacts: 'review' }) }
    const hidden = { id: 9, role_code: 'staff', permissions: JSON.stringify({ contacts: true, 'contacts:view': false, 'contacts:add': false, 'contacts:edit': false }) }
    const writer = { id: 10, role_code: 'staff', permissions: JSON.stringify({ contacts: true, 'contacts:view': false }) }
    assert.equal(pointsOf(await loyalty(viewer), 5101), 125)
    assert.equal(await loyalty(hidden), undefined)
    assert.equal(pointsOf(await loyalty(writer), 5101), 125, 'the existing Add/Edit implies View ruling still applies')
  })
  setting('loyalty_points_enabled', 'false')
  await cacheModule.bumpVersion(env, 'settings')
  await loyaltyCheck('the disabled programme does not emit loyalty prompts', async () => assert.equal(await loyalty(), undefined))
  setting('loyalty_points_enabled', 'true')
  await cacheModule.bumpVersion(env, 'settings')

  await loyaltyCheck('an actual share review immediately invalidates loyalty cache, and a denied review cannot award points', async () => {
    const portal = load('routes/portal.ts').default
    const review = async (user, status, reward_points) => {
      currentUser = user
      const response = await portal.request('http://local/submissions/5104/review', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, reward_points }),
      }, env, executionCtx)
      await Promise.all(pending.splice(0))
      return response.status
    }
    const before = await loyalty()
    assert.ok(!before.items.some(item => item.id === 'loyalty-5104'))
    assert.equal(await review(CASHIER, 'approved', 600), 403)
    assert.equal(raw.db.prepare('SELECT status FROM customer_share_submissions WHERE id=5104').get().status, 'pending')
    assert.equal(await review(ADMIN, 'approved', 600), 200)
    assert.equal(pointsOf(await loyalty(), 5104), 600, 'the cached pre-review section must turn over immediately')
    assert.equal(await review(ADMIN, 'rejected', 600), 200)
    assert.ok(!(await loyalty()).items.some(item => item.id === 'loyalty-5104'))
  })

  await loyaltyCheck('loyalty count remains exact for600 customers while only50 names are read for the preview', async () => {
    for (let id = 6000; id < 6600; id += 1) {
      seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO customers(id,name) VALUES (?,?)').run(id, `Preview ${id}`))
      seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO loyalty_point_adjustments(customer_id,points) VALUES (?,?)').run(id, 1000 + id))
    }
    await resetLoyaltyCache()
    const value = await loyalty()
    assert.equal(value.count, 602)
    assert.equal(value.items.length, 50)
    assert.equal(value.items[0].id, 'loyalty-6599')
    const names = ledger.filter(entry => /FROM customers WHERE id IN/.test(entry.sql))
    assert.equal(names.length, 1, 'names are read once for the bounded preview')
    assert.equal(names[0].rows, 50)
    const again = await loyalty()
    assert.deepEqual(again, value)
    assert.equal(statements('loyalty'), 0, 'unchanged cached answer costs no ledger/name reads')
  })
  await loyaltyCheck('uncached loyalty uses bounded per-row pages on either plan', async () => {
    const saved = globalThis.caches
    delete globalThis.caches
    try {
      const value = await loyalty()
      assert.equal(value.count, 602)
      assert.equal(statements('loyalty'), 8, 'settings/count plus four ledgers and one extra adjustment page plus50 names')
      assert.ok(ledger.length < 40, 'the complete summary stays below the Free50query ceiling with headroom for authentication')
      const pages = ledger.filter(entry => /ORDER BY id ASC LIMIT/.test(entry.sql))
      assert.ok(pages.every(entry => entry.rows <= 500))
      console.log(`  measured ${env.PLAN_TIER}: uncached summary ${ledger.length} SQL reads; loyalty${statements('loyalty')}; name rows50; peak page ${Math.max(...pages.map(entry => entry.bytes))} projected bytes (SQLite route harness, authentication mocked)`)
    } finally { globalThis.caches = saved }
  })
  assert.deepEqual(failures, [], 'all loyalty counterexamples must pass')

  console.log(`\n${passed} passed`)
}

module.exports = { raw, load, env, summary, section, cacheModule, ADMIN, ledger }
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1) })
