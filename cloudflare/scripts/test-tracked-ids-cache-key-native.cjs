#!/usr/bin/env node
'use strict'
// S1, audit #3, REVERSED. 6.0.2314 dropped `stock` from this cache key; the lead ruled under the Core Rule that a zero saving cannot justify an inexact list, so 6.0.2314 was
// reverted by a forward commit. GET /api/batches/tracked-product-ids is cached on the versions of `products`, `stock` and `inventory`.
// The answer is a pure function of (branch, which lots hold quantity > 0). A sale that empties a lot, a cancel or undo that refills one, and a quantity-only Set with the narrow
// switch on move ONLY `stock`. No shipped screen reads the list today (TransferModal single mode is unreachable, the POS stopped in 6.0.1639), so keeping `stock` in the key
// costs nothing and the list stays exact.
//
// This test enumerates every kind of write that can change the answer and asks, per kind, whether the route answers from its cache exactly what a fresh compute answers:
//   * the real key: NO writer may come back late, including the five that take a lot across zero with a stock-only bump;
//   * a mutant key that drops `stock` must leave EXACTLY those five zero-crossing writers late (so the test tells the right key from the wrong one);
//   * mutants that drop `products`, the branch, or every version turn it red too.
// It runs the REAL route against the migrated schema with a version-keyed fake cache, drives the real writers that exist in the harness (POST /api/inventory/adjust and PATCH
// /api/batches/:id/branches/:branchId, switch off and on), emulates the others with the exact versions their call sites bump, and pins those call sites with a source scan.
// Run: node scripts/test-tracked-ids-cache-key-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const SRC = path.join(__dirname, '..', 'src')
const TTL_SECONDS = 300

