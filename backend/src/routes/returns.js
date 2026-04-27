'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, getSafeCostPrice } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')
const { normalizeClientRequestId } = require('../idempotency')

const router = express.Router()
const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'

function normalizeScope(value, fallback = CUSTOMER_SCOPE) {
  const scope = String(value || '').trim().toLowerCase()
  if (scope === 'all') return 'all'
  if (scope === SUPPLIER_SCOPE) return SUPPLIER_SCOPE
  if (scope === CUSTOMER_SCOPE) return CUSTOMER_SCOPE
  return fallback
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function findReturnByClientRequestId(clientRequestId) {
  if (!clientRequestId) return null
  return db.prepare(`
    SELECT id, return_number
    FROM returns
    WHERE client_request_id = ?
    LIMIT 1
  `).get(clientRequestId)
}

function assertReturnableItems(saleId, items = [], excludeReturnId = null) {
  for (const item of items) {
    const qty = parseFloat(item.quantity)
    if (!qty || qty <= 0) throw new Error('Return quantity must be greater than zero')
  }

  if (!saleId) return

  const sale = db.prepare('SELECT id FROM sales WHERE id = ?').get(saleId)
  if (!sale) throw new Error('Original sale not found')

  for (const item of items) {
    const qty = parseFloat(item.quantity) || 0

    if (item.sale_item_id) {
      const saleItem = db.prepare('SELECT id, quantity, product_name FROM sale_items WHERE id = ? AND sale_id = ?').get(item.sale_item_id, saleId)
      if (!saleItem) throw new Error('Sale item not found for this return')

      const returned = excludeReturnId
        ? db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ?
              AND ri.sale_item_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
              AND r.id != ?
          `).get(saleId, item.sale_item_id, excludeReturnId)?.qty || 0
        : db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ?
              AND ri.sale_item_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
          `).get(saleId, item.sale_item_id)?.qty || 0

      const remaining = Math.max(0, (saleItem.quantity || 0) - returned)
      if (qty > remaining) throw new Error(`Cannot return ${qty} of ${saleItem.product_name || 'this item'} — only ${remaining} remaining`)
      continue
    }

    if (item.product_id) {
      const soldQty = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS qty FROM sale_items WHERE sale_id = ? AND product_id = ?').get(saleId, item.product_id)?.qty || 0
      const returned = excludeReturnId
        ? db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ?
              AND ri.product_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
              AND r.id != ?
          `).get(saleId, item.product_id, excludeReturnId)?.qty || 0
        : db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ?
              AND ri.product_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
          `).get(saleId, item.product_id)?.qty || 0

      const remaining = Math.max(0, soldQty - returned)
      if (qty > remaining) throw new Error(`Cannot return ${qty} of this product — only ${remaining} remaining`)
    }
  }
}

// GET /api/returns
router.get('/returns', authToken, requirePermission('sales'), (req, res) => {
  const { startDate, endDate, saleId, limit = 500 } = req.query
  const scope = normalizeScope(req.query.scope, CUSTOMER_SCOPE)
  let q = `SELECT r.* FROM returns r WHERE 1=1`
  const params = []
  if (startDate) { q += ' AND date(r.created_at) >= ?'; params.push(startDate) }
  if (endDate)   { q += ' AND date(r.created_at) <= ?'; params.push(endDate) }
  if (saleId)    { q += ' AND r.sale_id = ?';           params.push(saleId) }
  if (scope !== 'all') { q += ` AND COALESCE(r.return_scope, 'customer') = ?`; params.push(scope) }
  q += ' ORDER BY r.created_at DESC LIMIT ?'
  params.push(parseInt(limit))

  const returns = db.prepare(q).all(...params)
  const getItems = db.prepare('SELECT * FROM return_items WHERE return_id = ?')
  res.json(returns.map(r => ({ ...r, items: getItems.all(r.id) })))
})

// GET /api/returns/:id
router.get('/returns/:id', authToken, requirePermission('sales'), (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id)
  if (!ret) return err(res, 'Return not found', 404)
  const items = db.prepare('SELECT * FROM return_items WHERE return_id = ?').all(ret.id)
  res.json({ ...ret, items })
})

