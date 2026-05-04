'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, logOp } = require('../helpers')
const { authToken, requirePermission, getAuditActor, isAdminControlUser } = require('../middleware')
const { normalizePriceValue } = require('../money')
const { normalizeProductDiscount } = require('../productDiscounts')
const { aggregateInitialRows, getInitialKey, getInitialType } = require('../initials')
const { getStockMetrics } = require('../businessMetrics')

const router = express.Router()

function normalizeImportedTimestamp(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function recalcProductStock(productId) {
  db.prepare(`
    UPDATE products SET
      stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(productId, productId)
}

function cleanMoveReason(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'Stock moved to another product row'
  return raw.replace(/\?+/g, '').replace(/\s+/g, ' ').trim()
}

function normalizePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function splitSearchTerms(value = '') {
  return String(value || '')
    .normalize('NFC')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
}

function appendInventoryProductFilters(query = {}) {
  const where = ['p.is_active = 1']
  const params = {}
  const joins = []
  const branchId = Number.parseInt(query.branchId || query.branch_id || '', 10)
  if (Number.isFinite(branchId) && branchId > 0) {
    params.branchId = branchId
    joins.push('LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id AND selected_bs.branch_id = @branchId')
  }
  const terms = splitSearchTerms(query.query || query.q || '')
  if (terms.length) {
    const mode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    where.push(`(${terms.map((term, index) => {
      const key = `search${index}`
      params[key] = `%${term}%`
      return `(
        lower(COALESCE(p.name, '')) LIKE @${key}
        OR lower(COALESCE(p.sku, '')) LIKE @${key}
        OR lower(COALESCE(p.barcode, '')) LIKE @${key}
        OR lower(COALESCE(p.brand, '')) LIKE @${key}
        OR lower(COALESCE(p.category, '')) LIKE @${key}
        OR lower(COALESCE(p.supplier, '')) LIKE @${key}
        OR lower(COALESCE(p.unit, '')) LIKE @${key}
      )`
    }).join(` ${mode} `)})`)
  }
  const brand = String(query.brand || '').normalize('NFC').trim()
  if (brand && brand.toLowerCase() !== 'all') {
    params.brand = brand
    where.push('p.brand = @brand')
  }
  const stockExpr = params.branchId ? 'COALESCE(selected_bs.quantity, 0)' : 'COALESCE(p.stock_quantity, 0)'
  const stockState = String(query.stockState || query.stock_state || '').toLowerCase()
  if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`)
  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
  const groupState = String(query.groupState || query.group_state || '').toLowerCase()
  if (groupState === 'parent') where.push('(COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)')
  if (groupState === 'variant') where.push('COALESCE(p.parent_id, 0) > 0')
  if (['grouped', 'parents_variants', 'parent_variant', 'parents-and-variants'].includes(groupState)) {
    where.push('((COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0) OR COALESCE(p.parent_id, 0) > 0)')
  }
  if (groupState === 'standalone') where.push('(COALESCE(p.is_group, 0) = 0 AND COALESCE(p.parent_id, 0) = 0)')
  const initial = String(query.initial || '').normalize('NFC').trim()
  if (initial && initial.toLowerCase() !== 'all') {
    const key = getInitialKey(initial)
    params.initial = key
    if (getInitialType(key) === 'latin') where.push("upper(substr(trim(COALESCE(p.name, '')), 1, 1)) = @initial")
    else where.push("substr(trim(COALESCE(p.name, '')), 1, 1) = @initial")
  }
  return { where, joins, params, stockExpr }
}

// POST /api/inventory/adjust
router.post('/adjust', authToken, requirePermission('inventory'), (req, res) => {
  const t0 = Date.now()
  const body = req.body || {}
  const {
    productId, productName, type, quantity, reason, branchId,
    deviceName, deviceTz, clientTime,
  } = body
  const actor = getAuditActor(req, body)
  const unitCostUsd = parseFloat(body.unitCostUsd ?? body.unit_cost_usd ?? 0) || 0
  const unitCostKhr = parseFloat(body.unitCostKhr ?? body.unit_cost_khr ?? 0) || 0
  const movementCreatedAt = normalizeImportedTimestamp(body.created_at ?? body.movement_date ?? body.date)

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
          if (qty > available) throw new Error(`Cannot remove ${qty} â€” only ${available} available in this branch`)

          db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?')
            .run(qty, productId, requestedBranchId)
          movementBranchId = requestedBranchId
        } else {
          if (totalAvailable <= 0) throw new Error('No stock available to remove')
          if (qty > totalAvailable) throw new Error(`Cannot remove ${qty} â€” only ${totalAvailable} available`)

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
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(productId, productId)

      if (movementQty > 0) {
        const branchName = movementBranchId
          ? activeBranches.find(branch => branch.id === movementBranchId)?.name
            || db.prepare('SELECT name FROM branches WHERE id = ?').get(movementBranchId)?.name
          : null

        const movementId = db.prepare(`
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
          actor.userId,
          actor.userName,
        ).lastInsertRowid

        if (movementCreatedAt) {
          db.prepare('UPDATE inventory_movements SET created_at = ? WHERE id = ?')
            .run(movementCreatedAt, movementId)
        }
      }
    })()

    audit(actor.userId, actor.userName, type === 'remove' ? 'stock_remove' : type === 'set' ? 'stock_set' : 'stock_add', 'product', productId,
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

// POST /api/inventory/move-row
router.post('/move-row', authToken, requirePermission('inventory'), (req, res) => {
  const t0 = Date.now()
  const body = req.body || {}
  const actor = getAuditActor(req, body)
  const sourceProductId = parseInt(body.sourceProductId ?? body.source_product_id, 10)
  let destinationProductId = parseInt(body.destinationProductId ?? body.destination_product_id, 10)
  const quantity = parseFloat(body.quantity)
  const requestedBranchId = body.branchId || body.branch_id ? parseInt(body.branchId ?? body.branch_id, 10) : null
  const reason = cleanMoveReason(body.reason)
  const note = String(body.note || '').trim() || null
  const destinationDraft = body.destinationProduct || body.destination_product || null

  if (!sourceProductId) return err(res, 'Source product is required')
  if (!Number.isFinite(quantity) || quantity <= 0) return err(res, 'Quantity must be a positive number')

  try {
    const result = db.transaction(() => {
      const source = db.prepare('SELECT * FROM products WHERE id = ?').get(sourceProductId)
      if (!source) throw new Error('Source product not found')

      const activeBranches = db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
      if (!activeBranches.length) throw new Error('An active branch is required before stock can be moved')

      let branch = requestedBranchId
        ? activeBranches.find((entry) => Number(entry.id) === Number(requestedBranchId))
        : null
      if (!branch) {
        const branchRows = db.prepare(`
          SELECT bs.branch_id, bs.quantity, b.name, b.is_default
          FROM branch_stock bs
          JOIN branches b ON b.id = bs.branch_id
          WHERE bs.product_id = ? AND b.is_active = 1 AND bs.quantity > 0
          ORDER BY bs.quantity DESC, b.is_default DESC, b.id ASC
        `).all(sourceProductId)
        branch = branchRows[0]
          ? { id: branchRows[0].branch_id, name: branchRows[0].name, is_default: branchRows[0].is_default }
          : activeBranches.find((entry) => entry.is_default) || activeBranches[0]
      }
      if (!branch) throw new Error('Selected branch is no longer active')

      const available = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?')
        .get(sourceProductId, branch.id)?.quantity || 0
      if (quantity > available) throw new Error(`Cannot move ${quantity} - only ${available} available in ${branch.name}`)

      if (!destinationProductId && destinationDraft) {
        const name = String(destinationDraft.name || '').trim()
        if (!name) throw new Error('Destination product name is required')
        const duplicate = db.prepare('SELECT id FROM products WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1').get(name)
        if (duplicate) {
          destinationProductId = duplicate.id
        } else {
          const discount = normalizeProductDiscount(destinationDraft, source)
          const rootParentId = source.parent_id || source.id
          db.prepare('UPDATE products SET is_group = 1, updated_at = \'now\' WHERE id = ?').run(rootParentId)
          const inserted = db.prepare(`
            INSERT INTO products (
              name, sku, barcode, category, brand, unit, description,
              selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
              discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr,
              discount_label, discount_badge_color, discount_starts_at, discount_ends_at,
              purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr,
              stock_quantity, low_stock_threshold, out_of_stock_threshold, image_path, is_active,
              supplier, custom_fields, is_group, parent_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            name,
            destinationDraft.sku || null,
            destinationDraft.barcode || null,
            destinationDraft.category || source.category || null,
            destinationDraft.brand || source.brand || null,
            destinationDraft.unit || source.unit || 'pcs',
            destinationDraft.description || `${source.name} - ${reason}`,
            normalizePriceValue(destinationDraft.selling_price_usd ?? source.selling_price_usd ?? 0),
            normalizePriceValue(destinationDraft.selling_price_khr ?? source.selling_price_khr ?? 0),
            normalizePriceValue(destinationDraft.special_price_usd ?? source.special_price_usd ?? source.selling_price_usd ?? 0),
            normalizePriceValue(destinationDraft.special_price_khr ?? source.special_price_khr ?? source.selling_price_khr ?? 0),
            discount.discount_enabled,
            discount.discount_type,
            discount.discount_percent,
            discount.discount_amount_usd,
            discount.discount_amount_khr,
            discount.discount_label || null,
            discount.discount_badge_color,
            discount.discount_starts_at || null,
            discount.discount_ends_at || null,
            normalizePriceValue(destinationDraft.purchase_price_usd ?? source.purchase_price_usd ?? 0),
            normalizePriceValue(destinationDraft.purchase_price_khr ?? source.purchase_price_khr ?? 0),
            normalizePriceValue(destinationDraft.cost_price_usd ?? source.cost_price_usd ?? source.purchase_price_usd ?? 0),
            normalizePriceValue(destinationDraft.cost_price_khr ?? source.cost_price_khr ?? source.purchase_price_khr ?? 0),
            0,
            destinationDraft.low_stock_threshold ?? source.low_stock_threshold ?? 10,
            destinationDraft.out_of_stock_threshold ?? source.out_of_stock_threshold ?? 0,
            destinationDraft.image_path || source.image_path || null,
            destinationDraft.is_active ?? 1,
            destinationDraft.supplier || source.supplier || null,
            JSON.stringify(destinationDraft.custom_fields || {}),
            0,
            rootParentId,
          )
          destinationProductId = inserted.lastInsertRowid
        }
      }

      if (!destinationProductId) throw new Error('Destination product is required')
      if (Number(destinationProductId) === Number(sourceProductId)) throw new Error('Choose a different destination row')
      const destination = db.prepare('SELECT * FROM products WHERE id = ?').get(destinationProductId)
      if (!destination) throw new Error('Destination product not found')

      db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0)').run(sourceProductId, branch.id)
      db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0)').run(destinationProductId, branch.id)
      db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?').run(quantity, sourceProductId, branch.id)
      db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = ?').run(quantity, destinationProductId, branch.id)

      const moveId = db.prepare(`
        INSERT INTO stock_row_moves (
          source_product_id, source_product_name, destination_product_id, destination_product_name,
          branch_id, branch_name, quantity, reason, note, user_id, user_name
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        sourceProductId,
        source.name,
        destinationProductId,
        destination.name,
        branch.id,
        branch.name,
        quantity,
        reason,
        note,
        actor.userId,
        actor.userName,
      ).lastInsertRowid

      const insertMovement = db.prepare(`
        INSERT INTO inventory_movements
          (product_id, product_name, branch_id, branch_name, movement_type, quantity,
           unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      insertMovement.run(
        sourceProductId, source.name, branch.id, branch.name, 'row_move_out', quantity,
        source.cost_price_usd || source.purchase_price_usd || 0,
        source.cost_price_khr || source.purchase_price_khr || 0,
        quantity * (source.cost_price_usd || source.purchase_price_usd || 0),
        quantity * (source.cost_price_khr || source.purchase_price_khr || 0),
        reason, moveId, actor.userId, actor.userName,
      )
      insertMovement.run(
        destinationProductId, destination.name, branch.id, branch.name, 'row_move_in', quantity,
        destination.cost_price_usd || destination.purchase_price_usd || source.cost_price_usd || source.purchase_price_usd || 0,
        destination.cost_price_khr || destination.purchase_price_khr || source.cost_price_khr || source.purchase_price_khr || 0,
        quantity * (destination.cost_price_usd || destination.purchase_price_usd || source.cost_price_usd || source.purchase_price_usd || 0),
        quantity * (destination.cost_price_khr || destination.purchase_price_khr || source.cost_price_khr || source.purchase_price_khr || 0),
        reason, moveId, actor.userId, actor.userName,
      )

      recalcProductStock(sourceProductId)
      recalcProductStock(destinationProductId)
      audit(actor.userId, actor.userName, 'stock_row_move', 'product', sourceProductId, {
        destinationProductId,
        branchId: branch.id,
        quantity,
        reason,
        note,
      }, {
        deviceName: body.deviceName || null,
        deviceTz: body.deviceTz || null,
        clientTime: body.clientTime || null,
      })
      return { moveId, sourceProductId, destinationProductId, branchId: branch.id }
    })()

    logOp('inventory:moveRow', Date.now() - t0)
    broadcast('products')
    broadcast('inventory')
    ok(res, result)
  } catch (e) {
    err(res, e.message || 'Stock move failed')
  }
})

