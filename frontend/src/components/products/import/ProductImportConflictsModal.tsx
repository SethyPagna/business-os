// The product-import counterpart of contacts/ContactImportConflictsModal:
// same backend machinery (GET /import-jobs/:id/review, PATCH /:id/decisions),
// same lazy mount from BackgroundImportTracker, and -- since the
// import-review audit -- the same i18n contract.
//
// Every operator-visible string here used to be an English literal baked
// into the JSX with no t() anywhere in the file, so Khmer mode showed an
// English conflict-resolution screen. verify:i18n could not see it: a
// string that never looks a key up references no key to be missing. The
// key family below deliberately mirrors the sibling's
// contacts_import_conflicts_* names, and productImportReviewSurfaces.test.ts
// pins both the lookups and the pack entries.
import { useEffect, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Modal from '../../shared/Modal'
import ScanSearchButton from '../../shared/ScanSearchButton.tsx'
import { getImportJobReview, updateImportJobDecisions } from '../../../api/importJobsTransport'
import PaginationControls from '../../shared/PaginationControls'

const PAGE_SIZE = 50
const WARNING_KINDS = 'negative_stock,barcode_collision,sku_collision'

type TranslateFn = (key: string) => string | undefined

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

export default function ProductImportConflictsModal({ jobId, t, notify, onClose, onAllResolved }: {
  jobId: string | number
  t?: TranslateFn
  notify: (message: string, tone?: string) => void
  onClose: () => void
  onAllResolved?: () => void
}) {
  const tr = (key: string, fallbackEn: string): string => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallbackEn
  }
  // ScanSearchButton asks for its own labels by key; route them through the
  // same tr so the scanner button is translated with everything else
  // instead of rendering a hardcoded English word.
  const scannerText = (key: string): string => tr(key, key === 'scan_barcode' ? 'Scan Barcode' : key)
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
      notify(error instanceof Error ? error.message : tr('products_import_conflicts_load_failed', 'Could not load product conflicts.'), 'error')
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
      notify(error instanceof Error ? error.message : tr('products_import_conflicts_save_failed', 'Could not save this decision.'), 'error')
    } finally {
      setSavingRow(null)
    }
  }

  const applyLabel = tr('products_import_conflicts_apply', 'Use safe result')
  const skipLabel = tr('products_import_conflicts_skip', 'Skip row')

  return (
    <Modal title={tr('products_import_conflicts_title', 'Resolve product import conflicts')} onClose={onClose} size="xl" unsavedChanges="read-only">
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          {/* Each decision's explanation follows its own button label in
              bold, so the two sentence halves are separate keys rather than
              one string carrying markup a translator cannot keep intact. */}
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>
            {tr('products_import_conflicts_intro', 'Choose what happens for every barcode, SKU, or negative-stock warning.')}{' '}
            <strong>{applyLabel}</strong>{' '}
            {tr('products_import_conflicts_intro_apply', 'keeps the server preview (a colliding identifier stays a separate product; negative stock becomes 0).')}{' '}
            <strong>{skipLabel}</strong>{' '}
            {tr('products_import_conflicts_intro_skip', 'makes no change for that row.')}
          </p></div>
          <p className="mt-2 font-semibold">
            {tr('products_import_conflicts_remaining', '{count} unresolved of {total} flagged rows')
              .replace('{count}', String(unresolved))
              .replace('{total}', String(total))}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder={tr('products_import_conflicts_search', 'Search product, barcode, or SKU')} />
          </label>
          <ScanSearchButton onDetected={(value) => { setQuery(value); setPage(1) }} t={scannerText} />
        </div>
        <div className="max-h-[30rem] space-y-2 overflow-auto">
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : rows.length ? rows.map((row) => {
            const choice = String(row.decision?.action || '')
            const details = row.message || (row.warnings || []).map((warning) => warning.message).filter(Boolean).join(' · ')
            const rowName = row.identifier || String(row.data?.name || tr('products_import_conflicts_unnamed', 'Unnamed product'))
            return <div key={row.rowNumber} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0"><p className="text-sm font-semibold">{tr('products_import_conflicts_row', 'Row {row}: {name}').replace('{row}', String(row.rowNumber)).replace('{name}', rowName)}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{details || tr('products_import_conflicts_review_required', 'Review required')}</p></div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={choice === 'apply' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} disabled={savingRow !== null} onClick={() => void decide(row.rowNumber, 'apply')}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{applyLabel}</button>
                  <button type="button" className={choice === 'skip' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} disabled={savingRow !== null} onClick={() => void decide(row.rowNumber, 'skip')}>{skipLabel}</button>
                </div>
              </div>
            </div>
          }) : <p className="p-8 text-center text-sm text-slate-500">{tr('products_import_conflicts_no_matches', 'No matching unresolved or reviewed product conflicts.')}</p>}
        </div>
        <div className="flex justify-center"><PaginationControls compact rangeAsPageSize page={page} pageSize={PAGE_SIZE} totalItems={total} label={tr('records', 'records')} t={t} onPageChange={setPage} /></div>
        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800"><button type="button" className="btn-secondary" onClick={onClose}>{tr('products_import_conflicts_done', 'Done reviewing')}</button></div>
      </div>
    </Modal>
  )
}
