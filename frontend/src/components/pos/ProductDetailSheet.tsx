import ImageOff from 'lucide-react/dist/esm/icons/image-off.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { calculateProductDiscount } from '../../utils/pricing.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import ProductImage from './ProductImage'

type ProductGroupMeta = {
  groupKind?: string
  hasExplicitGroup?: boolean
  hasMultipleItems?: boolean
  maxSellingPriceUsd?: number
  minSellingPriceUsd?: number
  stockTotal?: number
}

type BranchStockRecord = {
  branch_id?: string | number
  quantity?: string | number
}

type ProductRecord = Record<string, unknown> & {
  __displayName?: string
  __groupChoices?: ProductRecord[]
  __groupKey?: string
  __groupMeta?: ProductGroupMeta
  __variantLabel?: string
  applied_price_khr?: number
  applied_price_usd?: number
  barcode?: string
  branch_id?: string | number | null
  branch_stock?: BranchStockRecord[]
  brand?: string
  cart_line_id?: string
  category?: string
  cost_price_khr?: string | number
  cost_price_usd?: string | number
  description?: string
  discount_label?: string
  id: string | number
  image_gallery?: string | string[]
  image_path?: string
  is_active?: boolean
  is_group?: boolean
  low_stock_threshold?: string | number
  name: string
  out_of_stock_threshold?: string | number
  parent_id?: string | number | null
  price_mode?: string
  product_discount_khr?: number
  product_discount_label?: string
  product_discount_type?: string | null
  product_discount_usd?: number
  purchase_price_khr?: string | number
  purchase_price_usd?: string | number
  quantity?: number
  selling_price_khr?: string | number
  selling_price_usd?: string | number
  sku?: string
  special_price_khr?: string | number
  special_price_usd?: string | number
  stock_quantity?: string | number
  supplier?: string
  unit?: string
}

type Translate = (key: string) => string | undefined
type CurrencyFormatter = (value: number) => string
type PriceMode = 'selling' | 'special' | 'promotion' | string

interface ProductDetailSheetProps {
  product: ProductRecord
  exchangeRate: number
  t: Translate
  fmtUSD: CurrencyFormatter
  fmtKHR: CurrencyFormatter
  asNumber: (value: unknown) => number
  posCopy: (english: string, fallback?: string) => string
  getDisplayStock: (product: ProductRecord | undefined, cartItem?: { branch_id?: string | number | null } | null) => number
  getPrimaryProductImage: (product: ProductRecord) => string
  getVariantChoices: (product: ProductRecord) => ProductRecord[]
  hasVariantChoices: (product: ProductRecord) => boolean
  onAddToCart: (product: ProductRecord, priceMode?: PriceMode) => void
  onClose: () => void
  onOpenImageLightbox: (product: ProductRecord, index: number) => void
}

