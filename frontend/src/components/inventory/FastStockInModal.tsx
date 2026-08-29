// F2 (Part 419): fast stock-in -- one shipment's header (branch, received
// date, supplier, paid/credit) entered ONCE, then rapid per-product lines:
// type a name, pick the row, quantity/cost/expiry, Add writes ONE
// receiveBatchStock through the same D4 kernel every other add-stock
// surface uses (no parallel write path -- the server derives/tops up the
// lot from the received date and applies first-attribution-sticks for the
// supplier), and the input clears for the next product. Done closes.
//
// Deliberately per-line commits, not a queued batch: each Add's outcome is
// shown on its own row (lot code or the error), so there is never a silent
// partial write -- what the list shows IS what happened.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect from '../shared/AppSelect.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import { receiveBatchStock } from '../../api/batchesTransport.ts'
import { searchProducts } from '../../api/methods.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft } from '../../utils/workDrafts.ts'

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

interface ProductCandidate {
  id: number | string
  name?: string | null
  barcode?: string | null
  stock_quantity?: number | string | null
  cost_price_usd?: number | string | null
}

interface ReceivedLine {
  key: string
  productName: string
  quantity: number
  ok: boolean
  detail: string
}

interface FastStockInModalProps {
  branchOptions: Array<{ value: string; label: string }>
  defaultBranchId?: string | number | null
  tr: TranslationWithFallback
  notify: (message: string, kind?: string) => void
  onClose: () => void
  onDone: () => void
  // F3 slice 2: park this shipment as a chip; the draft (slice 1) already
  // holds everything, so minimize is just "close without finishing".
  onMinimize?: (label: string) => void
}

