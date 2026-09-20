import { useMemo, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import { fetchShiftHistory, listShifts, type ShiftHistoryResult, type ShiftListResult } from '../../../api/shiftTransport.ts'
import { useApp } from '../../../AppContext.tsx'
import { isAdminControlUser, type PermissionUser } from '../../../utils/permissions.ts'
import AppSelect from '../../shared/AppSelect.tsx'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import ShiftHistoryPanel from '../../shifts/ShiftHistoryPanel.tsx'
import ShiftSummary from '../../shifts/ShiftSummary.tsx'
import { shiftComparisonRows, shiftFigureRows, shiftFiguresOf, shiftRegisteredRows } from '../../shifts/shiftReportModel.ts'
import { EmptyState, OverflowMenu, Skeleton } from '../../shared/kit'
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
  const [selection, setSelection] = useState({ scope: '', id: '' })
  // Dates select complete shift records by business_date, not clipped sales windows.
  const listing = useReportData<ShiftListResult>(() => listShifts({ branchId, from: filters.startDate, to: filters.endDate, limit: 200 }), depsKey)
  const shifts = listing.data?.shifts ?? []
  const selected = selection.scope === depsKey ? shifts.find((row) => String(row.id) === selection.id) : undefined
  const selectedId = selected?.id ?? shifts[0]?.id
  const state = useReportData<ShiftHistoryResult>(
    () => fetchShiftHistory(selectedId!), `${depsKey}:${selectedId ?? ''}`, selectedId != null,
  )
  const receivedShift = state.data?.shift ?? null
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
      secondaryActions={<div className="flex min-w-0 flex-wrap gap-2">
        <AppSelect value={selectedId ?? ''} onChange={(id) => setSelection({ scope: depsKey, id })}
          ariaLabel={tr('shift_history', 'Shift history')} disabled={listing.loading || !shifts.length}
          options={shifts.map((row) => ({ value: row.id, label: `${row.business_date} · ${row.user_name || tr('shift_staff', 'Staff')} · ${row.shift_code}` }))}
          className="min-w-0 max-w-full" />
        <ShiftHistoryPanel branchId={branchId} compact label={tr('shift_history', 'Shift history')} />
      </div>}
      menuAction={p.canExport() ? <OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, p.canExport, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> }).map((item) => ({ ...item, disabled: !shift }))} /> : null}
      summary={shift ? `${shift.user_name || tr('shift_staff', 'Staff')} · ${shift.branch_name || tr('all_branches', 'All branches')}` : ''}
      error={listing.error || state.error}
      onRetry={() => { listing.reload(); state.reload() }}
      retryLabel={tr('retry', 'Retry')}
    >
      {listing.loading || (state.loading && !state.data) ? <Skeleton rows={6} variant="text" />
        : shift ? <ShiftSummary shift={shift} detail className="report-shift-plain" />
          : <EmptyState icon={<Clock3 />} title={tr('shift_no_current', 'No current shift')} text={tr('shift_no_current_hint', 'Open a shift to see its registered cash and business results.')} />}
    </ReportFrame>
  )
}
