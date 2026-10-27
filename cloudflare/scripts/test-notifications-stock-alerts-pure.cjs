'use strict'
// The bell's inventory section is the stock alerts sales recorded, not a standing list.
//
// Owner ruling, 6 Oct 2026: low / out-of-stock notifications fire only when a SALE pushes a product across the
// threshold (no static list; a manual Remove / Set and a transfer are silent), and every notification is compact and
// deep-linked to its real location. Until 27 Oct the bell listed every low and out-of-stock product on every refresh
// (about 18k rows read per recompute, and unreadCount 4,648 in production). Since migration 0272 each crossing is a
// row in stock_crossing_alerts, written by lib/stockCrossingAlert.ts recordStockCrossings after the sale commits.
//
// Runs the REAL routes/notifications.ts and the REAL lib/stockCrossingAlert.ts against an in-memory SQLite database
// with every migration applied. Seams: the session, the Telegram transport (a recorder) and the broadcast hub.
//
//   one alert     a sale that crosses low creates exactly one bell item, with a stable id, the product's name, the
//                 deep link (inventory page, product anchor) and the copy keys the panel already has
//   silent        a manual Remove / Set and a transfer create none (their writes never call the recorder, asserted over
//                 the whole source tree); a product that is simply low or empty is not listed
//   unread        the panel marks items seen by id (its per-item state), so ids are stable across polls; only the last
//                 24 hours are listed, newest first, at most 50, and the section counts exactly what it lists
//   gates         the Settings switch, the inventory permission and a database without 0272 behave
//   cost          the statement seeks idx_stock_crossing_alerts_recent (no table scan) and returns at most 50 rows
//
// Run (from cloudflare/): node scripts/test-notifications-stock-alerts-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const SRC = path.join(__dirname, '..', 'src')
const raw = openDb(loadAll())
raw.db.limits.exprDepth = 100
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return {
      all: async (params) => stmt.all(params) ?? [],
      get: async (params) => stmt.get(params) ?? null,
      run: async (params) => { const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => raw.batch(items),
}

let currentUser = null
const sent = []
const overrides = {
  '../lib/db': { getDb: () => db },
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() }, prefetchWithSession: () => {}, takePrefetched: () => undefined },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  './telegram': { sendTelegramEvent: async (_env, event) => { sent.push(event); return true } },
}
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path.join(SRC, rel),
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
const notifications = load('routes/notifications.ts')
const alert = load('lib/stockCrossingAlert.ts')
const app = notifications.default
const env = { DB: raw, PLAN_TIER: 'paid', CACHE: { async get() { return null }, async put() {}, async delete() {} } }
const executionCtx = { waitUntil() {}, passThroughOnException() {} }

const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}' }
const CASHIER = { id: 2, username: 'cashier', name: 'Cashier', role_code: 'staff', permissions: JSON.stringify({ sales: true }) }
const STOCK_ONLY = { id: 3, username: 'stock', name: 'Stock', role_code: 'staff', permissions: JSON.stringify({ inventory: true }) }
async function summary(user = ADMIN) {
  currentUser = user
  const res = await app.request('http://local/summary', { method: 'GET' }, env, executionCtx)
  return { status: res.status, json: await res.json() }
}
const section = (body) => (body.json.sections || []).find((entry) => entry.id === 'inventory')

// ---- fixtures: products with branch stock, and the three ways stock moves --------------------------------------
seedStockFixture(raw.db, () => raw.db.prepare("INSERT OR IGNORE INTO branches (id, name, is_default, is_active) VALUES (1, 'LC Store', 1, 1)").run())
function product(name, stock, low = 10, out = 0) {
  return seedStockFixture(raw.db, () => {
    const id = Number(raw.db.prepare('INSERT INTO products (name, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active) VALUES (?, ?, ?, ?, 1)').run(name, stock, low, out).lastInsertRowid)
    raw.db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, ?)').run(id, stock)
    return id
  })
}
function movement(productId, type, quantity) {
  seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity) VALUES (?, ?, 1, ?, ?)').run(productId, 'x', type, quantity))
}
// A sale: the deduction commits, then the recorder runs (exactly the order in routes/sales.ts).
async function sell(saleId, productId, quantity) {
  seedStockFixture(raw.db, () => raw.db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = 1').run(quantity, productId))
  movement(productId, 'sale', -quantity)
  return alert.recordStockCrossings(env, { saleId, lines: [{ productId, branchId: 1, quantity }] })
}
// What the Inventory page's Remove / Set and a branch transfer do to stock: the quantity moves, no recorder runs.
function manualStockChange(productId, to, type) {
  seedStockFixture(raw.db, () => raw.db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = 1').run(to, productId))
  movement(productId, type, to)
}
const setting = (key, value) => seedStockFixture(raw.db, () => raw.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)))
const alertRows = () => raw.db.prepare('SELECT id, product_id, tier, created_at FROM stock_crossing_alerts ORDER BY id').all()

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

