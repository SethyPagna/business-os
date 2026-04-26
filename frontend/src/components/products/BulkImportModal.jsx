import { useMemo, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import FilePickerModal from '../files/FilePickerModal'

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

function parseCSVContent(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, '').toLowerCase())
  return lines.slice(1).map((line) => {
    const values = line.match(/(\".*?\"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || line.split(',')
    const row = {}
    headers.forEach((header, index) => {
      row[header] = String(values[index] || '').trim().replace(/^\"|\"$/g, '')
    })
    return row
  }).filter((row) => row.name?.trim())
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
  const gallery = Array.isArray(product.image_gallery) ? product.image_gallery : []
  const fallback = product.image_path ? [product.image_path] : []
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

export default function BulkImportModal({ onClose, onDone, t }) {
  const [mode, setMode] = useState('products')
  const [step, setStep] = useState(1)
  const [csvData, setCsvData] = useState(null)
  const [imageDir, setImageDir] = useState(null)
  const [imageFiles, setImageFiles] = useState({})
  const [conflicts, setConflicts] = useState([])
  const [cleanRows, setCleanRows] = useState([])
  const [decisions, setDecisions] = useState({})
  const [imageDecisions, setImageDecisions] = useState({})
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const { user } = useApp()

  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)

  const resetCsvState = () => {
    setCsvData(null)
    setConflicts([])
    setCleanRows([])
    setDecisions({})
    setImageDecisions({})
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
      await Promise.all(files.map((file) => new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          map[file.name] = e.target.result
          resolve()
        }
        reader.readAsDataURL(file)
      })))
      setImageFiles(map)
      const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Folder'
      setImageDir(`${folderName} (${files.length})`)
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

  const handleImageOnlyImport = async () => {
    if (!Object.keys(imageFiles).length) return
    setLoading(true)
    try {
      const response = await window.api.bulkImportProducts({
        products: [],
        imageFiles,
        imageOnly: true,
        userId: user.id,
        userName: user.name,
      })
      setResult(response)
      setStep(3)
      if ((response?.images_matched || 0) > 0 || (response?.updated || 0) > 0 || (response?.imported || 0) > 0) onDone()
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [error?.message || 'Import failed'] })
      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  const handlePickCSV = async () => {
    const picked = await window.api.openCSVDialog()
    if (!picked) return
    setCsvData(picked)
    setLoading(true)
    try {
      const rows = parseCSVContent(picked.content)
      const existingProducts = await window.api.getProducts()
      const existingMap = {}
      existingProducts.forEach((product) => {
        const byName = String(product?.name || '').trim().toLowerCase()
        if (byName) existingMap[byName] = product
        if (product?.sku) existingMap[`sku:${String(product.sku).trim().toLowerCase()}`] = product
      })

      const nextConflicts = []
      const nextCleanRows = []
      const nextDecisions = {}
      const nextImageDecisions = {}

      rows.forEach((row, index) => {
        const key = String(row?.name || '').trim().toLowerCase()
        const bySku = row?.sku ? existingMap[`sku:${String(row.sku).trim().toLowerCase()}`] : null
        const existing = existingMap[key] || bySku
        const incomingImages = getIncomingImageFilenames(row)
        if (!existing) {
          nextCleanRows.push({ row, index, incomingImages })
          nextDecisions[index] = 'new'
          nextImageDecisions[index] = incomingImages.length ? 'replace_with_csv' : 'keep_existing'
          return
        }

        const sameBasic = (
          (!row.sku || String(row.sku).trim() === String(existing.sku || '')) &&
          (!row.barcode || String(row.barcode).trim() === String(existing.barcode || '')) &&
          (!row.category || String(row.category).trim() === String(existing.category || '')) &&
          (!row.unit || String(row.unit).trim() === String(existing.unit || '')) &&
          (!row.supplier || String(row.supplier).trim() === String(existing.supplier || ''))
        )
        const sellingOk = !row.selling_price_usd || Math.abs(parseFloat(row.selling_price_usd || 0) - (existing.selling_price_usd || 0)) < 0.001
        const purchaseOk = !row.purchase_price_usd || Math.abs(parseFloat(row.purchase_price_usd || 0) - (existing.purchase_price_usd || 0)) < 0.001
        const existingImages = getExistingImageFilenames(existing)
        const sameImages = !incomingImages.length || (
          incomingImages.length === existingImages.length &&
          incomingImages.every((value, i) => value.toLowerCase() === String(existingImages[i] || '').toLowerCase())
        )

        nextConflicts.push({
          row,
          index,
          existing,
          sameBasic,
          samePricing: sellingOk && purchaseOk,
          sameImages,
          incomingImages,
          existingImages,
        })
        nextDecisions[index] = (sameBasic && sellingOk && purchaseOk) ? 'merge' : 'ask'
        nextImageDecisions[index] = incomingImages.length ? (sameBasic && sellingOk && purchaseOk ? 'keep_existing' : 'replace_with_csv') : 'keep_existing'
      })

      setConflicts(nextConflicts)
      setCleanRows(nextCleanRows)
      setDecisions(nextDecisions)
      setImageDecisions(nextImageDecisions)
      setStep(2)
    } catch (error) {
      alert(`Failed to analyze CSV: ${error?.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!csvData?.content) return
    setLoading(true)
    try {
      const rows = parseCSVContent(csvData.content)
      const instructions = rows.map((row, index) => ({
        ...row,
        _action: decisions[index] || 'new',
        _image_action: imageDecisions[index] || (getIncomingImageFilenames(row).length ? 'replace_with_csv' : 'keep_existing'),
      }))
      const response = await window.api.bulkImportProducts({
        products: instructions,
        imageFiles,
        userId: user.id,
        userName: user.name,
      })
      setResult(response)
      setStep(3)
      if ((response?.imported || 0) > 0 || (response?.updated || 0) > 0) onDone()
    } catch (error) {
      setResult({ imported: 0, updated: 0, errors: [error?.message || 'Import failed'] })
      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  const pendingAsk = useMemo(() => conflicts.filter((item) => decisions[item.index] === 'ask'), [conflicts, decisions])
  const allDecided = pendingAsk.length === 0
  const totalCount = cleanRows.length + conflicts.length

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

      {step === 1 && mode === 'products' ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            <p className="mb-1 font-semibold">{T('csv_columns_header', 'Columns')}</p>
            <p className="font-mono text-xs leading-relaxed">
              {T('csv_template_columns', 'name*, sku, barcode, category, brand, unit, description, selling_price_usd, selling_price_khr, purchase_price_usd, purchase_price_khr, stock_quantity, low_stock_threshold, supplier, branch, image_filename_1..5, image_filenames, image_conflict_mode')}
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
              <button type="button" className="btn-secondary text-sm" onClick={() => setFilePickerOpen(true)}>
                {T('files', 'Files')}
              </button>
            </div>
          </div>
          <button type="button" className="btn-primary w-full" onClick={handleImageOnlyImport} disabled={loading || !Object.keys(imageFiles).length}>
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
              <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{pendingAsk.length}</div>
              <div className="text-blue-600 dark:text-blue-500">{T('need_decision_count', 'Need decision')}</div>
            </div>
          </div>

          {conflicts.length ? (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{T('existing_matches_label', 'Existing product matches')}</p>
              {conflicts.map(({ row, index, existing, sameBasic, samePricing, sameImages, incomingImages, existingImages }) => (
                <div key={index} className={`space-y-2 rounded-xl border p-3 text-sm ${decisions[index] === 'ask' ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{row.name}</span>
                    <div className="flex flex-wrap gap-1 text-xs">
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
                    <button type="button" onClick={() => setDecisions((state) => ({ ...state, [index]: 'merge' }))} className={`rounded-lg border px-2.5 py-1.5 font-medium ${decisions[index] === 'merge' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>Add stock only</button>
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
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{T('images_optional', 'Images folder (optional)')}</p>
            <div className="flex gap-2">
              <div className="input flex-1 truncate text-xs text-gray-500">{imageDir || T('no_folder', 'No folder')}</div>
              <button type="button" className="btn-secondary text-sm" onClick={pickImageDirectory}>{T('browse', 'Browse')}</button>
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
          <div className={`rounded-xl p-4 ${(result.imported || 0) + (result.updated || 0) > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            {result.imported > 0 ? <p className="text-sm">{T('n_products_created', '{n} new products created').replace('{n}', String(result.imported))}</p> : null}
            {result.updated > 0 ? <p className="text-sm">{T('n_products_updated', '{n} products updated').replace('{n}', String(result.updated))}</p> : null}
            {result.images_matched > 0 ? <p className="text-sm">{T('n_images_matched', '{n} images matched').replace('{n}', String(result.images_matched))}</p> : null}
            {result.imported === 0 && result.updated === 0 && (result.images_matched || 0) === 0 ? <p className="text-sm">No changes applied.</p> : null}
          </div>
          {Array.isArray(result.errors) && result.errors.length ? (
            <div>
              <p className="mb-1 text-sm font-medium text-red-600">{T('errors_count', 'Errors ({n})').replace('{n}', String(result.errors.length))}</p>
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20">
                {result.errors.map((message, index) => <div key={index}>{message}</div>)}
              </div>
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
