// The server-backed, two-screen unified stock-action import (progress.md
// §12/§13). ONE ten-column sheet does create / add / sale / reconciliation;
// the SYSTEM decides which from the numbers, the date and the `action`
// column. This replaces the older client-side AddSaleImportModal: every write
// now goes through the atomic, idempotent, oversell-proof server engine
// (cloudflare/src/lib/stockActionCommit.ts + applyStockActionsJob), never a
// browser-side apply.
//
// Exactly two screens, per §13:
//   1. Upload  -- pick the file, choose Direct vs Reconcile, see a client-side
//                 row/issue preview, then Analyze.
//   2. Review  -- the resolved counts + any conflicts, gated behind an
//                 explicit Confirm before the import actually applies.
// The apply itself runs in the background queue; the global import tracker
// shows its progress once confirmed, same as every other import type.
import { useEffect, useRef, useState } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import UploadIcon from 'lucide-react/dist/esm/icons/upload.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Modal from '../../shared/Modal'
import AppSelect from '../../shared/AppSelect'
import { parseImportFile } from '../../../utils/spreadsheetImport.ts'
import { parseCsvRows } from '../../../utils/csvImport.ts'
import {
  createImportJob,
  uploadImportJobCsv,
  startImportJob,
  getImportJob,
  getImportJobReview,
  approveImportJob,
  cancelImportJob,
} from '../../../api/importJobsTransport.ts'
import {
  parseUnifiedStockRows,
  buildUnifiedStockTemplateCsv,
  UNIFIED_STOCK_HEADERS,
  type UnifiedStockMode,
} from './unifiedStockImport.ts'
import {
  unwrapImportJob,
  unwrapStockActionReview,
  describeStockActionReviewRow,
  deriveStockImportReview,
  STOCK_IMPORT_TERMINAL_ANALYZE,
  type StockActionReviewRow,
  type StockImportJob,
} from './stockActionImportModel.ts'

type TranslateFn = (key: string, fallback?: string, km?: string) => string

interface StockActionImportModalProps {
  onClose: () => void
  onDone: () => void
  t: TranslateFn
  notify?: (message: string, tone?: string) => void
}

type Step = 'upload' | 'review'

const POLL_INTERVAL_MS = 1500

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

