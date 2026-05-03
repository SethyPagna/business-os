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
  IMPORT_QUEUE_CONCURRENCY,
  IMPORT_BATCH_PAUSE_MS,
  IMPORT_MAX_ZIP_MB,
  JOB_QUEUE_DRIVER,
  BUSINESS_OS_REQUIRE_SCALE_SERVICES,
  REDIS_URL,
  UPLOADS_PATH,
} = require('../config')
const { audit, broadcast } = require('../helpers')
const { buildUniqueStoredName, registerStoredAsset, sanitizeOriginalFileName } = require('../fileAssets')
const { validateUploadedPath } = require('../uploadSecurity')
const { isSafeExternalImageReference } = require('../netSecurity')
const { normalizePriceValue } = require('../money')
const { normalizeProductDiscount } = require('../productDiscounts')
const { normalizeCsvKey, parseCsvRowBatchesFromFile } = require('../importCsv')
const { enqueueMediaOptimization } = require('./mediaQueue')
const { buildImportedContactState, cleanText } = require('../contactOptions')
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
const IMPORT_ANALYZE_QUEUE_NAME = process.env.IMPORT_ANALYZE_QUEUE_NAME || 'business-os-import-analyze'
const IMPORT_APPLY_QUEUE_NAME = process.env.IMPORT_APPLY_QUEUE_NAME || 'business-os-import-apply'
const IMPORT_MEDIA_WAIT_TIMEOUT_MS = Math.max(60_000, Number(process.env.IMPORT_MEDIA_WAIT_TIMEOUT_MS || 30 * 60 * 1000))
const runningLocalJobs = new Set()
let bullConnection = null
let bullQueues = { analyze: null, apply: null }
let bullWorkers = { analyze: null, apply: null }
let bullStatus = { driver: 'bullmq', available: false, reason: 'not_checked', producerReady: false, workerActive: false }

function nowIso() {
  return new Date().toISOString()
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

async function yieldImportWorker(multiplier = 1) {
  const pauseMs = Math.max(0, Number(IMPORT_BATCH_PAUSE_MS || 0))
  await wait(pauseMs * Math.max(1, Number(multiplier || 1)))
}

async function countCsvRowsFromFile(csvFile, jobId) {
  let rows = 0
  let batches = 0
  for await (const batchRows of parseCsvRowBatchesFromFile(csvFile.stored_path, { batchSize: Math.max(500, IMPORT_ROW_BATCH_SIZE) })) {
    if (jobId && isCancelled(jobId)) return rows
    rows += batchRows.length
    batches += 1
    if (jobId && (batches % 4 === 0 || batchRows.length < IMPORT_ROW_BATCH_SIZE)) {
      const currentSummary = getImportJob(jobId)?.summary || {}
      updateJob(jobId, {
        total_rows: rows,
        phase: 'analyzing_rows',
        summary_json: stringify({
          ...currentSummary,
          analyzed_rows: rows,
        }),
      })
    }
    await yieldImportWorker()
  }
  return rows
}

async function* rowBatchesFromFile(csvFile) {
  let startIndex = 0
  let batchIndex = 0
  for await (const rows of parseCsvRowBatchesFromFile(csvFile.stored_path, { batchSize: IMPORT_ROW_BATCH_SIZE })) {
    yield { rows, startIndex, batchIndex }
    startIndex += rows.length
    batchIndex += 1
    await yieldImportWorker()
  }
}

async function* rowBatchesFromArray(rows = [], batchSize = IMPORT_ROW_BATCH_SIZE) {
  const safeRows = Array.isArray(rows) ? rows : []
  for (let offset = 0; offset < safeRows.length; offset += batchSize) {
    yield {
      rows: safeRows.slice(offset, offset + batchSize),
      startIndex: offset,
      batchIndex: Math.floor(offset / batchSize),
    }
  }
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(String(value || '')) } catch (_) { return fallback }
}

function stringify(value) {
  try { return JSON.stringify(value ?? {}) } catch (_) { return '{}' }
}

function decorateImportJobRow(row) {
  if (!row) return null
  return {
    ...row,
    policy: safeJson(row.policy_json, {}),
    summary: safeJson(row.summary_json, {}),
  }
}

function isImportJobStale(row, staleMs = 30_000) {
  const updatedAt = Date.parse(row?.updated_at || row?.started_at || row?.created_at || '')
  if (!Number.isFinite(updatedAt)) return true
  return Date.now() - updatedAt >= Math.max(1_000, Number(staleMs || 30_000))
}

function isImportJobWorkDrained(row) {
  if (!row) return true
  const totalRows = Math.max(0, Number(row.total_rows || 0))
  const processedRows = Math.max(0, Number(row.processed_rows || 0))
  const totalImages = Math.max(0, Number(row.total_images || 0))
  const processedImages = Math.max(0, Number(row.processed_images || 0))
  const failedImages = Math.max(0, Number(row.failed_images || 0))
  const rowsDone = totalRows <= 0 || processedRows >= totalRows
  const imagesDone = totalImages <= 0 || (processedImages + failedImages) >= totalImages
  return rowsDone && imagesDone
}

function markStoredImportFilesCancelled(jobId, reason = 'Import cleanup removed pending files.') {
  db.prepare(`
    UPDATE import_job_files
    SET status = 'cancelled',
        error_message = COALESCE(error_message, ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE job_id = ? AND status IN ('stored', 'queued_media', 'processing')
  `).run(reason, jobId)
}

function reconcileImportJobRow(row, { staleMs = 30_000 } = {}) {
  if (!row) return null
  const status = String(row.status || '').toLowerCase()
  const cancelRequested = !!row.cancel_requested || status === 'cancelling'
  if (!cancelRequested) return row
  if (!['running', 'queued', 'cancelling', 'approved'].includes(status)) return row
  if (!isImportJobWorkDrained(row) && !isImportJobStale(row, staleMs)) return row

  markStoredImportFilesCancelled(row.id, 'Import cancellation cleanup finished.')
  db.prepare(`
    UPDATE import_jobs
    SET status = 'cancelled',
        phase = 'cancelled',
        cancel_requested = 1,
        finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.id)
  return db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(row.id)
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

function assertSafeImportPath(targetPath) {
  const root = path.resolve(IMPORTS_PATH)
  const target = path.resolve(targetPath || '')
  if (!target || target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Refusing to delete an unsafe import path')
  }
  return target
}

function deleteImportJobFiles(jobId) {
  const target = assertSafeImportPath(getJobRoot(jobId))
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (_) {}
}

function clearImportRuntimeFiles() {
  ensureImportRoot()
  const root = path.resolve(IMPORTS_PATH)
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = assertSafeImportPath(path.join(root, entry.name))
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (_) {}
  }
}

function createImportJob({ type = 'products', actor = {}, policy = {}, queueDriver = 'bullmq' } = {}) {
  ensureImportRoot()
  const id = `imp_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
  ensureDir(getJobRoot(id))
  db.prepare(`
    INSERT INTO import_jobs (
      id, type, status, phase, queue_driver, policy_json,
      created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, 'pending', 'created', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
  return decorateImportJobRow(reconcileImportJobRow(row))
}

function listImportJobs({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT *
    FROM import_jobs
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, Number(limit || 50)))).map((row) => decorateImportJobRow(reconcileImportJobRow(row))).filter(Boolean)
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
    'policy_json',
    'summary_json',
    'cancel_requested',
    'last_error',
    'started_at',
    'finished_at',
  ]
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key))
  if (!entries.length) return getImportJob(id)
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ')
  db.prepare(`UPDATE import_jobs SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, ...Object.fromEntries(entries) })
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

function normalizeReviewText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeReviewIdentifier(value) {
  return normalizeText(value).toLowerCase()
}

function getBarcodeReviewIssue(value) {
  const barcode = normalizeText(value)
  if (!barcode) return ''
  if (/[\u0000-\u001F\u007F]/.test(barcode)) return 'invalid_barcode'
  if (barcode.length > 128) return 'barcode_too_long'
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(barcode)) return 'barcode_scientific_notation'
  if (/[^\x20-\x7E]/.test(barcode)) return 'barcode_text'
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+() -]*$/.test(barcode)) return 'barcode_text'
  return ''
}

function isBlockingBarcodeIssue(issueType) {
  return ['invalid_barcode', 'barcode_too_long'].includes(String(issueType || ''))
}

async function buildProductImportReviewState(csvFile) {
  const byBarcode = new Map()
  const bySku = new Map()
  const byName = new Map()
  const add = (map, key, rowNumber) => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(rowNumber)
  }
  for await (const batchRows of parseCsvRowBatchesFromFile(csvFile.stored_path, { batchSize: Math.max(500, IMPORT_ROW_BATCH_SIZE) })) {
    for (const row of batchRows) {
      add(byBarcode, normalizeReviewIdentifier(row.barcode), row._rowNumber || null)
      add(bySku, normalizeReviewIdentifier(row.sku), row._rowNumber || null)
      add(byName, normalizeReviewIdentifier(row.name), row._rowNumber || null)
    }
    await yieldImportWorker()
  }
  const duplicateGroupCount = (map) => Array.from(map.values()).filter((rows) => rows.length > 1).length
  return {
    byBarcode,
    bySku,
    byName,
    duplicateBarcodeGroups: duplicateGroupCount(byBarcode),
    duplicateSkuGroups: duplicateGroupCount(bySku),
    duplicateNameGroups: duplicateGroupCount(byName),
  }
}

function hasReviewQueryMatch(row = {}, conflict = {}, query = '') {
  const needle = normalizeReviewText(query)
  if (!needle) return true
  const haystack = [
    row.name,
    row.sku,
    row.barcode,
    row.phone,
    row.email,
    row.membership_number,
    row.product,
    row.product_name,
    row.branch,
    conflict.type,
    ...(conflict.fields || []),
    ...(conflict.labels || []),
  ].join(' ').toLowerCase()
  return haystack.includes(needle)
}

function normalizeReviewFilter(value) {
  const filter = normalizeReviewText(value || 'all')
  if (['same_name', 'same-name', 'name'].includes(filter)) return 'same_name'
  if (['identifier', 'sku_barcode', 'sku/barcode'].includes(filter)) return 'identifier'
  if (['barcode', 'sku', 'errors', 'issues', 'membership', 'phone', 'email'].includes(filter)) return filter
  return 'all'
}

function matchesReviewFilter(conflict = {}, filter = 'all') {
  if (filter === 'all') return true
  if (filter === 'errors' || filter === 'issues') return !!conflict.issue
  if (filter === 'same_name') return String(conflict.type || '').includes('same_name')
  if (filter === 'identifier') return (conflict.fields || []).some((field) => ['sku', 'barcode'].includes(field))
  return (conflict.fields || []).includes(filter) || String(conflict.type || '').includes(filter)
}

function buildProductReviewIndex() {
  const products = db.prepare(`
    SELECT id, name, sku, barcode, category, brand, unit, description, supplier,
           selling_price_usd, selling_price_khr, special_price_usd, special_price_khr,
           purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr,
           parent_id, is_group, created_at
    FROM products
    WHERE is_active = 1
    ORDER BY id ASC
  `).all()
  const byName = new Map()
  const bySku = new Map()
  const byBarcode = new Map()
  for (const product of products) {
    const nameKey = normalizeReviewText(product.name)
    if (nameKey) {
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey).push(product)
    }
    const skuKey = normalizeReviewText(product.sku)
    if (skuKey && !bySku.has(skuKey)) bySku.set(skuKey, product)
    const barcodeKey = normalizeReviewText(product.barcode)
    if (barcodeKey && !byBarcode.has(barcodeKey)) byBarcode.set(barcodeKey, product)
  }
  return { byName, bySku, byBarcode }
}

