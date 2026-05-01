import { useMemo, useState } from 'react'
import Modal from '../shared/Modal'
import FilePickerModal from '../files/FilePickerModal'
import { analyzeProductImportText } from './productImportPlanner.mjs'

const IMAGE_CONFLICT_OPTIONS = [
  { value: 'keep_existing', label: 'Keep existing images' },
  { value: 'replace_with_csv', label: 'Replace with CSV images' },
  { value: 'append_csv', label: 'Append CSV images' },
]

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

function buildImageOnlyCsv(imageFiles = {}) {
  const rows = Object.keys(imageFiles || {})
    .filter(Boolean)
    .map((name) => [name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(), name])
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
  const [analysisSummary, setAnalysisSummary] = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [imageDecisions, setImageDecisions] = useState({})
  const [selectedConflictIds, setSelectedConflictIds] = useState(() => new Set())
  const [fieldRules, setFieldRules] = useState({})
  const [result, setResult] = useState(null)
  const [currentJob, setCurrentJob] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)

  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)

  const resetCsvState = () => {
    setCsvData(null)
    setConflicts([])
    setCleanRows([])
    setImportRows([])
    setAnalysisSummary(null)
    setAnalysisProgress(null)
    setDecisions({})
    setImageDecisions({})
    setSelectedConflictIds(new Set())
    setFieldRules({})
    setZipFile(null)
    setCurrentJob(null)
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
      return {
        ...row,
        _action: action,
        image_conflict_mode: imageDecisions[rowIndex] || row?.image_conflict_mode || (getIncomingImageFilenames(row).length ? 'replace_with_csv' : 'keep_existing'),
        _field_rules: JSON.stringify(fieldRules || {}),
        _target_product_id: row?._target_product_id || '',
        _parent_id: row?._parent_id || '',
      }
    })
    const headers = Array.from(instructions.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key))
      return set
    }, new Set(['name', 'sku', 'barcode', '_action', '_target_product_id', '_parent_id', '_field_rules', 'image_conflict_mode'])))
    return [
      headers.join(','),
      ...instructions.map((row) => headers.map((header) => csvEscape(row?.[header])).join(',')),
    ].join('\n')
  }

  const handleCancelCurrentJob = async () => {
    if (!currentJob?.id) return
    try {
      const payload = await window.api.cancelImportJob(currentJob.id)
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
    setLoading(true)
    setAnalysisProgress({ progress: 0, label: 'Creating import job' })
    try {
      const created = await window.api.createImportJob({
        type: 'products',
        policy: { mode: 'images_only', image_conflict_mode: 'append_csv' },
      })
      const job = created?.job || created
      setCurrentJob(job)
      const jobId = job?.id
      if (!jobId) throw new Error('Import job was not created')

      await window.api.uploadImportJobCsv({
        jobId,
        text: buildImageOnlyCsv(imageFiles),
        fileName: 'image-only-import.csv',
      })
      if (zipFile) {
        setAnalysisProgress({ progress: 10, label: 'Uploading ZIP image pack' })
        await window.api.uploadImportJobZip({ jobId, file: zipFile })
      }
      const browserImages = getBrowserImageEntries(imageFiles)
      if (browserImages.length) {
        await window.api.uploadImportJobImages({
          jobId,
          files: browserImages,
          onProgress: setAnalysisProgress,
        })
      }
      await window.api.startImportJob(jobId)
      setResult({ imported: 0, updated: 0, images_matched: 0, queued: Object.keys(imageFiles).length, jobId, errors: [] })
      setStep(3)
      onDone?.()
      return
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [error?.message || 'Import failed'] })
      setStep(3)
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
      const existingProducts = await window.api.getProducts()
      const analysis = await analyzeProductCsvInWorker({
        text: picked.content,
        existingProducts: Array.isArray(existingProducts) ? existingProducts : [],
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
      ;[...(analysis.cleanRows || []), ...nextConflicts].forEach((entry) => {
        const index = Number(entry.index ?? entry.row?._import_row_index ?? 0)
        const incomingImages = getIncomingImageFilenames(entry.row)
        nextImageDecisions[index] = incomingImages.length ? (entry.plannedAction === 'merge_stock' ? 'keep_existing' : 'replace_with_csv') : 'keep_existing'
      })

      setConflicts(nextConflicts)
      setCleanRows(analysis.cleanRows || [])
      setImportRows(analysis.rows || [])
      setAnalysisSummary(analysis.summary || null)
      setDecisions(analysis.decisions || {})
      setImageDecisions(nextImageDecisions)
      setSelectedConflictIds(new Set(nextConflicts.map((entry) => entry.index)))
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
    setLoading(true)
    setAnalysisProgress({ progress: 0, label: 'Creating import job' })
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
      const jobId = job?.id
      if (!jobId) throw new Error('Import job was not created')

      await window.api.uploadImportJobCsv({
        jobId,
        text: buildCsvForImportJob(),
        fileName: csvData?.name || 'products-import.csv',
      })
      if (zipFile) {
        setAnalysisProgress({ progress: 10, label: 'Uploading ZIP image pack' })
        await window.api.uploadImportJobZip({ jobId, file: zipFile })
      }
      const browserImages = getBrowserImageEntries(imageFiles)
      if (browserImages.length) {
        await window.api.uploadImportJobImages({
          jobId,
          files: browserImages,
          onProgress: setAnalysisProgress,
        })
      }
      await window.api.startImportJob(jobId)
      setResult({ imported: 0, updated: 0, queued: totalCount, jobId, errors: [] })
      setStep(3)
      onDone?.()
      return
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [error?.message || 'Import failed'] })
      setStep(3)
    } finally {
      setLoading(false)
      setAnalysisProgress(null)
    }
  }

  const pendingAsk = useMemo(() => conflicts.filter((item) => decisions[item.index] === 'ask'), [conflicts, decisions])
  const allDecided = pendingAsk.length === 0
  const totalCount = importRows.length || cleanRows.length + conflicts.length
  const selectedConflictCount = selectedConflictIds.size
  const visibleConflicts = useMemo(() => conflicts.slice(0, 200), [conflicts])

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
    setSelectedConflictIds(new Set(conflicts.map((entry) => entry.index)))
  }

  const applyDecisionToSelection = (value) => {
    setDecisions((current) => {
      const next = { ...current }
      conflicts.forEach((entry) => {
        if (selectedConflictIds.has(entry.index)) next[entry.index] = value
      })
      return next
    })
  }

  const applyImageDecisionToSelection = (value) => {
    setImageDecisions((current) => {
      const next = { ...current }
      conflicts.forEach((entry) => {
        if (selectedConflictIds.has(entry.index) && entry.incomingImages.length) next[entry.index] = value
      })
      return next
    })
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

          {conflicts.length ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedConflictCount > 0 && selectedConflictCount === conflicts.length}
                      onChange={(event) => toggleSelectAllConflicts(event.target.checked)}
                    />
                    All matches
                  </label>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyDecisionToSelection('merge_stock')}>Add stock only</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyDecisionToSelection('create_variant')}>Create variants</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyDecisionToSelection('override_add')}>Override + add stock</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyDecisionToSelection('override_replace')}>Override + replace stock</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => applyDecisionToSelection('new')}>Create selected as new</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {IMAGE_CONFLICT_OPTIONS.map((item) => (
                    <button key={item.value} type="button" className="btn-secondary text-xs" onClick={() => applyImageDecisionToSelection(item.value)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {[
                    ['category', 'Category'],
                    ['brand', 'Brand'],
                    ['unit', 'Unit'],
                    ['supplier', 'Supplier'],
                    ['description', 'Description'],
                    ['selling_price_usd', 'Sell USD'],
                    ['selling_price_khr', 'Sell KHR'],
                    ['special_price_usd', 'Special USD'],
                    ['special_price_khr', 'Special KHR'],
                    ['discount_enabled', 'Discount enabled'],
                    ['discount_type', 'Discount type'],
                    ['discount_percent', 'Discount %'],
                    ['discount_amount_usd', 'Discount USD'],
                    ['discount_amount_khr', 'Discount KHR'],
                    ['discount_label', 'Discount label'],
                    ['discount_badge_color', 'Badge color'],
                    ['discount_starts_at', 'Discount start'],
                    ['discount_ends_at', 'Discount end'],
                    ['purchase_price_usd', 'Buy USD'],
                    ['purchase_price_khr', 'Buy KHR'],
                    ['low_stock_threshold', 'Threshold'],
                    ['parent_id', 'Parent ID'],
                    ['is_group', 'Is Group'],
                  ].map(([field, label]) => (
                    <div key={field}>
                      <label htmlFor={`products-field-rule-${field}`} className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</label>
                      <select
                        id={`products-field-rule-${field}`}
                        className="input text-xs"
                        value={fieldRules[field] || 'merge_blank_only'}
                        onChange={(event) => setFieldRules((current) => ({ ...current, [field]: event.target.value }))}
                      >
                        <option value="merge_blank_only">Fill blanks only</option>
                        <option value="use_imported">Use imported value</option>
                        <option value="keep_existing">Keep existing value</option>
                        <option value="append_unique">Append unique values</option>
                        <option value="clear_value">Clear value</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{T('existing_matches_label', 'Existing product matches')}</p>
                {visibleConflicts.map(({ row, index, existing, plannedAction, sameBasic, samePricing, sameImages, incomingImages, existingImages }) => (
                <div key={index} className={`space-y-2 rounded-xl border p-3 text-sm ${decisions[index] === 'ask' ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedConflictIds.has(index)} onChange={() => toggleConflictSelection(index)} aria-label={`Select conflict row ${index + 1}`} />
                      <span className="font-medium text-gray-900 dark:text-white">{row.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-200">Plan: {(decisions[index] || plannedAction || '').replaceAll('_', ' ')}</span>
                      <span className={`rounded px-1.5 py-0.5 ${sameBasic ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>Basic: {sameBasic ? 'Same' : 'Different'}</span>
                      <span className={`rounded px-1.5 py-0.5 ${samePricing ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>Pricing: {samePricing ? 'Same' : 'Different'}</span>
                      <span className={`rounded px-1.5 py-0.5 ${sameImages ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>Images: {sameImages ? 'Same' : 'Different'}</span>
                    </div>
                  </div>

                  {incomingImages.length ? (
                    <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                      <div>CSV images: {incomingImages.join(', ')}</div>
                      <div>Current images: {existingImages.length ? existingImages.join(', ') : 'none'}</div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <button type="button" onClick={() => setDecisions((state) => ({ ...state, [index]: 'merge_stock' }))} className={`rounded-lg border px-2.5 py-1.5 font-medium ${decisions[index] === 'merge_stock' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>Add stock only</button>
                    <button type="button" onClick={() => setDecisions((state) => ({ ...state, [index]: 'create_variant' }))} className={`rounded-lg border px-2.5 py-1.5 font-medium ${decisions[index] === 'create_variant' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>Create variant</button>
                    <button type="button" onClick={() => setDecisions((state) => ({ ...state, [index]: 'override_add' }))} className={`rounded-lg border px-2.5 py-1.5 font-medium ${decisions[index] === 'override_add' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>Override info + add stock</button>
                    <button type="button" onClick={() => setDecisions((state) => ({ ...state, [index]: 'override_replace' }))} className={`rounded-lg border px-2.5 py-1.5 font-medium ${decisions[index] === 'override_replace' ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>Override all + replace stock</button>
                    <button type="button" onClick={() => setDecisions((state) => ({ ...state, [index]: 'new' }))} className={`rounded-lg border px-2.5 py-1.5 font-medium ${decisions[index] === 'new' ? 'border-purple-600 bg-purple-600 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>Create new row</button>
                  </div>

                  {incomingImages.length ? (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {IMAGE_CONFLICT_OPTIONS.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setImageDecisions((state) => ({ ...state, [index]: item.value }))}
                          className={`rounded-lg border px-2.5 py-1.5 font-medium ${imageDecisions[index] === item.value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No incoming image columns for this row.</p>
                  )}
                </div>
                ))}
                {conflicts.length > visibleConflicts.length ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    Showing first {visibleConflicts.length} of {conflicts.length} planned conflict/variant rows. All rows will still be imported with their selected action.
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
            {result.queued ? <p className="text-sm font-medium">{T('import_job_started_background', '{n} item(s) queued. The import is running in the background.').replace('{n}', String(result.queued))}</p> : null}
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
          <button type="button" className="btn-primary w-full" onClick={onClose}>{T('done', 'Done')}</button>
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
