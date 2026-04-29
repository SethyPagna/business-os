import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import { normalizeCsvKey, parseCsvNumber, parseCsvRows } from '../../utils/csvImport'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

function normalizeAction(value) {
  const raw = normalizeCsvKey(value)
  if (['add', 'remove', 'set'].includes(raw)) return raw
  if (raw === 'adjustment') return 'add'
  return 'add'
}

export default function InventoryImportModal({ onClose, onDone }) {
  const { user, notify, t } = useApp()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const importRequestRef = useRef(0)
  const importInFlightRef = useRef(false)
  const aliveRef = useRef(true)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const previewRows = useMemo(() => parseCsvRows(csvText), [csvText])

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(importRequestRef)
  }, [])

  const handlePickFile = async () => {
    const picked = await window.api.openCSVDialog?.()
    if (!picked?.content) return
    setCsvText(String(picked.content || ''))
    setFileName(String(picked.name || 'inventory.csv'))
    setResult(null)
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate('inventory')
  }

  const handleImport = async () => {
    if (importInFlightRef.current) return
    const rows = parseCsvRows(csvText)
    if (!rows.length) {
      notify(tr('inventory_import_choose_rows', 'Choose a CSV file with at least one inventory row.', 'សូមជ្រើសឯកសារ CSV ដែលមានយ៉ាងហោចណាស់មួយជួរស្តុក។'), 'error')
      return
    }

    const requestId = beginTrackedRequest(importRequestRef)
    importInFlightRef.current = true
    setLoading(true)
    try {
      const [products, branches] = await withLoaderTimeout(
        () => Promise.all([
          window.api.getProducts(),
          window.api.getBranches(),
        ]),
        'Inventory import setup',
      )
      if (!isTrackedRequestCurrent(importRequestRef, requestId)) return

      const bySku = new Map()
      const byBarcode = new Map()
      const byName = new Map()
      ;(Array.isArray(products) ? products : []).forEach((product) => {
        const sku = normalizeCsvKey(product?.sku)
        const barcode = normalizeCsvKey(product?.barcode)
        const name = normalizeCsvKey(product?.name)
        if (sku) bySku.set(sku, product)
        if (barcode) byBarcode.set(barcode, product)
        if (name) byName.set(name, product)
      })

      const activeBranches = (Array.isArray(branches) ? branches : []).filter((branch) => branch?.is_active)
      const defaultBranch = activeBranches.find((branch) => branch?.is_default) || activeBranches[0] || null
      const branchMap = new Map()
      activeBranches.forEach((branch) => {
        branchMap.set(normalizeCsvKey(branch?.name), branch)
        branchMap.set(normalizeCsvKey(branch?.id), branch)
      })

      let imported = 0
      const errors = []

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const product = bySku.get(normalizeCsvKey(row.sku))
          || byBarcode.get(normalizeCsvKey(row.barcode))
          || byName.get(normalizeCsvKey(row.name))
        if (!product) {
          errors.push(tr('inventory_import_row_product_not_found', 'Row {row}: product not found', 'ជួរ {row}: រកមិនឃើញផលិតផល').replace('{row}', index + 2))
          continue
        }

        const quantity = parseCsvNumber(row.quantity, 0)
        if (quantity <= 0) {
          errors.push(tr('inventory_import_row_quantity_invalid', 'Row {row}: quantity must be greater than 0', 'ជួរ {row}: បរិមាណត្រូវតែធំជាង 0').replace('{row}', index + 2))
          continue
        }

        const branchValue = String(row.branch || '').trim()
        const branch = branchValue ? branchMap.get(normalizeCsvKey(branchValue)) : defaultBranch
        if (branchValue && !branch) {
          errors.push(
            tr('inventory_import_row_branch_not_found', 'Row {row}: branch "{branch}" not found', 'ជួរ {row}: មិនឃើញសាខា "{branch}"')
              .replace('{row}', index + 2)
              .replace('{branch}', branchValue),
          )
          continue
        }

        try {
          await window.api.adjustStock({
            productId: product.id,
            productName: product.name,
            type: normalizeAction(row.action || row.type || row.movement_type),
            quantity,
            unitCostUsd: parseCsvNumber(row.unit_cost_usd, 0),
            unitCostKhr: parseCsvNumber(row.unit_cost_khr, 0),
            reason: String(row.reason || '').trim() || tr('inventory_import_reason', 'Inventory import', 'នាំចូលស្តុក'),
            branchId: branch?.id || null,
            userId: user?.id || null,
            userName: user?.name || '',
            created_at: String(row.date || row.created_at || row.movement_date || '').trim() || null,
          })
          imported += 1
        } catch (error) {
          errors.push(
            tr('inventory_import_row_failed', 'Row {row}: {message}', 'ជួរ {row}: {message}')
              .replace('{row}', index + 2)
              .replace('{message}', error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ')),
          )
        }
      }

      const nextResult = { imported, errors }
      if (!isTrackedRequestCurrent(importRequestRef, requestId) || !aliveRef.current) return
      setResult(nextResult)
      if (imported > 0) {
        notify(tr('inventory_import_finished', 'Inventory import finished: {count} row(s) applied.', 'ការនាំចូលស្តុកបានបញ្ចប់៖ បានអនុវត្ត {count} ជួរ។').replace('{count}', imported), 'success')
        onDone?.()
      } else {
        notify(tr('inventory_import_none', 'No inventory rows were imported.', 'មិនមានជួរស្តុកណាមួយត្រូវបាននាំចូលទេ។'), 'warning')
      }
    } catch (error) {
      const nextResult = { imported: 0, errors: [error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ')] }
      if (isTrackedRequestCurrent(importRequestRef, requestId) && aliveRef.current) {
        setResult(nextResult)
        notify(error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ'), 'error')
      }
    } finally {
      importInFlightRef.current = false
      if (isTrackedRequestCurrent(importRequestRef, requestId) && aliveRef.current) {
        setLoading(false)
      }
    }
  }

  return (
    <Modal title={tr('inventory_import_title', 'Import Inventory', 'នាំចូលស្តុក')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('inventory_import_help', 'Import stock adjustments from CSV rows. Supported actions are add, remove, and set.', 'នាំចូលការកែស្តុកពីជួរ CSV។ សកម្មភាពដែលគាំទ្រមាន add, remove និង set។')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={handleDownloadTemplate}>
            {t('download_template') || 'Download Template'}
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={handlePickFile}>
            {tr('choose_csv_file', 'Choose CSV', 'ជ្រើស CSV')}
          </button>
        </div>
        {fileName ? (
          <div className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
            {fileName}
          </div>
        ) : null}
        <label htmlFor="inventory-import-csv" className="sr-only">
          {tr('inventory_import_title', 'Import Inventory', 'នាំចូលស្តុក')}
        </label>
        <textarea
          id="inventory-import-csv"
          name="inventory_import_csv"
          className="input min-h-[180px] font-mono text-xs"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={tr('csv_paste_placeholder', 'Paste CSV here if you do not want to pick a file.', 'បិទភ្ជាប់ CSV នៅទីនេះ ប្រសិនបើអ្នកមិនចង់ជ្រើសឯកសារ។')}
        />
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', previewRows.length)}
        </div>
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              {tr('imported_rows_count', 'Imported {count} row(s)', 'បាននាំចូល {count} ជួរ').replace('{count}', result.imported)}
            </div>
            {result.errors?.length ? (
              <div className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400">
                {result.errors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={loading}>{t('close') || 'Close'}</button>
          <button type="button" className="btn-primary flex-1" disabled={loading || !String(csvText || '').trim()} onClick={handleImport}>
            {loading ? tr('importing', 'Importing...', 'កំពុងនាំចូល...') : tr('import_inventory_button', 'Import inventory', 'នាំចូលស្តុក')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
