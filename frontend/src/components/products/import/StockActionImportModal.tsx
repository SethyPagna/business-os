// The server-backed unified stock-action import (progress.md §12). ONE
// ten-column sheet does create / add / sale / reconciliation; the SYSTEM
// decides which from the numbers, the date and the `action` column. Every
// write goes through the atomic, idempotent, oversell-proof server engine
// (cloudflare/src/lib/stockActionCommit.ts + applyStockActionsJob), never a
// browser-side apply.
//
// ONE screen, the same review-first direct-apply contract every sibling
// importer follows (sales/inventory/products): pick the file, choose Direct
// vs Reconcile, review the parsed rows RIGHT HERE (CsvImportPreview + the
// client-side issue count), then Import -- analysis runs server-side and the
// job applies directly in the background (ServerImportReviewScreen's
// autoApprove, carrying the stock confirm flag). There is deliberately NO
// second server-side review screen: that extra "analyze → review → confirm"
// hop was slower and violated the standing upload → review → apply flow the
// operator chose; per-row conflicts stay recorded on the rows and appear in
// the finished job's report from the tracker.
import { useEffect, useRef, useState } from 'react'
import UploadIcon from 'lucide-react/dist/esm/icons/upload.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Scale from 'lucide-react/dist/esm/icons/scale.js'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js'
import Modal from '../../shared/Modal'
import CsvImportPreview from '../../shared/CsvImportPreview.tsx'
import ServerImportReviewScreen from '../../imports/ServerImportReviewScreen'
import { parseImportFile } from '../../../utils/spreadsheetImport.ts'
import { parseCsvRows } from '../../../utils/csvImport.ts'
import { createImportJob, uploadImportJobCsv, startImportJob } from '../../../api/importJobsTransport.ts'
import {
  parseUnifiedStockRows,
  buildUnifiedStockTemplateCsv,
  UNIFIED_STOCK_HEADERS,
  type UnifiedStockMode,
} from './unifiedStockImport.ts'
import { unwrapImportJob } from './stockActionImportModel.ts'
import ProductImportModeTabs, { ProductImportOptionCard, type ProductImportTopMode } from './ProductImportModeTabs'

type TranslateFn = (key: string, fallback?: string, km?: string) => string

interface StockActionImportModalProps {
  onClose: () => void
  onDone: () => void
  t: TranslateFn
  notify?: (message: string, tone?: string) => void
  topMode?: 'stock_actions'
  onTopModeChange?: (mode: ProductImportTopMode) => void
}

