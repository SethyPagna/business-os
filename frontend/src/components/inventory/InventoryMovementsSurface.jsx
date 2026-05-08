import { Fragment } from 'react'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import ExportMenu from '../shared/ExportMenu'

export default function InventoryMovementsSurface({
  MOV_COLORS,
  PaginationControls,
  expandedMovementGroups,
  expandedMovementPages,
  exportMovementGroups,
  fmtTime,
  fmtUSD,
  getMovementActionGroupRecordCount,
  getMovementGroupPage,
  getMovementRecordCount,
  getMovementSectionRecordCount,
  inventoryExportItems,
  isMovementScopeFullySelected,
  isMovementScopePartiallySelected,
  loading,
  movementDateRangeLabel,
  movementEndDate,
  movementMeta,
  movementSections,
  movementSelectAllRef,
  movementStartDate,
  openMovementProductDetail,
  selectedMovementGroups,
  selectedMovementIds,
  setSelectedMovementIds,
  setExpandedMovementGroupPage,
  setMovementEndDate,
  setMovementMeta,
  setMovementStartDate,
  setShowMovementDateFilter,
  showMovementActionGroups,
  showMovementDateFilter,
  t,
  toggleAllMovementSelection,
  toggleMovementGroup,
  toggleMovementScopeSelection,
  toggleMovementSectionCollapsed,
  toggleMovementSelection,
  tr,
  actionHistory,
  collapsedMovementSections,
  visibleMovementGroups,
  visibleMovementQuantity,
  visibleMovementRecordCount,
}) {
  return (
        <>
          <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('grouped_movement_history', 'Grouped movement history', '?????????????????????????????')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{tr('grouped_movement_history_desc', 'Related stock changes are bundled into one activity so sales, returns, imports, and transfers are easier to review.', '??????????????????????????????? ??????????????????????????? ?????????????????????? ????????? ????????? ????????????')}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">{visibleMovementGroups.length} groups · {visibleMovementRecordCount} records · {visibleMovementQuantity} quantity</div>
                {selectedMovementGroups.length > 0 ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs dark:border-blue-900/40 dark:bg-blue-900/20">
                    <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedMovementGroups.length} selected</span>
                    <button
                      type="button"
                      className="btn-secondary px-2.5 py-1 text-[11px]"
                      onClick={() => {
                        if (!window.confirm(tr('confirm_export_selected_movements', 'Do you want to export the selected movement groups?', '?????????????????????????????????????????'))) return
                        exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected')
                      }}
                    >
                      {tr('export_selected', 'Export selected', '?????????????????')}
                    </button>
                    <button type="button" className="text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedMovementIds(new Set())}>
                      {t('clear') || 'Clear'}
                    </button>
                  </div>
                ) : null}
                <ExportMenu
                  label={tr('export', 'Export', '??????')}
                  items={inventoryExportItems}
                  compact
                />
              </div>
            </div>
          </div>

          <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <ActionHistoryBar history={actionHistory} className="min-w-0" />
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:justify-end">
                <button
                  type="button"
                  className={`btn-secondary px-2.5 py-1 text-[11px] ${showMovementDateFilter ? 'border-blue-400 text-blue-700 dark:text-blue-300' : ''}`}
                  onClick={() => setShowMovementDateFilter((current) => !current)}
                >
                  {tr('custom_range', 'Custom range', '??????????????')}
                </button>
                <div className="max-w-full truncate rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  {movementDateRangeLabel}
                </div>
                {(movementStartDate || movementEndDate) ? (
                  <button
                    type="button"
                    className="btn-secondary px-2.5 py-1 text-[11px]"
                    onClick={() => {
                      setMovementStartDate('')
                      setMovementEndDate('')
                      setShowMovementDateFilter(false)
                    }}
                  >
                    {t('clear') || 'Clear'}
                  </button>
                ) : null}
              </div>
            </div>
            {showMovementDateFilter ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 md:max-w-xl">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('start_date', 'Start date', '????????????????????')}</span>
                  <input
                    type="date"
                    className="input text-sm"
                    value={movementStartDate}
                    onChange={(event) => setMovementStartDate(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('end_date', 'End date', '?????????????????')}</span>
                  <input
                    type="date"
                    className="input text-sm"
                    value={movementEndDate}
                    min={movementStartDate || undefined}
                    onChange={(event) => setMovementEndDate(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <PaginationControls
            className="mb-3"
            page={movementMeta.page}
            pageSize={movementMeta.pageSize}
            totalItems={movementMeta.total}
            label={t('movements') || 'movements'}
            t={t}
            onPageChange={(page) => setMovementMeta((current) => ({ ...current, page }))}
            onPageSizeChange={(pageSize) => setMovementMeta((current) => ({ ...current, page: 1, pageSize }))}
          />

          <div className="space-y-2 sm:hidden">
            {loading ? (
              <div className="py-10 text-center text-gray-400">{t('loading')}</div>
            ) : visibleMovementGroups.length === 0 ? (
              <div className="py-10 text-center text-gray-400">{t('no_data')}</div>
            ) : movementSections.map((section) => {
              const isCollapsed = collapsedMovementSections.has(section.id)
              return (
              <div key={section.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3 px-1 pt-1">
                  <div className="inline-flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isMovementScopeFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                    />
                    <button type="button" className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400" onClick={() => toggleMovementSectionCollapsed(section.id)}>
                      {section.label} · {section.ids.length} groups · {getMovementSectionRecordCount(section)} records
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleMovementSectionCollapsed(section.id)}>
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                {!isCollapsed ? section.groups.map((actionGroup) => (
                  <div key={actionGroup.id} className="space-y-2">
                    {showMovementActionGroups ? (
                      <div className="flex items-center gap-2 px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={isMovementScopeFullySelected(actionGroup.ids)}
                          ref={(node) => {
                            if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                          }}
                          onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                        />
                        <span>{actionGroup.label} · {actionGroup.items.length} groups · {getMovementActionGroupRecordCount(actionGroup)} records</span>
                      </div>
                    ) : null}
                    {actionGroup.items.map((group) => {
                      const isExpanded = expandedMovementGroups.has(group.id)
                      return (
                        <div key={group.id} className="card overflow-hidden">
                          <div className="flex items-start gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-700">
                            <label className="inline-flex items-center gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={selectedMovementIds.has(group.id)}
                                onChange={() => toggleMovementSelection(group.id)}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </label>
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left hover:text-blue-600 dark:hover:text-blue-300"
                              onClick={() => toggleMovementGroup(group.id)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOV_COLORS[group.movement_type] || 'bg-gray-100 text-gray-600'}`}>
                                      {group.movementLabel}
                                    </span>
                                    <span className="text-[10px] text-gray-400">{fmtTime(group.latest_at)}</span>
                                  </div>
                                  <div className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{group.productSummary || 'Movement'}</div>
                                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-400">
                                    <span>{getMovementRecordCount(group)} {tr('records', 'records', '?????????')}</span>
                                    {group.branchSummary ? <span>{group.branchSummary}</span> : null}
                                    {group.userSummary ? <span>{group.userSummary}</span> : null}
                                  </div>
                                  {group.reasonSummary ? <div className="mt-1 truncate text-xs text-gray-500">{group.reasonSummary}</div> : null}
                                </div>
                                <div className="flex items-start gap-2 text-right">
                                  <div>
                                    <div className="text-sm font-bold text-gray-900 dark:text-white">{group.totalQuantity}</div>
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</div>
                                  </div>
                                  <ChevronDown className={`mt-0.5 h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </div>
                            </button>
                          </div>
                          {isExpanded ? (
                            <div className="border-t border-gray-200 p-3 dark:border-gray-700">
                              {(() => {
                                const groupPage = getMovementGroupPage(group, {
                                  page: expandedMovementPages[group.id] || 1,
                                  pageSize: 10,
                                })
                                return (
                                  <>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Records</div>
                                  <div className="text-base font-bold text-gray-900 dark:text-white">{getMovementRecordCount(group)}</div>
                                </div>
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('quantity')}</div>
                                  <div className="text-base font-bold text-gray-900 dark:text-white">{group.totalQuantity}</div>
                                </div>
                              </div>
                              {group.reasonSummary ? (
                                <div className="mt-3">
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('reason')}</div>
                                  <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800 dark:bg-gray-700/50 dark:text-gray-200">{group.reasonSummary}</div>
                                </div>
                              ) : null}
                              <div className="mt-3 space-y-2">
                                {groupPage.items.map((movement) => (
                                  <div key={movement.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <Package className="h-4 w-4 text-gray-400" />
                                          <button
                                            type="button"
                                            className="truncate text-left text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300"
                                            onClick={() => openMovementProductDetail(movement)}
                                          >
                                            {movement.product_name || 'Product'}
                                          </button>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                          <span>{fmtTime(movement.created_at)}</span>
                                          {movement.branch_name ? <span>{movement.branch_name}</span> : null}
                                          {movement.user_name ? <span>{movement.user_name}</span> : null}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{movement.quantity}</div>
                                        {(movement.total_cost_usd || 0) > 0 ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(movement.total_cost_usd || 0)}</div> : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {groupPage.totalPages > 1 ? (
                                <PaginationControls
                                  className="mt-3"
                                  page={groupPage.page}
                                  pageSize={groupPage.pageSize}
                                  totalItems={groupPage.total}
                                  label={t('records') || 'records'}
                                  t={t}
                                  onPageChange={(page) => setExpandedMovementGroupPage(group.id, page)}
                                  onPageSizeChange={() => {}}
                                  pageSizeOptions={[10]}
                                />
                              ) : null}
                                  </>
                                )
                              })()}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )) : null}
              </div>
            )})}
          </div>

          <div className="card hidden overflow-hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        ref={movementSelectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={visibleMovementGroups.length > 0 && selectedMovementIds.size === visibleMovementGroups.length}
                        onChange={(event) => toggleAllMovementSelection(event.target.checked)}
                        aria-label="Select all movement groups"
                      />
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Activity</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Products</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('quantity')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">{t('branch')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden xl:table-cell">{t('user')}</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400">View</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
                  ) : visibleMovementGroups.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-gray-400">{t('no_data')}</td></tr>
                  ) : movementSections.map((section) => {
                    const isCollapsed = collapsedMovementSections.has(section.id)
                    return (
                    <Fragment key={section.id}>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isMovementScopeFullySelected(section.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                            }}
                            onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                          />
                        </td>
                        <td colSpan={8} className="px-4 py-2">
                          <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <span>{section.label} · {section.ids.length} groups · {getMovementSectionRecordCount(section)} records</span>
                            <div className="flex items-center gap-1">
                              <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleMovementSectionCollapsed(section.id)}>
                                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed ? section.groups.map((actionGroup) => (
                        <Fragment key={actionGroup.id}>
                          {showMovementActionGroups ? (
                            <tr className="bg-white dark:bg-gray-800/70">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isMovementScopeFullySelected(actionGroup.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                                  }}
                                  onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                                />
                              </td>
                              <td colSpan={8} className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {actionGroup.label} · {actionGroup.items.length} groups · {getMovementActionGroupRecordCount(actionGroup)} records
                              </td>
                            </tr>
                          ) : null}
                          {actionGroup.items.map((group) => {
                            const isExpanded = expandedMovementGroups.has(group.id)
                            return (
                              <Fragment key={group.id}>
                                <tr className="table-row hover:bg-blue-50 dark:hover:bg-blue-900/10">
                                  <td className="px-3 py-2" />
                                  <td className="whitespace-nowrap px-3 py-2 text-[10px] text-gray-400">{fmtTime(group.latest_at)}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded"
                                        checked={selectedMovementIds.has(group.id)}
                                        onChange={() => toggleMovementSelection(group.id)}
                                        onClick={(event) => event.stopPropagation()}
                                        aria-label={`Select movement group ${group.id}`}
                                      />
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOV_COLORS[group.movement_type] || 'bg-gray-100 text-gray-600'}`}>
                                        {group.movementLabel}
                                      </span>
                                      <span className="text-[10px] text-gray-400">{getMovementRecordCount(group)} {tr('records', 'records', '?????????')}</span>
                                    </div>
                                    {group.reasonSummary ? <div className="mt-1 max-w-[220px] truncate text-[11px] text-gray-500">{group.reasonSummary}</div> : null}
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">
                                    <button
                                      type="button"
                                      className="inline-flex min-w-0 items-center gap-1.5 text-left hover:text-blue-600 dark:hover:text-blue-300"
                                      onClick={() => toggleMovementGroup(group.id)}
                                    >
                                      <span className="truncate">{group.productSummary || 'Movement'}</span>
                                      <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                  </td>
                                  <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">{group.totalQuantity}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden lg:table-cell">{group.branchSummary || 'N/A'}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden xl:table-cell">{group.userSummary || 'N/A'}</td>
                                  <td className="px-3 py-2 text-center" />
                                </tr>
                                {isExpanded ? (
                                  <tr className="bg-gray-50/80 dark:bg-gray-900/30">
                                    <td colSpan={9} className="px-4 py-3">
                                      {(() => {
                                        const groupPage = getMovementGroupPage(group, {
                                          page: expandedMovementPages[group.id] || 1,
                                          pageSize: 10,
                                        })
                                        return (
                                          <>
                                      <div className="grid gap-3 lg:grid-cols-[220px,1fr]">
                                        <div className="space-y-3">
                                          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('reference')}</div>
                                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">{group.reference_id || 'N/A'}</div>
                                          </div>
                                          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('recorded_at')}</div>
                                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">{fmtTime(group.created_at)}</div>
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          {groupPage.items.map((movement) => (
                                            <div key={movement.id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                  <div className="flex items-center gap-2">
                                                    <Package className="h-4 w-4 text-gray-400" />
                                                    <button
                                                      type="button"
                                                      className="truncate text-left text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300"
                                                      onClick={() => openMovementProductDetail(movement)}
                                                    >
                                                      {movement.product_name || 'Product'}
                                                    </button>
                                                  </div>
                                                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                                    <span>{fmtTime(movement.created_at)}</span>
                                                    {movement.branch_name ? <span>{movement.branch_name}</span> : null}
                                                    {movement.user_name ? <span>{movement.user_name}</span> : null}
                                                    {movement.reason ? <span>{movement.reason}</span> : null}
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{movement.quantity}</div>
                                                  {(movement.total_cost_usd || 0) > 0 ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(movement.total_cost_usd || 0)}</div> : null}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      {groupPage.totalPages > 1 ? (
                                        <PaginationControls
                                          className="mt-3"
                                          page={groupPage.page}
                                          pageSize={groupPage.pageSize}
                                          totalItems={groupPage.total}
                                          label={t('records') || 'records'}
                                          t={t}
                                          onPageChange={(page) => setExpandedMovementGroupPage(group.id, page)}
                                          onPageSizeChange={() => {}}
                                          pageSizeOptions={[10]}
                                        />
                                      ) : null}
                                          </>
                                        )
                                      })()}
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            )
                          })}
                        </Fragment>
                      )) : null}
                    </Fragment>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </>
  )
}
