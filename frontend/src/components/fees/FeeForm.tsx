import { useEffect, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import { normalizePriceValue } from '../../utils/pricing.ts'
import type { FeeRecord, FeeType } from '../../api/feesTransport.ts'

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
  { value: 'other', labelKey: 'fee_type_other', fallback: 'Other' },
]

export type FeeBranchOption = { id: number | string; name: string | null; is_active?: boolean }

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function feeToFormState(fee?: FeeRecord | null): FeeFormState {
  return {
    fee_type: fee?.fee_type || 'other',
    label: fee?.label || '',
    amount_usd: fee ? String(fee.amount_usd ?? 0) : '',
    amount_khr: fee ? String(fee.amount_khr ?? 0) : '',
    fee_date: fee?.fee_date || todayIso(),
    sale_id: fee?.sale_id != null ? String(fee.sale_id) : '',
    branch_id: fee?.branch_id != null ? String(fee.branch_id) : '',
    notes: fee?.notes || '',
  }
}

type FeeFormProps = {
  fee?: FeeRecord | null
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

export default function FeeForm({ fee, onSave, onClose }: FeeFormProps) {
  const { t } = useApp()
  const [form, setForm] = useState<FeeFormState>(() => feeToFormState(fee))
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [branches, setBranches] = useState<FeeBranchOption[]>([])

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

  // On edit, resolve the fee's existing sale_id to a real display row
  // (receipt number / customer / total) instead of just showing a bare
  // number -- uses the new `id` exact-match filter on GET /api/sales.
  useEffect(() => {
    let cancelled = false
    const saleId = fee?.sale_id
    if (saleId == null) return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only ever re-resolve for the fee this form opened with
  }, [fee?.sale_id])

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
          setSaleResults(rows)
        })
        .catch(() => { if (saleSearchSeq.current === seq) setSaleResults([]) })
        .finally(() => { if (saleSearchSeq.current === seq) setSaleSearching(false) })
    }, 300)
    return () => clearTimeout(timer)
  }, [saleQuery])

  const pickSale = (sale: SaleSearchRow) => {
    setSelectedSale(sale)
    set('sale_id', String(sale.id))
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
        setBranches(((rows || []) as FeeBranchOption[]).filter((row) => row.is_active !== false))
      })
      .catch(() => {
        // Branch is optional on a fee record -- if the list fails to load,
        // fall back to no branch options rather than blocking the form;
        // an existing fee's already-set branch still round-trips via id.
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

  // Keep the fee's already-set branch selectable even if it's since been
  // deactivated -- same "don't silently drop an existing value" reasoning
  // as NewSupplierReturnModal.tsx's branch handling.
  const branchOptions = (() => {
    const options = branches.map((b) => ({ value: String(b.id), label: b.name || String(b.id) }))
    if (fee?.branch_id != null && !options.some((opt) => opt.value === String(fee.branch_id))) {
      options.push({ value: String(fee.branch_id), label: fee.branch_name || `#${fee.branch_id}` })
    }
    return [{ value: '', label: t('no_branch') || 'No branch' }, ...options]
  })()

  const handleSave = async () => {
    setTouched(true)
    if (amountsInvalid || dateInvalid) return
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
      <div>
        <label htmlFor="fee-type" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fee_type') || 'Fee Type'} *
        </label>
        <AppSelect
          id="fee-type"
          value={form.fee_type}
          buttonClassName="w-full"
          ariaLabel={t('fee_type') || 'Fee Type'}
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
          value={form.label}
          onChange={(event) => set('label', event.target.value)}
          placeholder={t('fee_label_placeholder') || 'e.g. Delivery charge, Phnom Penh weekend rush'}
          maxLength={200}
        />
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="fee-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('fee_date') || 'Date'} *
          </label>
          <input
            id="fee-date"
            className="input"
            type="date"
            value={form.fee_date}
            onChange={(event) => set('fee_date', event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && dateInvalid ? 'true' : 'false'}
          />
        </div>
        <div>
          <label htmlFor="fee-sale-id" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('fee_matched_sale_id') || 'Matched Sale ID (optional)'}
          </label>
          <input
            id="fee-sale-id"
            className="input"
            type="number"
            min="1"
            inputMode="numeric"
            value={form.sale_id}
            onChange={(event) => set('sale_id', event.target.value)}
            placeholder={t('fee_sale_id_placeholder') || 'e.g. 1042'}
          />
        </div>
      </div>

      <div>
        <label htmlFor="fee-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branch') || 'Branch'}
        </label>
        <AppSelect
          id="fee-branch"
          value={form.branch_id}
          buttonClassName="w-full"
          ariaLabel={t('branch') || 'Branch'}
          options={branchOptions}
          onChange={(value) => set('branch_id', value as string)}
        />
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
          {saving ? (t('saving') || 'Saving...') : (t('save_fee') || 'Save Fee')}
        </button>
        <button className="btn-secondary" type="button" onClick={onClose}>
          {t('cancel') || 'Cancel'}
        </button>
      </div>
    </form>
  )
}
