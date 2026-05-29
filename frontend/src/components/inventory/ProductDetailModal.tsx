import { calculateProductDiscount } from '../../utils/pricing.ts'
import { buildBatchPreview, getVisibleProductBatches } from '../../utils/productBatches.ts'

type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number) => string
type ProductAction = (product: InventoryProduct) => void

interface BranchStockEntry {
  branch_id?: string | number
  branch_name?: string
  quantity?: number
}

interface ProductBatchEntry {
  id?: string | number
  batch_id?: string | number
  lot_code?: string
  quantity?: number
  expiry_date?: string
  branch_stock?: Array<{ branch_id?: string | number; quantity?: number }>
  [key: string]: unknown
}

interface InventoryProduct {
  name?: string
  sku?: string
  barcode?: string
  category?: string
  brand?: string
  supplier?: string
  unit?: string
  description?: string
  stock_quantity?: number
  low_stock_threshold?: number
  purchase_price_usd?: number
  cost_price_usd?: number
  purchase_price_khr?: number
  selling_price_usd?: number
  selling_price_khr?: number
  special_price_usd?: number
  special_price_khr?: number
  qty_sold?: number
  revenue_usd?: number
  cogs_usd?: number
  branch_stock?: BranchStockEntry[]
  batches?: ProductBatchEntry[]
  [key: string]: unknown
}

interface ProductDetailModalProps {
  product?: InventoryProduct | null
  onClose: () => void
  onAdjust: ProductAction
  onTransfer?: ProductAction
  onMoveRow?: ProductAction
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  t?: TranslateFn
}

function getBranchStockKey(branchStock: BranchStockEntry, index: number): string {
  return String(branchStock.branch_id ?? `${branchStock.branch_name || 'branch'}-${index}`)
}

