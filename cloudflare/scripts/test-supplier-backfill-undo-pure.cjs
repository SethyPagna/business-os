// Part 578 item 3: reload-durable UNDO/REDO of a supplier backfill.
//
// Supplier attribution lives on the lot (product_batches.supplier_id/_name,
// migration 0062). A lot whose name never matched a suppliers row at receive
// time keeps supplier_id NULL and "stays linkable later"; the backfill action
// (POST /:id/suppliers/backfill) does that later linking. Undo must restore
// each lot's EXACT prior attribution; redo re-applies the supplier's CURRENT
// canonical name.
//
// House style (see test-product-merge-undo-pure.cjs): the REAL lib/undoAppliers
// .ts is loaded transpiled with its deps stubbed, so recordSupplierBackfill
// Snapshot and the supplier.backfill applier are the actual shipping code run
// against the REAL migrated schema (incl. 0062 + 0097). A forward apply that
// MIRRORS the route drives it; the route's own shape is pinned in the source-
// guard layer so the two cannot drift.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const LIB_DIR = path.join(cloudflareRoot, 'src', 'lib')

function loadUndoAppliers(d1) {
  const dbAdapter = {
    prepare(sql) {
      const st = d1.prepare(sql)
      return {
        get: (p) => st.get(p == null ? {} : p),
        all: (p) => st.all(p == null ? {} : p),
        run: (p) => {
          const r = st.run(p == null ? {} : p)
          return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (stmts) => d1.batch(stmts),
  }
  const stubs = {
    '../index': {},
    './auth': {},
    './db': { getDb: () => dbAdapter },
    './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    // S4-24b: the 'sale.add_items' applier's planners. This file exercises
    // the supplier-backfill applier only, so these stubs exist to let the
    // module load; the real planners are driven against a live schema by
    // test-sale-add-items-pure.cjs.
    './saleLineAddition': {
      buildAllocationStatements: () => [],
      planSaleLineAddition: () => ({ lines: [], statements: [], saleItemStatementIndexByLine: [], deductions: [], deductedUnits: 0, addedSubtotalUsd: 0 }),
      planSaleLineRemoval: () => ({ statements: [], restoredUnits: 0 }),
      plannedLineFromRecord: (record) => record,
      saleMoneyUpdateStatement: () => ({ sql: 'SELECT 1', params: {} }),
    },
    // S4-30: the same applier also appends an amendment-ledger entry now, so
    // an undone addition leaves a visible trail rather than a hole. Stubbed
    // for the same reason -- the real statement builder and the append-only
    // triggers behind it are driven against a live schema by
    // test-sale-amendments-pure.cjs.
    './saleAmendments': {
      amendmentEntryStatement: () => ({ sql: 'SELECT 1', params: {} }),
    },
  }
  const src = fs.readFileSync(path.join(LIB_DIR, 'undoAppliers.ts'), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'undoAppliers.ts',
  })
  const original = Module._load
  Module._load = (request, parent, isMain) =>
    Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : original.call(Module, request, parent, isMain)
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      mod.exports, require, mod, path.join(LIB_DIR, 'undoAppliers.ts'), LIB_DIR,
    )
  } finally {
    Module._load = original
  }
  return mod.exports
}

// A forward backfill that MIRRORS routes/products.ts POST /:id/suppliers/
// backfill: pick this product's active, still-unattributed lots (supplier_id
// IS NULL), capture prior attribution, set supplier_id + canonical name.
function backfillForward(d1, productId, supplier) {
  const targets = d1.db.prepare(
    'SELECT id, supplier_id, supplier_name FROM product_batches WHERE variant_product_id = ? AND is_active = 1 AND supplier_id IS NULL',
  ).all(productId)
  if (!targets.length) return { reversal: null }
  const ids = targets.map((t) => Number(t.id))
  d1.db.prepare(`UPDATE product_batches SET supplier_id = @sid, supplier_name = @name, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ids.join(',')})`).run({ sid: supplier.id, name: supplier.name })
  return {
    reversal: {
      productId, supplierId: supplier.id, supplierName: supplier.name,
      lots: targets.map((t) => ({ id: Number(t.id), prevSupplierId: t.supplier_id == null ? null : Number(t.supplier_id), prevSupplierName: t.supplier_name ?? null })),
    },
  }
}