function getProductConflictForReview(row = {}, index, importState = null) {
  const normalized = normalizeRowForProduct(row)
  const store = index || buildProductReviewIndex()
  const sameName = store.byName.get(normalizeReviewText(normalized.name)) || []
  const skuConflict = normalized.sku ? store.bySku.get(normalizeReviewText(normalized.sku)) || null : null
  const barcodeConflict = normalized.barcode ? store.byBarcode.get(normalizeReviewText(normalized.barcode)) || null : null
  const fields = []
  if (skuConflict) fields.push('sku')
  if (barcodeConflict && (!skuConflict || barcodeConflict.id !== skuConflict.id || barcodeConflict.barcode === normalized.barcode)) fields.push('barcode')
  const issueTypes = []
  const nameRows = normalized.name && importState?.byName?.get(normalizeReviewIdentifier(normalized.name)) || []
  const barcodeRows = normalized.barcode && importState?.byBarcode?.get(normalizeReviewIdentifier(normalized.barcode)) || []
  const skuRows = normalized.sku && importState?.bySku?.get(normalizeReviewIdentifier(normalized.sku)) || []
  const barcodeIssue = getBarcodeReviewIssue(normalized.barcode)
  if (!normalized.name) issueTypes.push('missing_name')
  if (barcodeIssue) issueTypes.push(barcodeIssue)
  if (barcodeRows.length > 1) issueTypes.push('duplicate_barcode')
  if (skuRows.length > 1) issueTypes.push('duplicate_sku')
  if ((barcodeIssue || barcodeRows.length > 1) && !fields.includes('barcode')) fields.push('barcode')
  if (skuRows.length > 1 && !fields.includes('sku')) fields.push('sku')
  const matching = sameName.find((product) => normalizeProductSignature(product) === normalizeProductSignature(normalized)) || null
  const selectedParent = chooseParentProduct(sameName)
  const hasIdentifier = fields.length > 0
  const hasImportedSameName = nameRows.length > 1
  const hasSameNameConflict = sameName.length > 0 || hasImportedSameName
  const sameNameType = hasSameNameConflict
    ? (hasIdentifier
      ? 'same_name_identifier'
      : sameName.length
        ? (matching ? 'same_name_same_details' : 'same_name_different_details')
        : 'same_name_import')
    : ''
  const issueType = issueTypes[0] || ''
  const type = issueType || sameNameType || (hasIdentifier ? 'identifier' : 'new')
  const plannedAction = sameName.length
    ? (matching ? 'merge_stock' : 'create_variant')
    : hasImportedSameName
      ? 'create_variant'
    : 'new'
  const conflictTarget = skuConflict || barcodeConflict || matching || sameName[0] || null
  return {
    issue: issueTypes.length > 0 || hasIdentifier,
    issueTypes,
    type,
    fields,
    labels: [
      sameName.length ? 'same name' : '',
      !sameName.length && hasImportedSameName ? 'same name in file' : '',
      fields.includes('sku') ? 'same sku' : '',
      fields.includes('barcode') ? 'same barcode' : '',
      issueTypes.includes('missing_name') ? 'missing name' : '',
      issueTypes.includes('invalid_barcode') ? 'invalid barcode' : '',
      issueTypes.includes('barcode_too_long') ? 'barcode too long' : '',
      issueTypes.includes('barcode_text') ? 'barcode text' : '',
      issueTypes.includes('barcode_scientific_notation') ? 'barcode looks scientific' : '',
      issueTypes.includes('duplicate_barcode') ? 'duplicate barcode in file' : '',
      issueTypes.includes('duplicate_sku') ? 'duplicate sku in file' : '',
      !matching && hasSameNameConflict ? 'different details' : '',
    ].filter(Boolean),
    plannedAction,
    target_product_id: matching?.id || conflictTarget?.id || null,
    parent_id: plannedAction === 'create_variant' ? (selectedParent?.parent_id || selectedParent?.id || null) : null,
    existing: conflictTarget ? {
      id: conflictTarget.id,
      name: conflictTarget.name,
      sku: conflictTarget.sku,
      barcode: conflictTarget.barcode,
      parent_id: conflictTarget.parent_id || null,
    } : null,
    importConflict: {
      nameRows,
      barcodeRows,
      skuRows,
      duplicateNameGroup: nameRows.length > 1,
      duplicateBarcodeGroup: barcodeRows.length > 1,
      duplicateSkuGroup: skuRows.length > 1,
      barcodeIssue,
      branchDefaulted: !normalizeText(row.branch),
    },
    decisionDefaults: {
      _action: plannedAction,
      _identifier_conflict_mode: hasIdentifier ? 'clear_imported' : '',
      _target_product_id: matching?.id || '',
      _parent_id: plannedAction === 'create_variant' ? (selectedParent?.parent_id || selectedParent?.id || '') : '',
    },
  }
}

function getReviewRowNumber(row = {}, fallback = null) {
  const value = Number(row?._rowNumber || fallback || 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

function summarizeImportReviewRow(row = {}, conflict = {}) {
  return {
    rowNumber: getReviewRowNumber(row),
    name: normalizeText(row.name),
    sku: normalizeText(row.sku),
    barcode: normalizeText(row.barcode),
    brand: normalizeText(row.brand),
    category: normalizeText(row.category),
    unit: normalizeText(row.unit),
    supplier: normalizeText(row.supplier),
    branch: normalizeText(row.branch),
    stock_quantity: row.stock_quantity ?? '',
    selling_price_usd: row.selling_price_usd ?? '',
    purchase_price_usd: row.purchase_price_usd ?? row.cost_price_usd ?? '',
    plannedAction: conflict.plannedAction || row._action || row._planned_action || '',
    fields: conflict.fields || [],
    issueTypes: conflict.issueTypes || [],
  }
}

function addProductReviewGroup(groupsByName, row = {}, conflict = {}) {
  const nameKey = normalizeReviewIdentifier(row.name)
  if (!nameKey) return
  if (!groupsByName.has(nameKey)) {
    groupsByName.set(nameKey, {
      key: nameKey,
      title: normalizeText(row.name),
      rowNumbers: [],
      rows: [],
      fields: new Set(),
      issueTypes: new Set(['same_name']),
      subgroupsBySignature: new Map(),
      existingMatches: new Map(),
    })
  }
  const group = groupsByName.get(nameKey)
  const rowNumber = getReviewRowNumber(row)
  let signature = ''
  try {
    signature = normalizeProductSignature(normalizeRowForProduct(row))
  } catch (_) {
    signature = `row-error:${rowNumber || group.rows.length}`
  }
  if (rowNumber) group.rowNumbers.push(rowNumber)
  ;(conflict.fields || []).forEach((field) => group.fields.add(field))
  ;(conflict.issueTypes || []).forEach((issueType) => group.issueTypes.add(issueType))
  if (conflict.existing?.id) group.existingMatches.set(Number(conflict.existing.id), conflict.existing)
  group.rows.push(summarizeImportReviewRow(row, conflict))
  if (!group.subgroupsBySignature.has(signature)) {
    group.subgroupsBySignature.set(signature, {
      signature,
      rowNumbers: [],
      rows: [],
      fields: new Set(),
      issueTypes: new Set(),
    })
  }
  const subgroup = group.subgroupsBySignature.get(signature)
  if (rowNumber) subgroup.rowNumbers.push(rowNumber)
  ;(conflict.fields || []).forEach((field) => subgroup.fields.add(field))
  ;(conflict.issueTypes || []).forEach((issueType) => subgroup.issueTypes.add(issueType))
  subgroup.rows.push(summarizeImportReviewRow(row, conflict))
}

function finalizeProductReviewGroups(groupsByName) {
  return Array.from(groupsByName.values())
    .filter((group) => group.rowNumbers.length > 1)
    .map((group) => {
      const subgroups = Array.from(group.subgroupsBySignature.values())
        .sort((left, right) => Math.min(...left.rowNumbers) - Math.min(...right.rowNumbers))
        .map((subgroup, index, all) => ({
          signature: subgroup.signature,
          rowNumbers: subgroup.rowNumbers,
          fields: Array.from(subgroup.fields),
          issueTypes: Array.from(subgroup.issueTypes),
          suggestedAction: subgroup.rowNumbers.length > 1
            ? 'merge_stock'
            : all.length > 1 || index > 0
              ? 'create_variant'
              : 'new',
          rows: subgroup.rows,
        }))
      return {
        key: group.key,
        groupId: `name:${group.key}`,
        title: group.title,
        issueTypes: Array.from(group.issueTypes),
        fields: Array.from(group.fields),
        rowNumbers: group.rowNumbers,
        rows: group.rows,
        subgroups,
        suggestedAction: subgroups.length > 1 ? 'create_variant' : 'merge_stock',
        existing: Array.from(group.existingMatches.values()),
      }
    })
    .sort((left, right) => Math.min(...left.rowNumbers) - Math.min(...right.rowNumbers))
}

function buildContactReviewIndex(type) {
  const table = type === 'suppliers' ? 'suppliers' : type === 'delivery_contacts' ? 'delivery_contacts' : 'customers'
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all()
  const byName = new Map()
  const byPhone = new Map()
  const byEmail = new Map()
  const byMembership = new Map()
  for (const row of rows) {
    const nameKey = normalizeReviewText(row.name)
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, row)
    const phoneKey = normalizeReviewText(row.phone)
    if (phoneKey && !byPhone.has(phoneKey)) byPhone.set(phoneKey, row)
    const emailKey = normalizeReviewText(row.email)
    if (emailKey && !byEmail.has(emailKey)) byEmail.set(emailKey, row)
    const membershipKey = normalizeReviewText(row.membership_number)
    if (membershipKey && !byMembership.has(membershipKey)) byMembership.set(membershipKey, row)
  }
  return { byName, byPhone, byEmail, byMembership }
}

function getContactConflictForReview(row = {}, type, index) {
  const store = index || buildContactReviewIndex(type)
  const contactState = buildImportedContactState(row, { mode: type === 'delivery_contacts' ? 'area' : 'address' })
  const incoming = {
    name: cleanText(contactState.primary.name || row.name),
    phone: cleanText(contactState.primary.phone || row.phone),
    email: cleanText(contactState.primary.email || row.email),
    membership_number: cleanText(row.membership_number),
  }
  const sameName = incoming.name ? store.byName.get(normalizeReviewText(incoming.name)) || null : null
  const samePhone = incoming.phone ? store.byPhone.get(normalizeReviewText(incoming.phone)) || null : null
  const sameEmail = incoming.email ? store.byEmail.get(normalizeReviewText(incoming.email)) || null : null
  const sameMembership = incoming.membership_number ? store.byMembership.get(normalizeReviewText(incoming.membership_number)) || null : null
  const fields = []
  if (sameMembership) fields.push('membership')
  if (samePhone) fields.push('phone')
  if (sameEmail) fields.push('email')
  const target = sameMembership || samePhone || sameEmail || sameName || null
  const sameNameDifferentContact = !!(sameName && (fields.length || normalizeReviewText(sameName.phone) !== normalizeReviewText(incoming.phone) || normalizeReviewText(sameName.email) !== normalizeReviewText(incoming.email)))
  const typeName = sameNameDifferentContact
    ? 'same_name_contact'
    : fields.length
      ? 'contact_identifier'
      : sameName
        ? 'same_name'
        : 'new'
  return {
    issue: !incoming.name && type !== 'delivery_contacts',
    type: typeName,
    fields,
    labels: [
      sameName ? 'same name' : '',
      sameMembership ? 'same membership' : '',
      samePhone ? 'same phone' : '',
      sameEmail ? 'same email' : '',
    ].filter(Boolean),
    plannedAction: target ? 'merge' : 'new',
    existing: target ? {
      id: target.id,
      name: target.name,
      phone: target.phone,
      email: target.email,
      membership_number: target.membership_number,
    } : null,
    decisionDefaults: {
      _conflict_mode: target ? 'merge' : 'new',
      _field_rules: '{}',
    },
  }
}

function getGenericImportConflictForReview(row = {}, type) {
  const issue = !Object.entries(row).some(([key, value]) => key !== '_rowNumber' && String(value || '').trim())
  return {
    issue,
    type: issue ? 'empty_row' : type || 'row',
    fields: [],
    labels: issue ? ['empty row'] : [],
    plannedAction: issue ? 'skip' : 'apply',
    existing: null,
    decisionDefaults: {},
  }
}

function applyImportDecisionToRow(row = {}, decisionsByRow = {}) {
  const rowNumber = String(row?._rowNumber || '')
  const zeroBased = String(Math.max(0, Number(row?._rowNumber || 2) - 2))
  const groupKey = normalizeReviewIdentifier(row?.name)
  const groupDecision = groupKey
    ? (decisionsByRow.__groups?.[groupKey] || decisionsByRow.__groups?.[`name:${groupKey}`] || null)
    : null
  const rowDecision = decisionsByRow[rowNumber] || decisionsByRow[zeroBased] || null
  const decision = groupDecision || rowDecision
  if (!decision || typeof decision !== 'object') return row
  const mergedDecision = groupDecision && rowDecision && typeof rowDecision === 'object'
    ? { ...groupDecision, ...rowDecision }
    : decision
  const next = { ...row }
  ;['_action', '_target_product_id', '_parent_id', '_identifier_conflict_mode', 'image_conflict_mode', '_conflict_mode'].forEach((key) => {
    if (mergedDecision[key] != null) next[key] = mergedDecision[key]
  })
  const fieldOverrides = mergedDecision.field_overrides || mergedDecision.overrides || mergedDecision.fields || null
  if (fieldOverrides && typeof fieldOverrides === 'object' && !Array.isArray(fieldOverrides)) {
    ;['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'description', 'supplier', 'branch'].forEach((key) => {
      if (fieldOverrides[key] != null) next[key] = fieldOverrides[key]
    })
  }
  if (mergedDecision.field_rules || mergedDecision._field_rules) {
    next._field_rules = typeof (mergedDecision.field_rules || mergedDecision._field_rules) === 'string'
      ? (mergedDecision.field_rules || mergedDecision._field_rules)
      : stringify(mergedDecision.field_rules || mergedDecision._field_rules)
  }
  const normalizedAction = normalizeLookup(mergedDecision.action || mergedDecision.import_action || mergedDecision._action || '')
  if (normalizedAction === 'create_variant') next._action = 'create_variant'
  if (normalizedAction === 'merge_stock' || normalizedAction === 'add_stock') next._action = 'merge_stock'
  if (normalizedAction === 'create_new' || normalizedAction === 'new') next._action = 'new'
  if (normalizedAction === 'skip_row' || normalizedAction === 'skip') next._action = 'skip_row'
  if (normalizedAction === 'link_variant') next._action = 'link_variant'

  const normalizedIdentifierDecision = normalizeLookup(
    mergedDecision.identifier_decision
    || mergedDecision.identifierDecision
    || mergedDecision.identifier_mode
    || mergedDecision._identifier_conflict_mode
    || '',
  )
  if (['allow_duplicate', 'allow_duplicates', 'keep_barcode', 'keep_sku', 'keep_same', 'same_barcode'].includes(normalizedIdentifierDecision)) {
    next._identifier_conflict_mode = 'allow_duplicate'
  }
  if (['clear', 'clear_imported', 'clear_barcode', 'clear_sku'].includes(normalizedIdentifierDecision)) {
    next._identifier_conflict_mode = 'clear_imported'
  }
  if (['fail', 'reject', 'error'].includes(normalizedIdentifierDecision)) {
    next._identifier_conflict_mode = 'fail'
  }

  const normalizedDecision = normalizeLookup(mergedDecision.decision || mergedDecision._decision || '')
  const decisionValue = normalizeText(mergedDecision.decision_value || mergedDecision.value || '')
  if (normalizedDecision === 'allow_duplicate') next._identifier_conflict_mode = 'allow_duplicate'
  if (normalizedDecision === 'keep_barcode') next._identifier_conflict_mode = next._identifier_conflict_mode || 'allow_duplicate'
  if (normalizedDecision === 'clear_barcode') next.barcode = ''
  if (normalizedDecision === 'change_barcode') next.barcode = decisionValue
  if (normalizedDecision === 'clear_sku') next.sku = ''
  if (normalizedDecision === 'change_sku') next.sku = decisionValue
  if (normalizedDecision === 'create_variant') next._action = 'create_variant'
  if (normalizedDecision === 'merge_stock') next._action = 'merge_stock'
  if (normalizedDecision === 'create_new' || normalizedDecision === 'new') next._action = 'new'
  if (normalizedDecision === 'keep') next._action = next._action || row._action || ''
  if (normalizedDecision === 'skip_row') next._action = 'skip_row'
  return next
}

