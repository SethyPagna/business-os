import {
  normalizeCsvKey,
  normalizeCsvMoney,
  normalizeCsvPercent,
  parseCsvNumber,
  parseCsvRows,
} from '../../utils/csvImport.js'

export const PRODUCT_MONEY_FIELDS = [
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
  'unit_price_usd',
  'unit_price_khr',
  'total_usd',
  'total_khr',
]

export const PRODUCT_PERCENT_FIELDS = ['discount_percent']
export const PRODUCT_NUMBER_FIELDS = ['stock_quantity', 'low_stock_threshold', 'parent_id', 'is_group']

const IMAGE_FIELDS = new Set([
  'image_filename',
  'image_filename_1',
  'image_filename_2',
  'image_filename_3',
  'image_filename_4',
  'image_filename_5',
  'image_1',
  'image_2',
  'image_3',
  'image_4',
  'image_5',
  'image_url_1',
  'image_url_2',
  'image_url_3',
  'image_url_4',
  'image_url_5',
  'image_filenames',
  'image_urls',
  'image_conflict_mode',
])

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

function normalizeText(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function normalizeImportProductName(value) {
  return normalizeText(value).toLocaleLowerCase()
}

function normalizeComparableText(value) {
  return normalizeText(value).toLocaleLowerCase()
}

function normalizeFlag(value, fallback = 0) {
  const text = normalizeComparableText(value)
  if (!text) return Number(fallback || 0) ? 1 : 0
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return 1
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return 0
  return Number(fallback || 0) ? 1 : 0
}

export function normalizeProductImportRow(row = {}, index = 0) {
  const normalized = {}
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeCsvKey(key)
    if (!normalizedKey) return
    normalized[normalizedKey] = typeof value === 'string' ? value.normalize('NFC').trim() : value
  })

  PRODUCT_MONEY_FIELDS.forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') normalized[field] = normalizeCsvMoney(normalized[field], 0)
  })
  PRODUCT_PERCENT_FIELDS.forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') normalized[field] = normalizeCsvPercent(normalized[field], 0)
  })
  PRODUCT_NUMBER_FIELDS.forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') {
      normalized[field] = parseCsvNumber(normalized[field], 0, { allowNegative: false })
    }
  })
  ;['discount_enabled', 'promotion_enabled', 'on_promotion'].forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') normalized[field] = normalizeFlag(normalized[field], 0)
  })

  normalized.name = normalizeText(normalized.name)
  normalized.unit = normalizeText(normalized.unit || 'pcs')
  normalized.special_price_usd = normalized.special_price_usd ?? normalized.selling_price_usd ?? 0
  normalized.special_price_khr = normalized.special_price_khr ?? normalized.selling_price_khr ?? 0
  normalized.cost_price_usd = normalized.cost_price_usd ?? normalized.purchase_price_usd ?? 0
  normalized.cost_price_khr = normalized.cost_price_khr ?? normalized.purchase_price_khr ?? 0
  normalized.low_stock_threshold = normalized.low_stock_threshold ?? 10
  normalized.discount_enabled = normalized.discount_enabled ?? normalized.promotion_enabled ?? normalized.on_promotion ?? 0
  normalized.discount_type = normalized.discount_type || (normalized.discount_amount_usd || normalized.discount_amount_khr ? 'fixed' : 'percent')
  normalized.discount_percent = normalized.discount_percent ?? 0
  normalized.discount_amount_usd = normalized.discount_amount_usd ?? 0
  normalized.discount_amount_khr = normalized.discount_amount_khr ?? 0
  normalized._import_row_index = Number(row?._import_row_index ?? index)
  normalized._rowNumber = Number(row?._rowNumber ?? index + 2)
  return normalized
}

