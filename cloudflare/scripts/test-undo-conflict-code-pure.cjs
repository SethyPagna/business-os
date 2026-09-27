// FX-undo2 item 1 (R-undo C5/C12): an undo/redo the Worker refuses in order
// to protect newer data must say so with a stable machine code in its 409
// body, so the client can restate the refusal in the operator's language
// (frontend/src/api/actionHistoryTransport.ts). Before this, UndoConflictError
// carried only statusCode 409 and routes/actionHistory.ts answered
// { success: false, error: <English sentence> }, so a Khmer screen showed the
// server's English.
//
// Real SQLite over the real migrated schema, the REAL transpiled
// lib/undoAppliers.ts + lib/branchWrites.ts (harness/load_undo_appliers.cjs)
// and the REAL routes/actionHistory.ts mounted on Hono. Only auth, audit,
// permissions and the notify side channels of other appliers are stubbed.
//
// Run: node scripts/test-undo-conflict-code-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')

const ROUTE = path.join(__dirname, '..', 'src', 'routes', 'actionHistory.ts')
const USER = { id: 42, name: 'Admin', username: 'admin' }
const RECORD_CHANGED = 'undo_record_changed'
const NO_DEFAULT_BRANCH = 'undo_no_default_branch'
const notify = async () => {}

function loadHistoryRoute(db, undoAppliers) {
  const stubs = {
    '../lib/acquisitionCostAccess': { acquisitionCostResponses: async (_c, next) => next(), hasAcquisitionCostInput: () => false },
    '../lib/db': { getDb: () => db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
    '../lib/audit': { audit: async () => {} },
    '../lib/permissions': {
      getActionTier: () => 'full', hasPermission: () => true, isAdminControlUser: () => true,
      isSensitiveActionHistory: () => false, permissionForActionHistory: () => '',
    },
    '../lib/undoAppliers': undoAppliers,
    '../lib/customerGenderRestoration': { CUSTOMER_GENDER_RESTORATION_KIND: 'customer.gender_restore', canRestoreCustomerGender: () => false, notifyCustomerGenderRestoration: notify },
    '../lib/productDelete': { PRODUCT_REMOVE_ACTION_KIND: 'product.remove' },
    '../lib/saleBulkStatus': { BULK_STATUS_KIND: 'sale.status.bulk', notifyBulkStatus: notify },
    '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set(['sale.fields.bulk']), notifySaleBulkUpdate: notify },
    '../lib/saleCustomerAssignmentGuard': { isLoyaltyAssignmentError: () => false, LOYALTY_REASSIGNMENT_CODE: 'loyalty_reassignment' },
    '../lib/returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk', notifyReturnBulkAction: notify },
    '../lib/saleSettlementAction': { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement', notifySaleSettlementAction: notify },
    '../lib/stockSession': { STOCK_SESSION_KIND: 'stock.session', canReplayStockSessionPayload: () => false, notifyStockSession: notify },
    '../lib/actorSnapshot': { actorSnapshot: (u) => (u && u.name) || '' },
    '../lib/transferOperation': { TRANSFER_OPERATION_KIND: 'stock.transfer', canReplayTransferPayload: () => false, notifyTransferOperation: notify },
    '../lib/stockLotAdjustment': { STOCK_LOT_SET_KIND: 'stock.quantity_set', notifyStockLotSet: notify },
    '../lib/stockInLineEdit': { STOCK_IN_LINE_EDIT_KIND: 'stock.session_line_edit', notifyStockInLineEdit: notify },
  }
  const code = ts.transpileModule(fs.readFileSync(ROUTE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'actionHistory.ts',
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.')) throw new Error(`routes/actionHistory.ts imports ${request}, which this test does not provide`)
    return require(request)
  }
  new Function('exports', 'require', 'module', code)(mod.exports, localRequire, mod)
  const app = new Hono()
  app.route('/api/action-history', mod.exports.default)
  return app
}

function freshWorld() {
  const d1 = openDb(loadAll())
  const { undoAppliers, branchWrites, db } = loadUndoAppliers(d1)
  const run = (sql, params) => d1.db.prepare(sql).run(params == null ? {} : params)
  return { d1, undoAppliers, branchWrites, db, run, app: loadHistoryRoute(db, undoAppliers) }
}

async function replay(world, historyId, direction) {
  const res = await world.app.request(`/api/action-history/${historyId}/${direction}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }, {}, { waitUntil: () => {}, passThroughOnException: () => {} })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch (_) { throw new Error(`${direction} answered ${res.status}: ${text}`) }
  return { status: res.status, body }
}

function historyRow(world, id) {
  return world.d1.db.prepare('SELECT status, last_error FROM action_history WHERE id = ?').get(id)
}

function assertCoded(result, code, pattern) {
  assert.equal(result.status, 409, `expected a 409 conflict, got ${result.status}: ${JSON.stringify(result.body)}`)
  assert.equal(result.body.success, false)
  assert.equal(result.body.code, code, `the 409 body carries the machine code (body: ${JSON.stringify(result.body)})`)
  assert.match(String(result.body.error), pattern, 'the English sentence stays in the body for diagnostics')
}

// --- branch.update (the same world as test-undo-branch-update-staleness-pure.cjs)

function branchWorld({ withWarehouse = true } = {}) {
  const world = freshWorld()
  world.run(`INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active)
    VALUES (1, 'Shop', 'Old Market', '012 111', 'Dara', 'front till', 1, 1)`)
  if (withWarehouse) {
    world.run(`INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active)
      VALUES (2, 'Warehouse', 'Depot Rd', '012 222', 'Sok', 'bulk', 0, 1)`)
  }
  return world
}

const BRANCH_COLUMNS = ['name', 'location', 'phone', 'manager', 'notes', 'is_default', 'is_active']
function branch(world, id) {
  const row = world.d1.db.prepare(`SELECT ${BRANCH_COLUMNS.join(', ')} FROM branches WHERE id = ?`).get(id)
  return row ? Object.fromEntries(BRANCH_COLUMNS.map((c) => [c, row[c]])) : null
}

function formPayload(row) {
  return {
    name: row.name || '', location: row.location || '', phone: row.phone || '', manager: row.manager || '',
    notes: row.notes || '', is_default: row.is_default ? 1 : 0, is_active: row.is_active ?? 1,
    userId: USER.id, userName: USER.name,
  }
}

async function branchEdit(world, id, changes) {
  const before = branch(world, id)
  const after = { ...before, ...changes }
  const identity = world.d1.db.prepare('SELECT id, name, is_active FROM branches WHERE id = ?').get(id)
  await world.d1.batch(world.branchWrites.branchUpdateStatements(id, formPayload(after), identity))
  const info = world.run(`INSERT INTO action_history (scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
    VALUES ('branches', 'branch', @entity, 'Edit branch', 1, 'undoable', @undo, @redo, @by, @byName)`, {
    entity: String(id),
    undo: JSON.stringify({ applier: 'branch.update', id, fields: formPayload(before) }),
    redo: JSON.stringify({ applier: 'branch.update', id, fields: formPayload(after) }),
    by: USER.id, byName: USER.name,
  })
  return Number(info.lastInsertRowid)
}

// --- supplier.backfill (the same world as test-undo-supplier-backfill-staleness-pure.cjs)

function supplierWorld() {
  const world = freshWorld()
  world.run(`INSERT INTO suppliers (id, name) VALUES (7, 'Acme Co'), (9, 'Gamma Ltd')`)
  world.run(`INSERT INTO products (id, name, is_active) VALUES (100, 'ProdA', 1)`)
  world.run(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active, supplier_id, supplier_name) VALUES
    (5000, 100, 'A1', 1, 1, NULL, NULL),
    (5001, 100, 'A2', 2, 1, NULL, 'Acme Co')`)
  return world
}

// routes/products.ts POST /:id/suppliers/backfill, then its real recorder
// (which writes the action_history row the route replays).
async function supplierBackfill(world) {
  const targets = world.d1.db.prepare(
    'SELECT id, supplier_id, supplier_name FROM product_batches WHERE variant_product_id = 100 AND supplier_id IS NULL ORDER BY id',
  ).all()
  world.run(`UPDATE product_batches SET supplier_id = 7, supplier_name = 'Acme Co' WHERE id IN (${targets.map((t) => Number(t.id)).join(',')})`)
  const recorded = await world.undoAppliers.recordSupplierBackfillSnapshot({}, USER, {
    productId: 100, supplierId: 7, supplierName: 'Acme Co',
    lots: targets.map((t) => ({ id: Number(t.id), prevSupplierId: null, prevSupplierName: t.supplier_name ?? null })),
  })
  return recorded.actionHistoryId
}

let passed = 0
const failed = []
// Every check runs even after a failure, so a red run names each broken case.
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed.push(name)
    console.log(`FAIL ${name}\n  ${String((error && error.message) || error).split('\n')[0]}`)
  }
}

