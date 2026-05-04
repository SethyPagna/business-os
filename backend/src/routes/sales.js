'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, logOp, getSafeCostPrice, tryParse } = require('../helpers')
const { authToken, requirePermission, getAuditActor, isAdminControlUser } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')
const { normalizeClientRequestId } = require('../idempotency')
const { getExpiringProducts, getLowStockProducts, getOutOfStockProducts, getStockMetrics } = require('../businessMetrics')

const router = express.Router()

function periodExpression(alias, granularity = 'day') {
  const createdAt = `NULLIF(${alias}.created_at::text, '')::timestamptz`
  if (granularity === 'week') return `to_char(${createdAt}, 'IYYY-"W"IW')`
  if (granularity === 'month') return `to_char(${createdAt}, 'YYYY-MM')`
  return `to_char(${createdAt}, 'YYYY-MM-DD')`
}

function hourExpression(column = 'created_at') {
  return `to_char(NULLIF(${column}::text, '')::timestamptz, 'HH24')`
}

function normalizeImportedTimestamp(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function getSaleItemCosts(item, product = null) {
  // First try item's own cost prices
  let unitCostUsd = item.cost_price_usd ?? item.purchase_price_usd
  let unitCostKhr = item.cost_price_khr ?? item.purchase_price_khr

  // If not provided, try to get from product data
  if ((unitCostUsd == null || unitCostUsd === 0) && product) {
    unitCostUsd = product.cost_price_usd ?? product.purchase_price_usd ?? 0
  }
  if ((unitCostKhr == null || unitCostKhr === 0) && product) {
    unitCostKhr = product.cost_price_khr ?? product.purchase_price_khr ?? 0
  }

  // Fallback to 0
  unitCostUsd = parseFloat(unitCostUsd) || 0
  unitCostKhr = parseFloat(unitCostKhr) || 0
  const quantity = parseFloat(item.quantity) || 0

  return {
    unitCostUsd: Math.max(0, unitCostUsd),
    unitCostKhr: Math.max(0, unitCostKhr),
    totalCostUsd: Math.max(0, unitCostUsd) * quantity,
    totalCostKhr: Math.max(0, unitCostKhr) * quantity,
  }
}

function assertSaleStockAvailable(items, fallbackBranchId = null) {
  const needed = new Map()

  for (const item of items || []) {
    const productId = item.product_id || item.id
    if (!productId) continue
    const scopedBranchId = item.branch_id || fallbackBranchId || null
    const key = `${productId}:${scopedBranchId || 'all'}`
    needed.set(key, (needed.get(key) || 0) + (parseFloat(item.quantity) || 0))
  }

  for (const [key, requiredQty] of needed.entries()) {
    const [productIdRaw, branchIdRaw] = key.split(':')
    const productId = parseInt(productIdRaw, 10)
    const branchId = branchIdRaw === 'all' ? null : parseInt(branchIdRaw, 10)

    const available = branchId
      ? (db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(productId, branchId)?.quantity || 0)
      : (db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId)?.stock_quantity || 0)

    if (requiredQty > available) {
      const sample = (items || []).find(item => (item.product_id || item.id) === productId)
      const name = sample?.product_name || sample?.name || `product #${productId}`
      const scope = branchId ? ' in the selected branch' : ''
      throw new Error(`Insufficient stock for ${name}${scope}: requested ${requiredQty}, available ${available}`)
    }
  }
}

function findCustomerForSaleAssignment({ customerId, membershipNumber }) {
  if (customerId) {
    return db.prepare(`
      SELECT id, name, membership_number, phone, address
      FROM customers
      WHERE id = ?
      LIMIT 1
    `).get(customerId)
  }

  const membership = String(membershipNumber || '').trim()
  if (!membership) return null

  return db.prepare(`
    SELECT id, name, membership_number, phone, address
    FROM customers
    WHERE lower(trim(membership_number)) = lower(trim(?))
    LIMIT 1
  `).get(membership)
}

