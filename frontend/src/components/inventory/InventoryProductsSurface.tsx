import { useEffect, useRef, useState } from 'react'
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js'
import PackageSearch from 'lucide-react/dist/esm/icons/package-search.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import TruncatedText from '../shared/TruncatedText.tsx'
import ColumnChooser from '../shared/ColumnChooser.tsx'
import { useColumnPreferences } from '../shared/useColumnPreferences.ts'
import type { TableColumnDef } from '../shared/columnPreferences.ts'
import PaginationControls from '../shared/PaginationControls.tsx'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import { stockHealthColour } from './stockHealthSummary.ts'

type AnyRecord = Record<string, any>
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string
type MoneyFormatter = (value: number) => string

// The Branches hub's own per-branch stock breakdown -- a lightweight FLOAT
// (absolute-positioned popover, not a modal, not a row that pushes its
// siblings down) triggered from the row's Stock cell. It answers "how much
// at each branch" without leaving the products list; batch/lot detail and
// every mutation still open the SAME shared modals the Movements section
// already uses (ManageBatchesModal / InventoryStockModals / ProductDetailModal),
// so there is exactly one adjust/transfer/batches implementation in the app.
const PRODUCTS_OPTIONAL_COLUMNS: TableColumnDef[] = [
  { key: 'category', label: 'Category' },
  { key: 'brand', label: 'Brand' },
  { key: 'unit', label: 'Unit' },
  { key: 'stock_value', label: 'Stock value' },
  { key: 'cost', label: 'Cost', defaultVisible: false },
  { key: 'updated', label: 'Last updated', defaultVisible: false },
]

interface InventoryProductsSurfaceProps {
  items: AnyRecord[]
  loading: boolean
  error: string | null
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  branchFilter: string
  getBranchLabel: (branchId: unknown, fallback?: string) => string
  getStockQty: (product?: AnyRecord | null) => number
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  fmtTime: (value?: string) => string
  canAdjustStock: boolean
  canTransferStock: boolean
  isAdmin: boolean
  selectMode: boolean
  onToggleSelectMode: () => void
  selectedIds: Set<number | string>
  onToggleSelected: (id: number | string) => void
  onToggleSelectAll: (checked: boolean) => void
  onOpenDetail: (product: AnyRecord) => void
  onAdjust: (product: AnyRecord) => void
  onTransfer: (product: AnyRecord) => void
  onManageBatches: (product: AnyRecord) => void
  onViewHistory: (product: AnyRecord) => void
  /** Catalogue editing (name/price/images/description) stays on the Products
   * page -- this branch-stock workspace only links out to it, it never
   * duplicates the edit form. Optional so a caller without navigation just
   * omits the menu entry. */
  onOpenInCatalogue?: (product: AnyRecord) => void
  t: Translator
  tr: TranslationWithFallback
}

function branchStockOf(product: AnyRecord): AnyRecord[] {
  return Array.isArray(product?.branch_stock) ? product.branch_stock : []
}

// Branch-scoped quantity reads straight off this row's own `branch_stock`
// array (always present from /api/inventory/products/search -- see
// searchProductsPayload's branch_stock_json) rather than the shared
// getStockQty helper, which only resolves correctly for a product opened
// through the Movements detail flow (display_quantity is a /summary-only
// field, never present on a search result row).
function totalStockOf(product: AnyRecord, branchFilter: string, getStockQty: (p?: AnyRecord | null) => number): number {
  const rows = branchStockOf(product)
  if (branchFilter !== 'all') {
    if (rows.length) return Number(rows.find((row) => String(row?.branch_id) === String(branchFilter))?.quantity || 0)
    return getStockQty(product)
  }
  if (rows.length) return rows.reduce((sum, row) => sum + (Number(row?.quantity) || 0), 0)
  return Number(product?.stock_quantity || 0)
}

function healthKeyOf(product: AnyRecord, qty: number): 'healthy' | 'low' | 'out' {
  const outThreshold = Number(product?.out_of_stock_threshold || 0)
  const lowThreshold = Number(product?.low_stock_threshold || 10)
  if (qty <= outThreshold) return 'out'
  if (qty <= lowThreshold) return 'low'
  return 'healthy'
}

