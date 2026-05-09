import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export default function ProductsListSurface({
  allVisibleProducts,
  collapsedProductGroups,
  collapsedProductSections,
  desktopSelectAllRef,
  getGroupSummaryParts,
  isSelectionScopeFullySelected,
  isSelectionScopePartiallySelected,
  loading,
  productSections,
  productTotal,
  refreshingProducts,
  renderDesktopProductRow,
  renderMobileProductCard,
  selectedVisibleCount,
  t,
  toggleProductGroup,
  toggleProductSection,
  toggleSelectAll,
  toggleSelectionScope,
  tr,
  visibleIds,
  visibleProducts,
}) {
  const skeletonRows = Array.from({ length: 8 }, (_, index) => index)

  return (
    <>
      <div className="card hidden flex-col sm:flex sm:h-[calc(100vh-18rem)] sm:min-h-[28rem] sm:max-h-[42rem] sm:overflow-hidden">
        <div className="min-h-0 overflow-auto sm:flex-1">
          <table className="w-full text-sm table-bordered">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length}
                    ref={desktopSelectAllRef}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                  />
                </th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold w-16">Image</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('product_name')}</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold hidden md:table-cell">{t('details') || 'Details'}</th>
                <th className="text-right px-3 py-3 text-red-600 dark:text-red-400 font-semibold col-highlight-red">{t('cost_in_purchase')}</th>
                <th className="text-right px-3 py-3 text-green-600 dark:text-green-400 font-semibold col-highlight-green">{t('selling_price_label')}</th>
                <th className="text-right px-3 py-3 text-blue-600 dark:text-blue-400 font-semibold hidden lg:table-cell">{t('margin')}</th>
                <th className="text-right px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('stock')}</th>
                <th className="text-center px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('status')}</th>
                <th className="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
              : visibleProducts.length === 0 ? <tr><td colSpan={10} className="text-center py-10 text-gray-400">{refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'áž€áŸ†áž–áž»áž„áž’áŸ’ážœáž¾áž”áž…áŸ’áž…áž»áž”áŸ’áž”áž“áŸ’áž“áž—áž¶áž–áž•áž›áž·ážáž•áž›...') : t('no_data')}</td></tr>
              : productSections.map((section) => {
                const isCollapsed = collapsedProductSections.has(section.id)
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                      <td colSpan={10} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
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
                            <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                          </label>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                            onClick={() => toggleProductSection(section.id)}
                          >
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed ? section.groups.map((group) => {
                      const groupCollapsed = collapsedProductGroups.has(group.key)
                      const showGroupRow = group.hasMultipleItems
                      return (
                        <Fragment key={group.key}>
                          {showGroupRow ? (
                            <tr className="bg-white/80 dark:bg-slate-900/45" data-product-jump-id={group.anchorId}>
                              <td colSpan={10} className="px-4 py-2.5">
                                <div className="flex items-center justify-between gap-3">
                                  <label className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-100">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded"
                                      checked={isSelectionScopeFullySelected(group.ids)}
                                      ref={(node) => {
                                        if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                                      }}
                                      onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                                      aria-label={`Select ${group.name}`}
                                    />
                                    <button type="button" className="inline-flex min-w-0 items-center gap-2 text-left" onClick={() => toggleProductGroup(group.key)}>
                                      {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                      <span className="truncate">{group.name}</span>
                                    </button>
                                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{group.items.length}</span>
                                  </label>
                                  <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-300">
                                    {getGroupSummaryParts(group).map((part) => (
                                      <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{part}</span>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          {!groupCollapsed || !showGroupRow ? group.items.map((product) => renderDesktopProductRow(product, { indented: showGroupRow })) : null}
                        </Fragment>
                      )
                    }) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 dark:border-gray-700">
          {visibleProducts.length} / {productTotal || allVisibleProducts.length} {t('products')}
        </div>
      </div>

      <div className="min-h-[32rem] flex-1 overflow-auto space-y-2 sm:hidden">
        {loading ? (
          <div className="space-y-2">
            {skeletonRows.slice(0, 6).map((row) => (
              <div key={`product-mobile-skeleton-${row}`} className="card animate-pulse p-3">
                <div className="flex items-start gap-3">
                  <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-8 w-full rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
        : visibleProducts.length === 0 ? <div className="text-center py-10 text-gray-400">{refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'áž€áŸ†áž–áž»áž„áž’áŸ’ážœáž¾áž”áž…áŸ’áž…áž»áž”áŸ’áž”áž“áŸ’áž“áž—áž¶áž–áž•áž›áž·ážáž•áž›...') : t('no_data')}</div>
        : productSections.map((section) => {
          const isCollapsed = collapsedProductSections.has(section.id)
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
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
                    <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                    onClick={() => toggleProductSection(section.id)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                  </button>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => {
                const groupCollapsed = collapsedProductGroups.has(group.key)
                const showGroupRow = group.hasMultipleItems
                return (
                  <div key={group.key} className="space-y-2">
                    {showGroupRow ? (
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/80" data-product-jump-id={group.anchorId}>
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex min-w-0 items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded"
                              checked={isSelectionScopeFullySelected(group.ids)}
                              ref={(node) => {
                                if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                              }}
                              onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                              aria-label={`Select ${group.name}`}
                            />
                            <button type="button" className="min-w-0 text-left" onClick={() => toggleProductGroup(group.key)}>
                              <div className="flex items-center gap-1.5">
                                {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.name}</span>
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{group.items.length}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
                                {getGroupSummaryParts(group, { includeCount: false }).map((part) => (
                                  <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{part}</span>
                                ))}
                              </div>
                            </button>
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {!groupCollapsed || !showGroupRow ? group.items.map((product) => renderMobileProductCard(product, { indented: showGroupRow })) : null}
                  </div>
                )
              }) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}