// ---- the version-keyed fake cache, parameterised by the key rule so a mutant can plant a bad one ----------------------------------------------------------------------------------------------------
const versions = {}
let store = new Map()
let bumps = []
let requestedNamespaces = null
let seenTtl = null
let keyRule = (url, tokens) => `${url}#${tokens.join('|')}` // the real rule: the whole url and every version the route asked for
const bump = async (_env, namespace) => { bumps.push(namespace); versions[namespace] = (versions[namespace] || 0) + 1 }
const cacheOverride = {
  cachedJsonResponse: async (request, _ctx, version, ttl, producer) => {
    seenTtl = ttl
    const key = keyRule(request.url, String(version).split('|'))
    if (store.has(key)) return JSON.parse(store.get(key))
    const value = await producer()
    store.set(key, JSON.stringify(value))
    return value
  },
  getVersion: async () => '0',
  getVersionWithFallback: async (_env, namespace) => String(versions[namespace] || 0),
  getVersionsWithFallback: async (_env, list) => { requestedNamespaces = [...list]; return list.map((namespace) => String(versions[namespace] || 0)) },
  bumpVersion: bump,
  bumpVersions: async (env, list) => { for (const namespace of list) await bump(env, namespace) },
  cacheIdentity: () => undefined,
  isUnsafeVersion: () => false,
  deploymentId: () => 'dev',
}
const h = createProductsRouteHarness({ overrides: { '../lib/cache': cacheOverride } })
h.setUser({ id: 1, username: 'tester', name: 'Test User', role_code: 'admin', role_id: 1, permissions: '{}', organization_id: null, is_active: 1 })
const inventory = h.load('routes/inventory.ts').default
const batches = h.load('routes/batches.ts').default
const { resetReadSwitchMemo } = h.load('lib/readSwitches.ts')
const { RETURN_WRITE_CACHE_NAMESPACES } = h.load('lib/returnCacheVersions.ts')
const ctx = { waitUntil: (promise) => { promise?.catch?.(() => {}) }, passThroughOnException: () => {} }
const send = async (app, method, url, body) => {
  const pending = []
  const response = await app.request(`http://local${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: h.raw }, { ...ctx, waitUntil: (promise) => pending.push(promise) })
  await Promise.allSettled(pending)
  return { status: response.status, json: await response.json().catch(() => null) }
}
const permit = (sql) => h.raw.db.exec(`INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'; ${sql}; DELETE FROM system_flags WHERE key='stock_transaction_permit';`)
const setSwitch = (state) => {
  h.raw.db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  if (state) h.raw.db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-09T00:00:00.000Z', set_by: 1, switches: { stock_bump_narrow: state } }))
  resetReadSwitchMemo()
}
const tracked = async (branch) => (await send(batches, 'GET', `/tracked-product-ids?branchId=${branch}`)).json.productIds.slice().sort((a, b) => a - b)
const BRANCHES = [1, 2]
const answers = async () => { const out = {}; for (const branch of BRANCHES) out[branch] = await tracked(branch); return out }

// The world: branch 1 holds lots A (product 1, qty 7), B (product 2, qty 4), C (product 3, active but EMPTY); branch 2 holds A at 3. D (product 4) has an inactive empty lot.
const resetWorld = () => {
  permit(`DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM stock_lot_adjustment_operations; DELETE FROM stock_mutation_receipts; UPDATE products SET stock_quantity = 0; DELETE FROM products;
    INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1);
    INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(2,'Store',0,1);
    INSERT INTO products(id,name,brand,barcode,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum','Alpha','8851000000011',1,10,2,5),(2,'Toner','Beta','8851000000028',1,4,2,5),(3,'Cream','Alpha','8851000000035',1,0,2,5),(4,'Mask','Beta','8851000000042',1,0,2,5);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,7),(1,2,3),(2,1,4),(3,1,0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(10,1,'A','A','2026-09-02',1,3,1),(20,2,'B','B','2026-09-02',1,3,1),(30,3,'C','C','2026-09-02',1,3,1),(40,4,'D','D','2026-09-02',1,3,0);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,7),(10,2,3),(20,1,4),(30,1,0),(40,1,0)`)
  store = new Map()
  for (const key of Object.keys(versions)) delete versions[key]
}
// The writers. `run` changes the rows (and bumps what the real call site bumps); `declared` marks the zero-crossing stock-only writers: the ones a key without `stock` would serve late.
const SALE_BUMPS = ['stock', 'sales'] // routes/sales.ts bumpVersions(c.env, ['stock', 'sales']) at every sale write; lib/saleBulkStatus.ts ['sales', 'stock']
const writers = [
  { name: 'sale leaves the lot above zero (7 -> 5)', bumps: SALE_BUMPS, run: async () => { permit('UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10 AND branch_id=1'); await cacheOverride.bumpVersions(null, SALE_BUMPS) } },
  { name: 'sale empties lot A at branch 1 (7 -> 0)', declared: true, run: async () => { permit('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=10 AND branch_id=1'); await cacheOverride.bumpVersions(null, SALE_BUMPS) } },
  { name: 'sale cancelled / undone: the empty lot C refills (0 -> 3)', declared: true, run: async () => { permit('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=30 AND branch_id=1'); await cacheOverride.bumpVersions(null, ['stock', 'sales']) } },
  { name: 'return restocks the emptied lot C (0 -> 3): RETURN_WRITE_CACHE_NAMESPACES', run: async () => { permit('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=30 AND branch_id=1'); await cacheOverride.bumpVersions(null, RETURN_WRITE_CACHE_NAMESPACES) } },
  { name: 'stock received into a new lot (batches.ts bumps products)', run: async () => { permit("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(50,4,'E','E','2026-10-01',2,3,1); INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(50,1,6)"); await cacheOverride.bumpVersion(null, 'products') } },
  { name: 'transfer moves lot A out of branch 1 and into branch 2 (transferOperation.ts bumps products)', run: async () => { permit('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=10 AND branch_id=1; UPDATE branch_batch_stock SET quantity=10 WHERE batch_id=10 AND branch_id=2'); await cacheOverride.bumpVersion(null, 'products') } },
  { name: 'reset-data / factory reset (system.ts bumps products + inventory)', run: async () => { permit('DELETE FROM branch_batch_stock WHERE batch_id IN (10,20)'); await cacheOverride.bumpVersions(null, ['products', 'inventory']) } },
  { name: 'real POST /api/inventory/adjust Set lot A 7 -> 0, narrow switch OFF', switchState: 'off', run: () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 10, quantity: 0, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'ck-off-0000001' }) },
  { name: 'real POST /api/inventory/adjust Set lot A 7 -> 0, narrow switch ON (stock only)', switchState: 'on', declared: true, run: () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 10, quantity: 0, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'ck-on-00000001' }) },
  { name: 'real POST /api/inventory/adjust Set empty lot C 0 -> 5 (a row exists), narrow switch ON (stock only)', switchState: 'on', declared: true, run: () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 3, branchId: 1, batchId: 30, quantity: 5, expectedLotQuantity: 0, reason: 'Physical count', client_request_id: 'ck-on-00000002' }) },
  { name: 'real PATCH /api/batches/20/branches/1 Set lot B 4 -> 0, narrow switch OFF', switchState: 'off', run: () => send(batches, 'PATCH', '/20/branches/1', { quantity: 0, expectedLotQuantity: 4, reason: 'Physical count', client_request_id: 'ck-patch-off-1' }) },
  { name: 'real PATCH /api/batches/20/branches/1 Set lot B 4 -> 0, narrow switch ON (stock only)', switchState: 'on', declared: true, run: () => send(batches, 'PATCH', '/20/branches/1', { quantity: 0, expectedLotQuantity: 4, reason: 'Physical count', client_request_id: 'ck-patch-on-01' }) },
]