// GET /api/inventory/summary
router.get('/products/search', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const page = normalizePositiveInt(req.query.page, 1, { min: 1, max: 100000 })
    const pageSize = normalizePositiveInt(req.query.pageSize || req.query.page_size, 20, { min: 1, max: 100 })
    const offset = (page - 1) * pageSize
    const { where, joins, params, stockExpr } = appendInventoryProductFilters(req.query)
    const joinSql = joins.join('\n')
    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM products p
      ${joinSql}
      ${whereSql}
    `).get(params)?.count || 0
    const rows = db.prepare(`
      SELECT p.*,
        ${stockExpr} AS display_quantity,
        COALESCE(${stockExpr} * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0), 0) AS stock_value_usd,
        COALESCE(${stockExpr} * COALESCE(NULLIF(p.purchase_price_khr, 0), p.cost_price_khr, 0), 0) AS stock_value_khr,
        (
          SELECT COALESCE(
            json_agg(json_build_object('branch_id', bs2.branch_id, 'branch_name', b2.name, 'quantity', bs2.quantity))
              FILTER (WHERE bs2.branch_id IS NOT NULL),
            '[]'::json
          )::text
          FROM branch_stock bs2
          JOIN branches b2 ON b2.id = bs2.branch_id
          WHERE bs2.product_id = p.id
        ) AS branch_stock_json
      FROM products p
      ${joinSql}
      ${whereSql}
      ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
      LIMIT @pageSize OFFSET @offset
    `).all({ ...params, pageSize, offset }).map((product) => {
      try {
        product.branch_stock = JSON.parse(product.branch_stock_json || '[]')
      } catch {
        product.branch_stock = []
      }
      delete product.branch_stock_json
      return product
    })
    const metadataQuery = { ...req.query, initial: 'all' }
    const metaFilters = appendInventoryProductFilters(metadataQuery)
    const metaJoinSql = metaFilters.joins.join('\n')
    const metaWhereSql = `WHERE ${metaFilters.where.join(' AND ')}`
    const brands = db.prepare(`
      SELECT DISTINCT p.brand AS value
      FROM products p
      ${metaJoinSql}
      ${metaWhereSql}
        AND COALESCE(trim(p.brand), '') != ''
      ORDER BY p.brand COLLATE NOCASE ASC
      LIMIT 500
    `).all(metaFilters.params).map((row) => row.value)
    const initials = aggregateInitialRows(db.prepare(`
      SELECT substr(trim(p.name), 1, 1) AS value, COUNT(*) AS count
      FROM products p
      ${metaJoinSql}
      ${metaWhereSql}
        AND COALESCE(trim(p.name), '') != ''
      GROUP BY value
    `).all(metaFilters.params))
    res.json({
      items: rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: { brands, initials },
      initials,
    })
  } catch (e) {
    console.error('[inventory/products/search] error:', e.message)
    err(res, 'Failed to search inventory: ' + e.message)
  }
})

function normalizeRfidId(value) {
  return String(value || '').trim().toUpperCase()
}

function getRfidSession(sessionId) {
  return db.prepare('SELECT * FROM rfid_scan_sessions WHERE id = ?').get(sessionId)
}

function getBranchLedgerQty(branchId) {
  return Number(db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM branch_stock WHERE branch_id = ?').get(branchId)?.total || 0)
}

function refreshRfidSessionCounts(sessionId) {
  const session = getRfidSession(sessionId)
  if (!session) return null
  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0) AS confirmed_qty,
      COALESCE(SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END), 0) AS missing_count,
      COALESCE(SUM(CASE WHEN status = 'extra' THEN 1 ELSE 0 END), 0) AS extra_count,
      COALESCE(SUM(CASE WHEN status = 'wrong_location' THEN 1 ELSE 0 END), 0) AS wrong_location_count,
      COALESCE(SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count
    FROM rfid_session_items
    WHERE session_id = ?
  `).get(sessionId) || {}
  const ledgerQty = getBranchLedgerQty(session.branch_id)
  db.prepare(`
    UPDATE rfid_scan_sessions
    SET ledger_qty = ?,
        confirmed_qty = ?,
        missing_count = ?,
        extra_count = ?,
        wrong_location_count = ?,
        unknown_count = ?
    WHERE id = ?
  `).run(
    ledgerQty,
    Number(counts.confirmed_qty || 0),
    Number(counts.missing_count || 0),
    Number(counts.extra_count || 0),
    Number(counts.wrong_location_count || 0),
    Number(counts.unknown_count || 0),
    sessionId,
  )
  return getRfidSession(sessionId)
}