export default function StockActionImportModal({ onClose, onDone, t, notify }: StockActionImportModalProps) {
  const tr = (key: string, en: string, km = en): string => {
    const value = typeof t === 'function' ? t(key, en, km) : en
    return value && value !== key ? value : en
  }
  const toast = (message: string, tone = 'info') => { if (typeof notify === 'function') notify(message, tone) }

  const [step, setStep] = useState<Step>('upload')
  const [mode, setMode] = useState<UnifiedStockMode>('direct')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [rowCount, setRowCount] = useState(0)
  const [issueCount, setIssueCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState<string | number | null>(null)
  const [job, setJob] = useState<StockImportJob | null>(null)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [reviewRows, setReviewRows] = useState<StockActionReviewRow[]>([])
  const [reviewTotal, setReviewTotal] = useState(0)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewQuery, setReviewQuery] = useState('')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [reviewLoading, setReviewLoading] = useState(false)
  const aliveRef = useRef(true)

  useEffect(() => () => { aliveRef.current = false }, [])

  // ---- Screen 2 polling: analyze runs in the queue; wait for awaiting_review.
  useEffect(() => {
    if (step !== 'review' || jobId == null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const fetched = unwrapImportJob(await getImportJob(jobId))
        if (cancelled || !aliveRef.current) return
        if (fetched) setJob(fetched)
        const status = String(fetched?.status || '')
        if (!STOCK_IMPORT_TERMINAL_ANALYZE.has(status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch {
        if (!cancelled && aliveRef.current) timer = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }
    void poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [step, jobId])

  // Screen 2's authoritative data is the analyzer's persisted row set, not
  // the browser's initial parse. Fetch it page-by-page so the operator sees
  // the exact resolved product/action/branch plan they are confirming.
  useEffect(() => {
    if (step !== 'review' || jobId == null || String(job?.status || '') !== 'awaiting_review') return
    let cancelled = false
    const timer = setTimeout(() => {
      setReviewLoading(true)
      void getImportJobReview(jobId, {
        page: reviewPage,
        pageSize: 50,
        ...(reviewFilter !== 'all' ? { filter: reviewFilter } : {}),
        ...(reviewQuery.trim() ? { query: reviewQuery.trim() } : {}),
      }).then((payload) => {
        if (cancelled || !aliveRef.current) return
        const reviewPageData = unwrapStockActionReview(payload)
        setReviewRows(reviewPageData.rows)
        setReviewTotal(reviewPageData.total)
      }).catch((err) => {
        if (!cancelled && aliveRef.current) setError(err instanceof Error ? err.message : 'Could not load resolved rows.')
      }).finally(() => {
        if (!cancelled && aliveRef.current) setReviewLoading(false)
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [step, jobId, job?.status, reviewPage, reviewQuery, reviewFilter])

  const readFile = async (file: File) => {
    setError('')
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
    }
  }

  const handlePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await readFile(file)
  }

  const handleAnalyze = async () => {
    if (busy || !csvText.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = unwrapImportJob(await createImportJob({ type: 'stock_actions', policy: { source: 'stock_action_modal', stock_action_mode: mode } }))
      if (!created?.id) throw new Error(tr('stock_import_no_job', 'The import job could not be created.', 'មិនអាចបង្កើតការងារនាំចូលបានទេ។'))
      await uploadImportJobCsv({ jobId: created.id, text: csvText, fileName: fileName || 'stock-actions.csv' })
      await startImportJob(created.id)
      if (!aliveRef.current) return
      setJobId(created.id)
      setJob(created)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('stock_import_start_failed', 'Could not start the import.', 'មិនអាចចាប់ផ្តើមការនាំចូលបានទេ។'))
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (busy || jobId == null) return
    setBusy(true)
    setError('')
    try {
      await approveImportJob(jobId, { source: 'stock_action_modal', confirmStockActions: true })
      if (!aliveRef.current) return
      toast(tr('stock_import_applying', 'Stock import confirmed — applying in the background. Track it from the top progress bar.', 'បានបញ្ជាក់ការនាំចូលស្តុក — កំពុងអនុវត្តនៅផ្ទៃខាងក្រោយ។'), 'success')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('stock_import_confirm_failed', 'Could not confirm the import.', 'មិនអាចបញ្ជាក់ការនាំចូលបានទេ។'))
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  const handleBackToUpload = async () => {
    // Abandon the analyzed job (never applied) and return to a clean upload.
    if (jobId != null) { try { await cancelImportJob(jobId, { source: 'stock_action_modal' }) } catch { /* best effort */ } }
    if (!aliveRef.current) return
    setJobId(null)
    setJob(null)
    setConfirmChecked(false)
    setReviewRows([])
    setReviewTotal(0)
    setReviewPage(1)
    setReviewQuery('')
    setReviewFilter('all')
    setError('')
    setStep('upload')
  }

  const review = deriveStockImportReview(job, confirmChecked, rowCount)
  const { needsConfirm, conflictRows, actionable, errored } = review
  const analyzing = step === 'review' && review.analyzing
  const analyzeFailed = review.failed
  const summary = job?.summary || {}

  return (
    <Modal title={tr('stock_import_title', 'Import Stock Actions', 'នាំចូលសកម្មភាពស្តុក')} onClose={onClose} draggable>
      {step === 'upload' ? (
        <div className="space-y-4">
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
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-xl border p-3 text-left transition ${mode === value ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-gray-200 dark:border-gray-700'}`}
                >
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{help}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
              <UploadIcon className="h-4 w-4" />
              {tr('choose_csv_file', 'Choose CSV or Excel', 'ជ្រើស CSV')}
              <input type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm" className="hidden" onChange={handlePick} />
            </label>
            <button type="button" className="btn-secondary" onClick={() => triggerDownload('stock-actions-template.csv', buildUnifiedStockTemplateCsv())}>
              {tr('download_template', 'Download Template', 'ទាញយកគំរូ')}
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {tr('stock_import_columns', 'Columns', 'ជួរ')}: <span className="font-mono">{UNIFIED_STOCK_HEADERS.join(', ')}</span>
          </div>

          {fileName ? (
            <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
              <div className="font-medium text-gray-800 dark:text-gray-200">{fileName}</div>
              <div className="mt-1 text-gray-600 dark:text-gray-300">
                {tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', String(rowCount))}
                {issueCount > 0 ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {tr('stock_import_issue_count', '{count} row(s) need attention', '{count} ជួរត្រូវការការយកចិត្តទុកដាក់').replace('{count}', String(issueCount))}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}

          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={busy}>{tr('cancel', 'Cancel', 'បោះបង់')}</button>
            <button type="button" className="btn-primary flex-1" disabled={busy || !csvText.trim() || rowCount === 0} onClick={handleAnalyze}>
              {busy ? tr('stock_import_analyzing', 'Analyzing…', 'កំពុងវិភាគ…') : tr('stock_import_analyze', 'Analyze rows', 'វិភាគជួរ')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {analyzing ? (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              {tr('stock_import_reviewing', 'Resolving your rows against the catalog…', 'កំពុងដោះស្រាយជួររបស់អ្នក…')}
            </div>
          ) : analyzeFailed ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {tr('stock_import_analyze_failed', 'The analysis failed.', 'ការវិភាគបានបរាជ័យ។')} {job?.last_error ? `— ${job.last_error}` : ''}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  [tr('stock_import_rows_total', 'Rows', 'ជួរ'), Number(summary.total || rowCount), 'text-gray-800 dark:text-gray-100'],
                  [tr('stock_import_will_apply', 'Will apply', 'នឹងអនុវត្ត'), actionable, 'text-emerald-600 dark:text-emerald-400'],
                  [tr('stock_import_skipped', 'No change', 'គ្មានការផ្លាស់ប្តូរ'), Number(summary.skipped || 0), 'text-gray-500 dark:text-gray-400'],
                  [tr('stock_import_errored', 'Errors', 'កំហុស'), errored, errored > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'],
                ] as const).map(([label, value, cls]) => (
                  <div key={label} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                    <div className={`text-lg font-semibold ${cls}`}>{value}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                  </div>
                ))}
              </div>

              {needsConfirm ? (
                <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                  <input type="checkbox" className="mt-0.5" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                  <span className="text-amber-800 dark:text-amber-200">
                    <span className="inline-flex items-center gap-1 font-medium"><AlertTriangle className="h-4 w-4" />{tr('stock_import_confirm_needed', 'Some rows need explicit confirmation', 'ជួរខ្លះត្រូវការការបញ្ជាក់ច្បាស់លាស់')}</span>
                    <span className="mt-0.5 block text-xs">
                      {tr('stock_import_confirm_detail', '{count} row(s) have a same-product / multiple-batch / multiple-cost conflict. Confirm you want them applied as resolved.', '{count} ជួរមានជម្លោះ។ បញ្ជាក់ថាអ្នកចង់អនុវត្តវា។').replace('{count}', String(conflictRows))}
                    </span>
                  </span>
                </label>
              ) : (
                <div className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {tr('stock_import_no_conflicts', 'No conflicts — ready to import.', 'គ្មានជម្លោះ — រួចរាល់ដើម្បីនាំចូល។')}
                </div>
              )}

              {errored > 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {tr('stock_import_errored_note', 'Rows with errors are skipped; the rest still import. Download the error report from the progress bar after it runs.', 'ជួរដែលមានកំហុសត្រូវបានរំលង។')}
                </div>
              ) : null}

              <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      {tr('stock_import_resolved_rows', 'Resolved rows', 'ជួរដែលបានដោះស្រាយ')}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {tr('stock_import_resolved_rows_help', 'This is the server plan that Confirm will apply.', 'នេះជាផែនការម៉ាស៊ីនមេដែលការបញ្ជាក់នឹងអនុវត្ត។')}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={reviewQuery}
                      onChange={(event) => { setReviewQuery(event.target.value); setReviewPage(1) }}
                      placeholder={tr('search_rows', 'Search rows…', 'ស្វែងរកជួរ…')}
                      className="w-40 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900"
                    />
                    <AppSelect
                      ariaLabel={tr('filter_rows', 'Filter rows', 'ត្រងជួរ')}
                      value={reviewFilter}
                      onChange={(value) => { setReviewFilter(value); setReviewPage(1) }}
                      buttonClassName="h-8 rounded-lg text-xs"
                      options={[
                        { value: 'all', label: tr('all_rows', 'All rows', 'ជួរទាំងអស់') },
                        { value: 'create', label: tr('create', 'Create', 'បង្កើត') },
                        { value: 'update', label: tr('update', 'Update', 'កែប្រែ') },
                        { value: 'skip', label: tr('skip', 'Skip', 'រំលង') },
                        { value: 'error', label: tr('errors', 'Errors', 'កំហុស') },
                      ]}
                    />
                  </div>
                </div>

                <div className="max-h-72 overflow-auto rounded-lg border border-gray-100 dark:border-gray-800">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">#</th>
                        <th className="px-2 py-2">{tr('product', 'Product', 'ផលិតផល')}</th>
                        <th className="px-2 py-2">{tr('resolved_action', 'Resolved action', 'សកម្មភាពដែលបានដោះស្រាយ')}</th>
                        <th className="px-2 py-2">{tr('status', 'Status', 'ស្ថានភាព')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {reviewRows.map((row) => (
                        <tr key={row.rowNumber} className={row.message ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                          <td className="whitespace-nowrap px-2 py-2 text-gray-500">{row.rowNumber}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-gray-800 dark:text-gray-100">{row.data?.productName || row.identifier || '—'}</div>
                            <div className="text-gray-500 dark:text-gray-400">{row.data?.date || ''}{row.data?.action ? ` · ${row.data.action}` : ''}</div>
                          </td>
                          <td className="min-w-52 px-2 py-2 text-gray-700 dark:text-gray-200">{describeStockActionReviewRow(row)}</td>
                          <td className="min-w-44 px-2 py-2">
                            <span className={row.action === 'error' ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-gray-700 dark:text-gray-200'}>{row.action}</span>
                            {row.message ? <div className="mt-0.5 text-amber-700 dark:text-amber-300">{row.message}</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!reviewLoading && reviewRows.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-500">{tr('no_matching_rows', 'No matching rows.', 'រកមិនឃើញជួរដែលត្រូវគ្នា។')}</div>
                  ) : null}
                  {reviewLoading ? <div className="p-4 text-center text-xs text-gray-500">{tr('loading', 'Loading…', 'កំពុងផ្ទុក…')}</div> : null}
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{reviewTotal} {tr('rows', 'rows', 'ជួរ')}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={reviewPage <= 1 || reviewLoading} onClick={() => setReviewPage((page) => Math.max(1, page - 1))}>{tr('previous', 'Previous', 'មុន')}</button>
                    <span>{reviewPage} / {Math.max(1, Math.ceil(reviewTotal / 50))}</span>
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={reviewPage * 50 >= reviewTotal || reviewLoading} onClick={() => setReviewPage((page) => page + 1)}>{tr('next', 'Next', 'បន្ទាប់')}</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}

          <div className="flex gap-2">
            <button type="button" className="btn-secondary inline-flex items-center justify-center gap-1" onClick={handleBackToUpload} disabled={busy}>
              <ArrowLeft className="h-4 w-4" />{tr('back', 'Back', 'ថយក្រោយ')}
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={busy || !review.canConfirm}
              onClick={handleConfirm}
            >
              {busy
                ? tr('stock_import_confirming', 'Confirming…', 'កំពុងបញ្ជាក់…')
                : tr('stock_import_confirm_apply', 'Confirm & Import', 'បញ្ជាក់ និងនាំចូល')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
