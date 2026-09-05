// Frontend review UI for the dated stock-reconciliation import -- the two
// pieces progress.md's own "Not done -- still open" list has flagged since
// Part 290/291: (1) the CSV/XLSX column-mapping step and (2) the
// step-by-step review screen that calls /resolve, renders `unresolved`'s
// suggestedActions/priceConflict as real choices, collects a `decisions`
// array, and calls /resolve/apply-decisions, then feeds the combined
// resolved list into the already-built /preview and /apply endpoints.
//
// Launched from ImportModeWizard once "Dated Stock Reconciliation" is
// picked as the General sub-option and its template screen is confirmed --
// same launch pattern that sub-option's sibling ('Add / Update Products')
// already uses to hand off to BulkImportModal. Mode is locked from here on:
// there is no way back into ImportModeWizard's mode/sub-option/template
// screens from inside this component -- Back at the file-upload step closes
// the whole flow (same as the legacy modal today), and Back from the
// mapping or review step drops the uploaded file and returns to the upload
// step, never further back than that -- per the user's own instruction this
// session ("can no longer choose and change mode as we already uploaded the
// import... has to press back which cancels the uploaded file and
// restarts").
import { useMemo, useState } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import UploadIcon from 'lucide-react/dist/esm/icons/upload.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Modal from '../../shared/Modal'
import AppSelect, { type AppSelectOption } from '../../shared/AppSelect.tsx'
import { openCSVDialog } from '../../../api/browserDialogs.ts'
import { parseCsvRows } from '../../../utils/csvImport.ts'
import {
  TARGET_FIELDS,
  autoMapHeaders,
} from './datedStockReconciliationMapping.ts'
import {
  resolveDatedStockCountRows as apiResolveRows,
  applyDatedStockCountDecisions as apiApplyDecisions,
  previewDatedStockCount as apiPreview,
  applyDatedStockCount as apiApply,
} from '../../../api/methods.ts'

type TranslateFn = (key: string, fallback?: string, km?: string) => string
type EntityId = string | number

interface ProductOption { id?: EntityId; name?: string | null }
interface BranchOption { id: EntityId; name?: string | null }

interface DatedStockReconciliationModalProps {
  onClose: () => void
  onDone: () => void
  t: TranslateFn
  products?: ProductOption[]
}

type Step = 'upload' | 'mapping' | 'resolving' | 'review' | 'applying_decisions' | 'plan' | 'applying' | 'done'

// Target fields this import can use, in the order shown on the mapping
// screen. Mirrors lib/datedStockCountResolve.ts's own RawDatedCountRow
// shape exactly -- these are the only fields that backend understands.
// (Kept here as a re-export for anything already importing it from this
// module; the canonical definition now lives in
// datedStockReconciliationMapping.ts alongside autoMapHeaders, since a
// plain node test script can't parse this file's JSX to import from it
// directly -- see that file's own test, datedStockReconciliationModal.test.ts.)
export { TARGET_FIELDS }

interface RawRowForApi {
  rowNumber: number
  date: string
  branchName: string
  sku?: string | null
  barcode?: string | null
  productName?: string | null
  count: number
  sellingPriceUsd?: number | null
  sellingPriceKhr?: number | null
}

interface PriceConflict {
  currentUsd: number
  currentKhr: number
  importedUsd: number | null
  importedKhr: number | null
  suggestedResolution: 'merge' | 'apply_new'
}

interface ResolvedRow {
  rowNumber: number
  date: string
  productId: number
  branchId: number
  count: number
  priceConflict?: PriceConflict
}

interface UnresolvedRow {
  rowNumber: number
  reason: string
  raw: RawRowForApi
  branchId?: number
  suggestedActions: string[]
  candidateProductIds?: number[]
}

type DecisionAction = 'create_new' | 'link_variant' | 'create_child' | 'skip'

interface RowDecisionState {
  action: DecisionAction | ''
  candidateProductId?: number
  priceResolution?: 'merge' | 'apply_new'
}

interface PlanMovement {
  productId: number
  productName: string
  branchId: number
  branchName: string
  date: string
  quantity: number
  movementType: 'add' | 'remove'
  reason: string
}

const REASON_LABEL: Record<string, string> = {
  invalid_date: 'Invalid or missing date',
  invalid_count: 'Invalid or missing count',
  missing_branch: 'Missing branch',
  missing_identifier: 'No product name, SKU, or barcode given',
  product_not_found: 'No matching product found',
  ambiguous_barcode: 'Multiple products share this barcode',
  ambiguous_name: 'Multiple products share this name',
}

