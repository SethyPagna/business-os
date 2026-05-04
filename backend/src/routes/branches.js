'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')

const router = express.Router()

function toDbBool(value, fallback = 1) {
  if (value == null || value === '') return fallback ? 1 : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0
}

function getStockTransferNoteColumn() {
  try {
    const columns = db.prepare(`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ?
      ORDER BY ordinal_position
    `).all('stock_transfers')
    if (columns.some((column) => String(column?.name || '').toLowerCase() === 'notes')) return 'notes'
    if (columns.some((column) => String(column?.name || '').toLowerCase() === 'note')) return 'note'
  } catch (_) {}
  return null
}

function normalizePositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function getDefaultBranch() {
  return db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1').get() || null
}

function getSellableProductWhere() {
  return [
    'p.is_active = 1',
    'NOT (COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)',
  ]
}

function buildBranchStockWhere(req, { includeStockState = true } = {}) {
  const where = getSellableProductWhere()
  const params = { branchId: Number.parseInt(req.params.id, 10) }
  const query = String(req.query?.query || req.query?.q || '').normalize('NFC').trim()
  if (query) {
    params.query = `%${query.toLowerCase()}%`
    where.push(`(
      lower(COALESCE(p.name, '')) LIKE @query
      OR lower(COALESCE(p.sku, '')) LIKE @query
      OR lower(COALESCE(p.barcode, '')) LIKE @query
      OR lower(COALESCE(p.brand, '')) LIKE @query
      OR lower(COALESCE(p.category, '')) LIKE @query
    )`)
  }
  const stockState = String(req.query?.stockState || req.query?.stock_state || 'positive').toLowerCase()
  if (includeStockState) {
    if (stockState === 'positive' || stockState === 'in_stock') where.push('COALESCE(bs.quantity, 0) > 0')
    if (stockState === 'zero') where.push('COALESCE(bs.quantity, 0) = 0')
    if (stockState === 'low') where.push('COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) AND COALESCE(bs.quantity, 0) <= COALESCE(p.low_stock_threshold, 10)')
    if (stockState === 'out' || stockState === 'out_of_stock') where.push('COALESCE(bs.quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0)')
  }
  return { where, params, stockState }
}

// GET /api/branches
router.get('/', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM branches ORDER BY is_default DESC, name').all())
})

// GET /api/branches/stock-integrity
router.get('/stock-integrity', authToken, requirePermission('inventory'), (_req, res) => {
  const defaultBranch = getDefaultBranch()
  if (!defaultBranch) return ok(res, { defaultBranch: null, issues: [], preview_token: null })
  const rows = db.prepare(`
    SELECT bs.product_id, p.name AS product_name, bs.branch_id, b.name AS branch_name, bs.quantity,
           COALESCE(default_bs.quantity, 0) AS default_quantity
    FROM branch_stock bs
    JOIN products p ON p.id = bs.product_id
    JOIN branches b ON b.id = bs.branch_id
    LEFT JOIN branch_stock default_bs ON default_bs.product_id = bs.product_id AND default_bs.branch_id = ?
    WHERE bs.branch_id != ?
      AND COALESCE(bs.quantity, 0) > 0
      AND p.is_active = 1
    ORDER BY b.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC
    LIMIT 5000
  `).all(defaultBranch.id, defaultBranch.id)
  const previewPayload = JSON.stringify(rows.map((row) => [row.product_id, row.branch_id, row.quantity]))
  const previewToken = require('crypto').createHash('sha256').update(`${defaultBranch.id}:${previewPayload}`).digest('hex')
  ok(res, {
    defaultBranch,
    issues: rows,
    summary: {
      misplacedRows: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    },
    preview_token: previewToken,
  })
})

