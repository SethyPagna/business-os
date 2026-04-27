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

// GET /api/branches
router.get('/', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM branches ORDER BY is_default DESC, name').all())
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
      'INSERT INTO branches (name, location, phone, manager, notes, is_default, is_active, updated_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'))'
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
        'UPDATE branches SET name=?, location=?, phone=?, manager=?, notes=?, is_default=?, is_active=?, updated_at=datetime(\'now\') WHERE id=?'
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
      return err(res, `Cannot delete branch — it still contains ${Math.round(stockCheck.total)} unit(s) of stock. Transfer all stock to another branch first.`)
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
  const rows = db.prepare(`
    SELECT p.id, p.name, p.sku, p.unit, p.selling_price_usd, p.selling_price_khr,
           p.purchase_price_usd, p.purchase_price_khr, p.low_stock_threshold, p.out_of_stock_threshold,
           COALESCE(bs.quantity, 0) AS branch_quantity
    FROM products p
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ?
    WHERE p.is_active = 1 AND (p.parent_id IS NULL OR p.parent_id = 0)
    ORDER BY p.name
  `).all(req.params.id)
  res.json(rows)
})

// GET /api/transfers
router.get('/transfers/list', authToken, (req, res) => {
  const rows = db.prepare(`
    SELECT st.*, b1.name AS from_name, b2.name AS to_name
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

      const r = db.prepare(
        'INSERT INTO stock_transfers (product_id, product_name, from_branch_id, to_branch_id, quantity, note, user_id, user_name) VALUES (?,?,?,?,?,?,?,?)'
      ).run(productId, productName, fromBranchId, toBranchId, qty, note || null, actor.userId, actor.userName)

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
