import {
  getBlankCsvHeaderColumns,
  getDuplicateCsvHeaders,
  normalizeCsvKey,
  normalizeCsvMoney,
  normalizeCsvPercent,
  parseCsvNumber,
  parseCsvRows,
} from '../../../utils/csvImport.ts'

export const PRODUCT_MONEY_FIELDS = [
  'selling_price_usd',
  'selling_price_khr',
  'special_price_usd',
  'special_price_khr',
  // The VIP-price header alias -- listed as a money field so a raw
  // 'vip_price_usd' string is coerced to a number before it is copied into
  // special_price_* during normalization (see normalizeProductImportRow).
  'vip_price_usd',
  'vip_price_khr',
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
export const PRODUCT_NUMBER_FIELDS = [
  'stock_quantity',
  'low_stock_threshold',
  'out_of_stock_threshold',
  'expiry_alert_days',
  'parent_id',
  'is_group',
]

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

// The DETAIL fields, matching utils/productDetailRule.ts exactly: the
// barcode, and nothing else.
//
// Cost left this list on Sep 4 2026 (user ruling): only a different barcode
// forks a child row now, and rows differing only in cost merge, with the
// stored cost becoming the mean of the distinct costs.
//
// This list used to also contain sku, category, brand, unit, description,
// supplier, selling price and special price -- so changing a supplier or a
// unit forked a "variant", and two rows for one article at two hoped-for
// prices were planned as different products. It disagreed with the backend
// (which was matching on name+cost+selling+barcode) AND with the frontend's
// own display merge, which compared every field. `purchase_price_*` was
// also the wrong cost column: import and the manual form only ever write
// `cost_price_*`, so that pair sat at 0 on every real row and contributed
// nothing.
const DETAIL_FIELDS = [
  'barcode',
]

const TEXT_CORRUPTION_FIELDS = [
  'name',
  'brand',
  'category',
  'unit',
  'description',
  'supplier',
]

type ImportRow = Record<string, any>
type ImportIssueType =
  | 'invalid_barcode'
  | 'barcode_scientific_notation'
  | 'barcode_too_long'
  | 'possible_encoding_corruption'
  | 'barcode_text'
  | 'missing_name'
  | string

type PlannedProductImportAction = 'new' | 'merge_stock' | 'create_variant' | 'link_variant' | 'skip_row' | string

interface ProductImportConflict {
  id: number
  row: ImportRow
  index: number
  existing: ImportRow | null
  plannedAction: PlannedProductImportAction
  conflictType: string
  conflictFields: string[]
  issueTypes: string[]
  sameBasic: boolean
  samePricing: boolean
  sameImages: boolean
  incomingImages: string[]
  existingImages: string[]
  importDuplicateRows?: {
    sku: number[]
    barcode: number[]
  }
}

interface ProductImportCleanRow {
  row: ImportRow
  index: number
  incomingImages: string[]
}

interface ProductImportReviewSubgroup {
  signature: string
  rowIndexes: number[]
  rowNumbers: number[]
  rows: ImportRow[]
  suggestedAction: string
}

interface ProductImportReviewGroup {
  key: string
  title: string
  rowIndexes: number[]
  rowNumbers: number[]
  rows: ImportRow[]
  subgroupsBySignature: Map<string, ProductImportReviewSubgroup>
  issueTypes: Set<string>
}

interface ProductImportAnalysis {
  rows: ImportRow[]
  cleanRows: ProductImportCleanRow[]
  conflicts: ProductImportConflict[]
  decisions: Record<number, PlannedProductImportAction>
  errors: string[]
  // Non-blocking, unlike `errors` -- real import-file audit (Aug 22 2026)
  // found duplicate/near-duplicate CSV headers (an Excel re-export
  // artifact, e.g. `discount_ends_at` + `discount_ends_at.1`) import
  // silently today with no signal that a column's data was dropped or
  // never read. This surfaces that as a warning, not a blocker, since the
  // import itself still works -- it just may be missing data the operator
  // thought they included.
  warnings: string[]
  groups: Array<Record<string, any>>
  summary: {
    total: number
    newCount: number
    mergeCount: number
    variantCount: number
    errorCount: number
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function normalizeImportProductName(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase()
}

function normalizeComparableText(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase()
}

export const BLOCKING_PRODUCT_IMPORT_ISSUES = new Set([
  'invalid_barcode',
  'barcode_scientific_notation',
  'barcode_too_long',
  'possible_encoding_corruption',
])

export function isBlockingProductImportIssue(issueType: unknown): boolean {
  return BLOCKING_PRODUCT_IMPORT_ISSUES.has(String(issueType || ''))
}

export function getProductImportBarcodeIssue(value: unknown): string {
  const barcode = normalizeText(value)
  if (!barcode) return ''
  if (/[\u0000-\u001F\u007F]/.test(barcode)) return 'invalid_barcode'
  if (barcode.length > 128) return 'barcode_too_long'
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(barcode)) return 'barcode_scientific_notation'
  if (/[^\x20-\x7E]/.test(barcode)) return 'barcode_text'
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+() -]*$/.test(barcode)) return 'barcode_text'
  return ''
}

