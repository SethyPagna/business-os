import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { isBrokenLocalizedString, useApp } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { countCsvDataRows } from '../../utils/csvRowCounter.ts'

const INVENTORY_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000
const INVENTORY_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 30000
const INVENTORY_IMPORT_JOB_START_TIMEOUT_MS = 12000
const INVENTORY_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000

function countInventoryCsvRowsInWorker(text) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(countCsvDataRows(text))
  }

  return new Promise((resolve, reject) => {
    const id = `inventory-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const worker = new Worker(new URL('./inventoryImportWorker.ts', import.meta.url), { type: 'module' })
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Inventory import row count timed out'))
    }, INVENTORY_IMPORT_ROW_COUNT_TIMEOUT_MS)
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      worker.terminate()
    }

    worker.onmessage = (event) => {
      const message = event.data || {}
      if (message.id !== id) return
      cleanup()
      if (message.type === 'result') resolve(Number(message.rowCount || 0))
      else reject(new Error(message.error || 'Inventory import row count failed'))
    }
    worker.onerror = (error) => {
      cleanup()
      reject(new Error(error?.message || 'Inventory import worker failed'))
    }
    worker.postMessage({ id, text })
  })
}

export default function InventoryImportModal({ onClose, onDone }) {
  const { notify, t } = useApp()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [previewRowCount, setPreviewRowCount] = useState(0)
  const [analyzingCsv, setAnalyzingCsv] = useState(false)
  const importRequestRef = useRef(0)
  const importInFlightRef = useRef(false)
  const rowCountRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    if (isKhmer && fallbackKm && !isBrokenLocalizedString(fallbackKm)) return fallbackKm
    return isBrokenLocalizedString(fallbackEn) ? key : fallbackEn
  }
  const signalDone = async (payload) => {
    if (typeof onDone === 'function') {
      await Promise.resolve(onDone(payload))
    }
  }

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(importRequestRef)
  }, [])

  const analyzeCsvText = async (text) => {
    const nextText = String(text || '')
    const requestId = rowCountRequestRef.current + 1
    rowCountRequestRef.current = requestId
    setAnalyzingCsv(true)
    let nextCount = 0
    try {
      nextCount = await countInventoryCsvRowsInWorker(nextText)
    } catch (_) {
      nextCount = countCsvDataRows(nextText)
    }
    if (!aliveRef.current || rowCountRequestRef.current !== requestId) return
    setPreviewRowCount(nextCount)
    setAnalyzingCsv(false)
  }

  const setInventoryCsvText = (text, name = fileName) => {
    const nextText = String(text || '')
    setCsvText(nextText)
    setFileName(String(name || 'inventory.csv'))
    setResult(null)
    void analyzeCsvText(nextText)
  }

  const handlePickFile = async () => {
    const picked = await window.api.openCSVDialog?.()
    if (!picked?.content) return
    setInventoryCsvText(picked.content, picked.name || 'inventory.csv')
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate('inventory')
  }

  const handleImport = async () => {
    if (!beginSingleAction(importInFlightRef)) return
    const rowCount = previewRowCount || countCsvDataRows(csvText)
    if (analyzingCsv) {
      finishSingleAction(importInFlightRef)
      notify(tr('inventory_import_wait_row_check', 'Wait for the CSV row check to finish.'), 'error')
      return
    }
    if (!rowCount) {
      finishSingleAction(importInFlightRef)
      notify(tr('inventory_import_choose_rows', 'Choose a CSV file with at least one inventory row.', 'សូមជ្រើសឯកសារ CSV ដែលមានយ៉ាងហោចណាស់មួយជួរស្តុក។'), 'error')
      return
    }

    const requestId = beginTrackedRequest(importRequestRef)
    setLoading(true)
    try {
      const created = await withLoaderTimeout(
        () => window.api.createImportJob({ type: 'inventory', policy: { source: 'inventory_modal' } }),
        'Inventory import job',
        INVENTORY_IMPORT_JOB_CREATE_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(importRequestRef, requestId)) return
      const job = created?.job || created
      if (!job?.id) throw new Error('Import job was not created')
      await withLoaderTimeout(
        () => window.api.uploadImportJobCsv({ jobId: job.id, text: csvText, fileName: fileName || 'inventory.csv' }),
        'Inventory import CSV upload',
        INVENTORY_IMPORT_JOB_UPLOAD_TIMEOUT_MS,
      )
      await withLoaderTimeout(
        () => window.api.startImportJob(job.id),
        'Inventory import start',
        INVENTORY_IMPORT_JOB_START_TIMEOUT_MS,
      )
      const queuedResult = { imported: 0, queued: rowCount, jobId: job.id, errors: [] }
      if (!isTrackedRequestCurrent(importRequestRef, requestId) || !aliveRef.current) return
      setResult(queuedResult)
      await signalDone(queuedResult)
      notify(tr('inventory_import_started', 'Inventory import analysis started: {count} row(s) queued. Review and approve it from the top progress bar.').replace('{count}', rowCount), 'success')
      return
    } catch (error) {
      const nextResult = { imported: 0, errors: [error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ')] }
      if (isTrackedRequestCurrent(importRequestRef, requestId) && aliveRef.current) {
        setResult(nextResult)
        notify(error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ'), 'error')
      }
    } finally {
      finishSingleAction(importInFlightRef)
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
          onChange={(event) => setInventoryCsvText(event.target.value, fileName)}
          placeholder={tr('csv_paste_placeholder', 'Paste CSV here if you do not want to pick a file.', 'បិទភ្ជាប់ CSV នៅទីនេះ ប្រសិនបើអ្នកមិនចង់ជ្រើសឯកសារ។')}
        />
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {analyzingCsv
            ? tr('inventory_import_checking_rows', 'Checking rows...')
            : tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', previewRowCount)}
        </div>
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              {result.queued
                ? tr('import_job_queued_count', '{count} row(s) queued for analysis. Review and approve it from the top progress bar.').replace('{count}', result.queued)
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
          <button type="button" className="btn-primary flex-1" disabled={loading || analyzingCsv || !String(csvText || '').trim()} onClick={handleImport}>
            {loading ? tr('importing', 'Importing...', 'កំពុងនាំចូល...') : analyzingCsv ? tr('inventory_import_checking', 'Checking...', 'កំពុងពិនិត្យ...') : tr('import_inventory_button', 'Import inventory', 'នាំចូលស្តុក')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