// Runs every writer against a given key rule. Returns one row per writer: did the answer change, did the cache serve the previous list, which versions moved.
// The truth is always read through the real key on an empty cache: a mutant's wrong key must not be able to corrupt the thing it is judged against.
const REAL_KEY = (url, tokens) => `${url}#${tokens.join('|')}`
const truth = async (rule) => { keyRule = REAL_KEY; store = new Map(); const out = await answers(); keyRule = rule; store = new Map(); return out }
async function enumerate(rule) {
  keyRule = rule
  const rows = []
  for (const writer of writers) {
    resetWorld()
    setSwitch(writer.switchState)
    const before = await truth(rule)
    await answers() // warms every branch's entry at the starting versions, under the key being judged
    bumps = []
    const done = (await writer.run()) ?? { status: 200 } // an emulated writer returns nothing
    assert.equal(done.status, 200, `${writer.name}: the writer is applied: ${JSON.stringify(done.json)}`)
    const moved = [...new Set(bumps)]
    const cached = await answers() // what the route answers now, from its cache wherever the key still matches
    const fresh = await truth(rule) // what the database says now (this drops the entries: the writer's effect has been captured in `cached`)
    const changed = JSON.stringify(before) !== JSON.stringify(fresh)
    rows.push({ name: writer.name, declared: !!writer.declared, moved, changed, late: JSON.stringify(cached) !== JSON.stringify(fresh) })
  }
  return rows
}

function bumpCallSites(filter) {
  const found = []
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (full.endsWith('.ts')) scan(full) } }
  const scan = (file) => {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/bumpVersions?\(\s*[\w.]+\s*,\s*(\[[^\]]*\]|'[^']*')/g)) if (filter(match[1])) found.push(`${path.relative(SRC, file).replace(/\\/g, '/')}: ${match[1].replace(/\s+/g, ' ')}`)
  }
  walk(SRC)
  return found.sort()
}
function staticCallSiteScan() {
  // Every bumpVersion(s) call in src that moves `stock` with a literal list and neither `products` nor `inventory`: the complete literal stock-only writer set.
  const found = []
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (full.endsWith('.ts')) scan(full) } }
  const scan = (file) => {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/bumpVersions?\(\s*[\w.]+\s*,\s*(\[[^\]]*\]|'[^']*')/g)) {
      const list = match[1]
      if (/'stock'/.test(list) && !/'products'|'inventory'/.test(list)) found.push(`${path.relative(SRC, file).replace(/\\/g, '/')}: ${list.replace(/\s+/g, ' ')}`)
    }
  }
  walk(SRC)
  return found.sort()
}