let baseline = 0
async function main() {
  // 330 low and out-of-stock products that no sale pushed anywhere: the old bell listed all of them
  for (let i = 0; i < 120; i += 1) product(`Empty ${i}`, 0)
  for (let i = 0; i < 210; i += 1) product(`Short ${i}`, 4)
  const a = product('Serum A', 12)
  const b = product('Cream B', 5, 10, 2)
  const c = product('Balm C', 30)

  await check('nothing was sold across a threshold: no inventory section, however many products are low or empty', async () => {
    const body = await summary()
    assert.equal(body.status, 200)
    assert.equal(section(body), undefined)
    // the one standing system notice (Drive not connected) is the only thing counted
    assert.deepEqual(body.json.sections.map((entry) => entry.id), ['system'])
    baseline = body.json.unreadCount
  })

  let lowId
  await check('a sale that crosses low creates exactly one bell item: stable id, name, deep link, existing copy keys', async () => {
    assert.deepEqual(await sell(101, a, 3), { crossings: 1, claimed: 1, sent: 1 }) // 12 -> 9
    const body = await summary()
    const inventory = section(body)
    assert.equal(inventory.items.length, 1)
    assert.equal(inventory.count, 1)
    const [item] = inventory.items
    lowId = item.id
    assert.equal(item.id, `crossing-${alertRows()[0].id}`)
    assert.equal(item.label, 'Serum A')
    assert.equal(item.tone, 'warning')
    assert.equal(item.kind, 'inventory_low_stock')
    assert.equal(item.meta, 'Low stock (9)')
    assert.equal(item.metaKey, 'notification_inventory_low_stock')
    assert.deepEqual(item.metaParams, { quantity: 9 })
    assert.equal(item.pageId, 'inventory')
    assert.equal(item.anchor, `product-${a}`)
    assert.equal(inventory.summary, '1 low stock')
    assert.equal(inventory.summaryKey, 'notification_inventory_summary')
    assert.deepEqual(inventory.summaryParams, { outCount: 0, lowCount: 1 })
    assert.equal(inventory.enabledKey, 'notifications_inventory_enabled')
    assert.equal(inventory.truncated, undefined)
    assert.equal(body.json.unreadCount, baseline + 1, 'unread counts the one crossing and nothing about the 330 low products')
    assert.equal(body.json.inventory_computed_at, undefined, 'no cached figure any more')
  })

  await check('the same sale replayed, and a sale that stays above the threshold, add nothing; ids are stable across polls', async () => {
    assert.deepEqual(await alert.recordStockCrossings(env, { saleId: 101, lines: [{ productId: a, branchId: 1, quantity: 3 }] }), { crossings: 1, claimed: 0, sent: 0 })
    await sell(102, c, 2) // 30 -> 28, nowhere near
    const first = await summary()
    const second = await summary()
    assert.deepEqual(section(first).items.map((item) => item.id), [lowId])
    assert.deepEqual(section(second).items.map((item) => item.id), [lowId], 'the panel keys seen / realert state by this id')
  })

  await check('a sale that crosses out of stock is a second item, newest first, with the existing out-of-stock copy', async () => {
    await sell(103, b, 4) // 5 -> 1: below the product's own out threshold 2 -> out
    const inventory = section(await summary())
    assert.equal(inventory.items.length, 2)
    const [first, second] = inventory.items
    assert.equal(first.label, 'Cream B')
    assert.equal(first.tone, 'danger')
    assert.equal(first.meta, 'Out of stock')
    assert.equal(first.metaKey, 'notification_inventory_out_of_stock')
    assert.equal(first.kind, 'inventory_out_of_stock')
    assert.equal(first.anchor, `product-${b}`)
    assert.equal(second.id, lowId)
    assert.equal(inventory.summary, '1 out of stock - 1 low stock')
    assert.deepEqual(inventory.summaryParams, { outCount: 1, lowCount: 1 })
  })

  await check('a manual Remove, a Set and a transfer create no item, even down to zero', async () => {
    const before = alertRows().length
    const ids = (await summary()).json.sections.find((entry) => entry.id === 'inventory').items.map((item) => item.id)
    manualStockChange(c, 0, 'remove') // Remove to empty
    manualStockChange(c, 3, 'set')
    manualStockChange(c, 0, 'transfer_out')
    const after = section(await summary())
    assert.equal(alertRows().length, before)
    assert.deepEqual(after.items.map((item) => item.id), ids)
    assert.ok(!after.items.some((item) => item.label === 'Balm C'))
  })

  await check('wiring: only the sale paths record crossings -- no Remove, Set, adjust, receive or transfer writer calls the recorder', async () => {
    const callers = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file)
        else if (/\.ts$/.test(entry.name) && /recordStockCrossings\(/.test(fs.readFileSync(file, 'utf8')) && entry.name !== 'stockCrossingAlert.ts') callers.push(path.relative(SRC, file).replace(/\\/g, '/'))
      }
    }
    walk(SRC)
    assert.deepEqual(callers.sort(), ['lib/returnExchangeCreate.ts', 'routes/returns.ts', 'routes/sales.ts'])
  })

  await check('a restock and a second crossing is a new item with its own id', async () => {
    seedStockFixture(raw.db, () => raw.db.prepare('UPDATE branch_stock SET quantity = 40 WHERE product_id = ? AND branch_id = 1').run(a))
    movement(a, 'add', 31)
    await sell(104, a, 32) // 40 -> 8
    const inventory = section(await summary())
    assert.equal(inventory.items.filter((item) => item.label === 'Serum A').length, 2)
    assert.equal(new Set(inventory.items.map((item) => item.id)).size, inventory.items.length)
  })

  await check('only recent crossings are listed or counted: one from two days ago is gone, the count is exactly what is listed', async () => {
    const listed = section(await summary()).count
    seedStockFixture(raw.db, () => raw.db.prepare(`INSERT INTO stock_crossing_alerts (alert_key, product_id, branch_id, tier, sale_id, quantity_before, quantity_after, created_at)
      VALUES ('old-1', ?, 1, 'low', 1, 12, 9, ?)`).run(c, new Date(Date.now() - 48 * 3600_000).toISOString()))
    const body = await summary()
    assert.equal(section(body).count, listed)
    assert.ok(!section(body).items.some((item) => item.label === 'Balm C'))
    assert.equal(body.json.unreadCount, body.json.sections.reduce((total, entry) => total + entry.count, 0))
  })

  await check('at most 50 are listed, newest first', async () => {
    const insert = raw.db.prepare(`INSERT INTO stock_crossing_alerts (alert_key, product_id, branch_id, tier, sale_id, quantity_before, quantity_after, created_at)
      VALUES (?, ?, 1, 'low', ?, 12, 9, ?)`)
    seedStockFixture(raw.db, () => {
      for (let i = 0; i < 70; i += 1) insert.run(`bulk-${i}`, c, 1000 + i, new Date(Date.now() - (70 - i) * 1000).toISOString())
    })
    const inventory = section(await summary())
    assert.equal(inventory.items.length, 50)
    assert.equal(inventory.count, 50)
    const ids = inventory.items.map((item) => Number(item.id.replace('crossing-', '')))
    const stamps = ids.map((id) => raw.db.prepare('SELECT created_at FROM stock_crossing_alerts WHERE id = ?').get(id).created_at)
    assert.deepEqual(stamps, [...stamps].sort().reverse(), 'newest first')
  })

  await check('the Settings switch and the inventory permission gate the section', async () => {
    assert.ok(section(await summary(STOCK_ONLY)), 'an inventory user sees it')
    assert.equal(section(await summary(CASHIER)), undefined, 'a cashier without inventory access does not')
    setting('notifications_inventory_enabled', 'false')
    const off = await summary()
    assert.equal(section(off), undefined)
    assert.equal(off.json.preferences.inventoryEnabled, false)
    setting('notifications_inventory_enabled', 'true')
    assert.ok(section(await summary()))
  })

  await check('cost: one seek on idx_stock_crossing_alerts_recent, no scan, at most 50 rows back', async () => {
    const plan = raw.db.prepare(`EXPLAIN QUERY PLAN ${notifications.STOCK_ALERTS_SQL}`).all({ since: new Date(Date.now() - 86400000).toISOString(), limit: 50 }).map((row) => row.detail)
    assert.ok(plan.some((detail) => /idx_stock_crossing_alerts_recent/.test(detail)), plan.join(' | '))
    assert.ok(!plan.some((detail) => /^SCAN a\b/.test(detail) && !/idx_stock_crossing_alerts_recent/.test(detail)), plan.join(' | '))
    assert.ok(!plan.some((detail) => /USE TEMP B-TREE FOR ORDER BY/.test(detail)), 'the index order is the order: no sort')
    raw.db.exec('ANALYZE')
    const analyzed = raw.db.prepare(`EXPLAIN QUERY PLAN ${notifications.STOCK_ALERTS_SQL}`).all({ since: new Date(Date.now() - 86400000).toISOString(), limit: 50 }).map((row) => row.detail)
    assert.ok(analyzed.some((detail) => /idx_stock_crossing_alerts_recent/.test(detail)), analyzed.join(' | '))
    assert.ok(raw.db.prepare(notifications.STOCK_ALERTS_SQL).all({ since: new Date(Date.now() - 86400000).toISOString(), limit: 50 }).length <= 50)
  })

  await check('deploy order: a database without migration 0272 gets no section and no error', async () => {
    alert.__resetStockCrossingProbeForTests()
    raw.db.exec('DROP TABLE stock_crossing_alerts')
    const body = await summary()
    assert.equal(body.status, 200)
    assert.equal(section(body), undefined)
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