function upsertRfidSessionItem({ sessionId, epcId, tid = '', productId = null, expectedBranchId = null, seenBranchId = null, status, reviewNote = '' }) {
  const existing = db.prepare('SELECT * FROM rfid_session_items WHERE session_id = ? AND epc_id = ?').get(sessionId, epcId)
  if (existing) {
    db.prepare(`
      UPDATE rfid_session_items
      SET tid = COALESCE(NULLIF(?, ''), tid),
          product_id = COALESCE(?, product_id),
          expected_branch_id = COALESCE(?, expected_branch_id),
          seen_branch_id = COALESCE(?, seen_branch_id),
          status = ?,
          review_note = ?,
          last_seen = CURRENT_TIMESTAMP,
          read_count = COALESCE(read_count, 0) + 1
      WHERE id = ?
    `).run(tid, productId, expectedBranchId, seenBranchId, status, reviewNote, existing.id)
    return db.prepare('SELECT * FROM rfid_session_items WHERE id = ?').get(existing.id)
  }
  const inserted = db.prepare(`
    INSERT INTO rfid_session_items
      (session_id, epc_id, tid, product_id, expected_branch_id, seen_branch_id, status, review_note)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(sessionId, epcId, tid, productId, expectedBranchId, seenBranchId, status, reviewNote)
  return db.prepare('SELECT * FROM rfid_session_items WHERE id = ?').get(inserted.lastInsertRowid)
}

function recordRfidEvent(session, event = {}) {
  const epcId = normalizeRfidId(event.epcId || event.epc_id || event.epc)
  if (!epcId) return null
  const tid = normalizeRfidId(event.tid || event.tid_id)
  const tag = db.prepare('SELECT * FROM rfid_tags WHERE epc_id = ?').get(epcId)
  let eventType = 'unknown'
  let reviewNote = 'Unknown RFID tag. Link it to a product before applying.'
  let productId = null
  let seenBranchId = Number(session.branch_id)
  let expectedBranchId = Number(session.branch_id)

  if (tag) {
    productId = Number(tag.product_id)
    expectedBranchId = Number(tag.branch_id)
    seenBranchId = Number(session.branch_id)
    if (Number(tag.branch_id) !== Number(session.branch_id)) {
      eventType = 'wrong_location'
      reviewNote = `Wrong location: tag belongs to branch ${tag.branch_id}, scanned in branch ${session.branch_id}.`
    } else {
      eventType = 'present'
      reviewNote = ''
      db.prepare('UPDATE rfid_tags SET last_seen = CURRENT_TIMESTAMP, last_seen_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(session.id, tag.id)
    }
  }

  const dedupeKey = `${session.id}:${epcId}:${eventType}`
  db.prepare(`
    INSERT INTO rfid_events
      (session_id, epc_id, tid, product_id, branch_id, event_type, antenna, rssi, raw_json, dedupe_key)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    session.id,
    epcId,
    tid,
    productId,
    seenBranchId,
    eventType,
    event.antenna || '',
    Number(event.rssi || 0),
    JSON.stringify(event || {}),
    dedupeKey,
  )
  return upsertRfidSessionItem({
    sessionId: session.id,
    epcId,
    tid,
    productId,
    expectedBranchId,
    seenBranchId,
    status: eventType,
    reviewNote,
  })
}

