// Frontend mapping/upload + review/apply wizard for the General mode
// "Add/Sale" import sub-option -- the last remaining piece of that
// pipeline per progress.md's "CSV-import mode selector" item (Parts
// 297-312 built and tested every pure function this screen calls:
// applyAddSaleMapping, groupAddSaleImportRows, resolveAddSaleCostPrices,
// resolveAddSaleProductMatches, resolveAddSaleRows, buildAddSaleGroupPlans,
// applyAddSaleGroupPlans -- nothing here duplicates that logic, this file
// only wires it to real data and renders it).
//
// Launched from ImportModeWizard once "Add-Sale" is picked as the top-level
// mode and its template screen is confirmed -- same launch pattern General's
// "Dated Stock Reconciliation" sub-option already uses. Same locked-mode
// convention as DatedStockReconciliationModal: Back from mapping/review
// drops the uploaded file and restarts at upload, never further back into
// ImportModeWizard's mode-picker screens.
//
// Existing-product matching data source -- a real design decision, not
// guessed: this app has an established, deliberate precedent
// (BulkImportModal's own analyzePickedCsv comment) of NOT loading the full
// product catalog client-side for import matching, since a real catalog can
// run to hundreds of thousands of rows (confirmed directly against the
// user's own uploaded products-template_with_description.csv, 150,000+
// lines) -- doing so here would silently not scale. There is also no
// bulk-lookup-by-identity-list backend endpoint today (confirmed via
// cloudflare/src/routes/products.ts). Rather than build a new backend route
// or block on that decision, this screen instead runs one `/search` query
// per UNIQUE barcode/sku/name found in the uploaded FILE (already the
// established, real search endpoint every other part of this app uses) --
// this scales with the import file's row count, not the catalog's, and
// needs no backend change.
import { useMemo, useState } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import UploadIcon from 'lucide-react/dist/esm/icons/upload.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Modal from '../../shared/Modal'
import AppSelect, { type AppSelectOption } from '../../shared/AppSelect.tsx'
import { openCSVDialog } from '../../../api/browserDialogs.ts'
import { parseCsvRows } from '../../../utils/csvImport.ts'
import { searchProducts as apiSearchProducts, getCustomers as apiGetCustomers } from '../../../api/methods.ts'
import { TARGET_FIELDS, autoMapHeaders, getUnmetRequiredFields, applyAddSaleMapping } from './addSaleImportMapping.ts'
import {
  groupAddSaleImportRows,
  resolveAddSaleCostPrices,
  resolveAddSaleProductMatches,
  type AddSaleImportRow,
  type CostPriceResolution,
  type ExistingProductForCostLookup,
  type ExistingProductForMatchLookup,
} from './addSaleImportResolve.ts'
import {
  resolveAddSaleRows,
  buildAddSaleGroupPlans,
  type RowReviewDecision,
  type AddSaleGroupPlan,
} from './addSaleImportPlan.ts'
import { applyAddSaleGroupPlans, summarizeAddSaleApplyResults, type AddSaleGroupApplyResult } from './addSaleImportApply.ts'

type TranslateFn = (key: string, fallback?: string, km?: string) => string
type EntityId = string | number

interface BranchOption { id: EntityId; name?: string | null }

interface AddSaleImportModalProps {
  onClose: () => void
  onDone: () => void
  t: TranslateFn
  branches?: BranchOption[]
}

type Step = 'upload' | 'mapping' | 'resolving' | 'review' | 'applying' | 'done'

interface SearchedProduct {
  id: number
  name?: string | null
  sku?: string | null
  barcode?: string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  branch_stock?: { branch_id?: EntityId | null; branch_name?: string | null; quantity?: number | string | null }[]
}

