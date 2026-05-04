import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Undo2 } from 'lucide-react'
import Modal from '../shared/Modal'
import FilePickerModal from '../files/FilePickerModal'
import {
  analyzeProductImportText,
  getProductImportBarcodeIssue,
  isBlockingProductImportIssue,
  normalizeImportProductName,
} from './productImportPlanner.mjs'

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

const IDENTIFIER_DECISION_OPTIONS = [
  { value: 'clear_imported', label: 'Clear duplicate ID' },
  { value: 'allow_duplicate', label: 'Keep same ID' },
]

const CONFLICT_FILTER_OPTIONS = [
  { value: 'all', label: 'All', countKey: 'total', hint: 'All rows that need review before the import can be applied.' },
  { value: 'same_name', label: 'Family', countKey: 'sameName', hint: 'Rows sharing the same product name. Expand the family to see parent and variant scenarios.' },
  { value: 'identifier', label: 'SKU/barcode', countKey: 'identifier', hint: 'Rows where SKU or barcode matches another row or an existing product and needs an identifier choice.' },
  { value: 'barcode', label: 'Barcode', countKey: 'barcode', hint: 'Rows with duplicate, unsafe, or review-worthy barcode values. Scientific notation blocks import until edited or cleared.' },
  { value: 'sku', label: 'SKU', countKey: 'sku', hint: 'Rows with duplicate or matched SKU values.' },
  { value: 'pricing', label: 'Pricing', countKey: 'pricing', hint: 'Rows where price/cost values differ from a match, or all price columns are blank or zero.' },
  { value: 'existing', label: 'Matched', countKey: 'existing', hint: 'Rows already matched to an existing product candidate.' },
  { value: 'variant', label: 'Variants', countKey: 'variant', hint: 'Rows planned as variants or links under a family parent.' },
  { value: 'merge', label: 'Add stock', countKey: 'merge', hint: 'Rows planned to add incoming stock to an existing or same-family target.' },
  { value: 'override', label: 'Override', countKey: 'override', hint: 'Rows where imported details can overwrite or fill existing product fields.' },
  { value: 'errors', label: 'Errors', countKey: 'errors', hint: 'Rows with blocking issues such as missing names or unsafe barcodes.' },
]

const FIELD_RULE_PRESET_HINTS = {
  merge_blank_only: 'Only fill blank existing details; keep existing values when both sides have data.',
  keep_existing: 'Keep existing product details and only import stock/images according to row actions.',
  use_imported: 'Use imported CSV details for reviewed fields when the row updates or overrides a product.',
}

function getBaseName(value) {
  return String(value || '')
    .split(/[\\/]/)
    .pop()
    .trim()
}