function hasSuspiciousEncodingCorruption(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('\ufffd')) return true
  if (/^\?{2,}$/.test(trimmed)) return true
  return /\?{2,}/.test(trimmed)
}

function getCorruptedTextFields(row: ImportRow = {}): string[] {
  return TEXT_CORRUPTION_FIELDS.filter((field) => hasSuspiciousEncodingCorruption(row?.[field]))
}

function getBlockingIssueMessage(issueType: ImportIssueType, rowNumber: unknown, barcode: unknown, fields: string[] = []): string {
  const prefix = `Row ${rowNumber}:`
  if (issueType === 'barcode_scientific_notation') return `${prefix} barcode "${barcode}" looks like scientific notation. Re-export it as text, edit it, or clear it before importing.`
  if (issueType === 'barcode_too_long') return `${prefix} barcode is too long. Shorten or clear it before importing.`
  if (issueType === 'invalid_barcode') return `${prefix} barcode contains invalid control characters. Edit or clear it before importing.`
  if (issueType === 'possible_encoding_corruption') {
    const fieldLabel = fields.length ? ` (${fields.join(', ')})` : ''
    return `${prefix} text looks corrupted${fieldLabel}. Re-export the CSV as UTF-8 or UTF-16 before importing.`
  }
  return `${prefix} barcode needs review.`
}

function normalizeFlag(value: unknown, fallback = 0): number {
  const text = normalizeComparableText(value)
  if (!text) return Number(fallback || 0) ? 1 : 0
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return 1
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return 0
  return Number(fallback || 0) ? 1 : 0
}

