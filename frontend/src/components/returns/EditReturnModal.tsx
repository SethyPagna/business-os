import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { getLoaderErrorMessage, withLoaderTimeout } from '../../utils/loaders.ts'
import { STOCK_ACTION_OPTIONS, normalizeStockAction, type ReturnStockAction } from './helpers/returnOptions.ts'
import { normalizeReturnReasonList } from './helpers/returnReasonPresets.ts'
import { useReturnReasonPresets } from './helpers/useReturnReasonPresets.ts'

const RETURN_UPDATE_TIMEOUT_MS = 15000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, type?: string) => void
type MoneyFormatter = (value: number | string) => string
type ReturnType = 'restock' | 'writeoff' | 'refund' | string

interface AppUser {
  id?: number | string | null
  name?: string | null
  username?: string | null
}

interface EditableReturnItem {
  id?: number | string | null
  sale_item_id?: number | string | null
  product_id?: number | string | null
  product_name?: string | null
  quantity?: number | string | null
  returnQty: number
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  return_to_stock?: boolean | null
  // 11.13: three-way chooser state; seeded from the stored row (or the
  // legacy boolean) by normalizeStockAction.
  stock_action?: ReturnStockAction
  branch_id?: number | string | null
}

interface ExistingReturnItem extends Omit<EditableReturnItem, 'returnQty'> {}

interface ExistingReturn {
  id: number | string
  return_number?: string | null
  reason?: string | null
  return_type?: ReturnType | null
  notes?: string | null
  branch_id?: number | string | null
  items?: ExistingReturnItem[] | null
}