async function main() {
  await check('control: a clean branch undo and redo are applied by the Worker and carry no refusal code', async () => {
    const world = branchWorld()
    const h = await branchEdit(world, 1, { phone: '099 999' })
    const undone = await replay(world, h, 'undo')
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    assert.equal(undone.body.applied, true)
    assert.equal(undone.body.code, undefined)
    assert.equal(branch(world, 1).phone, '012 111')
    const redone = await replay(world, h, 'redo')
    assert.equal(redone.status, 200, JSON.stringify(redone.body))
    assert.equal(branch(world, 1).phone, '099 999')
  })

  await check('branch.update undo after a later edit: 409 with the record-changed code, nothing written, still undoable', async () => {
    const world = branchWorld()
    const h = await branchEdit(world, 1, { phone: '099 999' })
    await branchEdit(world, 1, { manager: 'Later Manager' })
    const result = await replay(world, h, 'undo')
    assertCoded(result, RECORD_CHANGED, /edited after this change \(manager\)/)
    assert.equal(branch(world, 1).manager, 'Later Manager')
    assert.equal(branch(world, 1).phone, '099 999')
    const row = historyRow(world, h)
    assert.equal(row.status, 'undoable', 'a refused undo leaves the row reversible')
    assert.match(String(row.last_error), /edited after this change/, 'the English reason is kept on the row for diagnostics')
  })

  await check('branch.update redo after a later edit: 409 with the record-changed code', async () => {
    const world = branchWorld()
    const h = await branchEdit(world, 1, { location: 'A site' })
    assert.equal((await replay(world, h, 'undo')).status, 200)
    await branchEdit(world, 1, { notes: 'after the undo' })
    assertCoded(await replay(world, h, 'redo'), RECORD_CHANGED, /\(notes\)/)
    assert.equal(branch(world, 1).location, 'Old Market')
  })

  await check('branch.update edit that lands between the check and the write: 409 with the record-changed code', async () => {
    const world = branchWorld()
    const h = await branchEdit(world, 1, { phone: '099 999' })
    const batch = world.d1.batch.bind(world.d1)
    world.d1.batch = async (statements) => {
      world.d1.batch = batch
      world.run("UPDATE branches SET manager = 'Raced' WHERE id = 1")
      return batch(statements)
    }
    assertCoded(await replay(world, h, 'undo'), RECORD_CHANGED, /changed while the change was being undone/)
    assert.equal(branch(world, 1).phone, '099 999')
  })

  await check('branch.update history row with no recorded result: refused with the record-changed code, not replayed blind', async () => {
    const world = branchWorld()
    const h = await branchEdit(world, 1, { phone: '099 999' })
    world.run("UPDATE action_history SET redo_payload = '{}' WHERE id = @id", { id: h })
    assertCoded(await replay(world, h, 'undo'), RECORD_CHANGED, /no recorded result/)
    assert.equal(branch(world, 1).phone, '099 999')
  })

  await check('branch.update undo that would leave no default branch: 409 with its own code', async () => {
    const world = branchWorld({ withWarehouse: false })
    world.run('UPDATE branches SET is_default = 0 WHERE id = 1')
    const h = await branchEdit(world, 1, { is_default: 1 })
    assertCoded(await replay(world, h, 'undo'), NO_DEFAULT_BRANCH, /no default branch/)
    assert.equal(branch(world, 1).is_default, 1)
  })

  await check('supplier.backfill undo after a re-attribution: 409 with the record-changed code', async () => {
    const world = supplierWorld()
    const h = await supplierBackfill(world)
    world.run("UPDATE product_batches SET supplier_id = 9, supplier_name = 'Gamma Ltd' WHERE id = 5001")
    assertCoded(await replay(world, h, 'undo'), RECORD_CHANGED, /re-attributed after this change/)
    assert.equal(world.d1.db.prepare('SELECT supplier_id FROM product_batches WHERE id = 5000').get().supplier_id, 7)
    assert.equal(historyRow(world, h).status, 'undoable')
  })

  await check('supplier.backfill redo after an attribution made while reversed: 409 with the record-changed code', async () => {
    const world = supplierWorld()
    const h = await supplierBackfill(world)
    assert.equal((await replay(world, h, 'undo')).status, 200)
    world.run("UPDATE product_batches SET supplier_id = 9, supplier_name = 'Gamma Ltd' WHERE id = 5000")
    assertCoded(await replay(world, h, 'redo'), RECORD_CHANGED, /re-attributed after this change/)
  })

  await check('supplier.backfill re-attribution between the check and the write: 409 with the record-changed code', async () => {
    const world = supplierWorld()
    const h = await supplierBackfill(world)
    const batch = world.d1.batch.bind(world.d1)
    world.d1.batch = async (statements) => {
      world.d1.batch = batch
      world.run("UPDATE product_batches SET supplier_id = 9, supplier_name = 'Gamma Ltd' WHERE id = 5001")
      return batch(statements)
    }
    assertCoded(await replay(world, h, 'undo'), RECORD_CHANGED, /re-attributed while this change was being undone/)
  })

  await check('control: a failure that is not a refusal to protect newer data keeps its old shape (no code)', async () => {
    const world = branchWorld()
    const h = await branchEdit(world, 2, { phone: '099 999' })
    world.run('DELETE FROM branches WHERE id = 2')
    const result = await replay(world, h, 'undo')
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.match(String(result.body.error), /no longer exists/)
    assert.equal(Object.prototype.hasOwnProperty.call(result.body, 'code'), false, `no code on a plain failure: ${JSON.stringify(result.body)}`)
  })

  console.log(`\n${passed} check(s) passed, ${failed.length} failed.`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