// POST /api/returns
router.post('/returns', authToken, requirePermission('sales'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  const clientRequestId = normalizeClientRequestId(d.client_request_id)
  if (!Array.isArray(d.items) || d.items.length === 0) return err(res, 'Return items required')
  if (!d.reason) return err(res, 'Reason is required')

  const existingReturn = findReturnByClientRequestId(clientRequestId)
  if (existingReturn) {
    return ok(res, { id: existingReturn.id, returnNumber: existingReturn.return_number, duplicate: true })
  }

  try {
    assertReturnableItems(d.sale_id || null, d.items)
  } catch (e) {
    return err(res, e.message)
  }

  const returnNumber = String(d.return_number || '').trim()
    || `RET-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`

  try {
    const returnId = db.transaction(() => {
      const branchName = d.branch_id
        ? db.prepare('SELECT name FROM branches WHERE id = ?').get(d.branch_id)?.name
        : null

      // Look up sale if provided
      let saleMeta = {}
      if (d.sale_id) {
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(d.sale_id)
        if (sale) {
          saleMeta = {
            receipt_number: sale.receipt_number,
            customer_id:    sale.customer_id,
            customer_name:  sale.customer_name,
            branch_id:      sale.branch_id,
            branch_name:    sale.branch_name,
            exchange_rate:  sale.exchange_rate,
          }
        }
      }

      const rid = db.prepare(`
        INSERT INTO returns (
          return_number, client_request_id, sale_id, receipt_number, cashier_id, cashier_name,
          customer_id, customer_name, branch_id, branch_name, return_scope, reason, return_type,
          notes, total_refund_usd, total_refund_khr, exchange_rate,
          status, device_name, device_tz
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        returnNumber,
        clientRequestId,
        d.sale_id || null,
        d.receipt_number || saleMeta.receipt_number || null,
        actor.userId,
        actor.userName,
        d.customer_id || saleMeta.customer_id || null,
        d.customer_name || saleMeta.customer_name || null,
        d.branch_id || saleMeta.branch_id || null,
        branchName || saleMeta.branch_name || null,
        CUSTOMER_SCOPE,
        d.reason,
        d.return_type || 'restock',
        d.notes || null,
        d.total_refund_usd || 0,
        d.total_refund_khr || 0,
        d.exchange_rate || saleMeta.exchange_rate || 4100,
        'completed',
        d.device_name || null,
        d.device_tz || null,
      ).lastInsertRowid

      const insertItem = db.prepare(`
      INSERT INTO return_items (
        return_id, sale_item_id, product_id, product_name, quantity,
        applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr,
        total_usd, total_khr, return_to_stock, branch_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)

    // Pre-fetch product data for cost price defaults
    const productIds = d.items.map(it => it.product_id).filter(Boolean)
    const productMap = new Map()
    if (productIds.length > 0) {
      db.prepare(`SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`)
        .all(...productIds)
        .forEach(p => productMap.set(p.id, p))
    }

    for (const item of d.items) {
      const totalUsd = (item.applied_price_usd || 0) * item.quantity
      const totalKhr = (item.applied_price_khr || 0) * item.quantity
      const returnToStock = item.return_to_stock !== false ? 1 : 0

      // Use safe cost prices with fallback to product data
      let costUsd = item.cost_price_usd
      let costKhr = item.cost_price_khr
      if ((!costUsd || costUsd === 0) && item.product_id) {
        const prod = productMap.get(item.product_id)
        if (prod) {
          costUsd = prod.cost_price_usd || prod.purchase_price_usd || 0
          costKhr = prod.cost_price_khr || prod.purchase_price_khr || 0
        }
      }

      insertItem.run(
        rid,
        item.sale_item_id || null,
        item.product_id || null,
        item.product_name || null,
        item.quantity,
        item.applied_price_usd || 0,
        item.applied_price_khr || 0,
        costUsd || 0,
        costKhr || 0,
        totalUsd,
        totalKhr,
        returnToStock,
        item.branch_id || d.branch_id || null,
      )

      // Restore stock if return_to_stock is true
      if (returnToStock && item.product_id) {
        db.prepare(`UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ?`)
          .run(item.quantity, item.product_id)

        const bid = item.branch_id || d.branch_id
        if (bid) {
          db.prepare(`
            INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,?)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + ?
          `).run(item.product_id, bid, item.quantity, item.quantity)
        }

        // Log inventory movement
        db.prepare(`
          INSERT INTO inventory_movements
            (product_id, product_name, branch_id, branch_name, movement_type, quantity,
             unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
             reason, reference_id, user_id, user_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          item.product_id, item.product_name,
          item.branch_id || d.branch_id || null,
          branchName || null,
          'return',
          item.quantity,
          item.cost_price_usd || 0, item.cost_price_khr || 0,
          (item.cost_price_usd || 0) * item.quantity, (item.cost_price_khr || 0) * item.quantity,
          `Return: ${d.reason}`,
          rid,
          actor.userId,
          actor.userName,
        )
      }
    }

    // If sale_id provided, update sale_status to partial_return or returned
    if (d.sale_id) {
      // Check how many items from original sale were returned
      const saleItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(d.sale_id)
      const allReturnedQtys = db.prepare(`
        SELECT ri.product_id, SUM(ri.quantity) AS total_qty
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ?
          AND COALESCE(r.status, 'completed') != 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'
        GROUP BY ri.product_id
      `).all(d.sale_id)

      const returnedMap = {}
      allReturnedQtys.forEach(r => { returnedMap[r.product_id] = r.total_qty })

      const fullyReturned = saleItems.every(si => {
        const returned = returnedMap[si.product_id] || 0
        return returned >= si.quantity
      })

      const newStatus = fullyReturned ? 'returned' : 'partial_return'
      db.prepare("UPDATE sales SET sale_status = ? WHERE id = ?").run(newStatus, d.sale_id)
    }

    audit(actor.userId, actor.userName, 'create', 'return', rid,
      { returnNumber, total: d.total_refund_usd }, {
        tableName: 'returns', recordId: rid,
        newValue: { returnNumber, saleId: d.sale_id, reason: d.reason },
        deviceName: d.device_name || null,
        deviceTz:   d.device_tz   || null,
      })

      return rid
    })()

    broadcast('returns')
    broadcast('products')
    broadcast('sales')
    ok(res, { id: returnId, returnNumber })
  } catch (e) {
    if (clientRequestId && /client_request_id/i.test(String(e?.message || ''))) {
      const duplicateReturn = findReturnByClientRequestId(clientRequestId)
      if (duplicateReturn) {
        return ok(res, { id: duplicateReturn.id, returnNumber: duplicateReturn.return_number, duplicate: true })
      }
    }
    return err(res, e.message)
  }
})

function assertSupplierReturnableStock(items = [], fallbackBranchId = null) {
  for (const item of items) {
    const qty = toNumber(item.quantity, 0)
    if (!qty || qty <= 0) throw new Error('Return quantity must be greater than zero')
    if (!item.product_id) throw new Error('Product is required for supplier return')
    const branchId = item.branch_id || fallbackBranchId || null
    if (!branchId) throw new Error('Branch is required for supplier return')
    const available = db.prepare(`
      SELECT quantity
      FROM branch_stock
      WHERE product_id = ? AND branch_id = ?
      LIMIT 1
    `).get(item.product_id, branchId)?.quantity || 0
    if (qty > available) {
      const productName = item.product_name || `product #${item.product_id}`
      throw new Error(`Insufficient stock for ${productName} in selected branch: requested ${qty}, available ${available}`)
    }
  }
}

// POST /api/returns/supplier
router.post('/returns/supplier', authToken, requirePermission('sales'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  const clientRequestId = normalizeClientRequestId(d.client_request_id)
  if (!Array.isArray(d.items) || d.items.length === 0) return err(res, 'Return items required')
  if (!d.reason) return err(res, 'Reason is required')

  const existingReturn = findReturnByClientRequestId(clientRequestId)
  if (existingReturn) {
    return ok(res, { id: existingReturn.id, returnNumber: existingReturn.return_number, duplicate: true })
  }

  const settlement = ['refund', 'credit', 'replacement', 'writeoff'].includes(String(d.settlement || '').toLowerCase())
    ? String(d.settlement).toLowerCase()
    : 'refund'

  try {
    assertSupplierReturnableStock(d.items, d.branch_id || null)
  } catch (e) {
    return err(res, e.message)
  }

  const returnNumber = String(d.return_number || '').trim()
    || `SRET-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  try {
    const returnId = db.transaction(() => {
    const branchName = d.branch_id
      ? db.prepare('SELECT name FROM branches WHERE id = ?').get(d.branch_id)?.name
      : null

    const totalCostUsd = d.items.reduce((sum, item) => (
      sum + toNumber(item.quantity, 0) * toNumber(item.cost_price_usd ?? item.unit_cost_usd, 0)
    ), 0)
    const totalCostKhr = d.items.reduce((sum, item) => (
      sum + toNumber(item.quantity, 0) * toNumber(item.cost_price_khr ?? item.unit_cost_khr, 0)
    ), 0)

    const defaultCompensationUsd = ['refund', 'credit'].includes(settlement) ? totalCostUsd : 0
    const defaultCompensationKhr = ['refund', 'credit'].includes(settlement) ? totalCostKhr : 0
    const supplierCompensationUsd = toNumber(d.supplier_compensation_usd, defaultCompensationUsd)
    const supplierCompensationKhr = toNumber(d.supplier_compensation_khr, defaultCompensationKhr)
    const supplierLossUsd = Math.max(0, Number((totalCostUsd - supplierCompensationUsd).toFixed(2)))
    const supplierLossKhr = Math.max(0, Math.round(totalCostKhr - supplierCompensationKhr))

      const rid = db.prepare(`
        INSERT INTO returns (
          return_number, client_request_id, sale_id, receipt_number, cashier_id, cashier_name,
          customer_id, customer_name, branch_id, branch_name, return_scope, reason, return_type,
          notes, total_refund_usd, total_refund_khr, exchange_rate,
          supplier_id, supplier_name, supplier_settlement,
          supplier_compensation_usd, supplier_compensation_khr, supplier_loss_usd, supplier_loss_khr,
          status, device_name, device_tz
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        returnNumber,
        clientRequestId,
        null,
        null,
        actor.userId,
      actor.userName,
      null,
      null,
      d.branch_id || null,
      branchName || null,
      SUPPLIER_SCOPE,
      d.reason,
      'supplier_return',
      d.notes || null,
      0,
      0,
      d.exchange_rate || 4100,
      d.supplier_id || null,
      d.supplier_name || null,
      settlement,
      supplierCompensationUsd,
      supplierCompensationKhr,
      supplierLossUsd,
      supplierLossKhr,
      'completed',
      d.device_name || null,
      d.device_tz || null,
    ).lastInsertRowid

    const insertItem = db.prepare(`
      INSERT INTO return_items (
        return_id, sale_item_id, product_id, product_name, quantity,
        applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr,
        total_usd, total_khr, return_to_stock, branch_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)

    for (const item of d.items) {
      const qty = toNumber(item.quantity, 0)
      const unitCostUsd = toNumber(item.cost_price_usd ?? item.unit_cost_usd, 0)
      const unitCostKhr = toNumber(item.cost_price_khr ?? item.unit_cost_khr, 0)
      const totalUsd = Number((qty * unitCostUsd).toFixed(2))
      const totalKhr = Math.round(qty * unitCostKhr)
      const itemBranchId = item.branch_id || d.branch_id || null
      const itemBranchName = itemBranchId
        ? db.prepare('SELECT name FROM branches WHERE id = ?').get(itemBranchId)?.name || branchName || null
        : branchName || null

      insertItem.run(
        rid,
        null,
        item.product_id,
        item.product_name || null,
        qty,
        unitCostUsd,
        unitCostKhr,
        unitCostUsd,
        unitCostKhr,
        totalUsd,
        totalKhr,
        0,
        itemBranchId,
      )

      db.prepare(`UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), updated_at = datetime('now') WHERE id = ?`)
        .run(qty, item.product_id)

      if (itemBranchId) {
        db.prepare(`
          INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,MAX(0,-?))
          ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, quantity - ?)
        `).run(item.product_id, itemBranchId, qty, qty)
      }

      db.prepare(`
        INSERT INTO inventory_movements
          (product_id, product_name, branch_id, branch_name, movement_type, quantity,
           unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
           reason, reference_id, user_id, user_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        item.product_id,
        item.product_name || null,
        itemBranchId,
        itemBranchName,
        'supplier_return',
        qty,
        unitCostUsd,
        unitCostKhr,
        totalUsd,
        totalKhr,
        `Supplier return (${settlement}): ${d.reason}`,
        rid,
        actor.userId,
        actor.userName,
      )
    }

    audit(actor.userId, actor.userName, 'create', 'supplier_return', rid,
      { returnNumber, settlement, supplierName: d.supplier_name || null }, {
        tableName: 'returns',
        recordId: rid,
        newValue: {
          return_scope: SUPPLIER_SCOPE,
          supplier_name: d.supplier_name || null,
          supplier_settlement: settlement,
          supplier_loss_usd: supplierLossUsd,
        },
        deviceName: d.device_name || null,
        deviceTz: d.device_tz || null,
      })

      return rid
    })()

    broadcast('returns')
    broadcast('products')
    broadcast('inventory')
    ok(res, { id: returnId, returnNumber })
  } catch (e) {
    if (clientRequestId && /client_request_id/i.test(String(e?.message || ''))) {
      const duplicateReturn = findReturnByClientRequestId(clientRequestId)
      if (duplicateReturn) {
        return ok(res, { id: duplicateReturn.id, returnNumber: duplicateReturn.return_number, duplicate: true })
      }
    }
    return err(res, e.message)
  }
})