function parseBranchId(value) {
  const id = parseInt(value, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

function getActiveBranchContext() {
  const branches = db.prepare(`
    SELECT id, name, is_default
    FROM branches
    WHERE is_active = 1
    ORDER BY is_default DESC, id ASC
  `).all()

  return {
    branches,
    branchMap: new Map(branches.map((branch) => [branch.id, branch])),
    defaultBranch: branches.find((branch) => branch.is_default) || branches[0] || null,
  }
}

function requireActiveBranch(branchId, branchMap) {
  if (!branchId) return null
  const branch = branchMap.get(branchId)
  if (!branch) throw new Error('Selected branch is no longer active')
  return branch
}

function resolveSaleItemBranchId(item, fallbackBranchId, branchContext) {
  const explicitBranchId = parseBranchId(item?.branch_id)
  if (explicitBranchId) return requireActiveBranch(explicitBranchId, branchContext.branchMap)?.id || null

  const saleBranchId = parseBranchId(fallbackBranchId)
  if (saleBranchId) return requireActiveBranch(saleBranchId, branchContext.branchMap)?.id || null

  if (branchContext.branches.length <= 1) return branchContext.defaultBranch?.id || null
  return null
}

function normalizeSaleItems(items, fallbackBranchId, branchContext) {
  return (items || []).map((item, index) => {
    const productId = parseInt(item?.product_id || item?.id, 10)
    if (!productId) throw new Error(`Sale item #${index + 1} is missing a product`)

    const quantity = parseFloat(item?.quantity) || 0
    if (quantity <= 0) throw new Error(`Sale item #${index + 1} has an invalid quantity`)

    const productName = item?.product_name || item?.name || `product #${productId}`
    const branchId = resolveSaleItemBranchId(item, fallbackBranchId, branchContext)

    if (branchContext.branches.length > 1 && !branchId) {
      throw new Error(`Select a branch for ${productName} before checkout`)
    }

    const branch = branchId ? requireActiveBranch(branchId, branchContext.branchMap) : null

    return {
      ...item,
      product_id: productId,
      id: productId,
      name: productName,
      product_name: productName,
      quantity,
      branch_id: branch?.id || null,
      branch_name: branch?.name || null,
    }
  })
}

function summarizeSaleBranch(items, branchContext) {
  const branchIds = [...new Set((items || []).map((item) => parseBranchId(item.branch_id)).filter(Boolean))]
  if (branchIds.length === 1) {
    const branch = branchContext.branchMap.get(branchIds[0])
    return {
      branchId: branch?.id || null,
      branchName: branch?.name || null,
      isMixed: false,
    }
  }
  if (branchIds.length > 1) {
    return {
      branchId: null,
      branchName: 'Multiple branches',
      isMixed: true,
    }
  }
  return {
    branchId: null,
    branchName: null,
    isMixed: false,
  }
}

function refreshProductStockQuantity(productId) {
  db.prepare(`
    UPDATE products
    SET stock_quantity = (
      SELECT COALESCE(SUM(quantity), 0)
      FROM branch_stock
      WHERE product_id = ?
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(productId, productId)
}

function refreshProductStockQuantities(productIds) {
  for (const productId of productIds || []) {
    if (!productId) continue
    refreshProductStockQuantity(productId)
  }
}

function deductBranchStock(productId, branchId, quantity) {
  db.prepare(`
    INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0)
    ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = GREATEST(0, quantity - CAST(? AS numeric))
  `).run(productId, branchId, quantity)
}

function fetchSaleItemsWithBranches(saleId) {
  return db.prepare(`
    SELECT si.*, b.name AS branch_name
    FROM sale_items si
    LEFT JOIN branches b ON b.id = si.branch_id
    WHERE si.sale_id = ?
  `).all(saleId)
}

function findSaleByClientRequestId(clientRequestId) {
  if (!clientRequestId) return null
  return db.prepare(`
    SELECT id, receipt_number
    FROM sales
    WHERE client_request_id = ?
    LIMIT 1
  `).get(clientRequestId)
}

// POST /api/sales
router.post('/sales', authToken, requirePermission('sales'), (req, res) => {
  const t0 = Date.now()
  const d  = req.body || {}
  const actor = getAuditActor(req)
  const saleCreatedAt = normalizeImportedTimestamp(d.created_at ?? d.sale_date ?? d.date)
  const cashierId = Number.isFinite(parseInt(d.cashier_id, 10)) ? parseInt(d.cashier_id, 10) : actor.userId
  const cashierName = String(d.cashier_name || actor.userName || '').trim() || actor.userName
  if (!Array.isArray(d.items) || d.items.length === 0) return err(res, 'Sale items required')
  const clientRequestId = normalizeClientRequestId(d.client_request_id)

  const existingSale = findSaleByClientRequestId(clientRequestId)
  if (existingSale) {
    return ok(res, {
      id: existingSale.id,
      receiptNumber: existingSale.receipt_number,
      duplicate: true,
    })
  }

  const receiptNumber = String(d.receipt_number || '').trim()
    || `RCP-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`

  let saleId
  try {
    saleId = db.transaction(() => {
      const branchContext = getActiveBranchContext()
      const normalizedItems = normalizeSaleItems(d.items, d.branch_id || null, branchContext)
      const saleBranch = summarizeSaleBranch(normalizedItems, branchContext)

      const saleStatus = d.sale_status || 'completed'
      const shouldDeductStock = (saleStatus === 'completed' || saleStatus === 'awaiting_delivery')
      if (shouldDeductStock) assertSaleStockAvailable(normalizedItems, null)

      const sid = db.prepare(`
        INSERT INTO sales (
          receipt_number, client_request_id, cashier_id, cashier_name, customer_name, customer_phone, customer_address,
          customer_id,
          branch_id, branch_name, subtotal_usd, subtotal_khr, discount_usd, discount_khr,
          membership_discount_usd, membership_discount_khr, membership_points_redeemed,
          tax_usd, tax_khr, total_usd, total_khr, payment_method, payment_currency,
          amount_paid_usd, amount_paid_khr, change_usd, change_khr, exchange_rate,
          is_delivery, delivery_contact_id, delivery_contact_name, delivery_contact_phone,
          delivery_contact_address, delivery_fee_usd, delivery_fee_khr, delivery_fee_paid_by,
          sale_status, notes, device_tz, device_name
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
        receiptNumber, clientRequestId, cashierId, cashierName,
        d.customer_name || null, d.customer_phone || null, d.customer_address || null,
        d.customer_id || null,
        saleBranch.branchId, saleBranch.branchName,
        d.subtotal_usd || 0, d.subtotal_khr || 0,
        d.discount_usd || 0, d.discount_khr || 0,
        d.membership_discount_usd || 0, d.membership_discount_khr || 0, d.membership_points_redeemed || 0,
        d.tax_usd || 0, d.tax_khr || 0,
        d.total_usd || 0, d.total_khr || 0,
        d.payment_method || 'Cash', d.payment_currency || 'USD',
        d.amount_paid_usd || 0, d.amount_paid_khr || 0,
        d.change_usd || 0, d.change_khr || 0,
        d.exchange_rate || 4100,
        d.is_delivery ? 1 : 0,
        d.delivery_contact_id || null, d.delivery_contact_name || null,
        d.delivery_contact_phone || null, d.delivery_contact_address || null,
        d.delivery_fee_usd || 0, d.delivery_fee_khr || 0,
        d.delivery_fee_paid_by || 'customer',
        saleStatus,
        d.notes || null,
        d.device_tz || null, d.device_name || null,
      ).lastInsertRowid

      if (saleCreatedAt) {
        db.prepare('UPDATE sales SET created_at = ?, updated_at = \'now\' WHERE id = ?')
          .run(saleCreatedAt, sid)
      }

      const insertItem = db.prepare(`
        INSERT INTO sale_items
          (sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr,
           price_mode, product_discount_type, product_discount_label, product_discount_usd, product_discount_khr,
           cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)

      // Pre-fetch all product data for cost price defaults
      const productIdSet = new Set(d.items.map(it => it.id || it.product_id).filter(Boolean))
      const productMap = new Map()
      if (productIdSet.size > 0) {
        db.prepare(`SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr FROM products WHERE id IN (${Array.from(productIdSet).map(() => '?').join(',')})`)
          .all(...Array.from(productIdSet))
          .forEach(p => productMap.set(p.id, p))
      }

      const touchedProductIds = new Set()

      for (const item of normalizedItems) {
        const productId = item.product_id
        const product = productMap.get(productId)
        const totalUsd = (item.applied_price_usd || 0) * item.quantity
        const totalKhr = (item.applied_price_khr || 0) * item.quantity
        const { unitCostUsd, unitCostKhr, totalCostUsd, totalCostKhr } = getSaleItemCosts(item, product)

        insertItem.run(
          sid, productId || null, item.name || null, item.quantity,
          item.applied_price_usd || 0, item.applied_price_khr || 0,
          item.price_mode || 'selling',
          item.product_discount_type || item.discount_type || null,
          item.product_discount_label || item.discount_label || null,
          item.product_discount_usd || item.discount_amount_usd || 0,
          item.product_discount_khr || item.discount_amount_khr || 0,
          unitCostUsd, unitCostKhr,
          totalUsd, totalKhr, item.branch_id || null,
        )

        if (shouldDeductStock) {
          if (item.branch_id) {
            deductBranchStock(productId, item.branch_id, item.quantity)
          }
          touchedProductIds.add(productId)

          const movementId = db.prepare(`
            INSERT INTO inventory_movements
              (product_id, product_name, branch_id, branch_name, movement_type, quantity,
               unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            productId || null,
            item.name,
            item.branch_id || null,
            item.branch_name,
            'sale',
            item.quantity,
            unitCostUsd,
            unitCostKhr,
            totalCostUsd,
            totalCostKhr,
            `Sale ${receiptNumber} (${saleStatus})`,
            sid,
            actor.userId,
            actor.userName,
          ).lastInsertRowid

          if (saleCreatedAt) {
            db.prepare('UPDATE inventory_movements SET created_at = ? WHERE id = ?')
              .run(saleCreatedAt, movementId)
          }
        }
      }

      if (shouldDeductStock) {
        refreshProductStockQuantities(touchedProductIds)
      }

      audit(actor.userId, actor.userName, 'create', 'sale', sid,
        { receiptNumber, total: d.total_usd, status: saleStatus, branch: saleBranch.branchName }, {
          tableName: 'sales', recordId: sid,
          newValue: { receiptNumber, total: d.total_usd, status: saleStatus, branch: saleBranch.branchName },
          deviceName: d.device_name || null,
          deviceTz:   d.device_tz   || null,
          clientTime: d.client_time  || null,
        })
      return sid
    })()
  } catch (e) {
    if (clientRequestId && /client_request_id/i.test(String(e?.message || ''))) {
      const duplicateSale = findSaleByClientRequestId(clientRequestId)
      if (duplicateSale) {
        return ok(res, {
          id: duplicateSale.id,
          receiptNumber: duplicateSale.receipt_number,
          duplicate: true,
        })
      }
    }
    return err(res, e.message)
  }

  logOp('sales:create', Date.now() - t0)
  broadcast('sales')
  broadcast('products')
  broadcast('inventory')
  ok(res, { id: saleId, receiptNumber })
})

