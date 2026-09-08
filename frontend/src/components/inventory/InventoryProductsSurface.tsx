import { Fragment, useMemo, useState } from 'react'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import PaginationControls from '../shared/PaginationControls.tsx'
import { buildProductGroups } from '../../utils/productGrouping.ts'

export type InventoryProductRow = Record<string, any> & {
  id?: number | string
  name?: string
  // No `sku` on purpose (N10): SKU is a product-detail field (ProductDetailModal,
  // the product row's detail pills). This table was the app's ONLY SKU column,
  // so it was removed rather than kept as a one-off. Barcode stays -- it is the
  // identifier people scan and read off a shelf.
  barcode?: string
  brand?: string
  category?: string
  branch_stock?: Array<Record<string, any>>
  display_quantity?: number | null
  stock_value_usd?: number | null
  stock_value_khr?: number | null
  qty_sold?: number | null
  revenue_usd?: number | null
  revenue_khr?: number | null
  cogs_usd?: number | null
  cogs_khr?: number | null
  profit_usd?: number | null
}

export type InventoryProductsPayload = {
  items: InventoryProductRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function normalizeInventoryProductsResponse(value: unknown, fallbackPage: number, fallbackPageSize: number): InventoryProductsPayload {
  const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const items = Array.isArray(payload.items) ? payload.items as InventoryProductRow[] : []
  const total = Math.max(0, Number(payload.total) || 0)
  const pageSize = Math.max(1, Number(payload.pageSize) || fallbackPageSize)
  const totalPages = Math.max(1, Number(payload.totalPages) || Math.ceil(total / pageSize) || 1)
  const page = Math.min(totalPages, Math.max(1, Number(payload.page) || fallbackPage))
  return { items, total, page, pageSize, totalPages }
}

export function scopedProductQuantity(product: InventoryProductRow, branchFilter: string): number {
  const stock = Array.isArray(product.branch_stock) ? product.branch_stock : []
  if (branchFilter !== 'all') {
    return Number(stock.find((row) => String(row.branch_id) === String(branchFilter))?.quantity || 0)
  }
  if (stock.length) return stock.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)
  return Number(product.stock_quantity || 0)
}

export function groupInventoryProducts(items: InventoryProductRow[]) {
  const effective = items.map((item) => ({ ...item, cost_price_usd: inventoryCost(item, 'usd'), cost_price_khr: inventoryCost(item, 'khr') }))
  return buildProductGroups(effective, new Map(effective.map((item) => [Number(item.id), item])), { preserveInputOrder: true })
    .map((group) => ({ ...group, label: group.name, items: group.items as InventoryProductRow[], rows: group.rows as InventoryProductRow[] }))
}

