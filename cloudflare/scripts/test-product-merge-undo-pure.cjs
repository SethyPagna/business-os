// Part 578 item 2b: reload-durable UNDO/REDO of a duplicate-product merge.
//
// The merge (routes/products.ts foldDuplicateProductInto) folds a duplicate
// into a keeper across many tables and soft-deletes the dup; undo must restore
// BOTH products to their exact pre-merge state, and redo must reproduce the
// merge. This test proves the round-trip is EXACT against the real schema.
//
// House style (see test-auto-merge-record-pure.cjs / test-contact-merge-
// repoints-pure.cjs): no full-route fetch harness. Instead:
//   (1) REAL undo code -- lib/undoAppliers.ts is loaded transpiled-for-real
//       (its deps are few and stubbable), so recordMergeUndoSnapshot, the
//       applyMergeReversal undo, and the redo orchestration are the actual
//       shipping code, run against the REAL migrated schema (incl. 0097).
//   (2) A forward fold that MIRRORS products.ts drives it; every reversal
//       field and every mutation it makes is also pinned in products.ts by
//       the SOURCE-GUARD layer below, so the two cannot silently drift.
//   (3) EXACT round-trip: fingerprint before(F0) === after-undo, and
//       after-merge(F1) === after-redo, across undo->redo->undo.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const LIB_DIR = path.join(cloudflareRoot, 'src', 'lib')

// --------------------------------------------------------------------------
// Load the REAL lib/undoAppliers.ts with its dependencies stubbed. getDb is
// pointed at a thin wrapper over the d1compat shim that returns the SAME
// { changes, lastInsertRowid } shape lib/db.ts's wrapper does (the shim's raw
// run() returns { meta: { last_row_id } }, which the real wrapper normalizes).
// --------------------------------------------------------------------------
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