export default function ProductDetailSheet({
  product,
  exchangeRate,
  t,
  fmtUSD,
  fmtKHR,
  asNumber,
  posCopy,
  getDisplayStock,
  getPrimaryProductImage,
  getVariantChoices,
  hasVariantChoices,
  onAddToCart,
  onClose,
  onOpenImageLightbox,
}: ProductDetailSheetProps) {
  const stock = getDisplayStock(product)
  const variants = getVariantChoices(product)
  const groupProduct = hasVariantChoices(product)
  const groupMeta = product.__groupMeta || null
  const promotion = calculateProductDiscount(product, exchangeRate)
  const choiceLabel = groupMeta?.groupKind === 'variant'
    ? posCopy('Variants', 'Variants')
    : posCopy('Options', 'Options')
  const primaryImage = getPrimaryProductImage(product)
  const displayName = product.__displayName || product.name || ''
  const closeAfterAdd = (nextProduct: ProductRecord, priceMode: PriceMode) => {
    onAddToCart(nextProduct, priceMode)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0"
              onClick={() => onOpenImageLightbox(product, 0)}
              aria-label={posCopy('Preview product images')}
            >
              {primaryImage ? <ProductImage src={primaryImage} alt={displayName} className="w-full h-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-400" />}
            </button>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 dark:text-white truncate">{displayName}</div>
              {product.sku ? <div className="text-xs text-gray-400 font-mono">{product.sku}</div> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2 text-sm">
          {([
            [t('label_category') || 'Category', product.category],
            [t('label_supplier') || 'Supplier', product.supplier],
            [t('label_unit') || 'Unit', product.unit],
            [t('label_barcode') || 'Barcode', product.barcode],
            [t('label_description') || 'Description', product.description],
          ] as Array<[string, string | number | undefined]>).map(([label, val]) => val ? (
            <div key={label} className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</span><span className="text-sm text-gray-800 dark:text-gray-200">{String(val)}</span></div>
          ) : null)}
          <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('label_selling_price') || 'Price'}</span><div><span className="font-bold text-blue-600">{fmtUSD(asNumber(product.selling_price_usd))}</span>{asNumber(product.selling_price_khr) > 0 ? <span className="text-xs text-gray-400 ml-2">{fmtKHR(asNumber(product.selling_price_khr))}</span> : null}</div></div>
          {asNumber(product.special_price_usd) > 0 || asNumber(product.special_price_khr) > 0 ? (
            <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('special_price') || 'Special'}</span><div><span className="font-bold text-emerald-600">{fmtUSD(asNumber(product.special_price_usd || product.selling_price_usd || 0))}</span>{asNumber(product.special_price_khr || product.selling_price_khr || 0) > 0 ? <span className="text-xs text-gray-400 ml-2">{fmtKHR(asNumber(product.special_price_khr || product.selling_price_khr || 0))}</span> : null}</div></div>
          ) : null}
          {promotion.active ? (
            <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{posCopy('Discounts', 'Discounts')}</span><div><span className="font-bold text-rose-600">{fmtUSD(promotion.applied_price_usd || 0)}</span>{(promotion.applied_price_khr || 0) > 0 ? <span className="text-xs text-gray-400 ml-2">{fmtKHR(promotion.applied_price_khr || 0)}</span> : null}</div></div>
          ) : null}
          <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('label_stock') || 'Stock'}</span><span className={`font-bold ${stock <= 0 ? 'text-red-600' : stock <= (asNumber(product.low_stock_threshold) || 10) ? 'text-yellow-600' : 'text-green-600'}`}>{stock} {product.unit}</span></div>
          {groupProduct ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{choiceLabel}</div>
              <div className="space-y-2">
                {variants.map((variant) => {
                  const variantStock = getDisplayStock(variant)
                  const variantInStockNow = variantStock > asNumber(variant.out_of_stock_threshold)
                  const variantPromotion = calculateProductDiscount(variant, exchangeRate)
                  return (
                    <div key={variant.id} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
                      <div className="flex items-center gap-2">
                        {variant.__variantLabel ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{variant.__variantLabel}</span> : null}
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{variant.name}</div>
                      </div>
                      <div {...getKhmerTextProps(variant.unit, 'mt-0.5 text-xs text-gray-500 dark:text-gray-400')}>{variantStock} {variant.unit}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button className="btn-primary flex-1 text-xs" disabled={!variantInStockNow} onClick={() => closeAfterAdd(variant, 'selling')}>
                          {fmtUSD(asNumber(variant.selling_price_usd || 0))}
                        </button>
                        {asNumber(variant.special_price_usd) > 0 || asNumber(variant.special_price_khr) > 0 ? (
                          <button className="btn-secondary flex-1 text-xs" disabled={!variantInStockNow} onClick={() => closeAfterAdd(variant, 'special')}>
                            {posCopy('Special', 'Special')} {fmtUSD(asNumber(variant.special_price_usd || variant.selling_price_usd || 0))}
                          </button>
                        ) : null}
                        {variantPromotion.active ? (
                          <button className="btn-secondary flex-1 text-xs border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-200" disabled={!variantInStockNow} onClick={() => closeAfterAdd(variant, 'promotion')}>
                            {variant.discount_label || posCopy('Discounts', 'Discounts')} {fmtUSD(variantPromotion.applied_price_usd)}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
        {!groupProduct ? (
          <div className="border-t border-gray-200 p-4 dark:border-gray-700">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button className="btn-primary flex-1" disabled={stock <= asNumber(product.out_of_stock_threshold)} onClick={() => closeAfterAdd(product, 'selling')}>
                {stock <= asNumber(product.out_of_stock_threshold) ? t('out_of_stock') : `${posCopy('Regular', 'Regular')} ${fmtUSD(asNumber(product.selling_price_usd || 0))}`}
              </button>
              {promotion.active ? (
                <button className="btn-secondary flex-1 border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-200" disabled={stock <= asNumber(product.out_of_stock_threshold)} onClick={() => closeAfterAdd(product, 'promotion')}>
                  {product.discount_label || posCopy('Discounts', 'Discounts')} {fmtUSD(promotion.applied_price_usd)}
                </button>
              ) : null}
              {asNumber(product.special_price_usd) > 0 || asNumber(product.special_price_khr) > 0 ? (
                <button className="btn-secondary flex-1" disabled={stock <= asNumber(product.out_of_stock_threshold)} onClick={() => closeAfterAdd(product, 'special')}>
                  {posCopy('Special', 'Special')} {fmtUSD(asNumber(product.special_price_usd || product.selling_price_usd || 0))}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
