import { normalizePriceValue } from '../../utils/pricing.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { computeCartLineSavings } from './posCore.ts'
import AppSelect from '../shared/AppSelect'

type Translate = (key: string) => string | undefined
type CurrencyFormatter = (value: number) => string
type MoneyKind = 'usd' | 'khr'
type ManualDiscountType = 'percent' | 'fixed'

interface CartLineItem {
  id: string | number
  cart_line_id?: string | number
  name: string
  quantity: number
  branch_id?: string | number | null
  price_mode?: string
  product_discount_label?: string | null
  applied_price_usd: number
  applied_price_khr: number
  base_price_usd?: number
  base_price_khr?: number
  // Ordinary selling price, kept on every cart line regardless of price
  // mode (see POS.tsx's addToCart, which spreads the source product onto
  // the line) -- used only to show the "was $X, save $Y" comparison below
  // when a special price or promotion is in effect.
  selling_price_usd?: string | number
  selling_price_khr?: string | number
  // VIP (special) price carried from the source product onto the line, so
  // the cart can still offer the VIP tier-tag toggle after it's been
  // deselected back to a plain 'selling' line (the price stays put; only
  // the marker flips). See onToggleTierTag below.
  special_price_usd?: string | number
  special_price_khr?: string | number
  manual_discount_type?: ManualDiscountType | null
  manual_discount_value?: number
  manual_discount_usd?: number
  // Present only when this line was added via the batch/lot picker (see
  // POS.tsx's addToCart) -- was captured on the line but never actually
  // rendered anywhere in the cart, so a batch-tracked sale looked
  // identical to a plain one until the receipt.
  batch_id?: number | string | null
  batch_label?: string | null
  batch_expiry_date?: string | null
  // 11.9: this line draws from a damaged lot (see POS.tsx addToCart) --
  // shown in amber so a damage sale reads differently from a plain one.
  damaged_lot_label?: string | null
}

interface BranchOption {
  id: string | number
  name: string
  is_default?: boolean
}

interface CartItemProps {
  item: CartLineItem
  branches: BranchOption[]
  t?: Translate
  onQtyChange: (lineId: string | number, quantity: number) => void
  onPriceChange: (lineId: string | number, kind: MoneyKind, value: string) => void
  onDiscountChange: (lineId: string | number, type: ManualDiscountType | null, value: string) => void
  onBranchChange: (lineId: string | number, branchId: string) => void
  // Flips the line's VIP tier MARKER on/off (user). It only toggles whether
  // the line is recorded/printed as VIP -- the price is never touched -- so
  // deselecting leaves the exact number in place and just stops the tag
  // printing on the receipt. Only offered on lines that carry a VIP price.
  onToggleTierTag: (lineId: string | number) => void
  onRemove: (lineId: string | number) => void
  onShowDetails: () => void
  fmtUSD: CurrencyFormatter
  fmtKHR: CurrencyFormatter
  usdSymbol: string
  khrSymbol: string
  // Controlled by Settings' "Show Discount in Cart" toggle
  // (pos_show_item_discount). Defaults to true (undefined === shown) so
  // existing behavior doesn't regress for anyone who hasn't touched the
  // setting. Only affects the before/after comparison below -- the
  // special/promotion text label above always shows regardless, and the
  // manual per-item discount editor further down is never hidden by this.
  showItemDiscount?: boolean
}

function translate(t: Translate | undefined, key: string, fallback: string): string {
  return t?.(key) || fallback
}

