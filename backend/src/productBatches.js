'use strict'

const { db } = require('./database')

const LEGACY_BACKFILL_CHUNK_SIZE = Math.max(1, Math.min(250, Number(process.env.BATCH_BACKFILL_CHUNK_SIZE || 25) || 25))
const LEGACY_BACKFILL_DELAY_MS = Math.max(0, Math.min(5000, Number(process.env.BATCH_BACKFILL_DELAY_MS || 50) || 50))
const legacyBackfillState = {
  scheduled: false,
  running: false,
  completedAt: '',
  lastError: '',
}

const RECEIVED_AT_ORDER_SQL = `
  CASE
    WHEN NULLIF(pb.received_at, '') IS NOT NULL
      AND NULLIF(pb.received_at, '') ~ '^\\d{4}-\\d{2}-\\d{2}([ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?$'
      THEN NULLIF(pb.received_at, '')::timestamptz
    ELSE pb.created_at
  END
`

function normalizeExpiryDate(value) {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

function normalizeLotCode(value) {
  const raw = String(value || '').trim()
  return raw || null
}

function isSellableProduct(product = {}) {
  return !(Number(product?.is_group || 0) === 1 && Number(product?.parent_id || 0) === 0)
}

function buildBatchKey({ lotCode = null, expiryDate = null, synthetic = false, fallback = 'open' } = {}) {
  const normalizedLot = normalizeLotCode(lotCode)
  const normalizedExpiry = normalizeExpiryDate(expiryDate)
  if (normalizedLot || normalizedExpiry) {
    return `lot:${normalizedLot || 'none'}|exp:${normalizedExpiry || 'none'}`
  }
  return `${synthetic ? 'legacy' : 'open'}:${fallback || 'open'}`
}

function getProductById(productId) {
  const numericId = Number.parseInt(productId, 10)
  if (!Number.isFinite(numericId) || numericId <= 0) return null
  return db.prepare('SELECT * FROM products WHERE id = ? LIMIT 1').get(numericId) || null
}

function getProductBatchIds(productId) {
  return db.prepare('SELECT id FROM product_batches WHERE variant_product_id = ?').all(productId).map((row) => row.id)
}

function getBatchRowsForProduct(productId) {
  return db.prepare(`
    SELECT *
    FROM product_batches
    WHERE variant_product_id = ?
    ORDER BY id ASC
  `).all(productId)
}

function getLegacyBatchBackfillCandidates(limit = LEGACY_BACKFILL_CHUNK_SIZE) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit || LEGACY_BACKFILL_CHUNK_SIZE) || LEGACY_BACKFILL_CHUNK_SIZE))
  return db.prepare(`
    SELECT p.id
    FROM products p
    LEFT JOIN product_batches pb ON pb.variant_product_id = p.id
    WHERE NOT (COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)
      AND pb.id IS NULL
    ORDER BY p.id ASC
    LIMIT ?
  `).all(safeLimit).map((row) => row.id)
}

