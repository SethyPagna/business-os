import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

const deferredMobileCardStyle = {
  contentVisibility: 'auto',
  containIntrinsicSize: '128px',
}

const deferredDesktopRowStyle = {
  contentVisibility: 'auto',
  containIntrinsicSize: '56px',
}

function ReturnsDesktopSkeletonRows() {
  return Array.from({ length: 4 }).map((_, index) => (
    <tr key={`returns-desktop-skeleton-${index}`} className="animate-pulse">
      <td className="px-3 py-3">
        <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
      </td>
      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-orange-100 dark:bg-orange-900/40" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-5 w-20 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" /></td>
    </tr>
  ))
}

function ReturnsMobileSkeletonCards() {
  return Array.from({ length: 3 }).map((_, index) => (
    <div key={`returns-mobile-skeleton-${index}`} className="card animate-pulse p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-orange-100 dark:bg-orange-900/40" />
          <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  ))
}

export default function ReturnsListSurface({
  collapsedReturnSections,
  CUSTOMER_SCOPE,
  filtered,
  fmtTime,
  isSelectionScopeFullySelected,
  isSelectionScopePartiallySelected,
  loading,
  normalizeScope,
  renderAmount,
  returnSections,
  scope,
  selectAllRef,
  selectedIds,
  setDetailRet,
  showReturnActionGroups,
  SUPPLIER_SCOPE,
  t,
  toggleReturnSection,
  toggleSelected,
  toggleSelectAll,
  toggleSelectionScope,
  tr,
  visibleIds,
}) {
  let desktopRenderedRowCount = 0

  return (
    <>
      <div className="card hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={visibleIds.length > 0 && selectedIds.size === visibleIds.length}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    aria-label="Select all returns"
                  />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('return_number', 'Return #')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('date', 'Date')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('reference', 'Reference')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{scope === SUPPLIER_SCOPE ? tr('supplier', 'Supplier') : tr('customer', 'Customer')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('reason', 'Reason')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('type', 'Type')}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{tr('amount', 'Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <ReturnsDesktopSkeletonRows />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</td></tr>
              ) : returnSections.map((section) => {
                const isCollapsed = collapsedReturnSections.has(section.id)
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                      <td colSpan={8} className="px-4 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                          <label className="inline-flex items-center gap-2 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
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
                          </label>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400">{section.ids.length}</span>
                            <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleReturnSection(section.id)}>
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed ? section.groups.map((group) => (
                      <Fragment key={group.id}>
                        {showReturnActionGroups ? (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/30">
                            <td colSpan={8} className="px-6 py-2">
                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                <label className="inline-flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
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
                                </label>
                                <span className="text-slate-400">{group.items.length}</span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {group.items.map((ret) => {
                          const desktopRowIndex = desktopRenderedRowCount
                          desktopRenderedRowCount += 1
                          const retScope = normalizeScope(ret.return_scope)
                          const typeLabel = retScope === SUPPLIER_SCOPE
                            ? (ret.supplier_settlement || tr('settlement_refund', 'refund'))
                            : (ret.return_type || tr('manual_return', 'manual'))
                          return (
                            <tr
                              key={ret.id}
                              className="table-row cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-900/10"
                              style={desktopRowIndex >= 12 ? deferredDesktopRowStyle : undefined}
                              onClick={() => setDetailRet(ret)}
                            >
                              <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={selectedIds.has(Number(ret.id))}
                                  onChange={() => toggleSelected(ret.id)}
                                  aria-label={`Select ${ret.return_number}`}
                                />
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium text-orange-600 dark:text-orange-400">{ret.return_number}</td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">{fmtTime(ret.created_at)}</td>
                              <td className="px-4 py-2.5">
                                {ret.receipt_number
                                  ? <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{ret.receipt_number}</span>
                                  : <span className="text-xs text-gray-400">{tr('manual_return', 'Manual')}</span>}
                              </td>
                              <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}</td>
                              <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{ret.reason || '-'}</td>
                              <td className="px-4 py-2.5">
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-700 dark:text-gray-200">{typeLabel}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right">{renderAmount(ret)}</td>
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
      </div>

      <div className="space-y-2 sm:hidden">
        {loading ? (
          <ReturnsMobileSkeletonCards />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</div>
        ) : returnSections.map((section) => {
          const isCollapsed = collapsedReturnSections.has(section.id)
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
                    <span className="normal-case tracking-normal text-slate-400">{section.ids.length}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleReturnSection(section.id)}>
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => (
                <div key={group.id} className="space-y-2">
                  {showReturnActionGroups ? (
                    <div className="px-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <label className="inline-flex items-center gap-2">
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
                      </label>
                    </div>
                  ) : null}
                  {group.items.map((ret, index) => {
                    const retScope = normalizeScope(ret.return_scope)
                    return (
                      <div
                        key={ret.id}
                        className="card cursor-pointer p-3"
                        style={index >= 8 ? deferredMobileCardStyle : undefined}
                        onClick={() => setDetailRet(ret)}
                      >
                        <div className="mb-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={selectedIds.has(Number(ret.id))}
                            onChange={() => toggleSelected(ret.id)}
                            aria-label={`Select ${ret.return_number}`}
                          />
                        </div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">{ret.return_number}</div>
                            <div className="text-xs text-gray-400">{fmtTime(ret.created_at)}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">{ret.reason}</div>
                            <div className="mt-0.5 text-xs text-gray-400">{retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}</div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {renderAmount(ret)}
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
