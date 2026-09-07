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
// N13: the actor snapshot kernel, loaded for REAL. It is pure (no imports of
// its own) and the whole point of it is WHICH identity it picks, so a stub
// would be testing the stub.
let actorSnapshotCache = null
let productMergeCache = null
function loadRealActorSnapshot() {
  if (actorSnapshotCache) return actorSnapshotCache
  const file = path.join(LIB_DIR, 'actorSnapshot.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'actorSnapshot.ts',
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  actorSnapshotCache = mod.exports
  return actorSnapshotCache
}
function loadRealProductMerge() {
  if (productMergeCache) return productMergeCache
  const file = path.join(LIB_DIR, 'productMerge.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'productMerge.ts',
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  productMergeCache = mod.exports
  return productMergeCache
}
function loadUndoAppliers(d1) {
  const readBatches = []
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
    batch: (stmts) => {
      const readOnly = stmts.every((stmt) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(stmt.sql))
      if (!readOnly) return d1.batch(stmts)
      readBatches.push(stmts)
      return Promise.resolve(stmts.map((stmt) => ({
        success: true,
        results: d1.prepare(stmt.sql).all(stmt.params == null ? {} : stmt.params),
      })))
    },
  }
  const stubs = {
    './actorSnapshot': loadRealActorSnapshot(),
    './productMerge': loadRealProductMerge(),
    // Bulk status replay is outside this suite; fail if it is invoked.
    './saleBulkStatus': {
      replaySaleBulkStatus: () => { throw new Error('Unexpected bulk status replay in test-product-merge-undo-pure.cjs') },
    },
    './saleBulkUpdate': {
      BULK_UPDATE_KIND: 'sale.fields.bulk',
      BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk',
      replaySaleBulkUpdate: () => { throw new Error('Unexpected bulk sale update replay in test-product-merge-undo-pure.cjs') },
    },
    './returnBulkAction': {
      RETURN_BULK_ACTION_KIND: 'return.fields.bulk',
      replayReturnBulkAction: () => { throw new Error('Unexpected return bulk replay in test-product-merge-undo-pure.cjs') },
    },
    './saleSettlementAction': {
      SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement',
      replaySaleSettlementAction: () => { throw new Error('Unexpected settlement replay in product merge fixture; use test-payment-fx-pure.cjs') },
    },
    './stockSession': {
      STOCK_SESSION_KIND: 'stock.session',
      replayStockSession: () => { throw new Error('Unexpected stock replay in product merge fixture; use test-stock-session-undo.cjs') },
    },
    '../index': {},
    './auth': {},
    './db': { getDb: () => dbAdapter },
    './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    // S4-24b: the 'sale.add_items' applier's planners. This file exercises the
    // merge appliers only, so these stubs exist to let the module load; the
    // real planners are driven against a live schema by
    // test-sale-add-items-pure.cjs, which is where that applier is proved.
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
  mod.exports.__testDbAdapter = dbAdapter
  mod.exports.__testReadBatches = readBatches
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
      const saleAllocationIds = d1.db.prepare('SELECT id FROM sale_item_batch_allocations WHERE batch_id = ?').all(batchRow.id).map((r) => Number(r.id))
      stmts.push({ sql: 'UPDATE sale_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId', params: { keeperBatchId: existingCanonicalBatchId, dupBatchId: batchRow.id } })
      foldedBatches.push({ dupBatchId: batchRow.id, keeperBatchId: existingCanonicalBatchId, dupStockBefore: dupBatchStockRows.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })), keeperStockBefore: keeperBatchStockBefore.map((r) => ({ branch_id: r.branch_id, quantity: Number(r.quantity) || 0 })), saleAllocationIds })
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
    sale_allocations: q(`SELECT id, sale_item_id, batch_id, quantity, released_quantity FROM sale_item_batch_allocations WHERE batch_id IN ${bids} ORDER BY id`),
    // Only the historical (non-adjustment) movements carry stable identity;
    // the fold's 'adjustment' rows are ephemeral markers that redo legitimately
    // regenerates with fresh ids (asserted by count, not identity).
    movements_owner: q(`SELECT id, product_id FROM inventory_movements WHERE product_id IN ${ids} AND movement_type <> 'adjustment' ORDER BY id`),
    adjustment_count: q(`SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id = ${keeperId} AND movement_type='adjustment'`)[0].n,
    movement_total: q(`SELECT COUNT(*) AS n FROM inventory_movements`)[0].n,
  }
}

