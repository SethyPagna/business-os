import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { countCsvDataRows } from '../../utils/csvRowCounter.ts'
import { parseImportFile } from '../../utils/spreadsheetImport.ts'
import CsvImportPreview from '../shared/CsvImportPreview.tsx'

const SALES_TEMPLATE_COLUMNS = 'receipt_number, sale_date, sale_status, payment_method, payment_currency, exchange_rate, branch, customer_name, customer_phone, customer_address, cashier_name, name, sku, barcode, quantity, unit_price_usd, unit_price_khr, batch_label, returned_quantity, discount_usd, discount_khr, tax_usd, amount_paid_usd, amount_paid_khr, membership_discount_usd, membership_discount_khr, membership_points_redeemed, is_delivery, delivery_contact_name, delivery_contact_phone, delivery_contact_address, delivery_fee_usd, delivery_fee_khr, delivery_fee_paid_by, notes'

const SALES_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000
const SALES_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 30000
const SALES_IMPORT_JOB_START_TIMEOUT_MS = 12000
const SALES_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

interface AppContextValue {
  notify: NotifyFn
  t: TranslateFn
}

interface ImportModalProps {
  onClose: () => void
  onDone?: (payload: ImportResult) => void | Promise<void>
}

interface CsvDialogResult {
  content?: string | null
  name?: string | null
}

interface ImportJob {
  id?: string | number | null
}

interface ImportJobResponse extends ImportJob {
  job?: ImportJob | null
}

interface ImportResult {
  imported: number
  duplicates: number
  queued?: number
  jobId?: string | number | null
  errors: string[]
}

interface ImportApi {
  openCSVDialog?: () => Promise<CsvDialogResult | null | undefined>
  downloadImportTemplate: (type: 'sales') => void
  createImportJob: (payload: { type: 'sales'; policy: { source: string } }) => Promise<ImportJobResponse>
  uploadImportJobCsv: (payload: { jobId: string | number; text: string; fileName: string }) => Promise<unknown>
  startImportJob: (jobId: string | number) => Promise<unknown>
}

interface RowCountWorkerMessage {
  id?: string
  type?: 'result' | 'error'
  rowCount?: number | string
  error?: string
}

const useApp = useAppHook as () => AppContextValue

