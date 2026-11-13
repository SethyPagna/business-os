'use strict'
// W3 Slice A round 2 (review F1 + F3 for Undo/Redo). The REAL History routes (POST /api/action-history/:id/undo and /redo) over the real
// undoAppliers registry and a fully migrated SQLite, with a SLOW fake cache and a broadcast recorder. Required, for every server applier:
//   1. ORDER   -- no broadcast is observable before the bump has finished, and the bump finished before the response resolved;
//   2. ONE     -- exactly one bumpVersions/bumpVersion call per undo or redo (one quota upsert on Free), carrying every namespace.
// supplier.backfill broadcasts from INSIDE the applier before the route's bump (F1); product.conflict_mark bumps 'products' inside the applier
// and then the route bumped 'stock' again (F3). The source checks pin the rest: no applier broadcasts or bumps directly any more, and the
// route's per-kind namespace list equals what each bump helper in lib/ passes to the cache module.
// Run (from cloudflare/): node scripts/test-undo-redo-one-bump-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const SRC = path.join(__dirname, '../src')
const BUMP_MS = 60
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function inert() { return new Proxy(function () {}, { get: () => inert(), apply: () => undefined }) }
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (request) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : require(request)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(req, mod, mod.exports, full, path.dirname(full))
  return mod.exports
}
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const text = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n')