// POST /api/branches/stock-integrity/repair
router.post('/stock-integrity/repair', authToken, requirePermission('inventory'), (req, res) => {
  const actor = getAuditActor(req, req.body || {})
  const defaultBranch = getDefaultBranch()
  if (!defaultBranch) return err(res, 'Default branch required')
  const rows = db.prepare(`
    SELECT bs.product_id, bs.branch_id, bs.quantity
    FROM branch_stock bs
    JOIN products p ON p.id = bs.product_id
    WHERE bs.branch_id != ?
      AND COALESCE(bs.quantity, 0) > 0
      AND p.is_active = 1
    ORDER BY bs.product_id ASC, bs.branch_id ASC
  `).all(defaultBranch.id)
  const previewPayload = JSON.stringify(rows.map((row) => [row.product_id, row.branch_id, row.quantity]))
  const previewToken = require('crypto').createHash('sha256').update(`${defaultBranch.id}:${previewPayload}`).digest('hex')
  if (!req.body?.confirm || req.body?.preview_token !== previewToken) {
    return err(res, 'Run stock integrity check first, then confirm the matching preview token.')
  }
  const repaired = db.transaction(() => {
    const insertDefault = db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity
    `)
    const clearSource = db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ? AND branch_id = ?')
    const recalc = db.prepare(`
      UPDATE products SET
        stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    const touched = new Set()
    rows.forEach((row) => {
      insertDefault.run(row.product_id, defaultBranch.id, Number(row.quantity || 0))
      clearSource.run(row.product_id, row.branch_id)
      touched.add(row.product_id)
    })
    touched.forEach((productId) => recalc.run(productId, productId))
    audit(actor.userId, actor.userName, 'repair', 'branch_stock_integrity', defaultBranch.id, {
      movedRows: rows.length,
      defaultBranchId: defaultBranch.id,
    })
    return { movedRows: rows.length, productCount: touched.size }
  })()
  broadcast('branches')
  broadcast('products')
  broadcast('inventory')
  ok(res, repaired)
})

// POST /api/branches
router.post('/', authToken, requirePermission('inventory'), (req, res) => {
  const { name, location, phone, manager, notes, is_default, is_active, deviceName, deviceTz, clientTime } = req.body || {}
  const actor = getAuditActor(req, req.body || {})
  if (!name?.trim()) return err(res, 'Name required')
  const id = db.transaction(() => {
    const defaultFlag = toDbBool(is_default, 0)
    const activeFlag = toDbBool(is_active, 1)
    if (defaultFlag) db.prepare('UPDATE branches SET is_default = 0').run()
    const r = db.prepare(
      'INSERT INTO branches (name, location, phone, manager, notes, is_default, is_active, updated_at) VALUES (?,?,?,?,?,?,?,\'now\')'
    ).run(name.trim(), location || null, phone || null, manager || null, notes || null, defaultFlag, activeFlag)
    audit(actor.userId, actor.userName, 'create', 'branch', r.lastInsertRowid, { name }, {
      tableName: 'branches', recordId: r.lastInsertRowid,
      deviceName: deviceName || null, deviceTz: deviceTz || null, clientTime: clientTime || null,
    })
    return r.lastInsertRowid
  })()
  broadcast('branches')
  ok(res, { id })
})

