import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ImageOff from 'lucide-react/dist/esm/icons/image-off.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { promotionBadgeForProduct, evaluatePromotionPricing, type PromotionRule } from '../../utils/promotionRules.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { getProductBatches } from '../../api/batchesTransport.ts'
import { getDamagedLots, type DamagedLot } from '../../api/damagedLotsTransport.ts'
import type { BatchSelection, ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { useLowStockConfig } from '../../AppContext'
import { effectiveLowStockThreshold } from '../../utils/lowStockSettings.ts'
import { buildVariantOptionLabels, computeExpiryStatus, sortBatchesForPicker } from './posCore.ts'
import { deriveProductSheetState, type SheetIntent } from './productSheetState.ts'
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
  // Kept in step with POS.tsx's own ProductRecord (these are two parallel
  // declarations of the same wire shape): D1 sends INTEGER 0/1, not a bool.
  is_active?: boolean | number
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
  // special_price_khr/usd are gone: the 2026-09-04 ruling deleted the "VIP"
  // tier they backed, and migration 0111 moved the values into the wholesale
  // pair below -- now the sheet's only discounted tier.
  wholesale_price_khr?: string | number
  wholesale_price_usd?: string | number
  stock_quantity?: string | number
  supplier?: string
  unit?: string
}

type Translate = (key: string) => string | undefined
type CurrencyFormatter = (value: number) => string
// 'special' dropped from the named members by the 2026-09-04 ruling -- this
// sheet can no longer add a line at the deleted "VIP" tier. ('wholesale' has
// always ridden in on the `| string` arm, which is why it isn't listed either.)
type PriceMode = 'selling' | 'promotion' | string

// Grouped products (same name, different branch/price/barcode/etc.) can have
// many entries -- paginate each pill row instead of dumping them all in one
// long scroll, so branch/barcode differences stay easy to scan.
const VARIANT_CHOICES_PAGE_SIZE = 5
const BRANCH_CHOICES_PAGE_SIZE = 6
const BATCH_CHOICES_PAGE_SIZE = 6

// One lot as the picker holds it: the transport row plus the id of the
// product ROW it came from. Only set when several indistinguishable rows'
// lots are merged into a single list (see `mergeRowsIntoLotList` below);
// picking such a lot also resolves which row the sale is booked against.
type PickerBatch = ProductBatch & { __productId?: number }

