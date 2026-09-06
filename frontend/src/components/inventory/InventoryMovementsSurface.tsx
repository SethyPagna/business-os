import { Fragment } from 'react'
import type { ComponentType, Dispatch, RefObject, SetStateAction } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js'
import ExportMenu from '../shared/ExportMenu'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import type { PaginationControlsProps } from '../shared/PaginationControls'
import type { PortalMenuItem } from '../shared/PortalMenu'
import { fmtClock24 } from '../../utils/formatters'
import { translateMovementType } from './movementGroups'
// N13: branch / actor / reason are rendered through the one shared history
// row model, so this drill and the Stock Change ledger cannot disagree about
// the same movement row (an absent value said nothing here and '—' there).
import { historyActor, historyField } from '../../utils/historyRowModel.ts'

type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallback?: string, altFallback?: string) => string
type MoneyFormatter = (value: number) => string
type TimeFormatter = (value: unknown) => string
type MovementId = string

type ActionHistoryItem = {
  id?: string | number
  label?: string
  status?: string
}

type ActionHistoryState = {
  undoItems?: ActionHistoryItem[]
  redoItems?: ActionHistoryItem[]
  serverItems?: ActionHistoryItem[]
  isAdmin?: boolean
  userFilter?: string
  setUserFilter?: (userId: string) => void
  userOptions?: Array<{ id: string | number; name?: string; username?: string }>
  canUndo?: boolean
  canRedo?: boolean
  busy?: boolean
  lastUndoLabel?: string
  lastRedoLabel?: string
  undo: (id?: string | number) => void
  redo: (id?: string | number) => void
}

type MovementRecord = {
  id: MovementId | number
  product_name?: string
  created_at?: string | null
  branch_name?: string
  user_name?: string
  reason?: string
  quantity?: number
  total_cost_usd?: number
}

type MovementGroup = {
  id: MovementId
  movement_type: string
  movementLabel: string
  created_at?: string | null
  latest_at?: string | null
  reference_id?: unknown
  productSummary?: string
  branchSummary?: string
  userSummary?: string
  reasonSummary?: string
  totalQuantity: number
  totalCostUsd?: number
  items: MovementRecord[]
}

type MovementActionGroup = {
  id: string
  label: string
  ids: MovementId[]
  items: MovementGroup[]
}

type MovementSection = {
  id: string
  label: string
  ids: MovementId[]
  groups: MovementActionGroup[]
}

type MovementMeta = {
  page: number
  pageSize: number
  total: number
}

