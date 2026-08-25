import { useEffect, useState } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ImageOff from 'lucide-react/dist/esm/icons/image-off.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { calculateProductDiscount } from '../../utils/pricing.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { getProductBatches } from '../../api/batchesTransport.ts'
import type { BatchSelection, ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { buildProductBranchSummaryLabel } from '../products/helpers/productDisplayHelpers.ts'
import { computeExpiryStatus } from './posCore.ts'
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
  branch_name?: string
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
  // Flat, non-batch expiry tracking -- a plain product-level field,
  // distinct from the per-lot expiry_date carried by the batch/lot system
  // (see the `batches` picker further down). Only meaningful when the
  // product isn't batch-tracked; a batch-tracked product's real expiry
  // lives on whichever lot gets picked, not here.
  expiry_date?: string | null
  expiry_alert_days?: string | number
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

// Grouped products (same name, different branch/price/barcode/etc.) can have
// many entries -- paginate each pill row instead of dumping them all in one
// long scroll, so branch/barcode differences stay easy to scan.
const VARIANT_CHOICES_PAGE_SIZE = 5
const BRANCH_CHOICES_PAGE_SIZE = 6
const BATCH_CHOICES_PAGE_SIZE = 6

// Human-readable label for one lot/batch pill -- lot code when the batch has
// one, otherwise the shared "Batch n: mm/dd/yyyy" default (batchLabel.ts),
// falling back further to a bare id so the pill is never blank.
function formatBatchLabel(batch: ProductBatch, posCopy: PosCopy): string {
  return batchDisplayLabel(batch, posCopy('Batch', 'Batch'))
}

interface BranchOption {
  id: string
  name: string
}

type PosCopy = (english: string, fallback?: string) => string

// Shared back/next + numbered-page row for the pill lists below. Hidden
// entirely once everything fits on one page.
function PillPager({ page, pageCount, onPageChange, posCopy }: {
  page: number
  pageCount: number
  onPageChange: (next: number) => void
  posCopy: PosCopy
}) {
  if (pageCount <= 1) return null
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
        disabled={page <= 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
      >
        <ChevronLeft className="h-3 w-3" />
        {posCopy('Back', 'Back')}
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: pageCount }, (_, index) => (
          <button
            key={index}
            type="button"
            aria-label={posCopy('Go to page {n}', 'Go to page {n}').replace('{n}', String(index + 1))}
            onClick={() => onPageChange(index)}
            className={`h-5 w-5 rounded-full text-[10px] font-semibold transition-colors ${
              index === page
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
      >
        {posCopy('Next', 'Next')}
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}

// `outOfStock` only changes the unselected look (faded/greyed pill so a
// cashier can tell at a glance which branch/barcode has nothing to sell
// without the option disappearing or becoming unclickable -- selecting it
// still works, and the actual add-to-cart buttons below are what block the
// sale). A selected pill always keeps the active/blue look regardless of
// stock, since the cashier explicitly chose it and the stock number + the
// disabled add-to-cart button already communicate the zero-stock state.
function pillClass(active: boolean, outOfStock: boolean = false): string {
  if (active) {
    return 'rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors border-blue-700 bg-blue-600 text-white shadow-sm'
  }
  if (outOfStock) {
    return 'rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors border-slate-200 bg-slate-50 text-slate-400 opacity-60 hover:opacity-90 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500'
  }
  return 'rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors border-slate-200 bg-white text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80'
}

interface ProductDetailSheetProps {
  product: ProductRecord
  exchangeRate: number
  t: Translate
  fmtUSD: CurrencyFormatter
  fmtKHR: CurrencyFormatter
  asNumber: (value: unknown) => number
  posCopy: PosCopy
  // The cashier's currently-filtered POS branch, if any -- used only to
  // preselect Step 1 below; the cashier can still pick a different branch.
  activeBranchId?: string | number | null
  // Every product id that carries active batch/expiry tracking (see
  // POS.tsx's trackedBatchProductIds) -- forces a lot-picker step before
  // the price buttons become clickable, and every add-to-cart call below
  // carries the picked lot's id/label/expiry/remaining-stock. Passed as
  // the full set (not a single resolved boolean) because a grouped
  // product's Branch/Barcode steps can resolve to a *different* row on
  // every pick, and each row can be tracked independently of the others.
  trackedBatchProductIds?: Set<number>
  getDisplayStock: (product: ProductRecord | undefined, cartItem?: { branch_id?: string | number | null } | null) => number
  getPrimaryProductImage: (product: ProductRecord) => string
  getVariantChoices: (product: ProductRecord) => ProductRecord[]
  hasVariantChoices: (product: ProductRecord) => boolean
  onAddToCart: (product: ProductRecord, priceMode?: PriceMode, batchSelection?: BatchSelection) => void
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
  activeBranchId = null,
  trackedBatchProductIds,
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
  const expiryInfo = computeExpiryStatus(product.expiry_date, product.expiry_alert_days)
  const choiceLabel = groupMeta?.groupKind === 'variant'
    ? posCopy('Variants', 'Variants')
    : posCopy('Options', 'Options')
  const primaryImage = getPrimaryProductImage(product)
  const displayName = product.__displayName || product.name || ''

  // Step-by-step picker state for grouped products: Branch, then Barcode,
  // then the resolved row's Price -- reset whenever a different product's
  // sheet opens so a stale branch/barcode pick doesn't leak into the next.
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [branchPage, setBranchPage] = useState(0)
  const [barcodePage, setBarcodePage] = useState(0)
  // Lot/batch picker state -- see the batch-picker section further down.
  // Reset alongside the other step state whenever a different product's
  // sheet opens, same as branch/barcode above.
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [batchPage, setBatchPage] = useState(0)
  useEffect(() => {
    setSelectedBranchId(null)
    setSelectedVariantId(null)
    setBranchPage(0)
    setBarcodePage(0)
    setSelectedBatchId(null)
    setBatchPage(0)
  }, [product?.id])

  // Step 1: which branches this group is actually carried at, gathered from
  // every row's branch_stock. Catalogs/groups with no per-branch stock data
  // at all simply produce no branch options, and the picker below falls
  // back to a flat Barcode step across every row (its original behavior).
  const branchOptionsMap = new Map<string, string>()
  // Summed stock per branch across every row in the group, used only to
  // grey out a branch pill when nothing in this product is carried there --
  // see pillClass's `outOfStock` param.
  const branchStockTotals = new Map<string, number>()
  // `variants` is EMPTY for a flat product -- getVariantChoices only returns
  // rows for a group (__groupChoices) or a parent with variant children. So
  // iterating it alone meant a flat product produced no branch options at
  // all, which left effectiveBranchId null, which left the lot picker with
  // nothing to query. That is the reported "batch pick not working": a
  // batch-tracked flat product showed "No lots available at this branch"
  // and "Pick a lot first" refused the add, while the API had two lots for
  // it. Falling back to the product's own row makes a flat product behave
  // like a one-row group, which is what it is.
  for (const variant of variants.length ? variants : [product]) {
    for (const entry of Array.isArray(variant.branch_stock) ? variant.branch_stock : []) {
      const id = entry?.branch_id
      if (id == null) continue
      const key = String(id)
      if (!branchOptionsMap.has(key)) branchOptionsMap.set(key, String(entry.branch_name || key))
      branchStockTotals.set(key, (branchStockTotals.get(key) || 0) + Number(entry?.quantity || 0))
    }
  }
  const branchOptions: BranchOption[] = [...branchOptionsMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const activeBranchKey = activeBranchId == null ? null : String(activeBranchId)
  const fallbackBranchId = branchOptions.some((b) => b.id === activeBranchKey)
    ? activeBranchKey
    : (branchOptions[0]?.id ?? null)
  const effectiveBranchId = selectedBranchId != null && branchOptions.some((b) => b.id === selectedBranchId)
    ? selectedBranchId
    : fallbackBranchId

  const branchPageCount = Math.max(1, Math.ceil(branchOptions.length / BRANCH_CHOICES_PAGE_SIZE))
  const clampedBranchPage = Math.min(branchPage, branchPageCount - 1)
  const pagedBranchOptions = branchOptions.slice(
    clampedBranchPage * BRANCH_CHOICES_PAGE_SIZE,
    clampedBranchPage * BRANCH_CHOICES_PAGE_SIZE + BRANCH_CHOICES_PAGE_SIZE,
  )

  // Step 2: narrow the group's rows down to whichever ones are actually
  // carried at the selected branch. A row with no branch_stock entries at
  // all is treated as branch-agnostic and stays offered under every branch.
  const candidateVariants = branchOptions.length === 0 || effectiveBranchId == null
    ? variants
    : variants.filter((variant) => {
      const branchStock = Array.isArray(variant.branch_stock) ? variant.branch_stock : []
      if (!branchStock.length) return true
      return branchStock.some((entry) => String(entry?.branch_id) === effectiveBranchId)
    })
  const candidatePool = candidateVariants.length ? candidateVariants : variants

  // Shared by the barcode pills below and by effectiveVariantStock further
  // down, so both use the exact same branch-aware stock number.
  const getVariantStockForBranch = (variant: ProductRecord | null, branchId: string | null): number => {
    if (!variant) return 0
    if (branchOptions.length && branchId != null) {
      return Number((Array.isArray(variant.branch_stock) ? variant.branch_stock : [])
        .find((entry) => String(entry?.branch_id) === branchId)?.quantity || 0)
    }
    return getDisplayStock(variant)
  }

  const barcodePageCount = Math.max(1, Math.ceil(candidatePool.length / VARIANT_CHOICES_PAGE_SIZE))
  const clampedBarcodePage = Math.min(barcodePage, barcodePageCount - 1)
  const pagedCandidates = candidatePool.slice(
    clampedBarcodePage * VARIANT_CHOICES_PAGE_SIZE,
    clampedBarcodePage * VARIANT_CHOICES_PAGE_SIZE + VARIANT_CHOICES_PAGE_SIZE,
  )

  // Step 3: the price for whichever row Steps 1 + 2 resolved to -- defaults
  // to the first candidate so a price shows immediately, but the cashier can
  // override branch and/or barcode at any point and this recomputes.
  const effectiveVariant = candidatePool.find((variant) => String(variant.id) === selectedVariantId) || candidatePool[0] || null
  const effectiveVariantStock = getVariantStockForBranch(effectiveVariant, effectiveBranchId)
  const effectiveVariantInStock = effectiveVariant ? effectiveVariantStock > asNumber(effectiveVariant.out_of_stock_threshold) : false
  const effectiveVariantPromotion = calculateProductDiscount(effectiveVariant || undefined, exchangeRate)
  const effectiveVariantExpiry = computeExpiryStatus(effectiveVariant?.expiry_date, effectiveVariant?.expiry_alert_days)

  // Lot/batch picker -- keyed on whichever product ROW is actually resolved
  // right now, not on the group as a whole: a flat product resolves to
  // itself, a grouped product resolves to whatever Steps 1+2 (Branch,
  // Barcode) currently point at (`effectiveVariant`), and that resolved
  // row is what batch/expiry tracking (POS.tsx's trackedBatchProductIds)
  // and GET /api/batches are actually scoped to. This mirrors the same
  // "does this option match what's already picked" rule Branch and
  // Barcode already follow -- picking a different barcode can point at a
  // differently-tracked (or untracked) row, so the batch step has to
  // re-resolve every time Branch/Barcode change, exactly like the price
  // buttons below already do.
  const resolvedProduct = groupProduct ? effectiveVariant : product
  // A flat product used to resolve to `activeBranchId ?? product.branch_id`.
  // Both are routinely null: `activeBranchId` is null whenever the cashier
  // has not picked a branch filter (the normal case), and `branch_id` is not
  // a column on products at all -- per-branch stock lives in `branch_stock`.
  // The effect below then short-circuits on `resolvedBranchId == null` and
  // force-feeds the picker an empty list, so a batch-tracked product showed
  // "No lots available at this branch" and "Pick a lot first" blocked the
  // add. A cashier could not sell ANY batch-tracked product without first
  // selecting a branch filter -- reproduced with two real lots present.
  //
  // `effectiveBranchId` is the same branch the sheet already resolved for
  // its own Branch step (built from this product's own branch_stock), so
  // using it here keeps the lot list and the branch shown on screen in
  // agreement instead of deriving the branch twice by different rules.
  const resolvedBranchId = effectiveBranchId
  const isBatchTracked = resolvedProduct != null && (trackedBatchProductIds?.has(Number(resolvedProduct.id)) ?? false)
  useEffect(() => {
    if (!isBatchTracked || resolvedProduct == null) { setBatches([]); return }
    if (resolvedBranchId == null) { setBatches([]); setBatchesLoading(false); return }
    let cancelled = false
    setBatchesLoading(true)
    getProductBatches(resolvedProduct.id, resolvedBranchId).then((res) => {
      if (cancelled) return
      setBatches(Array.isArray(res?.batches) ? res.batches : [])
    }).catch(() => { if (!cancelled) setBatches([]) }).finally(() => { if (!cancelled) setBatchesLoading(false) })
    return () => { cancelled = true }
  }, [isBatchTracked, resolvedProduct?.id, resolvedBranchId])
  // A Branch/Barcode change can resolve to a different (or differently-
  // tracked) row, so a lot picked under the previous row must not silently
  // carry over -- same "don't leak a stale pick into the next selection"
  // rule the product-level reset above already applies to Branch/Barcode
  // themselves.
  useEffect(() => {
    setSelectedBatchId(null)
    setBatchPage(0)
  }, [resolvedProduct?.id, resolvedBranchId])

  const batchPageCount = Math.max(1, Math.ceil(batches.length / BATCH_CHOICES_PAGE_SIZE))
  const clampedBatchPage = Math.min(batchPage, batchPageCount - 1)
  const pagedBatches = batches.slice(clampedBatchPage * BATCH_CHOICES_PAGE_SIZE, clampedBatchPage * BATCH_CHOICES_PAGE_SIZE + BATCH_CHOICES_PAGE_SIZE)
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) || null
  const batchStockTotal = batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
  // Requires an in-stock lot to be picked before the price buttons below
  // become clickable -- a batch-tracked sale can't proceed without knowing
  // which lot it's coming from. Now applies the same way whether the
  // resolved row came from the flat flow or from the group's Branch/
  // Barcode steps.
  const batchSelectionRequired = isBatchTracked
  const batchReadyToSell = !batchSelectionRequired || (selectedBatch != null && Number(selectedBatch.quantity || 0) > 0)

  const buildBatchSelection = (): BatchSelection | undefined => {
    if (!batchSelectionRequired || !selectedBatch) return undefined
    return {
      batchId: selectedBatch.id,
      batchLabel: formatBatchLabel(selectedBatch, posCopy),
      batchExpiryDate: selectedBatch.expiry_date ?? null,
      quantity: Number(selectedBatch.quantity || 0),
    }
  }

  const closeAfterAdd = (nextProduct: ProductRecord, priceMode: PriceMode) => {
    onAddToCart(nextProduct, priceMode, buildBatchSelection())
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-modal-80 flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
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
          <button type="button" onClick={onClose} aria-label={t('close') || 'Close'} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
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
          <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('label_stock') || 'Stock'}</span><span className={`font-bold ${stock <= 0 ? 'text-red-600' : stock <= (asNumber(product.low_stock_threshold) || 10) ? 'text-yellow-600' : 'text-green-600'}`}>{selectedBatch ? Number(selectedBatch.quantity || 0) : batchSelectionRequired ? batchStockTotal : stock} {product.unit}</span></div>
          {/* Branch-aware zero-stock display (this session): the Stock row
              above is the single branch-resolved number (see
              getDisplayStock's own comment for why it's scoped to one
              branch, not a sum), so a multi-branch product showing "0"
              there doesn't say whether it's out everywhere or just at the
              currently-viewed/best branch. Group products already get a
              full per-branch picker below; for a standalone product, name
              every tracked branch's own quantity here instead of leaving
              the cashier to guess. */}
          {!groupProduct && stock <= 0 && Array.isArray(product.branch_stock) && product.branch_stock.length > 1 ? (
            <div className="flex gap-3"><span className="w-24 flex-shrink-0" /><span className="text-xs text-gray-400">{buildProductBranchSummaryLabel(product)}</span></div>
          ) : null}
          {/* Flat (non-batch) expiry date -- only meaningful when this
              product isn't batch-tracked (a batch-tracked product's real
              expiry lives on the lot picked below, not here) and isn't a
              group (no single expiry applies to every variant). */}
          {!groupProduct && !batchSelectionRequired && product.expiry_date ? (
            <div className="flex gap-3">
              <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('product_expiry_date') || 'Expiry date'}</span>
              <span className={`font-bold ${expiryInfo?.status === 'expired' ? 'text-red-600' : expiryInfo?.status === 'expiring' ? 'text-yellow-600' : 'text-gray-800 dark:text-gray-200'}`}>
                {product.expiry_date}
                {expiryInfo?.status === 'expired' ? ` (${t('expired') || 'Expired'})` : null}
                {expiryInfo?.status === 'expiring' ? ` (${t('expiring_soon') || 'Expiring soon'})` : null}
              </span>
            </div>
          ) : null}
          {groupProduct ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{choiceLabel}</div>

              {branchOptions.length ? (
                <div className="mb-3">
                  <div className="mb-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">{posCopy('1. Branch', '1. Branch')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {pagedBranchOptions.map((branch) => {
                      const branchOut = (branchStockTotals.get(branch.id) || 0) <= 0
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          className={pillClass(branch.id === effectiveBranchId, branchOut)}
                          onClick={() => { setSelectedBranchId(branch.id); setSelectedVariantId(null); setBarcodePage(0) }}
                        >
                          {branch.name}
                          {branchOut ? <span className="ml-1 text-[10px] font-normal opacity-75">({posCopy('Out', 'Out')})</span> : null}
                        </button>
                      )
                    })}
                  </div>
                  <PillPager page={clampedBranchPage} pageCount={branchPageCount} onPageChange={setBranchPage} posCopy={posCopy} />
                </div>
              ) : null}

              <div className="mb-3">
                <div className="mb-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                  {branchOptions.length ? posCopy('2. Barcode', '2. Barcode') : posCopy('Barcode', 'Barcode')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pagedCandidates.map((variant) => {
                    const variantStock = getVariantStockForBranch(variant, effectiveBranchId)
                    const variantOut = variantStock <= asNumber(variant.out_of_stock_threshold)
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        className={pillClass(String(variant.id) === String(effectiveVariant?.id), variantOut)}
                        onClick={() => setSelectedVariantId(String(variant.id))}
                      >
                        {variant.__variantLabel ? <span className="mr-1 opacity-75">{variant.__variantLabel}</span> : null}
                        <span className="font-mono">{variant.barcode || variant.sku || posCopy('No barcode', 'No barcode')}</span>
                        {variantOut ? <span className="ml-1 text-[10px] font-normal opacity-75">({posCopy('Out', 'Out')})</span> : null}
                      </button>
                    )
                  })}
                </div>
                <PillPager page={clampedBarcodePage} pageCount={barcodePageCount} onPageChange={setBarcodePage} posCopy={posCopy} />
              </div>

              {effectiveVariant ? (
                <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div {...getKhmerTextProps(effectiveVariant.name, 'min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white')}>{effectiveVariant.name}</div>
                    <span className={`flex-shrink-0 text-xs font-bold ${effectiveVariantStock <= 0 ? 'text-red-600' : effectiveVariantStock <= (asNumber(effectiveVariant.low_stock_threshold) || 10) ? 'text-yellow-600' : 'text-green-600'}`}>
                      {effectiveVariantStock} {effectiveVariant.unit}
                    </span>
                  </div>
                  {effectiveVariant.expiry_date ? (
                    <div className={`mb-2 text-[11px] font-medium ${effectiveVariantExpiry?.status === 'expired' ? 'text-red-600' : effectiveVariantExpiry?.status === 'expiring' ? 'text-yellow-600' : 'text-gray-400'}`}>
                      {t('product_expiry_date') || 'Expiry date'}: {effectiveVariant.expiry_date}
                      {effectiveVariantExpiry?.status === 'expired' ? ` (${t('expired') || 'Expired'})` : null}
                      {effectiveVariantExpiry?.status === 'expiring' ? ` (${t('expiring_soon') || 'Expiring soon'})` : null}
                    </div>
                  ) : null}
                  {/* Step 3 (group flow): same lot/batch picker as the flat flow, now
                      keyed off resolvedProduct/resolvedBranchId so it re-fetches
                      whenever Branch or Barcode above resolve to a different (or
                      differently-tracked) row -- see isBatchTracked/resolvedProduct
                      above for why this couldn't just reuse the flat-only gate. */}
                  {batchSelectionRequired ? (
                    <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900/40">
                      <div className="mb-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">{posCopy('3. Batch', '3. Batch')}</div>
                      {batchesLoading ? (
                        <div className="text-xs text-gray-400">{posCopy('Loading lots…', 'Loading lots…')}</div>
                      ) : batches.length === 0 ? (
                        <div className="text-xs text-gray-400">{posCopy('No lots available at this branch', 'No lots available at this branch')}</div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {pagedBatches.map((batch) => {
                              const batchOut = Number(batch.quantity || 0) <= 0
                              return (
                                <button
                                  key={batch.id}
                                  type="button"
                                  className={pillClass(batch.id === selectedBatchId, batchOut)}
                                  onClick={() => setSelectedBatchId(batch.id)}
                                >
                                  <span className="font-mono">{formatBatchLabel(batch, posCopy)}</span>
                                  {batch.expiry_date ? <span className="ml-1 text-[10px] font-normal opacity-75">{posCopy('exp', 'exp')} {batch.expiry_date}</span> : null}
                                  <span className="ml-1 text-[10px] font-normal opacity-75">({batch.quantity} {effectiveVariant.unit})</span>
                                </button>
                              )
                            })}
                          </div>
                          <PillPager page={clampedBatchPage} pageCount={batchPageCount} onPageChange={setBatchPage} posCopy={posCopy} />
                        </>
                      )}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    <button className="btn-primary flex-1 text-xs" disabled={!effectiveVariantInStock || !batchReadyToSell} onClick={() => closeAfterAdd(effectiveVariant, 'selling')}>
                      {batchSelectionRequired && !selectedBatch ? posCopy('Pick a lot first', 'Pick a lot first') : fmtUSD(asNumber(effectiveVariant.selling_price_usd || 0))}
                    </button>
                    {asNumber(effectiveVariant.special_price_usd) > 0 || asNumber(effectiveVariant.special_price_khr) > 0 ? (
                      <button className="btn-secondary flex-1 text-xs" disabled={!effectiveVariantInStock || !batchReadyToSell} onClick={() => closeAfterAdd(effectiveVariant, 'special')}>
                        {posCopy('Special', 'Special')} {fmtUSD(asNumber(effectiveVariant.special_price_usd || effectiveVariant.selling_price_usd || 0))}
                      </button>
                    ) : null}
                    {effectiveVariantPromotion.active ? (
                      <button className="btn-secondary flex-1 text-xs border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-200" disabled={!effectiveVariantInStock || !batchReadyToSell} onClick={() => closeAfterAdd(effectiveVariant, 'promotion')}>
                        {effectiveVariant.discount_label || posCopy('Discounts', 'Discounts')} {fmtUSD(effectiveVariantPromotion.applied_price_usd)}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {!groupProduct ? (
          <div className="border-t border-gray-200 p-4 dark:border-gray-700 space-y-3">
            {batchSelectionRequired ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {posCopy('Pick a lot / batch', 'Pick a lot / batch')}
                </div>
                {batchesLoading ? (
                  <div className="text-xs text-gray-400">{posCopy('Loading lots…', 'Loading lots…')}</div>
                ) : batches.length === 0 ? (
                  <div className="text-xs text-gray-400">{posCopy('No lots available at this branch', 'No lots available at this branch')}</div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {pagedBatches.map((batch) => {
                        const batchOut = Number(batch.quantity || 0) <= 0
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            className={pillClass(batch.id === selectedBatchId, batchOut)}
                            onClick={() => setSelectedBatchId(batch.id)}
                          >
                            <span className="font-mono">{formatBatchLabel(batch, posCopy)}</span>
                            {batch.expiry_date ? <span className="ml-1 text-[10px] font-normal opacity-75">{posCopy('exp', 'exp')} {batch.expiry_date}</span> : null}
                            <span className="ml-1 text-[10px] font-normal opacity-75">({batch.quantity} {product.unit})</span>
                          </button>
                        )
                      })}
                    </div>
                    <PillPager page={clampedBatchPage} pageCount={batchPageCount} onPageChange={setBatchPage} posCopy={posCopy} />
                  </>
                )}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button className="btn-primary flex-1" disabled={stock <= asNumber(product.out_of_stock_threshold) || !batchReadyToSell} onClick={() => closeAfterAdd(product, 'selling')}>
                {stock <= asNumber(product.out_of_stock_threshold) ? t('out_of_stock') : batchSelectionRequired && !selectedBatch ? posCopy('Pick a lot first', 'Pick a lot first') : `${posCopy('Regular', 'Regular')} ${fmtUSD(asNumber(product.selling_price_usd || 0))}`}
              </button>
              {promotion.active ? (
                <button className="btn-secondary flex-1 border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-200" disabled={stock <= asNumber(product.out_of_stock_threshold) || !batchReadyToSell} onClick={() => closeAfterAdd(product, 'promotion')}>
                  {product.discount_label || posCopy('Discounts', 'Discounts')} {fmtUSD(promotion.applied_price_usd)}
                </button>
              ) : null}
              {asNumber(product.special_price_usd) > 0 || asNumber(product.special_price_khr) > 0 ? (
                <button className="btn-secondary flex-1" disabled={stock <= asNumber(product.out_of_stock_threshold) || !batchReadyToSell} onClick={() => closeAfterAdd(product, 'special')}>
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
