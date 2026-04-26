import { useApp } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'

const CUSTOMER_SCOPE = 'customer'

function normalizeScope(value) {
  return value === 'supplier' ? 'supplier' : CUSTOMER_SCOPE
}

export default function ReturnDetailModal({ ret, onClose, onEdit, fmtUSD, fmtKHR }) {
  const { t } = useApp()
  const tr = (key, fallback) => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  if (!ret) return null
  const items = Array.isArray(ret.items) ? ret.items : []
  const scope = normalizeScope(ret.return_scope)
  const isSupplier = scope === 'supplier'

  const typeLabel = isSupplier
    ? (ret.supplier_settlement || tr('settlement_refund', 'refund'))
    : (ret.return_type || tr('manual_return', 'manual'))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <div className="font-mono text-base font-bold text-gray-900 dark:text-white">{ret.return_number}</div>
            <div className="text-xs text-gray-400">{fmtTime(ret.created_at)}</div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <button onClick={onEdit} className="btn-secondary px-3 py-1.5 text-xs">{tr('edit', 'Edit')}</button>
            ) : null}
            <button onClick={onClose} className="h-8 w-8 text-2xl leading-none text-gray-400 hover:text-gray-600">x</button>
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
                <div className="font-mono text-sm text-blue-600 dark:text-blue-400">{ret.receipt_number}</div>
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
                    <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{item.product_name || '-'}</div>
                    <div className="text-xs text-gray-400">{tr('quantity', 'Qty')}: {item.quantity || 0}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{fmtUSD(item.total_usd || 0)}</div>
                    {(item.total_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(item.total_khr || 0)}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isSupplier ? (
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/40">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-300">{tr('supplier_compensation', 'Supplier compensation')}</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{fmtUSD(ret.supplier_compensation_usd || 0)}</span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-300">{tr('business_loss', 'Business loss')}</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtUSD(ret.supplier_loss_usd || 0)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {fmtKHR(ret.supplier_compensation_khr || 0)} / {fmtKHR(ret.supplier_loss_khr || 0)}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/40">
              <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white">
                <span>{tr('total_refunded', 'Total Refunded')}</span>
                <span>{fmtUSD(ret.total_refund_usd || 0)}</span>
              </div>
              {(ret.total_refund_khr || 0) > 0 ? (
                <div className="text-right text-xs text-gray-400">{fmtKHR(ret.total_refund_khr || 0)}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
