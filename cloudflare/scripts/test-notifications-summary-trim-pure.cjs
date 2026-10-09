// GET /api/notifications/summary: counts + a 50-item inventory preview, with the three expensive
// sections (inventory, expiry, loyalty) answered from the Cache API between writes.
//
// Loads the REAL routes/notifications.ts and the REAL lib/cache.ts against an in-memory SQLite
// database with every migration applied. Only Worker seams are stubbed: the session, the Cache API
// (a Map keyed by URL, like caches.default) and KV (a Map holding the cache version counters).
// The database handle counts every statement and every row it returns, so each claim is a number:
//
//   BEFORE (the removed code, restated below as BASELINE_INVENTORY_SQL and run on the same data):
//     one statement returning every flagged product, up to 5,000 rows, all serialised to the client;
//   AFTER:
//     the same single pass but 50 rows returned, an exact count from window aggregates, and on a
//     cache hit zero statements for inventory, expiry and loyalty.
//
// Each case is discriminating: the baseline comparison fails if the order, the count or the summary
// text drifts; the invalidation cases fail if a cache does not turn over on the right version bump
// (and the "not before the bump" half fails if nothing is cached at all).
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
  if (/out_of_stock_threshold/.test(sql) && /FROM products/.test(sql)) return 'inventory'
  if (/expiry_date/.test(sql) && /FROM products/.test(sql)) return 'expiry'
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
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
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
const lowStock = load('lib/lowStockSettings.ts')

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
  const low = rows.filter((row) => Number(row.stock_quantity || 0) > Number(row.out_threshold || 0))
  return {
    rows: rows.length,
    outCount: out.length,
    lowCount: low.length,
    items: [
      ...out.map((p) => ({ id: `out-${p.id}`, label: p.name, meta: 'Out of stock' })),
      ...low.map((p) => ({ id: `low-${p.id}`, label: p.name, meta: `Low stock (${Number(p.stock_quantity || 0)})` })),
    ],
  }
}
const pick = (item) => ({ id: item.id, label: item.label, meta: item.meta })

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  seedProducts()
  const config = await lowStock.loadLowStockConfig(env)
  const baseline = baselineInventory(config)

  await check('fixture sanity: the baseline really is a big payload (330 flagged, ties, a raised out threshold)', () => {
    assert.equal(baseline.rows, 330)
    assert.equal(baseline.outCount, 120)
    assert.equal(baseline.lowCount, 210)
  })

  let first
  await check('AFTER: inventory returns 50 rows, the exact count, and the baseline order/summary', async () => {
    first = await summary()
    assert.equal(first.status, 200)
    const inventory = section(first, 'inventory')
    assert.equal(inventory.count, 330, 'count is the true size, not the preview size')
    assert.equal(inventory.items.length, 50)
    assert.equal(inventory.truncated, true)
    assert.equal(inventory.itemsTotal, 330)
    assert.equal(inventory.summary, '120 out of stock - 210 low stock')
    assert.deepEqual(inventory.items.map(pick), baseline.items.slice(0, 50).map(pick), 'the first 50 are the first 50 the old route listed, in order')
    assert.equal(first.json.unreadCount, first.json.sections.reduce((total, entry) => total + entry.count, 0))
  })

  await check('rows and bytes: the inventory statement returns 50 rows instead of 330, and the payload shrinks to a fraction', async () => {
    assert.equal(rowsOf('inventory'), 50, 'rows returned by the inventory statement (baseline: 330)')
    assert.equal(statements('inventory'), 1, 'still one pass over the catalog, not one for the page plus one for the counts')
    // Baseline payload: the old route serialised every flagged item. Rebuild that body size from the same rows.
    const baselineBody = JSON.stringify(baseline.items.map((item) => ({ ...item, tone: 'x', kind: 'inventory_low_stock', pageId: 'inventory', anchor: `product-${item.id}` })))
    assert.ok(first.bytes < baselineBody.length / 3, `summary ${first.bytes} B vs baseline inventory alone ${baselineBody.length} B`)
    assert.ok(first.bytes < 20 * 1024, `summary stays under 20 KB (${first.bytes} B)`)
    console.log(`  measured: inventory statement rows ${rowsOf('inventory')} (baseline ${baseline.rows}); summary body ${first.bytes} B vs baseline inventory items alone ${baselineBody.length} B`)
  })

  await check('the public shape is otherwise unchanged: preferences carry no cache-only fields', () => {
    assert.ok(!('loyaltyPointsEnabled' in first.json.preferences))
    assert.deepEqual(Object.keys(first.json.preferences).sort(), [
      'driveSyncConnected', 'driveSyncEnabled', 'expiryDays', 'expiryEnabled', 'inventoryEnabled', 'loyaltyEnabled', 'loyaltyThreshold',
      'portalEnabled', 'realertMinutes', 'salesEnabled', 'supplierCreditDays', 'supplierCreditEnabled', 'systemEnabled',
    ])
    assert.equal(first.json.unread, first.json.unreadCount)
  })

  await check('a second call is a cache hit: zero inventory, expiry and loyalty statements, identical answer', async () => {
    kvReads = 0
    const again = await summary()
    assert.ok(kvReads <= 7, `each of the six data versions is read once per request, not once per section, plus at most one low-stock memo re-confirmation (${kvReads} KV reads; 9 before the per-request memo)`)
    assert.ok(statements('versions') <= 6, 'and the D1 fallback for a never-bumped version is likewise once each')
    assert.equal(statements('inventory'), 0)
    assert.equal(statements('expiry'), 0)
    assert.equal(statements('loyalty'), 0)
    assert.deepEqual(again.json.sections, first.json.sections)
  })

  await check('a stock change is NOT visible before its version bump (the cache is real) and IS right after it', async () => {
    raw.db.prepare("UPDATE products SET stock_quantity = 0 WHERE name = 'Healthy 0'").run()
    const stale = await summary()
    assert.equal(section(stale, 'inventory').count, 330, 'control: still the cached answer')
    await cacheModule.bumpVersion(env, 'stock') // what a sale does
    const fresh = await summary()
    assert.equal(statements('inventory'), 1, 'inventory re-ran')
    assert.equal(statements('expiry'), 0, 'a stock bump does not touch the expiry entry')
    assert.equal(section(fresh, 'inventory').count, 331)
    assert.equal(section(fresh, 'inventory').summary, '121 out of stock - 210 low stock')
  })

  await check("a product edit ('products' bump) re-runs inventory and expiry but not loyalty", async () => {
    await cacheModule.bumpVersion(env, 'products')
    await summary()
    assert.equal(statements('inventory'), 1)
    assert.equal(statements('expiry'), 1)
    assert.equal(statements('loyalty'), 0)
  })

  await check("a sale/return/customer edit re-runs loyalty only (and does not touch inventory)", async () => {
    for (const namespace of ['sales', 'returns', 'customers']) {
      await cacheModule.bumpVersion(env, namespace)
      await summary()
      assert.ok(statements('loyalty') >= 1, `${namespace} bump re-ran loyalty`)
      assert.equal(statements('inventory'), 0, `${namespace} bump left inventory cached`)
    }
  })

  await check("a settings save re-runs every cached section", async () => {
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
    assert.equal(inventory.count, 121 + 0, 'alerts off: only out-of-stock rows remain (the OR keeps them)')
    assert.equal(inventory.summary, '121 out of stock')
    raw.db.prepare("DELETE FROM settings WHERE key = 'low_stock_alert_enabled'").run()
    lowStock.invalidateLowStockConfigMemo()
    assert.equal(section(await summary(), 'inventory').count, 331, 'switching back returns the earlier numbers')
  })

  await check('users never see each other\'s sections through the shared cache', async () => {
    await summary(ADMIN) // warm every cached section as an administrator
    const cashier = await summary(CASHIER)
    assert.equal(section(cashier, 'inventory'), undefined, 'a cashier without inventory access gets no inventory section')
    assert.equal(section(cashier, 'expiry'), undefined)
    assert.equal(section(cashier, 'loyalty'), undefined)
    const stockOnly = await summary(STOCK_ONLY)
    assert.equal(section(stockOnly, 'inventory').count, 331)
    assert.equal(section(stockOnly, 'supplier_credit'), undefined, 'supplier credit stays admin-only')
    assert.equal(section(stockOnly, 'security'), undefined)
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
    assert.equal(JSON.stringify(await summary(fullButHidden)).includes('R-1'), false, 'and the receipt number is nowhere in the body')
  })

  await check('GET /summary/items returns the whole inventory list for "show all", gated like the section', async () => {
    const all = await call('GET', '/summary/items?section=inventory', ADMIN)
    assert.equal(all.status, 200)
    assert.equal(all.json.count, 331)
    assert.equal(all.json.items.length, 331, 'nothing is lost: every flagged product is reachable')
    const baselineNow = baselineInventory(await lowStock.loadLowStockConfig(env))
    assert.deepEqual(all.json.items.map((item) => item.id), baselineNow.items.map((item) => item.id), 'same order as the old full list')
    assert.equal((await call('GET', '/summary/items?section=inventory', CASHIER)).status, 403)
    assert.equal((await call('GET', '/summary/items?section=sales', ADMIN)).status, 404)
    const cached = await call('GET', '/summary/items?section=inventory', ADMIN)
    assert.equal(statements('inventory'), 0, 'the expanded list is cached too')
    assert.equal(cached.json.items.length, 331)
  })

  await check('a small shop is unchanged: under 50 flagged products there is no preview marker and every item is present', async () => {
    raw.db.prepare("UPDATE products SET stock_quantity = 500 WHERE is_active=1 AND name NOT IN ('Out 000', 'Low 000', 'Low 001')").run()
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

  const failures = []
  const loyaltyCheck = async (name, fn) => {
    try { await check(name, fn) } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`) }
  }
  const setting = (key, value) => raw.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value))
  const resetLoyaltyCache = () => cacheModule.bumpVersion(env, 'customers')
  const loyalty = async (user = ADMIN) => section(await summary(user), 'loyalty')
  const pointsOf = (value, id) => Number(value?.items.find(item => item.id === `loyalty-${id}`)?.meta.split(' ')[0])
  setting('loyalty_points_enabled', 'true')
  setting('notifications_loyalty_threshold', 100)
  await cacheModule.bumpVersion(env, 'settings')
  for (let id = 5101; id <= 5107; id += 1) raw.db.prepare('INSERT INTO customers(id,name) VALUES (?,?)').run(id, `Loyalty customer ${id}`)
  raw.db.exec(`
    INSERT INTO loyalty_point_adjustments(customer_id,points) VALUES (5101,125),(5102,900);
    UPDATE loyalty_point_adjustments SET voided_at='2026-01-01' WHERE customer_id=5102;
    INSERT INTO customer_share_submissions(id,customer_id,status,reward_points,reward_points_voided_at)
      VALUES (5103,5103,'approved',150,NULL),(5104,5104,'pending',1000,NULL),(5105,5105,'approved',1000,'2026-01-01');
  `)
  await resetLoyaltyCache()
  await loyaltyCheck('loyalty includes manual and reward-only customers without a sale, excluding voided and pending awards', async () => {
    const value = await loyalty()
    assert.equal(value?.count, 2)
    assert.equal(pointsOf(value, 5101), 125)
    assert.equal(pointsOf(value, 5103), 150)
    assert.ok(!value.items.some(item => ['loyalty-5102', 'loyalty-5104', 'loyalty-5105'].includes(item.id)))
  })

  raw.db.exec(`
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
    INSERT INTO customer_share_submissions(customer_id,status,reward_points) VALUES (5106,'approved',5);
  `)
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
  raw.db.prepare("DELETE FROM settings WHERE key='customer_portal_points_per_khr'").run()
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
      raw.db.prepare('INSERT INTO customers(id,name) VALUES (?,?)').run(id, `Preview ${id}`)
      raw.db.prepare('INSERT INTO loyalty_point_adjustments(customer_id,points) VALUES (?,?)').run(id, 1000 + id)
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
