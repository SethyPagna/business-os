import { useEffect, useRef, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import AppSelect from '../../shared/AppSelect'
import PaginationControls from '../../shared/PaginationControls'
import { approveImportJob, getImportJob, getImportJobReview, updateImportJobDecisions } from '../../../api/importJobsTransport'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards'
import { importPollDelayMs } from '../../../utils/importPoll'

const PAGE_SIZE = 50

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void
type ReviewDecision = { action?: string; field_overrides?: Record<string, unknown> } | null
type ReviewRow = {
  rowNumber: number
  action: string
  identifier?: string | null
  message?: string | null
  warnings?: Array<{ kind?: string; message?: string }>
  data?: Record<string, unknown>
  plannedMode?: string | null
  decision?: ReviewDecision
}
type ReviewPayload = {
  rows?: ReviewRow[]
  page?: number
  pageSize?: number
  total?: number
  counts?: Record<string, number>
  unresolvedProductConflicts?: number
}

function unwrapJob(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return record.job && typeof record.job === 'object' ? record.job as Record<string, unknown> : record
}

function choiceFor(row: ReviewRow): string {
  if (row.decision?.action === 'skip') return 'skip'
  const needsDecision = (row.warnings || []).some((warning) => ['negative_stock', 'barcode_collision', 'sku_collision'].includes(String(warning.kind || '')))
  if (needsDecision && !row.decision) return 'needs_decision'
  const mode = String(row.decision?.field_overrides?._action || row.plannedMode || '')
  return ['merge_stock', 'override_add', 'override_replace'].includes(mode) ? mode : 'apply'
}

function decisionFor(choice: string): { action: string; field_overrides?: Record<string, unknown> } {
  if (choice === 'skip') return { action: 'skip' }
  if (['merge_stock', 'override_add', 'override_replace'].includes(choice)) {
    return { action: 'apply', field_overrides: { _action: choice } }
  }
  return { action: 'apply' }
}

export default function ProductServerImportReviewScreen({ jobId, jobRevision, t, notify, onApproved, onReviewLater, onCancel, onJob, autoApprove = false, rowCount = 0 }: {
  jobId: string | number
  jobRevision?: unknown
  t: TranslateFn
  notify: NotifyFn
  onApproved: () => void | Promise<void>
  onReviewLater: () => void | Promise<void>
  onCancel: () => void | Promise<void>
  onJob?: (job: Record<string, unknown>) => void
  // Direct-apply mode: once analysis reaches awaiting_review, approve
  // automatically instead of showing the review table -- the operator already
  // reviewed on the client screen. The server is the authority on conflicts
  // (its approve 409s on unresolved ones), so if that happens we fall back to
  // the manual review below so they can be resolved. Clean imports (the common
  // case) never see this screen's table at all.
  autoApprove?: boolean
  // Rows the operator is importing (known from the client analysis before the
  // server round-trip). Shown in the direct-apply progress so it reads
  // "Importing N rows…" instead of a bare spinner; the server's create/update
  // breakdown replaces it as soon as analysis lands.
  rowCount?: number
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
  const [unresolved, setUnresolved] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('row_asc')
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [loadingRows, setLoadingRows] = useState(false)
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [approving, setApproving] = useState(false)
  const approvalRef = useRef(false)
  // Direct-apply: fell back to the manual review because the server reported
  // unresolved conflicts; `autoAttemptedRef` makes the auto-approve fire once.
  const [autoFellBack, setAutoFellBack] = useState(false)
  const autoAttemptedRef = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryDraft.trim()); setPage(1) }, 300)
    return () => window.clearTimeout(timer)
  }, [queryDraft])

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    let attempt = 0
    const poll = async () => {
      try {
        const raw = await getImportJob(jobId)
        if (cancelled) return
        const job = unwrapJob(raw)
        const nextStatus = String(job?.status || 'queued').toLowerCase()
        setStatus(nextStatus)
        setJobError(String(job?.last_error || job?.error_message || ''))
        if (job) onJob?.(job)
        if (!['awaiting_review', 'failed', 'cancelled', 'completed', 'completed_with_errors'].includes(nextStatus)) {
          timer = window.setTimeout(poll, importPollDelayMs(attempt++))
        }
      } catch (error) {
        if (cancelled) return
        setJobError(error instanceof Error ? error.message : tr('import_status_failed', 'Could not read import status.'))
        timer = window.setTimeout(poll, importPollDelayMs(attempt++))
      }
    }
    void poll()
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobRevision])

  const loadRows = async () => {
    setLoadingRows(true)
    try {
      const raw = await getImportJobReview(jobId, { page, pageSize: PAGE_SIZE, type: filter, query: query || undefined, sort }) as ReviewPayload | null
      setRows(Array.isArray(raw?.rows) ? raw.rows : [])
      setTotal(Math.max(0, Number(raw?.total) || 0))
      setCounts(raw?.counts && typeof raw.counts === 'object' ? raw.counts : {})
      setUnresolved(Math.max(0, Number(raw?.unresolvedProductConflicts) || 0))
    } catch (error) {
      setJobError(error instanceof Error ? error.message : tr('import_review_failed', 'Could not load import review.'))
    } finally {
      setLoadingRows(false)
    }
  }

  // Only fetch the (paged) review rows when the table will actually be shown --
  // i.e. a manual review, or an auto-approve that fell back to one. In the clean
  // direct-apply case the screen auto-approves and closes, so fetching a 50-row
  // page here would be a wasted round-trip; the progress uses the known rowCount.
  useEffect(() => { if (status === 'awaiting_review' && (!autoApprove || autoFellBack)) void loadRows() }, [filter, page, query, sort, status, autoApprove, autoFellBack]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveDecision = async (row: ReviewRow, choice: string) => {
    if (savingRow !== null) return
    setSavingRow(row.rowNumber)
    try {
      await updateImportJobDecisions(jobId, { [String(row.rowNumber)]: decisionFor(choice) })
      await loadRows()
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('import_decision_failed', 'Could not save this decision.'), 'error')
    } finally {
      setSavingRow(null)
    }
  }

  const confirm = async ({ auto = false }: { auto?: boolean } = {}) => {
    // Manual confirm keeps its client guard; auto-approve lets the server be the
    // authority (it 409s on unresolved conflicts), so it need not wait for the
    // review rows to have loaded first.
    if (!auto && unresolved > 0) {
      notify(tr('product_import_resolve_first', 'Resolve {n} flagged row(s) before importing.').replace('{n}', String(unresolved)), 'error')
      return
    }
    if (!beginSingleAction(approvalRef)) return
    setApproving(true)
    try {
      await approveImportJob(jobId, { source: 'products_modal' })
      if (!auto) notify(tr('import_approved_now', 'Confirmed — the import is applying now.'), 'success')
      await onApproved()
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      const httpStatus = (error as { status?: number } | null)?.status
      // Direct-apply hit real conflicts the client couldn't pre-resolve: drop to
      // the manual review table (no scary toast) so the operator can resolve
      // them, rather than silently applying a risky default.
      if (auto && (code === 'product_conflicts_unresolved' || httpStatus === 409)) {
        setAutoFellBack(true)
        await loadRows()
        return
      }
      notify(error instanceof Error ? error.message : tr('import_apply_failed', 'Could not approve import.'), 'error')
      await loadRows()
    } finally {
      finishSingleAction(approvalRef)
      setApproving(false)
    }
  }

  // Direct-apply mode: once the server finishes analysis (awaiting_review),
  // approve automatically. Fires once; `autoFellBack` disables it if the server
  // sent us back to the manual table.
  useEffect(() => {
    if (!autoApprove || autoFellBack) return
    if (status !== 'awaiting_review') return
    if (approvalRef.current || autoAttemptedRef.current) return
    autoAttemptedRef.current = true
    void confirm({ auto: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoApprove, autoFellBack])

  const summary = ['create', 'update', 'skip', 'error']
    .filter((key) => Number(counts[key] || 0) > 0)
    .map((key) => `${key}: ${Number(counts[key] || 0)}`)
    .join(' · ')

  // Direct-apply mode (no second review): show a single progress state while the
  // server analyzes and we auto-approve. The modal closes on onApproved, and the
  // apply runs in the background tracker. Skipped once autoFellBack flips true.
  if (autoApprove && !autoFellBack) {
    const terminal = ['failed', 'cancelled', 'completed', 'completed_with_errors'].includes(status)
    // What's being imported: the server's create/update breakdown once analysis
    // lands, else the row count the client already knows -- so the progress reads
    // "Importing 3 rows…" / "2 new · 1 update" instead of a bare spinner.
    const progressDetail = summary
      || (rowCount > 0 ? `${rowCount.toLocaleString()} ${tr('rows', 'rows')}` : '')
    return <div className="space-y-4 py-8 text-center">
      {!terminal ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--ui-accent)]" /> : <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />}
      <p className="text-sm font-semibold">{terminal ? tr('import_analysis_stopped', 'Import analysis stopped') : tr('import_applying_now', 'Importing…')}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{jobError || (terminal ? status : (progressDetail || tr('import_applying_hint', 'Applying your reviewed import. This closes when it starts.')))}</p>
      <div className="flex justify-center gap-2"><button type="button" className="btn-secondary text-sm" onClick={() => void onCancel()}>{tr('cancel_import', 'Cancel import')}</button><button type="button" className="btn-secondary text-sm" onClick={() => void onReviewLater()}>{tr('continue_in_background', 'Continue in background')}</button></div>
    </div>
  }

  if (status !== 'awaiting_review') {
    const terminal = ['failed', 'cancelled', 'completed', 'completed_with_errors'].includes(status)
    return <div className="space-y-4 py-8 text-center">
      {!terminal ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--ui-accent)]" /> : <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />}
      <p className="text-sm font-semibold">{terminal ? tr('import_analysis_stopped', 'Import analysis stopped') : tr('import_analyzing', 'Analyzing on the server…')}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{jobError || (terminal ? status : tr('import_analyzing_hint', 'The persisted review will open here when analysis finishes.'))}</p>
      <div className="flex justify-center gap-2"><button type="button" className="btn-secondary text-sm" onClick={() => void onCancel()}>{tr('cancel_import', 'Cancel import')}</button><button type="button" className="btn-secondary text-sm" onClick={() => void onReviewLater()}>{tr('continue_in_background', 'Continue in background')}</button></div>
    </div>
  }

  return <div className="space-y-4">
    <div><h3 className="text-sm font-semibold">{tr('import_review_title', 'Review before importing')} — Products</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{summary || tr('import_review_no_actions', 'No actionable rows were found.')}</p></div>
    {unresolved > 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"><strong>{unresolved} flagged row(s) still need a decision.</strong> Barcode/SKU collisions stay separate by default; negative stock becomes 0. Confirm that safe result or skip the row.</div> : null}
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <label className="relative block"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder={tr('search_rows', 'Search rows')} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" /></label>
      <AppSelect value={filter} onChange={(value) => { setFilter(value); setPage(1) }} ariaLabel="Filter rows" buttonClassName="w-full px-2.5 py-2 text-sm" options={[{ value: 'all', label: 'All' }, { value: 'create', label: 'Create' }, { value: 'update', label: 'Update' }, { value: 'skip', label: 'Skip' }, { value: 'error', label: 'Errors' }]} />
      <AppSelect value={sort} onChange={(value) => { setSort(value); setPage(1) }} ariaLabel="Sort rows" buttonClassName="w-full px-2.5 py-2 text-sm" options={[{ value: 'row_asc', label: 'First–last' }, { value: 'row_desc', label: 'Last–first' }, { value: 'name_asc', label: 'Name A–Z' }, { value: 'name_desc', label: 'Name Z–A' }]} />
    </div>
    <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
      {loadingRows ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : rows.length ? <table className="w-full min-w-[48rem] text-left text-xs"><thead className="sticky top-0 bg-slate-50 dark:bg-slate-800"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Server preview</th><th className="px-3 py-2">Details</th><th className="px-3 py-2">Decision</th></tr></thead><tbody>{rows.map((row) => {
        const requiresDecision = choiceFor(row) === 'needs_decision'
        const collision = (row.warnings || []).some((warning) => ['barcode_collision', 'sku_collision'].includes(String(warning.kind || '')))
        const applyLabel = collision ? 'Create separate product (safe)' : row.action === 'create' ? 'Create product' : 'Use server preview'
        const options = [
          ...(requiresDecision ? [{ value: 'needs_decision', label: 'Choose a safe result…', disabled: true }] : []),
          { value: 'apply', label: applyLabel },
          { value: 'skip', label: 'Skip row' },
        ]
        if (row.action === 'update') options.splice(1, 0, { value: 'merge_stock', label: 'Stock only' }, { value: 'override_add', label: 'Update + add stock' }, { value: 'override_replace', label: 'Update details; keep stock' })
        return <tr key={row.rowNumber} className="border-t border-slate-100 align-top dark:border-slate-800"><td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2 font-medium">{row.identifier || String(row.data?.name || '—')}<div className="mt-0.5 font-normal text-slate-400">{String(row.data?.barcode || row.data?.sku || '')}</div></td><td className="px-3 py-2">{row.action}</td><td className="max-w-sm px-3 py-2 text-slate-500 dark:text-slate-400">{row.message || (row.warnings || []).map((warning) => warning.message).filter(Boolean).join(' · ') || '—'}</td><td className="w-52 px-3 py-2"><AppSelect value={choiceFor(row)} onChange={(value) => void saveDecision(row, value)} ariaLabel={`Decision for row ${row.rowNumber}`} buttonClassName="w-full px-2 py-1.5 text-xs" options={options} disabled={savingRow !== null} /></td></tr>
      })}</tbody></table> : <div className="p-8 text-center text-sm text-slate-500">No matching rows.</div>}
    </div>
    <div className="flex justify-center"><PaginationControls compact rangeAsPageSize page={page} pageSize={PAGE_SIZE} totalItems={total} label="records" onPageChange={setPage} /></div>
    {jobError ? <p className="text-xs text-red-600 dark:text-red-400">{jobError}</p> : null}
    <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 pb-5 pt-3 dark:border-slate-800 dark:bg-slate-900"><button type="button" className="btn-secondary" disabled={approving} onClick={() => void onReviewLater()}>Review later</button><button type="button" className="btn-primary" disabled={approving || loadingRows || unresolved > 0} onClick={() => void confirm()}>{approving ? 'Approving…' : 'Confirm & import'}</button></div>
  </div>
}

export { choiceFor as restoreProductServerDecision, decisionFor as buildProductServerDecision }
