'use strict'
// Conflicts decisions through the REAL History routes (lane 6.0.988): POST /api/action-history/:id/undo and /redo, the real
// undoAppliers registry (the product.conflict_mark applier, reached through its dynamic imports) and the real lib/productDataGaps.ts over a
// fully migrated SQLite. Pins: undo and redo flip the mark and the history row; a role with Conflicts access (merge_duplicates) switched
// off is refused on both routes and nothing changes; a $0 confirmation also needs the cost-entry permission; a replay that no longer applies
// answers 409 with its stable code.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const SRC = path.join(__dirname, '../src')
function inert() { return new Proxy(function () {}, { get: () => inert(), apply: () => undefined }) }
// A persistent require: the appliers reach productDataGaps / acquisitionCostAccess / cache with `await import()`, which runs later.
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = request => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : require(request)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(req, mod, mod.exports, full, path.dirname(full))
  return mod.exports
}

const role = grants => ({ id: 31, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const CONFLICTS = { products: true, 'products:merge_duplicates': true, product_cost_view: true, product_cost_edit: true }

async function main() {
  const native = openDb(loadAll())
  const raw = native.db
  seedStockFixture(raw, () => {
    const add = raw.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,is_active,stock_quantity,selling_price_usd) VALUES(?,?,?,?,1,0,1)')
    add.run(1, 'Old zero', 'B1', 0)
    add.run(2, 'No barcode', null, 2)
    add.run(3, 'Second old zero', 'B3', 0)
    add.run(4, 'Third old zero', 'B4', 0)
    add.run(5, 'Second no barcode', null, 2)
  })
  raw.prepare("UPDATE system_flags SET value = '5' WHERE key = 'cost_zero_watermark'").run()
  let user = ADMIN
  const db = { prepare: sql => native.prepare(sql), batch: statements => native.batch(statements) }
  const permissions = load('lib/permissions.ts')
  const actor = load('lib/actorSnapshot.ts')
  const stockTransaction = load('lib/stockTransaction.ts')
  const audit = { buildAuditStatement: (userId, userName, action, entity, entityId, details) => ({
    sql: 'INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details) VALUES (@u, @n, @a, @e, @i, @d)',
    params: { u: userId, n: userName, a: action, e: entity, i: entityId, d: JSON.stringify(details) } }) }
  const gaps = load('lib/productDataGaps.ts', { './audit': audit, './businessMaintenanceGuard': load('lib/businessMaintenanceGuard.ts') })
  const cost = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
  const appliers = load('lib/undoAppliers.ts', {
    './stockTransaction': stockTransaction, './permissions': permissions, './actorSnapshot': actor, './db': { getDb: () => db },
    './productDataGaps': gaps, './acquisitionCostAccess': cost, './cache': { bumpVersion: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
  })
  const history = load('routes/actionHistory.ts', {
    '../lib/stockTransaction': stockTransaction, '../lib/acquisitionCostAccess': cost, '../lib/db': { getDb: () => db },
    '../lib/permissions': permissions, '../lib/actorSnapshot': actor, '../lib/undoAppliers': appliers,
    '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set() }, '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
    '../lib/audit': { audit: async () => {}, buildAuditStatement: audit.buildAuditStatement },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); return next() } },
  }).default
  const app = new Hono()
  app.route('/api/action-history', history)
  const executionCtx = { waitUntil: p => { p?.catch?.(() => {}) }, passThroughOnException() {} }
  const call = async (as, id, direction) => {
    user = as
    const res = await app.request(`http://local/api/action-history/${id}/${direction}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, { DB: native }, executionCtx)
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  const marks = () => raw.prepare('SELECT product_id || \':\' || mark AS k FROM product_conflict_marks ORDER BY 1').all().map(r => r.k)
  const historyRow = id => raw.prepare('SELECT status, reversible FROM action_history WHERE id = ?').get(id)
  // A non-admin may operate only history rows they made themselves (canOperateHistoryRow), so the role tests record their own decisions.
  const actorAdmin = { id: 7, name: 'Admin' }
  const actorStaff = { id: 31, name: 'Staff' }
  const decide = async (productId, mark, by = actorAdmin) => (await gaps.setProductConflictMark(db, by, { product_id: productId, mark, set: true })).action_history_id

  let failed = 0
  const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.stack || error.message) } }

  await check('the History undo and redo routes reverse and re-apply a Confirm $0 and a no-barcode mark, flipping the history row each time', async () => {
    const zeroId = await decide(1, 'zero_cost_confirmed')
    const barcodeId = await decide(2, 'no_barcode')
    assert.ok(zeroId > 0 && barcodeId > 0, 'control: both decisions wrote an undo record')
    assert.deepEqual(marks(), ['1:zero_cost_confirmed', '2:no_barcode'])
    for (const [id, key] of [[zeroId, '1:zero_cost_confirmed'], [barcodeId, '2:no_barcode']]) {
      const undone = await call(ADMIN, id, 'undo')
      assert.equal(undone.status, 200, JSON.stringify(undone.json))
      assert.ok(!marks().includes(key), `${key} is gone after undo`)
      assert.equal(historyRow(id).status, 'redoable')
      const redone = await call(ADMIN, id, 'redo')
      assert.equal(redone.status, 200, JSON.stringify(redone.json))
      assert.ok(marks().includes(key), `${key} is back after redo`)
      assert.equal(historyRow(id).status, 'undoable')
    }
    const audited = raw.prepare("SELECT action FROM audit_logs WHERE entity = 'product' AND action IN ('conflict_mark','conflict_unmark') ORDER BY id").all().map(r => r.action)
    assert.deepEqual(audited.filter(a => a === 'conflict_unmark').length, 2, 'each undo is audited')
    assert.equal(audited.filter(a => a === 'conflict_mark').length, 2 + 2, 'two decisions and two redos are audited')
  })

  await check('a role with Conflicts access (merge_duplicates) off is refused on undo and on redo, and nothing changes', async () => {
    const id = await decide(3, 'zero_cost_confirmed', actorStaff)
    const before = marks()
    const noConflicts = role({ ...CONFLICTS, 'products:merge_duplicates': false })
    const refusedUndo = await call(noConflicts, id, 'undo')
    assert.equal(refusedUndo.status, 403, JSON.stringify(refusedUndo.json))
    assert.deepEqual(marks(), before)
    assert.equal(historyRow(id).status, 'undoable')
    assert.equal((await call(ADMIN, id, 'undo')).status, 200)
    const refusedRedo = await call(noConflicts, id, 'redo')
    assert.equal(refusedRedo.status, 403, JSON.stringify(refusedRedo.json))
    assert.ok(!marks().includes('3:zero_cost_confirmed'), 'the refused redo did not re-apply the mark')
    assert.equal(historyRow(id).status, 'redoable')
    assert.equal((await call(role(CONFLICTS), id, 'redo')).status, 200, 'control: the same role with Conflicts access on may redo')
    assert.ok(marks().includes('3:zero_cost_confirmed'))
  })

  await check('undoing a $0 confirmation needs the cost-entry permission; a no-barcode mark does not', async () => {
    const withoutCostEdit = role({ products: true, 'products:merge_duplicates': true })
    const zeroId = await decide(4, 'zero_cost_confirmed', actorStaff)
    assert.ok(marks().includes('4:zero_cost_confirmed'))
    const refused = await call(withoutCostEdit, zeroId, 'undo')
    assert.equal(refused.status, 409)
    assert.equal(refused.json.code, 'undo_refused')
    assert.ok(marks().includes('4:zero_cost_confirmed'))
    const barcodeId = await decide(5, 'no_barcode', actorStaff)
    assert.equal((await call(withoutCostEdit, barcodeId, 'undo')).status, 200)
    assert.ok(!marks().includes('5:no_barcode'))
  })

  await check('a replay that no longer applies answers 409 with its stable code: already done, and a barcode typed meanwhile', async () => {
    const barcodeId = raw.prepare("SELECT id FROM action_history WHERE label = 'Marked a product as having no barcode' AND entity_id = '5' ORDER BY id LIMIT 1").get().id
    assert.equal(historyRow(barcodeId).status, 'redoable')
    seedStockFixture(raw, () => raw.prepare("UPDATE products SET barcode = '8850000000999' WHERE id = 5").run())
    const redo = await call(ADMIN, barcodeId, 'redo')
    assert.equal(redo.status, 409, JSON.stringify(redo.json))
    assert.equal(redo.json.code, 'undo_record_changed')
    assert.ok(!marks().includes('5:no_barcode'))
  })

  if (failed) throw new Error(failed + ' history route checks failed')
  console.log('product conflict history routes PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