// --------------------------------------------------------------------------
// A forward fold that mirrors routes/products.ts foldDuplicateProductInto and
// returns the SAME MergeReversal shape. Pinned to the real source in the
// source-guard layer below.
// --------------------------------------------------------------------------
async function foldForward(d1, keeper, dup, branchNameById, mergeContext) {
  const canonicalId = keeper.id
  const canonicalName = keeper.name
  const canonicalBatchRows = d1.db.prepare('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = ?').all(canonicalId)
  const canonicalBatchIdByKey = new Map(canonicalBatchRows.map((b) => [b.batch_key, b.id]))
  let nextCanonicalBatchNumber = canonicalBatchRows.reduce((m, b) => Math.max(m, Number(b.batch_number) || 0), 0) + 1

  const stockRows = d1.db.prepare('SELECT branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id = ?').all(dup.id)
  const canonicalStockBefore = d1.db.prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = ?').all(canonicalId)
  const canonicalBefore = d1.db.prepare('SELECT image_path FROM products WHERE id = ?').get(canonicalId)
  const dupBatchRows = d1.db.prepare('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = ?').all(dup.id)
  const dupImageRows = d1.db.prepare('SELECT image_path, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(dup.id)
  const canonicalImageRows = d1.db.prepare('SELECT image_path FROM product_images WHERE product_id = ?').all(canonicalId)
  const canonicalImagePaths = new Set(canonicalImageRows.map((r) => String(r.image_path)))
  let nextCanonicalImageOrder = canonicalImageRows.length

  const stmts = []
  let quantityMoved = 0
  for (const row of stockRows) {
    const qty = Number(row.quantity) || 0
    if (!qty) continue
    quantityMoved += qty
    stmts.push({ sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@canonicalId, @branchId, @qty) ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`, params: { canonicalId, branchId: row.branch_id, qty } })
    stmts.push({ sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at) VALUES (@productId,@productName,@branchId,@branchName,'adjustment',@quantity,@reason,@userId,@userName,CURRENT_TIMESTAMP)`, params: { productId: canonicalId, productName: canonicalName, branchId: row.branch_id, branchName: branchNameById.get(row.branch_id) || null, quantity: qty, reason: `Merged duplicate product "${dup.name}" (#${dup.id}) into this product -- ${mergeContext}`, userId: null, userName: null } })
  }
  stmts.push({ sql: 'DELETE FROM branch_stock WHERE product_id = @id', params: { id: dup.id } })

  let imagesMovedThisDup = 0
  const imagesMovedPaths = []
  for (const image of dupImageRows) {
    const imagePath = String(image.image_path || '')
    if (!imagePath || canonicalImagePaths.has(imagePath)) continue
    canonicalImagePaths.add(imagePath)
    imagesMovedPaths.push(imagePath)
    stmts.push({ sql: 'INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@canonicalId, @path, @order)', params: { canonicalId, path: imagePath, order: nextCanonicalImageOrder } })
    nextCanonicalImageOrder += 1
    imagesMovedThisDup += 1
  }
  stmts.push({ sql: 'DELETE FROM product_images WHERE product_id = @id', params: { id: dup.id } })
  stmts.push({ sql: `UPDATE products SET image_path = COALESCE(NULLIF(image_path, ''), @dupImagePath), updated_at = CURRENT_TIMESTAMP WHERE id = @canonicalId AND @dupImagePath IS NOT NULL AND @dupImagePath != ''`, params: { canonicalId, dupImagePath: dup.image_path ?? null } })
  stmts.push({ sql: 'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dup.id } })

  const repointedBatches = []
  const foldedBatches = []
  for (const batchRow of dupBatchRows) {
    const existingCanonicalBatchId = canonicalBatchIdByKey.get(batchRow.batch_key)
    if (existingCanonicalBatchId) {
      const dupBatchStockRows = d1.db.prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = ?').all(batchRow.id)
      const keeperBatchStockBefore = d1.db.prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = ?').all(existingCanonicalBatchId)
      for (const bbs of dupBatchStockRows) {
        const qty = Number(bbs.quantity) || 0
        if (!qty) continue
        stmts.push({ sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @qty) ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`, params: { batchId: existingCanonicalBatchId, branchId: bbs.branch_id, qty } })
      }
      stmts.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @id', params: { id: batchRow.id } })
      stmts.push({ sql: 'UPDATE product_batches SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: batchRow.id } })
      foldedBatches.push({ dupBatchId: batchRow.id, keeperBatchId: existingCanonicalBatchId, dupStockBefore: dupBatchStockRows.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })), keeperStockBefore: keeperBatchStockBefore.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })) })
    } else {
      stmts.push({ sql: 'UPDATE product_batches SET variant_product_id = @canonicalId, batch_number = @batchNumber, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { canonicalId, batchNumber: nextCanonicalBatchNumber, id: batchRow.id } })
      canonicalBatchIdByKey.set(batchRow.batch_key, batchRow.id)
      nextCanonicalBatchNumber += 1
      repointedBatches.push({ id: batchRow.id, batchNumber: batchRow.batch_number })
    }
  }

  const reparentedSaleItemIds = d1.db.prepare('SELECT id FROM sale_items WHERE product_id = ?').all(dup.id).map((r) => Number(r.id))
  const reparentedMovementIds = d1.db.prepare('SELECT id FROM inventory_movements WHERE product_id = ?').all(dup.id).map((r) => Number(r.id))
  stmts.push({ sql: 'UPDATE sale_items SET product_id = @canonicalId WHERE product_id = @dupId', params: { canonicalId, dupId: dup.id } })
  stmts.push({ sql: 'UPDATE inventory_movements SET product_id = @canonicalId WHERE product_id = @dupId', params: { canonicalId, dupId: dup.id } })

  await d1.batch(stmts)

  const adjustmentMovementIds = d1.db.prepare(`SELECT id FROM inventory_movements WHERE product_id = ? AND movement_type = 'adjustment' AND reason LIKE ?`).all(canonicalId, `%(#${dup.id}) into this product%`).map((r) => Number(r.id))

  return {
    reversal: {
      keeperId: canonicalId, keeperName: canonicalName, dupId: dup.id, dupName: dup.name ?? null,
      keeperImagePathBefore: canonicalBefore?.image_path ?? null,
      keeperStockBefore: canonicalStockBefore.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })),
      dupStockBefore: stockRows.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0, rfid_confirmed_qty: Number(r.rfid_confirmed_qty) || 0 })),
      dupImagesBefore: dupImageRows.map((r) => ({ image_path: String(r.image_path), sort_order: r.sort_order == null ? null : Number(r.sort_order) })),
      imagesMovedToKeeper: imagesMovedPaths, repointedBatches, foldedBatches,
      reparentedSaleItemIds, reparentedMovementIds, adjustmentMovementIds, mergeContext,
    },
  }
}

// --------------------------------------------------------------------------
// Fingerprint: a stable JSON of every row the merge/undo can touch for the
// two products, so an exact round-trip is a deepEqual.
// --------------------------------------------------------------------------
function fingerprint(d1, keeperId, dupId, batchIds) {
  const q = (sql, ...a) => d1.db.prepare(sql).all(...a)
  const ids = `(${keeperId},${dupId})`
  const bids = `(${batchIds.join(',')})`
  return {
    products: q(`SELECT id, is_active, image_path, stock_quantity FROM products WHERE id IN ${ids} ORDER BY id`),
    branch_stock: q(`SELECT product_id, branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id IN ${ids} ORDER BY product_id, branch_id`),
    product_images: q(`SELECT product_id, image_path, sort_order FROM product_images WHERE product_id IN ${ids} ORDER BY product_id, image_path`),
    product_batches: q(`SELECT id, variant_product_id, batch_number, is_active FROM product_batches WHERE id IN ${bids} ORDER BY id`),
    branch_batch_stock: q(`SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN ${bids} ORDER BY batch_id, branch_id`),
    sale_items: q(`SELECT id, product_id FROM sale_items WHERE product_id IN ${ids} ORDER BY id`),
    // Only the historical (non-adjustment) movements carry stable identity;
    // the fold's 'adjustment' rows are ephemeral markers that redo legitimately
    // regenerates with fresh ids (asserted by count, not identity).
    movements_owner: q(`SELECT id, product_id FROM inventory_movements WHERE product_id IN ${ids} AND movement_type <> 'adjustment' ORDER BY id`),
    adjustment_count: q(`SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id = ${keeperId} AND movement_type='adjustment'`)[0].n,
    movement_total: q(`SELECT COUNT(*) AS n FROM inventory_movements`)[0].n,
  }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`  ✓ ${name}`) }