export function normalizeProductImportRow(row: ImportRow = {}, index = 0): ImportRow {
  const normalized: ImportRow = {}
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
  // VIP price (stored in special_price_*; label is "VIP" now). Reads the
  // new vip_price_* header OR the legacy special_price_* one, and defaults
  // to 0 when neither is given -- NOT the selling price. Defaulting to
  // selling set VIP = selling on every blank row, which the edit form then
  // wrote back, destroying real VIP prices. Every consumer treats 0 as
  // "no VIP price, use selling".
  normalized.special_price_usd = normalized.special_price_usd ?? normalized.vip_price_usd ?? 0
  normalized.special_price_khr = normalized.special_price_khr ?? normalized.vip_price_khr ?? 0
  normalized.cost_price_usd = normalized.cost_price_usd ?? normalized.purchase_price_usd ?? 0
  normalized.cost_price_khr = normalized.cost_price_khr ?? normalized.purchase_price_khr ?? 0
  normalized.low_stock_threshold = normalized.low_stock_threshold ?? 10
  normalized.discount_enabled = normalized.discount_enabled ?? normalized.promotion_enabled ?? normalized.on_promotion ?? 0
  normalized.discount_type = normalized.discount_type || (normalized.discount_amount_usd || normalized.discount_amount_khr ? 'fixed' : 'percent')
  normalized.discount_percent = normalized.discount_percent ?? 0
  normalized.discount_amount_usd = normalized.discount_amount_usd ?? 0
  normalized.discount_amount_khr = normalized.discount_amount_khr ?? 0
  // These three mirror products' own column defaults (0001_init.sql) --
  // materializeImportChunk's INSERT/UPDATE now name these columns
  // explicitly (see importEngine.ts), and naming a column in an INSERT
  // bypasses SQLite's own DEFAULT for it, binding a literal NULL instead
  // if nothing sets a value first. Defaulting here keeps an imported row
  // that never mentions these columns behaving the same as one created
  // through the manual Add Product form (which leaves them to the
  // schema default too).
  normalized.out_of_stock_threshold = normalized.out_of_stock_threshold ?? 0
  normalized.expiry_alert_days = normalized.expiry_alert_days ?? 30
  normalized.discount_badge_color = normalized.discount_badge_color || '#e11d48'
  normalized._import_row_index = Number(row?._import_row_index ?? index)
  normalized._rowNumber = Number(row?._rowNumber ?? index + 2)
  return normalized
}

function normalizeProductForSignature(product: ImportRow = {}): ImportRow {
  const normalized: ImportRow = { ...product }
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
  // VIP price (stored in special_price_*; label is "VIP" now). Reads the
  // new vip_price_* header OR the legacy special_price_* one, and defaults
  // to 0 when neither is given -- NOT the selling price. Defaulting to
  // selling set VIP = selling on every blank row, which the edit form then
  // wrote back, destroying real VIP prices. Every consumer treats 0 as
  // "no VIP price, use selling".
  normalized.special_price_usd = normalized.special_price_usd ?? normalized.vip_price_usd ?? 0
  normalized.special_price_khr = normalized.special_price_khr ?? normalized.vip_price_khr ?? 0
  normalized.cost_price_usd = normalized.cost_price_usd ?? normalized.purchase_price_usd ?? 0
  normalized.cost_price_khr = normalized.cost_price_khr ?? normalized.purchase_price_khr ?? 0
  normalized.low_stock_threshold = normalized.low_stock_threshold ?? 10
  normalized.discount_type = normalized.discount_type || (normalized.discount_amount_usd || normalized.discount_amount_khr ? 'fixed' : 'percent')
  normalized.discount_percent = normalized.discount_percent ?? 0
  normalized.discount_amount_usd = normalized.discount_amount_usd ?? 0
  normalized.discount_amount_khr = normalized.discount_amount_khr ?? 0
  return normalized
}

export function getProductImportDetailSignature(source: ImportRow = {}): string {
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

function chooseParentProduct(existingRows: ImportRow[] = []): ImportRow | null {
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

function buildExistingIndex(existingProducts: ImportRow[] = []) {
  const byName = new Map<string, ImportRow[]>()
  const bySku = new Map<string, ImportRow>()
  const byBarcode = new Map<string, ImportRow>()
  ;(Array.isArray(existingProducts) ? existingProducts : []).forEach((product) => {
    const nameKey = normalizeImportProductName(product?.name)
    if (nameKey) {
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey)?.push(product)
    }
    const sku = normalizeComparableText(product?.sku)
    if (sku) bySku.set(sku, product)
    const barcode = normalizeComparableText(product?.barcode)
    if (barcode) byBarcode.set(barcode, product)
  })
  return { byName, bySku, byBarcode }
}

function buildImportedIdentifierIndex(rows: ImportRow[] = []) {
  const bySku = new Map<string, number[]>()
  const byBarcode = new Map<string, number[]>()
  const add = (map: Map<string, number[]>, key: string, rowIndex: number): void => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key)?.push(rowIndex)
  }
  ;(Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const rowIndex = Number(row?._import_row_index ?? index)
    add(bySku, normalizeComparableText(row?.sku), rowIndex)
    add(byBarcode, normalizeComparableText(row?.barcode), rowIndex)
  })
  return { bySku, byBarcode }
}