// PATCH /api/returns/:id  — update a return (e.g. customer changed mind)
router.patch('/returns/:id', authToken, requirePermission('sales'), (req, res) => {
  const { id } = req.params
  const d = req.body || {}
  const actor = getAuditActor(req)

  const existing = db.prepare('SELECT * FROM returns WHERE id = ?').get(id)
  if (!existing) return err(res, 'Return not found', 404)
  if (normalizeScope(existing.return_scope, CUSTOMER_SCOPE) !== CUSTOMER_SCOPE) {
    return err(res, 'Supplier returns cannot be edited from this form yet.', 400)
  }

  const existingItems = db.prepare('SELECT * FROM return_items WHERE return_id = ?').all(id)
  const newItems = Array.isArray(d.items) ? d.items : existingItems

  try {
    assertUpdatedAtMatch('return', existing, getExpectedUpdatedAt(d))
    assertReturnableItems(existing.sale_id || null, newItems, parseInt(id, 10))
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    return err(res, e.message)
  }

  try {
    db.transaction(() => {
    const branchName = d.branch_id
      ? db.prepare('SELECT name FROM branches WHERE id = ?').get(d.branch_id)?.name
      : existing.branch_name

    // Reverse previous stock effects
    for (const item of existingItems) {
      if (item.return_to_stock && item.product_id) {
        // Undo: remove from stock what was previously added back
        db.prepare(`UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), updated_at = datetime('now') WHERE id = ?`)
          .run(item.quantity, item.product_id)
        if (item.branch_id) {
          db.prepare(`
            INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,MAX(0,-?))
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, quantity - ?)
          `).run(item.product_id, item.branch_id, item.quantity, item.quantity)
        }
        // Log reversal
        db.prepare(`
          INSERT INTO inventory_movements
            (product_id, product_name, branch_id, branch_name, movement_type, quantity,
             unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          item.product_id, item.product_name,
          item.branch_id, existing.branch_name,
          'return_reversal', item.quantity,
          item.cost_price_usd || 0, 0,
          (item.cost_price_usd || 0) * item.quantity, 0,
          `Return #${existing.return_number} updated — reversing previous restock`,
          parseInt(id), actor.userId, actor.userName,
        )
      }
    }

    // Delete old items
    db.prepare('DELETE FROM return_items WHERE return_id = ?').run(id)

    // Compute new totals
    let totalRefundUsd = 0
    let totalRefundKhr = 0

    const insertItem = db.prepare(`
      INSERT INTO return_items (
        return_id, sale_item_id, product_id, product_name, quantity,
        applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr,
        total_usd, total_khr, return_to_stock, branch_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)

    for (const item of newItems) {
      const totalUsd = (item.applied_price_usd || 0) * item.quantity
      const totalKhr = (item.applied_price_khr || 0) * item.quantity
      const returnToStock = item.return_to_stock !== false ? 1 : 0
      totalRefundUsd += totalUsd
      totalRefundKhr += totalKhr

      insertItem.run(
        id, item.sale_item_id || null, item.product_id || null, item.product_name || null,
        item.quantity, item.applied_price_usd || 0, item.applied_price_khr || 0,
        item.cost_price_usd || 0, item.cost_price_khr || 0, totalUsd, totalKhr, returnToStock,
        item.branch_id || existing.branch_id || null,
      )

      // Re-apply stock if return_to_stock
      if (returnToStock && item.product_id) {
        db.prepare(`UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ?`)
          .run(item.quantity, item.product_id)
        const bid = item.branch_id || existing.branch_id
        if (bid) {
          db.prepare(`
            INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,?)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + ?
          `).run(item.product_id, bid, item.quantity, item.quantity)
        }
        db.prepare(`
          INSERT INTO inventory_movements
            (product_id, product_name, branch_id, branch_name, movement_type, quantity,
             unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          item.product_id, item.product_name,
          item.branch_id || existing.branch_id || null, branchName,
          'return', item.quantity,
          item.cost_price_usd || 0, item.cost_price_khr || 0,
          (item.cost_price_usd || 0) * item.quantity, (item.cost_price_khr || 0) * item.quantity,
          `Return #${existing.return_number} updated: ${d.reason || existing.reason}`,
          parseInt(id), actor.userId, actor.userName,
        )
      }
    }

    // Update return header
    db.prepare(`
      UPDATE returns SET
        reason = ?, return_type = ?, notes = ?,
        total_refund_usd = ?, total_refund_khr = ?,
        branch_id = ?, branch_name = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      d.reason || existing.reason,
      d.return_type || existing.return_type,
      d.notes !== undefined ? d.notes : existing.notes,
      d.total_refund_usd !== undefined ? d.total_refund_usd : totalRefundUsd,
      d.total_refund_khr !== undefined ? d.total_refund_khr : totalRefundKhr,
      d.branch_id || existing.branch_id,
      branchName || existing.branch_name,
      id,
    )

    // Re-evaluate parent sale status
    if (existing.sale_id) {
      const saleItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(existing.sale_id)
      const allReturned = db.prepare(`
        SELECT ri.product_id, SUM(ri.quantity) AS total_qty
        FROM return_items ri JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ?
          AND COALESCE(r.status, 'completed') != 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'
        GROUP BY ri.product_id
      `).all(existing.sale_id)
      const map = {}
      allReturned.forEach(r => { map[r.product_id] = r.total_qty })
      const fullyReturned = saleItems.every(si => (map[si.product_id] || 0) >= si.quantity)
      const hasAny = allReturned.length > 0
      const newStatus = fullyReturned ? 'returned' : hasAny ? 'partial_return' : 'completed'
      db.prepare("UPDATE sales SET sale_status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, existing.sale_id)
    }

    audit(actor.userId, actor.userName, 'update', 'return', parseInt(id),
      { reason: d.reason }, {
        tableName: 'returns', recordId: parseInt(id),
        oldValue: { reason: existing.reason, return_type: existing.return_type },
        newValue: { reason: d.reason, return_type: d.return_type },
        deviceName: d.device_name || null,
        deviceTz: d.device_tz || null,
        clientTime: d.client_time || null,
      })
    })()
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    return err(res, e.message)
  }

  broadcast('returns')
  broadcast('products')
  broadcast('sales')
  broadcast('inventory')
  const updatedReturn = db.prepare('SELECT id, updated_at FROM returns WHERE id = ?').get(id)
  ok(res, updatedReturn || { id: parseInt(id) })
})

module.exports = router
