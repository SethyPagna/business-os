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
import ServerImportReviewScreen from '../imports/ServerImportReviewScreen.tsx'

type InventoryImportAction = 'add' | 'remove' | 'set'

// One template per action instead of one combined template with a
// free-text 'action' column mixed row-to-row -- each action only needs
// (and only shows) the columns it actually uses.
// `date` (optional on all three) backdates the recorded movement to that
// date -- e.g. "this stock actually arrived last Tuesday" -- and falls
// back to today/now when left blank, same as a manual stock action with
// no date typed in.
const INVENTORY_ACTION_COLUMNS: Record<InventoryImportAction, string> = {
  add: 'date, branch, name, sku, barcode, quantity, unit_cost_usd, unit_cost_khr, reason',
  remove: 'date, branch, name, sku, barcode, quantity, reason',
  set: 'date, branch, name, sku, barcode, quantity, reason',
}

const INVENTORY_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000
const INVENTORY_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 30000
const INVENTORY_IMPORT_JOB_START_TIMEOUT_MS = 12000
const INVENTORY_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000

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
  queued?: number
  jobId?: string | number | null
  errors: string[]
}

interface ImportApi {
  openCSVDialog?: () => Promise<CsvDialogResult | null | undefined>
  downloadImportTemplate: (type: 'inventory' | 'inventoryAdd' | 'inventoryRemove' | 'inventorySet') => void
  createImportJob: (payload: { type: 'inventory'; policy: { source: string; inventory_action: InventoryImportAction } }) => Promise<ImportJobResponse>
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

function isBrokenLocalizedString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('\uFFFD')) return true
  if (/[\uE000-\uF8FF]/.test(trimmed)) return true
  const mojibakeMarkers = ['\u00C3', '\u00C2', '\u00E2\u20AC', '\u00E1\u0178', '\u00E1\u017E', '\u00E0\u00B8', '\u00E1\u00BA', '\u00D0', '\u00D1', '\u00D8', '\u00D9']
  if (mojibakeMarkers.some((marker) => trimmed.includes(marker))) return true
  const questionMarks = (trimmed.match(/\?/g) || []).length
  return questionMarks >= Math.max(3, Math.floor(trimmed.length * 0.18))
}

function getImportApi(): ImportApi {
  if (!window.api) throw new Error('Inventory import API is not available.')
  return window.api as ImportApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function countInventoryCsvRowsInWorker(text: string): Promise<number> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(countCsvDataRows(text))
  }

  return new Promise<number>((resolve, reject) => {
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

    worker.onmessage = (event: MessageEvent<RowCountWorkerMessage>) => {
      const message = event.data || {}
      if (message.id !== id) return
      cleanup()
      if (message.type === 'result') resolve(Number(message.rowCount || 0))
      else reject(new Error(message.error || 'Inventory import row count failed'))
    }
    worker.onerror = (error: ErrorEvent) => {
      cleanup()
      reject(new Error(error?.message || 'Inventory import worker failed'))
    }
    worker.postMessage({ id, text })
  })
}