function buildProductImportReviewGroups(rows: ImportRow[] = []): Array<Record<string, any>> {
  const byName = new Map<string, ProductImportReviewGroup>()
  ;(Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const nameKey = normalizeImportProductName(row?.name)
    if (!nameKey) return
    if (!byName.has(nameKey)) {
      byName.set(nameKey, {
        key: nameKey,
        title: normalizeText(row?.name),
        rowIndexes: [],
        rowNumbers: [],
        rows: [],
        subgroupsBySignature: new Map(),
        issueTypes: new Set(['same_name']),
      })
    }
    const group = byName.get(nameKey)
    if (!group) return
    const rowIndex = Number(row?._import_row_index ?? index)
    const rowNumber = Number(row?._rowNumber ?? rowIndex + 2)
    // Same name + every DETAIL_FIELDS value (sku, barcode, category, brand,
    // unit, description, supplier, prices) collapses into one subgroup --
    // this is a "same product, different branch" split, not a variant --
    // regardless of whether a barcode is present. Only an actual difference
    // in one of those fields (branch is deliberately not one of them) earns
    // create_variant/new. This used to gate the merge behind having a
    // barcode at all, which forced every barcode-less multi-branch product
    // into parent/child variant rows even when nothing but branch differed.
    const signature = row?._detail_signature || getProductImportDetailSignature(row)
    group.rowIndexes.push(rowIndex)
    group.rowNumbers.push(rowNumber)
    group.rows.push({
      rowIndex,
      rowNumber,
      name: row?.name || '',
      sku: row?.sku || '',
      barcode: row?.barcode || '',
      brand: row?.brand || '',
      category: row?.category || '',
      unit: row?.unit || '',
      supplier: row?.supplier || '',
      branch: row?.branch || '',
      stock_quantity: row?.stock_quantity ?? '',
      low_stock_threshold: row?.low_stock_threshold ?? '',
      selling_price_usd: row?.selling_price_usd ?? '',
      selling_price_khr: row?.selling_price_khr ?? '',
      special_price_usd: row?.special_price_usd ?? row?.vip_price_usd ?? '',
      special_price_khr: row?.special_price_khr ?? row?.vip_price_khr ?? '',
      purchase_price_usd: row?.purchase_price_usd ?? row?.cost_price_usd ?? '',
      purchase_price_khr: row?.purchase_price_khr ?? row?.cost_price_khr ?? '',
      discount_enabled: row?.discount_enabled ?? '',
      discount_type: row?.discount_type || '',
      discount_percent: row?.discount_percent ?? '',
      discount_amount_usd: row?.discount_amount_usd ?? '',
      discount_amount_khr: row?.discount_amount_khr ?? '',
      description: row?.description || '',
      plannedAction: row?._planned_action || '',
    })
    if (!group.subgroupsBySignature.has(signature)) {
      group.subgroupsBySignature.set(signature, {
        signature,
        rowIndexes: [],
        rowNumbers: [],
        rows: [],
        suggestedAction: 'create_variant',
      })
    }
    const subgroup = group.subgroupsBySignature.get(signature)
    if (!subgroup) return
    subgroup.rowIndexes.push(rowIndex)
    subgroup.rowNumbers.push(rowNumber)
    subgroup.rows.push(row)
  })

  return Array.from(byName.values())
    .filter((group) => group.rowIndexes.length > 1)
    .map((group) => {
      const subgroups = Array.from(group.subgroupsBySignature.values())
        .sort((left, right) => Math.min(...left.rowIndexes) - Math.min(...right.rowIndexes))
        .map((subgroup, index, all) => ({
          signature: subgroup.signature,
          rowIndexes: subgroup.rowIndexes,
          rowNumbers: subgroup.rowNumbers,
          suggestedAction: subgroup.rowIndexes.length > 1
            ? 'merge_stock'
            : all.length > 1 || index > 0
              ? 'create_variant'
              : 'new',
          rows: subgroup.rows.map((row) => ({
            rowIndex: row._import_row_index,
            rowNumber: row._rowNumber,
            sku: row.sku || '',
            barcode: row.barcode || '',
            brand: row.brand || '',
            category: row.category || '',
            unit: row.unit || '',
            supplier: row.supplier || '',
            branch: row.branch || '',
            stock_quantity: row.stock_quantity ?? '',
            low_stock_threshold: row.low_stock_threshold ?? '',
            selling_price_usd: row.selling_price_usd ?? '',
            selling_price_khr: row.selling_price_khr ?? '',
            special_price_usd: row.special_price_usd ?? row.vip_price_usd ?? '',
            special_price_khr: row.special_price_khr ?? row.vip_price_khr ?? '',
            purchase_price_usd: row.purchase_price_usd ?? row.cost_price_usd ?? '',
            purchase_price_khr: row.purchase_price_khr ?? row.cost_price_khr ?? '',
            discount_enabled: row.discount_enabled ?? '',
            discount_type: row.discount_type || '',
            discount_percent: row.discount_percent ?? '',
            discount_amount_usd: row.discount_amount_usd ?? '',
            discount_amount_khr: row.discount_amount_khr ?? '',
            description: row.description || '',
            plannedAction: row._planned_action || '',
          })),
        }))
      return {
        key: group.key,
        title: group.title,
        issueTypes: Array.from(group.issueTypes),
        rowIndexes: group.rowIndexes,
        rowNumbers: group.rowNumbers,
        rows: group.rows,
        subgroups,
        suggestedAction: subgroups.length > 1 ? 'create_variant' : 'merge_stock',
      }
    })
    .sort((left, right) => Math.min(...left.rowIndexes) - Math.min(...right.rowIndexes))
}

