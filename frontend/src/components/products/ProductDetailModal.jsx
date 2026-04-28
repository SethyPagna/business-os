import { X } from 'lucide-react'
import { ProductImg, ProductImagePlaceholder } from './primitives'

export default function ProductDetailModal({
  p,
  catMap,
  unitMap,
  fmtUSD,
  fmtKHR,
  onEdit,
  onDelete,
  onClose,
  onImageClick,
  t,
}) {
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)
  const purchaseUsd = p.purchase_price_usd || p.cost_price_usd || 0
  const purchaseKhr = p.purchase_price_khr || p.cost_price_khr || 0
  const marginUsd = p.selling_price_usd - purchaseUsd
  const marginPct = p.selling_price_usd > 0 ? (marginUsd / p.selling_price_usd) * 100 : 0
  const gallery = Array.isArray(p?.image_gallery) && p.image_gallery.length
    ? p.image_gallery.filter(Boolean).slice(0, 5)
    : (p?.image_path ? [p.image_path] : [])
  const primaryImage = gallery[0] || ''
  const unitColor = unitMap?.[p.unit]?.color || ''

  const Row = ({ label, children }) => (
    <div className="flex gap-3">
      <span className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{label}</span>
      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{children}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-xl dark:bg-gray-700">
              {primaryImage ? (
                <ProductImg
                  src={primaryImage}
                  alt={p.name}
                  className="h-full w-full cursor-zoom-in object-cover"
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
              <div className="truncate font-bold text-gray-900 dark:text-white">{p.name}</div>
              {p.sku ? <div className="font-mono text-xs text-gray-400">{p.sku}</div> : null}
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-4">
          {p.category ? (
            <Row label={T('label_category', 'Category')}>
              <span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: catMap[p.category]?.color || '#6b7280' }}>
                {p.category}
              </span>
            </Row>
          ) : null}
          {p.barcode ? <Row label={T('label_barcode', 'Barcode')}><span className="font-mono">{p.barcode}</span></Row> : null}
          {p.brand ? <Row label={T('brand', 'Brand')}>{p.brand}</Row> : null}
          {p.supplier ? <Row label={T('label_supplier', 'Supplier')}>{p.supplier}</Row> : null}
          {p.unit ? (
            <Row label={T('label_unit', 'Unit')}>
              {unitColor ? (
                <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: unitColor }}>
                  {p.unit}
                </span>
              ) : p.unit}
            </Row>
          ) : null}
          <Row label={T('label_stock', 'Stock')}>
            <strong className="text-gray-900 dark:text-white">{p.stock_quantity}</strong>
            {p.unit ? (
              unitColor ? (
                <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: unitColor }}>
                  {p.unit}
                </span>
              ) : (
                <span className="ml-1">{p.unit}</span>
              )
            ) : null}
          </Row>
          {p.description ? <Row label={T('label_description', 'Description')}>{p.description}</Row> : null}

          <div className="space-y-2 border-t border-gray-100 pt-2 dark:border-gray-700">
            <Row label={T('label_cost_purchase', 'Cost In (Purchase)')}>
              <span className="text-red-600">{fmtUSD(purchaseUsd)}</span>
              {purchaseKhr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(purchaseKhr)}</span> : null}
            </Row>
            <Row label={T('label_selling_price', 'Selling Price')}>
              <span className="text-green-600">{fmtUSD(p.selling_price_usd)}</span>
              {p.selling_price_khr > 0 ? <span className="ml-2 text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</span> : null}
            </Row>
            <Row label={T('label_margin', 'Margin')}>
              <span className={marginUsd >= 0 ? 'text-blue-600' : 'text-yellow-600'}>
                {fmtUSD(marginUsd)} ({marginPct.toFixed(1)}%)
              </span>
            </Row>
          </div>

          {(p.branch_stock || []).length > 0 ? (
            <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
              <div className="mb-1.5 text-xs text-gray-400">{T('label_branches', 'Branch Stock')}</div>
              <div className="flex flex-wrap gap-1.5">
                {(p.branch_stock || []).map((bs) => (
                  <span
                    key={bs.branch_id}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      bs.quantity > 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30'
                        : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                    }`}
                  >
                    {bs.branch_name}: {bs.quantity}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <Row label={T('status', 'Status')}>
            {p.stock_quantity <= (p.out_of_stock_threshold || 0) ? (
              <span className="badge-red">{T('out_of_stock', 'Out of stock')}</span>
            ) : p.stock_quantity <= (p.low_stock_threshold || 10) ? (
              <span className="badge-yellow">{T('low_stock', 'Low stock')}</span>
            ) : (
              <span className="badge-green">{T('in_stock', 'In stock')}</span>
            )}
          </Row>

          {p.created_at ? (
            <Row label={T('label_added', 'Added')}>
              {new Date(p.created_at.includes('T') ? p.created_at : `${p.created_at}Z`).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </Row>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
          <button className="btn-primary flex-1" onClick={onEdit}>{T('edit', 'Edit')}</button>
          <button className="btn-danger" onClick={onDelete}>{T('delete', 'Delete')}</button>
        </div>
      </div>
    </div>
  )
}
