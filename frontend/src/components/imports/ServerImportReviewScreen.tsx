import { useEffect, useMemo, useRef, useState } from 'react'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import AppSelect from '../shared/AppSelect'
import { approveImportJob, getImportJob, getImportJobReview } from '../../api/importJobsTransport'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

type ReviewRow = {
  rowNumber: number
  action: string
  identifier?: string | null
  message?: string | null
  warnings?: Array<{ kind?: string; message?: string }>
  data?: Record<string, unknown>
}

type ReviewPayload = {
  rows?: ReviewRow[]
  page?: number
  pageSize?: number
  total?: number
  counts?: Record<string, number>
}

const PAGE_SIZE = 50
const POLL_MS = 1200

function unwrapJob(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const nested = record.job
  return nested && typeof nested === 'object' ? nested as Record<string, unknown> : record
}

export default function ServerImportReviewScreen({ jobId, label, source, t, notify, onApproved, onReviewLater, autoApprove = false }: {
  jobId: string | number
  label: string
  source: 'sales_modal' | 'inventory_modal'
  t: TranslateFn
  notify: NotifyFn
  onApproved: () => void | Promise<void>
  onReviewLater: () => void | Promise<void>
  // Direct-apply: once analysis reaches awaiting_review, approve automatically
  // instead of showing the review table -- the operator already reviewed on the
  // upload screen. Inventory/sales approve never conflict-blocks server-side, so
  // this just applies; on any unexpected approve error we fall back to the
  // manual table so the operator isn't stuck.
  autoApprove?: boolean
}) {
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const [status, setStatus] = useState('queued')
  const [jobError, setJobError] = useState('')
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('row_asc')
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [loadingRows, setLoadingRows] = useState(false)
  const [approving, setApproving] = useState(false)
  const approvingRef = useRef(false)
  // Direct-apply: fell back to the manual review after an unexpected approve
  // error; autoAttemptedRef makes the auto-approve fire once.
  const [autoFellBack, setAutoFellBack] = useState(false)
  const autoAttemptedRef = useRef(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(queryDraft.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [queryDraft])

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null
    const poll = async () => {
      try {
        const raw = await getImportJob(jobId)
        if (cancelled) return
        const job = unwrapJob(raw)
        const nextStatus = String(job?.status || 'queued').toLowerCase()
        setStatus(nextStatus)
        setJobError(String(job?.error_message || ''))
        if (!['awaiting_review', 'failed', 'cancelled', 'completed', 'completed_with_errors'].includes(nextStatus)) {
          timeoutId = window.setTimeout(poll, POLL_MS)
        }
      } catch (error) {
        if (cancelled) return
        setJobError(error instanceof Error ? error.message : tr('import_status_failed', 'Could not read import status.'))
        timeoutId = window.setTimeout(poll, POLL_MS)
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    if (status !== 'awaiting_review') return
    let cancelled = false
    setLoadingRows(true)
    getImportJobReview(jobId, { page, pageSize: PAGE_SIZE, type: filter, query: query || undefined, sort })
      .then((raw) => {
        if (cancelled) return
        const payload = (raw || {}) as ReviewPayload
        setRows(Array.isArray(payload.rows) ? payload.rows : [])
        setTotal(Math.max(0, Number(payload.total) || 0))
        setCounts(payload.counts && typeof payload.counts === 'object' ? payload.counts : {})
      })
      .catch((error) => {
        if (!cancelled) setJobError(error instanceof Error ? error.message : tr('import_review_failed', 'Could not load import review.'))
      })
      .finally(() => { if (!cancelled) setLoadingRows(false) })
    return () => { cancelled = true }
  }, [filter, jobId, page, query, sort, status])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const summary = useMemo(() => ['create', 'update', 'skip', 'error']
    .filter((key) => Number(counts[key] || 0) > 0)
    .map((key) => `${key}: ${Number(counts[key] || 0)}`)
    .join(' · '), [counts])

  const confirm = async ({ auto = false }: { auto?: boolean } = {}) => {
    if (!beginSingleAction(approvingRef)) return
    setApproving(true)
    try {
      await approveImportJob(jobId, { source })
      if (!auto) notify(tr('import_approved_now', 'Confirmed — the import is applying now.'), 'success')
      await onApproved()
    } catch (error) {
      // Direct-apply hit an unexpected error: drop to the manual review so the
      // operator can see it and retry, rather than a dead-ended spinner.
      if (auto) setAutoFellBack(true)
      notify(error instanceof Error ? error.message : tr('import_apply_failed', 'Could not approve import'), 'error')
    } finally {
      finishSingleAction(approvingRef)
      setApproving(false)
    }
  }

  // Direct-apply mode: approve automatically once analysis reaches
  // awaiting_review. Fires once; disabled after a fallback.
  useEffect(() => {
    if (!autoApprove || autoFellBack) return
    if (status !== 'awaiting_review') return
    if (approvingRef.current || autoAttemptedRef.current) return
    autoAttemptedRef.current = true
    void confirm({ auto: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoApprove, autoFellBack])

  // Direct-apply mode (no second review): one progress state while the server
  // analyzes and we auto-approve; the modal closes on onApproved and the apply
  // runs in the background tracker. Skipped once autoFellBack flips true.
  if (autoApprove && !autoFellBack) {
    const terminal = ['failed', 'cancelled', 'completed', 'completed_with_errors'].includes(status)
    return (
      <div className="space-y-4 py-8 text-center">
        {!terminal ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-500" /> : <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />}
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {terminal ? tr('import_analysis_stopped', 'Import analysis stopped') : tr('import_applying_now', 'Importing…')}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {jobError || (terminal ? status : tr('import_applying_hint', 'Applying your reviewed import. This closes when it starts.'))}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => void onReviewLater()}>
          {tr('continue_in_background', 'Continue in background')}
        </button>
      </div>
    )
  }

  if (status !== 'awaiting_review') {
    const terminal = ['failed', 'cancelled', 'completed', 'completed_with_errors'].includes(status)
    return (
      <div className="space-y-4 py-8 text-center">
        {!terminal ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-500" /> : <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />}
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {terminal ? tr('import_analysis_stopped', 'Import analysis stopped') : tr('import_analyzing', 'Analyzing on the server…')}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {jobError || (terminal ? status : tr('import_analyzing_hint', 'Screen 2 will open here as soon as the persisted review is ready.'))}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => void onReviewLater()}>
          {tr('continue_in_background', 'Continue in background')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{tr('import_review_title', 'Review before importing')} — {label}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{summary || tr('import_review_no_actions', 'No actionable rows were found.')}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder={tr('search_rows', 'Search rows')} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <AppSelect value={filter} onChange={(value) => { setFilter(value); setPage(1) }} ariaLabel={tr('filter_rows', 'Filter rows')} buttonClassName="w-full px-2.5 py-2 text-sm" options={[
          { value: 'all', label: tr('all', 'All') }, { value: 'create', label: tr('create', 'Create') }, { value: 'update', label: tr('update', 'Update') }, { value: 'skip', label: tr('skip', 'Skip') }, { value: 'error', label: tr('errors', 'Errors') },
        ]} />
        <AppSelect value={sort} onChange={(value) => { setSort(value); setPage(1) }} ariaLabel={tr('sort_rows', 'Sort rows')} buttonClassName="w-full px-2.5 py-2 text-sm" options={[
          { value: 'row_asc', label: tr('first_to_last', 'First–last') }, { value: 'row_desc', label: tr('last_to_first', 'Last–first') }, { value: 'name_asc', label: tr('sort_name_az', 'Name A–Z') }, { value: 'name_desc', label: tr('sort_name_za', 'Name Z–A') },
        ]} />
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        {loadingRows ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : rows.length ? (
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">{tr('item', 'Item')}</th><th className="px-3 py-2">{tr('action', 'Action')}</th><th className="px-3 py-2">{tr('details', 'Details')}</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.rowNumber} className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2 font-medium">{row.identifier || String(row.data?.name || '—')}</td><td className="px-3 py-2">{row.action}</td><td className="max-w-md px-3 py-2 text-slate-500 dark:text-slate-400">{row.message || (row.warnings || []).map((warning) => warning.message).filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody>
          </table>
        ) : <div className="p-8 text-center text-sm text-slate-500">{tr('no_matching_rows', 'No matching rows.')}</div>}
      </div>
      {total > PAGE_SIZE ? <div className="flex items-center justify-between text-xs text-slate-500"><span>{tr('page_of', 'Page {page} of {pages}').replace('{page}', String(page)).replace('{pages}', String(pages))}</span><div className="flex gap-2"><button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{tr('previous', 'Previous')}</button><button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{tr('next', 'Next')}</button></div></div> : null}
      {jobError ? <p className="text-xs text-red-600 dark:text-red-400">{jobError}</p> : null}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button type="button" className="btn-secondary" disabled={approving} onClick={() => void onReviewLater()}>{tr('review_later', 'Review later')}</button>
        <button type="button" className="btn-primary" disabled={approving || loadingRows} onClick={() => void confirm()}>{approving ? tr('approving', 'Approving…') : tr('confirm_import', 'Confirm & import')}</button>
      </div>
    </div>
  )
}