// Generic fingerprint over any set of products + batches (bulk scenario).
function fingerprintMany(d1, productIds, batchIds) {
  const q = (sql, ...a) => d1.db.prepare(sql).all(...a)
  const pids = `(${productIds.join(',')})`
  const bids = `(${batchIds.join(',')})`
  return {
    products: q(`SELECT id, is_active, image_path, stock_quantity FROM products WHERE id IN ${pids} ORDER BY id`),
    branch_stock: q(`SELECT product_id, branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id IN ${pids} ORDER BY product_id, branch_id`),
    product_images: q(`SELECT product_id, image_path, sort_order FROM product_images WHERE product_id IN ${pids} ORDER BY product_id, image_path`),
    product_batches: q(`SELECT id, variant_product_id, batch_number, is_active FROM product_batches WHERE id IN ${bids} ORDER BY id`),
    branch_batch_stock: q(`SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN ${bids} ORDER BY batch_id, branch_id`),
    sale_items: q(`SELECT id, product_id FROM sale_items WHERE product_id IN ${pids} ORDER BY id`),
    movements_owner: q(`SELECT id, product_id FROM inventory_movements WHERE product_id IN ${pids} AND movement_type <> 'adjustment' ORDER BY id`),
    movement_total: q(`SELECT COUNT(*) AS n FROM inventory_movements`)[0].n,
  }
}

