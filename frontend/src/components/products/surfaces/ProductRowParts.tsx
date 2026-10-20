import type { ReactNode } from 'react'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import { useCopyFloat } from '../../shared/CopyFloat.tsx'
import { calculateProductDiscount } from '../../../utils/pricing.ts'
import { buildBatchPreview } from '../../../utils/productBatches.ts'
import { batchDisplayLabel } from '../../../utils/batchLabel.ts'
import EntityLink, { type EntityNavigate } from '../../shared/EntityLink.tsx'
import { getKhmerTextProps } from '../../../utils/scriptTypography.ts'
import { branchStockLinesWorthShowing } from '../../../utils/branchScope.ts'
import type { StockCellModel } from '../config/productTableColumns.ts'

type BranchId = string | number
type Translate = (key: string, fallback?: string, khmerFallback?: string) => string
type MoneyFormatter = (value: unknown) => string

type ProductLike = {
  id?: string | number
  sku?: string
  barcode?: string
  supplier?: string
  batches?: unknown
  discount_enabled?: unknown
  discount_type?: unknown
  discount_percent?: unknown
  discount_amount_usd?: unknown
  discount_amount_khr?: unknown
  discount_starts_at?: unknown
  discount_ends_at?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  branch_stock?: Array<{ branch_id?: unknown; branch_name?: unknown; branch_active?: unknown; quantity?: unknown }>
}

type ProductPromotion = {
  active?: boolean
  applied_price_usd?: unknown
}

type MetaPill = {
  key: string
  label: ReactNode
  className: string
}

type ProductDiscountBadgeProps = {
  product: ProductLike
  promotion?: ProductPromotion | null
  fmtUSD: MoneyFormatter
  label: string
  overlay?: boolean
}

type ProductBatchPreviewProps = {
  product: ProductLike
  branchId?: BranchId
  tr: Translate
  compact?: boolean
}

type ProductDetailsCellProps = {
  product: ProductLike
  promotion?: ProductPromotion | null
  branchLabel?: ReactNode
  selectedBranchName?: ReactNode
  selectedBranchId?: BranchId
  renderMetaPill: (item: MetaPill) => ReactNode
  tr: Translate
  fmtUSD: MoneyFormatter
  navigateTo?: EntityNavigate
}

export function ProductDiscountBadge({
  product,
  promotion,
  fmtUSD,
  label,
  overlay = false,
}: ProductDiscountBadgeProps) {
  const promo = promotion || calculateProductDiscount(product)
  if (!promo?.active) return null
  const className = overlay
    ? 'absolute right-1 top-1 inline-flex max-w-[9rem] truncate rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60'
    : 'inline-flex max-w-[10rem] truncate rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60'
  // G1: a rule's shown title beats the generic label; a quantity rule
  // ("buy >= X") advertises its deal instead of a price it isn't cutting
  // yet. Extra fields are optional so pre-G1 promotion objects render
  // exactly as before.
  const extra = promo as { title?: string; isQuantityHint?: boolean; minQuantity?: number }
  const shownLabel = extra.title || label
  const text = extra.isQuantityHint
    ? (extra.title || `${label} ${extra.minQuantity || 0}+`)
    : `${shownLabel} ${fmtUSD(promo.applied_price_usd || 0)}`
  return (
    <span className={className} title={text} data-reveal-text={text}>
      {text}
    </span>
  )
}

