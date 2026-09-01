// F2 (Part 419): fast stock-in -- one shipment's header (branch, received
// date, supplier, paid/credit) entered ONCE, then rapid per-product lines:
// type a name, pick the row, quantity/cost/expiry, and queue it. Queued
// lines remain editable/removable until Complete writes them through the
// same receiveBatchStock kernel used by every other add-stock surface.
// Each outcome stays visible, so a partial failure can be fixed and retried.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AppSelect from '../shared/AppSelect.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import { receiveBatchStock } from '../../api/batchesTransport.ts'
import { adjustStock } from '../../api/inventoryWriteTransport.ts'
import { searchProducts } from '../../api/methods.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft } from '../../utils/workDrafts.ts'

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

interface ProductCandidate {
  id: number | string
  name?: string | null
  barcode?: string | null
  stock_quantity?: number | string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  purchase_price_usd?: number | string | null
  purchase_price_khr?: number | string | null
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  special_price_usd?: number | string | null
  special_price_khr?: number | string | null
  discount_enabled?: boolean | number | null
  discount_type?: string | null
  discount_percent?: number | string | null
  discount_amount_usd?: number | string | null
}

interface ReceivedLine {
  key: string
  product: ProductCandidate
  productName: string
  quantity: number
  unitCost: string
  createPriceVariant: boolean
  expiryDate: string
  status: 'queued' | 'saving' | 'saved' | 'error'
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
  initialHeader?: Partial<Pick<FastStockInDraft, 'branchId' | 'receivedDate' | 'supplier' | 'paymentStatus' | 'creditDueDate'>>
}

// F3 slice 1: the batch-in flow persists like add-product does -- the
// shipment header, in-progress line, and queued lines survive navigation/
// reload via the shared store.
const FAST_STOCKIN_DRAFT_KEY = 'bos_draft_fast_stockin'

type FastStockInDraft = {
  sessionId?: number
  branchId: string
  receivedDate: string
  supplier: SupplierChoice
  paymentStatus: 'paid' | 'credit'
  creditDueDate: string
  query: string
  picked: ProductCandidate | null
  quantity: string
  unitCost: string
  createPriceVariant?: boolean
  expiryDate: string
  lines?: ReceivedLine[]
}

