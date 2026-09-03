import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { fmtTime } from '../../utils/formatters.ts'
import CopyableId from '../shared/CopyableId.tsx'
import { normalizeStockAction, stockActionOption } from './helpers/returnOptions.ts'

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'

type ReturnScope = typeof CUSTOMER_SCOPE | typeof SUPPLIER_SCOPE

interface ReturnLineItem {
  id?: string | number | null
  product_id?: string | number | null
  product_name?: string | null
  quantity?: number | string | null
  total_usd?: number | string | null
  total_khr?: number | string | null
  stock_action?: string | null
  return_to_stock?: boolean | number | null
}

interface ReplacementLineItem {
  id?: string | number | null
  product_name?: string | null
  quantity?: number | string | null
  total_usd?: number | string | null
  total_khr?: number | string | null
}

interface ReturnDetail {
  return_number?: string | null
  created_at?: string | Date | null
  items?: ReturnLineItem[] | null
  return_scope?: string | null
  supplier_settlement?: string | null
  return_type?: string | null
  receipt_number?: string | null
  replacement_sale_id?: number | string | null
  replacement_receipt_number?: string | null
  supplier_name?: string | null
  customer_name?: string | null
  branch_name?: string | null
  cashier_name?: string | null
  reason?: string | null
  notes?: string | null
  supplier_compensation_usd?: number | string | null
  supplier_loss_usd?: number | string | null
  supplier_compensation_khr?: number | string | null
  supplier_loss_khr?: number | string | null
  total_refund_usd?: number | string | null
  total_refund_khr?: number | string | null
  replacement_items?: ReplacementLineItem[] | null
  settlement_mode?: string | null
  settlement_diff_usd?: number | string | null
}

