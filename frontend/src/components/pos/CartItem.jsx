import { normalizePriceValue } from '../../utils/pricing.js'

export default function CartItem({
  item, branches, t,
  onQtyChange, onPriceChange, onBranchChange, onRemove, onShowDetails,
  fmtUSD, fmtKHR, usdSymbol, khrSymbol,
}) {
  const lineId = item.cart_line_id || item.id

  return (
    <div className="border-b border-gray-100 px-3 py-2.5 last:border-0 dark:border-gray-700">
      <div className="mb-2 flex items-start justify-between">
        <div className="mr-2 min-w-0 flex-1">
          <p className="leading-snug text-sm font-semibold text-gray-900 dark:text-white">{item.name}</p>
          {item.price_mode === 'special' ? (
            <div className="mt-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{t ? t('special_price') : 'Special price'}</div>
          ) : null}
          {item.price_mode === 'promotion' ? (
            <div className="mt-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300">{item.product_discount_label || (t ? t('promotion_price') : 'Promotion price')}</div>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onShowDetails}
            className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-gray-200 px-2 text-base font-bold leading-none text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
            title={t ? t('details') : 'Details'}
          >
            ...
          </button>
          <button
            type="button"
            onClick={() => onRemove(lineId)}
            className="px-1 text-base leading-none text-red-400 hover:text-red-600"
            title={t ? t('remove') : 'Remove'}
            aria-label={t ? t('remove') : 'Remove'}
          >
            x
          </button>
        </div>
      </div>

      {branches.length > 1 ? (
        <div className="mb-2">
          <select
            className="input text-xs py-1"
            value={item.branch_id || ''}
            onChange={(event) => onBranchChange(lineId, event.target.value)}
          >
            <option value="">{t ? t('select_branch_placeholder') : 'Select branch'}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.is_default ? ' *' : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <div className="flex flex-shrink-0 items-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
          <button type="button" className="flex h-7 w-7 items-center justify-center text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => onQtyChange(lineId, item.quantity - 1)}>-</button>
          <input
            className="w-10 border-x border-gray-200 bg-transparent py-1 text-center text-xs text-gray-900 dark:border-gray-600 dark:text-white"
            type="number"
            min="1"
            value={item.quantity}
            onChange={(event) => onQtyChange(lineId, parseInt(event.target.value, 10) || 1)}
          />
          <button type="button" className="flex h-7 w-7 items-center justify-center text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => onQtyChange(lineId, item.quantity + 1)}>+</button>
        </div>
        <div className="relative min-w-[70px] flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{usdSymbol}</span>
          <input
            className="input w-full py-1 pl-5 text-xs"
            type="number"
            step="any"
            value={normalizePriceValue(item.applied_price_usd || 0).toFixed(2)}
            onChange={(event) => onPriceChange(lineId, 'usd', event.target.value)}
          />
        </div>
        <div className="relative min-w-[70px] flex-1">
          <input
            className="input w-full py-1 pr-5 text-xs"
            type="number"
            step="any"
            value={normalizePriceValue(item.applied_price_khr || 0).toFixed(2)}
            onChange={(event) => onPriceChange(lineId, 'khr', event.target.value)}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{khrSymbol}</span>
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-xs text-gray-400">{t ? t('line') : 'Line'}</span>
        <div className="text-right">
          <span className="text-sm font-bold text-blue-600">{fmtUSD(item.applied_price_usd * item.quantity)}</span>
          {item.applied_price_khr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(item.applied_price_khr * item.quantity)}</div> : null}
        </div>
      </div>
    </div>
  )
}