function getImportDecisionMap(jobId) {
  const policy = getImportJob(jobId)?.policy || {}
  const decisions = policy.decisionsByRowNumber || policy.decisions_by_row_number || policy.decisions || {}
  const rows = decisions && typeof decisions === 'object' ? { ...decisions } : {}
  const groups = policy.groupDecisionsByKey || policy.group_decisions || {}
  if (groups && typeof groups === 'object') rows.__groups = groups
  return rows
}

async function getImportJobReview(jobId, { page = 1, pageSize = 50, filter = 'all', query = '' } = {}) {
  const job = getImportJob(jobId)
  if (!job) throw new Error('Import job not found')
  const csvFile = getJobFiles(jobId, 'csv')[0]
  if (!csvFile?.stored_path || !fs.existsSync(csvFile.stored_path)) {
    return { job, page: 1, pageSize: 50, total: 0, rows: [], counts: {} }
  }
  const normalizedFilter = normalizeReviewFilter(filter)
  const safePage = Math.max(1, Number(page || 1))
  const safePageSize = Math.max(10, Math.min(100, Number(pageSize || 50)))
  const offsetStart = (safePage - 1) * safePageSize
  const rows = []
  const counts = {
    total: 0,
    visible: 0,
    same_name: 0,
    identifier: 0,
    barcode: 0,
    sku: 0,
    membership: 0,
    phone: 0,
    email: 0,
    issues: 0,
    new: 0,
    missing_name: 0,
    invalid_barcode: 0,
    barcode_text: 0,
    barcode_scientific_notation: 0,
    barcode_too_long: 0,
    duplicate_barcode: 0,
    duplicate_sku: 0,
    malformed_number: 0,
    duplicate_name_groups: 0,
    duplicate_barcode_groups: 0,
    duplicate_sku_groups: 0,
  }
  const productIndex = job.type === 'products' ? buildProductReviewIndex() : null
  const productImportState = job.type === 'products' ? await buildProductImportReviewState(csvFile) : null
  if (productImportState) {
    counts.duplicate_name_groups = productImportState.duplicateNameGroups
    counts.duplicate_barcode_groups = productImportState.duplicateBarcodeGroups
    counts.duplicate_sku_groups = productImportState.duplicateSkuGroups
  }
  const contactIndex = ['customers', 'suppliers', 'delivery_contacts'].includes(job.type) ? buildContactReviewIndex(job.type) : null
  const decisionsByRow = getImportDecisionMap(jobId)
  const productGroupsByName = job.type === 'products' ? new Map() : null
  let matched = 0
  for await (const batchRows of parseCsvRowBatchesFromFile(csvFile.stored_path, { batchSize: Math.max(200, IMPORT_ROW_BATCH_SIZE) })) {
    for (const sourceRow of batchRows) {
      const row = applyImportDecisionToRow(sourceRow, decisionsByRow)
      let conflict
      try {
        conflict = job.type === 'products'
          ? getProductConflictForReview(row, productIndex, productImportState)
          : contactIndex
            ? getContactConflictForReview(row, job.type, contactIndex)
            : getGenericImportConflictForReview(row, job.type)
      } catch (error) {
        const numericIssue = /number|price|stock|quantity|negative|malformed|invalid/i.test(String(error?.message || ''))
        conflict = {
          issue: true,
          type: numericIssue ? 'malformed_number' : 'row_error',
          fields: ['errors'],
          labels: ['error'],
          issueTypes: [numericIssue ? 'malformed_number' : 'row_error'],
          plannedAction: 'skip',
          existing: null,
          decisionDefaults: {},
          error: error?.message || 'Unable to review row',
        }
      }
      counts.total += 1
      if (String(conflict.type || '').includes('same_name')) counts.same_name += 1
      if ((conflict.fields || []).some((field) => ['sku', 'barcode'].includes(field))) counts.identifier += 1
      ;['barcode', 'sku', 'membership', 'phone', 'email'].forEach((field) => {
        if ((conflict.fields || []).includes(field)) counts[field] += 1
      })
      if (conflict.issue) counts.issues += 1
      ;(conflict.issueTypes || []).forEach((issueType) => {
        if (Object.prototype.hasOwnProperty.call(counts, issueType)) counts[issueType] += 1
      })
      if (conflict.type === 'new') counts.new += 1
      if (productGroupsByName && normalizeReviewIdentifier(row.name)) {
        addProductReviewGroup(productGroupsByName, row, conflict)
      }
      if (!matchesReviewFilter(conflict, normalizedFilter)) continue
      if (!hasReviewQueryMatch(row, conflict, query)) continue
      matched += 1
      if (matched <= offsetStart) continue
      if (rows.length >= safePageSize) continue
      rows.push({
        rowNumber: row._rowNumber || null,
        row,
        conflict,
      })
    }
    await yieldImportWorker()
  }
  counts.visible = matched
  return {
    job: getImportJob(jobId),
    page: safePage,
    pageSize: safePageSize,
    total: matched,
    counts,
    groups: productGroupsByName ? finalizeProductReviewGroups(productGroupsByName) : [],
    rows,
  }
}

function updateImportJobDecisions(jobId, decisions = {}) {
  const job = getImportJob(jobId)
  if (!job) throw new Error('Import job not found')
  const policy = { ...(job.policy || {}) }
  const current = policy.decisionsByRowNumber && typeof policy.decisionsByRowNumber === 'object'
    ? policy.decisionsByRowNumber
    : {}
  const incoming = decisions && typeof decisions === 'object' ? decisions : {}
  const incomingRows = incoming.rows && typeof incoming.rows === 'object'
    ? incoming.rows
    : incoming.byRow && typeof incoming.byRow === 'object'
      ? incoming.byRow
      : incoming.decisions && typeof incoming.decisions === 'object'
        ? incoming.decisions
        : incoming.groups
          ? {}
          : incoming
  const incomingGroups = incoming.groups && typeof incoming.groups === 'object' ? incoming.groups : {}
  const currentGroups = policy.groupDecisionsByKey && typeof policy.groupDecisionsByKey === 'object'
    ? policy.groupDecisionsByKey
    : {}
  const normalizedGroups = {}
  Object.entries(incomingGroups).forEach(([key, value]) => {
    const normalizedKey = normalizeReviewIdentifier(String(key || '').replace(/^name:/i, ''))
    if (!normalizedKey || !value || typeof value !== 'object') return
    normalizedGroups[normalizedKey] = value
  })
  policy.decisionsByRowNumber = { ...current, ...incomingRows }
  policy.groupDecisionsByKey = { ...currentGroups, ...normalizedGroups }
  updateJob(jobId, { policy_json: stringify(policy) })
  return getImportJob(jobId)
}

