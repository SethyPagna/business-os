import { Fragment, type RefObject } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import StatusBadge from './StatusBadge.tsx'
import { consumeLongPressClick, createLongPressHandlers, type LongPressState } from '../../utils/longPress.ts'
import ColumnChooser from '../shared/ColumnChooser.tsx'
import { useColumnPreferences } from '../shared/useColumnPreferences.ts'
import { resolveDriverLabel } from '../../utils/salesDriverLabel.ts'
import { SALES_COLUMNS_SURFACE_KEY, SALES_OPTIONAL_COLUMNS } from './salesListColumns.ts'
import { saleRecordsCount } from '../../utils/saleRecords.ts'

type TranslateFn = (key: string) => string
type MoneyFormatter = (value: number | string) => string

interface SaleItem {
  id?: number | string
  product_id?: number | string
  quantity?: number | string
}

interface SaleRecord {
  id: number | string
  receipt_number?: string
  created_at?: string
  sale_status?: string
  cashier_name?: string
  payment_method?: string
  total_usd?: number
  total?: number
  total_khr?: number
  items?: SaleItem[] | string | null
  // Y17: the customer column folds name + phone into one cell; the full
  // membership/address detail opens in SaleDetailModal on row click.
  customer_name?: string
  customer_phone?: string
  // N9: resolved server-side (delivery_contact_name falls back to the
  // linked driver's live name in GET /sales) -- see utils/salesDriverLabel.ts.
  linked_driver_name?: string | null
  delivery_contact_name?: string | null
  // N41: how many RECORDS this sale has -- every change anybody ever made to
  // it, unioned server-side from the amendment ledger, audit_logs, the bulk
  // operation receipts and the sale's own creation. GET /api/sales delivers it
  // with the page (one statement per chunk, never a query per row). Never 0
  // for a real sale: being rung up is itself the first record, so a missing
  // value means "the server did not say", not "nothing ever happened".
  records_count?: number | string | null
}

interface SalesGroup {
  id: string
  label: string
  ids: number[]
  items: SaleRecord[]
}

interface SalesSection {
  id: string
  label: string
  ids: number[]
  items: SaleRecord[]
  groups: SalesGroup[]
}

interface SalesListSurfaceProps {
  collapsedSalesSections: Set<string>
  filtered: SaleRecord[]
  filteredIds: number[]
  fmtKHR: MoneyFormatter
  fmtTime: (value?: string) => string
  fmtUSD: MoneyFormatter
  getSaleBranchLabel: (sale: SaleRecord) => string
  isSelectionScopeFullySelected: (ids: number[]) => boolean
  isSelectionScopePartiallySelected: (ids: number[]) => boolean
  loading: boolean
  revenue: number
  /** Count of sales that contribute to `revenue` — every sale in the window
   * except a cancelled one, matching the kernel's `recognizedExpr`. A credit
   * sale is IN, because it is inside `revenue` too. This contract used to
   * claim the credit cohort was left out, which described neither
   * `isRevenueCountedSale` nor GET /api/sales/stats. */
  revenueCount: number
  /** How much of `revenue` is still owed: the credit annotation (owner,
   * Sep 6 2026). Printed POSITIVE beside the revenue, never with a minus and
   * never as a deduction — these rows are already inside `revenue`. */
  creditUsd: number
  /** Predicate: does this sale count toward the money shown? Used to make the
   * day-group header counts money-counting too, so they sum to the footer. */
  isCountedSale: (sale: SaleRecord) => boolean
  salesSections: SalesSection[]
  selectAllRef: RefObject<HTMLInputElement>
  selectedIds: Set<number>
  // 11.1/11.2 (B6), same selection model as Products/Inventory: checkboxes
  // and the select column only exist while something IS selected; enter
  // select mode by long-pressing a row (click-and-hold with a mouse). The
  // desktop column-header checkbox is the select-all control.
  selectionModeActive: boolean
  getSaleLongPressState: (rowId: number) => LongPressState
  // N41: open the sale's Records float. Omitted for a viewer who may not read
  // sales history -- the line is then not rendered at all, rather than shown
  // and refused.
  openSaleRecords?: (sale: SaleRecord) => void
  setDetailSale: (sale: SaleRecord) => void
  setSelectedSale: (sale: SaleRecord) => void
  showSalesActionGroups: boolean
  t: TranslateFn
  toggleSalesSection: (sectionId: string) => void
  toggleSelected: (saleId: SaleRecord['id']) => void
  toggleSelectAll: (checked: boolean) => void
  toggleSelectionScope: (ids: number[], checked: boolean) => void
}

