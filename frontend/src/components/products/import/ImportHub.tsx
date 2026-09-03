import { useMemo, useRef, useState } from 'react'
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js'
import AppSelect from '../../shared/AppSelect.tsx'
import InfoHint from '../../shared/InfoHint.tsx'
import { parseImportFile } from '../../../utils/spreadsheetImport.ts'
import { classifyImportContent, DEFERRED_LEDGER_INFO, type DeferredLedgerKind, type DetectedImportType } from './importTemplateRouter.ts'
import { parseCsvRows } from '../../../utils/csvImport.ts'
import { createImportJob, uploadImportJobCsv, startImportJob } from '../../../api/importJobsTransport.ts'

// N1c: the ONE import entry point. Drop one file or many -- each is
// classified by its real header shape (importTemplateRouter) and shown in
// a routing plan the operator can override per file -- then every file is
// dispatched into the SAME job pipeline every importer already uses
// (create -> upload csv -> start analyze; §13's two-screen contract, no
// new commit paths). The queued jobs are siblings in the shared import
// tracker, where each is reviewed and approved exactly like a job started
// from its own page. Volume never forces a split: stock files ride the M4
// continuation engine, and the §12 supplier column comes along untouched.

type TranslateFn = (key: string, fallback?: string, km?: string) => string

type PlanEntry = {
  file: File
  name: string
  content: string
  rowCount: number
  detected: DetectedImportType
  signals: string[]
  deferredLedger?: DeferredLedgerKind
  chosen: DetectedImportType | 'skip'
  status: 'planned' | 'creating' | 'uploading' | 'queued' | 'error'
  jobId?: string | number
  error?: string
}

const TYPE_LABELS: Record<DetectedImportType, { key: string; fallback: string }> = {
  products: { key: 'import_hub_type_products', fallback: 'Products (catalog / stock)' },
  stock_actions: { key: 'import_hub_type_stock', fallback: 'Stock actions (add / sale / reconcile)' },
  sales: { key: 'import_hub_type_sales', fallback: 'Sales history' },
  customers: { key: 'import_hub_type_customers', fallback: 'Customers' },
  suppliers: { key: 'import_hub_type_suppliers', fallback: 'Suppliers' },
  delivery_contacts: { key: 'import_hub_type_delivery', fallback: 'Delivery contacts' },
  deferred_ledger: { key: 'import_hub_type_deferred', fallback: 'Old-system ledger — kept aside' },
  unknown: { key: 'import_hub_type_unknown', fallback: 'Unknown — choose' },
}

function defaultPolicyFor(type: DetectedImportType, accrueLoyalty: boolean): Record<string, unknown> {
  if (type === 'sales') return { source: 'import_hub', accrue_loyalty: accrueLoyalty }
  if (type === 'customers' || type === 'suppliers' || type === 'delivery_contacts') {
    // The contacts importer's own default: merge into phone-matched
    // existing contacts rather than duplicating or skipping.
    return { source: 'import_hub', conflictMode: 'merge' }
  }
  return { source: 'import_hub' }
}

