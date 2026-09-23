import { useEffect, useMemo, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import {
  fetchShiftHistory,
  listShifts,
  SHIFT_SEARCH_DEBOUNCE_MS,
  SHIFT_SEARCH_MAX_LENGTH,
  type ShiftHistoryResult,
  type ShiftListResult,
} from '../../../api/shiftTransport.ts'
import { useApp } from '../../../AppContext.tsx'
import { fmtDateOnly } from '../../../utils/formatters.ts'
import { isAdminControlUser, type PermissionUser } from '../../../utils/permissions.ts'
import { useDebouncedValue } from '../../../utils/useDebouncedValue.ts'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../../shared/PaginationControls.tsx'
import SuggestionTextInput from '../../shared/SuggestionTextInput.tsx'
import { SHIFT_STATE_CHANGED_EVENT } from '../../pos/ShiftGate.tsx'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import ShiftHistoryPanel from '../../shifts/ShiftHistoryPanel.tsx'
import ShiftSummary from '../../shifts/ShiftSummary.tsx'
import { shiftComparisonRows, shiftFigureRows, shiftFiguresOf, shiftRegisteredRows } from '../../shifts/shiftReportModel.ts'
import { Button, EmptyState, OverflowMenu, Skeleton } from '../../shared/kit'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import { reportFileName } from './reportModel.ts'
import { exportMenuItems, type ReportViewProps } from './reportTypes.ts'

export default function ShiftReport(p: ReportViewProps) {
  const { filters, tr, view } = p
  const { user } = useApp() as { user: PermissionUser & { id?: number | string } }
  const branchId = filters.branchId ? Number(filters.branchId) : undefined
  // The authorized list works for admin-exempt reviewers too. Keep selection
  // scoped to actor/permissions/branch, and load expensive figures on demand.
  const depsKey = JSON.stringify([branchId, filters.startDate, filters.endDate, user?.id, user?.username, user?.role_code, user?.permissions, user?.role_permissions])
  // Owner, 23 Sep 2026: "when entering shift, i can search the cashier, or
  // id." The picker is a search box that also lists the shifts. The search
  // runs on the SERVER (q, cashier name or shift ID) because the list is
  // paged there: filtering the loaded page would miss every older shift. A
  // new search starts again at page 1 and the pager then pages the search.
  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search, SHIFT_SEARCH_DEBOUNCE_MS).trim()
  // Typed but not yet sent: the options on hand answer the previous search.
  const searchPending = search.trim() !== query
  const pageScope = JSON.stringify([depsKey, query])
  const [selection, setSelection] = useState<{ scope: string; id: number | null }>({ scope: '', id: null })
  const [paging, setPaging] = useState({ scope: '', page: 1, size: DEFAULT_PAGE_SIZE })
  const page = paging.scope === pageScope ? paging.page : 1
  const pageSize = paging.size
  const listKey = `${pageScope}:${page}:${pageSize}`
  // Dates select complete shift records by business_date, not clipped sales windows.
  const listing = useReportData<ShiftListResult>(() => listShifts({ branchId, from: filters.startDate, to: filters.endDate, page, pageSize, q: query }, { fresh: true }), listKey)
  const shifts = listing.data?.shifts ?? []
  // A picked shift stays the report until another pick, or until the dates,
  // branch or actor change: searching and paging only change what the picker
  // offers, so looking for the next shift never throws away the one on
  // screen. Before any pick, the newest shift in the current results shows.
  const pickedId = selection.scope === depsKey ? selection.id : null
  const selectedId = pickedId ?? shifts[0]?.id
  const state = useReportData<ShiftHistoryResult>(
    () => fetchShiftHistory(selectedId!), pickedId != null ? `${depsKey}:${pickedId}` : `${listKey}:${selectedId ?? ''}`, selectedId != null,
  )
  const receivedShift = state.data?.shift ?? null
  useEffect(() => {
    const refresh = () => { listing.reload(); state.reload() }
    window.addEventListener(SHIFT_STATE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(SHIFT_STATE_CHANGED_EVENT, refresh)
  }, [listing.reload, state.reload])
  const shift = receivedShift && !isAdminControlUser(user)
    ? { ...receivedShift, reconciliation: null, figures: null } : receivedShift

  const rows = useMemo(() => {
    if (!shift) return []
    return [
      // Open, additional change used, end -- the same shared order the shift
      // screen prints, so an exported row never contradicts the app.
      ...shiftRegisteredRows(shift).map((row) => ({
        Section: tr('shift_registered_cash', 'Registered cash'),
        Line: tr(row.key, row.fallback),
        USD: row.usd ?? '',
        KHR: row.khr ?? '',
      })),
      ...shiftFigureRows(shiftFiguresOf(shift)).map((row) => ({
        Section: tr('shift_report_figures', 'Business results'),
        Line: tr(row.key, row.key === 'credit_awaiting_payment' ? 'Not Paid' : row.key),
        USD: row.usd,
        KHR: row.khr ?? '',
      })),
      ...shiftComparisonRows(shift).map((row) => ({
        Section: tr('shift_cash_breakdown', 'Cash breakdown'),
        Line: tr(row.key, row.key),
        USD: row.usd ?? '',
        KHR: row.khr ?? '',
      })),
    ]
  }, [shift, tr])

  const exportCsv = () => {
    if (shift) downloadCSV(reportFileName(`shift-${shift.shift_code}`, filters, 'csv'), rows)
  }
  const exportPrint = () => {
    if (!shift) return
    openPrintExport({
      title: `${tr('shift_report', 'Shift Report')} · ${shift.shift_code}`,
      subtitle: `${shift.user_name || tr('shift_staff', 'Staff')} · ${shift.branch_name || tr('all_branches', 'All branches')}`,
      headers: ['Section', 'Line', 'USD', 'KHR'],
      rows,
    })
  }

  return (
    <ReportFrame
      title={tr(view.labelKey, view.fallback)}
      titleControl={p.titleControl}
      hint={{ label: tr('shift_report', 'Shift Report'), text: tr('shift_report_hint', 'Registered OPEN and END cash is report-only. Business results come from sales, COGS, profit, delivery, expenses, refunds, and positive Not Paid.') }}
      secondaryActions={<ShiftHistoryPanel branchId={branchId} compact label={tr('shift_history', 'Shift history')} />}
      menuAction={p.canExport() ? <OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, p.canExport, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> }).map((item) => ({ ...item, disabled: !shift }))} /> : null}
      summary={shift ? `${shift.user_name || tr('shift_staff', 'Staff')} · ${shift.branch_name || tr('all_branches', 'All branches')}` : ''}
      error={listing.error || state.error}
      onRetry={() => { listing.reload(); state.reload() }}
      retryLabel={tr('retry', 'Retry')}
    >
      {/* The picker sits at the top of the report body, not on the secondary
          rail: the rail scrolls sideways (overflow-x: auto), which also clips
          vertically, so the list a search box drops would be cut off there.
          Here it floats over the report below it. It is never disabled while
          a page loads -- that would drop the keyboard mid-word. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SuggestionTextInput
          id="shift-report-search"
          className="min-w-[12rem] flex-1"
          value={search}
          // Picking a row chooses the shift and leaves the search as typed,
          // so the next pick is still one tap away in the same results.
          onChange={(text, option) => {
            if (option) setSelection({ scope: depsKey, id: Number(option.payload) })
            else setSearch(text.slice(0, SHIFT_SEARCH_MAX_LENGTH))
          }}
          options={searchPending ? [] : shifts.map((row) => ({
            key: String(row.id),
            value: `${fmtDateOnly(row.business_date)} · ${row.user_name || tr('shift_staff', 'Staff')}`,
            meta: row.shift_code,
            selected: row.id === selectedId,
            payload: row.id,
          }))}
          // The server already matched the search; every row of the page shows.
          filter="none"
          limit={0}
          loading={listing.loading || searchPending}
          loadingLabel={tr('searching', 'Searching...')}
          emptyHint={!listing.data ? undefined : query ? tr('shift_search_no_match', 'No shifts match the search.') : tr('shift_history_empty', 'No shifts recorded.')}
          ariaLabel={tr('shift_search_placeholder', 'Search cashier or ID')}
          placeholder={tr('shift_search_placeholder', 'Search cashier or ID')}
        />
        {!listing.loading && listing.data ? <PaginationControls compact page={listing.data.page ?? page} pageSize={pageSize}
          totalItems={listing.data.total ?? shifts.length} t={(key) => tr(key, key)}
          onPageChange={(next) => setPaging({ scope: pageScope, page: next, size: pageSize })}
          onPageSizeChange={(size) => setPaging({ scope: pageScope, page: 1, size })} /> : null}
      </div>
      {(pickedId == null && listing.loading) || (state.loading && !state.data) ? <Skeleton rows={6} variant="text" />
        : shift ? <ShiftSummary shift={shift} detail className="report-shift-plain" />
          : query && listing.data && !shifts.length
            ? <EmptyState icon={<Clock3 />} title={tr('shift_search_no_match', 'No shifts match the search.')}
              action={<Button size="sm" variant="secondary" onClick={() => setSearch('')}>{tr('clear_search', 'Clear search')}</Button>} />
            : <EmptyState icon={<Clock3 />} title={tr('shift_no_current', 'No current shift')} text={tr('shift_no_current_hint', 'Open a shift to see its registered cash and business results.')} />}
    </ReportFrame>
  )
}
