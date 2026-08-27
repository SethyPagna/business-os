import X from 'lucide-react/dist/esm/icons/x.js'
import PlusCircle from 'lucide-react/dist/esm/icons/plus-circle.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import { useState, Suspense, type ReactNode } from 'react'
import { ProductImg, ProductImagePlaceholder } from '../shared/primitives'
import { getContrastingTextColor } from '../../../utils/color.ts'
import { calculateProductDiscount } from '../../../utils/pricing.ts'
import { getVisibleProductBatches } from '../../../utils/productBatches.ts'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { ADMIN_MAX_PRODUCT_GALLERY_IMAGES } from '../helpers/productGalleryHelpers.ts'

const ProductDescriptionDetailModal = lazyRetry(() => import('./ProductDescriptionDetailModal'), 'products-description-detail-modal')

// Truncation length for the description Row's inline preview -- long
// enough to still be useful at a glance, short enough that a real
// Features/Benefits/Ingredients/Caution block (which can run to
// several hundred characters) always gets cut off with "..." rather
// than dumping the whole blob inline (Aug 23 ask).
const DESCRIPTION_PREVIEW_LENGTH = 140

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
  special_price_usd?: unknown
  special_price_khr?: unknown
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
  const specialUsd = Number(p.special_price_usd || 0)
  const specialKhr = Number(p.special_price_khr || 0)
  const sellingKhr = Number(p.selling_price_khr || 0)
  const stockQuantity = Number(p.stock_quantity || 0)
  const outOfStockThreshold = Number(p.out_of_stock_threshold || 0)
  const lowStockThreshold = Number(p.low_stock_threshold || 10)
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
  // "Batch" row (replaces the old "Added" row below): the most recently
  // received batch's date + lot code, falling back to the product's own
  // created_at only if no batch has a received_at yet (should be rare --
  // every product gets a "day added" batch at creation, see
  // getVisibleProductBatches's comment above). Comparing received_at as
  // plain ISO-ish strings is safe here since D1 stores them sortable
  // (`YYYY-MM-DD[ T]HH:MM:SS`-shaped), same assumption the rest of this
  // file already makes when formatting created_at below.
  const latestBatch = visibleBatches.reduce<typeof visibleBatches[number] | null>((latest, batch) => {
    const batchStamp = String(batch.received_at || batch.created_at || '')
    if (!batchStamp) return latest
    const latestStamp = latest ? String(latest.received_at || latest.created_at || '') : ''
    return !latest || batchStamp > latestStamp ? batch : latest
  }, null)
  const batchDateRaw = String((latestBatch && (latestBatch.received_at || latestBatch.created_at)) || p.created_at || '')
  const batchDateParsed = batchDateRaw ? new Date(batchDateRaw.includes('T') ? batchDateRaw : `${batchDateRaw}Z`) : null
  const formattedBatchDate = batchDateParsed && !Number.isNaN(batchDateParsed.getTime())
    ? batchDateParsed.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : ''
  const latestBatchLotCode = String(latestBatch?.lot_code || '')
  const copyBarcode = () => {
    if (!p.barcode || typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(String(p.barcode)).catch(() => {})
  }

  // Label column tightened from w-28 (7rem) to w-20 (5rem) and the gap from
  // gap-3 to gap-2 -- per the Aug 19 2026 ask to tighten these value/label
  // pairs so each row takes less horizontal space, freeing room in the
  // sheet (see the action-button restack just below for the other half of
  // that same request).
  const Row = ({ label, children }: DetailRowProps) => (
    <div className="flex min-w-0 gap-2">
      <span className="w-20 flex-shrink-0 pt-0.5 text-xs text-gray-400">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200">{children}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-modal-88 w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-5xl sm:rounded-2xl dark:bg-gray-800 pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
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
              <div className="truncate font-bold text-gray-900 dark:text-white">{productName}</div>
              {/* Category/brand/barcode/SKU all live on this one line right
                  below the title now (brand moved up from its own row in
                  the details grid below -- same "avoid showing it twice"
                  reasoning Inventory's own ProductDetailModal already
                  applies to its header line). Category and brand each get
                  a bounded max-w so Tailwind's `truncate` (which needs a
                  constrained width to do anything inside a flex-wrap row)
                  actually clips a long value to "..." instead of wrapping
                  the whole line or overflowing -- title attr keeps the
                  full value available on hover/long-press. */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {/* Barcode leads this line ("in view details barcode show
                    first"). It is the identifier someone opens a product to
                    check or copy; category and brand are groupings they
                    already knew from the list they came from. The middot
                    separator moves onto the FOLLOWING items so the line
                    never opens with a stray dot when a product has no
                    barcode or SKU. */}
                {p.barcode ? (
                  <button type="button" className="max-w-[140px] truncate font-mono underline-offset-2 hover:text-blue-600 hover:underline" onClick={copyBarcode} title={T('copy_barcode', 'Copy barcode')}>
                    {p.barcode}
                  </button>
                ) : null}
                {p.sku ? <span className="max-w-[100px] truncate font-mono" title={p.sku}>{p.sku}</span> : null}
                {p.category ? <span className="max-w-[110px] truncate" title={p.category}>{p.barcode || p.sku ? '· ' : ''}{p.category}</span> : null}
                {p.brand ? <span className="max-w-[110px] truncate" title={p.brand}>&middot; {p.brand}</span> : null}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={T('close', 'Close')} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Details/Actions split applied at every width now, not just
            `lg:` -- per the Aug 22 ask: "the mobile click to view detail is
            split half vertical, one side details the other buttons", same
            grid-cols-2 pattern this already used above `lg`, just without
            the `lg:` gate. Replaces the separate icon-grid action bar that
            used to run along the bottom on narrower screens (see the
            deleted block below this div) -- actions live in the same
            right-hand column at every size now, so there's no longer a
            second, differently-shaped action surface to keep in sync. */}
        {/* The actions column is sized to its content rather than taking
            half the width. grid-cols-2 gave two or three buttons the same
            room as every product detail combined, which is what made them
            read as over-wide with too much space around them. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-h-0 space-y-2.5 overflow-auto p-4">
          {/* Short label:value rows (Barcode/Supplier/Stock/Expiry) laid
              out 2-per-row instead of one full-width row each -- per the
              explicit "make it as column" ask: a product with every one of
              these fields set used to run 7 full-width rows deep before
              even reaching Description/pricing, "crushing" everything
              below it further down the sheet. gap-x-3/gap-y-1.5 keeps the
              two columns from touching; min-w-0 on Row itself (above) lets
              a long value truncate/wrap inside its own column instead of
              forcing the grid wider.
              RESPONSIVENESS FIX (Aug 22 2026): this used to be a plain
              (non-responsive) 2-column grid on the reasoning that these
              are short chip/badge-style values that "fit comfortably at
              the narrowest phone width" -- true only when this pane was
              still a full-width bottom sheet below `sm`. It no longer is:
              this pane is now the LEFT HALF of a grid-cols-2 details/
              actions split active at every width (see that split's own
              comment above), so a plain 2-col grid in here means four
              columns' worth of squeeze at phone width (~375px sheet ->
              ~180px half, minus padding, split again -> under 90px per
              sub-column -- not enough room for an 80px label plus any
              value, which is exactly the cramped title/label positioning
              this was reported to have). Single column below `sm`, two
              columns from `sm` up once there's actually a wide-enough
              dialog to fit them. Description right below stays full-width
              on every size since free text doesn't share that same
              "always short" property. Category and Brand no longer have
              rows here -- both moved up to the header line next to the
              title (see above). Unit deliberately has no row of its own
              here -- it's already shown right next to the Stock quantity
              below, and a second, separate "Unit" row just repeated the
              same value a second time for no reason. */}
          <div className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-3">
            {p.supplier ? <Row label={T('label_supplier', 'Supplier')}>{p.supplier}</Row> : null}
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
          {/* Description kept full-width, outside the 2-column grid above
              -- free-text can run much longer than a category/unit chip
              and would force the grid's row height (or wrap awkwardly
              against a short neighbor) if it shared a row with one.
              Aug 23 rework: truncates with "..." instead of dumping the
              raw blob inline, and is clickable -- opens
              ProductDescriptionDetailModal.tsx, the admin-side
              counterpart to the public-portal Details flyout, showing
              the same parsed Features/Benefits/Ingredients/Caution
              breakdown a shopper sees rather than plain text. */}
          {p.description ? (
            <div className="flex min-w-0 gap-2">
              <span className="w-20 flex-shrink-0 pt-0.5 text-xs text-gray-400">{T('label_description', 'Description')}</span>
              <button
                type="button"
                onClick={() => setDescriptionDetailOpen(true)}
                className="min-w-0 flex-1 truncate rounded text-left text-sm text-gray-800 underline-offset-2 hover:text-blue-700 hover:underline dark:text-gray-200 dark:hover:text-blue-300"
                title={T('view_full_description', 'View full description')}
              >
                {p.description.length > DESCRIPTION_PREVIEW_LENGTH
                  ? `${p.description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}...`
                  : p.description}
              </button>
            </div>
          ) : null}

          {/* Margin used to have its own grid column next to Cost, putting
              it in a third place instead of alongside the two prices it's
              derived from -- per the Aug 22 2026 ask, folded into the
              Selling Price row -- and has since been moved back out to its
              own row again, see the comment below Selling Price. Cost
              kept as its own full-width row, same treatment as Selling
              Price below it, instead of the old 2-column grid pairing
              (which only had one real member left once Margin moved). */}
          <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
            <Row label={T('label_cost', 'Cost')}>
              <span className="text-red-600">{fmtUSD(purchaseUsd)}</span>
              {purchaseKhr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(purchaseKhr)}</span> : null}
            </Row>
          </div>
          {/* Selling Price pulled out of the 2-column grid into its own
              full-width row -- it used to share a row with Cost, making it
              just another column instead of the one price a shopper/staffer
              actually cares about scanning for first. Full-width also gives
              it room to sit directly above Special Price/Discounts (which
              are its variants), instead of those wrapping onto a
              differently-paired row below depending on which of them are
              present. Margin (cost vs. this price) now rides along inline
              here rather than its own row. */}
          <Row label={T('label_selling_price', 'Selling Price')}>
            <span className="text-base font-semibold text-green-600">{fmtUSD(sellingUsd)}</span>
            {sellingKhr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(sellingKhr)}</span> : null}
          </Row>
          {/* Margin is its own row again (Aug 25 2026: "margin should be
              another row instead of continuing from selling price"), which
              REVERSES the Aug 22 change that folded it inline. Inline, it
              ran on from the price as a parenthetical and the two figures
              read as one wrapping sentence -- particularly once a KHR price
              sat between them. As a labelled row it lines up with Cost and
              Selling Price above it, so all three read down the same
              column. */}
          {purchaseUsd > 0 && sellingUsd > 0 ? (
            <Row label={T('label_margin', 'Margin')}>
              <span className={`font-medium ${marginUsd >= 0 ? 'text-blue-600' : 'text-yellow-600'}`}>
                {fmtUSD(marginUsd)}
              </span>
              <span className="ml-2 text-xs text-gray-400">{marginPct.toFixed(1)}%</span>
            </Row>
          ) : null}
          {(specialUsd > 0 || specialKhr > 0) ? (
            <Row label={T('special_price', 'VIP Price')}>
              <span className="text-blue-600">{fmtUSD(specialUsd || sellingUsd)}</span>
              {(specialKhr > 0 || sellingKhr > 0) ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(specialKhr || sellingKhr)}</span> : null}
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

          {batchCount ? (
            <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
              {/* Click-to-view row, same pattern as Inventory's own
                  ProductDetailModal "View stock history" row -- a summary
                  count plus a chevron that opens the full live-fetched,
                  per-branch batch editor (ManageBatchesModal), rather than
                  rendering every batch inline in this already-dense pane. */}
              <button
                type="button"
                onClick={onManageBatches}
                disabled={!onManageBatches}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-left text-xs text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-default disabled:opacity-100 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/30"
              >
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  {T('batches', 'Batches')} <span className="text-amber-500/80 dark:text-amber-300/70">({batchCount})</span>
                </span>
                {onManageBatches ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" /> : null}
              </button>
            </div>
          ) : null}

          <Row label={T('status', 'Status')}>
            {stockQuantity <= outOfStockThreshold ? (
              <span className="badge-red">{T('out_of_stock', 'Out of stock')}</span>
            ) : stockQuantity <= lowStockThreshold ? (
              <span className="badge-yellow">{T('low_stock', 'Low stock')}</span>
            ) : (
              <span className="badge-green">{T('in_stock', 'In stock')}</span>
            )}
          </Row>

          {/* "Added" (the product record's created_at) replaced with
              "Batch" -- the most recently received batch's date, which is
              what actually changes as stock gets restocked over time; when
              a product was first created is far less useful to see at a
              glance than when its stock last came in. Falls back to
              created_at only if no batch has a received_at set yet (should
              be rare -- every product gets a "day added" batch at creation,
              see getVisibleProductBatches's comment above). */}
          {formattedBatchDate ? (
            <button
              type="button"
              onClick={onManageBatches}
              disabled={!onManageBatches}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-0 py-0.5 text-left transition-colors hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-700/40"
            >
              <span className="flex min-w-0 gap-2">
                <span className="w-20 flex-shrink-0 pt-0.5 text-xs text-gray-400">{T('label_batch', 'Batch')}</span>
                <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200">
                  {formattedBatchDate}
                  {latestBatchLotCode ? <span className="ml-2 text-xs text-gray-400" title={latestBatchLotCode}>{latestBatchLotCode}</span> : null}
                </span>
              </span>
              {onManageBatches ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" /> : null}
            </button>
          ) : null}
        </div>

        {/* Single actions pane, visible at every width. Aug 23 rework:
            three standalone buttons -- Add variant / Adjust stock / Edit.
            Delete is gone from this pane entirely, it now lives inside the
            Edit flow itself (ProductForm's own footer -- see Products.tsx),
            not as a fourth button here. Adjust stock is back as its own
            button (was dropped Aug 22, restored per Aug 23 ask) with a
            literal "adjust" icon (SlidersHorizontal) instead of a generic
            pencil/gear so it doesn't read as a second Edit. Icon+label at
            `sm:` and up, icon-only (label visually hidden, kept for
            screen readers via aria-label + a title tooltip) below `sm` so
            three buttons keep fitting the narrow half of a phone-width
            split without truncating into illegibility. */}
        <aside className="flex min-h-0 w-28 flex-col justify-center border-l border-gray-200 bg-slate-50/70 p-2.5 dark:border-gray-700 dark:bg-slate-900/30 sm:w-40 sm:p-4">
          <div className="mb-2 hidden sm:block">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{T('actions', 'Actions')}</p>
          </div>
          <div className="space-y-1.5">
            {onAddVariant ? (
              <button
                type="button"
                className="btn-secondary flex w-full items-center justify-center gap-1.5 truncate px-3 py-1.5 text-xs sm:text-sm"
                onClick={onAddVariant}
                aria-label={T('add_variant', 'Add variant')}
                title={T('add_variant', 'Add variant')}
              >
                <PlusCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden truncate sm:inline">{T('add_variant', 'Add variant')}</span>
              </button>
            ) : null}
            {onAdjustStock ? (
              <button
                type="button"
                className="btn-secondary flex w-full items-center justify-center gap-1.5 truncate px-3 py-1.5 text-xs sm:text-sm"
                onClick={onAdjustStock}
                aria-label={T('adjust_stock', 'Adjust stock')}
                title={T('adjust_stock', 'Adjust stock')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden truncate sm:inline">{T('adjust_stock', 'Adjust stock')}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary flex w-full items-center justify-center gap-1.5 truncate px-3 py-1.5 text-xs sm:text-sm"
              onClick={onEdit}
              aria-label={T('edit', 'Edit')}
              title={T('edit', 'Edit')}
            >
              <Pencil className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden truncate sm:inline">{T('edit', 'Edit')}</span>
            </button>
          </div>
        </aside>
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
}
