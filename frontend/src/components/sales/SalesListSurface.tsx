import { Fragment, type RefObject } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import StatusBadge from './StatusBadge.tsx'
import { consumeLongPressClick, createLongPressHandlers, type LongPressState } from '../../utils/longPress.ts'

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
  /** Count of sales that contribute to `revenue` (cancelled + awaiting-payment
   * excluded) — the reconciled headline count shown in the footer. */
  revenueCount: number
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
  isCountedSale,
  salesSections,
  selectAllRef,
  selectedIds,
  selectionModeActive,
  getSaleLongPressState,
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

  return (
    <>
      <div className="card hidden flex-col sm:flex sm:max-h-[42rem] sm:overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/50">
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
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('receipt_number')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('customer')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                <th className="hidden px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 lg:table-cell">{t('cashier')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('payment_method')}</th>
                <th className="hidden px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('branch')}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                <th className="hidden px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('items')}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">{t('print')}</th>
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
                    <td className="hidden px-4 py-3 lg:table-cell"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="hidden px-4 py-3 md:table-cell"><div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="px-4 py-3"><div className="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="hidden px-4 py-3 md:table-cell"><div className="mx-auto h-4 w-8 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    <td className="px-4 py-3"><div className="mx-auto h-6 w-16 rounded bg-slate-200 dark:bg-slate-700" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="py-10 text-center text-gray-400">{t('no_data')}</td></tr>
              ) : salesSections.map((section) => {
                const isCollapsed = collapsedSalesSections.has(section.id)
                // Money-counting count for the day header (cancelled + awaiting
                // excluded), so the per-day counts sum to the footer total.
                const countedCount = section.items.filter(isCountedSale).length
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                      <td colSpan={11} className="px-4 py-2">
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
                            <td colSpan={11} className="px-6 py-2">
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
                            <tr
                              key={sale.id}
                              className={`table-row cursor-pointer select-none hover:bg-blue-50 dark:hover:bg-blue-900/10 ${rowSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${status === 'cancelled' ? 'opacity-60' : ''}`}
                              onClick={selectionModeActive ? handleRowClick : undefined}
                              {...(selectionModeActive ? {} : longPress)}
                            >
                              <td className={`${selectCellPad} py-2.5`} onClick={(event) => event.stopPropagation()}>
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
                              <td className="px-4 py-2.5 font-mono font-medium text-blue-600 dark:text-blue-400">{sale.receipt_number}</td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-500">{fmtTime(sale.created_at)}</td>
                              <td className="px-4 py-2.5">
                                {/* Y17: name + phone folded into one column; the
                                    row click opens the full detail (membership,
                                    address, line items). */}
                                <div className="min-w-0 max-w-[12rem]">
                                  <div className="truncate font-medium text-gray-800 dark:text-gray-200">{sale.customer_name?.trim() || (t('walk_in') || 'Walk-in')}</div>
                                  {sale.customer_phone?.trim() ? <div className="truncate text-xs text-gray-400">{sale.customer_phone}</div> : null}
                                </div>
                              </td>
                              <td className="px-4 py-2.5"><StatusBadge status={status} t={t} /></td>
                              <td className="hidden px-4 py-2.5 text-gray-700 dark:text-gray-300 lg:table-cell">{sale.cashier_name || 'N/A'}</td>
                              <td className="px-4 py-2.5"><span className="badge-blue text-xs">{sale.payment_method || 'N/A'}</span></td>
                              <td className="hidden px-4 py-2.5 text-xs text-gray-500 md:table-cell">{branchLabel || 'N/A'}</td>
                              <td className="px-4 py-2.5 text-right">
                                <div className={`font-semibold ${status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{fmtUSD(totalUsd)}</div>
                                {totalKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                              </td>
                              <td className="hidden px-4 py-2.5 text-center text-gray-500 md:table-cell">{items.length}</td>
                              <td className="px-4 py-2.5 text-center" onClick={(event) => event.stopPropagation()}>
                                <button
                                  onClick={() => setSelectedSale(sale)}
                                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20"
                                >
                                  {t('reprint')}
                                </button>
                              </td>
                            </tr>
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
        </div>
      </div>

      <div className="space-y-2 sm:hidden">
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
                              <span className="min-w-0 truncate font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{sale.receipt_number}</span>
                              <span className="shrink-0 text-xs text-gray-400">{fmtTime(sale.created_at)}</span>
                            </div>
                            {/* Y17: customer (name + phone) leads the meta line;
                                tapping the card opens the full detail. */}
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                              <span className="font-medium text-gray-700 dark:text-gray-300">{sale.customer_name?.trim() || (t('walk_in') || 'Walk-in')}</span>
                              {sale.customer_phone?.trim() ? <span className="text-gray-400">{sale.customer_phone}</span> : null}
                              {sale.cashier_name ? <span>| {sale.cashier_name}</span> : null}
                              {branchLabel ? <span>| {branchLabel}</span> : null}
                              <span>| {items.length} {t('items')}</span>
                            </div>
                            {/* Third row on small screens (user, Aug 30):
                                status + payment get their OWN line, and the
                                payment badge truncates with "…" instead of
                                ever touching the KHR figure at the right. */}
                            <div className="mt-1 flex min-w-0 items-center gap-1.5">
                              <StatusBadge status={status} t={t} />
                              <span className="badge-blue min-w-0 max-w-[9rem] truncate text-xs">{sale.payment_method || 'N/A'}</span>
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className={`font-semibold ${status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{fmtUSD(totalUsd)}</div>
                            {totalKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                            <button className="mt-1 text-xs text-blue-500 underline" onClick={(event) => { event.stopPropagation(); setSelectedSale(sale) }}>
                              {t('reprint')}
                            </button>
                          </div>
                        </div>
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
