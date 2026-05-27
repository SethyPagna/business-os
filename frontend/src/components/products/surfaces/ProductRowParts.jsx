import { ThreeDotPortal } from '../../shared/PortalMenu'
import { calculateProductDiscount } from '../../../utils/pricing.js'
import { buildBatchPreview } from '../../../utils/productBatches.mjs'

export function ProductDiscountBadge({ product, promotion, fmtUSD, label, overlay = false }) {
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

export function ProductRowActions({ onDetails, onEdit, onDelete, onAddVariant, onDiscount, onAdjustStock, t }) {
  const label = (key, fallback) => (typeof t === 'function' ? (t(key) || fallback) : fallback)
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
      extraItems={[
        onDiscount && { label: label('discounts', 'Discounts'), onClick: onDiscount, color: 'orange' },
        onAdjustStock && { label: label('adjust_stock', 'Adjust stock'), onClick: onAdjustStock, color: 'green' },
      ]}
    />
  )
}

export function ProductBatchPreview({ product, branchId = 'all', tr, compact = false }) {
  const preview = buildBatchPreview(product, branchId, { limit: compact ? 2 : 3 })
  if (!preview.totalCount) return null
  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? 'mt-1' : 'mt-1.5'}`}>
      {preview.items.map((batch) => (
        <span
          key={`${product?.id || 'product'}-batch-${batch.id || batch.batch_id}`}
          className="inline-flex max-w-[13rem] items-center truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50"
          title={`${batch.lot_code || tr('batch', 'Batch', 'Batch')} / ${batch.expiry_date || tr('no_expiry', 'No expiry', 'No expiry')} / ${batch.quantity}`}
        >
          {batch.lot_code || tr('batch', 'Batch', 'Batch')} / {batch.expiry_date || tr('no_expiry', 'No expiry', 'No expiry')} / {batch.quantity}
        </span>
      ))}
      {preview.extraCount ? (
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          +{preview.extraCount}
        </span>
      ) : null}
    </div>
  )
}

export function ProductDetailsCell({ product, promotion, branchLabel, selectedBranchName, selectedBranchId = 'all', renderMetaPill, tr, fmtUSD }) {
  const detailPills = [
    selectedBranchName ? { key: 'branch', label: selectedBranchName, className: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200' } : null,
    branchLabel ? { key: 'branches', label: branchLabel, className: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200' } : null,
    product.sku ? { key: 'sku', label: product.sku, className: 'bg-indigo-50 font-mono text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200' } : null,
    product.barcode ? { key: 'barcode', label: product.barcode, className: 'bg-sky-50 font-mono text-sky-700 dark:bg-sky-900/30 dark:text-sky-200' } : null,
  ].filter(Boolean)

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