export default function CartItem({
  item,
  branches,
  t,
  onQtyChange,
  onPriceChange,
  onDiscountChange,
  onBranchChange,
  onToggleTierTag,
  onRemove,
  onShowDetails,
  fmtUSD,
  fmtKHR,
  usdSymbol,
  khrSymbol,
  showItemDiscount = true,
}: CartItemProps) {
  const lineId = item.cart_line_id || item.id
  // The line carries a VIP price -> offer the VIP tier-tag toggle. Kept
  // separate from `price_mode` so the chip stays visible (just unhighlighted)
  // after the marker is switched off. "VIP" reads the same in both packs
  // (matches the POS grid/detail sheet), so it needs no lang key.
  const hasVipPrice = Number(item.special_price_usd || 0) > 0 || Number(item.special_price_khr || 0) > 0
  const vipTagActive = item.price_mode === 'special'
  const promotionPriceLabel = item.product_discount_label || translate(t, 'promotion_price', 'Discount price')
  const savings = showItemDiscount ? computeCartLineSavings(item) : null

  return (
    <div
      className="cursor-pointer border-b border-gray-100 px-3 py-2.5 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/60"
      role="button"
      tabIndex={0}
      onClick={onShowDetails}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onShowDetails()
        }
      }}
      title={translate(t, 'details', 'Details')}
    >
      <div className="mb-2 flex items-start justify-between gap-1.5">
        <div className="mr-1 min-w-0 flex-1">
          <p {...getKhmerTextProps(item.name, 'leading-snug text-sm font-semibold text-gray-900 dark:text-white')}>{item.name}</p>
          {/* VIP tier tag as an on/off toggle (user): default selected/
              highlighted; deselecting only unhighlights it and drops the tag
              from the receipt -- the price never changes. Shown on any line
              that carries a VIP price so it can be re-selected after being
              switched off. stopPropagation so tapping the chip doesn't open
              the line's detail sheet (the whole row is a button). */}
          {hasVipPrice ? (
            <button
              type="button"
              aria-pressed={vipTagActive}
              onClick={(event) => { event.stopPropagation(); onToggleTierTag(lineId) }}
              className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none transition-colors ${
                vipTagActive
                  ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                  : 'border-emerald-300 bg-transparent text-emerald-500 opacity-60 hover:opacity-100 dark:border-emerald-700 dark:text-emerald-400'
              }`}
            >
              VIP
            </button>
          ) : null}
          {item.price_mode === 'promotion' ? (
            <div {...getKhmerTextProps(promotionPriceLabel, 'mt-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300')}>{promotionPriceLabel}</div>
          ) : null}
          {savings?.active ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-gray-400 line-through">{fmtUSD(savings.compare_at_usd)}</span>
              <span {...getKhmerTextProps(translate(t, 'pos_you_save', 'You save'), 'text-[10px] font-semibold text-emerald-600 dark:text-emerald-400')}>
                {translate(t, 'pos_you_save', 'You save')} {fmtUSD(savings.savings_usd)} ({savings.savings_percent}%)
              </span>
            </div>
          ) : null}
          {/* Batch/lot the line was sold from -- captured on the cart line
              since the batch picker (ProductDetailSheet.tsx) but never
              actually shown here before, so a batch-tracked sale looked
              no different from a plain one until the receipt printed. */}
          {item.batch_label ? (
            <div {...getKhmerTextProps(item.batch_label, 'mt-0.5 truncate text-[10px] font-medium text-sky-600 dark:text-sky-400')} title={item.batch_label}>
              {item.batch_label}
            </div>
          ) : null}
          {item.damaged_lot_label ? (
            <div className="mt-0.5 truncate text-[10px] font-medium text-orange-500 dark:text-orange-400" title={item.damaged_lot_label}>
              🟠 {item.damaged_lot_label}
            </div>
          ) : null}
        </div>
        {/* Branch selector merged into the title row (was its own
            full-width row below the title before) -- same info, one row
            instead of two, kept compact so it never crowds the title. */}
        <div className="flex flex-shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {branches.length > 1 ? (
            <AppSelect
              className="w-[100px]"
              buttonClassName="min-h-7 w-full rounded-lg py-1 pl-2 pr-1 text-[11px]"
              value={item.branch_id || ''}
              onChange={(nextValue) => onBranchChange(lineId, nextValue)}
              ariaLabel={translate(t, 'select_branch_placeholder', 'Select branch')}
              options={[
                { value: '', label: translate(t, 'select_branch_placeholder', 'Select branch') },
                ...branches.map((branch) => ({
                  value: branch.id,
                  label: `${branch.name}${branch.is_default ? ' *' : ''}`,
                })),
              ]}
            />
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(lineId)}
            className="px-1 text-base leading-none text-red-400 hover:text-red-600"
            title={translate(t, 'remove', 'Remove')}
            aria-label={translate(t, 'remove', 'Remove')}
          >
            x
          </button>
        </div>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
          <button type="button" className="flex h-7 w-7 items-center justify-center text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => onQtyChange(lineId, item.quantity - 1)}>-</button>
          <input
            className="w-10 border-x border-gray-200 bg-transparent py-1 text-center text-xs text-gray-900 dark:border-gray-600 dark:text-white"
            type="number"
            min="1"
            value={item.quantity}
            onChange={(event) => onQtyChange(lineId, Number.parseInt(event.target.value, 10) || 1)}
          />
          <button type="button" className="flex h-7 w-7 items-center justify-center text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => onQtyChange(lineId, item.quantity + 1)}>+</button>
        </div>
        {/* Z2: the price input shows the line's SELLING/base price and stays
            put when a discount is applied -- the discount reduces the line
            total below, never this field. Editing it sets the selling price
            (POS.tsx updatePrice re-applies any manual discount against it). */}
        <div className="relative min-w-[70px] flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{usdSymbol}</span>
          <input
            className="input w-full py-1 pl-5 text-xs"
            type="number"
            step="any"
            value={normalizePriceValue((item.base_price_usd ?? item.applied_price_usd) || 0).toFixed(2)}
            onChange={(event) => onPriceChange(lineId, 'usd', event.target.value)}
          />
        </div>
        <div className="relative min-w-[70px] flex-1">
          <input
            className="input w-full py-1 pr-5 text-xs"
            type="number"
            step="any"
            // KHR is a whole-riel currency everywhere else in the app --
            // showing 4100.00 here was the one decimal-riel holdout.
            value={normalizePriceValue((item.base_price_khr ?? item.applied_price_khr) || 0).toFixed(0)}
            onChange={(event) => onPriceChange(lineId, 'khr', event.target.value)}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{khrSymbol}</span>
        </div>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
        <span className="flex-shrink-0 text-[11px] text-gray-400">{translate(t, 'discount', 'Discount')}</span>
        <div className="flex flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 text-sm font-medium dark:border-gray-600">
          <button
            type="button"
            className={`min-w-[2.25rem] px-2.5 py-1 ${item.manual_discount_type === 'percent' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            onClick={() => onDiscountChange(lineId, 'percent', String(item.manual_discount_type === 'percent' ? item.manual_discount_value || 0 : 0))}
          >
            %
          </button>
          <button
            type="button"
            className={`min-w-[2.25rem] border-l border-gray-200 px-2.5 py-1 dark:border-gray-600 ${item.manual_discount_type === 'fixed' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            onClick={() => onDiscountChange(lineId, 'fixed', String(item.manual_discount_type === 'fixed' ? item.manual_discount_value || 0 : 0))}
          >
            {usdSymbol}
          </button>
        </div>
        <input
          className="input min-w-0 flex-1 py-1 text-xs"
          type="number"
          min="0"
          step="any"
          disabled={!item.manual_discount_type}
          placeholder={item.manual_discount_type === 'percent' ? '0%' : '0.00'}
          value={item.manual_discount_type ? String(item.manual_discount_value ?? '') : ''}
          onChange={(event) => onDiscountChange(lineId, item.manual_discount_type ?? 'fixed', event.target.value)}
        />
        {item.manual_discount_type ? (
          <button
            type="button"
            className="flex-shrink-0 px-1 text-[11px] text-gray-400 hover:text-red-500"
            onClick={() => onDiscountChange(lineId, null, '0')}
            title={translate(t, 'clear_discount', 'Clear discount')}
          >
            {translate(t, 'clear', 'Clear')}
          </button>
        ) : null}
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-xs text-gray-400">{translate(t, 'line', 'Line')}</span>
        <div className="text-right">
          <span className="text-sm font-bold text-blue-600">{fmtUSD(item.applied_price_usd * item.quantity)}</span>
          {item.applied_price_khr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(item.applied_price_khr * item.quantity)}</div> : null}
          {item.manual_discount_usd ? (
            <div {...getKhmerTextProps(translate(t, 'discount', 'Discount'), 'text-[10px] font-medium text-amber-600 dark:text-amber-400')}>
              -{fmtUSD(item.manual_discount_usd * item.quantity)} {translate(t, 'discount', 'discount')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
