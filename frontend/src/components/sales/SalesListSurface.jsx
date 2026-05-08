import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import StatusBadge from './StatusBadge'

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
  salesSections,
  selectAllRef,
  selectedIds,
  setDetailSale,
  setSelectedSale,
  showSalesActionGroups,
  t,
  toggleSalesSection,
  toggleSelected,
  toggleSelectAll,
  toggleSelectionScope,
}) {
  return (
    <>
      <div className="card hidden flex-col sm:flex">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={filteredIds.length > 0 && selectedIds.size === filteredIds.length}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    aria-label="Select all sales"
                  />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('receipt_number')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                <th className="hidden px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 lg:table-cell">{t('cashier')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('payment_method')}</th>
                <th className="hidden px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('branch')}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                <th className="hidden px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('items')}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">{t('no_data')}</td></tr>
              ) : salesSections.map((section) => {
                const isCollapsed = collapsedSalesSections.has(section.id)
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                      <td colSpan={10} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <label className="inline-flex min-w-0 items-center gap-2 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
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
                            <span>{section.label}</span>
                            <span className="text-slate-400">{section.ids.length} sale{section.ids.length === 1 ? '' : 's'}</span>
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
                            <td colSpan={10} className="px-6 py-2">
                              <div className="flex flex-wrap items-center gap-3 text-xs">
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
                                <span className="font-medium text-slate-600 dark:text-slate-300">{group.label}</span>
                                <span className="text-slate-400">{group.items.length}</span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {group.items.map((sale) => {
                          const items = Array.isArray(sale.items) ? sale.items : []
                          const totalUsd = sale.total_usd || sale.total || 0
                          const totalKhr = sale.total_khr || 0
                          const status = sale.sale_status || 'completed'
                          const branchLabel = getSaleBranchLabel(sale)
                          return (
                            <tr
                              key={sale.id}
                              className={`table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 ${status === 'cancelled' ? 'opacity-60' : ''}`}
                              onClick={() => setDetailSale(sale)}
                            >
                              <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={selectedIds.has(Number(sale.id))}
                                  onChange={() => toggleSelected(sale.id)}
                                  aria-label={`Select ${sale.receipt_number}`}
                                />
                              </td>
                              <td className="px-4 py-2.5 font-mono font-medium text-blue-600 dark:text-blue-400">{sale.receipt_number}</td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-500">{fmtTime(sale.created_at)}</td>
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
          {filtered.length} {t('sales')} · {fmtUSD(revenue)}
        </div>
      </div>

      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="py-10 text-center text-gray-400">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{t('no_data')}</div>
        ) : salesSections.map((section) => {
          const isCollapsed = collapsedSalesSections.has(section.id)
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <label className="inline-flex min-w-0 items-center gap-2">
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
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{section.ids.length}</span>
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
                        <span>{group.label}</span>
                        <span className="text-slate-400">{group.items.length}</span>
                      </div>
                    </div>
                  ) : null}
                  {group.items.map((sale) => {
                    const items = Array.isArray(sale.items) ? sale.items : []
                    const totalUsd = sale.total_usd || sale.total || 0
                    const totalKhr = sale.total_khr || 0
                    const status = sale.sale_status || 'completed'
                    const branchLabel = getSaleBranchLabel(sale)
                    return (
                      <div key={sale.id} className="card cursor-pointer p-3 active:bg-blue-50 dark:active:bg-blue-900/10" onClick={() => setDetailSale(sale)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={selectedIds.has(Number(sale.id))}
                                onChange={() => toggleSelected(sale.id)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select ${sale.receipt_number}`}
                              />
                              <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{sale.receipt_number}</span>
                              <span className="text-xs text-gray-400">{fmtTime(sale.created_at)}</span>
                              <span className="badge-blue text-xs">{sale.payment_method || 'N/A'}</span>
                              <StatusBadge status={status} t={t} />
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                              {sale.cashier_name ? <span>{sale.cashier_name}</span> : null}
                              {branchLabel ? <span>· {branchLabel}</span> : null}
                              <span>· {items.length} {t('items')}</span>
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
