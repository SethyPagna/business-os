import ProductNameRail from '../../shared/ProductNameRail'
import { useApp } from '../../../AppContext'
import { canViewAcquisitionCosts } from '../../../utils/acquisitionCostAccess.ts'
import type { PermissionUser } from '../../../utils/permissions.ts'
import X from 'lucide-react/dist/esm/icons/x.js'
import PlusCircle from 'lucide-react/dist/esm/icons/plus-circle.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import { useState, Suspense, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ProductImg, ProductImagePlaceholder } from '../shared/primitives'
import { useCopyFloat } from '../../shared/CopyFloat.tsx'
import { getContrastingTextColor } from '../../../utils/color.ts'
import { calculateProductDiscount } from '../../../utils/pricing.ts'
import { getVisibleProductBatches } from '../../../utils/productBatches.ts'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { ADMIN_MAX_PRODUCT_GALLERY_IMAGES } from '../helpers/productGalleryHelpers.ts'
import { useLowStockConfig } from '../../../AppContext'
import { effectiveLowStockThreshold } from '../../../utils/lowStockSettings.ts'
import EntityLink, { type EntityNavigate } from '../../shared/EntityLink.tsx'
import { TOOLBAR_BUTTON_BASE, toolbarIconButtonClassName } from '../../shared/toolbarButtonStyles.ts'
import CostCalculationFloat from '../../shared/CostCalculationFloat.tsx'
import ScrollText from 'lucide-react/dist/esm/icons/scroll-text.js'

// Loaded when the float is opened. The field history is a rare read behind a
// permission tier; imported statically it joins this page's startup closure
// (tests/performanceBudgets.test.ts measures exactly that closure), so every
// operator would pay to download a float most of them never open.
const EntityRecordsFloat = lazyRetry(() => import('../../shared/EntityRecordsFloat.tsx'), 'products-records-float')
const ProductDescriptionDetailModal = lazyRetry(() => import('./ProductDescriptionDetailModal'), 'products-description-detail-modal')
// D3 (Part 422): the detail page's report sections (batch summary,
// movements with running balance, sales breakdown, suppliers) -- its own
// chunk, loaded only when a detail pane opens.
const ProductDetailReport = lazyRetry(() => import('./ProductDetailReport.tsx'), 'products-detail-report')

// The links row's chip shape; ProductDetailReport's own chips use the same
// string (it is a lazy chunk, so importing a shared constant from it would pull
// it into this page's startup closure).
const LINK_CHIP = 'inline-flex h-8 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs transition-colors'

type Translate = (key: string) => string | undefined
type FormatMoney = (value: unknown) => string

type ColorLookupEntry = {
  color?: string
}

type ColorLookup = Record<string, ColorLookupEntry | undefined>
type BrandColorLookup = Record<string, string | undefined>

type BranchStockEntry = {
  branch_id?: string | number | null
  branch_name?: string
  quantity?: unknown
}

type ProductDetailProduct = {
  name?: unknown
  sku?: string
  barcode?: string
  category?: string
  brand?: string
  supplier?: string
  unit?: string
  description?: string
  stock_quantity?: unknown
  out_of_stock_threshold?: unknown
  low_stock_threshold?: unknown
  purchase_price_usd?: unknown
  cost_price_usd?: unknown
  purchase_price_khr?: unknown
  cost_price_khr?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  // special_price_* is deliberately absent: the 2026-09-04 ruling deleted the
  // "VIP" tier (it was the wholesale price all along) and migration 0111 moved
  // its values into wholesale_price_*, leaving the old columns dead.
  wholesale_price_usd?: unknown
  wholesale_price_khr?: unknown
  discount_badge_color?: string
  discount_label?: string
  expiry_date?: string
  created_at?: string
  image_path?: string
  image_gallery?: unknown[]
  batches?: unknown
  branch_stock?: BranchStockEntry[]
  [key: string]: unknown
}

