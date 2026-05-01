'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const yauzl = require('yauzl')
const { db } = require('../database')
const {
  IMPORTS_PATH,
  IMPORT_ROW_BATCH_SIZE,
  IMPORT_IMAGE_CONCURRENCY,
  IMPORT_MAX_ZIP_MB,
  JOB_QUEUE_DRIVER,
  REDIS_URL,
  UPLOADS_PATH,
} = require('../config')
const { audit, broadcast } = require('../helpers')
const { buildUniqueStoredName, registerStoredAsset, sanitizeOriginalFileName } = require('../fileAssets')
const { validateUploadedPath } = require('../uploadSecurity')
const { isSafeExternalImageReference } = require('../netSecurity')
const { normalizePriceValue } = require('../money')
const { normalizeProductDiscount } = require('../productDiscounts')
const { parseCsvRows } = require('../importCsv')
const {
  hasImportValue,
  normalizeImageConflictMode,
  parseImportFlag,
  parseImportNumber,
  resolveImportValue,
} = require('../productImportPolicies')

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const MAX_ZIP_IMAGES = 25_000
const MAX_ZIP_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
const IMPORT_QUEUE_NAME = 'business-os-imports'
const runningLocalJobs = new Set()
let bullQueue = null
let bullWorker = null
let bullStatus = { driver: 'sqlite', available: false, reason: 'not_checked' }

function nowIso() {
  return new Date().toISOString()
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(String(value || '')) } catch (_) { return fallback }
}

function stringify(value) {
  try { return JSON.stringify(value ?? {}) } catch (_) { return '{}' }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function ensureImportRoot() {
  ensureDir(IMPORTS_PATH)
}

function getJobRoot(jobId) {
  return path.join(IMPORTS_PATH, String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
}

function createImportJob({ type = 'products', actor = {}, policy = {}, queueDriver = 'sqlite' } = {}) {
  ensureImportRoot()
  const id = `imp_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
  ensureDir(getJobRoot(id))
  db.prepare(`
    INSERT INTO import_jobs (
      id, type, status, phase, queue_driver, policy_json,
      created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, 'pending', 'created', ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    String(type || 'products').trim().toLowerCase(),
    queueDriver,
    stringify(policy),
    actor.userId || null,
    actor.userName || null,
  )
  return getImportJob(id)
}

function getImportJob(id) {
  const row = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...row,
    policy: safeJson(row.policy_json, {}),
    summary: safeJson(row.summary_json, {}),
  }
}

function listImportJobs({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT *
    FROM import_jobs
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, Number(limit || 50)))).map((row) => ({
    ...row,
    policy: safeJson(row.policy_json, {}),
    summary: safeJson(row.summary_json, {}),
  }))
}

function updateJob(id, patch = {}) {
  const allowed = [
    'status',
    'phase',
    'queue_driver',
    'total_rows',
    'processed_rows',
    'failed_rows',
    'total_images',
    'processed_images',
    'failed_images',
    'warning_count',
    'summary_json',
    'cancel_requested',
    'last_error',
    'started_at',
    'finished_at',
  ]
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key))
  if (!entries.length) return getImportJob(id)
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ')
  db.prepare(`UPDATE import_jobs SET ${assignments}, updated_at = datetime('now') WHERE id = @id`).run({ id, ...Object.fromEntries(entries) })
  return getImportJob(id)
}

