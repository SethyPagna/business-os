'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, logOp } = require('../helpers')
const { authToken } = require('../middleware')

const router = express.Router()

// POST /api/inventory/adjust
router.post('/adjust', authToken, (req, res) => {
  const t0 = Date.now()
  const body = req.body || {}
  const {
    productId, productName, type, quantity, reason, branchId,
    userId, userName, deviceName, deviceTz, clientTime,
  } = body
  const unitCostUsd = parseFloat(body.unitCostUsd ?? body.unit_cost_usd ?? 0) || 0
  const unitCostKhr = parseFloat(body.unitCostKhr ?? body.unit_cost_khr ?? 0) || 0

  if (!productId || !quantity) return err(res, 'Missing required fields')
  if (!['add', 'remove', 'set'].includes(type)) return err(res, 'Invalid stock action')

  const qty = parseFloat(quantity)
  if (isNaN(qty) || qty <= 0) return err(res, 'Quantity must be a positive number')

  const product = db.prepare('SELECT id, stock_quantity FROM products WHERE id = ?').get(productId)
  if (!product) return err(res, 'Product not found', 404)

  const activeBranches = db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
  const defaultBranch = activeBranches.find(b => b.is_default) || activeBranches[0] || null
  const requestedBranchId = branchId ? parseInt(branchId, 10) : null
  const branchRows = db.prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = ?').all(productId)
  const getBranchQty = (bid) => branchRows.find(row => row.branch_id === bid)?.quantity || 0
  const totalAvailable = branchRows.reduce((sum, row) => sum + (row.quantity || 0), 0)

  try {
    let movementBranchId = requestedBranchId || null
    let movementQty = Math.abs(qty)

    db.transaction(() => {
      const ensureBranchRow = db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0)')

      if (type === 'add') {
        const targetBranchId = requestedBranchId || defaultBranch?.id
        if (!targetBranchId) throw new Error('An active branch is required before stock can be added')
        ensureBranchRow.run(productId, targetBranchId)
        db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = ?')
          .run(qty, productId, targetBranchId)
        movementBranchId = targetBranchId
      }

      if (type === 'remove') {
        if (requestedBranchId) {
          const available = getBranchQty(requestedBranchId)
          if (available <= 0) throw new Error('No stock available in this branch to remove')
          if (qty > available) throw new Error(`Cannot remove ${qty} — only ${available} available in this branch`)

          db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?')
            .run(qty, productId, requestedBranchId)
          movementBranchId = requestedBranchId
        } else {
          if (totalAvailable <= 0) throw new Error('No stock available to remove')
          if (qty > totalAvailable) throw new Error(`Cannot remove ${qty} — only ${totalAvailable} available`)

          let remaining = qty
          const rowsToDeduct = branchRows
            .filter(row => (row.quantity || 0) > 0)
            .sort((a, b) => (b.quantity || 0) - (a.quantity || 0) || a.branch_id - b.branch_id)

          for (const row of rowsToDeduct) {
            if (remaining <= 0) break
            const take = Math.min(row.quantity || 0, remaining)
            db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?')
              .run(take, productId, row.branch_id)
            remaining -= take
          }

          movementBranchId = null
        }
      }

      if (type === 'set') {
        const targetQty = Math.abs(qty)

        if (requestedBranchId) {
          const currentQty = getBranchQty(requestedBranchId)
          movementQty = Math.abs(targetQty - currentQty)
          ensureBranchRow.run(productId, requestedBranchId)
          db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?')
            .run(targetQty, productId, requestedBranchId)
          movementBranchId = requestedBranchId
        } else {
          if (!defaultBranch) throw new Error('An active branch is required before stock can be set')
          movementQty = Math.abs(targetQty - totalAvailable)

          if (movementQty > 0) {
            db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ?').run(productId)
            ensureBranchRow.run(productId, defaultBranch.id)
            db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?')
              .run(targetQty, productId, defaultBranch.id)
          }

          movementBranchId = defaultBranch.id
        }
      }

      db.prepare(`
        UPDATE products SET
          stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = ?),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(productId, productId)

      if (movementQty > 0) {
        const branchName = movementBranchId
          ? activeBranches.find(branch => branch.id === movementBranchId)?.name
            || db.prepare('SELECT name FROM branches WHERE id = ?').get(movementBranchId)?.name
          : null

        db.prepare(`
          INSERT INTO inventory_movements
            (product_id, product_name, branch_id, branch_name, movement_type, quantity,
             unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, user_id, user_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          productId,
          productName,
          movementBranchId || null,
          branchName || null,
          type,
          movementQty,
          unitCostUsd,
          unitCostKhr,
          movementQty * unitCostUsd,
          movementQty * unitCostKhr,
          reason || null,
          userId || null,
          userName || null,
        )
      }
    })()

    audit(userId, userName, type === 'remove' ? 'stock_remove' : type === 'set' ? 'stock_set' : 'stock_add', 'product', productId,
      { type, quantity: qty, reason, branchId: requestedBranchId }, {
        deviceName: deviceName || null, deviceTz: deviceTz || null, clientTime: clientTime || null,
      })
    logOp('products:adjustStock', Date.now() - t0)
    broadcast('products')
    broadcast('inventory')
    ok(res, {})
  } catch (e) {
    err(res, e.message || 'Stock adjustment failed')
  }
})