function getImportApi(): ImportApi {
  if (!window.api) throw new Error('Sales import API is not available.')
  return window.api as ImportApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function countSalesCsvRowsInWorker(text: string): Promise<number> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(countCsvDataRows(text))
  }

  return new Promise<number>((resolve, reject) => {
    const id = `sales-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const worker = new Worker(new URL('./salesImportWorker.ts', import.meta.url), { type: 'module' })
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Sales import row count timed out'))
    }, SALES_IMPORT_ROW_COUNT_TIMEOUT_MS)
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      worker.terminate()
    }

    worker.onmessage = (event: MessageEvent<RowCountWorkerMessage>) => {
      const message = event.data || {}
      if (message.id !== id) return
      cleanup()
      if (message.type === 'result') resolve(Number(message.rowCount || 0))
      else reject(new Error(message.error || 'Sales import row count failed'))
    }
    worker.onerror = (error: ErrorEvent) => {
      cleanup()
      reject(new Error(error?.message || 'Sales import worker failed'))
    }
    worker.postMessage({ id, text })
  })
}

export default function SalesImportModal({ onClose, onDone }: ImportModalProps) {
  const { notify, t } = useApp()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [previewRowCount, setPreviewRowCount] = useState(0)
  const [analyzingCsv, setAnalyzingCsv] = useState(false)
  const importRequestRef = useRef(0)
  const importInFlightRef = useRef(false)
  const rowCountRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }
  const signalDone = async (payload: ImportResult): Promise<void> => {
    if (typeof onDone === 'function') {
      await Promise.resolve(onDone(payload))
    }
  }

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(importRequestRef)
  }, [])

  const analyzeCsvText = async (text: string): Promise<void> => {
    const nextText = String(text || '')
    const requestId = rowCountRequestRef.current + 1
    rowCountRequestRef.current = requestId
    setAnalyzingCsv(true)
    let nextCount = 0
    try {
      nextCount = await countSalesCsvRowsInWorker(nextText)
    } catch (_) {
      nextCount = countCsvDataRows(nextText)
    }
    if (!aliveRef.current || rowCountRequestRef.current !== requestId) return
    setPreviewRowCount(nextCount)
    setAnalyzingCsv(false)
  }

  const setSalesCsvText = (text: string, name = fileName): void => {
    const nextText = String(text || '')
    setCsvText(nextText)
    setFileName(String(name || 'sales.csv'))
    setResult(null)
    void analyzeCsvText(nextText)
  }

  const handlePickFile = async () => {
    const picked = await getImportApi().openCSVDialog?.()
    if (!picked?.content) return
    setSalesCsvText(picked.content, picked.name || 'sales.csv')
  }

  const handleDropFile = async (file: File) => {
    try {
      const parsed = await parseImportFile(file)
      if (!parsed?.content) return
      setSalesCsvText(parsed.content, parsed.name || file.name || 'sales.csv')
    } catch (error) {
      notify(getErrorMessage(error, tr('sales_import_drop_failed', 'Could not read that file.', 'មិនអាចអានឯកសារនោះបានទេ។')), 'error')
    }
  }

  const handleDownloadTemplate = () => {
    getImportApi().downloadImportTemplate('sales')
  }

  const handleImport = async () => {
    if (!beginSingleAction(importInFlightRef)) return
    const rowCount = previewRowCount || countCsvDataRows(csvText)
    if (analyzingCsv) {
      finishSingleAction(importInFlightRef)
      notify(tr('sales_import_wait_row_check', 'Wait for the CSV row check to finish.'), 'error')
      return
    }
    if (!rowCount) {
      finishSingleAction(importInFlightRef)
      notify(tr('sales_import_choose_rows', 'Choose a CSV file with at least one sale row.', 'សូមជ្រើសឯកសារ CSV ដែលមានយ៉ាងហោចណាស់មួយជួរលក់។'), 'error')
      return
    }

    const requestId = beginTrackedRequest(importRequestRef)
    setLoading(true)
    try {
      const created = await withLoaderTimeout(
        () => getImportApi().createImportJob({ type: 'sales', policy: { source: 'sales_modal' } }),
        'Sales import job',
        SALES_IMPORT_JOB_CREATE_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(importRequestRef, requestId)) return
      const job = created?.job || created
      if (!job?.id) throw new Error('Import job was not created')
      await withLoaderTimeout(
        () => getImportApi().uploadImportJobCsv({ jobId: job.id as string | number, text: csvText, fileName: fileName || 'sales.csv' }),
        'Sales import CSV upload',
        SALES_IMPORT_JOB_UPLOAD_TIMEOUT_MS,
      )
      await withLoaderTimeout(
        () => getImportApi().startImportJob(job.id as string | number),
        'Sales import start',
        SALES_IMPORT_JOB_START_TIMEOUT_MS,
      )
      const queuedResult = { imported: 0, duplicates: 0, queued: rowCount, jobId: job.id, errors: [] }
      if (!isTrackedRequestCurrent(importRequestRef, requestId) || !aliveRef.current) return
      setResult(queuedResult)
      await signalDone(queuedResult)
      notify(tr('sales_import_started', 'Sales import analysis started: {count} row(s) queued. Review and approve it from the top progress bar.').replace('{count}', String(rowCount)), 'success')
      return
    } catch (error) {
      const nextResult = { imported: 0, duplicates: 0, errors: [getErrorMessage(error, tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ'))] }
      if (isTrackedRequestCurrent(importRequestRef, requestId) && aliveRef.current) {
        setResult(nextResult)
        notify(getErrorMessage(error, tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ')), 'error')
      }
    } finally {
      finishSingleAction(importInFlightRef)
      if (isTrackedRequestCurrent(importRequestRef, requestId) && aliveRef.current) {
        setLoading(false)
      }
    }
  }

  return (
    <Modal title={tr('sales_import_title', 'Import Sales', 'នាំចូលការលក់')} onClose={onClose} draggable>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('sales_import_help', 'Import sales from CSV rows grouped by receipt number. Each row should describe one sold product line.', 'នាំចូលការលក់ពីជួរ CSV ដែលដាក់ជាក្រុមតាមលេខបង្កាន់ដៃ។ មួយជួរគួរតែតំណាងឱ្យមួយបន្ទាត់ផលិតផលដែលបានលក់។')}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr(
            'sales_import_stock_help',
            "This just records history and links each line to a product -- it never changes stock on its own. The one exception is sale_status \"returned\" / \"partial_return\": that restocks the returned_quantity (batch_label optional, to restock a specific lot).",
            'នេះគ្រាន់តែកត់ត្រាប្រវត្តិ ហើយភ្ជាប់ជួរនីមួយៗទៅផលិតផល -- វាមិនផ្លាស់ប្តូរស្តុកដោយខ្លួនឯងទេ។ករណីលើកលែងតែមួយគត់គឺ sale_status "returned" / "partial_return"៖ វានឹងបន្ថែម returned_quantity ត្រឡប់ទៅស្តុកវិញ (batch_label ជាជម្រើស សម្រាប់ត្រឡប់ទៅឡូតជាក់លាក់)។',
          )}
        </p>
        <CsvImportPreview
          columnsLabel={t('csv_columns_header') || 'Columns'}
          columnsText={SALES_TEMPLATE_COLUMNS}
          fileName={fileName}
          csvText={csvText}
          rowCount={previewRowCount}
          analyzing={analyzingCsv}
          onDownloadTemplate={handleDownloadTemplate}
          onPickFile={handlePickFile}
          onDropFile={handleDropFile}
          dragLabel={tr('sales_import_drop_file', 'Drop file here to import', 'ទម្លាក់ឯកសារទីនេះដើម្បីនាំចូល')}
          downloadLabel={t('download_template') || 'Download Template'}
          pickLabel={tr('choose_csv_file', 'Choose CSV or Excel', 'ជ្រើស CSV')}
          analyzingLabel={tr('sales_import_checking_rows', 'Checking rows...', 'កំពុងពិនិត្យជួរ...')}
          noFileLabel={tr('sales_import_no_file', 'No CSV or Excel file selected yet.', 'មិនទាន់បានជ្រើសឯកសារ CSV ទេ។')}
          previewHeadingLabel={tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', String(previewRowCount))}
        />
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              {result.queued
                ? tr('import_job_queued_count', '{count} row(s) queued for analysis. Review and approve it from the top progress bar.').replace('{count}', String(result.queued))
                : tr('imported_sales_count', 'Imported {count} sale(s)', 'បាននាំចូលការលក់ {count}').replace('{count}', String(result.imported))}
              {!result.queued && result.duplicates ? `, ${tr('duplicates_skipped_count', 'skipped {count} duplicate(s)', 'បានរំលងស្ទួន {count}').replace('{count}', String(result.duplicates))}` : ''}
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
            {loading ? tr('importing', 'Importing...', 'កំពុងនាំចូល...') : tr('import_sales_button', 'Import sales', 'នាំចូលការលក់')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
