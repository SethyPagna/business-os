'use strict'
const path    = require('path')
const fs      = require('fs')
const express = require('express')
const { db }  = require('../database')
const { UPLOADS_PATH } = require('../config')
const { ok, err, audit, broadcast, logOp, tryParse } = require('../helpers')
const { authToken, upload, compressUpload, validateUploadedFile, routeRateLimit, requirePermission, getAuditActor } = require('../middleware')
const { registerUploadFromRequest, storeDataUrlAsset } = require('../fileAssets')
const { isSafeExternalImageReference } = require('../netSecurity')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')
const { sanitizeMediaList } = require('../settingsSnapshot')
const { normalizeClientRequestId } = require('../idempotency')
const { normalizePriceValue } = require('../money')
const { normalizeProductDiscount } = require('../productDiscounts')
const { aggregateInitialRows, getInitialKey, getInitialType } = require('../initials')
const {
  hasImportValue,
  normalizeFieldRule,
  normalizeImageConflictMode,
  parseImportFlag,
  parseImportNumber,
  resolveImportValue,
} = require('../productImportPolicies')

const router = express.Router()

function getActiveBranches() {
  return db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
}

function getDefaultBranch(activeBranches = getActiveBranches()) {
  return activeBranches.find(branch => branch.is_default) || activeBranches[0] || null
}

function seedBranchRows(productId, activeBranches = getActiveBranches()) {
  const insertBS = db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0)')
  activeBranches.forEach(branch => insertBS.run(productId, branch.id))
}

function recalcProductStock(productId) {
  db.prepare(`
    UPDATE products SET
      stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(productId, productId)
}

function normalizeImageGallery(value, fallbackPrimary = null) {
  const normalized = sanitizeMediaList(Array.isArray(value) ? value : []).slice(0, 5)
  const fallback = sanitizeMediaList([fallbackPrimary])[0] || ''
  if (!normalized.length && fallback) normalized.push(fallback)
  return normalized.slice(0, 5)
}

function syncProductImageGallery(productId, gallery) {
  const normalized = normalizeImageGallery(gallery)
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId)
  if (!normalized.length) {
    db.prepare("UPDATE products SET image_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(productId)
    return []
  }
  const insert = db.prepare(`
    INSERT INTO product_images (product_id, image_path, sort_order)
    VALUES (?, ?, ?)
  `)
  normalized.forEach((imagePath, index) => {
    insert.run(productId, imagePath, index)
  })
  db.prepare("UPDATE products SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(normalized[0], productId)
  return normalized
}

function loadProductImageMap(productIds = []) {
  const ids = Array.from(new Set((productIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT product_id, image_path
    FROM product_images
    WHERE product_id IN (${placeholders})
    ORDER BY sort_order ASC, id ASC
  `).all(...ids)
  const map = new Map()
  rows.forEach((row) => {
    if (!map.has(row.product_id)) map.set(row.product_id, [])
    map.get(row.product_id).push(row.image_path)
  })
  return map
}

function attachImageGallery(products = []) {
  const map = loadProductImageMap(products.map((product) => product.id))
  return products.map((product) => {
    const gallery = normalizeImageGallery(map.get(product.id) || [], product.image_path)
    return {
      ...product,
      image_gallery: gallery,
      image_path: gallery[0] || null,
    }
  })
}

function findProductByClientRequestId(clientRequestId) {
  if (!clientRequestId) return null
  return db.prepare(`
    SELECT id
    FROM products
    WHERE client_request_id = ?
    LIMIT 1
  `).get(clientRequestId)
}

function assertUniqueProductFields({ name, sku, barcode, excludeId = null, allowDuplicateName = false }) {
  const trimmedName = String(name || '').trim()
  if (!trimmedName) throw new Error('Product name required')

  const conflicts = db.prepare(`
    SELECT id, name, sku, barcode
    FROM products
    WHERE (
      (? = 0 AND lower(trim(name)) = lower(trim(?)))
      OR (? IS NOT NULL AND ? != '' AND sku = ?)
      OR (? IS NOT NULL AND ? != '' AND barcode = ?)
    )
    AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(
    allowDuplicateName ? 1 : 0, trimmedName,
    sku || null, sku || '', sku || null,
    barcode || null, barcode || '', barcode || null,
    excludeId, excludeId,
  )

  if (!conflicts) return
  if ((sku || '') && conflicts.sku === sku) throw new Error(`Duplicate SKU "${sku}" is not allowed`)
  if ((barcode || '') && conflicts.barcode === barcode) throw new Error(`Duplicate barcode "${barcode}" is not allowed`)
  if (!allowDuplicateName) throw new Error(`Duplicate product name "${trimmedName}" is not allowed`)
}

function hasOwnField(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key)
}

function pickField(source, key, fallback) {
  return hasOwnField(source, key) ? source[key] : fallback
}

function ensureParentProductExists(parentId, { childId = null } = {}) {
  if (!parentId) return null
  const numericId = Number(parentId)
  if (!Number.isFinite(numericId) || numericId <= 0) throw new Error('Parent product not found')
  if (childId && numericId === Number(childId)) throw new Error('A product cannot be its own group parent')
  const parent = db.prepare('SELECT id, name FROM products WHERE id = ?').get(numericId)
  if (!parent) throw new Error('Parent product not found')
  return parent
}

function markParentProductAsGroup(parentId) {
  if (!parentId) return
  db.prepare("UPDATE products SET is_group = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(parentId)
}

function normalizeImportLookup(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeImportFlagValue(value, fallback = 0) {
  const text = normalizeImportLookup(value)
  if (!text) return Number(fallback || 0) ? 1 : 0
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return 1
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return 0
  return Number(fallback || 0) ? 1 : 0
}

const IMPORT_DETAIL_FIELDS = [
  'sku',
  'barcode',
  'category',
  'brand',
  'unit',
  'description',
  'supplier',
]
const IMPORT_MONEY_FIELDS = new Set([
  'selling_price_usd',
  'selling_price_khr',
  'special_price_usd',
  'special_price_khr',
  'discount_amount_usd',
  'discount_amount_khr',
  'purchase_price_usd',
  'purchase_price_khr',
  'cost_price_usd',
  'cost_price_khr',
])
const IMPORT_NUMERIC_FIELDS = new Set(['discount_percent', 'low_stock_threshold'])

function getProductImportDetailSignature(source = {}) {
  return IMPORT_DETAIL_FIELDS.map((field) => {
    const value = source?.[field]
    if (IMPORT_MONEY_FIELDS.has(field)) return `${field}:${normalizePriceValue(value || 0)}`
    if (IMPORT_NUMERIC_FIELDS.has(field)) return `${field}:${normalizePriceValue(value || 0)}`
    if (field === 'discount_enabled') return `${field}:${normalizeImportFlagValue(value, 0)}`
    return `${field}:${normalizeImportLookup(value)}`
  }).join('|')
}

function chooseImportParentProduct(rows = []) {
  return [...rows].sort((left, right) => {
    const leftGroup = Number(left?.is_group || 0) ? 0 : 1
    const rightGroup = Number(right?.is_group || 0) ? 0 : 1
    if (leftGroup !== rightGroup) return leftGroup - rightGroup
    const leftChild = Number(left?.parent_id || 0) ? 1 : 0
    const rightChild = Number(right?.parent_id || 0) ? 1 : 0
    if (leftChild !== rightChild) return leftChild - rightChild
    const leftCreated = String(left?.created_at || '')
    const rightCreated = String(right?.created_at || '')
    if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated)
    return Number(left?.id || 0) - Number(right?.id || 0)
  })[0] || null
}

function normalizeImportAction(value) {
  const action = String(value || '').trim().toLowerCase()
  if (action === 'merge_stock' || action === 'link_variant') return 'merge'
  if (action === 'create_variant') return 'new'
  if (['new', 'merge', 'override_add', 'override_replace'].includes(action)) return action
  return ''
}

function parseOptionalImportId(row, field) {
  const raw = row?.[field]
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0
  const numeric = Number(raw)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0
}

function discountInsertColumns() {
  return 'discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label, discount_badge_color, discount_starts_at, discount_ends_at'
}

function discountValues(source = {}, fallback = {}) {
  const discount = normalizeProductDiscount(source, fallback)
  return [
    discount.discount_enabled,
    discount.discount_type,
    discount.discount_percent,
    discount.discount_amount_usd,
    discount.discount_amount_khr,
    discount.discount_label || null,
    discount.discount_badge_color,
    discount.discount_starts_at || null,
    discount.discount_ends_at || null,
  ]
}

function normalizePositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function parseInclude(value = '') {
  return new Set(String(value || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean))
}

function splitSearchTerms(value = '') {
  return String(value || '')
    .normalize('NFC')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
}

function appendProductSearchFilters(query = {}) {
  const where = ['p.is_active = 1']
  const params = {}
  const joins = []
  const rawIds = String(query.ids || query.productIds || query.product_ids || '').trim()
  if (rawIds) {
    const ids = Array.from(new Set(
      rawIds
        .split(',')
        .map((value) => Number.parseInt(String(value || '').trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    )).slice(0, 100)
    if (ids.length) {
      const idKeys = ids.map((id, index) => {
        const key = `productId${index}`
        params[key] = id
        return `@${key}`
      })
      where.push(`p.id IN (${idKeys.join(',')})`)
    }
  }
  const branchId = Number.parseInt(query.branchId || query.branch_id || '', 10)
  if (Number.isFinite(branchId) && branchId > 0) {
    params.branchId = branchId
    joins.push('LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id AND selected_bs.branch_id = @branchId')
  }
  const searchTerms = splitSearchTerms(query.query || query.q || '')
  if (searchTerms.length) {
    const searchMode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    const termClauses = searchTerms.map((term, index) => {
      const key = `search${index}`
      params[key] = `%${term}%`
      return `(
        lower(COALESCE(p.name, '')) LIKE @${key}
        OR lower(COALESCE(p.sku, '')) LIKE @${key}
        OR lower(COALESCE(p.barcode, '')) LIKE @${key}
        OR lower(COALESCE(p.brand, '')) LIKE @${key}
        OR lower(COALESCE(p.category, '')) LIKE @${key}
        OR lower(COALESCE(p.supplier, '')) LIKE @${key}
      )`
    })
    where.push(`(${termClauses.join(searchMode === 'OR' ? ' OR ' : ' AND ')})`)
  }
  ;['brand', 'category', 'supplier'].forEach((field) => {
    const raw = String(query[field] || '').normalize('NFC').trim()
    if (raw && raw.toLowerCase() !== 'all') {
      params[field] = raw
      where.push(`p.${field} = @${field}`)
    }
  })
  const groupState = String(query.groupState || query.group_state || 'all').toLowerCase()
  if (groupState === 'parent') where.push('COALESCE(p.is_group, 0) = 1')
  if (groupState === 'variant') where.push('COALESCE(p.parent_id, 0) > 0')
  if (['grouped', 'parents_variants', 'parent_variant', 'parents-and-variants'].includes(groupState)) {
    where.push('(COALESCE(p.is_group, 0) = 1 OR COALESCE(p.parent_id, 0) > 0)')
  }
  if (groupState === 'standalone') where.push('COALESCE(p.is_group, 0) = 0 AND COALESCE(p.parent_id, 0) = 0')
  const stockExpr = params.branchId ? 'COALESCE(selected_bs.quantity, 0)' : 'COALESCE(p.stock_quantity, 0)'
  const stockState = String(query.stockState || query.stock_state || 'all').toLowerCase()
  if (stockState === 'positive' || stockState === 'in_stock') where.push(`${stockExpr} > 0`)
  if (stockState === 'out' || stockState === 'out_of_stock') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`)
  const initial = String(query.initial || '').normalize('NFC').trim()
  if (initial && initial.toLowerCase() !== 'all') {
    const key = getInitialKey(initial)
    params.initial = key
    if (getInitialType(key) === 'latin') {
      where.push('upper(substr(trim(COALESCE(p.name, "")), 1, 1)) = @initial')
    } else {
      where.push('substr(trim(COALESCE(p.name, "")), 1, 1) = @initial')
    }
  }
  return { where, joins, params, stockExpr }
}