function normalizeProductForSignature(product = {}) {
  const normalized = { ...product }
  PRODUCT_MONEY_FIELDS.forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') normalized[field] = normalizeCsvMoney(normalized[field], 0)
  })
  PRODUCT_PERCENT_FIELDS.forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') normalized[field] = normalizeCsvPercent(normalized[field], 0)
  })
  ;['discount_enabled'].forEach((field) => {
    normalized[field] = normalizeFlag(normalized[field], 0)
  })
  normalized.name = normalizeText(normalized.name)
  normalized.unit = normalizeText(normalized.unit || 'pcs')
  normalized.special_price_usd = normalized.special_price_usd ?? normalized.selling_price_usd ?? 0
  normalized.special_price_khr = normalized.special_price_khr ?? normalized.selling_price_khr ?? 0
  normalized.cost_price_usd = normalized.cost_price_usd ?? normalized.purchase_price_usd ?? 0
  normalized.cost_price_khr = normalized.cost_price_khr ?? normalized.purchase_price_khr ?? 0
  normalized.low_stock_threshold = normalized.low_stock_threshold ?? 10
  normalized.discount_type = normalized.discount_type || (normalized.discount_amount_usd || normalized.discount_amount_khr ? 'fixed' : 'percent')
  normalized.discount_percent = normalized.discount_percent ?? 0
  normalized.discount_amount_usd = normalized.discount_amount_usd ?? 0
  normalized.discount_amount_khr = normalized.discount_amount_khr ?? 0
  return normalized
}

export function getProductImportDetailSignature(source = {}) {
  const normalized = normalizeProductForSignature(source)
  return DETAIL_FIELDS
    .filter((field) => !IMAGE_FIELDS.has(field))
    .map((field) => {
      const value = normalized[field]
      if (typeof value === 'number') return `${field}:${Number.isFinite(value) ? value : 0}`
      return `${field}:${normalizeComparableText(value)}`
    })
    .join('|')
}

function chooseParentProduct(existingRows = []) {
  const safeRows = Array.isArray(existingRows) ? existingRows : []
  return [...safeRows].sort((left, right) => {
    const leftGroup = Number(left?.is_group || 0) ? 0 : 1
    const rightGroup = Number(right?.is_group || 0) ? 0 : 1
    if (leftGroup !== rightGroup) return leftGroup - rightGroup
    const leftRoot = Number(left?.parent_id || 0) ? 1 : 0
    const rightRoot = Number(right?.parent_id || 0) ? 1 : 0
    if (leftRoot !== rightRoot) return leftRoot - rightRoot
    const leftCreated = String(left?.created_at || '')
    const rightCreated = String(right?.created_at || '')
    if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated)
    return Number(left?.id || 0) - Number(right?.id || 0)
  })[0] || null
}

function buildExistingIndex(existingProducts = []) {
  const byName = new Map()
  const bySku = new Map()
  const byBarcode = new Map()
  ;(Array.isArray(existingProducts) ? existingProducts : []).forEach((product) => {
    const nameKey = normalizeImportProductName(product?.name)
    if (nameKey) {
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey).push(product)
    }
    const sku = normalizeComparableText(product?.sku)
    if (sku) bySku.set(sku, product)
    const barcode = normalizeComparableText(product?.barcode)
    if (barcode) byBarcode.set(barcode, product)
  })
  return { byName, bySku, byBarcode }
}

