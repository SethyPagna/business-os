// ── NewReturnModal ───────────────────────────────────────────────────────────
import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import { fmtTime } from '../../utils/formatters'
import {
  beginTrackedRequest,
  getLoaderErrorMessage,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { searchProducts } from '../../api/methods.ts'
import { STOCK_ACTION_OPTIONS, computeSettlementPreview, describeBatchOption, stockActionOption, type ReturnStockAction } from './helpers/returnOptions.ts'
import { normalizeReturnReasonList } from './helpers/returnReasonPresets.ts'
import { useReturnReasonPresets } from './helpers/useReturnReasonPresets.ts'

const RETURN_SALE_SEARCH_TIMEOUT_MS = 12000
const RETURN_HISTORY_LOOKUP_TIMEOUT_MS = 10000
const RETURN_CREATE_TIMEOUT_MS = 15000

type ModalStep = 'search' | 'items' | 'confirm'
type NoticeKind = 'success' | 'error' | 'info' | 'warning' | string
type MoneyFormatter = (value: number | string) => string
type ReturnType = 'restock' | 'writeoff' | 'refund'
type TranslateFn = (key: string) => string | undefined

interface AppUser {
  id?: number | string | null
  name?: string | null
  username?: string | null
}

interface SaleItemRow {
  id?: number | string | null
  product_id?: number | string | null
  product_name?: string | null
  name?: string | null
  quantity?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  purchase_price_khr?: number | string | null
  branch_id?: number | string | null
}

interface SaleReturnItem extends SaleItemRow {
  alreadyQty: number
  remaining: number
  returnQty: number
  included: boolean
  return_to_stock: boolean
  // 11.13: the ONE per-item chooser -- what happens to this item's stock.
  // return_to_stock stays derived from it (restock <=> true) for the wire.
  stock_action: ReturnStockAction
}

// A replacement is a normal sale line linked to this return. It may be any
// catalog product and is selected with the same name/barcode search as POS.
interface ReplacementCandidate {
  id: number | string
  name?: string | null
  sku?: string | null
  barcode?: string | null
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
}

interface ReplacementLine {
  key: string
  product_id: number | string
  product_name: string
  branch_id: number | string | null
  batch_id: number | null
  batches: ProductBatch[]
  candidates: ReplacementCandidate[]
  search_query: string
  searching: boolean
  searched: boolean
  quantity: number
  price_usd: number
  price_khr: number
}

interface SaleRow {
  id?: number | string | null
  receipt_number?: string | null
  customer_name?: string | null
  branch_id?: number | string | null
  exchange_rate?: number | string | null
  total_usd?: number | string | null
  created_at?: string | number | Date | null
  items?: SaleItemRow[] | null
}

interface ExistingReturnRow {
  status?: string | null
  items?: Array<{
    sale_item_id?: number | string | null
    product_id?: number | string | null
    quantity?: number | string | null
  }> | null
}

interface ReturnCreatePayload extends Record<string, unknown> {
  sale_id: number | string | null
  receipt_number: string | null
  cashier_id: number | string | null | undefined
  cashier_name: string | null | undefined
  customer_name: string | null
  branch_id: number | string | null
  reason: string
  return_type: ReturnType
  notes: string | null
  total_refund_usd: number
  total_refund_khr: number
  exchange_rate: number
  items: Array<{
    sale_item_id: number | string | null
    product_id: number | string | null | undefined
    product_name: string | null | undefined
    quantity: number
    applied_price_usd: number
    applied_price_khr: number
    cost_price_usd: number
    cost_price_khr: number
    return_to_stock: boolean
    stock_action: ReturnStockAction
    branch_id: number | string | null
  }>
}

interface NewReturnModalProps {
  onClose: () => void
  onSuccess?: (result?: unknown) => void | Promise<void>
  fmtUSD: MoneyFormatter
  notify: (message: string, kind?: NoticeKind) => void
}

type ReturnedQuantityMap = Record<string, number>

const useApp = useAppHook as () => {
  user?: AppUser | null
  t?: TranslateFn
  getPermissionTier?: (key: string) => string
}

type SalesTransportModule = typeof import('../../api/salesTransport.ts')
type ReturnsTransportModule = typeof import('../../api/returnsTransport.ts')
type ReturnsReadTransportModule = typeof import('../../api/returnsReadTransport.ts')

let salesTransportPromise: Promise<SalesTransportModule> | null = null
let returnsTransportPromise: Promise<ReturnsTransportModule> | null = null
let returnsReadTransportPromise: Promise<ReturnsReadTransportModule> | null = null

function loadSalesTransport(): Promise<SalesTransportModule> {
  if (!salesTransportPromise) salesTransportPromise = import('../../api/salesTransport.ts')
  return salesTransportPromise
}

function loadReturnsTransport(): Promise<ReturnsTransportModule> {
  if (!returnsTransportPromise) returnsTransportPromise = import('../../api/returnsTransport.ts')
  return returnsTransportPromise
}

function loadReturnsReadTransport(): Promise<ReturnsReadTransportModule> {
  if (!returnsReadTransportPromise) returnsReadTransportPromise = import('../../api/returnsReadTransport.ts')
  return returnsReadTransportPromise
}

async function searchReturnSales(options: { limit: number }): Promise<SaleRow[]> {
  const { getSales } = await loadSalesTransport()
  const rows = await getSales(options)
  return (Array.isArray(rows) ? rows : []) as SaleRow[]
}

async function loadExistingSaleReturns(saleId: number | string | null | undefined): Promise<ExistingReturnRow[]> {
  const { getReturns } = await loadReturnsReadTransport()
  const rows = await getReturns({ saleId })
  return (Array.isArray(rows) ? rows : []) as ExistingReturnRow[]
}

async function createReturnRequest(payload: ReturnCreatePayload): Promise<unknown> {
  const { createReturn } = await loadReturnsTransport()
  return createReturn(payload)
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampReturnQuantity(value: unknown, maxQuantity: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value || ''))
  const safeQuantity = Number.isFinite(parsed) ? parsed : 0
  return Math.max(0, Math.min(maxQuantity, safeQuantity))
}