async function main() {
  // 0. the route's key, as written
  const source = fs.readFileSync(path.join(SRC, 'routes', 'batches.ts'), 'utf8')
  const route = source.slice(source.indexOf("app.get('/tracked-product-ids'"), source.indexOf("app.get('/damaged-lots'"))
  assert.match(route, /const namespaces = \['products', 'stock', 'inventory'\]/, 'the key is exactly products + stock + inventory')
  assert.match(route, /, 300, \(\) => getTrackedProductIds\(db, branchId\)/, 'the entry lives 300 s: the backstop for a write that announces nothing')

  // 1. the real key, over every writer: no writer comes back late
  const real = await enumerate((url, tokens) => `${url}#${tokens.join('|')}`)
  assert.deepEqual(requestedNamespaces, ['products', 'stock', 'inventory'], 'the route asked the cache for exactly these three versions')
  assert.equal(seenTtl, TTL_SECONDS, 'and cached for 300 s')
  assert.deepEqual(real.filter((row) => row.late).map((row) => row.name), [], 'no writer leaves the cached answer different from a fresh one')
  const crossing = real.filter((row) => row.declared)
  assert.equal(crossing.length, 5, 'five writers take a lot across zero with a stock-only bump')
  for (const row of crossing) {
    assert.ok(row.changed, `${row.name}: its answer really changes (so the cache must recompute it)`)
    assert.ok(row.moved.length > 0 && row.moved.every((n) => ['stock', 'sales'].includes(n)), `${row.name}: it moves only stock/sales (${row.moved})`)
  }
  console.log(`PASS real key: ${real.length} writers, none late; ${crossing.length} zero-crossing stock-only writers all recompute`)

  // 2. the complete literal stock-only writer set, pinned by a scan of every bump call site
  const stockOnly = staticCallSiteScan()
  assert.deepEqual(stockOnly, [
    "lib/saleBulkStatus.ts: ['sales', 'stock']",
    "routes/sales.ts: ['stock', 'sales']",
    "routes/sales.ts: ['stock', 'sales']",
    "routes/sales.ts: ['stock', 'sales']",
    "routes/sales.ts: ['stock', 'sales']",
  ], 'a new literal stock-only bump must be reviewed against this list (its answer-changing writes depend on stock being in the key); dynamic lists (undo, the narrow Set) are covered by the rows above')
  // `inventory` is only ever bumped together with `products` (system reset), so a key that dropped it would be observationally equal today: the one equivalent mutant, shown by this scan, not by a row.
  const inventorySites = bumpCallSites((list) => /'inventory'/.test(list))
  assert.ok(inventorySites.length >= 1 && inventorySites.every((site) => /'products'/.test(site)), `every bump of 'inventory' also bumps 'products': ${inventorySites}`)
  console.log(`PASS call-site scan: ${stockOnly.length} literal stock-only bump sites, all sale writes; ${inventorySites.length} 'inventory' bump sites, every one with 'products'`)

  // 3. mutants: a key that drops a component that matters must be caught
  const mutants = [
    ['key drops `products`', (url, tokens) => `${url}#${tokens.filter((t, i) => i !== 0).join('|')}`, (rows) => rows.some((row) => row.late && !row.declared)],
    ['key drops the branch', (url, tokens) => `${url.replace(/\?.*$/, '')}#${tokens.join('|')}`, (rows) => rows.some((row) => row.late && !row.declared) ],
    ['key drops both versions (url only)', (url) => url, (rows) => rows.some((row) => row.late && !row.declared)],
  ]
  for (const [name, rule, red] of mutants) {
    const rows = await enumerate(rule)
    assert.ok(red(rows), `mutant "${name}" survived: no undeclared late answer appeared`)
  }
  // The mutant that matters: a key that drops `stock` leaves EXACTLY the five zero-crossing stock-only writers late, no more and no fewer.
  const droppedStock = await enumerate((url, tokens) => `${url}#${tokens.filter((token) => !token.startsWith('stock:')).join('|')}`)
  assert.deepEqual(droppedStock.filter((row) => row.late).map((row) => row.name), crossing.map((row) => row.name), 'a key without stock serves exactly the five zero-crossing writers late')
  console.log(`PASS mutants: ${mutants.length} keys that drop a component that matters turn the enumeration red; the key without stock leaves exactly ${crossing.length} zero-crossing writers late`)
}
main().catch((error) => { console.error(error); process.exit(1) })