function addJobFile(jobId, file = {}, kind = 'csv', relativePath = '') {
  const stats = fs.existsSync(file.path) ? fs.statSync(file.path) : null
  const result = db.prepare(`
    INSERT INTO import_job_files (
      job_id, kind, original_name, stored_path, relative_path, mime_type, byte_size,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stored', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
  const row = db.prepare('SELECT cancel_requested, status FROM import_jobs WHERE id = ?').get(jobId)
  if (!row) return true
  return !!row.cancel_requested || String(row.status || '').toLowerCase() === 'cancelled'
}

async function waitForQueuedImportMedia(jobId) {
  let lastPending = -1
  const startedAt = Date.now()
  while (!isCancelled(jobId)) {
    const pending = db.prepare(`
      SELECT COUNT(*) AS count
      FROM import_job_files
      WHERE job_id = ? AND status = 'queued_media'
    `).get(jobId)?.count || 0
    if (!pending) return
    if (pending !== lastPending) {
      lastPending = pending
      updateJob(jobId, {
        phase: 'processing_media',
        summary_json: stringify({
          ...(getImportJob(jobId)?.summary || {}),
          pending_media: pending,
        }),
      })
    }
    if (Date.now() - startedAt > IMPORT_MEDIA_WAIT_TIMEOUT_MS) {
      throw new Error('Timed out waiting for queued media optimization. Check that the media worker is running, then retry failed images.')
    }
    await wait(1000)
  }
}

function finalizeSkippedImportImages(jobId) {
  const result = db.prepare(`
    UPDATE import_job_files
    SET status = 'skipped', error_message = COALESCE(error_message, 'Image was uploaded but not referenced by the applied import rows.'), updated_at = CURRENT_TIMESTAMP
    WHERE job_id = ? AND kind = 'image' AND status = 'stored'
  `).run(jobId)
  const skipped = Number(result.changes || 0)
  if (skipped > 0) {
    db.prepare(`
      UPDATE import_jobs
      SET processed_images = processed_images + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(skipped, jobId)
  }
  return skipped
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
    db.prepare("UPDATE products SET image_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(productId)
    return []
  }
  const insert = db.prepare('INSERT INTO product_images (product_id, image_path, sort_order) VALUES (?, ?, ?)')
  normalized.forEach((imagePath, index) => insert.run(productId, imagePath, index))
  db.prepare("UPDATE products SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(normalized[0], productId)
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
  db.prepare("UPDATE products SET is_group = 1, parent_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(parent.id)
  return parent
}

function assertUniqueProductFields({
  name,
  sku,
  barcode,
  excludeId = null,
  allowDuplicateName = false,
  allowDuplicateSku = false,
  allowDuplicateBarcode = false,
}) {
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
  if (!allowDuplicateSku && (sku || '') && conflict.sku === sku) throw new Error(`Duplicate SKU "${sku}" is not allowed`)
  if (!allowDuplicateBarcode && (barcode || '') && conflict.barcode === barcode) throw new Error(`Duplicate barcode "${barcode}" is not allowed`)
  if (!allowDuplicateName) throw new Error(`Duplicate product name "${trimmedName}" is not allowed`)
}

function findProductIdentifierConflict({ sku, barcode, excludeId = null }) {
  const normalizedSku = normalizeText(sku)
  const normalizedBarcode = normalizeText(barcode)
  if (!normalizedSku && !normalizedBarcode) return null
  return db.prepare(`
    SELECT id, name, sku, barcode
    FROM products
    WHERE (
      (? IS NOT NULL AND ? != '' AND sku = ?)
      OR (? IS NOT NULL AND ? != '' AND barcode = ?)
    )
    AND (? IS NULL OR id != ?)
    ORDER BY id ASC
    LIMIT 1
  `).get(
    normalizedSku || null, normalizedSku || '', normalizedSku || null,
    normalizedBarcode || null, normalizedBarcode || '', normalizedBarcode || null,
    excludeId, excludeId,
  ) || null
}

function normalizeIdentifierConflictMode(value) {
  const mode = normalizeLookup(value)
  if (['allow_duplicate', 'allow_duplicates', 'allow_same', 'same'].includes(mode)) return 'allow_duplicate'
  if (['clear', 'clear_imported', 'remove', 'blank'].includes(mode)) return 'clear_imported'
  if (['fail', 'error', 'reject'].includes(mode)) return 'fail'
  return 'clear_imported'
}

function resolveNewProductIdentifiers(normalized, row = {}) {
  const mode = normalizeIdentifierConflictMode(row._identifier_conflict_mode || row.identifier_conflict_mode)
  const conflict = findProductIdentifierConflict({ sku: normalized.sku, barcode: normalized.barcode })
  if (!conflict) {
    return {
      sku: normalized.sku,
      barcode: normalized.barcode,
      allowDuplicateSku: false,
      allowDuplicateBarcode: false,
      conflict: null,
      mode,
    }
  }
  if (mode === 'fail') {
    if (normalized.sku && conflict.sku === normalized.sku) throw new Error(`Duplicate SKU "${normalized.sku}" is not allowed`)
    if (normalized.barcode && conflict.barcode === normalized.barcode) throw new Error(`Duplicate barcode "${normalized.barcode}" is not allowed`)
  }
  if (mode === 'allow_duplicate') {
    return {
      sku: normalized.sku,
      barcode: normalized.barcode,
      allowDuplicateSku: !!(normalized.sku && conflict.sku === normalized.sku),
      allowDuplicateBarcode: !!(normalized.barcode && conflict.barcode === normalized.barcode),
      conflict,
      mode,
    }
  }
  return {
    sku: normalized.sku && conflict.sku === normalized.sku ? null : normalized.sku,
    barcode: normalized.barcode && conflict.barcode === normalized.barcode ? null : normalized.barcode,
    allowDuplicateSku: false,
    allowDuplicateBarcode: false,
    conflict,
    mode,
  }
}

async function copyImageIntoAssets(sourcePath, originalName, actor = {}, { importJobId = null, importFileId = null } = {}) {
  const safeOriginal = sanitizeOriginalFileName(originalName || path.basename(sourcePath))
  const storedName = buildUniqueStoredName(safeOriginal)
  const destination = path.join(UPLOADS_PATH, storedName)
  fs.copyFileSync(sourcePath, destination)
  const file = { path: destination, mimetype: getMimeTypeFromName(storedName), originalname: safeOriginal }
  await validateUploadedPath(destination, file)
  const byteSize = fs.existsSync(destination) ? fs.statSync(destination).size : null
  const asset = await registerStoredAsset({
    storedName,
    originalName: safeOriginal,
    mimeType: file.mimetype,
    createdById: actor.userId || null,
    createdByName: actor.userName || null,
    source: 'bulk_import',
    optimization: {
      original_byte_size: byteSize,
      optimized_byte_size: byteSize,
      optimization_status: 'queued',
      optimization_note: 'Queued for media worker optimization',
      duration_seconds: null,
    },
  })
  if (importFileId) {
    db.prepare("UPDATE import_job_files SET status = 'queued_media', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(importFileId)
  }
  try {
    await enqueueMediaOptimization({ storedName, source: 'bulk_import', importJobId, importFileId })
  } catch (error) {
    console.warn(`[media-queue] Could not enqueue ${storedName}: ${error?.message || error}`)
    if (importFileId) {
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(error?.message || 'Media queue unavailable', importFileId)
    }
    throw error
  }
  return { publicPath: asset.public_path, mediaQueued: !!importFileId }
}

async function resolveImageGallery(row, imageLookup, actor, jobId, imageAssetCache = new Map()) {
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
    const cacheKey = file.id ? `file:${file.id}` : `path:${file.stored_path}`
    if (imageAssetCache.has(cacheKey)) {
      const cached = imageAssetCache.get(cacheKey)
      if (cached?.publicPath) gallery.push(cached.publicPath)
      continue
    }
    try {
      const copied = await copyImageIntoAssets(file.stored_path, file.original_name || file.relative_path, actor, { importJobId: jobId, importFileId: file.id })
      imageAssetCache.set(cacheKey, copied)
      gallery.push(copied.publicPath)
      if (!copied.mediaQueued) {
        db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(file.id)
        db.prepare(`
          UPDATE import_jobs
          SET processed_images = processed_images + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(jobId)
      }
    } catch (error) {
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(error?.message || 'Image processing failed', file.id)
      db.prepare(`
        UPDATE import_jobs
        SET failed_images = failed_images + 1, updated_at = CURRENT_TIMESTAMP
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
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
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
    importParentsByName: new Map(),
    importProductsBySignature: new Map(),
  }
}

function buildImportSignatureKey(nameKey, signature) {
  const safeName = String(nameKey || '').trim()
  const safeSignature = String(signature || '').trim()
  return safeName && safeSignature ? `${safeName}::${safeSignature}` : ''
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
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(productId, productId)
}

function insertInventoryMovement({ productId, productName, branch, movementType, qty, buyUsd, buyKhr, reason, actor, referenceId = null }) {
  if (!(qty > 0)) return
  const safeReferenceId = Number.isFinite(Number(referenceId)) && Number(referenceId) > 0
    ? Number(referenceId)
    : null
  db.prepare(`
    INSERT INTO inventory_movements
      (product_id, product_name, branch_id, branch_name, movement_type, quantity,
       unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    safeReferenceId,
    actor.userId || null,
    actor.userName || null,
  )
}

function seedBranchRows(productId, ctx) {
  const insert = db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, 0)')
  if (ctx.defaultBranch?.id) {
    insert.run(productId, ctx.defaultBranch.id)
  }
}

async function processProductRow({ row, imageLookup, actor, ctx, jobId, imageAssetCache }) {
  if (normalizeLookup(row._action || row.decision || row._decision) === 'skip_row') {
    return { imported: 0, updated: 0, skipped: 1 }
  }
  const normalized = normalizeRowForProduct(row)
  if (!normalized.name) throw new Error('Product name required')
  const barcodeIssue = getBarcodeReviewIssue(normalized.barcode)
  if (isBlockingBarcodeIssue(barcodeIssue)) {
    throw new Error(`Invalid barcode "${normalized.barcode}". Clear it or change it in import review.`)
  }
  normalized.category = ensureCategory(ctx, normalized.category)
  normalized.unit = ensureUnit(ctx, normalized.unit)
  normalized.brand = ensureBrand(ctx, normalized.brand)
  normalized.supplier = ensureSupplier(ctx, normalized.supplier)

  const incomingGallery = await resolveImageGallery(row, imageLookup, actor, jobId, imageAssetCache)
  const sameName = db.prepare(`
    SELECT *
    FROM products
    WHERE lower(trim(name)) = lower(trim(?))
    ORDER BY is_group DESC, parent_id ASC, created_at ASC, id ASC
  `).all(normalized.name)
  const nameKey = normalizeLookup(normalized.name)
  const importedParent = nameKey ? ctx.importParentsByName.get(nameKey) || null : null
  const signature = normalizeProductSignature(normalized)
  const importedSignatureMatch = ctx.importProductsBySignature.get(buildImportSignatureKey(nameKey, signature)) || null
  const candidateParents = importedParent
    ? [...sameName, importedParent]
    : sameName
  const matching = sameName.find((product) => normalizeProductSignature(product) === signature) || importedSignatureMatch || null
  const selectedParent = chooseParentProduct(candidateParents)

  let importActionLabel = normalizeLookup(row._action || '')
  if (!importActionLabel || importActionLabel === 'ask') {
    if (matching) {
      importActionLabel = sameName.length > 1 ? 'link_variant' : 'merge_stock'
      row._target_product_id = matching.id
    } else if (sameName.length || importedParent) {
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
  const wantsVariantParent = ['create_variant', 'link_variant'].includes(importActionLabel)
  const parentId = wantsVariantParent
    ? (plannedParentId || explicitParentId || selectedParent?.parent_id || selectedParent?.id || null)
    : explicitParentId
  const imageConflictMode = normalizeImageConflictMode(row._image_action || row.image_conflict_mode, action, incomingGallery.length > 0)

  return db.transaction(() => {
    if (action === 'new') {
      const parentRecord = ensureParentProductExists(parentId || null)
      const normalizedParentId = parentRecord?.id || null
      const identifiers = resolveNewProductIdentifiers(normalized, row)
      assertUniqueProductFields({
        name: normalized.name,
        sku: identifiers.sku,
        barcode: identifiers.barcode,
        allowDuplicateName: true,
        allowDuplicateSku: identifiers.allowDuplicateSku,
        allowDuplicateBarcode: identifiers.allowDuplicateBarcode,
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
        identifiers.sku,
        identifiers.barcode,
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
      const insertedRecord = {
        ...normalized,
        id: productId,
        is_group: normalizedParentId ? 0 : normalized.is_group,
        parent_id: normalizedParentId,
        created_at: nowIso(),
      }
      const signatureKey = buildImportSignatureKey(nameKey, signature)
      if (signatureKey) ctx.importProductsBySignature.set(signatureKey, insertedRecord)
      syncProductImageGallery(productId, incomingGallery)
      if (normalizedParentId) {
        ctx.importParentsByName.set(nameKey, ctx.importParentsByName.get(nameKey) || {
          ...normalized,
          id: normalizedParentId,
          is_group: 1,
          parent_id: null,
          created_at: nowIso(),
        })
      } else if (nameKey && !ctx.importParentsByName.has(nameKey)) {
        ctx.importParentsByName.set(nameKey, {
          ...insertedRecord,
          is_group: importActionLabel === 'create_variant' ? 1 : normalized.is_group,
          parent_id: null,
        })
        if (importActionLabel === 'create_variant') {
          db.prepare("UPDATE products SET is_group = 1, parent_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(productId)
        }
      }
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
        referenceId: jobId,
      })
      return { imported: 1, updated: 0, variant: normalizedParentId ? 1 : 0 }
    }

    const existing = plannedTargetId
      ? db.prepare('SELECT * FROM products WHERE id = ?').get(plannedTargetId)
      : (matching || db.prepare("SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) OR (sku IS NOT NULL AND sku = ?) OR (barcode IS NOT NULL AND barcode = ?)").get(normalized.name, normalized.sku || '__NOSKUMATCH__', normalized.barcode || '__NOBARCODEMATCH__'))
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

    const resolvedParentCandidate = Number(resolved.parent_id || 0) === Number(existing.id || 0)
      ? (existing.parent_id || null)
      : (resolved.parent_id || null)
    const parentRecord = ensureParentProductExists(resolvedParentCandidate, { childId: existing.id })
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
        low_stock_threshold = ?, is_group = ?, parent_id = ?, updated_at = CURRENT_TIMESTAMP
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
        referenceId: jobId,
      })
    }
    return { imported: 0, updated: 1, merged: action === 'merge' ? 1 : 0 }
  })()
}

async function processProductRowBatches({ jobId, rowBatches, totalRows = null, imageLookup, actor }) {
  const ctx = createProductContext()
  const imageAssetCache = new Map()
  const decisionsByRow = getImportDecisionMap(jobId)
  let imported = 0
  let updated = 0
  let failed = 0
  let skipped = 0
  let variants = 0
  let merged = 0
  let pendingProgressRows = 0

  const flushProgress = () => {
    if (!pendingProgressRows) return
    db.prepare(`
      UPDATE import_jobs
      SET processed_rows = processed_rows + ?,
          failed_rows = ?,
          summary_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(pendingProgressRows, failed, stringify({
      imported,
      updated,
      merged,
      variants,
      skipped,
      failed,
      applied_rows: imported + updated + skipped + failed,
      accounted: imported + updated + skipped + failed,
    }), jobId)
    pendingProgressRows = 0
  }

  for await (const batch of rowBatches) {
    if (isCancelled(jobId)) {
      flushProgress()
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported, updated, merged, variants, skipped, failed, cancelled: true }
    }
    const batchRows = Array.isArray(batch?.rows) ? batch.rows : []
    const offset = Number(batch?.startIndex || 0)
    const batchIndex = Number(batch?.batchIndex || Math.floor(offset / IMPORT_ROW_BATCH_SIZE))
    const batchResult = db.prepare(`
      INSERT INTO import_job_batches (job_id, batch_index, start_row, end_row, status, attempts, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id, batch_index) DO UPDATE SET
        status = 'running',
        attempts = attempts + 1,
        started_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run(jobId, batchIndex, offset + 1, offset + batchRows.length)
    const batchId = batchResult.lastInsertRowid || db.prepare('SELECT id FROM import_job_batches WHERE job_id = ? AND batch_index = ?').get(jobId, batchIndex)?.id
    for (const sourceRow of batchRows) {
      const row = applyImportDecisionToRow(sourceRow, decisionsByRow)
      if (isCancelled(jobId)) {
        flushProgress()
        updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
        return { imported, updated, merged, variants, skipped, failed, cancelled: true }
      }
      try {
        const result = await processProductRow({ row, imageLookup, actor, ctx, jobId, imageAssetCache })
        imported += result.imported || 0
        updated += result.updated || 0
        skipped += result.skipped || 0
        variants += result.variant || 0
        merged += result.merged || 0
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
      pendingProgressRows += 1
      if (pendingProgressRows >= 25) flushProgress()
    }
    flushProgress()
    db.prepare("UPDATE import_job_batches SET status = 'completed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(batchId)
    if (totalRows) {
      updateJob(jobId, {
        processed_rows: Math.min(totalRows, offset + batchRows.length),
        failed_rows: failed,
        summary_json: stringify({
          imported,
          updated,
          merged,
          variants,
          skipped,
          failed,
          applied_rows: imported + updated + skipped + failed,
          accounted: imported + updated + skipped + failed,
        }),
      })
    }
    await yieldImportWorker()
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
  return { imported, updated, merged, variants, skipped, failed, cancelled: false }
}

async function processProductRows({ jobId, rows, imageLookup, actor }) {
  return processProductRowBatches({
    jobId,
    rowBatches: rowBatchesFromArray(rows),
    totalRows: Array.isArray(rows) ? rows.length : null,
    imageLookup,
    actor,
  })
}

async function preflightImportJob(jobId) {
  const job = getImportJob(jobId)
  if (!job) throw new Error('Import job not found')
  const csvFile = getJobFiles(jobId, 'csv')[0]
  if (!csvFile?.stored_path || !fs.existsSync(csvFile.stored_path)) {
    throw new Error('CSV file is required before preflight')
  }
  const decisionsByRow = getImportDecisionMap(jobId)
  const failures = []
  const warnings = []
  const simulatedSignaturesByName = new Map()
  const simulatedFamilyByName = new Set()
  let checkedRows = 0

  const addFailure = (row, message, code = 'preflight_failed') => {
    failures.push({
      rowNumber: getReviewRowNumber(row),
      code,
      name: normalizeText(row?.name),
      message,
    })
  }

  if (job.type !== 'products') {
    return { ok: true, job, checkedRows: 0, failures, warnings, groups: [] }
  }

  const productIndex = buildProductReviewIndex()
  const productImportState = await buildProductImportReviewState(csvFile)
  const groupsByName = new Map()
  for await (const batchRows of parseCsvRowBatchesFromFile(csvFile.stored_path, { batchSize: Math.max(200, IMPORT_ROW_BATCH_SIZE) })) {
    for (const sourceRow of batchRows) {
      const row = applyImportDecisionToRow(sourceRow, decisionsByRow)
      checkedRows += 1
      const actionLabel = normalizeLookup(row._action || row.action || row.decision || row._decision || '')
      if (actionLabel === 'skip_row' || actionLabel === 'skip') continue
      let conflict = null
      let normalized = null
      try {
        normalized = normalizeRowForProduct(row)
        conflict = getProductConflictForReview(row, productIndex, productImportState)
        addProductReviewGroup(groupsByName, row, conflict)
      } catch (error) {
        addFailure(row, error?.message || 'Unable to preflight row')
        continue
      }
      if (!normalized.name) {
        addFailure(row, 'Product name required', 'missing_name')
        continue
      }
      const barcodeIssue = getBarcodeReviewIssue(normalized.barcode)
      if (isBlockingBarcodeIssue(barcodeIssue)) {
        addFailure(row, `Invalid barcode "${normalized.barcode}". Clear it or change it in import review.`, barcodeIssue)
        continue
      }
      if (barcodeIssue) {
        warnings.push({
          rowNumber: getReviewRowNumber(row),
          code: barcodeIssue,
          message: `Barcode "${normalized.barcode}" needs review but can be kept as text if you choose that decision.`,
        })
      }
      const nameKey = normalizeReviewIdentifier(normalized.name)
      const signature = normalizeProductSignature(normalized)
      const sameName = productIndex.byName.get(nameKey) || []
      const matchingExisting = sameName.find((product) => normalizeProductSignature(product) === signature) || null
      const knownSignatures = simulatedSignaturesByName.get(nameKey) || new Set()
      const normalizedAction = normalizeImportAction(actionLabel) || (conflict?.plannedAction ? normalizeImportAction(conflict.plannedAction) : 'new') || 'new'
      const wantsMerge = normalizedAction === 'merge'
      if (wantsMerge) {
        const targetId = parseOptionalImportId(row, '_target_product_id')
        if (!targetId && !matchingExisting && !knownSignatures.has(signature)) {
          addFailure(row, 'Merge/add stock needs an existing product or an earlier imported row with the same details.', 'merge_target_missing')
          continue
        }
      }
      const identifierConflict = findProductIdentifierConflict({ sku: normalized.sku, barcode: normalized.barcode })
      const identifierMode = normalizeIdentifierConflictMode(row._identifier_conflict_mode || row.identifier_conflict_mode)
      if (identifierConflict && identifierMode === 'fail') {
        addFailure(row, 'Duplicate barcode/SKU is set to reject. Choose keep, clear, or edit before applying.', 'identifier_rejected')
        continue
      }
      if (!simulatedSignaturesByName.has(nameKey)) simulatedSignaturesByName.set(nameKey, new Set())
      simulatedSignaturesByName.get(nameKey).add(signature)
      simulatedFamilyByName.add(nameKey)
    }
    await yieldImportWorker()
  }
  const groups = finalizeProductReviewGroups(groupsByName)
  return {
    ok: failures.length === 0,
    job: getImportJob(jobId),
    checkedRows,
    failures,
    warnings,
    groups,
    summary: {
      checkedRows,
      failures: failures.length,
      warnings: warnings.length,
      groups: groups.length,
      families: simulatedFamilyByName.size,
    },
  }
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
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run('No active product matched this image filename.', file.id)
      updateJob(jobId, { failed_images: failed })
      addJobError(jobId, {
        fileName: file.relative_path || file.original_name,
        code: 'image_no_match',
        message: `No product matched image "${file.relative_path || file.original_name}".`,
      })
      continue
    }
    try {
      const copied = await copyImageIntoAssets(file.stored_path, file.original_name || file.relative_path, actor, { importJobId: jobId, importFileId: file.id })
      const publicPath = copied.publicPath
      db.transaction(() => {
        const gallery = loadCurrentGallery(product.id, product.image_path)
        syncProductImageGallery(product.id, [...gallery, publicPath])
        if (!copied.mediaQueued) {
          db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(file.id)
          db.prepare(`
            UPDATE import_jobs
            SET processed_images = processed_images + 1,
                summary_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(stringify({ imported: 0, updated: 0, images_matched: imagesMatched + 1, failed }), jobId)
        }
      })()
      imagesMatched += 1
    } catch (error) {
      failed += 1
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(error?.message || 'Image processing failed', file.id)
      updateJob(jobId, { failed_images: failed })
      addJobError(jobId, {
        fileName: file.relative_path || file.original_name,
        code: 'image_failed',
        message: error?.message || 'Image processing failed',
      })
    }
    await yieldImportWorker()
  }
  return { imported: 0, updated: 0, images_matched: imagesMatched, failed, cancelled: false }
}

function normalizeContactMode(value) {
  const mode = String(value || 'merge').trim().toLowerCase()
  return ['skip', 'merge', 'overwrite'].includes(mode) ? mode : 'merge'
}

function resolveContactValue(existingValue, incomingValue, rule, defaultRule = 'merge_blank_only') {
  const mode = String(rule || defaultRule || '').trim().toLowerCase()
  if (mode === 'clear_value') return null
  if (mode === 'use_imported') return incomingValue ?? null
  if (mode === 'keep_existing') return existingValue ?? null
  return existingValue || incomingValue || null
}

function parseFieldRules(row = {}) {
  const raw = row._field_rules
  if (raw && typeof raw === 'object') return raw
  return safeJson(raw, {})
}

function generateCustomerMembershipNumber(row = {}) {
  const namePart = normalizeLookup(row?.name || 'customer').replace(/[^a-z0-9]+/g, '').slice(0, 4).toUpperCase() || 'CUS'
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = `${Date.now().toString(36)}${attempt.toString(36)}`.toUpperCase().slice(-7)
    const candidate = `${namePart}-${suffix}`
    const exists = db.prepare('SELECT id FROM customers WHERE lower(trim(membership_number)) = lower(trim(?)) LIMIT 1').get(candidate)
    if (!exists) return candidate
  }
  throw new Error('Could not generate a unique membership number')
}

