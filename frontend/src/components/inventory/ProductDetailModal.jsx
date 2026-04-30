// ProductDetailModal (Inventory)
// Shows full stock details for a product across all branches.
import { calculateProductDiscount } from '../../utils/pricing.js'

export default function ProductDetailModal({ product: p, onClose, onAdjust, onMove, fmtUSD, fmtKHR, t }) {
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)
  if (!p) return null

  const stockPct = p.low_stock_threshold > 0
    ? Math.min(100, (p.stock_quantity / p.low_stock_threshold) * 100)
    : 100
  const stockColor = p.stock_quantity <= 0
    ? 'text-red-600'
    : p.stock_quantity <= p.low_stock_threshold
      ? 'text-yellow-600'
      : 'text-green-600'
  const profit = Math.max(0, p.revenue_usd || 0) - Math.max(0, p.cogs_usd || 0)
  const promotion = calculateProductDiscount(p)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-gray-900 dark:text-white">{p.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {p.sku ? <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-400 dark:bg-gray-700">{p.sku}</span> : null}
              {p.category ? <span className="text-xs text-blue-600 dark:text-blue-400">{p.category}</span> : null}
              {p.unit ? <span className="text-xs text-gray-400">/{p.unit}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-2xl text-gray-400 hover:text-gray-600" aria-label={T('close', 'Close')}>×</button>
        </div>

        <div className="modal-scroll space-y-4 p-4">
          <div className="rounded-xl bg-gray-50 p-4 dark:bg-gray-700/50">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{T('current_stock', 'Current Stock')}</span>
              <span className={`text-2xl font-bold ${stockColor}`}>{p.stock_quantity} <span className="text-sm font-normal">{p.unit}</span></span>
            </div>
            <div className="mb-1 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-600">
              <div
                className={`h-2 rounded-full transition-all ${p.stock_quantity <= 0 ? 'bg-red-500' : p.stock_quantity <= p.low_stock_threshold ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.max(2, Math.min(100, stockPct))}%` }}
              />
            </div>
            <div className="text-xs text-gray-400">{T('low_stock_threshold', 'Low stock threshold')}: {p.low_stock_threshold} {p.unit}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-red-50 p-3 dark:bg-red-900/20">
              <div className="mb-1 text-xs font-semibold text-red-600 dark:text-red-400">{T('label_cost_purchase', 'Cost Price')}</div>
              <div className="font-bold text-red-700 dark:text-red-300">{fmtUSD(p.purchase_price_usd || p.cost_price_usd || 0)}</div>
              {(p.purchase_price_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(p.purchase_price_khr)}</div> : null}
            </div>
            <div className="rounded-xl bg-green-50 p-3 dark:bg-green-900/20">
              <div className="mb-1 text-xs font-semibold text-green-600 dark:text-green-400">{T('label_selling_price', 'Selling Price')}</div>
              <div className="font-bold text-green-700 dark:text-green-300">{fmtUSD(p.selling_price_usd || 0)}</div>
              {(p.selling_price_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</div> : null}
            </div>
            {(p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0 ? (
              <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-900/20 col-span-2">
                <div className="mb-1 text-xs font-semibold text-blue-600 dark:text-blue-400">{T('special_price', 'Special Price')}</div>
                <div className="font-bold text-blue-700 dark:text-blue-300">{fmtUSD(p.special_price_usd || p.selling_price_usd || 0)}</div>
                {(p.special_price_khr || p.selling_price_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(p.special_price_khr || p.selling_price_khr || 0)}</div> : null}
              </div>
            ) : null}
            {promotion.active ? (
              <div className="col-span-2 rounded-xl bg-rose-50 p-3 dark:bg-rose-950/30">
                <div className="mb-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{T('product_discount', 'Promotion')}</div>
                <div className="font-bold text-rose-700 dark:text-rose-200">{fmtUSD(promotion.applied_price_usd || 0)}</div>
                {(promotion.applied_price_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(promotion.applied_price_khr || 0)}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            {[
              [T('label_sku', 'SKU'), p.sku],
              [T('label_barcode', 'Barcode'), p.barcode],
              [T('label_supplier', 'Supplier'), p.supplier],
              [T('label_description', 'Description'), p.description],
            ].filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="flex gap-3 text-sm">
                <span className="w-24 flex-shrink-0 pt-0.5 text-xs text-gray-400">{label}</span>
                <span className="break-all text-gray-700 dark:text-gray-300">{value}</span>
              </div>
            ))}
          </div>

          {(p.qty_sold > 0 || p.revenue_usd > 0) ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{T('performance', 'Performance')} ({T('net_of_returns', 'net of returns')})</div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { value: Math.max(0, p.qty_sold || 0), label: T('net_sold', 'Net Sold'), className: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  { value: fmtUSD(Math.max(0, p.revenue_usd || 0)), label: T('revenue', 'Revenue'), className: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
                  { value: fmtUSD(Math.max(0, p.cogs_usd || 0)), label: T('cogs', 'COGS'), className: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                  { value: fmtUSD(profit), label: T('profit', 'Profit'), className: profit >= 0 ? 'text-purple-600' : 'text-red-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                ].map((item) => (
                  <div key={item.label} className={`${item.bg} rounded-xl p-2`}>
                    <div className={`text-xs font-bold ${item.className}`}>{item.value}</div>
                    <div className="text-[10px] text-gray-500">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {Array.isArray(p.branch_stock) && p.branch_stock.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{T('branch_stock', 'Branch Stock')}</div>
              <div className="space-y-1">
                {p.branch_stock.map((branchStock) => (
                  <div key={branchStock.branch_id} className="flex justify-between border-b border-gray-100 py-1 text-sm dark:border-gray-700">
                    <span className="text-gray-700 dark:text-gray-300">{branchStock.branch_name}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{branchStock?.quantity ?? 0} {p.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid flex-shrink-0 gap-2 border-t border-gray-200 p-4 dark:border-gray-700 sm:grid-cols-2">
          <button type="button" onClick={() => { onClose(); onAdjust(p) }} className="btn-primary w-full py-3 text-sm">{T('adjust_stock', 'Adjust Stock')}</button>
          <button type="button" onClick={() => { onClose(); onMove?.(p) }} className="btn-secondary w-full py-3 text-sm">{T('move_stock', 'Move Stock')}</button>
        </div>
      </div>
    </div>
  )
}
