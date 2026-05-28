import type { ReactNode } from 'react'
import { ThreeDotPortal } from '../../shared/PortalMenu'
import type { PortalMenuItem } from '../../shared/PortalMenu'
import { calculateProductDiscount } from '../../../utils/pricing.ts'
import { buildBatchPreview } from '../../../utils/productBatches.ts'

type BranchId = string | number
type Translate = (key: string, fallback?: string, khmerFallback?: string) => string
type MoneyFormatter = (value: unknown) => string

type ProductLike = {
  id?: string | number
  sku?: string
  barcode?: string
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

type ProductRowActionsProps = {
  onDetails?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onAddVariant?: () => void
  onDiscount?: () => void
  onAdjustStock?: () => void
  t?: (key: string) => string | undefined
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
  const title = `${label} ${fmtUSD(promo.applied_price_usd || 0)}`
  return (
    <span className={className} title={title}>
      {label} {fmtUSD(promo.applied_price_usd || 0)}
    </span>
  )
}

export function ProductRowActions({
  onDetails,
  onEdit,
  onDelete,
  onAddVariant,
  onDiscount,
  onAdjustStock,
  t,
}: ProductRowActionsProps) {
  const label = (key: string, fallback: string) => (typeof t === 'function' ? (t(key) || fallback) : fallback)
  const extraItems: Array<PortalMenuItem | false | undefined> = [
    onDiscount && { label: label('discounts', 'Discounts'), onClick: onDiscount, color: 'orange' },
    onAdjustStock && { label: label('adjust_stock', 'Adjust stock'), onClick: onAdjustStock, color: 'green' },
  ]

  return (
    <ThreeDotPortal
      onDetails={onDetails}
      onEdit={onEdit}
      onDelete={onDelete}
      onAddVariant={onAddVariant}
      labels={{
        details: label('view_details', label('details', 'View Details')),
        edit: label('edit', 'Edit'),
        addVariant: label('add_variant', 'Add Variant'),
        delete: label('delete', 'Delete'),
        ariaLabel: label('actions', 'Open actions menu'),
      }}
      extraItems={extraItems}
    />
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
        const lotCode = String(batch.lot_code || tr('batch', 'Batch', 'Batch'))
        const expiryDate = String(batch.expiry_date || tr('no_expiry', 'No expiry', 'No expiry'))
        const quantity = Number(batch.quantity || 0)
        return (
          <span
            key={`${product?.id || 'product'}-batch-${batchId}`}
            className="inline-flex max-w-[13rem] items-center truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50"
            title={`${lotCode} / ${expiryDate} / ${quantity}`}
          >
            {lotCode} / {expiryDate} / {quantity}
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
}: ProductDetailsCellProps) {
  const detailPills: MetaPill[] = []
  if (selectedBranchName) {
    detailPills.push({ key: 'branch', label: selectedBranchName, className: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200' })
  }
  if (branchLabel) {
    detailPills.push({ key: 'branches', label: branchLabel, className: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200' })
  }
  if (product.sku) {
    detailPills.push({ key: 'sku', label: product.sku, className: 'bg-indigo-50 font-mono text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200' })
  }
  if (product.barcode) {
    detailPills.push({ key: 'barcode', label: product.barcode, className: 'bg-sky-50 font-mono text-sky-700 dark:bg-sky-900/30 dark:text-sky-200' })
  }

  return (
    <div className="min-h-[4.25rem] max-w-[17rem]">
      <div className="flex flex-wrap items-center gap-1">
        {detailPills.map((item) => renderMetaPill(item))}
        <ProductDiscountBadge product={product} promotion={promotion} fmtUSD={fmtUSD} label={tr('discounts', 'Discounts', 'Discounts')} />
        {!detailPills.length && !promotion?.active ? <span className="text-xs text-gray-300">N/A</span> : null}
      </div>
      <ProductBatchPreview product={product} branchId={selectedBranchId} tr={tr} />
    </div>
  )
}