export function inventoryMoney(value: unknown): number | null {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

type InventoryMetric = 'display_quantity' | 'stock_value_usd' | 'stock_value_khr' | 'qty_sold' | 'revenue_usd' | 'revenue_khr' | 'cogs_usd' | 'cogs_khr' | 'profit_usd'

/** Merge server-scoped real rows, not the canonical display row's inherited lead metrics. */
export function mergedInventoryMetric(product: InventoryProductRow, items: InventoryProductRow[], field: InventoryMetric): number | null {
  const ids = new Set<number>((product.__mergedProductIds || [product.id]).map(Number))
  const byId = new Map(items.map((item) => [Number(item.id), item]))
  let total = 0
  for (const id of ids) {
    const value = inventoryMoney(byId.get(id)?.[field])
    if (value === null) return null
    total += value
  }
  return ids.size ? total : null
}

export function inventoryCost(product: InventoryProductRow, currency: 'usd' | 'khr'): number | null {
  if (product.__mergedRowCount > 1) return inventoryMoney(product[`cost_price_${currency}`])
  const purchase = inventoryMoney(product[`purchase_price_${currency}`])
  return purchase ? purchase : inventoryMoney(product[`cost_price_${currency}`]) ?? purchase
}

/** Value uses each real row's branch quantity/cost, never the merged display cost. */
export function scopedProductValue(product: InventoryProductRow, items: InventoryProductRow[], branch: string): number | null {
  const ids = new Set((product.__mergedProductIds || [product.id]).map(Number))
  const members = items.filter((row) => ids.has(Number(row.id)))
  let total = 0
  for (const row of members) {
    const quantity = Math.max(0, scopedProductQuantity(row, branch))
    if (!quantity) continue
    const cost = inventoryCost(row, 'usd')
    if (cost === null) return null
    total += quantity * cost
  }
  return members.length ? total : null
}

type Props = InventoryProductsPayload & {
  loading: boolean
  error: string | null
  branchFilter: string
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onOpenDetail: (product: InventoryProductRow) => void
  onOpenInCatalogue: (product: InventoryProductRow) => void
  onAdjust?: (product: InventoryProductRow) => void
  fmtUSD: (value: number) => string
  fmtKHR: (value: number) => string
  serverStats: Record<string, unknown> | null
  statsLoading: boolean
  statsError?: string | null
  t: (key: string) => string | undefined
}

export default function InventoryProductsSurface({
  items, total, page, pageSize, loading, error, branchFilter,
  onPageChange, onPageSizeChange, onOpenDetail, onOpenInCatalogue, onAdjust, fmtUSD, fmtKHR,
  serverStats, statsLoading, statsError, t,
}: Props) {
  const groups = useMemo(() => groupInventoryProducts(items), [items])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setCollapsed((old) => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const columnCount = 11
  const metric = (product: InventoryProductRow, field: InventoryMetric) => mergedInventoryMetric(product, items, field)
  const quantity = (product: InventoryProductRow) => metric(product, 'display_quantity') ?? scopedProductQuantity(product, branchFilter)
  // Money cell shape copied from the Sales list's amount cell: the USD figure
  // is the bold primary line, the KHR equivalent a muted sub-line. `tone`
  // carries the Products page's column convention (cost red, price green,
  // profit blue / yellow on a loss) so the same number means the same thing
  // on every list.
  const money = (usd: unknown, khr?: unknown, tone = 'text-slate-800 dark:text-slate-100') => {
    const u = inventoryMoney(usd), k = inventoryMoney(khr)
    return <span className="block whitespace-nowrap text-right tabular-nums">
      <span className={`block font-semibold ${tone}`}>{u === null ? '—' : fmtUSD(u)}</span>
      {k !== null && k !== 0 ? <span className="block text-[11px] font-normal text-slate-400">{fmtKHR(k)}</span> : null}
    </span>
  }
  // Net sold, Revenue, COGS and Profit are the server's figures, rendered as
  // they come. All FOUR used to disagree with the detail pane opened from this
  // very row -- ProductDetailModal.tsx clamps qty_sold, revenue_usd and
  // cogs_usd with Math.max(0, ...) and derives Profit from the clamped pair,
  // over the SAME row object -- because the Worker's four hand-copied
  // sales-minus-returns joins could emit a negative revenue or COGS, and
  // because the per-product ledger that replaced them subtracted a whole
  // customer return at every branch the sale touched (a sale split across
  // branches reported "Net sold -2" here beside "0" in the pane).
  // cloudflare/src/lib/productSalesLedger.ts now apportions each return over
  // the sale's branch lines -- each column against its own denominator, and
  // units by largest remainder because Net sold below is rendered with no
  // formatting at all -- and makes qty_sold >= 0, revenue_usd >= 0 and
  // cogs_usd >= 0 true by construction. So all four clamps are no-ops and the
  // two surfaces agree cell for cell. That agreement is about the four cells,
  // not about the branch arithmetic behind them: the ledger's own header is
  // where the branch slices are shown to add back up to the unfiltered row,
  // and where the over-refund cases that no scoping rule reaches are named.
  //
  // A negative reaching this line therefore means one thing: the product was
  // genuinely sold below cost. That is real and stays visible (yellow). Do NOT
  // add a floor here -- a wrong negative is a ledger defect to root-cause, and
  // flooring it would hide the next one the way the pane's clamps hid these.
  const profitTone = (value: number | null) => (value !== null && value < 0 ? 'text-yellow-600' : 'text-blue-600 dark:text-blue-400')
  const costTone = 'text-red-700 dark:text-red-400'
  const priceTone = 'text-green-700 dark:text-green-400'
  const branchLines = (product: InventoryProductRow) => (product.branch_stock || [])
    .filter((row) => branchFilter === 'all' || String(row.branch_id) === branchFilter)
    .map((row) => <div key={String(row.branch_id)} className="break-words">{row.branch_name || row.branch_id}: <span className="font-semibold">{Number(row.quantity) || 0}</span></div>)
  const mobileActions = (product: InventoryProductRow) => {
    const ids = new Set((product.__mergedProductIds || [product.id]).map(Number))
    const members = items.filter((row) => ids.has(Number(row.id)))
    const buttons = members.map((row) => <div key={String(row.id)} className="flex flex-wrap items-center gap-2">
      {members.length > 1 ? <span className="text-[11px]">#{row.id}</span> : null}
      <button type="button" className="min-h-11 text-primary-600 hover:underline" onClick={() => onOpenDetail(row)}>{t('view_details') || 'View details'}</button>
      {onAdjust ? <button type="button" className="min-h-11 text-primary-600 hover:underline" onClick={() => onAdjust(row)}>{t('adjust_stock') || 'Adjust stock'}</button> : null}
    </div>)
    return <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
      {members.length > 1 ? <details><summary className="min-h-11 cursor-pointer py-2">{t('view_details') || 'View details'} ({members.length})</summary>{buttons}</details> : buttons}
      <button type="button" className="inline-flex min-h-11 items-center gap-1 text-primary-600" onClick={() => onOpenInCatalogue(product)}>{t('products') || 'Products'} <ExternalLink className="h-3.5 w-3.5" /></button>
    </div>
  }
  // Desktop keeps every action in the product cell instead of reserving a
  // sparse Actions column. Merged rows still expose each original member so
  // View details and Adjust retain their real-record targets.
  const productMenu = (product: InventoryProductRow) => {
    const ids = new Set((product.__mergedProductIds || [product.id]).map(Number))
    const members = items.filter((row) => ids.has(Number(row.id)))
    return <details data-inventory-product-menu="" className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
      <summary className="inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-1 text-slate-500 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800" aria-label={`${t('actions') || 'Actions'}: ${product.name || t('product') || 'Product'}`}>
        <span aria-hidden="true">⋯</span><span className="sr-only">{t('actions') || 'Actions'}</span>
      </summary>
      <div className="absolute z-10 mt-1 min-w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        {members.map((row) => <div key={String(row.id)} className="flex flex-col border-b border-slate-100 py-0.5 last:border-0 dark:border-slate-800">
          {members.length > 1 ? <span className="px-2 text-[11px] text-slate-500">#{row.id}</span> : null}
          <button type="button" className="min-h-8 px-2 text-left text-xs text-primary-600 hover:underline" onClick={() => onOpenDetail(row)}>{t('view_details') || 'View details'}</button>
          {onAdjust ? <button type="button" className="min-h-8 px-2 text-left text-xs text-primary-600 hover:underline" onClick={() => onAdjust(row)}>{t('adjust_stock') || 'Adjust stock'}</button> : null}
        </div>)}
        <button type="button" className="inline-flex min-h-8 w-full items-center gap-1 px-2 text-left text-xs text-primary-600 hover:underline" onClick={() => onOpenInCatalogue(product)}>{t('products') || 'Products'} <ExternalLink className="h-3.5 w-3.5" /></button>
      </div>
    </details>
  }
  const summaryFields = [['total_products', 'products'], ['in_stock', 'in_stock'], ['low_stock', 'low_stock'], ['out_of_stock', 'out_of_stock'], ['stock_value_usd', 'stock_val']] as const

  return (
    <section aria-label={t('products') || 'Products'} className="min-w-0 max-w-full space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700" aria-busy={statsLoading}>
        {summaryFields.map(([field, label]) => <div key={field}>{t(label) || label}: <strong>{statsLoading ? '…' : inventoryMoney(serverStats?.[field]) === null ? '—' : field === 'stock_value_usd' ? fmtUSD(Number(serverStats?.[field])) : Number(serverStats?.[field])}</strong></div>)}
      </div>
      {statsError ? <p role="alert" className="text-xs text-red-600">{statsError}</p> : null}
      <div className="card hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-xs" style={{ minWidth: 680 }}>
          {/* Header weight and the red/green column tints match
              ProductsListSurface / SalesListSurface exactly -- this table used
              to be the one dense list with unweighted, uncoloured headers. */}
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
            <tr>
              <th className="px-3 py-1.5 text-left">{t('product') || 'Product'}</th>
              <th className="px-3 py-1.5 text-left">{t('barcode') || 'Barcode'}</th>
              <th className="px-3 py-1.5 text-right">{t('quantity') || 'Quantity'}</th>
              <th className="px-3 py-1.5 text-left">{t('branches') || 'Branches'}</th>
              <th className="col-highlight-red px-3 py-1.5 text-right text-red-600 dark:text-red-400">{t('cost') || 'Cost'}</th>
              <th className="col-highlight-green px-3 py-1.5 text-right text-green-600 dark:text-green-400">{t('price') || 'Price'}</th>
              <th className="px-3 py-1.5 text-right">{t('stock_val') || 'Stock value'}</th>
              <th className="px-3 py-1.5 text-right">{t('net_sold') || 'Net sold'}</th>
              <th className="px-3 py-1.5 text-right">{t('revenue') || 'Revenue'}</th>
              <th className="px-3 py-1.5 text-right">{t('cogs') || 'COGS'}</th>
              <th className="px-3 py-1.5 text-right text-blue-600 dark:text-blue-400">{t('profit') || 'Profit'}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }, (_, index) => <tr key={index}><td colSpan={columnCount} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /></td></tr>)
            ) : error ? (
              <tr><td colSpan={columnCount} className="px-3 py-10 text-center text-red-600">{error}</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={columnCount} className="px-3 py-10 text-center text-gray-400">{t('no_data') || 'No data'}</td></tr>
            ) : groups.map((group) => (
              <Fragment key={group.key}>
                {group.items.length > 1 ? (
                  <tr className="border-t border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/50">
                    {/* N36: the group title IS a product name (groupInventoryProducts
                        sets `label: group.name`), so it scrolls like every other
                        name cell. It needs the inner span rather than the class on
                        the button, because this table is neither table-fixed nor
                        colgroup'd: a nowrap block inside `colSpan={columnCount}`
                        would push the whole 680px-min table wider. As a FLEX item
                        the .scroll-x-clean span's `min-width: 0` lets it shrink
                        below its text, so the row keeps its width and the name
                        scrolls inside it. */}
                    <td colSpan={columnCount} className="px-3 py-1.5 font-semibold text-slate-600 dark:text-slate-300"><button type="button" className="flex min-h-11 w-full items-center gap-1 text-left" aria-expanded={!collapsed.has(group.key)} onClick={() => toggle(group.key)}><span className="shrink-0">{collapsed.has(group.key) ? '▸' : '▾'}</span><span className="scroll-x-clean">{group.label}</span><span className="ml-1 shrink-0 font-normal text-slate-400">{group.items.length}</span></button></td>
                  </tr>
                ) : null}
                {!collapsed.has(group.key) && group.rows.map((product) => (
                  <tr key={String(product.id)} className="border-t border-slate-100 hover:bg-blue-50/60 dark:border-slate-800 dark:hover:bg-blue-900/10" onClick={() => { if (product.__mergedProductIds?.length <= 1) onOpenDetail(product) }}>
                    {/* N36: the product NAME scrolls horizontally inside the cell
                        (.scroll-x-clean, the one shared class in styles/main.css)
                        instead of ending in an unreadable ellipsis -- same rule as
                        the Products page and its group titles. The brand/category
                        line under it is derived metadata, not the name, and keeps
                        ordinary truncation. */}
                    <td className="max-w-[18rem] px-3 py-1.5"><div className="flex min-w-0 items-start gap-1"><div className="min-w-0 flex-1"><div className="scroll-x-clean font-medium text-slate-800 dark:text-slate-100">{product.name || '—'}</div><div className="truncate text-[10px] text-slate-400">{[product.brand, product.category].filter(Boolean).join(' · ')}</div></div>{productMenu(product)}</div></td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{product.barcode || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{quantity(product)}</td>
                    <td className="min-w-28 px-3 py-1.5 text-[11px]">{branchLines(product)}</td>
                    <td className="col-highlight-red px-3 py-1.5">{money(inventoryCost(product, 'usd'), inventoryCost(product, 'khr'), costTone)}</td>
                    <td className="col-highlight-green px-3 py-1.5">{money(product.selling_price_usd, product.selling_price_khr, priceTone)}</td>
                    <td className="px-3 py-1.5">{money(metric(product, 'stock_value_usd'), metric(product, 'stock_value_khr'))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{metric(product, 'qty_sold') ?? '—'}</td>
                    <td className="px-3 py-1.5">{money(metric(product, 'revenue_usd'), metric(product, 'revenue_khr'))}</td>
                    <td className="px-3 py-1.5">{money(metric(product, 'cogs_usd'), metric(product, 'cogs_khr'))}</td>
                    <td className="px-3 py-1.5">{money(metric(product, 'profit_usd'), null, profitTone(metric(product, 'profit_usd')))}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className="card h-20 animate-pulse bg-slate-100 dark:bg-slate-800" />)
          : error ? <div className="card p-6 text-center text-sm text-red-600">{error}</div>
            : groups.length === 0 ? <div className="card p-6 text-center text-sm text-gray-400">{t('no_data') || 'No data'}</div>
              : groups.map((group) => <div key={group.key} className="min-w-0 space-y-1">
                {/* N36: same group-title rule as this surface's desktop table
                    above -- the label is the product name, so it scrolls in place
                    instead of wrapping to a second row. min-h-11 stays: it is the
                    44px touch target, not a wrapping affordance. */}
                {group.items.length > 1 ? <button type="button" className="min-h-11 w-full scroll-x-clean text-left text-sm font-semibold" aria-expanded={!collapsed.has(group.key)} onClick={() => toggle(group.key)}>{collapsed.has(group.key) ? '▸' : '▾'} {group.label} ({group.items.length})</button> : null}
                {!collapsed.has(group.key) && group.rows.map((product) => <div key={String(product.id)} className="card min-w-0 p-2 text-sm">
                  {/* N36: same shared class as this surface's desktop row above. */}
                  <div className="flex min-w-0 items-start justify-between gap-2"><span className="scroll-x-clean font-medium">{product.name || '—'}</span><strong>{quantity(product)}</strong></div>
                  {/* Barcode only -- the SKU half of this line went with the column. */}
                  <p className="break-all text-[11px] text-slate-500">{product.barcode || '—'}</p>
                  <div className="my-1 text-xs">{branchLines(product)}</div>
                  {/* Same colour language as the desktop columns, so a value
                      does not change meaning when the layout does. */}
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                    <dt className="text-red-600 dark:text-red-400">{t('cost') || 'Cost'}</dt><dd>{money(inventoryCost(product, 'usd'), inventoryCost(product, 'khr'), costTone)}</dd>
                    <dt className="text-green-600 dark:text-green-400">{t('price') || 'Price'}</dt><dd>{money(product.selling_price_usd, product.selling_price_khr, priceTone)}</dd>
                    <dt>{t('stock_val') || 'Stock value'}</dt><dd>{money(metric(product, 'stock_value_usd'), metric(product, 'stock_value_khr'))}</dd>
                    <dt>{t('net_sold') || 'Net sold'}</dt><dd className="text-right font-semibold tabular-nums">{metric(product, 'qty_sold') ?? '—'}</dd>
                    <dt>{t('revenue') || 'Revenue'}</dt><dd>{money(metric(product, 'revenue_usd'), metric(product, 'revenue_khr'))}</dd>
                    <dt>{t('cogs') || 'COGS'}</dt><dd>{money(metric(product, 'cogs_usd'), metric(product, 'cogs_khr'))}</dd>
                    <dt className="text-blue-600 dark:text-blue-400">{t('profit') || 'Profit'}</dt><dd>{money(metric(product, 'profit_usd'), null, profitTone(metric(product, 'profit_usd')))}</dd>
                  </dl>
                  {mobileActions(product)}
                </div>)}
              </div>)}
      </div>

      <div className="flex justify-center">
        <PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={total} label={t('products') || 'products'} t={t} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      </div>
    </section>
  )
}