export function analyzeProductImportRows(rows = [], existingProducts = []) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeProductImportRow(row, index))
    .filter((row) => normalizeText(row.name))

  const { byName, bySku, byBarcode } = buildExistingIndex(existingProducts)
  const firstPlannedByName = new Map()
  const signatureOwnerByName = new Map()
  const decisions = {}
  const cleanRows = []
  const conflicts = []
  const errors = []

  normalizedRows.forEach((row, index) => {
    const rowIndex = Number(row._import_row_index ?? index)
    const nameKey = normalizeImportProductName(row.name)
    const skuKey = normalizeComparableText(row.sku)
    const barcodeKey = normalizeComparableText(row.barcode)
    const sameNameProducts = byName.get(nameKey) || []
    const skuMatch = skuKey ? bySku.get(skuKey) : null
    const barcodeMatch = barcodeKey ? byBarcode.get(barcodeKey) : null
    const identifierMatch = skuMatch || barcodeMatch || null
    const identifierMatchSameName = identifierMatch && normalizeImportProductName(identifierMatch.name) === nameKey
    const identifierConflictFields = [
      skuMatch && !identifierMatchSameName ? 'sku' : '',
      barcodeMatch && !identifierMatchSameName ? 'barcode' : '',
    ].filter(Boolean)
    const existingCandidates = skuMatch && normalizeImportProductName(skuMatch.name) === nameKey
      ? [skuMatch, ...sameNameProducts.filter((product) => Number(product?.id) !== Number(skuMatch.id))]
      : barcodeMatch && normalizeImportProductName(barcodeMatch.name) === nameKey
        ? [barcodeMatch, ...sameNameProducts.filter((product) => Number(product?.id) !== Number(barcodeMatch.id))]
        : sameNameProducts
    const signature = getProductImportDetailSignature(row)
    const matchingExisting = existingCandidates.find((product) => getProductImportDetailSignature(product) === signature) || null
    const parent = chooseParentProduct(existingCandidates)
    let plannedAction = 'new'
    let targetProductId = null
    let parentId = null

    if (matchingExisting) {
      plannedAction = sameNameProducts.length > 1 ? 'link_variant' : 'merge_stock'
      targetProductId = Number(matchingExisting.id || 0) || null
    } else if (existingCandidates.length) {
      plannedAction = 'create_variant'
      parentId = Number(parent?.parent_id || parent?.id || 0) || null
    } else if (identifierConflictFields.length) {
      plannedAction = 'new'
    } else {
      const signatureOwners = signatureOwnerByName.get(nameKey) || new Map()
      if (signatureOwners.has(signature)) {
        plannedAction = 'merge_stock'
        targetProductId = Number(signatureOwners.get(signature) || 0) || null
      } else if (firstPlannedByName.has(nameKey)) {
        plannedAction = 'create_variant'
        parentId = Number(firstPlannedByName.get(nameKey) || 0) || null
      } else {
        plannedAction = 'new'
        firstPlannedByName.set(nameKey, null)
      }
      signatureOwners.set(signature, firstPlannedByName.get(nameKey) || null)
      signatureOwnerByName.set(nameKey, signatureOwners)
    }

    const plannedRow = {
      ...row,
      _planned_action: plannedAction,
      _target_product_id: targetProductId,
      _parent_id: parentId,
      _detail_signature: signature,
      _identifier_conflict_mode: identifierConflictFields.length ? 'clear_imported' : '',
    }
    normalizedRows[index] = plannedRow
    decisions[rowIndex] = plannedAction

    if (plannedAction === 'new' && !identifierConflictFields.length) {
      cleanRows.push({ row: plannedRow, index: rowIndex, incomingImages: [] })
    } else {
      conflicts.push({
        id: rowIndex,
        row: plannedRow,
        index: rowIndex,
        existing: matchingExisting || parent || identifierMatch || null,
        plannedAction,
        conflictType: identifierConflictFields.length ? 'identifier' : 'same_name',
        conflictFields: identifierConflictFields,
        sameBasic: plannedAction === 'merge_stock' || plannedAction === 'link_variant',
        samePricing: plannedAction === 'merge_stock' || plannedAction === 'link_variant',
        sameImages: true,
        incomingImages: [],
        existingImages: [],
      })
    }

    if (!plannedRow.name) errors.push(`Row ${plannedRow._rowNumber}: product name required`)
  })

  return {
    rows: normalizedRows,
    cleanRows,
    conflicts,
    decisions,
    errors,
    summary: {
      total: normalizedRows.length,
      newCount: normalizedRows.filter((row) => row._planned_action === 'new').length,
      mergeCount: normalizedRows.filter((row) => row._planned_action === 'merge_stock').length,
      variantCount: normalizedRows.filter((row) => row._planned_action === 'create_variant' || row._planned_action === 'link_variant').length,
      errorCount: errors.length,
    },
  }
}

export function analyzeProductImportText(text, existingProducts = []) {
  return analyzeProductImportRows(parseCsvRows(text), existingProducts)
}