interface ReturnUpdatePayload extends Record<string, unknown> {
  reason: string
  return_type: ReturnType
  notes: string | null
  total_refund_usd: number
  total_refund_khr: number
  cashier_id?: number | string | null
  cashier_name?: string | null
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

interface EditReturnModalProps {
  ret: ExistingReturn
  onClose: () => void
  onSuccess?: (result?: unknown) => void | Promise<void>
  fmtUSD: MoneyFormatter
  notify: NotifyFn
}

interface ConflictLikeError {
  conflict?: boolean
  code?: string
}

const useApp = useAppHook as () => {
  user?: AppUser | null
  t?: TranslateFn
}

type ReturnsTransportModule = typeof import('../../api/returnsTransport.ts')

let returnsTransportPromise: Promise<ReturnsTransportModule> | null = null

function loadReturnsTransport(): Promise<ReturnsTransportModule> {
  if (!returnsTransportPromise) returnsTransportPromise = import('../../api/returnsTransport.ts')
  return returnsTransportPromise
}

async function updateReturnRequest(id: number | string, payload: ReturnUpdatePayload): Promise<unknown> {
  const { updateReturn } = await loadReturnsTransport()
  return updateReturn(id, payload)
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

function isWriteConflict(error: unknown): boolean {
  const candidate = error as ConflictLikeError | null | undefined
  return !!candidate?.conflict || candidate?.code === 'write_conflict'
}

export default function EditReturnModal({ ret, onClose, onSuccess, fmtUSD, notify }: EditReturnModalProps) {
  const { user, t } = useApp()
  const T = (key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : undefined
    return value && value !== key ? value : fallback
  }

  const OTHER_LABEL = T('reason_other', 'Other')
  const returnReasonPresets = useReturnReasonPresets(t)
  const RETURN_REASONS = normalizeReturnReasonList([...returnReasonPresets.customer, OTHER_LABEL])

  const existingItems = Array.isArray(ret.items) ? ret.items : []
  const [reason,       setReason]       = useState<string>(ret.reason || RETURN_REASONS[0])
  const [customReason, setCustomReason] = useState(RETURN_REASONS.includes(ret.reason || '') ? '' : ret.reason || '')
  const [returnType,   setReturnType]   = useState<ReturnType>(ret.return_type || 'restock')
  const [notes,        setNotes]        = useState(ret.notes || '')
  const [items,        setItems]        = useState<EditableReturnItem[]>(
    existingItems.map((item) => ({ ...item, returnQty: toNumber(item.quantity), stock_action: normalizeStockAction(item as { stock_action?: unknown; return_to_stock?: unknown }) })),
  )
  const [submitting,   setSubmitting]   = useState(false)
  const submitInFlightRef = useRef(false)
  const isKnownReason = RETURN_REASONS.includes(reason)

  useEffect(() => {
    if (!reason || reason === OTHER_LABEL || isKnownReason) return
    setCustomReason((current) => current || reason)
  }, [OTHER_LABEL, isKnownReason, reason])

  const reasonValue = isKnownReason ? reason : OTHER_LABEL
  const finalReason = reasonValue === OTHER_LABEL ? customReason : reason

  const updateQty     = (idx: number, qty: unknown) => setItems(prev => prev.map((it, i) =>
    i === idx ? { ...it, returnQty: clampReturnQuantity(qty, toNumber(it.quantity)) } : it
  ))
  const updateAction = (idx: number, action: ReturnStockAction) => setItems(prev => prev.map((it, i) =>
    i === idx ? { ...it, stock_action: action, return_to_stock: action === 'restock' } : it
  ))

  const activeItems    = items.filter(it => it.returnQty > 0)
  const totalRefund    = activeItems.reduce((sum, it) => sum + toNumber(it.applied_price_usd) * it.returnQty, 0)
  const totalRefundKhr = activeItems.reduce((sum, it) => sum + toNumber(it.applied_price_khr) * it.returnQty, 0)

  const handleSubmit = async (): Promise<void> => {
    if (!finalReason.trim()) { notify(T('return_reason','Please provide a reason'), 'error'); return }
    if (!beginSingleAction(submitInFlightRef)) return
    setSubmitting(true)
    try {
      const payload: ReturnUpdatePayload = {
        reason:            finalReason,
        return_type:       returnType,
        notes:             notes || null,
        total_refund_usd:  totalRefund,
        total_refund_khr:  totalRefundKhr,
        cashier_id:        user?.id,
        cashier_name:      user?.name || user?.username || null,
        items: activeItems.map(it => ({
          sale_item_id:      it.sale_item_id || null,
          product_id:        it.product_id,
          product_name:      it.product_name,
          quantity:          it.returnQty,
          applied_price_usd: toNumber(it.applied_price_usd),
          applied_price_khr: toNumber(it.applied_price_khr),
          cost_price_usd:    toNumber(it.cost_price_usd),
          cost_price_khr:    toNumber(it.cost_price_khr),
          return_to_stock:   it.return_to_stock !== false,
          stock_action:      it.stock_action || 'restock',
          branch_id:         it.branch_id || ret.branch_id || null,
        })),
      }
      const result = await withLoaderTimeout(
        () => updateReturnRequest(ret.id, payload),
        'Update return',
        RETURN_UPDATE_TIMEOUT_MS,
      )
      notify(T('success','Return updated successfully'))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      await Promise.resolve(onSuccess?.(result))
      onClose()
    } catch (error) {
      if (isWriteConflict(error)) {
        onSuccess?.()
        return
      }
      notify((T('error','Error') || 'Error') + ': ' + getLoaderErrorMessage(error), 'error')
    } finally {
      finishSingleAction(submitInFlightRef)
      setSubmitting(false)
    }
  }

  // Backdrop/X/Cancel close should not fire while a submit is in flight --
  // same guard ReceiveBatchModal.tsx/ManageBatchesModal.tsx/
  // InventoryBatchModal.tsx already use for this exact reason (only the
  // Save button here was disabled during `submitting`; the other three
  // close paths could still unmount the modal mid-request).
  const closeIfIdle = () => {
    if (!submitting) onClose()
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">✏️ {T('edit','')} {T('returns','Return')}</h2>
            <div className="text-xs text-gray-400 font-mono mt-0.5">{ret.return_number}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={handleSubmit} disabled={submitting || !finalReason.trim()} className="btn-primary min-h-9 max-w-24 truncate px-3 py-1.5 text-xs sm:hidden">{submitting ? `⏳ ${T('saving_label','Saving…')}` : `✓ ${T('save','Save')}`}</button>
            <button type="button" onClick={closeIfIdle} disabled={submitting} aria-label={T('close', 'Close')} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="modal-scroll p-4 space-y-4">
          {/* Warning */}
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-xs text-orange-700 dark:text-orange-400">
            ⚠️ {T('edit_return_warning','Editing a return will reverse the previous stock changes and apply the new ones. A record of both changes will appear in inventory movements.')}
          </div>

          {/* Return type */}
          <div>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
              {T('return_type_label','Handling Method')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['restock',  T('return_type_restock','↩️ Restock'),    T('return_type_restock_desc','Return items to inventory')],
                ['writeoff', T('return_type_writeoff','🗑 Write Off'),  T('return_type_writeoff_desc','Lost / damaged goods')],
                ['refund',   T('return_type_refund','💰 Refund Only'),  T('return_type_refund_desc','Money back, no stock change')],
              ].map(([v, label, desc]) => (
                <button key={v}
                  onClick={() => { setReturnType(v); setItems(prev => prev.map(it => ({ ...it, return_to_stock: v === 'restock', stock_action: (v === 'restock' ? 'restock' : 'none') as ReturnStockAction }))) }}
                  className={`p-2 rounded-xl border-2 text-left text-xs transition-colors ${returnType === v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                  <div className={`font-semibold ${returnType === v ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{label}</div>
                  <div className="text-gray-400 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                {T('items','Items')} &amp; {T('quantity','Quantities')}
                <span className="ml-1 text-xs font-normal text-gray-400">({T('remaining','max = original returned qty')})</span>
              </label>
              <div className="space-y-2">
                {items.map((item, idx) => {
                  const isActive = item.returnQty > 0
                  return (
                    <div key={`${item.id || item.sale_item_id || item.product_id || 'return-item'}-${idx}`} className={`border rounded-xl p-3 transition-colors ${
                      isActive ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700'
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.product_name}</div>
                          <div className="text-xs text-gray-400">{fmtUSD(item.applied_price_usd || 0)} {T('each','each')}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => updateQty(idx, (item.returnQty || 0) - 1)}
                            className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold">−</button>
                          <input type="number" min="0" max={toNumber(item.quantity)} step="1"
                            className="input w-14 text-center text-sm py-1"
                            value={item.returnQty}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => updateQty(idx, event.target.value)} />
                          <button onClick={() => updateQty(idx, (item.returnQty || 0) + 1)}
                            className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold">+</button>
                          <span className="text-[10px] text-gray-400 ml-1 w-10">/ {item.quantity}</span>
                        </div>
                      </div>
                      {isActive && (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          {/* 11.13: the same ONE chooser the create flow uses */}
                          <div className="flex flex-wrap gap-1">
                            {STOCK_ACTION_OPTIONS.map((option) => (
                              <button key={option.value} type="button"
                                onClick={() => updateAction(idx, option.value)}
                                title={T(option.descKey, option.descEn)}
                                className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${item.stock_action === option.value
                                  ? 'border-blue-500 bg-blue-100/70 font-semibold text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400'}`}>
                                {option.icon} {T(option.labelKey, option.labelEn)}
                              </button>
                            ))}
                          </div>
                          <span className="flex-shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {fmtUSD(toNumber(item.applied_price_usd) * item.returnQty)}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
              {T('return_reason','Reason')} *
            </label>
            <AppSelect
              value={reasonValue}
              onChange={(nextValue) => setReason(nextValue)}
              ariaLabel={T('return_reason','Reason')}
              className="mb-2 w-full"
              buttonClassName="h-10 w-full text-sm"
              menuClassName="min-w-[14rem]"
              optionClassName="text-sm"
              options={RETURN_REASONS.map((returnReason) => ({ value: returnReason, label: returnReason }))}
            />
            {reasonValue === OTHER_LABEL && (
              <input className="input text-sm"
                placeholder={T('reason_placeholder','Describe the reason…')}
                value={customReason}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomReason(event.target.value)} />
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              {T('return_notes','Notes')}
            </label>
            <textarea className="input text-sm resize-none" rows={2}
              value={notes} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)} />
          </div>

          {/* Summary */}
          {activeItems.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 flex justify-between font-bold text-gray-900 dark:text-white">
              <span>{T('total_refunded','New Total Refund')}</span>
              <span>{fmtUSD(totalRefund)}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="hidden gap-2 pt-1 sm:flex">
            <button onClick={closeIfIdle} disabled={submitting} className="btn-secondary text-sm flex-1 disabled:opacity-50">
              {T('cancel','Cancel')}
            </button>
            <button onClick={handleSubmit}
              disabled={submitting || !finalReason.trim()}
              className="btn-primary text-sm flex-1 disabled:opacity-50">
              {submitting ? `⏳ ${T('saving_label','Saving…')}` : `✓ ${T('save','Save Changes')}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