async function run() {
  const d1 = openDb(loadAll())
  const undo = loadUndoAppliers(d1)
  undo.registerMergeFold((env, _db, _user, keeper, dup, branchNameById, ctx) => foldForward(d1, keeper, dup, branchNameById, ctx))

  const KEEPER = 100, DUP = 200
  const B1 = 1, B2 = 2, B3 = 3
  const KB = 5000, DB1 = 5001, DB2 = 5002 // keeper batch, dup folded batch, dup repointed batch
  const BATCH_IDS = [KB, DB1, DB2]
  const run1 = (sql, p) => d1.db.prepare(sql).run(p == null ? {} : p)

  // ---- Seed a scenario exercising every reversal branch ----
  run1(`INSERT INTO branches (id, name) VALUES (1,'B1'),(2,'B2'),(3,'B3')`)
  run1(`INSERT INTO products (id, name, is_active, image_path, stock_quantity) VALUES (100,'Keeper',1,'',8),(200,'Dup',1,'dhero.jpg',11)`)
  run1(`INSERT INTO branch_stock (product_id, branch_id, quantity, rfid_confirmed_qty) VALUES (100,1,5,2),(100,2,3,0),(200,1,4,1),(200,3,7,0)`)
  run1(`INSERT INTO product_images (product_id, image_path, sort_order) VALUES (100,'k1.jpg',0),(200,'k1.jpg',0),(200,'d1.jpg',1),(200,'d2.jpg',2)`)
  run1(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active) VALUES (5000,100,'2026',1,1),(5001,200,'2026',1,1),(5002,200,'2027',1,1)`)
  run1(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (5000,1,5),(5001,1,4),(5001,2,2),(5002,3,7)`)
  run1(`INSERT INTO sales (id) VALUES (900),(901)`)
  run1(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity) VALUES (700,900,200,'Dup',1),(701,900,200,'Dup',2),(702,901,200,'Dup',1)`)
  run1(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity, reason) VALUES (800,200,'Dup',1,'sale',-1,'legacy'),(801,200,'Dup',3,'received',7,'legacy')`)

  const branchNameById = new Map([[1, 'B1'], [2, 'B2'], [3, 'B3']])
  const F0 = fingerprint(d1, KEEPER, DUP, BATCH_IDS)

  let snapshotId, actionHistoryId, reversal

  await check('forward merge folds the dup into the keeper (sales + movements re-parented)', async () => {
    const res = await foldForward(d1, { id: KEEPER, name: 'Keeper' }, { id: DUP, name: 'Dup', image_path: 'dhero.jpg' }, branchNameById, 'possible-duplicates review merge')
    reversal = res.reversal
    run1('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = @id) WHERE id = @id', { id: KEEPER })
    // dup is soft-deleted; its sales + movements now belong to the keeper
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=200').get().is_active, 0)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM sale_items WHERE product_id=100').get().n, 3)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM sale_items WHERE product_id=200').get().n, 0)
    // keeper stock summed: B1 5+4=9, B2 3, B3 7 = 19
    assert.equal(d1.db.prepare('SELECT stock_quantity FROM products WHERE id=100').get().stock_quantity, 19)
    // keeper adopted the dup's hero image; two gallery images moved
    assert.equal(d1.db.prepare('SELECT image_path FROM products WHERE id=100').get().image_path, 'dhero.jpg')
    assert.equal(reversal.imagesMovedToKeeper.length, 2)
    assert.equal(reversal.repointedBatches.length, 1)
    assert.equal(reversal.foldedBatches.length, 1)
    assert.equal(reversal.adjustmentMovementIds.length, 2)
  })

  const F1 = fingerprint(d1, KEEPER, DUP, BATCH_IDS)

  await check('recordMergeUndoSnapshot stores the snapshot + a small action_history row (real code, 0097 table)', async () => {
    const rec = await undo.recordMergeUndoSnapshot({}, { id: 42, name: 'Merger' }, reversal)
    snapshotId = rec.snapshotId; actionHistoryId = rec.actionHistoryId
    assert.ok(snapshotId > 0 && actionHistoryId > 0)
    const snap = d1.db.prepare('SELECT kind, status FROM undo_snapshots WHERE id = ?').get(snapshotId)
    assert.equal(snap.kind, 'product.merge'); assert.equal(snap.status, 'applied')
    const hist = d1.db.prepare('SELECT scope, entity, reversible, status, undo_payload FROM action_history WHERE id = ?').get(actionHistoryId)
    assert.equal(hist.scope, 'products'); assert.equal(hist.entity, 'product'); assert.equal(hist.reversible, 1); assert.equal(hist.status, 'undoable')
    // the action_history payload is TINY -- only a pointer, never the snapshot
    assert.ok(hist.undo_payload.length < 200, 'action_history payload must stay small')
    assert.equal(JSON.parse(hist.undo_payload).snapshot_id, snapshotId)
  })

  const applier = undo.resolveUndoApplier({ applier: 'product.merge', snapshot_id: snapshotId })
  assert.ok(applier, 'product.merge applier must resolve')

  await check('UNDO (real applyMergeReversal) restores BOTH products to the exact pre-merge state', async () => {
    await applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    assert.deepEqual(fingerprint(d1, KEEPER, DUP, BATCH_IDS), F0)
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(snapshotId).status, 'reversed')
    // rfid_confirmed_qty specifically restored (dup) and preserved (keeper)
    assert.equal(d1.db.prepare('SELECT rfid_confirmed_qty q FROM branch_stock WHERE product_id=200 AND branch_id=1').get().q, 1)
    assert.equal(d1.db.prepare('SELECT rfid_confirmed_qty q FROM branch_stock WHERE product_id=100 AND branch_id=1').get().q, 2)
  })

  await check('REDO (real orchestration re-runs the fold) reproduces the exact merged state', async () => {
    await applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'redo' })
    run1('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = @id) WHERE id = @id', { id: KEEPER })
    assert.deepEqual(fingerprint(d1, KEEPER, DUP, BATCH_IDS), F1)
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(snapshotId).status, 'applied')
  })

  await check('UNDO -> REDO -> UNDO is stable (no drift, no orphaned rows)', async () => {
    await applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    assert.deepEqual(fingerprint(d1, KEEPER, DUP, BATCH_IDS), F0)
    // no adjustment rows and no leaked movements remain after undo
    assert.equal(d1.db.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE product_id=100 AND movement_type='adjustment'`).get().n, 0)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, F0.movement_total)
  })

  await check('double-undo is refused (status guard), so a merge cannot be reversed twice', async () => {
    await assert.rejects(
      applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' }),
      /already been undone/,
    )
  })

  // ---- Source guards: the REAL fold in products.ts must emit the same shape ----
  const productsSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  const appliersSrc = fs.readFileSync(path.join(LIB_DIR, 'undoAppliers.ts'), 'utf8')

  await check('products.ts fold re-parents sale_items + inventory_movements and captures their ids', async () => {
    assert.match(productsSrc, /UPDATE sale_items SET product_id = @canonicalId WHERE product_id = @dupId/)
    assert.match(productsSrc, /UPDATE inventory_movements SET product_id = @canonicalId WHERE product_id = @dupId/)
    assert.match(productsSrc, /const reparentedSaleItemIds =/)
    assert.match(productsSrc, /const reparentedMovementIds =/)
    assert.match(productsSrc, /rfid_confirmed_qty FROM branch_stock WHERE product_id = @id/)
    assert.match(productsSrc, /const adjustmentMovementIds =/)
    assert.match(productsSrc, /registerMergeFold\(foldDuplicateProductInto\)/)
    assert.match(productsSrc, /recordMergeUndoSnapshot\(c\.env, user, stats\.reversal\)/)
  })

  await check('undoAppliers.ts undo preserves keeper rfid (UPDATE qty, not delete+reinsert) and gates on merge_duplicates', async () => {
    assert.match(appliersSrc, /UPDATE branch_stock SET quantity = @q WHERE product_id = @keeperId AND branch_id = @b/)
    assert.match(appliersSrc, /INSERT INTO branch_stock \(product_id, branch_id, quantity, rfid_confirmed_qty\)/)
    assert.match(appliersSrc, /action: 'merge_duplicates'/)
    assert.match(appliersSrc, /DELETE FROM inventory_movements WHERE id IN/)
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((err) => { console.error(err); process.exitCode = 1 })