const ACTION_LABEL: Record<string, string> = {
  create_new: 'Create as a new, standalone product',
  link_variant: 'Link this count to an existing product',
  create_child: "Create as a child row (keeps the linked product's name)",
  skip: "Skip this row -- don't import it",
}

export default function DatedStockReconciliationModal({ onClose, onDone, t, products = [] }: DatedStockReconciliationModalProps) {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const productNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of products) {
      const id = Number(p?.id)
      if (Number.isFinite(id)) map.set(id, String(p?.name || `#${id}`))
    }
    return map
  }, [products])

  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState('')

  // ---- upload ----
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [uploading, setUploading] = useState(false)

  // ---- mapping ----
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})

  // ---- resolve result ----
  const [resolved, setResolved] = useState<ResolvedRow[]>([])
  const [unresolved, setUnresolved] = useState<UnresolvedRow[]>([])
  const [branchesCreated, setBranchesCreated] = useState<string[]>([])

  // ---- review decisions ----
  const [decisions, setDecisions] = useState<Record<number, RowDecisionState>>({})
  const [priceDecisions, setPriceDecisions] = useState<Record<number, 'merge' | 'apply_new'>>({})

  // ---- apply-decisions + preview result ----
  const [combinedResolved, setCombinedResolved] = useState<ResolvedRow[]>([])
  const [applyErrors, setApplyErrors] = useState<{ rowNumber: number; error: string }[]>([])
  const [plan, setPlan] = useState<{ movementsToCreate: PlanMovement[] } | null>(null)
  const [working, setWorking] = useState(false)

  async function pickFile(): Promise<void> {
    setError('')
    setUploading(true)
    try {
      const result = await openCSVDialog()
      if (!result) { setUploading(false); return }
      const rows = parseCsvRows(result.content)
      if (!rows.length) {
        setError(T('dated_count_empty_file', 'That file has no data rows.'))
        setUploading(false)
        return
      }
      const detectedHeaders = Object.keys(rows[0])
      setFileName(result.name)
      setCsvText(result.content)
      setHeaders(detectedHeaders)
      setMapping(autoMapHeaders(detectedHeaders))
      setStep('mapping')
    } catch (e) {
      setError(e instanceof Error ? e.message : T('dated_count_read_failed', 'Could not read that file.'))
    } finally {
      setUploading(false)
    }
  }

  // Back from mapping/review always restarts at upload -- the mode itself
  // (this whole component) is locked in from ImportModeWizard, and per the
  // user's own instruction a change of heart on the FILE means starting
  // over, not editing the mapping of a file that's already been resolved
  // against the database.
  function restartUpload(): void {
    setFileName('')
    setCsvText('')
    setHeaders([])
    setMapping({})
    setResolved([])
    setUnresolved([])
    setBranchesCreated([])
    setDecisions({})
    setPriceDecisions({})
    setCombinedResolved([])
    setApplyErrors([])
    setPlan(null)
    setError('')
    setStep('upload')
  }

  const mappingRows = useMemo(() => (csvText ? parseCsvRows(csvText) : []), [csvText])
  const mappingComplete = mapping.date && mapping.branchName && mapping.count
    && (mapping.productName || mapping.sku || mapping.barcode)

  async function runResolve(): Promise<void> {
    if (!mappingComplete) return
    setError('')
    setStep('resolving')
    try {
      const rows: RawRowForApi[] = mappingRows.map((row, index) => ({
        rowNumber: index + 1,
        date: String(mapping.date ? row[mapping.date] ?? '' : ''),
        branchName: String(mapping.branchName ? row[mapping.branchName] ?? '' : ''),
        sku: mapping.sku ? String(row[mapping.sku] ?? '').trim() || null : null,
        barcode: mapping.barcode ? String(row[mapping.barcode] ?? '').trim() || null : null,
        productName: mapping.productName ? String(row[mapping.productName] ?? '').trim() || null : null,
        count: Number(mapping.count ? row[mapping.count] : NaN),
        sellingPriceUsd: mapping.sellingPriceUsd && String(row[mapping.sellingPriceUsd] ?? '').trim() !== ''
          ? Number(row[mapping.sellingPriceUsd]) : undefined,
        sellingPriceKhr: mapping.sellingPriceKhr && String(row[mapping.sellingPriceKhr] ?? '').trim() !== ''
          ? Number(row[mapping.sellingPriceKhr]) : undefined,
      }))
      const result = await apiResolveRows(rows) as {
        success?: boolean; error?: string
        resolved?: ResolvedRow[]; unresolved?: UnresolvedRow[]; branchesCreated?: string[]
      } | null
      if (!result || result.success === false) {
        setError(result?.error || T('dated_count_resolve_failed', 'Could not analyze this file.'))
        setStep('mapping')
        return
      }
      setResolved(result.resolved || [])
      setUnresolved(result.unresolved || [])
      setBranchesCreated(result.branchesCreated || [])
      // Sensible defaults so a row with only one real choice doesn't force
      // an extra click: single-candidate rows default to that candidate;
      // price conflicts default to the backend's own suggestion.
      const initialDecisions: Record<number, RowDecisionState> = {}
      for (const row of result.unresolved || []) {
        const candidates = row.candidateProductIds || []
        initialDecisions[row.rowNumber] = {
          action: row.suggestedActions?.length === 1 ? (row.suggestedActions[0] as DecisionAction) : '',
          candidateProductId: candidates.length === 1 ? candidates[0] : undefined,
        }
      }
      setDecisions(initialDecisions)
      const initialPriceDecisions: Record<number, 'merge' | 'apply_new'> = {}
      for (const row of result.resolved || []) {
        if (row.priceConflict) initialPriceDecisions[row.rowNumber] = row.priceConflict.suggestedResolution
      }
      setPriceDecisions(initialPriceDecisions)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : T('dated_count_resolve_failed', 'Could not analyze this file.'))
      setStep('mapping')
    }
  }

  const reviewComplete = unresolved.every((row) => {
    if (row.suggestedActions.length === 0) return true // surfaces as an error either way, nothing to pick
    const decision = decisions[row.rowNumber]
    if (!decision || !decision.action) return false
    if (decision.action === 'skip') return true
    if (decision.action === 'create_new') return true
    return decision.candidateProductId != null
  })

  async function runApplyDecisions(): Promise<void> {
    if (!reviewComplete) return
    setError('')
    setStep('applying_decisions')
    setWorking(true)
    try {
      // Fold this screen's price-conflict choices back onto the resolved
      // rows as `decisions` entries too -- apply-decisions reads
      // priceResolution off the SAME decisions array for both resolved-row
      // price conflicts and unresolved-row actions.
      const decisionList = [
        ...Object.entries(priceDecisions).map(([rowNumber, priceResolution]) => ({ rowNumber: Number(rowNumber), action: 'skip' as const, priceResolution })),
        ...Object.entries(decisions)
          .filter(([, d]) => d.action)
          .map(([rowNumber, d]) => ({
            rowNumber: Number(rowNumber),
            action: d.action as DecisionAction,
            candidateProductId: d.candidateProductId,
          })),
      ]
      const result = await apiApplyDecisions({ resolved, unresolved, decisions: decisionList }) as {
        success?: boolean; error?: string
        resolved?: ResolvedRow[]; errors?: { rowNumber: number; error: string }[]
      } | null
      if (!result || result.success === false) {
        setError(result?.error || T('dated_count_apply_decisions_failed', 'Could not apply those decisions.'))
        setStep('review')
        return
      }
      setCombinedResolved(result.resolved || [])
      setApplyErrors(result.errors || [])
      if (!(result.resolved || []).length) {
        setError(T('dated_count_nothing_to_import', 'Nothing left to import after those decisions.'))
        setStep('review')
        return
      }
      const entries = (result.resolved || []).map((row) => ({ date: row.date, productId: row.productId, branchId: row.branchId, count: row.count }))
      const previewResult = await apiPreview(entries) as { success?: boolean; error?: string; plan?: { movementsToCreate: PlanMovement[] } } | null
      if (!previewResult || previewResult.success === false || !previewResult.plan) {
        setError(previewResult?.error || T('dated_count_preview_failed', 'Could not build a preview for this import.'))
        setStep('review')
        return
      }
      setPlan(previewResult.plan)
      setStep('plan')
    } catch (e) {
      setError(e instanceof Error ? e.message : T('dated_count_apply_decisions_failed', 'Could not apply those decisions.'))
      setStep('review')
    } finally {
      setWorking(false)
    }
  }

  async function runApply(): Promise<void> {
    setError('')
    setWorking(true)
    setStep('applying')
    try {
      const entries = combinedResolved.map((row) => ({ date: row.date, productId: row.productId, branchId: row.branchId, count: row.count }))
      const result = await apiApply(entries) as { success?: boolean; error?: string } | null
      if (!result || result.success === false) {
        setError(result?.error || T('dated_count_apply_failed', 'The import failed to apply.'))
        setStep('plan')
        return
      }
      setStep('done')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : T('dated_count_apply_failed', 'The import failed to apply.'))
      setStep('plan')
    } finally {
      setWorking(false)
    }
  }

  function updateDecision(rowNumber: number, patch: Partial<RowDecisionState>): void {
    setDecisions((current) => ({ ...current, [rowNumber]: { ...current[rowNumber], ...patch } }))
  }

  return (
    <Modal title={T('dated_stock_reconciliation_title', 'Dated Stock Reconciliation')} onClose={onClose} size="lg" draggable unsavedChanges={{ dirty: Boolean(csvText) }}>
      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {step === 'upload' ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            <p className="mb-1 font-semibold">{T('dated_count_upload_heading', 'Upload a dated stock-count file')}</p>
            <p className="text-xs">
              {T('dated_count_upload_body', 'CSV or Excel (.xlsx/.xls/.xlsm). You\'ll match this file\'s own column headers to the fields this import needs on the next screen -- headers don\'t need to match exactly.')}
            </p>
          </div>
          <button type="button" className="btn-primary flex w-full items-center justify-center gap-2 text-sm" onClick={() => void pickFile()} disabled={uploading}>
            <UploadIcon className="h-4 w-4" />
            {uploading ? T('dated_count_reading', 'Reading file...') : T('dated_count_choose_file', 'Choose File')}
          </button>
        </div>
      ) : null}

      {step === 'mapping' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{fileName}</span>
            <span>{T('dated_count_rows_detected', '{n} rows detected').replace('{n}', String(mappingRows.length))}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {T('dated_count_mapping_body', "Match each field this import needs to a column in your file. Fields marked required must be mapped; optional ones can be left as \"-- none --\".")}
          </p>
          <div className="space-y-2">
            {TARGET_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                <div className="w-40 shrink-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {field.label}{field.required ? ' *' : ''}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">{field.hint}</div>
                </div>
                <AppSelect
                  className="flex-1"
                  buttonClassName="input text-sm"
                  value={mapping[field.key] || ''}
                  options={[
                    { value: '', label: T('dated_count_none', '-- none --') },
                    ...headers.map((header): AppSelectOption => ({ value: header, label: header })),
                  ]}
                  onChange={(value) => setMapping((current) => ({ ...current, [field.key]: value }))}
                />
              </div>
            ))}
          </div>
          {!mappingComplete ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{T('dated_count_mapping_incomplete', 'Map date, branch, counted quantity, and at least one of product name/SKU/barcode to continue.')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'resolving' || step === 'applying_decisions' || step === 'applying' ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <span>
            {step === 'resolving' && T('dated_count_analyzing', 'Analyzing rows against your product catalog...')}
            {step === 'applying_decisions' && T('dated_count_applying_decisions', 'Applying decisions and building a preview...')}
            {step === 'applying' && T('dated_count_applying', 'Applying stock movements...')}
          </span>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-green-50 p-2 text-green-700 dark:bg-green-950/30 dark:text-green-300">
              <div className="text-lg font-semibold">{resolved.length}</div>
              {T('dated_count_matched_automatically', 'matched automatically')}
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <div className="text-lg font-semibold">{unresolved.length}</div>
              {T('dated_count_need_a_decision', 'need a decision')}
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <div className="text-lg font-semibold">{branchesCreated.length}</div>
              {T('dated_count_branches_created', 'branches created')}
            </div>
          </div>

          {resolved.filter((row) => row.priceConflict).length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{T('dated_count_price_conflicts', 'Price differences found')}</p>
              <div className="space-y-2">
                {resolved.filter((row) => row.priceConflict).map((row) => (
                  <div key={row.rowNumber} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-700">
                    <div className="mb-1.5 text-slate-600 dark:text-slate-300">
                      {T('dated_count_row', 'Row')} {row.rowNumber}: {T('dated_count_current_price', 'currently')} ${row.priceConflict!.currentUsd} / ៛{row.priceConflict!.currentKhr}
                      {' -- '}{T('dated_count_imported_price', 'file has')} ${row.priceConflict!.importedUsd ?? '-'} / ៛{row.priceConflict!.importedKhr ?? '-'}
                    </div>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`price-${row.rowNumber}`} checked={(priceDecisions[row.rowNumber] || 'merge') === 'merge'} onChange={() => setPriceDecisions((c) => ({ ...c, [row.rowNumber]: 'merge' }))} />
                        {T('dated_count_keep_current_price', 'Keep current price')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`price-${row.rowNumber}`} checked={priceDecisions[row.rowNumber] === 'apply_new'} onChange={() => setPriceDecisions((c) => ({ ...c, [row.rowNumber]: 'apply_new' }))} />
                        {T('dated_count_use_imported_price', 'Use imported price')}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {unresolved.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{T('dated_count_rows_needing_a_decision', 'Rows needing a decision')}</p>
              <div className="space-y-3">
                {unresolved.map((row) => {
                  const decision = decisions[row.rowNumber] || { action: '' as const }
                  const candidates = row.candidateProductIds || []
                  const noAction = row.suggestedActions.length === 0
                  return (
                    <div key={row.rowNumber} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
                      <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">
                        {T('dated_count_row', 'Row')} {row.rowNumber}: {row.raw.productName || row.raw.sku || row.raw.barcode || T('dated_count_unnamed_row', '(unnamed)')}
                      </div>
                      <div className="mb-2 text-slate-500 dark:text-slate-400">{REASON_LABEL[row.reason] || row.reason}</div>
                      {noAction ? (
                        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {T('dated_count_fix_source_data', 'This row needs the source data fixed and re-uploaded -- it will show as an error.')}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-3">
                            {[...row.suggestedActions, 'skip'].map((action) => (
                              <label key={action} className="flex items-center gap-1.5">
                                <input
                                  type="radio"
                                  name={`action-${row.rowNumber}`}
                                  checked={decision.action === action}
                                  onChange={() => updateDecision(row.rowNumber, { action: action as DecisionAction })}
                                />
                                {ACTION_LABEL[action] || action}
                              </label>
                            ))}
                          </div>
                          {(decision.action === 'link_variant' || decision.action === 'create_child') && candidates.length > 0 ? (
                            <AppSelect
                              className="w-full"
                              buttonClassName="input text-xs"
                              value={decision.candidateProductId ?? ''}
                              options={[
                                { value: '', label: T('dated_count_choose_product', '-- choose a product --') },
                                ...candidates.map((id): AppSelectOption => ({ value: id, label: productNameById.get(id) || `#${id}` })),
                              ]}
                              onChange={(value) => updateDecision(row.rowNumber, { candidateProductId: value ? Number(value) : undefined })}
                            />
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'plan' && plan ? (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {applyErrors.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
              {T('dated_count_rows_skipped_as_errors', '{n} row(s) could not be applied and were skipped as errors.').replace('{n}', String(applyErrors.length))}
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            {T('dated_count_plan_summary', '{n} stock movement(s) will be created.').replace('{n}', String(plan.movementsToCreate.length))}
          </div>
          <div className="max-h-72 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-2 py-1.5 font-medium text-slate-500 dark:text-slate-400">{T('dated_count_product', 'Product')}</th>
                  <th className="px-2 py-1.5 font-medium text-slate-500 dark:text-slate-400">{T('dated_count_branch', 'Branch')}</th>
                  <th className="px-2 py-1.5 font-medium text-slate-500 dark:text-slate-400">{T('dated_count_date', 'Date')}</th>
                  <th className="px-2 py-1.5 font-medium text-slate-500 dark:text-slate-400">{T('dated_count_change', 'Change')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.movementsToCreate.map((m, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{m.productName}</td>
                    <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">{m.branchName}</td>
                    <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">{m.date}</td>
                    <td className={`px-2 py-1.5 font-medium ${m.movementType === 'add' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.movementType === 'add' ? '+' : '-'}{m.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-8 w-8" />
          {T('dated_count_done', 'Import complete.')}
        </div>
      ) : null}

      {/* N4: Back facing a long step label ("Apply Decisions & Preview") in a
          no-wrap row overflowed at 320 in English and in Khmer at 375. The
          row wraps and both buttons may shrink. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            if (step === 'upload' || step === 'done') onClose()
            else if (step === 'mapping' || step === 'review') restartUpload()
            else if (step === 'plan') setStep('review')
          }}
          disabled={working || step === 'resolving' || step === 'applying_decisions' || step === 'applying'}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {step === 'upload' || step === 'done' ? T('cancel', 'Cancel') : T('back', 'Back')}
        </button>
        {step === 'mapping' ? (
          <button type="button" onClick={() => void runResolve()} disabled={!mappingComplete} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
            {T('continue', 'Continue')}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {step === 'review' ? (
          <button type="button" onClick={() => void runApplyDecisions()} disabled={!reviewComplete} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
            {T('dated_count_build_preview', 'Apply Decisions & Preview')}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {step === 'plan' ? (
          <button type="button" onClick={() => void runApply()} disabled={working} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40">
            {T('dated_count_confirm_import', 'Confirm Import')}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {step === 'done' ? (
          <button type="button" onClick={onClose} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700">
            {T('done', 'Done')}
          </button>
        ) : null}
      </div>
    </Modal>
  )
}
