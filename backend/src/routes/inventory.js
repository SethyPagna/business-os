'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, logOp } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { normalizePriceValue } = require('../money')
const { normalizeProductDiscount } = require('../productDiscounts')
const { aggregateInitialRows, getInitialKey, getInitialType } = require('../initials')

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
  if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.low_stock_threshold, 0)`)
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