function getSaleItemKey(item: SaleItemRow): string {
  return String(item.id || `p_${item.product_id}`)
}

export default function NewReturnModal({ onClose, onSuccess, fmtUSD, notify }: NewReturnModalProps) {
  const { user, t, getPermissionTier } = useApp()
  const T = (key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : undefined
    return value && value !== key ? value : fallback
  }

  const OTHER_LABEL = T('reason_other', 'Other')
  const returnReasonPresets = useReturnReasonPresets(t)
  const RETURN_REASONS = normalizeReturnReasonList([...returnReasonPresets.customer, OTHER_LABEL])

  const [step,          setStep]          = useState<ModalStep>('search')
  const [searchQuery,   setSearchQuery]   = useState('')
  const [foundSale,     setFoundSale]     = useState<SaleRow | null>(null)
  const [searching,     setSearching]     = useState(false)
  const [selectedItems, setSelectedItems] = useState<SaleReturnItem[]>([])
  const [reason,        setReason]        = useState(RETURN_REASONS[0])
  const [customReason,  setCustomReason]  = useState('')
  const [returnType,    setReturnType]    = useState<ReturnType>('restock')
  const [notes,         setNotes]         = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const searchRequestRef = useRef(0)
  const searchInFlightRef = useRef(false)
  const submitInFlightRef = useRef(false)
  const [replacements, setReplacements] = useState<ReplacementLine[]>([])
  const [settleDifference, setSettleDifference] = useState(false)
  const isKnownReason = RETURN_REASONS.includes(reason)
  useEffect(() => {
    if (!reason || reason === OTHER_LABEL || isKnownReason) return
    setCustomReason((current) => current || reason)
    setReason(OTHER_LABEL)
  }, [OTHER_LABEL, isKnownReason, reason])
  // Locked note: "Non-default price adjustment requires full access and an
  // explicit preview" -- the checkbox below IS the explicit preview, and
  // it only unlocks for Full Access to Returns.
  const canSettleDifference = getPermissionTier?.('returns') === 'full'

  const loadReplacementBatches = async (lineKey: string, productId: number | string, branchId: number | string | null) => {
    if (!branchId) return
    try {
      const { batches } = await getProductBatches(productId, branchId, true)
      setReplacements((prev) => prev.map((line) => line.key === lineKey
        ? { ...line, batches: (Array.isArray(batches) ? batches : []).filter((batch) => (Number(batch.quantity) || 0) > 0) }
        : line))
    } catch { /* the lot picker is a nicety -- "any stock" still works */ }
  }

  const addReplacementFor = (item: SaleReturnItem) => {
    if (!item.product_id) return
    const name = String(item.product_name || item.name || '').trim()
    const branchId = item.branch_id || foundSale?.branch_id || null
    const key = `rep_${item.product_id}_${Date.now()}`
    setReplacements((prev) => [...prev, {
      key,
      product_id: item.product_id as number | string,
      product_name: name,
      branch_id: branchId,
      batch_id: null,
      batches: [],
      candidates: [],
      search_query: '',
      searching: false,
      searched: false,
      quantity: item.returnQty || 1,
      // Seed with the returned row at the paid price for a quick even swap.
      // A catalog search can then replace it with any other product/price.
      price_usd: toNumber(item.applied_price_usd),
      price_khr: toNumber(item.applied_price_khr),
    }])
    void loadReplacementBatches(key, item.product_id, branchId)
  }

  const pickReplacementRow = (lineKey: string, candidate: ReplacementCandidate) => {
    let branchForBatches: number | string | null = null
    setReplacements((prev) => prev.map((line) => {
      if (line.key !== lineKey) return line
      branchForBatches = line.branch_id
      return {
        ...line,
        product_id: candidate.id,
        product_name: String(candidate.name || line.product_name),
        batch_id: null,
        batches: [],
        price_usd: toNumber(candidate.selling_price_usd),
        price_khr: toNumber(candidate.selling_price_khr),
      }
    }))
    void loadReplacementBatches(lineKey, candidate.id, branchForBatches || foundSale?.branch_id || null)
  }

  const updateReplacement = (lineKey: string, patch: Partial<ReplacementLine>) => {
    setReplacements((prev) => prev.map((line) => line.key === lineKey ? { ...line, ...patch } : line))
  }

  const searchReplacementCatalog = async (lineKey: string, scannedQuery?: string) => {
    const line = replacements.find((entry) => entry.key === lineKey)
    const query = scannedQuery?.trim() || line?.search_query.trim() || ''
    if (!line || !query || line.searching) return
    updateReplacement(lineKey, { search_query: query, searching: true })
    try {
      const payload = await searchProducts({ query, page: 1, pageSize: 30 }) as { items?: ReplacementCandidate[] }
      const rows = Array.isArray(payload?.items) ? payload.items : []
      // Project rule (barcode-scan-select-then-confirm): a scan NEVER
      // auto-picks a product on any surface. The scanned/typed code becomes
      // the query and narrows this line's candidate list -- the operator
      // still chooses the row, because a replacement changes what the
      // customer walks out with and what the linked sale charges.
      updateReplacement(lineKey, { candidates: rows, searching: false, searched: true })
    } catch (error) {
      updateReplacement(lineKey, { searching: false, searched: true })
      notify(`${T('search_error', 'Search error')}: ${getLoaderErrorMessage(error, T('error', 'Error'))}`, 'error')
    }
  }
  const removeReplacement = (lineKey: string) => setReplacements((prev) => prev.filter((line) => line.key !== lineKey))

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    if (!beginSingleAction(searchInFlightRef)) return
    const requestId = beginTrackedRequest(searchRequestRef)
    setSearching(true)
    try {
      const sales = await withLoaderTimeout(
        () => searchReturnSales({ limit: 500 }),
        'Return sale search',
        RETURN_SALE_SEARCH_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(searchRequestRef, requestId)) return
      const q = searchQuery.trim().toLowerCase()
      const found = sales.find((s) =>
        s.receipt_number?.toLowerCase().includes(q) || String(s.id) === q
      )
      if (found) {
        const items = Array.isArray(found.items) ? found.items : []
        const alreadyReturned: ReturnedQuantityMap = {}
        try {
          const existingReturns = await withLoaderTimeout(
            () => loadExistingSaleReturns(found.id),
            'Return history lookup',
            RETURN_HISTORY_LOOKUP_TIMEOUT_MS,
          )
          if (!isTrackedRequestCurrent(searchRequestRef, requestId)) return
          ;(existingReturns || []).forEach((ret) => {
            if ((ret.status || 'completed') === 'cancelled') return
            ;(ret.items || []).forEach((ri) => {
              const key = ri.sale_item_id || `p_${ri.product_id}`
              alreadyReturned[key] = (alreadyReturned[key] || 0) + toNumber(ri.quantity)
            })
          })
        } catch (error) {
          if (!isTrackedRequestCurrent(searchRequestRef, requestId)) return
          notify(
            T('return_history_lookup_failed', 'Could not verify previous returns for this sale. Please try again before creating a return.'),
            'error',
          )
          return
        }
        if (!isTrackedRequestCurrent(searchRequestRef, requestId)) return
        setFoundSale(found)
        setSelectedItems(items.map((item) => {
          const key = getSaleItemKey(item)
          const alreadyQty = alreadyReturned[key] || 0
          const remaining = Math.max(0, toNumber(item.quantity) - alreadyQty)
          return { ...item, alreadyQty, remaining, returnQty: 0, included: remaining > 0, return_to_stock: true, stock_action: 'restock' as ReturnStockAction }
        }))
        setStep('items')
      } else {
        if (!isTrackedRequestCurrent(searchRequestRef, requestId)) return
        notify(T('sale_not_found', 'Sale not found. Try the receipt number or sale ID.'), 'error')
      }
    } catch (error) {
      if (!isTrackedRequestCurrent(searchRequestRef, requestId)) return
      notify((T('search_error','Search error') || T('error','Error')) + ': ' + getLoaderErrorMessage(error, T('error', 'Error')), 'error')
    } finally {
      if (isTrackedRequestCurrent(searchRequestRef, requestId)) {
        finishSingleAction(searchInFlightRef)
        setSearching(false)
      }
    }
  }

  const handleReturnTypeChange = (v: ReturnType) => {
    setReturnType(v)
    const action: ReturnStockAction = v === 'restock' ? 'restock' : 'none'
    setSelectedItems((prev) => prev.map((it) => ({ ...it, return_to_stock: action === 'restock', stock_action: action })))
  }

  const toggleIncluded = (idx: number) => {
    setSelectedItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it
      const nowIncluded = !it.included
      return { ...it, included: nowIncluded, returnQty: nowIncluded ? (it.remaining || 0) : 0 }
    }))
  }

  const updateItemQty = (idx: number, val: unknown) => {
    const max = toNumber(selectedItems[idx]?.remaining ?? selectedItems[idx]?.quantity ?? Number.POSITIVE_INFINITY)
    const qty = clampReturnQuantity(val, max)
    setSelectedItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, returnQty: qty, included: qty > 0 } : it
    ))
  }

  const updateItemAction = (idx: number, action: ReturnStockAction) => {
    setSelectedItems((prev) => prev.map((it, i) => i === idx ? { ...it, stock_action: action, return_to_stock: action === 'restock' } : it))
  }

  const selectAll = () => setSelectedItems((prev) => prev.map((it) =>
    it.remaining > 0 ? { ...it, included: true, returnQty: it.remaining, return_to_stock: returnType === 'restock', stock_action: (returnType === 'restock' ? 'restock' : 'none') as ReturnStockAction } : it
  ))
  const clearAll  = () => setSelectedItems((prev) => prev.map((it) => ({ ...it, included: false, returnQty: 0 })))

  const activeItems    = selectedItems.filter((it) => it.included && (it.returnQty || 0) > 0)
  const totalRefund    = activeItems.reduce((s, it) => s + toNumber(it.applied_price_usd) * it.returnQty, 0)
  const totalRefundKhr = activeItems.reduce((s, it) => s + toNumber(it.applied_price_khr) * it.returnQty, 0)
  const replacementTotalUsd = replacements.reduce((s, line) => s + line.price_usd * line.quantity, 0)
  const replacementTotalKhr = replacements.reduce((s, line) => s + line.price_khr * line.quantity, 0)
  // Mirrors the backend kernel's math exactly -- the preview and the
  // server's verdict can never disagree.
  const settlementPreview = computeSettlementPreview({ returnedTotalUsd: totalRefund, returnedTotalKhr: totalRefundKhr, replacementTotalUsd, replacementTotalKhr })
  const finalReason    = reason === OTHER_LABEL ? customReason.trim() : reason

  const handleSubmit = async () => {
    if (!activeItems.length) { notify(T('select_items_to_return','Select at least one item to return.'), 'error'); return }
    if (!finalReason) { notify(T('return_reason','Please provide a return reason.'), 'error'); return }
    if (replacements.length && !settlementPreview.isEven && !settleDifference) {
      notify(T('uneven_exchange_blocked', 'This is not an even exchange -- tick "Settle this price difference" (Full Access) or match the totals.'), 'error')
      return
    }
    if (!beginSingleAction(submitInFlightRef)) return
    setSubmitting(true)
    try {
      const result = await withLoaderTimeout(
        () => createReturnRequest({
          sale_id:          foundSale?.id   || null,
          receipt_number:   foundSale?.receipt_number || null,
          cashier_id:       user?.id,
          cashier_name:     user?.name || user?.username,
          customer_name:    foundSale?.customer_name || null,
          branch_id:        foundSale?.branch_id || null,
          reason:           finalReason,
          return_type:      returnType,
          notes:            notes || null,
          total_refund_usd: totalRefund,
          total_refund_khr: totalRefundKhr,
          exchange_rate:    toNumber(foundSale?.exchange_rate) || 4100,
          items: activeItems.map((it) => ({
            sale_item_id:      it.id || null,
            product_id:        it.product_id,
            product_name:      it.product_name || it.name,
            quantity:          it.returnQty,
            applied_price_usd: toNumber(it.applied_price_usd),
            applied_price_khr: toNumber(it.applied_price_khr),
            cost_price_usd:    toNumber(it.cost_price_usd),
            cost_price_khr:    toNumber(it.cost_price_khr || it.purchase_price_khr),
            return_to_stock:   it.return_to_stock !== false,
            stock_action:      it.stock_action,
            branch_id:         it.branch_id || foundSale?.branch_id || null,
          })),
          ...(replacements.length ? {
            replacement_items: replacements.map((line) => ({
              product_id: line.product_id,
              product_name: line.product_name,
              branch_id: line.branch_id,
              batch_id: line.batch_id,
              quantity: line.quantity,
              applied_price_usd: line.price_usd,
              applied_price_khr: line.price_khr,
            })),
            settlement_mode: settlementPreview.isEven ? 'even_exchange' : 'price_difference',
          } : {}),
        }),
        'Create return',
        RETURN_CREATE_TIMEOUT_MS,
      )
      const response = (result || {}) as { replacementReceiptNumber?: string | null }
      notify(response.replacementReceiptNumber
        ? `${T('return_processed_with_receipt', 'Return processed. Replacement sale receipt')}: ${response.replacementReceiptNumber}`
        : T('sale_complete','Return processed successfully'))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      await Promise.resolve(onSuccess?.(result))
      onClose()
    } catch (error) {
      notify((T('error','Error') || 'Error') + ': ' + getLoaderErrorMessage(error, T('error', 'Error')), 'error')
    } finally {
      finishSingleAction(submitInFlightRef)
      setSubmitting(false)
    }
  }

  const STEPS: ModalStep[] = ['search', 'items', 'confirm']
  const stepIdx = STEPS.indexOf(step)

  // Backdrop/X close should not fire while a submit is in flight -- same
  // guard ReceiveBatchModal.tsx/ManageBatchesModal.tsx/InventoryBatchModal.tsx
  // already use for this exact reason (an outside click or the X button
  // used to close the modal mid-request even though the Confirm button
  // itself was correctly disabled during `submitting`).
  const closeIfIdle = () => {
    if (!submitting) onClose()
  }

  const reviewReturn = () => {
    if (!activeItems.length) { notify(T('select_items_to_return', 'Select at least one item to return.'), 'error'); return }
    if (!finalReason) { notify(T('return_reason', 'Please provide a return reason.'), 'error'); return }
    setStep('confirm')
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="min-w-0 truncate text-lg font-bold text-gray-900 dark:text-white">↩️ {T('new_return','New Return')}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {step === 'items' ? <button type="button" onClick={reviewReturn} className="btn-primary min-h-9 max-w-28 truncate px-3 py-1.5 text-xs sm:hidden">{T('confirm','Review')}</button> : null}
            {step === 'confirm' ? <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary min-h-9 max-w-28 truncate px-3 py-1.5 text-xs sm:hidden">{submitting ? T('submitting','Processing…') : T('confirm','Confirm')}</button> : null}
            <div className="hidden items-center gap-2 sm:flex">{STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold transition-colors
                  ${i === stepIdx ? 'bg-blue-600 text-white' : i < stepIdx ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}`}>
                  {i < stepIdx ? '✓' : i + 1}
                </div>
                {i < STEPS.length - 1 && <span className="text-gray-300 dark:text-gray-600 text-xs">→</span>}
              </div>
            ))}</div>
            <button type="button" onClick={closeIfIdle} disabled={submitting} aria-label={T('close', 'Close')} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center ml-2 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="modal-scroll p-4 space-y-4">

          {/* Step 1 — Find Sale */}
          {step === 'search' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
                {T('search_receipt_hint','Enter a receipt number or sale ID. You can also skip and do a manual return.')}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  {T('search_receipt_or_id','Receipt Number or Sale ID')}
                </label>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder={T('search_receipt_or_id','e.g. 20260831-143000')}
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()} autoFocus />
                  <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
                    className="btn-primary px-4 disabled:opacity-50">
                    {searching ? '⏳' : T('btn_search','🔍 Find')}
                  </button>
                </div>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <button onClick={() => { invalidateTrackedRequest(searchRequestRef); finishSingleAction(searchInFlightRef); setSearching(false); setFoundSale(null); setSelectedItems([]); setStep('items') }}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  {T('btn_manual_return','→ Skip — manual return (no sale linked)')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Select Items */}
          {step === 'items' && (
            <div className="space-y-4">
              {foundSale ? (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
                  <div className="font-semibold text-green-700 dark:text-green-400 text-sm">✅ {foundSale.receipt_number}</div>
                  <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    {fmtTime(foundSale.created_at)} · {foundSale.customer_name || T('no_data','—')} · {fmtUSD(foundSale.total_usd || 0)}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-sm text-gray-500">
                  {T('manual_return','Manual return')} — {T('no_data','not linked to a sale')}.
                </div>
              )}

              {/* Return type */}
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                  {T('return_type_label','Handling Method')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['restock',  T('return_type_restock','↩️ Restock'),       T('return_type_restock_desc','Items back to inventory')],
                    ['writeoff', T('return_type_writeoff','🗑 Write Off'),     T('return_type_writeoff_desc','Lost / damaged goods')],
                    ['refund',   T('return_type_refund','💰 Refund Only'),     T('return_type_refund_desc','Refund with no stock change')],
                  ] as Array<[ReturnType, string, string]>).map(([v, label, desc]) => (
                    <button key={v} onClick={() => handleReturnTypeChange(v)}
                      className={`p-2 rounded-xl border-2 text-left text-xs transition-colors ${returnType === v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                      <div className={`font-semibold ${returnType === v ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{label}</div>
                      <div className="text-gray-400 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Items list */}
              {selectedItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {T('select_items_to_return','Select items to return')}
                    </label>
                    <div className="flex gap-2 text-xs">
                      <button onClick={selectAll} className="text-blue-600 hover:underline">{T('select_all','Select All')}</button>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <button onClick={clearAll} className="text-red-500 hover:underline">{T('deselect_all','Clear')}</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {selectedItems.map((item, idx) => {
                      const availableQuantity = item.remaining ?? toNumber(item.quantity)
                      const isFullyReturned = availableQuantity <= 0
                      const isIncluded = item.included && !isFullyReturned
                      return (
                        <div key={idx} className={`border rounded-xl p-3 transition-colors ${
                          isFullyReturned
                            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-60'
                            : isIncluded
                              ? 'border-blue-400 dark:border-blue-600 bg-blue-50/60 dark:bg-blue-900/15'
                              : 'border-gray-200 dark:border-gray-700'
                        }`}>
                          <div className="flex items-start gap-3">
                            <button
                              disabled={isFullyReturned}
                              onClick={() => !isFullyReturned && toggleIncluded(idx)}
                              className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                                isFullyReturned
                                  ? 'border-gray-300 dark:border-gray-600 cursor-not-allowed'
                                  : isIncluded
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'border-gray-400 dark:border-gray-500 hover:border-blue-500'
                              }`}>
                              {isIncluded && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                {item.product_name || item.name}
                              </div>
                              <div className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                <span>{T('qty_sold','Sold')}: {toNumber(item.quantity)} × {fmtUSD(toNumber(item.applied_price_usd))}</span>
                                {(item.alreadyQty || 0) > 0 && (
                                  <span className="text-orange-500 dark:text-orange-400">
                                    ↩ {item.alreadyQty} {T('already_returned','already returned')}
                                  </span>
                                )}
                                {isFullyReturned && (
                                  <span className="text-gray-400 font-medium">— {T('restocked','fully returned')}</span>
                                )}
                              </div>
                            </div>
                            {!isFullyReturned && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => updateItemQty(idx, Math.max(0, (item.returnQty||0) - 1))}
                                  className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold">−</button>
                                <input type="number" min="0" max={availableQuantity} step="1"
                                  className="input w-14 text-center text-sm py-1"
                                  value={item.returnQty || 0}
                                  onChange={e => updateItemQty(idx, e.target.value)} />
                                <button onClick={() => updateItemQty(idx, Math.min(availableQuantity, (item.returnQty||0) + 1))}
                                  className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold">+</button>
                                <span className="text-[10px] text-gray-400 ml-1 w-12 text-left">
                                  / {availableQuantity}
                                </span>
                              </div>
                            )}
                          </div>
                          {isIncluded && (
                            <div className="mt-2 pl-8 space-y-1.5">
                              {/* 11.13: the ONE chooser -- each option says what
                                  happens to this item's stock */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap gap-1">
                                  {STOCK_ACTION_OPTIONS.map((option) => (
                                    <button key={option.value} type="button"
                                      onClick={() => updateItemAction(idx, option.value)}
                                      title={T(option.descKey, option.descEn)}
                                      className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${item.stock_action === option.value
                                        ? 'border-blue-500 bg-blue-100/70 font-semibold text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300'
                                        : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400'}`}>
                                      {option.icon} {T(option.labelKey, option.labelEn)}
                                    </button>
                                  ))}
                                </div>
                                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex-shrink-0">
                                  {fmtUSD(toNumber(item.applied_price_usd) * (item.returnQty || 0))}
                                </span>
                              </div>
                              {item.stock_action === 'damaged' && (
                                <div className="text-[10px] text-orange-500 dark:text-orange-400">
                                  {T('stock_action_damaged_hint', 'Tracked as a damaged lot tied to this return — kept out of sellable stock.')}
                                </div>
                              )}
                              {item.product_id ? (
                                <button type="button" onClick={() => addReplacementFor(item)}
                                  className="text-[11px] text-emerald-600 hover:underline dark:text-emerald-400">
                                  🔁 {T('add_replacement_sale_item', 'Add an item to the replacement sale')}
                                </button>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {activeItems.length > 0 && (
                    <div className="mt-2 flex justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                      <span>{activeItems.length} {T('items','item(s)')} {T('return_type_restock','to return')}
                        {activeItems.length < selectedItems.filter((it) => it.remaining > 0).length
                          ? <span className="text-orange-500 ml-1 font-normal">({T('status_partial_return','partial')})</span>
                          : null}
                      </span>
                      <span className="text-blue-700 dark:text-blue-300">{fmtUSD(totalRefund)} {T('refund','refund')}</span>
                    </div>
                  )}
                </div>
              )}

              {selectedItems.length === 0 && (
                <div className="text-sm text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-center">
                  {T('manual_return','No sale items linked. This will be recorded as a manual return.')}
                </div>
              )}

              {/* Replacement sale: any catalog item can be found by name,
                  SKU or barcode, then drawn from an optional exact lot. */}
              {replacements.length > 0 && (
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                    🔁 {T('replacement_sale_items_label','Replacement sale items')}
                  </label>
                  <div className="space-y-2">
                    {replacements.map((line) => (
                      <div key={line.key} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2 dark:border-emerald-800 dark:bg-emerald-900/10">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{line.product_name}</div>
                          <button type="button" onClick={() => removeReplacement(line.key)} className="flex-shrink-0 text-xs text-red-500 hover:underline">{T('remove','Remove')}</button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            className="input h-9 min-w-0 flex-1 py-1 text-xs"
                            value={line.search_query}
                            onChange={(event) => updateReplacement(line.key, { search_query: event.target.value, searched: false })}
                            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchReplacementCatalog(line.key) } }}
                            placeholder={T('replacement_product_search', 'Search another product by name, SKU or barcode')}
                            aria-label={T('replacement_product_search', 'Search another product by name, SKU or barcode')}
                          />
                          <button
                            type="button"
                            className="btn-secondary h-9 flex-shrink-0 px-3 py-1 text-xs"
                            disabled={line.searching || !line.search_query.trim()}
                            onClick={() => void searchReplacementCatalog(line.key)}
                          >
                            {line.searching ? '…' : T('btn_search', 'Search')}
                          </button>
                          <ScanSearchButton
                            onDetected={(value) => { void searchReplacementCatalog(line.key, value) }}
                            t={(key: string) => T(key, key)}
                            className="h-9 w-9"
                          />
                        </div>
                        {line.candidates.length > 0 && (
                          <AppSelect
                            value={String(line.product_id)}
                            onChange={(next) => { const candidate = line.candidates.find((row) => String(row.id) === next); if (candidate) pickReplacementRow(line.key, candidate) }}
                            ariaLabel={T('replacement_product', 'Replacement product')}
                            className="w-full"
                            buttonClassName="h-9 w-full text-xs"
                            optionClassName="text-xs"
                            options={line.candidates.map((row) => ({ value: String(row.id), label: `${row.name}${row.sku ? ` · ${row.sku}` : ''}${row.barcode ? ` · ${row.barcode}` : ''} · ${fmtUSD(toNumber(row.selling_price_usd))}` }))}
                          />
                        )}
                        {line.searched && !line.searching && line.candidates.length === 0 ? (
                          <div className="text-xs text-amber-600 dark:text-amber-400">{T('no_products_found', 'No products found. Try another name, SKU or barcode.')}</div>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <AppSelect
                            value={line.batch_id != null ? String(line.batch_id) : ''}
                            onChange={(next) => updateReplacement(line.key, { batch_id: next ? Number(next) : null })}
                            ariaLabel={T('batch','Batch')}
                            className="flex-1 min-w-0"
                            buttonClassName="h-9 w-full text-xs"
                            optionClassName="text-xs"
                            options={[{ value: '', label: T('any_stock','Any stock (no specific lot)') },
                              ...line.batches.map((batch) => ({ value: String(batch.id), label: describeBatchOption(batch) }))]}
                          />
                          <input type="number" min="1" step="1" className="input w-16 flex-shrink-0 py-1 text-center text-sm"
                            aria-label={T('quantity','Quantity')}
                            value={line.quantity}
                            onChange={(e) => updateReplacement(line.key, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                          <span className="w-16 flex-shrink-0 text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400">{fmtUSD(line.price_usd * line.quantity)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${settlementPreview.isEven
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                    {settlementPreview.isEven ? (
                      <span>✓ {T('even_exchange','Even exchange')} — {T('even_exchange_desc','replacement value equals the returned value; no money moves.')}</span>
                    ) : (
                      <div className="space-y-1">
                        <div>
                          {settlementPreview.diffUsd > 0
                            ? `${T('customer_owes','Customer pays the difference')}: ${fmtUSD(settlementPreview.diffUsd)}`
                            : `${T('shop_refunds','Shop refunds the difference')}: ${fmtUSD(Math.abs(settlementPreview.diffUsd))}`}
                        </div>
                        <label className={`flex items-center gap-2 text-xs ${canSettleDifference ? 'cursor-pointer' : 'opacity-60'}`}>
                          <input type="checkbox" className="rounded accent-amber-600" checked={settleDifference}
                            disabled={!canSettleDifference}
                            onChange={(e) => setSettleDifference(e.target.checked)} />
                          <span>{T('settle_difference','Settle this price difference')}{canSettleDifference ? '' : ` (${T('requires_full_access','requires Full Access to Returns')})`}</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                  {T('return_reason','Return Reason')} *
                </label>
                <AppSelect
                  value={reason}
                  onChange={(nextValue) => setReason(nextValue)}
                  ariaLabel={T('return_reason','Return Reason')}
                  className="mb-2 w-full"
                  buttonClassName="h-10 w-full text-sm"
                  menuClassName="min-w-[14rem]"
                  optionClassName="text-sm"
                  options={RETURN_REASONS.map((returnReason) => ({ value: returnReason, label: returnReason }))}
                />
                {reason === OTHER_LABEL && (
                  <input className="input text-sm" placeholder={T('reason_placeholder','Describe the reason…')}
                    value={customReason} onChange={e => setCustomReason(e.target.value)} />
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  {T('return_notes','Notes')} ({T('optional','optional')})
                </label>
                <textarea className="input text-sm resize-none" rows={2} placeholder={T('reason_placeholder','Additional details…')}
                  value={notes} onChange={e => setNotes(e.target.value)} />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep('search')} className="btn-secondary text-sm flex-1">← {T('back','Back')}</button>
                <button onClick={reviewReturn} className="btn-primary text-sm flex-1">
                  {T('confirm','Review')} → {activeItems.length} {T('items','item(s)')}
                  {activeItems.length < selectedItems.filter((it) => (it.remaining ?? toNumber(it.quantity)) > 0).length
                    ? ` (${T('status_partial_return','partial')})` : ''}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4 border border-orange-200 dark:border-orange-800">
                <div className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-2">⚠️ {T('confirm','Confirm Return')}</div>
                <div className="text-xs text-orange-700 dark:text-orange-400 space-y-1">
                  {foundSale && <div>{T('original_receipt','Original Sale')}: <span className="font-mono font-bold">{foundSale.receipt_number}</span></div>}
                  <div>{T('reason','Reason')}: <span className="font-medium">{finalReason}</span></div>
                  <div>{T('return_type_label','Handling')}: <span className="font-medium">
                    {returnType === 'restock' ? T('return_type_restock','↩️ Restock') : returnType === 'writeoff' ? T('return_type_writeoff','🗑 Write Off') : T('return_type_refund','💰 Refund Only')}
                  </span></div>
                  <div>{T('returns','Returning')}: <span className="font-medium">{activeItems.length} {T('items','item type(s)')}</span></div>
                  {activeItems.filter(it => it.return_to_stock !== false).length > 0 && (
                    <div>↩️ {activeItems.filter(it => it.return_to_stock !== false).length} {T('restocked','will be restocked')}</div>
                  )}
                  {activeItems.filter(it => it.stock_action === 'none').length > 0 && (
                    <div>🚫 {activeItems.filter(it => it.stock_action === 'none').length} {T('written_off','will NOT restock')}</div>
                  )}
                  {activeItems.filter(it => it.stock_action === 'damaged').length > 0 && (
                    <div>🟠 {activeItems.filter(it => it.stock_action === 'damaged').length} {T('tracked_as_damaged','tracked as damaged stock')}</div>
                  )}
                  {replacements.length > 0 && (
                    <div>🔁 {replacements.length} {T('replacement_sale_items_short','item(s) on the replacement sale receipt')} — {settlementPreview.isEven ? T('even_exchange','even exchange') : T('price_difference','price difference')}</div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-1">
                {activeItems.map((it, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-200 dark:border-gray-700 last:border-0">
                    <div className="flex-1 min-w-0 mr-2">
                      <span className="text-gray-700 dark:text-gray-300 truncate block">{it.product_name || it.name}</span>
                      <span className="text-[10px] text-gray-400">
                        {stockActionOption(it.stock_action).icon} {T(stockActionOption(it.stock_action).labelKey, stockActionOption(it.stock_action).labelEn)}
                        {' · '}{T('quantity','qty')} {it.returnQty}
                      </span>
                    </div>
                    <span className="font-medium text-gray-900 dark:text-white flex-shrink-0">
                      {fmtUSD(toNumber(it.applied_price_usd) * it.returnQty)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-base text-gray-900 dark:text-white pt-2 mt-1 border-t border-gray-300 dark:border-gray-600">
                  <span>{T('total_refunded','Total Refund')}</span>
                  <span>{fmtUSD(totalRefund)}</span>
                </div>
              </div>

              {replacements.length > 0 && (
                <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
                  {replacements.map((line) => (
                    <div key={line.key} className="flex justify-between py-1 text-sm">
                      <span className="mr-2 truncate text-gray-700 dark:text-gray-300">🔁 {line.product_name} × {line.quantity}</span>
                      <span className="flex-shrink-0 font-medium text-gray-900 dark:text-white">{fmtUSD(line.price_usd * line.quantity)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-emerald-200 pt-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                    <span>{settlementPreview.isEven ? T('even_exchange','Even exchange') : T('price_difference','Price difference')}</span>
                    <span>{settlementPreview.isEven ? '±0' : (settlementPreview.diffUsd > 0 ? '+' : '−') + fmtUSD(Math.abs(settlementPreview.diffUsd))}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep('items')} className="btn-secondary text-sm flex-1">← {T('back','Back')}</button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="btn-primary text-sm flex-1 disabled:opacity-50">
                  {submitting ? `⏳ ${T('submitting','Processing…')}` : `✅ ${T('submit_return','Confirm Return')}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