async function processContactRowBatches({ jobId, rowBatches, totalRows = null, actor, type }) {
  const isCustomer = type === 'customers'
  const isSupplier = type === 'suppliers'
  const table = isCustomer ? 'customers' : isSupplier ? 'suppliers' : 'delivery_contacts'
  const jobPolicy = getImportJob(jobId)?.policy || {}
  const decisionsByRow = getImportDecisionMap(jobId)
  const defaultConflictMode = normalizeContactMode(jobPolicy.conflictMode || jobPolicy.conflict_mode || 'merge')
  const policyFieldRules = jobPolicy.fieldRules || jobPolicy.field_rules || {}
  let imported = 0
  let updated = 0
  let failed = 0

  const findCustomerByMembership = db.prepare('SELECT * FROM customers WHERE lower(trim(membership_number)) = lower(trim(?)) LIMIT 1')
  const findCustomerByPhone = db.prepare("SELECT * FROM customers WHERE trim(coalesce(phone,'')) != '' AND trim(phone) = trim(?) LIMIT 1")
  const findCustomerByName = db.prepare('SELECT * FROM customers WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1')
  const findSupplierByName = db.prepare('SELECT * FROM suppliers WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1')
  const findSupplierByPhone = db.prepare("SELECT * FROM suppliers WHERE trim(coalesce(phone,'')) != '' AND trim(phone) = trim(?) LIMIT 1")
  const findDeliveryByName = db.prepare('SELECT * FROM delivery_contacts WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1')
  const findDeliveryByPhone = db.prepare("SELECT * FROM delivery_contacts WHERE trim(coalesce(phone,'')) != '' AND trim(phone) = trim(?) LIMIT 1")

  for await (const batch of rowBatches) {
    if (isCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported, updated, failed, cancelled: true }
    }
    const batchRows = Array.isArray(batch?.rows) ? batch.rows : []
    const offset = Number(batch?.startIndex || 0)
    const batchIndex = Number(batch?.batchIndex || Math.floor(offset / IMPORT_ROW_BATCH_SIZE))
    const batchResult = db.prepare(`
      INSERT INTO import_job_batches (job_id, batch_index, start_row, end_row, status, attempts, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id, batch_index) DO UPDATE SET
        status = 'running',
        attempts = attempts + 1,
        started_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run(jobId, batchIndex, offset + 1, offset + batchRows.length)
    const batchId = batchResult.lastInsertRowid || db.prepare('SELECT id FROM import_job_batches WHERE job_id = ? AND batch_index = ?').get(jobId, batchIndex)?.id

    db.transaction(() => {
      for (const sourceRow of batchRows) {
        const row = applyImportDecisionToRow(sourceRow, decisionsByRow)
        try {
          const mode = normalizeContactMode(row._conflict_mode || row.conflict_mode || defaultConflictMode)
          const fieldRules = { ...policyFieldRules, ...parseFieldRules(row) }
          const defaultRule = mode === 'overwrite' ? 'use_imported' : 'merge_blank_only'
          const contactState = buildImportedContactState(row, { mode: type === 'delivery_contacts' ? 'area' : 'address' })
          let incoming
          let existing = null

          if (isCustomer) {
            incoming = {
              name: cleanText(row.name),
              membership_number: cleanText(row.membership_number) || generateCustomerMembershipNumber(row),
              phone: cleanText(contactState.primary.phone || row.phone),
              email: cleanText(contactState.primary.email || row.email),
              address: contactState.serialized || cleanText(row.address),
              company: cleanText(row.company),
              notes: cleanText(row.notes),
            }
            if (!incoming.name) throw new Error('name is required')
            existing = findCustomerByMembership.get(incoming.membership_number)
              || (incoming.phone ? findCustomerByPhone.get(incoming.phone) : null)
              || findCustomerByName.get(incoming.name)
            if (!existing) {
              db.prepare('INSERT INTO customers (name, membership_number, phone, email, address, company, notes, updated_at) VALUES (?,?,?,?,?,?,?,\'now\')')
                .run(incoming.name, incoming.membership_number, incoming.phone, incoming.email, incoming.address, incoming.company, incoming.notes)
              imported += 1
            } else if (mode !== 'skip') {
              db.prepare('UPDATE customers SET name=?, membership_number=?, phone=?, email=?, address=?, company=?, notes=?, updated_at=\'now\' WHERE id=?')
                .run(
                  resolveContactValue(existing.name, incoming.name, fieldRules.name, defaultRule),
                  resolveContactValue(existing.membership_number, incoming.membership_number, fieldRules.membership_number, defaultRule),
                  resolveContactValue(existing.phone, incoming.phone, fieldRules.phone, defaultRule),
                  resolveContactValue(existing.email, incoming.email, fieldRules.email, defaultRule),
                  resolveContactValue(existing.address, incoming.address, fieldRules.address || fieldRules.contact_options, defaultRule),
                  resolveContactValue(existing.company, incoming.company, fieldRules.company, defaultRule),
                  resolveContactValue(existing.notes, incoming.notes, fieldRules.notes, defaultRule),
                  existing.id,
                )
              updated += 1
            }
          } else if (isSupplier) {
            incoming = {
              name: cleanText(row.name),
              phone: cleanText(contactState.primary.phone || row.phone),
              email: cleanText(contactState.primary.email || row.email),
              address: contactState.serialized || cleanText(row.address),
              company: cleanText(row.company),
              contact_person: cleanText(contactState.primary.name || row.contact_person),
              notes: cleanText(row.notes),
            }
            if (!incoming.name) throw new Error('name is required')
            existing = findSupplierByName.get(incoming.name) || (incoming.phone ? findSupplierByPhone.get(incoming.phone) : null)
            if (!existing) {
              db.prepare('INSERT INTO suppliers (name, phone, email, address, company, contact_person, notes, updated_at) VALUES (?,?,?,?,?,?,?,\'now\')')
                .run(incoming.name, incoming.phone, incoming.email, incoming.address, incoming.company, incoming.contact_person, incoming.notes)
              imported += 1
            } else if (mode !== 'skip') {
              db.prepare('UPDATE suppliers SET name=?, phone=?, email=?, address=?, company=?, contact_person=?, notes=?, updated_at=\'now\' WHERE id=?')
                .run(
                  resolveContactValue(existing.name, incoming.name, fieldRules.name, defaultRule),
                  resolveContactValue(existing.phone, incoming.phone, fieldRules.phone, defaultRule),
                  resolveContactValue(existing.email, incoming.email, fieldRules.email, defaultRule),
                  resolveContactValue(existing.address, incoming.address, fieldRules.address || fieldRules.contact_options, defaultRule),
                  resolveContactValue(existing.company, incoming.company, fieldRules.company, defaultRule),
                  resolveContactValue(existing.contact_person, incoming.contact_person, fieldRules.contact_person, defaultRule),
                  resolveContactValue(existing.notes, incoming.notes, fieldRules.notes, defaultRule),
                  existing.id,
                )
              updated += 1
            }
          } else {
            const rawName = cleanText(contactState.primary.name || row.name)
            const phone = cleanText(contactState.primary.phone || row.phone)
            const finalName = rawName || (phone ? `Driver ${phone}` : '')
            incoming = {
              name: finalName,
              phone,
              area: cleanText(contactState.primary.area || row.area),
              address: contactState.serialized || cleanText(row.address),
              notes: cleanText(row.notes),
            }
            if (!incoming.name && !incoming.phone) throw new Error('driver name or phone is required')
            existing = findDeliveryByName.get(incoming.name) || (incoming.phone ? findDeliveryByPhone.get(incoming.phone) : null)
            if (!existing) {
              db.prepare('INSERT INTO delivery_contacts (name, phone, area, address, notes, updated_at) VALUES (?,?,?,?,?,\'now\')')
                .run(incoming.name, incoming.phone, incoming.area, incoming.address, incoming.notes)
              imported += 1
            } else if (mode !== 'skip') {
              db.prepare('UPDATE delivery_contacts SET name=?, phone=?, area=?, address=?, notes=?, updated_at=\'now\' WHERE id=?')
                .run(
                  resolveContactValue(existing.name, incoming.name, fieldRules.name, defaultRule),
                  resolveContactValue(existing.phone, incoming.phone, fieldRules.phone, defaultRule),
                  resolveContactValue(existing.area, incoming.area, fieldRules.area, defaultRule),
                  resolveContactValue(existing.address, incoming.address, fieldRules.address || fieldRules.contact_options, defaultRule),
                  resolveContactValue(existing.notes, incoming.notes, fieldRules.notes, defaultRule),
                  existing.id,
                )
              updated += 1
            }
          }
        } catch (error) {
          failed += 1
          addJobError(jobId, {
            batchId,
            rowNumber: row?._rowNumber || null,
            code: 'row_failed',
            message: `${row?.name || table} row: ${error?.message || 'Import failed'}`,
            raw: row,
          })
        }
      }
    })()

    updateJob(jobId, {
      processed_rows: totalRows ? Math.min(totalRows, offset + batchRows.length) : offset + batchRows.length,
      failed_rows: failed,
      summary_json: stringify({ imported, updated, failed }),
    })
    db.prepare("UPDATE import_job_batches SET status = 'completed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(batchId)
    await yieldImportWorker()
  }

  audit(actor.userId, actor.userName, 'import_job_completed', 'import_job', null, { jobId, type, imported, updated, failed })
  broadcast(isCustomer ? 'customers' : isSupplier ? 'suppliers' : 'deliveryContacts')
  return { imported, updated, failed, cancelled: false }
}

async function processContactRows({ jobId, rows, actor, type }) {
  return processContactRowBatches({
    jobId,
    rowBatches: rowBatchesFromArray(rows),
    totalRows: Array.isArray(rows) ? rows.length : null,
    actor,
    type,
  })
}

function normalizeInventoryAction(value) {
  const action = normalizeCsvKey(value)
  if (['add', 'remove', 'set'].includes(action)) return action
  if (action === 'adjustment') return 'add'
  return 'add'
}

async function processInventoryRowBatches({ jobId, rowBatches, totalRows = null, actor }) {
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1').all()
  const branches = db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
  const defaultBranch = branches.find((branch) => branch.is_default) || branches[0] || null
  const decisionsByRow = getImportDecisionMap(jobId)
  const productMap = new Map()
  products.forEach((product) => {
    ;[product.sku, product.barcode, product.name, product.id].forEach((value) => {
      const key = normalizeCsvKey(value)
      if (key && !productMap.has(key)) productMap.set(key, product)
    })
  })
  const branchMap = new Map()
  branches.forEach((branch) => {
    ;[branch.name, branch.id].forEach((value) => {
      const key = normalizeCsvKey(value)
      if (key) branchMap.set(key, branch)
    })
  })

  let imported = 0
  let failed = 0
  for await (const batch of rowBatches) {
    if (isCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported, updated: 0, failed, cancelled: true }
    }
    const batchRows = Array.isArray(batch?.rows) ? batch.rows : []
    const offset = Number(batch?.startIndex || 0)
    db.transaction(() => {
      for (const sourceRow of batchRows) {
        const row = applyImportDecisionToRow(sourceRow, decisionsByRow)
        try {
          const product = productMap.get(normalizeCsvKey(row.sku))
            || productMap.get(normalizeCsvKey(row.barcode))
            || productMap.get(normalizeCsvKey(row.name))
          if (!product) throw new Error('product not found')
          const qty = parseImportNumber(row, 'quantity', 0)
          if (!(qty > 0)) throw new Error('quantity must be greater than 0')
          const action = normalizeInventoryAction(row.action || row.type || row.movement_type)
          const branchValue = normalizeCsvKey(row.branch || row.branch_id)
          const branch = branchValue ? branchMap.get(branchValue) : defaultBranch
          if (!branch) throw new Error('active branch required')
          db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, 0)').run(product.id, branch.id)
          if (action === 'set') {
            db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?').run(qty, product.id, branch.id)
          } else if (action === 'remove') {
            const currentQty = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(product.id, branch.id)?.quantity || 0
            if (qty > currentQty) throw new Error(`cannot remove ${qty}; only ${currentQty} available`)
            db.prepare('UPDATE branch_stock SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?').run(qty, product.id, branch.id)
          } else {
            db.prepare('UPDATE branch_stock SET quantity = quantity + ? WHERE product_id = ? AND branch_id = ?').run(qty, product.id, branch.id)
          }
          recalcProductStock(product.id)
          const unitCostUsd = normalizePriceValue(parseImportNumber(row, 'unit_cost_usd', product.purchase_price_usd || product.cost_price_usd || 0))
          const unitCostKhr = normalizePriceValue(parseImportNumber(row, 'unit_cost_khr', product.purchase_price_khr || product.cost_price_khr || 0))
          db.prepare(`
            INSERT INTO inventory_movements
              (product_id, product_name, branch_id, branch_name, movement_type, quantity,
               unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            product.id,
            product.name,
            branch.id,
            branch.name,
            action,
            qty,
            unitCostUsd,
            unitCostKhr,
            qty * unitCostUsd,
            qty * unitCostKhr,
            normalizeText(row.reason) || 'CSV import - inventory',
            Number(jobId) || null,
            actor.userId || null,
            actor.userName || null,
          )
          imported += 1
        } catch (error) {
          failed += 1
          addJobError(jobId, {
            rowNumber: row?._rowNumber || null,
            code: 'row_failed',
            message: `Inventory row: ${error?.message || 'Import failed'}`,
            raw: row,
          })
        }
      }
    })()
    updateJob(jobId, {
      processed_rows: totalRows ? Math.min(totalRows, offset + batchRows.length) : offset + batchRows.length,
      failed_rows: failed,
      summary_json: stringify({ imported, updated: 0, failed }),
    })
    await yieldImportWorker()
  }
  audit(actor.userId, actor.userName, 'import_job_completed', 'import_job', null, { jobId, type: 'inventory', imported, failed })
  broadcast('products')
  broadcast('inventory')
  return { imported, updated: 0, failed, cancelled: false }
}