export default function FastStockInModal({ branchOptions, defaultBranchId, tr, notify, onClose, onDone, onMinimize, initialHeader }: FastStockInModalProps) {
  // ---- shipment header (entered once, applies to every line) ----
  const draftRef = useRef<FastStockInDraft | null>(readWorkDraft<FastStockInDraft>(FAST_STOCKIN_DRAFT_KEY)?.data ?? null)
  const draft = draftRef.current
  const [branchId, setBranchId] = useState<string>(draft?.branchId || initialHeader?.branchId || (defaultBranchId != null ? String(defaultBranchId) : (branchOptions[0]?.value || '')))
  const [receivedDate, setReceivedDate] = useState<string>(draft?.receivedDate || initialHeader?.receivedDate || '')
  const [supplier, setSupplier] = useState<SupplierChoice>(draft?.supplier || initialHeader?.supplier || { supplierId: null, supplierName: '' })
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>(draft?.paymentStatus || initialHeader?.paymentStatus || 'paid')
  const [creditDueDate, setCreditDueDate] = useState(draft?.creditDueDate || initialHeader?.creditDueDate || '')

  // ---- per-line entry ----
  const [query, setQuery] = useState(draft?.query || '')
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [picked, setPicked] = useState<ProductCandidate | null>(draft?.picked || null)
  const [quantity, setQuantity] = useState(draft?.quantity || '1')
  const [unitCost, setUnitCost] = useState(draft?.unitCost || '')
  const [createPriceVariant, setCreatePriceVariant] = useState(Boolean(draft?.createPriceVariant))
  const [expiryDate, setExpiryDate] = useState(draft?.expiryDate || '')
  const [saving, setSaving] = useState(false)
  const [received, setReceived] = useState<ReceivedLine[]>(draft?.lines || [])
  const [editingKey, setEditingKey] = useState('')
  const searchSeqRef = useRef(0)
  const sessionIdRef = useRef(draft?.sessionId || Date.now())
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Autosave the header + in-progress line (debounced, shared cadence).
  // Deliberately NO dirtyWork registration: with the draft persisting,
  // leaving is SAFE -- everything is exactly here on reopen -- so the
  // three-option navigation guard would only nag about work that cannot
  // be lost.
  useEffect(() => {
    return scheduleWorkDraftWrite<FastStockInDraft>(FAST_STOCKIN_DRAFT_KEY, {
      sessionId: sessionIdRef.current,
      branchId, receivedDate, supplier, paymentStatus, creditDueDate,
      query, picked, quantity, unitCost, createPriceVariant, expiryDate, lines: received,
    })
  }, [branchId, receivedDate, supplier, paymentStatus, creditDueDate, query, picked, quantity, unitCost, createPriceVariant, expiryDate, received])

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
    setCreatePriceVariant(false)
  }

  const resetLine = () => {
    setPicked(null)
    setQuery('')
    setQuantity('1')
    setUnitCost('')
    setCreatePriceVariant(false)
    setExpiryDate('')
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const addLine = () => {
    if (saving) return
    const qty = Math.floor(Number(quantity)) || 0
    if (!picked) { notify(tr('fast_stockin_pick_product', 'Pick a product first'), 'error'); return }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (qty <= 0) { notify(tr('fast_stockin_qty', 'Quantity must be at least 1'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate.trim()) {
      notify(tr('fast_stockin_credit_due', 'On-credit stock needs a due date'), 'error')
      return
    }
    const lineName = String(picked.name || `#${picked.id}`)
    const next: ReceivedLine = {
        key: editingKey || `${picked.id}-${Date.now()}`,
        product: picked,
        productName: lineName,
        quantity: qty,
        unitCost,
        createPriceVariant: costChanged(picked, unitCost) && createPriceVariant,
        expiryDate,
        status: 'queued',
        detail: tr('ready_to_receive', 'Ready'),
    }
    setReceived((prev) => editingKey
      ? prev.map((line) => line.key === editingKey ? next : line)
      : [next, ...prev])
    setEditingKey('')
    resetLine()
  }

  const editLine = (line: ReceivedLine) => {
    if (saving || line.status === 'saved') return
    setEditingKey(line.key)
    setPicked(line.product)
    setQuery(line.productName)
    setQuantity(String(line.quantity))
    setUnitCost(line.unitCost)
    setCreatePriceVariant(line.createPriceVariant)
    setExpiryDate(line.expiryDate)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const removeLine = (key: string) => {
    if (saving) return
    setReceived((prev) => prev.filter((line) => line.key !== key))
    if (editingKey === key) { setEditingKey(''); resetLine() }
  }

  const commitSession = async () => {
    if (saving) return
    const pending = received.filter((line) => line.status !== 'saved')
    if (!pending.length) {
      if (received.some((line) => line.status === 'saved')) onDone()
      clearWorkDraft(FAST_STOCKIN_DRAFT_KEY)
      onClose()
      return
    }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate.trim()) { notify(tr('fast_stockin_credit_due', 'On-credit stock needs a due date'), 'error'); return }
    setSaving(true)
    let failed = 0
    for (const line of pending) {
      setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'saving' } : item))
      try {
        const result = line.createPriceVariant
          ? await adjustStock({
              productId: Number(line.product.id), type: 'add', quantity: line.quantity,
              reason: tr('stock_in_session_reason', 'Stock-in session'), branchId: Number(branchId),
              unlockPricing: true,
              receivedDate: receivedDate.trim() || null, expiryDate: line.expiryDate.trim() || null,
              supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
              unitCostUsd: Number(line.unitCost), paymentStatus,
              creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
              sessionId: sessionIdRef.current,
              pricing: pricingForVariant(line.product, Number(line.unitCost)),
            }) as { batchNumber?: number | null; lotCode?: string | null; createdSibling?: boolean }
          : await receiveBatchStock({
              productId: Number(line.product.id), branchId: Number(branchId), quantity: line.quantity,
              receivedDate: receivedDate.trim() || null, expiryDate: line.expiryDate.trim() || null,
              supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
              unitCostUsd: Number(line.unitCost) >= 0 && line.unitCost !== '' ? Number(line.unitCost) : null,
              paymentStatus, creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
              sessionId: sessionIdRef.current,
            })
        setReceived((prev) => prev.map((item) => item.key === line.key ? {
          ...item, status: 'saved', detail: result?.lotCode
            ? `${tr('lot', 'lot')} ${result.lotCode}`
            : line.createPriceVariant
              ? tr('price_variant_received', 'Price variant received')
              : tr('received', 'Received'),
        } : item))
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : tr('error', 'Error')
        setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'error', detail: message } : item))
      }
    }
    setSaving(false)
    onDone()
    if (failed) { notify(tr('stock_session_partial', `${failed} line(s) could not be saved. Fix them and complete again.`), 'error'); return }
    clearWorkDraft(FAST_STOCKIN_DRAFT_KEY)
    onClose()
  }

  const successCount = received.filter((line) => line.status === 'saved').length
  // X/backdrop keep the draft (reopen later, shipment intact); only the
  // explicit Done button completes the batch and clears it.
  const closeIfIdle = () => { if (!saving) { if (successCount > 0) onDone(); onClose() } }

  return createPortal(
    <div className="fixed inset-0 z-[1050] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="flex max-h-modal-92 w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-2xl sm:rounded-2xl sm:pb-0 dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
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
          {/* Search comes first on phones and desktops; shipment details sit below it. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              {editingKey ? tr('edit_stock_line', 'Edit product line') : tr('fast_stockin_line', 'Next product')}
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input ref={searchInputRef} className="input w-full text-sm" placeholder={tr('fast_stockin_search', 'Type a product name or barcode…')} value={query}
                  onChange={(event) => { setQuery(event.target.value); setPicked(null); setEditingKey('') }} autoFocus />
                {candidates.length > 0 ? (
                  <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                    {candidates.map((candidate) => (
                      <button key={candidate.id} type="button" onClick={() => pick(candidate)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                        <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">{candidate.name}</span>
                        <span className="flex-shrink-0 text-[10px] text-gray-400">{candidate.barcode || ''} · {Number(candidate.stock_quantity) || 0}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <ScanSearchButton onDetected={(value) => { setQuery(value); setPicked(null); setEditingKey('') }} t={(key) => tr(key, key)} showLabel />
            </div>
            {picked ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[5rem_6rem_8rem_1fr] sm:items-end">
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('quantity', 'Qty')}</span><input type="number" min="1" step="1" className="input text-center text-sm" value={quantity} onChange={(event) => setQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addLine() }} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('unit_cost_usd', 'Unit cost $')}</span><input type="number" min="0" step="0.01" className="input text-sm" value={unitCost} onChange={(event) => {
                  const next = event.target.value
                  setUnitCost(next)
                  setCreatePriceVariant(costChanged(picked, next))
                }} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_optional', 'Expiry (optional)')}</span><input className="input text-sm" placeholder="mm/dd/yyyy" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
                <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={saving} onClick={addLine}>＋ {editingKey ? tr('save_changes', 'Save changes') : tr('fast_stockin_add', 'Add & next')}</button>
                {costChanged(picked, unitCost) ? (
                  <label className="col-span-2 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-4 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={createPriceVariant} onChange={(event) => setCreatePriceVariant(event.target.checked)} />
                    <span><strong>{tr('create_price_variant', 'Create/use a price variant')}</strong><br />{tr('create_price_variant_hint', `The cost changed from $${currentCost(picked).toFixed(2)} to $${Number(unitCost || 0).toFixed(2)}. Keep this on a separate product row with the same name and details.`)}</span>
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>

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

          {/* what landed */}
          {received.length > 0 ? (
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {tr('fast_stockin_received', 'Received this session')} ({successCount})
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {received.map((line) => (
                  <div key={line.key} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900/50">
                    <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                      {line.status === 'saved' ? '✅' : line.status === 'error' ? '⚠️' : line.status === 'saving' ? '⏳' : '•'} {line.productName} × {line.quantity}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`text-[10px] ${line.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>{line.detail}</span>
                      {line.status !== 'saved' ? <button type="button" disabled={saving} onClick={() => editLine(line)} className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-blue-600 dark:hover:bg-gray-700" aria-label={tr('edit', 'Edit')}><Pencil className="h-3.5 w-3.5" /></button> : null}
                      {line.status !== 'saved' ? <button type="button" disabled={saving} onClick={() => removeLine(line.key)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" aria-label={tr('remove', 'Remove')}><Trash2 className="h-3.5 w-3.5" /></button> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button type="button" className="btn-primary w-full text-sm" disabled={saving || !received.length} onClick={() => void commitSession()}>
            {saving ? `⏳ ${tr('saving_label', 'Saving…')}` : `✓ ${tr('complete_stock_session', 'Complete stock-in session')}`}{successCount > 0 ? ` — ${successCount} ${tr('lines_received', 'line(s) received')}` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function currentCost(product: ProductCandidate): number {
  return Number(product.cost_price_usd ?? product.purchase_price_usd ?? 0) || 0
}

function costChanged(product: ProductCandidate, next: string): boolean {
  if (next.trim() === '' || !Number.isFinite(Number(next))) return false
  return Math.round(currentCost(product) * 100) !== Math.round(Number(next) * 100)
}

function pricingForVariant(product: ProductCandidate, costUsd: number): Record<string, unknown> {
  return {
    selling_price_usd: Number(product.selling_price_usd) || 0,
    selling_price_khr: Number(product.selling_price_khr) || 0,
    special_price_usd: Number(product.special_price_usd) || 0,
    special_price_khr: Number(product.special_price_khr) || 0,
    discount_enabled: Boolean(product.discount_enabled),
    discount_type: product.discount_type || 'percent',
    discount_percent: Number(product.discount_percent) || 0,
    discount_amount_usd: Number(product.discount_amount_usd) || 0,
    cost_usd: costUsd,
    cost_khr: Number(product.cost_price_khr ?? product.purchase_price_khr ?? 0) || 0,
    barcode: product.barcode || null,
  }
}