// PATCH /api/sales/:id/status  â€” update sale status
router.patch('/sales/:id/status', authToken, requirePermission('sales'), (req, res) => {
  const { id } = req.params
  const payload = req.body || {}
  const actor = getAuditActor(req)
  const { sale_status, notes, device_name, device_tz, client_time } = payload

  const validStatuses = ['completed', 'awaiting_payment', 'awaiting_delivery', 'cancelled', 'partial_return', 'returned']
  if (!sale_status || !validStatuses.includes(sale_status)) {
    return err(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`)
  }

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id)
  if (!sale) return err(res, 'Sale not found', 404)
  try {
    assertUpdatedAtMatch('sale', sale, getExpectedUpdatedAt(payload))
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    return err(res, e.message)
  }

  const oldStatus = sale.sale_status || 'completed'
  if (oldStatus === sale_status) return ok(res, { id: parseInt(id), sale_status, updated_at: sale.updated_at || null })

  try {
    db.transaction(() => {
      // Build update query
      const updates = ['sale_status = ?', "updated_at = CURRENT_TIMESTAMP"]
      const params = [sale_status]
      if (notes !== undefined) { updates.push('notes = ?'); params.push(notes) }
      params.push(id)
      db.prepare(`UPDATE sales SET ${updates.join(', ')} WHERE id = ?`).run(...params)

      const items = fetchSaleItemsWithBranches(id)

      // Define which statuses trigger stock deduction
      const statusesWithStockDeducted = ['completed', 'awaiting_delivery']
      const wasStockDeducted = statusesWithStockDeducted.includes(oldStatus)
      const willStockBeDeducted = statusesWithStockDeducted.includes(sale_status)

      // Handle stock adjustments based on transition
      if (oldStatus === 'awaiting_payment' && willStockBeDeducted) {
        // Transition: awaiting_payment â†’ {completed, awaiting_delivery}
        // Stock needs to be deducted now (it was held, not deducted)
        assertSaleStockAvailable(items, sale.branch_id || null)

        const touchedProductIds = new Set()
        for (const item of items) {
          if (item.branch_id) {
            deductBranchStock(item.product_id, item.branch_id, item.quantity)
          }
          touchedProductIds.add(item.product_id)

          db.prepare(`
            INSERT INTO inventory_movements
              (product_id, product_name, branch_id, branch_name, movement_type, quantity,
               unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            item.product_id,
            item.product_name,
            item.branch_id,
            item.branch_name || null,
            'sale',
            item.quantity,
            item.cost_price_usd || 0,
            item.cost_price_khr || 0,
            (item.cost_price_usd || 0) * item.quantity,
            (item.cost_price_khr || 0) * item.quantity,
            `Sale status changed from awaiting_payment to ${sale_status}`,
            id,
            actor.userId,
            actor.userName,
          )
        }
        refreshProductStockQuantities(touchedProductIds)
      } else if (wasStockDeducted && !willStockBeDeducted && sale_status !== 'partial_return' && sale_status !== 'returned') {
        // Transition: {completed, awaiting_delivery} â†’ awaiting_payment / cancelled / other
        // Stock was deducted, now needs to be restored
        const touchedProductIds = new Set()
        for (const item of items) {
          if (item.branch_id) {
            db.prepare(`
              INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,?)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + ?
            `).run(item.product_id, item.branch_id, item.quantity, item.quantity)
          }
          touchedProductIds.add(item.product_id)

          db.prepare(`
            INSERT INTO inventory_movements
              (product_id, product_name, branch_id, branch_name, movement_type, quantity,
               unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            item.product_id,
            item.product_name,
            item.branch_id,
            item.branch_name || null,
            'return',
            item.quantity,
            item.cost_price_usd || 0,
            item.cost_price_khr || 0,
            (item.cost_price_usd || 0) * item.quantity,
            (item.cost_price_khr || 0) * item.quantity,
            `Sale status changed from ${oldStatus} to ${sale_status}`,
            id,
            actor.userId,
            actor.userName,
          )
        }
        refreshProductStockQuantities(touchedProductIds)
      }

      audit(actor.userId, actor.userName, 'update', 'sale', parseInt(id),
        { oldStatus, newStatus: sale_status }, {
          tableName: 'sales', recordId: parseInt(id),
          oldValue: { sale_status: oldStatus },
          newValue: { sale_status },
          deviceName: device_name || null,
          deviceTz:   device_tz   || null,
          clientTime: client_time || null,
        })
    })()
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    return err(res, e.message)
  }

  broadcast('sales')
  broadcast('products')
  broadcast('inventory')
  const updatedSale = db.prepare('SELECT id, sale_status, updated_at FROM sales WHERE id = ?').get(id)
  ok(res, updatedSale || { id: parseInt(id), sale_status })
})

// PATCH /api/sales/:id/customer  -- attach a customer or membership to an existing sale
router.patch('/sales/:id/customer', authToken, requirePermission('sales'), (req, res) => {
  const saleId = parseInt(req.params.id, 10)
  const payload = req.body || {}
  const actor = getAuditActor(req)
  const {
    customerId,
    membershipNumber,
    clearAssignment,
    device_name,
    device_tz,
  } = payload

  if (!saleId) return err(res, 'Invalid sale id')

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId)
  if (!sale) return err(res, 'Sale not found', 404)

  const shouldClearAssignment = !!clearAssignment
  const customer = shouldClearAssignment
    ? null
    : findCustomerForSaleAssignment({ customerId, membershipNumber })
  if (!shouldClearAssignment && !customer) return err(res, 'Customer or membership number not found', 404)

  try {
    db.transaction(() => {
      assertUpdatedAtMatch('sale', sale, getExpectedUpdatedAt(payload))

      db.prepare(`
      UPDATE sales
      SET customer_id = ?, customer_name = ?, customer_phone = ?, customer_address = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `).run(
      customer?.id || null,
      customer?.name || null,
      customer?.phone || null,
      customer?.address || null,
      saleId
      )

      db.prepare(`
      UPDATE returns
      SET customer_id = ?, customer_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE sale_id = ?
      `).run(
      customer?.id || null,
      customer?.name || null,
      saleId
      )

      audit(
        actor.userId,
        actor.userName,
        'update',
        'sale',
        saleId,
        {
          previous_customer_id: sale.customer_id || null,
          next_customer_id: customer?.id || null,
          membership_number: customer?.membership_number || null,
          cleared: shouldClearAssignment ? 1 : 0,
        },
        {
          tableName: 'sales',
          recordId: saleId,
          newValue: {
            customer_id: customer?.id || null,
            customer_name: customer?.name || null,
            membership_number: customer?.membership_number || null,
          },
          deviceName: device_name || null,
          deviceTz: device_tz || null,
        }
      )
    })()
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    return err(res, e.message)
  }

  broadcast('sales')
  broadcast('returns')
  const updatedSale = db.prepare('SELECT id, customer_id, customer_name, updated_at FROM sales WHERE id = ?').get(saleId)
  ok(res, {
    ...(updatedSale || { id: saleId }),
    customer: customer ? {
      id: customer.id,
      name: customer.name || null,
      membership_number: customer.membership_number || null,
      phone: customer.phone || null,
      address: customer.address || null,
    } : null,
  })
})

// GET /api/sales
router.get('/sales', authToken, requirePermission('sales'), (req, res) => {
  const { startDate, endDate, cashier, branchId, status, userId, limit = 100 } = req.query
  // Fetch sales with all items in a single query (avoids N+1 problem)
  let q = `SELECT s.*,
             MAX(c.membership_number) AS customer_membership_number,
             COALESCE(MAX(r.refund_usd), 0) AS refund_usd,
             COALESCE(MAX(r.refund_khr), 0) AS refund_khr,
             COALESCE(MAX(r.return_count), 0) AS return_count,
             STRING_AGG(si.product_name || ' x' || si.quantity, ', ' ORDER BY si.id) FILTER (WHERE si.id IS NOT NULL) AS items_summary,
             COALESCE(json_agg(json_build_object(
                 'id', si.id,
                 'sale_id', si.sale_id,
                 'product_id', si.product_id,
                 'product_name', si.product_name,
                 'quantity', si.quantity,
                 'applied_price_usd', si.applied_price_usd,
                 'applied_price_khr', si.applied_price_khr,
                 'cost_price_usd', si.cost_price_usd,
                 'cost_price_khr', si.cost_price_khr,
                 'total_usd', si.total_usd,
                 'total_khr', si.total_khr,
                 'branch_id', si.branch_id,
                 'branch_name', bsi.name
               )
             ) FILTER (WHERE si.id IS NOT NULL), '[]'::json)::text AS items_json
           FROM sales s
           LEFT JOIN customers c ON c.id = s.customer_id
           LEFT JOIN (
             SELECT sale_id,
               COUNT(*) AS return_count,
               COALESCE(SUM(total_refund_usd), 0) AS refund_usd,
               COALESCE(SUM(total_refund_khr), 0) AS refund_khr
             FROM returns
             WHERE COALESCE(status,'completed') != 'cancelled'
               AND COALESCE(return_scope,'customer') = 'customer'
             GROUP BY sale_id
           ) r ON r.sale_id = s.id
           LEFT JOIN sale_items si ON si.sale_id = s.id
           LEFT JOIN branches bsi ON bsi.id = si.branch_id
           WHERE 1=1`
  const params = []
  if (startDate) { q += ' AND date(s.created_at) >= ?'; params.push(startDate) }
  if (endDate)   { q += ' AND date(s.created_at) <= ?'; params.push(endDate) }
  if (cashier)   { q += ' AND s.cashier_name LIKE ?';   params.push(`%${cashier}%`) }
  if (userId) {
    if (!isAdminControlUser(req.user)) return err(res, 'Administrator access required for cashier user filters.', 403)
    q += ' AND s.cashier_id = ?'
    params.push(parseInt(userId, 10) || userId)
  }
  if (branchId)  {
    q += ' AND (s.branch_id = ? OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = ?))'
    params.push(branchId, branchId)
  }
  if (status)    { q += ' AND s.sale_status = ?';       params.push(status) }
  q += ' GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?'
  params.push(Math.min(parseInt(limit) || 100, 500))  // Cap limit at 500

  const sales = db.prepare(q).all(...params)
  res.json(sales.map(s => ({
    ...s,
    items_json: undefined,  // Remove raw JSON column
    items: tryParse(s.items_json, []),  // Parse items from JSON
    total_discount_usd: (s.discount_usd || 0) + (s.membership_discount_usd || 0),
    total_discount_khr: (s.discount_khr || 0) + (s.membership_discount_khr || 0),
    net_total_usd: (s.total_usd || 0) - (s.refund_usd || 0),
    net_total_khr: (s.total_khr || 0) - (s.refund_khr || 0),
  })))
})

// GET /api/sales/export  â€” enriched export with accounting summary
router.get('/sales/export', authToken, requirePermission('sales'), (req, res) => {
  const { startDate, endDate, period, format = 'json' } = req.query

  let start = startDate
  let end   = endDate

  if (!start || !end) {
    const now = new Date()
    if (period === 'daily') {
      start = end = now.toISOString().split('T')[0]
    } else if (period === 'monthly') {
      start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
      const last = new Date(now.getFullYear(), now.getMonth()+1, 0)
      end = last.toISOString().split('T')[0]
    } else if (period === 'yearly') {
      start = `${now.getFullYear()}-01-01`
      end   = `${now.getFullYear()}-12-31`
    } else {
      start = end = now.toISOString().split('T')[0]
    }
  }

  const sales = db.prepare(`
    SELECT s.* FROM sales s WHERE date(s.created_at) BETWEEN ? AND ?
    ORDER BY s.created_at ASC
  `).all(start, end)

  const getItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?')

  const rows = sales.map(s => {
    const items = getItems.all(s.id)
    const cogs = items.reduce((sum, i) => sum + ((i.cost_price_usd || 0) * i.quantity), 0)
    return { ...s, items, cogs_usd: cogs }
  })

  // Returns summary
  const returnsData = db.prepare(`
    SELECT r.*, ri.total_usd as item_total
    FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE date(r.created_at) BETWEEN ? AND ?
      AND COALESCE(r.status,'completed') != 'cancelled'
      AND COALESCE(r.return_scope,'customer') = 'customer'
  `).all(start, end)
  const totalRefunds = db.prepare(`
    SELECT COALESCE(SUM(total_refund_usd),0) AS total FROM returns
    WHERE date(created_at) BETWEEN ? AND ?
      AND COALESCE(status,'completed') != 'cancelled'
      AND COALESCE(return_scope,'customer') = 'customer'
  `).get(start, end)

  // Accounting summary
  const completedSales = rows.filter(s => ['completed','partial_return','returned'].includes(s.sale_status || 'completed'))
  const revenue      = completedSales.reduce((s, r) => s + (r.subtotal_usd || 0), 0)
  const revenueKhr   = completedSales.reduce((s, r) => s + (r.subtotal_khr || 0), 0)
  const totalCogs    = completedSales.reduce((s, r) => s + (r.cogs_usd || 0), 0)
  const totalDiscount= completedSales.reduce((s, r) => s + (r.discount_usd || 0) + (r.membership_discount_usd || 0), 0)
  const totalTax     = completedSales.reduce((s, r) => s + (r.tax_usd || 0), 0)
  const totalDelivery= completedSales.reduce((s, r) => s + (r.delivery_fee_usd || 0), 0)
  const totalReturns = totalRefunds.total || 0
  const netRevenue   = revenue - totalDiscount - totalReturns
  const grossProfit  = netRevenue - totalCogs
  const txCount      = completedSales.length
  const avgOrder     = txCount > 0 ? netRevenue / txCount : 0

  // By payment method
  const byPayment = db.prepare(`
    SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total_usd),0) AS revenue
    FROM sales WHERE date(created_at) BETWEEN ? AND ?
    AND COALESCE(sale_status,'completed') NOT IN ('cancelled', 'awaiting_payment')
    GROUP BY payment_method ORDER BY revenue DESC
  `).all(start, end)

  // By product
  const byProduct = db.prepare(`
    SELECT si.product_name, si.product_id,
      SUM(si.quantity) AS qty_sold,
      SUM(si.total_usd) AS revenue_usd,
      SUM(si.quantity * si.cost_price_usd) AS cogs_usd
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE date(s.created_at) BETWEEN ? AND ?
    AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled', 'awaiting_payment')
    GROUP BY si.product_name ORDER BY revenue_usd DESC
  `).all(start, end)

  // By status
  const byStatus = db.prepare(`
    SELECT COALESCE(sale_status,'completed') AS status, COUNT(*) AS count,
      COALESCE(SUM(total_usd),0) AS revenue
    FROM sales WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY status
  `).all(start, end)

  const result = {
    period: { start, end },
    summary: {
      total_transactions:  rows.length,
      completed_transactions: txCount,
      revenue_usd:   netRevenue,
      revenue_khr:   revenueKhr,
      cogs_usd:      totalCogs,
      gross_profit_usd: grossProfit,
      gross_margin_pct: netRevenue > 0 ? ((grossProfit / netRevenue) * 100).toFixed(2) : '0.00',
      total_discounts_usd: totalDiscount,
      total_tax_usd:  totalTax,
      total_delivery_usd: totalDelivery,
      avg_order_usd:  avgOrder,
      total_refunds_usd: totalReturns,
      net_revenue_usd: netRevenue,
    },
    by_payment:  byPayment,
    by_product:  byProduct,
    by_status:   byStatus,
    returns_count: returnsData.length,
    sales:  rows.map(s => ({
      receipt_number:  s.receipt_number,
      date:            s.created_at,
      cashier:         s.cashier_name || '',
      branch:          s.branch_name || '',
      customer:        s.customer_name || '',
      payment_method:  s.payment_method || '',
      sale_status:     s.sale_status || 'completed',
      subtotal_usd:    s.subtotal_usd || 0,
      discount_usd:    (s.discount_usd || 0) + (s.membership_discount_usd || 0),
      membership_discount_usd: s.membership_discount_usd || 0,
      membership_points_redeemed: s.membership_points_redeemed || 0,
      tax_usd:         s.tax_usd || 0,
      delivery_fee_usd: s.delivery_fee_usd || 0,
      total_usd:       s.total_usd || 0,
      total_khr:       s.total_khr || 0,
      cogs_usd:        s.cogs_usd || 0,
      profit_usd:      (s.subtotal_usd || 0) - ((s.discount_usd || 0) + (s.membership_discount_usd || 0)) - (s.cogs_usd || 0),
      items_count:     s.items.length,
      notes:           s.notes || '',
    })),
  }

  if (format === 'csv') {
    // Flatten for CSV
    const escape = v => {
      if (v == null) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s
    }
    const headers = Object.keys(result.sales[0] || {})
    const csvRows = [headers.join(','), ...result.sales.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')

    // Prepend summary
    const summaryLines = [
      'SALES EXPORT REPORT',
      `Period: ${start} to ${end}`,
      '',
      'SUMMARY',
      ...Object.entries(result.summary).map(([k,v]) => `${k},${v}`),
      '',
      'SALES DETAIL',
      csvRows,
    ].join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="sales-export-${start}-${end}.csv"`)
    return res.send(summaryLines)
  }

  res.json(result)
})

