import X from 'lucide-react/dist/esm/icons/x.js'
import PlusCircle from 'lucide-react/dist/esm/icons/plus-circle.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import { useState, Suspense, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ProductImg, ProductImagePlaceholder } from '../shared/primitives'
import { getContrastingTextColor } from '../../../utils/color.ts'
import { calculateProductDiscount } from '../../../utils/pricing.ts'
import { getVisibleProductBatches } from '../../../utils/productBatches.ts'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { ADMIN_MAX_PRODUCT_GALLERY_IMAGES } from '../helpers/productGalleryHelpers.ts'
import { useLowStockConfig } from '../../../AppContext'
import { effectiveLowStockThreshold } from '../../../utils/lowStockSettings.ts'

const ProductDescriptionDetailModal = lazyRetry(() => import('./ProductDescriptionDetailModal'), 'products-description-detail-modal')
// D3 (Part 422): the detail page's report sections (batch summary,
// movements with running balance, sales breakdown, suppliers) -- its own
// chunk, loaded only when a detail pane opens.
const ProductDetailReport = lazyRetry(() => import('./ProductDetailReport.tsx'), 'products-detail-report')

// Truncation length for the description Row's inline preview -- long
// enough to still be useful at a glance, short enough that a real
// Features/Benefits/Ingredients/Caution block (which can run to
// several hundred characters) always gets cut off with "..." rather
// than dumping the whole blob inline (Aug 23 ask).

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
  onAddVariant?: () => void
  // Aug 23 ask restores Adjust Stock as its own button (three standalone
  // buttons now: Add variant / Adjust stock / Edit) and, separately,
  // resolves the earlier Delete placement question the hard way: Delete
  // is no longer rendered here at all -- it lives inside the Edit flow
  // (ProductForm's own footer, see Products.tsx) instead of sitting as a
  // fourth button on this pane. onDelete is intentionally gone from this
  // component's props; Products.tsx now wires delete straight into
  // ProductForm. Discount stays a ProductForm-tab shortcut only (no
  // button here), same reasoning as before -- Pricing is a normal click
  // away once Edit is open.
  onDiscount?: () => void
  onAdjustStock?: () => void
  onClose: () => void
  onImageClick?: (imagePath: string, gallery: string[], index: number) => void
  onManageBatches?: () => void
  t?: Translate
}

type DetailRowProps = {
  label: string
  children: ReactNode
}

const MS_PER_DAY = 86400000