async function processInventoryRows({ jobId, rows, actor }) {
  return processInventoryRowBatches({
    jobId,
    rowBatches: rowBatchesFromArray(rows),
    totalRows: Array.isArray(rows) ? rows.length : null,
    actor,
  })
}

async function processSalesRowBatches({ jobId, rowBatches, totalRows = null, actor }) {
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1').all()
  const branches = db.prepare('SELECT id, name, is_default FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
  const defaultBranch = branches.find((branch) => branch.is_default) || branches[0] || null
  const decisionsByRow = getImportDecisionMap(jobId)
  const productMap = new Map()
  products.forEach((product) => {
    ;[product.sku, product.barcode, product.name, product.id].forEach((value) => {
      const key = normalizeCsvKey(value)
      if (key && !productMap.has(key)) productMap.set(key, product)
    })
  })
  const branchMap = new Map()
  branches.forEach((branch) => {
    ;[branch.name, branch.id].forEach((value) => {
      const key = normalizeCsvKey(value)
      if (key) branchMap.set(key, branch)
    })
  })

  const grouped = new Map()
  let failed = 0
  let groupedRows = 0
  for await (const batch of rowBatches) {
    if (isCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported: 0, updated: 0, duplicates: 0, failed, cancelled: true }
    }
    const batchRows = Array.isArray(batch?.rows) ? batch.rows : []
    for (let index = 0; index < batchRows.length; index += 1) {
      const row = applyImportDecisionToRow(batchRows[index], decisionsByRow)
      const absoluteIndex = Number(batch?.startIndex || 0) + index
      try {
        const product = productMap.get(normalizeCsvKey(row.sku))
          || productMap.get(normalizeCsvKey(row.barcode))
          || productMap.get(normalizeCsvKey(row.name))
        if (!product) throw new Error(`Row ${row._rowNumber || absoluteIndex + 2}: product not found`)
        const qty = parseImportNumber(row, 'quantity', 0)
        if (!(qty > 0)) throw new Error(`Row ${row._rowNumber || absoluteIndex + 2}: quantity must be greater than 0`)
        const branchValue = normalizeCsvKey(row.branch || row.branch_id)
        const branch = branchValue ? branchMap.get(branchValue) : defaultBranch
        if (!branch) throw new Error(`Row ${row._rowNumber || absoluteIndex + 2}: active branch required`)
        const receiptNumber = normalizeText(row.receipt_number) || `IMP-SALE-${Date.now()}-${absoluteIndex + 1}`
        const sale = grouped.get(receiptNumber) || {
          receiptNumber,
          createdAt: normalizeText(row.sale_date || row.date || row.created_at) || null,
          status: normalizeText(row.sale_status) || 'completed',
          paymentMethod: normalizeText(row.payment_method) || 'Cash',
          paymentCurrency: normalizeText(row.payment_currency) || 'USD',
          customerName: normalizeText(row.customer_name) || null,
          customerPhone: normalizeText(row.customer_phone) || null,
          customerAddress: normalizeText(row.customer_address) || null,
          cashierName: normalizeText(row.cashier_name) || actor.userName || null,
          notes: normalizeText(row.notes) || null,
          branchId: branch.id,
          branchName: branch.name,
          items: [],
          subtotalUsd: 0,
          subtotalKhr: 0,
        }
        const priceUsd = normalizePriceValue(parseImportNumber(row, 'unit_price_usd', product.selling_price_usd || 0))
        const priceKhr = normalizePriceValue(parseImportNumber(row, 'unit_price_khr', product.selling_price_khr || 0))
        sale.items.push({
          product,
          branch,
          quantity: qty,
          applied_price_usd: priceUsd,
          applied_price_khr: priceKhr,
        })
        sale.subtotalUsd += priceUsd * qty
        sale.subtotalKhr += priceKhr * qty
        grouped.set(receiptNumber, sale)
      } catch (error) {
        failed += 1
        addJobError(jobId, {
          rowNumber: row?._rowNumber || null,
          code: 'row_failed',
          message: error?.message || 'Sales row failed',
          raw: row,
        })
      }
      groupedRows += 1
    }
    if (groupedRows % IMPORT_ROW_BATCH_SIZE === 0 || batchRows.length) {
      updateJob(jobId, {
        phase: 'grouping_sales',
        processed_rows: totalRows ? Math.min(totalRows, groupedRows) : groupedRows,
        failed_rows: failed,
        summary_json: stringify({ imported: 0, updated: 0, duplicates: 0, failed, grouped: grouped.size }),
      })
      await yieldImportWorker()
    }
  }

  let imported = 0
  let duplicates = 0
  let saleRowsApplied = 0
  for (const sale of grouped.values()) {
    if (isCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
      return { imported, updated: duplicates, failed, cancelled: true }
    }
    try {
      db.transaction(() => {
        const existing = db.prepare('SELECT id FROM sales WHERE receipt_number = ? LIMIT 1').get(sale.receiptNumber)
        if (existing) {
          duplicates += 1
          return
        }
        const saleId = db.prepare(`
          INSERT INTO sales (
            receipt_number, cashier_id, cashier_name, customer_name, customer_phone, customer_address,
            branch_id, branch_name, subtotal_usd, subtotal_khr, total_usd, total_khr,
            payment_method, payment_currency, amount_paid_usd, amount_paid_khr,
            sale_status, notes, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        `).run(
          sale.receiptNumber,
          actor.userId || null,
          sale.cashierName,
          sale.customerName,
          sale.customerPhone,
          sale.customerAddress,
          sale.branchId,
          sale.branchName,
          normalizePriceValue(sale.subtotalUsd),
          normalizePriceValue(sale.subtotalKhr),
          normalizePriceValue(sale.subtotalUsd),
          normalizePriceValue(sale.subtotalKhr),
          sale.paymentMethod,
          sale.paymentCurrency,
          normalizePriceValue(sale.subtotalUsd),
          normalizePriceValue(sale.subtotalKhr),
          sale.status,
          sale.notes,
          sale.createdAt,
        ).lastInsertRowid
        for (const item of sale.items) {
          const product = item.product
          const totalUsd = normalizePriceValue(item.applied_price_usd * item.quantity)
          const totalKhr = normalizePriceValue(item.applied_price_khr * item.quantity)
          db.prepare(`
            INSERT INTO sale_items
              (sale_id, product_id, product_name, sku, quantity, unit,
               applied_price_usd, applied_price_khr, price_mode,
               cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            saleId,
            product.id,
            product.name,
            product.sku || null,
            item.quantity,
            product.unit || null,
            item.applied_price_usd,
            item.applied_price_khr,
            'import',
            product.cost_price_usd || product.purchase_price_usd || 0,
            product.cost_price_khr || product.purchase_price_khr || 0,
            totalUsd,
            totalKhr,
            item.branch.id,
          )
          db.prepare('INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, 0)').run(product.id, item.branch.id)
          db.prepare('UPDATE branch_stock SET quantity = MAX(0, quantity - ?) WHERE product_id = ? AND branch_id = ?')
            .run(item.quantity, product.id, item.branch.id)
          recalcProductStock(product.id)
          db.prepare(`
            INSERT INTO inventory_movements
              (product_id, product_name, branch_id, branch_name, movement_type, quantity,
               unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            product.id,
            product.name,
            item.branch.id,
            item.branch.name,
            'sale',
            item.quantity,
            product.cost_price_usd || product.purchase_price_usd || 0,
            product.cost_price_khr || product.purchase_price_khr || 0,
            item.quantity * (product.cost_price_usd || product.purchase_price_usd || 0),
            item.quantity * (product.cost_price_khr || product.purchase_price_khr || 0),
            `CSV import - sale ${sale.receiptNumber}`,
            saleId,
            actor.userId || null,
            actor.userName || null,
          )
        }
        audit(actor.userId, actor.userName, 'create', 'sale', saleId, { receiptNumber: sale.receiptNumber, source: 'import_job' })
        imported += 1
      })()
      saleRowsApplied += sale.items.length
    } catch (error) {
      failed += 1
      addJobError(jobId, {
        code: 'sale_failed',
        message: `${sale.receiptNumber}: ${error?.message || 'Sale import failed'}`,
      })
    }
    updateJob(jobId, {
      phase: 'applying_rows',
      processed_rows: totalRows ? Math.min(totalRows, saleRowsApplied + failed) : saleRowsApplied + failed,
      failed_rows: failed,
      summary_json: stringify({ imported, updated: duplicates, duplicates, failed }),
    })
    await yieldImportWorker()
  }
  audit(actor.userId, actor.userName, 'import_job_completed', 'import_job', null, { jobId, type: 'sales', imported, duplicates, failed })
  broadcast('sales')
  broadcast('products')
  broadcast('inventory')
  return { imported, updated: duplicates, duplicates, failed, cancelled: false }
}

async function processSalesRows({ jobId, rows, actor }) {
  return processSalesRowBatches({
    jobId,
    rowBatches: rowBatchesFromArray(rows),
    totalRows: Array.isArray(rows) ? rows.length : null,
    actor,
  })
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

  db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(zipFile.id)
  return added
}

async function processImportJob(jobId, { mode = 'analyze' } = {}) {
  const job = getImportJob(jobId)
  if (!job) return { id: jobId, status: 'cancelled', phase: 'missing_or_reset' }
  const currentStatus = String(job.status || '').toLowerCase()
  const normalizedMode = normalizeQueueMode(mode)
  if (job.cancel_requested || currentStatus === 'cancelling' || currentStatus === 'cancelled') {
    updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
    return getImportJob(jobId)
  }
  if (currentStatus === 'running') return job
  if (normalizedMode === 'analyze' && ['awaiting_review', 'approved', 'completed', 'completed_with_errors'].includes(currentStatus)) {
    return job
  }
  if (normalizedMode === 'apply' && currentStatus === 'completed') return job
  updateJob(jobId, {
    status: 'running',
    phase: normalizedMode === 'apply' ? 'applying_rows' : 'analyzing',
    started_at: job.started_at || nowIso(),
    last_error: null,
  })
  const actor = { userId: job.created_by_id || null, userName: job.created_by_name || null }
  try {
    const csvFile = getJobFiles(jobId, 'csv')[0]
    if (!csvFile?.stored_path || !fs.existsSync(csvFile.stored_path)) throw new Error('CSV file is required before starting import')
    updateJob(jobId, { phase: normalizedMode === 'apply' ? 'preparing_files' : 'analyzing_files' })
    const zipFiles = getJobFiles(jobId, 'zip').filter((file) => file.status !== 'processed')
    for (const zipFile of zipFiles) {
      await extractZipImages(jobId, zipFile)
      await yieldImportWorker(2)
    }
    const imageFiles = getJobFiles(jobId, 'image')
    updateJob(jobId, { total_images: imageFiles.length, phase: normalizedMode === 'apply' ? 'reading_rows' : 'analyzing_rows' })

    if (normalizedMode !== 'apply') {
      const totalRows = await countCsvRowsFromFile(csvFile, jobId)
      const summary = {
        requiresApproval: true,
        analyzed: true,
        rows: totalRows,
        images: imageFiles.length,
        type: job.type,
        nextPhase: 'approved',
      }
      updateJob(jobId, {
        status: 'awaiting_review',
        phase: 'awaiting_review',
        total_rows: totalRows,
        processed_rows: 0,
        failed_rows: 0,
        total_images: imageFiles.length,
        summary_json: stringify(summary),
        cancel_requested: 0,
        finished_at: null,
      })
      audit(actor.userId, actor.userName, 'import_job_analyzed', 'import_job', null, { jobId, type: job.type, rows: totalRows, images: imageFiles.length })
      return getImportJob(jobId)
    }

    const totalRows = Number(job.total_rows || 0) || await countCsvRowsFromFile(csvFile, jobId)
    updateJob(jobId, {
      total_rows: totalRows,
      processed_rows: 0,
      failed_rows: 0,
      processed_images: 0,
      failed_images: 0,
      phase: totalRows ? 'applying_rows' : 'processing_images',
    })
    let result
    if (job.type === 'products') {
      result = totalRows
        ? await processProductRowBatches({
            jobId,
            rowBatches: rowBatchesFromFile(csvFile),
            totalRows,
            imageLookup: buildImageLookup(imageFiles),
            actor,
          })
        : await processImageOnlyFiles({ jobId, imageFiles, actor })
    } else if (['customers', 'suppliers', 'delivery_contacts'].includes(job.type)) {
      result = await processContactRowBatches({ jobId, rowBatches: rowBatchesFromFile(csvFile), totalRows, actor, type: job.type })
    } else if (job.type === 'inventory') {
      result = await processInventoryRowBatches({ jobId, rowBatches: rowBatchesFromFile(csvFile), totalRows, actor })
    } else if (job.type === 'sales') {
      result = await processSalesRowBatches({ jobId, rowBatches: rowBatchesFromFile(csvFile), totalRows, actor })
    } else {
      throw new Error(`Import type "${job.type}" is not implemented in the job pipeline yet`)
    }
    if (result.cancelled) return getImportJob(jobId)
    if (job.type === 'products') {
      await waitForQueuedImportMedia(jobId)
      if (isCancelled(jobId)) {
        updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finished_at: nowIso() })
        return getImportJob(jobId)
      }
      const skippedImages = finalizeSkippedImportImages(jobId)
      if (skippedImages > 0) {
        result = {
          ...result,
          skipped_images: skippedImages,
        }
      }
    }
    updateJob(jobId, { phase: 'finalizing' })
    await yieldImportWorker(3)
    const finalJob = getImportJob(jobId)
    const failedRows = totalRows ? Number(result.failed || 0) : 0
    const failedImages = Number(finalJob?.failed_images || 0)
    const hasFailures = failedRows > 0 || failedImages > 0
    updateJob(jobId, {
      status: hasFailures ? 'completed_with_errors' : 'completed',
      phase: 'completed',
      failed_rows: failedRows,
      failed_images: failedImages,
      summary_json: stringify(result),
      finished_at: nowIso(),
      cancel_requested: 0,
    })
    audit(actor.userId, actor.userName, 'import_job_completed', 'import_job', null, { jobId, type: job.type, ...result })
    if (job.type === 'products') {
      broadcast('products')
      broadcast('inventory')
    }
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

async function runLocalJob(jobId, mode = 'analyze') {
  const key = `${jobId}:${mode}`
  if (runningLocalJobs.has(key)) return
  runningLocalJobs.add(key)
  try { await processImportJob(jobId, { mode }) } finally { runningLocalJobs.delete(key) }
}

function normalizeQueueMode(mode = 'analyze') {
  return mode === 'apply' ? 'apply' : 'analyze'
}

function queueNameForMode(mode = 'analyze') {
  return normalizeQueueMode(mode) === 'apply' ? IMPORT_APPLY_QUEUE_NAME : IMPORT_ANALYZE_QUEUE_NAME
}

function configuredQueueDriver() {
  if (JOB_QUEUE_DRIVER === 'bullmq') return 'bullmq'
  return 'bullmq'
}

function getImportQueueConcurrency() {
  return IMPORT_QUEUE_CONCURRENCY
}

function hasBullProducer() {
  return !!(bullQueues.analyze && bullQueues.apply)
}

function hasBullWorkers() {
  return !!(bullWorkers.analyze || bullWorkers.apply)
}

async function removeQueuedBullJobsForImport(jobId) {
  const removed = []
  if (!jobId) return removed
  const status = await initializeBullQueue()
  if (!status.available || !hasBullProducer()) return removed
  const states = ['waiting', 'delayed', 'prioritized', 'paused']
  for (const mode of ['analyze', 'apply']) {
    const queue = bullQueues[mode]
    if (!queue) continue
    try {
      const jobs = await queue.getJobs(states, 0, 500, true)
      for (const queuedJob of jobs) {
        if (String(queuedJob?.data?.jobId || '') !== String(jobId)) continue
        await queuedJob.remove()
        removed.push({ mode, id: queuedJob.id })
      }
    } catch (error) {
      console.warn(`[import-jobs] Could not remove queued ${mode} job for ${jobId}: ${error?.message || error}`)
    }
  }
  return removed
}

async function getBullConnection() {
  if (bullConnection) return bullConnection
  const IORedis = require('ioredis')
  bullConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  })
  await bullConnection.connect()
  await bullConnection.ping()
  return bullConnection
}