router.get('/rfid/status', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const branchId = Number.parseInt(req.query.branchId || req.query.branch_id || '', 10)
    const where = Number.isFinite(branchId) && branchId > 0 ? 'WHERE branch_id = ?' : ''
    const params = where ? [branchId] : []
    const tagCount = db.prepare(`SELECT COUNT(*) AS count FROM rfid_tags ${where}`).get(...params)?.count || 0
    const activeSession = db.prepare(`SELECT * FROM rfid_scan_sessions ${where ? `${where} AND` : 'WHERE'} status = 'active' ORDER BY started_at DESC, id DESC LIMIT 1`).get(...params) || null
    const exceptions = db.prepare(`
      SELECT COUNT(*) AS count
      FROM rfid_session_items item
      JOIN rfid_scan_sessions session ON session.id = item.session_id
      ${where ? 'WHERE session.branch_id = ? AND' : 'WHERE'} item.status IN ('wrong_location', 'unknown', 'missing', 'extra')
    `).get(...params)?.count || 0
    ok(res, {
      item: {
        connected: false,
        readerCount: 0,
        tagCount: Number(tagCount || 0),
        activeSession,
        exceptionCount: Number(exceptions || 0),
      },
    })
  } catch (error) {
    err(res, error?.message || 'Failed to load RFID status', 500)
  }
})