// Human-readable label for one lot/batch pill -- lot code when the batch has
// one, otherwise the shared "Batch n: dd/mm/yyyy" default (batchLabel.ts),
// falling back further to a bare id so the pill is never blank.
function formatBatchLabel(batch: ProductBatch, batchWord: string): string {
  return batchDisplayLabel(batch, batchWord)
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
        {posCopy('Back', 'ត្រឡប់')}
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: pageCount }, (_, index) => (
          <button
            key={index}
            type="button"
            aria-label={posCopy('Go to page {n}', 'ទៅទំព័រ {n}').replace('{n}', String(index + 1))}
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
        {posCopy('Next', 'បន្ទាប់')}
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
  // The branch the POS card's own stock badge resolved to (the branch filter
  // when one is set, else pickBestBranchId's choice) -- used only to preselect
  // Step 1 below; the cashier can still pick a different branch. It MUST be
  // the same branch the card number came from: the sheet's old fallback was
  // branchOptions[0] (alphabetical), which routinely disagreed with the card
  // and silently offered/booked a different branch's lots.
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
  // branchId is the branch the sheet's own Branch step resolved to. It has to
  // travel with the add: POS's addToCart otherwise re-derives a branch of its
  // own (highest-stock, or the branch filter), which is routinely a DIFFERENT
  // branch from the one whose stock and lots the cashier was just looking at.
  // That mismatch showed up as "the stock displayed doesn't match the option I
  // picked", and booked lots against the wrong branch -- caught only as a 409
  // server-side, after the sale was committed.
  onAddToCart: (product: ProductRecord, priceMode?: PriceMode, batchSelection?: BatchSelection, branchId?: string | number | null, damagedSelection?: { damagedLotId: number; quantity: number; label: string }) => void
  onClose: () => void
  onOpenImageLightbox: (product: ProductRecord, index: number) => void
  // G1: the active promotion rules -- the sheet's price buttons and the
  // Discounts row evaluate the SAME kernel POS charges with, including
  // "buy >= X" deals that only engage once the cart line's quantity
  // crosses the threshold.
  promotionRules?: readonly PromotionRule[]
  // What this sheet is opened FOR. 'sell' is POS / add-items-to-sale / a
  // return's replacement line: the warehouse branch is shown WITH its
  // quantity but cannot be picked, because only the shop rings a sale.
  // 'stock' is add/remove/set/transfer/fast-stock-in, where every branch the
  // operation permits stays selectable. See utils/branchRoles.ts.
  intent?: SheetIntent
  // Non-POS surfaces hand the resolved row + branch + received date back
  // instead of adding a cart line; the price buttons become one confirm
  // button. See components/shared/ProductOptionSheet.tsx.
  onPick?: (product: ProductRecord, selection: { branchId: string | null; batch?: BatchSelection }) => void
  pickLabel?: string
  // Drop the received-date step on a host whose write cannot carry one (the
  // sale-line REPLACEMENT: the Worker plans it with batchId null and draws by
  // FIFO). Showing a step whose answer is discarded is worse than not showing
  // it -- it reads as a batch-identity guarantee the write does not make. See
  // productSheetState.ts's receivedDateStepHidden.
  hideReceivedDates?: boolean
  // Render through a portal above the modal that opened it. Modal.tsx tops
  // out at z-[1070] for a nested modal and App's toasts own z-[1100], so a
  // sheet opened from inside a modal has to sit between the two -- the
  // sheet's own z-50 would otherwise render UNDERNEATH its opener.
  portal?: boolean
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
  promotionRules = [],
  intent = 'sell',
  onPick,
  pickLabel,
  hideReceivedDates = false,
  portal = false,
}: ProductDetailSheetProps) {
  // Settings > Stock Alerts -- the same number the POS grid behind this sheet
  // colours by, so the sheet and the card can never disagree about a product.
  const lowStockConfig = useLowStockConfig()
  const variants = getVariantChoices(product)
  const groupProduct = hasVariantChoices(product)
  const groupMeta = product.__groupMeta || null
  const promoBadge = promotionBadgeForProduct(product, promotionRules)
  const promoEvaluation = evaluatePromotionPricing(product, 1, promotionRules, exchangeRate)
  const promotion = {
    active: promoBadge.active,
    applied_price_usd: promoEvaluation.unit_price_usd,
    applied_price_khr: promoEvaluation.unit_price_khr,
  }
  const expiryInfo = computeExpiryStatus(product.expiry_date, product.expiry_alert_days)
  const choiceLabel = groupMeta?.groupKind === 'variant'
    ? posCopy('Variants', 'ជម្រើសផ្សេងៗ')
    : posCopy('Options', 'ជម្រើស')
  const primaryImage = getPrimaryProductImage(product)
  const displayName = product.__displayName || product.name || ''

  // Step-by-step picker state for grouped products: Branch, then Barcode,
  // then the resolved row's Price -- reset whenever a different product's
  // sheet opens so a stale branch/barcode pick doesn't leak into the next.
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  // The `vipRevealed` tap-to-reveal state is deleted along with the tier
  // (2026-09-04 ruling). Note the reveal gesture did NOT carry over to the
  // wholesale buttons: those have always shown their amount outright, so
  // nothing here needs to remember what has been revealed.
  const [branchPage, setBranchPage] = useState(0)
  const [barcodePage, setBarcodePage] = useState(0)
  // Lot/batch picker state -- see the batch-picker section further down.
  // Reset alongside the other step state whenever a different product's
  // sheet opens, same as branch/barcode above.
  const [batches, setBatches] = useState<PickerBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  // Non-empty when the lot lookup FAILED, as opposed to succeeding with no
  // lots. The two must not render the same way -- see the fetch below.
  const [batchesError, setBatchesError] = useState('')
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [batchChoicesOpen, setBatchChoicesOpen] = useState(false)
  // 11.9: open damaged lots for the resolved row/branch -- the Damage
  // source option shown beside the sellable lots. A failed fetch shows no
  // option (absence is safe; damaged stock is an offer, not a gate).
  const [damagedLots, setDamagedLots] = useState<DamagedLot[]>([])
  const [selectedDamagedLotId, setSelectedDamagedLotId] = useState<number | null>(null)
  const [batchPage, setBatchPage] = useState(0)
  // Why a branch pill refused the tap, shown under the pills. A tooltip
  // alone is unreachable on the touch screens this runs on.
  const [branchNotice, setBranchNotice] = useState('')
  useEffect(() => {
    setBranchNotice('')
    setSelectedBranchId(null)
    setSelectedVariantId(null)
    setBranchPage(0)
    setBarcodePage(0)
    setSelectedBatchId(null)
    setBatchChoicesOpen(false)
    setBatchPage(0)
  }, [product?.id])

  // Everything this sheet derives -- which branches it offers and how many
  // units each holds, which product ROW the steps resolve to, the ONE stock
  // number the Add buttons enforce, and the received-date list -- comes from
  // one pure function. It used to be ~120 lines of expressions inline right
  // here, which is exactly why a flat product could read "Stock 0" (and
  // refuse the sale) while its own branch_stock said 28 and every test in
  // the repo stayed green: they were all regexes over this file's text.
  const sheetState = deriveProductSheetState({
    product,
    variants,
    groupProduct,
    selectedBranchId,
    activeBranchId,
    selectedVariantId,
    trackedBatchProductIds,
    receivedDateStepHidden: hideReceivedDates,
    batches,
    selectedBatchId,
    damagedLots,
    selectedDamagedLotId,
    intent,
    getDisplayStock: (row) => getDisplayStock(row as ProductRecord),
    optionStepTitleFor: (pool) => buildVariantOptionLabels(pool as ProductRecord[], (value) => fmtUSD(value)).stepTitle,
  })
  const branchOptions = sheetState.branchOptions
  const effectiveBranchId = sheetState.effectiveBranchId
  const candidatePool = sheetState.candidatePool as ProductRecord[]
  const effectiveVariant = sheetState.effectiveVariant as ProductRecord | null
  const effectiveVariantStock = sheetState.effectiveVariantStock
  const warehouseBlockedMessage = t('pos_warehouse_not_sellable') || 'Only allow Shop sale. Please transfer to Shop first.'

  const branchPageCount = Math.max(1, Math.ceil(branchOptions.length / BRANCH_CHOICES_PAGE_SIZE))
  const clampedBranchPage = Math.min(branchPage, branchPageCount - 1)
  const pagedBranchOptions = branchOptions.slice(
    clampedBranchPage * BRANCH_CHOICES_PAGE_SIZE,
    clampedBranchPage * BRANCH_CHOICES_PAGE_SIZE + BRANCH_CHOICES_PAGE_SIZE,
  )

  // Per-row stock at one branch, for the option pills. Same rule the module
  // applies (branch_stock when the product carries any, else the
  // cross-branch number), so the pills and the Stock row cannot disagree.
  const getVariantStockForBranch = (variant: ProductRecord | null, branchId: string | null): number => {
    if (!variant) return 0
    if (branchOptions.length && branchId != null) {
      return Number((Array.isArray(variant.branch_stock) ? variant.branch_stock : [])
        .find((entry) => String(entry?.branch_id) === branchId)?.quantity || 0)
    }
    return getDisplayStock(variant)
  }

  // What actually tells these rows apart -- drives both the step heading and
  // each pill's text. See posCore.ts's buildVariantOptionLabels.
  const variantOptionLabels = buildVariantOptionLabels(candidatePool, (value) => fmtUSD(value))

  // THE DUPLICATE LIST. buildVariantOptionLabels reports stepTitle 'Option'
  // in exactly one situation: neither the barcode nor the selling price
  // differs across these rows, so it has nothing cashier-facing left to put
  // on a pill and falls back to the row's internal id ("#7321", "#7322").
  // Those id pills ask the SAME question the received-date list underneath
  // asks -- "which intake of this product?" -- so the two collapse into one:
  // every indistinguishable row's lots are fetched into a single list, and
  // picking one also resolves the row that owns it (see the pill onClick).
  const mergeRowsIntoLotList = sheetState.mergeRowsIntoLotList

  // Step numbers are counted, not hardcoded. The option step disappears in
  // merged mode, and a lot step still labelled "3." under a lone "1. Branch"
  // reads as a step the cashier somehow skipped.
  const branchStepShown = branchOptions.length > 0
  const optionStepShown = !mergeRowsIntoLotList
  const optionStepNumber = branchStepShown ? 2 : 1
  const lotStepNumber = (branchStepShown ? 1 : 0) + (optionStepShown ? 1 : 0) + 1

  const barcodePageCount = Math.max(1, Math.ceil(candidatePool.length / VARIANT_CHOICES_PAGE_SIZE))
  const clampedBarcodePage = Math.min(barcodePage, barcodePageCount - 1)
  const pagedCandidates = candidatePool.slice(
    clampedBarcodePage * VARIANT_CHOICES_PAGE_SIZE,
    clampedBarcodePage * VARIANT_CHOICES_PAGE_SIZE + VARIANT_CHOICES_PAGE_SIZE,
  )
  const effectiveVariantInStock = effectiveVariant ? effectiveVariantStock > asNumber(effectiveVariant.out_of_stock_threshold) : false
  const effectiveVariantPromoBadge = promotionBadgeForProduct(effectiveVariant || undefined, promotionRules)
  const effectiveVariantPromoEvaluation = evaluatePromotionPricing(effectiveVariant || undefined, 1, promotionRules, exchangeRate)
  const effectiveVariantPromotion = {
    active: effectiveVariantPromoBadge.active,
    applied_price_usd: effectiveVariantPromoEvaluation.unit_price_usd,
    applied_price_khr: effectiveVariantPromoEvaluation.unit_price_khr,
  }
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
  const isBatchTracked = sheetState.isBatchTracked
  // Which product row(s) the lot list is drawn from. Normally just the
  // resolved row; in merged mode (above) every indistinguishable row, so the
  // one remaining list still reaches every lot the removed id pills used to
  // reach. The joined key is what the fetch and the "forget the previous
  // pick" reset below depend on, NOT resolvedProduct.id -- in merged mode
  // choosing a lot CHANGES the resolved row, and keying on that would wipe
  // the very selection that changed it.
  const lotSourceProductIds = (mergeRowsIntoLotList ? candidatePool : (resolvedProduct ? [resolvedProduct] : []))
    .map((variant) => Number(variant.id))
    .filter((id) => Number.isFinite(id) && id > 0)
  const lotSourceKey = lotSourceProductIds.join(',')
  useEffect(() => {
    if (!isBatchTracked || lotSourceProductIds.length === 0) { setBatches([]); return }
    if (resolvedBranchId == null) { setBatches([]); setBatchesLoading(false); return }
    let cancelled = false
    setBatchesLoading(true)
    setBatchesError('')
    // Promise.all, not allSettled, on purpose: a partially-loaded lot list is
    // indistinguishable on screen from a complete one, and a cashier picking
    // "the oldest lot" out of a list that quietly lost half its rows sells
    // the wrong stock. One failed row fails the whole list, which the error
    // branch below renders as an error and which keeps the sale blocked.
    Promise.all(lotSourceProductIds.map((productId) => getProductBatches(productId, resolvedBranchId)
      .then((res) => (Array.isArray(res?.batches) ? res.batches : [])
        .map((batch) => ({ ...batch, __productId: productId } as PickerBatch))))).then((lists) => {
      if (cancelled) return
      setBatches(lists.flat())
      setBatchesError('')
    }).catch((error: unknown) => {
      // A failed lot fetch is NOT "this product has no lots here". The old
      // `catch(() => setBatches([]))` rendered the two identically, so a
      // 403/500/timeout showed the definitive-sounding "No lots available
      // at this branch" and the cashier had no way to tell the difference.
      // Record the error so the picker can say so and keep the sale
      // blocked -- selling batch-tracked stock without a lot is worse than
      // refusing the sale.
      if (cancelled) return
      setBatches([])
      setBatchesError(error instanceof Error && error.message ? error.message : 'Could not load lots')
    }).finally(() => { if (!cancelled) setBatchesLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBatchTracked, lotSourceKey, resolvedBranchId])
  // A Branch/Barcode change can resolve to a different (or differently-
  // tracked) row, so a lot picked under the previous row must not silently
  // carry over -- same "don't leak a stale pick into the next selection"
  // rule the product-level reset above already applies to Branch/Barcode
  // themselves.
  useEffect(() => {
    if (resolvedProduct == null || resolvedBranchId == null) { setDamagedLots([]); return }
    let cancelled = false
    getDamagedLots(resolvedProduct.id, resolvedBranchId).then((res) => {
      if (!cancelled) setDamagedLots(Array.isArray(res?.lots) ? res.lots : [])
    }).catch(() => { if (!cancelled) setDamagedLots([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedProduct?.id, resolvedBranchId])
  // Keyed on the lot list's OWN identity (which rows it is drawn from, at
  // which branch), not on the resolved row: in merged mode picking a lot is
  // what moves the resolved row, and resetting on that would clear the pick
  // the moment it was made. Outside merged mode `lotSourceKey` IS the
  // resolved row's id, so this behaves exactly as before.
  useEffect(() => {
    setSelectedBatchId(null)
    setSelectedDamagedLotId(null)
    setBatchPage(0)
    setBatchChoicesOpen(false)
  }, [lotSourceKey, resolvedBranchId])

  // The cashier's order: available lots first, each group earliest received
  // date to latest. See posCore.ts's sortBatchesForPicker -- the server's
  // list is expiry-first FIFO, which interleaves empty lots among sellable
  // ones. Ordered here at render (rather than when the fetch lands) so the
  // list can never be shown in the raw transport order.
  const batchWord = t('batch') || 'Received date'
  const orderedBatches = sortBatchesForPicker(batches)
  const batchPageCount = Math.max(1, Math.ceil(orderedBatches.length / BATCH_CHOICES_PAGE_SIZE))
  const clampedBatchPage = Math.min(batchPage, batchPageCount - 1)
  const pagedBatches = orderedBatches.slice(clampedBatchPage * BATCH_CHOICES_PAGE_SIZE, clampedBatchPage * BATCH_CHOICES_PAGE_SIZE + BATCH_CHOICES_PAGE_SIZE)
  const selectedBatch = orderedBatches.find((batch) => batch.id === selectedBatchId) || null
  // Picking a lot in merged mode also picks the product row that owns it --
  // that is how the removed id pills' one real job survives without the
  // pills. Prices/VIP/wholesale below all re-render from the resolved row,
  // so what the cashier sees is always the row the sale is booked against.
  const chooseBatch = (batch: PickerBatch) => {
    // Kept on one line: "picking a lot clears the damaged-lot pick and closes
    // the list" is a contract both tests/returnOptions.test.ts and
    // tests/productsResponsiveSurface.test.ts assert on the source text.
    setSelectedBatchId(batch.id); setSelectedDamagedLotId(null); setBatchChoicesOpen(false)
    if (mergeRowsIntoLotList && batch.__productId != null) setSelectedVariantId(String(batch.__productId))
  }
  // Requires an in-stock lot to be picked before the price buttons below
  // become clickable -- a batch-tracked sale can't proceed without knowing
  // which lot it's coming from. Now applies the same way whether the
  // resolved row came from the flat flow or from the group's Branch/
  // Barcode steps.
  const selectedDamagedLot = damagedLots.find((lot) => lot.id === selectedDamagedLotId) || null
  // A picked damaged lot IS the line's source -- it satisfies the received-
  // date gate the same way a sellable lot does (the units come from it).
  const batchSelectionRequired = sheetState.batchSelectionRequired
  const batchReadyToSell = sheetState.batchReadyToSell
  const pickAllowed = sheetState.pickAllowed
  const pickBlockedReason = sheetState.pickBlockedReason
  // The ONE stock number this sheet shows, from productSheetState.ts:
  // on-hand comes from branch_stock (the ledger that answers "how many are
  // at this branch"), and the lot ledger only narrows it once a specific
  // received date is picked. Reading the lot total as on-hand is what made
  // the sheet print "Stock: 0" beside a branch line saying 28.
  const displayedStock = sheetState.displayedStock


  const damagedLotLabel = (lot: DamagedLot): string =>
    `${posCopy('Damage', 'ខូចខាត')} · ${lot.return_id ? `${posCopy('return', 'ប្រគល់វិញ')} #${lot.return_id}` : `#${lot.id}`}`

  const buildDamagedSelection = () => selectedDamagedLot
    ? { damagedLotId: selectedDamagedLot.id, quantity: Number(selectedDamagedLot.quantity_remaining || 0), label: damagedLotLabel(selectedDamagedLot) }
    : undefined

  const buildBatchSelection = (): BatchSelection | undefined => {
    if (selectedDamagedLot) return undefined
    if (!batchSelectionRequired || !selectedBatch) return undefined
    return {
      batchId: selectedBatch.id,
      batchLabel: formatBatchLabel(selectedBatch, batchWord),
      batchExpiryDate: selectedBatch.expiry_date ?? null,
      quantity: Number(selectedBatch.quantity || 0),
    }
  }

  const closeAfterAdd = (nextProduct: ProductRecord, priceMode: PriceMode) => {
    onAddToCart(nextProduct, priceMode, buildBatchSelection(), effectiveBranchId, buildDamagedSelection())
    onClose()
  }

  // Non-POS surfaces confirm a choice instead of pricing a cart line. The
  // gate is the same one the price buttons use, so a picker can never hand
  // back a row/branch/received-date combination the POS would refuse.
  //
  // DISMISSED and PICKED are not the same event, and this must not collapse
  // them: `onClose` is what a host uses to throw the whole selection away.
  // Calling it after a successful `onPick` fired the host's discard path on
  // top of its accept path -- in CreateProductsSessionModal that was
  // resetExistingCandidate() nulling the product the pick had just set, so
  // the line form it gates never opened and the pick appeared to do nothing.
  // The host closes the sheet from inside its own onPick.
  const confirmPick = (nextProduct: ProductRecord) => {
    onPick?.(nextProduct, { branchId: effectiveBranchId, batch: buildBatchSelection() })
  }
  const pickButtonLabel = pickLabel || t('select') || 'Select'
  // The gate is DERIVED (productSheetState's pickAllowed), not re-decided
  // here. This button used to refuse anything out of stock on every host,
  // which quietly broke the hosts whose entire job is to raise a quantity:
  // fast stock-in, "Have already" in the create-products session and the
  // add/set modes of the stock adjuster all open on products sitting at 0,
  // and every one of them answered "Out of stock" with a dead button. The
  // in-stock half of the gate belongs to a SALE; the received-date half
  // belongs to whichever host asked the lot question.
  const renderPickButton = (row: ProductRecord) => (
    <button
      type="button"
      className="btn-primary flex-1 text-xs"
      disabled={!pickAllowed}
      onClick={() => confirmPick(row)}
    >
      {pickBlockedReason === 'out_of_stock'
        ? (t('out_of_stock') || 'Out of stock')
        : pickBlockedReason === 'received_date'
          ? (t('pick_received_date_first') || 'Pick a received date first')
          : pickButtonLabel}
    </button>
  )

  // One branch step for BOTH shapes. It used to live inside the grouped-only
  // block, so a standalone product -- the commonest card on the screen --
  // got no branch row at all, and the pills that did render printed a name
  // with no number beside the one total above them.
  const branchStep = branchStepShown ? (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="mb-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">{`1. ${t('branch') || 'Branch'}`}</div>
      <div className="flex flex-wrap gap-1.5">
        {pagedBranchOptions.map((branch) => {
          const branchOut = branch.quantity <= 0
          const blocked = !branch.selectable
          return (
            <button
              key={branch.id}
              type="button"
              aria-disabled={blocked}
              className={`${pillClass(branch.id === effectiveBranchId, branchOut || blocked)}${blocked ? ' cursor-not-allowed' : ''}`}
              onClick={() => {
                // Greyed, NOT hidden and NOT removed: the cashier has to be
                // able to see that the units are sitting in the warehouse,
                // and be told what to do about it. Admins included -- this
                // is a business rule, not a permission.
                if (blocked) { setBranchNotice(warehouseBlockedMessage); return }
                setBranchNotice('')
                setSelectedBranchId(branch.id)
                setSelectedVariantId(null)
                setBarcodePage(0)
              }}
            >
              {branch.name}
              <span className="ml-1 text-[10px] font-normal opacity-75">· {branch.quantity}</span>
            </button>
          )
        })}
      </div>
      {branchNotice ? <div className="mt-1.5 text-[11px] font-medium text-amber-600">{branchNotice}</div> : null}
      <PillPager page={clampedBranchPage} pageCount={branchPageCount} onPageChange={setBranchPage} posCopy={posCopy} />
    </div>
  ) : null

  // A portalled sheet sits ABOVE a host modal, so Escape has to close the
  // SHEET and go no further. Without this the one key press falls through to
  // the modal underneath and closes it too, taking the half-filled stock
  // line with it. Captured on the way down, for the same reason every other
  // stacked surface in this app captures it.
  useEffect(() => {
    if (!portal || typeof document === 'undefined') return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [portal, onClose])

  const sheet = (
    <div className={`fixed inset-0 bg-black/50 ${portal ? 'z-[1080]' : 'z-50'} flex items-end sm:items-center justify-center p-0 sm:p-4`} onClick={onClose}>
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
              <div className="break-words font-bold text-gray-900 dark:text-white">{displayName}</div>
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
            [t('label_barcode') || 'Barcode', product.barcode],
            [t('label_description') || 'Description', product.description],
          ] as Array<[string, string | number | undefined]>).map(([label, val]) => val ? (
            <div key={label} className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</span><span className="text-sm text-gray-800 dark:text-gray-200">{String(val)}</span></div>
          ) : null)}
          {/* Selling and wholesale share ONE row (owner ask, 2026-09-06):
              two stacked rows for two numbers pushed the per-branch counts
              and the option pills below the fold on a phone. The VIP tier
              that used to sit beside them is deleted (2026-09-04 ruling);
              wholesale is the one remaining discounted tier and was never a
              tap-to-reveal price. */}
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('selling_price') || 'Selling'}</span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span><span className="font-bold text-blue-600">{fmtUSD(asNumber(product.selling_price_usd))}</span>{asNumber(product.selling_price_khr) > 0 ? <span className="text-xs text-gray-400 ml-1">{fmtKHR(asNumber(product.selling_price_khr))}</span> : null}</span>
              {asNumber(product.wholesale_price_usd) > 0 || asNumber(product.wholesale_price_khr) > 0 ? (
                <span><span className="text-xs text-gray-400 mr-1">{t('wholesale_price') || 'Wholesale'}</span><span className="font-bold text-indigo-600">{fmtUSD(asNumber(product.wholesale_price_usd || 0))}</span>{asNumber(product.wholesale_price_khr || 0) > 0 ? <span className="text-xs text-gray-400 ml-1">{fmtKHR(asNumber(product.wholesale_price_khr || 0))}</span> : null}</span>
              ) : null}
            </div>
          </div>
          {promotion.active ? (
            <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{posCopy('Discounts', 'ការបញ្ចុះតម្លៃ')}</span><div><span className="font-bold text-rose-600">{fmtUSD(promotion.applied_price_usd || 0)}</span>{(promotion.applied_price_khr || 0) > 0 ? <span className="text-xs text-gray-400 ml-2">{fmtKHR(promotion.applied_price_khr || 0)}</span> : null}</div></div>
          ) : null}
          {/* One stock number, for the row and branch that Steps 1-2 actually
              resolved to -- the same figure the option pills show and the same
              one the Add buttons enforce. This used to read getDisplayStock(product),
              a product-level number that could be scoped to a DIFFERENT branch than
              the one on screen, which is what "display shows different data than the
              actual stock in the options" was describing. */}
          <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('label_stock') || 'Stock'}</span><span className={`font-bold ${displayedStock <= 0 ? 'text-red-600' : displayedStock <= effectiveLowStockThreshold(lowStockConfig, product.low_stock_threshold) ? 'text-yellow-600' : 'text-green-600'}`}>{displayedStock} {product.unit}</span></div>
          {/* "Warehouse: n · Shop: n", ALWAYS -- grouped or standalone, in
              stock or out. The Stock row above is one branch-resolved
              number, so on its own it never said whether the rest of the
              units were at the other branch or nowhere. This used to render
              only for a standalone product that was already at zero, i.e.
              it disappeared exactly when the cashier could act on it. */}
          {branchOptions.length ? (
            <div className="flex gap-3"><span className="w-24 flex-shrink-0" /><span className="text-xs text-gray-400">{sheetState.branchSummary}</span></div>
          ) : null}
          {/* The two ledgers disagreeing, said out loud. branch_stock holds
              units at this branch but the received-date ledger has nothing
              to draw them from, so the sale cannot proceed -- which is very
              different from "there are none here", and used to render as a
              flat "Stock: 0" beside a branch line showing the units. */}
          {sheetState.stockWithoutReceivedDate ? (
            <div className="flex gap-3"><span className="w-24 flex-shrink-0" /><span className="text-xs font-medium text-amber-600">{t('stock_without_received_date') || 'Units are at this branch but carry no received date.'}</span></div>
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
          {branchStep}
          {groupProduct ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{choiceLabel}</div>

              {/* The option step is labelled by whatever actually DIFFERS between
                  these rows, not hardcoded to "Barcode". Under the identity rule
                  (details = barcode + cost) two rows in one name group can share a
                  barcode and differ only in cost -- which used to render as two
                  identical pills with nothing to choose between them, and picking
                  the wrong one books the sale against the wrong cost. See
                  posCore.ts's buildVariantOptionLabels.

                  Hidden entirely in merged mode, where it degenerates into a
                  list of internal row ids ("#7321", "#7322") duplicating the
                  lot list below -- see mergeRowsIntoLotList. */}
              {optionStepShown ? (
              <div className="mb-3">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                    {branchStepShown
                      ? `${optionStepNumber}. ${posCopy(variantOptionLabels.stepTitle, variantOptionLabels.stepTitle)}`
                      : posCopy(variantOptionLabels.stepTitle, variantOptionLabels.stepTitle)}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {candidatePool.length} {posCopy('options', 'ជម្រើស')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pagedCandidates.map((variant) => {
                    const variantStock = getVariantStockForBranch(variant, effectiveBranchId)
                    const variantOut = variantStock <= asNumber(variant.out_of_stock_threshold)
                    const optionLabel = variantOptionLabels.byId.get(String(variant.id))
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        className={pillClass(String(variant.id) === String(effectiveVariant?.id), variantOut)}
                        onClick={() => setSelectedVariantId(String(variant.id))}
                      >
                        {variant.__variantLabel ? <span className="mr-1 opacity-75">{variant.__variantLabel}</span> : null}
                        <span className="font-mono">{optionLabel?.label || posCopy('No barcode', 'គ្មានបាកូដ')}</span>
                        {optionLabel?.hint ? <span className="ml-1 text-[10px] font-normal opacity-75">{optionLabel.hint}</span> : null}
                        <span className="ml-1 text-[10px] font-normal opacity-75">
                          {variantOut ? `(${posCopy('Out', 'អស់')})` : `· ${variantStock}`}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <PillPager page={clampedBarcodePage} pageCount={barcodePageCount} onPageChange={setBarcodePage} posCopy={posCopy} />
              </div>
              ) : null}

              {effectiveVariant ? (
                <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div {...getKhmerTextProps(effectiveVariant.name, 'min-w-0 flex-1 break-words text-sm font-semibold text-gray-900 dark:text-white')}>{effectiveVariant.name}</div>
                    <span className={`flex-shrink-0 text-xs font-bold ${effectiveVariantStock <= 0 ? 'text-red-600' : effectiveVariantStock <= effectiveLowStockThreshold(lowStockConfig, effectiveVariant.low_stock_threshold) ? 'text-yellow-600' : 'text-green-600'}`}>
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
                      <div className="mb-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">{`${lotStepNumber}. ${t('batches') || 'Received dates'}`}</div>
                      {batchesLoading ? (
                        <div className="text-xs text-gray-400">{t('loading') || 'Loading…'}</div>
                      ) : batchesError ? (
                        <div className="text-xs font-medium text-red-500">{batchesError}</div>
                      ) : orderedBatches.length === 0 ? (
                        <div className="text-xs text-gray-400">{t('received_dates_none') || 'No received dates at this branch'}</div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            onClick={() => setBatchChoicesOpen((open) => !open)}
                            aria-expanded={batchChoicesOpen}
                          >
                            <span className="min-w-0 truncate">
                              {selectedBatch
                                ? `${formatBatchLabel(selectedBatch, batchWord)} · ${Number(selectedBatch.quantity || 0)}`
                                : t('choose_received_date') || 'Choose a received date'}
                            </span>
                            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${batchChoicesOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {batchChoicesOpen ? <><div className="mt-1.5 flex flex-wrap gap-1.5">
                            {pagedBatches.map((batch) => {
                              const batchOut = Number(batch.quantity || 0) <= 0
                              return (
                                <button
                                  key={batch.id}
                                  type="button"
                                  className={pillClass(batch.id === selectedBatchId, batchOut)}
                                  onClick={() => chooseBatch(batch)}
                                >
                                  <span className="font-mono">{formatBatchLabel(batch, batchWord)}</span>
                                  {batch.expiry_date ? <span className="ml-1 text-[10px] font-normal opacity-75">{posCopy('exp', 'ផុត')} {batch.expiry_date}</span> : null}
                                  <span className="ml-1 text-[10px] font-normal opacity-75">({batch.quantity} {effectiveVariant.unit})</span>
                                </button>
                              )
                            })}
                          </div>
                          <PillPager page={clampedBatchPage} pageCount={batchPageCount} onPageChange={setBatchPage} posCopy={posCopy} />
                          </> : null}
                        </>
                      )}
                    </div>
                  ) : null}
                  {damagedLots.length > 0 ? (
                    <div className="mb-2 rounded-lg border border-orange-200 bg-orange-50/60 p-2 dark:border-orange-900/50 dark:bg-orange-950/20">
                      <div className="mb-1.5 text-[11px] font-semibold text-orange-500 dark:text-orange-400">🟠 {posCopy('Damage (from returns)', 'ខូចខាត (ពីការប្រគល់មកវិញ)')}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {damagedLots.map((lot) => (
                          <button key={lot.id} type="button"
                            className={pillClass(lot.id === selectedDamagedLotId, Number(lot.quantity_remaining || 0) <= 0)}
                            onClick={() => { setSelectedDamagedLotId(lot.id === selectedDamagedLotId ? null : lot.id); setSelectedBatchId(null) }}>
                            <span className="font-mono">{damagedLotLabel(lot)}</span>
                            <span className="ml-1 text-[10px] font-normal opacity-75">({lot.quantity_remaining})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {onPick ? renderPickButton(effectiveVariant) : null}
                    {onPick ? null : <button className="btn-primary flex-1 text-xs" disabled={!effectiveVariantInStock || !batchReadyToSell} onClick={() => closeAfterAdd(effectiveVariant, 'selling')}>
                      {batchSelectionRequired && !selectedBatch ? t('pick_received_date_first') || 'Pick a received date first' : `${t('selling_price') || 'Selling'} ${fmtUSD(asNumber(effectiveVariant.selling_price_usd || 0))}`}
                    </button>}
                    {/* The variant's VIP add-to-cart button is deleted by the
                        2026-09-04 ruling; the Wholesale button beside it now
                        carries the same numbers (migration 0111 moved them). */}
                    {!onPick && (asNumber(effectiveVariant.wholesale_price_usd) > 0 || asNumber(effectiveVariant.wholesale_price_khr) > 0) ? (
                      <button
                        className="btn-secondary flex-1 text-xs border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-200"
                        disabled={!effectiveVariantInStock || !batchReadyToSell}
                        onClick={() => closeAfterAdd(effectiveVariant, 'wholesale')}
                      >
                        {`${t('wholesale_price') || 'Wholesale'} ${fmtUSD(asNumber(effectiveVariant.wholesale_price_usd || 0))}`}
                      </button>
                    ) : null}
                    {!onPick && effectiveVariantPromotion.active ? (
                      <button className="btn-secondary flex-1 text-xs border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-200" disabled={!effectiveVariantInStock || !batchReadyToSell} onClick={() => closeAfterAdd(effectiveVariant, 'promotion')}>
                        {effectiveVariantPromoBadge.kind === 'quantity_hint'
                          ? ((effectiveVariantPromoBadge.show_title && effectiveVariantPromoBadge.title) || `${posCopy('Buy', 'ទិញ')} ${effectiveVariantPromoBadge.min_quantity}+`)
                          : `${(effectiveVariantPromoBadge.show_title && effectiveVariantPromoBadge.title) || effectiveVariant.discount_label || posCopy('Discounts', 'ការបញ្ចុះតម្លៃ')} ${fmtUSD(effectiveVariantPromotion.applied_price_usd)}`}
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
                  {t('batches') || 'Received dates'}
                </div>
                {batchesLoading ? (
                  <div className="text-xs text-gray-400">{t('loading') || 'Loading…'}</div>
                ) : batchesError ? (
                  <div className="text-xs font-medium text-red-500">{batchesError}</div>
                ) : orderedBatches.length === 0 ? (
                  <div className="text-xs text-gray-400">{t('received_dates_none') || 'No received dates at this branch'}</div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      onClick={() => setBatchChoicesOpen((open) => !open)}
                      aria-expanded={batchChoicesOpen}
                    >
                      <span className="min-w-0 truncate">
                        {selectedBatch
                          ? `${formatBatchLabel(selectedBatch, batchWord)} · ${Number(selectedBatch.quantity || 0)}`
                          : t('choose_received_date') || 'Choose a received date'}
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${batchChoicesOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {batchChoicesOpen ? <><div className="mt-1.5 flex flex-wrap gap-1.5">
                      {pagedBatches.map((batch) => {
                        const batchOut = Number(batch.quantity || 0) <= 0
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            className={pillClass(batch.id === selectedBatchId, batchOut)}
                            onClick={() => chooseBatch(batch)}
                          >
                            <span className="font-mono">{formatBatchLabel(batch, batchWord)}</span>
                            {batch.expiry_date ? <span className="ml-1 text-[10px] font-normal opacity-75">{posCopy('exp', 'ផុត')} {batch.expiry_date}</span> : null}
                            <span className="ml-1 text-[10px] font-normal opacity-75">({batch.quantity} {product.unit})</span>
                          </button>
                        )
                      })}
                    </div>
                    <PillPager page={clampedBatchPage} pageCount={batchPageCount} onPageChange={setBatchPage} posCopy={posCopy} />
                    </> : null}
                  </>
                )}
              </div>
            ) : null}
            {damagedLots.length > 0 ? (
              <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900/50 dark:bg-orange-950/20">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-500 dark:text-orange-400">🟠 {posCopy('Damage (from returns)', 'ខូចខាត (ពីការប្រគល់មកវិញ)')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {damagedLots.map((lot) => (
                    <button key={lot.id} type="button"
                      className={pillClass(lot.id === selectedDamagedLotId, Number(lot.quantity_remaining || 0) <= 0)}
                      onClick={() => { setSelectedDamagedLotId(lot.id === selectedDamagedLotId ? null : lot.id); setSelectedBatchId(null) }}>
                      <span className="font-mono">{damagedLotLabel(lot)}</span>
                      <span className="ml-1 text-[10px] font-normal opacity-75">({lot.quantity_remaining})</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {onPick ? renderPickButton(product) : null}
              {onPick ? null : <button className="btn-primary flex-1" disabled={displayedStock <= asNumber(product.out_of_stock_threshold) || !batchReadyToSell} onClick={() => closeAfterAdd(product, 'selling')}>
                {displayedStock <= asNumber(product.out_of_stock_threshold) ? t('out_of_stock') : batchSelectionRequired && !selectedBatch ? t('pick_received_date_first') || 'Pick a received date first' : `${t('selling_price') || 'Selling'} ${fmtUSD(asNumber(product.selling_price_usd || 0))}`}
              </button>}
              {!onPick && promotion.active ? (
                <button className="btn-secondary flex-1 border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-200" disabled={displayedStock <= asNumber(product.out_of_stock_threshold) || !batchReadyToSell} onClick={() => closeAfterAdd(product, 'promotion')}>
                  {promoBadge.kind === 'quantity_hint'
                    ? ((promoBadge.show_title && promoBadge.title) || `${posCopy('Buy', 'ទិញ')} ${promoBadge.min_quantity}+`)
                    : `${(promoBadge.show_title && promoBadge.title) || product.discount_label || posCopy('Discounts', 'ការបញ្ចុះតម្លៃ')} ${fmtUSD(promotion.applied_price_usd)}`}
                </button>
              ) : null}
              {/* The product's VIP add-to-cart button is deleted by the
                  2026-09-04 ruling -- same as the variant twin above. */}
              {!onPick && (asNumber(product.wholesale_price_usd) > 0 || asNumber(product.wholesale_price_khr) > 0) ? (
                <button
                  className="btn-secondary flex-1 border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-200"
                  disabled={displayedStock <= asNumber(product.out_of_stock_threshold) || !batchReadyToSell}
                  onClick={() => closeAfterAdd(product, 'wholesale')}
                >
                  {`${t('wholesale_price') || 'Wholesale'} ${fmtUSD(asNumber(product.wholesale_price_usd || 0))}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
  return portal && typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet
}
