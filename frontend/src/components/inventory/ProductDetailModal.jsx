// ── ProductDetailModal (Inventory) ───────────────────────────────────────────
// Shows full stock details for a product across all branches.
import DualMoney from './DualMoney'

export default
function ProductDetailModal({ product: p, onClose, onAdjust, fmtUSD, fmtKHR, t }) {
  const T = (k, fb) => (typeof t === 'function' ? t(k) : fb)
  if (!p) return null
  const stockPct   = p.low_stock_threshold > 0 ? Math.min(100, (p.stock_quantity / p.low_stock_threshold) * 100) : 100
  const stockColor = p.stock_quantity <= 0 ? 'text-red-600' : p.stock_quantity <= p.low_stock_threshold ? 'text-yellow-600' : 'text-green-600'
  const profit     = Math.max(0, p.revenue_usd || 0) - Math.max(0, p.cogs_usd || 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-gray-900 dark:text-white">{p.name}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {p.sku      && <span className="font-mono text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{p.sku}</span>}
              {p.category && <span className="text-xs text-blue-600 dark:text-blue-400">{p.category}</span>}
              {p.unit     && <span className="text-xs text-gray-400">/{p.unit}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl w-8 h-8 flex items-center justify-center">×</button>
        </div>

        <div className="modal-scroll p-4 space-y-4">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{T('current_stock','Current Stock')}</span>
              <span className={`text-2xl font-bold ${stockColor}`}>{p.stock_quantity} <span className="text-sm font-normal">{p.unit}</span></span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 mb-1">
              <div className={`h-2 rounded-full transition-all ${p.stock_quantity <= 0 ? 'bg-red-500' : p.stock_quantity <= p.low_stock_threshold ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{width:`${Math.max(2, Math.min(100, stockPct))}%`}} />
            </div>
            <div className="text-xs text-gray-400">{T('low_stock_threshold','Low stock threshold')}: {p.low_stock_threshold} {p.unit}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <div className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">🛒 {T('label_cost_purchase','Cost Price')}</div>
              <div className="font-bold text-red-700 dark:text-red-300">{fmtUSD(p.purchase_price_usd || p.cost_price_usd || 0)}</div>
              {(p.purchase_price_khr || 0) > 0 && <div className="text-xs text-gray-400">{fmtKHR(p.purchase_price_khr)}</div>}
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
              <div className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">💵 {T('label_selling_price','Selling Price')}</div>
              <div className="font-bold text-green-700 dark:text-green-300">{fmtUSD(p.selling_price_usd || 0)}</div>
              {(p.selling_price_khr || 0) > 0 && <div className="text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</div>}
            </div>
          </div>

          <div className="space-y-2">
            {[[T('label_sku','SKU'), p.sku], [T('label_barcode','Barcode'), p.barcode], [T('label_supplier','Supplier'), p.supplier], [T('label_description','Description'), p.description]]
              .filter(([, v]) => v).map(([label, val]) => (
              <div key={label} className="flex gap-3 text-sm">
                <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</span>
                <span className="text-gray-700 dark:text-gray-300 break-all">{val}</span>
              </div>
            ))}
          </div>

          {(p.qty_sold > 0 || p.revenue_usd > 0) && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{T('performance_loading','Performance')} ({T('net_of_returns','net of returns')})</div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { val: Math.max(0, p.qty_sold||0),           lbl: T('net_sold','Net Sold'),   cls: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  { val: fmtUSD(Math.max(0,p.revenue_usd||0)), lbl: T('revenue','Revenue'),     cls: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20' },
                  { val: fmtUSD(Math.max(0,p.cogs_usd||0)),   lbl: T('cogs','COGS'),            cls: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                  { val: fmtUSD(profit),                       lbl: T('profit','Profit'),        cls: profit >= 0 ? 'text-purple-600' : 'text-red-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                ].map(item => (
                  <div key={item.lbl} className={`${item.bg} rounded-xl p-2`}>
                    <div className={`text-xs font-bold ${item.cls}`}>{item.val}</div>
                    <div className="text-[10px] text-gray-500">{item.lbl}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(p.branch_stock) && p.branch_stock.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{T('label_branches','Branch Stock')}</div>
              <div className="space-y-1">
                {p.branch_stock.map(bs => (
                  <div key={bs.branch_id} className="flex justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-700 dark:text-gray-300">{bs.branch_name}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{bs?.quantity ?? 0} {p.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button onClick={() => { onClose(); onAdjust(p) }} className="btn-primary w-full text-sm">⚖️ {T('adjust_stock','Adjust Stock')}</button>
        </div>
      </div>
    </div>
  )
}