function addJobError(jobId, { batchId = null, rowNumber = null, fileName = null, code = null, message, raw = {} } = {}) {
  db.prepare(`
    INSERT INTO import_job_errors (job_id, batch_id, row_number, file_name, code, message, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, batchId, rowNumber, fileName, code, String(message || 'Import error').slice(0, 1000), stringify(raw))
}

function getJobErrors(jobId, { limit = 500 } = {}) {
  return db.prepare(`
    SELECT *
    FROM import_job_errors
    WHERE job_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(jobId, Math.max(1, Math.min(5000, Number(limit || 500))))
}

function addJobFile(jobId, file = {}, kind = 'csv', relativePath = '') {
  const stats = fs.existsSync(file.path) ? fs.statSync(file.path) : null
  const result = db.prepare(`
    INSERT INTO import_job_files (
      job_id, kind, original_name, stored_path, relative_path, mime_type, byte_size,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stored', datetime('now'), datetime('now'))
  `).run(
    jobId,
    kind,
    String(file.originalname || path.basename(file.path || '') || '').slice(0, 240),
    file.path,
    String(relativePath || file.originalname || path.basename(file.path || '') || '').slice(0, 500),
    String(file.mimetype || ''),
    stats?.size || Number(file.size || 0) || 0,
  )
  return db.prepare('SELECT * FROM import_job_files WHERE id = ?').get(result.lastInsertRowid)
}

function getJobFiles(jobId, kind = null) {
  if (kind) return db.prepare('SELECT * FROM import_job_files WHERE job_id = ? AND kind = ? ORDER BY id ASC').all(jobId, kind)
  return db.prepare('SELECT * FROM import_job_files WHERE job_id = ? ORDER BY id ASC').all(jobId)
}

function markJobCancelled(jobId) {
  return updateJob(jobId, { cancel_requested: 1, status: 'cancelling', phase: 'cancel_requested' })
}

function isCancelled(jobId) {
  return !!db.prepare('SELECT cancel_requested FROM import_jobs WHERE id = ?').get(jobId)?.cancel_requested
}

function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

function getMimeTypeFromName(fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.csv') return 'text/csv'
  return 'application/octet-stream'
}

const DETAIL_FIELDS = [
  'sku',
  'barcode',
  'category',
  'brand',
  'unit',
  'description',
  'supplier',
  'selling_price_usd',
  'selling_price_khr',
  'special_price_usd',
  'special_price_khr',
  'discount_enabled',
  'discount_type',
  'discount_percent',
  'discount_amount_usd',
  'discount_amount_khr',
  'discount_label',
  'discount_badge_color',
  'discount_starts_at',
  'discount_ends_at',
  'purchase_price_usd',
  'purchase_price_khr',
  'cost_price_usd',
  'cost_price_khr',
  'low_stock_threshold',
]

const MONEY_FIELDS = new Set([
  'selling_price_usd',
  'selling_price_khr',
  'special_price_usd',
  'special_price_khr',
  'discount_percent',
  'discount_amount_usd',
  'discount_amount_khr',
  'purchase_price_usd',
  'purchase_price_khr',
  'cost_price_usd',
  'cost_price_khr',
  'low_stock_threshold',
])

function normalizeProductSignature(source = {}) {
  return DETAIL_FIELDS.map((field) => {
    const value = source?.[field]
    if (MONEY_FIELDS.has(field)) return `${field}:${normalizePriceValue(Number(value || 0))}`
    return `${field}:${normalizeLookup(value)}`
  }).join('|')
}

function chooseParentProduct(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftGroup = Number(left?.is_group || 0) ? 0 : 1
    const rightGroup = Number(right?.is_group || 0) ? 0 : 1
    if (leftGroup !== rightGroup) return leftGroup - rightGroup
    const leftRoot = Number(left?.parent_id || 0) ? 1 : 0
    const rightRoot = Number(right?.parent_id || 0) ? 1 : 0
    if (leftRoot !== rightRoot) return leftRoot - rightRoot
    const byCreated = String(left?.created_at || '').localeCompare(String(right?.created_at || ''))
    if (byCreated) return byCreated
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
  const value = Number(row?.[field] || 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseIncomingImageRefs(row = {}) {
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
    const raw = String(value || '').trim().replace(/\\/g, '/')
    const normalized = /^data:image\//i.test(raw) || /^https?:\/\//i.test(raw) || raw.startsWith('/uploads/') || raw.startsWith('uploads/')
      ? (raw.startsWith('uploads/') ? `/${raw}` : raw)
      : path.basename(raw)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(normalized)
    if (unique.length >= 5) break
  }
  return unique
}

function syncProductImageGallery(productId, gallery = []) {
  const clean = []
  const seen = new Set()
  ;(Array.isArray(gallery) ? gallery : []).forEach((item) => {
    const value = String(item || '').trim()
    if (!value) return
    const key = value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    clean.push(value)
  })
  const normalized = clean.slice(0, 5)
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId)
  if (!normalized.length) {
    db.prepare("UPDATE products SET image_path = NULL, updated_at = datetime('now') WHERE id = ?").run(productId)
    return []
  }
  const insert = db.prepare('INSERT INTO product_images (product_id, image_path, sort_order) VALUES (?, ?, ?)')
  normalized.forEach((imagePath, index) => insert.run(productId, imagePath, index))
  db.prepare("UPDATE products SET image_path = ?, updated_at = datetime('now') WHERE id = ?").run(normalized[0], productId)
  return normalized
}

function loadCurrentGallery(productId, fallbackPrimary = null) {
  const rows = db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(productId)
  const gallery = rows.map((row) => row.image_path).filter(Boolean)
  if (!gallery.length && fallbackPrimary) gallery.push(fallbackPrimary)
  return gallery.slice(0, 5)
}

function ensureParentProductExists(parentId, { childId = null } = {}) {
  if (!parentId) return null
  const parent = db.prepare('SELECT id, name FROM products WHERE id = ?').get(parentId)
  if (!parent) throw new Error('Parent product not found')
  if (childId && Number(parent.id) === Number(childId)) throw new Error('A product cannot be its own parent')
  db.prepare("UPDATE products SET is_group = 1, parent_id = NULL, updated_at = datetime('now') WHERE id = ?").run(parent.id)
  return parent
}

function assertUniqueProductFields({ name, sku, barcode, excludeId = null, allowDuplicateName = false }) {
  const trimmedName = normalizeText(name)
  if (!trimmedName) throw new Error('Product name required')
  const conflict = db.prepare(`
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
    allowDuplicateName ? 1 : 0,
    trimmedName,
    sku || null, sku || '', sku || null,
    barcode || null, barcode || '', barcode || null,
    excludeId, excludeId,
  )
  if (!conflict) return
  if ((sku || '') && conflict.sku === sku) throw new Error(`Duplicate SKU "${sku}" is not allowed`)
  if ((barcode || '') && conflict.barcode === barcode) throw new Error(`Duplicate barcode "${barcode}" is not allowed`)
  if (!allowDuplicateName) throw new Error(`Duplicate product name "${trimmedName}" is not allowed`)
}

async function copyImageIntoAssets(sourcePath, originalName, actor = {}) {
  const safeOriginal = sanitizeOriginalFileName(originalName || path.basename(sourcePath))
  const storedName = buildUniqueStoredName(safeOriginal)
  const destination = path.join(UPLOADS_PATH, storedName)
  fs.copyFileSync(sourcePath, destination)
  const file = { path: destination, mimetype: getMimeTypeFromName(storedName), originalname: safeOriginal }
  await validateUploadedPath(destination, file)
  const asset = await registerStoredAsset({
    storedName,
    originalName: safeOriginal,
    mimeType: file.mimetype,
    createdById: actor.userId || null,
    createdByName: actor.userName || null,
    source: 'bulk_import',
  })
  return asset.public_path
}

async function resolveImageGallery(row, imageLookup, actor, jobId) {
  const refs = parseIncomingImageRefs(row)
  const gallery = []
  for (const ref of refs) {
    const normalized = String(ref || '').trim()
    if (!normalized) continue
    if (isSafeExternalImageReference(normalized) && !/^data:image\//i.test(normalized)) {
      gallery.push(normalized)
      continue
    }
    const file = imageLookup.get(path.basename(normalized).toLowerCase())
    if (!file) {
      addJobError(jobId, {
        rowNumber: row._rowNumber || null,
        fileName: normalized,
        code: 'image_missing',
        message: `Image "${normalized}" was referenced but not uploaded.`,
      })
      continue
    }
    try {
      gallery.push(await copyImageIntoAssets(file.stored_path, file.original_name || file.relative_path, actor))
      db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = datetime('now') WHERE id = ?").run(file.id)
      db.prepare(`
        UPDATE import_jobs
        SET processed_images = processed_images + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(jobId)
    } catch (error) {
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?").run(error?.message || 'Image processing failed', file.id)
      db.prepare(`
        UPDATE import_jobs
        SET failed_images = failed_images + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(jobId)
      addJobError(jobId, {
        rowNumber: row._rowNumber || null,
        fileName: normalized,
        code: 'image_failed',
        message: error?.message || 'Image processing failed',
      })
    }
  }
  return gallery.slice(0, 5)
}

function ensureSettingOptionMap(key) {
  const value = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
  const parsed = safeJson(value, [])
  const options = Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  return {
    options,
    map: new Map(options.map((value) => [normalizeLookup(value), value])),
  }
}

function upsertSettingJson(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, stringify(value))
}

function normalizeRowForProduct(row = {}) {
  const sellUsd = normalizePriceValue(parseImportNumber(row, 'selling_price_usd', 0))
  const sellKhr = normalizePriceValue(parseImportNumber(row, 'selling_price_khr', 0))
  const specialUsd = normalizePriceValue(parseImportNumber(row, 'special_price_usd', sellUsd))
  const specialKhr = normalizePriceValue(parseImportNumber(row, 'special_price_khr', sellKhr))
  const buyUsd = normalizePriceValue(parseImportNumber(row, 'purchase_price_usd', parseImportNumber(row, 'cost_price_usd', 0)))
  const buyKhr = normalizePriceValue(parseImportNumber(row, 'purchase_price_khr', parseImportNumber(row, 'cost_price_khr', 0)))
  const discount = normalizeProductDiscount({
    discount_enabled: row.discount_enabled ?? row.promotion_enabled ?? row.on_promotion,
    discount_type: row.discount_type || (hasImportValue(row, 'discount_amount_usd') || hasImportValue(row, 'discount_amount_khr') ? 'fixed' : 'percent'),
    discount_percent: parseImportNumber(row, 'discount_percent', 0),
    discount_amount_usd: parseImportNumber(row, 'discount_amount_usd', 0),
    discount_amount_khr: parseImportNumber(row, 'discount_amount_khr', 0),
    discount_label: row.discount_label || row.promotion_label || '',
    discount_badge_color: row.discount_badge_color || '',
    discount_starts_at: row.discount_starts_at || row.promotion_starts_at || '',
    discount_ends_at: row.discount_ends_at || row.promotion_ends_at || '',
  })
  return {
    name: normalizeText(row.name),
    sku: normalizeText(row.sku) || null,
    barcode: normalizeText(row.barcode) || null,
    category: normalizeText(row.category) || null,
    brand: normalizeText(row.brand) || null,
    unit: normalizeText(row.unit || 'pcs') || 'pcs',
    description: normalizeText(row.description) || null,
    supplier: normalizeText(row.supplier) || null,
    selling_price_usd: sellUsd,
    selling_price_khr: sellKhr,
    special_price_usd: specialUsd,
    special_price_khr: specialKhr,
    ...discount,
    purchase_price_usd: buyUsd,
    purchase_price_khr: buyKhr,
    cost_price_usd: buyUsd,
    cost_price_khr: buyKhr,
    stock_quantity: parseImportNumber(row, 'stock_quantity', 0),
    low_stock_threshold: parseImportNumber(row, 'low_stock_threshold', 10),
    is_active: parseImportFlag(row, 'is_active', 1),
    is_group: parseImportFlag(row, 'is_group', 0),
    parent_id: parseOptionalImportId(row, 'parent_id'),
    branch: normalizeText(row.branch) || '',
  }
}

function createProductContext() {
  const activeBranches = db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
  const categoryMap = new Map(db.prepare('SELECT id, name FROM categories ORDER BY name COLLATE NOCASE ASC').all().map((row) => [normalizeLookup(row.name), row]))
  const unitMap = new Map(db.prepare('SELECT id, name FROM units ORDER BY name COLLATE NOCASE ASC').all().map((row) => [normalizeLookup(row.name), row]))
  const brandState = ensureSettingOptionMap('product_brand_options')
  return {
    activeBranches,
    defaultBranch: activeBranches.find((branch) => branch.is_default) || activeBranches[0] || null,
    categoryMap,
    unitMap,
    brandOptions: brandState.options,
    brandMap: brandState.map,
    changed: {
      categories: false,
      units: false,
      brands: false,
      branches: false,
      suppliers: false,
    },
  }
}

function ensureCategory(ctx, value) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  const lookup = normalizeLookup(trimmed)
  const existing = ctx.categoryMap.get(lookup)
  if (existing?.name) return existing.name
  const result = db.prepare('INSERT INTO categories (name, color, updated_at) VALUES (?, ?, ?)').run(trimmed, '#6366f1', nowIso())
  ctx.categoryMap.set(lookup, { id: result.lastInsertRowid, name: trimmed })
  ctx.changed.categories = true
  return trimmed
}

function ensureUnit(ctx, value) {
  const trimmed = normalizeText(value || 'pcs') || 'pcs'
  const lookup = normalizeLookup(trimmed)
  const existing = ctx.unitMap.get(lookup)
  if (existing?.name) return existing.name
  const result = db.prepare('INSERT INTO units (name, color, updated_at) VALUES (?, ?, ?)').run(trimmed, '#6366f1', nowIso())
  ctx.unitMap.set(lookup, { id: result.lastInsertRowid, name: trimmed })
  ctx.changed.units = true
  return trimmed
}

function ensureBrand(ctx, value) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  const lookup = normalizeLookup(trimmed)
  const existing = ctx.brandMap.get(lookup)
  if (existing) return existing
  ctx.brandOptions.push(trimmed)
  ctx.brandMap.set(lookup, trimmed)
  ctx.changed.brands = true
  return trimmed
}

function ensureSupplier(ctx, value) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  const existing = db.prepare('SELECT id FROM suppliers WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1').get(trimmed)
  if (!existing) {
    db.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(trimmed)
    ctx.changed.suppliers = true
  }
  return trimmed
}

function determineBranch(ctx, branchName) {
  const name = normalizeText(branchName)
  if (!name) return ctx.defaultBranch
  let branch = ctx.activeBranches.find((item) => normalizeLookup(item.name) === normalizeLookup(name))
  if (branch) return branch
  const result = db.prepare('INSERT OR IGNORE INTO branches (name, is_default, is_active) VALUES (?, 0, 1)').run(name)
  const id = result.lastInsertRowid || db.prepare('SELECT id FROM branches WHERE name = ?').get(name)?.id
  branch = id ? { id, name } : null
  if (branch) {
    ctx.activeBranches.push(branch)
    ctx.changed.branches = true
  }
  return branch || ctx.defaultBranch
}

function handleBranchStock(ctx, productId, branchName, qty, replace) {
  const branch = determineBranch(ctx, branchName)
  if (!branch) {
    if (qty > 0) throw new Error('A branch is required to import stock')
    if (replace) db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ?').run(productId)
    recalcProductStock(productId)
    return null
  }
  db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, 0)').run(productId, branch.id)
  if (replace) db.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = ?').run(productId)
  if (qty > 0) {
    if (replace) db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?').run(qty, productId, branch.id)
    else db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = ?').run(qty, productId, branch.id)
  }
  recalcProductStock(productId)
  return branch
}

function recalcProductStock(productId) {
  db.prepare(`
    UPDATE products SET
      stock_quantity = (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = ?),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(productId, productId)
}

function insertInventoryMovement({ productId, productName, branch, movementType, qty, buyUsd, buyKhr, reason, actor }) {
  if (!(qty > 0)) return
  db.prepare(`
    INSERT INTO inventory_movements
      (product_id, product_name, branch_id, branch_name, movement_type, quantity,
       unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, user_id, user_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    productId,
    productName,
    branch?.id || null,
    branch?.name || null,
    movementType,
    qty,
    buyUsd,
    buyKhr,
    qty * buyUsd,
    qty * buyKhr,
    reason,
    actor.userId || null,
    actor.userName || null,
  )
}

function seedBranchRows(productId, ctx) {
  const insert = db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, 0)')
  ctx.activeBranches.forEach((branch) => insert.run(productId, branch.id))
}

async function processProductRow({ row, imageLookup, actor, ctx, jobId }) {
  const normalized = normalizeRowForProduct(row)
  if (!normalized.name) throw new Error('Product name required')
  normalized.category = ensureCategory(ctx, normalized.category)
  normalized.unit = ensureUnit(ctx, normalized.unit)
  normalized.brand = ensureBrand(ctx, normalized.brand)
  normalized.supplier = ensureSupplier(ctx, normalized.supplier)

  const incomingGallery = await resolveImageGallery(row, imageLookup, actor, jobId)
  const sameName = db.prepare(`
    SELECT *
    FROM products
    WHERE lower(trim(name)) = lower(trim(?))
    ORDER BY is_group DESC, parent_id ASC, created_at ASC, id ASC
  `).all(normalized.name)
  const signature = normalizeProductSignature(normalized)
  const matching = sameName.find((product) => normalizeProductSignature(product) === signature) || null
  const selectedParent = chooseParentProduct(sameName)

  let importActionLabel = normalizeLookup(row._action || '')
  if (!importActionLabel || importActionLabel === 'ask') {
    if (matching) {
      importActionLabel = sameName.length > 1 ? 'link_variant' : 'merge_stock'
      row._target_product_id = matching.id
    } else if (sameName.length) {
      importActionLabel = 'create_variant'
      row._parent_id = selectedParent?.parent_id || selectedParent?.id || null
    } else {
      importActionLabel = 'new'
    }
  }

  const action = normalizeImportAction(importActionLabel) || 'new'
  const plannedTargetId = parseOptionalImportId(row, '_target_product_id')
  const explicitParentId = parseOptionalImportId(row, 'parent_id')
  const plannedParentId = parseOptionalImportId(row, '_parent_id')
  const parentId = importActionLabel === 'create_variant'
    ? (plannedParentId || selectedParent?.parent_id || selectedParent?.id || explicitParentId || null)
    : explicitParentId
  const imageConflictMode = normalizeImageConflictMode(row._image_action || row.image_conflict_mode, action, incomingGallery.length > 0)

  return db.transaction(() => {
    if (action === 'new') {
      const parentRecord = ensureParentProductExists(parentId || null)
      const normalizedParentId = parentRecord?.id || null
      assertUniqueProductFields({
        name: normalized.name,
        sku: normalized.sku,
        barcode: normalized.barcode,
        allowDuplicateName: importActionLabel === 'create_variant' && !!normalizedParentId,
      })
      const primary = incomingGallery[0] || null
      const result = db.prepare(`
        INSERT INTO products (
          name, sku, barcode, category, unit, description, brand,
          selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
          discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr,
          discount_label, discount_badge_color, discount_starts_at, discount_ends_at,
          purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr,
          stock_quantity, low_stock_threshold, is_active, supplier, image_path, is_group, parent_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalized.name,
        normalized.sku,
        normalized.barcode,
        normalized.category,
        normalized.unit,
        normalized.description,
        normalized.brand,
        normalized.selling_price_usd,
        normalized.selling_price_khr,
        normalized.special_price_usd,
        normalized.special_price_khr,
        normalized.discount_enabled,
        normalized.discount_type,
        normalized.discount_percent,
        normalized.discount_amount_usd,
        normalized.discount_amount_khr,
        normalized.discount_label || null,
        normalized.discount_badge_color,
        normalized.discount_starts_at || null,
        normalized.discount_ends_at || null,
        normalized.purchase_price_usd,
        normalized.purchase_price_khr,
        normalized.cost_price_usd,
        normalized.cost_price_khr,
        normalized.stock_quantity,
        normalized.low_stock_threshold,
        normalized.is_active,
        normalized.supplier,
        primary,
        normalizedParentId ? 0 : normalized.is_group,
        normalizedParentId,
      )
      const productId = result.lastInsertRowid
      syncProductImageGallery(productId, incomingGallery)
      seedBranchRows(productId, ctx)
      const branch = handleBranchStock(ctx, productId, normalized.branch, normalized.stock_quantity, true)
      insertInventoryMovement({
        productId,
        productName: normalized.name,
        branch,
        movementType: 'purchase',
        qty: normalized.stock_quantity,
        buyUsd: normalized.purchase_price_usd,
        buyKhr: normalized.purchase_price_khr,
        reason: 'CSV import - new product',
        actor,
      })
      return { imported: 1, updated: 0 }
    }

    const existing = plannedTargetId
      ? db.prepare('SELECT * FROM products WHERE id = ?').get(plannedTargetId)
      : (matching || db.prepare("SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) OR (sku IS NOT NULL AND sku = ?)").get(normalized.name, normalized.sku || '__NOSKUMATCH__'))
    if (!existing) throw new Error('Existing product not found')

    const fieldRules = row._field_rules && typeof row._field_rules === 'object'
      ? row._field_rules
      : safeJson(row._field_rules, {})
    const defaultRule = action === 'merge' ? 'merge_blank_only' : 'use_imported'
    const resolved = {
      category: resolveImportValue(existing.category, normalized.category, hasImportValue(row, 'category'), fieldRules.category, defaultRule),
      unit: resolveImportValue(existing.unit, normalized.unit, hasImportValue(row, 'unit'), fieldRules.unit, defaultRule),
      brand: resolveImportValue(existing.brand, normalized.brand, hasImportValue(row, 'brand'), fieldRules.brand, defaultRule),
      description: resolveImportValue(existing.description, normalized.description, hasImportValue(row, 'description'), fieldRules.description, defaultRule),
      supplier: resolveImportValue(existing.supplier, normalized.supplier, hasImportValue(row, 'supplier'), fieldRules.supplier, defaultRule),
      selling_price_usd: resolveImportValue(existing.selling_price_usd, normalized.selling_price_usd, hasImportValue(row, 'selling_price_usd'), fieldRules.selling_price_usd, defaultRule),
      selling_price_khr: resolveImportValue(existing.selling_price_khr, normalized.selling_price_khr, hasImportValue(row, 'selling_price_khr'), fieldRules.selling_price_khr, defaultRule),
      special_price_usd: resolveImportValue(existing.special_price_usd, normalized.special_price_usd, hasImportValue(row, 'special_price_usd'), fieldRules.special_price_usd, defaultRule),
      special_price_khr: resolveImportValue(existing.special_price_khr, normalized.special_price_khr, hasImportValue(row, 'special_price_khr'), fieldRules.special_price_khr, defaultRule),
      purchase_price_usd: resolveImportValue(existing.purchase_price_usd, normalized.purchase_price_usd, hasImportValue(row, 'purchase_price_usd'), fieldRules.purchase_price_usd, defaultRule),
      purchase_price_khr: resolveImportValue(existing.purchase_price_khr, normalized.purchase_price_khr, hasImportValue(row, 'purchase_price_khr'), fieldRules.purchase_price_khr, defaultRule),
      low_stock_threshold: resolveImportValue(existing.low_stock_threshold, normalized.low_stock_threshold, hasImportValue(row, 'low_stock_threshold'), fieldRules.low_stock_threshold, defaultRule),
      is_group: resolveImportValue(existing.is_group, normalized.is_group, hasImportValue(row, 'is_group'), fieldRules.is_group, defaultRule),
      parent_id: resolveImportValue(existing.parent_id, parentId || null, hasImportValue(row, 'parent_id') || !!parentId, fieldRules.parent_id, defaultRule),
    }
    const resolvedDiscount = normalizeProductDiscount({
      discount_enabled: resolveImportValue(existing.discount_enabled, normalized.discount_enabled, hasImportValue(row, 'discount_enabled') || hasImportValue(row, 'promotion_enabled') || hasImportValue(row, 'on_promotion'), fieldRules.discount_enabled, defaultRule),
      discount_type: resolveImportValue(existing.discount_type, normalized.discount_type, hasImportValue(row, 'discount_type'), fieldRules.discount_type, defaultRule),
      discount_percent: resolveImportValue(existing.discount_percent, normalized.discount_percent, hasImportValue(row, 'discount_percent'), fieldRules.discount_percent, defaultRule),
      discount_amount_usd: resolveImportValue(existing.discount_amount_usd, normalized.discount_amount_usd, hasImportValue(row, 'discount_amount_usd'), fieldRules.discount_amount_usd, defaultRule),
      discount_amount_khr: resolveImportValue(existing.discount_amount_khr, normalized.discount_amount_khr, hasImportValue(row, 'discount_amount_khr'), fieldRules.discount_amount_khr, defaultRule),
      discount_label: resolveImportValue(existing.discount_label, normalized.discount_label, hasImportValue(row, 'discount_label') || hasImportValue(row, 'promotion_label'), fieldRules.discount_label, defaultRule),
      discount_badge_color: resolveImportValue(existing.discount_badge_color, normalized.discount_badge_color, hasImportValue(row, 'discount_badge_color'), fieldRules.discount_badge_color, defaultRule),
      discount_starts_at: resolveImportValue(existing.discount_starts_at, normalized.discount_starts_at, hasImportValue(row, 'discount_starts_at') || hasImportValue(row, 'promotion_starts_at'), fieldRules.discount_starts_at, defaultRule),
      discount_ends_at: resolveImportValue(existing.discount_ends_at, normalized.discount_ends_at, hasImportValue(row, 'discount_ends_at') || hasImportValue(row, 'promotion_ends_at'), fieldRules.discount_ends_at, defaultRule),
    }, existing)

    const parentRecord = ensureParentProductExists(resolved.parent_id || null, { childId: existing.id })
    const normalizedParentId = parentRecord?.id || null
    const normalizedIsGroup = normalizedParentId ? 0 : (resolved.is_group ? 1 : 0)
    const currentGallery = loadCurrentGallery(existing.id, existing.image_path)
    let nextGallery = currentGallery
    if (incomingGallery.length > 0) {
      if (imageConflictMode === 'replace_with_csv') nextGallery = incomingGallery
      else if (imageConflictMode === 'append_csv') nextGallery = [...currentGallery, ...incomingGallery]
    }

    db.prepare(`
      UPDATE products SET
        category = ?, unit = ?, brand = ?, description = ?, supplier = ?,
        selling_price_usd = ?, selling_price_khr = ?,
        special_price_usd = ?, special_price_khr = ?,
        discount_enabled = ?, discount_type = ?, discount_percent = ?, discount_amount_usd = ?, discount_amount_khr = ?,
        discount_label = ?, discount_badge_color = ?, discount_starts_at = ?, discount_ends_at = ?,
        purchase_price_usd = ?, purchase_price_khr = ?, cost_price_usd = ?, cost_price_khr = ?,
        low_stock_threshold = ?, is_group = ?, parent_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      resolved.category,
      resolved.unit,
      resolved.brand,
      resolved.description,
      resolved.supplier,
      normalizePriceValue(resolved.selling_price_usd || 0),
      normalizePriceValue(resolved.selling_price_khr || 0),
      normalizePriceValue(resolved.special_price_usd ?? resolved.selling_price_usd ?? 0),
      normalizePriceValue(resolved.special_price_khr ?? resolved.selling_price_khr ?? 0),
      resolvedDiscount.discount_enabled,
      resolvedDiscount.discount_type,
      resolvedDiscount.discount_percent,
      resolvedDiscount.discount_amount_usd,
      resolvedDiscount.discount_amount_khr,
      resolvedDiscount.discount_label || null,
      resolvedDiscount.discount_badge_color,
      resolvedDiscount.discount_starts_at || null,
      resolvedDiscount.discount_ends_at || null,
      normalizePriceValue(resolved.purchase_price_usd || 0),
      normalizePriceValue(resolved.purchase_price_khr || 0),
      normalizePriceValue(resolved.purchase_price_usd || 0),
      normalizePriceValue(resolved.purchase_price_khr || 0),
      resolved.low_stock_threshold || 0,
      normalizedIsGroup ? 1 : 0,
      normalizedParentId,
      existing.id,
    )
    syncProductImageGallery(existing.id, nextGallery)

    const replaceStock = action === 'override_replace'
    if (replaceStock || normalized.stock_quantity > 0) {
      const branch = handleBranchStock(ctx, existing.id, normalized.branch, normalized.stock_quantity, replaceStock)
      insertInventoryMovement({
        productId: existing.id,
        productName: existing.name,
        branch,
        movementType: replaceStock ? 'adjustment' : 'add',
        qty: normalized.stock_quantity,
        buyUsd: normalized.purchase_price_usd || existing.purchase_price_usd || 0,
        buyKhr: normalized.purchase_price_khr || existing.purchase_price_khr || 0,
        reason: replaceStock ? 'CSV import - override replace stock' : 'CSV import - merge add stock',
        actor,
      })
    }
    return { imported: 0, updated: 1 }
  })()
}

async function processProductRows({ jobId, rows, imageLookup, actor }) {
  const ctx = createProductContext()
  let imported = 0
  let updated = 0
  let failed = 0
  const batchSize = IMPORT_ROW_BATCH_SIZE

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    if (isCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported, updated, failed, cancelled: true }
    }
    const batchRows = rows.slice(offset, offset + batchSize)
    const batchIndex = Math.floor(offset / batchSize)
    const batchResult = db.prepare(`
      INSERT INTO import_job_batches (job_id, batch_index, start_row, end_row, status, attempts, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', 1, datetime('now'), datetime('now'))
      ON CONFLICT(job_id, batch_index) DO UPDATE SET
        status = 'running',
        attempts = attempts + 1,
        started_at = datetime('now'),
        updated_at = datetime('now')
    `).run(jobId, batchIndex, offset + 1, offset + batchRows.length)
    const batchId = batchResult.lastInsertRowid || db.prepare('SELECT id FROM import_job_batches WHERE job_id = ? AND batch_index = ?').get(jobId, batchIndex)?.id
    for (const row of batchRows) {
      try {
        const result = await processProductRow({ row, imageLookup, actor, ctx, jobId })
        imported += result.imported || 0
        updated += result.updated || 0
      } catch (error) {
        failed += 1
        addJobError(jobId, {
          batchId,
          rowNumber: row?._rowNumber || null,
          code: 'row_failed',
          message: `${row?.name || 'Row'}: ${error?.message || 'Import failed'}`,
          raw: row,
        })
      }
      db.prepare(`
        UPDATE import_jobs
        SET processed_rows = processed_rows + 1,
            failed_rows = ?,
            summary_json = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(failed, stringify({ imported, updated, failed }), jobId)
    }
    db.prepare("UPDATE import_job_batches SET status = 'completed', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(batchId)
  }

  if (ctx.changed.brands) {
    const clean = Array.from(new Map(ctx.brandOptions.map((value) => [normalizeLookup(value), normalizeText(value)])).values()).filter(Boolean).sort((a, b) => a.localeCompare(b))
    upsertSettingJson('product_brand_options', clean)
  }
  if (ctx.changed.categories) broadcast('categories')
  if (ctx.changed.units) broadcast('units')
  if (ctx.changed.brands) broadcast('settings')
  if (ctx.changed.branches) broadcast('branches')
  if (ctx.changed.suppliers) broadcast('suppliers')
  return { imported, updated, failed, cancelled: false }
}

function buildImageLookup(files = []) {
  const map = new Map()
  files.forEach((file) => {
    const candidates = [
      file.original_name,
      file.relative_path,
      path.basename(file.stored_path || ''),
    ].map((value) => path.basename(String(value || '')).toLowerCase()).filter(Boolean)
    candidates.forEach((name) => {
      if (!map.has(name)) map.set(name, file)
    })
  })
  return map
}

function normalizeImageMatchKey(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

async function processImageOnlyFiles({ jobId, imageFiles, actor }) {
  const products = db.prepare('SELECT id, name, sku, barcode, image_path FROM products WHERE is_active = 1').all()
  const byKey = new Map()
  products.forEach((product) => {
    ;[product.name, product.sku, product.barcode].forEach((value) => {
      const key = normalizeImageMatchKey(value)
      if (key && !byKey.has(key)) byKey.set(key, product)
    })
  })
  let imagesMatched = 0
  let failed = 0
  for (const file of imageFiles) {
    if (isCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported: 0, updated: 0, images_matched: imagesMatched, failed, cancelled: true }
    }
    const matchKey = normalizeImageMatchKey(file.relative_path || file.original_name || file.stored_path)
    const product = byKey.get(matchKey)
    if (!product) {
      failed += 1
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?").run('No active product matched this image filename.', file.id)
      updateJob(jobId, { failed_images: failed })
      addJobError(jobId, {
        fileName: file.relative_path || file.original_name,
        code: 'image_no_match',
        message: `No product matched image "${file.relative_path || file.original_name}".`,
      })
      continue
    }
    try {
      const publicPath = await copyImageIntoAssets(file.stored_path, file.original_name || file.relative_path, actor)
      db.transaction(() => {
        const gallery = loadCurrentGallery(product.id, product.image_path)
        syncProductImageGallery(product.id, [...gallery, publicPath])
        db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = datetime('now') WHERE id = ?").run(file.id)
        db.prepare(`
          UPDATE import_jobs
          SET processed_images = processed_images + 1,
              summary_json = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(stringify({ imported: 0, updated: 0, images_matched: imagesMatched + 1, failed }), jobId)
      })()
      imagesMatched += 1
    } catch (error) {
      failed += 1
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?").run(error?.message || 'Image processing failed', file.id)
      updateJob(jobId, { failed_images: failed })
      addJobError(jobId, {
        fileName: file.relative_path || file.original_name,
        code: 'image_failed',
        message: error?.message || 'Image processing failed',
      })
    }
  }
  return { imported: 0, updated: 0, images_matched: imagesMatched, failed, cancelled: false }
}

async function extractZipImages(jobId, zipFile) {
  if (!zipFile?.stored_path || !fs.existsSync(zipFile.stored_path)) return []
  const zipSize = fs.statSync(zipFile.stored_path).size
  if (zipSize > IMPORT_MAX_ZIP_MB * 1024 * 1024) throw new Error(`ZIP exceeds ${IMPORT_MAX_ZIP_MB} MB`)
  const extractRoot = path.join(getJobRoot(jobId), 'images')
  ensureDir(extractRoot)
  let totalBytes = 0
  let imageCount = 0
  const added = []

  await new Promise((resolve, reject) => {
    yauzl.open(zipFile.stored_path, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return reject(openError)
      zip.readEntry()
      zip.on('entry', (entry) => {
        const rawName = String(entry.fileName || '').replace(/\\/g, '/')
        const normalized = path.posix.normalize(rawName)
        if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) {
          zip.close()
          return reject(new Error(`Unsafe ZIP path: ${rawName}`))
        }
        if (/\/$/.test(normalized)) {
          zip.readEntry()
          return
        }
        const ext = path.extname(normalized).toLowerCase()
        if (!IMAGE_EXTENSIONS.has(ext)) {
          zip.readEntry()
          return
        }
        imageCount += 1
        totalBytes += Number(entry.uncompressedSize || 0)
        if (imageCount > MAX_ZIP_IMAGES) {
          zip.close()
          return reject(new Error(`ZIP contains more than ${MAX_ZIP_IMAGES} images`))
        }
        if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          zip.close()
          return reject(new Error('ZIP uncompressed size is too large'))
        }
        const safeName = `${String(imageCount).padStart(6, '0')}-${sanitizeOriginalFileName(path.basename(normalized))}`
        const target = path.join(extractRoot, safeName)
        zip.openReadStream(entry, (streamError, readStream) => {
          if (streamError) {
            zip.close()
            return reject(streamError)
          }
          const writeStream = fs.createWriteStream(target)
          readStream.pipe(writeStream)
          writeStream.on('error', reject)
          writeStream.on('finish', () => {
            added.push(addJobFile(jobId, {
              path: target,
              originalname: path.basename(normalized),
              mimetype: getMimeTypeFromName(normalized),
              size: entry.uncompressedSize || 0,
            }, 'image', normalized))
            zip.readEntry()
          })
        })
      })
      zip.on('end', resolve)
      zip.on('error', reject)
    })
  })

  db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = datetime('now') WHERE id = ?").run(zipFile.id)
  return added
}

async function processImportJob(jobId) {
  const job = getImportJob(jobId)
  if (!job) throw new Error('Import job not found')
  if (job.status === 'running') return job
  updateJob(jobId, {
    status: 'running',
    phase: 'starting',
    started_at: job.started_at || nowIso(),
    last_error: null,
  })
  const actor = { userId: job.created_by_id || null, userName: job.created_by_name || null }
  try {
    const csvFile = getJobFiles(jobId, 'csv')[0]
    if (!csvFile?.stored_path || !fs.existsSync(csvFile.stored_path)) throw new Error('CSV file is required before starting import')
    updateJob(jobId, { phase: 'extracting_images' })
    const zipFiles = getJobFiles(jobId, 'zip')
    for (const zipFile of zipFiles) {
      await extractZipImages(jobId, zipFile)
    }
    const imageFiles = getJobFiles(jobId, 'image')
    updateJob(jobId, { total_images: imageFiles.length, phase: 'parsing_csv' })
    const csvText = fs.readFileSync(csvFile.stored_path, 'utf8')
    const rows = parseCsvRows(csvText)
    updateJob(jobId, { total_rows: rows.length, phase: 'processing_rows', processed_rows: 0, failed_rows: 0 })
    if (job.type !== 'products') throw new Error(`Import type "${job.type}" is not implemented in the job pipeline yet`)
    const result = rows.length
      ? await processProductRows({
          jobId,
          rows,
          imageLookup: buildImageLookup(imageFiles),
          actor,
        })
      : await processImageOnlyFiles({ jobId, imageFiles, actor })
    if (result.cancelled) return getImportJob(jobId)
    updateJob(jobId, {
      status: result.failed > 0 ? 'completed_with_errors' : 'completed',
      phase: 'completed',
      failed_rows: rows.length ? result.failed : 0,
      failed_images: rows.length ? getImportJob(jobId).failed_images : result.failed,
      summary_json: stringify(result),
      finished_at: nowIso(),
    })
    audit(actor.userId, actor.userName, 'import_job_completed', 'import_job', null, { jobId, type: job.type, ...result })
    broadcast('products')
    broadcast('inventory')
    return getImportJob(jobId)
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      phase: 'failed',
      last_error: error?.message || 'Import failed',
      finished_at: nowIso(),
    })
    addJobError(jobId, { code: 'job_failed', message: error?.message || 'Import failed' })
    return getImportJob(jobId)
  }
}

async function runLocalJob(jobId) {
  if (runningLocalJobs.has(jobId)) return
  runningLocalJobs.add(jobId)
  try { await processImportJob(jobId) } finally { runningLocalJobs.delete(jobId) }
}

async function initializeBullQueue() {
  if (bullQueue || bullWorker) return bullStatus
  if (JOB_QUEUE_DRIVER === 'sqlite') {
    bullStatus = { driver: 'sqlite', available: false, reason: 'sqlite_configured' }
    return bullStatus
  }
  try {
    const { Queue, Worker } = require('bullmq')
    const IORedis = require('ioredis')
    const connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    })
    await connection.connect()
    await connection.ping()
    bullQueue = new Queue(IMPORT_QUEUE_NAME, { connection })
    bullWorker = new Worker(IMPORT_QUEUE_NAME, async (job) => {
      await processImportJob(job.data.jobId)
    }, {
      connection,
      concurrency: 1,
    })
    bullStatus = { driver: 'bullmq', available: true, reason: 'ready' }
  } catch (error) {
    bullStatus = { driver: 'sqlite', available: false, reason: error?.message || 'Redis unavailable' }
    if (JOB_QUEUE_DRIVER === 'bullmq') {
      console.warn(`[import-jobs] BullMQ unavailable, using SQLite fallback: ${bullStatus.reason}`)
    }
  }
  return bullStatus
}

async function enqueueImportJob(jobId) {
  const status = await initializeBullQueue()
  if (status.available && bullQueue) {
    updateJob(jobId, { queue_driver: 'bullmq', status: 'queued', phase: 'queued' })
    await bullQueue.add('process-import', { jobId }, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    })
    return getImportJob(jobId)
  }
  updateJob(jobId, { queue_driver: 'sqlite', status: 'queued', phase: 'queued' })
  setImmediate(() => { runLocalJob(jobId).catch(() => {}) })
  return getImportJob(jobId)
}

function recoverImportJobs() {
  const rows = db.prepare(`
    SELECT id
    FROM import_jobs
    WHERE status IN ('running', 'queued', 'cancelling')
    ORDER BY datetime(created_at) ASC
    LIMIT 20
  `).all()
  rows.forEach((row) => {
    updateJob(row.id, { status: 'queued', phase: 'recovered_after_restart' })
    setImmediate(() => { runLocalJob(row.id).catch(() => {}) })
  })
}

function getQueueStatus() {
  return {
    ...bullStatus,
    configuredDriver: JOB_QUEUE_DRIVER,
    redisUrlConfigured: !!REDIS_URL,
    imageConcurrency: IMPORT_IMAGE_CONCURRENCY,
    rowBatchSize: IMPORT_ROW_BATCH_SIZE,
  }
}

function buildErrorsCsv(jobId) {
  const errors = getJobErrors(jobId, { limit: 5000 })
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [
    ['row_number', 'file_name', 'code', 'message'].map(escape).join(','),
    ...errors.map((error) => [
      error.row_number || '',
      error.file_name || '',
      error.code || '',
      error.message || '',
    ].map(escape).join(',')),
  ].join('\n')
}

module.exports = {
  addJobFile,
  buildErrorsCsv,
  createImportJob,
  enqueueImportJob,
  getImportJob,
  getJobErrors,
  getJobFiles,
  getQueueStatus,
  initializeBullQueue,
  listImportJobs,
  markJobCancelled,
  recoverImportJobs,
  updateJob,
}