function lotFingerprint(d1, ids) {
  // Normalize to plain objects -- the d1compat shim hands back null-prototype
  // rows, which deepStrictEqual would reject against plain object literals.
  return d1.db.prepare(`SELECT id, supplier_id, supplier_name FROM product_batches WHERE id IN (${ids.join(',')}) ORDER BY id`).all()
    .map((r) => ({ id: Number(r.id), supplier_id: r.supplier_id == null ? null : Number(r.supplier_id), supplier_name: r.supplier_name == null ? null : String(r.supplier_name) }))
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`  ✓ ${name}`) }

async function run() {
  const d1 = openDb(loadAll())
  const undo = loadUndoAppliers(d1)
  const run1 = (sql, p) => d1.db.prepare(sql).run(p == null ? {} : p)

  run1(`INSERT INTO suppliers (id, name) VALUES (7,'Acme Co'),(8,'Beta Supply'),(9,'Gamma Ltd')`)
  run1(`INSERT INTO products (id, name, is_active) VALUES (100,'ProdA',1),(200,'ProdB',1)`)
  // ProdA lots: blank (no supplier at all), name-only (Acme Co, but id NULL),
  // and an already-attributed lot (supplier 9) that must be left untouched.
  run1(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active, supplier_id, supplier_name) VALUES
    (5000,100,'A1',1,1,NULL,NULL),
    (5001,100,'A2',2,1,NULL,'Acme Co'),
    (5002,100,'A3',3,1,9,'Gamma Ltd')`)
  // ProdB lots: two blank, for the supplier-deleted-before-redo scenario.
  run1(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active, supplier_id, supplier_name) VALUES
    (6000,200,'B1',1,1,NULL,NULL),(6001,200,'B2',2,1,NULL,NULL)`)

  const A_IDS = [5000, 5001, 5002]
  const F0 = lotFingerprint(d1, A_IDS)
  let snapshotId, actionHistoryId

  await check('forward backfill attributes only the NULL lots to supplier 7 (leaves the id-attributed lot alone)', async () => {
    const { reversal } = backfillForward(d1, 100, { id: 7, name: 'Acme Co' })
    assert.equal(reversal.lots.length, 2, 'only the two supplier_id-NULL lots are targeted')
    const rec = await undo.recordSupplierBackfillSnapshot({}, { id: 42, name: 'Editor' }, reversal)
    snapshotId = rec.snapshotId; actionHistoryId = rec.actionHistoryId
    // 5000 (blank) and 5001 (name-only) now carry supplier 7; 5002 untouched
    assert.deepEqual(lotFingerprint(d1, A_IDS), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5001, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5002, supplier_id: 9, supplier_name: 'Gamma Ltd' },
    ])
  })

  await check('recordSupplierBackfillSnapshot stores the snapshot + a small action_history row', async () => {
    const snap = d1.db.prepare('SELECT kind, status, payload_json FROM undo_snapshots WHERE id = ?').get(snapshotId)
    assert.equal(snap.kind, 'supplier.backfill'); assert.equal(snap.status, 'applied')
    assert.equal(JSON.parse(snap.payload_json).lots.length, 2)
    const hist = d1.db.prepare('SELECT scope, entity, reversible, status, label, undo_payload FROM action_history WHERE id = ?').get(actionHistoryId)
    assert.equal(hist.scope, 'products'); assert.equal(hist.entity, 'product'); assert.equal(hist.reversible, 1); assert.equal(hist.status, 'undoable')
    assert.equal(hist.label, 'Attributed 2 lots to "Acme Co"')
    assert.ok(hist.undo_payload.length < 200, 'action_history payload stays a tiny pointer')
    assert.equal(JSON.parse(hist.undo_payload).applier, 'supplier.backfill')
  })

  const applier = undo.resolveUndoApplier({ applier: 'supplier.backfill', snapshot_id: snapshotId })
  assert.ok(applier, 'supplier.backfill applier must resolve')
  assert.equal(applier.permission, 'products')
  assert.equal(applier.action, 'edit')

  await check('UNDO restores each lot to its EXACT prior attribution (blank->NULL/NULL, name-only->NULL/name)', async () => {
    await applier.run({ applier: 'supplier.backfill', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    assert.deepEqual(lotFingerprint(d1, A_IDS), F0)
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(snapshotId).status, 'reversed')
  })

  await check('REDO re-applies the supplier CURRENT canonical name (honours a rename between undo and redo)', async () => {
    // Rename the supplier while the action sits reversed.
    run1(`UPDATE suppliers SET name = 'Acme Corporation' WHERE id = 7`)
    await applier.run({ applier: 'supplier.backfill', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'redo' })
    assert.deepEqual(lotFingerprint(d1, A_IDS), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Corporation' },
      { id: 5001, supplier_id: 7, supplier_name: 'Acme Corporation' },
      { id: 5002, supplier_id: 9, supplier_name: 'Gamma Ltd' },
    ])
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(snapshotId).status, 'applied')
    // the snapshot's cached supplierName is refreshed so a future undo label is right
    assert.equal(JSON.parse(d1.db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(snapshotId).payload_json).supplierName, 'Acme Corporation')
  })

  await check('double-undo... then double-undo again is refused (status guard)', async () => {
    await applier.run({ applier: 'supplier.backfill', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    await assert.rejects(
      applier.run({ applier: 'supplier.backfill', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' }),
      /already been undone/,
    )
  })

  await check('REDO is refused when the supplier was deleted while the action was reversed', async () => {
    const { reversal } = backfillForward(d1, 200, { id: 8, name: 'Beta Supply' })
    const rec = await undo.recordSupplierBackfillSnapshot({}, { id: 42, name: 'Editor' }, reversal)
    const ap = undo.resolveUndoApplier({ applier: 'supplier.backfill', snapshot_id: rec.snapshotId })
    await ap.run({ applier: 'supplier.backfill', snapshot_id: rec.snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    run1(`DELETE FROM suppliers WHERE id = 8`)
    await assert.rejects(
      ap.run({ applier: 'supplier.backfill', snapshot_id: rec.snapshotId }, { env: {}, user: { id: 42 }, direction: 'redo' }),
      /no longer exists/,
    )
    // and the lots stay at their undone (blank) state -- a refused redo mutates nothing
    assert.deepEqual(lotFingerprint(d1, [6000, 6001]), [
      { id: 6000, supplier_id: null, supplier_name: null },
      { id: 6001, supplier_id: null, supplier_name: null },
    ])
  })

  // Source guards: the REAL route must match this forward shape and gate.
  const productsSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  const appliersSrc = fs.readFileSync(path.join(LIB_DIR, 'undoAppliers.ts'), 'utf8')

  await check('products.ts backfill route: products-edit-gated, NULL-only, records the snapshot', async () => {
    const at = productsSrc.indexOf("app.post('/:id/suppliers/backfill'")
    assert.ok(at > 0, 'the backfill route must exist')
    const rest = productsSrc.slice(at + 1)
    const nextRoute = rest.search(/\napp\.(get|post|put|patch|delete)\(/)
    const handler = nextRoute > 0 ? rest.slice(0, nextRoute) : rest
    assert.match(handler, /getActionTier\(user, 'products', 'edit'\) !== 'full'/)
    assert.match(handler, /is_active = 1 AND supplier_id IS NULL/)
    assert.match(handler, /recordSupplierBackfillSnapshot\(c\.env, user,/)
  })

  await check('undoAppliers.ts supplier.backfill: NULL-safe restore + gated on products edit', async () => {
    assert.match(appliersSrc, /'supplier\.backfill': \{/)
    assert.match(appliersSrc, /UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname/)
    assert.match(appliersSrc, /That supplier no longer exists/)
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((err) => { console.error(err); process.exitCode = 1 })