export default function ProductDetailModal({
  p,
  catMap,
  unitMap,
  brandColorMap,
  fmtUSD,
  fmtKHR,
  onEdit,
  onAddVariant,
  onAdjustStock,
  onClose,
  onImageClick,
  onManageBatches,
  t,
}: ProductDetailModalProps) {
  const [descriptionDetailOpen, setDescriptionDetailOpen] = useState(false)
  const T = (key: string, fallback: string) => {
    const translated = typeof t === 'function' ? t(key) : ''
    return translated && translated !== key ? translated : fallback
  }
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
  // brandColorMap is still accepted (external prop contract, callers may
  // pass it) but no longer used for styling here -- the header line brand
  // moved to plain truncated text matching Category's own styling instead
  // of a colored pill, since a small "...--truncated + color chip" combo
  // reads noisier on this already-tight single header line than it did as
  // its own full-width row in the details grid below.
  const expiryDate = String(p.expiry_date || '').trim()
  const expiryDaysLeft = expiryDate ? Math.ceil((new Date(`${expiryDate}T00:00:00`).getTime() - Date.now()) / MS_PER_DAY) : null
  // includeEmpty: true -- every product gets a "day added" batch at
  // creation (seedInitialBatchForNewProduct) that legitimately starts at 0
  // stock; the full detail view is the one place that should still show it
  // instead of filtering it out like the compact row/list previews do.
  // Summary count only now -- the full per-batch list moved behind the
  // click-to-view ManageBatchesModal (same live-fetched, per-branch batch
  // editor Inventory's own ProductDetailModal already opens via its
  // "View stock history"-style row), so this pane no longer needs to
  // render every batch inline just to say how many there are.
  const visibleBatches = getVisibleProductBatches(p, 'all', { includeEmpty: true })
  // The list read attaches a scalar `batch_count` instead of the full array
  // (see cloudflare/src/lib/productBatches.ts's attachBatchCounts), so a
  // detail opened straight from a list row has the number but not the rows.
  // Show that count so the Batches affordance appears (and opens the full
  // per-batch view) instead of vanishing at 0.
  const batchCount = visibleBatches.length || Number((p as { batch_count?: unknown }).batch_count || 0)
  // (The old "Batch: latest received date" row and its computation were
  // removed Aug 30 -- see the note where it rendered.)
  const copyBarcode = () => {
    if (!p.barcode || typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(String(p.barcode)).catch(() => {})
  }

  // Label column tightens to 4rem on phones (then 5rem from sm) and the gap
  // gap-3 to gap-2 -- per the Aug 19 2026 ask to tighten these value/label
  // pairs so each row takes less horizontal space, freeing room in the
  // sheet (see the action-button restack just below for the other half of
  // that same request).
  const Row = ({ label, children }: DetailRowProps) => (
    <div className="flex min-w-0 gap-2">
      <span className="w-16 flex-shrink-0 pt-0.5 text-xs text-gray-400 sm:w-20">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200">{children}</span>
    </div>
  )

  // Click-to-view row, same pattern as Inventory's own ProductDetailModal
  // "View stock history" row -- a summary count plus a chevron that opens the
  // full live-fetched, per-branch batch editor (ManageBatchesModal), rather
  // than rendering every batch inline in this already-dense pane. Extracted to
  // one element so it can render in TWO responsive slots (Part 563 ask): the
  // left mini-section on wide screens ("first half"), and -- on phones, where
  // the two mini-sections stack -- below the Status row and above the report
  // pills instead. Only one slot is ever visible (the other is display:none),
  // so both call the same onManageBatches with no conflict.
  const batchesButton = batchCount ? (
    <button
      type="button"
      onClick={onManageBatches}
      disabled={!onManageBatches}
      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-left text-xs text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-default disabled:opacity-100 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/30"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Layers className="h-3.5 w-3.5" />
        <span className="truncate">{T('batches', 'Batches')}</span> <span className="shrink-0 text-amber-500/80 dark:text-amber-300/70">({batchCount})</span>
      </span>
      {onManageBatches ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" /> : null}
    </button>
  ) : null

  const modal = (
    // This sheet used to live inside Products' page tree at z-50. On mobile,
    // that put it in a lower stacking context than the fixed app header and
    // bottom navigation, so those bars could cover its rows and action
    // footer. Rendering at the body-level overlay layer ensures the sheet is
    // above both bars, while the safe viewport classes keep every control
    // inside the usable screen area on notched/short devices.
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-5xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-xl dark:bg-gray-700">
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
            <div className="min-w-0">
              <div className="break-words font-bold text-gray-900 dark:text-white">{productName}</div>
              {/* Category/brand/SKU stay compact but expose their complete
                  values through horizontal touch scrolling. */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {/* Barcode leads this line ("in view details barcode show
                    first"). It is the identifier someone opens a product to
                    check or copy; category and brand are groupings they
                    already knew from the list they came from. The middot
                    separator moves onto the FOLLOWING items so the line
                    never opens with a stray dot when a product has no
                    barcode or SKU. */}
                {p.sku ? <span className="detail-scroll-text max-w-[100px] font-mono" title={p.sku}>{p.sku}</span> : null}
                {p.category ? <span className="detail-scroll-text max-w-[110px]" title={p.category}>{p.sku ? '· ' : ''}{p.category}</span> : null}
                {p.brand ? <span className="detail-scroll-text max-w-[110px]" title={p.brand}>&middot; {p.brand}</span> : null}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={T('close', 'Close')} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Aug 29 rework: the actions no longer occupy a right-hand column.
            They sit in ONE row along the bottom (see the footer below), which
            frees the whole pane for the product data. The old details/actions
            vertical split (with its slate-filled actions aside and heavy
            border) is replaced by two DATA mini-sections split by a THIN
            same-background divider on wide screens; on phones the two
            mini-sections stack into one full-width column so the label:value
            rows aren't crushed into a ~180px half the way the old split
            crushed them. The report block spans the full pane beneath both
            mini-sections. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="grid grid-cols-1 gap-y-2.5 sm:grid-cols-2 sm:gap-x-5 sm:divide-x sm:divide-gray-100 dark:sm:divide-gray-700">
              {/* Left mini-section: the compact identity + stock facts. */}
              <div className="min-w-0 space-y-2.5 sm:pr-5">
                <div className="grid grid-cols-1 gap-y-1.5">
                  {p.barcode ? <Row label={T('barcode', 'Barcode')}><button type="button" className="whitespace-nowrap text-left font-mono underline-offset-2 hover:text-blue-600 hover:underline" onClick={copyBarcode} title={T('copy_barcode', 'Copy barcode')}>{p.barcode}</button></Row> : null}
                  {p.sku ? <Row label={T('sku', 'SKU')}><span className="font-mono">{p.sku}</span></Row> : null}
                  {p.supplier ? <Row label={T('label_supplier', 'Supplier')}>{p.supplier}</Row> : null}
                  {/* Stock + Status moved to the right column after Margin
                      (Aug 30 ask) -- identity facts stay here. */}
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
                  <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
                    <div className="mb-1.5 text-xs text-gray-400">{T('label_branches', 'Branch Stock')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(p.branch_stock || []).map((bs) => {
                        const branchQuantity = Number(bs.quantity || 0)
                        return (
                        <span
                          key={bs.branch_id || bs.branch_name}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            branchQuantity > 0
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30'
                              : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                          }`}
                        >
                          {bs.branch_name}: {branchQuantity}
                        </span>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Desktop keeps all four related actions in this left-side
                    column, directly below Branch Stock. */}
                {batchesButton || Number(p.id) > 0 ? (
                  <div className="hidden border-t border-gray-100 pt-2 dark:border-gray-700 sm:block">
                    {batchesButton}
                    {Number(p.id) > 0 ? (
                      <Suspense fallback={<p className="py-2 text-center text-xs text-gray-400">...</p>}>
                        <ProductDetailReport productId={Number(p.id)} barcode={p.barcode} t={t || (() => undefined)} fmtUSD={fmtUSD} />
                      </Suspense>
                    ) : null}
                  </div>
                ) : null}

                {/* The "Batch: <latest received date>" row is REMOVED (Aug 30
                    ask): after the migration every product carries an
                    import-day opening lot, so "latest received" showed the
                    import date rather than any real receiving date -- a wrong
                    detail at a glance. Per-lot dates live behind the Batches
                    (stack icon) button above, which opens the real per-branch
                    lot editor. */}
              </div>

              {/* Right mini-section: description + the pricing stack. */}
              <div className="min-w-0 space-y-2.5 border-t border-gray-100 pt-2.5 dark:border-gray-700 sm:border-t-0 sm:pl-5 sm:pt-0">
                {/* The compact row keeps the complete description scrollable;
                    clicking also opens the formatted description reader. */}
                {p.description ? (
                  <div className="flex min-w-0 gap-2">
                    <span className="w-20 flex-shrink-0 pt-0.5 text-xs text-gray-400">{T('label_description', 'Description')}</span>
                    <button
                      type="button"
                      onClick={() => setDescriptionDetailOpen(true)}
                      className="detail-scroll-text min-w-0 flex-1 rounded text-left text-sm text-gray-800 underline-offset-2 hover:text-blue-700 hover:underline dark:text-gray-200 dark:hover:text-blue-300"
                      title={T('view_full_description', 'View full description')}
                    >
                      {p.description}
                    </button>
                  </div>
                ) : null}

                <Row label={T('label_cost', 'Cost')}>
                  <span className="text-red-600">{fmtUSD(purchaseUsd)}</span>
                  {purchaseKhr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(purchaseKhr)}</span> : null}
                </Row>
                <Row label={T('label_selling_price', 'Selling Price')}>
                  <span className="text-base font-semibold text-green-600">{fmtUSD(sellingUsd)}</span>
                  {sellingKhr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(sellingKhr)}</span> : null}
                </Row>
                {purchaseUsd > 0 && sellingUsd > 0 ? (
                  <Row label={T('label_margin', 'Margin')}>
                    <span className={`font-medium ${marginUsd >= 0 ? 'text-blue-600' : 'text-yellow-600'}`}>
                      {fmtUSD(marginUsd)}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">{marginPct.toFixed(1)}%</span>
                  </Row>
                ) : null}
                {/* Stock + Status directly after Margin (Aug 30 ask). */}
                <Row label={T('label_stock', 'Stock')}>
                  <strong className="text-gray-900 dark:text-white">{stockQuantity}</strong>
                  {p.unit ? (
                    unitColor ? (
                      <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: unitColor, color: getContrastingTextColor(unitColor) }}>
                        {p.unit}
                      </span>
                    ) : (
                      <span className="ml-1">{p.unit}</span>
                    )
                  ) : null}
                </Row>
                <Row label={T('status', 'Status')}>
                  {stockQuantity <= outOfStockThreshold ? (
                    <span className="badge-red">{T('out_of_stock', 'Out of stock')}</span>
                  ) : stockQuantity <= lowStockThreshold ? (
                    <span className="badge-yellow">{T('low_stock', 'Low stock')}</span>
                  ) : (
                    <span className="badge-green">{T('in_stock', 'In stock')}</span>
                  )}
                </Row>
                {/* The "VIP Price" Row that sat here is deleted by the
                    2026-09-04 ruling -- that tier was the wholesale price
                    misnamed, and the Wholesale row directly below now shows
                    the very numbers it used to (migration 0111 moved them). */}
                {(wholesaleUsd > 0 || wholesaleKhr > 0) ? (
                  <Row label={T('wholesale_price', 'Wholesale')}>
                    <span className="text-indigo-600 dark:text-indigo-300">{fmtUSD(wholesaleUsd)}</span>
                    {wholesaleKhr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(wholesaleKhr)}</span> : null}
                  </Row>
                ) : null}
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

            {/* Phones only (Part 563 ask): the two mini-sections have stacked
                by here, so Status has just rendered above -- drop Batches in
                right below it and above the report pills. The wide-screen copy
                lives in the left mini-section (sm:block there / sm:hidden here),
                so exactly one shows. */}
            {batchesButton ? (
              <div className="mt-2.5 border-t border-gray-100 pt-2 dark:border-gray-700 sm:hidden">
                {batchesButton}
              </div>
            ) : null}

            {/* Phones retain the report actions below the metadata. */}
            {Number(p.id) > 0 ? (
              <div className="mt-2.5 border-t border-gray-100 pt-2 dark:border-gray-700 sm:hidden">
                <Suspense fallback={<p className="py-2 text-center text-xs text-gray-400">...</p>}>
                  <ProductDetailReport productId={Number(p.id)} barcode={p.barcode} t={t || (() => undefined)} fmtUSD={fmtUSD} />
                </Suspense>
              </div>
            ) : null}
          </div>

          {/* Bottom action row (Aug 29 ask): the three actions -- Add variant
              / Adjust stock / Edit -- sit side by side in ONE row along the
              bottom, sharing the width equally (flex-1). Replaces the old
              right-hand slate-filled actions column; only a thin top border
              separates them from the data now, no slate fill. Labels stay
              visible at every width: below sm the row WRAPS (N4) so each
              action keeps a half-width cell and a 44px tap target instead of
              three cells squeezed past their labels and past the modal edge.
              Delete is not here -- it lives inside the Edit flow (ProductForm's
              own footer, see Products.tsx). */}
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
            {onAddVariant ? (
              <button
                type="button"
                className="btn-secondary flex min-h-11 min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] items-center justify-center gap-1.5 truncate px-3 py-2 text-xs sm:min-h-0 sm:basis-0 sm:text-sm"
                onClick={onAddVariant}
                aria-label={T('add_variant', 'Add variant')}
                title={T('add_variant', 'Add variant')}
              >
                <PlusCircle className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{T('add_variant', 'Add variant')}</span>
              </button>
            ) : null}
            {onAdjustStock ? (
              <button
                type="button"
                className="btn-secondary flex min-h-11 min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] items-center justify-center gap-1.5 truncate px-3 py-2 text-xs sm:min-h-0 sm:basis-0 sm:text-sm"
                onClick={onAdjustStock}
                aria-label={T('adjust_stock', 'Adjust stock')}
                title={T('adjust_stock', 'Adjust stock')}
              >
                <SlidersHorizontal className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{T('adjust_stock', 'Adjust stock')}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary flex min-h-11 min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] items-center justify-center gap-1.5 truncate px-3 py-2 text-xs sm:min-h-0 sm:basis-0 sm:text-sm"
              onClick={onEdit}
              aria-label={T('edit', 'Edit')}
              title={T('edit', 'Edit')}
            >
              <Pencil className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{T('edit', 'Edit')}</span>
            </button>
          </div>
        </div>
      </div>
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
    </div>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}