async function initializeBullQueue() {
  if (hasBullProducer()) return bullStatus
  try {
    const { Queue } = require('bullmq')
    const connection = await getBullConnection()
    bullQueues.analyze = bullQueues.analyze || new Queue(IMPORT_ANALYZE_QUEUE_NAME, { connection })
    bullQueues.apply = bullQueues.apply || new Queue(IMPORT_APPLY_QUEUE_NAME, { connection })
    bullStatus = { driver: 'bullmq', available: true, reason: 'producer_ready', producerReady: true, workerActive: hasBullWorkers() }
  } catch (error) {
    bullConnection = null
    bullQueues = { analyze: null, apply: null }
    bullStatus = { driver: 'bullmq', available: false, reason: error?.message || 'Redis unavailable', producerReady: false, workerActive: hasBullWorkers() }
    if (JOB_QUEUE_DRIVER === 'bullmq') {
      console.warn(`[import-jobs] BullMQ unavailable: ${bullStatus.reason}`)
    }
  }
  return bullStatus
}

async function startImportWorkers({ concurrency = getImportQueueConcurrency() } = {}) {
  const status = await initializeBullQueue()
  if (!status.available || !hasBullProducer()) {
    throw new Error(`Import queue is unavailable: ${status.reason || 'Redis/BullMQ unavailable'}`)
  }
  const { Worker } = require('bullmq')
  const connection = await getBullConnection()
  const startWorker = (mode) => {
    if (bullWorkers[mode]) return bullWorkers[mode]
    const worker = new Worker(queueNameForMode(mode), async (job) => {
      const jobId = job?.data?.jobId
      if (!jobId) throw new Error('Import worker received a job without jobId')
      await processImportJob(jobId, { mode })
    }, {
      connection,
      concurrency,
      autorun: true,
    })
    worker.on('failed', (job, error) => {
      const jobId = job?.data?.jobId
      if (jobId) {
        updateJob(jobId, {
          status: 'failed',
          phase: 'worker_failed',
          last_error: error?.message || 'Import worker failed',
          finished_at: nowIso(),
        })
        addJobError(jobId, { code: 'worker_failed', message: error?.message || 'Import worker failed' })
      }
      console.warn(`[import-worker] ${mode} job failed: ${error?.message || error}`)
    })
    worker.on('error', (error) => {
      console.warn(`[import-worker] ${mode} worker error: ${error?.message || error}`)
    })
    bullWorkers[mode] = worker
    return worker
  }
  startWorker('analyze')
  startWorker('apply')
  bullStatus = { driver: 'bullmq', available: true, reason: 'workers_ready', producerReady: true, workerActive: true }
  return getQueueStatus()
}