async function main() {
  const native = openDb(loadAll())
  const raw = native.db
  seedStockFixture(raw, () => {
    raw.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,is_active,stock_quantity,selling_price_usd) VALUES(1,?,?,2,1,0,1)').run('Zero cost', 'B1')
    raw.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,is_active,stock_quantity,selling_price_usd) VALUES(2,?,?,2,1,0,1)').run('Backfilled', 'B2')
    raw.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,is_active,stock_quantity,selling_price_usd) VALUES(3,?,NULL,2,1,0,1)').run('No barcode')
    raw.prepare("INSERT INTO suppliers(id,name) VALUES(5,'Acme')").run()
    raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active,supplier_id,supplier_name) VALUES(10,2,'L1','L1','2026-09-02',1,3,1,5,'Acme')").run()
  })
  raw.prepare("UPDATE system_flags SET value = '5' WHERE key = 'cost_zero_watermark'").run()
  // The harness statements answer D1's meta.last_row_id; lib/db.ts's wrapper answers lastInsertRowid, which the recorders read.
  const db = {
    prepare: (sql) => {
      const statement = native.prepare(sql)
      return { all: async (p) => statement.all(p), get: async (p) => statement.get(p),
        run: async (p) => { const out = statement.run(p); return { ...out, changes: out.meta.changes, lastInsertRowid: out.meta.last_row_id } } }
    },
    batch: (statements) => native.batch(statements),
  }
  const events = []
  const bumps = []
  const cache = {
    bumpVersion: async (_env, namespace) => { events.push(`bump-start:${namespace}`); bumps.push([namespace]); await sleep(BUMP_MS); events.push(`bump-done:${namespace}`) },
    bumpVersions: async (_env, list) => { events.push(`bump-start:${list.join('+')}`); bumps.push([...list]); await sleep(BUMP_MS); events.push(`bump-done:${list.join('+')}`) },
  }
  const hub = { broadcast: async (_env, channel) => { events.push(`broadcast:${channel}`) } }
  const permissions = load('lib/permissions.ts')
  const actor = load('lib/actorSnapshot.ts')
  const stockTransaction = load('lib/stockTransaction.ts')
  const audit = { audit: async () => {}, buildAuditStatement: (userId, userName, action, entity, entityId, details) => ({
    sql: 'INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details) VALUES (@u, @n, @a, @e, @i, @d)',
    params: { u: userId, n: userName, a: action, e: entity, i: entityId, d: JSON.stringify(details) } }) }
  const gaps = load('lib/productDataGaps.ts', { './audit': audit, './businessMaintenanceGuard': load('lib/businessMaintenanceGuard.ts') })
  const cost = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
  const appliers = load('lib/undoAppliers.ts', {
    './stockTransaction': stockTransaction, './permissions': permissions, './actorSnapshot': actor, './db': { getDb: () => db }, './audit': audit,
    './productDataGaps': gaps, './acquisitionCostAccess': cost, './cache': cache, './branchWrites': load('lib/branchWrites.ts', { './db': { toDbBool: (v) => (v ? 1 : 0) }, './canonicalBranchIdentity': load('lib/canonicalBranchIdentity.ts', { './db': { toDbBool: (v) => (v ? 1 : 0) }, './branchRoles': load('lib/branchRoles.ts') }) }), '../durable-objects/broadcastHub': hub,
  })
  const history = load('routes/actionHistory.ts', {
    '../lib/stockTransaction': stockTransaction, '../lib/acquisitionCostAccess': cost, '../lib/db': { getDb: () => db },
    '../lib/permissions': permissions, '../lib/actorSnapshot': actor, '../lib/undoAppliers': appliers,
    '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set() }, '../lib/cache': cache, '../durable-objects/broadcastHub': hub,
    '../lib/audit': audit, '../lib/auth': { requireAuth: async (c, next) => { c.set('user', ADMIN); return next() } },
  }).default
  const app = new Hono()
  app.route('/api/action-history', history)
  const pending = []
  const executionCtx = { waitUntil: (p) => { pending.push(p); p?.catch?.(() => {}) }, passThroughOnException() {} }
  const call = async (id, direction) => {
    events.length = 0; bumps.length = 0
    const res = await app.request(`http://local/api/action-history/${id}/${direction}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, { DB: native }, executionCtx)
    events.push('response');
    const json = await res.json().catch(() => null)
    return { status: res.status, json, trace: events.join(' > ') }
  }
  const settle = async (label, got) => {
    assert.equal(got.status, 200, `${label}: ${JSON.stringify(got.json)}`)
    const order = got.trace.split(' > ')
    const response = order.indexOf('response')
    const done = order.findIndex((event) => event.startsWith('bump-done:'))
    assert.ok(done >= 0 && done < response, `${label}: the bump finished before the response (${got.trace})`)
    assert.equal(bumps.length, 1, `${label}: ONE bump call per undo/redo (${got.trace})`)
    assert.ok(bumps[0].includes('stock'), `${label}: the one call carries stock (${bumps[0]})`)
    const beforeBroadcast = order.findIndex((event) => event.startsWith('broadcast:'))
    assert.ok(beforeBroadcast < 0 || beforeBroadcast > done, `${label}: no broadcast before the bump finished (${got.trace})`)
    await Promise.allSettled(pending.splice(0))
    const all = events.join(' > ')
    const firstBroadcast = events.findIndex((event) => event.startsWith('broadcast:'))
    assert.ok(firstBroadcast >= 0, `${label}: the peers are still told (${all})`)
    assert.ok(firstBroadcast > events.findIndex((event) => event.startsWith('bump-done:')), `${label}: the broadcast follows the bump (${all})`)
  }
  let failed = 0
  const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.stack || error.message) } }

  await check('supplier.backfill undo and redo: one bump, then the broadcasts', async () => {
    const reversal = { productId: 2, supplierId: 5, supplierName: 'Acme', lots: [{ id: 10, prevSupplierId: null, prevSupplierName: null }] }
    const recorded = await appliers.recordSupplierBackfillSnapshot({}, ADMIN, reversal)
    assert.ok(recorded && recorded.actionHistoryId > 0)
    await settle('supplier.backfill undo', await call(recorded.actionHistoryId, 'undo'))
    // The original writer (supplier backfill) bumps 'products'; the replay carries it too (review N1).
    assert.deepEqual([...bumps[0]].sort(), ['products', 'stock'], 'supplier.backfill undo namespaces')
    await settle('supplier.backfill redo', await call(recorded.actionHistoryId, 'redo'))
    assert.deepEqual([...bumps[0]].sort(), ['products', 'stock'], 'supplier.backfill redo namespaces')
  })

  await check('branch.update undo and redo: the products list turns over with stock, in one bump', async () => {
    raw.prepare("INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active) VALUES (50, 'Warehouse', 'Rd', '2', 'Sok', 'n', 0, 1)").run()
    raw.prepare("INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active) VALUES (51, 'Shop', 'Rd', '3', 'Dara', 'n', 1, 1)").run()
    const form = (phone) => ({ name: 'Warehouse', location: 'Rd', phone, manager: 'Sok', notes: 'n', is_default: 0, is_active: 1 })
    const id = Number(raw.prepare(`INSERT INTO action_history (scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
      VALUES ('branches', 'branch', '50', 'Edit branch', 1, 'undoable', @u, @r, 7, 'Admin')`).run({
      u: JSON.stringify({ applier: 'branch.update', id: 50, fields: form('1') }),
      r: JSON.stringify({ applier: 'branch.update', id: 50, fields: form('2') }) }).lastInsertRowid)
    await settle('branch.update undo', await call(id, 'undo'))
    assert.deepEqual([...bumps[0]].sort(), ['products', 'stock'], 'branch.update undo namespaces')
    await settle('branch.update redo', await call(id, 'redo'))
    assert.deepEqual([...bumps[0]].sort(), ['products', 'stock'], 'branch.update redo namespaces')
  })

  await check('product.conflict_mark undo and redo: ONE bump call (products and stock together)', async () => {
    const id = (await gaps.setProductConflictMark(db, { id: 7, name: 'Admin' }, { product_id: 3, mark: 'no_barcode', set: true })).action_history_id
    await settle('conflict_mark undo', await call(id, 'undo'))
    assert.deepEqual([...bumps[0]].sort(), ['products', 'stock'])
    await settle('conflict_mark redo', await call(id, 'redo'))
  })

  await check('source: appliers never broadcast or bump directly, and the route namespaces equal the bump helpers', async () => {
    const appliersSrc = text('lib/undoAppliers.ts')
    const direct = appliersSrc.split('\n').filter((line) => /\bbroadcast\(ctx\.env/.test(line) || /bumpVersions?\(ctx\.env/.test(line))
    assert.equal(direct.length, 2, `only announceChange and bumpChange touch the hub/cache directly: ${direct.join(' | ')}`)
    const route = text('routes/actionHistory.ts')
    const table = route.slice(route.indexOf('function serverReplayBumpNamespaces'), route.indexOf('async function completeServerHistoryTransition'))
    const parity = [
      ['lib/customerGenderRestoration.ts', 'bumpCustomerGenderRestoration', 'CUSTOMER_GENDER_RESTORATION_KIND', ['customers']],
      ['lib/returnLegacyConvert.ts', 'bumpLegacyReturnConversion', 'RETURN_LEGACY_CONVERT_KIND', ['returns', 'sales']],
      ['lib/transferOperation.ts', 'bumpTransferOperation', 'TRANSFER_OPERATION_KIND', ['products']],
      ['lib/stockLotAdjustment.ts', 'bumpStockLotSet', 'STOCK_LOT_SET_KIND', ['products', 'inventory_checks']],
      ['lib/stockInLineEdit.ts', 'bumpStockInLineEdit', 'STOCK_IN_LINE_EDIT_KIND', ['products']],
      ['lib/stockSession.ts', 'bumpStockSession', 'STOCK_SESSION_KIND', ['products', 'stock']],
      ['lib/saleSettlementAction.ts', 'bumpSaleSettlementAction', 'SALE_SETTLEMENT_ACTION_KIND', ['sales']],
      ['lib/saleBulkStatus.ts', 'bumpBulkStatus', 'BULK_STATUS_KIND', ['sales', 'stock']],
    ]
    // The two kinds the table below cannot cover (review N1): the route adds 'products' for exactly the kinds whose original writer bumps it.
    const kindsLine = route.split('\n').find((line) => line.startsWith('const PRODUCTS_REPLAY_KINDS')) || ''
    assert.deepEqual([...kindsLine.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).sort(), ['branch.update', 'supplier.backfill'], 'route products replay kinds')
    const nextLine = (file, needle) => { const lines = text(file).split('\n'); const i = lines.findIndex((line) => line.includes(needle)); return i < 0 ? '' : lines[i + 1] }
    assert.match(nextLine('routes/branches.ts', 'Every product row lists the branches'), /bumpVersion\(c\.env, 'products'\)/, 'branch writer bumps products')
    assert.match(nextLine('routes/products.ts', "'supplier_backfill', 'product'"), /bumpVersion\(c\.env, 'products'\)/, 'supplier backfill writer bumps products')
    const quoted = (value) => [...new Set([...value.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]))]
    for (const [file, helperName, kind, expected] of parity) {
      const source = text(file)
      const start = source.indexOf(`export async function ${helperName}`)
      assert.ok(start >= 0, `${file} defines ${helperName}`)
      const helper = source.slice(start, source.indexOf('\n}', start))
      assert.deepEqual(quoted(helper).sort(), [...expected].sort(), `${file} ${helperName} namespaces`)
      const row = table.match(new RegExp(`case ${kind}: return \\[([^\\]]*)\\]`))
      assert.ok(row, `the route lists ${kind}`)
      assert.deepEqual(quoted(row[1]).sort(), [...expected].sort(), `${kind} namespaces in the route`)
    }
  })

  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1) }
  console.log('PASS test-undo-redo-one-bump-native')
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