router.post('/rfid/tags', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const actor = getAuditActor(req, req.body || {})
    const epcId = normalizeRfidId(req.body?.epcId || req.body?.epc_id || req.body?.epc)
    const tid = normalizeRfidId(req.body?.tid || req.body?.tid_id)
    const productId = Number.parseInt(req.body?.productId || req.body?.product_id, 10)
    const branchId = Number.parseInt(req.body?.branchId || req.body?.branch_id, 10)
    if (!epcId) return err(res, 'EPC/TID is required')
    if (!Number.isFinite(productId) || productId <= 0) return err(res, 'Product is required')
    if (!Number.isFinite(branchId) || branchId <= 0) return err(res, 'Branch is required')
    const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId)
    const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(branchId)
    if (!product) return err(res, 'Product not found', 404)
    if (!branch) return err(res, 'Branch not found', 404)
    const existing = db.prepare('SELECT * FROM rfid_tags WHERE epc_id = ?').get(epcId)
    if (existing && (Number(existing.product_id) !== productId || Number(existing.branch_id) !== branchId)) {
      return err(res, 'Duplicate EPC already linked to another product or branch.', 409)
    }
    let tag
    if (existing) {
      db.prepare('UPDATE rfid_tags SET tid = ?, status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(tid, req.body?.status || existing.status || 'active', actor.userId, existing.id)
      tag = db.prepare('SELECT * FROM rfid_tags WHERE id = ?').get(existing.id)
    } else {
      const inserted = db.prepare(`
        INSERT INTO rfid_tags (epc_id, tid, product_id, branch_id, status, created_by, updated_by)
        VALUES (?,?,?,?,?,?,?)
      `).run(epcId, tid, productId, branchId, req.body?.status || 'active', actor.userId, actor.userId)
      tag = db.prepare('SELECT * FROM rfid_tags WHERE id = ?').get(inserted.lastInsertRowid)
    }
    audit(actor.userId, actor.userName, 'rfid_tag_link', 'rfid_tag', tag.id, { epcId, productId, branchId })
    ok(res, { item: tag })
  } catch (error) {
    err(res, error?.message || 'Failed to save RFID tag', 500)
  }
})

