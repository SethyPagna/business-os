import History from 'lucide-react/dist/esm/icons/history.js'
import { createPortal } from 'react-dom'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import { calculateProductDiscount } from '../../utils/pricing.ts'
import { buildBatchPreview, getVisibleProductBatches } from '../../utils/productBatches.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

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
  // No special_price_*: the "VIP" tier it backed was deleted on 2026-09-04.
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
  // Both optional: Inventory.tsx passes undefined for whichever the
  // signed-in role's permission tier cannot perform, and an omitted
  // handler removes the button entirely rather than showing one that
  // 403s on click. See utils/permissionActions.ts.
  onAdjust?: ProductAction
  onTransfer?: ProductAction
  onViewHistory?: ProductAction
  onManageBatches?: ProductAction
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  t?: TranslateFn
}

function getBranchStockKey(branchStock: BranchStockEntry, index: number): string {
  return String(branchStock.branch_id ?? `${branchStock.branch_name || 'branch'}-${index}`)
}

export default function ProductDetailModal({ product: p, onClose, onAdjust, onTransfer, onViewHistory, onManageBatches, fmtUSD, fmtKHR, t }: ProductDetailModalProps) {
  const T = (key: string, fallback: string): string => (typeof t === 'function' ? t(key) : fallback) || fallback
  if (!p) return null

  const costPriceUsd = Number(p.purchase_price_usd || p.cost_price_usd || 0)
  const costPriceKhr = Number(p.purchase_price_khr || 0)
  const sellingPriceUsd = Number(p.selling_price_usd || 0)
  const sellingPriceKhr = Number(p.selling_price_khr || 0)
  // The special_price_* ("VIP") tier is deleted by the 2026-09-04 ruling, so
  // there is no longer a second tier that can override the shelf price here.
  // "Active price" is therefore simply the selling price: wholesale is a tier
  // the cashier picks per line at the POS, never the default price of a
  // product, so it must not silently replace the selling price on this panel
  // the way the old special price did.
  const activePriceUsd = sellingPriceUsd
  const activePriceKhr = sellingPriceKhr
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
  // includeEmpty: true -- same "day added" default-batch reasoning as the
  // Products surface detail modal (see utils/productBatches.ts): the full
  // detail view should still surface a fresh product's zero-stock starter
  // batch instead of showing an empty Batches section.
  const visibleBatches = getVisibleProductBatches(p, 'all', { includeEmpty: true })
  const batchPreview = buildBatchPreview(p, 'all', { limit: 8, includeEmpty: true }) as {
    items: ProductBatchEntry[]
    extraCount: number
  }
  const batchCount = visibleBatches.length

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <div className="break-words font-bold text-gray-900 dark:text-white">{p.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {p.sku ? <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-400 dark:bg-gray-700">{p.sku}</span> : null}
              {p.category ? <span className="text-xs text-blue-600 dark:text-blue-400">{p.category}</span> : null}
              {p.unit ? <span className="text-xs text-gray-400">/{p.unit}</span> : null}
              {/* Brand + barcode moved here from their own detail rows below --
                  same text-xs sizing as the rest of this line, so they reuse
                  this row's existing wrap space instead of costing a new
                  row's worth of vertical space every time. */}
              {p.brand ? <span className="text-xs text-gray-400">&middot; {p.brand}</span> : null}
              {p.barcode ? <span className="shrink-0 whitespace-nowrap font-mono text-xs text-gray-400">&middot; {p.barcode}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={T('close', 'Close')}><X className="h-4 w-4" /></button>
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
            <div className="grid grid-cols-2 gap-2 pt-1 text-center">
              {[
                { label: T('low_stock_threshold', 'Low stock threshold'), value: `${lowStockThreshold} ${p.unit || ''}` },
                { label: T('batches', 'Batches'), value: String(batchCount || 0) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-white/80 px-2 py-1.5 dark:bg-slate-800/60">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{item.value}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-gray-400">{item.label}</div>
                </div>
              ))}
            </div>
            {onViewHistory ? (
              <button
                type="button"
                onClick={() => onViewHistory(p)}
                className="mt-2 flex w-full items-center justify-between rounded-lg bg-white/80 px-2.5 py-1.5 text-left text-xs text-gray-500 transition-colors hover:bg-white hover:text-gray-700 dark:bg-slate-800/60 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-200"
              >
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {T('view_stock_history', 'View stock history (in, out, sales, returns, imports...)')}
                </span>
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
              </button>
            ) : null}
          </div>

          <div className="space-y-3">
            {/* Fixed at two columns now that the third tile (the "Special
                Price" / VIP tier) is deleted by the 2026-09-04 ruling -- the
                grid used to widen to three whenever that tier had a value. */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
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
              {/* The "Special Price" tile is deleted (2026-09-04 ruling): that
                  tier was the wholesale price under the wrong name, migration
                  0111 moved its values to wholesale_price_*, and this inventory
                  panel is a cost/stock view that never carried wholesale. */}
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-center sm:gap-2">
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
              // Brand + barcode now live in the header row next to the
              // category/unit line -- kept out of this list to avoid
              // showing them twice.
              [T('label_sku', 'SKU'), p.sku],
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
                      <span className="font-semibold text-amber-700 dark:text-amber-200">{batchDisplayLabel({ id: batch.id ?? batch.batch_id ?? `b-${index}`, lot_code: batch.lot_code ?? null, received_at: (batch.received_at as string) ?? null, batch_number: (batch.batch_number as number) ?? null }, T('batch', 'Batch'))}</span>
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

        {/* Icon + label at sm: and up, icon-only (label visually hidden,
            kept for screen readers via aria-label + a title tooltip) below
            sm -- same "Product detail-view button layout" convention
            Products' own ProductDetailModal.tsx already uses (Parts
            227/241/244), brought here to close the "every other sheet/page
            ... still open" half of that backlog item (Part 245's
            writeup). Adjust Stock's icon switched from plain text to
            SlidersHorizontal per that item's explicit "needs a better/more
            literal 'adjust' icon" ask -- same icon Products' own detail
            modal uses for the same action, so the two pages read
            consistently. */}
        <div className="grid grid-cols-2 flex-shrink-0 gap-1.5 border-t border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-4 sm:gap-2">
          {onAdjust ? (
            <button
              type="button"
              onClick={() => { onClose(); onAdjust(p) }}
              className="btn-primary flex w-full items-center justify-center gap-1.5 truncate px-1 py-2.5 text-xs leading-tight sm:text-sm"
              aria-label={T('adjust_stock', 'Adjust Stock')}
              title={T('adjust_stock', 'Adjust Stock')}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden truncate sm:inline">{T('adjust_stock', 'Adjust Stock')}</span>
            </button>
          ) : null}
          {onTransfer ? (
            <button
              type="button"
              onClick={() => { onClose(); onTransfer(p) }}
              className="btn-secondary flex w-full items-center justify-center gap-1.5 truncate px-1 py-2.5 text-xs leading-tight sm:text-sm"
              aria-label={T('transfer', 'Transfer')}
              title={T('transfer', 'Transfer')}
            >
              <ArrowRightLeft className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden truncate sm:inline">{T('transfer', 'Transfer')}</span>
            </button>
          ) : null}
          {onManageBatches ? (
            <button
              type="button"
              onClick={() => { onClose(); onManageBatches(p) }}
              className="btn-secondary flex w-full items-center justify-center gap-1.5 truncate px-1 py-2.5 text-xs leading-tight sm:text-sm"
              aria-label={T('manage_batches', 'Manage Batches')}
              title={T('manage_batches', 'Manage Batches')}
            >
              <Layers className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden truncate sm:inline">{T('manage_batches', 'Manage Batches')}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