function getProductSearchMetadata(query = {}) {
  const metadataQuery = { ...query, initial: 'all' }
  const { where, joins, params } = appendProductSearchFilters(metadataQuery)
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const joinSql = joins.join('\n')
  const distinctField = (field) => db.prepare(`
    SELECT DISTINCT p.${field} AS value
    FROM products p
    ${joinSql}
    ${whereSql}
      AND COALESCE(trim(p.${field}), '') != ''
    ORDER BY p.${field} COLLATE NOCASE ASC
    LIMIT 500
  `).all(params).map((row) => row.value)
  const initials = aggregateInitialRows(db.prepare(`
    SELECT substr(trim(p.name), 1, 1) AS value, COUNT(*) AS count
    FROM products p
    ${joinSql}
    ${whereSql}
      AND COALESCE(trim(p.name), '') != ''
    GROUP BY value
  `).all(params))
  return {
    brands: distinctField('brand'),
    categories: distinctField('category'),
    suppliers: distinctField('supplier'),
    initials,
  }
}

function attachBranchStock(products = []) {
  const ids = Array.from(new Set((products || []).map((product) => Number(product?.id || 0)).filter((id) => id > 0)))
  if (!ids.length) return products
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT bs.product_id, b.id AS branch_id, b.name AS branch_name, COALESCE(bs.quantity, 0) AS quantity
    FROM branches b
    LEFT JOIN branch_stock bs ON bs.branch_id = b.id AND bs.product_id IN (${placeholders})
    WHERE b.is_active = 1
    ORDER BY b.is_default DESC, b.id ASC
  `).all(...ids)
  const byProduct = new Map(ids.map((id) => [id, []]))
  rows.forEach((row) => {
    if (!row.product_id) return
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, [])
    byProduct.get(row.product_id).push({
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      quantity: row.quantity,
    })
  })
  return products.map((product) => ({
    ...product,
    branch_stock: byProduct.get(Number(product.id)) || [],
  }))
}

// GET /api/products/search - paged catalog read for large datasets
router.get('/search', authToken, (req, res) => {
  try {
    const page = normalizePositiveInt(req.query.page, 1, { min: 1, max: 100000 })
    const pageSize = normalizePositiveInt(req.query.pageSize || req.query.page_size, 20, { min: 1, max: 100 })
    const offset = (page - 1) * pageSize
    const include = parseInclude(req.query.include)
    const { where, joins, params, stockExpr } = appendProductSearchFilters(req.query)
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const joinSql = joins.join('\n')
    const sort = String(req.query.sort || 'name_asc').toLowerCase()
    const orderSql = sort === 'created_desc'
      ? 'p.created_at DESC, p.id DESC'
      : sort === 'created_asc'
        ? 'p.created_at ASC, p.id ASC'
        : sort === 'stock_desc'
          ? `${stockExpr} DESC, p.name COLLATE NOCASE ASC, p.id ASC`
          : 'p.name COLLATE NOCASE ASC, p.id ASC'

    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM products p
      ${joinSql}
      ${whereSql}
    `).get(params)?.count || 0
    const rows = db.prepare(`
      SELECT p.*, ${stockExpr} AS selected_branch_quantity
      FROM products p
      ${joinSql}
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT @pageSize OFFSET @offset
    `).all({ ...params, pageSize, offset }).map((product) => ({
      ...product,
      custom_fields: tryParse(product.custom_fields, {}),
    }))
    let items = rows
    if (include.has('branch_stock')) items = attachBranchStock(items)
    if (include.has('images') || include.has('gallery')) items = attachImageGallery(items)
    const filters = getProductSearchMetadata(req.query)
    ok(res, {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters,
      initials: filters.initials,
      summary: {
        total,
        returned: items.length,
        page,
        pageSize,
      },
    })
  } catch (error) {
    err(res, error?.message || 'Failed to search products')
  }
})

// GET /api/products/filters - compact filter metadata without downloading all products
router.get('/filters', authToken, (req, res) => {
  try {
    const { brands, categories, suppliers, initials } = getProductSearchMetadata(req.query)
    const total = db.prepare('SELECT COUNT(*) AS count FROM products WHERE is_active = 1').get()?.count || 0
    ok(res, { brands, categories, suppliers, initials, total })
  } catch (error) {
    err(res, error?.message || 'Failed to load product filters')
  }
})

// ?? GET /api/products ?????????????????????????????????????????????????????????
router.get('/', authToken, (req, res) => {
  // Fetch all products with branch stock in a single optimized query (avoids O(n簡) filtering)
  const products = db.prepare(`
    SELECT 
      p.*,
      COALESCE(json_agg(json_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'quantity', COALESCE(bs.quantity, 0)
      )) FILTER (WHERE b.id IS NOT NULL), '[]'::json)::text AS branch_stock_json
    FROM products p
    LEFT JOIN branches b ON b.is_active = 1
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = b.id
    GROUP BY p.id
    ORDER BY p.name
  `).all()

  const parsed = products.map(p => ({
    ...p,
    custom_fields: tryParse(p.custom_fields, {}),
    branch_stock_json: undefined,  // Remove raw JSON column
    branch_stock: tryParse(p.branch_stock_json, []),  // Parse branch stock from JSON
  }))
  res.json(attachImageGallery(parsed))
})

