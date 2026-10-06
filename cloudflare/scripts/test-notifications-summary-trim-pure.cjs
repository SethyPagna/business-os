// GET /api/notifications/summary: counts + a 10-item stock-event preview, with the three cached
// sections (stock events, expiry, loyalty) answered from the Cache API between writes.
//
// Loads the REAL routes/notifications.ts and the REAL lib/cache.ts against an in-memory SQLite
// database with every migration applied. Only Worker seams are stubbed: the session, the Cache API
// (a Map keyed by URL, like caches.default) and KV (a Map holding the cache version counters).
// The database handle counts every statement and every row it returns, so each claim is a number:
//
//   BEFORE (the removed code, restated below as baselineInventory and run on the same data):
//     one statement returning every product at or under its threshold, up to 5,000 rows, all
//     serialised to the client -- a standing list, whether or not any sale had touched it;
//   AFTER (NOTIF-V2):
//     only the product families a SALE carried into low / out of stock (stock_alert_events, written
//     by the sale batch itself -- here by the real statement from lib/saleStockAlerts.ts), 10 rows
//     returned, an exact count from window aggregates, and on a cache hit zero statements for
//     stock, expiry and loyalty. The 330 seeded products below sit under their thresholds and the
//     bell must NOT list them.
//
// Each case is discriminating: the stock cases fail on any "is below the threshold" implementation
// (the 330 standing rows would leak in); the invalidation cases fail if a cache does not turn over on
// the right version bump (and the "not before the bump" half fails if nothing is cached at all).
//
// Run: node scripts/test-notifications-summary-trim-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