// GET /api/inventory/summary
router.get('/summary', authToken, (req, res) => {
  try {
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null
  let products

  // Detect whether parent_id column exists (added via migration — may be absent on older DBs)
  let hasParentId = true
  try { db.prepare('SELECT parent_id FROM products LIMIT 0').run() } catch (_) { hasParentId = false }
  const parentFilter = hasParentId ? 'AND (p.parent_id IS NULL OR p.parent_id = 0)' : ''

  if (branchId) {
    products = db.prepare(`
      SELECT p.*,
        COALESCE(bs.quantity, 0) AS display_quantity,
        COALESCE(bs.quantity * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0), 0) AS stock_value_usd,
        COALESCE(bs.quantity * COALESCE(NULLIF(p.purchase_price_khr, 0), p.cost_price_khr, 0), 0) AS stock_value_khr,
        COALESCE(si.qty_sold, 0) - COALESCE(ret.qty_returned, 0)           AS qty_sold,
        COALESCE(si.store_discount_usd, 0)                                 AS store_discount_usd,
        COALESCE(si.store_discount_khr, 0)                                 AS store_discount_khr,
        COALESCE(si.membership_discount_usd, 0)                            AS membership_discount_usd,
        COALESCE(si.membership_discount_khr, 0)                            AS membership_discount_khr,
        COALESCE(si.revenue_usd, 0) - COALESCE(ret.refund_usd, 0)          AS revenue_usd,
        COALESCE(si.revenue_khr, 0) - COALESCE(ret.refund_khr, 0)          AS revenue_khr,
        COALESCE(si.cogs_usd, 0) - COALESCE(ret.cogs_returned_usd, 0)      AS cogs_usd,
        COALESCE(si.cogs_khr, 0) - COALESCE(ret.cogs_returned_khr, 0)      AS cogs_khr
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ?
      LEFT JOIN (
        SELECT si.product_id, si.branch_id,
               SUM(si.quantity)                    AS qty_sold,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.discount_usd, 0)
                 ELSE 0
               END) AS store_discount_usd,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.discount_khr, 0)
                 ELSE 0
               END) AS store_discount_khr,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.membership_discount_usd, 0)
                 ELSE 0
               END) AS membership_discount_usd,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.membership_discount_khr, 0)
                 ELSE 0
               END) AS membership_discount_khr,
               SUM(si.total_usd - CASE
                 WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * (COALESCE(s.discount_usd, 0) + COALESCE(s.membership_discount_usd, 0))
                 ELSE 0
               END) AS revenue_usd,
               SUM(si.total_khr - CASE
                 WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * (COALESCE(s.discount_khr, 0) + COALESCE(s.membership_discount_khr, 0))
                 ELSE 0
               END) AS revenue_khr,
               SUM(si.cost_price_usd * si.quantity) AS cogs_usd,
               SUM(si.cost_price_khr * si.quantity) AS cogs_khr
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE si.branch_id = ?
          AND COALESCE(s.sale_status, 'completed') NOT IN ('awaiting_payment', 'cancelled')
        GROUP BY si.product_id, si.branch_id
      ) si ON si.product_id = p.id AND si.branch_id = ?
      LEFT JOIN (
        SELECT ri.product_id,
               SUM(ri.quantity)                                                       AS qty_returned,
               SUM(ri.total_usd)                                                      AS refund_usd,
               SUM(ri.total_khr)                                                      AS refund_khr,
               SUM(CASE WHEN ri.return_to_stock=1 THEN ri.cost_price_usd*ri.quantity ELSE 0 END) AS cogs_returned_usd,
               SUM(CASE WHEN ri.return_to_stock=1 THEN ri.cost_price_khr*ri.quantity ELSE 0 END) AS cogs_returned_khr
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE COALESCE(ri.branch_id, r.branch_id) = ?
          AND COALESCE(r.status, 'completed') != 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'
        GROUP BY ri.product_id
      ) ret ON ret.product_id = p.id
      WHERE p.is_active = 1 ${parentFilter}
      ORDER BY p.name
    `).all(branchId, branchId, branchId, branchId)
  } else {
    products = db.prepare(`
      SELECT p.*,
        p.stock_quantity AS display_quantity,
        COALESCE(p.stock_quantity * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0), 0)                        AS stock_value_usd,
        COALESCE(p.stock_quantity * COALESCE(NULLIF(p.purchase_price_khr, 0), p.cost_price_khr, 0), 0)                        AS stock_value_khr,
        COALESCE(si.qty_sold, 0) - COALESCE(ret.qty_returned, 0)                    AS qty_sold,
        COALESCE(si.store_discount_usd, 0)                                          AS store_discount_usd,
        COALESCE(si.store_discount_khr, 0)                                          AS store_discount_khr,
        COALESCE(si.membership_discount_usd, 0)                                     AS membership_discount_usd,
        COALESCE(si.membership_discount_khr, 0)                                     AS membership_discount_khr,
        COALESCE(si.revenue_usd, 0) - COALESCE(ret.refund_usd, 0)                   AS revenue_usd,
        COALESCE(si.revenue_khr, 0) - COALESCE(ret.refund_khr, 0)                   AS revenue_khr,
        COALESCE(si.cogs_usd, 0) - COALESCE(ret.cogs_returned_usd, 0)               AS cogs_usd,
        COALESCE(si.cogs_khr, 0) - COALESCE(ret.cogs_returned_khr, 0)               AS cogs_khr,
        (
          SELECT json_group_array(json_object('branch_id', bs2.branch_id, 'branch_name', b2.name, 'quantity', bs2.quantity))
          FROM branch_stock bs2
          JOIN branches b2 ON b2.id = bs2.branch_id
          WHERE bs2.product_id = p.id
        ) AS branch_stock_json
      FROM products p
      LEFT JOIN (
        SELECT si.product_id,
               SUM(si.quantity)                    AS qty_sold,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.discount_usd, 0)
                 ELSE 0
               END) AS store_discount_usd,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.discount_khr, 0)
                 ELSE 0
               END) AS store_discount_khr,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * COALESCE(s.membership_discount_usd, 0)
                 ELSE 0
               END) AS membership_discount_usd,
               SUM(CASE
                 WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * COALESCE(s.membership_discount_khr, 0)
                 ELSE 0
               END) AS membership_discount_khr,
               SUM(si.total_usd - CASE
                 WHEN COALESCE(s.subtotal_usd, 0) > 0 THEN (si.total_usd / s.subtotal_usd) * (COALESCE(s.discount_usd, 0) + COALESCE(s.membership_discount_usd, 0))
                 ELSE 0
               END) AS revenue_usd,
               SUM(si.total_khr - CASE
                 WHEN COALESCE(s.subtotal_khr, 0) > 0 THEN (si.total_khr / s.subtotal_khr) * (COALESCE(s.discount_khr, 0) + COALESCE(s.membership_discount_khr, 0))
                 ELSE 0
               END) AS revenue_khr,
               SUM(si.cost_price_usd * si.quantity) AS cogs_usd,
               SUM(si.cost_price_khr * si.quantity) AS cogs_khr
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE COALESCE(s.sale_status, 'completed') NOT IN ('awaiting_payment', 'cancelled')
        GROUP BY si.product_id
      ) si ON si.product_id = p.id
      LEFT JOIN (
        SELECT ri.product_id,
               SUM(ri.quantity)                                                            AS qty_returned,
               SUM(ri.total_usd)                                                           AS refund_usd,
               SUM(ri.total_khr)                                                           AS refund_khr,
               SUM(CASE WHEN ri.return_to_stock=1 THEN ri.cost_price_usd*ri.quantity ELSE 0 END) AS cogs_returned_usd,
               SUM(CASE WHEN ri.return_to_stock=1 THEN ri.cost_price_khr*ri.quantity ELSE 0 END) AS cogs_returned_khr
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE COALESCE(r.status, 'completed') != 'cancelled'
          AND COALESCE(r.return_scope, 'customer') = 'customer'
        GROUP BY ri.product_id
      ) ret ON ret.product_id = p.id
      WHERE p.is_active = 1 ${parentFilter}
      ORDER BY p.name
    `).all()

    products = products.map(p => {
      try {
        p.branch_stock = JSON.parse(p.branch_stock_json || '[]')
      } catch { p.branch_stock = [] }
      delete p.branch_stock_json
      return p
    })
  }

  res.json(products)
  } catch (e) {
    console.error('[inventory/summary] error:', e.message)
    err(res, 'Failed to load inventory: ' + e.message)
  }
})

// GET /api/inventory/movements
router.get('/movements', authToken, (req, res) => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null
  let rows
  if (branchId) {
    rows = db.prepare(`
      SELECT * FROM inventory_movements WHERE branch_id = ?
      ORDER BY created_at DESC LIMIT 1000
    `).all(branchId)
  } else {
    rows = db.prepare(`
      SELECT * FROM inventory_movements
      ORDER BY created_at DESC LIMIT 1000
    `).all()
  }
  res.json(rows)
})

module.exports = router
