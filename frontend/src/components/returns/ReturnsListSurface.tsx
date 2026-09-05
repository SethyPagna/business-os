import { Fragment, useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import { consumeLongPressClick, createLongPressHandlers, type LongPressState } from '../../utils/longPress.ts'
import ColumnChooser from '../shared/ColumnChooser.tsx'
import { useColumnPreferences } from '../shared/useColumnPreferences.ts'
import type { TableColumnDef } from '../shared/columnPreferences.ts'

// Optional (toggleable) large-screen columns for the returns list. Stable
// module-level identity so useColumnPreferences doesn't churn; labels are
// translated at render for the chooser only. Status (default on) fills the
// audit gap where the returns list had no status column.
const RETURN_OPTIONAL_COLUMNS: TableColumnDef[] = [
  { key: 'status', label: 'Status' },
  // N13: branch shown consistently with the sales list's branch column
  // (default-visible), closing the gap where returns had no branch at all.
  { key: 'branch', label: 'Branch' },
  { key: 'cashier', label: 'Cashier', defaultVisible: false },
]

const deferredMobileCardStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '128px',
}

const deferredDesktopRowStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '56px',
}

type TranslateFn = (key: string, fallbackEn?: string, fallbackKm?: string) => string
type BasicTranslateFn = (key: string) => string

interface ReturnRecord {
  id: number | string
  return_number?: string
  created_at?: string
  receipt_number?: string
  return_scope?: string
  supplier_settlement?: string
  return_type?: string
  supplier_name?: string
  customer_name?: string
  reason?: string
  status?: string
  cashier_name?: string
  branch_name?: string | null
  // Counted by the list read itself (routes/returns.ts DAMAGED_ITEM_COUNT_SQL)
  // so a damaged line is visible on the row -- the list shows one row per
  // return and never its items, so this used to require opening the return.
  damaged_item_count?: number
}

interface ReturnGroup {
  id: string
  label: string
  ids: number[]
  items: ReturnRecord[]
}

interface ReturnSection {
  id: string
  label: string
  ids: number[]
  items: ReturnRecord[]
  groups: ReturnGroup[]
}

interface ReturnsListSurfaceProps {
  collapsedReturnSections: Set<string>
  CUSTOMER_SCOPE: string
  filtered: ReturnRecord[]
  fmtTime: (value?: string) => string
  isSelectionScopeFullySelected: (ids: number[]) => boolean
  isSelectionScopePartiallySelected: (ids: number[]) => boolean
  loading: boolean
  normalizeScope: (scope?: string) => string
  renderAmount: (ret: ReturnRecord) => ReactNode
  /** Predicate: does this return count toward the refund money shown?
   * Cancelled returns are excluded from the refund figures, so they are
   * excluded from the day-group counts too — keeping the count reconciled
   * with the money (user, Aug 31: "count only what the money counts"). */
  isCountedReturn: (ret: ReturnRecord) => boolean
  returnSections: ReturnSection[]
  scope: string
  selectAllRef: RefObject<HTMLInputElement>
  selectedIds: Set<number>
  // 11.1/11.2 (B6), same selection model as Products/Inventory/Sales:
  // checkboxes and the select column only exist while something IS
  // selected; enter select mode by long-pressing a row (click-and-hold
  // with a mouse). The desktop column-header checkbox is select-all.
  selectionModeActive: boolean
  getReturnLongPressState: (rowId: number) => LongPressState
  setDetailRet: (ret: ReturnRecord) => void
  showReturnActionGroups: boolean
  SUPPLIER_SCOPE: string
  t: BasicTranslateFn
  toggleReturnSection: (sectionId: string) => void
  toggleSelected: (returnId: ReturnRecord['id']) => void
  toggleSelectAll: (selected: boolean) => void
  toggleSelectionScope: (ids: number[], selected: boolean) => void
  tr: TranslateFn
  visibleIds: number[]
}

function detectMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 767px)').matches
}

function ReturnsDesktopSkeletonRows() {
  return Array.from({ length: 4 }).map((_, index) => (
    <tr key={`returns-desktop-skeleton-${index}`} className="animate-pulse">
      {/* Select column collapsed while loading (selection can't be active). */}
      <td className="px-0 py-3" />
      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-orange-100 dark:bg-orange-900/40" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-5 w-20 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-2 py-3"><div className="ml-auto h-6 w-6 rounded bg-slate-200 dark:bg-slate-700" /></td>
    </tr>
  ))
}