// PUT /api/branches/:id
router.put('/:id', authToken, requirePermission('inventory'), (req, res) => {
  const { name, location, phone, manager, notes, is_default, is_active, deviceName, deviceTz, clientTime } = req.body || {}
  const actor = getAuditActor(req, req.body || {})
  try {
    db.transaction(() => {
      const current = db.prepare('SELECT id, updated_at FROM branches WHERE id = ?').get(req.params.id)
      if (!current) throw new Error('Branch not found')
      assertUpdatedAtMatch('branch', current, getExpectedUpdatedAt(req.body || {}))
      const defaultFlag = toDbBool(is_default, 0)
      const activeFlag = toDbBool(is_active, 1)
      if (defaultFlag) db.prepare('UPDATE branches SET is_default = 0').run()
      db.prepare(
        'UPDATE branches SET name=?, location=?, phone=?, manager=?, notes=?, is_default=?, is_active=?, updated_at=\'now\' WHERE id=?'
      ).run(name, location || null, phone || null, manager || null, notes || null, defaultFlag, activeFlag, req.params.id)
      audit(actor.userId, actor.userName, 'update', 'branch', req.params.id, { name }, {
        tableName: 'branches', recordId: req.params.id,
        deviceName: deviceName || null, deviceTz: deviceTz || null, clientTime: clientTime || null,
      })
    })()
    broadcast('branches')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

// DELETE /api/branches/:id
router.delete('/:id', authToken, requirePermission('inventory'), (req, res) => {
  const actor = getAuditActor(req, req.body || req.query || {})
  try {
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id)
    if (!branch) return err(res, 'Branch not found')
    assertUpdatedAtMatch('branch', branch, getExpectedUpdatedAt(req.body || req.query || {}))
    if (branch.is_default) return err(res, 'Cannot delete the default branch')

    const stockCheck = db.prepare(`
      SELECT SUM(quantity) as total FROM branch_stock WHERE branch_id = ? AND quantity > 0
    `).get(req.params.id)
    if (stockCheck && stockCheck.total > 0) {
      return err(res, `Cannot delete branch â€” it still contains ${Math.round(stockCheck.total)} unit(s) of stock. Transfer all stock to another branch first.`)
    }

    db.prepare('DELETE FROM branch_stock WHERE branch_id = ?').run(req.params.id)
    db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'branch', req.params.id, { name: branch.name })
    broadcast('branches')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

// GET /api/branches/:id/stock
router.get('/:id/stock', authToken, (req, res) => {
  const wantsPaged = req.query && Object.keys(req.query).some((key) => ['page', 'pageSize', 'page_size', 'query', 'q', 'stockState', 'stock_state'].includes(key))
  if (!wantsPaged) {
    const rows = db.prepare(`
    SELECT p.id, p.name, p.sku, p.unit, p.selling_price_usd, p.selling_price_khr,
           p.purchase_price_usd, p.purchase_price_khr, p.low_stock_threshold, p.out_of_stock_threshold,
           COALESCE(bs.quantity, 0) AS branch_quantity
    FROM products p
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ?
    WHERE ${getSellableProductWhere().join(' AND ')}
    ORDER BY p.name
    `).all(req.params.id)
    return res.json(rows)
  }
  const page = normalizePositiveInt(req.query.page, 1, { min: 1, max: 100000 })
  const pageSize = normalizePositiveInt(req.query.pageSize || req.query.page_size, 20, { min: 1, max: 100 })
  const offset = (page - 1) * pageSize
  const { where, params, stockState } = buildBranchStockWhere(req)
  const whereSql = `WHERE ${where.join(' AND ')}`
  const summaryWhere = buildBranchStockWhere(req, { includeStockState: false })
  const summaryWhereSql = `WHERE ${summaryWhere.where.join(' AND ')}`
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM products p
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId
    ${whereSql}
  `).get(params)?.count || 0
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_products,
      SUM(CASE WHEN COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) THEN 1 ELSE 0 END) AS in_stock_products,
      SUM(CASE WHEN COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) AND COALESCE(bs.quantity, 0) <= COALESCE(p.low_stock_threshold, 10) THEN 1 ELSE 0 END) AS low_stock_products,
      SUM(CASE WHEN COALESCE(bs.quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0) THEN 1 ELSE 0 END) AS out_of_stock_products,
      SUM(CASE WHEN COALESCE(bs.quantity, 0) > 0 THEN 1 ELSE 0 END) AS positive_products,
      COALESCE(SUM(CASE WHEN COALESCE(bs.quantity, 0) > 0 THEN COALESCE(bs.quantity, 0) ELSE 0 END), 0) AS positive_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(bs.quantity, 0) > 0 THEN COALESCE(bs.quantity, 0) * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0) ELSE 0 END), 0) AS positive_value_usd,
      COALESCE(SUM(COALESCE(bs.quantity, 0)), 0) AS total_quantity,
      COALESCE(SUM(COALESCE(bs.quantity, 0) * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0)), 0) AS total_value_usd
    FROM products p
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId
    ${summaryWhereSql}
  `).get(summaryWhere.params) || {}
  const items = db.prepare(`
    SELECT p.id, p.name, p.sku, p.barcode, p.brand, p.category, p.unit, p.selling_price_usd, p.selling_price_khr,
           p.purchase_price_usd, p.purchase_price_khr, p.cost_price_usd, p.cost_price_khr,
           p.low_stock_threshold, p.out_of_stock_threshold,
           COALESCE(bs.quantity, 0) AS branch_quantity
    FROM products p
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId
    ${whereSql}
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
    LIMIT @pageSize OFFSET @offset
  `).all({ ...params, pageSize, offset })
  ok(res, {
    items,
    total,
    page,
    pageSize,
    stockState,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary,
  })
})

// GET /api/transfers
router.get('/transfers/list', authToken, (req, res) => {
  const noteColumn = getStockTransferNoteColumn()
  const noteSelect = noteColumn ? `st.${noteColumn} AS note,` : 'NULL AS note,'
  const rows = db.prepare(`
    SELECT st.*, ${noteSelect} b1.name AS from_name, b2.name AS to_name
    FROM stock_transfers st
    LEFT JOIN branches b1 ON b1.id = st.from_branch_id
    LEFT JOIN branches b2 ON b2.id = st.to_branch_id
    ORDER BY st.created_at DESC LIMIT 500
  `).all()
  res.json(rows)
})

// POST /api/branches/transfer
router.post('/transfer', authToken, requirePermission('inventory'), (req, res) => {
  const { fromBranchId, toBranchId, productId, productName, quantity, note, deviceName, deviceTz, clientTime } = req.body || {}
  const actor = getAuditActor(req, req.body || {})
  if (!fromBranchId || !toBranchId || !productId || !quantity) return err(res, 'Missing required fields')
  if (parseInt(fromBranchId, 10) === parseInt(toBranchId, 10)) return err(res, 'Source and destination cannot be the same')

  try {
    db.transaction(() => {
      const qty = Math.max(0, parseFloat(quantity) || 0)
      if (!qty) throw new Error('Transfer quantity must be greater than zero')

      const fromStock = db.prepare(
        'SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?'
      ).get(productId, fromBranchId)
      if (!fromStock || fromStock.quantity < qty) throw new Error('Insufficient stock in source branch')

      const fromBranch = db.prepare('SELECT name FROM branches WHERE id = ?').get(fromBranchId)
      const toBranch = db.prepare('SELECT name FROM branches WHERE id = ?').get(toBranchId)
      const product = db.prepare('SELECT cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr FROM products WHERE id = ?').get(productId)
      const unitCostUsd = product?.cost_price_usd || product?.purchase_price_usd || 0
      const unitCostKhr = product?.cost_price_khr || product?.purchase_price_khr || 0

      db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?')
        .run(qty, productId, fromBranchId)
      db.prepare(`
        INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,?)
        ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity
      `).run(productId, toBranchId, qty)

      const noteColumn = getStockTransferNoteColumn()
      const transferColumns = ['product_id', 'product_name', 'from_branch_id', 'to_branch_id', 'quantity', 'user_id', 'user_name']
      const transferValues = [productId, productName, fromBranchId, toBranchId, qty, actor.userId, actor.userName]
      if (noteColumn) {
        transferColumns.splice(5, 0, noteColumn)
        transferValues.splice(5, 0, note || null)
      }
      const placeholders = transferColumns.map(() => '?').join(',')
      const quotedColumns = transferColumns.map((column) => `"${column}"`).join(', ')
      const r = db.prepare(
        `INSERT INTO stock_transfers (${quotedColumns}) VALUES (${placeholders})`
      ).run(...transferValues)

      const transferId = r.lastInsertRowid
      const insertMovement = db.prepare(`
        INSERT INTO inventory_movements
          (product_id, product_name, branch_id, branch_name, movement_type, quantity,
           unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
           reason, reference_id, user_id, user_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      insertMovement.run(
        productId,
        productName,
        fromBranchId,
        fromBranch?.name || null,
        'transfer',
        qty,
        unitCostUsd,
        unitCostKhr,
        unitCostUsd * qty,
        unitCostKhr * qty,
        `Transfer out to ${toBranch?.name || 'destination'}${note ? ` - ${note}` : ''}`,
        transferId,
        actor.userId,
        actor.userName,
      )
      insertMovement.run(
        productId,
        productName,
        toBranchId,
        toBranch?.name || null,
        'transfer',
        qty,
        unitCostUsd,
        unitCostKhr,
        unitCostUsd * qty,
        unitCostKhr * qty,
        `Transfer in from ${fromBranch?.name || 'source'}${note ? ` - ${note}` : ''}`,
        transferId,
        actor.userId,
        actor.userName,
      )

      audit(actor.userId, actor.userName, 'transfer', 'stock', transferId, { productName, quantity: qty, fromBranchId, toBranchId }, {
        deviceName: deviceName || null, deviceTz: deviceTz || null, clientTime: clientTime || null,
      })
    })()
    broadcast('branches')
    broadcast('products')
    broadcast('inventory')
    ok(res, {})
  } catch (e) { err(res, e.message) }
})

module.exports = router
