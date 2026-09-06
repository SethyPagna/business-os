/**
 * ONE product card. The POS grid's card, lifted out of POS.tsx so the other
 * surface that searches products for a SALE -- the sale detail modal's
 * "Add items to this sale" and its Replace picker -- shows the identical
 * thing instead of a one-line row of its own.
 *
 * Owner, 2026-09-06: "for add to item, the design when clicked should be like
 * the POS, same identical design, don't create new." The click half became the
 * POS's own detail sheet first; this is the half you look at BEFORE clicking.
 * The POS renders this component -- it is not a copy taken from it -- so the
 * two surfaces cannot drift apart again.
 *
 * Everything environment-specific arrives as a prop, because "the stock on
 * this card" means a different shelf on each surface: the POS reads its
 * branch filter / best branch, the sale screen reads the sale's own branch.
 * The card never decides that; it only renders what `getStock` answers.
 */
import ImageOff from 'lucide-react/dist/esm/icons/image-off.js'
import ProductImage from './ProductImage'
import { computeExpiryStatus } from './posCore.ts'
import { getProductGalleryImages } from '../products/helpers/productGalleryHelpers.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { effectiveLowStockThreshold, type LowStockConfig } from '../../utils/lowStockSettings.ts'
import { promotionBadgeForProduct, evaluatePromotionPricing, type PromotionRule } from '../../utils/promotionRules.ts'

/**
 * Deliberately structural and open: the POS holds a full catalogue row and
 * the sale screen holds a search result, and neither has to pretend to be the
 * other for a card that only reads names, prices and thresholds off it.
 */
export type ProductCardProduct = Record<string, unknown>

/**
 * The group summary the card prints on its bottom row. The POS reads it off
 * the row (`__groupMeta`, built by the catalogue grouping); the sale screen
 * builds it from its own search groups. Same three numbers either way.
 */
export type ProductCardGroupMeta = {
  groupKind?: string
  maxSellingPriceUsd?: number
  stockTotal?: number
}

export interface ProductCardProps {
  product: ProductCardProduct
  /** The group's sellable rows -- empty for a flat product. */
  variants: readonly ProductCardProduct[]
  groupMeta: ProductCardGroupMeta | null
  /** Units on the shelf THIS surface is reading. */
  getStock: (product: ProductCardProduct) => number
  lowStockConfig: LowStockConfig
  promotionRules: readonly PromotionRule[]
  exchangeRate: number
  fmtUSD: (value: number) => string
  fmtKHR: (value: number) => string
  t: (key: string) => string
  /** The POS's `posCopy`: an en/km pair for text that is not a pack key. */
  copy: (en: string, km?: string) => string
  onOpen: (options: { groupProduct: boolean; inStock: boolean }) => void
  /**
   * Opens the image lightbox. Optional: a surface with no lightbox omits it
   * and the thumbnail is plain decoration rather than a control that does
   * nothing -- tapping it still opens the product, because the card does.
   */
  onOpenImage?: () => void
}

function asNumber(value: unknown): number {
  return Number(value || 0)
}

const CARD_IMAGE_FRAME = 'relative w-full aspect-square rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-2 overflow-hidden'

function ProductDiscountBadge({
  product,
  exchangeRate,
  fmtUSD,
  label = 'Discounts',
  promotionRules = [],
}: {
  exchangeRate: number
  fmtUSD: (value: number) => string
  label?: string
  product: ProductCardProduct
  promotionRules?: readonly PromotionRule[]
}) {
  // G1: one kernel decides what the card advertises -- the product's own
  // discount OR the best promotion rule, including "buy >= X" deals that
  // don't cut the qty-1 price but must still be visible on the card.
  const badge = promotionBadgeForProduct(product, promotionRules)
  if (!badge.active) return null
  const text = badge.kind === 'quantity_hint'
    ? ((badge.show_title && badge.title) || `${label} ${badge.min_quantity}+`)
    : `${(badge.show_title && badge.title) || String(product?.discount_label || '') || label} ${fmtUSD(evaluatePromotionPricing(product, 1, promotionRules, exchangeRate).unit_price_usd || 0)}`
  return (
    <span className="absolute bottom-1 left-1 right-1 z-10 truncate rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: badge.badge_color || '#e11d48' }} title={text}>
      {text}
    </span>
  )
}