function createOrFindProductBatch(productId, options = {}) {
  const product = getProductById(productId)
  if (!product) throw new Error('Product not found')
  if (!isSellableProduct(product)) throw new Error('Parent rows cannot own batches')

  const lotCode = normalizeLotCode(options.lotCode ?? options.lot_code)
  const expiryDate = normalizeExpiryDate(options.expiryDate ?? options.expiry_date ?? product.expiry_date)
  const synthetic = Number(options.synthetic ? 1 : 0)
  const batchKey = String(options.batchKey || buildBatchKey({
    lotCode,
    expiryDate,
    synthetic: !!synthetic,
    fallback: options.fallbackKey || 'open',
  })).trim()
  const receivedAt = options.receivedAt || options.received_at || product.created_at || null
  const notes = options.notes || null

  let batch = db.prepare(`
    SELECT *
    FROM product_batches
    WHERE variant_product_id = ? AND batch_key = ?
    LIMIT 1
  `).get(product.id, batchKey)

  if (!batch) {
    const inserted = db.prepare(`
      INSERT INTO product_batches (
        variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, synthetic
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run(
      product.id,
      batchKey,
      lotCode,
      expiryDate,
      receivedAt,
      options.is_active === 0 ? 0 : 1,
      notes,
      synthetic,
    )
    batch = db.prepare('SELECT * FROM product_batches WHERE id = ? LIMIT 1').get(inserted.lastInsertRowid)
  } else if (
    batch.lot_code !== lotCode
    || batch.expiry_date !== expiryDate
    || Number(batch.synthetic || 0) !== synthetic
    || (notes != null && notes !== batch.notes)
  ) {
    db.prepare(`
      UPDATE product_batches
      SET lot_code = ?, expiry_date = ?, notes = COALESCE(?, notes), synthetic = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(lotCode, expiryDate, notes, synthetic, batch.id)
    batch = db.prepare('SELECT * FROM product_batches WHERE id = ? LIMIT 1').get(batch.id)
  }

  return batch
}

function setBranchBatchQuantity(batchId, branchId, quantity) {
  const qty = Math.max(0, Number(quantity || 0))
  db.prepare(`
    INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
    VALUES (?,?,?)
    ON CONFLICT(batch_id, branch_id) DO UPDATE
    SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
  `).run(batchId, branchId, qty)
}

function incrementBranchBatchQuantity(batchId, branchId, delta) {
  const change = Number(delta || 0)
  db.prepare(`
    INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
    VALUES (?,?,?)
    ON CONFLICT(batch_id, branch_id) DO UPDATE
    SET quantity = GREATEST(0, branch_batch_stock.quantity + excluded.quantity),
        updated_at = CURRENT_TIMESTAMP
  `).run(batchId, branchId, change)
}

function getBatchStockRows(productId, { branchId = null, batchId = null, includeZero = false } = {}) {
  const conditions = ['pb.variant_product_id = ?']
  const params = [productId]
  if (branchId) {
    conditions.push('bbs.branch_id = ?')
    params.push(branchId)
  }
  if (batchId) {
    conditions.push('pb.id = ?')
    params.push(batchId)
  }
  if (!includeZero) conditions.push('COALESCE(bbs.quantity, 0) > 0')
  return db.prepare(`
    SELECT
      pb.id AS batch_id,
      pb.variant_product_id AS product_id,
      pb.batch_key,
      pb.lot_code,
      pb.expiry_date,
      pb.received_at,
      pb.synthetic,
      bbs.branch_id,
      b.name AS branch_name,
      COALESCE(bbs.quantity, 0) AS quantity
    FROM product_batches pb
    LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
    LEFT JOIN branches b ON b.id = bbs.branch_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE
        WHEN NULLIF(pb.expiry_date, '') IS NOT NULL AND NULLIF(pb.expiry_date, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
          THEN NULLIF(pb.expiry_date, '')::date
        ELSE NULL
      END ASC NULLS LAST,
      ${RECEIVED_AT_ORDER_SQL} ASC,
      pb.id ASC,
      bbs.branch_id ASC
  `).all(...params)
}

function listProductBatches(productIds = [], { branchId = null } = {}) {
  const ids = Array.from(new Set((productIds || []).map((id) => Number.parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const params = [...ids]
  let branchJoin = ''
  if (branchId) {
    params.push(branchId)
    branchJoin = 'AND bbs.branch_id = ?'
  }
  const rows = db.prepare(`
    SELECT
      pb.id,
      pb.variant_product_id,
      pb.batch_key,
      pb.lot_code,
      pb.expiry_date,
      pb.received_at,
      pb.synthetic,
      pb.is_active,
      COALESCE(SUM(bbs.quantity), 0) AS quantity,
      COALESCE(
        json_agg(
          json_build_object(
            'branch_id', bbs.branch_id,
            'branch_name', b.name,
            'quantity', bbs.quantity
          )
          ORDER BY b.name COLLATE "C", bbs.branch_id
        ) FILTER (WHERE bbs.branch_id IS NOT NULL),
        '[]'::json
      )::text AS branch_stock_json
    FROM product_batches pb
    LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id ${branchJoin}
    LEFT JOIN branches b ON b.id = bbs.branch_id
    WHERE pb.variant_product_id IN (${placeholders})
    GROUP BY pb.id
    ORDER BY
      pb.variant_product_id ASC,
      CASE
        WHEN NULLIF(pb.expiry_date, '') IS NOT NULL AND NULLIF(pb.expiry_date, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
          THEN NULLIF(pb.expiry_date, '')::date
        ELSE NULL
      END ASC NULLS LAST,
      ${RECEIVED_AT_ORDER_SQL} ASC,
      pb.id ASC
  `).all(...params)

  const map = new Map()
  rows.forEach((row) => {
    if (!map.has(row.variant_product_id)) map.set(row.variant_product_id, [])
    let branchStock = []
    try {
      branchStock = JSON.parse(row.branch_stock_json || '[]')
    } catch (_) {}
    map.get(row.variant_product_id).push({
      id: row.id,
      batch_id: row.id,
      batch_key: row.batch_key,
      lot_code: row.lot_code || null,
      expiry_date: row.expiry_date || null,
      received_at: row.received_at || null,
      synthetic: Number(row.synthetic || 0),
      is_active: Number(row.is_active || 1),
      quantity: Number(row.quantity || 0),
      branch_stock: branchStock,
    })
  })
  return map
}

function syncProductBatchRollups(productIds = []) {
  const ids = Array.from(new Set((productIds || []).map((id) => Number.parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return

  for (const productId of ids) {
    const aggregateRows = db.prepare(`
      SELECT bbs.branch_id, COALESCE(SUM(bbs.quantity), 0) AS quantity
      FROM product_batches pb
      LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
      WHERE pb.variant_product_id = ?
      GROUP BY bbs.branch_id
    `).all(productId).filter((row) => row.branch_id)

    const nextByBranch = new Map(aggregateRows.map((row) => [Number(row.branch_id), Number(row.quantity || 0)]))
    const branchRows = db.prepare('SELECT branch_id FROM branch_stock WHERE product_id = ?').all(productId)
    const seen = new Set()
    for (const [branchId, quantity] of nextByBranch.entries()) {
      seen.add(branchId)
      db.prepare(`
        INSERT INTO branch_stock (product_id, branch_id, quantity)
        VALUES (?,?,?)
        ON CONFLICT(product_id, branch_id) DO UPDATE
        SET quantity = excluded.quantity
      `).run(productId, branchId, quantity)
    }
    for (const row of branchRows) {
      if (seen.has(Number(row.branch_id))) continue
      db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ? AND branch_id = ?').run(productId, row.branch_id)
    }

    const totalQuantity = aggregateRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    db.prepare(`
      UPDATE products
      SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalQuantity, productId)
  }
}

function migrateLegacyProductToBatches(productId, { force = false } = {}) {
  const product = getProductById(productId)
  if (!product || !isSellableProduct(product)) return []

  const existingBatches = getBatchRowsForProduct(product.id)
  const hasTrackedBatches = existingBatches.some((batch) => Number(batch.synthetic || 0) === 0)
  if (hasTrackedBatches && !force) {
    syncProductBatchRollups([product.id])
    return existingBatches
  }

  const batch = createOrFindProductBatch(product.id, {
    expiryDate: product.expiry_date,
    synthetic: true,
    batchKey: buildBatchKey({ expiryDate: product.expiry_date, synthetic: true, fallback: `product-${product.id}` }),
    receivedAt: product.created_at || null,
    notes: 'Migrated from legacy flat product stock',
  })

  const branchRows = db.prepare(`
    SELECT branch_id, quantity
    FROM branch_stock
    WHERE product_id = ?
  `).all(product.id)

  if (!force) {
    const legacyBatchIds = existingBatches.length ? existingBatches.map((row) => row.id) : [batch.id]
    if (legacyBatchIds.length) {
      const placeholders = legacyBatchIds.map(() => '?').join(',')
      db.prepare(`
        UPDATE branch_batch_stock
        SET quantity = 0, updated_at = CURRENT_TIMESTAMP
        WHERE batch_id IN (${placeholders})
      `).run(...legacyBatchIds)
    }
  }

  branchRows.forEach((row) => {
    setBranchBatchQuantity(batch.id, row.branch_id, row.quantity || 0)
  })
  syncProductBatchRollups([product.id])
  return getBatchRowsForProduct(product.id)
}

function migrateAllLegacyProductsToBatches({ force = false } = {}) {
  const productIds = force
    ? db.prepare(`
      SELECT id
      FROM products
      WHERE NOT (COALESCE(is_group, 0) = 1 AND COALESCE(parent_id, 0) = 0)
    `).all().map((row) => row.id)
    : getLegacyBatchBackfillCandidates()
  for (const productId of productIds) migrateLegacyProductToBatches(productId, { force })
  return productIds.length
}

function scheduleLegacyBatchBackfill(options = {}) {
  const chunkSize = Math.max(1, Math.min(1000, Number(options.chunkSize || LEGACY_BACKFILL_CHUNK_SIZE) || LEGACY_BACKFILL_CHUNK_SIZE))
  const delayMs = Math.max(0, Math.min(5000, Number(options.delayMs || LEGACY_BACKFILL_DELAY_MS) || LEGACY_BACKFILL_DELAY_MS))
  if (legacyBackfillState.scheduled || legacyBackfillState.running) return false
  legacyBackfillState.scheduled = true

  const runNextChunk = () => {
    legacyBackfillState.scheduled = false
    legacyBackfillState.running = true
    try {
      const pendingIds = getLegacyBatchBackfillCandidates(chunkSize)
      if (!pendingIds.length) {
        legacyBackfillState.running = false
        legacyBackfillState.completedAt = new Date().toISOString()
        legacyBackfillState.lastError = ''
        return
      }
      for (const productId of pendingIds) {
        migrateLegacyProductToBatches(productId, { force: false })
      }
      legacyBackfillState.running = false
      legacyBackfillState.completedAt = ''
      legacyBackfillState.lastError = ''
      legacyBackfillState.scheduled = true
      setTimeout(runNextChunk, delayMs).unref?.()
    } catch (error) {
      legacyBackfillState.running = false
      legacyBackfillState.lastError = error?.message || String(error || 'Legacy batch backfill failed')
      console.warn(`[product-batches] legacy backfill paused: ${legacyBackfillState.lastError}`)
    }
  }

  setTimeout(runNextChunk, delayMs).unref?.()
  return true
}

function getLegacyBatchBackfillStatus() {
  return {
    scheduled: legacyBackfillState.scheduled,
    running: legacyBackfillState.running,
    completedAt: legacyBackfillState.completedAt,
    lastError: legacyBackfillState.lastError,
  }
}

function getAvailableProductQuantity(productId, branchId = null) {
  const rows = getBatchStockRows(productId, { branchId })
  return rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
}

function allocateProductBatches(productId, branchId, quantity, options = {}) {
  const numericQty = Number(quantity || 0)
  if (!Number.isFinite(numericQty) || numericQty <= 0) throw new Error('Quantity must be greater than zero')
  const product = getProductById(productId)
  if (!product) throw new Error('Product not found')
  migrateLegacyProductToBatches(product.id)

  const rows = getBatchStockRows(product.id, {
    branchId: branchId || null,
    batchId: options.batchId || options.batch_id || null,
  })
  const available = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  if (available + 0.0000001 < numericQty) {
    throw new Error(`Insufficient stock for ${product.name || 'product'}: requested ${numericQty}, available ${available}`)
  }

  const allocations = []
  let remaining = numericQty
  for (const row of rows) {
    if (remaining <= 0) break
    const take = Math.min(Number(row.quantity || 0), remaining)
    if (take <= 0) continue
    incrementBranchBatchQuantity(row.batch_id, row.branch_id, -take)
    allocations.push({
      product_id: product.id,
      batch_id: row.batch_id,
      branch_id: row.branch_id,
      branch_name: row.branch_name || null,
      quantity: take,
      lot_code: row.lot_code || null,
      expiry_date: row.expiry_date || null,
      batch_key: row.batch_key,
    })
    remaining -= take
  }

  syncProductBatchRollups([product.id])
  return allocations
}

function increaseProductBatchStock(productId, branchId, quantity, options = {}) {
  const numericQty = Number(quantity || 0)
  if (!Number.isFinite(numericQty) || numericQty <= 0) throw new Error('Quantity must be greater than zero')
  const batch = createOrFindProductBatch(productId, options)
  incrementBranchBatchQuantity(batch.id, branchId, numericQty)
  syncProductBatchRollups([productId])
  return {
    product_id: Number(productId),
    batch_id: batch.id,
    branch_id: Number(branchId),
    quantity: numericQty,
    lot_code: batch.lot_code || null,
    expiry_date: batch.expiry_date || null,
    batch_key: batch.batch_key,
  }
}

function restoreBatchAllocations(allocations = []) {
  const touchedProductIds = new Set()
  for (const allocation of allocations || []) {
    const batchId = Number.parseInt(allocation.batch_id, 10)
    const branchId = Number.parseInt(allocation.branch_id, 10)
    const quantity = Number(allocation.quantity || 0)
    if (!Number.isFinite(batchId) || batchId <= 0 || !Number.isFinite(branchId) || branchId <= 0 || quantity <= 0) continue
    incrementBranchBatchQuantity(batchId, branchId, quantity)
    const batch = db.prepare('SELECT variant_product_id FROM product_batches WHERE id = ? LIMIT 1').get(batchId)
    if (batch?.variant_product_id) touchedProductIds.add(Number(batch.variant_product_id))
  }
  syncProductBatchRollups([...touchedProductIds])
  return [...touchedProductIds]
}

function cloneAllocationsToProduct(destinationProductId, branchId, allocations = [], options = {}) {
  const created = []
  for (const allocation of allocations || []) {
    const quantity = Number(allocation.quantity || 0)
    if (quantity <= 0) continue
    const batch = createOrFindProductBatch(destinationProductId, {
      lotCode: allocation.lot_code || null,
      expiryDate: allocation.expiry_date || null,
      fallbackKey: options.fallbackKey || `move-${destinationProductId}`,
      synthetic: Number(options.synthetic ? 1 : 0),
      notes: options.notes || null,
    })
    incrementBranchBatchQuantity(batch.id, branchId, quantity)
    created.push({
      ...allocation,
      destination_product_id: Number(destinationProductId),
      branch_id: Number(branchId),
      batch_id: batch.id,
    })
  }
  syncProductBatchRollups([destinationProductId])
  return created
}

function getSaleItemAllocations(saleItemId, { activeOnly = false } = {}) {
  const clauses = ['sale_item_id = ?']
  const params = [saleItemId]
  if (activeOnly) clauses.push('released_at IS NULL')
  return db.prepare(`
    SELECT *
    FROM sale_item_batch_allocations
    WHERE ${clauses.join(' AND ')}
    ORDER BY id ASC
  `).all(...params)
}

function markSaleItemAllocationsReleased(saleItemId) {
  db.prepare(`
    UPDATE sale_item_batch_allocations
    SET released_at = CURRENT_TIMESTAMP
    WHERE sale_item_id = ? AND released_at IS NULL
  `).run(saleItemId)
}

function getAvailableSaleAllocationRows(saleItemId) {
  return db.prepare(`
    SELECT
      sia.id,
      sia.sale_item_id,
      sia.batch_id,
      sia.branch_id,
      sia.quantity,
      sia.lot_code,
      sia.expiry_date,
      COALESCE((
        SELECT SUM(ria.quantity)
        FROM return_item_batch_allocations ria
        WHERE ria.sale_item_id = sia.sale_item_id
          AND ria.batch_id = sia.batch_id
          AND ria.reversed_at IS NULL
      ), 0) AS returned_quantity
    FROM sale_item_batch_allocations sia
    WHERE sia.sale_item_id = ?
    ORDER BY sia.id ASC
  `).all(saleItemId)
}

function getReturnItemAllocations(returnItemId, { activeOnly = false } = {}) {
  const clauses = ['return_item_id = ?']
  const params = [returnItemId]
  if (activeOnly) clauses.push('reversed_at IS NULL')
  return db.prepare(`
    SELECT *
    FROM return_item_batch_allocations
    WHERE ${clauses.join(' AND ')}
    ORDER BY id ASC
  `).all(...params)
}

function markReturnItemAllocationsReversed(returnItemId) {
  db.prepare(`
    UPDATE return_item_batch_allocations
    SET reversed_at = CURRENT_TIMESTAMP
    WHERE return_item_id = ? AND reversed_at IS NULL
  `).run(returnItemId)
}

module.exports = {
  allocateProductBatches,
  buildBatchKey,
  cloneAllocationsToProduct,
  createOrFindProductBatch,
  getAvailableProductQuantity,
  getAvailableSaleAllocationRows,
  getBatchRowsForProduct,
  getProductById,
  getProductBatchIds,
  getReturnItemAllocations,
  getSaleItemAllocations,
  increaseProductBatchStock,
  incrementBranchBatchQuantity,
  isSellableProduct,
  listProductBatches,
  markSaleItemAllocationsReleased,
  markReturnItemAllocationsReversed,
  getLegacyBatchBackfillStatus,
  migrateAllLegacyProductsToBatches,
  migrateLegacyProductToBatches,
  normalizeExpiryDate,
  normalizeLotCode,
  restoreBatchAllocations,
  scheduleLegacyBatchBackfill,
  setBranchBatchQuantity,
  syncProductBatchRollups,
}