const BLOCK_REASON_LABEL: Record<string, string> = {
  unknown_branch: "This row's branch doesn't match any real branch name.",
  invalid_quantity: 'Quantity is missing or not a positive number.',
  missing_selling_price: 'Selling price (USD or KHR) is missing.',
  missing_cost_price: "Cost price is missing and couldn't be resolved from a matching product.",
  cost_unresolved: 'Cost price is not resolved yet.',
  no_identity_match: 'No existing product matches this row by barcode/SKU/name.',
  cost_price_mismatch: "A product matched by name/barcode/SKU, but its cost price doesn't agree with this row's cost.",
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

// Small reusable inline product search-and-pick control, shared by both
// cost-block rows (pick a product to inherit cost from) and identity-match
// block rows (pick a product to sell against anyway). Deliberately minimal
// -- a text query + Search button + result list -- not a live-typeahead,
// since this app's other pickers (AppSelect) are fixed-option, not live-
// search, and building a full typeahead component is its own separate
// scope this screen doesn't need to solve.
function InlineProductPicker({
  T, placeholder, onPick,
}: { T: (key: string, fallback: string) => string; placeholder: string; onPick: (product: SearchedProduct) => void }) {
  const [query, setQuery] = useState(placeholder)
  const [results, setResults] = useState<SearchedProduct[]>([])
  const [searching, setSearching] = useState(false)

  async function runSearch(): Promise<void> {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const payload = await apiSearchProducts({ q, pageSize: 8, include: 'branch_stock' }) as { items?: SearchedProduct[] } | SearchedProduct[] | null
      const items = Array.isArray(payload) ? payload : (payload?.items || [])
      setResults(items)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          className="input flex-1 text-xs"
          placeholder={T('add_sale_search_products', 'Search products by name, SKU, or barcode')}
        />
        <button type="button" onClick={() => void runSearch()} disabled={searching} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">
          <Search className="h-3 w-3" />
          {T('search', 'Search')}
        </button>
      </div>
      {results.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onPick(product)}
              className="block w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {product.name || `#${product.id}`}{product.sku ? ` -- SKU ${product.sku}` : ''}{product.barcode ? ` -- ${product.barcode}` : ''}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function AddSaleImportModal({ onClose, onDone, t, branches = [] }: AddSaleImportModalProps) {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const branchIdByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of branches) {
      const id = Number(b?.id)
      const name = normalizeKey(b?.name)
      if (name && Number.isFinite(id)) map.set(name, id)
    }
    return map
  }, [branches])

  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  // ---- upload ----
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [uploading, setUploading] = useState(false)

  // ---- mapping ----
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})

  // ---- resolved data sources (built once per file, during 'resolving') ----
  const [rows, setRows] = useState<AddSaleImportRow[]>([])
  const [existingProductsForCost, setExistingProductsForCost] = useState<ExistingProductForCostLookup[]>([])
  const [existingProductsForMatch, setExistingProductsForMatch] = useState<ExistingProductForMatchLookup[]>([])
  const [customerIdByName, setCustomerIdByName] = useState<Map<string, number>>(new Map())

  // ---- review decisions ----
  const [reviewDecisions, setReviewDecisions] = useState<Map<number, RowReviewDecision>>(new Map())
  // Cost-block rows need one more thing reviewDecisions alone can't carry:
  // resolveAddSaleRows only consults reviewDecisions AFTER a row's cost is
  // already resolved (see addSaleImportPlan.ts), so picking a product to
  // source cost from has to actually feed a resolved cost back into
  // costResolutions, not just record a decision -- this map is that
  // feedback, applied as an override in the costResolutions memo below.
  const [costOverrides, setCostOverrides] = useState<Map<number, { costPriceUsd: number; costPriceKhr?: number; matchedProductId: number }>>(new Map())

  // ---- apply ----
  const [applyResults, setApplyResults] = useState<AddSaleGroupApplyResult[]>([])

  async function pickFile(): Promise<void> {
    setError('')
    setUploading(true)
    try {
      const result = await openCSVDialog()
      if (!result) { setUploading(false); return }
      const parsedRows = parseCsvRows(result.content)
      if (!parsedRows.length) {
        setError(T('add_sale_empty_file', 'That file has no data rows.'))
        setUploading(false)
        return
      }
      const detectedHeaders = Object.keys(parsedRows[0])
      setFileName(result.name)
      setCsvText(result.content)
      setHeaders(detectedHeaders)
      setMapping(autoMapHeaders(detectedHeaders))
      setStep('mapping')
    } catch (e) {
      setError(e instanceof Error ? e.message : T('add_sale_read_failed', 'Could not read that file.'))
    } finally {
      setUploading(false)
    }
  }

  function restartUpload(): void {
    setFileName('')
    setCsvText('')
    setHeaders([])
    setMapping({})
    setRows([])
    setExistingProductsForCost([])
    setExistingProductsForMatch([])
    setCustomerIdByName(new Map())
    setReviewDecisions(new Map())
    setCostOverrides(new Map())
    setApplyResults([])
    setError('')
    setStep('upload')
  }

  const mappingRows = useMemo(() => (csvText ? parseCsvRows(csvText) : []), [csvText])
  const unmetRequiredFields = useMemo(() => getUnmetRequiredFields(mapping), [mapping])
  const mappingComplete = unmetRequiredFields.length === 0

  async function runResolve(): Promise<void> {
    if (!mappingComplete) return
    setError('')
    setStep('resolving')
    try {
      const mappedRows = applyAddSaleMapping(mappingRows, mapping)

      // One search per UNIQUE identity key across the whole file -- see
      // this file's own header comment for why this, not a full-catalog
      // load or a new backend route.
      const uniqueKeys = new Set<string>()
      for (const row of mappedRows) {
        const key = normalizeKey(row.barcode) || normalizeKey(row.sku) || normalizeKey(row.name)
        if (key) uniqueKeys.add(key)
      }
      const productById = new Map<number, SearchedProduct>()
      for (const key of uniqueKeys) {
        // eslint-disable-next-line no-await-in-loop -- sequential by design, matches applyAddSaleGroupPlans' own ordering rationale: a debuggable, bounded sequence over the file's own unique keys, not the whole catalog.
        const payload = await apiSearchProducts({ q: key, pageSize: 8, include: 'branch_stock' }) as { items?: SearchedProduct[] } | SearchedProduct[] | null
        const items = Array.isArray(payload) ? payload : (payload?.items || [])
        for (const item of items) {
          const id = Number(item?.id)
          if (Number.isFinite(id) && !productById.has(id)) productById.set(id, item)
        }
      }

      const costLookup: ExistingProductForCostLookup[] = []
      const matchLookup: ExistingProductForMatchLookup[] = []
      for (const product of productById.values()) {
        const costUsd = product.cost_price_usd == null ? null : Number(product.cost_price_usd)
        const costKhr = product.cost_price_khr == null ? null : Number(product.cost_price_khr)
        costLookup.push({
          id: product.id, barcode: product.barcode, sku: product.sku, name: product.name,
          cost_price_usd: Number.isFinite(costUsd as number) ? costUsd : null,
          cost_price_khr: Number.isFinite(costKhr as number) ? costKhr : null,
        })
        for (const stock of product.branch_stock || []) {
          if (!stock?.branch_name) continue
          matchLookup.push({
            id: product.id, barcode: product.barcode, sku: product.sku, name: product.name,
            branch: stock.branch_name,
            cost_price_usd: Number.isFinite(costUsd as number) ? costUsd : null,
            cost_price_khr: Number.isFinite(costKhr as number) ? costKhr : null,
          })
        }
      }

      let customerMap = new Map<string, number>()
      if (mapping.customer) {
        const customersPayload = await apiGetCustomers({ pageSize: 500 }) as { items?: { id?: EntityId; name?: string }[] } | { id?: EntityId; name?: string }[] | null
        const customerItems = Array.isArray(customersPayload) ? customersPayload : (customersPayload?.items || [])
        customerMap = new Map(
          customerItems
            .filter((c) => c?.name && c?.id != null)
            .map((c) => [normalizeKey(c.name), Number(c.id)] as [string, number]),
        )
      }

      setRows(mappedRows)
      setExistingProductsForCost(costLookup)
      setExistingProductsForMatch(matchLookup)
      setCustomerIdByName(customerMap)
      setReviewDecisions(new Map())
      setCostOverrides(new Map())
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : T('add_sale_resolve_failed', 'Could not analyze this file.'))
      setStep('mapping')
    }
  }

  const costResolutions = useMemo((): CostPriceResolution[] => {
    const base = resolveAddSaleCostPrices(rows, existingProductsForCost)
    if (!costOverrides.size) return base
    return base.map((resolution, rowIndex) => {
      const override = costOverrides.get(rowIndex)
      if (!override) return resolution
      return {
        rowIndex, resolved: true,
        costPriceUsd: override.costPriceUsd,
        ...(override.costPriceKhr != null ? { costPriceKhr: override.costPriceKhr } : {}),
        matchedProductId: override.matchedProductId,
      }
    })
  }, [rows, existingProductsForCost, costOverrides])

  const matchResolutions = useMemo(
    () => resolveAddSaleProductMatches(rows, costResolutions, existingProductsForMatch),
    [rows, costResolutions, existingProductsForMatch],
  )

  const resolvedRows = useMemo(
    () => resolveAddSaleRows(rows, costResolutions, matchResolutions, branchIdByName, reviewDecisions),
    [rows, costResolutions, matchResolutions, branchIdByName, reviewDecisions],
  )

  const groups = useMemo(() => groupAddSaleImportRows(rows), [rows])

  const plans = useMemo(
    () => buildAddSaleGroupPlans(rows, groups, resolvedRows, customerIdByName),
    [rows, groups, resolvedRows, customerIdByName],
  )

  const readyCount = plans.filter((p) => p.status === 'ready').length
  const blockedCount = plans.filter((p) => p.status === 'blocked').length
  const needsNewProductCount = plans.filter((p) => p.status === 'needs_new_product').length

  function setDecision(rowIndex: number, decision: RowReviewDecision): void {
    setReviewDecisions((current) => new Map(current).set(rowIndex, decision))
  }

  function pickCostSource(rowIndex: number, product: SearchedProduct): void {
    const costUsd = product.cost_price_usd == null ? null : Number(product.cost_price_usd)
    if (costUsd == null || !Number.isFinite(costUsd)) return // this product has no cost either -- nothing usable to inherit
    const costKhr = product.cost_price_khr == null ? undefined : Number(product.cost_price_khr)
    setCostOverrides((current) => new Map(current).set(rowIndex, {
      costPriceUsd: costUsd,
      ...(costKhr != null && Number.isFinite(costKhr) ? { costPriceKhr: costKhr } : {}),
      matchedProductId: product.id,
    }))
  }

  async function runApply(): Promise<void> {
    setError('')
    setWorking(true)
    setStep('applying')
    try {
      const results = await applyAddSaleGroupPlans(plans)
      setApplyResults(results)
      setStep('done')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : T('add_sale_apply_failed', 'The import failed to apply.'))
      setStep('review')
    } finally {
      setWorking(false)
    }
  }

  const applySummary = useMemo(() => summarizeAddSaleApplyResults(applyResults), [applyResults])

  function rowLabel(rowIndex: number): string {
    const row = rows[rowIndex]
    return row?.name || row?.barcode || row?.sku || `${T('add_sale_row', 'Row')} ${rowIndex + 1}`
  }

  function renderBlockedRow(rowIndex: number) {
    const resolved = resolvedRows.find((r) => r.rowIndex === rowIndex)
    const reason = resolved?.blockedReason || ''
    const match = matchResolutions[rowIndex]
    const isCostBlock = reason === 'missing_cost_price'
    const isMatchBlock = reason === 'no_identity_match' || reason === 'cost_price_mismatch'
    const candidates = (match?.conflictingCandidateIds || []).map((id) => existingProductsForMatch.find((p) => p.id === id)).filter((p): p is ExistingProductForMatchLookup => !!p)

    return (
      <div key={rowIndex} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
        <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">{rowLabel(rowIndex)}</div>
        <div className="mb-2 flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {BLOCK_REASON_LABEL[reason] || reason}
        </div>
        {isMatchBlock && candidates.length > 0 ? (
          <div className="mb-2 space-y-1">
            <p className="text-slate-500 dark:text-slate-400">{T('add_sale_use_anyway', 'Or use one of these anyway:')}</p>
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setDecision(rowIndex, { type: 'use_product', productId: candidate.id })}
                className={`block w-full rounded-md border px-2 py-1 text-left ${
                  reviewDecisions.get(rowIndex)?.type === 'use_product' && (reviewDecisions.get(rowIndex) as { type: 'use_product'; productId: number }).productId === candidate.id
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {candidate.name} -- {T('add_sale_branch', 'branch')}: {candidate.branch}
              </button>
            ))}
          </div>
        ) : null}
        {isCostBlock ? (
          <InlineProductPicker T={T} placeholder={String(rows[rowIndex]?.name || rows[rowIndex]?.barcode || rows[rowIndex]?.sku || '')} onPick={(product) => pickCostSource(rowIndex, product)} />
        ) : null}
        {isMatchBlock ? (
          <InlineProductPicker T={T} placeholder={String(rows[rowIndex]?.name || rows[rowIndex]?.barcode || rows[rowIndex]?.sku || '')} onPick={(product) => setDecision(rowIndex, { type: 'use_product', productId: product.id })} />
        ) : null}
        {isMatchBlock ? (
          <button
            type="button"
            onClick={() => setDecision(rowIndex, { type: 'create_new' })}
            className={`mt-2 w-full rounded-md border px-2 py-1 text-left ${
              reviewDecisions.get(rowIndex)?.type === 'create_new'
                ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {T('add_sale_create_new_product', 'Create as a new product (not automated yet -- skipped this run, flagged for follow-up)')}
          </button>
        ) : null}
        {costOverrides.has(rowIndex) ? (
          <div className="mt-2 flex items-center gap-1.5 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {T('add_sale_cost_source_picked', 'Cost price will be taken from the product you picked above.')}
          </div>
        ) : null}
      </div>
    )
  }

  function renderGroup(plan: AddSaleGroupPlan) {
    const title = plan.actionLabel ? `${T('add_sale_group', 'Sale group')} "${plan.actionLabel}"` : rowLabel(plan.rowIndexes[0])
    if (plan.status === 'ready') {
      return (
        <div key={`${plan.actionLabel}-${plan.rowIndexes.join(',')}`} className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50/60 p-2.5 text-xs text-green-700 dark:border-green-900/40 dark:bg-green-950/10 dark:text-green-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{title} -- {plan.payload.items.length} {T('add_sale_line_items', 'item(s)')}, {T('add_sale_ready', 'ready to import')}</span>
        </div>
      )
    }
    if (plan.status === 'needs_new_product') {
      return (
        <div key={`${plan.actionLabel}-${plan.rowIndexes.join(',')}`} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-300">
          {title} -- {T('add_sale_needs_new_product', 'will be skipped this run: needs a new product created first (not automated yet).')}
        </div>
      )
    }
    return (
      <div key={`${plan.actionLabel}-${plan.rowIndexes.join(',')}`} className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</p>
        {plan.blockedRowIndexes.map((rowIndex) => renderBlockedRow(rowIndex))}
      </div>
    )
  }

  return (
    <Modal title={T('add_sale_import_title', 'Add & Link to Sales')} onClose={onClose} size="lg" draggable>
      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {step === 'upload' ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            <p className="mb-1 font-semibold">{T('add_sale_upload_heading', 'Upload a stock-in / sale file')}</p>
            <p className="text-xs">
              {T('add_sale_upload_body', "CSV or Excel. You'll match this file's own column headers to the fields this import needs on the next screen -- headers don't need to match exactly.")}
            </p>
          </div>
          <button type="button" className="btn-primary flex w-full items-center justify-center gap-2 text-sm" onClick={() => void pickFile()} disabled={uploading}>
            <UploadIcon className="h-4 w-4" />
            {uploading ? T('add_sale_reading', 'Reading file...') : T('add_sale_choose_file', 'Choose File')}
          </button>
        </div>
      ) : null}

      {step === 'mapping' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{fileName}</span>
            <span>{T('add_sale_rows_detected', '{n} rows detected').replace('{n}', String(mappingRows.length))}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {T('add_sale_mapping_body', 'Match each field this import needs to a column in your file. Fields marked required must be mapped; optional ones can be left as "-- none --".')}
          </p>
          <div className="space-y-2">
            {TARGET_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                <div className="w-44 shrink-0">
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
                    { value: '', label: T('add_sale_none', '-- none --') },
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
              <span>{T('add_sale_mapping_incomplete', 'Still needed: ')}{unmetRequiredFields.join(', ')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'resolving' || step === 'applying' ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <span>
            {step === 'resolving' && T('add_sale_analyzing', 'Matching rows against your product catalog...')}
            {step === 'applying' && T('add_sale_applying', 'Creating sales...')}
          </span>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-green-50 p-2 text-green-700 dark:bg-green-950/30 dark:text-green-300">
              <div className="text-lg font-semibold">{readyCount}</div>
              {T('add_sale_ready_count', 'ready')}
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <div className="text-lg font-semibold">{blockedCount}</div>
              {T('add_sale_need_a_decision', 'need a decision')}
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <div className="text-lg font-semibold">{needsNewProductCount}</div>
              {T('add_sale_need_new_product', 'need a new product')}
            </div>
          </div>
          <div className="space-y-2">
            {plans.map((plan) => renderGroup(plan))}
          </div>
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-8 w-8" />
          {T('add_sale_done', 'Import complete.')}
          <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs text-slate-600 dark:text-slate-300">
            <div className="rounded-lg bg-green-50 p-2 dark:bg-green-950/30"><div className="text-base font-semibold">{applySummary.applied}</div>{T('add_sale_applied', 'applied')}</div>
            <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/30"><div className="text-base font-semibold">{applySummary.failed}</div>{T('add_sale_failed', 'failed')}</div>
            <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-950/30"><div className="text-base font-semibold">{applySummary.skippedBlocked}</div>{T('add_sale_skipped_blocked', 'skipped (blocked)')}</div>
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60"><div className="text-base font-semibold">{applySummary.skippedNeedsNewProduct}</div>{T('add_sale_skipped_new_product', 'skipped (needs new product)')}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            if (step === 'upload' || step === 'done') onClose()
            else restartUpload()
          }}
          disabled={working || step === 'resolving' || step === 'applying'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {step === 'upload' || step === 'done' ? T('cancel', 'Cancel') : T('back', 'Back')}
        </button>
        {step === 'mapping' ? (
          <button type="button" onClick={() => void runResolve()} disabled={!mappingComplete} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
            {T('continue', 'Continue')}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {step === 'review' ? (
          <button type="button" onClick={() => void runApply()} disabled={working || readyCount === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
            {T('add_sale_confirm_import', 'Confirm Import')} ({readyCount})
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {step === 'done' ? (
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700">
            {T('done', 'Done')}
          </button>
        ) : null}
      </div>
    </Modal>
  )
}
