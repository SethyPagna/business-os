// ── CartItem ─────────────────────────────────────────────────────────────────
// Individual item row in the POS cart — shows price, qty controls, and remove.

import ProductImage from './ProductImage'

export default
function CartItem({
  item, branches, t,
  onQtyChange, onPriceChange, onBranchChange, onRemove, onShowDetails,
  fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate,
}) {
  return (
    <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      {/* Name + remove */}
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-white flex-1 mr-2 leading-snug">{item.name}</p>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={onShowDetails} className="text-gray-300 hover:text-blue-500 px-1.5 py-0.5 rounded text-xs" title={t ? t('details') : 'Details'}>⋯</button>
          <button onClick={() => onRemove(item.id)} className="text-red-400 hover:text-red-600 px-1 text-base leading-none">×</button>
        </div>
      </div>

      {/* Source branch — only shown when there are multiple branches */}
      {branches.length > 1 && (
        <div className="mb-2">
          <select className="input text-xs py-1" value={item.branch_id || ''} onChange={e => onBranchChange(item.id, e.target.value)}>
            <option value="">{t ? t('select_branch_placeholder') : '— Select branch —'}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' ★' : ''}</option>)}
          </select>
        </div>
      )}

      {/* Qty + USD price + KHR price */}
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <div className="flex items-center border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden flex-shrink-0">
          <button className="w-7 h-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm" onClick={() => onQtyChange(item.id, item.quantity - 1)}>−</button>
          <input className="w-10 text-center text-xs border-x border-gray-200 dark:border-gray-600 bg-transparent py-1 text-gray-900 dark:text-white" type="number" min="1" value={item.quantity} onChange={e => onQtyChange(item.id, parseInt(e.target.value) || 1)} />
          <button className="w-7 h-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm" onClick={() => onQtyChange(item.id, item.quantity + 1)}>+</button>
        </div>
        <div className="relative flex-1 min-w-[70px]">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span>
          <input className="input text-xs py-1 pl-5 w-full" type="number" step="any" value={item.applied_price_usd} onChange={e => onPriceChange(item.id, 'usd', e.target.value)} />
        </div>
        <div className="relative flex-1 min-w-[70px]">
          <input className="input text-xs py-1 pr-5 w-full" type="number" step="any" value={Number(item.applied_price_khr).toFixed(0)} onChange={e => onPriceChange(item.id, 'khr', e.target.value)} />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{khrSymbol}</span>
        </div>
      </div>

      {/* Line total */}
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-gray-400">{t ? t('line') : 'Line'}</span>
        <div className="text-right">
          <span className="text-sm font-bold text-blue-600">{fmtUSD(item.applied_price_usd * item.quantity)}</span>
          {item.applied_price_khr > 0 && <div className="text-xs text-gray-400">{fmtKHR(item.applied_price_khr * item.quantity)}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Small modal for adding a customer or delivery contact without leaving POS.
 * Uses a render-prop `fields` so callers control what inputs appear.
 */