type MovementGroupPage = {
  items: MovementRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type InventoryMovementsSurfaceProps = {
  movementColorClass: (group: MovementGroup) => string
  PaginationControls: ComponentType<PaginationControlsProps>
  expandedMovementGroups: Set<MovementId>
  expandedMovementPages: Record<string, number>
  exportMovementGroups: (groupIds: MovementId[], exportName: string) => void
  fmtTime: TimeFormatter
  fmtUSD: MoneyFormatter
  getMovementActionGroupRecordCount: (group: MovementActionGroup) => number
  getMovementGroupPage: (group: MovementGroup, options: { page: number; pageSize: number }) => MovementGroupPage
  getMovementRecordCount: (group: MovementGroup) => number
  getMovementSectionRecordCount: (section: MovementSection) => number
  inventoryExportItems: Array<PortalMenuItem | null | undefined | false>
  isMovementScopeFullySelected: (ids: MovementId[]) => boolean
  isMovementScopePartiallySelected: (ids: MovementId[]) => boolean
  loading: boolean
  movementEndDate: string
  movementMeta: MovementMeta
  movementSections: MovementSection[]
  movementSelectAllRef: RefObject<HTMLInputElement>
  // Checkboxes render ONLY while Select mode is on (user, Aug 31: "the
  // check box can be removed... show only in select mode") -- the toolbar's
  // Select toggle drives it; leaving the mode clears the selection
  // (Inventory.tsx's effect).
  movementSelectMode: boolean
  movementStartDate: string
  onToggleMovementSelectMode: () => void
  openMovementProductDetail: (movement: MovementRecord) => void
  selectedMovementGroups: MovementId[]
  selectedMovementIds: Set<MovementId>
  setSelectedMovementIds: Dispatch<SetStateAction<Set<MovementId>>>
  setExpandedMovementGroupPage: (groupId: MovementId, page: number) => void
  setMovementEndDate: (value: string) => void
  setMovementMeta: Dispatch<SetStateAction<MovementMeta>>
  setMovementStartDate: (value: string) => void
  showMovementActionGroups: boolean
  t: Translator
  toggleAllMovementSelection: (checked: boolean) => void
  toggleMovementGroup: (groupId: MovementId) => void
  toggleMovementScopeSelection: (ids: MovementId[], checked: boolean) => void
  toggleMovementSectionCollapsed: (sectionId: string) => void
  toggleMovementSelection: (groupId: MovementId) => void
  tr: TranslationWithFallback
  actionHistory?: ActionHistoryState | null
  collapsedMovementSections: Set<string>
  visibleMovementGroups: MovementGroup[]
  visibleMovementQuantity: number
  visibleMovementRecordCount: number
}

// There is no "group parent" record (user, Aug 31): a movement group is a
// bundle whose title the SYSTEM makes up -- the shared product name when
// every record touches one product, otherwise just how many products the
// bundle spans. Every actual record, first included, is an equal child row
// in the expanded table below; the old productSummary concatenated many
// names into the collapsed row instead.
function movementGroupTitle(group: MovementGroup, tr: TranslationWithFallback): string {
  const names = new Set<string>()
  for (const item of group.items || []) {
    const name = String(item?.product_name || '').trim()
    if (name) names.add(name)
  }
  const first = names.values().next().value as string | undefined
  if (names.size === 1 && first) return first
  if (names.size === 0) return tr('movement', 'Movement')
  return `${names.size} ${tr('products', 'Products')}`
}

// Rows carry only their clock time -- the DAY lives once on the section
// divider above them (movementSections group by day now). A record with no
// real time of day reads as a muted placeholder, not a fabricated 00:00.
function rowClock(raw: string | null | undefined): string {
  const clock = fmtClock24(raw)
  return clock && clock !== '—' ? clock : '––:––'
}

export default function InventoryMovementsSurface({
  movementColorClass,
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
  movementEndDate,
  movementMeta,
  movementSections,
  movementSelectAllRef,
  movementSelectMode,
  movementStartDate,
  onToggleMovementSelectMode,
  openMovementProductDetail,
  selectedMovementGroups,
  selectedMovementIds,
  setSelectedMovementIds,
  setExpandedMovementGroupPage,
  setMovementEndDate,
  setMovementMeta,
  setMovementStartDate,
  showMovementActionGroups,
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
}: InventoryMovementsSurfaceProps) {
  // Every data column of the desktop table, for the day/action header rows
  // to span; +1 while the Select-mode checkbox column exists.
  const desktopColumnCount = movementSelectMode ? 8 : 7

  // The expanded view is ONE excel-style bordered table of the group's
  // child records (user, Aug 31: "for expanded do excel style" -- replacing
  // the stacked mini-cards) -- shared by the mobile cards and the desktop
  // table. Time is the full stamp here (a bundle can straddle days); the
  // collapsed rows outside carry the day/time split.
  const renderGroupDetail = (group: MovementGroup) => {
    const groupPage = getMovementGroupPage(group, {
      page: expandedMovementPages[group.id] || 1,
      pageSize: 10,
    })
    const cellClass = 'border border-gray-200 px-2 py-1.5 dark:border-gray-700'
    return (
      <>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span>{t('reference') || 'Reference'}: <span className="text-gray-700 dark:text-gray-200">{String(group.reference_id || '—')}</span></span>
          <span>{t('recorded_at') || 'Recorded at'}: <span className="text-gray-700 dark:text-gray-200">{fmtTime(group.created_at)}</span></span>
          {group.reasonSummary ? (
            <span className="min-w-0 max-w-full truncate" title={group.reasonSummary}>{t('reason') || 'Reason'}: <span className="text-gray-700 dark:text-gray-200">{group.reasonSummary}</span></span>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="bg-gray-100 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <th className={`${cellClass} w-8 text-right`}>#</th>
                <th className={cellClass}>{t('product') || 'Product'}</th>
                <th className={`${cellClass} text-right`}>{t('quantity') || 'Qty'}</th>
                <th className={`${cellClass} text-right`}>{t('cost') || 'Cost'}</th>
                <th className={cellClass}>{t('branch') || 'Branch'}</th>
                <th className={cellClass}>{t('user') || 'User'}</th>
                <th className={cellClass}>{t('time') || 'Time'}</th>
                <th className={cellClass}>{t('reason') || 'Reason'}</th>
              </tr>
            </thead>
            <tbody>
              {groupPage.items.map((movement, index) => (
                <tr key={movement.id} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900/40 dark:even:bg-gray-800/40">
                  <td className={`${cellClass} text-right tabular-nums text-gray-400`}>{(groupPage.page - 1) * groupPage.pageSize + index + 1}</td>
                  <td className={cellClass}>
                    <button
                      type="button"
                      className="max-w-[16rem] truncate text-left font-medium text-gray-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300"
                      onClick={() => openMovementProductDetail(movement)}
                      title={movement.product_name || ''}
                    >
                      {movement.product_name || (t('product') || 'Product')}
                    </button>
                  </td>
                  <td className={`${cellClass} text-right font-semibold tabular-nums text-gray-900 dark:text-white`}>{movement.quantity}</td>
                  <td className={`${cellClass} text-right tabular-nums text-emerald-600 dark:text-emerald-400`}>{(movement.total_cost_usd || 0) > 0 ? fmtUSD(movement.total_cost_usd || 0) : ''}</td>
                  <td className={`${cellClass} text-gray-600 dark:text-gray-300`}>{historyField(movement.branch_name)}</td>
                  <td className={`${cellClass} text-gray-600 dark:text-gray-300`}>{historyActor(movement.user_name)}</td>
                  <td className={`${cellClass} whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-300`}>{fmtTime(movement.created_at)}</td>
                  <td className={`${cellClass} max-w-[14rem] text-gray-500 dark:text-gray-400`}>
                    <span className="block max-w-full truncate" title={historyField(movement.reason)}>{historyField(movement.reason)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {groupPage.totalPages > 1 ? (
          <PaginationControls
            className="mt-3"
            compact
            rangeAsPageSize
            editablePageSizeInput={false}
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
  }

  return (
        <>
          {/* Compact movement controls. The date range is optional, so the
              page opens with the complete history rather than only today. */}
          <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* Keep the actionable controls at the left, as in the supplied
                  layout. The redundant history heading/count block is removed. */}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {movementSelectMode && selectedMovementGroups.length > 0 ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs dark:border-blue-900/40 dark:bg-blue-900/20">
                    <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedMovementGroups.length} {tr('selected', 'selected')}</span>
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-[11px]"
                      onClick={() => {
                        if (!window.confirm(tr('confirm_export_selected_movements'))) return
                        exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected')
                      }}
                    >
                      {tr('export_selected', 'Export selected')}
                    </button>
                    <button type="button" className="text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedMovementIds(new Set())}>
                      {t('clear') || 'Clear'}
                    </button>
                  </div>
                ) : null}

                <button
                  type="button"
                  className={`btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px] ${movementSelectMode ? 'border-blue-400 text-blue-700 dark:text-blue-300' : ''}`}
                  onClick={onToggleMovementSelectMode}
                  aria-pressed={movementSelectMode}
                  title={tr('movement_select_mode_hint', 'Show checkboxes to pick movement groups for export')}
                >
                  <ListChecks className="h-3.5 w-3.5 shrink-0" />
                  {tr('select', 'Select')}
                </button>

                <DateTimeRangePicker
                  value={{ startDate: movementStartDate, endDate: movementEndDate, startTime: '', endTime: '' }}
                  onChange={(range) => {
                    setMovementStartDate(range.startDate || '')
                    setMovementEndDate(range.endDate || '')
                  }}
                  t={t}
                  showTime={false}
                  triggerClassName="flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5"
                />
                {(movementStartDate || movementEndDate) ? (
                  <button
                    type="button"
                    className="btn-secondary shrink-0 px-2 py-1 text-[11px]"
                    onClick={() => {
                      setMovementStartDate('')
                      setMovementEndDate('')
                    }}
                  >
                    {t('clear') || 'Clear'}
                  </button>
                ) : null}

                <ExportMenu
                  label={tr('export', 'Export')}
                  items={inventoryExportItems}
                  compact
                  iconOnly
                />
              </div>
            </div>
          </div>

          <div className="mb-3 flex justify-center">
          <PaginationControls
            compact
            rangeAsPageSize
            page={movementMeta.page}
            pageSize={movementMeta.pageSize}
            totalItems={movementMeta.total}
            label={t('movements') || 'movements'}
            t={t}
            onPageChange={(page) => setMovementMeta((current) => ({ ...current, page }))}
            onPageSizeChange={(pageSize) => setMovementMeta((current) => ({ ...current, page: 1, pageSize }))}
          />
          </div>

          {/* Mobile: day divider headers (movementSections group by DAY now,
              so the section label IS the date) with time-only cards. */}
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
                    {movementSelectMode ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isMovementScopeFullySelected(section.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                        }}
                        onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                      />
                    ) : null}
                    <button type="button" className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" onClick={() => toggleMovementSectionCollapsed(section.id)}>
                      {section.label} <span className="font-normal normal-case text-gray-400">· {section.ids.length} {tr('groups', 'groups')} · {getMovementSectionRecordCount(section)} {tr('records', 'records')}</span>
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
                        {movementSelectMode ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isMovementScopeFullySelected(actionGroup.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                            }}
                            onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                          />
                        ) : null}
                        <span>{actionGroup.label} · {actionGroup.items.length} {tr('groups', 'groups')} · {getMovementActionGroupRecordCount(actionGroup)} {tr('records', 'records')}</span>
                      </div>
                    ) : null}
                    {actionGroup.items.map((group) => {
                      const isExpanded = expandedMovementGroups.has(group.id)
                      return (
                        <div key={group.id} className="card overflow-hidden">
                          <div className="flex items-start gap-2 px-3 py-2">
                            {movementSelectMode ? (
                              <label className="inline-flex items-center gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={selectedMovementIds.has(group.id)}
                                  onChange={() => toggleMovementSelection(group.id)}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </label>
                            ) : null}
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left hover:text-blue-600 dark:hover:text-blue-300"
                              onClick={() => toggleMovementGroup(group.id)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="shrink-0 tabular-nums text-[11px] font-medium text-gray-400">{rowClock(group.latest_at)}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${movementColorClass(group)}`}>
                                      {translateMovementType(group.movement_type, t)}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{movementGroupTitle(group, tr)}</div>
                                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-400">
                                    <span>{getMovementRecordCount(group)} {tr('records', 'records')}</span>
                                    {group.branchSummary ? <span>{group.branchSummary}</span> : null}
                                    {group.userSummary ? <span>{group.userSummary}</span> : null}
                                  </div>
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
                              {renderGroupDetail(group)}
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
                    {movementSelectMode ? (
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
                    ) : null}
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">{t('time') || 'Time'}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Activity</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">{t('title') || 'Title'}</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('quantity')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">{t('branch')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden xl:table-cell">{t('user')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={desktopColumnCount} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
                  ) : visibleMovementGroups.length === 0 ? (
                    <tr><td colSpan={desktopColumnCount} className="py-8 text-center text-gray-400">{t('no_data')}</td></tr>
                  ) : movementSections.map((section) => {
                    const isCollapsed = collapsedMovementSections.has(section.id)
                    return (
                    <Fragment key={section.id}>
                      {/* Day divider row -- the section label IS the date now,
                          so every group row below needs only its time. */}
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        {movementSelectMode ? (
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
                        ) : null}
                        <td colSpan={desktopColumnCount - (movementSelectMode ? 1 : 0)} className="px-4 py-2">
                          <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <span>{section.label} <span className="font-normal normal-case text-slate-400">· {section.ids.length} {tr('groups', 'groups')} · {getMovementSectionRecordCount(section)} {tr('records', 'records')}</span></span>
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
                              {movementSelectMode ? (
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
                              ) : null}
                              <td colSpan={desktopColumnCount - (movementSelectMode ? 1 : 0)} className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {actionGroup.label} · {actionGroup.items.length} {tr('groups', 'groups')} · {getMovementActionGroupRecordCount(actionGroup)} {tr('records', 'records')}
                              </td>
                            </tr>
                          ) : null}
                          {actionGroup.items.map((group) => {
                            const isExpanded = expandedMovementGroups.has(group.id)
                            return (
                              <Fragment key={group.id}>
                                <tr className="table-row hover:bg-blue-50 dark:hover:bg-blue-900/10">
                                  {movementSelectMode ? (
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded"
                                        checked={selectedMovementIds.has(group.id)}
                                        onChange={() => toggleMovementSelection(group.id)}
                                        onClick={(event) => event.stopPropagation()}
                                        aria-label={`Select movement group ${group.id}`}
                                      />
                                    </td>
                                  ) : null}
                                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[11px] text-gray-400">{rowClock(group.latest_at)}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${movementColorClass(group)}`}>
                                        {translateMovementType(group.movement_type, t)}
                                      </span>
                                      <span className="text-[10px] text-gray-400">{getMovementRecordCount(group)} {tr('records', 'records')}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">
                                    <button
                                      type="button"
                                      className="inline-flex min-w-0 items-center gap-1.5 text-left hover:text-blue-600 dark:hover:text-blue-300"
                                      onClick={() => toggleMovementGroup(group.id)}
                                    >
                                      <span className="truncate">{movementGroupTitle(group, tr)}</span>
                                      <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                  </td>
                                  <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">{group.totalQuantity}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden lg:table-cell">{group.branchSummary || ''}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden xl:table-cell">{group.userSummary || ''}</td>
                                </tr>
                                {isExpanded ? (
                                  <tr className="bg-gray-50/80 dark:bg-gray-900/30">
                                    <td colSpan={desktopColumnCount} className="px-4 py-3">
                                      {renderGroupDetail(group)}
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