router.get('/rfid/tags/search', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const query = `%${String(req.query.q || req.query.query || '').trim().toLowerCase()}%`
    const branchId = Number.parseInt(req.query.branchId || req.query.branch_id || '', 10)
    const where = ['1=1']
    const params = []
    if (query !== '%%') {
      where.push('(lower(t.epc_id) LIKE ? OR lower(COALESCE(t.tid, \'\')) LIKE ? OR lower(COALESCE(p.name, \'\')) LIKE ? OR lower(COALESCE(p.sku, \'\')) LIKE ? OR lower(COALESCE(p.barcode, \'\')) LIKE ?)')
      params.push(query, query, query, query, query)
    }
    if (Number.isFinite(branchId) && branchId > 0) {
      where.push('t.branch_id = ?')
      params.push(branchId)
    }
    const items = db.prepare(`
      SELECT t.*, p.name AS product_name, p.sku, p.barcode, b.name AS branch_name
      FROM rfid_tags t
      LEFT JOIN products p ON p.id = t.product_id
      LEFT JOIN branches b ON b.id = t.branch_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT 100
    `).all(...params)
    ok(res, { items })
  } catch (error) {
    err(res, error?.message || 'Failed to search RFID tags', 500)
  }
})

router.post('/rfid/sessions', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const actor = getAuditActor(req, req.body || {})
    const branchId = Number.parseInt(req.body?.branchId || req.body?.branch_id, 10)
    if (!Number.isFinite(branchId) || branchId <= 0) return err(res, 'Branch is required')
    const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(branchId)
    if (!branch) return err(res, 'Branch not found', 404)
    const ledgerQty = getBranchLedgerQty(branchId)
    const inserted = db.prepare(`
      INSERT INTO rfid_scan_sessions
        (branch_id, area, reader_id, status, ledger_qty, created_by, created_by_name)
      VALUES (?,?,?,?,?,?,?)
    `).run(branchId, req.body?.area || '', req.body?.readerId || req.body?.reader_id || '', 'active', ledgerQty, actor.userId, actor.userName)
    const session = db.prepare('SELECT * FROM rfid_scan_sessions WHERE id = ?').get(inserted.lastInsertRowid)
    audit(actor.userId, actor.userName, 'rfid_session_start', 'rfid_scan_session', session.id, { branchId, area: req.body?.area || '', readerId: req.body?.readerId || req.body?.reader_id || '' })
    ok(res, { item: session })
  } catch (error) {
    err(res, error?.message || 'Failed to start RFID session', 500)
  }
})