export function ProductBatchPreview({
  product,
  branchId = 'all',
  tr,
  compact = false,
}: ProductBatchPreviewProps) {
  const preview = buildBatchPreview(product, branchId, { limit: compact ? 2 : 3 })
  if (!preview.totalCount) return null
  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? 'mt-1' : 'mt-1.5'}`}>
      {preview.items.map((batch) => {
        const batchId = String(batch.id || batch.batch_id || 'batch')
        // Z1a: a date-derived lot code reads as its dd/mm/yyyy date; a real
        // custom code stays a code.
        const lotCode = batchDisplayLabel({ id: String(batch.id ?? batch.batch_id ?? 'batch'), lot_code: (batch.lot_code as string) ?? null, received_at: (batch.received_at as string) ?? null, batch_number: (batch.batch_number as number) ?? null }, tr('batch', 'Received date', 'ថ្ងៃចូល'))
        const expiryDate = String(batch.expiry_date || tr('no_expiry', 'No expiry', 'No expiry'))
        const quantity = Number(batch.quantity || 0)
        return (
          <span
            key={`${product?.id || 'product'}-batch-${batchId}`}
            className="inline-flex max-w-[13rem] items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50"
            title={`${lotCode} / ${expiryDate} / ${quantity}`}
          >
            <span className="detail-scroll-text">{lotCode} / {expiryDate} / {quantity}</span>
          </span>
        )
      })}
      {preview.extraCount ? (
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          +{preview.extraCount}
        </span>
      ) : null}
    </div>
  )
}

export function ProductDetailsCell({
  product,
  promotion,
  branchLabel,
  selectedBranchName,
  selectedBranchId = 'all',
  renderMetaPill,
  tr,
  fmtUSD,
  navigateTo,
}: ProductDetailsCellProps) {
  // Supplier is the one of the four copyable product fields (name, brand,
  // supplier, barcode) that renders in THIS cell -- the Products list keeps
  // name and brand in its name cell and dropped barcode from here when it
  // moved to that cell's meta line. Those three are wired where they are
  // actually drawn: Products.tsx for the desktop row and the mobile card,
  // and both product detail modals. The POS product sheet is another
  // lane's file and is handed over as an addendum.
  const copy = useCopyFloat(tr)
  const detailPills: MetaPill[] = []
  const branchRows = selectedBranchName
    ? [String(selectedBranchName)]
    : Array.isArray(product.branch_stock) && product.branch_stock.length
      ? branchStockLinesWorthShowing(product.branch_stock).map((entry) => `${String(entry.branch_name || entry.branch_id || 'Branch')}: ${Number(entry.quantity || 0)}`)
      : branchLabel ? [String(branchLabel)] : []
  if (product.sku) {
    detailPills.push({ key: 'sku', label: product.sku, className: 'bg-indigo-50 font-mono text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200' })
  }
  // Barcode moved out of this cell -- it now sits with brand/category in
  // the name cell's compactMeta line (desktop table row, see
  // buildProductRowDisplayState/renderDesktopProductRow) instead of here,
  // matching Inventory's name-cell tag line. Keeping it here too would
  // just duplicate it.
  if (product.supplier) {
    detailPills.push({ key: 'supplier', label: product.supplier, className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' })
  }

  return (
    <div className="min-h-[4.25rem] min-w-0">
      {branchRows.length ? (
        <div className="mb-1 flex min-w-0 flex-wrap gap-1">
          {branchRows.map((label, index) => (
            <div key={`${label}-${index}`} className="max-w-full whitespace-normal break-words rounded-lg bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200">
              {label}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {detailPills.map((item) => (item.key === 'supplier' ? (
          // The pill itself is drawn by the caller's renderMetaPill (which
          // stringifies its label, so the affordance cannot go inside it);
          // this wrapper carries the gesture attributes and no box of its
          // own beyond the inline-flex the pill already sat in.
          <span key="supplier-copy" className="inline-flex min-w-0 max-w-full" {...copy(product.supplier)}>
            <EntityLink className="text-inherit no-underline hover:text-inherit hover:no-underline" page="contacts" anchor="hub:contacts:suppliers" search={product.supplier} navigate={navigateTo} title={tr('open_supplier', 'Open supplier', 'បើកអ្នកផ្គត់ផ្គង់')}>
              {renderMetaPill(item)}
            </EntityLink>
          </span>
        ) : renderMetaPill(item)))}
        <ProductDiscountBadge product={product} promotion={promotion} fmtUSD={fmtUSD} label={tr('discounts', 'Discounts', 'Discounts')} />
        {!branchRows.length && !detailPills.length && !promotion?.active ? <span className="text-xs text-gray-300">N/A</span> : null}
      </div>
      <ProductBatchPreview product={product} branchId={selectedBranchId} tr={tr} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Excel-style table cells (config/productTableColumns.ts decides which exist)
// ---------------------------------------------------------------------------

/** The lock on a column the signed-in user may read but not change. */
export function ReadOnlyMark({ tip }: { tip: string }) {
  return (
    <span role="img" aria-label={tip} title={tip} className="inline-flex shrink-0 text-gray-400 dark:text-gray-500">
      <Lock className="h-3 w-3" aria-hidden="true" />
    </span>
  )
}

type ProductPriceCellProps = {
  usd: number
  khr: number
  tone: 'selling' | 'wholesale'
  /** Set when the user cannot change prices: the value turns muted and gains a lock. */
  lockTip?: string
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  children?: ReactNode
}

/** USD on the first line, riel on the second. A wholesale price nobody set reads as a dash. */
export function ProductPriceCell({ usd, khr, tone, lockTip, fmtUSD, fmtKHR, children }: ProductPriceCellProps) {
  if (tone === 'wholesale' && !(usd > 0) && !(khr > 0)) {
    return <div className="flex items-center justify-end gap-1 text-gray-300">{lockTip ? <ReadOnlyMark tip={lockTip} /> : null}<span>—</span></div>
  }
  const ink = lockTip
    ? 'text-gray-500 dark:text-gray-400'
    : tone === 'selling' ? 'font-semibold text-green-700 dark:text-green-400' : 'font-medium text-primary-700 dark:text-primary-400'
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-end gap-1">
        {lockTip ? <ReadOnlyMark tip={lockTip} /> : null}
        <span className={ink}>{fmtUSD(usd)}</span>
      </div>
      {khr > 0 ? <div {...getKhmerTextProps(fmtKHR(khr), 'text-xs text-gray-400')}>{fmtKHR(khr)}</div> : null}
      {children}
    </div>
  )
}

type ProductSupplierCellProps = {
  supplier?: string
  /** Set while the table cannot edit the supplier: muted text and a lock. */
  lockTip?: string
  tr: Translate
  navigateTo?: EntityNavigate
}

export function ProductSupplierCell({ supplier, lockTip, tr, navigateTo }: ProductSupplierCellProps) {
  const copy = useCopyFloat(tr)
  return (
    <div className="flex min-w-0 items-center gap-1">
      {supplier ? (
        <span className={`inline-flex min-w-0 max-w-full ${lockTip ? 'text-gray-500 dark:text-gray-400' : ''}`} {...copy(supplier)}>
          <EntityLink className="detail-scroll-text text-inherit no-underline hover:text-inherit hover:no-underline" page="contacts" anchor="hub:contacts:suppliers" search={supplier} navigate={navigateTo} title={tr('open_supplier', 'Open supplier', 'បើកអ្នកផ្គត់ផ្គង់')}>
            {supplier}
          </EntityLink>
        </span>
      ) : <span className="text-gray-300">—</span>}
      {lockTip ? <ReadOnlyMark tip={lockTip} /> : null}
    </div>
  )
}

type ProductStockCellProps = {
  qty: unknown
  qtyClassName: string
  unitChip: ReactNode
  model: StockCellModel
  totalLabel: string
  inactiveLabel: string
}

/** The status-coloured total, then the branch: a chip for one branch, a short list for several. */
export function ProductStockCell({ qty, qtyClassName, unitChip, model, totalLabel, inactiveLabel }: ProductStockCellProps) {
  return (
    <div className="min-w-0">
      <div title={model.lines.length ? totalLabel : undefined} className={`flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 font-bold ${qtyClassName}`}>
        <span>{String(qty || 0)}</span>
        {unitChip}
      </div>
      {model.chip ? (
        <div data-stock-branch-chip="" title={model.chip} className="mt-0.5 flex min-w-0 items-center justify-end gap-1 text-[10px] text-gray-500 dark:text-gray-400">
          <Store className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="detail-scroll-text min-w-0">{model.chip}</span>
        </div>
      ) : null}
      {model.lines.map((line) => (
        <div key={line.key} data-stock-branch-line={line.inactive ? 'inactive' : 'active'} className={`mt-0.5 flex min-w-0 items-center justify-between gap-1 text-[10px] ${line.inactive ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
          <span className="detail-scroll-text min-w-0">{line.inactive ? `${line.name} (${inactiveLabel})` : line.name}</span>
          <span className="shrink-0 tabular-nums">{line.quantity}</span>
        </div>
      ))}
    </div>
  )
}