function analyzeProductCsvInWorker({ text, existingProducts, onProgress }) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(analyzeProductImportText(text, existingProducts))
  }
  return new Promise((resolve, reject) => {
    const id = `product-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const worker = new Worker(new URL('./productImportWorker.mjs', import.meta.url), { type: 'module' })
    const cleanup = () => worker.terminate()
    worker.onmessage = (event) => {
      const message = event.data || {}
      if (message.id !== id) return
      if (message.type === 'progress') {
        onProgress?.({ progress: message.progress || 0, label: message.label || '' })
        return
      }
      cleanup()
      if (message.type === 'result') resolve(message.result)
      else reject(new Error(message.error || 'Import analysis failed'))
    }
    worker.onerror = (error) => {
      cleanup()
      reject(new Error(error?.message || 'Import analysis worker failed'))
    }
    worker.postMessage({ id, text, existingProducts })
  })
}

/**
 * 1. CSV image reference parser.
 * 1.1 Accept legacy image_filename columns and URL/path columns.
 * 1.2 Convert paths/URLs to basename for human conflict display.
 * 1.3 Keep max 5 unique names in source order.
 */
function getIncomingImageFilenames(row = {}) {
  const direct = [
    'image_filename',
    'image_filename_1', 'image_filename_2', 'image_filename_3', 'image_filename_4', 'image_filename_5',
    'image_1', 'image_2', 'image_3', 'image_4', 'image_5',
    'image_url_1', 'image_url_2', 'image_url_3', 'image_url_4', 'image_url_5',
  ]
  const candidates = []
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
  const seen = new Set()
  const unique = []
  for (const item of candidates) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
    if (unique.length >= 5) break
  }
  return unique
}

function getExistingImageFilenames(product = {}) {
  const safeProduct = product && typeof product === 'object' ? product : {}
  let gallery = []
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
  const seen = new Set()
  const names = []
  for (const entry of source) {
    const name = getBaseName(entry)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= 5) break
  }
  return names
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const IMPORT_REVIEW_EDIT_FIELDS = [
  ['name', 'Name'],
  ['sku', 'SKU'],
  ['barcode', 'Barcode'],
  ['brand', 'Brand'],
  ['category', 'Category'],
  ['unit', 'Unit'],
  ['supplier', 'Supplier'],
  ['branch', 'Branch'],
  ['stock_quantity', 'Stock'],
  ['low_stock_threshold', 'Low stock'],
  ['purchase_price_usd', 'Cost USD'],
  ['purchase_price_khr', 'Cost KHR'],
  ['selling_price_usd', 'Sell USD'],
  ['selling_price_khr', 'Sell KHR'],
  ['special_price_usd', 'Special USD'],
  ['special_price_khr', 'Special KHR'],
  ['discount_percent', 'Discount %'],
  ['discount_amount_usd', 'Discount USD'],
  ['discount_amount_khr', 'Discount KHR'],
  ['description', 'Description'],
]

const IMPORT_PRICE_FIELDS = ['purchase_price_usd', 'purchase_price_khr', 'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr']

function compactImportValue(value) {
  const text = String(value ?? '').trim()
  return text || '-'
}

function isBlankImportValue(value) {
  return String(value ?? '').trim() === ''
}

function hasPriceReviewIssue(row = {}, existing = null, samePricing = true) {
  if (existing && samePricing === false) return true
  return IMPORT_PRICE_FIELDS.every((field) => isBlankImportValue(row?.[field]) || Number(row?.[field] || 0) === 0)
}

function getProductImportIssueLabel(issueType) {
  if (issueType === 'barcode_scientific_notation') return 'Barcode exported as scientific notation'
  if (issueType === 'barcode_too_long') return 'Barcode too long'
  if (issueType === 'invalid_barcode') return 'Invalid barcode'
  if (issueType === 'barcode_text') return 'Barcode text'
  if (issueType === 'missing_name') return 'Missing name'
  return String(issueType || '').replaceAll('_', ' ')
}

function getProductImportIssueHint(issueType) {
  if (issueType === 'barcode_scientific_notation') return 'Edit this barcode, clear it, or re-export the CSV with the barcode column formatted as text. Scientific notation cannot be applied safely.'
  if (issueType === 'barcode_too_long') return 'Shorten this barcode or clear it before importing.'
  if (issueType === 'invalid_barcode') return 'Remove invalid control characters or clear this barcode before importing.'
  if (issueType === 'barcode_text') return 'This barcode contains text or symbols. It can be kept if that is intentional.'
  return 'Review this row before importing.'
}

function getProductImportRowIssueDetails(entry = {}, editedRow = {}) {
  const details = []
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

function valuesDiffer(left, right) {
  return String(left ?? '').trim().normalize('NFC') !== String(right ?? '').trim().normalize('NFC')
}

function normalizeImageMatchKey(value) {
  return String(value || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function getImageReference(entryKey, entryValue) {
  const textValue = typeof entryValue === 'string' ? entryValue.trim() : ''
  if (textValue && (/^data:image\//i.test(textValue) || /^https?:\/\//i.test(textValue) || textValue.startsWith('/uploads/') || textValue.startsWith('uploads/'))) {
    return textValue.startsWith('uploads/') ? `/${textValue}` : textValue
  }
  return getBaseName(entryKey || textValue || entryValue?.name || '')
}

function findImageReferenceForRow(row = {}, imageFiles = {}) {
  const keys = [row.name, row.sku, row.barcode].map(normalizeImageMatchKey).filter(Boolean)
  if (!keys.length) return ''
  for (const [entryKey, entryValue] of Object.entries(imageFiles || {})) {
    const imageKey = normalizeImageMatchKey(entryKey || entryValue?.name || '')
    if (imageKey && keys.includes(imageKey)) return getImageReference(entryKey, entryValue)
  }
  return ''
}

function getDecisionLabel(value) {
  return IMPORT_DECISION_OPTIONS.find((item) => item.value === value)?.label || String(value || 'Action')
}

function getFamilyKeyForRow(row = {}) {
  return normalizeImportProductName(row?.name) || `row:${Number(row?._import_row_index ?? row?._rowNumber ?? 0)}`
}

function summarizeRowNumbers(rowNumbers = []) {
  const unique = Array.from(new Set((Array.isArray(rowNumbers) ? rowNumbers : []).map((value) => Number(value)).filter(Boolean))).sort((left, right) => left - right)
  if (!unique.length) return '-'
  if (unique.length <= 4) return unique.join(', ')
  return `${unique.slice(0, 3).join(', ')} +${unique.length - 3}`
}

function summarizeSubgroup(subgroup = {}, index = 0) {
  const label = getDecisionLabel(subgroup.suggestedAction || 'new')
  return `Case ${index + 1}: ${label} - rows ${summarizeRowNumbers(subgroup.rowNumbers)}`
}

function getImportActionTargetSummary(entry = {}, decisionValue = '', editedRow = {}) {
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

function InlineImportDetailGrid({ row = {}, compareTo = null, onBeginEdit, onChange }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {IMPORT_REVIEW_EDIT_FIELDS.map(([field, label]) => {
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

function buildImageOnlyCsv(imageFiles = {}) {
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

function getBrowserImageEntries(imageFiles = {}) {
  return Object.entries(imageFiles || {})
    .filter(([, value]) => typeof File !== 'undefined' && value instanceof File)
    .map(([relativePath, file]) => ({
      relativePath: relativePath || file.webkitRelativePath || file.name,
      file,
    }))
}

export default function BulkImportModal({ onClose, onDone, t }) {
  const [mode, setMode] = useState('products')
  const [step, setStep] = useState(1)
  const [csvData, setCsvData] = useState(null)
  const [imageDir, setImageDir] = useState(null)
  const [imageFiles, setImageFiles] = useState({})
  const [zipFile, setZipFile] = useState(null)
  const [conflicts, setConflicts] = useState([])
  const [cleanRows, setCleanRows] = useState([])
  const [importRows, setImportRows] = useState([])
  const [reviewGroups, setReviewGroups] = useState([])
  const [analysisSummary, setAnalysisSummary] = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [imageDecisions, setImageDecisions] = useState({})
  const [identifierDecisions, setIdentifierDecisions] = useState({})
  const [identifierOverrides, setIdentifierOverrides] = useState({})
  const [rowOverrides, setRowOverrides] = useState({})
  const [conflictFilter, setConflictFilter] = useState('all')
  const [conflictQuery, setConflictQuery] = useState('')
  const [selectedConflictIds, setSelectedConflictIds] = useState(() => new Set())
  const [collapsedFamilyKeys, setCollapsedFamilyKeys] = useState(() => new Set())
  const [reviewUndoStack, setReviewUndoStack] = useState([])
  const [fieldRules, setFieldRules] = useState({})
  const [result, setResult] = useState(null)
  const [currentJob, setCurrentJob] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const cancelRequestedRef = useRef(false)
  const editSessionRef = useRef(new Set())

  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)

  const throwIfImportCancelled = () => {
    if (!cancelRequestedRef.current) return
    const error = new Error(T('import_cancelled', 'Import cancelled.'))
    error.code = 'import_cancel_requested'
    throw error
  }

  const setCancelledResult = (jobId = currentJob?.id) => {
    setResult({
      imported: 0,
      updated: 0,
      queued: 0,
      jobId,
      cancelled: true,
      errors: [],
      message: T('import_cancelled', 'Import cancelled.'),
    })
    setStep(3)
  }

  const createReviewSnapshot = (label) => ({
    label,
    decisions,
    imageDecisions,
    identifierDecisions,
    identifierOverrides,
    rowOverrides,
    fieldRules,
  })

  const pushReviewUndoSnapshot = (label) => {
    setReviewUndoStack((stack) => [...stack.slice(-19), createReviewSnapshot(label)])
  }

  const undoLastReviewChange = () => {
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

  const beginInlineEdit = (rowIndex, field, label = 'Edited row details') => {
    const key = `${rowIndex}:${field}`
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
    setReviewUndoStack([])
    setFieldRules({})
    setZipFile(null)
    setCurrentJob(null)
    editSessionRef.current = new Set()
    cancelRequestedRef.current = false
    setStep(1)
  }

  const pickImageDirectory = async () => {
    const folder = await window.api.openFolderDialog?.()
    if (folder) {
      setImageDir(folder)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.multiple = true
    input.onchange = async (event) => {
      const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))
      if (!files.length) return
      const map = {}
      files.forEach((file) => {
        map[file.webkitRelativePath || file.name] = file
      })
      setImageFiles(map)
      const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Folder'
      setImageDir(`${folderName} (${files.length})`)
    }
    input.click()
  }

  const pickImageZip = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip,application/x-zip-compressed'
    input.onchange = (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      setZipFile(file)
      setImageDir(`${file.name} (${Math.ceil(file.size / 1024 / 1024)} MB ZIP)`)
    }
    input.click()
  }

  const addLibraryImages = (assets = []) => {
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

  const buildCsvForImportJob = () => {
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
    const headers = Array.from(instructions.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key))
      return set
    }, new Set(['name', 'sku', 'barcode', '_action', '_target_product_id', '_parent_id', '_field_rules', '_identifier_conflict_mode', 'image_conflict_mode'])))
    return [
      headers.join(','),
      ...instructions.map((row) => headers.map((header) => csvEscape(row?.[header])).join(',')),
    ].join('\n')
  }

  const handleCancelCurrentJob = async () => {
    if (!currentJob?.id) return
    if (loading && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm(T('confirm_cancel_import', 'Cancel this import? The upload/start sequence will stop immediately.'))
      if (!confirmed) return
    }
    cancelRequestedRef.current = true
    try {
      const payload = await window.api.cancelImportJob(currentJob.id, { source: 'products_modal' })
      setCurrentJob(payload?.job || payload || currentJob)
      setAnalysisProgress((current) => ({
        progress: current?.progress || 0,
        label: T('cancel_requested', 'Cancel requested...'),
      }))
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [error?.message || 'Failed to cancel import job'] })
      setStep(3)
      setLoading(false)
    }
  }

  const handleImageOnlyImport = async () => {
    if (!Object.keys(imageFiles).length && !zipFile) return
    cancelRequestedRef.current = false
    setLoading(true)
    setAnalysisProgress({ progress: 0, label: 'Creating import job' })
    let jobId = null
    try {
      const created = await window.api.createImportJob({
        type: 'products',
        policy: { mode: 'images_only', image_conflict_mode: 'append_csv' },
      })
      const job = created?.job || created
      setCurrentJob(job)
      jobId = job?.id
      if (!jobId) throw new Error('Import job was not created')
      throwIfImportCancelled()

      await window.api.uploadImportJobCsv({
        jobId,
        text: buildImageOnlyCsv(imageFiles),
        fileName: 'image-only-import.csv',
      })
      throwIfImportCancelled()
      if (zipFile) {
        setAnalysisProgress({ progress: 10, label: 'Uploading ZIP image pack' })
        await window.api.uploadImportJobZip({ jobId, file: zipFile })
        throwIfImportCancelled()
      }
      const browserImages = getBrowserImageEntries(imageFiles)
      if (browserImages.length) {
        await window.api.uploadImportJobImages({
          jobId,
          files: browserImages,
          onProgress: setAnalysisProgress,
        })
        throwIfImportCancelled()
      }
      throwIfImportCancelled()
      await window.api.startImportJob(jobId, { source: 'products_modal' })
      throwIfImportCancelled()
      setResult({
        imported: 0,
        updated: 0,
        images_matched: 0,
        queued: Object.keys(imageFiles).length,
        jobId,
        errors: [],
        message: T('import_analysis_started', 'Import analysis started. Review and approve it from the top progress bar.'),
      })
      setStep(3)
      return
    } catch (error) {
      if (error?.code === 'import_cancel_requested') {
        setCancelledResult(jobId)
      } else {
        setResult({ imported: 0, updated: 0, errors: [error?.message || 'Import failed'] })
        setStep(3)
      }
    } finally {
      setLoading(false)
      setAnalysisProgress(null)
    }
  }

  const handlePickCSV = async () => {
    const picked = await window.api.openCSVDialog()
    if (!picked) return
    setCsvData(picked)
    setLoading(true)
    setAnalysisProgress({ progress: 0, label: 'Preparing import' })
    try {
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
      const nextImageDecisions = {}
      const nextIdentifierDecisions = {}
      const nextIdentifierOverrides = {}
      ;[...(analysis.cleanRows || []), ...nextConflicts].forEach((entry) => {
        const index = Number(entry.index ?? entry.row?._import_row_index ?? 0)
        const incomingImages = getIncomingImageFilenames(entry.row)
        nextImageDecisions[index] = incomingImages.length ? (entry.plannedAction === 'merge_stock' ? 'keep_existing' : 'replace_with_csv') : 'keep_existing'
        if ((entry.conflictFields || []).length) nextIdentifierDecisions[index] = entry.row?._identifier_conflict_mode || 'clear_imported'
        if ((entry.conflictFields || []).length) nextIdentifierOverrides[index] = { sku: entry.row?.sku || '', barcode: entry.row?.barcode || '' }
      })

      setConflicts(nextConflicts)
      setCleanRows(analysis.cleanRows || [])
      setImportRows(analysis.rows || [])
      setReviewGroups(analysis.groups || [])
      setAnalysisSummary(analysis.summary || null)
      setDecisions(analysis.decisions || {})
      setImageDecisions(nextImageDecisions)
      setIdentifierDecisions(nextIdentifierDecisions)
      setIdentifierOverrides(nextIdentifierOverrides)
      setSelectedConflictIds(new Set(nextConflicts.map((entry) => entry.index)))
      setCollapsedFamilyKeys(new Set())
      setReviewUndoStack([])
      editSessionRef.current = new Set()
      setStep(2)
    } catch (error) {
      alert(`Failed to analyze CSV: ${error?.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
      setAnalysisProgress(null)
    }
  }

  const handleImport = async () => {
    if (!csvData?.content) return
    cancelRequestedRef.current = false
    setLoading(true)
    setAnalysisProgress({ progress: 0, label: 'Creating import job' })
    let jobId = null
    try {
      const created = await window.api.createImportJob({
        type: 'products',
        policy: {
          source: 'products_modal',
          field_rules: fieldRules,
        },
      })
      const job = created?.job || created
      setCurrentJob(job)
      jobId = job?.id
      if (!jobId) throw new Error('Import job was not created')
      throwIfImportCancelled()

      await window.api.uploadImportJobCsv({
        jobId,
        text: buildCsvForImportJob(),
        fileName: csvData?.name || 'products-import.csv',
      })
      throwIfImportCancelled()
      if (zipFile) {
        setAnalysisProgress({ progress: 10, label: 'Uploading ZIP image pack' })
        await window.api.uploadImportJobZip({ jobId, file: zipFile })
        throwIfImportCancelled()
      }
      const browserImages = getBrowserImageEntries(imageFiles)
      if (browserImages.length) {
        await window.api.uploadImportJobImages({
          jobId,
          files: browserImages,
          onProgress: setAnalysisProgress,
        })
        throwIfImportCancelled()
      }
      throwIfImportCancelled()
      await window.api.startImportJob(jobId, { source: 'products_modal' })
      throwIfImportCancelled()
      setResult({
        imported: 0,
        updated: 0,
        queued: totalCount,
        jobId,
        errors: [],
        message: T('import_analysis_started', 'Import analysis started. Review and approve it from the top progress bar.'),
      })
      setStep(3)
      return
    } catch (error) {
      if (error?.code === 'import_cancel_requested') {
        setCancelledResult(jobId)
      } else {
        setResult({ imported: 0, updated: 0, errors: [error?.message || 'Import failed'] })
        setStep(3)
      }
    } finally {
      setLoading(false)
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
  const reviewIssueSummary = reviewIssueRows.slice(0, 8)
  const allDecided = pendingAsk.length === 0 && blockingIssueCount === 0
  const totalCount = importRows.length || cleanRows.length + conflicts.length
  const selectedConflictCount = selectedConflictIds.size
  const conflictGroups = useMemo(() => ({
    total: conflicts.length,
    sameName: conflicts.filter((entry) => String(entry.conflictType || '').includes('same_name')).length,
    identifier: conflicts.filter((entry) => (entry.conflictFields || []).length).length,
    barcode: conflicts.filter((entry) => (entry.conflictFields || []).includes('barcode')).length,
    sku: conflicts.filter((entry) => (entry.conflictFields || []).includes('sku')).length,
    pricing: conflicts.filter((entry) => hasPriceReviewIssue({ ...(entry.row || {}), ...(rowOverrides[entry.index] || {}) }, entry.existing, entry.samePricing)).length,
    existing: conflicts.filter((entry) => !!entry.existing).length,
    variant: conflicts.filter((entry) => ['create_variant', 'link_variant'].includes(String(decisions[entry.index] || entry.plannedAction || ''))).length,
    merge: conflicts.filter((entry) => String(decisions[entry.index] || entry.plannedAction || '') === 'merge_stock').length,
    override: conflicts.filter((entry) => String(decisions[entry.index] || entry.plannedAction || '').startsWith('override')).length,
    errors: conflicts.filter((entry) => String(entry.conflictType || '').includes('missing_name') || (entry.issueTypes || []).length || (entry.conflictFields || []).includes('errors')).length,
  }), [conflicts, decisions, rowOverrides])
  const visibleConflicts = useMemo(() => {
    const query = conflictQuery.trim().toLowerCase()
    return conflicts.filter((entry) => {
      const type = String(entry.conflictType || '')
      const fields = entry.conflictFields || []
      const planned = String(decisions[entry.index] || entry.plannedAction || '')
      const editedRow = { ...(entry.row || {}), ...(rowOverrides[entry.index] || {}) }
      if (conflictFilter === 'same_name' && !type.includes('same_name')) return false
      if (conflictFilter === 'identifier' && !fields.length) return false
      if (conflictFilter === 'barcode' && !fields.includes('barcode')) return false
      if (conflictFilter === 'sku' && !fields.includes('sku')) return false
      if (conflictFilter === 'pricing' && !hasPriceReviewIssue(editedRow, entry.existing, entry.samePricing)) return false
      if (conflictFilter === 'existing' && !entry.existing) return false
      if (conflictFilter === 'variant' && !['create_variant', 'link_variant'].includes(planned)) return false
      if (conflictFilter === 'merge' && planned !== 'merge_stock') return false
      if (conflictFilter === 'override' && !planned.startsWith('override')) return false
      if (conflictFilter === 'errors' && !type.includes('missing_name') && !(entry.issueTypes || []).length && !fields.includes('errors')) return false
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
  }, [conflictFilter, conflictQuery, conflicts, decisions, rowOverrides])

  const visibleConflictSections = useMemo(() => {
    const groupByRowIndex = new Map()
    reviewGroups.forEach((group) => {
      ;(group.rowIndexes || []).forEach((rowIndex) => {
        groupByRowIndex.set(Number(rowIndex), group)
      })
    })
    const sections = []
    const sectionByFamily = new Map()

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
          rows: [],
        }
        sectionByFamily.set(key, section)
        sections.push(section)
      }
      sectionByFamily.get(key).rows.push(entry)
    })

    return sections
  }, [reviewGroups, rowOverrides, visibleConflicts])

  const toggleFamilyCollapse = (familyKey) => {
    setCollapsedFamilyKeys((current) => {
      const next = new Set(current)
      if (next.has(familyKey)) next.delete(familyKey)
      else next.add(familyKey)
      return next
    })
  }

  const toggleConflictSelection = (index) => {
    setSelectedConflictIds((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const toggleSelectAllConflicts = (checked) => {
    if (!checked) {
      setSelectedConflictIds(new Set())
      return
    }
    setSelectedConflictIds(new Set(visibleConflicts.map((entry) => entry.index)))
  }

  const applyDecisionToSelection = (value) => {
    if (!selectedConflictIds.size) return
    pushReviewUndoSnapshot('Changed selected import actions')
    setDecisions((current) => {
      const next = { ...current }
      conflicts.forEach((entry) => {
        if (selectedConflictIds.has(entry.index)) next[entry.index] = value
      })
      return next
    })
  }

  const applyImageDecisionToSelection = (value) => {
    if (!selectedConflictIds.size) return
    pushReviewUndoSnapshot('Changed selected image actions')
    setImageDecisions((current) => {
      const next = { ...current }
      conflicts.forEach((entry) => {
        const editedRow = { ...(entry.row || {}), ...(rowOverrides[entry.index] || {}) }
        const hasImage = entry.incomingImages.length || findImageReferenceForRow(editedRow, imageFiles)
        if (selectedConflictIds.has(entry.index) && hasImage) next[entry.index] = value
      })
      return next
    })
  }

  const applyIdentifierDecisionToSelection = (value) => {
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

  const applyFieldRulePreset = (preset) => {
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

  const renderConflictRow = (entry) => {
    const { row, index, existing, plannedAction, conflictType, conflictFields = [], importDuplicateRows = {}, sameBasic, samePricing, sameImages, incomingImages = [], existingImages = [] } = entry
    const editedRow = {
      ...(row || {}),
      ...(rowOverrides[index] || {}),
      sku: identifierOverrides[index]?.sku ?? rowOverrides[index]?.sku ?? row?.sku ?? '',
      barcode: identifierOverrides[index]?.barcode ?? rowOverrides[index]?.barcode ?? row?.barcode ?? '',
    }
    const updateEditedRow = (field, value) => {
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

    return (
      <div key={index} className={`rounded-xl border p-2 text-sm ${liveBarcodeBlocking ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20' : decisionValue === 'ask' ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={selectedConflictIds.has(index)} onChange={() => toggleConflictSelection(index)} aria-label={`Select conflict row ${index + 1}`} />
          <div className="min-w-[12rem] flex-1">
            <div className="truncate font-medium text-gray-900 dark:text-white">Row {editedRow._rowNumber || index + 2}: {editedRow.name || 'Needs a product name'}</div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={targetSummary}>Target: {targetSummary}</div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
              {String(conflictType || '').includes('same_name') ? <span title="This row belongs to a same-name product family." className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">Family</span> : null}
              {conflictFields.length ? <span title="SKU or barcode matches another product or another CSV row." className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Same {conflictFields.join(' + ').toUpperCase()}</span> : null}
              {!sameBasic || !samePricing ? <span title="Imported product details or pricing differ from the matched target." className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">Different details</span> : <span title="Imported row details match the candidate target." className="rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">Same details</span>}
              {existing ? <span title="Matched existing product candidate." className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-200">Matched: {existing.name}</span> : null}
              {rowIncomingImages.length ? <span title="A CSV or library image is available for this row." className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Image ready</span> : null}
              {!sameImages ? <span title="Incoming image set differs from the current product images." className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Image difference</span> : null}
              {liveBarcodeIssue ? (
                <span title={getProductImportIssueHint(liveBarcodeIssue)} className={`rounded px-1.5 py-0.5 ${liveBarcodeBlocking ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'}`}>
                  {getProductImportIssueLabel(liveBarcodeIssue)}
                </span>
              ) : null}
            </div>
          </div>
          <select
            className="input h-8 min-w-[8.5rem] py-1 text-xs"
            value={decisionValue}
            title={`Action target: ${targetSummary}`}
            onChange={(event) => {
              pushReviewUndoSnapshot(`Changed row ${editedRow._rowNumber || index + 2} action`)
              setDecisions((state) => ({ ...state, [index]: event.target.value }))
            }}
          >
            {IMPORT_DECISION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {conflictFields.length ? (
            <select
              className="input h-8 min-w-[8.5rem] py-1 text-xs"
              value={identifierDecision}
              title="Choose whether duplicate SKU/barcode values are cleared, changed, or intentionally kept."
              onChange={(event) => {
                const value = event.target.value
                pushReviewUndoSnapshot(`Changed row ${editedRow._rowNumber || index + 2} identifier choice`)
                setIdentifierDecisions((state) => ({ ...state, [index]: value }))
                if (value === 'allow_duplicate') {
                  setIdentifierOverrides((state) => ({ ...state, [index]: { sku: row.sku || '', barcode: row.barcode || '' } }))
                }
                if (value === 'clear_imported') {
                  setIdentifierOverrides((state) => ({ ...state, [index]: { sku: '', barcode: '' } }))
                }
              }}
            >
              {IDENTIFIER_DECISION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          ) : null}
          {rowIncomingImages.length ? (
            <select
              className="input h-8 min-w-[8.5rem] py-1 text-xs"
              value={imageDecision}
              title="Choose how incoming CSV/library images should affect the matched product images."
              onChange={(event) => {
                pushReviewUndoSnapshot(`Changed row ${editedRow._rowNumber || index + 2} image action`)
                setImageDecisions((state) => ({ ...state, [index]: event.target.value }))
              }}
            >
              {IMAGE_CONFLICT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          ) : null}
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2 text-xs dark:border-slate-700 dark:bg-slate-900/60">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-200">
            <span className="font-semibold">Inline details</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{existing ? `Comparing with ${existing.name || `#${existing.id}`}` : 'No existing product match. Click fields to edit before apply.'}</span>
          </div>
          <InlineImportDetailGrid
            row={editedRow}
            compareTo={existing}
            onBeginEdit={(field) => beginInlineEdit(index, field, `Edited row ${editedRow._rowNumber || index + 2}`)}
            onChange={updateEditedRow}
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
      </div>
    )
  }

  return (
    <Modal title={mode === 'products' ? T('csv_template_title', 'Products + CSV') : T('csv_images_only', 'Images Only')} onClose={onClose} wide>
      {step === 1 ? (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('products')}
            className={`flex-1 rounded-xl border py-2 text-sm font-medium ${mode === 'products' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400'}`}
          >
            {T('csv_template_title', 'Products + CSV')}
          </button>
          <button
            type="button"
            onClick={() => setMode('images')}
            className={`flex-1 rounded-xl border py-2 text-sm font-medium ${mode === 'images' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400'}`}
          >
            {T('csv_images_only', 'Images Only')}
          </button>
        </div>
      ) : null}

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
            <div><span className="font-semibold">{T('status', 'Status')}:</span> {currentJob.status || '-'}</div>
            <div><span className="font-semibold">{T('rows', 'Rows')}:</span> {Number(currentJob.processed_rows || 0)} / {Number(currentJob.total_rows || 0)}</div>
            <div><span className="font-semibold">{T('images', 'Images')}:</span> {Number(currentJob.processed_images || 0)} / {Number(currentJob.total_images || 0)}</div>
            <div><span className="font-semibold">{T('errors', 'Errors')}:</span> {Number(currentJob.failed_rows || 0) + Number(currentJob.failed_images || 0)}</div>
          </div>
          {loading ? (
            <button type="button" className="btn-secondary mt-3 text-xs" onClick={handleCancelCurrentJob}>
              {T('cancel_import', 'Cancel import')}
            </button>
          ) : null}
        </div>
      ) : null}

      {step === 1 && mode === 'products' ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            <p className="mb-1 font-semibold">{T('csv_columns_header', 'Columns')}</p>
            <p className="font-mono text-xs leading-relaxed">
              {T('csv_template_columns', 'name*, sku, barcode, category, brand, unit, description, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr, discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label, discount_badge_color, discount_starts_at, discount_ends_at, purchase_price_usd, purchase_price_khr, stock_quantity, low_stock_threshold, supplier, branch, parent_id, is_group, image_filename_1..5, image_filenames, image_conflict_mode')}
            </p>
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary flex-1 text-sm" onClick={() => window.api.downloadImportTemplate('products')}>
              {T('csv_template_download', 'Download Template')}
            </button>
            <button type="button" className="btn-primary flex-1 text-sm" onClick={handlePickCSV} disabled={loading}>
              {loading ? T('analysing', 'Analyzing...') : T('csv_template_upload', 'Upload CSV')}
            </button>
          </div>
          {analysisProgress ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span>{analysisProgress.label || T('analysing', 'Analyzing...')}</span>
                <span>{Math.round(analysisProgress.progress || 0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(5, Math.min(100, analysisProgress.progress || 0))}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 && mode === 'images' ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-yellow-50 p-4 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
            <p className="mb-1 font-semibold">{T('image_matching_rules', 'Image matching rules')}</p>
            <ul className="list-inside list-disc space-y-1 text-xs">
              <li>{T('img_rule_1', 'Filename must match product name')}</li>
              <li>{T('img_rule_2', 'Spaces and underscores are treated as equivalent')}</li>
              <li>{T('img_rule_3', 'Supported: jpg, jpeg, png, gif, webp')}</li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{T('select_image_folder_label', 'Select image folder')}</p>
            <div className="flex gap-2">
              <div className="input flex-1 truncate text-sm text-gray-500">{imageDir || T('no_folder_selected', 'No folder selected')}</div>
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
          </div>
          <button type="button" className="btn-primary w-full" onClick={handleImageOnlyImport} disabled={loading || (!Object.keys(imageFiles).length && !zipFile)}>
            {loading ? T('importing_images', 'Importing...') : T('match_import_images', 'Match and import {n} images').replace('{n}', String(Object.keys(imageFiles).length))}
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
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

          {reviewIssueSummary.length ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Errors and review blockers</div>
                  <div className="mt-0.5 text-red-600 dark:text-red-300">Fix these row-level issues before applying. Hover row badges for quick meanings, then edit inline fields directly.</div>
                </div>
                <button type="button" className="rounded-lg bg-white px-2 py-1 font-semibold text-red-700 shadow-sm dark:bg-slate-900 dark:text-red-200" onClick={() => setConflictFilter('errors')}>
                  Show error rows
                </button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {reviewIssueSummary.map((entry) => (
                  <div key={entry.index} className="rounded-lg border border-red-100 bg-white/75 p-2 dark:border-red-900/50 dark:bg-slate-950/40">
                    <div className="font-semibold">Row {entry.rowNumber}: {entry.name}</div>
                    <div className="mt-1 space-y-1">
                      {entry.details.map((detail) => (
                        <div key={detail.title} className={detail.blocking ? 'font-medium' : ''}>
                          <span className="font-semibold">{detail.title}:</span> {detail.detail}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {reviewIssueRows.length > reviewIssueSummary.length ? (
                <div className="mt-2 text-red-600 dark:text-red-300">
                  Showing first {reviewIssueSummary.length} of {reviewIssueRows.length} issue rows. Use the Errors filter to continue reviewing.
                </div>
              ) : null}
            </div>
          ) : null}

          {conflicts.length ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                  <label className="sr-only" htmlFor="product-import-conflict-search">Search conflicts</label>
                  <input
                    id="product-import-conflict-search"
                    className="input text-xs"
                    value={conflictQuery}
                    onChange={(event) => setConflictQuery(event.target.value)}
                    placeholder="Search conflict rows by name, barcode, SKU, brand, category..."
                    autoComplete="off"
                  />
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {CONFLICT_FILTER_OPTIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold ${conflictFilter === item.value ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                        title={item.hint}
                        aria-label={`${item.label}: ${item.hint}`}
                        onClick={() => setConflictFilter(item.value)}
                      >
                        <span>{item.label} ({conflictGroups[item.countKey] || 0})</span>
                        <Info className="h-3 w-3 opacity-70" aria-hidden="true" />
                      </button>
                    ))}
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
                      checked={selectedConflictCount > 0 && selectedConflictCount === visibleConflicts.length}
                      onChange={(event) => toggleSelectAllConflicts(event.target.checked)}
                    />
                    Visible matches
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">Action</span>
                    <select className="input h-8 min-w-[9rem] py-1 text-xs" defaultValue="" onChange={(event) => { if (event.target.value) applyDecisionToSelection(event.target.value); event.target.value = '' }}>
                      <option value="">Apply to selected...</option>
                      {IMPORT_DECISION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">SKU/barcode</span>
                    <select className="input h-8 min-w-[9rem] py-1 text-xs" defaultValue="" onChange={(event) => { if (event.target.value) applyIdentifierDecisionToSelection(event.target.value); event.target.value = '' }}>
                      <option value="">Apply...</option>
                      {IDENTIFIER_DECISION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">Images</span>
                    <select className="input h-8 min-w-[9rem] py-1 text-xs" defaultValue="" onChange={(event) => { if (event.target.value) applyImageDecisionToSelection(event.target.value); event.target.value = '' }}>
                      <option value="">Apply...</option>
                      {IMAGE_CONFLICT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="ml-auto inline-flex min-w-[13rem] items-center gap-2">
                    <span className="whitespace-nowrap text-gray-500 dark:text-gray-400">Details</span>
                    <select
                      className="input h-8 min-w-[11rem] py-1 text-xs"
                      value={fieldRules.__preset || 'merge_blank_only'}
                      title={FIELD_RULE_PRESET_HINTS[fieldRules.__preset || 'merge_blank_only']}
                      onChange={(event) => {
                        const value = event.target.value
                        applyFieldRulePreset(value)
                      }}
                    >
                      <option value="merge_blank_only">Fill blanks only</option>
                      <option value="keep_existing">Keep existing</option>
                      <option value="use_imported">Use imported</option>
                    </select>
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
                    Showing first {visibleConflicts.length} of {conflicts.length} review rows. Search or use filters to narrow the rows before applying bulk actions.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{T('images_optional', 'Images folder (optional)')}</p>
            <div className="flex gap-2">
              <div className="input flex-1 truncate text-xs text-gray-500">{imageDir || T('no_folder', 'No folder')}</div>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageDirectory}>{T('browse', 'Browse')}</button>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageZip}>{T('zip_images', 'ZIP')}</button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setFilePickerOpen(true)}>{T('files', 'Files')}</button>
            </div>
          </div>

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

          <div className="flex gap-3 pt-1">
            <button type="button" className="btn-secondary" onClick={resetCsvState}>{T('back', 'Back')}</button>
            <button type="button" className="btn-primary flex-1" onClick={handleImport} disabled={loading || !allDecided}>
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
            {result.images_matched > 0 ? <p className="text-sm">{T('n_images_matched', '{n} images matched').replace('{n}', String(result.images_matched))}</p> : null}
            {!result.queued && result.imported === 0 && result.updated === 0 && (result.images_matched || 0) === 0 ? <p className="text-sm">No changes applied.</p> : null}
          </div>
          {Array.isArray(result.errors) && result.errors.length ? (
            <div>
              <p className="mb-1 text-sm font-medium text-red-600">{T('errors_count', 'Errors ({n})').replace('{n}', String(result.errors.length))}</p>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20">
                {result.errors.map((message, index) => <div key={index}>{message}</div>)}
              </div>
              {result.job?.id ? (
                <button type="button" className="btn-secondary mt-2 text-sm" onClick={() => window.api.downloadImportJobErrors?.(result.job.id)}>
                  {T('download_failed_rows', 'Download failed rows')}
                </button>
              ) : null}
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