function todayMmDdYyyy(): string {
  const now = new Date()
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`
}

// F3 slice 1: the batch-in flow persists like add-product does -- the
// shipment header and the in-progress line survive navigation/reload via
// the shared store. The received log deliberately does NOT persist: those
// lines are already server truth (each Add committed them).
const FAST_STOCKIN_DRAFT_KEY = 'bos_draft_fast_stockin'

type FastStockInDraft = {
  branchId: string
  receivedDate: string
  supplier: SupplierChoice
  paymentStatus: 'paid' | 'credit'
  creditDueDate: string
  query: string
  picked: ProductCandidate | null
  quantity: string
  unitCost: string
  expiryDate: string
}

export default function FastStockInModal({ branchOptions, defaultBranchId, tr, notify, onClose, onDone, onMinimize }: FastStockInModalProps) {
  // ---- shipment header (entered once, applies to every line) ----
  const draftRef = useRef<FastStockInDraft | null>(readWorkDraft<FastStockInDraft>(FAST_STOCKIN_DRAFT_KEY)?.data ?? null)
  const draft = draftRef.current
  const [branchId, setBranchId] = useState<string>(draft?.branchId || (defaultBranchId != null ? String(defaultBranchId) : (branchOptions[0]?.value || '')))
  const [receivedDate, setReceivedDate] = useState<string>(draft?.receivedDate || todayMmDdYyyy())
  const [supplier, setSupplier] = useState<SupplierChoice>(draft?.supplier || { supplierId: null, supplierName: '' })
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>(draft?.paymentStatus || 'paid')
  const [creditDueDate, setCreditDueDate] = useState(draft?.creditDueDate || '')

  // ---- per-line entry ----
  const [query, setQuery] = useState(draft?.query || '')
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [picked, setPicked] = useState<ProductCandidate | null>(draft?.picked || null)
  const [quantity, setQuantity] = useState(draft?.quantity || '1')
  const [unitCost, setUnitCost] = useState(draft?.unitCost || '')
  const [expiryDate, setExpiryDate] = useState(draft?.expiryDate || '')
  const [saving, setSaving] = useState(false)
  const [received, setReceived] = useState<ReceivedLine[]>([])
  const searchSeqRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Autosave the header + in-progress line (debounced, shared cadence).
  // Deliberately NO dirtyWork registration: with the draft persisting,
  // leaving is SAFE -- everything is exactly here on reopen -- so the
  // three-option navigation guard would only nag about work that cannot
  // be lost. (Per-Add lines were server-committed the moment they ran.)
  useEffect(() => {
    return scheduleWorkDraftWrite<FastStockInDraft>(FAST_STOCKIN_DRAFT_KEY, {
      branchId, receivedDate, supplier, paymentStatus, creditDueDate,
      query, picked, quantity, unitCost, expiryDate,
    })
  }, [branchId, receivedDate, supplier, paymentStatus, creditDueDate, query, picked, quantity, unitCost, expiryDate])

  useEffect(() => {
    const text = query.trim()
    if (picked || text.length < 2) { setCandidates([]); return }
    const seq = ++searchSeqRef.current
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchProducts({ query: text, pageSize: 8 }) as { items?: ProductCandidate[] }
        if (seq !== searchSeqRef.current) return
        setCandidates(Array.isArray(payload?.items) ? payload.items : [])
      } catch { /* suggestions only -- typing again retries */ }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, picked])

  const pick = (candidate: ProductCandidate) => {
    setPicked(candidate)
    setCandidates([])
    setQuery(String(candidate.name || ''))
    const cost = Number(candidate.cost_price_usd)
    if (Number.isFinite(cost) && cost > 0) setUnitCost(String(cost))
  }

  const resetLine = () => {
    setPicked(null)
    setQuery('')
    setQuantity('1')
    setUnitCost('')
    setExpiryDate('')
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const addLine = async () => {
    if (saving) return
    const qty = Math.floor(Number(quantity)) || 0
    if (!picked) { notify(tr('fast_stockin_pick_product', 'Pick a product first'), 'error'); return }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (qty <= 0) { notify(tr('fast_stockin_qty', 'Quantity must be at least 1'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate.trim()) {
      notify(tr('fast_stockin_credit_due', 'On-credit stock needs a due date'), 'error')
      return
    }
    setSaving(true)
    const lineName = String(picked.name || `#${picked.id}`)
    try {
      const result = await receiveBatchStock({
        productId: Number(picked.id),
        branchId: Number(branchId),
        quantity: qty,
        receivedDate: receivedDate.trim() || null,
        expiryDate: expiryDate.trim() || null,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName.trim() || null,
        unitCostUsd: Number(unitCost) > 0 ? Number(unitCost) : null,
        paymentStatus,
        creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
      })
      setReceived((prev) => [{
        key: `${picked.id}-${Date.now()}`,
        productName: lineName,
        quantity: qty,
        ok: true,
        detail: result?.lotCode ? `${tr('lot', 'lot')} ${result.lotCode}` : tr('received', 'received'),
      }, ...prev])
      resetLine()
    } catch (error) {
      // The failed line STAYS in the form (nothing was written for it) and
      // the failure is recorded in the list -- retry or change and re-Add.
      const message = error instanceof Error ? error.message : tr('error', 'Error')
      setReceived((prev) => [{
        key: `${picked.id}-${Date.now()}`,
        productName: lineName,
        quantity: qty,
        ok: false,
        detail: message,
      }, ...prev])
      notify(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const successCount = received.filter((line) => line.ok).length
  // X/backdrop keep the draft (reopen later, shipment intact); only the
  // explicit Done button completes the batch and clears it.
  const closeIfIdle = () => { if (!saving) { if (successCount > 0) onDone(); onClose() } }
  const finishAndClose = () => {
    if (saving) return
    clearWorkDraft(FAST_STOCKIN_DRAFT_KEY)
    if (successCount > 0) onDone()
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="flex max-h-modal-92 w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">⚡ {tr('fast_stockin_title', 'Fast stock-in')}</h2>
          <div className="flex items-center gap-1">
            {onMinimize ? (
              <button type="button" disabled={saving}
                onClick={() => { if (!saving) { onMinimize(tr('fast_stockin_title', 'Fast stock-in')); onClose() } }}
                aria-label={tr('minimize', 'Minimize')}
                title={tr('minimize_hint', 'Minimize — continue later from the chip')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-700">
                <span className="text-base leading-none">−</span>
              </button>
            ) : null}
            <button type="button" onClick={closeIfIdle} disabled={saving} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="modal-scroll space-y-4 p-4">
          {/* shipment header -- once */}
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('fast_stockin_header', 'This shipment (applies to every line)')}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('branch', 'Branch')}</span>
                <AppSelect
                  value={branchId}
                  onChange={(next) => setBranchId(next)}
                  ariaLabel={tr('branch', 'Branch')}
                  buttonClassName="h-10 w-full text-sm"
                  optionClassName="text-sm"
                  options={branchOptions}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('received_date', 'Received date')}</span>
                <input className="input w-full text-sm" placeholder="mm/dd/yyyy" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} />
              </label>
              <SupplierPickerField
                value={supplier}
                onChange={setSupplier}
                tr={tr}
                idPrefix="fast-stockin"
                hint={tr('fast_stockin_supplier_hint', 'Recorded on every lot this session receives (first attribution sticks).')}
              />
              <div>
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('payment', 'Payment')}</span>
                <div className="flex gap-1.5">
                  {(['paid', 'credit'] as const).map((mode) => (
                    <button key={mode} type="button"
                      onClick={() => setPaymentStatus(mode)}
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${paymentStatus === mode
                        ? 'border-blue-500 bg-blue-100/70 font-semibold text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400'}`}>
                      {mode === 'paid' ? tr('paid', 'Paid') : tr('on_credit', 'On credit')}
                    </button>
                  ))}
                  {paymentStatus === 'credit' ? (
                    <input className="input flex-1 text-sm" placeholder={`${tr('due', 'due')} mm/dd/yyyy`} value={creditDueDate} onChange={(event) => setCreditDueDate(event.target.value)} />
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* per-product line */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              {tr('fast_stockin_line', 'Next product')}
            </div>
            <div className="relative">
              <input
                ref={searchInputRef}
                className="input w-full text-sm"
                placeholder={tr('fast_stockin_search', 'Type a product name or barcode…')}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPicked(null) }}
                autoFocus
              />
              {candidates.length > 0 ? (
                <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  {candidates.map((candidate) => (
                    <button key={candidate.id} type="button"
                      onClick={() => pick(candidate)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                      <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">{candidate.name}</span>
                      <span className="flex-shrink-0 text-[10px] text-gray-400">{candidate.barcode || ''} · {Number(candidate.stock_quantity) || 0}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {picked ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('quantity', 'Qty')}</span>
                  <input type="number" min="1" step="1" className="input w-20 text-center text-sm" value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void addLine() }} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('unit_cost_usd', 'Unit cost $')}</span>
                  <input type="number" min="0" step="0.01" className="input w-24 text-sm" value={unitCost}
                    onChange={(event) => setUnitCost(event.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_optional', 'Expiry (optional)')}</span>
                  <input className="input w-32 text-sm" placeholder="mm/dd/yyyy" value={expiryDate}
                    onChange={(event) => setExpiryDate(event.target.value)} />
                </label>
                <button type="button" className="btn-primary flex-1 text-sm disabled:opacity-50" disabled={saving} onClick={() => void addLine()}>
                  {saving ? `⏳ ${tr('saving_label', 'Saving…')}` : `＋ ${tr('fast_stockin_add', 'Add & next')}`}
                </button>
              </div>
            ) : null}
          </div>

          {/* what landed */}
          {received.length > 0 ? (
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {tr('fast_stockin_received', 'Received this session')} ({successCount})
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {received.map((line) => (
                  <div key={line.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                      {line.ok ? '✅' : '⚠️'} {line.productName} × {line.quantity}
                    </span>
                    <span className={`flex-shrink-0 text-[10px] ${line.ok ? 'text-gray-400' : 'text-red-500'}`}>{line.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button type="button" className="btn-secondary w-full text-sm" disabled={saving} onClick={finishAndClose}>
            ✓ {tr('fast_stockin_done', 'Done')}{successCount > 0 ? ` — ${successCount} ${tr('lines_received', 'line(s) received')}` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