type ProductDetailModalProps = {
  p: ProductDetailProduct
  catMap?: ColorLookup
  unitMap?: ColorLookup
  brandColorMap?: BrandColorLookup
  fmtUSD: FormatMoney
  fmtKHR: FormatMoney
  onEdit: () => void
  // Delete lives inside the Edit flow (ProductForm's footer), not here.
  // Each action renders only when its callback is passed, so the caller's
  // permission check decides whether the button exists at all.
  onAddVariant?: () => void
  onDiscount?: () => void
  onAdjustStock?: () => void
  onClose: () => void
  onImageClick?: (imagePath: string, gallery: string[], index: number) => void
  onManageBatches?: () => void
  navigateTo?: EntityNavigate
  t?: Translate
}

type DetailRowProps = {
  label: string
  children: ReactNode
}

type PriceCellProps = {
  label: string
  children: ReactNode
}

const MS_PER_DAY = 86400000

export default function ProductDetailModal({
  p,
  unitMap,
  fmtUSD,
  fmtKHR,
  onEdit,
  onAddVariant,
  onAdjustStock,
  onClose,
  onImageClick,
  onManageBatches,
  navigateTo,
  t,
}: ProductDetailModalProps) {
  const { user, getPermissionTier, can } = useApp() as { user: PermissionUser; getPermissionTier: (key: string) => string; can?: (key: string, action: string) => boolean }
  // Owner, 5 Oct 2026 (evening): the sales / supplier history report is a Products sub-page; the Employee default
  // (products:history off) sees only the product's own information and images here. The Worker refuses the reads too.
  const canReadProductHistory = can ? can('products', 'history') : false
  const canViewCosts = canViewAcquisitionCosts(user)
  const [descriptionDetailOpen, setDescriptionDetailOpen] = useState(false)
  // P10-6: the calculated-cost float.
  const [costFloatOpen, setCostFloatOpen] = useState(false)
  // The product's Records (field history). Its rows come from the audit
  // trail, read through the audit_log permission, whose 'view' tier answers
  // with the CALLER'S OWN entries only; a list scoped to one reader presented
  // as "this product's history" is a wrong answer, so the link appears only
  // at the tier that sees all of it.
  const [fieldHistoryOpen, setFieldHistoryOpen] = useState(false)
  const canReadFieldHistory = getPermissionTier('audit_log') === 'full'
  const T = (key: string, fallback: string) => {
    const translated = typeof t === 'function' ? t(key) : ''
    return translated && translated !== key ? translated : fallback
  }
  // Name, brand, supplier and barcode all copy through the one shared
  // float: double-click on a pointer device, press-and-hold on touch.
  const copy = useCopyFloat(T)
  const productName = String(p.name || '')
  const purchaseUsd = Number(p.purchase_price_usd || p.cost_price_usd || 0)
  const purchaseKhr = Number(p.purchase_price_khr || p.cost_price_khr || 0)
  const sellingUsd = Number(p.selling_price_usd || 0)
  const wholesaleUsd = Number(p.wholesale_price_usd || 0)
  const wholesaleKhr = Number(p.wholesale_price_khr || 0)
  const sellingKhr = Number(p.selling_price_khr || 0)
  const stockQuantity = Number(p.stock_quantity || 0)
  const outOfStockThreshold = Number(p.out_of_stock_threshold || 0)
  // Settings > Stock Alerts -- the same number the row behind this modal was
  // coloured by, so opening a product cannot change its verdict.
  const lowStockThreshold = effectiveLowStockThreshold(useLowStockConfig(), p.low_stock_threshold)
  const promotion = calculateProductDiscount(p)
  const marginUsd = sellingUsd - purchaseUsd
  const marginPct = sellingUsd > 0 ? (marginUsd / sellingUsd) * 100 : 0
  const gallery = Array.isArray(p?.image_gallery) && p.image_gallery.length
    ? p.image_gallery.filter((imagePath): imagePath is string => Boolean(imagePath)).slice(0, ADMIN_MAX_PRODUCT_GALLERY_IMAGES)
    : (p?.image_path ? [p.image_path] : [])
  const primaryImage = gallery[0] || ''
  const unitColor = p.unit ? unitMap?.[p.unit]?.color || '' : ''
  const expiryDate = String(p.expiry_date || '').trim()
  const expiryDaysLeft = expiryDate ? Math.ceil((new Date(`${expiryDate}T00:00:00`).getTime() - Date.now()) / MS_PER_DAY) : null
  // includeEmpty: true -- every product gets a "day added" batch at
  // creation (seedInitialBatchForNewProduct) that legitimately starts at 0
  // stock; the full detail view is the one place that should still count it.
  const visibleBatches = getVisibleProductBatches(p, 'all', { includeEmpty: true })
  // The list read attaches a scalar `batch_count` instead of the full array
  // (see cloudflare/src/lib/productBatches.ts's attachBatchCounts), so a
  // detail opened straight from a list row has the number but not the rows.
  const batchCount = visibleBatches.length || Number((p as { batch_count?: unknown }).batch_count || 0)
  const productId = Number(p.id)
  // Label column: w-16 on phones, w-20 from sm; leading-snug lets a Khmer
  // label take two lines. Every body row, the description included, uses it.
  const Row = ({ label, children }: DetailRowProps) => (
    <div className="flex min-w-0 gap-2">
      <span className="w-16 shrink-0 pt-0.5 text-xs leading-snug text-gray-400 sm:w-20">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200">{children}</span>
    </div>
  )
  const PriceCell = ({ label, children }: PriceCellProps) => (
    <div className="min-w-0 rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-700/40">
      <div className="text-[11px] leading-tight text-gray-400">{label}</div>
      <div className="mt-0.5 min-w-0 text-sm font-medium tabular-nums">{children}</div>
    </div>
  )

  // Received dates and Records lead the links row; the report renders them
  // first inside its own chip row (and so does its loading fallback).
  const leadingPills = (
    <>
      {batchCount ? (
        <button
          type="button"
          onClick={onManageBatches}
          disabled={!onManageBatches}
          className={`${LINK_CHIP} bg-amber-50/70 text-amber-700 hover:bg-amber-50 disabled:cursor-default dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/30`}
        >
          <Layers className="h-3.5 w-3.5 shrink-0" />
          <span className="detail-scroll-text min-w-0">{T('batches', 'Received dates')}</span>
          <span className="text-amber-500/80 dark:text-amber-300/70">({batchCount})</span>
        </button>
      ) : null}
      {canReadFieldHistory && productId > 0 ? (
        <button
          type="button"
          data-product-field-history=""
          onClick={() => setFieldHistoryOpen(true)}
          className={`${LINK_CHIP} bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-700`}
        >
          <ScrollText className="h-3.5 w-3.5 shrink-0" />
          {/* leading-relaxed: Khmer subscripts clip in a Latin line box. */}
          <span className="detail-scroll-text min-w-0 leading-relaxed">{T('field_history', 'Records')}</span>
        </button>
      ) : null}
    </>
  )

  const modal = (
    <>
    {/* This sheet renders at the body-level overlay layer so the fixed app
        header and bottom navigation cannot cover its rows or footer; the
        safe viewport classes keep every control inside the usable screen.

        The child floats (description, field history, cost calculation) are
        SIBLINGS of this overlay, never children -- see the note after it. */}
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        {/* items-start + gap-3: the thumbnail sits by the first title line
            and the gap is the guaranteed space before the X. */}
        <div className="flex items-start gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-xl dark:bg-gray-700">
            {primaryImage ? (
              <ProductImg
                src={primaryImage}
                alt={productName}
                className="h-full w-full cursor-zoom-in object-contain p-0.5"
                onClick={(event) => {
                  event.stopPropagation()
                  onImageClick?.(primaryImage, gallery, 0)
                }}
              />
            ) : (
              <ProductImagePlaceholder compact className="h-full w-full rounded-lg" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="min-w-0 font-bold text-gray-900 dark:text-white" {...copy(productName)}>
              {/* Balanced wrap in this header only: two near-equal lines, no
                  Khmer word orphaned on the second. */}
              <EntityLink className="text-inherit no-underline hover:text-inherit hover:no-underline" page="products" anchor="hub:products:products" search={productName} navigate={navigateTo} title={T('open_product', 'Open product')}><ProductNameRail name={productName} className="[text-wrap:balance]" /></EntityLink>
            </div>
            {/* Brand first, then category, on ONE line that scrolls sideways
                when long (scroll-x-clean has no touch-action, so a vertical
                swipe here still scrolls the sheet). SKU is a body row. */}
            {p.brand || p.category ? (
              <div className="scroll-x-clean mt-0.5 text-xs text-gray-500 dark:text-gray-400" data-detail-meta-row="brand-category">
                {p.brand ? <span className="whitespace-nowrap" {...copy(p.brand)}><EntityLink className="text-inherit no-underline hover:text-inherit hover:underline" page="products" anchor="hub:products:products" focus={{ brand: p.brand }} navigate={navigateTo} title={T('open_product', 'Open product')}>{p.brand}</EntityLink></span> : null}
                {p.brand && p.category ? <span className="mx-1 text-gray-300" aria-hidden="true">·</span> : null}
                {p.category ? <span className="whitespace-nowrap"><EntityLink className="text-inherit no-underline hover:text-inherit hover:underline" page="products" anchor="hub:products:products" focus={{ category: p.category }} navigate={navigateTo} title={T('open_product', 'Open product')}>{p.category}</EntityLink></span> : null}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label={T('close', 'Close')} className={toolbarIconButtonClassName}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 py-3">
            {/* Phones: one column. sm and up: identity rows left, prices and
                stock right, split by a thin divider; the links row spans both. */}
            <div className="grid grid-cols-1 gap-y-2.5 sm:grid-cols-2 sm:gap-x-5 sm:divide-x sm:divide-gray-100 dark:sm:divide-gray-700">
              <div className="min-w-0 space-y-2.5 sm:pr-5">
                <div className="grid grid-cols-1 gap-y-1.5">
                  {/* barcode contract: <span className="whitespace-nowrap font-mono">{p.barcode}</span> */}
                  {p.barcode ? <Row label={T('barcode', 'Barcode')}><EntityLink className="text-inherit no-underline hover:text-inherit hover:no-underline" page="products" anchor="hub:products:products" search={p.barcode} navigate={navigateTo} title={T('open_product', 'Open product')}><span className="whitespace-nowrap font-mono" {...copy(p.barcode)}>{p.barcode}</span></EntityLink></Row> : null}
                  {p.sku ? <Row label={T('sku', 'SKU')}><span className="font-mono">{p.sku}</span></Row> : null}
                  {p.supplier ? <Row label={T('label_supplier', 'Supplier')}><EntityLink className="text-inherit no-underline hover:text-inherit hover:no-underline" page="contacts" anchor="hub:contacts:suppliers" search={p.supplier} navigate={navigateTo} title={T('open_supplier', 'Open supplier')}><span {...copy(p.supplier)}>{p.supplier}</span></EntityLink></Row> : null}
                  {expiryDate ? (
                    <Row label={T('product_expiry_date', 'Expiry')}>
                      <span className={expiryDaysLeft != null && expiryDaysLeft < 0 ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}>
                        {expiryDate}
                        {expiryDaysLeft != null ? (
                          <span className="ml-2 text-xs">
                            {expiryDaysLeft < 0
                              ? `${T('expired', 'Expired')} ${Math.abs(expiryDaysLeft)}d`
                              : `${expiryDaysLeft}d`}
                          </span>
                        ) : null}
                      </span>
                    </Row>
                  ) : null}
                </div>

                {(p.branch_stock || []).length > 0 ? (
                  <Row label={T('branch', 'Branch')}>
                    <div className="scroll-x-clean flex min-w-0 flex-nowrap gap-1.5">
                      {(p.branch_stock || []).map((bs) => {
                        const branchQuantity = Number(bs.quantity || 0)
                        return (
                        <span
                          key={bs.branch_id || bs.branch_name}
                          className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                            branchQuantity > 0
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30'
                              : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                          }`}
                        >
                          <EntityLink page="branches" anchor="hub:branches:overview" navigate={navigateTo}>{bs.branch_name}</EntityLink>: {branchQuantity}
                        </span>
                        )
                      })}
                    </div>
                  </Row>
                ) : null}

                {/* One line with an ellipsis; the whole value opens the
                    formatted reader. Not a sideways scroller: a scrolled-away
                    box read as a description missing its first letters. */}
                {p.description ? (
                  <Row label={T('label_description', 'Description')}>
                    <button
                      type="button"
                      onClick={() => setDescriptionDetailOpen(true)}
                      className="block w-full min-w-0 truncate rounded text-left"
                      title={T('view_full_description', 'View full description')}
                      aria-label={T('view_full_description', 'View full description')}
                    >
                      {p.description}
                    </button>
                  </Row>
                ) : null}
              </div>

              <div className="min-w-0 space-y-2.5 border-t border-gray-100 pt-2.5 dark:border-gray-700 sm:border-t-0 sm:pl-5 sm:pt-0">
                <div className="grid grid-cols-2 gap-2" data-detail-price-row="cost-wholesale">
                  {canViewCosts ? <PriceCell label={T('label_cost', 'Cost')}>
                    <button type="button" onClick={() => setCostFloatOpen(true)} className="text-left text-red-600 decoration-dotted underline-offset-2 hover:underline" title={T('cost_breakdown_title', 'Calculated cost price')}>{fmtUSD(purchaseUsd)}</button>
                    {purchaseKhr > 0 ? <span className="ml-2 text-xs font-normal text-gray-400">{fmtKHR(purchaseKhr)}</span> : null}
                  </PriceCell> : null}
                  <PriceCell label={T('wholesale_price', 'Wholesale price')}>
                    {(wholesaleUsd > 0 || wholesaleKhr > 0) ? (
                      <>
                        <span className="text-indigo-600 dark:text-indigo-300">{fmtUSD(wholesaleUsd)}</span>
                        {wholesaleKhr > 0 ? <span className="ml-2 text-xs font-normal text-gray-400">{fmtKHR(wholesaleKhr)}</span> : null}
                      </>
                    ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </PriceCell>
                </div>
                <div className="grid grid-cols-2 gap-2" data-detail-price-row="selling-margin">
                  <PriceCell label={T('label_selling_price', 'Selling price')}>
                    <span className="text-green-600">{fmtUSD(sellingUsd)}</span>
                    {sellingKhr > 0 ? <span className="ml-2 text-xs font-normal text-gray-400">{fmtKHR(sellingKhr)}</span> : null}
                  </PriceCell>
                  {canViewCosts ? <PriceCell label={T('label_margin', 'Margin')}>
                    {purchaseUsd > 0 && sellingUsd > 0 ? (
                      <>
                        <span className={marginUsd >= 0 ? 'text-blue-600' : 'text-yellow-600'}>{fmtUSD(marginUsd)}</span>
                        <span className="ml-2 text-xs font-normal text-gray-400">{marginPct.toFixed(1)}%</span>
                      </>
                    ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </PriceCell> : null}
                </div>
                {/* Stock, unit and status on ONE row (owner, 30 Sep): the
                    badge needs no "Status" label of its own. */}
                <Row label={T('label_stock', 'Stock')}>
                  <strong className="text-gray-900 dark:text-white">{stockQuantity}</strong>
                  {p.unit ? (
                    unitColor ? (
                      <EntityLink page="products" anchor="hub:products:products" focus={{ unit: p.unit }} navigate={navigateTo} title={T('open_unit_products', 'Open products using this unit')} className="ml-2 text-inherit no-underline hover:text-inherit">
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: unitColor, color: getContrastingTextColor(unitColor) }}>
                          {p.unit}
                        </span>
                      </EntityLink>
                    ) : (
                      <EntityLink page="products" anchor="hub:products:products" focus={{ unit: p.unit }} navigate={navigateTo} title={T('open_unit_products', 'Open products using this unit')} className="ml-1 text-inherit no-underline hover:text-inherit">{p.unit}</EntityLink>
                    )
                  ) : null}
                  {stockQuantity <= outOfStockThreshold ? (
                    <span className="badge-red ml-2">{T('out_of_stock', 'Out of stock')}</span>
                  ) : stockQuantity <= lowStockThreshold ? (
                    <span className="badge-yellow ml-2">{T('low_stock', 'Low stock')}</span>
                  ) : (
                    <span className="badge-green ml-2">{T('in_stock', 'In stock')}</span>
                  )}
                </Row>
                {promotion.active ? (
                  <Row label={T('product_discount', 'Discounts')}>
                    <span className="text-rose-600 dark:text-rose-300">{fmtUSD(promotion.applied_price_usd)}</span>
                    {promotion.applied_price_khr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(promotion.applied_price_khr)}</span> : null}
                    <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: p.discount_badge_color || '#e11d48' }}>
                      {p.discount_label || `${promotion.percent_off || 0}%`}
                    </span>
                  </Row>
                ) : null}
              </div>
            </div>

            {/* The links row, rendered ONCE at every width (it used to mount
                the report twice, one copy hidden by CSS, so every open fetched
                it twice). Content-sized chips wrap to a second line on phones. */}
            {productId > 0 && canReadProductHistory ? (
              <div className="border-t border-gray-100 pt-2.5 dark:border-gray-700" data-detail-links-row="">
                <Suspense fallback={<div className="flex flex-wrap gap-1.5">{leadingPills}</div>}>
                  <ProductDetailReport productId={productId} barcode={p.barcode} t={t || (() => undefined)} fmtUSD={fmtUSD} leadingPills={leadingPills} />
                </Suspense>
              </div>
            ) : batchCount ? (
              <div className="flex flex-wrap gap-1.5 border-t border-gray-100 pt-2.5 dark:border-gray-700" data-detail-links-row="">{leadingPills}</div>
            ) : null}
          </div>

          {/* One row at every width (owner button policy, 27 Sep): Edit is the
              main action with icon + word; Add variant and Adjust stock are
              icon-only with a translated tooltip. */}
          <div className="flex items-center gap-2 border-t border-gray-200 px-3 py-2.5 dark:border-gray-700 sm:justify-end">
            {onAddVariant ? (
              <button
                type="button"
                className={`btn-secondary ${TOOLBAR_BUTTON_BASE} w-10 shrink-0 px-0`}
                onClick={onAddVariant}
                aria-label={T('add_variant', 'Add variant')}
                title={T('add_variant', 'Add variant')}
              >
                <PlusCircle className="h-4 w-4" />
              </button>
            ) : null}
            {onAdjustStock ? (
              <button
                type="button"
                className={`btn-secondary ${TOOLBAR_BUTTON_BASE} w-10 shrink-0 px-0`}
                onClick={onAdjustStock}
                aria-label={T('adjust_stock', 'Adjust stock')}
                title={T('adjust_stock', 'Adjust stock')}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              className={`btn-primary ${TOOLBAR_BUTTON_BASE} min-w-0 flex-1 sm:flex-none`}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4 shrink-0" />
              <span className="truncate">{T('edit', 'Edit')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    {/* Owner, 25 Sep 2026: opening a specific record from this sheet "goes
        back to the default view instead of showing that record, with no
        before/after". Root cause: these floats used to render INSIDE the
        overlay <div> above, whose onClick is onClose. Every float here is a
        portal, but React bubbles synthetic events through the COMPONENT tree,
        not the DOM -- so pressing a row in the Field history float (or
        anything in the cost or description float) bubbled up to that onClick
        and closed the whole product sheet, unmounting the float with it.
        Inventory's ProductDetailModal and POS's ProductDetailSheet already
        render theirs as siblings of the overlay; this is the same shape. */}
      {descriptionDetailOpen ? (
        <Suspense fallback={null}>
          <ProductDescriptionDetailModal
            productName={productName}
            description={p.description}
            category={p.category}
            brand={p.brand}
            onClose={() => setDescriptionDetailOpen(false)}
            t={t}
          />
        </Suspense>
      ) : null}
      {fieldHistoryOpen ? (
        <Suspense fallback={null}>
          <EntityRecordsFloat
            entity="product"
            entityId={productId || 0}
            subject={productName}
            createdAt={p.created_at}
            canViewCosts={canViewCosts}
            onClose={() => setFieldHistoryOpen(false)}
            t={(key) => (typeof t === 'function' ? (t(key) ?? key) : key)}
            fmtUSD={(value) => fmtUSD(Number(value))}
            fmtKHR={(value) => fmtKHR(Number(value))}
          />
        </Suspense>
      ) : null}
      {canViewCosts && costFloatOpen ? (
        <CostCalculationFloat
          productId={Number((p as { id?: unknown }).id) || 0}
          productName={productName}
          onClose={() => setCostFloatOpen(false)}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
          t={(key, fallback) => T(key, fallback)}
        />
      ) : null}
    </>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}