export default function InventoryProductsSurface({
  items,
  loading,
  error,
  page,
  pageSize,
  total,
  totalPages: _totalPages,
  onPageChange,
  onPageSizeChange,
  branchFilter,
  getBranchLabel,
  getStockQty,
  fmtUSD,
  fmtTime,
  canAdjustStock,
  canTransferStock,
  isAdmin,
  selectMode,
  onToggleSelectMode,
  selectedIds,
  onToggleSelected,
  onToggleSelectAll,
  onOpenDetail,
  onAdjust,
  onTransfer,
  onManageBatches,
  onViewHistory,
  onOpenInCatalogue,
  t,
  tr,
}: InventoryProductsSurfaceProps) {
  const cols = useColumnPreferences('inventory-products', PRODUCTS_OPTIONAL_COLUMNS)
  const chooserColumns = PRODUCTS_OPTIONAL_COLUMNS.map((column) => ({ ...column, label: t(column.key) || column.label }))
  const [stockPopoverId, setStockPopoverId] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!stockPopoverId) return
    const onDocClick = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setStockPopoverId(null)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setStockPopoverId(null) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [stockPopoverId])

  useEffect(() => {
    if (!selectAllRef.current) return
    const allIds = items.map((item) => item.id)
    const selectedCount = allIds.filter((id) => selectedIds.has(id)).length
    selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < allIds.length
  }, [items, selectedIds])

  const columnCount = 4 + cols.visibleCount + (selectMode ? 1 : 0)
  const skeletonRows = Array.from({ length: 6 }, (_, index) => index)

  const rowActions = (product: AnyRecord): PortalMenuItem[] => ([
    { label: tr('view_details', 'View details'), onClick: () => onOpenDetail(product), icon: <Eye className="h-4 w-4 shrink-0" /> },
    canAdjustStock ? { label: tr('adjust', 'Adjust'), onClick: () => onAdjust(product), icon: <SlidersHorizontal className="h-4 w-4 shrink-0" /> } : null,
    canTransferStock ? { label: tr('stock_transfer', 'Transfer'), onClick: () => onTransfer(product), color: 'violet' as const, icon: <PackageSearch className="h-4 w-4 shrink-0" /> } : null,
    { label: tr('manage_batches', 'Manage batches'), onClick: () => onManageBatches(product), icon: <Layers className="h-4 w-4 shrink-0" /> },
    { label: tr('view_stock_history', 'View stock history'), onClick: () => onViewHistory(product) },
    onOpenInCatalogue ? 'divider' : null,
    onOpenInCatalogue ? { label: tr('open_in_products', 'Open in Products catalogue'), onClick: () => onOpenInCatalogue(product) } : null,
  ].filter(Boolean) as PortalMenuItem[])

  const StockCell = ({ product }: { product: AnyRecord }) => {
    const qty = totalStockOf(product, branchFilter, getStockQty)
    const health = healthKeyOf(product, qty)
    const rows = branchStockOf(product)
    const isOpen = stockPopoverId === String(product.id)
    return (
      <div className="relative inline-block">
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 ${stockHealthColour(health)}`}
          onClick={(event) => { event.stopPropagation(); setStockPopoverId(isOpen ? null : String(product.id)) }}
          title={tr('view_branch_stock', 'View branch stock')}
        >
          {qty}
        </button>
        {isOpen ? (
          <div
            ref={popoverRef}
            // Floats ABOVE the surrounding rows (absolute + z-40) -- it never
            // pushes content down, matching every other expansion in this app.
            className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-2 text-left text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-1 font-semibold text-gray-700 dark:text-gray-200">{tr('branch_stock', 'Branch stock')}</div>
            {rows.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {rows.map((row) => (
                  <li key={String(row.branch_id)} className="flex items-center justify-between gap-2">
                    <span className="truncate text-gray-600 dark:text-gray-300">{row.branch_name || getBranchLabel(row.branch_id)}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-100">{Number(row.quantity || 0)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400">{t('no_data') || 'No data'}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-100 pt-1.5 dark:border-gray-700">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {tr('batches', 'Batches')}: {Number(product.batch_count || 0)}
              </span>
              <button type="button" className="text-[10px] font-medium text-primary-600 hover:underline" onClick={() => { setStockPopoverId(null); onManageBatches(product) }}>
                {tr('manage_batches', 'Manage batches')}
              </button>
              {canAdjustStock ? (
                <button type="button" className="text-[10px] font-medium text-primary-600 hover:underline" onClick={() => { setStockPopoverId(null); onAdjust(product) }}>
                  {tr('adjust', 'Adjust')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div className="card hidden overflow-visible md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 760 }}>
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                {selectMode ? (
                  <th className="w-10 px-3 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={items.length > 0 && items.every((item) => selectedIds.has(item.id))}
                      onChange={(event) => onToggleSelectAll(event.target.checked)}
                      aria-label={tr('select_all', 'Select all')}
                    />
                  </th>
                ) : null}
                <th className="px-3 py-2 text-left font-semibold">{t('product') || 'Product'}</th>
                {cols.isVisible('category') ? <th className="hidden px-3 py-2 text-left font-semibold md:table-cell">{t('category')}</th> : null}
                {cols.isVisible('brand') ? <th className="hidden px-3 py-2 text-left font-semibold md:table-cell">{t('brand')}</th> : null}
                {cols.isVisible('unit') ? <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">{t('unit')}</th> : null}
                <th className="px-3 py-2 text-center font-semibold">{tr('stock', 'Stock')}</th>
                <th className="px-3 py-2 text-center font-semibold">{tr('batches', 'Batches')}</th>
                {cols.isVisible('stock_value') ? <th className="hidden px-3 py-2 text-right font-semibold lg:table-cell">{tr('stock_value', 'Stock value')}</th> : null}
                {isAdmin && cols.isVisible('cost') ? <th className="hidden px-3 py-2 text-right font-semibold lg:table-cell">{t('cost')}</th> : null}
                {cols.isVisible('updated') ? <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">{tr('last_updated', 'Last updated')}</th> : null}
                <th className="px-3 py-2 text-right font-semibold">{t('actions') || 'Actions'}</th>
                <th className="hidden w-10 px-1 py-2 text-right lg:table-cell">
                  <ColumnChooser columns={chooserColumns} isVisible={cols.isVisible} toggle={cols.toggle} reset={cols.reset} label={t('columns') || 'Columns'} resetLabel={t('reset') || 'Reset'} />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                skeletonRows.map((row) => (
                  <tr key={`product-skeleton-${row}`} className="animate-pulse">
                    <td colSpan={columnCount} className="px-4 py-3"><div className="h-4 w-full max-w-md rounded bg-slate-200 dark:bg-slate-700" /></td>
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={columnCount} className="py-10 text-center text-red-500">{error}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={columnCount} className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</td></tr>
              ) : items.map((product) => {
                const stockValue = Number(product.selling_price_usd || 0) * totalStockOf(product, branchFilter, getStockQty)
                return (
                  <tr
                    key={String(product.id)}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
                    onClick={() => onOpenDetail(product)}
                  >
                    {selectMode ? (
                      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={selectedIds.has(product.id)}
                          onChange={() => onToggleSelected(product.id)}
                          aria-label={tr('select_row', 'Select row')}
                        />
                      </td>
                    ) : null}
                    <td className="max-w-[16rem] px-3 py-2">
                      <TruncatedText text={String(product.name || '')} className="font-medium text-gray-800 dark:text-gray-100" />
                      <div className="mt-0.5 text-[10px] text-gray-400">
                        {[product.sku, product.barcode].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    {cols.isVisible('category') ? <td className="hidden px-3 py-2 text-gray-600 dark:text-gray-300 md:table-cell">{product.category || '—'}</td> : null}
                    {cols.isVisible('brand') ? <td className="hidden px-3 py-2 text-gray-600 dark:text-gray-300 md:table-cell">{product.brand || '—'}</td> : null}
                    {cols.isVisible('unit') ? <td className="hidden px-3 py-2 text-gray-500 lg:table-cell">{product.unit || '—'}</td> : null}
                    <td className="px-3 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <StockCell product={product} />
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-300">{Number(product.batch_count || 0)}</td>
                    {cols.isVisible('stock_value') ? <td className="hidden px-3 py-2 text-right text-gray-600 dark:text-gray-300 lg:table-cell">{fmtUSD(stockValue)}</td> : null}
                    {isAdmin && cols.isVisible('cost') ? <td className="hidden px-3 py-2 text-right text-gray-600 dark:text-gray-300 lg:table-cell">{fmtUSD(Number(product.cost_price_usd || product.purchase_price_usd || 0))}</td> : null}
                    {cols.isVisible('updated') ? <td className="hidden px-3 py-2 text-gray-500 lg:table-cell">{fmtTime(product.updated_at)}</td> : null}
                    <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                      <LazyPortalMenu
                        align="auto"
                        trigger={(
                          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label={t('actions') || 'Actions'}>
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        )}
                        items={rowActions(product)}
                      />
                    </td>
                    <td className="hidden lg:table-cell" />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards -- excel-style table is a large-screen convention only;
          below md every list surface in this app falls back to cards. */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          Array.from({ length: 4 }, (_, index) => (
            <div key={`product-mcard-skeleton-${index}`} className="card animate-pulse p-3"><div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" /></div>
          ))
        ) : items.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">{error || t('no_data') || 'No data'}</div>
        ) : items.map((product) => {
          const qty = totalStockOf(product, branchFilter, getStockQty)
          const health = healthKeyOf(product, qty)
          return (
            <div key={String(product.id)} className="card p-3" onClick={() => onOpenDetail(product)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <TruncatedText text={String(product.name || '')} className="font-medium text-gray-800 dark:text-gray-100" />
                  <div className="mt-0.5 text-[10px] text-gray-400">{[product.sku, product.barcode].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold ${stockHealthColour(health)}`}>{qty}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                <span>{tr('batches', 'Batches')}: {Number(product.batch_count || 0)}</span>
                <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  {canAdjustStock ? <button type="button" className="font-medium text-primary-600" onClick={() => onAdjust(product)}>{tr('adjust', 'Adjust')}</button> : null}
                  {canTransferStock ? <button type="button" className="font-medium text-primary-600" onClick={() => onTransfer(product)}>{tr('stock_transfer', 'Transfer')}</button> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {!selectMode ? (
          <button type="button" className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" onClick={onToggleSelectMode}>
            {tr('select', 'Select')}
          </button>
        ) : (
          <button type="button" className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" onClick={onToggleSelectMode}>
            {t('cancel') || 'Cancel'} ({selectedIds.size})
          </button>
        )}
        <PaginationControls
          page={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          t={t}
          compact
          className="flex-1 justify-end"
        />
      </div>
    </>
  )
}