// Reference implementation of the pre-batching merge fingerprint. Keeping
// this serial in the test proves that fewer adapter calls do not change the
// optimistic-CAS bytes, row ordering, or the set of protected rows.
async function serialMergeStateFingerprint(d1, reversals, reparentTables) {
  const chunks = (values, size = 80) => {
    const out = []
    for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
    return out
  }
  const intIds = (values) => (Array.isArray(values) ? values : [])
    .map(Number).filter((value) => Number.isInteger(value) && value > 0)
  const all = (sql, params = []) => d1.prepare(sql).all(params)
  const productIds = [...new Set(reversals.flatMap((row) => [Number(row.keeperId), Number(row.dupId)])
    .filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
  if (!productIds.length) return ''

  const products = [], branchStock = [], batches = [], movementHeads = []
  for (const ids of chunks(productIds)) {
    const placeholders = ids.map(() => '?').join(',')
    products.push(...all(`SELECT * FROM products WHERE id IN (${placeholders})`, ids))
    branchStock.push(...all(`SELECT product_id, branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id IN (${placeholders})`, ids))
    batches.push(...all(`SELECT id, variant_product_id, batch_key, batch_number, is_active FROM product_batches WHERE variant_product_id IN (${placeholders})`, ids))
    movementHeads.push(...all(`SELECT product_id, MAX(id) AS max_id, COUNT(*) AS row_count FROM inventory_movements WHERE product_id IN (${placeholders}) GROUP BY product_id`, ids))
  }
  const savedBatchIds = reversals.flatMap((row) => [
    ...(row.repointedBatches || []).map((batch) => Number(batch.id)),
    ...(row.foldedBatches || []).flatMap((batch) => [Number(batch.dupBatchId), Number(batch.keeperBatchId)]),
    ...(row.writtenOffBatches || []).map((batch) => Number(batch.batchId)),
  ])
  const batchIds = [...new Set([...batches.map((batch) => Number(batch.id)), ...savedBatchIds]
    .filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
  const batchStock = []
  for (const ids of chunks(batchIds)) {
    batchStock.push(...all(`SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN (${ids.map(() => '?').join(',')})`, ids))
  }
  const productImages = [], stockSessions = []
  for (const ids of chunks(productIds)) {
    const placeholders = ids.map(() => '?').join(',')
    productImages.push(...all(`SELECT * FROM product_images WHERE product_id IN (${placeholders})`, ids))
    stockSessions.push(...all(`SELECT * FROM stock_session_members WHERE product_id IN (${placeholders})`, ids))
  }
  const adjustmentRows = []
  for (const reversal of reversals) {
    if (reversal.adjustmentMovementMarker) {
      adjustmentRows.push(...all('SELECT * FROM inventory_movements WHERE product_id=? AND reason LIKE ?', [reversal.keeperId, `%${reversal.adjustmentMovementMarker}%`]))
    } else {
      for (const ids of chunks(intIds(reversal.adjustmentMovementIds))) {
        adjustmentRows.push(...all(`SELECT * FROM inventory_movements WHERE id IN (${ids.map(() => '?').join(',')})`, ids))
      }
    }
  }
  const linkedRows = {}
  for (const entry of reparentTables) {
    const ids = [...new Set(reversals.flatMap((row) => (row.reparentedByTable || [])
      .filter((saved) => saved.table === entry.table && saved.column === entry.column)
      .flatMap((saved) => intIds(saved.ids))))]
    if (!ids.length) continue
    const rows = []
    for (const group of chunks(ids)) rows.push(...all(`SELECT * FROM ${entry.table} WHERE id IN (${group.map(() => '?').join(',')})`, group))
    linkedRows[`${entry.table}.${entry.column}`] = rows
  }
  const promotionIds = [...new Set(reversals.flatMap((row) => (row.promotionRulesBefore || []).map((item) => Number(item.id)))
    .filter((id) => Number.isInteger(id) && id > 0))]
  const promotionRules = []
  for (const ids of chunks(promotionIds)) promotionRules.push(...all(`SELECT * FROM promotion_rules WHERE id IN (${ids.map(() => '?').join(',')})`, ids))
  const childIds = [...new Set(reversals.flatMap((row) => intIds(row.reparentedChildProductIds)))]
  const childProducts = []
  for (const ids of chunks(childIds)) childProducts.push(...all(`SELECT id,parent_id,updated_at FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ids))
  const allocationIds = {
    sale: [...new Set(reversals.flatMap((row) => (row.foldedBatches || []).flatMap((batch) => intIds(batch.saleAllocationIds))))],
    returns: [...new Set(reversals.flatMap((row) => (row.foldedBatches || []).flatMap((batch) => intIds(batch.returnAllocationIds))))],
  }
  const saleAllocations = [], returnAllocations = []
  for (const ids of chunks(allocationIds.sale)) saleAllocations.push(...all(`SELECT * FROM sale_item_batch_allocations WHERE id IN (${ids.map(() => '?').join(',')})`, ids))
  for (const ids of chunks(allocationIds.returns)) returnAllocations.push(...all(`SELECT * FROM return_item_batch_allocations WHERE id IN (${ids.map(() => '?').join(',')})`, ids))

  const byNumbers = (keys) => (left, right) => {
    for (const key of keys) {
      const difference = Number(left[key]) - Number(right[key])
      if (difference) return difference
    }
    return 0
  }
  products.sort(byNumbers(['id']))
  branchStock.sort(byNumbers(['product_id', 'branch_id']))
  batches.sort(byNumbers(['id']))
  batchStock.sort(byNumbers(['batch_id', 'branch_id']))
  movementHeads.sort(byNumbers(['product_id']))
  adjustmentRows.sort(byNumbers(['id']))
  productImages.sort(byNumbers(['id']))
  stockSessions.sort((a, b) => String(a.operation_id).localeCompare(String(b.operation_id)) || Number(a.product_id) - Number(b.product_id))
  promotionRules.sort(byNumbers(['id']))
  childProducts.sort(byNumbers(['id']))
  saleAllocations.sort(byNumbers(['id']))
  returnAllocations.sort(byNumbers(['id']))
  for (const rows of Object.values(linkedRows)) rows.sort(byNumbers(['id']))
  return JSON.stringify({ products, branchStock, batches, batchStock, movementHeads, adjustmentRows, productImages, stockSessions, linkedRows, promotionRules, childProducts, saleAllocations, returnAllocations })
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
  run1(`INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (750,700,5001,1,1,0)`)
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
    assert.equal(d1.db.prepare('SELECT batch_id FROM sale_item_batch_allocations WHERE id=750').get().batch_id, KB, 'historical allocation follows the active keeper lot')
    assert.equal(reversal.adjustmentMovementIds.length, 2)
  })

  const F1 = fingerprint(d1, KEEPER, DUP, BATCH_IDS)

  await check('batched merge fingerprint is byte-equivalent to the serial CAS fingerprint', async () => {
    const serial = await serialMergeStateFingerprint(d1, [reversal], undo.MERGE_REPARENT_TABLES)
    const before = undo.__testReadBatches.length
    const batched = await undo.mergeStateFingerprint(undo.__testDbAdapter, [reversal])
    assert.equal(batched, serial)
    assert.equal(undo.__testReadBatches.length, before + 1, 'the complete fingerprint uses one adapter batch')
    for (const statement of undo.__testReadBatches.at(-1)) {
      const bindCount = Array.isArray(statement.params)
        ? statement.params.length
        : Object.keys(statement.params || {}).length
      assert.ok(bindCount <= 80, `fingerprint statement exceeded 80 binds: ${bindCount}`)
    }
  })

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

  await check('post-commit history lookup failure returns a stable pending reconciliation receipt', async () => {
    const operationId = 'committed-merge-overload'
    const result = await undo.finalizeAtomicMergeHistory({}, operationId, reversal, {
      prepare: () => ({
        get: async () => { throw new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.') },
      }),
      batch: async () => { throw new Error('finalization batch must not run after lookup failure') },
    })
    assert.deepEqual(result, {
      operationId,
      committed: true,
      snapshotId: null,
      actionHistoryId: null,
      historyResolved: false,
      fingerprintReady: false,
    })
  })

  // ---- Source guards: the REAL fold in products.ts must emit the same shape ----
  const productsSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  const appliersSrc = fs.readFileSync(path.join(LIB_DIR, 'undoAppliers.ts'), 'utf8')
  const snapshotSrc = fs.readFileSync(path.join(LIB_DIR, 'productMergeSnapshot.ts'), 'utf8')

  await check('products.ts fold re-parents sale_items + inventory_movements and captures their ids', async () => {
    // The batched snapshot must still be driven by MERGE_REPARENT_TABLES (the
    // one list undoAppliers.ts and the fold share), and the route may only
    // replay the exact ids returned by that snapshot.
    assert.match(productsSrc, /UPDATE \$\{table\} SET \$\{column\} = @canonicalId WHERE \$\{column\} = @dupId/)
    assert.match(productsSrc, /readProductMergeCaseSnapshot\(db, canonicalId, dup\.id, MERGE_REPARENT_TABLES\)/)
    assert.match(productsSrc, /const reparentedByTable = snapshot\.reparentedByTable/)
    assert.match(productsSrc, /for \(const \{ table, column, ids \} of reparentedByTable\)/)
    assert.match(snapshotSrc, /\.\.\.reparentTables\.map\(\(\{ table, column \}, index\) =>/)
    assert.match(snapshotSrc, /sql: `SELECT id FROM \$\{table\} WHERE \$\{column\} = @id`/)
    assert.match(appliersSrc, /\{ table: 'sale_items', column: 'product_id' \}/)
    assert.match(appliersSrc, /\{ table: 'inventory_movements', column: 'product_id' \}/)
    assert.match(productsSrc, /const reparentedSaleItemIds = byTable\('sale_items'\)/)
    assert.match(productsSrc, /const reparentedMovementIds = byTable\('inventory_movements'\)/)
    assert.match(snapshotSrc, /rfid_confirmed_qty FROM branch_stock WHERE product_id = @id/)
    assert.match(productsSrc, /const adjustmentMovementIds =/)
    assert.match(productsSrc, /registerMergeFold\(foldDuplicateProductInto\)/)
    assert.match(productsSrc, /buildAtomicMergeHistoryStatements\(user, reversal, atomicHistory\.operationId, auditDetails\)/)
    assert.match(productsSrc, /await finalizeAtomicMergeHistory\(env, atomicHistory\.operationId, reversal, db\)/)
    assert.match(appliersSrc, /VALUES\('products','product',@entityId,@label,@undoLabel,@redoLabel,0,'recorded'/)
    assert.match(appliersSrc, /UPDATE action_history SET reversible=1,status='undoable'/)
  })

  await check('undoAppliers.ts undo preserves keeper rfid (UPDATE qty, not delete+reinsert) and gates on merge_duplicates', async () => {
    assert.match(appliersSrc, /UPDATE branch_stock SET quantity = @q WHERE product_id = @keeperId AND branch_id = @b/)
    assert.match(appliersSrc, /INSERT INTO branch_stock \(product_id, branch_id, quantity, rfid_confirmed_qty\)/)
    assert.match(appliersSrc, /action: 'merge_duplicates'/)
    assert.match(appliersSrc, /DELETE FROM inventory_movements WHERE id IN/)
    assert.match(productsSrc, /UPDATE sale_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId/)
    assert.match(productsSrc, /UPDATE return_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId/)
    assert.match(appliersSrc, /This merge has later stock or batch activity/)
  })

  await check('image-denied image-free undo omits image SQL and preserves a concurrent keeper cover', async () => {
    const statement = undo.mergeKeeperRestoreStatement({
      keeperId: KEEPER,
      dupId: DUP,
      keeperImagePathBefore: null,
      dupImagesBefore: [],
      imagesMovedToKeeper: [],
    }, false)
    assert.doesNotMatch(statement.sql, /image_path/)
    assert.equal(Object.prototype.hasOwnProperty.call(statement.params, 'path'), false)
    d1.db.prepare("UPDATE products SET image_path='/uploads/concurrent.png' WHERE id=?").run(KEEPER)
    d1.db.prepare(statement.sql).run(statement.params)
    assert.equal(d1.db.prepare('SELECT image_path FROM products WHERE id=?').get(KEEPER).image_path, '/uploads/concurrent.png')
  })

  await check('undo refuses a merge after later stock activity', async () => {
    await applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'redo' })
    run1('UPDATE branch_stock SET quantity = quantity + 1 WHERE product_id = @productId AND branch_id = @branchId', { productId: KEEPER, branchId: B1 })
    await assert.rejects(
      applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' }),
      /later stock or batch activity/,
    )
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=?').get(DUP).is_active, 0, 'refusal mutates nothing')
  })

}

// A bounded bulk cluster may be applied one duplicate at a time, but its cost
// is resolved once from every original member. Redo must therefore replay the
// saved cluster economics rather than average the keeper's restored 4 with the
// current duplicate's 5 (which would drift to 4.5 and lose the original 6).
async function runSavedClusterEconomics() {
  console.log('\n-- saved bulk-cluster economics across undo/redo --')
  const d1 = openDb(loadAll())
  const undo = loadUndoAppliers(d1)
  const productMerge = loadRealProductMerge()
  const run1 = (sql, p) => d1.db.prepare(sql).run(p == null ? {} : p)

  run1(`INSERT INTO products (
    id, name, barcode, is_active,
    selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr,
    cost_price_usd, cost_price_khr, stock_quantity
  ) VALUES
    (1,'Planned Item','PLAN-1',1,10,41000,9,36900,4,4000,0),
    (2,'Planned Item','PLAN-1',1,10,41000,9,36900,5,5000,0),
    (3,'Planned Item','PLAN-1',1,10,41000,9,36900,6,6000,0)`)

  const planRows = d1.db.prepare(`
    SELECT id, updated_at,
           selling_price_usd, selling_price_khr,
           wholesale_price_usd, wholesale_price_khr,
           cost_price_usd, cost_price_khr
      FROM products
     WHERE id IN (1,2,3)
     ORDER BY id
  `).all()
  const clusterPlan = productMerge.createProductMergeClusterPlan('planned item\u0001plan-1', 1, planRows)
  const plannedEconomics = productMerge.resolveProductMergeClusterPlanEconomics(clusterPlan)
  assert.equal(plannedEconomics.merged.cost_price_usd, 5)
  assert.equal(plannedEconomics.merged.cost_price_khr, 5000)

  const observedRedoCosts = []
  const foldWithEconomics = async (_env, _db, _user, keeper, dup, branchNameById, ctx, _stockDisposition, economicsOverride) => {
    const before = d1.db.prepare(`
      SELECT selling_price_usd, selling_price_khr,
             wholesale_price_usd, wholesale_price_khr,
             cost_price_usd, cost_price_khr
        FROM products WHERE id = ?
    `).get(keeper.id)
    const result = await foldForward(d1, keeper, dup, branchNameById, ctx)
    const economics = economicsOverride || productMerge.resolveProductMergeEconomics([
      { id: keeper.id, ...before },
      d1.db.prepare(`
        SELECT id, selling_price_usd, selling_price_khr,
               wholesale_price_usd, wholesale_price_khr,
               cost_price_usd, cost_price_khr
          FROM products WHERE id = ?
      `).get(dup.id),
    ])
    if (economicsOverride) observedRedoCosts.push(economics.merged.cost_price_usd)
    run1(`UPDATE products
             SET selling_price_usd=@sellingUsd,
                 selling_price_khr=@sellingKhr,
                 wholesale_price_usd=@wholesaleUsd,
                 wholesale_price_khr=@wholesaleKhr,
                 cost_price_usd=@costUsd,
                 cost_price_khr=@costKhr,
                 updated_at=CURRENT_TIMESTAMP
           WHERE id=@id`, {
      id: keeper.id,
      sellingUsd: economics.merged.selling_price_usd ?? before.selling_price_usd,
      sellingKhr: economics.merged.selling_price_khr ?? before.selling_price_khr,
      wholesaleUsd: economics.merged.wholesale_price_usd ?? before.wholesale_price_usd,
      wholesaleKhr: economics.merged.wholesale_price_khr ?? before.wholesale_price_khr,
      costUsd: economics.merged.cost_price_usd ?? before.cost_price_usd,
      costKhr: economics.merged.cost_price_khr ?? before.cost_price_khr,
    })
    result.reversal.keeperPricingBefore = {
      selling_price_usd: Number(before.selling_price_usd),
      selling_price_khr: Number(before.selling_price_khr),
      wholesale_price_usd: Number(before.wholesale_price_usd),
      wholesale_price_khr: Number(before.wholesale_price_khr),
      cost_price_usd: Number(before.cost_price_usd),
      cost_price_khr: Number(before.cost_price_khr),
    }
    return result
  }
  undo.registerMergeFold(foldWithEconomics)

  const first = await foldWithEconomics(
    {}, undo.__testDbAdapter, { id: 42 },
    { id: 1, name: 'Planned Item' },
    { id: 2, name: 'Planned Item', image_path: null },
    new Map(), 'bounded duplicate cleanup', 'merge', plannedEconomics,
  )
  first.reversal.bulkClusterPlan = clusterPlan
  const recorded = await undo.recordMergeUndoSnapshot({}, { id: 42, name: 'Merger' }, first.reversal)
  const applier = undo.resolveUndoApplier({ applier: 'product.merge', snapshot_id: recorded.snapshotId })
  assert.ok(applier, 'product.merge applier must resolve for a planned cluster fold')
  observedRedoCosts.length = 0

  await check('4/5/6 cluster redo keeps the original mean at 5 across repeated undo/redo', async () => {
    assert.equal(d1.db.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd, 5)
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await applier.run(
        { applier: 'product.merge', snapshot_id: recorded.snapshotId },
        { env: {}, user: { id: 42 }, direction: 'undo' },
      )
      assert.equal(d1.db.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd, 4)
      assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 1)

      await applier.run(
        { applier: 'product.merge', snapshot_id: recorded.snapshotId },
        { env: {}, user: { id: 42 }, direction: 'redo' },
      )
      const redone = d1.db.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id=1').get()
      assert.equal(redone.cost_price_usd, 5)
      assert.notEqual(redone.cost_price_usd, 4.5)
      assert.equal(redone.cost_price_khr, 5000)
      const saved = JSON.parse(d1.db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(recorded.snapshotId).payload_json)
      assert.deepEqual(saved.bulkClusterPlan, clusterPlan, 'redo snapshot must retain the immutable original cluster plan')
    }
    assert.deepEqual(observedRedoCosts, [5, 5], 'every redo uses the saved 4/5/6 cluster mean')
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=3').get().is_active, 1, 'the remaining cluster member is untouched')
  })
}

// --------------------------------------------------------------------------
// Bulk composite: the whole-catalog POST /merge-duplicates folds MANY dups in
// ONE run and records ONE undoable action (recordBulkMergeUndoSnapshot +
// the 'product.merge.bulk' applier). This proves the ORDER-DEPENDENT round-
// trip: within group A, dup 202's '2027' batch folds into the very batch dup
// 201 just repointed onto the keeper, so undo MUST replay in reverse and redo
// forward. Exact F0/F1 fingerprints across undo -> redo -> undo prove it.
// --------------------------------------------------------------------------
async function runBulk() {
  console.log('\n-- bulk composite merge (whole-catalog cleanup) --')
  const d1 = openDb(loadAll())
  const undo = loadUndoAppliers(d1)
  undo.registerMergeFold((env, _db, _user, keeper, dup, branchNameById, ctx) => foldForward(d1, keeper, dup, branchNameById, ctx))
  const run1 = (sql, p) => d1.db.prepare(sql).run(p == null ? {} : p)

  // Group A: keeper 100 <- dups 201, 202 (in that order). Group B: keeper 300 <- dup 301.
  const PIDS = [100, 201, 202, 300, 301]
  const BIDS = [6000, 6001, 6002, 6003, 6100, 6101, 6102]
  run1(`INSERT INTO branches (id, name) VALUES (1,'B1'),(2,'B2'),(3,'B3')`)
  run1(`INSERT INTO products (id, name, is_active, image_path, stock_quantity) VALUES
    (100,'KeeperA',1,'ka.jpg',8),(201,'DupA1',1,'d1.jpg',11),(202,'DupA2',1,'d2.jpg',3),
    (300,'KeeperB',1,'kb.jpg',6),(301,'DupB1',1,'d3.jpg',10)`)
  run1(`INSERT INTO branch_stock (product_id, branch_id, quantity, rfid_confirmed_qty) VALUES
    (100,1,5,2),(100,2,3,0),(201,1,4,1),(201,3,7,0),(202,2,2,0),(202,3,1,0),
    (300,1,6,3),(301,2,8,0),(301,3,2,1)`)
  run1(`INSERT INTO product_images (product_id, image_path, sort_order) VALUES
    (100,'ka.jpg',0),(201,'g1.jpg',0),(202,'g2.jpg',0),(300,'kb.jpg',0),(301,'g3.jpg',0)`)
  // 6001 (201/'2027') repoints onto 100; 6002 (202/'2027') then folds into 6001; 6003 (202/'2028') repoints.
  // 6101 (301/'2030') folds into keeper batch 6100; 6102 (301/'2031') repoints.
  run1(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active) VALUES
    (6000,100,'2026',1,1),(6001,201,'2027',1,1),(6002,202,'2027',1,1),(6003,202,'2028',1,1),
    (6100,300,'2030',1,1),(6101,301,'2030',1,1),(6102,301,'2031',1,1)`)
  run1(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES
    (6000,1,5),(6001,1,4),(6001,2,2),(6002,1,1),(6002,3,1),(6003,3,1),
    (6100,1,6),(6101,1,6),(6102,2,8)`)
  run1(`INSERT INTO sales (id) VALUES (910),(911)`)
  run1(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity) VALUES
    (720,910,201,'DupA1',1),(721,910,202,'DupA2',2),(722,911,301,'DupB1',1)`)
  run1(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity, reason) VALUES
    (820,201,'DupA1',1,'sale',-1,'legacy'),(821,202,'DupA2',3,'received',1,'legacy'),(822,301,'DupB1',2,'received',8,'legacy')`)

  const branchNameById = new Map([[1, 'B1'], [2, 'B2'], [3, 'B3']])
  const F0 = fingerprintMany(d1, PIDS, BIDS)

  // Drive the forward run exactly as the route does: fold each dup in order,
  // collect reversals, recompute each keeper, then record ONE composite action.
  const plan = [
    { keeper: { id: 100, name: 'KeeperA' }, dup: { id: 201, name: 'DupA1', image_path: 'd1.jpg' } },
    { keeper: { id: 100, name: 'KeeperA' }, dup: { id: 202, name: 'DupA2', image_path: 'd2.jpg' } },
    { keeper: { id: 300, name: 'KeeperB' }, dup: { id: 301, name: 'DupB1', image_path: 'd3.jpg' } },
  ]
  const reversals = []
  for (const step of plan) {
    const res = await foldForward(d1, step.keeper, step.dup, branchNameById, 'branch-only duplicate cleanup')
    reversals.push(res.reversal)
  }
  for (const kid of [100, 300]) run1('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = @id) WHERE id = @id', { id: kid })
  const F1 = fingerprintMany(d1, PIDS, BIDS)

  let snapshotId, actionHistoryId

  await check('the order-dependent fold actually happened (202 folded into the batch 201 repointed onto the keeper)', async () => {
    // dup 202's '2027' batch (6002) is soft-deleted, folded into 6001 (now on 100)
    assert.equal(d1.db.prepare('SELECT is_active FROM product_batches WHERE id=6002').get().is_active, 0)
    assert.equal(d1.db.prepare('SELECT variant_product_id FROM product_batches WHERE id=6001').get().variant_product_id, 100)
    // 6001 branch 1 now holds 201's 4 + 202's 1 = 5
    assert.equal(d1.db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=6001 AND branch_id=1').get().q, 5)
    // all three dups soft-deleted; all their sale_items re-parented
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM products WHERE id IN (201,202,301) AND is_active=0').get().n, 3)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM sale_items WHERE product_id IN (201,202,301)').get().n, 0)
  })

  await check('recordBulkMergeUndoSnapshot stores ONE snapshot + ONE small action_history row for the whole run', async () => {
    const rec = await undo.recordBulkMergeUndoSnapshot({}, { id: 42, name: 'Merger' }, reversals)
    snapshotId = rec.snapshotId; actionHistoryId = rec.actionHistoryId
    assert.ok(snapshotId > 0 && actionHistoryId > 0)
    const snap = d1.db.prepare('SELECT kind, status, payload_json FROM undo_snapshots WHERE id = ?').get(snapshotId)
    assert.equal(snap.kind, 'product.merge.bulk'); assert.equal(snap.status, 'applied')
    assert.equal(JSON.parse(snap.payload_json).reversals.length, 3)
    const hist = d1.db.prepare('SELECT scope, entity, reversible, status, label, undo_payload FROM action_history WHERE id = ?').get(actionHistoryId)
    assert.equal(hist.scope, 'products'); assert.equal(hist.reversible, 1); assert.equal(hist.status, 'undoable')
    assert.equal(hist.label, 'Merged 3 duplicate products')
    assert.ok(hist.undo_payload.length < 200, 'action_history payload must stay small (points at the snapshot)')
    assert.equal(JSON.parse(hist.undo_payload).applier, 'product.merge.bulk')
    // exactly one composite history row for the whole run -- not three
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, 1)
  })

  const applier = undo.resolveUndoApplier({ applier: 'product.merge.bulk', snapshot_id: snapshotId })
  assert.ok(applier, 'product.merge.bulk applier must resolve')
  assert.equal(applier.action, 'merge_duplicates')

  await check('UNDO replays reversals in REVERSE and restores every product to the exact pre-bulk state', async () => {
    await applier.run({ applier: 'product.merge.bulk', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    assert.deepEqual(fingerprintMany(d1, PIDS, BIDS), F0)
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(snapshotId).status, 'reversed')
    // no adjustment rows leaked onto either keeper
    assert.equal(d1.db.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE product_id IN (100,300) AND movement_type='adjustment'`).get().n, 0)
  })

  await check('REDO re-runs the folds FORWARD and reproduces the exact merged state', async () => {
    await applier.run({ applier: 'product.merge.bulk', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'redo' })
    assert.deepEqual(fingerprintMany(d1, PIDS, BIDS), F1)
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(snapshotId).status, 'applied')
    assert.equal(JSON.parse(d1.db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(snapshotId).payload_json).reversals.length, 3)
  })

  await check('UNDO -> REDO -> UNDO is stable and leaves no orphaned rows', async () => {
    await applier.run({ applier: 'product.merge.bulk', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' })
    assert.deepEqual(fingerprintMany(d1, PIDS, BIDS), F0)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, F0.movement_total)
  })

  await check('double-undo of the bulk action is refused (status guard)', async () => {
    await assert.rejects(
      applier.run({ applier: 'product.merge.bulk', snapshot_id: snapshotId }, { env: {}, user: { id: 42 }, direction: 'undo' }),
      /already been undone/,
    )
  })

  // Source guard: the real bulk route records every case with its own atomic
  // snapshot and carries the immutable cluster plan across retries.
  const productsSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  await check('products.ts bulk route records each fold atomically and persists the retry plan', async () => {
    assert.match(productsSrc, /const result = await foldDuplicateProductInto\(/)
    assert.match(productsSrc, /bulkClusterPlan: clusterPlan/)
    assert.match(productsSrc, /readAppliedBulkClusterPlan/)
    assert.match(productsSrc, /buildAtomicMergeHistoryStatements\(user, reversal, atomicHistory\.operationId, auditDetails\)/)
  })
}

async function main() {
  await run()
  await runSavedClusterEconomics()
  await runBulk()
  console.log(`\n${passed} check(s) passed.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