export default function ProductDetailModal({ product: p, onClose, onAdjust, onTransfer, onMoveRow, fmtUSD, fmtKHR, t }: ProductDetailModalProps) {
  const T = (key: string, fallback: string): string => (typeof t === 'function' ? t(key) : fallback) || fallback
  if (!p) return null

  const costPriceUsd = Number(p.purchase_price_usd || p.cost_price_usd || 0)
  const costPriceKhr = Number(p.purchase_price_khr || 0)
  const sellingPriceUsd = Number(p.selling_price_usd || 0)
  const sellingPriceKhr = Number(p.selling_price_khr || 0)
  const specialPriceUsd = Number(p.special_price_usd || 0)
  const specialPriceKhr = Number(p.special_price_khr || 0)
  const hasSpecialPrice = specialPriceUsd > 0 || specialPriceKhr > 0
  const activePriceUsd = hasSpecialPrice ? (specialPriceUsd || sellingPriceUsd) : sellingPriceUsd
  const activePriceKhr = hasSpecialPrice ? (specialPriceKhr || sellingPriceKhr) : sellingPriceKhr
  const stockQuantity = Number(p.stock_quantity || 0)
  const lowStockThreshold = Number(p.low_stock_threshold || 0)
  const stockPct = lowStockThreshold > 0
    ? Math.min(100, (stockQuantity / lowStockThreshold) * 100)
    : 100
  const stockColor = stockQuantity <= 0
    ? 'text-red-600'
    : stockQuantity <= lowStockThreshold
      ? 'text-yellow-600'
      : 'text-green-600'
  const profit = Math.max(0, p.revenue_usd || 0) - Math.max(0, p.cogs_usd || 0)
  const stockValueUsd = Math.max(0, stockQuantity) * costPriceUsd
  const marginUsd = Math.max(0, activePriceUsd - costPriceUsd)
  const marginPct = costPriceUsd > 0 ? ((marginUsd / costPriceUsd) * 100) : 0
  const branchStock = Array.isArray(p.branch_stock) ? p.branch_stock : []
  const branchCount = branchStock.length
  const promotion = calculateProductDiscount(p)
  const visibleBatches = getVisibleProductBatches(p)
  const batchPreview = buildBatchPreview(p, 'all', { limit: 8 }) as {
    items: ProductBatchEntry[]
    extraCount: number
  }
  const batchCount = visibleBatches.length

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-gray-900 dark:text-white">{p.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {p.sku ? <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-400 dark:bg-gray-700">{p.sku}</span> : null}
              {p.category ? <span className="text-xs text-blue-600 dark:text-blue-400">{p.category}</span> : null}
              {p.unit ? <span className="text-xs text-gray-400">/{p.unit}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-2xl text-gray-400 hover:text-gray-600" aria-label={T('close', 'Close')}>x</button>
        </div>

        <div className="modal-scroll space-y-3 p-4">
          <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/50">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{T('current_stock', 'Current Stock')}</span>
              <span className={`text-2xl font-bold ${stockColor}`}>{stockQuantity} <span className="text-sm font-normal">{p.unit}</span></span>
            </div>
            <div className="mb-1 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-600">
              <div
                className={`h-2 rounded-full transition-all ${stockQuantity <= 0 ? 'bg-red-500' : stockQuantity <= lowStockThreshold ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.max(2, Math.min(100, stockPct))}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              {[
                { label: T('low_stock_threshold', 'Low stock threshold'), value: `${lowStockThreshold} ${p.unit || ''}` },
                { label: T('branches', 'Branches'), value: String(branchCount || 0) },
                { label: T('batches', 'Batches'), value: String(batchCount || 0) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-white/80 px-2 py-1.5 dark:bg-slate-800/60">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{item.value}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-gray-400">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className={`grid gap-3 ${hasSpecialPrice ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
              <div className="rounded-xl bg-red-50 p-3 dark:bg-red-900/20">
                <div className="mb-1 text-xs font-semibold text-red-600 dark:text-red-400">{T('label_cost_purchase', 'Cost Price')}</div>
                <div className="font-bold text-red-700 dark:text-red-300">{fmtUSD(costPriceUsd)}</div>
                {costPriceKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(costPriceKhr)}</div> : null}
              </div>
              <div className="rounded-xl bg-green-50 p-3 dark:bg-green-900/20">
                <div className="mb-1 text-xs font-semibold text-green-600 dark:text-green-400">{T('label_selling_price', 'Selling Price')}</div>
                <div className="font-bold text-green-700 dark:text-green-300">{fmtUSD(sellingPriceUsd)}</div>
                {sellingPriceKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(sellingPriceKhr)}</div> : null}
              </div>
              {hasSpecialPrice ? (
                <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-900/20">
                  <div className="mb-1 text-xs font-semibold text-blue-600 dark:text-blue-400">{T('special_price', 'Special Price')}</div>
                  <div className="font-bold text-blue-700 dark:text-blue-300">{fmtUSD(specialPriceUsd || sellingPriceUsd)}</div>
                  {(specialPriceKhr || sellingPriceKhr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(specialPriceKhr || sellingPriceKhr || 0)}</div> : null}
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                { label: T('stock_val', 'Stock Value'), value: fmtUSD(stockValueUsd), tone: 'text-slate-700 dark:text-slate-200', bg: 'bg-slate-50 dark:bg-slate-700/40' },
                { label: T('active_price', 'Active Price'), value: fmtUSD(activePriceUsd), tone: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                { label: T('margin', 'Margin'), value: `${fmtUSD(marginUsd)}${costPriceUsd > 0 ? ` - ${Math.round(marginPct)}%` : ''}`, tone: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                { label: T('branches', 'Branches'), value: String(branchCount || 0), tone: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-50 dark:bg-violet-900/20' },
              ].map((item) => (
                <div key={item.label} className={`${item.bg} rounded-xl px-2.5 py-2`}>
                  <div className={`text-xs font-bold ${item.tone}`}>{item.value}</div>
                  <div className="mt-0.5 text-[10px] text-gray-500">{item.label}</div>
                </div>
              ))}
            </div>
            {promotion.active ? (
              <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-950/30">
                <div className="mb-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{T('discounts', 'Discounts')}</div>
                <div className="font-bold text-rose-700 dark:text-rose-200">{fmtUSD(promotion.applied_price_usd || 0)}</div>
                {(promotion.applied_price_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(promotion.applied_price_khr || 0)}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 sm:gap-x-4">
            {[
              [T('label_brand', 'Brand'), p.brand],
              [T('label_sku', 'SKU'), p.sku],
              [T('label_barcode', 'Barcode'), p.barcode],
              [T('label_unit', 'Unit'), p.unit],
              [T('label_supplier', 'Supplier'), p.supplier],
              [T('label_description', 'Description'), p.description],
            ].filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="flex gap-2 text-sm">
                <span className="w-20 flex-shrink-0 pt-0.5 text-[11px] text-gray-400">{label}</span>
                <span className="break-all text-gray-700 dark:text-gray-300">{value}</span>
              </div>
            ))}
          </div>

          {(Number(p.qty_sold || 0) > 0 || Number(p.revenue_usd || 0) > 0) ? (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{T('performance', 'Performance')} ({T('net_of_returns', 'net of returns')})</div>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                {[
                  { value: Math.max(0, p.qty_sold || 0), label: T('net_sold', 'Net Sold'), className: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  { value: fmtUSD(Math.max(0, p.revenue_usd || 0)), label: T('revenue', 'Revenue'), className: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
                  { value: fmtUSD(Math.max(0, p.cogs_usd || 0)), label: T('cogs', 'COGS'), className: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                  { value: fmtUSD(profit), label: T('profit', 'Profit'), className: profit >= 0 ? 'text-purple-600' : 'text-red-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                ].map((item) => (
                  <div key={item.label} className={`${item.bg} rounded-xl px-2 py-2`}>
                    <div className={`text-xs font-bold ${item.className}`}>{item.value}</div>
                    <div className="text-[10px] text-gray-500">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {branchStock.length > 0 ? (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{T('branch_stock', 'Branch Stock')}</div>
              <div className="space-y-1">
                {branchStock.map((branchStock, index) => (
                  <div
                    key={getBranchStockKey(branchStock, index)}
                    className={`flex justify-between py-1 text-sm ${index < branchCount - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
                  >
                    <span className="text-gray-700 dark:text-gray-300">{branchStock.branch_name}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{branchStock?.quantity ?? 0} {p.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {visibleBatches.length ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{T('batches', 'Batches')}</div>
              <div className="space-y-2">
                {batchPreview.items.map((batch, index) => (
                  <div key={String(batch.id || batch.batch_id || `batch-${index}`)} className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-amber-700 dark:text-amber-200">{batch.lot_code || T('batch', 'Batch')}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{batch.quantity} {p.unit}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-300">{batch.expiry_date || T('no_expiry', 'No expiry')}</div>
                  </div>
                ))}
                {batchPreview.extraCount ? (
                  <div className="text-[11px] text-gray-400">+{batchPreview.extraCount} {T('more', 'more')}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid flex-shrink-0 gap-2 border-t border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-3">
          <button type="button" onClick={() => { onClose(); onAdjust(p) }} className="btn-primary w-full py-2.5 text-sm">{T('adjust_stock', 'Adjust Stock')}</button>
          <button type="button" onClick={() => { onClose(); onTransfer?.(p) }} className="btn-secondary w-full py-2.5 text-sm">{T('transfer', 'Transfer')}</button>
          <button type="button" onClick={() => { onClose(); onMoveRow?.(p) }} className="btn-secondary w-full py-2.5 text-sm">{T('move_stock', 'Move Stock')}</button>
        </div>
      </div>
    </div>
  )
}