// ---- database with statement + row accounting ---------------------------------------------------
const raw = openDb(loadAll())
raw.db.limits.exprDepth = 100
const ledger = []
function category(sql) {
  if (/stock_alert_events/.test(sql)) return 'inventory'
  if (/expiry_date/.test(sql) && /FROM products/.test(sql)) return 'expiry'
  if (/GROUP BY customer_id/.test(sql) || /FROM customers WHERE id IN/.test(sql)) return 'loyalty'
  if (/loyalty_points_enabled'/.test(sql)) return 'loyalty'
  if (/FROM sales/.test(sql)) return 'sales'
  if (/cache_versions/.test(sql)) return 'versions'
  if (/FROM settings/.test(sql)) return 'settings'
  return 'other'
}
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    const note = (rows) => ledger.push({ category: category(sql), rows })
    return {
      all: async (params) => { const rows = stmt.all(params) ?? []; note(rows.length); return rows },
      get: async (params) => { const row = stmt.get(params) ?? null; note(row ? 1 : 0); return row },
      run: async (params) => { const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => raw.batch(items),
  exec: (sql) => raw.exec(sql),
}
const statements = (name) => ledger.filter((entry) => entry.category === name).length
const rowsOf = (name) => ledger.filter((entry) => entry.category === name).reduce((sum, entry) => sum + entry.rows, 0)

// ---- module loader (relative requires resolved from src/, like the other route harnesses) --------
let currentUser = null
const overrides = {
  '../lib/db': { getDb: () => db },
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
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
  PLAN_TIER: 'paid',
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
const lowStock = load('lib/lowStockSettings.ts')
const alerts = load('lib/saleStockAlerts.ts')

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
// 330 products already under their thresholds (the OLD bell listed every one) plus 40 healthy and 5
// inactive ones. Only the 28 products a "sale" below carries across a threshold may appear in the bell.
function seedProducts() {
  const insert = raw.db.prepare('INSERT INTO products (name, stock_quantity, out_of_stock_threshold, low_stock_threshold, is_active) VALUES (?, ?, ?, ?, ?)')
  for (let i = 0; i < 120; i += 1) insert.run(`Out ${String(i).padStart(3, '0')}`, i % 3, 2, 10, 1) // qty 0..2, own out threshold 2 -> out
  for (let i = 0; i < 210; i += 1) insert.run(`Low ${String(i).padStart(3, '0')}`, 3 + (i % 8), 0, 10, 1) // qty 3..10 -> low
  for (let i = 0; i < 40; i += 1) insert.run(`Healthy ${i}`, 50 + i, 0, 10, 1)
  for (let i = 0; i < 5; i += 1) insert.run(`Retired ${i}`, 0, 0, 10, 0) // inactive: never listed
}

// The removed code, restated: one query returning every flagged row (LIMIT 5000), split in JS.
function baselineInventory(config) {
  const lowSql = lowStock.lowStockThresholdSql(config, 'low_stock_threshold')
  const rows = raw.db.prepare(`
    SELECT id, name, stock_quantity,
      COALESCE(out_of_stock_threshold, 0) AS out_threshold,
      ${lowSql} AS low_threshold
    FROM products
    WHERE is_active = 1
      AND (COALESCE(stock_quantity, 0) <= ${lowSql}
           OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))
    ORDER BY stock_quantity ASC
    LIMIT 5000
  `).all()
  const out = rows.filter((row) => Number(row.stock_quantity || 0) <= Number(row.out_threshold || 0))
  return { rows: rows.length, outCount: out.length, lowCount: rows.length - out.length }
}

// One sale batch exactly as the routes build it: the deduction, then the real alert statement.
let lowStockConfig
async function sell(productName, quantity, saleId = 1) {
  const product = raw.db.prepare('SELECT id FROM products WHERE name = ?').get(productName)
  await raw.batch([
    { sql: 'UPDATE products SET stock_quantity = stock_quantity - @quantity WHERE id = @id', params: { id: product.id, quantity } },
    alerts.planSaleStockAlertStatement({ lines: [{ product_id: product.id, branch_id: 1, quantity }], lowStock: lowStockConfig, sale: { saleId } }),
  ])
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  seedProducts()
  lowStockConfig = await lowStock.loadLowStockConfig(env)
  const baseline = baselineInventory(lowStockConfig)
  raw.db.prepare("INSERT INTO sales (id, receipt_number, total_usd, sale_status) VALUES (1, 'R-77', 12.5, 'completed')").run()
  raw.db.prepare("INSERT INTO branches (id, name) VALUES (1, 'Main Store')").run()

  await check('fixture sanity: the old list would have been a big payload (330 flagged, ties, a raised out threshold)', () => {
    assert.equal(baseline.rows, 330)
    assert.equal(baseline.outCount, 120)
    assert.equal(baseline.lowCount, 210)
  })

  let first
  await check('BEFORE any sale the stock section is absent: 330 products are under their thresholds and none is announced', async () => {
    first = await summary()
    assert.equal(first.status, 200)
    assert.equal(section(first, 'inventory'), undefined, "a standing list is the Dashboard's job, not the bell's")
  })

  // 18 healthy products sold into low (12 -> 5), 10 sold out (12 -> 0); the 330 flagged stay untouched.
  const insertSold = raw.db.prepare('INSERT INTO products (name, stock_quantity, out_of_stock_threshold, low_stock_threshold, is_active) VALUES (?, 12, 0, 10, 1)')
  for (let i = 0; i < 28; i += 1) insertSold.run(`Sold ${String(i).padStart(2, '0')}`)
  for (let i = 0; i < 18; i += 1) await sell(`Sold ${String(i).padStart(2, '0')}`, 7)
  for (let i = 18; i < 28; i += 1) await sell(`Sold ${String(i).padStart(2, '0')}`, 12)
  // A sale on a product that is ALREADY low must stay silent (the old bell showed it regardless).
  await sell('Low 005', 1)
  await sell('Low 005', 1)
  await cacheModule.bumpVersion(env, 'stock')

  await check('AFTER: the stock section lists the 28 crossings (10 shown, exact count, out first), not the 330 standing rows', async () => {
    first = await summary()
    const inventory = section(first, 'inventory')
    assert.equal(inventory.count, 28, 'count is the true size of the sale events, not the preview size, not 330')
    assert.equal(inventory.items.length, 10)
    assert.equal(inventory.truncated, true)
    assert.equal(inventory.itemsTotal, 28)
    assert.equal(inventory.summary, '10 out of stock - 18 low stock')
    assert.deepEqual(inventory.summaryParams, { outCount: 10, lowCount: 18 })
    assert.equal(inventory.summaryKey, 'notification_inventory_summary')
    assert.ok(inventory.items.every((item) => item.kind === 'inventory_out_of_stock'), 'out-of-stock rows come first (all 10 shown here)')
    assert.ok(inventory.items.every((item) => /^Sold \d\d$/.test(item.label)), 'no standing Out/Low row leaks in')
    const row = inventory.items[0]
    assert.equal(row.pageId, 'dashboard')
    assert.equal(row.anchor, 'out-of-stock')
    assert.equal(row.metaKey, 'notification_stock_out')
    assert.equal(row.saleId, 1)
    assert.equal(row.metaParams.receipt, 'R-77')
    assert.equal(row.metaParams.branch, 'Main Store')
    assert.ok(row.at, 'carries the event time for the panel to format')
    assert.equal(first.json.unreadCount, first.json.sections.reduce((total, entry) => total + entry.count, 0))
  })

  await check('rows and bytes: one statement returns 10 rows; the payload is a fraction of the old standing list', async () => {
    assert.equal(rowsOf('inventory'), 10, 'rows returned by the stock statement (the old list: 330)')
    assert.equal(statements('inventory'), 1)
    const oldItems = Array.from({ length: baseline.rows }, (_, index) => ({ id: `low-${index}`, label: `Low ${String(index).padStart(3, '0')}`, meta: 'Low stock (5)', tone: 'warning', kind: 'inventory_low_stock', pageId: 'inventory', anchor: `product-${index}` }))
    const baselineBody = JSON.stringify(oldItems)
    assert.ok(first.bytes < baselineBody.length / 3, `summary ${first.bytes} B vs the old inventory items alone ${baselineBody.length} B`)
    assert.ok(first.bytes < 8 * 1024, `summary stays under 8 KB (${first.bytes} B)`)
    console.log(`  measured: stock statement rows ${rowsOf('inventory')} (old list ${baseline.rows}); summary body ${first.bytes} B vs old inventory items alone ${baselineBody.length} B`)
  })

  await check('the public shape is otherwise unchanged: preferences carry no cache-only fields', () => {
    assert.ok(!('loyaltyPointsEnabled' in first.json.preferences))
    assert.deepEqual(Object.keys(first.json.preferences).sort(), [
      'driveSyncConnected', 'driveSyncEnabled', 'expiryDays', 'expiryEnabled', 'inventoryEnabled', 'loyaltyEnabled', 'loyaltyThreshold',
      'portalEnabled', 'realertMinutes', 'salesEnabled', 'supplierCreditDays', 'supplierCreditEnabled', 'systemEnabled',
    ])
    assert.equal(first.json.unread, first.json.unreadCount)
  })

  await check('a second call is a cache hit: zero stock, expiry and loyalty statements, identical answer', async () => {
    kvReads = 0
    const again = await summary()
    assert.ok(kvReads <= 7, `each of the six data versions is read once per request, not once per section, plus at most one low-stock memo re-confirmation (${kvReads} KV reads; 9 before the per-request memo)`)
    assert.ok(statements('versions') <= 6, 'and the D1 fallback for a never-bumped version is likewise once each')
    assert.equal(statements('inventory'), 0)
    assert.equal(statements('expiry'), 0)
    assert.equal(statements('loyalty'), 0)
    assert.deepEqual(again.json.sections, first.json.sections)
  })

  await check('a new sale event is NOT visible before its version bump (the cache is real) and IS right after it', async () => {
    raw.db.prepare("INSERT INTO products (name, stock_quantity, out_of_stock_threshold, low_stock_threshold, is_active) VALUES ('Late Sale', 11, 0, 10, 1)").run()
    await sell('Late Sale', 2)
    const stale = await summary()
    assert.equal(section(stale, 'inventory').count, 28, 'control: still the cached answer')
    await cacheModule.bumpVersion(env, 'stock') // what a sale does
    const fresh = await summary()
    assert.equal(statements('inventory'), 1, 'stock events re-ran')
    assert.equal(statements('expiry'), 0, 'a stock bump does not touch the expiry entry')
    assert.equal(section(fresh, 'inventory').count, 29)
    assert.equal(section(fresh, 'inventory').summary, '10 out of stock - 19 low stock')
  })

  await check('a restock drops the family out of the bell at its next refresh', async () => {
    raw.db.prepare("UPDATE products SET stock_quantity = 60 WHERE name = 'Late Sale'").run()
    await cacheModule.bumpVersion(env, 'stock')
    assert.equal(section(await summary(), 'inventory').count, 28)
  })

  await check("a product edit ('products' bump) re-runs stock events and expiry but not loyalty", async () => {
    await cacheModule.bumpVersion(env, 'products')
    await summary()
    assert.equal(statements('inventory'), 1)
    assert.equal(statements('expiry'), 1)
    assert.equal(statements('loyalty'), 0)
  })

  await check("a sale/return/customer edit re-runs loyalty only (a sale's own 'stock' bump is what refreshes the stock events)", async () => {
    for (const namespace of ['sales', 'returns', 'customers']) {
      await cacheModule.bumpVersion(env, namespace)
      await summary()
      assert.ok(statements('loyalty') >= 1, `${namespace} bump re-ran loyalty`)
      assert.equal(statements('inventory'), 0, `${namespace} bump left the stock events cached`)
    }
  })

  await check('a settings save re-runs every cached section', async () => {
    await cacheModule.bumpVersion(env, 'settings')
    await summary()
    assert.equal(statements('inventory'), 1)
    assert.equal(statements('expiry'), 1)
    assert.ok(statements('loyalty') >= 1)
  })

  await check('changing the low-stock config changes the answer at once -- the config is part of the cache key, no bump needed', async () => {
    raw.db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_alert_enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
    lowStock.invalidateLowStockConfigMemo() // what the Settings POST does in this isolate
    const off = await summary()
    const inventory = section(off, 'inventory')
    assert.equal(statements('inventory'), 1, 'a different config is a different cache entry')
    assert.equal(inventory.count, 10, 'alerts off: the 18 low events stop describing a family that is not "low" any more; the 10 out events remain')
    assert.equal(inventory.summary, '10 out of stock')
    raw.db.prepare("DELETE FROM settings WHERE key = 'low_stock_alert_enabled'").run()
    lowStock.invalidateLowStockConfigMemo()
    assert.equal(section(await summary(), 'inventory').count, 28, 'switching back returns the earlier numbers')
  })

  await check("users never see each other's sections through the shared cache", async () => {
    await summary(ADMIN) // warm every cached section as an administrator
    const cashier = await summary(CASHIER)
    assert.equal(section(cashier, 'inventory'), undefined, 'a cashier with neither dashboard nor inventory access gets no stock section')
    assert.equal(section(cashier, 'expiry'), undefined)
    assert.equal(section(cashier, 'loyalty'), undefined)
    const stockOnly = await summary(STOCK_ONLY)
    assert.equal(section(stockOnly, 'inventory').count, 28)
    assert.equal(section(stockOnly, 'supplier_credit'), undefined, 'supplier credit stays admin-only')
    assert.equal(section(stockOnly, 'security'), undefined)
  })

  await check('the receipt a stock row names is sales data: a stock-only user gets the row without sale id or receipt, through the same cache', async () => {
    const admin = await summary(ADMIN)
    const adminRow = section(admin, 'inventory').items[0]
    assert.equal(adminRow.metaParams.receipt, 'R-77')
    assert.equal(adminRow.saleId, 1)
    const stockOnly = await summary(STOCK_ONLY)
    const stockRow = section(stockOnly, 'inventory').items[0]
    assert.equal(stockRow.metaParams.receipt, '')
    assert.equal(stockRow.saleId, undefined)
    assert.equal(JSON.stringify(stockOnly.json).includes('R-77'), false, 'the receipt number is nowhere in a stock-only body')
    assert.equal(JSON.stringify((await summary(ADMIN)).json).includes('R-77'), true, 'and the admin variant was not poisoned by the stock-only call')
  })

  await check('the sales section follows the sales READ rule: view-only sees it, a full user with sales:view off does not', async () => {
    raw.db.prepare("INSERT INTO sales (receipt_number, total_usd, sale_status) VALUES ('R-1', 12.5, 'awaiting_payment')").run()
    const viewOnly = { id: 4, username: 'viewer', name: 'Viewer', role_code: 'staff', permissions: JSON.stringify({ sales: 'view' }) }
    const fullButHidden = { id: 5, username: 'hidden', name: 'Hidden', role_code: 'staff', permissions: JSON.stringify({ sales: true, 'sales:view': false }) }
    const full = { id: 6, username: 'full', name: 'Full', role_code: 'staff', permissions: JSON.stringify({ sales: true }) }
    assert.equal(section(await summary(ADMIN), 'sales').count, 1, 'control: an administrator sees the row')
    assert.equal(section(await summary(full), 'sales').count, 1, 'a full sales user sees it')
    assert.equal(section(await summary(viewOnly), 'sales').count, 1, 'a view-only user sees it (hasPermission would have hidden it)')
    assert.equal(section(await summary(fullButHidden), 'sales'), undefined, 'sales:view switched off hides it (hasPermission would have shown it)')
    assert.equal(JSON.stringify((await summary(fullButHidden)).json).includes('R-1'), false, 'and the receipt number is nowhere in the body')
    const awaiting = section(await summary(ADMIN), 'sales').items[0]
    assert.equal(awaiting.saleId > 0, true, 'the row names its sale so the panel can open it')
    assert.ok(awaiting.at, 'and when it was taken')
  })

  await check('GET /summary/items returns the rest of the stock events for "load more", gated like the section', async () => {
    const all = await call('GET', '/summary/items?section=inventory', ADMIN)
    assert.equal(all.status, 200)
    assert.equal(all.json.count, 28)
    assert.equal(all.json.items.length, 28, 'nothing is lost: every event is reachable')
    assert.deepEqual(all.json.items.slice(0, 10).map((item) => item.id), section(await summary(ADMIN), 'inventory').items.map((item) => item.id), 'the preview is the head of the full list')
    assert.equal((await call('GET', '/summary/items?section=inventory', CASHIER)).status, 403)
    assert.equal((await call('GET', '/summary/items?section=sales', ADMIN)).status, 404)
    const cached = await call('GET', '/summary/items?section=inventory', ADMIN)
    assert.equal(statements('inventory'), 0, 'the expanded list is cached too')
    assert.equal(cached.json.items.length, 28)
  })

  await check('a quiet shop is unchanged: under 10 events there is no preview marker and every item is present', async () => {
    raw.db.prepare('DELETE FROM stock_alert_events WHERE id > 4').run()
    await cacheModule.bumpVersion(env, 'products')
    const small = await summary()
    const inventory = section(small, 'inventory')
    assert.equal(inventory.items.length, inventory.count)
    assert.equal(inventory.truncated, undefined)
    assert.equal(inventory.itemsTotal, undefined)
  })

  await check('no Cache API (unit harness) behaves as the uncached route did: every call runs the statements', async () => {
    const saved = globalThis.caches
    delete globalThis.caches
    try {
      await summary()
      await summary()
      assert.equal(statements('inventory'), 1)
    } finally {
      globalThis.caches = saved
    }
  })

  console.log(`\n${passed} passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