// GET /api/dashboard
router.get('/dashboard', authToken, requirePermission('sales'), (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0]
  const stockMetrics = getStockMetrics()
  const expiringProducts = getExpiringProducts({ limit: 20, days: 30 })

  const todaySales = db.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_usd),0) AS subtotal, COALESCE(SUM(subtotal_khr),0) AS subtotal_khr, COALESCE(SUM(discount_usd + COALESCE(membership_discount_usd,0)),0) AS discount_usd, COALESCE(SUM(discount_khr + COALESCE(membership_discount_khr,0)),0) AS discount_khr FROM sales WHERE date(created_at) = ? AND COALESCE(sale_status,'completed') NOT IN ('cancelled','awaiting_payment')"
  ).get(todayStr)
  const allSales = db.prepare(
    "SELECT COALESCE(SUM(subtotal_usd),0) AS subtotal, COALESCE(SUM(subtotal_khr),0) AS subtotal_khr, COALESCE(SUM(discount_usd + COALESCE(membership_discount_usd,0)),0) AS discount_usd, COALESCE(SUM(discount_khr + COALESCE(membership_discount_khr,0)),0) AS discount_khr FROM sales WHERE COALESCE(sale_status,'completed') NOT IN ('cancelled','awaiting_payment')"
  ).get()
  const costs   = db.prepare("SELECT COALESCE(SUM(total_cost_usd),0) AS cost_in, COALESCE(SUM(total_cost_khr),0) AS cost_in_khr FROM inventory_movements WHERE movement_type = 'purchase'").get()
  const saleCostOut = db.prepare(`
    SELECT
      COALESCE(SUM(si.quantity * COALESCE(si.cost_price_usd, 0)), 0) AS cost_out,
      COALESCE(SUM(si.quantity * COALESCE(si.cost_price_khr, 0)), 0) AS cost_out_khr
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
  `).get()
  const returnedCost = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_usd, 0) ELSE 0 END), 0) AS cost_out,
      COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_khr, 0) ELSE 0 END), 0) AS cost_out_khr
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE COALESCE(r.status,'completed') != 'cancelled'
      AND COALESCE(r.return_scope,'customer') = 'customer'
  `).get()

  // Returns stats â€” all-time and today
  const allReturns = db.prepare(`
    SELECT COUNT(*) AS return_count,
      COALESCE(SUM(total_refund_usd), 0) AS total_refund_usd,
      COALESCE(SUM(total_refund_khr), 0) AS total_refund_khr
    FROM returns
    WHERE COALESCE(status,'completed') != 'cancelled'
      AND COALESCE(return_scope,'customer') = 'customer'
  `).get()
  const todayReturns = db.prepare(`
    SELECT COUNT(*) AS return_count,
      COALESCE(SUM(total_refund_usd), 0) AS total_refund_usd,
      COALESCE(SUM(total_refund_khr), 0) AS total_refund_khr
    FROM returns
    WHERE date(created_at) = ?
      AND COALESCE(status,'completed') != 'cancelled'
      AND COALESCE(return_scope,'customer') = 'customer'
  `).get(todayStr)
  const supplierReturns = db.prepare(`
    SELECT
      COUNT(*) AS return_count,
      COALESCE(SUM(supplier_compensation_usd), 0) AS compensation_usd,
      COALESCE(SUM(supplier_compensation_khr), 0) AS compensation_khr,
      COALESCE(SUM(supplier_loss_usd), 0) AS loss_usd,
      COALESCE(SUM(supplier_loss_khr), 0) AS loss_khr
    FROM returns
    WHERE COALESCE(status,'completed') != 'cancelled'
      AND COALESCE(return_scope,'customer') = 'supplier'
  `).get()

  const allTaxDelivery = db.prepare(`
    SELECT
      COALESCE(SUM(tax_usd),0)          AS all_tax_usd,
      COALESCE(SUM(delivery_fee_usd),0) AS all_delivery_usd,
      SUM(CASE WHEN is_delivery = 1 THEN 1 ELSE 0 END) AS all_delivery_count
    FROM sales
    WHERE COALESCE(sale_status,'completed') NOT IN ('cancelled')
  `).get()

  res.json({
    today_count:          todaySales.count,
    today_total:          todaySales.subtotal - todaySales.discount_usd - todayReturns.total_refund_usd,
    today_total_khr:      todaySales.subtotal_khr - todaySales.discount_khr - todayReturns.total_refund_khr,
    today_return_count:   todayReturns.return_count,
    today_return_usd:     todayReturns.total_refund_usd,
    all_total:            allSales.subtotal - allSales.discount_usd - allReturns.total_refund_usd,
    all_total_khr:        allSales.subtotal_khr - allSales.discount_khr - allReturns.total_refund_khr,
    all_return_count:     allReturns.return_count,
    all_refund_usd:       allReturns.total_refund_usd,
    all_refund_khr:       allReturns.total_refund_khr,
    supplier_return_count: supplierReturns.return_count || 0,
    supplier_compensation_usd: supplierReturns.compensation_usd || 0,
    supplier_compensation_khr: supplierReturns.compensation_khr || 0,
    supplier_loss_usd: supplierReturns.loss_usd || 0,
    supplier_loss_khr: supplierReturns.loss_khr || 0,
    all_tax_usd:          allTaxDelivery.all_tax_usd,
    all_delivery_usd:     allTaxDelivery.all_delivery_usd,
    all_delivery_count:   allTaxDelivery.all_delivery_count,
    cost_in:              costs.cost_in,
    cost_in_khr:          costs.cost_in_khr,
    cost_out:             saleCostOut.cost_out - returnedCost.cost_out,
    cost_out_khr:         saleCostOut.cost_out_khr - returnedCost.cost_out_khr,
    product_count:        stockMetrics.total_products,
    stock_value_usd:      stockMetrics.stock_value_usd,
    stock_value_khr:      stockMetrics.stock_value_khr,
    in_stock_count:       stockMetrics.in_stock,
    low_stock_count:      stockMetrics.low_stock,
    out_of_stock_count:   stockMetrics.out_of_stock,
    low_stock:            getLowStockProducts({ limit: 5000 }),
    out_of_stock:         getOutOfStockProducts({ limit: 5000 }),
    expiring_products:    expiringProducts,
    expiring_count:       expiringProducts.length,
    recent_sales:         db.prepare('SELECT s.id, s.receipt_number, s.total_usd, s.total_khr, s.created_at, s.customer_name, s.branch_name, s.sale_status FROM sales s ORDER BY s.created_at DESC LIMIT 10').all(),
  })
})

// GET /api/analytics
router.get('/analytics', authToken, requirePermission('sales'), (req, res) => {
  const { startDate, endDate, granularity = 'day' } = req.query
  if (!startDate || !endDate) return err(res, 'startDate and endDate required')

  const saleGroupExpr = periodExpression('s', granularity)
  const returnGroupExpr = periodExpression('r', granularity)

  const periodData = db.prepare(`
    WITH sale_costs AS (
      SELECT sale_id,
        SUM(quantity * COALESCE(cost_price_usd, 0)) AS cost_usd,
        SUM(quantity * COALESCE(cost_price_khr, 0)) AS cost_khr
      FROM sale_items
      GROUP BY sale_id
    ),
    sales_by_period AS (
      SELECT ${saleGroupExpr} AS period,
        COUNT(*) AS sale_count,
        COALESCE(SUM(s.subtotal_usd),0) AS gross_sales_usd,
        COALESCE(SUM(s.subtotal_khr),0) AS gross_sales_khr,
        COALESCE(SUM(s.discount_usd),0) AS store_discount_usd,
        COALESCE(SUM(s.discount_khr),0) AS store_discount_khr,
        COALESCE(SUM(COALESCE(s.membership_discount_usd,0)),0) AS membership_discount_usd,
        COALESCE(SUM(COALESCE(s.membership_discount_khr,0)),0) AS membership_discount_khr,
        COALESCE(SUM(s.discount_usd + COALESCE(s.membership_discount_usd,0)),0) AS total_discount_usd,
        COALESCE(SUM(s.discount_khr + COALESCE(s.membership_discount_khr,0)),0) AS total_discount_khr,
        COALESCE(SUM(s.tax_usd),0) AS tax_usd,
        COALESCE(SUM(s.delivery_fee_usd),0) AS delivery_usd,
        COALESCE(SUM(sc.cost_usd),0) AS cost_usd,
        COALESCE(SUM(sc.cost_khr),0) AS cost_khr
      FROM sales s
      LEFT JOIN sale_costs sc ON sc.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ?
        AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
      GROUP BY period
    ),
    returns_by_period AS (
      SELECT ${returnGroupExpr} AS period,
        COUNT(*) AS return_count,
        COALESCE(SUM(r.total_refund_usd),0) AS refund_usd,
        COALESCE(SUM(r.total_refund_khr),0) AS refund_khr,
        COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_usd, 0) ELSE 0 END),0) AS cogs_returned_usd,
        COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_khr, 0) ELSE 0 END),0) AS cogs_returned_khr
      FROM returns r
      LEFT JOIN return_items ri ON ri.return_id = r.id
      WHERE date(r.created_at) BETWEEN ? AND ?
        AND COALESCE(r.status,'completed') != 'cancelled'
        AND COALESCE(r.return_scope,'customer') = 'customer'
      GROUP BY period
    ),
    periods AS (
      SELECT period FROM sales_by_period
      UNION
      SELECT period FROM returns_by_period
    )
    SELECT
      p.period,
      COALESCE(s.sale_count,0) AS count,
      COALESCE(s.gross_sales_usd,0) AS gross_sales_usd,
      COALESCE(s.gross_sales_khr,0) AS gross_sales_khr,
      COALESCE(s.store_discount_usd,0) AS store_discount_usd,
      COALESCE(s.membership_discount_usd,0) AS membership_discount_usd,
      COALESCE(s.total_discount_usd,0) AS discount_usd,
      COALESCE(r.refund_usd,0) AS refund_usd,
      COALESCE(s.tax_usd,0) AS tax_usd,
      COALESCE(s.delivery_usd,0) AS delivery_usd,
      COALESCE(s.gross_sales_usd,0) - COALESCE(s.total_discount_usd,0) - COALESCE(r.refund_usd,0) AS revenue_usd,
      COALESCE(s.gross_sales_khr,0) - COALESCE(s.total_discount_khr,0) - COALESCE(r.refund_khr,0) AS revenue_khr,
      COALESCE(s.cost_usd,0) - COALESCE(r.cogs_returned_usd,0) AS cost_usd,
      (
        COALESCE(s.gross_sales_usd,0) - COALESCE(s.total_discount_usd,0) - COALESCE(r.refund_usd,0)
      ) - (COALESCE(s.cost_usd,0) - COALESCE(r.cogs_returned_usd,0)) AS profit_usd
    FROM periods p
    LEFT JOIN sales_by_period s ON s.period = p.period
    LEFT JOIN returns_by_period r ON r.period = p.period
    ORDER BY p.period
  `).all(startDate, endDate, startDate, endDate)

  const totals = db.prepare(`
    WITH sales_totals AS (
      SELECT
        COUNT(*) AS tx_count,
        COALESCE(SUM(s.subtotal_usd),0) AS gross_sales_usd,
        COALESCE(SUM(s.subtotal_khr),0) AS gross_sales_khr,
        COALESCE(SUM(s.discount_usd),0) AS store_discount_usd,
        COALESCE(SUM(s.discount_khr),0) AS store_discount_khr,
        COALESCE(SUM(COALESCE(s.membership_discount_usd,0)),0) AS membership_discount_usd,
        COALESCE(SUM(COALESCE(s.membership_discount_khr,0)),0) AS membership_discount_khr,
        COALESCE(SUM(s.discount_usd + COALESCE(s.membership_discount_usd,0)),0) AS discount_usd,
        COALESCE(SUM(s.discount_khr + COALESCE(s.membership_discount_khr,0)),0) AS discount_khr,
        COALESCE(SUM(sc.cost_usd),0) AS cost_usd,
        COALESCE(SUM(sc.cost_khr),0) AS cost_khr,
        COALESCE(SUM(s.tax_usd),0) AS tax_usd,
        COALESCE(SUM(s.delivery_fee_usd),0) AS delivery_usd
      FROM sales s
      LEFT JOIN (
        SELECT sale_id,
          SUM(quantity * COALESCE(cost_price_usd, 0)) AS cost_usd,
          SUM(quantity * COALESCE(cost_price_khr, 0)) AS cost_khr
        FROM sale_items
        GROUP BY sale_id
      ) sc ON sc.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ?
        AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
    ),
    return_totals AS (
      SELECT
        COALESCE(SUM(r.total_refund_usd),0) AS refund_usd,
        COALESCE(SUM(r.total_refund_khr),0) AS refund_khr,
        COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_usd, 0) ELSE 0 END),0) AS cogs_returned_usd,
        COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_khr, 0) ELSE 0 END),0) AS cogs_returned_khr
      FROM returns r
      LEFT JOIN return_items ri ON ri.return_id = r.id
      WHERE date(r.created_at) BETWEEN ? AND ?
        AND COALESCE(r.status,'completed') != 'cancelled'
        AND COALESCE(r.return_scope,'customer') = 'customer'
    )
    SELECT
      s.tx_count,
      s.gross_sales_usd,
      s.gross_sales_khr,
      s.store_discount_usd,
      s.store_discount_khr,
      s.membership_discount_usd,
      s.membership_discount_khr,
      s.discount_usd,
      s.discount_khr,
      r.refund_usd,
      r.refund_khr,
      s.gross_sales_usd - s.discount_usd - r.refund_usd AS revenue_usd,
      s.gross_sales_khr - s.discount_khr - r.refund_khr AS revenue_khr,
      CASE WHEN s.tx_count > 0 THEN (s.gross_sales_usd - s.discount_usd - r.refund_usd) / s.tx_count ELSE 0 END AS avg_order_usd,
      s.cost_usd - r.cogs_returned_usd AS cost_usd,
      s.cost_khr - r.cogs_returned_khr AS cost_khr,
      (s.gross_sales_usd - s.discount_usd - r.refund_usd) - (s.cost_usd - r.cogs_returned_usd) AS profit_usd,
      s.tax_usd,
      s.delivery_usd
    FROM sales_totals s
    CROSS JOIN return_totals r
  `).get(startDate, endDate, startDate, endDate)

  const ms        = new Date(endDate) - new Date(startDate)
  const prevEnd   = new Date(new Date(startDate) - 86400000).toISOString().split('T')[0]
  const prevStart = new Date(new Date(startDate) - ms - 86400000).toISOString().split('T')[0]
  const prevTotals = db.prepare(`
    WITH sales_prev AS (
      SELECT COUNT(*) AS tx_count, COALESCE(SUM(subtotal_usd - discount_usd - COALESCE(membership_discount_usd,0)),0) AS revenue_usd
      FROM sales
      WHERE date(created_at) BETWEEN ? AND ?
        AND COALESCE(sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
    ),
    returns_prev AS (
      SELECT COALESCE(SUM(total_refund_usd),0) AS refund_usd
      FROM returns
      WHERE date(created_at) BETWEEN ? AND ?
        AND COALESCE(status,'completed') != 'cancelled'
        AND COALESCE(return_scope,'customer') = 'customer'
    )
    SELECT
      s.tx_count,
      s.revenue_usd - r.refund_usd AS revenue_usd
    FROM sales_prev s
    CROSS JOIN returns_prev r
  `).get(prevStart, prevEnd, prevStart, prevEnd)

  res.json({
    periodData,
    totals,
    prevTotals,
    periodReturns:  db.prepare(`
      SELECT COUNT(*) AS return_count,
        COALESCE(SUM(ri_agg.items_count), 0) AS items_returned,
        COALESCE(SUM(r.total_refund_usd), 0) AS refund_usd,
        COALESCE(SUM(r.total_refund_khr), 0) AS refund_khr,
        COALESCE(SUM(ri_agg.cogs_returned_usd), 0) AS cogs_returned_usd,
        COALESCE(SUM(ri_agg.cogs_returned_khr), 0) AS cogs_returned_khr
      FROM returns r
      LEFT JOIN (
        SELECT
          return_id,
          SUM(quantity) AS items_count,
          SUM(CASE WHEN return_to_stock = 1 THEN quantity * COALESCE(cost_price_usd, 0) ELSE 0 END) AS cogs_returned_usd,
          SUM(CASE WHEN return_to_stock = 1 THEN quantity * COALESCE(cost_price_khr, 0) ELSE 0 END) AS cogs_returned_khr
        FROM return_items
        GROUP BY return_id
      ) ri_agg ON ri_agg.return_id = r.id
      WHERE date(r.created_at) BETWEEN ? AND ?
      AND COALESCE(r.status,'completed') != 'cancelled'
      AND COALESCE(r.return_scope,'customer') = 'customer'
    `).get(startDate, endDate),
    periodSupplierReturns: db.prepare(`
      SELECT
        COUNT(*) AS return_count,
        COALESCE(SUM(supplier_compensation_usd), 0) AS compensation_usd,
        COALESCE(SUM(supplier_compensation_khr), 0) AS compensation_khr,
        COALESCE(SUM(supplier_loss_usd), 0) AS loss_usd,
        COALESCE(SUM(supplier_loss_khr), 0) AS loss_khr
      FROM returns
      WHERE date(created_at) BETWEEN ? AND ?
        AND COALESCE(status,'completed') != 'cancelled'
        AND COALESCE(return_scope,'customer') = 'supplier'
    `).get(startDate, endDate),
    byPayment:      db.prepare(`SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total_usd),0) AS revenue_usd FROM sales WHERE date(created_at) BETWEEN ? AND ? AND COALESCE(sale_status,'completed') NOT IN ('cancelled','awaiting_payment') GROUP BY payment_method ORDER BY revenue_usd DESC`).all(startDate, endDate),
    topProducts:    db.prepare(`
      WITH sales_by_product AS (
        SELECT si.product_id, si.product_name,
          SUM(si.quantity) AS qty_sold,
          SUM(si.total_usd) AS revenue_usd
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE date(s.created_at) BETWEEN ? AND ?
          AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
        GROUP BY si.product_id, si.product_name
      ),
      returns_by_product AS (
        SELECT ri.product_id,
          SUM(ri.quantity) AS qty_returned,
          SUM(ri.total_usd) AS refund_usd
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE date(r.created_at) BETWEEN ? AND ?
          AND COALESCE(r.status,'completed') != 'cancelled'
          AND COALESCE(r.return_scope,'customer') = 'customer'
        GROUP BY ri.product_id
      )
      SELECT
        s.product_name,
        COALESCE(s.qty_sold,0) - COALESCE(r.qty_returned,0) AS qty_sold,
        COALESCE(s.revenue_usd,0) - COALESCE(r.refund_usd,0) AS revenue_usd
      FROM sales_by_product s
      LEFT JOIN returns_by_product r ON r.product_id = s.product_id
      ORDER BY revenue_usd DESC
      LIMIT 50
    `).all(startDate, endDate, startDate, endDate),
    topProductsQty: db.prepare(`
      WITH sales_by_product AS (
        SELECT si.product_id, si.product_name,
          SUM(si.quantity) AS qty_sold,
          SUM(si.total_usd) AS revenue_usd
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE date(s.created_at) BETWEEN ? AND ?
          AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
        GROUP BY si.product_id, si.product_name
      ),
      returns_by_product AS (
        SELECT ri.product_id,
          SUM(ri.quantity) AS qty_returned,
          SUM(ri.total_usd) AS refund_usd
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE date(r.created_at) BETWEEN ? AND ?
          AND COALESCE(r.status,'completed') != 'cancelled'
          AND COALESCE(r.return_scope,'customer') = 'customer'
        GROUP BY ri.product_id
      )
      SELECT
        s.product_name,
        COALESCE(s.qty_sold,0) - COALESCE(r.qty_returned,0) AS qty_sold,
        COALESCE(s.revenue_usd,0) - COALESCE(r.refund_usd,0) AS revenue_usd
      FROM sales_by_product s
      LEFT JOIN returns_by_product r ON r.product_id = s.product_id
      ORDER BY qty_sold DESC
      LIMIT 50
    `).all(startDate, endDate, startDate, endDate),
    topCustomers:   db.prepare(`
      SELECT
        COALESCE(MAX(c.name), MAX(s.customer_name))                           AS customer_name,
        MAX(c.membership_number)                                              AS membership_number,
        COUNT(DISTINCT s.id)                                              AS sale_count,
        COALESCE(SUM(s.subtotal_usd), 0)                                 AS gross_revenue_usd,
        COALESCE(SUM(s.discount_usd), 0)                                 AS store_discount_usd,
        COALESCE(SUM(COALESCE(s.membership_discount_usd,0)), 0)          AS membership_discount_usd,
        COALESCE(SUM(r_agg.refund_usd), 0)                               AS total_refund_usd,
        COALESCE(SUM(s.subtotal_usd), 0)
          - COALESCE(SUM(s.discount_usd + COALESCE(s.membership_discount_usd,0)), 0)
          - COALESCE(SUM(r_agg.refund_usd), 0)                           AS net_revenue_usd
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN (
        SELECT sale_id, SUM(total_refund_usd) AS refund_usd
        FROM returns
        WHERE COALESCE(status,'completed') != 'cancelled'
          AND COALESCE(return_scope,'customer') = 'customer'
        GROUP BY sale_id
      ) r_agg ON r_agg.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ?
        AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
        AND s.customer_name IS NOT NULL AND s.customer_name != ''
      GROUP BY COALESCE(s.customer_id, 0), lower(trim(COALESCE(s.customer_name, '')))
      ORDER BY net_revenue_usd DESC
      LIMIT 50
    `).all(startDate, endDate),
    byBranch:       db.prepare(`
      WITH sales_by_branch AS (
        SELECT
          COALESCE(s.branch_name,'No Branch') AS branch_name,
          COUNT(*) AS count,
          COALESCE(SUM(s.subtotal_usd - s.discount_usd - COALESCE(s.membership_discount_usd,0)),0) AS revenue_usd
        FROM sales s
        WHERE date(s.created_at) BETWEEN ? AND ?
          AND COALESCE(s.sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
        GROUP BY COALESCE(s.branch_name,'No Branch')
      ),
      returns_by_branch AS (
        SELECT COALESCE(r.branch_name,'No Branch') AS branch_name, COALESCE(SUM(r.total_refund_usd),0) AS refund_usd
        FROM returns r
        WHERE date(r.created_at) BETWEEN ? AND ?
          AND COALESCE(r.status,'completed') != 'cancelled'
          AND COALESCE(r.return_scope,'customer') = 'customer'
        GROUP BY COALESCE(r.branch_name,'No Branch')
      ),
      all_branches AS (
        SELECT branch_name FROM sales_by_branch
        UNION
        SELECT branch_name FROM returns_by_branch
      )
      SELECT
        b.branch_name,
        COALESCE(s.count,0) AS count,
        COALESCE(s.revenue_usd,0) - COALESCE(r.refund_usd,0) AS revenue_usd
      FROM all_branches b
      LEFT JOIN sales_by_branch s ON s.branch_name = b.branch_name
      LEFT JOIN returns_by_branch r ON r.branch_name = b.branch_name
      ORDER BY revenue_usd DESC
    `).all(startDate, endDate, startDate, endDate),
    hourlyDist:     db.prepare(`
      SELECT
        ${hourExpression('created_at')} AS hour,
        COUNT(*) AS count,
        COALESCE(SUM(subtotal_usd - discount_usd - COALESCE(membership_discount_usd,0)),0) AS revenue_usd
      FROM sales
      WHERE date(created_at) BETWEEN ? AND ?
        AND COALESCE(sale_status,'completed') NOT IN ('cancelled','awaiting_payment')
      GROUP BY hour
      ORDER BY hour
    `).all(startDate, endDate),
  })
})

module.exports = router
