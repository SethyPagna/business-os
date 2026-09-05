import { Fragment, useMemo } from 'react'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import PaginationControls from '../shared/PaginationControls.tsx'

export type InventoryProductRow = Record<string, any> & {
  id?: number | string
  name?: string
  sku?: string
  barcode?: string
  brand?: string
  category?: string
  branch_stock?: Array<Record<string, any>>
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

export function groupInventoryProducts(items: InventoryProductRow[]): Array<{ key: string; label: string; items: InventoryProductRow[] }> {
  const groups = new Map<string, InventoryProductRow[]>()
  for (const item of items) {
    const label = String(item.name || '').trim() || 'Unnamed product'
    const key = label.toLocaleLowerCase()
    groups.set(key, [...(groups.get(key) || []), item])
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, label: String(rows[0]?.name || '').trim() || 'Unnamed product', items: rows }))
}

type Props = InventoryProductsPayload & {
  loading: boolean
  error: string | null
  branchFilter: string
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onOpenDetail: (product: InventoryProductRow) => void
  onOpenInCatalogue: (product: InventoryProductRow) => void
  t: (key: string) => string | undefined
}

export default function InventoryProductsSurface({
  items, total, page, pageSize, loading, error, branchFilter,
  onPageChange, onPageSizeChange, onOpenDetail, onOpenInCatalogue, t,
}: Props) {
  const groups = useMemo(() => groupInventoryProducts(items), [items])
  const columnCount = 5

  return (
    <section aria-label={t('products') || 'Products'} className="space-y-2">
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-xs" style={{ minWidth: 680 }}>
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">{t('product') || 'Product'}</th>
              <th className="px-3 py-2 text-left">{t('sku') || 'SKU'}</th>
              <th className="px-3 py-2 text-left">{t('barcode') || 'Barcode'}</th>
              <th className="px-3 py-2 text-right">{t('quantity') || 'Quantity'}</th>
              <th className="px-3 py-2 text-right">{t('actions') || 'Actions'}</th>
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
                    <td colSpan={columnCount} className="px-3 py-1.5 font-semibold text-slate-600 dark:text-slate-300">{group.label} <span className="ml-1 font-normal text-slate-400">{group.items.length}</span></td>
                  </tr>
                ) : null}
                {group.items.map((product) => (
                  <tr key={String(product.id)} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/60 dark:border-slate-800 dark:hover:bg-blue-900/10" onClick={() => onOpenDetail(product)}>
                    <td className="max-w-[18rem] px-3 py-2"><div className="truncate font-medium text-slate-800 dark:text-slate-100">{product.name || '—'}</div><div className="truncate text-[10px] text-slate-400">{[product.brand, product.category].filter(Boolean).join(' · ')}</div></td>
                    <td className="px-3 py-2 font-mono text-slate-500">{product.sku || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{product.barcode || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{scopedProductQuantity(product, branchFilter)}</td>
                    <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}><button type="button" className="inline-flex items-center gap-1 text-primary-600 hover:underline" onClick={() => onOpenInCatalogue(product)}>{t('view_details') || 'View details'} <ExternalLink className="h-3.5 w-3.5" /></button></td>
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
              : groups.flatMap((group) => group.items.map((product) => (
                <button key={String(product.id)} type="button" className="card flex w-full items-start justify-between gap-3 p-3 text-left" onClick={() => onOpenDetail(product)}>
                  <span className="min-w-0"><span className="block truncate font-medium">{product.name || '—'}</span><span className="block truncate text-[11px] text-slate-400">{[product.sku, product.barcode].filter(Boolean).join(' · ') || '—'}</span></span>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-sm font-semibold dark:bg-slate-800">{scopedProductQuantity(product, branchFilter)}</span>
                </button>
              )))}
      </div>

      <div className="flex justify-center">
        <PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={total} label={t('products') || 'products'} t={t} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      </div>
    </section>
  )
}