export default function InventoryImportModal({ onClose, onDone }: ImportModalProps) {
  const { notify, t } = useApp()
  const [inventoryAction, setInventoryAction] = useState<InventoryImportAction>('add')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [previewRowCount, setPreviewRowCount] = useState(0)
  const [analyzingCsv, setAnalyzingCsv] = useState(false)
  const [reviewJob, setReviewJob] = useState<{ id: string | number; rowCount: number } | null>(null)
  const importRequestRef = useRef(0)
  const importInFlightRef = useRef(false)
  const rowCountRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    if (isKhmer && fallbackKm && !isBrokenLocalizedString(fallbackKm)) return fallbackKm
    return isBrokenLocalizedString(fallbackEn) ? key : fallbackEn
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
      nextCount = await countInventoryCsvRowsInWorker(nextText)
    } catch (_) {
      nextCount = countCsvDataRows(nextText)
    }
    if (!aliveRef.current || rowCountRequestRef.current !== requestId) return
    setPreviewRowCount(nextCount)
    setAnalyzingCsv(false)
  }

  const setInventoryCsvText = (text: string, name = fileName): void => {
    const nextText = String(text || '')
    setCsvText(nextText)
    setFileName(String(name || 'inventory.csv'))
    setResult(null)
    void analyzeCsvText(nextText)
  }

  const handlePickFile = async () => {
    const picked = await getImportApi().openCSVDialog?.()
    if (!picked?.content) return
    setInventoryCsvText(picked.content, picked.name || 'inventory.csv')
  }

  const handleDropFile = async (file: File) => {
    try {
      const parsed = await parseImportFile(file)
      if (!parsed?.content) return
      setInventoryCsvText(parsed.content, parsed.name || file.name || 'inventory.csv')
    } catch (error) {
      notify(getErrorMessage(error, tr('inventory_import_drop_failed', 'Could not read that file.', 'មិនអាចអានឯកសារនោះបានទេ។')), 'error')
    }
  }

  const handleDownloadTemplate = () => {
    const type = inventoryAction === 'add' ? 'inventoryAdd' : inventoryAction === 'remove' ? 'inventoryRemove' : 'inventorySet'
    getImportApi().downloadImportTemplate(type)
  }

  const handleSelectAction = (nextAction: InventoryImportAction) => {
    if (nextAction === inventoryAction) return
    setInventoryAction(nextAction)
    // Columns (and what a positive quantity means) differ per action --
    // a file picked for one action isn't valid input for another, so
    // switching clears whatever was already loaded rather than letting a
    // stale file get imported under the wrong action.
    setCsvText('')
    setFileName('')
    setPreviewRowCount(0)
    setResult(null)
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
        () => getImportApi().createImportJob({ type: 'inventory', policy: { source: 'inventory_modal', inventory_action: inventoryAction } }),
        'Inventory import job',
        INVENTORY_IMPORT_JOB_CREATE_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(importRequestRef, requestId)) return
      const job = created?.job || created
      if (!job?.id) throw new Error('Import job was not created')
      await withLoaderTimeout(
        () => getImportApi().uploadImportJobCsv({ jobId: job.id as string | number, text: csvText, fileName: fileName || 'inventory.csv' }),
        'Inventory import CSV upload',
        INVENTORY_IMPORT_JOB_UPLOAD_TIMEOUT_MS,
      )
      await withLoaderTimeout(
        () => getImportApi().startImportJob(job.id as string | number),
        'Inventory import start',
        INVENTORY_IMPORT_JOB_START_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(importRequestRef, requestId) || !aliveRef.current) return
      setReviewJob({ id: job.id as string | number, rowCount })
      return
    } catch (error) {
      const nextResult = { imported: 0, errors: [getErrorMessage(error, tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ'))] }
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
    <Modal title={tr('inventory_import_title', 'Import Inventory', 'នាំចូលស្តុក')} onClose={onClose} draggable>
      {reviewJob ? (
        <ServerImportReviewScreen
          jobId={reviewJob.id}
          label={tr('inventory', 'Inventory')}
          source="inventory_modal"
          // Direct-apply: approve automatically after analysis, no second review.
          autoApprove
          rowCount={reviewJob.rowCount}
          t={t}
          notify={notify}
          onApproved={async () => {
            await signalDone({ imported: 0, queued: reviewJob.rowCount, jobId: reviewJob.id, errors: [] })
            onClose()
          }}
          onReviewLater={async () => {
            await signalDone({ imported: 0, queued: reviewJob.rowCount, jobId: reviewJob.id, errors: [] })
            notify(tr('inventory_import_started', 'Inventory import analysis is continuing in the background.'), 'info')
            onClose()
          }}
        />
      ) : <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('inventory_import_help', 'Pick one action, then download that action\'s template. Each action only imports what it says -- nothing is mixed together.', 'ជ្រើសសកម្មភាពមួយ រួចទាញយកគំរូរបស់សកម្មភាពនោះ។')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(['add', 'remove', 'set'] as InventoryImportAction[]).map((action) => {
            const labels: Record<InventoryImportAction, { title: string; hint: string }> = {
              add: {
                title: tr('inventory_action_add_title', 'Add stock', 'បន្ថែមស្តុក'),
                hint: tr('inventory_action_add_hint', 'Stock coming in -- new items or more of what you have.', 'ស្តុកចូល'),
              },
              remove: {
                title: tr('inventory_action_remove_title', 'Remove stock', 'ដកស្តុក'),
                hint: tr('inventory_action_remove_hint', 'Stock going out -- shrinkage, breakage, corrections.', 'ស្តុកចេញ'),
              },
              set: {
                title: tr('inventory_action_set_title', 'Set exact count', 'កំណត់ចំនួនពិត'),
                hint: tr('inventory_action_set_hint', 'Physical count -- sets stock to exactly this number.', 'រាប់ស្តុកជាក់ស្តែង'),
              },
            }
            const isActive = inventoryAction === action
            return (
              <button
                key={action}
                type="button"
                onClick={() => handleSelectAction(action)}
                aria-pressed={isActive}
                disabled={loading}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${isActive ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                <span className="block font-semibold">{labels[action].title}</span>
                <span className={`block ${isActive ? 'text-blue-100' : 'text-gray-400 dark:text-gray-500'}`}>{labels[action].hint}</span>
              </button>
            )
          })}
        </div>
        <CsvImportPreview
          columnsLabel={t('csv_columns_header') || 'Columns'}
          columnsText={INVENTORY_ACTION_COLUMNS[inventoryAction]}
          fileName={fileName}
          csvText={csvText}
          rowCount={previewRowCount}
          analyzing={analyzingCsv}
          onDownloadTemplate={handleDownloadTemplate}
          onPickFile={handlePickFile}
          onDropFile={handleDropFile}
          dragLabel={tr('inventory_import_drop_file', 'Drop file here to import', 'ទម្លាក់ឯកសារទីនេះដើម្បីនាំចូល')}
          downloadLabel={t('download_template') || 'Download Template'}
          pickLabel={tr('choose_csv_file', 'Choose CSV or Excel', 'ជ្រើស CSV')}
          analyzingLabel={tr('inventory_import_checking_rows', 'Checking rows...', 'កំពុងពិនិត្យជួរ...')}
          noFileLabel={tr('inventory_import_no_file', 'No CSV or Excel file selected yet.', 'មិនទាន់បានជ្រើសឯកសារ CSV ទេ។')}
          previewHeadingLabel={tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', String(previewRowCount))}
        />
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              {tr('imported_rows_count', 'Imported {count} row(s)', 'បាននាំចូល {count} ជួរ').replace('{count}', String(result.imported))}
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
      </div>}
    </Modal>
  )
}