router.post('/rfid/sessions/:id/events', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const sessionId = Number.parseInt(req.params.id, 10)
    const session = getRfidSession(sessionId)
    if (!session) return err(res, 'RFID session not found', 404)
    if (String(session.status || '').toLowerCase() !== 'active') return err(res, 'RFID session is not active', 409)
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body || {}]
    const items = db.transaction(() => events.map((event) => recordRfidEvent(session, event)).filter(Boolean))()
    const updated = refreshRfidSessionCounts(sessionId)
    ok(res, { items, session: updated })
  } catch (error) {
    err(res, error?.message || 'Failed to record RFID events', 500)
  }
})

router.get('/rfid/sessions/:id/review', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const sessionId = Number.parseInt(req.params.id, 10)
    const session = refreshRfidSessionCounts(sessionId)
    if (!session) return err(res, 'RFID session not found', 404)
    const items = db.prepare(`
      SELECT item.*, p.name AS product_name, p.sku, p.barcode, expected.name AS expected_branch_name, seen.name AS seen_branch_name
      FROM rfid_session_items item
      LEFT JOIN products p ON p.id = item.product_id
      LEFT JOIN branches expected ON expected.id = item.expected_branch_id
      LEFT JOIN branches seen ON seen.id = item.seen_branch_id
      WHERE item.session_id = ?
      ORDER BY CASE item.status WHEN 'wrong_location' THEN 0 WHEN 'unknown' THEN 1 WHEN 'missing' THEN 2 WHEN 'extra' THEN 3 ELSE 4 END, item.last_seen DESC
    `).all(sessionId)
    ok(res, { item: session, items })
  } catch (error) {
    err(res, error?.message || 'Failed to load RFID review', 500)
  }
})