export default function ProductCard({
  product,
  variants,
  groupMeta,
  getStock,
  lowStockConfig,
  promotionRules,
  exchangeRate,
  fmtUSD,
  fmtKHR,
  t,
  copy,
  onOpen,
  onOpenImage,
}: ProductCardProps) {
  const displayName = String(product.__displayName || product.name || '')
  const unit = String(product.unit || '')
  const tagLabel = String(product.tag_label || '').trim()
  const primaryImage = getProductGalleryImages(product)[0] || ''
  const groupProduct = variants.length > 0
  const choiceLabel = groupMeta?.groupKind === 'variant'
    ? copy('Variants', 'ជម្រើសផ្សេងៗ')
    : copy('Options', 'ជម្រើស')
  const stock   = getStock(product)
  const variantInStock = variants.some((variant) => getStock(variant) > asNumber(variant.out_of_stock_threshold))
  const inStock = groupProduct ? variantInStock : stock > asNumber(product.out_of_stock_threshold)
  const promoBadge = promotionBadgeForProduct(product, promotionRules)
  const expiryInfo = !groupProduct ? computeExpiryStatus(product.expiry_date as string | null | undefined, product.expiry_alert_days) : null
  const imageContent = (
    <>
      {primaryImage ? <ProductImage src={primaryImage} alt={displayName} className="w-full h-full object-cover" /> : <ImageOff className="h-5 w-5 text-gray-400" />}
      <ProductDiscountBadge product={product} exchangeRate={exchangeRate} fmtUSD={fmtUSD} label={copy('Discounts', 'ការបញ្ចុះតម្លៃ')} promotionRules={promotionRules} />
    </>
  )
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card relative cursor-pointer p-3 text-left transition-all ${inStock ? 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600' : 'opacity-60'}`}
      onClick={() => onOpen({ groupProduct, inStock })}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen({ groupProduct, inStock })
        }
      }}
    >
      {onOpenImage ? (
        <button
          type="button"
          className={CARD_IMAGE_FRAME}
          onClick={(event) => { event.stopPropagation(); onOpenImage() }}
          aria-label={copy('Preview product images', 'មើលរូបភាពទំនិញ')}
        >
          {imageContent}
        </button>
      ) : (
        <div className={CARD_IMAGE_FRAME}>{imageContent}</div>
      )}
      {/* The purple "Groups: N" chip that used to sit here was
          removed (user): it duplicated the "Options: N" count now
          shown on the bottom row below — same number twice. */}
      <p {...getKhmerTextProps(displayName, 'text-xs font-medium text-gray-900 dark:text-white leading-tight mb-1 line-clamp-2')}>
        {displayName}
        {/* P4: the operator's own memory-aid tag chip */}
        {tagLabel ? (
          <span className="ml-1 inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 align-middle text-[9px] font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{tagLabel}</span>
        ) : null}
      </p>
      {/* Product cards show only the normal selling price. VIP
          stays inside the product's price options, matching the
          wholesale tier instead of advertising a tier label on
          the outside grid. Grouped cards still show the highest
          option selling price. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-sm font-bold text-blue-600">
          {fmtUSD(groupProduct ? (groupMeta?.maxSellingPriceUsd || asNumber(product.selling_price_usd)) : asNumber(product.selling_price_usd))}
        </span>
      </div>
      {asNumber(product.selling_price_khr) > 0 && !groupProduct ? <p className="text-xs text-gray-400">{fmtKHR(asNumber(product.selling_price_khr))}</p> : null}
      {promoBadge.active ? (
        <p className="text-[11px] font-semibold" style={{ color: promoBadge.badge_color || '#e11d48' }}>
          {promoBadge.kind === 'quantity_hint'
            ? ((promoBadge.show_title && promoBadge.title) || `${copy('Buy', 'ទិញ')} ${promoBadge.min_quantity}+`)
            : `${(promoBadge.show_title && promoBadge.title) || String(product.discount_label || '') || copy('Discounts', 'ការបញ្ចុះតម្លៃ')} ${fmtUSD(evaluatePromotionPricing(product, 1, promotionRules, exchangeRate).unit_price_usd)}`}
        </p>
      ) : null}
      {/* Colored qty+unit instead of a separate "Out of Stock" label --
          same convention as Products/Inventory/Branches: red when out,
          amber/yellow when low, emerald when healthy. Group products have
          no single qty to color against (variants can each differ), so
          they keep the neutral gray style. */}
      {/* Grouped card's bottom row (user): "Options: N | Total: n"
          — the single home for the option count (the removed
          purple chip's duplicate) and the summed stock. The
          labels stay grey but the NUMBERS carry colour (user,
          Sep 3 2026): the option count in the accent, the summed
          stock in the same red/amber/emerald convention a flat
          product's "qty unit" uses, judged against the group's
          total. A flat product keeps its coloured "qty unit". */}
      <p {...getKhmerTextProps(groupProduct ? choiceLabel : unit, `text-xs mt-0.5 font-medium ${groupProduct ? 'text-gray-400 font-normal' : !inStock ? 'text-red-500' : stock <= effectiveLowStockThreshold(lowStockConfig, product.low_stock_threshold) ? 'text-yellow-500' : 'text-emerald-500'}`)}>
        {groupProduct ? (
          <>
            {choiceLabel}: <span className="font-semibold text-primary-600 dark:text-primary-400">{variants.length}</span>
            {groupMeta?.stockTotal != null ? (
              <>
                {' | '}{copy('Total', 'សរុប')}: <span className={`font-semibold ${groupMeta.stockTotal <= 0 ? 'text-red-500' : groupMeta.stockTotal <= effectiveLowStockThreshold(lowStockConfig, product.low_stock_threshold) ? 'text-yellow-500' : 'text-emerald-500'}`}>{groupMeta.stockTotal}</span>
              </>
            ) : null}
          </>
        ) : `${stock} ${unit}`}
      </p>
      {expiryInfo && expiryInfo.status !== 'ok' ? (
        <p className={`text-[11px] font-semibold ${expiryInfo.status === 'expired' ? 'text-red-600' : 'text-yellow-600'}`}>
          {expiryInfo.status === 'expired' ? (t('expired') || 'Expired') : (t('expiring_soon') || 'Expiring soon')}
        </p>
      ) : null}
    </div>
  )
}