function ReturnsMobileSkeletonCards() {
  return Array.from({ length: 3 }).map((_, index) => (
    <div key={`returns-mobile-skeleton-${index}`} className="card animate-pulse p-3">
      <div className="mb-3 flex items-center gap-2">
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
  isCountedReturn,
  returnSections,
  scope,
  selectAllRef,
  selectedIds,
  selectionModeActive,
  getReturnLongPressState,
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
}: ReturnsListSurfaceProps) {
  let desktopRenderedRowCount = 0
  const [isMobileViewport, setIsMobileViewport] = useState(() => detectMobileViewport())
  // 11.1: the checkbox column only takes space in select mode.
  const selectCellPad = selectionModeActive ? 'px-3' : 'px-0'
  const cols = useColumnPreferences('returns', RETURN_OPTIONAL_COLUMNS)
  // The column chooser belongs in the actual table header, not in a detached
  // strip above it. Keep an aligned trailing cell for every body state.
  const columnCount = 9 + cols.visibleCount
  const chooserColumns = RETURN_OPTIONAL_COLUMNS.map((column) => ({ ...column, label: tr(column.key, column.label) }))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 767px)')
    const apply = () => setIsMobileViewport(media.matches)
    apply()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    media.addListener(apply)
    return () => media.removeListener(apply)
  }, [])

  return (
    <>
      {!isMobileViewport ? (
      <div className="desktop-dense-only dense-data-shell">
        <div className="overflow-x-auto">
          <table className="dense-data-table min-w-[720px]">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className={`${selectionModeActive ? 'w-10' : 'w-0'} ${selectCellPad} py-3`}>
                  {selectionModeActive ? (
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={visibleIds.length > 0 && selectedIds.size === visibleIds.length}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                      aria-label="Select all returns"
                    />
                  ) : null}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('return_number', 'Return #')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('date', 'Date')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('reference', 'Reference')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{scope === SUPPLIER_SCOPE ? tr('supplier', 'Supplier') : tr('customer', 'Customer')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('reason', 'Reason')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('type', 'Type')}</th>
                {cols.isVisible('status') ? <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('status', 'Status')}</th> : null}
                {cols.isVisible('branch') ? <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('branch', 'Branch')}</th> : null}
                {cols.isVisible('cashier') ? <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('cashier', 'Cashier')}</th> : null}
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{tr('amount', 'Amount')}</th>
                <th className="w-10 px-2 py-2 text-right"><ColumnChooser columns={chooserColumns} isVisible={cols.isVisible} toggle={cols.toggle} reset={cols.reset} label={tr('columns', 'Columns')} resetLabel={tr('reset', 'Reset')} /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <ReturnsDesktopSkeletonRows />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={columnCount} className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</td></tr>
              ) : returnSections.map((section) => {
                const isCollapsed = collapsedReturnSections.has(section.id)
                // Money-counting count (cancelled returns excluded), so the
                // per-day counts reconcile with the refund figures.
                const countedCount = section.items.filter(isCountedReturn).length
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                      <td colSpan={columnCount} className="px-4 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                          <label className="inline-flex items-center gap-2 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
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
                          </label>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400">{countedCount}</span>
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
                            <td colSpan={columnCount} className="px-6 py-2">
                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                <label className="inline-flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
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
                          const rowSelected = selectedIds.has(Number(ret.id))
                          // Same long-press-to-select-mode pattern as Products/
                          // Inventory/Sales rows.
                          const rowLongPressState = getReturnLongPressState(Number(ret.id))
                          const longPress = createLongPressHandlers(rowLongPressState, {
                            disabled: selectionModeActive,
                            onLongPress: () => toggleSelected(ret.id),
                            onClick: () => setDetailRet(ret),
                          })
                          const handleRowClick = () => {
                            if (consumeLongPressClick(rowLongPressState)) return
                            toggleSelected(ret.id)
                          }
                          return (
                            <tr
                              key={ret.id}
                              className={`table-row cursor-pointer select-none hover:bg-orange-50 dark:hover:bg-orange-900/10 ${rowSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}
                              data-clickable="true"
                              tabIndex={0}
                              style={desktopRowIndex >= 12 ? deferredDesktopRowStyle : undefined}
                              onClick={selectionModeActive ? handleRowClick : undefined}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return
                                event.preventDefault()
                                if (selectionModeActive) handleRowClick()
                                else setDetailRet(ret)
                              }}
                              {...(selectionModeActive ? {} : longPress)}
                            >
                              <td className={`${selectCellPad} py-2.5`} onClick={(event) => event.stopPropagation()}>
                                {selectionModeActive ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={rowSelected}
                                  onChange={() => toggleSelected(ret.id)}
                                  aria-label={`Select ${ret.return_number}`}
                                />
                                ) : null}
                              </td>
                              <td className="dense-id whitespace-nowrap font-medium text-orange-600 dark:text-orange-400">
                                {ret.return_number}
                                {(ret.damaged_item_count || 0) > 0 ? (
                                  <span
                                    data-tag="damaged"
                                    title={tr('stock_action_damaged_hint', 'Tracked as a damaged lot tied to this return — kept out of sellable stock.')}
                                    className="ml-1 inline-flex items-center rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                                  >
                                    {ret.damaged_item_count} {tr('damaged_items_tag', 'damaged')}
                                  </span>
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap text-gray-500">{fmtTime(ret.created_at)}</td>
                              <td>
                                {ret.receipt_number
                                  ? <span className="dense-cell-truncate dense-id text-blue-600 dark:text-blue-400" title={ret.receipt_number}>{ret.receipt_number}</span>
                                  : <span className="text-xs text-gray-400">{tr('manual_return', 'Manual')}</span>}
                              </td>
                              <td className="text-gray-700 dark:text-gray-300"><span className="dense-cell-truncate" title={retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}>{retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}</span></td>
                              <td className="text-gray-700 dark:text-gray-300"><span className="dense-cell-truncate" title={ret.reason || '-'}>{ret.reason || '-'}</span></td>
                              <td>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-700 dark:text-gray-200">{typeLabel}</span>
                              </td>
                              {cols.isVisible('status') ? (
                                <td>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${(ret.status || 'completed') === 'cancelled' ? 'bg-gray-100 text-gray-500 dark:bg-zinc-700 dark:text-gray-400' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>{tr(`status_${ret.status || 'completed'}`, ret.status || 'completed')}</span>
                                </td>
                              ) : null}
                              {cols.isVisible('branch') ? (
                                <td className="text-gray-500 dark:text-gray-400"><span className="dense-cell-truncate" title={ret.branch_name || '-'}>{ret.branch_name || '-'}</span></td>
                              ) : null}
                              {cols.isVisible('cashier') ? (
                                <td className="text-gray-500 dark:text-gray-400"><span className="dense-cell-truncate" title={ret.cashier_name || '-'}>{ret.cashier_name || '-'}</span></td>
                              ) : null}
                              <td className="text-right">{renderAmount(ret)}</td>
                              <td className="w-10 px-2 py-2" aria-hidden="true" />
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
      ) : null}

      {isMobileViewport ? (
      <div className="mobile-cards-only space-y-2">
        {loading ? (
          <ReturnsMobileSkeletonCards />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</div>
        ) : returnSections.map((section) => {
          const isCollapsed = collapsedReturnSections.has(section.id)
          const countedCount = section.items.filter(isCountedReturn).length
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
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
                      </label>
                    </div>
                  ) : null}
                  {group.items.map((ret, index) => {
                    const retScope = normalizeScope(ret.return_scope)
                    const cardSelected = selectedIds.has(Number(ret.id))
                    // Mobile mirror of the desktop rows' long-press pattern
                    // (one shared per-return state slot; only one layout is
                    // interactive at a given viewport width).
                    const cardLongPressState = getReturnLongPressState(Number(ret.id))
                    const cardLongPress = createLongPressHandlers(cardLongPressState, {
                      disabled: selectionModeActive,
                      onLongPress: () => toggleSelected(ret.id),
                      onClick: () => setDetailRet(ret),
                    })
                    const handleCardClick = () => {
                      if (consumeLongPressClick(cardLongPressState)) return
                      toggleSelected(ret.id)
                    }
                    return (
                      <div
                        key={ret.id}
                        className={`card cursor-pointer select-none p-3 ${cardSelected ? 'ring-1 ring-orange-300 bg-orange-50/60 dark:ring-orange-700 dark:bg-orange-900/20' : ''}`}
                        style={index >= 8 ? deferredMobileCardStyle : undefined}
                        onClick={selectionModeActive ? handleCardClick : undefined}
                        {...(selectionModeActive ? {} : cardLongPress)}
                      >
                        {selectionModeActive ? (
                        <div className="mb-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={cardSelected}
                            onChange={() => toggleSelected(ret.id)}
                            aria-label={`Select ${ret.return_number}`}
                          />
                        </div>
                        ) : null}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">{ret.return_number}</span>
                              {(ret.damaged_item_count || 0) > 0 ? (
                                <span
                                  data-tag="damaged"
                                  title={tr('stock_action_damaged_hint', 'Tracked as a damaged lot tied to this return — kept out of sellable stock.')}
                                  className="inline-flex items-center rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                                >
                                  {ret.damaged_item_count} {tr('damaged_items_tag', 'damaged')}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-400">{fmtTime(ret.created_at)}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">{ret.reason}</div>
                            <div className="mt-0.5 text-xs text-gray-400">{retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}</div>
                            {/* N13: branch + cashier shown consistently with
                                the sales phone card's meta line. */}
                            {ret.branch_name || ret.cashier_name ? (
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
                                {ret.branch_name ? <span>{ret.branch_name}</span> : null}
                                {ret.cashier_name ? <span>{ret.branch_name ? '| ' : ''}{ret.cashier_name}</span> : null}
                              </div>
                            ) : null}
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
      ) : null}
    </>
  )
}
