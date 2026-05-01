import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

function countCsvDataRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim())
  return Math.max(0, lines.length - 1)
}

export default function InventoryImportModal({ onClose, onDone }) {
  const { notify, t } = useApp()
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

  const previewRowCount = useMemo(() => countCsvDataRows(csvText), [csvText])

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
    const rowCount = countCsvDataRows(csvText)
    if (!rowCount) {
      notify(tr('inventory_import_choose_rows', 'Choose a CSV file with at least one inventory row.', 'សូមជ្រើសឯកសារ CSV ដែលមានយ៉ាងហោចណាស់មួយជួរស្តុក។'), 'error')
      return
    }

    const requestId = beginTrackedRequest(importRequestRef)
    importInFlightRef.current = true
    setLoading(true)
    try {
      const created = await withLoaderTimeout(
        () => window.api.createImportJob({ type: 'inventory', policy: { source: 'inventory_modal' } }),
        'Inventory import job',
      )
      if (!isTrackedRequestCurrent(importRequestRef, requestId)) return
      const job = created?.job || created
      if (!job?.id) throw new Error('Import job was not created')
      await window.api.uploadImportJobCsv({ jobId: job.id, text: csvText, fileName: fileName || 'inventory.csv' })
      await window.api.startImportJob(job.id)
      const queuedResult = { imported: 0, queued: rowCount, jobId: job.id, errors: [] }
      if (!isTrackedRequestCurrent(importRequestRef, requestId) || !aliveRef.current) return
      setResult(queuedResult)
      notify(tr('inventory_import_started', 'Inventory import started: {count} row(s) queued. You can keep using the app.').replace('{count}', rowCount), 'success')
      onDone?.()
      return
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
          {tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', previewRowCount)}
        </div>
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              {result.queued
                ? tr('import_job_queued_count', '{count} row(s) queued. Progress is shown at the top of the app.').replace('{count}', result.queued)
                : tr('imported_rows_count', 'Imported {count} row(s)', 'បាននាំចូល {count} ជួរ').replace('{count}', result.imported)}
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