async function enqueueImportJob(jobId, { mode = 'analyze', force = false } = {}) {
  const normalizedMode = normalizeQueueMode(mode)
  const currentJob = getImportJob(jobId)
  if (!force && ['running', 'queued', 'cancelling'].includes(String(currentJob?.status || '').toLowerCase())) {
    return currentJob
  }
  const status = await initializeBullQueue()
  if (status.available && hasBullProducer()) {
    updateJob(jobId, { queue_driver: 'bullmq', status: 'queued', phase: normalizedMode === 'apply' ? 'apply_queued' : 'analyze_queued' })
    await bullQueues[normalizedMode].add(`import-${normalizedMode}`, { jobId, mode: normalizedMode }, {
      jobId: `${jobId}:${normalizedMode}:${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    })
    return getImportJob(jobId)
  }
  if (BUSINESS_OS_REQUIRE_SCALE_SERVICES || JOB_QUEUE_DRIVER === 'bullmq') {
    updateJob(jobId, {
      status: 'failed',
      phase: 'queue_unavailable',
      last_error: `Required import queue is unavailable: ${status.reason || 'Redis/BullMQ unavailable'}`,
      finished_at: nowIso(),
    })
    throw new Error(`Required import queue is unavailable: ${status.reason || 'Redis/BullMQ unavailable'}`)
  }
  updateJob(jobId, {
    status: 'failed',
    phase: 'queue_unavailable',
    last_error: `Required import queue is unavailable: ${status.reason || 'Redis/BullMQ unavailable'}`,
    finished_at: nowIso(),
  })
  throw new Error(`Required import queue is unavailable: ${status.reason || 'Redis/BullMQ unavailable'}`)
}

async function cancelImportJob(jobId) {
  const job = getImportJob(jobId)
  if (!job) throw new Error('Import job not found')
  const status = String(job.status || '').toLowerCase()
  if (status === 'completed' || status === 'completed_with_errors') {
    return job
  }
  if (status === 'cancelled') return job

  markJobCancelled(jobId)
  const removedQueued = await removeQueuedBullJobsForImport(jobId)
  if (status === 'running' || status === 'cancelling') {
    await waitForImportJobsToStop([jobId], 2_500)
  }
  const fresh = getImportJob(jobId)
  const freshStatus = String(fresh?.status || '').toLowerCase()
  const canFinishNow = ['pending', 'queued', 'approved', 'awaiting_review', 'failed'].includes(status)
    || (freshStatus === 'cancelling' && removedQueued.length > 0)
    || (fresh?.cancel_requested && isImportJobWorkDrained(fresh))
  if (canFinishNow && !runningLocalJobs.has(`${jobId}:analyze`) && !runningLocalJobs.has(`${jobId}:apply`)) {
    updateJob(jobId, {
      status: 'cancelled',
      phase: 'cancelled',
      last_error: null,
      finished_at: nowIso(),
    })
    markStoredImportFilesCancelled(jobId, 'Import was cancelled.')
  }
  return getImportJob(jobId)
}

const CANCELLABLE_IMPORT_STATUSES = ['pending', 'queued', 'running', 'cancelling', 'approved', 'awaiting_review']

function listCancellableImportJobs() {
  return db.prepare(`
    SELECT *
    FROM import_jobs
    WHERE lower(status) IN (${CANCELLABLE_IMPORT_STATUSES.map(() => '?').join(',')})
    ORDER BY created_at ASC, id ASC
  `).all(...CANCELLABLE_IMPORT_STATUSES)
}

async function waitForImportJobsToStop(jobIds = [], timeoutMs = 15_000) {
  const ids = Array.from(new Set((jobIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
  if (!ids.length) return []
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0))
  while (Date.now() <= deadline) {
    const placeholders = ids.map(() => '?').join(',')
    const active = db.prepare(`
      SELECT id, status, phase
      FROM import_jobs
      WHERE id IN (${placeholders}) AND lower(status) IN ('running', 'cancelling', 'queued')
    `).all(...ids)
    if (!active.length) return []
    await wait(250)
  }
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, status, phase
    FROM import_jobs
    WHERE id IN (${placeholders}) AND lower(status) IN ('running', 'cancelling', 'queued')
  `).all(...ids)
}

async function cancelAllImportJobs({ reason = 'Background import cancelled by system maintenance.', waitMs = 15_000 } = {}) {
  const jobs = listCancellableImportJobs()
  if (!jobs.length) {
    return { cancelled: 0, remaining: [], jobIds: [] }
  }
  const jobIds = jobs.map((job) => job.id)
  for (const jobId of jobIds) {
    await removeQueuedBullJobsForImport(jobId)
  }
  const placeholders = jobIds.map(() => '?').join(',')
  db.prepare(`
    UPDATE import_jobs
    SET cancel_requested = 1,
        status = CASE WHEN lower(status) = 'running' THEN 'cancelling' ELSE 'cancelled' END,
        phase = CASE WHEN lower(status) = 'running' THEN 'cancel_requested' ELSE 'cancelled' END,
        last_error = ?,
        finished_at = CASE WHEN lower(status) = 'running' THEN finished_at ELSE CURRENT_TIMESTAMP END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `).run(reason, ...jobIds)
  db.prepare(`
    UPDATE import_job_files
    SET status = 'cancelled',
        error_message = COALESCE(error_message, ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE job_id IN (${placeholders}) AND status IN ('stored', 'queued_media')
  `).run(reason, ...jobIds)
  const remaining = await waitForImportJobsToStop(jobIds, waitMs)
  return { cancelled: jobs.length, remaining, jobIds }
}

async function deleteImportJob(jobId, { force = false } = {}) {
  const job = getImportJob(jobId)
  if (!job) return { deleted: false, missing: true, id: jobId }
  const reconciled = reconcileImportJobRow(job, { staleMs: 5_000 })
  const current = decorateImportJobRow(reconciled) || job
  const status = String(current.status || '').toLowerCase()
  const busy = ['running', 'queued', 'cancelling', 'approved'].includes(status)
  if (busy && !force) {
    await cancelImportJob(jobId)
    const remaining = await waitForImportJobsToStop([jobId], 5000)
    const afterCancel = getImportJob(jobId)
    const stillBusy = remaining.length && !isImportJobWorkDrained(afterCancel)
    if (stillBusy) {
      const error = new Error('Import is still stopping. Try remove again after it changes to cancelled.')
      error.code = 'import_still_stopping'
      throw error
    }
  }
  await removeQueuedBullJobsForImport(jobId)
  db.transaction(() => {
    db.prepare('DELETE FROM import_job_errors WHERE job_id = ?').run(jobId)
    db.prepare('DELETE FROM import_job_batches WHERE job_id = ?').run(jobId)
    db.prepare('DELETE FROM import_job_files WHERE job_id = ?').run(jobId)
    db.prepare('DELETE FROM import_jobs WHERE id = ?').run(jobId)
  })()
  deleteImportJobFiles(jobId)
  broadcast('runtime')
  return { deleted: true, id: jobId }
}

async function deleteAllImportJobs({ removeFiles = true } = {}) {
  const ids = db.prepare('SELECT id FROM import_jobs').all().map((row) => row.id)
  for (const jobId of ids) {
    await removeQueuedBullJobsForImport(jobId)
  }
  db.transaction(() => {
    db.prepare('DELETE FROM import_job_errors').run()
    db.prepare('DELETE FROM import_job_batches').run()
    db.prepare('DELETE FROM import_job_files').run()
    db.prepare('DELETE FROM import_jobs').run()
  })()
  if (removeFiles) clearImportRuntimeFiles()
  broadcast('runtime')
  return { deleted: ids.length }
}

async function approveImportJob(jobId) {
  const job = getImportJob(jobId)
  if (!job) throw new Error('Import job not found')
  if (['running', 'queued', 'cancelling'].includes(String(job.status || '').toLowerCase())) {
    throw new Error('Import job is already busy')
  }
  if (!['awaiting_review', 'completed_with_errors', 'failed', 'cancelled', 'approved'].includes(String(job.status || '').toLowerCase())) {
    throw new Error('Import job is not ready to apply')
  }
  const preflight = await preflightImportJob(jobId)
  if (!preflight.ok) {
    const firstFailure = preflight.failures[0]
    throw new Error(firstFailure?.message || 'Import decisions need review before applying')
  }
  updateJob(jobId, {
    status: 'approved',
    phase: 'approved',
    cancel_requested: 0,
    last_error: null,
    finished_at: null,
  })
  return enqueueImportJob(jobId, { mode: 'apply' })
}

async function recoverImportJobs({ forceQueue = false } = {}) {
  const rows = db.prepare(`
    SELECT id, phase
    FROM import_jobs
    WHERE status IN ('running', 'queued', 'cancelling')
    ORDER BY created_at ASC
    LIMIT 20
  `).all()
  for (const row of rows) {
    const mode = String(row.phase || '').includes('apply') ? 'apply' : 'analyze'
    try {
      await enqueueImportJob(row.id, { mode, force: true })
    } catch (error) {
      updateJob(row.id, {
        status: 'queued',
        phase: 'queue_recovery_waiting',
        last_error: error?.message || 'Import queue recovery failed',
      })
    }
  }
}

function getQueueStatus() {
  return {
    ...bullStatus,
    configuredDriver: JOB_QUEUE_DRIVER,
    effectiveDriver: configuredQueueDriver(),
    redisUrlConfigured: !!REDIS_URL,
    queues: {
      analyze: IMPORT_ANALYZE_QUEUE_NAME,
      apply: IMPORT_APPLY_QUEUE_NAME,
    },
    producerReady: hasBullProducer(),
    workerActive: hasBullWorkers(),
    imageConcurrency: IMPORT_IMAGE_CONCURRENCY,
    rowBatchSize: IMPORT_ROW_BATCH_SIZE,
  }
}

function buildErrorsCsv(jobId) {
  const errors = getJobErrors(jobId, { limit: 5000 })
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [
    `\uFEFF${['row_number', 'file_name', 'code', 'message'].map(escape).join(',')}`,
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
  approveImportJob,
  buildErrorsCsv,
  cancelAllImportJobs,
  cancelImportJob,
  createImportJob,
  deleteAllImportJobs,
  deleteImportJob,
  enqueueImportJob,
  getImportJob,
  getImportJobReview,
  getJobErrors,
  getJobFiles,
  getQueueStatus,
  initializeBullQueue,
  listImportJobs,
  markJobCancelled,
  preflightImportJob,
  processImportJob,
  recoverImportJobs,
  startImportWorkers,
  updateImportJobDecisions,
  updateJob,
}