export function analyzeProductImportRows(rows: ImportRow[] = [], existingProducts: ImportRow[] = []): ProductImportAnalysis {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeProductImportRow(row, index))

  const { byName, bySku, byBarcode } = buildExistingIndex(existingProducts)
  const importedIdentifiers = buildImportedIdentifierIndex(normalizedRows)
  const firstPlannedByName = new Map<string, number | null>()
  const signatureOwnerByName = new Map<string, Map<string, number | null>>()
  const decisions: Record<number, PlannedProductImportAction> = {}
  const cleanRows: ProductImportCleanRow[] = []
  const conflicts: ProductImportConflict[] = []
  const errors: string[] = []

  normalizedRows.forEach((row, index) => {
    const rowIndex = Number(row._import_row_index ?? index)
    const barcodeIssue = getProductImportBarcodeIssue(row.barcode)
    const corruptedFields = getCorruptedTextFields(row)
    const issueTypes: string[] = [
      ...(corruptedFields.length ? ['possible_encoding_corruption'] : []),
      ...(barcodeIssue ? [barcodeIssue] : []),
    ]
    const blockingIssue = issueTypes.find(isBlockingProductImportIssue) || ''
    if (blockingIssue) errors.push(getBlockingIssueMessage(blockingIssue, row._rowNumber || rowIndex + 2, row.barcode, corruptedFields))
    if (!normalizeText(row.name)) {
      const missingIssueTypes = ['missing_name', ...issueTypes]
      const plannedRow: ImportRow = {
        ...row,
        _planned_action: 'skip_row',
        _target_product_id: null,
        _parent_id: null,
        _detail_signature: '',
        _identifier_conflict_mode: '',
      }
      normalizedRows[index] = plannedRow
      decisions[rowIndex] = 'skip_row'
      conflicts.push({
        id: rowIndex,
        row: plannedRow,
        index: rowIndex,
        existing: null,
        plannedAction: 'skip_row',
        conflictType: blockingIssue || 'missing_name',
        conflictFields: Array.from(new Set(['errors', ...(barcodeIssue ? ['barcode'] : []), ...corruptedFields])),
        issueTypes: missingIssueTypes,
        sameBasic: false,
        samePricing: false,
        sameImages: true,
        incomingImages: [],
        existingImages: [],
      })
      errors.push(`Row ${plannedRow._rowNumber}: product name required`)
      return
    }
    const nameKey = normalizeImportProductName(row.name)
    const skuKey = normalizeComparableText(row.sku)
    const barcodeKey = normalizeComparableText(row.barcode)
    const sameNameProducts = byName.get(nameKey) || []
    const skuMatch = skuKey ? bySku.get(skuKey) : null
    const barcodeMatch = barcodeKey ? byBarcode.get(barcodeKey) : null
    const sameFileSkuRows = skuKey ? (importedIdentifiers.bySku.get(skuKey) || []) : []
    const sameFileBarcodeRows = barcodeKey ? (importedIdentifiers.byBarcode.get(barcodeKey) || []) : []
    const sameFileIdentifierFields = [
      sameFileSkuRows.length > 1 ? 'sku' : '',
      sameFileBarcodeRows.length > 1 ? 'barcode' : '',
    ].filter(Boolean)
    const identifierMatch = skuMatch || barcodeMatch || null
    const identifierMatchSameName = identifierMatch && normalizeImportProductName(identifierMatch.name) === nameKey
    const identifierMatchFields = [
      (skuMatch || sameFileSkuRows.length > 1) ? 'sku' : '',
      (barcodeMatch || sameFileBarcodeRows.length > 1) ? 'barcode' : '',
    ].filter(Boolean)
    const identifierConflictFields = Array.from(new Set([
      skuMatch && !identifierMatchSameName ? 'sku' : '',
      barcodeMatch && !identifierMatchSameName ? 'barcode' : '',
      ...sameFileIdentifierFields,
    ].filter(Boolean)))
    const reviewConflictFields = Array.from(new Set([
      ...identifierMatchFields,
      ...(barcodeIssue ? ['barcode'] : []),
    ]))
    const issueConflictFields = Array.from(new Set([
      ...identifierConflictFields,
      ...reviewConflictFields,
      ...corruptedFields,
    ]))
    const existingCandidates = skuMatch && normalizeImportProductName(skuMatch.name) === nameKey
      ? [skuMatch, ...sameNameProducts.filter((product) => Number(product?.id) !== Number(skuMatch.id))]
      : barcodeMatch && normalizeImportProductName(barcodeMatch.name) === nameKey
        ? [barcodeMatch, ...sameNameProducts.filter((product) => Number(product?.id) !== Number(barcodeMatch.id))]
        : sameNameProducts
    const signature = getProductImportDetailSignature(row)
    // Same name + identical sku/barcode/category/brand/unit/description/
    // supplier/prices (branch excluded on purpose) -> "the exact same item,
    // just restock it for another branch". This no longer requires a
    // barcode: a barcode-less row that matches everything else about an
    // existing product still merges stock instead of becoming a variant.
    const matchingExisting = existingCandidates.find((product) => getProductImportDetailSignature(product) === signature) || null
    const parent = chooseParentProduct(existingCandidates)
    let plannedAction: PlannedProductImportAction = 'new'
    let targetProductId: number | null = null
    let parentId: number | null = null

    if (matchingExisting) {
      plannedAction = sameNameProducts.length > 1 ? 'link_variant' : 'merge_stock'
      targetProductId = Number(matchingExisting.id || 0) || null
    } else if (existingCandidates.length) {
      plannedAction = 'create_variant'
      parentId = Number(parent?.parent_id || parent?.id || 0) || null
    } else if (identifierConflictFields.length && !sameFileIdentifierFields.length) {
      plannedAction = 'new'
    } else {
      const signatureOwners = signatureOwnerByName.get(nameKey) || new Map<string, number | null>()
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
      _identifier_conflict_mode: issueConflictFields.length && ['new', 'create_variant'].includes(plannedAction) ? 'clear_imported' : '',
    }
    normalizedRows[index] = plannedRow
    decisions[rowIndex] = plannedAction

    if (plannedAction === 'new' && !issueConflictFields.length && !issueTypes.length) {
      cleanRows.push({ row: plannedRow, index: rowIndex, incomingImages: [] })
    } else {
      conflicts.push({
        id: rowIndex,
        row: plannedRow,
        index: rowIndex,
        existing: matchingExisting || parent || identifierMatch || null,
        plannedAction,
        conflictType: blockingIssue || (identifierConflictFields.length ? 'identifier' : (reviewConflictFields.length ? 'same_name_identifier' : 'same_name')),
        conflictFields: issueConflictFields,
        issueTypes,
        importDuplicateRows: {
          sku: sameFileSkuRows,
          barcode: sameFileBarcodeRows,
        },
        sameBasic: plannedAction === 'merge_stock' || plannedAction === 'link_variant',
        samePricing: plannedAction === 'merge_stock' || plannedAction === 'link_variant',
        sameImages: true,
        incomingImages: [],
        existingImages: [],
      })
    }
  })

  return {
    rows: normalizedRows,
    cleanRows,
    conflicts,
    decisions,
    errors,
    warnings: [],
    groups: buildProductImportReviewGroups(normalizedRows),
    summary: {
      total: normalizedRows.length,
      newCount: normalizedRows.filter((row) => row._planned_action === 'new').length,
      mergeCount: normalizedRows.filter((row) => row._planned_action === 'merge_stock').length,
      variantCount: normalizedRows.filter((row) => row._planned_action === 'create_variant' || row._planned_action === 'link_variant').length,
      errorCount: errors.length,
    },
  }
}