export default function ImportHub({
  t,
  onUseClassic,
  onClose,
}: {
  t: TranslateFn
  onUseClassic: () => void
  onClose: () => void
}) {
  const [plan, setPlan] = useState<PlanEntry[]>([])
  const [reading, setReading] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [done, setDone] = useState(false)
  const [accrueLoyalty, setAccrueLoyalty] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const T = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const addFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files || [])
    if (!list.length) return
    setReading(true)
    try {
      const entries: PlanEntry[] = []
      for (const file of list) {
        try {
          const parsed = await parseImportFile(file)
          const detection = classifyImportContent(parsed.content)
          const rowCount = Math.max(0, parsed.content.split(/\r?\n/).filter((line) => line.trim()).length - 1)
          entries.push({
            file, name: file.name, content: parsed.content, rowCount,
            detected: detection.type, signals: detection.signals,
            deferredLedger: detection.deferredLedger,
            // Deferred ledgers are locked to skip -- their data either has no
            // destination feature yet or is already counted in the live
            // tables, so no override control renders for them below.
            chosen: detection.type === 'unknown' || detection.type === 'deferred_ledger' ? 'skip' : detection.type,
            status: 'planned',
          })
        } catch (error) {
          entries.push({
            file, name: file.name, content: '', rowCount: 0,
            detected: 'unknown', signals: [], chosen: 'skip',
            status: 'error', error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      setPlan((previous) => [...previous, ...entries])
    } finally {
      setReading(false)
    }
  }

  const dispatchAll = async () => {
    if (dispatching) return
    setDispatching(true)
    try {
      // Sequential on purpose: each job's create+upload+start is cheap,
      // and one-at-a-time keeps failures attributable to their file.
      for (let index = 0; index < plan.length; index++) {
        const entry = plan[index]
        if (entry.chosen === 'skip' || entry.detected === 'deferred_ledger' || entry.status === 'queued' || entry.status === 'error') continue
        const update = (patch: Partial<PlanEntry>) => setPlan((previous) => previous.map((row, i) => i === index ? { ...row, ...patch } : row))
        try {
          update({ status: 'creating' })
          const created = await createImportJob({
            type: entry.chosen,
            // Direct-apply: the routed files were already reviewed here on the
            // hub, so flag each job to auto-approve once the server finishes
            // analysis. The tracker fires the approve; genuine conflicts still
            // route to their review/merge screen instead of applying blindly.
            policy: { ...defaultPolicyFor(entry.chosen, accrueLoyalty), auto_approve: true },
          }) as { job?: { id?: string | number }; id?: string | number }
          const jobId = created?.job?.id ?? created?.id
          if (!jobId) throw new Error(T('import_hub_job_failed', 'Import job was not created'))
          update({ status: 'uploading', jobId })
          await uploadImportJobCsv({ jobId, text: entry.content, fileName: entry.name })
          await startImportJob(jobId)
          update({ status: 'queued' })
        } catch (error) {
          update({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }
      setDone(true)
    } finally {
      setDispatching(false)
    }
  }

  const queuedCount = plan.filter((entry) => entry.status === 'queued').length
  const actionable = plan.some((entry) => entry.chosen !== 'skip' && entry.status === 'planned')
  const hasSales = plan.some((entry) => entry.chosen === 'sales' && entry.status !== 'queued')

  // Review before importing: a few rows of each routed file so the operator can
  // sanity-check the data (and that it routed to the right type) before queueing
  // -- the same "see the rows first" the classic Add screen shows. Only the first
  // lines are parsed, so this stays cheap no matter how large the file is.
  const previews = useMemo(() => plan.map((entry) => {
    try {
      const head = String(entry.content || '').split(/\r?\n/).slice(0, 4).join('\n')
      const rows = parseCsvRows(head).slice(0, 3)
      return { rows, columns: rows.length ? Object.keys(rows[0]) : [] }
    } catch {
      return { rows: [] as Record<string, string | number>[], columns: [] as string[] }
    }
  }), [plan])

  // Title + how-it-works InfoHint moved into the shared Modal header the
  // wizard now wraps this in (ImportModeWizard.tsx) -- this component
  // renders body content only.
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-[var(--ui-accent)] p-6 text-center transition-colors"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer?.files || null) }}
      >
        <UploadCloud className="w-8 h-8 mx-auto text-gray-400" />
        <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          {reading ? (T('import_hub_reading', 'Reading files…')) : T('import_hub_drop', 'Drop CSV / Excel files, or click to choose')}
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.tsv,.txt"
        multiple
        className="hidden"
        onChange={(event) => { void addFiles(event.target.files); event.target.value = '' }}
      />

      {plan.length > 0 ? (
        <div className="space-y-2">
          {plan.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              {/* min-w-0 flex-1 on the name: a flex item won't shrink below
                  its content without it, so a long file name pushed the row
                  count and status out of the row on phone widths instead of
                  truncating. */}
              <div className="flex items-center gap-2 flex-wrap">
                <FileSpreadsheet className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="min-w-0 flex-1 text-sm font-medium truncate">{entry.name}</span>
                <span className="shrink-0 whitespace-nowrap text-xs text-gray-400">{entry.rowCount} {T('import_hub_rows', 'rows')}</span>
                <span className={`ml-auto shrink-0 text-xs font-semibold ${
                  entry.status === 'queued' ? 'text-emerald-600'
                  : entry.status === 'error' ? 'text-red-600'
                  : entry.status === 'planned' ? 'text-gray-400'
                  : 'text-[var(--ui-accent-ink)]'
                }`}>
                  {entry.status === 'planned' ? ''
                    : entry.status === 'creating' ? T('import_hub_creating', 'creating job…')
                    : entry.status === 'uploading' ? T('import_hub_uploading', 'uploading…')
                    : entry.status === 'queued' ? T('import_hub_queued', 'queued for review')
                    : (entry.error || T('import_failed', 'Import failed'))}
                </span>
              </div>
              {entry.detected === 'deferred_ledger' ? (
                <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    {T(`import_hub_ledger_${entry.deferredLedger}`, DEFERRED_LEDGER_INFO[entry.deferredLedger || 'po_invoices'].label)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {T('import_hub_ledger_kept_aside', '— kept aside, needs its own feature first')}
                  </span>
                  <InfoHint
                    label={T('import_hub_ledger_why', 'Why this file is not imported')}
                    text={T(`import_hub_ledger_${entry.deferredLedger}_why`, DEFERRED_LEDGER_INFO[entry.deferredLedger || 'po_invoices'].reason)}
                  />
                </div>
              ) : (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <div className="min-w-[16rem]">
                  <AppSelect
                    value={entry.chosen}
                    onChange={(value: string) => setPlan((previous) => previous.map((row, i) => i === index ? { ...row, chosen: value as PlanEntry['chosen'] } : row))}
                    options={[
                      ...(['products', 'stock_actions', 'sales', 'customers', 'suppliers', 'delivery_contacts'] as const).map((type) => ({
                        value: type,
                        label: T(TYPE_LABELS[type].key, TYPE_LABELS[type].fallback),
                      })),
                      { value: 'skip', label: T('import_hub_skip', 'Skip this file') },
                    ]}
                  />
                </div>
                {entry.detected !== 'unknown' ? (
                  <span className="text-[11px] text-gray-400">
                    {T('import_hub_detected_by', 'detected by')}: {entry.signals.join(', ') || entry.detected}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600">
                    {T('import_hub_unrecognized', 'Columns not recognized — choose the import type or skip')}
                  </span>
                )}
              </div>
              )}
              {previews[index]?.rows.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-[11px] font-medium text-[var(--ui-accent-ink)]">
                    {T('import_hub_preview_rows', 'Preview rows')}
                  </summary>
                  <div className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                        <tr>
                          {previews[index].columns.map((col) => (
                            <th key={col} className="whitespace-nowrap px-2 py-1 font-medium text-slate-500 dark:text-slate-400">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previews[index].rows.map((row, r) => (
                          <tr key={r} className="border-t border-gray-100 dark:border-gray-800">
                            {previews[index].columns.map((col) => (
                              <td key={col} className="whitespace-nowrap px-2 py-1 text-slate-600 dark:text-slate-300">{String(row[col] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </div>
          ))}

          {hasSales ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3 text-xs">
              <label className="flex cursor-pointer items-center gap-2 text-amber-800 dark:text-amber-200">
                <input type="checkbox" checked={accrueLoyalty} onChange={(event) => setAccrueLoyalty(event.target.checked)} />
                {T('sales_import_accrue_loyalty', 'Count loyalty points for these sales')}
              </label>
              <InfoHint
                label={T('sales_import_accrue_loyalty', 'Count loyalty points for these sales')}
                text={T('import_hub_loyalty_note', '— leave OFF for historical sales: balances are computed by summing sales, so old receipts would inflate them.').replace(/^—\s*/, '')}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline" onClick={onUseClassic}>
          {T('import_hub_classic', 'Use the classic import screens')}
        </button>
        <div className="flex items-center gap-2">
          {done && queuedCount > 0 ? (
            <span className="text-xs text-emerald-600 font-medium">
              {queuedCount} {T('import_hub_done', 'import(s) applying in the background — conflicts pause in the import tracker')}
            </span>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={dispatching}>
            {T('close', 'Close')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void dispatchAll()} disabled={!actionable || dispatching || reading}>
            {dispatching ? T('import_hub_dispatching', 'Queueing…') : T('import_hub_start', 'Queue the imports')}
          </button>
        </div>
      </div>
    </div>
  )
}
