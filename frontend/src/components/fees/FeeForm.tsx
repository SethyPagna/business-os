import { useEffect, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import { useFormDirty } from '../../utils/formDirty.ts'
import {
  clearWorkDraft,
  flushPendingWorkDraft,
  readWorkDraft,
  scheduleWorkDraftWrite,
  scopedWorkDraftKey,
} from '../../utils/workDrafts.ts'
import { useModalClose } from '../shared/modalCloseContext.ts'
import AppSelect from '../shared/AppSelect.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import { normalizePriceValue } from '../../utils/pricing.ts'
import { getFeeLabels, type FeeLabelSuggestion, type FeeRecord, type FeeType } from '../../api/feesTransport.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { branchCanSell } from '../../utils/branchRoles.ts'

// Add/edit form for a single fee record.
//
// Layout (per the "Fees UI merge" request): fee-type + label share a row,
// USD/KHR share a row (unchanged), branch + date share a row, and the
// matched-sale field is a real search-and-attach picker pinned above
// everything else (not a raw numeric id typed into a date-row cell) --
// reuses sales.ts's existing multi-field `search` query (receipt number,
// customer name/phone, product name/sku/barcode) via getSales, the same
// endpoint the Sales page's own search already calls, plus a small new
// `id` exact-match filter (routes/sales.ts) so an already-attached sale
// can be re-displayed by id when editing an existing fee.

type SaleModule = typeof import('../../api/salesTransport.ts')
let saleModulePromise: Promise<SaleModule> | null = null
function loadSaleModule(): Promise<SaleModule> {
  if (!saleModulePromise) saleModulePromise = import('../../api/salesTransport.ts')
  return saleModulePromise
}

type SaleSearchRow = {
  id: number | string
  receipt_number?: string | null
  customer_name?: string | null
  total_usd?: number | null
  created_at?: string | null
  branch_id?: number | string | null
  branch_name?: string | null
}

function formatSaleOptionLabel(sale: SaleSearchRow): string {
  const receipt = sale.receipt_number || `#${sale.id}`
  const parts = [receipt]
  if (sale.customer_name) parts.push(sale.customer_name)
  if (sale.total_usd != null) parts.push(`$${Number(sale.total_usd).toFixed(2)}`)
  return parts.join(' \u2022 ')
}

type TranslateFn = (key: string) => string | undefined
const useApp = useAppHook as unknown as () => { t: TranslateFn }

export const FEE_TYPE_OPTIONS: { value: FeeType; labelKey: string; fallback: string }[] = [
  { value: 'tax', labelKey: 'fee_type_tax', fallback: 'Tax' },
  { value: 'delivery', labelKey: 'fee_type_delivery', fallback: 'Delivery' },
  { value: 'change', labelKey: 'fee_type_change', fallback: 'Change' },
  { value: 'expense', labelKey: 'fee_type_expense', fallback: 'Expense' },
  { value: 'other', labelKey: 'fee_type_other', fallback: 'Other' },
]

export type FeeBranchOption = { id: number | string; name: string | null; is_active?: boolean }

// Labels are reusable tags, not prose -- the same 6-word/60-char cap the
// server enforces (routes/fees.ts's normalizeFeeLabel), clamped live here
// so a whole sentence can't even be typed. Khmer has no spaces, so the
// char cap is what bounds an unspaced Khmer label.
export const FEE_LABEL_MAX_WORDS = 6
export const FEE_LABEL_MAX_CHARS = 60

export function clampFeeLabel(value: string): string {
  // Only the leading edge is trimmed while typing -- a trailing space is a
  // word in progress, and collapsing it would make the space key look dead.
  const str = value.replace(/^\s+/, '')
  const words = str.split(/(\s+)/) // keep separators so spacing is preserved
  let count = 0
  let out = ''
  for (const part of words) {
    if (/^\s+$/.test(part)) { out += count >= FEE_LABEL_MAX_WORDS ? '' : part; continue }
    if (!part) continue
    if (count >= FEE_LABEL_MAX_WORDS) break
    out += part
    count += 1
  }
  return out.slice(0, FEE_LABEL_MAX_CHARS)
}

export function feeLabelWordCount(value: string): number {
  const str = value.trim()
  return str ? str.split(/\s+/).length : 0
}

// Lazy-loaded the same way Products.tsx/NewSupplierReturnModal.tsx pull
// branchTransport -- this form only needs the list once per mount, not
// bundled into the main chunk.
type BranchModule = typeof import('../../api/branchTransport.ts')
let branchModulePromise: Promise<BranchModule> | null = null
function loadBranchModule(): Promise<BranchModule> {
  if (!branchModulePromise) branchModulePromise = import('../../api/branchTransport.ts')
  return branchModulePromise
}

export type FeeFormState = {
  fee_type: FeeType
  label: string
  amount_usd: string
  amount_khr: string
  fee_date: string
  sale_id: string
  branch_id: string
  notes: string
}


export function feeToFormState(fee?: FeeRecord | null): FeeFormState {
  return {
    fee_type: fee?.fee_type || 'other',
    label: fee?.label || '',
    amount_usd: fee ? String(fee.amount_usd ?? 0) : '',
    amount_khr: fee ? String(fee.amount_khr ?? 0) : '',
    fee_date: fee?.fee_date || todayStr(),
    sale_id: fee?.sale_id != null ? String(fee.sale_id) : '',
    branch_id: fee?.branch_id != null ? String(fee.branch_id) : '',
    notes: fee?.notes || '',
  }
}

type FeeFormProps = {
  fee?: FeeRecord | null
  /** Distinct labels already used on saved fees — offered as suggestions so
   *  a recurring reason ("Boost", "ទឹកភ្លើង") is picked, not retyped. */
  labelSuggestions?: string[]
  onSave: (payload: {
    fee_type: FeeType
    label: string | null
    amount_usd: number
    amount_khr: number
    fee_date: string
    sale_id: number | null
    branch_id: number | null
    notes: string | null
  }) => Promise<void> | void
  onClose: () => void
}

// S4-21: the registry key for this form's unsaved work, exported so the
// modal hosting the form asks about the SAME entry the form registers.
export function feeFormWorkKey(feeId?: string | number | null): string {
  return `fee-form-${feeId ?? 'new'}`
}

export function feeFormDraftBaseKey(feeId?: string | number | null): string {
  return `fee_${feeId ?? 'new'}`
}

function restoreFeeForm(base: FeeFormState, draft?: Partial<FeeFormState> | null): FeeFormState {
  if (!draft || typeof draft !== 'object') return base
  const feeType = FEE_TYPE_OPTIONS.some((option) => option.value === draft.fee_type)
    ? draft.fee_type as FeeType
    : base.fee_type
  const text = <K extends keyof FeeFormState>(key: K): FeeFormState[K] => (
    typeof draft[key] === 'string' ? draft[key] : base[key]
  ) as FeeFormState[K]
  return {
    fee_type: feeType,
    label: text('label'),
    amount_usd: text('amount_usd'),
    amount_khr: text('amount_khr'),
    fee_date: text('fee_date'),
    sale_id: text('sale_id'),
    branch_id: text('branch_id'),
    notes: text('notes'),
  }
}

export default function FeeForm({ fee, labelSuggestions = [], onSave, onClose }: FeeFormProps) {
  const { t } = useApp()
  const draftKey = scopedWorkDraftKey(feeFormDraftBaseKey(fee?.id))
  const restoredDraftRef = useRef<ReturnType<typeof readWorkDraft<Partial<FeeFormState>>> | undefined>(undefined)
  if (restoredDraftRef.current === undefined) {
    restoredDraftRef.current = readWorkDraft<Partial<FeeFormState>>(draftKey, {
      notOlderThanMs: fee?.updated_at ? Date.parse(fee.updated_at) || 0 : 0,
    })
  }
  const [form, setForm] = useState<FeeFormState>(() => restoreFeeForm(feeToFormState(fee), restoredDraftRef.current?.data))
  const [saving, setSaving] = useState(false)
  // One declaration; the ✕ above, the navigation guard, beforeunload, the
  // sidebar dot and the update gate all read it. Latched off on a real
  // save so closing after saving never prompts.
  const { dirty } = useFormDirty(form, String(fee?.id ?? 'new'))
  const savedRef = useRef(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = (dirty || !!restoredDraftRef.current) && !savedRef.current
  const requestClose = useModalClose(onClose)
  useEffect(() => registerDirtyWork({
    key: feeFormWorkKey(fee?.id),
    pageId: 'sales',
    label: `${t('expense') || 'Expense'}${form.label ? ` — ${form.label}` : ''}`,
    isDirty: () => dirtyRef.current,
    discard: () => clearWorkDraft(draftKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [draftKey, fee?.id])
  useEffect(() => () => { flushPendingWorkDraft(draftKey) }, [draftKey])
  useEffect(() => {
    if (!dirtyRef.current) return
    return scheduleWorkDraftWrite(draftKey, form)
  }, [draftKey, form])
  const [touched, setTouched] = useState(false)
  const [branches, setBranches] = useState<FeeBranchOption[]>([])
  // Saved labels from the server (every distinct label ever used, with its
  // dominant fee type) -- the page-derived `labelSuggestions` prop stays as
  // the instant seed / offline fallback until this arrives.
  const [savedLabels, setSavedLabels] = useState<FeeLabelSuggestion[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getFeeLabels()
      .then((result) => { if (!cancelled && Array.isArray(result?.labels)) setSavedLabels(result.labels) })
      .catch(() => { /* datalist just keeps the page-derived seed */ })
    return () => { cancelled = true }
  }, [])

  // Matched-sale search-and-attach state. `selectedSale` is the row shown
  // once a sale is picked (or, on edit, once the already-set sale_id has
  // been resolved back to a display row); `saleQuery`/`saleResults` drive
  // the dropdown while actively searching.
  const [selectedSale, setSelectedSale] = useState<SaleSearchRow | null>(null)
  const [saleQuery, setSaleQuery] = useState('')
  const [saleResults, setSaleResults] = useState<SaleSearchRow[]>([])
  const [saleSearching, setSaleSearching] = useState(false)
  const [saleDropdownOpen, setSaleDropdownOpen] = useState(false)
  const [saleResolving, setSaleResolving] = useState(false)
  const saleSearchSeq = useRef(0)

  // Resolve the current sale_id to a real display row. This uses form state,
  // rather than only the server prop, so a restored add/edit draft displays
  // the linked sale it will submit.
  // (receipt number / customer / total) instead of just showing a bare
  // number -- uses the new `id` exact-match filter on GET /api/sales.
  useEffect(() => {
    let cancelled = false
    const saleId = form.sale_id.trim()
    if (!saleId || String(selectedSale?.id || '') === saleId) return
    setSelectedSale(null)
    setSaleResolving(true)
    loadSaleModule()
      .then((mod) => mod.getSales({ id: String(saleId), limit: 1 }))
      .then((result) => {
        if (cancelled) return
        const rows = (Array.isArray(result) ? result : (result as { sales?: unknown[] })?.sales || []) as SaleSearchRow[]
        if (rows[0]) setSelectedSale(rows[0])
      })
      .catch(() => {
        // Resolution is cosmetic (nicer label) -- if it fails, the raw
        // sale_id is still saved and submitted correctly on save; just
        // nothing pretty to show while editing.
      })
      .finally(() => { if (!cancelled) setSaleResolving(false) })
    return () => { cancelled = true }
  }, [form.sale_id, selectedSale?.id])

  // Debounced as-you-type sale search, same 300ms pattern other
  // search-as-you-type pickers in this app use.
  useEffect(() => {
    const query = saleQuery.trim()
    if (!query) { setSaleResults([]); setSaleSearching(false); return }
    const seq = ++saleSearchSeq.current
    setSaleSearching(true)
    const timer = setTimeout(() => {
      loadSaleModule()
        .then((mod) => mod.getSales({ search: query, limit: 8 }))
        .then((result) => {
          if (saleSearchSeq.current !== seq) return
          const rows = (Array.isArray(result) ? result : (result as { sales?: unknown[] })?.sales || []) as SaleSearchRow[]
          setSaleResults(rows.filter((sale) => sale.branch_id != null && branchCanSell(sale.branch_name)))
        })
        .catch(() => { if (saleSearchSeq.current === seq) setSaleResults([]) })
        .finally(() => { if (saleSearchSeq.current === seq) setSaleSearching(false) })
    }, 300)
    return () => clearTimeout(timer)
  }, [saleQuery])

  const pickSale = (sale: SaleSearchRow) => {
    setSelectedSale(sale)
    set('sale_id', String(sale.id))
    if (sale.branch_id != null) set('branch_id', String(sale.branch_id))
    setSaleQuery('')
    setSaleResults([])
    setSaleDropdownOpen(false)
  }

  const clearSale = () => {
    setSelectedSale(null)
    set('sale_id', '')
    setSaleQuery('')
    setSaleResults([])
  }

  useEffect(() => {
    let cancelled = false
    loadBranchModule()
      .then((mod) => mod.getBranches())
      .then((rows) => {
        if (cancelled) return
        const shops = ((rows || []) as FeeBranchOption[])
          .filter((row) => row.is_active !== false && branchCanSell(row.name))
        setBranches(shops)
        if (!fee && shops.length === 1) {
          setForm((current) => current.branch_id ? current : { ...current, branch_id: String(shops[0].id) })
        }
      })
      .catch(() => {
        // The Worker remains the authority and refuses a save without the
        // active Shop. Keep the form open if the lookup fails.
        if (!cancelled) setBranches([])
      })
    return () => { cancelled = true }
  }, [])

  const set = <K extends keyof FeeFormState>(key: K, value: FeeFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const amountUsd = normalizePriceValue(form.amount_usd, 0)
  const amountKhr = normalizePriceValue(form.amount_khr, 0)
  // At least one currency amount must be a real, positive number -- a
  // fee with both amounts at 0 isn't a meaningful record.
  const amountsInvalid = amountUsd <= 0 && amountKhr <= 0
  const dateInvalid = !form.fee_date.trim()

  const branchOptions = (() => {
    const options = branches.map((b) => ({ value: String(b.id), label: b.name || String(b.id) }))
    return [{ value: '', label: t('select_branch') || 'Select Shop' }, ...options]
  })()

  const handleSave = async () => {
    setTouched(true)
    if (amountsInvalid || dateInvalid || !form.branch_id.trim()) return
    const saleId = form.sale_id.trim() ? Number(form.sale_id.trim()) : null
    const branchId = form.branch_id.trim() ? Number(form.branch_id.trim()) : null
    try {
      setSaving(true)
      await onSave({
        fee_type: form.fee_type,
        label: form.label.trim() || null,
        amount_usd: amountUsd,
        amount_khr: amountKhr,
        fee_date: form.fee_date,
        sale_id: Number.isFinite(saleId as number) ? saleId : null,
        branch_id: Number.isFinite(branchId as number) ? branchId : null,
        notes: form.notes.trim() || null,
      })
      // Saved for real -- latch before closing so the close below cannot
      // raise the discard prompt.
      savedRef.current = true
      dirtyRef.current = false
      restoredDraftRef.current = null
      clearWorkDraft(draftKey)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      {/* Type + label genuinely share one row (the old comment claimed this
          while the JSX still stacked them). The label input suggests every
          label already saved on a fee, so recurring reasons are reusable
          without retyping — and a brand-new label just gets typed in. */}
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor="fee-type" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('fee_type') || 'Type'} *
          </label>
          <AppSelect
            id="fee-type"
            value={form.fee_type}
            buttonClassName="w-full"
            ariaLabel={t('fee_type') || 'Type'}
            options={FEE_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) || opt.fallback }))}
            onChange={(value) => set('fee_type', value as FeeType)}
          />
        </div>
        <div>
          <label htmlFor="fee-label" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('fee_label') || 'Label'}
          </label>
          <input
            id="fee-label"
            className="input"
            list="fee-label-suggestions"
            value={form.label}
            onChange={(event) => {
              // Clamp live to the shared label cap, and when the text lands
              // exactly on a saved label, adopt that label's dominant fee
              // type -- picking "Grab" from the list should not leave the
              // type sitting on whatever the previous entry used (real rows
              // were saved as 'expense' with delivery-company labels).
              const next = clampFeeLabel(event.target.value)
              const match = savedLabels?.find((s) => s.label.toLowerCase() === next.trim().toLowerCase())
              setForm((prev) => ({ ...prev, label: next, fee_type: match ? match.fee_type : prev.fee_type }))
            }}
            placeholder={t('fee_label_placeholder') || 'e.g. Delivery charge, Staff salary'}
            maxLength={FEE_LABEL_MAX_CHARS}
            title={t('fee_label_limit_hint') || `Short reusable tag — up to ${FEE_LABEL_MAX_WORDS} words. Details go in Notes.`}
          />
          {feeLabelWordCount(form.label) >= FEE_LABEL_MAX_WORDS - 1 ? (
            <p className="mt-0.5 text-right text-[11px] text-gray-400">
              {feeLabelWordCount(form.label)}/{FEE_LABEL_MAX_WORDS}
            </p>
          ) : null}
          <datalist id="fee-label-suggestions">
            {(savedLabels?.length
              ? savedLabels.map((s) => s.label)
              : labelSuggestions
            ).map((label) => <option key={label} value={label} />)}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="fee-amount-usd" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('amount_usd') || 'Amount (USD)'}
          </label>
          <input
            id="fee-amount-usd"
            className="input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form.amount_usd}
            onChange={(event) => set('amount_usd', event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label htmlFor="fee-amount-khr" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('amount_khr') || 'Amount (KHR)'}
          </label>
          <input
            id="fee-amount-khr"
            className="input"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={form.amount_khr}
            onChange={(event) => set('amount_khr', event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="0"
          />
        </div>
      </div>
      {touched && amountsInvalid ? (
        <p className="-mt-2 text-xs text-red-500">
          {t('fee_amount_required') || 'Enter an amount in USD or KHR.'}
        </p>
      ) : null}

      <div>
        <label htmlFor="fee-sale-search" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fee_matched_sale_id') || 'Linked sale (optional)'}
        </label>
        {selectedSale ? (
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-700 dark:bg-emerald-950/30">
            <div className="min-w-0">
              <div className="truncate font-semibold text-emerald-900 dark:text-emerald-100">{formatSaleOptionLabel(selectedSale)}</div>
              <div className="text-xs text-emerald-700 dark:text-emerald-300">Sale ID #{selectedSale.id}{selectedSale.branch_name ? ` · ${selectedSale.branch_name}` : ''}</div>
            </div>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              onClick={clearSale}
            >
              {t('remove') || 'Remove'}
            </button>
          </div>
        ) : (
          <div className="relative">
            <SearchInput
              id="fee-sale-search"
              value={saleQuery}
              onChange={(value) => { setSaleQuery(value); setSaleDropdownOpen(true) }}
              onFocus={() => setSaleDropdownOpen(true)}
              onBlur={() => window.setTimeout(() => setSaleDropdownOpen(false), 120)}
              placeholder={t('fee_sale_search_placeholder') || 'Search receipt, customer, phone, product, SKU or barcode'}
              ariaLabel={t('fee_sale_search_placeholder') || 'Search for a sale to link'}
              className="w-full"
            />
            {saleDropdownOpen && saleQuery.trim() ? (
              <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-900" role="listbox">
                {saleSearching || saleResolving ? (
                  <div className="px-3 py-2 text-sm text-gray-500">{t('loading') || 'Loading...'}</div>
                ) : saleResults.length ? saleResults.map((sale) => (
                  <button
                    key={sale.id}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="min-h-11 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pickSale(sale)}
                  >
                    <span className="block font-medium">{formatSaleOptionLabel(sale)}</span>
                    <span className="block text-xs text-gray-500">Sale ID #{sale.id}{sale.branch_name ? ` · ${sale.branch_name}` : ''}</span>
                  </button>
                )) : (
                  <div className="px-3 py-2 text-sm text-gray-500">{t('no_results') || 'No Shop sales found'}</div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="fee-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fee_date') || 'Date'} *
        </label>
        <DateEntryInput
          id="fee-date"
          t={t}
          ariaLabel={t('fee_date') || 'Date'}
          value={form.fee_date}
          onChange={(iso) => { set('fee_date', iso); setTouched(true) }}
          onInvalidChange={(invalid) => { if (invalid) setTouched(true) }}
        />
      </div>

      <div>
        <label htmlFor="fee-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branch') || 'Shop'} *
        </label>
        <AppSelect
          id="fee-branch"
          value={form.branch_id}
          buttonClassName="w-full"
          ariaLabel={t('branch') || 'Branch'}
          options={branchOptions}
          onChange={(value) => set('branch_id', value as string)}
        />
        {touched && !form.branch_id.trim() ? (
          <p className="mt-1 text-xs text-red-500">{t('select_branch') || 'Select the Shop branch.'}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="fee-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('notes') || 'Notes'}
        </label>
        <textarea
          id="fee-notes"
          className="input resize-none"
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder={t('notes_placeholder') || 'Any notes...'}
          maxLength={2000}
        />
      </div>

      {/* Sticky footer: pinned to the bottom of Modal.tsx's scrollable area
          (.modal-scroll) so Save/Cancel stay reachable without scrolling to
          the end of the form on small screens. -mx-5 -mb-5 cancels the
          modal's own p-5 padding so the bar spans full width and sits flush
          against the bottom edge; px-5 pb-5 pt-4 puts it back inside the bar. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
        <button className="btn-primary flex-1" type="submit" disabled={saving}>
          {saving ? (t('saving') || 'Saving...') : (t('save_fee') || 'Save Expense')}
        </button>
        {/* Cancel is a dismissal: through the modal's guard, not straight
            to onClose (S4-21). */}
        <button className="btn-secondary" type="button" onClick={requestClose}>
          {t('cancel') || 'Cancel'}
        </button>
      </div>
    </form>
  )
}