// ?? POST /api/products/variant ?????????????????????????????????????????????????
router.post('/variant', authToken, requirePermission('products'), (req, res) => {
  const t0 = Date.now()
  const d  = req.body || {}
  const actor = getAuditActor(req, d)
  if (!d.parent_id) return err(res, 'parent_id required for variant')
  if (!d.name?.trim()) return err(res, 'Variant name required')
  try {
    const activeBranches = getActiveBranches()
    const defaultBranch = getDefaultBranch(activeBranches)
    const openingStock = Math.max(0, parseFloat(d.stock_quantity) || 0)
    const openingBranchId = d.branch_id ? parseInt(d.branch_id, 10) : defaultBranch?.id || null
    if (!openingBranchId) return err(res, 'A branch is required for new products')
    assertUniqueProductFields({ name: d.name, sku: d.sku, barcode: d.barcode })

    const parent = ensureParentProductExists(d.parent_id)
    if (!parent) return err(res, 'Parent product not found')
    const parentGallery = normalizeImageGallery(
      loadProductImageMap([parent.id]).get(parent.id) || [],
      parent.image_path || null,
    )
    const imageGallery = normalizeImageGallery(
      d.image_gallery,
      d.image_path || parentGallery[0] || parent.image_path || null,
    )
    const primaryImage = imageGallery[0] || null
    markParentProductAsGroup(d.parent_id)
    const productDiscountValues = discountValues(d, {})
    const r = db.prepare(`
      INSERT INTO products
        (name, sku, barcode, category, brand, unit, description, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
         ${discountInsertColumns()},
         purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr,
         stock_quantity, low_stock_threshold, out_of_stock_threshold, image_path, is_active,
         supplier, custom_fields, is_group, parent_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      d.name.trim(), d.sku || null, d.barcode || null,
      d.category || parent.category || null,
      d.brand || parent.brand || null,
      d.unit || parent.unit || 'pcs', d.description || null,
      normalizePriceValue(d.selling_price_usd || 0), normalizePriceValue(d.selling_price_khr || 0),
      normalizePriceValue(d.special_price_usd ?? d.selling_price_usd ?? 0), normalizePriceValue(d.special_price_khr ?? d.selling_price_khr ?? 0),
      ...productDiscountValues,
      normalizePriceValue(d.purchase_price_usd || 0), normalizePriceValue(d.purchase_price_khr || 0),
      normalizePriceValue(d.cost_price_usd || d.purchase_price_usd || 0),
      normalizePriceValue(d.cost_price_khr || d.purchase_price_khr || 0),
      openingStock, d.low_stock_threshold ?? parent.low_stock_threshold ?? 10,
      d.out_of_stock_threshold ?? 0,
      primaryImage, d.is_active ?? 1,
      d.supplier || null, JSON.stringify(d.custom_fields || {}), 0, d.parent_id,
    )
    const pid = r.lastInsertRowid
    syncProductImageGallery(pid, imageGallery)
    seedBranchRows(pid, activeBranches)
    if (openingBranchId && openingStock > 0) {
      db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?').run(openingStock, pid, openingBranchId)
      recalcProductStock(pid)
    }
    audit(actor.userId, actor.userName, 'create', 'product', pid, { name: d.name, parent_id: d.parent_id }, {
      deviceName: d.deviceName || null, deviceTz: d.deviceTz || null, clientTime: d.clientTime || null,
    })
    logOp('products:create', Date.now() - t0)
    broadcast('products')
    ok(res, { id: pid })
  } catch (e) { err(res, e.message) }
})

// ?? POST /api/products ????????????????????????????????????????????????????????
router.post('/', authToken, requirePermission('products'), (req, res) => {
  const t0 = Date.now()
  const d  = req.body || {}
  const actor = getAuditActor(req, d)
  const clientRequestId = normalizeClientRequestId(d.client_request_id)
  if (!d.name?.trim()) return err(res, 'Product name required')

  const existingProduct = findProductByClientRequestId(clientRequestId)
  if (existingProduct) return ok(res, { id: existingProduct.id, duplicate: true })

  try {
    const activeBranches = getActiveBranches()
    const defaultBranch = getDefaultBranch(activeBranches)
    const openingStock = Math.max(0, parseFloat(d.stock_quantity) || 0)
    const openingBranchId = d.branch_id ? parseInt(d.branch_id, 10) : defaultBranch?.id || null
    const imageGallery = normalizeImageGallery(d.image_gallery, d.image_path || null)
    const primaryImage = imageGallery[0] || null
    const parentRecord = ensureParentProductExists(d.parent_id)
    const normalizedParentId = parentRecord?.id || null
    if (!openingBranchId) return err(res, 'A branch is required for new products')
    assertUniqueProductFields({ name: d.name, sku: d.sku, barcode: d.barcode })
    const productDiscountValues = discountValues(d, {})

    const r = db.prepare(`
      INSERT INTO products
        (name, client_request_id, sku, barcode, category, brand, unit, description, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
         ${discountInsertColumns()},
         purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr,
         stock_quantity, low_stock_threshold, out_of_stock_threshold, image_path, is_active, supplier, custom_fields, is_group, parent_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      d.name.trim(), clientRequestId, d.sku || null, d.barcode || null, d.category || null, d.brand || null, d.unit || 'pcs', d.description || null,
      normalizePriceValue(d.selling_price_usd || 0), normalizePriceValue(d.selling_price_khr || 0),
      normalizePriceValue(d.special_price_usd ?? d.selling_price_usd ?? 0), normalizePriceValue(d.special_price_khr ?? d.selling_price_khr ?? 0),
      ...productDiscountValues,
      normalizePriceValue(d.purchase_price_usd || 0), normalizePriceValue(d.purchase_price_khr || 0),
      normalizePriceValue(d.cost_price_usd || d.purchase_price_usd || 0),
      normalizePriceValue(d.cost_price_khr || d.purchase_price_khr || 0),
      openingStock, d.low_stock_threshold ?? 10, d.out_of_stock_threshold ?? 0,
      primaryImage, d.is_active ?? 1,
      d.supplier || null,
      JSON.stringify(d.custom_fields || {}),
      normalizedParentId ? 0 : (Number(d.is_group) ? 1 : 0),
      normalizedParentId,
    )
    const pid = r.lastInsertRowid
    syncProductImageGallery(pid, imageGallery)
    if (normalizedParentId) markParentProductAsGroup(normalizedParentId)

    // Seed branch_stock rows for all active branches
    seedBranchRows(pid, activeBranches)
    if (openingBranchId && openingStock > 0) {
      db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?')
        .run(openingStock, pid, openingBranchId)
      recalcProductStock(pid)
    }
    audit(actor.userId, actor.userName, 'create', 'product', pid, { name: d.name }, {
      deviceName: d.deviceName || null, deviceTz: d.deviceTz || null, clientTime: d.clientTime || null,
    })
    logOp('products:create', Date.now() - t0)
    broadcast('products')
    ok(res, { id: pid })
  } catch (e) {
    if (clientRequestId && /client_request_id/i.test(String(e?.message || ''))) {
      const duplicateProduct = findProductByClientRequestId(clientRequestId)
      if (duplicateProduct) return ok(res, { id: duplicateProduct.id, duplicate: true })
    }
    err(res, e.message)
  }
})

// ?? PUT /api/products/:id ?????????????????????????????????????????????????????
router.put('/:id', authToken, requirePermission('products'), (req, res) => {
  const t0 = Date.now()
  const d  = req.body || {}
  const actor = getAuditActor(req, d)
  try {
    const productId = parseInt(req.params.id, 10)
    db.transaction(() => {
      const prev = db.prepare('SELECT * FROM products WHERE id=?').get(productId)
      if (!prev) throw new Error('Product not found')
      assertUpdatedAtMatch('product', prev, getExpectedUpdatedAt(d))

      const merged = {
        name: pickField(d, 'name', prev.name),
        sku: pickField(d, 'sku', prev.sku),
        barcode: pickField(d, 'barcode', prev.barcode),
        category: pickField(d, 'category', prev.category),
        brand: pickField(d, 'brand', prev.brand),
        unit: pickField(d, 'unit', prev.unit),
        description: pickField(d, 'description', prev.description),
        selling_price_usd: pickField(d, 'selling_price_usd', prev.selling_price_usd),
        selling_price_khr: pickField(d, 'selling_price_khr', prev.selling_price_khr),
        special_price_usd: pickField(d, 'special_price_usd', prev.special_price_usd),
        special_price_khr: pickField(d, 'special_price_khr', prev.special_price_khr),
        ...normalizeProductDiscount(d, prev),
        purchase_price_usd: pickField(d, 'purchase_price_usd', prev.purchase_price_usd),
        purchase_price_khr: pickField(d, 'purchase_price_khr', prev.purchase_price_khr),
        cost_price_usd: pickField(d, 'cost_price_usd', prev.cost_price_usd),
        cost_price_khr: pickField(d, 'cost_price_khr', prev.cost_price_khr),
        stock_quantity: pickField(d, 'stock_quantity', prev.stock_quantity),
        low_stock_threshold: pickField(d, 'low_stock_threshold', prev.low_stock_threshold),
        out_of_stock_threshold: pickField(d, 'out_of_stock_threshold', prev.out_of_stock_threshold),
        image_path: pickField(d, 'image_path', prev.image_path),
        is_active: pickField(d, 'is_active', prev.is_active),
        supplier: pickField(d, 'supplier', prev.supplier),
        custom_fields: pickField(d, 'custom_fields', tryParse(prev.custom_fields, {})),
        is_group: pickField(d, 'is_group', prev.is_group),
        parent_id: pickField(d, 'parent_id', prev.parent_id),
      }

      if (!String(merged.name || '').trim()) throw new Error('Product name required')
      assertUniqueProductFields({ name: merged.name, sku: merged.sku, barcode: merged.barcode, excludeId: productId })
      const parentRecord = ensureParentProductExists(merged.parent_id, { childId: productId })
      const normalizedParentId = parentRecord?.id || null

      const desiredQty = Math.max(0, parseFloat(merged.stock_quantity) || 0)
      const incomingGallery = normalizeImageGallery(
        hasOwnField(d, 'image_gallery') ? d.image_gallery : [],
        null,
      )
      const effectiveGallery = incomingGallery.length
        ? incomingGallery
        : normalizeImageGallery([], merged.image_path || prev.image_path || null)
      const primaryImage = effectiveGallery[0] || null

      db.prepare(`
        UPDATE products SET
          name=?, sku=?, barcode=?, category=?, brand=?, unit=?, description=?,
          selling_price_usd=?, selling_price_khr=?,
          special_price_usd=?, special_price_khr=?,
          discount_enabled=?, discount_type=?, discount_percent=?, discount_amount_usd=?, discount_amount_khr=?,
          discount_label=?, discount_badge_color=?, discount_starts_at=?, discount_ends_at=?,
          purchase_price_usd=?, purchase_price_khr=?,
          cost_price_usd=?, cost_price_khr=?,
          stock_quantity=?, low_stock_threshold=?, out_of_stock_threshold=?,
          image_path=?, is_active=?, supplier=?, custom_fields=?, is_group=?, parent_id=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        String(merged.name || '').trim(),
        merged.sku || null,
        merged.barcode || null,
        merged.category || null,
        merged.brand || null,
        merged.unit || 'pcs',
        merged.description || null,
        normalizePriceValue(merged.selling_price_usd || 0),
        normalizePriceValue(merged.selling_price_khr || 0),
        normalizePriceValue(merged.special_price_usd ?? merged.selling_price_usd ?? 0),
        normalizePriceValue(merged.special_price_khr ?? merged.selling_price_khr ?? 0),
        merged.discount_enabled ? 1 : 0,
        merged.discount_type || 'percent',
        normalizePriceValue(merged.discount_percent || 0),
        normalizePriceValue(merged.discount_amount_usd || 0),
        normalizePriceValue(merged.discount_amount_khr || 0),
        merged.discount_label || null,
        merged.discount_badge_color || '#e11d48',
        merged.discount_starts_at || null,
        merged.discount_ends_at || null,
        normalizePriceValue(merged.purchase_price_usd || 0),
        normalizePriceValue(merged.purchase_price_khr || 0),
        normalizePriceValue(merged.cost_price_usd || merged.purchase_price_usd || 0),
        normalizePriceValue(merged.cost_price_khr || merged.purchase_price_khr || 0),
        desiredQty,
        merged.low_stock_threshold ?? 10,
        merged.out_of_stock_threshold ?? 0,
        primaryImage, merged.is_active ?? 1,
        merged.supplier || null,
        JSON.stringify(merged.custom_fields || {}),
        normalizedParentId ? 0 : (merged.is_group ? 1 : 0),
        normalizedParentId,
        productId,
      )
      syncProductImageGallery(productId, effectiveGallery)
      if (normalizedParentId) markParentProductAsGroup(normalizedParentId)

      const delta = desiredQty - Math.max(0, prev.stock_quantity || 0)
      if (Math.abs(delta) > 0.0001) {
        const activeBranches = getActiveBranches()
        const defaultBranch = getDefaultBranch(activeBranches)
        const requestedBranchId = d.branch_id ? parseInt(d.branch_id, 10) : null
        let movementBranchId = requestedBranchId || null

        seedBranchRows(productId, activeBranches)

        if (delta > 0) {
          const targetBranchId = requestedBranchId || defaultBranch?.id
          if (!targetBranchId) throw new Error('An active branch is required before stock can be increased')
          db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = ?')
            .run(delta, productId, targetBranchId)
          movementBranchId = targetBranchId
        } else {
          let remaining = Math.abs(delta)

          if (requestedBranchId) {
            const available = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(productId, requestedBranchId)?.quantity || 0
            if (remaining > available) throw new Error(`Cannot remove ${remaining} ??only ${available} available in this branch`)

            db.prepare('UPDATE branch_stock SET quantity = MAX(0, quantity - ?) WHERE product_id = ? AND branch_id = ?')
              .run(remaining, productId, requestedBranchId)
            movementBranchId = requestedBranchId
          } else {
            const branchRows = db.prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC, branch_id ASC').all(productId)
            const totalAvailable = branchRows.reduce((sum, row) => sum + (row.quantity || 0), 0)
            if (remaining > totalAvailable) throw new Error(`Cannot remove ${remaining} ??only ${totalAvailable} available`)

            for (const row of branchRows) {
              if (remaining <= 0) break
              const take = Math.min(row.quantity || 0, remaining)
              db.prepare('UPDATE branch_stock SET quantity = MAX(0, quantity - ?) WHERE product_id = ? AND branch_id = ?')
                .run(take, productId, row.branch_id)
              remaining -= take
            }

            movementBranchId = null
          }
        }

        recalcProductStock(productId)

        const branchName = movementBranchId
          ? activeBranches.find(branch => branch.id === movementBranchId)?.name || null
          : null

        db.prepare(`
          INSERT INTO inventory_movements
            (product_id, product_name, branch_id, branch_name, movement_type, quantity,
             unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, user_id, user_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          productId,
          String(merged.name || '').trim(),
          movementBranchId,
          branchName,
          delta > 0 ? 'add' : 'remove',
          Math.abs(delta),
          merged.purchase_price_usd || 0,
          merged.purchase_price_khr || 0,
          Math.abs(delta) * (merged.purchase_price_usd || 0),
          Math.abs(delta) * (merged.purchase_price_khr || 0),
          'Product edit (manual stock change)',
          actor.userId,
          actor.userName,
        )
      } else {
        recalcProductStock(productId)
      }

      audit(actor.userId, actor.userName, 'update', 'product', productId, { name: merged.name }, {
        deviceName: d.deviceName || null, deviceTz: d.deviceTz || null, clientTime: d.clientTime || null,
      })
    })()
    logOp('products:update', Date.now() - t0)
    broadcast('products')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

// ?? DELETE /api/products/:id ??????????????????????????????????????????????????
router.delete('/:id', authToken, requirePermission('products'), (req, res) => {
  const { deviceName, deviceTz, clientTime } = req.body || req.query || {}
  const actor = getAuditActor(req, req.body || req.query || {})
  try {
    const p = db.prepare('SELECT id, name, updated_at FROM products WHERE id = ?').get(req.params.id)
    if (!p) return err(res, 'Product not found')
    assertUpdatedAtMatch('product', p, getExpectedUpdatedAt(req.body || req.query || {}))
    db.transaction(() => {
      db.prepare('UPDATE inventory_movements SET product_id = NULL WHERE product_id = ?').run(req.params.id)
      db.prepare('UPDATE sale_items SET product_id = NULL WHERE product_id = ?').run(req.params.id)
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(req.params.id)
      db.prepare('DELETE FROM branch_stock WHERE product_id = ?').run(req.params.id)
      db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
    })()
    audit(actor.userId, actor.userName, 'delete', 'product', req.params.id, p, {
      deviceName: deviceName || null,
      deviceTz: deviceTz || null,
      clientTime: clientTime || null,
    })
    broadcast('products')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

// ?? POST /api/products/upload-image ??????????????????????????????????????????
router.post('/upload-image', authToken, requirePermission('products'), routeRateLimit({ name: 'products:upload_image', max: 30, windowMs: 5 * 60 * 1000, message: 'Too many product image uploads.' }), upload.single('image'), validateUploadedFile, compressUpload, (req, res) => {
  if (!req.file) return err(res, 'No image uploaded')
  registerUploadFromRequest(req.file, getAuditActor(req))
    .then((asset) => ok(res, { path: asset.public_path, asset }))
    .catch((error) => err(res, error.message || 'Image upload failed'))
})

// ?? POST /api/products/bulk-import ???????????????????????????????????????????
router.post('/bulk-import', authToken, requirePermission('products'), routeRateLimit({ name: 'products:bulk_import', max: 10, windowMs: 15 * 60 * 1000, message: 'Too many bulk imports.' }), async (req, res) => {
  const { products, imageFiles, imageOnly, deviceName, deviceTz, clientTime } = req.body || {}
  const actor = getAuditActor(req, req.body || {})
  const errors = []
  let imported = 0, updated = 0, images_matched = 0
  const normalizeLookup = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const legacyProductCount = Array.isArray(products) ? products.length : 0
  const legacyImageEntries = imageFiles && typeof imageFiles === 'object' ? Object.entries(imageFiles) : []
  const legacyBase64ImageBytes = legacyImageEntries.reduce((sum, [, value]) => (
    sum + (/^data:image\//i.test(String(value || '')) ? String(value || '').length : 0)
  ), 0)
  if (
    legacyProductCount > 500
    || legacyImageEntries.length > 100
    || legacyBase64ImageBytes > 10 * 1024 * 1024
  ) {
    return err(res, 'Large product imports must use the import job pipeline so rows and images are processed safely in the background.', 413)
  }

  // Image-only mode: match uploaded images to products by filename ??product name
  if (imageOnly) {
    if (!imageFiles || typeof imageFiles !== 'object') return err(res, 'No images provided')
    const allProducts = db.prepare('SELECT id, name FROM products WHERE is_active = 1').all()
    const imgEntries  = Object.entries(imageFiles)

    // Process async (compression), then write DB in a transaction
    const resolved = []
    for (const [filename, dataUrl] of imgEntries) {
      const baseName = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim().toLowerCase()
      const match    = allProducts.find(p => p.name.trim().toLowerCase() === baseName)
      if (!match) { errors.push(`No product matched for "${filename}"`); continue }
      try {
        const sourceValue = String(dataUrl || '').trim()
        if (isSafeExternalImageReference(sourceValue) && !/^data:image\//i.test(sourceValue)) {
          resolved.push({ id: match.id, path: sourceValue })
          continue
        }
        const asset = await storeDataUrlAsset({
          dataUrl,
          fileName: filename,
          createdById: actor.userId,
          createdByName: actor.userName,
          source: 'bulk_import',
        })
        resolved.push({ id: match.id, path: asset.public_path })
      } catch (e) { errors.push(`${filename}: ${e.message}`) }
    }

    db.transaction(() => {
      for (const { id, path: imgPath } of resolved) {
        db.prepare("UPDATE products SET image_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(imgPath, id)
        syncProductImageGallery(id, [imgPath])
        images_matched++
      }
    })()
    audit(actor.userId, actor.userName, 'image_import', 'product', null, { images_matched }, {
      deviceName: deviceName || null,
      deviceTz: deviceTz || null,
      clientTime: clientTime || null,
    })
    broadcast('products')
    return ok(res, { imported: 0, updated: 0, images_matched, errors })
  }

  if (!Array.isArray(products) || products.length === 0) return err(res, 'products array required')

  const activeBranches = db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
  const defaultImportBranch = getDefaultBranch(activeBranches)
  const categoryMap = new Map(
    db.prepare('SELECT id, name FROM categories ORDER BY name COLLATE NOCASE ASC').all()
      .map((row) => [normalizeLookup(row.name), row])
  )
  const unitMap = new Map(
    db.prepare('SELECT id, name FROM units ORDER BY name COLLATE NOCASE ASC').all()
      .map((row) => [normalizeLookup(row.name), row])
  )
  const settingsSupportsUpdatedAt = db.prepare(`
    SELECT 1 AS exists
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
  `).get('settings', 'updated_at')?.exists === 1
  const upsertSetting = settingsSupportsUpdatedAt
    ? db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)
    : db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
  const brandSettingValue = db.prepare("SELECT value FROM settings WHERE key = 'product_brand_options'").get()?.value
  const parsedBrandOptions = tryParse(brandSettingValue, [])
  const brandOptions = Array.isArray(parsedBrandOptions) ? parsedBrandOptions : []
  const brandMap = new Map(
    brandOptions
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => [normalizeLookup(value), value])
  )
  let categoriesChanged = false
  let unitsChanged = false
  let brandsChanged = false
  let branchesChanged = false
  let suppliersChanged = false
  const insertBS  = db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,?)')
  // logMove: movement_type is passed as a parameter so each action uses the correct type:
  //   'purchase' ??new product initial stock from CSV
  //   'add'      ??merge: adding stock to existing product
  //   'adjustment' ??override_add / override_replace: replacing or adding with explicit override
  const logMove   = db.prepare(`
    INSERT INTO inventory_movements
      (product_id, product_name, branch_id, branch_name, movement_type, quantity,
       unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, user_id, user_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)

  const resolveImage = async (filename) => {
    if (!filename || !imageFiles?.[filename]) return null
    const sourceValue = String(imageFiles[filename] || '').trim()
    if (isSafeExternalImageReference(sourceValue) && !/^data:image\//i.test(sourceValue)) return sourceValue
    try {
      const asset = await storeDataUrlAsset({
        dataUrl: imageFiles[filename],
        fileName: filename,
        createdById: actor.userId,
        createdByName: actor.userName,
        source: 'bulk_import',
      })
      return asset.public_path
    } catch { return null }
  }

  const ensureCategory = (value) => {
    const trimmed = String(value || '').trim()
    if (!trimmed) return null
    const lookup = normalizeLookup(trimmed)
    const existing = categoryMap.get(lookup)
    if (existing?.name) return existing.name
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO categories (name, color, updated_at) VALUES (?, ?, ?)').run(trimmed, '#6366f1', now)
    const created = { id: result.lastInsertRowid, name: trimmed }
    categoryMap.set(lookup, created)
    categoriesChanged = true
    return created.name
  }

  const ensureUnit = (value) => {
    const trimmed = String(value || '').trim()
    if (!trimmed) return null
    const lookup = normalizeLookup(trimmed)
    const existing = unitMap.get(lookup)
    if (existing?.name) return existing.name
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO units (name, color, updated_at) VALUES (?, ?, ?)').run(trimmed, '#6366f1', now)
    const created = { id: result.lastInsertRowid, name: trimmed }
    unitMap.set(lookup, created)
    unitsChanged = true
    return created.name
  }

  const ensureBrand = (value) => {
    const trimmed = String(value || '').trim()
    if (!trimmed) return null
    const lookup = normalizeLookup(trimmed)
    const existing = brandMap.get(lookup)
    if (existing) return existing
    brandOptions.push(trimmed)
    brandMap.set(lookup, trimmed)
    brandsChanged = true
    return trimmed
  }

  const ensureSupplier = (value) => {
    const trimmed = String(value || '').trim()
    if (!trimmed) return null
    const existing = db.prepare('SELECT id, name FROM suppliers WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1').get(trimmed)
    if (!existing) {
      db.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(trimmed)
      suppliersChanged = true
    }
    return trimmed
  }

  const determineBranch = (branchName) => {
    let mb = null
    if (branchName?.trim()) {
      mb = activeBranches.find(b => b.name.toLowerCase() === branchName.trim().toLowerCase())
      if (!mb) {
        const nb  = db.prepare('INSERT OR IGNORE INTO branches (name,is_default,is_active) VALUES (?,0,1)').run(branchName.trim())
        const nid = nb.lastInsertRowid || db.prepare('SELECT id FROM branches WHERE name=?').get(branchName.trim())?.id
        if (nid) {
          mb = { id: nid, name: branchName.trim() }
          activeBranches.push(mb)
          branchesChanged = true
        }
      }
    } else {
      mb = defaultImportBranch
    }
    return mb
  }

  const handleBranch = (pid, branchName, qty, replace) => {
    const mb = determineBranch(branchName)

    if (!mb) {
      if (qty > 0) throw new Error('A branch is required to import stock')
      if (replace) db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ?').run(pid)
      recalcProductStock(pid)
      return
    }

    insertBS.run(pid, mb.id, 0)
    if (replace) db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ?').run(pid)
    if (qty > 0) {
      if (replace) db.prepare('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=?').run(qty, pid, mb.id)
      else         db.prepare('UPDATE branch_stock SET quantity=quantity+? WHERE product_id=? AND branch_id=?').run(qty, pid, mb.id)
    }
    recalcProductStock(pid)
  }

  /**
   * 5.1 Image import reference parser.
   * 5.1.1 Supports legacy filename columns and URL/path-based columns.
   * 5.1.2 Keeps max 5 unique entries in CSV order.
   * 5.1.3 File entries normalize to basename so they match uploaded folder files.
   */
  const isDirectImageRef = (value = '') => {
    const raw = String(value || '').trim().replace(/\\/g, '/')
    if (!raw) return false
    return (
      /^data:image\//i.test(raw)
      || /^https?:\/\//i.test(raw)
      || raw.startsWith('/uploads/')
      || raw.startsWith('uploads/')
    )
  }

  const normalizeDirectImageRef = (value = '') => {
    const raw = String(value || '').trim().replace(/\\/g, '/')
    if (!raw) return ''
    if (raw.startsWith('uploads/')) return `/${raw}`
    return raw
  }

  const parseIncomingImageRefs = (row = {}) => {
    const candidates = []
    const directKeys = [
      'image_filename',
      'image_filename_1', 'image_filename_2', 'image_filename_3', 'image_filename_4', 'image_filename_5',
      'image_1', 'image_2', 'image_3', 'image_4', 'image_5',
      'image_url_1', 'image_url_2', 'image_url_3', 'image_url_4', 'image_url_5',
    ]
    directKeys.forEach((key) => {
      const value = String(row?.[key] || '').trim()
      if (value) candidates.push(value)
    })
    ;['image_filenames', 'image_urls'].forEach((key) => {
      const listField = String(row?.[key] || '').trim()
      if (!listField) return
      listField.split(/[|;\n]/).map((item) => item.trim()).filter(Boolean).forEach((item) => candidates.push(item))
    })
    const seen = new Set()
    const unique = []
    for (const value of candidates) {
      const normalized = isDirectImageRef(value)
        ? normalizeDirectImageRef(value)
        : path.basename(value)
      if (!normalized) continue
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(normalized)
      if (unique.length >= 5) break
    }
    return unique
  }

  const loadCurrentGallery = (productId, fallbackPrimary = null) => {
    const rows = db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(productId)
    const gallery = rows.map((row) => row.image_path)
    return normalizeImageGallery(gallery, fallbackPrimary)
  }

  const resolvedImages = {}
  const allImageFilenames = new Set()
  for (const p of products) {
    parseIncomingImageRefs(p).forEach((ref) => {
      if (!isDirectImageRef(ref)) allImageFilenames.add(ref)
    })
  }
  for (const filename of allImageFilenames) {
    resolvedImages[filename] = await resolveImage(filename)
    if (!resolvedImages[filename] && imageFiles?.[filename]) {
      errors.push(`${filename}: image upload failed`)
    }
  }

  const importParentsByName = new Map()
  db.transaction(() => {
    for (const p of products) {
      try {
        if (!p.name?.trim()) { errors.push('Row missing name'); continue }
        let importActionLabel = String(p._action || '').trim().toLowerCase()
        const qty     = parseImportNumber(p, 'stock_quantity', 0)
        const sellUsd = normalizePriceValue(parseImportNumber(p, 'selling_price_usd', 0))
        const sellKhr = normalizePriceValue(parseImportNumber(p, 'selling_price_khr', 0))
        const specialUsd = normalizePriceValue(parseImportNumber(p, 'special_price_usd', sellUsd))
        const specialKhr = normalizePriceValue(parseImportNumber(p, 'special_price_khr', sellKhr))
        const importDiscount = normalizeProductDiscount({
          discount_enabled: p.discount_enabled ?? p.promotion_enabled ?? p.on_promotion,
          discount_type: p.discount_type || (hasImportValue(p, 'discount_amount_usd') || hasImportValue(p, 'discount_amount_khr') ? 'fixed' : 'percent'),
          discount_percent: parseImportNumber(p, 'discount_percent', 0),
          discount_amount_usd: parseImportNumber(p, 'discount_amount_usd', 0),
          discount_amount_khr: parseImportNumber(p, 'discount_amount_khr', 0),
          discount_label: p.discount_label || p.promotion_label || '',
          discount_badge_color: p.discount_badge_color || '',
          discount_starts_at: p.discount_starts_at || p.promotion_starts_at || '',
          discount_ends_at: p.discount_ends_at || p.promotion_ends_at || '',
        })
        const buyUsd  = normalizePriceValue(parseImportNumber(p, 'purchase_price_usd', 0))
        const buyKhr  = normalizePriceValue(parseImportNumber(p, 'purchase_price_khr', 0))
        const thresh  = parseImportNumber(p, 'low_stock_threshold', 10)
        const explicitParentId = parseOptionalImportId(p, 'parent_id')
        const plannedParentId = parseOptionalImportId(p, '_parent_id')
        const plannedTargetId = parseOptionalImportId(p, '_target_product_id')
        const isGroup = parseImportFlag(p, 'is_group', 0)
        const normalizedCategory = ensureCategory(p.category)
        const normalizedUnit = ensureUnit(p.unit || 'pcs') || 'pcs'
        const normalizedBrand = ensureBrand(p.brand)
        const normalizedSupplier = ensureSupplier(p.supplier)
        const incomingImageGallery = normalizeImageGallery(
          parseIncomingImageRefs(p)
            .map((ref) => (isDirectImageRef(ref) ? ref : (resolvedImages[ref] || null)))
            .filter(Boolean),
          null,
        )
        const sameNameProducts = db.prepare("SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) ORDER BY is_group DESC, parent_id ASC, created_at ASC, id ASC").all(p.name.trim())
        const nameKey = normalizeLookup(p.name)
        const importedParent = nameKey ? importParentsByName.get(nameKey) || null : null
        const candidateParents = importedParent ? [...sameNameProducts, importedParent] : sameNameProducts
        const importSignature = getProductImportDetailSignature({
          ...p,
          category: normalizedCategory,
          unit: normalizedUnit,
          brand: normalizedBrand,
          supplier: normalizedSupplier,
          selling_price_usd: sellUsd,
          selling_price_khr: sellKhr,
          special_price_usd: specialUsd,
          special_price_khr: specialKhr,
          discount_enabled: importDiscount.discount_enabled,
          discount_type: importDiscount.discount_type,
          discount_percent: importDiscount.discount_percent,
          discount_amount_usd: importDiscount.discount_amount_usd,
          discount_amount_khr: importDiscount.discount_amount_khr,
          discount_label: importDiscount.discount_label,
          discount_badge_color: importDiscount.discount_badge_color,
          discount_starts_at: importDiscount.discount_starts_at,
          discount_ends_at: importDiscount.discount_ends_at,
          purchase_price_usd: buyUsd,
          purchase_price_khr: buyKhr,
          cost_price_usd: buyUsd,
          cost_price_khr: buyKhr,
          low_stock_threshold: thresh,
        })
        const matchingSameNameProduct = sameNameProducts.find((product) => getProductImportDetailSignature(product) === importSignature) || null
        const selectedParent = chooseImportParentProduct(candidateParents)
        if (!importActionLabel || importActionLabel === 'ask') {
          if (matchingSameNameProduct) {
            importActionLabel = sameNameProducts.length > 1 ? 'link_variant' : 'merge_stock'
            p._target_product_id = matchingSameNameProduct.id
          } else if (sameNameProducts.length) {
            importActionLabel = 'create_variant'
            p._parent_id = selectedParent?.parent_id || selectedParent?.id || null
          } else {
            importActionLabel = 'new'
          }
        }
        const action = normalizeImportAction(importActionLabel) || 'new'
        const wantsVariantParent = ['create_variant', 'link_variant'].includes(importActionLabel)
        const parentId = wantsVariantParent
          ? (plannedParentId || explicitParentId || selectedParent?.parent_id || selectedParent?.id || null)
          : explicitParentId
        const imageConflictMode = normalizeImageConflictMode(
          p._image_action || p.image_conflict_mode,
          action,
          incomingImageGallery.length > 0,
        )

        if (action === 'new') {
          const parentRecord = ensureParentProductExists(parentId || null)
          const normalizedParentId = parentRecord?.id || null
          assertUniqueProductFields({
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            allowDuplicateName: importActionLabel === 'create_variant' && !!normalizedParentId,
          })
          const newProductGallery = incomingImageGallery
          const newPrimaryImage = newProductGallery[0] || null
          const r = db.prepare(`
            INSERT INTO products
              (name, sku, barcode, category, unit, description,
              brand,
              selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
              discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr,
              discount_label, discount_badge_color, discount_starts_at, discount_ends_at,
              purchase_price_usd, purchase_price_khr,
              cost_price_usd, cost_price_khr,
              stock_quantity, low_stock_threshold,
              is_active, supplier, image_path, is_group, parent_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            p.name.trim(), p.sku || null, p.barcode || null, normalizedCategory, normalizedUnit,
            p.description || null, normalizedBrand, sellUsd, sellKhr, specialUsd, specialKhr,
            importDiscount.discount_enabled, importDiscount.discount_type, importDiscount.discount_percent,
            importDiscount.discount_amount_usd, importDiscount.discount_amount_khr,
            importDiscount.discount_label || null, importDiscount.discount_badge_color,
            importDiscount.discount_starts_at || null, importDiscount.discount_ends_at || null,
            buyUsd, buyKhr, buyUsd, buyKhr, qty, thresh,
            (p.is_active !== undefined ? p.is_active : 1), normalizedSupplier, newPrimaryImage, normalizedParentId ? 0 : isGroup, normalizedParentId
          )
          const pid = r.lastInsertRowid
          syncProductImageGallery(pid, newProductGallery)
          if (normalizedParentId) {
            markParentProductAsGroup(normalizedParentId)
            if (nameKey && !importParentsByName.has(nameKey)) {
              importParentsByName.set(nameKey, { ...p, id: normalizedParentId, is_group: 1, parent_id: null, created_at: new Date().toISOString() })
            }
          } else if (nameKey && !importParentsByName.has(nameKey)) {
            importParentsByName.set(nameKey, { ...p, id: pid, is_group: importActionLabel === 'create_variant' ? 1 : isGroup, parent_id: null, created_at: new Date().toISOString() })
            if (importActionLabel === 'create_variant') markParentProductAsGroup(pid)
          }
          activeBranches.forEach(b => insertBS.run(pid, b.id, 0))
          const branch = determineBranch(p.branch)
          if (qty > 0) {
            logMove.run(pid, p.name.trim(), branch?.id || null, branch?.name || null, 'purchase', qty, buyUsd, buyKhr, qty * buyUsd, qty * buyKhr,
              'CSV import - new product', actor.userId, actor.userName)
          }
          handleBranch(pid, p.branch, qty, true)
          imported++
        } else {
          const ep = plannedTargetId
            ? db.prepare('SELECT * FROM products WHERE id = ?').get(plannedTargetId)
            : db.prepare(
              "SELECT * FROM products WHERE lower(trim(name))=lower(trim(?)) OR (sku IS NOT NULL AND sku=?)"
            ).get(p.name.trim(), p.sku || '__NOSKUMATCH__')
          if (!ep) { errors.push(`${p.name}: existing product not found`); continue }
          const pid = ep.id
          const fieldRules = p._field_rules && typeof p._field_rules === 'object' ? p._field_rules : {}
          const defaultFieldRule = action === 'merge' ? 'merge_blank_only' : 'use_imported'
          const resolvedCategory = resolveImportValue(ep.category, normalizedCategory, hasImportValue(p, 'category'), fieldRules.category, defaultFieldRule)
          const resolvedUnit = resolveImportValue(ep.unit, normalizedUnit, hasImportValue(p, 'unit'), fieldRules.unit, defaultFieldRule)
          const resolvedBrand = resolveImportValue(ep.brand, normalizedBrand, hasImportValue(p, 'brand'), fieldRules.brand, defaultFieldRule)
          const resolvedDescription = resolveImportValue(ep.description, p.description || null, hasImportValue(p, 'description'), fieldRules.description, defaultFieldRule)
          const resolvedSupplier = resolveImportValue(ep.supplier, normalizedSupplier, hasImportValue(p, 'supplier'), fieldRules.supplier, defaultFieldRule)
          const resolvedSellUsd = resolveImportValue(ep.selling_price_usd, sellUsd, hasImportValue(p, 'selling_price_usd'), fieldRules.selling_price_usd, defaultFieldRule)
          const resolvedSellKhr = resolveImportValue(ep.selling_price_khr, sellKhr, hasImportValue(p, 'selling_price_khr'), fieldRules.selling_price_khr, defaultFieldRule)
          const resolvedSpecialUsd = resolveImportValue(ep.special_price_usd, specialUsd, hasImportValue(p, 'special_price_usd'), fieldRules.special_price_usd, defaultFieldRule)
          const resolvedSpecialKhr = resolveImportValue(ep.special_price_khr, specialKhr, hasImportValue(p, 'special_price_khr'), fieldRules.special_price_khr, defaultFieldRule)
          const resolvedDiscount = normalizeProductDiscount({
            discount_enabled: resolveImportValue(ep.discount_enabled, importDiscount.discount_enabled, hasImportValue(p, 'discount_enabled') || hasImportValue(p, 'promotion_enabled') || hasImportValue(p, 'on_promotion'), fieldRules.discount_enabled, defaultFieldRule),
            discount_type: resolveImportValue(ep.discount_type, importDiscount.discount_type, hasImportValue(p, 'discount_type'), fieldRules.discount_type, defaultFieldRule),
            discount_percent: resolveImportValue(ep.discount_percent, importDiscount.discount_percent, hasImportValue(p, 'discount_percent'), fieldRules.discount_percent, defaultFieldRule),
            discount_amount_usd: resolveImportValue(ep.discount_amount_usd, importDiscount.discount_amount_usd, hasImportValue(p, 'discount_amount_usd'), fieldRules.discount_amount_usd, defaultFieldRule),
            discount_amount_khr: resolveImportValue(ep.discount_amount_khr, importDiscount.discount_amount_khr, hasImportValue(p, 'discount_amount_khr'), fieldRules.discount_amount_khr, defaultFieldRule),
            discount_label: resolveImportValue(ep.discount_label, importDiscount.discount_label, hasImportValue(p, 'discount_label') || hasImportValue(p, 'promotion_label'), fieldRules.discount_label, defaultFieldRule),
            discount_badge_color: resolveImportValue(ep.discount_badge_color, importDiscount.discount_badge_color, hasImportValue(p, 'discount_badge_color'), fieldRules.discount_badge_color, defaultFieldRule),
            discount_starts_at: resolveImportValue(ep.discount_starts_at, importDiscount.discount_starts_at, hasImportValue(p, 'discount_starts_at') || hasImportValue(p, 'promotion_starts_at'), fieldRules.discount_starts_at, defaultFieldRule),
            discount_ends_at: resolveImportValue(ep.discount_ends_at, importDiscount.discount_ends_at, hasImportValue(p, 'discount_ends_at') || hasImportValue(p, 'promotion_ends_at'), fieldRules.discount_ends_at, defaultFieldRule),
          }, ep)
          const resolvedBuyUsd = resolveImportValue(ep.purchase_price_usd, buyUsd, hasImportValue(p, 'purchase_price_usd'), fieldRules.purchase_price_usd, defaultFieldRule)
          const resolvedBuyKhr = resolveImportValue(ep.purchase_price_khr, buyKhr, hasImportValue(p, 'purchase_price_khr'), fieldRules.purchase_price_khr, defaultFieldRule)
          const resolvedThreshold = resolveImportValue(ep.low_stock_threshold, thresh, hasImportValue(p, 'low_stock_threshold'), fieldRules.low_stock_threshold, defaultFieldRule)
          const resolvedIsGroup = resolveImportValue(ep.is_group, isGroup, hasImportValue(p, 'is_group'), fieldRules.is_group, defaultFieldRule)
          const resolvedParentId = resolveImportValue(ep.parent_id, parentId || null, hasImportValue(p, 'parent_id') || !!parentId, fieldRules.parent_id, defaultFieldRule)
          const resolvedParentCandidate = Number(resolvedParentId || 0) === Number(pid)
            ? (ep.parent_id || null)
            : (resolvedParentId || null)
          const parentRecord = ensureParentProductExists(resolvedParentCandidate, { childId: pid })
          const normalizedParentId = parentRecord?.id || null
          const normalizedIsGroup = normalizedParentId ? 0 : (resolvedIsGroup ? 1 : 0)
          const currentGallery = loadCurrentGallery(pid, ep.image_path || null)
          let nextGallery = currentGallery
          if (incomingImageGallery.length > 0) {
            if (imageConflictMode === 'replace_with_csv') {
              nextGallery = normalizeImageGallery(incomingImageGallery)
            } else if (imageConflictMode === 'append_csv') {
              nextGallery = normalizeImageGallery([...currentGallery, ...incomingImageGallery])
            }
          }

          if (action === 'merge') {
            const changedFields = (
              resolvedCategory !== ep.category
              || resolvedUnit !== ep.unit
              || resolvedBrand !== ep.brand
              || resolvedDescription !== ep.description
              || resolvedSupplier !== ep.supplier
              || resolvedSellUsd !== ep.selling_price_usd
              || resolvedSellKhr !== ep.selling_price_khr
              || resolvedSpecialUsd !== ep.special_price_usd
              || resolvedSpecialKhr !== ep.special_price_khr
              || Number(resolvedDiscount.discount_enabled || 0) !== Number(ep.discount_enabled || 0)
              || resolvedDiscount.discount_type !== (ep.discount_type || 'percent')
              || Number(resolvedDiscount.discount_percent || 0) !== Number(ep.discount_percent || 0)
              || Number(resolvedDiscount.discount_amount_usd || 0) !== Number(ep.discount_amount_usd || 0)
              || Number(resolvedDiscount.discount_amount_khr || 0) !== Number(ep.discount_amount_khr || 0)
              || (resolvedDiscount.discount_label || '') !== (ep.discount_label || '')
              || (resolvedDiscount.discount_badge_color || '#e11d48') !== (ep.discount_badge_color || '#e11d48')
              || (resolvedDiscount.discount_starts_at || '') !== (ep.discount_starts_at || '')
              || (resolvedDiscount.discount_ends_at || '') !== (ep.discount_ends_at || '')
              || resolvedBuyUsd !== ep.purchase_price_usd
              || resolvedBuyKhr !== ep.purchase_price_khr
              || resolvedThreshold !== ep.low_stock_threshold
              || normalizedIsGroup !== ep.is_group
              || normalizedParentId !== ep.parent_id
            )
            if (changedFields) {
              db.prepare(`
                UPDATE products SET
                  category=?, unit=?, brand=?, description=?, supplier=?,
                  selling_price_usd=?, selling_price_khr=?,
                  special_price_usd=?, special_price_khr=?,
                  discount_enabled=?, discount_type=?, discount_percent=?, discount_amount_usd=?, discount_amount_khr=?,
                  discount_label=?, discount_badge_color=?, discount_starts_at=?, discount_ends_at=?,
                  purchase_price_usd=?, purchase_price_khr=?,
                  cost_price_usd=?, cost_price_khr=?,
                  low_stock_threshold=?, is_group=?, parent_id=?,
                  updated_at=CURRENT_TIMESTAMP
                WHERE id=?
              `).run(
                resolvedCategory,
                resolvedUnit,
                resolvedBrand,
                resolvedDescription,
                resolvedSupplier,
                normalizePriceValue(resolvedSellUsd || 0),
                normalizePriceValue(resolvedSellKhr || 0),
                normalizePriceValue(resolvedSpecialUsd ?? resolvedSellUsd ?? 0),
                normalizePriceValue(resolvedSpecialKhr ?? resolvedSellKhr ?? 0),
                resolvedDiscount.discount_enabled,
                resolvedDiscount.discount_type,
                resolvedDiscount.discount_percent,
                resolvedDiscount.discount_amount_usd,
                resolvedDiscount.discount_amount_khr,
                resolvedDiscount.discount_label || null,
                resolvedDiscount.discount_badge_color,
                resolvedDiscount.discount_starts_at || null,
                resolvedDiscount.discount_ends_at || null,
                normalizePriceValue(resolvedBuyUsd || 0),
                normalizePriceValue(resolvedBuyKhr || 0),
                normalizePriceValue(resolvedBuyUsd || 0),
                normalizePriceValue(resolvedBuyKhr || 0),
                resolvedThreshold || 0,
                normalizedIsGroup ? 1 : 0,
                normalizedParentId,
                pid,
              )
            }
            if (normalizedParentId) markParentProductAsGroup(normalizedParentId)
            if (qty > 0) {
              const branch = determineBranch(p.branch)
              logMove.run(pid, ep.name, branch?.id || null, branch?.name || null, 'add', qty, ep.purchase_price_usd, ep.purchase_price_khr,
                qty * ep.purchase_price_usd, qty * ep.purchase_price_khr, 'CSV import - merge add stock', actor.userId, actor.userName)
              handleBranch(pid, p.branch, qty, false)
            }
            if (JSON.stringify(nextGallery) !== JSON.stringify(currentGallery)) {
              syncProductImageGallery(pid, nextGallery)
            }
          } else if (action === 'override_add' || action === 'override_replace') {
            const replaceStock = action === 'override_replace'
            db.prepare(`
              UPDATE products SET
                category=?, unit=?, brand=?, description=?, supplier=?,
                selling_price_usd=?, selling_price_khr=?,
                special_price_usd=?, special_price_khr=?,
                discount_enabled=?, discount_type=?, discount_percent=?, discount_amount_usd=?, discount_amount_khr=?,
                discount_label=?, discount_badge_color=?, discount_starts_at=?, discount_ends_at=?,
                purchase_price_usd=?, purchase_price_khr=?,
                cost_price_usd=?, cost_price_khr=?,
                low_stock_threshold=?, is_group=?, parent_id=?,
                updated_at=CURRENT_TIMESTAMP WHERE id=?
            `).run(
              resolvedCategory,
              resolvedUnit,
              resolvedBrand,
              resolvedDescription,
              resolvedSupplier,
              normalizePriceValue(resolvedSellUsd || 0),
              normalizePriceValue(resolvedSellKhr || 0),
              normalizePriceValue(resolvedSpecialUsd ?? resolvedSellUsd ?? 0),
              normalizePriceValue(resolvedSpecialKhr ?? resolvedSellKhr ?? 0),
              resolvedDiscount.discount_enabled,
              resolvedDiscount.discount_type,
              resolvedDiscount.discount_percent,
              resolvedDiscount.discount_amount_usd,
              resolvedDiscount.discount_amount_khr,
              resolvedDiscount.discount_label || null,
              resolvedDiscount.discount_badge_color,
              resolvedDiscount.discount_starts_at || null,
              resolvedDiscount.discount_ends_at || null,
              normalizePriceValue(resolvedBuyUsd || 0),
              normalizePriceValue(resolvedBuyKhr || 0),
              normalizePriceValue(resolvedBuyUsd || 0),
              normalizePriceValue(resolvedBuyKhr || 0),
              resolvedThreshold || 0,
              normalizedIsGroup ? 1 : 0,
              normalizedParentId,
              pid,
            )
            if (normalizedParentId) markParentProductAsGroup(normalizedParentId)
            if (JSON.stringify(nextGallery) !== JSON.stringify(currentGallery)) {
              syncProductImageGallery(pid, nextGallery)
            }
            if (replaceStock) {
              handleBranch(pid, p.branch, qty, true)
            }
            if (qty > 0) {
              const movType = replaceStock ? 'adjustment' : 'add'
              const movReason = replaceStock ? 'CSV import - override replace stock' : 'CSV import - override add stock'
              const branch = determineBranch(p.branch)
              logMove.run(pid, ep.name, branch?.id || null, branch?.name || null, movType, qty,
                buyUsd || ep.purchase_price_usd, buyKhr || ep.purchase_price_khr,
                qty * (buyUsd || ep.purchase_price_usd), qty * (buyKhr || ep.purchase_price_khr),
                movReason, actor.userId, actor.userName)
              if (!replaceStock) handleBranch(pid, p.branch, qty, false)
            }
          }
          updated++
        }
      } catch (e) { errors.push(`${p.name || '?'}: ${e.message}`) }
    }
    if (brandsChanged) {
      const cleanBrandMap = new Map()
      brandOptions
        .map((value) => String(value || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .forEach((value) => {
          const lookup = normalizeLookup(value)
          if (!cleanBrandMap.has(lookup)) cleanBrandMap.set(lookup, value)
        })
      const cleanBrands = Array.from(cleanBrandMap.values()).sort((left, right) => left.localeCompare(right))
      upsertSetting.run('product_brand_options', JSON.stringify(cleanBrands))
    }
  })()

  audit(actor.userId, actor.userName, 'bulk_import', 'product', null, { imported, updated }, {
    deviceName: deviceName || null,
    deviceTz: deviceTz || null,
    clientTime: clientTime || null,
  })
  if (categoriesChanged) broadcast('categories')
  if (unitsChanged) broadcast('units')
  if (brandsChanged) broadcast('settings')
  if (branchesChanged) broadcast('branches')
  if (suppliersChanged) broadcast('suppliers')
  broadcast('products')
  ok(res, { imported, updated, errors })
})

module.exports = router



