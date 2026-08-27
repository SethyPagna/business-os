import { useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Columns3 from 'lucide-react/dist/esm/icons/columns-3.js'
import PackagePlus from 'lucide-react/dist/esm/icons/package-plus.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import Modal from '../../shared/Modal'
import AppSelect from '../../shared/AppSelect'
import FilePickerModalBase from '../../files/FilePickerModal'
import {
  analyzeProductImportText,
  getProductImportBarcodeIssue,
  isBlockingProductImportIssue,
  normalizeImportProductName,
} from './productImportPlanner.ts'
import { beginNamedAction, finishNamedAction } from '../../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../../utils/loaders.ts'
import { parseImportFile } from '../../../utils/spreadsheetImport.ts'
import { useApp as useAppHook } from '../../../app/AppContextCore.tsx'
import { detectLikelyDatedReconciliation, type ImportModeDetectionResult } from './importModeDetection.ts'
import { REPLACE_COLUMN_GROUPS } from './productReplaceColumnGroups.ts'
import { MAX_PRODUCT_GALLERY_IMAGES } from '../helpers/productGalleryHelpers.ts'
import ProductImportModeTabs, { ProductImportOptionCard, type ProductImportTopMode } from './ProductImportModeTabs'

type NotifyFn = (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void
const useApp = useAppHook as () => { notify: NotifyFn; hasPermission: (key: string) => boolean }

const IMAGE_CONFLICT_OPTIONS = [
  { value: 'keep_existing', label: 'Keep existing images' },
  { value: 'replace_with_csv', label: 'Replace with CSV images' },
  { value: 'append_csv', label: 'Append CSV images' },
]

const IMPORT_DECISION_OPTIONS = [
  { value: 'merge_stock', label: 'Add stock' },
  { value: 'create_variant', label: 'Variant' },
  { value: 'override_add', label: 'Override + stock' },
  { value: 'override_replace', label: 'Override + replace' },
  { value: 'new', label: 'New' },
  { value: 'skip_row', label: 'Skip' },
]

// Replace mode (column-level) -- Part 320 (chat), the one Replace-mode
// sub-option that genuinely had no backend before this session (see
// progress.md's Part 320/321 entries for why the other two sub-options
// turned out to already be built). Group data lives in
// productReplaceColumnGroups.ts (single source of truth, wired in Part
// 321) rather than duplicated here -- that module's own partition test
// (productReplaceColumnGroups.test.ts) is what actually guards
// REPLACE_COLUMN_GROUPS staying a strict partition of the backend's
// `PRODUCT_REPLACE_COLUMNS` allow-list (cloudflare/src/lib/
// importEngine.ts): every column there appears in exactly one group,
// nothing more and nothing less, since the backend silently drops
// anything not on its own allow-list rather than erroring (an operator
// picking a group that maps to a column the backend doesn't recognize
// would look like it worked, but quietly not write that field).

const IDENTIFIER_DECISION_OPTIONS = [
  { value: 'clear_imported', label: 'Clear duplicate ID' },
  { value: 'allow_duplicate', label: 'Keep same ID' },
]

// Grouped by what the chip actually tells you, not just alphabetically --
// see the render site (search "product-import-filter-row") for why: the
// old flat 11-chip row put Matched/Variants/Add stock/Override next to
// Family/Barcode/SKU with no visual distinction, even though the first
// four describe the row's *planned outcome* and the rest describe *what
// data* triggered review. 'scope' (All) and 'severity' (Errors) stay as
// their own always-visible anchors -- All resets the filter, Errors is
// the one chip that should never get lost in a labeled cluster.
const CONFLICT_FILTER_OPTIONS: ConflictFilterOption[] = [
  { value: 'all', label: 'All', group: 'scope', countKey: 'total', hint: 'All rows that need review before the import can be applied.' },
  { value: 'same_name', label: 'Family', group: 'field', countKey: 'sameName', hint: 'Rows sharing the same product name. Expand the family to see parent and variant scenarios.' },
  { value: 'barcode', label: 'Barcode', group: 'field', countKey: 'barcode', hint: 'Rows with duplicate, unsafe, or review-worthy barcode values. Scientific notation blocks import until edited or cleared.' },
  { value: 'no_barcode', label: 'No barcode', group: 'field', countKey: 'noBarcode', hint: 'Rows with no barcode at all. These always create a new row (in the same family if the name matches, standalone if it doesn\u2019t) rather than auto-merging stock, since a barcode-less row can\u2019t be confidently matched to an existing item.' },
  { value: 'sku', label: 'SKU', group: 'field', countKey: 'sku', hint: 'Rows with duplicate or matched SKU values.' },
  { value: 'pricing', label: 'Pricing', group: 'field', countKey: 'pricing', hint: 'Rows where price/cost values differ from a match, or all price columns are blank or zero.' },
  { value: 'existing', label: 'Matched', group: 'status', countKey: 'existing', hint: 'Rows already matched to an existing product candidate.' },
  { value: 'variant', label: 'Variants', group: 'status', countKey: 'variant', hint: 'Rows planned as variants or links under a family parent.' },
  { value: 'merge', label: 'Add stock', group: 'status', countKey: 'merge', hint: 'Rows planned to add incoming stock to an existing or same-family target.' },
  { value: 'override', label: 'Override', group: 'status', countKey: 'override', hint: 'Rows where imported details can overwrite or fill existing product fields.' },
  { value: 'errors', label: 'Errors', group: 'severity', countKey: 'errors', hint: 'Rows with blocking issues such as missing names or unsafe barcodes.' },
]

const IMPORT_JOB_STATUS_TIMEOUT_MS = 10000
const IMPORT_JOB_PREFLIGHT_TIMEOUT_MS = 15000
const PRODUCT_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000
const PRODUCT_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 45000
const PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS = 120000
const PRODUCT_IMPORT_JOB_START_TIMEOUT_MS = 12000
const PRODUCT_IMPORT_ANALYSIS_TIMEOUT_MS = 60000

type EntityId = string | number
type ImportActionName = 'retry' | 'delete' | 'image-only' | 'pick-csv' | 'import'
type ImportMode = 'products' | 'images'
type FieldRulePreset = 'merge_blank_only' | 'keep_existing' | 'use_imported'
type ImportDecision = string
type RowIndex = number
type ImportRecord = Record<string, any>
type ProductImportRow = ImportRecord & {
  _import_row_index?: number
  _rowNumber?: number
  _planned_action?: string
  _target_product_id?: EntityId
  _parent_id?: EntityId
  name?: string
  sku?: string
  barcode?: string
  image_conflict_mode?: string
  _identifier_conflict_mode?: string
}
type ExistingProduct = ImportRecord & {
  id?: EntityId
  parent_id?: EntityId
  name?: string
  sku?: string
  barcode?: string
  image_gallery?: unknown
  image_path?: string
}
type ProductImportConflict = ImportRecord & {
  row?: ProductImportRow
  index: number
  existing?: ExistingProduct | null
  plannedAction?: string
  conflictType?: string
  conflictFields?: string[]
  importDuplicateRows?: Record<string, number[]>
  sameBasic?: boolean
  samePricing?: boolean
  sameImages?: boolean
  incomingImages?: string[]
  existingImages?: string[]
  issueTypes?: string[]
  familyContextOnly?: boolean
  group?: ProductImportGroup | null
}
type ProductImportSubgroup = ImportRecord & {
  signature?: string
  suggestedAction?: string
  rowNumbers?: number[]
}
type ProductImportGroup = ImportRecord & {
  key?: string
  title?: string
  rowIndexes?: number[]
  rowNumbers?: number[]
  subgroups?: ProductImportSubgroup[]
}
type ProductImportAnalysis = {
  rows?: ProductImportRow[]
  cleanRows?: ProductImportRow[]
  conflicts?: ProductImportConflict[]
  groups?: ProductImportGroup[]
  decisions?: Record<RowIndex, ImportDecision>
  summary?: ProductImportSummary | null
  // Header-level, non-blocking issues (e.g. duplicate/near-duplicate CSV
  // columns) -- see productImportPlanner.ts's analyzeProductImportText.
  warnings?: string[]
}
type ProductImportSummary = ImportRecord & {
  variantCount?: number
}
type ImageFileMap = Record<string, File | string>
type BrowserImageEntry = {
  relativePath: string
  file: File
}
type CsvData = {
  name?: string
  content: string
}
type ImportJob = ImportRecord & {
  id?: EntityId
  job_id?: EntityId
  status?: string
  processed_rows?: number
  total_rows?: number
  processed_images?: number
  total_images?: number
  failed_rows?: number
  failed_images?: number
  last_error?: string
  error?: string
}
type ImportResult = {
  imported: number
  updated: number
  queued?: number
  images_matched?: number
  jobId?: EntityId | null
  job?: ImportJob | null
  cancelled?: boolean
  errors?: string[]
  message?: string
}
type ImportProgress = {
  progress: number
  label: string
}
type PreflightIssue = {
  rowNumber?: EntityId
  message?: string
  // Machine-readable warning kind (e.g. 'sku_collision', 'negative_stock')
  // for warnings, or the literal 'validation_error' for failures -- see
  // IMPORT_WARNING_LABELS in cloudflare/src/lib/importEngine.ts, which
  // `label` below is the pre-resolved human text for. Both optional so
  // this still degrades fine against an older server response that only
  // sent `message`.
  code?: string
  label?: string
}
type ServerPreflight = {
  jobId: EntityId
  checkedRows: number
  failures: PreflightIssue[]
  warnings: PreflightIssue[]
}
type ReviewUndoSnapshot = {
  label: string
  decisions: Record<RowIndex, ImportDecision>
  imageDecisions: Record<RowIndex, string>
  identifierDecisions: Record<RowIndex, string>
  identifierOverrides: Record<RowIndex, Partial<ProductImportRow>>
  rowOverrides: Record<RowIndex, Partial<ProductImportRow>>
  fieldRules: Record<string, string>
}
type FileAsset = {
  original_name?: string
  public_path?: string
}
type ProductImportApi = {
  openFolderDialog?: () => Promise<string | null | undefined>
  openCSVDialog: () => Promise<CsvData | null | undefined>
  getImportJob?: (jobId: EntityId | null | undefined) => Promise<ImportRecord | ImportJob | undefined>
  preflightImportJob: (jobId: EntityId) => Promise<ImportRecord | undefined>
  cancelImportJob: (jobId: EntityId, options?: ImportRecord) => Promise<ImportRecord | ImportJob | undefined>
  retryImportJob: (jobId: EntityId, options?: ImportRecord) => Promise<ImportRecord | ImportJob | undefined>
  deleteImportJob: (jobId: EntityId, options?: ImportRecord) => Promise<unknown>
  createImportJob: (payload: ImportRecord) => Promise<ImportRecord | ImportJob | undefined>
  uploadImportJobCsv: (payload: ImportRecord) => Promise<unknown>
  uploadImportJobZip: (payload: { jobId: EntityId; file: File }) => Promise<unknown>
  uploadImportJobImages: (payload: { jobId: EntityId; files: BrowserImageEntry[]; onProgress: (progress: ImportProgress) => void }) => Promise<unknown>
  recompressImportJobZipImages?: (jobId: EntityId, images: unknown[], onProgress?: (progress: { done: number; total: number }) => void) => Promise<{ attempted: number; compressed: number; savedBytes: number }>
  startImportJob: (jobId: EntityId, options?: ImportRecord) => Promise<unknown>
  assignImportJobImage?: (jobId: EntityId, fileId: EntityId, rowNumber: number | null) => Promise<unknown>
  assignImportJobImageToExistingProduct?: (jobId: EntityId, fileId: EntityId, productId: EntityId) => Promise<unknown>
  searchProducts?: (params: Record<string, unknown>) => Promise<unknown>
  resolveImportJobImageLimit?: (jobId: EntityId, rowNumber: number, keepFileIds: EntityId[]) => Promise<unknown>
  downloadImportTemplate: (type: string) => void
  wireImportJobImages?: (jobId: EntityId) => Promise<unknown>
  downloadImportJobErrors?: (jobId: EntityId) => void
}
type FilePickerModalProps = {
  open: boolean
  onClose: () => void
  mediaType: string
  title: string
  multiple?: boolean
  onSelectMany?: (assets: FileAsset[]) => void
}
type BulkImportModalProps = {
  onClose: () => void
  onDone?: (payload: ImportResult) => unknown | Promise<unknown>
  t?: (key: string) => string
  topMode?: Exclude<ProductImportTopMode, 'stock_actions'>
  onTopModeChange?: (mode: ProductImportTopMode) => void
}
type ProductImportError = Error & {
  code?: string
  preflight?: ServerPreflight
}
type ConflictFilterOption = {
  value: string
  label: string
  group: 'scope' | 'field' | 'status' | 'severity'
  countKey: keyof ConflictGroupCounts
  hint: string
}
type ConflictGroupCounts = {
  total: number
  sameName: number
  barcode: number
  noBarcode: number
  sku: number
  pricing: number
  existing: number
  variant: number
  merge: number
  override: number
  errors: number
}
type VisibleConflictSection = {
  key: string
  familyKey: string
  group?: ProductImportGroup
  title: string
  rowNumbers: number[]
  rows: ProductImportConflict[]
}

const FilePickerModal = FilePickerModalBase as ComponentType<FilePickerModalProps>

function getProductImportApi(): ProductImportApi {
  return (window as unknown as { api: ProductImportApi }).api
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function getBaseName(value: unknown): string {
  return String(value || '')
    .split(/[\\/]/)
    .pop()
    ?.trim()
    || ''
}

function analyzeProductCsvInWorker({
  text,
  existingProducts,
  onProgress,
}: {
  text: string
  existingProducts: ExistingProduct[]
  onProgress?: (progress: ImportProgress) => void
}): Promise<ProductImportAnalysis> {
  const runFallbackAnalysis = () => {
    onProgress?.({ progress: 15, label: 'Using browser analysis fallback' })
    return analyzeProductImportText(text, existingProducts)
  }
  if (typeof Worker === 'undefined') {
    return Promise.resolve(runFallbackAnalysis())
  }
  return new Promise<ProductImportAnalysis>((resolve, reject) => {
    const id = `product-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let worker: Worker | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      worker?.terminate()
      worker = null
    }
    const complete = (callback: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const runFallback = (error: unknown): void => {
      complete(() => {
        try {
          resolve(runFallbackAnalysis())
        } catch (fallbackError) {
          reject(fallbackError || error || new Error('Import analysis failed'))
        }
      })
    }
    try {
      worker = new Worker(new URL('./productImportWorker.ts', import.meta.url), { type: 'module' })
      timeoutId = setTimeout(() => {
        runFallback(new Error('Import analysis worker timed out'))
      }, PRODUCT_IMPORT_ANALYSIS_TIMEOUT_MS)
      worker.onmessage = (event: MessageEvent<ImportRecord>) => {
        const message = event.data || {}
        if (message.id !== id) return
        if (message.type === 'progress') {
          onProgress?.({ progress: message.progress || 0, label: message.label || '' })
          return
        }
        if (message.type === 'result') {
          complete(() => resolve(message.result))
        } else {
          runFallback(new Error(message.error || 'Import analysis failed'))
        }
      }
      worker.onerror = (error: ErrorEvent) => {
        runFallback(new Error(error?.message || 'Import analysis worker failed'))
      }
      worker.postMessage({ id, text, existingProducts })
    } catch (error) {
      runFallback(error)
    }
  })
}

/**
 * 1. CSV image reference parser.
 * 1.1 Accept legacy image_filename columns and URL/path columns.
 * 1.2 Convert paths/URLs to basename for human conflict display.
 * 1.3 Keep max MAX_PRODUCT_GALLERY_IMAGES unique names in source order --
 *     a CSV row can still carry more image_*_N columns than the cap (kept
 *     recognizing all of them for backward compatibility with older
 *     export/import templates), only the display/candidate list this
 *     produces is trimmed to the cap, matching the backend's own
 *     MAX_IMAGES_PER_PRODUCT (importImageMatch.ts) enforcement at apply
 *     time.
 */
function getIncomingImageFilenames(row: ProductImportRow = {}): string[] {
  const direct = [
    'image_filename',
    'image_filename_1', 'image_filename_2', 'image_filename_3', 'image_filename_4', 'image_filename_5',
    'image_1', 'image_2', 'image_3', 'image_4', 'image_5',
    'image_url_1', 'image_url_2', 'image_url_3', 'image_url_4', 'image_url_5',
  ]
  const candidates: string[] = []
  direct.forEach((key) => {
    const value = String(row?.[key] || '').trim()
    if (value) candidates.push(getBaseName(value))
  })
  ;['image_filenames', 'image_urls'].forEach((key) => {
    const list = String(row?.[key] || '').trim()
    if (!list) return
    list
      .split(/[|;\n]/)
      .map((item) => getBaseName(item))
      .filter(Boolean)
      .forEach((item) => candidates.push(item))
  })
  const seen = new Set<string>()
  const unique: string[] = []
  for (const item of candidates) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
    if (unique.length >= MAX_PRODUCT_GALLERY_IMAGES) break
  }
  return unique
}

function getExistingImageFilenames(product: ExistingProduct | null = {}): string[] {
  const safeProduct = product && typeof product === 'object' ? product : {}
  let gallery: unknown[] = []
  if (Array.isArray(safeProduct.image_gallery)) {
    gallery = safeProduct.image_gallery
  } else if (typeof safeProduct.image_gallery === 'string' && safeProduct.image_gallery.trim()) {
    try {
      const parsed = JSON.parse(safeProduct.image_gallery)
      gallery = Array.isArray(parsed) ? parsed : []
    } catch (_) {
      gallery = safeProduct.image_gallery.split(/[|;\n]/)
    }
  }
  const fallback = safeProduct.image_path ? [safeProduct.image_path] : []
  const source = gallery.length ? gallery : fallback
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of source) {
    const name = getBaseName(entry)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= MAX_PRODUCT_GALLERY_IMAGES) break
  }
  return names
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// Field -> translation key + English fallback. Previously this was
// [field, hardcoded label] with no i18n at all -- IMPORT_REVIEW_EDIT_FIELDS
// is a module-level constant, so it can't reach the component-scoped T()
// helper the rest of this file's 77+ other strings use, meaning this grid
// was permanently English-only regardless of km.json's completeness.
// Every key below already exists in en.json/km.json with a real Khmer
// translation (reused from ProductForm.tsx's own field labels, confirmed
// by direct lookup -- not new keys), so InlineImportDetailGrid just needs
// T threaded down to actually use them; the English fallback text matches
// this grid's previous compact wording so nothing changes if translation
// ever fails to load.
const IMPORT_REVIEW_EDIT_FIELDS: Array<[string, string, string]> = [
  ['name', 'name', 'Name'],
  ['sku', 'sku', 'SKU'],
  ['barcode', 'barcode', 'Barcode'],
  ['brand', 'brand', 'Brand'],
  ['category', 'category', 'Category'],
  ['unit', 'unit', 'Unit'],
  ['supplier', 'supplier', 'Supplier'],
  ['branch', 'branch', 'Branch'],
  ['stock_quantity', 'stock', 'Stock'],
  ['low_stock_threshold', 'low_stock_threshold', 'Low stock'],
  ['purchase_price_usd', 'purchase_price_usd', 'Cost USD'],
  ['purchase_price_khr', 'purchase_price_khr', 'Cost KHR'],
  ['selling_price_usd', 'selling_price_usd', 'Sell USD'],
  ['selling_price_khr', 'selling_price_khr', 'Sell KHR'],
  ['special_price_usd', 'special_price_usd_full', 'Special USD'],
  ['special_price_khr', 'special_price_khr_full', 'Special KHR'],
  ['discount_percent', 'discount_percent', 'Discount %'],
  ['discount_amount_usd', 'discount_amount_usd', 'Discount USD'],
  ['discount_amount_khr', 'discount_amount_khr', 'Discount KHR'],
  ['description', 'description', 'Description'],
]

const IMPORT_PRICE_FIELDS = ['purchase_price_usd', 'purchase_price_khr', 'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr']

function compactImportValue(value: unknown): string {
  const text = String(value ?? '').trim()
  return text || '-'
}

// Short "$1.50 / 6,000 KHR" style price summary for the redesigned
// conflict-row header -- the full per-field grid (with cost, discount,
// special price, etc.) still lives one click away in "More details";
// this line is just enough to recognize the product at a glance.
function compactImportPrice(row: ProductImportRow = {}): string {
  const usd = String(row?.selling_price_usd ?? '').trim()
  const khr = String(row?.selling_price_khr ?? '').trim()
  const parts: string[] = []
  if (usd) parts.push(`$${usd}`)
  if (khr) parts.push(`${khr} KHR`)
  return parts.length ? parts.join(' / ') : '-'
}

function isBlankImportValue(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

function hasPriceReviewIssue(row: ProductImportRow = {}, existing: ExistingProduct | null = null, samePricing = true): boolean {
  if (existing && samePricing === false) return true
  return IMPORT_PRICE_FIELDS.every((field) => isBlankImportValue(row?.[field]) || Number(row?.[field] || 0) === 0)
}

function getProductImportIssueLabel(issueType: unknown): string {
  if (issueType === 'barcode_scientific_notation') return 'Barcode exported as scientific notation'
  if (issueType === 'barcode_too_long') return 'Barcode too long'
  if (issueType === 'invalid_barcode') return 'Invalid barcode'
  if (issueType === 'barcode_text') return 'Barcode text'
  if (issueType === 'missing_name') return 'Missing name'
  return String(issueType || '').replaceAll('_', ' ')
}

function getProductImportIssueHint(issueType: unknown): string {
  if (issueType === 'barcode_scientific_notation') return 'Edit this barcode, clear it, or re-export the CSV with the barcode column formatted as text. Scientific notation cannot be applied safely.'
  if (issueType === 'barcode_too_long') return 'Shorten this barcode or clear it before importing.'
  if (issueType === 'invalid_barcode') return 'Remove invalid control characters or clear this barcode before importing.'
  if (issueType === 'barcode_text') return 'This barcode contains text or symbols. It can be kept if that is intentional.'
  return 'Review this row before importing.'
}

function getProductImportRowIssueDetails(entry: ProductImportConflict = { index: 0 }, editedRow: ProductImportRow = {}) {
  const details: Array<{ title: string; detail: string; blocking?: boolean }> = []
  const conflictFields = Array.isArray(entry.conflictFields) ? entry.conflictFields : []
  const duplicateRows = entry.importDuplicateRows || {}
  const barcodeIssue = getProductImportBarcodeIssue(editedRow.barcode)

  if (!normalizeImportProductName(editedRow.name)) {
    details.push({
      title: 'Product name is required',
      detail: 'Add a product name or skip this row. Rows without a name cannot create, update, or receive stock.',
    })
  }

  if (barcodeIssue) {
    details.push({
      title: barcodeIssue === 'barcode_scientific_notation' ? 'Barcode looks like scientific notation' : getProductImportIssueLabel(barcodeIssue),
      detail: getProductImportIssueHint(barcodeIssue),
      blocking: isBlockingProductImportIssue(barcodeIssue),
    })
  }

  if (conflictFields.includes('sku') || conflictFields.includes('barcode')) {
    const csvRows = [
      ...(Array.isArray(duplicateRows.sku) ? duplicateRows.sku : []),
      ...(Array.isArray(duplicateRows.barcode) ? duplicateRows.barcode : []),
    ]
    details.push({
      title: 'Duplicate SKU/barcode',
      detail: csvRows.length
        ? `Same identifier appears in CSV rows ${summarizeRowNumbers(csvRows.map((rowIndex) => Number(rowIndex) + 2))}. Clear, edit, or intentionally keep the duplicate.`
        : `Imported ${conflictFields.join(' and ')} matches ${entry.existing?.name || 'another product'}. Choose clear, edit, or keep duplicate before applying.`,
    })
  }

  if (hasPriceReviewIssue(editedRow, entry.existing, entry.samePricing)) {
    details.push({
      title: 'Price/cost needs review',
      detail: entry.existing && entry.samePricing === false
        ? 'Imported price or cost differs from the matched product. Choose whether to keep existing details, fill blanks only, or use imported values.'
        : 'All price/cost columns are blank or zero. Confirm that is intentional before applying this row.',
    })
  }

  ;(entry.issueTypes || []).forEach((issueType) => {
    if (issueType === 'missing_name' || issueType === barcodeIssue) return
    details.push({
      title: getProductImportIssueLabel(issueType),
      detail: getProductImportIssueHint(issueType),
      blocking: isBlockingProductImportIssue(issueType),
    })
  })

  return details
}

function valuesDiffer(left: unknown, right: unknown): boolean {
  return String(left ?? '').trim().normalize('NFC') !== String(right ?? '').trim().normalize('NFC')
}

// Part 242: only strip a leading "folder/" when the value actually looks
// like a file path (ends in a real extension) -- previously this always
// split on '/' or '\' and kept just the last segment, which silently
// truncated a product name containing a literal '/' as real content
// (e.g. "10/20ml" became "20ml"). Any '/' or '\' that's still present
// after that decision (a real one inside a name, or what's left of a
// relative path once its own leading folder is gone) gets folded into a
// space below, same as '_'/'-' already were -- see
// cloudflare/src/lib/importImageMatch.ts's normalizeImageMatchKey for
// the backend twin of this exact fix and fuller rationale.
function normalizeImageMatchKey(value: unknown): string {
  const text = String(value || '')
  const looksLikeFilePath = /\.[a-zA-Z0-9]{1,6}$/.test(text)
  const base = looksLikeFilePath ? (text.split(/[\\/]/).pop() ?? text) : text
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-/\\]+/g, ' ')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    || ''
}

function getImageReference(entryKey: unknown, entryValue: unknown): string {
  const textValue = typeof entryValue === 'string' ? entryValue.trim() : ''
  if (textValue && (/^data:image\//i.test(textValue) || /^https?:\/\//i.test(textValue) || textValue.startsWith('/uploads/') || textValue.startsWith('uploads/'))) {
    return textValue.startsWith('uploads/') ? `/${textValue}` : textValue
  }
  const fileName = typeof File !== 'undefined' && entryValue instanceof File ? entryValue.name : ''
  return getBaseName(entryKey || textValue || fileName || '')
}

function findImageReferenceForRow(row: ProductImportRow = {}, imageFiles: ImageFileMap = {}): string {
  const keys = [row.name, row.sku, row.barcode].map(normalizeImageMatchKey).filter(Boolean)
  if (!keys.length) return ''
  for (const [entryKey, entryValue] of Object.entries(imageFiles || {})) {
    const fileName = typeof File !== 'undefined' && entryValue instanceof File ? entryValue.name : ''
    const imageKey = normalizeImageMatchKey(entryKey || fileName || '')
    if (imageKey && keys.includes(imageKey)) return getImageReference(entryKey, entryValue)
  }
  return ''
}

function getDecisionLabel(value: unknown): string {
  return IMPORT_DECISION_OPTIONS.find((item) => item.value === value)?.label || String(value || 'Action')
}

function getFamilyKeyForRow(row: ProductImportRow = {}): string {
  return normalizeImportProductName(row?.name) || `row:${Number(row?._import_row_index ?? row?._rowNumber ?? 0)}`
}

function summarizeRowNumbers(rowNumbers: unknown[] = []): string {
  const unique = Array.from(new Set((Array.isArray(rowNumbers) ? rowNumbers : []).map((value) => Number(value)).filter(Boolean))).sort((left, right) => left - right)
  if (!unique.length) return '-'
  if (unique.length <= 4) return unique.join(', ')
  return `${unique.slice(0, 3).join(', ')} +${unique.length - 3}`
}

function summarizeSubgroup(subgroup: ProductImportSubgroup = {}, index = 0): string {
  const label = getDecisionLabel(subgroup.suggestedAction || 'new')
  return `Case ${index + 1}: ${label} - rows ${summarizeRowNumbers(subgroup.rowNumbers)}`
}

function getImportActionTargetSummary(entry: ProductImportConflict = { index: 0 }, decisionValue = '', editedRow: ProductImportRow = {}): string {
  const existing = entry.existing || null
  const action = String(decisionValue || entry.plannedAction || editedRow?._planned_action || 'new')
  const row = { ...(entry.row || {}), ...(editedRow || {}) }
  const targetId = row._target_product_id || entry.row?._target_product_id || existing?.id || ''
  const parentId = row._parent_id || entry.row?._parent_id || existing?.parent_id || ''
  const existingName = existing?.name || (targetId ? `product #${targetId}` : '')
  const familyName = row.name || existing?.name || 'this family'

  if (action === 'merge_stock') {
    if (existingName) return `Add stock to ${existingName}${targetId ? ` (#${targetId})` : ''}`
    if (targetId) return `Add stock to product #${targetId}`
    return `Add stock to the matching ${familyName} row in this family`
  }
  if (action === 'create_variant') {
    if (parentId) return `Create a variant under parent #${parentId}`
    if (existingName) return `Create a variant under ${existingName}`
    return `Create a new variant inside the ${familyName} family`
  }
  if (action === 'link_variant') {
    if (targetId) return `Link this row to existing variant #${targetId}`
    return `Link this row to the matched family variant`
  }
  if (action === 'override_add') {
    return existingName ? `Update ${existingName} and add incoming stock` : `Update matched target and add incoming stock`
  }
  if (action === 'override_replace') {
    return existingName ? `Replace details on ${existingName}` : `Replace details on matched target`
  }
  if (action === 'skip_row') return 'Skip this CSV row; no product or stock change will apply'
  return `Create a new product row for ${familyName}`
}

function createFamilyContextEntry(row: ProductImportRow = {}, rowIndex = 0, group: ProductImportGroup | null = null): ProductImportConflict {
  const safeRow = row && typeof row === 'object' ? row : {}
  const index = Number(rowIndex ?? safeRow._import_row_index ?? 0)
  return {
    row: safeRow,
    index,
    existing: null,
    plannedAction: safeRow._planned_action || 'new',
    conflictType: 'same_name_family_context',
    conflictFields: [],
    importDuplicateRows: {},
    sameBasic: true,
    samePricing: true,
    sameImages: true,
    incomingImages: getIncomingImageFilenames(safeRow),
    existingImages: [],
    familyContextOnly: true,
    group,
  }
}

function buildVisibleFamilyRows(
  group: ProductImportGroup | null | undefined,
  conflictsByIndex: Map<number, ProductImportConflict>,
  importRowsByIndex: Map<number, ProductImportRow>,
): ProductImportConflict[] {
  const rowIndexes = Array.isArray(group?.rowIndexes) ? group.rowIndexes : []
  return rowIndexes
    .map((rowIndex) => {
      const index = Number(rowIndex)
      if (!Number.isFinite(index)) return null
      const conflictEntry = conflictsByIndex.get(index)
      if (conflictEntry) return conflictEntry
      const row = importRowsByIndex.get(index)
      return row ? createFamilyContextEntry(row, index, group) : null
    })
    .filter((entry): entry is ProductImportConflict => !!entry?.row)
    .sort((left, right) => Number(left?.row?._rowNumber || left?.index || 0) - Number(right?.row?._rowNumber || right?.index || 0))
}

function InlineImportDetailGrid({
  row = {},
  compareTo = null,
  onBeginEdit,
  onChange,
  T,
}: {
  row?: ProductImportRow
  compareTo?: ExistingProduct | null
  onBeginEdit?: (field: string) => void
  onChange?: (field: string, value: string) => void
  T: (key: string, fallback: string) => string
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {IMPORT_REVIEW_EDIT_FIELDS.map(([field, labelKey, labelFallback]) => {
        const label = T(labelKey, labelFallback)
        const differs = compareTo && valuesDiffer(row?.[field], compareTo?.[field])
        const hint = differs
          ? `${label} differs. Existing: ${compactImportValue(compareTo?.[field])}. Click the field to edit the imported value.`
          : `${label}. Click to edit the imported value.`
        return (
          <label
            key={field}
            className={`group relative min-w-0 rounded-lg border px-2 py-1.5 ${differs ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}
            title={hint}
          >
            <span className="mb-1 block truncate text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">{label}</span>
            <input
              className="w-full min-w-0 border-0 bg-transparent p-0 text-xs font-medium text-slate-800 outline-none focus:ring-0 dark:text-slate-100"
              value={row?.[field] ?? ''}
              onFocus={() => onBeginEdit?.(field)}
              onChange={(event) => onChange?.(field, event.target.value)}
            />
            {differs ? (
              <span className="mt-1 block truncate text-[10px] text-amber-700 dark:text-amber-200">Existing: {compactImportValue(compareTo?.[field])}</span>
            ) : null}
          </label>
        )
      })}
    </div>
  )
}

// Shape of currentJob.summary.imageMatch as returned by the server
// (see cloudflare/src/lib/importEngine.ts's ImportImageMatchSummaryJson).
type ImageMatchUnmatchedEntry = { id: number | string; originalName: string; publicPath: string }
type ImageMatchOverLimitImage = { id: number | string; originalName: string; publicPath: string; score: number; kept: boolean }
type ImageMatchOverLimitEntry = { rowNumber: number | string; productName: string; limit: number; images: ImageMatchOverLimitImage[] }
type ImageMatchSummaryData = { matchedCount?: number; unmatched?: ImageMatchUnmatchedEntry[]; overLimit?: ImageMatchOverLimitEntry[] }

// Search-and-assign row picker for an unmatched image -- filters this
// import's own CSV rows by name as the operator types, since the image
// needs to attach to a product actually in this import (create or
// update), not an arbitrary existing catalog product.
function ImageRowPicker({
  rows,
  onPick,
  T,
}: {
  rows: ProductImportRow[]
  onPick: (rowNumber: number) => void
  T: (key: string, fallback: string) => string
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const named = rows.filter((row) => String(row?.name || '').trim())
    if (!needle) return named.slice(0, 8)
    return named.filter((row) => String(row?.name || '').toLowerCase().includes(needle)).slice(0, 8)
  }, [rows, query])
  return (
    <div className="relative">
      <input
        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
        placeholder={T('search_product_name_in_import', 'Search product name in this import...')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length ? (
        <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {matches.map((row) => (
            <button
              key={row._rowNumber}
              type="button"
              className="block w-full truncate px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => onPick(Number(row._rowNumber))}
            >
              {T('row_label', 'Row {n}').replace('{n}', String(row._rowNumber))}: {row.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Search-and-assign picker for an unmatched image, against the LIVE
// catalog rather than this import's own rows -- for a stray photo, or
// an image-only import where the operator just wants to add a picture
// to a product that already exists (no row here needs it, so
// ImageRowPicker's list would come up empty). Debounced server search
// via GET /api/products/search (the same endpoint the Products page's
// own filter bar uses), since the catalog can be far larger than what's
// reasonable to filter client-side.
function ExistingProductSearchPicker({
  onPick,
  T,
}: {
  onPick: (product: { id: number; name: string }) => void
  T: (key: string, fallback: string) => string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ id: number; name: string }>>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const needle = text.trim()
    if (!needle) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const payload = await getProductImportApi().searchProducts?.({ query: needle, pageSize: 8 })
        const items = (payload as { items?: Array<{ id: number; name: string }> } | null)?.items
        setResults(Array.isArray(items) ? items : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  return (
    <div className="relative">
      <input
        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
        placeholder={T('search_existing_catalog_products', 'Search existing catalog products...')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          runSearch(event.target.value)
        }}
      />
      {loading ? <div className="mt-1 text-[11px] text-slate-400">{T('searching', 'Searching...')}</div> : null}
      {results.length ? (
        <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              className="block w-full truncate px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => onPick(product)}
            >
              {product.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Review-step panel for the two image conflict types computeImportImageMatch
// (importEngine.ts) surfaces beyond ordinary per-row conflicts:
//   1. Images that matched no product at all (search + assign manually).
//   2. A product that best-fit-matched MORE than MAX_IMAGES_PER_PRODUCT (3)
//      images -- shows all candidates so the operator picks which win.
// Both write to the job's policy_json via PATCH endpoints and rely on the
// caller to re-run analyze so the change is reflected before Approve.
function ImageMatchReviewPanel({
  jobId,
  imageMatch,
  rows,
  onResolved,
  T,
}: {
  jobId: EntityId | null | undefined
  imageMatch: ImageMatchSummaryData | null | undefined
  rows: ProductImportRow[]
  onResolved: () => void | Promise<void>
  T: (key: string, fallback: string) => string
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [searchModeByImage, setSearchModeByImage] = useState<Record<string, 'import' | 'catalog'>>({})
  const unmatched = imageMatch?.unmatched || []
  const overLimit = imageMatch?.overLimit || []
  if (!jobId || (!unmatched.length && !overLimit.length)) return null

  const runAssign = async (fileId: number | string, rowNumber: number) => {
    setBusyId(String(fileId))
    try {
      await getProductImportApi().assignImportJobImage?.(jobId, fileId, rowNumber)
      await onResolved()
    } finally {
      setBusyId(null)
    }
  }

  // Same underlying "resolve this unmatched image" action as runAssign,
  // just against a live catalog product instead of a row in this job's
  // own CSV -- see /:id/images/assign-existing's comment for why this
  // takes effect immediately rather than waiting on job approval.
  const runAssignExisting = async (fileId: number | string, product: { id: number; name: string }) => {
    setBusyId(String(fileId))
    try {
      await getProductImportApi().assignImportJobImageToExistingProduct?.(jobId, fileId, product.id)
      await onResolved()
    } finally {
      setBusyId(null)
    }
  }

  const runLimitResolve = async (rowNumber: number | string, keepIds: Array<number | string>) => {
    setBusyId(`limit:${rowNumber}`)
    try {
      await getProductImportApi().resolveImportJobImageLimit?.(jobId, Number(rowNumber), keepIds)
      await onResolved()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mb-4 space-y-3">
      {unmatched.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="mb-2 font-semibold text-amber-800 dark:text-amber-100">
            {unmatched.length} image{unmatched.length === 1 ? '' : 's'} didn't match any product automatically
          </div>
          <div className="space-y-2">
            {unmatched.map((image) => (
              <div key={image.id} className="flex items-center gap-3 rounded-lg border border-amber-200/70 bg-white p-2 dark:border-amber-900/40 dark:bg-slate-900">
                <img src={image.publicPath} alt={image.originalName} className="h-10 w-10 flex-none rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-700 dark:text-slate-200">{image.originalName}</div>
                  <div className="mb-1 flex gap-1 text-[10px]">
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 ${(searchModeByImage[String(image.id)] || 'import') === 'import' ? 'bg-slate-200 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-100' : 'text-slate-400'}`}
                      onClick={() => setSearchModeByImage((prev) => ({ ...prev, [String(image.id)]: 'import' }))}
                    >
                      {T('this_import', 'This import')}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 ${searchModeByImage[String(image.id)] === 'catalog' ? 'bg-slate-200 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-100' : 'text-slate-400'}`}
                      onClick={() => setSearchModeByImage((prev) => ({ ...prev, [String(image.id)]: 'catalog' }))}
                    >
                      {T('existing_catalog', 'Existing catalog')}
                    </button>
                  </div>
                  {(searchModeByImage[String(image.id)] || 'import') === 'import' ? (
                    <ImageRowPicker rows={rows} onPick={(rowNumber) => runAssign(image.id, rowNumber)} T={T} />
                  ) : (
                    <ExistingProductSearchPicker onPick={(product) => runAssignExisting(image.id, product)} T={T} />
                  )}
                </div>
                {busyId === String(image.id) ? <span className="flex-none text-slate-400">{T('saving', 'Saving...')}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {overLimit.map((entry) => (
        <div key={entry.rowNumber} className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900/50 dark:bg-blue-950/30">
          <div className="mb-2 font-semibold text-blue-800 dark:text-blue-100">
            "{entry.productName}" matched {entry.images.length} images -- only {entry.limit} can be kept. Pick which ones.
          </div>
          <ImageLimitPicker
            entry={entry}
            busy={busyId === `limit:${entry.rowNumber}`}
            onSave={(keepIds) => runLimitResolve(entry.rowNumber, keepIds)}
          />
        </div>
      ))}
    </div>
  )
}

function ImageLimitPicker({
  entry,
  busy,
  onSave,
}: {
  entry: ImageMatchOverLimitEntry
  busy: boolean
  onSave: (keepIds: Array<number | string>) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entry.images.filter((img) => img.kept).map((img) => String(img.id))))
  const toggle = (id: number | string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const key = String(id)
      if (next.has(key)) next.delete(key)
      else if (next.size < entry.limit) next.add(key)
      return next
    })
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {entry.images.map((image) => {
          const isSelected = selected.has(String(image.id))
          return (
            <label
              key={image.id}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-1.5 ${isSelected ? 'border-blue-500 bg-white dark:bg-slate-900' : 'border-transparent opacity-60'}`}
            >
              <input type="checkbox" className="sr-only" checked={isSelected} onChange={() => toggle(image.id)} />
              <img src={image.publicPath} alt={image.originalName} className="h-14 w-14 rounded object-cover" />
              <span className="max-w-[4.5rem] truncate text-[10px]">{image.originalName}</span>
            </label>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-slate-500">{selected.size} / {entry.limit} selected</span>
        <button
          type="button"
          className="btn-primary px-2 py-1 text-[11px]"
          disabled={busy || selected.size === 0}
          onClick={() => onSave(Array.from(selected))}
        >
          {busy ? 'Saving...' : 'Save selection'}
        </button>
      </div>
    </div>
  )
}

function buildImageOnlyCsv(imageFiles: ImageFileMap = {}): string {
  const rows = Object.entries(imageFiles || {})
    .filter(Boolean)
    .map(([name, value]) => [
      getBaseName(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(),
      getImageReference(name, value),
    ])
  return [
    'name,image_filename_1,image_conflict_mode,_action',
    ...rows.map(([name, fileName]) => [
      csvEscape(name || fileName),
      csvEscape(fileName),
      'append_csv',
      'merge_stock',
    ].join(',')),
  ].join('\n')
}

function getBrowserImageEntries(imageFiles: ImageFileMap = {}): BrowserImageEntry[] {
  return Object.entries(imageFiles || {})
    .filter((entry): entry is [string, File] => typeof File !== 'undefined' && entry[1] instanceof File)
    .map(([relativePath, file]) => ({
      relativePath: relativePath || file.webkitRelativePath || file.name,
      file,
    }))
}

export default function BulkImportModal({ onClose, onDone, t, topMode = 'general', onTopModeChange }: BulkImportModalProps) {
  const { notify, hasPermission } = useApp()
  // Server-side gate lives in routes/importJobs.ts (requires the
  // 'destructive_delete' permission, not just ordinary products-import
  // access, for BOTH destructive modes -- replace_all and replace_columns
  // -- see that file for why). Hiding the tiles here for anyone who
  // doesn't hold it is a UX nicety on top of that real gate, not a
  // replacement for it: someone without this permission would otherwise
  // see a mode they can pick but always get a 403 on.
  const canReplaceAll = hasPermission('destructive_delete')
  const mode: ImportMode = topMode === 'images' ? 'images' : 'products'
  const [step, setStep] = useState(1)
  const [showColumnsInfo, setShowColumnsInfo] = useState(false)
  const [csvData, setCsvData] = useState<CsvData | null>(null)
  // Visual-only (border highlight while a drag is over the drop target).
  // The actual file handoff happens in handleDropCSV via onDrop, same
  // split as CsvImportPreview's drag handling.
  const [isDragActive, setIsDragActive] = useState(false)
  const [imageDir, setImageDir] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<ImageFileMap>({})
  const [wireImagesState, setWireImagesState] = useState<'idle' | 'working' | 'wired'>('idle')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [conflicts, setConflicts] = useState<ProductImportConflict[]>([])
  const [cleanRows, setCleanRows] = useState<ProductImportRow[]>([])
  const [importRows, setImportRows] = useState<ProductImportRow[]>([])
  const [reviewGroups, setReviewGroups] = useState<ProductImportGroup[]>([])
  const [analysisSummary, setAnalysisSummary] = useState<ProductImportSummary | null>(null)
  // Header-level, non-blocking issues found while parsing the file itself
  // (e.g. duplicate/near-duplicate column headers) -- separate from
  // `conflicts`/row `errors`, which are about the data, not the header row.
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([])
  // Item 10a's first real wiring: once an "Add / Update Products" file is
  // parsed, check whether it actually looks like a dated stock-count
  // snapshot (same product+branch on 2+ distinct dates) rather than a
  // plain one-row-per-product file -- see importModeDetection.ts for why
  // this is surfaced as a dismissible suggestion, not an automatic
  // switch (the two import paths have genuinely different parse
  // semantics, so silently redirecting the file would be wrong). Reset
  // alongside every other per-file analysis state in analyzePickedCsv.
  const [datedReconciliationSignal, setDatedReconciliationSignal] = useState<ImportModeDetectionResult | null>(null)
  const [dismissedDatedSignal, setDismissedDatedSignal] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<ImportProgress | null>(null)
  const [decisions, setDecisions] = useState<Record<RowIndex, ImportDecision>>({})
  const [imageDecisions, setImageDecisions] = useState<Record<RowIndex, string>>({})
  const [identifierDecisions, setIdentifierDecisions] = useState<Record<RowIndex, string>>({})
  const [identifierOverrides, setIdentifierOverrides] = useState<Record<RowIndex, Partial<ProductImportRow>>>({})
  const [rowOverrides, setRowOverrides] = useState<Record<RowIndex, Partial<ProductImportRow>>>({})
  const [conflictFilter, setConflictFilter] = useState('all')
  const [conflictQuery, setConflictQuery] = useState('')
  const [selectedConflictIds, setSelectedConflictIds] = useState<Set<RowIndex>>(() => new Set())
  const [collapsedFamilyKeys, setCollapsedFamilyKeys] = useState<Set<string>>(() => new Set())
  const [expandedDetailRows, setExpandedDetailRows] = useState<Set<RowIndex>>(() => new Set())
  const [reviewUndoStack, setReviewUndoStack] = useState<ReviewUndoSnapshot[]>([])
  const [fieldRules, setFieldRules] = useState<Record<string, string>>({})
  // 'merge' (default): add/update into the existing catalog, same identity
  // matching classifyProducts always does. 'replace_columns': matched rows
  // overwrite only the operator-selected column groups below, everything
  // else on the matched product stays untouched (cloudflare/src/lib/
  // importEngine.ts's productImportMode==='replace_columns' block --
  // added Part 320/321). 'replace_all': this file becomes the complete
  // current catalog -- matched rows still update in place, but every
  // active product this import doesn't touch gets soft-deactivated at the
  // end (importEngine.ts's replace_all block; not a hard delete, so old
  // sales/movement history stays intact, same as the existing single-
  // product delete). See the mode picker in the products upload card
  // below for the confirmation copy shown before either destructive mode
  // can run.
  // 'fill_blank' (added alongside merge/replace_columns/replace_all): a
  // fourth, non-destructive mode -- for a matched row, only fields the
  // existing product doesn't already have a value for get filled in from
  // this file; anything already on file stays as-is. Quantity is always
  // ignored in this mode (see importEngine.ts's ProductImportMode doc
  // comment) since a supplementary "fill in missing details" file's
  // quantity column is usually stale/unrelated, not a real stock update.
  // Available to everyone (unlike the two replace_* modes below, gated on
  // destructive_delete) since it can only ever add information to an
  // already-blank field, never overwrite or remove anything.
  const [importMode, setImportMode] = useState<'merge' | 'fill_blank' | 'replace_columns' | 'replace_all'>(topMode === 'replace' ? 'replace_columns' : 'merge')
  const [replaceColumnGroupKeys, setReplaceColumnGroupKeys] = useState<Set<string>>(() => new Set())
  // Flattened column list the actually-selected groups expand to -- this,
  // not the group keys, is what the backend's allow-list
  // (PRODUCT_REPLACE_COLUMNS) expects on the wire.
  const selectedReplaceColumns = REPLACE_COLUMN_GROUPS
    .filter((group) => replaceColumnGroupKeys.has(group.key))
    .flatMap((group) => group.columns)
  const toggleReplaceColumnGroup = (key: string) => {
    setReplaceColumnGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const [result, setResult] = useState<ImportResult | null>(null)
  const [currentJob, setCurrentJob] = useState<ImportJob | null>(null)
  const [serverPreflight, setServerPreflight] = useState<ServerPreflight | null>(null)
  const [loading, setLoading] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const cancelRequestedRef = useRef(false)
  const editSessionRef = useRef<Set<string>>(new Set())
  const actionInFlightRef = useRef('')

  // t() returns the raw key itself (never undefined/empty) on a miss, and
  // this previously returned t(key) unconditionally whenever t was a
  // function -- fallback was dead code for every real call. Compare
  // against the key to detect a genuine miss, same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const T = (key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : undefined
    return value && value !== key ? value : fallback
  }
  const signalDone = async (payload: ImportResult): Promise<void> => {
    if (typeof onDone === 'function') {
      await Promise.resolve(onDone(payload))
    }
  }

  // Once the CSV/images are uploaded and the server-side analyze job is
  // queued, there is nothing left for this modal to usefully show: the
  // previous "step 3" screen at this point always displayed hardcoded
  // imported:0/updated:0 counts (the real numbers only exist after the
  // background job is analyzed and approved), so it was a dead-end
  // confirmation screen requiring an extra "Close" click before the person
  // could go find the real progress in the top-right import tracker anyway.
  // Hand off directly instead: close this modal and surface a toast that
  // points at the tracker, which is where the actual per-row decision
  // ("Approve import") and live progress/result counts live.
  const handOffToBackgroundTracker = async (payload: ImportResult): Promise<void> => {
    await signalDone(payload)
    notify(
      payload.message || T('import_queued_notice', '{n} item(s) queued for review. Approve the import from the tracker in the top-right corner to apply it.').replace('{n}', String(payload.queued || 0)),
      'info',
    )
    onClose()
  }

  // uploadImportJobZip's response carries per-entry extraction results
  // (routes/importJobs.ts's POST /:id/zip: `note`, `failed_images`) that
  // both call sites below previously discarded entirely -- a ZIP that
  // failed to parse, or had a handful of entries that failed to extract,
  // uploaded "successfully" (stored the ZIP itself, HTTP 200) with zero
  // indication to the person that some/all of their images never actually
  // made it in, until they noticed a product missing its photo much later
  // with no link back to why. Surface it as a warning toast right away,
  // next to the (still separate) "N item(s) queued for review" success
  // toast that follows once the whole import finishes.
  const notifyZipUploadIssues = (result: unknown): void => {
    const payload = result as { note?: unknown; failed_images?: Array<{ file_name?: unknown }>; images?: unknown[] } | null
    const failedCount = Array.isArray(payload?.failed_images) ? payload.failed_images.length : 0
    const noteText = typeof payload?.note === 'string' ? payload.note : ''
    const zipUnreadable = /could not be read/i.test(noteText)
    if (zipUnreadable) {
      notify(noteText || T('zip_unreadable', 'The ZIP file could not be read; no images were extracted from it.'), 'warning')
      return
    }
    if (failedCount > 0) {
      notify(
        T('zip_partial_extract_failed', '{n} image(s) inside the ZIP could not be extracted and were skipped.').replace('{n}', String(failedCount)),
        'warning',
      )
    }
  }

  // Closes the "bulk ZIP-import image attach path has zero compression"
  // gap: uploadImportJobZip stores every extracted image at full,
  // uncompressed size (no `sharp`/native image lib exists in the Workers
  // runtime to compress it server-side -- see routes/importJobs.ts's
  // /:id/images/:fileId/recompress for the full explanation). Manual
  // uploads and the direct per-file import path both compress in the
  // browser BEFORE the bytes are sent; a ZIP's contents only become
  // individually available to the browser AFTER the server extracts and
  // stores them, so the fix has to be this round-trip: fetch each stored
  // image back, recompress it the same way, and re-upload only the ones
  // that actually shrank. Best-effort and non-blocking -- runs after the
  // ZIP upload's own success/warning toast, never throws (any failure is
  // swallowed inside recompressImportJobZipImages itself), and never
  // holds up the rest of the import.
  const recompressZipImages = async (jobId: EntityId, zipResult: unknown): Promise<void> => {
    const images = (zipResult as { images?: unknown[] } | null)?.images
    if (!Array.isArray(images) || !images.length) return
    const recompress = getProductImportApi().recompressImportJobZipImages
    if (!recompress) return
    try {
      setAnalysisProgress({ progress: 15, label: 'Compressing imported images' })
      const outcome = await recompress(jobId, images, ({ done, total }) => {
        setAnalysisProgress({ progress: 10 + Math.round((done / Math.max(total, 1)) * 10), label: `Compressing imported images ${done} / ${total}` })
      })
      if (outcome?.compressed) {
        const savedMb = (outcome.savedBytes / (1024 * 1024)).toFixed(1)
        notify(
          T('zip_images_compressed', '{n} imported image(s) compressed, saving ~{mb} MB.')
            .replace('{n}', String(outcome.compressed))
            .replace('{mb}', savedMb),
          'info',
        )
      }
    } catch (_) {
      // Never let a best-effort size optimization block or fail the import.
    }
  }

  const throwIfImportCancelled = (): void => {
    if (!cancelRequestedRef.current) return
    const error = new Error(T('import_cancelled', 'Import cancelled.')) as ProductImportError
    error.code = 'import_cancel_requested'
    throw error
  }

  const isCancelledStartError = (error: unknown): boolean => /import was cancelled|retry before starting/i.test(getErrorMessage(error, String(error || '')))

  const beginImportAction = (action: ImportActionName, options: { setLoading?: boolean } = {}): boolean => {
    if (!beginNamedAction(actionInFlightRef, action, { blocked: loading })) return false
    if (options.setLoading !== false) setLoading(true)
    return true
  }

  const finishImportAction = (action: ImportActionName): void => {
    finishNamedAction(actionInFlightRef, action)
    setLoading(false)
  }

  const setCancelledResult = async (jobId: EntityId | null | undefined = currentJob?.id, error: unknown = null): Promise<void> => {
    let job = currentJob
    const api = getProductImportApi()
    if (jobId && api.getImportJob) {
      try {
        const payload = await withLoaderTimeout(
          () => api.getImportJob?.(jobId),
          'Product import job status',
          IMPORT_JOB_STATUS_TIMEOUT_MS,
        )
        job = (payload?.job || payload || job) as ImportJob | null
        if (job) setCurrentJob(job)
      } catch (_) {}
    }
    const message = getErrorMessage(error, T('import_cancelled', 'Import cancelled.'))
    setResult({
      imported: 0,
      updated: 0,
      queued: 0,
      jobId,
      job,
      cancelled: true,
      errors: error ? [message] : [],
      message,
    })
    setStep(3)
  }

  const createReviewSnapshot = (label: string): ReviewUndoSnapshot => ({
    label,
    decisions,
    imageDecisions,
    identifierDecisions,
    identifierOverrides,
    rowOverrides,
    fieldRules,
  })

  const pushReviewUndoSnapshot = (label: string): void => {
    setReviewUndoStack((stack) => [...stack.slice(-19), createReviewSnapshot(label)])
  }

  const undoLastReviewChange = (): void => {
    setReviewUndoStack((stack) => {
      const snapshot = stack[stack.length - 1]
      if (!snapshot) return stack
      setDecisions(snapshot.decisions || {})
      setImageDecisions(snapshot.imageDecisions || {})
      setIdentifierDecisions(snapshot.identifierDecisions || {})
      setIdentifierOverrides(snapshot.identifierOverrides || {})
      setRowOverrides(snapshot.rowOverrides || {})
      setFieldRules(snapshot.fieldRules || {})
      editSessionRef.current = new Set()
      return stack.slice(0, -1)
    })
  }

  const beginInlineEdit = (rowIndex: RowIndex, field: string, label = 'Edited row details'): void => {
    const key = `${rowIndex}:${field}`
    setExpandedDetailRows((current) => {
      if (current.has(rowIndex)) return current
      const next = new Set(current)
      next.add(rowIndex)
      return next
    })
    if (editSessionRef.current.has(key)) return
    editSessionRef.current.add(key)
    pushReviewUndoSnapshot(label)
  }

  const resetCsvState = () => {
    setCsvData(null)
    setConflicts([])
    setCleanRows([])
    setImportRows([])
    setReviewGroups([])
    setAnalysisSummary(null)
    setAnalysisProgress(null)
    setDecisions({})
    setImageDecisions({})
    setIdentifierDecisions({})
    setIdentifierOverrides({})
    setRowOverrides({})
    setConflictFilter('all')
    setConflictQuery('')
    setSelectedConflictIds(new Set())
    setCollapsedFamilyKeys(new Set())
    setExpandedDetailRows(new Set())
    setReviewUndoStack([])
    setFieldRules({})
    setZipFile(null)
    setCurrentJob(null)
    setServerPreflight(null)
    editSessionRef.current = new Set()
    cancelRequestedRef.current = false
    setStep(1)
  }

  const pickImageDirectory = async () => {
    const folder = await getProductImportApi().openFolderDialog?.()
    if (folder) {
      setImageDir(folder)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.multiple = true
    input.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement | null
      const files = Array.from(target?.files || []).filter((file) => file.type.startsWith('image/'))
      if (!files.length) return
      const map: ImageFileMap = {}
      files.forEach((file) => {
        map[file.webkitRelativePath || file.name] = file
      })
      setImageFiles(map)
      const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Folder'
      setImageDir(`${folderName} (${files.length})`)
    }
    input.click()
  }

  const applyZipFile = (file: File) => {
    setZipFile(file)
    setImageDir(`${file.name} (${Math.ceil(file.size / 1024 / 1024)} MB ZIP)`)
  }

  const pickImageZip = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip,application/x-zip-compressed'
    input.onchange = (event: Event) => {
      const target = event.target as HTMLInputElement | null
      const file = target?.files?.[0]
      if (!file) return
      applyZipFile(file)
    }
    input.click()
  }

  // Drag-and-drop counterpart to pickImageZip -- same applyZipFile path,
  // just a File handed over by the browser's drop event instead of the
  // native file dialog. Only handles a dropped .zip; a dropped *folder*
  // still needs Browse (folder drops need DataTransferItem.webkitGetAsEntry
  // directory traversal, a bigger separate feature, not attempted here).
  const [isImageDragActive, setIsImageDragActive] = useState(false)
  const handleImageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    event.stopPropagation()
    setIsImageDragActive(true)
  }
  const handleImageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    setIsImageDragActive(false)
  }
  const handleImageDropEvent = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    event.stopPropagation()
    setIsImageDragActive(false)
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    const looksLikeZip = file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.toLowerCase().endsWith('.zip')
    if (!looksLikeZip) {
      notify(T('zip_drop_wrong_type', 'Drop a .zip file here, or use Browse to pick a folder instead.'), 'warning')
      return
    }
    applyZipFile(file)
  }

  const addLibraryImages = (assets: FileAsset[] = []) => {
    const safeAssets = Array.isArray(assets) ? assets : []
    if (!safeAssets.length) return
    setImageFiles((current) => {
      const next = { ...current }
      safeAssets.forEach((asset) => {
        const fileName = String(asset?.original_name || '').trim()
        const publicPath = String(asset?.public_path || '').trim()
        if (!fileName || !publicPath) return
        next[fileName] = publicPath
      })
      setImageDir(`Files library (${Object.keys(next).length})`)
      return next
    })
  }

  const buildCsvForImportJob = (): string => {
    const rows = importRows.length ? importRows : analyzeProductImportText(csvData?.content || '', []).rows
    const instructions = rows.map((row, index) => {
      const rowIndex = Number(row?._import_row_index ?? index)
      const action = decisions[rowIndex] || row?._planned_action || 'new'
      const editedRow = {
        ...row,
        ...(rowOverrides[rowIndex] || {}),
        sku: identifierOverrides[rowIndex]?.sku ?? row.sku,
        barcode: identifierOverrides[rowIndex]?.barcode ?? row.barcode,
      }
      const matchedImageRef = getIncomingImageFilenames(editedRow).length ? '' : findImageReferenceForRow(editedRow, imageFiles)
      return {
        ...editedRow,
        ...(matchedImageRef ? { image_filename_1: matchedImageRef } : {}),
        _action: action,
        image_conflict_mode: imageDecisions[rowIndex] || row?.image_conflict_mode || (getIncomingImageFilenames(editedRow).length || matchedImageRef ? 'replace_with_csv' : 'keep_existing'),
        _field_rules: JSON.stringify(fieldRules || {}),
        _identifier_conflict_mode: identifierDecisions[rowIndex] || row?._identifier_conflict_mode || 'clear_imported',
        _target_product_id: row?._target_product_id || '',
        _parent_id: row?._parent_id || '',
      }
    })
    const headers = Array.from(instructions.reduce((set: Set<string>, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key))
      return set
    }, new Set(['name', 'sku', 'barcode', '_action', '_target_product_id', '_parent_id', '_field_rules', '_identifier_conflict_mode', 'image_conflict_mode'])))
    return [
      headers.join(','),
      ...instructions.map((row) => headers.map((header) => csvEscape((row as ImportRecord)?.[header])).join(',')),
    ].join('\n')
  }

  const ensureServerPreflightReady = async (jobId: EntityId): Promise<ImportRecord | undefined> => {
    const api = getProductImportApi()
    const preflight = await withLoaderTimeout(
      () => api.preflightImportJob(jobId),
      'Product import preflight',
      IMPORT_JOB_PREFLIGHT_TIMEOUT_MS,
    )
    const failures = Array.isArray(preflight?.failures) ? preflight.failures : []
    const warnings = Array.isArray(preflight?.warnings) ? preflight.warnings : []
    if (failures.length) {
      const preflightError = new Error(failures[0]?.message || 'Import review still has blocking issues.') as ProductImportError
      preflightError.preflight = {
        jobId,
        checkedRows: Number(preflight?.checkedRows || 0),
        failures,
        warnings,
      }
      setServerPreflight({
        jobId,
        checkedRows: Number(preflight?.checkedRows || 0),
        failures,
        warnings,
      })
      setConflictFilter('errors')
      throw preflightError
    }
    setServerPreflight({
      jobId,
      checkedRows: Number(preflight?.checkedRows || 0),
      failures: [],
      warnings,
    })
    return preflight
  }

  const handleCancelCurrentJob = async () => {
    if (!currentJob?.id) return
    if (loading && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm(T('confirm_cancel_import', 'Cancel this import? The upload/start sequence will stop immediately.'))
      if (!confirmed) return
    }
    cancelRequestedRef.current = true
    try {
      const payload = await getProductImportApi().cancelImportJob(currentJob.id, { source: 'products_modal' })
      setCurrentJob((payload?.job || payload || currentJob) as ImportJob)
      setAnalysisProgress((current) => ({
        progress: current?.progress || 0,
        label: T('cancel_requested', 'Cancel requested...'),
      }))
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [getErrorMessage(error, 'Failed to cancel import job')] })
      setStep(3)
      setLoading(false)
    }
  }

  // Attaching this job's images is an explicit, opt-in step -- see
  // importJobsTransport.ts's wireImportJobImages and the route's own
  // comment for why it stopped happening automatically. Until it is
  // pressed the job behaves exactly like a CSV with no images at all,
  // which is a safe state to sit in rather than a half-applied one.
  const handleWireImportJobImages = async () => {
    const jobId = currentJob?.id || result?.job?.id || result?.jobId
    if (!jobId || wireImagesState === 'working') return
    const wire = getProductImportApi().wireImportJobImages
    if (!wire) return
    setWireImagesState('working')
    try {
      const response = await wire(jobId) as { success?: boolean; error?: string; imageCount?: number } | undefined
      if (response?.success === false) throw new Error(response.error || 'Failed to wire images')
      setWireImagesState('wired')
      notify(
        T('wire_import_images_done', '{n} image(s) will be attached when this import is applied.')
          .replace('{n}', String(response?.imageCount ?? 0)),
      )
    } catch (error) {
      setWireImagesState('idle')
      notify(getErrorMessage(error, T('wire_import_images_failed', "Could not wire this import's images.")), 'error')
    }
  }

  const handleRetryCurrentJob = async () => {
    if (!beginImportAction('retry')) return
    const targetJob = currentJob || result?.job
    if (!targetJob?.id) {
      finishImportAction('retry')
      return
    }
    setAnalysisProgress({ progress: 0, label: T('retry_import', 'Retry import') })
    try {
      const payload = await getProductImportApi().retryImportJob(targetJob.id, { source: 'products_modal' })
      const job = (payload?.job || payload || targetJob) as ImportJob
      setCurrentJob(job)
      setResult(null)
      cancelRequestedRef.current = false
      setStep(2)
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [getErrorMessage(error, 'Failed to retry import job')] })
      setStep(3)
    } finally {
      finishImportAction('retry')
      setAnalysisProgress(null)
    }
  }

  const handleDeleteCurrentJob = async () => {
    if (!beginImportAction('delete')) return
    const targetJob = currentJob || result?.job
    if (!targetJob?.id) {
      finishImportAction('delete')
      return
    }
    const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
      ? true
      : window.confirm(T('confirm_delete_import', 'Delete this import job? This keeps product data unchanged.'))
    if (!confirmed) {
      finishImportAction('delete')
      return
    }
    try {
      await getProductImportApi().deleteImportJob(targetJob.id, { force: true, source: 'products_modal' })
      setCurrentJob(null)
      setResult(null)
      resetCsvState()
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [getErrorMessage(error, 'Failed to delete import job')] })
      setStep(3)
    } finally {
      finishImportAction('delete')
    }
  }

  const handleImageOnlyImport = async () => {
    if (!Object.keys(imageFiles).length && !zipFile) return
    if (!beginImportAction('image-only')) return
    cancelRequestedRef.current = false
    setServerPreflight(null)
    setAnalysisProgress({ progress: 0, label: 'Creating import job' })
    let jobId: EntityId | null = null
    const api = getProductImportApi()
    try {
      const created = await withLoaderTimeout(
        () => api.createImportJob({
          type: 'products',
          policy: { mode: 'images_only', image_conflict_mode: 'append_csv' },
        }),
        'Product image import job',
        PRODUCT_IMPORT_JOB_CREATE_TIMEOUT_MS,
      )
      const job = (created?.job || created) as ImportJob | undefined
      if (!job?.id) throw new Error('Import job was not created')
      setCurrentJob(job)
      const activeJobId = job.id
      jobId = activeJobId
      throwIfImportCancelled()

      await withLoaderTimeout(
        () => api.uploadImportJobCsv({
          jobId: activeJobId,
          text: buildImageOnlyCsv(imageFiles),
          fileName: 'image-only-import.csv',
        }),
        'Product image import CSV upload',
        PRODUCT_IMPORT_JOB_UPLOAD_TIMEOUT_MS,
      )
      throwIfImportCancelled()
      if (zipFile) {
        setAnalysisProgress({ progress: 10, label: 'Uploading ZIP image pack' })
        const zipResult = await withLoaderTimeout(
          () => api.uploadImportJobZip({ jobId: activeJobId, file: zipFile }),
          'Product image import ZIP upload',
          PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS,
        )
        notifyZipUploadIssues(zipResult)
        throwIfImportCancelled()
        await recompressZipImages(activeJobId, zipResult)
        throwIfImportCancelled()
      }
      const browserImages = getBrowserImageEntries(imageFiles)
      if (browserImages.length) {
        await withLoaderTimeout(
          () => api.uploadImportJobImages({
            jobId: activeJobId,
            files: browserImages,
            onProgress: setAnalysisProgress,
          }),
          'Product image import upload',
          PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS,
        )
        throwIfImportCancelled()
      }
      setAnalysisProgress({ progress: 92, label: 'Checking conflicts and row decisions' })
      await ensureServerPreflightReady(activeJobId)
      throwIfImportCancelled()
      await withLoaderTimeout(
        () => api.startImportJob(activeJobId, { source: 'products_modal' }),
        'Product image import start',
        PRODUCT_IMPORT_JOB_START_TIMEOUT_MS,
      )
      throwIfImportCancelled()
      const nextResult = {
        imported: 0,
        updated: 0,
        images_matched: 0,
        queued: Object.keys(imageFiles).length,
        jobId,
        errors: [],
        message: T('import_analysis_started', 'Import analysis started. Review and approve it from the top progress bar.'),
      }
      await handOffToBackgroundTracker(nextResult)
      return
    } catch (error) {
      const importError = error as ProductImportError
      if (importError?.code === 'import_cancel_requested' || isCancelledStartError(error)) {
        await setCancelledResult(jobId, error)
      } else if (Array.isArray(importError?.preflight?.failures) && importError.preflight.failures.length) {
        alert(getErrorMessage(error, 'Server preflight found rows that still need review.'))
        setStep(2)
      } else {
        setResult({ imported: 0, updated: 0, errors: [getErrorMessage(error, 'Import failed')] })
        setStep(3)
      }
    } finally {
      finishImportAction('image-only')
      setAnalysisProgress(null)
    }
  }

  const analyzePickedCsv = async (picked: CsvData) => {
    setCsvData(picked)
    setLoading(true)
    setAnalysisProgress({ progress: 0, label: 'Preparing import' })
    const analysis = await analyzeProductCsvInWorker({
      text: picked.content,
      // Keep the modal responsive for large catalogs. Existing-product conflicts
      // are reviewed by the server import job; this local pass only previews CSV
      // row grouping and same-file issues.
      existingProducts: [],
      onProgress: setAnalysisProgress,
    })
    const nextConflicts = (analysis.conflicts || []).map((entry) => {
      const incomingImages = getIncomingImageFilenames(entry.row)
      const existingImages = getExistingImageFilenames(entry.existing)
      return {
        ...entry,
        incomingImages,
        existingImages,
        sameImages: !incomingImages.length || (
          incomingImages.length === existingImages.length &&
          incomingImages.every((value, i) => value.toLowerCase() === String(existingImages[i] || '').toLowerCase())
        ),
      }
    })
    const nextImageDecisions: Record<RowIndex, string> = {}
    const nextIdentifierDecisions: Record<RowIndex, string> = {}
    const nextIdentifierOverrides: Record<RowIndex, Partial<ProductImportRow>> = {}
    ;[...(analysis.cleanRows || []), ...nextConflicts].forEach((entry) => {
      const index = Number(entry.index ?? entry.row?._import_row_index ?? 0)
      const incomingImages = getIncomingImageFilenames(entry.row)
      nextImageDecisions[index] = incomingImages.length ? (entry.plannedAction === 'merge_stock' ? 'keep_existing' : 'replace_with_csv') : 'keep_existing'
      if ((entry.conflictFields || []).length) nextIdentifierDecisions[index] = entry.row?._identifier_conflict_mode || 'clear_imported'
      if ((entry.conflictFields || []).length) nextIdentifierOverrides[index] = { sku: entry.row?.sku || '', barcode: entry.row?.barcode || '' }
    })

    const datedSignal = detectLikelyDatedReconciliation(analysis.rows || [])

    setConflicts(nextConflicts)
    setCleanRows(analysis.cleanRows || [])
    setImportRows(analysis.rows || [])
    setReviewGroups(analysis.groups || [])
    setAnalysisSummary(analysis.summary || null)
    setAnalysisWarnings(analysis.warnings || [])
    setDatedReconciliationSignal(datedSignal.likelyDatedReconciliation ? datedSignal : null)
    setDismissedDatedSignal(false)
    setDecisions(analysis.decisions || {})
    setImageDecisions(nextImageDecisions)
    setIdentifierDecisions(nextIdentifierDecisions)
    setIdentifierOverrides(nextIdentifierOverrides)
    setSelectedConflictIds(new Set(nextConflicts.map((entry) => entry.index)))
    setCollapsedFamilyKeys(new Set())
    setExpandedDetailRows(new Set())
    setReviewUndoStack([])
    setServerPreflight(null)
    editSessionRef.current = new Set()
    setStep(2)
  }

  const handlePickCSV = async () => {
    if (!beginImportAction('pick-csv', { setLoading: false })) return
    try {
      const picked = await getProductImportApi().openCSVDialog()
      if (!picked) return
      await analyzePickedCsv(picked)
    } catch (error) {
      alert(`Failed to analyze CSV: ${getErrorMessage(error, 'Unknown error')}`)
    } finally {
      finishImportAction('pick-csv')
      setAnalysisProgress(null)
    }
  }

  // Drag-and-drop counterpart to handlePickCSV: same analysis path, just a
  // File handed over by the browser's drop event instead of one returned by
  // the native file-dialog. parseImportFile handles both real CSV/TSV and
  // real Excel (.xlsx/.xls/.xlsm) drops, matching the picker's Upload CSV
  // button which also accepts Excel via the same underlying dialog.
  const handleDropCSV = async (file: File) => {
    if (!beginImportAction('pick-csv', { setLoading: false })) return
    try {
      const parsed = await parseImportFile(file)
      if (!parsed?.content) return
      await analyzePickedCsv({ content: parsed.content, name: parsed.name || file.name || 'products-import.csv' })
    } catch (error) {
      notify(getErrorMessage(error, T('csv_drop_failed', 'Could not read that file.')), 'error')
    } finally {
      finishImportAction('pick-csv')
      setAnalysisProgress(null)
    }
  }

  const handleDragOverCSV = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(true)
  }
  const handleDragLeaveCSV = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    setIsDragActive(false)
  }
  const handleDropCSVEvent = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) void handleDropCSV(file)
  }

  const handleImport = async () => {
    if (!csvData?.content) return
    // Last-chance gate for the destructive mode, right at the point of no
    // return (job creation kicks off the actual apply chunk-by-chunk).
    // The picker's inline warning covers the "why", this covers "are you
    // sure, right now, with this specific file" -- same pattern as the
    // existing cancel/delete-job confirms above, just red instead of the
    // neutral copy those use since this one can deactivate products.
    if (mode === 'products' && importMode === 'replace_all') {
      const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
        ? true
        : window.confirm(T('confirm_replace_all_import', 'Replace mode: every active product not in this file will be deactivated once this import finishes. Continue?'))
      if (!confirmed) return
    }
    if (mode === 'products' && importMode === 'replace_columns') {
      if (!selectedReplaceColumns.length) return
      const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
        ? true
        : window.confirm(T('confirm_replace_columns_import', 'Replace mode: for every product this file matches, the selected columns will be overwritten with this file\'s values -- including blanks. Continue?'))
      if (!confirmed) return
    }
    if (!beginImportAction('import')) return
    cancelRequestedRef.current = false
    setServerPreflight(null)
    setAnalysisProgress({ progress: 0, label: 'Creating import job' })
    let jobId: EntityId | null = null
    const api = getProductImportApi()
    try {
      const created = await withLoaderTimeout(
        () => api.createImportJob({
          type: 'products',
          policy: {
            source: 'products_modal',
            field_rules: fieldRules,
            import_mode: importMode,
            ...(importMode === 'replace_columns' ? { replace_columns: selectedReplaceColumns } : {}),
            // No extra payload for 'fill_blank' -- unlike replace_columns,
            // it isn't scoped to an operator-picked column subset, it
            // covers every fillable field automatically (importEngine.ts's
            // PRODUCT_REPLACE_COLUMNS), so import_mode alone is enough for
            // the backend to act on it.
          },
        }),
        'Product import job',
        PRODUCT_IMPORT_JOB_CREATE_TIMEOUT_MS,
      )
      const job = (created?.job || created) as ImportJob | undefined
      if (!job?.id) throw new Error('Import job was not created')
      setCurrentJob(job)
      const activeJobId = job.id
      jobId = activeJobId
      throwIfImportCancelled()

      await withLoaderTimeout(
        () => api.uploadImportJobCsv({
          jobId: activeJobId,
          text: buildCsvForImportJob(),
          fileName: csvData?.name || 'products-import.csv',
        }),
        'Product import CSV upload',
        PRODUCT_IMPORT_JOB_UPLOAD_TIMEOUT_MS,
      )
      throwIfImportCancelled()
      if (zipFile) {
        setAnalysisProgress({ progress: 10, label: 'Uploading ZIP image pack' })
        const zipResult = await withLoaderTimeout(
          () => api.uploadImportJobZip({ jobId: activeJobId, file: zipFile }),
          'Product import ZIP upload',
          PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS,
        )
        notifyZipUploadIssues(zipResult)
        throwIfImportCancelled()
        await recompressZipImages(activeJobId, zipResult)
        throwIfImportCancelled()
      }
      const browserImages = getBrowserImageEntries(imageFiles)
      if (browserImages.length) {
        await withLoaderTimeout(
          () => api.uploadImportJobImages({
            jobId: activeJobId,
            files: browserImages,
            onProgress: setAnalysisProgress,
          }),
          'Product import image upload',
          PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS,
        )
        throwIfImportCancelled()
      }
      setAnalysisProgress({ progress: 92, label: 'Checking conflicts and row decisions' })
      await ensureServerPreflightReady(activeJobId)
      throwIfImportCancelled()
      await withLoaderTimeout(
        () => api.startImportJob(activeJobId, { source: 'products_modal' }),
        'Product import start',
        PRODUCT_IMPORT_JOB_START_TIMEOUT_MS,
      )
      throwIfImportCancelled()
      const nextResult = {
        imported: 0,
        updated: 0,
        queued: totalCount,
        jobId,
        errors: [],
        message: T('import_analysis_started', 'Import analysis started. Review and approve it from the top progress bar.'),
      }
      await handOffToBackgroundTracker(nextResult)
      return
    } catch (error) {
      const importError = error as ProductImportError
      if (importError?.code === 'import_cancel_requested' || isCancelledStartError(error)) {
        await setCancelledResult(jobId, error)
      } else if (Array.isArray(importError?.preflight?.failures) && importError.preflight.failures.length) {
        alert(getErrorMessage(error, 'Server preflight found rows that still need review.'))
        setStep(2)
      } else {
        setResult({ imported: 0, updated: 0, errors: [getErrorMessage(error, 'Import failed')] })
        setStep(3)
      }
    } finally {
      finishImportAction('import')
      setAnalysisProgress(null)
    }
  }

  const pendingAsk = useMemo(() => conflicts.filter((item) => decisions[item.index] === 'ask'), [conflicts, decisions])
  const blockingIssueEntries = useMemo(() => conflicts.map((entry) => {
    const index = Number(entry.index ?? entry.row?._import_row_index ?? 0)
    const editedRow = {
      ...(entry.row || {}),
      ...(rowOverrides[index] || {}),
      sku: identifierOverrides[index]?.sku ?? rowOverrides[index]?.sku ?? entry.row?.sku ?? '',
      barcode: identifierOverrides[index]?.barcode ?? rowOverrides[index]?.barcode ?? entry.row?.barcode ?? '',
    }
    const issue = getProductImportBarcodeIssue(editedRow.barcode)
    return {
      index,
      rowNumber: editedRow._rowNumber || index + 2,
      barcode: editedRow.barcode || '',
      issue,
    }
  }).filter((entry) => isBlockingProductImportIssue(entry.issue)), [conflicts, identifierOverrides, rowOverrides])
  const blockingIssueCount = blockingIssueEntries.length
  const reviewIssueRows = useMemo(() => conflicts.map((entry) => {
    const index = Number(entry.index ?? entry.row?._import_row_index ?? 0)
    const editedRow = {
      ...(entry.row || {}),
      ...(rowOverrides[index] || {}),
      sku: identifierOverrides[index]?.sku ?? rowOverrides[index]?.sku ?? entry.row?.sku ?? '',
      barcode: identifierOverrides[index]?.barcode ?? rowOverrides[index]?.barcode ?? entry.row?.barcode ?? '',
    }
    const details = getProductImportRowIssueDetails(entry, editedRow)
    return {
      index,
      rowNumber: editedRow._rowNumber || index + 2,
      name: editedRow.name || 'Unnamed row',
      details,
    }
  }).filter((entry) => entry.details.length), [conflicts, identifierOverrides, rowOverrides])
  const reviewIssueIndexSet = useMemo(() => new Set(reviewIssueRows.map((entry) => Number(entry.index))), [reviewIssueRows])
  const reviewIssueSummary = reviewIssueRows.slice(0, 8)
  const allDecided = pendingAsk.length === 0 && blockingIssueCount === 0
  const totalCount = importRows.length || cleanRows.length + conflicts.length
  const selectedConflictCount = selectedConflictIds.size
  const importRowsByIndex = useMemo(() => {
    const rowsByIndex = new Map()
    ;(importRows || []).forEach((row, index) => {
      const rowIndex = Number(row?._import_row_index ?? index)
      if (Number.isFinite(rowIndex)) rowsByIndex.set(rowIndex, row)
    })
    return rowsByIndex
  }, [importRows])
  const conflictsByIndex = useMemo(() => {
    const rowsByIndex = new Map()
    ;(conflicts || []).forEach((entry) => {
      const rowIndex = Number(entry?.index ?? entry?.row?._import_row_index ?? 0)
      if (Number.isFinite(rowIndex)) rowsByIndex.set(rowIndex, entry)
    })
    return rowsByIndex
  }, [conflicts])
  const conflictGroups = useMemo(() => {
    const groups = {
      total: conflicts.length,
      sameName: 0,
      barcode: 0,
      noBarcode: 0,
      sku: 0,
      pricing: 0,
      existing: 0,
      variant: 0,
      merge: 0,
      override: 0,
      errors: reviewIssueRows.length,
    }
    for (const entry of conflicts) {
      const fields = entry.conflictFields || []
      const planned = String(decisions[entry.index] || entry.plannedAction || '')
      const editedRow = { ...(entry.row || {}), ...(rowOverrides[entry.index] || {}) }
      if (String(entry.conflictType || '').includes('same_name')) groups.sameName += 1
      if (fields.includes('barcode')) groups.barcode += 1
      if (!String(editedRow.barcode || '').trim()) groups.noBarcode += 1
      if (fields.includes('sku')) groups.sku += 1
      if (hasPriceReviewIssue(editedRow, entry.existing, entry.samePricing)) groups.pricing += 1
      if (entry.existing) groups.existing += 1
      if (['create_variant', 'link_variant'].includes(planned)) groups.variant += 1
      if (planned === 'merge_stock') groups.merge += 1
      if (planned.startsWith('override')) groups.override += 1
    }
    return groups
  }, [conflicts, decisions, reviewIssueRows.length, rowOverrides])
  const visibleConflicts = useMemo(() => {
    const query = conflictQuery.trim().toLowerCase()
    return conflicts.filter((entry) => {
      const type = String(entry.conflictType || '')
      const fields = entry.conflictFields || []
      const planned = String(decisions[entry.index] || entry.plannedAction || '')
      const editedRow = { ...(entry.row || {}), ...(rowOverrides[entry.index] || {}) }
      if (conflictFilter === 'same_name' && !type.includes('same_name')) return false
      if (conflictFilter === 'barcode' && !fields.includes('barcode')) return false
      if (conflictFilter === 'no_barcode' && String(editedRow.barcode || '').trim()) return false
      if (conflictFilter === 'sku' && !fields.includes('sku')) return false
      if (conflictFilter === 'pricing' && !hasPriceReviewIssue(editedRow, entry.existing, entry.samePricing)) return false
      if (conflictFilter === 'existing' && !entry.existing) return false
      if (conflictFilter === 'variant' && !['create_variant', 'link_variant'].includes(planned)) return false
      if (conflictFilter === 'merge' && planned !== 'merge_stock') return false
      if (conflictFilter === 'override' && !planned.startsWith('override')) return false
      if (conflictFilter === 'errors' && !reviewIssueIndexSet.has(Number(entry.index))) return false
      if (!CONFLICT_FILTER_OPTIONS.some((item) => item.value === conflictFilter)) return false
      if (!query) return true
      const existing = entry.existing || {}
      const hay = [
        editedRow.name, editedRow.sku, editedRow.barcode, editedRow.category, editedRow.brand, editedRow.unit, editedRow.supplier, editedRow.branch, editedRow.description,
        existing.name, existing.sku, existing.barcode, existing.category, existing.brand, existing.unit, existing.supplier,
        ...(entry.conflictFields || []),
      ].join(' ').toLowerCase()
      return hay.includes(query)
    }).slice(0, 75)
  }, [conflictFilter, conflictQuery, conflicts, decisions, reviewIssueIndexSet, rowOverrides])

  const visibleConflictSections = useMemo(() => {
    const groupByRowIndex = new Map<RowIndex, ProductImportGroup>()
    reviewGroups.forEach((group) => {
      ;(group.rowIndexes || []).forEach((rowIndex) => {
        groupByRowIndex.set(Number(rowIndex), group)
      })
    })
    const sections: VisibleConflictSection[] = []
    const sectionByFamily = new Map<string, VisibleConflictSection>()

    visibleConflicts.forEach((entry) => {
      const rowIndex = Number(entry.index ?? entry.row?._import_row_index ?? 0)
      const group = groupByRowIndex.get(rowIndex)
      const row = { ...(entry.row || {}), ...(rowOverrides[rowIndex] || {}) }
      const familyKey = group?.key || getFamilyKeyForRow(row)
      const shouldGroup = !!group || String(entry.conflictType || '').includes('same_name')
      const key = shouldGroup ? `family:${familyKey}` : `row:${rowIndex}`
      if (!sectionByFamily.has(key)) {
        const section = {
          key,
          familyKey,
          group,
          title: group?.title || row.name || 'Review row',
          rowNumbers: group?.rowNumbers || [row._rowNumber || rowIndex + 2],
          rows: group ? buildVisibleFamilyRows(group, conflictsByIndex, importRowsByIndex) : [],
        }
        sectionByFamily.set(key, section)
        sections.push(section)
      }
      const section = sectionByFamily.get(key)
      if (!group && section) section.rows.push(entry)
    })

    return sections
  }, [conflictsByIndex, importRowsByIndex, reviewGroups, rowOverrides, visibleConflicts])

  const visibleReviewRows = useMemo(() => visibleConflictSections.flatMap((section) => section.rows || []), [visibleConflictSections])
  const visibleReviewRowCount = visibleReviewRows.length

  const toggleFamilyCollapse = (familyKey: string) => {
    setCollapsedFamilyKeys((current) => {
      const next = new Set(current)
      if (next.has(familyKey)) next.delete(familyKey)
      else next.add(familyKey)
      return next
    })
  }

  const toggleInlineDetails = (rowIndex: RowIndex) => {
    setExpandedDetailRows((current) => {
      const next = new Set(current)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }

  const toggleConflictSelection = (index: RowIndex) => {
    setSelectedConflictIds((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const toggleSelectAllConflicts = (checked: boolean) => {
    if (!checked) {
      setSelectedConflictIds(new Set())
      return
    }
    setSelectedConflictIds(new Set(visibleReviewRows.map((entry) => entry.index)))
  }

  const applyDecisionToSelection = (value: string) => {
    if (!selectedConflictIds.size) return
    pushReviewUndoSnapshot('Changed selected import actions')
    setDecisions((current) => {
      const next = { ...current }
      selectedConflictIds.forEach((index) => { next[index] = value })
      return next
    })
  }

  const applyImageDecisionToSelection = (value: string) => {
    if (!selectedConflictIds.size) return
    pushReviewUndoSnapshot('Changed selected image actions')
    setImageDecisions((current) => {
      const next = { ...current }
      selectedConflictIds.forEach((index) => {
        const entry = conflictsByIndex.get(Number(index))
        const row = entry?.row || importRowsByIndex.get(Number(index)) || {}
        const editedRow = { ...(row || {}), ...(rowOverrides[index] || {}) }
        const incomingImages = Array.isArray(entry?.incomingImages) ? entry.incomingImages : getIncomingImageFilenames(editedRow)
        const hasImage = incomingImages.length || findImageReferenceForRow(editedRow, imageFiles)
        if (hasImage) next[index] = value
      })
      return next
    })
  }

  const applyIdentifierDecisionToSelection = (value: string) => {
    if (!selectedConflictIds.size) return
    pushReviewUndoSnapshot('Changed selected identifier actions')
    setIdentifierDecisions((current) => {
      const next = { ...current }
      conflicts.forEach((entry) => {
        if (selectedConflictIds.has(entry.index) && (entry.conflictFields || []).length) next[entry.index] = value
      })
      return next
    })
  }

  const applyFieldRulePreset = (preset: FieldRulePreset) => {
    pushReviewUndoSnapshot('Changed detail merge rule')
    const fields = [
      'category', 'brand', 'unit', 'supplier', 'description', 'low_stock_threshold',
    ]
    const rule = preset === 'use_imported'
      ? 'use_imported'
      : preset === 'keep_existing'
        ? 'keep_existing'
        : 'merge_blank_only'
    setFieldRules({ __preset: preset, ...Object.fromEntries(fields.map((field) => [field, rule])) })
  }

  // Shared by the three labeled sub-rows this renders into (see
  // "product-import-filter-row" below) -- one button implementation kept
  // identical across the All/Errors anchors and the Field/Status clusters
  // so grouping the chips visually didn't mean forking their behavior.
  const renderConflictFilterChip = (item: ConflictFilterOption) => (
    <button
      key={item.value}
      type="button"
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold ${conflictFilter === item.value ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}
      title={item.hint}
      aria-label={`${item.label}: ${item.hint}`}
      onClick={() => setConflictFilter(item.value)}
    >
      {/* Part 207: icon moved before the label, matching the reordering
          applied to the other tooltip-style Info icons app-wide. */}
      <Info className="h-3 w-3 opacity-70" aria-hidden="true" />
      {item.value === 'errors'
        ? <span>Errors ({reviewIssueRows.length})</span>
        : <span>{item.label} ({conflictGroups[item.countKey] || 0})</span>}
    </button>
  )

  const renderConflictRow = (entry: ProductImportConflict) => {
    const { row = {}, index, existing, plannedAction, conflictFields = [], importDuplicateRows = {}, sameBasic, samePricing, incomingImages = [], existingImages = [] } = entry
    const editedRow = {
      ...(row || {}),
      ...(rowOverrides[index] || {}),
      sku: identifierOverrides[index]?.sku ?? rowOverrides[index]?.sku ?? row?.sku ?? '',
      barcode: identifierOverrides[index]?.barcode ?? rowOverrides[index]?.barcode ?? row?.barcode ?? '',
    }
    const updateEditedRow = (field: string, value: string) => {
      setRowOverrides((state) => ({ ...state, [index]: { ...(state[index] || {}), [field]: value } }))
      if (field === 'sku' || field === 'barcode') {
        setIdentifierOverrides((state) => ({ ...state, [index]: { ...(state[index] || {}), [field]: value } }))
        setIdentifierDecisions((state) => ({ ...state, [index]: value === (row?.[field] || '') ? (state[index] || 'clear_imported') : 'change_identifier' }))
      }
    }
    const decisionValue = decisions[index] || plannedAction || 'merge_stock'
    const identifierDecision = identifierDecisions[index] || row?._identifier_conflict_mode || 'clear_imported'
    const imageDecision = imageDecisions[index] || row?.image_conflict_mode || 'keep_existing'
    const matchedLibraryImage = incomingImages.length ? '' : findImageReferenceForRow(editedRow, imageFiles)
    const rowIncomingImages = incomingImages.length ? incomingImages : (matchedLibraryImage ? [matchedLibraryImage] : [])
    const liveBarcodeIssue = getProductImportBarcodeIssue(editedRow.barcode)
    const liveBarcodeBlocking = isBlockingProductImportIssue(liveBarcodeIssue)
    const targetSummary = getImportActionTargetSummary(entry, decisionValue, editedRow)
    const detailsCollapsed = !expandedDetailRows.has(index)
    const detailsDiffer = !sameBasic || !samePricing

    return (
      <div key={index} className={`rounded-xl border p-2 text-sm ${liveBarcodeBlocking ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20' : decisionValue === 'ask' ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
        <div className="flex flex-wrap items-start gap-2">
          <input type="checkbox" checked={selectedConflictIds.has(index)} onChange={() => toggleConflictSelection(index)} aria-label={`Select conflict row ${index + 1}`} className="mt-1" />
          <div className="min-w-[14rem] flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-medium text-gray-900 dark:text-white">{editedRow.name || 'Needs a product name'}</span>
              {liveBarcodeIssue ? (
                <span title={getProductImportIssueHint(liveBarcodeIssue)} className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${liveBarcodeBlocking ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'}`}>
                  {getProductImportIssueLabel(liveBarcodeIssue)}
                </span>
              ) : null}
              {!existing ? (
                <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[11px] text-green-700 dark:bg-green-900/30 dark:text-green-400">New</span>
              ) : detailsDiffer ? (
                <span title="Some details differ from the matched existing product -- see More details." className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">Differs</span>
              ) : null}
            </div>
            {/* The facts asked for at a glance: name (above), barcode,
                SKU, branch, qty, price. Everything else (cost, discounts,
                description, category/brand/unit/supplier) is one click
                away in "More details" instead of shown by default --
                confirmed this exact field set with the user directly
                (Part 313): those extra fields already have their own
                formatting/editing surfaces elsewhere, so import review's
                job is just separating/matching rows, not re-displaying
                every product field. */}
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span>Barcode: <span className="text-slate-700 dark:text-slate-200">{compactImportValue(editedRow.barcode)}</span></span>
              <span>SKU: <span className="text-slate-700 dark:text-slate-200">{compactImportValue(editedRow.sku)}</span></span>
              <span>Branch: <span className="text-slate-700 dark:text-slate-200">{compactImportValue((editedRow as ImportRecord)['branch'])}</span></span>
              <span>Qty: <span className="text-slate-700 dark:text-slate-200">{compactImportValue((editedRow as ImportRecord)['stock_quantity'])}</span></span>
              <span>Price: <span className="text-slate-700 dark:text-slate-200">{compactImportPrice(editedRow)}</span></span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500" title={targetSummary}>{targetSummary}</div>
          </div>
          <AppSelect
            value={decisionValue}
            onChange={(nextValue) => {
              pushReviewUndoSnapshot(`Changed row ${editedRow._rowNumber || index + 2} action`)
              setDecisions((state) => ({ ...state, [index]: nextValue }))
            }}
            ariaLabel="Import decision"
            className="min-w-[8.5rem]"
            buttonClassName="h-8 w-full px-2 py-1 text-xs"
            menuClassName="min-w-[9rem]"
            optionClassName="text-xs"
            options={IMPORT_DECISION_OPTIONS}
          />
        </div>

        <div className="mt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            onClick={() => toggleInlineDetails(index)}
            title={detailsCollapsed ? 'Show every field, plus identifier/image conflicts, for this row.' : 'Hide the extra fields for this row.'}
          >
            {detailsCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            More details
            {conflictFields.length || rowIncomingImages.length ? <span className="text-amber-600 dark:text-amber-300">*</span> : null}
          </button>
        </div>

        {!detailsCollapsed ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2 text-xs dark:border-slate-700 dark:bg-slate-900/60">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-200">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{existing ? `Comparing with ${existing.name || `#${existing.id}`}` : 'No existing product match. Click fields to edit before apply.'}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {conflictFields.length ? (
                <AppSelect
                  value={identifierDecision}
                  onChange={(nextValue) => {
                    const value = nextValue
                    pushReviewUndoSnapshot(`Changed row ${editedRow._rowNumber || index + 2} identifier choice`)
                    setIdentifierDecisions((state) => ({ ...state, [index]: value }))
                    if (value === 'allow_duplicate') {
                      setIdentifierOverrides((state) => ({ ...state, [index]: { sku: row.sku || '', barcode: row.barcode || '' } }))
                    }
                    if (value === 'clear_imported') {
                      setIdentifierOverrides((state) => ({ ...state, [index]: { sku: '', barcode: '' } }))
                    }
                  }}
                  ariaLabel="Identifier decision"
                  className="min-w-[8.5rem]"
                  buttonClassName="h-8 w-full px-2 py-1 text-xs"
                  menuClassName="min-w-[10rem]"
                  optionClassName="text-xs"
                  options={IDENTIFIER_DECISION_OPTIONS}
                />
              ) : null}
              {rowIncomingImages.length ? (
                <AppSelect
                  value={imageDecision}
                  onChange={(nextValue) => {
                    pushReviewUndoSnapshot(`Changed row ${editedRow._rowNumber || index + 2} image action`)
                    setImageDecisions((state) => ({ ...state, [index]: nextValue }))
                  }}
                  ariaLabel="Image conflict decision"
                  className="min-w-[8.5rem]"
                  buttonClassName="h-8 w-full px-2 py-1 text-xs"
                  menuClassName="min-w-[11rem]"
                  optionClassName="text-xs"
                  options={IMAGE_CONFLICT_OPTIONS}
                />
              ) : null}
            </div>
          </div>
          <InlineImportDetailGrid
            row={editedRow}
            compareTo={existing}
            onBeginEdit={(field) => beginInlineEdit(index, field, `Edited row ${editedRow._rowNumber || index + 2}`)}
            onChange={updateEditedRow}
            T={T}
          />

          {conflictFields.length ? (
            <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
              <div className="font-semibold">Identifier conflict</div>
              <div>Imported: SKU {(identifierOverrides[index]?.sku ?? row.sku) || '-'} / Barcode {(identifierOverrides[index]?.barcode ?? row.barcode) || '-'}</div>
              <div>Existing: {existing?.name || '-'} - SKU {existing?.sku || '-'} / Barcode {existing?.barcode || '-'}</div>
              {importDuplicateRows?.sku?.length > 1 || importDuplicateRows?.barcode?.length > 1 ? (
                <div className="mt-1 rounded bg-white/70 px-2 py-1 dark:bg-slate-900/60">
                  {importDuplicateRows?.sku?.length > 1 ? <div>Same SKU appears in CSV rows: {importDuplicateRows.sku.join(', ')}</div> : null}
                  {importDuplicateRows?.barcode?.length > 1 ? <div>Same barcode appears in CSV rows: {importDuplicateRows.barcode.join(', ')}</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {liveBarcodeIssue ? (
            <div className={`mt-2 rounded-lg border p-2 text-xs ${liveBarcodeBlocking ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'}`}>
              <div className="font-semibold">{getProductImportIssueLabel(liveBarcodeIssue)}</div>
              <div>{getProductImportIssueHint(liveBarcodeIssue)}</div>
            </div>
          ) : null}

          {rowIncomingImages.length ? (
            <div className="mt-2 rounded-lg bg-white p-2 text-xs text-gray-500 dark:bg-slate-950/50 dark:text-gray-400">
              <div>Incoming images: {rowIncomingImages.join(', ')}</div>
              <div>Current images: {existingImages.length ? existingImages.join(', ') : 'none'}</div>
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    )
  }

  const cancelledImportRecovery = currentJob && ['cancelled', 'cancelling'].includes(String(currentJob.status || '').toLowerCase())

  return (
    <Modal title={mode === 'products' ? T('csv_template_title', 'Products + CSV') : T('csv_images_only', 'Images Only')} onClose={onClose} wide draggable>
      {step === 1 && onTopModeChange ? <ProductImportModeTabs value={topMode} onChange={onTopModeChange} /> : null}

      <div className="mb-5 flex gap-1.5">
        {[1, 2, 3].map((value) => (
          <div key={value} className={`h-1 flex-1 rounded-full ${step >= value ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
        ))}
      </div>
      {analysisProgress && step !== 1 ? (
        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span>{analysisProgress.label || T('analysing', 'Analyzing...')}</span>
            <span>{Math.round(analysisProgress.progress || 0)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(5, Math.min(100, analysisProgress.progress || 0))}%` }} />
          </div>
        </div>
      ) : null}
      {currentJob && step !== 1 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          <div className="grid gap-2 sm:grid-cols-4">
            <div><span className="font-semibold">Job:</span> {currentJob.id || currentJob.job_id || '-'}</div>
            <div><span className="font-semibold">{T('status', 'Status')}:</span> {currentJob.status || '-'}</div>
            <div><span className="font-semibold">{T('rows', 'Rows')}:</span> {Number(currentJob.processed_rows || 0)} / {Number(currentJob.total_rows || 0)}</div>
            {Number(currentJob.total_images || 0) > 0 ? (
              <div><span className="font-semibold">{T('images', 'Images')}:</span> {Number(currentJob.processed_images || 0)} / {Number(currentJob.total_images || 0)}</div>
            ) : null}
            <div><span className="font-semibold">{T('errors', 'Errors')}:</span> {Number(currentJob.failed_rows || 0) + Number(currentJob.failed_images || 0)}</div>
          </div>
          {currentJob.last_error || currentJob.error ? (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <span className="font-semibold">Backend error:</span> {currentJob.last_error || currentJob.error}
            </div>
          ) : null}
          {loading ? (
            <button type="button" className="btn-secondary mt-3 text-xs" onClick={handleCancelCurrentJob}>
              {T('cancel_import', 'Cancel import')}
            </button>
          ) : null}
          {cancelledImportRecovery ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <span className="font-semibold">{T('cancelled_import_recovery', 'Cancelled import recovery')}</span>
              <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={handleRetryCurrentJob} disabled={loading}>{T('retry_import', 'Retry import')}</button>
              <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={handleDeleteCurrentJob} disabled={loading}>{T('delete_import', 'Delete import')}</button>
              <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={resetCsvState} disabled={loading}>{T('back_to_upload', 'Back to upload')}</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {currentJob && step !== 1 ? (
        <ImageMatchReviewPanel
          jobId={currentJob.id || currentJob.job_id}
          imageMatch={(currentJob.summary as { imageMatch?: ImageMatchSummaryData } | undefined)?.imageMatch}
          rows={importRows}
          T={T}
          onResolved={async () => {
            const api = getProductImportApi()
            const targetId = currentJob.id || currentJob.job_id
            if (!targetId) return
            // Overrides just changed (policy_json) -- re-queue analyze so
            // summary_json.imageMatch reflects the new decision, then poll
            // briefly until it leaves the transient queued/analyzing phase.
            await api.startImportJob(targetId, { source: 'products_modal_image_review' })
            for (let attempt = 0; attempt < 10; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 700))
              const refreshed = await api.getImportJob?.(targetId)
              if (refreshed) setCurrentJob(refreshed as ImportJob)
              const status = String((refreshed as ImportRecord | undefined)?.status || '').toLowerCase()
              if (status && !['queued', 'analyzing'].includes(status)) break
            }
          }}
        />
      ) : null}
      {/* Header-level file warnings (e.g. duplicate/near-duplicate CSV
          columns) -- shown once at the top of the review step, separate
          from serverPreflight below (that's about row data, this is about
          the header row itself, and only the client-side analysis knows
          about it). */}
      {analysisWarnings.length && step === 2 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-semibold">{T('csv_header_warning_title', 'File warning')}</div>
          <div className="mt-1 space-y-1">
            {analysisWarnings.map((warning, index) => <div key={index}>{warning}</div>)}
          </div>
        </div>
      ) : null}
      {/* Item 10a: suggest (never auto-switch) Dated Stock Reconciliation
          when this "Add / Update Products" file's own shape looks like a
          dated snapshot -- see importModeDetection.ts for the signal and
          why it stops at a dismissible suggestion. Cancelling here (not a
          silent redirect) keeps the deliberate "mode is locked once you're
          past the wizard" design DatedStockReconciliationModal's own header
          comment documents. */}
      {datedReconciliationSignal && !dismissedDatedSignal && step === 2 ? (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">{T('dated_reconciliation_suggestion_title', 'This might be a dated stock-count file')}</div>
              <div className="mt-1">
                {T(
                  'dated_reconciliation_suggestion_body',
                  `${datedReconciliationSignal.repeatedGroupCount} product${datedReconciliationSignal.repeatedGroupCount === 1 ? '' : 's'} in this file` +
                  (datedReconciliationSignal.sampleProductName ? ` (e.g. "${datedReconciliationSignal.sampleProductName}")` : '') +
                  ' appear on more than one date at the same branch. If you\'re recording repeated stock counts over time, the Dated Stock Reconciliation import handles that better -- it works out what changed between counts instead of overwriting stock in place.',
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  {T('dated_reconciliation_suggestion_switch', 'Cancel this import & choose Dated Reconciliation')}
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedDatedSignal(true)}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900/40"
                >
                  {T('dated_reconciliation_suggestion_dismiss', 'No, this file is correct')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {serverPreflight && step !== 1 ? (
        <div className={`mb-4 rounded-xl border p-3 text-xs ${serverPreflight.failures?.length ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">
              {serverPreflight.failures?.length
                ? 'Server preflight found rows that still need review'
                : 'Server preflight completed'}
            </div>
            <div>
              {serverPreflight.checkedRows || 0} rows checked
            </div>
          </div>
          {serverPreflight.failures?.length ? (
            <div className="mt-2 space-y-1">
              {serverPreflight.failures.slice(0, 6).map((failure, index) => (
                <div key={`${failure.rowNumber || 'row'}-${index}`}>
                  Row {failure.rowNumber || '?'}: {failure.message}
                </div>
              ))}
              {serverPreflight.failures.length > 6 ? (
                <div>+ {serverPreflight.failures.length - 6} more issue(s)</div>
              ) : null}
            </div>
          ) : null}
          {!serverPreflight.failures?.length && serverPreflight.warnings?.length ? (
            <div className="mt-2 space-y-1 text-amber-700 dark:text-amber-200">
              {serverPreflight.warnings.slice(0, 4).map((warning, index) => (
                <div key={`${warning.rowNumber || 'warning'}-${index}`}>
                  Row {warning.rowNumber || '?'}
                  {warning.label ? <span className="font-medium"> ({warning.label})</span> : null}
                  : {warning.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 && mode === 'products' ? (
        <div className="flex flex-col gap-3">
          {/* Unified upload card (redesign, Aug 2026): the whole card is
              the drop target (onDragOver/Leave/Drop) AND a click target
              (same handlePickCSV a button used to own alone), so there's
              one obvious place to either click or drop a file, matching
              how upload cards read elsewhere on the web.
              Part 133 revision (explicit user decision, reversing the
              Aug-2026 "Download Template stays clearly secondary"
              choice this file used to document here): that choice made
              the template link too easy to miss, and the card's own
              tall/stacked shape took more vertical room than the click
              target itself needed. Two changes: (1) the card is now a
              horizontal (icon-left, text-right) row instead of a
              stacked column, so it reads wider and shorter rather than
              tall and square; (2) Download Template is now a real
              `btn-secondary` button sized to match the shared
              `CsvImportPreview.tsx` treatment every other import modal
              already uses, not a small text-only link. */}
          <div
            role="button"
            tabIndex={loading || (topMode === 'replace' && !canReplaceAll) ? -1 : 0}
            aria-disabled={loading || (topMode === 'replace' && !canReplaceAll)}
            onClick={() => { if (!loading && !(topMode === 'replace' && !canReplaceAll)) handlePickCSV() }}
            onKeyDown={(event) => {
              if (loading || (topMode === 'replace' && !canReplaceAll)) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handlePickCSV()
              }
            }}
            onDragOver={handleDragOverCSV}
            onDragLeave={handleDragLeaveCSV}
            onDrop={handleDropCSVEvent}
            className={`order-3 flex flex-row items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 text-left transition-colors ${loading ? 'cursor-wait opacity-70' : 'cursor-pointer'} ${
              isDragActive
                ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:hover:border-blue-800 dark:hover:bg-blue-900/10'
            }`}
          >
            <UploadCloud className={`h-7 w-7 shrink-0 ${isDragActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${isDragActive ? 'text-blue-600 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>
                {isDragActive ? T('csv_drop_file', 'Drop file here to import') : T('csv_template_upload', 'Upload CSV or Excel')}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {T('csv_drop_hint_inline', 'Click to browse, or drag a CSV/Excel file anywhere in this box')}
              </p>
              {loading ? <p className="text-xs font-medium text-blue-600 dark:text-blue-300">{T('analysing', 'Analyzing...')}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); getProductImportApi().downloadImportTemplate('products') }}
            className="btn-secondary order-2 flex w-full items-center justify-center gap-1.5 text-sm"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {T('csv_template_download', 'Download Template')}
          </button>

          <div
            onDragOver={handleImageDragOver}
            onDragLeave={handleImageDragLeave}
            onDrop={handleImageDropEvent}
            className={`order-4 rounded-xl border p-3 transition-colors ${isImageDragActive ? 'border-dashed border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'}`}
          >
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              {isImageDragActive ? T('zip_drop_file', 'Drop the .zip here') : T('images_optional', 'Product images (optional)')}
            </p>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {T('images_screen_one_hint', 'Choose the image folder or ZIP here on Screen 1. Screen 2 only reviews the CSV, image matches, and final actions.')}
            </p>
            <div className="flex flex-wrap gap-2">
              <div className="input min-w-0 flex-1 truncate text-xs text-gray-500">{imageDir || zipFile?.name || T('no_folder', 'No images selected')}</div>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageDirectory}>{T('browse', 'Browse')}</button>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageZip}>{T('zip_images', 'ZIP')}</button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setFilePickerOpen(true)}>{T('files', 'Files')}</button>
            </div>
          </div>

          {analysisProgress ? (
            <div className="order-6 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span>{analysisProgress.label || T('analysing', 'Analyzing...')}</span>
                <span>{Math.round(analysisProgress.progress || 0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(5, Math.min(100, analysisProgress.progress || 0))}%` }} />
              </div>
            </div>
          ) : null}

          {/* Import mode picker (Aug 2026, reordered Part 133; third tile
              added Part 320/321): moved above the columns-reference box,
              per an explicit user note that it read as buried/unclear
              where it used to sit (after that box). 'merge' (default)
              only adds/updates -- nothing is ever removed.
              'replace_columns' overwrites only the selected column
              groups on a matched row, leaving everything else on that
              product (and every unmatched row's create-or-not behavior)
              untouched. 'replace_all' treats this file as the complete,
              current catalog: matched rows still update in place, but
              every active product the file doesn't mention gets
              soft-deactivated once the whole run finishes
              (cloudflare/src/lib/importEngine.ts's replace_all block --
              not a hard delete, so sales/stock history referencing those
              products stays intact and they can be reactivated later).
              Kept as explicit tap targets rather than a dropdown so a
              destructive option can't be picked by accident while
              scrolling past it, and each mode's own warning/column
              picker only appears once it's actually selected. */}
          <div className={`order-1 rounded-xl border p-4 text-sm transition-colors ${importMode === 'replace_columns' || importMode === 'replace_all' ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/40'}`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {T('csv_import_mode_label', 'Import mode')}
            </p>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {T('csv_import_mode_intro', 'Choose what this file should do to your catalog before uploading it.')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {topMode === 'general' ? (
                <>
              <ProductImportOptionCard
                active={importMode === 'merge'}
                icon={PackagePlus}
                title={T('csv_mode_merge_title', 'Add / update products')}
                description={T('csv_mode_merge_hint', 'A row with no match becomes a new product. A matched row updates the existing product and adds its stock; nothing already in your catalog is removed.')}
                onClick={() => setImportMode('merge')}
              />
              {/* Non-destructive, like Add -- available to everyone, no
                  permission gate. Only fills a field the existing product
                  doesn't already have a value for; never overwrites
                  something already on file and never touches stock, so
                  there's nothing here that needs the same "are you sure"
                  treatment the two red tiles below get. */}
              <ProductImportOptionCard
                active={importMode === 'fill_blank'}
                icon={Sparkles}
                title={T('csv_mode_fill_blank_title', 'Fill missing details only')}
                description={T('csv_mode_fill_blank_hint', 'For a matched product, only empty fields are filled. Existing values stay unchanged and quantity is ignored; unmatched rows still create products.')}
                onClick={() => setImportMode('fill_blank')}
              />
                </>
              ) : null}
              {/* Both destructive tiles below only render for someone
                  holding 'destructive_delete' -- routes/importJobs.ts
                  enforces this for real for both; hiding the tiles
                  otherwise avoids offering a choice that always 403s. */}
              {topMode === 'replace' && canReplaceAll ? (
                <ProductImportOptionCard
                  active={importMode === 'replace_columns'}
                  dangerous
                  icon={Columns3}
                  title={T('csv_mode_replace_columns_title', 'Replace selected columns')}
                  description={T('csv_mode_replace_columns_hint', 'For a matched product, overwrite only the column groups selected below. Everything else stays untouched; unmatched rows still create products.')}
                  onClick={() => setImportMode('replace_columns')}
                />
              ) : null}
              {topMode === 'replace' && canReplaceAll ? (
                <ProductImportOptionCard
                  active={importMode === 'replace_all'}
                  dangerous
                  icon={RefreshCw}
                  title={T('csv_mode_replace_title', 'Replace entire catalog')}
                  description={T('csv_mode_replace_hint', 'This file becomes the complete catalog. Matched products update in place and every active product absent from the file is deactivated.')}
                  onClick={() => setImportMode('replace_all')}
                />
              ) : null}
            </div>
            {topMode === 'replace' && !canReplaceAll ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {T('csv_replace_permission_required', 'Replace imports require destructive-data permission. Choose Add / Update, or ask an administrator for access.')}
              </p>
            ) : null}
            {importMode === 'replace_columns' ? (
              <div className="mt-3 space-y-2">
                <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-100/60 p-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {T('csv_mode_replace_columns_warning', 'For every product this file matches, the selected columns below will be overwritten with this file\'s values -- including a blank cell, which will clear that field. Pick only the columns you actually mean to overwrite.')}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {REPLACE_COLUMN_GROUPS.map((group) => {
                    const checked = replaceColumnGroupKeys.has(group.key)
                    return (
                      <label
                        key={group.key}
                        className={`flex cursor-pointer items-start gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${checked ? 'border-red-500 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:bg-gray-800'}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() => toggleReplaceColumnGroup(group.key)}
                        />
                        <span>
                          <span className="block font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
                          {group.hint ? <span className="block text-gray-400 dark:text-gray-500">{group.hint}</span> : null}
                        </span>
                      </label>
                    )
                  })}
                </div>
                {!selectedReplaceColumns.length ? (
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {T('csv_mode_replace_columns_none_selected', 'Pick at least one column group to overwrite.')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {importMode === 'replace_all' ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-100/60 p-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {T('csv_mode_replace_warning', 'Every currently active product not present in this file will be deactivated (hidden from POS/catalog, not deleted -- its sales and stock history are kept and it can be reactivated later). Products this file does match are updated in place, same as merge mode. Double-check this is the complete, current catalog before importing.')}
                </span>
              </p>
            ) : null}
          </div>

          {/* Columns reference, collapsed by default (redesign, Aug 2026):
              previously the full ~40-name comma-separated column string
              rendered unconditionally above this toggle, so the panel
              opened as a wall of monospace text before anyone asked for
              it. Now the default state is a single plain-language line;
              the toggle reveals the full column list AND the field-by-
              field notes together, instead of two separately-triggered
              reveals stacked on top of each other. */}
          <div className="order-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            <div className="flex items-center justify-between gap-2">
              <p>
                {T('csv_columns_summary', 'Only ')}<code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900/40">name</code>{T('csv_columns_summary_rest', ' is required -- pricing, stock, images, and variant columns are all optional.')}
              </p>
              <button
                type="button"
                onClick={() => setShowColumnsInfo((current) => !current)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/40"
                aria-expanded={showColumnsInfo}
              >
                <Info className="h-3 w-3" aria-hidden="true" />
                {T('csv_columns_info_toggle', showColumnsInfo ? 'Hide details' : 'Information')}
              </button>
            </div>
            {showColumnsInfo ? (
              <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-white/70 p-3 text-xs leading-relaxed text-slate-700 dark:border-blue-900/40 dark:bg-slate-900/40 dark:text-slate-200">
                <p className="font-mono leading-relaxed">
                  {T('csv_template_columns', 'name*, sku, barcode, category, brand, unit, description, selling_price_usd, selling_price_khr, vip_price_usd, vip_price_khr, cost_price_usd, cost_price_khr, stock_quantity, low_stock_threshold, batch(mm/dd/yyyy), expiry_date, expiry_alert_days, branch, supplier, parent_id, is_group, image_filename_1..5, image_filenames, is_active')}
                </p>
                <p><strong>{T('csv_info_required_label', 'Required')}:</strong> {T('csv_info_required', 'only name (marked with *) has to be filled in -- every other column can be left blank.')}</p>
                <p><strong>{T('csv_info_pricing_label', 'Pricing')}:</strong> {T('csv_info_pricing', 'selling/special/cost prices each have a USD and a KHR column -- fill in whichever currency you use, the other can stay blank.')}</p>
                <p><strong>{T('csv_info_batch_label', 'Batch')}:</strong> {T('csv_info_batch', 'optional -- one column, batch(mm/dd/yyyy), is the date this stock was received (e.g. "08/24/2026"). Leave it blank and it defaults to today. The system auto-formats whichever date you give it into the stored batch code (e.g. "AUG242026") -- there is no separate free-typed label to fill in. A row naming the same received date as an earlier import or manual receive lands in the same batch automatically. expiry_date/expiry_alert_days are separate and control low-stock/expiry warnings, not batch numbering.')}</p>
                <p><strong>{T('csv_info_images_label', 'Images')}:</strong> {T('csv_info_images', 'image_filename_1 through image_filename_5 (or the combined image_filenames column) should match the filenames of images you upload alongside the CSV. What to do about a product\'s existing images (keep, replace, or add to them) is chosen on the review screen after upload, not in the file.')}</p>
                <p><strong>{T('csv_info_grouping_label', 'Variants/grouping')}:</strong> {T('csv_info_grouping', 'set is_group to 1 on a row that should act as a parent product, then set parent_id on its variant rows to that parent row\'s number to group them together.')}</p>
                <p><strong>{T('csv_info_example_label', 'Example row')}:</strong> <span className="font-mono">{T('csv_info_example', 'name=Iced Coffee, sku=BEV-001, category=Beverages, selling_price_usd=2.50, stock_quantity=40, batch(mm/dd/yyyy)=08/24/2026 (blank = today, auto-formatted to a code like AUG242026), branch=Main Branch, image_filename_1=iced-coffee.jpg')}</span> {T('csv_info_example_note', '-- also included as an actual second row in the downloaded template file, not just here.')}</p>
              </div>
            ) : null}
          </div>

        </div>
      ) : null}

      {step === 1 && mode === 'images' ? (
        <div className="space-y-4">
          {/* Icon-led card language matches products-mode (part 52). This
              session added real drag-and-drop for a dropped .zip (wired to
              the same applyZipFile path pickImageZip's dialog uses) --
              folder drops still need Browse; there's no plain HTML5 drag-
              drop equivalent to a folder picker without a much bigger
              DataTransferItem.webkitGetAsEntry traversal, left as Browse. */}
          <div className="flex items-start gap-3 rounded-xl bg-yellow-50 p-4 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
            <ImagePlus className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="mb-1 font-semibold">{T('image_matching_rules', 'Image matching rules')}</p>
              <ul className="list-inside list-disc space-y-1 text-xs">
                <li>{T('img_rule_1', 'Filename must match product name')}</li>
                <li>{T('img_rule_2', 'Spaces and underscores are treated as equivalent')}</li>
                <li>{T('img_rule_3', 'Supported: jpg, jpeg, png, gif, webp')}</li>
              </ul>
            </div>
          </div>
          <div
            onDragOver={handleImageDragOver}
            onDragLeave={handleImageDragLeave}
            onDrop={handleImageDropEvent}
            className={`rounded-xl border p-4 transition-colors ${
              isImageDragActive
                ? 'border-2 border-dashed border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              <FolderOpen className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
              {isImageDragActive ? T('zip_drop_file', 'Drop the .zip here') : T('select_image_folder_label', 'Select image folder')}
            </p>
            <div className="flex flex-wrap gap-2">
              <div className="input min-w-0 flex-1 truncate text-sm text-gray-500">{imageDir || T('no_folder_selected', 'No folder selected')}</div>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageDirectory}>
                {T('browse', 'Browse')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageZip}>
                {T('zip_images', 'ZIP')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setFilePickerOpen(true)}>
                {T('files', 'Files')}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              {T('zip_drop_hint', 'or drag a .zip of images anywhere in this box')}
            </p>
          </div>
          <button type="button" className="btn-primary w-full" onClick={handleImageOnlyImport} disabled={loading || (!Object.keys(imageFiles).length && !zipFile)}>
            {loading ? T('importing_images', 'Importing...') : T('match_import_images', 'Match and import {n} images').replace('{n}', String(Object.keys(imageFiles).length))}
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          {mode === 'products' && importMode === 'replace_all' ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {T('csv_mode_replace_review_warning', 'Replace mode: importing will also deactivate every active product not in this file, in addition to the changes below.')}
              </span>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-green-50 p-2 dark:bg-green-900/20">
              <div className="text-lg font-bold text-green-700 dark:text-green-400">{cleanRows.length}</div>
              <div className="text-green-600 dark:text-green-500">{T('new_products_count', 'New products')}</div>
            </div>
            <div className="rounded-lg bg-yellow-50 p-2 dark:bg-yellow-900/20">
              <div className="text-lg font-bold text-yellow-700 dark:text-yellow-400">{conflicts.length}</div>
              <div className="text-yellow-600 dark:text-yellow-500">{T('existing_matches_count', 'Existing matches')}</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
              <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{analysisSummary?.variantCount ?? pendingAsk.length}</div>
              <div className="text-blue-600 dark:text-blue-500">{T('variant_rows_count', 'Variant rows')}</div>
            </div>
          </div>

          {conflicts.length ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="mb-3 grid gap-2">
                  <label className="sr-only" htmlFor="product-import-conflict-search">Search conflicts</label>
                  <input
                    id="product-import-conflict-search"
                    className="input h-11 text-sm"
                    value={conflictQuery}
                    onChange={(event) => setConflictQuery(event.target.value)}
                    placeholder="Search conflict rows by name, barcode, SKU, brand, category..."
                    autoComplete="off"
                  />
                  <div className="flex flex-col gap-1.5" data-testid="product-import-filter-row">
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {CONFLICT_FILTER_OPTIONS.filter((item) => item.group === 'scope' || item.group === 'severity').map(renderConflictFilterChip)}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        By field
                      </span>
                      {CONFLICT_FILTER_OPTIONS.filter((item) => item.group === 'field').map(renderConflictFilterChip)}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        By status
                      </span>
                      {CONFLICT_FILTER_OPTIONS.filter((item) => item.group === 'status').map(renderConflictFilterChip)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    onClick={undoLastReviewChange}
                    disabled={!reviewUndoStack.length}
                    title={reviewUndoStack.length ? `Undo: ${reviewUndoStack[reviewUndoStack.length - 1]?.label || 'last review change'}` : 'No review changes to undo yet.'}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Undo
                  </button>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={visibleReviewRowCount > 0 && selectedConflictCount > 0 && selectedConflictCount === visibleReviewRowCount}
                      onChange={(event) => toggleSelectAllConflicts(event.target.checked)}
                    />
                    Visible matches
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">Action</span>
                    <AppSelect
                      value=""
                      onChange={(nextValue) => { if (nextValue) applyDecisionToSelection(nextValue) }}
                      ariaLabel="Apply action to selected"
                      className="min-w-[9rem]"
                      buttonClassName="h-8 w-full px-2 py-1 text-xs"
                      menuClassName="min-w-[10rem]"
                      optionClassName="text-xs"
                      options={[{ value: '', label: 'Apply to selected...' }, ...IMPORT_DECISION_OPTIONS]}
                    />
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">SKU/barcode</span>
                    <AppSelect
                      value=""
                      onChange={(nextValue) => { if (nextValue) applyIdentifierDecisionToSelection(nextValue) }}
                      ariaLabel="Apply identifier decision to selected"
                      className="min-w-[9rem]"
                      buttonClassName="h-8 w-full px-2 py-1 text-xs"
                      menuClassName="min-w-[10rem]"
                      optionClassName="text-xs"
                      options={[{ value: '', label: 'Apply...' }, ...IDENTIFIER_DECISION_OPTIONS]}
                    />
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">Images</span>
                    <AppSelect
                      value=""
                      onChange={(nextValue) => { if (nextValue) applyImageDecisionToSelection(nextValue) }}
                      ariaLabel="Apply image decision to selected"
                      className="min-w-[9rem]"
                      buttonClassName="h-8 w-full px-2 py-1 text-xs"
                      menuClassName="min-w-[11rem]"
                      optionClassName="text-xs"
                      options={[{ value: '', label: 'Apply...' }, ...IMAGE_CONFLICT_OPTIONS]}
                    />
                  </label>
                  <label className="ml-auto inline-flex min-w-[13rem] items-center gap-2">
                    <span className="whitespace-nowrap text-gray-500 dark:text-gray-400">Details</span>
                    <AppSelect
                      value={(fieldRules.__preset as FieldRulePreset | undefined) || 'merge_blank_only'}
                      onChange={(nextValue) => {
                        const value = nextValue as FieldRulePreset
                        applyFieldRulePreset(value)
                      }}
                      ariaLabel="Product detail handling"
                      className="min-w-[11rem]"
                      buttonClassName="h-8 w-full px-2 py-1 text-xs"
                      menuClassName="min-w-[11rem]"
                      optionClassName="text-xs"
                      options={[
                        { value: 'merge_blank_only', label: 'Fill blanks only' },
                        { value: 'keep_existing', label: 'Keep existing' },
                        { value: 'use_imported', label: 'Use imported' },
                      ]}
                    />
                  </label>
                </div>
              </div>
              <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {T('import_conflict_rows_label', 'Rows that need review')}
                  </p>
                {visibleConflictSections.map((section) => {
                  const collapsed = collapsedFamilyKeys.has(section.familyKey)
                  const group = section.group
                  return (
                    <div key={section.key} className={group ? 'overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/50 dark:bg-indigo-950/10' : 'space-y-2'}>
                      {group ? (
                        <div className="flex flex-wrap items-start gap-2 p-2 text-xs">
                          <button
                            type="button"
                            className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-200"
                            onClick={() => toggleFamilyCollapse(section.familyKey)}
                            title={collapsed ? 'Expand this family group.' : 'Collapse this family group.'}
                            aria-label={collapsed ? 'Expand family group' : 'Collapse family group'}
                          >
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          <div className="min-w-[12rem] flex-1">
                            <div className="font-semibold text-indigo-900 dark:text-indigo-100">Family: {section.title}</div>
                            <div className="mt-0.5 text-indigo-700/80 dark:text-indigo-200/80">
                              Rows {summarizeRowNumbers(section.rowNumbers)} - {group.subgroups?.length || 1} case(s). Expand to decide which row adds stock and which row becomes a parent or variant.
                            </div>
                            {group.subgroups?.length ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {group.subgroups.map((subgroup, subgroupIndex) => (
                                  <span key={subgroup.signature || subgroupIndex} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-slate-900 dark:text-indigo-200" title={summarizeSubgroup(subgroup, subgroupIndex)}>
                                    {summarizeSubgroup(subgroup, subgroupIndex)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-white px-2 py-1 font-semibold text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-200"
                            onClick={() => setSelectedConflictIds((current) => {
                              const next = new Set(current)
                              section.rows.forEach((entry) => next.add(entry.index))
                              return next
                            })}
                            title="Select every visible row in this family for one bulk action."
                          >
                            Select family
                          </button>
                        </div>
                      ) : null}
                      {!collapsed ? (
                        <div className={group ? 'space-y-2 border-t border-indigo-100 p-2 dark:border-indigo-900/40' : 'space-y-2'}>
                          {section.rows.map(renderConflictRow)}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {conflicts.length > visibleConflicts.length ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    Showing first {visibleReviewRowCount} visible family/review rows from {conflicts.length} review matches. Search or use filters to narrow the rows before applying bulk actions.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {blockingIssueCount ? (
            <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">
              {T('blocking_barcode_issue_count', '{n} barcode(s) must be edited or cleared before import.').replace('{n}', String(blockingIssueCount))}
              {' '}
              {blockingIssueEntries.slice(0, 3).map((entry) => `Row ${entry.rowNumber}: ${getProductImportIssueLabel(entry.issue)}`).join('; ')}
            </p>
          ) : null}

          {pendingAsk.length ? (
            <p className="rounded-lg bg-yellow-50 p-2 text-xs text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400">
              {T('still_need_decision', '{n} product(s) still need a decision.').replace('{n}', String(pendingAsk.length))}
            </p>
          ) : null}

          {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx's
              own fix -- this is the review step, which can run long once
              rows/photos are listed above it. */}
          <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
            <button type="button" className="btn-secondary" onClick={resetCsvState}>{T('back', 'Back')}</button>
            <button type="button" className="btn-primary flex-1" onClick={handleImport} disabled={loading || !allDecided || (importMode === 'replace_columns' && !selectedReplaceColumns.length)}>
              {loading ? T('importing_images', 'Importing...') : T('import_n_products', 'Import {n} products').replace('{n}', String(totalCount))}
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && result ? (
        <div className="space-y-4">
          <div className={`rounded-xl p-4 ${result.queued ? 'bg-blue-50 dark:bg-blue-900/20' : (result.imported || 0) + (result.updated || 0) > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            {result.queued ? <p className="text-sm font-medium">{result.message || T('import_job_started_background', '{n} item(s) queued for background analysis. Review and approve it from the top progress bar.').replace('{n}', String(result.queued))}</p> : null}
            {result.jobId ? <p className="mt-1 text-xs opacity-70">Job: {result.jobId}</p> : null}
            {result.imported > 0 ? <p className="text-sm">{T('n_products_created', '{n} new products created').replace('{n}', String(result.imported))}</p> : null}
            {result.updated > 0 ? <p className="text-sm">{T('n_products_updated', '{n} products updated').replace('{n}', String(result.updated))}</p> : null}
            {(result.images_matched || 0) > 0 ? <p className="text-sm">{T('n_images_matched', '{n} images matched').replace('{n}', String(result.images_matched || 0))}</p> : null}
            {!result.queued && result.imported === 0 && result.updated === 0 && (result.images_matched || 0) === 0 ? <p className="text-sm">No changes applied.</p> : null}
          </div>
          {Array.isArray(result.errors) && result.errors.length ? (
            <div>
              <p className="mb-1 text-sm font-medium text-red-600">{T('errors_count', 'Errors ({n})').replace('{n}', String(result.errors.length))}</p>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20">
                {result.errors.map((message, index) => <div key={index}>{message}</div>)}
              </div>
              {result.job?.id ? (
                <button type="button" className="btn-secondary mt-2 text-sm" onClick={() => { if (result.job?.id) getProductImportApi().downloadImportJobErrors?.(result.job.id) }}>
                  {T('download_failed_rows', 'Download failed rows')}
                </button>
              ) : null}
            </div>
          ) : null}
          {result.cancelled || cancelledImportRecovery ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <div className="font-semibold">Cancelled import recovery</div>
              <div className="mt-1 text-xs">Job {result.job?.id || currentJob?.id || result.jobId || '-'} is cancelled or cannot be started until it is reset.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={handleRetryCurrentJob} disabled={loading || !(currentJob?.id || result.job?.id)}>
                  Retry import
                </button>
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={handleDeleteCurrentJob} disabled={loading || !(currentJob?.id || result.job?.id)}>
                  Delete import
                </button>
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={resetCsvState} disabled={loading}>
                  Back to upload
                </button>
              </div>
            </div>
          ) : null}
          {/* Images are NOT attached automatically any more (see
              handleWireImportJobImages above). This is the button that
              opts this job in, and it only appears when the job actually
              carried images -- offering it for a CSV-only import would be
              a control that does nothing. */}
          {(result.jobId || result.job?.id || currentJob?.id) && (Object.keys(imageFiles).length > 0 || zipFile) ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/20">
              <p className="font-medium text-blue-900 dark:text-blue-200">{T('wire_import_images_title', "Attach this import's images")}</p>
              <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                {T('wire_import_images_hint', 'Photos are matched to rows by filename but stay unattached until you ask for it, so you can review the match first. Nothing about the products changes if you skip this.')}
              </p>
              <button
                type="button"
                className="btn-secondary mt-2 text-sm"
                onClick={handleWireImportJobImages}
                disabled={wireImagesState !== 'idle'}
              >
                {wireImagesState === 'working'
                  ? T('wire_import_images_working', 'Wiring...')
                  : wireImagesState === 'wired'
                    ? T('wire_import_images_wired', 'Images will be attached')
                    : T('wire_import_images_action', 'Wire images to these rows')}
              </button>
            </div>
          ) : null}
          <button type="button" className="btn-primary w-full" onClick={onClose}>{T('close', 'Close')}</button>
        </div>
      ) : null}

      <FilePickerModal
        open={filePickerOpen}
        onClose={() => setFilePickerOpen(false)}
        mediaType="image"
        title={T('files', 'Files')}
        multiple
        onSelectMany={addLibraryImages}
      />
    </Modal>
  )
}