function getSaleItems(sale: SaleRecord): SaleItem[] {
  return Array.isArray(sale.items) ? sale.items : []
}

/**
 * N41, the owner's ask verbatim: "i want a row at the bottom of sales each sale
 * rows. one line called Records with total records when press it pops up a
 * float with who made changes in this sales record".
 *
 * ONE implementation, rendered by both layouts -- the desktop table row and the
 * phone card. Two copies of a one-line control is how a surface ends up with
 * the count on one breakpoint and not the other; here the parity is structural
 * rather than remembered.
 *
 * A missing count prints an em dash rather than 0. Zero would be a claim
 * ("nothing ever happened to this sale") that is never true -- being rung up is
 * itself the first record -- so an older cached page must not make it.
 */
function SaleRecordsLine({ sale, t, onOpen }: { sale: SaleRecord; t: TranslateFn; onOpen?: (sale: SaleRecord) => void }) {
  if (!onOpen) return null
  const count = saleRecordsCount(sale)
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onOpen(sale) }}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"
      title={t('records_open') || 'Show who changed this sale'}
    >
      <History className="h-3 w-3" />
      <span>{t('sale_records') || 'Records'}</span>
      <span className="tabular-nums">· {count === null ? '—' : count}</span>
    </button>
  )
}

export default function SalesListSurface({
  collapsedSalesSections,
  filtered,
  filteredIds,
  fmtKHR,
  fmtTime,
  fmtUSD,
  getSaleBranchLabel,
  isSelectionScopeFullySelected,
  isSelectionScopePartiallySelected,
  loading,
  revenue,
  revenueCount,
  creditUsd,
  isCountedSale,
  salesSections,
  selectAllRef,
  selectedIds,
  selectionModeActive,
  getSaleLongPressState,
  openSaleRecords,
  setDetailSale,
  setSelectedSale,
  showSalesActionGroups,
  t,
  toggleSalesSection,
  toggleSelected,
  toggleSelectAll,
  toggleSelectionScope,
}: SalesListSurfaceProps) {
  const skeletonRows = Array.from({ length: 8 }, (_, index) => index)
  const mobileSkeletonCards = Array.from({ length: 4 }, (_, index) => index)
  // 11.1: the checkbox column only takes space in select mode; out of it
  // every first-column cell drops padding/content and auto layout collapses
  // the column.
  const selectCellPad = selectionModeActive ? 'px-3' : 'px-0'
  const cols = useColumnPreferences(SALES_COLUMNS_SURFACE_KEY, SALES_OPTIONAL_COLUMNS)
  const columnCount = 9 + cols.visibleCount
  const chooserColumns = SALES_OPTIONAL_COLUMNS.map((column) => ({ ...column, label: t(column.key) || column.label }))

  return (
    <>
      <div className="card hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 760 }}>
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                <th className={`${selectionModeActive ? 'w-10' : 'w-0'} ${selectCellPad} py-3`}>
                  {selectionModeActive ? (
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={filteredIds.length > 0 && selectedIds.size === filteredIds.length}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                      aria-label="Select all sales"
                    />
                  ) : null}
                </th>
                <th className="px-3 py-2 text-left font-semibold">{t('receipt_number')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('date')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('customer')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('status')}</th>
                {cols.isVisible('cashier') ? <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">{t('cashier')}</th> : null}
                <th className="px-3 py-2 text-left font-semibold">{t('payment_method')}</th>
                {cols.isVisible('branch') ? <th className="hidden px-3 py-2 text-left font-semibold md:table-cell">{t('branch')}</th> : null}
                {cols.isVisible('driver') ? <th className="hidden px-3 py-2 text-left font-semibold md:table-cell">{t('driver')}</th> : null}
                <th className="px-3 py-2 text-right font-semibold">{t('total')}</th>
                {cols.isVisible('items') ? <th className="hidden px-3 py-2 text-center font-semibold md:table-cell">{t('items')}</th> : null}
                <th className="px-3 py-2 text-right font-semibold">{t('actions') || 'Actions'}</th>
                <th className="hidden w-10 px-1 py-2 text-right lg:table-cell">
                  <ColumnChooser columns={chooserColumns} isVisible={cols.isVisible} toggle={cols.toggle} reset={cols.reset} label={t('columns') || 'Columns'} resetLabel={t('reset') || 'Reset'} />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                skeletonRows.map((row) => (
                  <tr key={`sale-skeleton-${row}`} className="animate-pulse">
                    <td className={`${selectCellPad} py-3`} />
                    <td className="px-4 py-3"><div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-20 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
                    {cols.isVisible('cashier') ? <td className="hidden px-4 py-3 lg:table-cell"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td> : null}
                    <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
                    {cols.isVisible('branch') ? <td className="hidden px-4 py-3 md:table-cell"><div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td> : null}
                    {cols.isVisible('driver') ? <td className="hidden px-4 py-3 md:table-cell"><div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td> : null}
                    <td className="px-4 py-3"><div className="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    {cols.isVisible('items') ? <td className="hidden px-4 py-3 md:table-cell"><div className="mx-auto h-4 w-8 rounded bg-slate-200 dark:bg-slate-700" /></td> : null}
                    <td className="px-4 py-3"><div className="mx-auto h-6 w-16 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="hidden lg:table-cell" />
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={columnCount} className="py-10 text-center text-gray-400">{t('no_data')}</td></tr>
              ) : salesSections.map((section) => {
                const isCollapsed = collapsedSalesSections.has(section.id)
                // Money-counting count for the day header (cancelled + awaiting
                // excluded), so the per-day counts sum to the footer total.
                const countedCount = section.items.filter(isCountedSale).length
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                      <td colSpan={columnCount} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <label className="inline-flex min-w-0 items-center gap-2 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                            {selectionModeActive ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded"
                              checked={isSelectionScopeFullySelected(section.ids)}
                              ref={(node) => {
                                if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                              }}
                              onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                              aria-label={`Select ${section.label}`}
                            />
                            ) : null}
                            <span>{section.label}</span>
                            <span className="text-slate-400">{countedCount} sale{countedCount === 1 ? '' : 's'}</span>
                          </label>
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                            onClick={() => toggleSalesSection(section.id)}
                          >
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed ? section.groups.map((group) => (
                      <Fragment key={group.id}>
                        {showSalesActionGroups ? (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/30">
                            <td colSpan={columnCount} className="px-6 py-2">
                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                {selectionModeActive ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isSelectionScopeFullySelected(group.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                                  }}
                                  onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                                  aria-label={`Select ${group.label}`}
                                />
                                ) : null}
                                <span className="font-medium text-slate-600 dark:text-slate-300">{group.label}</span>
                                <span className="text-slate-400">{group.items.length}</span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {group.items.map((sale) => {
                          const items = getSaleItems(sale)
                          const totalUsd = sale.total_usd || sale.total || 0
                          const totalKhr = sale.total_khr || 0
                          const status = sale.sale_status || 'completed'
                          const branchLabel = getSaleBranchLabel(sale)
                          const driverLabel = resolveDriverLabel(sale)
                          const rowSelected = selectedIds.has(Number(sale.id))
                          // Same long-press-to-select-mode pattern as Products/
                          // Inventory rows: out of select mode a plain click
                          // opens the detail and a hold starts selection; in
                          // select mode a plain click toggles.
                          const rowLongPressState = getSaleLongPressState(Number(sale.id))
                          const longPress = createLongPressHandlers(rowLongPressState, {
                            disabled: selectionModeActive,
                            onLongPress: () => toggleSelected(sale.id),
                            onClick: () => setDetailSale(sale),
                          })
                          const handleRowClick = () => {
                            if (consumeLongPressClick(rowLongPressState)) return
                            toggleSelected(sale.id)
                          }
                          return (
                            <Fragment key={sale.id}>
                            <tr
                              className={`table-row cursor-pointer select-none hover:bg-blue-50 dark:hover:bg-blue-900/10 ${rowSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${status === 'cancelled' ? 'opacity-60' : ''}`}
                              onClick={selectionModeActive ? handleRowClick : undefined}
                              {...(selectionModeActive ? {} : longPress)}
                            >
                              <td className={`${selectCellPad} py-1.5`} onClick={(event) => event.stopPropagation()}>
                                {selectionModeActive ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={rowSelected}
                                  onChange={() => toggleSelected(sale.id)}
                                  aria-label={`Select ${sale.receipt_number}`}
                                />
                                ) : null}
                              </td>
                              <td className="max-w-[11rem] px-3 py-1.5">
                                <button type="button" className="block max-w-full truncate font-mono font-semibold text-blue-600 hover:underline dark:text-blue-400" title={sale.receipt_number} onClick={(event) => { event.stopPropagation(); setDetailSale(sale) }}>{sale.receipt_number}</button>
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-gray-500">{fmtTime(sale.created_at)}</td>
                              <td className="px-3 py-1.5">
                                {/* Y17: name + phone folded into one column; the
                                    row click opens the full detail (membership,
                                    address, line items). */}
                                <div className="min-w-0 max-w-[12rem]">
                                  <div className="truncate font-medium text-gray-800 dark:text-gray-200">{sale.customer_name?.trim() || (t('walk_in') || 'Walk-in')}</div>
                                  {sale.customer_phone?.trim() ? <div className="truncate text-xs text-gray-400">{sale.customer_phone}</div> : null}
                                </div>
                              </td>
                              <td className="px-3 py-1.5"><StatusBadge status={status} t={t} /></td>
                              {cols.isVisible('cashier') ? <td className="hidden px-3 py-1.5 text-gray-700 dark:text-gray-300 lg:table-cell">{sale.cashier_name || 'N/A'}</td> : null}
                              <td className="px-3 py-1.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{sale.payment_method || 'N/A'}</span></td>
                              {cols.isVisible('branch') ? <td className="hidden px-3 py-1.5 text-[11px] text-gray-500 md:table-cell">{branchLabel || 'N/A'}</td> : null}
                              {cols.isVisible('driver') ? <td className="hidden px-3 py-1.5 text-[11px] text-gray-500 md:table-cell">{driverLabel || 'N/A'}</td> : null}
                              <td className="px-3 py-1.5 text-right">
                                <div className={`font-semibold ${status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{fmtUSD(totalUsd)}</div>
                                {totalKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                              </td>
                              {cols.isVisible('items') ? <td className="hidden px-3 py-1.5 text-center text-gray-500 md:table-cell">{items.length}</td> : null}
                              <td className="px-2 py-1.5 text-right" onClick={(event) => event.stopPropagation()}>
                                <div className="flex flex-nowrap items-center justify-end gap-0.5">
                                  <button type="button" onClick={() => setDetailSale(sale)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800" aria-label={t('view') || 'View'} title={t('view') || 'View'}><Eye className="h-3.5 w-3.5" /></button>
                                  <button type="button" onClick={() => setSelectedSale(sale)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800" aria-label={t('print') || 'Print'} title={t('print') || 'Print'}><Printer className="h-3.5 w-3.5" /></button>
                                </div>
                              </td>
                              <td className="hidden lg:table-cell" />
                            </tr>
                            {/* The Records line the owner asked for, as its own
                                row UNDER the sale's row -- a table section may
                                only contain rows, so a bare div here would be
                                hoisted out of the table box by the browser.
                                It carries no row-click and no long-press: the
                                only thing on it opens the float. */}
                            {openSaleRecords ? (
                              <tr
                                className={`${rowSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${status === 'cancelled' ? 'opacity-60' : ''}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <td className={`${selectCellPad} pb-1.5`} />
                                <td colSpan={columnCount - 1} className="px-3 pb-1.5 pt-0">
                                  <SaleRecordsLine sale={sale} t={t} onOpen={openSaleRecords} />
                                </td>
                              </tr>
                            ) : null}
                            </Fragment>
                          )
                        })}
                      </Fragment>
                    )) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
          {revenueCount} {t('sales')} | {fmtUSD(revenue)}
          {/* The credit rides BESIDE the revenue, positive and unsigned: it is
              part of the figure to its left, not something to take off it. */}
          {creditUsd > 0 ? <> · {t('rpt_pending_credit') || 'Credit'} {fmtUSD(creditUsd)}</> : null}
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
            {mobileSkeletonCards.map((card) => (
              <div key={`sale-mobile-skeleton-${card}`} className="card p-3 animate-pulse">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-4 w-44 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
                      <div className="h-6 w-28 rounded-full bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="h-3 w-48 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                  <div className="space-y-3 text-right">
                    <div className="ml-auto h-6 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="ml-auto h-5 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{t('no_data')}</div>
        ) : salesSections.map((section) => {
          const isCollapsed = collapsedSalesSections.has(section.id)
          const countedCount = section.items.filter(isCountedSale).length
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <label className="inline-flex min-w-0 items-center gap-2">
                    {selectionModeActive ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isSelectionScopeFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                      aria-label={`Select ${section.label}`}
                    />
                    ) : null}
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{countedCount}</span>
                  </label>
                  <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSalesSection(section.id)}>
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                  </button>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => (
                <div key={group.id} className="space-y-2">
                  {showSalesActionGroups ? (
                    <div className="px-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <div className="inline-flex items-center gap-2">
                        {selectionModeActive ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={isSelectionScopeFullySelected(group.ids)}
                          ref={(node) => {
                            if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                          }}
                          onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                          aria-label={`Select ${group.label}`}
                        />
                        ) : null}
                        <span>{group.label}</span>
                        <span className="text-slate-400">{group.items.length}</span>
                      </div>
                    </div>
                  ) : null}
                  {group.items.map((sale) => {
                    const items = getSaleItems(sale)
                    const totalUsd = sale.total_usd || sale.total || 0
                    const totalKhr = sale.total_khr || 0
                    const status = sale.sale_status || 'completed'
                    const branchLabel = getSaleBranchLabel(sale)
                    const driverLabel = resolveDriverLabel(sale)
                    const cardSelected = selectedIds.has(Number(sale.id))
                    // Mobile mirror of the desktop rows' long-press pattern --
                    // the card and the row share one per-sale state slot, which
                    // is fine: only one of the two layouts is interactive at a
                    // given viewport width.
                    const cardLongPressState = getSaleLongPressState(Number(sale.id))
                    const cardLongPress = createLongPressHandlers(cardLongPressState, {
                      disabled: selectionModeActive,
                      onLongPress: () => toggleSelected(sale.id),
                      onClick: () => setDetailSale(sale),
                    })
                    const handleCardClick = () => {
                      if (consumeLongPressClick(cardLongPressState)) return
                      toggleSelected(sale.id)
                    }
                    return (
                      <div
                        key={sale.id}
                        className={`card cursor-pointer select-none p-3 active:bg-blue-50 dark:active:bg-blue-900/10 ${cardSelected ? 'ring-1 ring-blue-300 bg-blue-50/60 dark:ring-blue-700 dark:bg-blue-900/20' : ''}`}
                        onClick={selectionModeActive ? handleCardClick : undefined}
                        {...(selectionModeActive ? {} : cardLongPress)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              {selectionModeActive ? (
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={cardSelected}
                                onChange={() => toggleSelected(sale.id)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select ${sale.receipt_number}`}
                              />
                              ) : null}
                              {/* The card layout is the phone one (<768px), so
                                  the receipt id must never be ellipsised here
                                  -- it wraps onto a second line inside the
                                  card instead (user, Sep 3 2026). */}
                              <span className="min-w-0 whitespace-normal break-all font-mono text-sm font-semibold leading-snug text-blue-600 dark:text-blue-400">{sale.receipt_number}</span>
                              <span className="shrink-0 text-xs text-gray-400">{fmtTime(sale.created_at)}</span>
                            </div>
                            {/* Y17: customer (name + phone) leads the meta line;
                                tapping the card opens the full detail. */}
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                              <span className="font-medium text-gray-700 dark:text-gray-300">{sale.customer_name?.trim() || (t('walk_in') || 'Walk-in')}</span>
                              {sale.customer_phone?.trim() ? <span className="text-gray-400">{sale.customer_phone}</span> : null}
                              {sale.cashier_name ? <span>| {sale.cashier_name}</span> : null}
                              {branchLabel ? <span>| {branchLabel}</span> : null}
                              {/* N23: the driver is NAMED here. Cashier,
                                  branch and driver shared one unlabeled
                                  pipe-separated line, so a bare "Sok Dara"
                                  could equally have been the cashier -- the
                                  desktop table has a column header to say
                                  which, the card had nothing. The N/A
                                  placeholder is a TABLE convention (an empty
                                  cell reads as a bug); a card elides an
                                  empty field, as cashier and branch beside
                                  it already do. */}
                              {driverLabel ? <span>| {t('driver')}: {driverLabel}</span> : null}
                            </div>
                            {/* Third row on small screens (user, Aug 30):
                                status + payment get their OWN line, and the
                                payment badge truncates with "…" instead of
                                ever touching the KHR figure at the right. */}
                            <div className="mt-1 flex min-w-0 items-center gap-1.5">
                              <StatusBadge status={status} t={t} />
                              <span className="badge-blue min-w-0 max-w-[9rem] truncate text-xs">{sale.payment_method || 'N/A'}</span>
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{items.length} {t('items')}</span>
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className={`font-semibold ${status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{fmtUSD(totalUsd)}</div>
                            {totalKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                            <button className="mt-1 text-xs text-blue-500 underline" onClick={(event) => { event.stopPropagation(); setSelectedSale(sale) }}>
                              {t('print') || 'Print'}
                            </button>
                          </div>
                        </div>
                        {/* Same one line, at the bottom of the card -- the
                            phone mirror of the row underneath the desktop
                            row, rendered by the same component so the two
                            breakpoints cannot drift apart. */}
                        {openSaleRecords ? (
                          <div className="mt-1.5 border-t border-gray-100 pt-1 dark:border-gray-700">
                            <SaleRecordsLine sale={sale} t={t} onOpen={openSaleRecords} />
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
