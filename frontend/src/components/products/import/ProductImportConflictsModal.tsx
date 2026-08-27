import { useEffect, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Modal from '../../shared/Modal'
import { getImportJobReview, updateImportJobDecisions } from '../../../api/importJobsTransport'

const PAGE_SIZE = 50
const WARNING_KINDS = 'negative_stock,barcode_collision,sku_collision'

type ReviewRow = {
  rowNumber: number
  action: string
  identifier?: string | null
  message?: string | null
  warnings?: Array<{ kind?: string; message?: string }>
  decision?: { action?: string } | null
  data?: Record<string, unknown>
}

type ReviewPayload = {
  rows?: ReviewRow[]
  total?: number
  unresolvedProductConflicts?: number
}

export default function ProductImportConflictsModal({ jobId, notify, onClose, onAllResolved }: {
  jobId: string | number
  notify: (message: string, tone?: string) => void
  onClose: () => void
  onAllResolved?: () => void
}) {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [total, setTotal] = useState(0)
  const [unresolved, setUnresolved] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingRow, setSavingRow] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const raw = await getImportJobReview(jobId, {
        page,
        pageSize: PAGE_SIZE,
        warningKind: WARNING_KINDS,
        query: query.trim() || undefined,
        sort: 'row_asc',
      }) as ReviewPayload | null
      setRows(Array.isArray(raw?.rows) ? raw.rows : [])
      setTotal(Math.max(0, Number(raw?.total) || 0))
      const remaining = Math.max(0, Number(raw?.unresolvedProductConflicts) || 0)
      setUnresolved(remaining)
      if (remaining === 0) onAllResolved?.()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load product conflicts.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [jobId, page, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (rowNumber: number, action: 'apply' | 'skip') => {
    if (savingRow !== null) return
    setSavingRow(rowNumber)
    try {
      await updateImportJobDecisions(jobId, { [String(rowNumber)]: { action } })
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save this decision.', 'error')
    } finally {
      setSavingRow(null)
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <Modal title="Resolve product import conflicts" onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Choose what happens for every barcode, SKU, or negative-stock warning. <strong>Use safe result</strong> keeps the server preview (a colliding identifier stays a separate product; negative stock becomes 0). <strong>Skip row</strong> makes no change for that row.</p></div>
          <p className="mt-2 font-semibold">{unresolved} unresolved of {total} flagged rows</p>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Search product, barcode, or SKU" />
        </label>
        <div className="max-h-[30rem] space-y-2 overflow-auto">
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : rows.length ? rows.map((row) => {
            const choice = String(row.decision?.action || '')
            const details = row.message || (row.warnings || []).map((warning) => warning.message).filter(Boolean).join(' · ')
            return <div key={row.rowNumber} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0"><p className="text-sm font-semibold">Row {row.rowNumber}: {row.identifier || String(row.data?.name || 'Unnamed product')}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{details || 'Review required'}</p></div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={choice === 'apply' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} disabled={savingRow !== null} onClick={() => void decide(row.rowNumber, 'apply')}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Use safe result</button>
                  <button type="button" className={choice === 'skip' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} disabled={savingRow !== null} onClick={() => void decide(row.rowNumber, 'skip')}>Skip row</button>
                </div>
              </div>
            </div>
          }) : <p className="p-8 text-center text-sm text-slate-500">No matching unresolved or reviewed product conflicts.</p>}
        </div>
        {total > PAGE_SIZE ? <div className="flex items-center justify-between text-xs text-slate-500"><span>Page {page} of {pages}</span><div className="flex gap-2"><button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div> : null}
        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800"><button type="button" className="btn-secondary" onClick={onClose}>Done reviewing</button></div>
      </div>
    </Modal>
  )
}