function triggerDownload(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function StockActionImportModal({ onClose, onDone, t, notify, topMode = 'stock_actions', onTopModeChange }: StockActionImportModalProps) {
  const tr = (key: string, en: string, km = en): string => {
    const value = typeof t === 'function' ? t(key, en, km) : en
    return value && value !== key ? value : en
  }
  const toast = (message: string, tone = 'info') => { if (typeof notify === 'function') notify(message, tone) }

  const [mode, setMode] = useState<UnifiedStockMode>('direct')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [rowCount, setRowCount] = useState(0)
  const [issueCount, setIssueCount] = useState(0)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewJob, setReviewJob] = useState<{ id: string | number; rowCount: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => () => { aliveRef.current = false }, [])

  const readFile = async (file: File) => {
    setError('')
    setReading(true)
    try {
      const parsed = await parseImportFile(file)
      const content = String(parsed?.content || '')
      if (!content.trim()) { setError(tr('stock_import_empty_file', 'That file has no rows.', 'ឯកសារនោះគ្មានជួរទេ។')); return }
      setCsvText(content)
      setFileName(String(parsed?.name || file.name || 'stock-actions.csv'))
      const rows = parseCsvRows(content)
      const result = parseUnifiedStockRows(rows as Record<string, unknown>[])
      setRowCount(result.rows.length)
      setIssueCount(result.issues.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('stock_import_read_failed', 'Could not read that file.', 'មិនអាចអានឯកសារនោះបានទេ។'))
    } finally {
      setReading(false)
    }
  }

  const handlePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await readFile(file)
  }

  // The one dispatch: create + upload + start, then hand off to the shared
  // direct-apply screen -- the operator already reviewed the rows above.
  const handleImport = async () => {
    if (busy || !csvText.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = unwrapImportJob(await createImportJob({
        type: 'stock_actions',
        policy: { source: 'stock_action_modal', stock_action_mode: mode, auto_approve: true },
      }))
      if (!created?.id) throw new Error(tr('stock_import_no_job', 'The import job could not be created.', 'មិនអាចបង្កើតការងារនាំចូលបានទេ។'))
      await uploadImportJobCsv({ jobId: created.id, text: csvText, fileName: fileName || 'stock-actions.csv' })
      await startImportJob(created.id)
      if (!aliveRef.current) return
      setReviewJob({ id: created.id, rowCount })
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('stock_import_start_failed', 'Could not start the import.', 'មិនអាចចាប់ផ្តើមការនាំចូលបានទេ។'))
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  return (
    <Modal title={tr('stock_import_title', 'Import Stock Actions', 'នាំចូលសកម្មភាពស្តុក')} onClose={onClose} draggable unsavedChanges={{ dirty: Boolean(csvText) }}>
      {reviewJob ? (
        <ServerImportReviewScreen
          jobId={reviewJob.id}
          label={tr('stock_actions', 'Stock actions', 'សកម្មភាពស្តុក')}
          source="stock_action_modal"
          // Direct-apply: approve automatically after analysis, no second
          // review. The confirm flag rides along so a conflicted stock plan
          // (same-product / multi-batch / multi-cost rows, resolved and
          // recorded per row) applies instead of dead-ending on a 409.
          autoApprove
          confirmStockActions
          rowCount={reviewJob.rowCount}
          t={(key: string) => t(key)}
          notify={(message, tone) => toast(message, tone)}
          onApproved={() => {
            toast(tr('stock_import_applying', 'Stock import confirmed — applying in the background. Track it from the top progress bar.', 'បានបញ្ជាក់ការនាំចូលស្តុក — កំពុងអនុវត្តនៅផ្ទៃខាងក្រោយ។'), 'success')
            onDone()
            onClose()
          }}
          onReviewLater={() => {
            toast(tr('stock_import_started_bg', 'Stock import analysis is continuing in the background.', 'ការវិភាគនាំចូលស្តុកកំពុងបន្តនៅផ្ទៃខាងក្រោយ។'), 'info')
            onDone()
            onClose()
          }}
        />
      ) : (
        <div className="space-y-4">
          {onTopModeChange ? <ProductImportModeTabs value={topMode} onChange={onTopModeChange} /> : null}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {tr('stock_import_help', 'One sheet for add, sale, and reconciliation. The system decides what each row does from its numbers, date and the action column — no separate templates.', 'សន្លឹកតែមួយសម្រាប់បន្ថែម លក់ និងផ្ទៀងផ្ទាត់។ ប្រព័ន្ធសម្រេចថាជួរនីមួយៗធ្វើអ្វីពីលេខ កាលបរិច្ឆេទ និងជួរសកម្មភាព។')}
          </p>

          <div>
            <div className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{tr('stock_import_mode', 'How to read the numbers', 'របៀបអានលេខ')}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                ['direct', tr('stock_import_mode_direct', 'Direct — the number IS the change', 'ផ្ទាល់ — លេខគឺជាការផ្លាស់ប្តូរ'), tr('stock_import_mode_direct_help', 'shop/warehouse are how much to add or sell; the action column says which.', 'shop/warehouse គឺជាចំនួនត្រូវបន្ថែម ឬលក់។')],
                ['reconcile', tr('stock_import_mode_reconcile', 'Reconcile — the number is the total count', 'ផ្ទៀងផ្ទាត់ — លេខគឺជាចំនួនសរុប'), tr('stock_import_mode_reconcile_help', 'shop/warehouse are the counted total on that date; the system computes the delta.', 'shop/warehouse គឺជាចំនួនសរុបនៅថ្ងៃនោះ។')],
              ] as const).map(([value, label, help]) => (
                <ProductImportOptionCard
                  key={value}
                  active={mode === value}
                  icon={value === 'direct' ? TrendingUp : Scale}
                  title={label}
                  description={help}
                  onClick={() => setMode(value)}
                />
              ))}
            </div>
          </div>

          <CsvImportPreview
            columnsLabel={tr('stock_import_columns', 'Columns', 'ជួរ')}
            columnsText={UNIFIED_STOCK_HEADERS.join(', ')}
            fileName={fileName}
            csvText={csvText}
            rowCount={rowCount}
            analyzing={reading}
            onDownloadTemplate={() => triggerDownload('stock-actions-template.csv', buildUnifiedStockTemplateCsv())}
            onPickFile={() => fileInputRef.current?.click()}
            onDropFile={(file) => void readFile(file)}
            dragLabel={tr('stock_import_drop_file', 'Drop file here to import', 'ទម្លាក់ឯកសារទីនេះដើម្បីនាំចូល')}
            downloadLabel={tr('download_template', 'Download Template', 'ទាញយកគំរូ')}
            pickLabel={tr('choose_csv_file', 'Choose CSV or Excel', 'ជ្រើស CSV')}
            analyzingLabel={tr('stock_import_checking_rows', 'Checking rows...', 'កំពុងពិនិត្យជួរ...')}
            noFileLabel={tr('stock_import_no_file', 'No CSV or Excel file selected yet.', 'មិនទាន់បានជ្រើសឯកសារទេ។')}
            previewHeadingLabel={tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', String(rowCount))}
          />
          <input ref={fileInputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm" className="hidden" onChange={handlePick} />

          {issueCount > 0 ? (
            <div className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {tr('stock_import_issue_count', '{count} row(s) need attention', '{count} ជួរត្រូវការការយកចិត្តទុកដាក់').replace('{count}', String(issueCount))}
              {' — '}
              {tr('stock_import_issue_note', 'they are skipped with a reason in the finished report; the rest import normally.', 'ជួរទាំងនោះត្រូវបានរំលងជាមួយហេតុផលនៅក្នុងរបាយការណ៍។')}
            </div>
          ) : null}

          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}

          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={busy}>{tr('cancel', 'Cancel', 'បោះបង់')}</button>
            <button type="button" className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5" disabled={busy || !csvText.trim() || rowCount === 0} onClick={handleImport}>
              <UploadIcon className="h-4 w-4" />
              {busy ? tr('stock_import_starting', 'Starting…', 'កំពុងចាប់ផ្តើម…') : tr('stock_import_start', 'Import', 'នាំចូល')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