router.post('/rfid/sessions/:id/apply', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const actor = getAuditActor(req, req.body || {})
    const sessionId = Number.parseInt(req.params.id, 10)
    const session = refreshRfidSessionCounts(sessionId)
    if (!session) return err(res, 'RFID session not found', 404)
    const branchId = Number.parseInt(req.body?.branchId || req.body?.branch_id || session.branch_id, 10)
    if (Number(branchId) !== Number(session.branch_id)) return err(res, 'Branch mismatch: this RFID scan cannot update another branch.', 409)
    const presentRows = db.prepare(`
      SELECT product_id, COUNT(*) AS confirmed_qty
      FROM rfid_session_items
      WHERE session_id = ? AND status = 'present' AND product_id IS NOT NULL
      GROUP BY product_id
    `).all(sessionId)
    const applyMaster = req.body?.applyMaster !== false && req.body?.updateMasterStock !== false
    const movements = []
    db.transaction(() => {
      presentRows.forEach((row) => {
        const productId = Number(row.product_id)
        const confirmedQty = Number(row.confirmed_qty || 0)
        const product = db.prepare('SELECT id, name, purchase_price_usd, purchase_price_khr FROM products WHERE id = ?').get(productId)
        if (!product) return
        db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0)').run(productId, branchId)
        const branchStock = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(productId, branchId) || { quantity: 0 }
        db.prepare('UPDATE branch_stock SET rfid_confirmed_qty = ? WHERE product_id = ? AND branch_id = ?').run(confirmedQty, productId, branchId)
        if (applyMaster) {
          const previousQty = Number(branchStock.quantity || 0)
          const delta = confirmedQty - previousQty
          db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?').run(confirmedQty, productId, branchId)
          if (delta !== 0) {
            const movement_type = 'rfid_count_adjustment'
            db.prepare(`
              INSERT INTO inventory_movements
                (product_id, product_name, branch_id, branch_name, movement_type, quantity,
                 unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              productId,
              product.name,
              branchId,
              db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId)?.name || '',
              movement_type,
              delta,
              Number(product.purchase_price_usd || 0),
              Number(product.purchase_price_khr || 0),
              Math.abs(delta) * Number(product.purchase_price_usd || 0),
              Math.abs(delta) * Number(product.purchase_price_khr || 0),
              'RFID manual stock count apply',
              `rfid-session:${sessionId}`,
              actor.userId,
              actor.userName,
            )
            movements.push({ productId, delta, movement_type })
          }
          recalcProductStock(productId)
        }
        db.prepare('UPDATE products SET rfid_confirmed_qty = (SELECT COALESCE(SUM(rfid_confirmed_qty), 0) FROM branch_stock WHERE product_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(productId, productId)
      })
      db.prepare("UPDATE rfid_scan_sessions SET status = 'applied', applied_at = CURRENT_TIMESTAMP, finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP) WHERE id = ?").run(sessionId)
      audit(actor.userId, actor.userName, 'rfid_stock_apply', 'rfid_scan_session', sessionId, {
        branchId,
        applyMaster,
        movements,
      })
    })()
    ok(res, { item: refreshRfidSessionCounts(sessionId), movements })
  } catch (error) {
    err(res, error?.message || 'Failed to apply RFID session', 500)
  }
})

// GET /api/inventory/stats
router.get('/stats', authToken, requirePermission('inventory'), (req, res) => {
  try {
    const branchId = req.query.branchId ? Number.parseInt(req.query.branchId, 10) : null
    ok(res, { item: getStockMetrics({ branchId }) })
  } catch (error) {
    err(res, error?.message || 'Failed to load inventory stats')
  }
})

// GET /api/inventory/summary
router.get('/summary', authToken, requirePermission('inventory'), (req, res) => {
  try {
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null
  let products

  // Detect whether parent_id column exists (added via migration â€” may be absent on older DBs)
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
          SELECT COALESCE(
            json_agg(json_build_object('branch_id', bs2.branch_id, 'branch_name', b2.name, 'quantity', bs2.quantity))
              FILTER (WHERE bs2.branch_id IS NOT NULL),
            '[]'::json
          )::text
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
router.get('/movements', authToken, requirePermission('inventory'), (req, res) => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId) : null
  const userId = req.query.userId ? String(req.query.userId).trim() : ''
  const limit = Math.min(Math.max(parseInt(req.query.limit || '1000', 10) || 1000, 1), 1000)
  const where = []
  const params = []
  if (branchId) {
    where.push('branch_id = ?')
    params.push(branchId)
  }
  if (userId) {
    if (!isAdminControlUser(req.user)) return err(res, 'Administrator access required for movement user filters.', 403)
    where.push('user_id = ?')
    params.push(parseInt(userId, 10) || userId)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT * FROM inventory_movements
    ${whereSql}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit)
  res.json(rows)
})

module.exports = router