interface ReturnDetailModalProps {
  ret?: ReturnDetail | null
  onClose: () => void
  onEdit?: () => void
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

const useApp = useAppHook as () => {
  t?: (key: string) => string | undefined
}

function normalizeScope(value: unknown): ReturnScope {
  return value === SUPPLIER_SCOPE ? SUPPLIER_SCOPE : CUSTOMER_SCOPE
}

function coerceMoney(value: number | string | null | undefined): number | string {
  return value || 0
}

function isPositiveMoney(value: number | string | null | undefined): boolean {
  return Number(value || 0) > 0
}

export default function ReturnDetailModal({ ret, onClose, onEdit, fmtUSD, fmtKHR }: ReturnDetailModalProps) {
  const { t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  if (!ret) return null
  const items = Array.isArray(ret.items) ? ret.items : []
  const replacementItems = Array.isArray(ret.replacement_items) ? ret.replacement_items : []
  const scope = normalizeScope(ret.return_scope)
  const isSupplier = scope === SUPPLIER_SCOPE

  const typeLabel = isSupplier
    ? (ret.supplier_settlement || tr('settlement_refund', 'refund'))
    : (ret.return_type || tr('manual_return', 'manual'))

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        {/* Same treatment as the sale receipt id: below sm the return id takes
            a full-width row of its own and wraps rather than being clipped or
            scrolled, with a one-tap copy control. */}
        <div className="flex flex-col gap-2 border-b border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <CopyableId
              value={ret.return_number || ''}
              copyLabel={tr('copy_return_id', 'Copy return ID')}
              copiedLabel={tr('copied', 'Copied')}
              valueClassName="font-mono text-base font-bold text-gray-900 dark:text-white"
            />
            <div className="mt-1 text-xs text-gray-400">{fmtTime(ret.created_at)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onEdit ? (
              <button type="button" onClick={onEdit} className="btn-secondary px-3 py-1.5 text-xs">{tr('edit', 'Edit')}</button>
            ) : null}
            <button type="button" onClick={onClose} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="modal-scroll space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-0.5 text-xs text-gray-400">{tr('scope', 'Scope')}</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {isSupplier ? tr('supplier_returns', 'Supplier Return') : tr('customer_returns', 'Customer Return')}
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-xs text-gray-400">{tr('type', 'Type')}</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{typeLabel}</div>
            </div>
            {ret.receipt_number ? (
              <div>
                <div className="mb-0.5 text-xs text-gray-400">{tr('original_receipt', 'Original Receipt')}</div>
                <CopyableId
                  value={ret.receipt_number}
                  copyLabel={tr('copy_receipt_number', 'Copy receipt number')}
                  copiedLabel={tr('copied', 'Copied')}
                  valueClassName="font-mono text-sm text-blue-600 dark:text-blue-400"
                />
              </div>
            ) : null}
            {ret.replacement_receipt_number ? (
              <div>
                <div className="mb-0.5 text-xs text-gray-400">{tr('replacement_sale_receipt', 'Replacement Sale Receipt')}</div>
                <CopyableId
                  value={ret.replacement_receipt_number}
                  copyLabel={tr('copy_receipt_number', 'Copy receipt number')}
                  copiedLabel={tr('copied', 'Copied')}
                  valueClassName="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400"
                />
              </div>
            ) : null}
            <div>
              <div className="mb-0.5 text-xs text-gray-400">{isSupplier ? tr('supplier', 'Supplier') : tr('customer', 'Customer')}</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {isSupplier ? (ret.supplier_name || '-') : (ret.customer_name || '-')}
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-xs text-gray-400">{tr('branch', 'Branch')}</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{ret.branch_name || '-'}</div>
            </div>
            <div>
              <div className="mb-0.5 text-xs text-gray-400">{tr('cashier', 'Cashier')}</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{ret.cashier_name || '-'}</div>
            </div>
          </div>

          <div className="rounded-xl bg-orange-50 p-3 dark:bg-orange-900/20">
            <div className="mb-1 text-xs font-semibold text-orange-700 dark:text-orange-400">{tr('reason', 'Reason')}</div>
            <div className="text-sm text-orange-800 dark:text-orange-300">{ret.reason || '-'}</div>
            {ret.notes ? <div className="mt-1 text-xs text-orange-600 dark:text-orange-400">{ret.notes}</div> : null}
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('items', 'Items')} ({items.length})
            </div>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={`${item.id || item.product_id || 'item'}-${index}`} className="flex items-start justify-between gap-2 border-b border-gray-100 py-2 last:border-0 dark:border-gray-700">
                  <div className="min-w-0 flex-1">
                    {/* Damaged is a TAG on the line, next to the name -- the
                        product itself is never renamed to say so, so the name
                        here is the catalog name and the chip carries the
                        state. It sits beside the name rather than only in the
                        meta line below, where it read as one more attribute
                        instead of the flag that keeps the units out of
                        sellable stock. */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="detail-scroll-text text-sm font-medium text-gray-800 dark:text-gray-200">{item.product_name || '-'}</span>
                      {!isSupplier && normalizeStockAction({ stock_action: item.stock_action, return_to_stock: item.return_to_stock !== 0 && item.return_to_stock !== false }) === 'damaged' ? (
                        <span
                          data-tag="damaged"
                          title={tr('stock_action_damaged_hint', 'Tracked as a damaged lot tied to this return — kept out of sellable stock.')}
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                        >
                          {stockActionOption('damaged').icon} {tr('stock_action_damaged', 'Damaged')}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-gray-400">
                      {tr('quantity', 'Qty')}: {item.quantity || 0}
                      {!isSupplier ? (() => {
                        const option = stockActionOption(normalizeStockAction({ stock_action: item.stock_action, return_to_stock: item.return_to_stock !== 0 && item.return_to_stock !== false }))
                        return <span className="ml-2">{option.icon} {tr(option.labelKey, option.labelEn)}</span>
                      })() : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{fmtUSD(coerceMoney(item.total_usd))}</div>
                    {isPositiveMoney(item.total_khr) ? <div className="text-xs text-gray-400">{fmtKHR(coerceMoney(item.total_khr))}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {replacementItems.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                🔁 {tr('replacement_sale_items_label', 'Replacement sale items')} ({replacementItems.length})
              </div>
              <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
                {replacementItems.map((line, index) => (
                  <div key={`${line.id || 'replacement'}-${index}`} className="flex justify-between py-1 text-sm">
                    <span className="detail-scroll-text mr-2 min-w-0 flex-1 text-gray-700 dark:text-gray-300">{line.product_name || '-'} × {line.quantity || 0}</span>
                    <span className="flex-shrink-0 font-medium text-gray-900 dark:text-white">{fmtUSD(coerceMoney(line.total_usd))}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-emerald-200 pt-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                  <span>{ret.settlement_mode === 'price_difference' ? tr('price_difference', 'Price difference') : tr('even_exchange', 'Even exchange')}</span>
                  <span>{ret.settlement_mode === 'price_difference'
                    ? (Number(ret.settlement_diff_usd || 0) > 0 ? '+' : '−') + fmtUSD(Math.abs(Number(ret.settlement_diff_usd || 0)))
                    : '±0'}</span>
                </div>
              </div>
            </div>
          ) : null}

          {isSupplier ? (
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/40">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-300">{tr('supplier_compensation', 'Supplier compensation')}</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{fmtUSD(coerceMoney(ret.supplier_compensation_usd))}</span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-300">{tr('business_loss', 'Business loss')}</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtUSD(coerceMoney(ret.supplier_loss_usd))}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {fmtKHR(coerceMoney(ret.supplier_compensation_khr))} / {fmtKHR(coerceMoney(ret.supplier_loss_khr))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/40">
              <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white">
                <span>{tr('total_refunded', 'Total Refunded')}</span>
                <span>{fmtUSD(coerceMoney(ret.total_refund_usd))}</span>
              </div>
              {isPositiveMoney(ret.total_refund_khr) ? (
                <div className="text-right text-xs text-gray-400">{fmtKHR(coerceMoney(ret.total_refund_khr))}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