export function analyzeProductImportText(text: string, existingProducts: ImportRow[] = []): ProductImportAnalysis {
  const analysis = analyzeProductImportRows(parseCsvRows(text), existingProducts)
  // Header-level check, not row-level -- can only run here, where the raw
  // text (and its original header row) is still available; by the time
  // rows reach analyzeProductImportRows they're already keyed objects with
  // no memory of which literal header produced which key.
  const duplicateHeaders = getDuplicateCsvHeaders(text)
  if (duplicateHeaders.length) {
    analysis.warnings = [
      ...analysis.warnings,
      `Duplicate or near-duplicate column header${duplicateHeaders.length > 1 ? 's' : ''} found: ${duplicateHeaders.join(', ')}. One may be silently overwriting or ignoring the other -- check the file before importing.`,
    ]
  }
  // Real-file audit (Aug 23 2026) -- see getBlankCsvHeaderColumns' own
  // comment in csvImport.ts: a blank-header column with real data under it
  // (e.g. a stale/hand-edited template) silently loses that column's data
  // today, with no signal at all otherwise.
  const blankHeaderColumns = getBlankCsvHeaderColumns(text)
  if (blankHeaderColumns.length) {
    analysis.warnings = [
      ...analysis.warnings,
      `Column${blankHeaderColumns.length > 1 ? 's' : ''} ${blankHeaderColumns.join(', ')} ${blankHeaderColumns.length > 1 ? 'have' : 'has'} no header but ${blankHeaderColumns.length > 1 ? 'contain' : 'contains'} data -- that data will be skipped on import. Add a header name to that column, or remove it, then re-upload.`,
    ]
  }
  return analysis
}
