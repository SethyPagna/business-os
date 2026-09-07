import { useMemo } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import { fetchCurrentShift, type ShiftState } from '../../../api/shiftTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import ShiftHistoryPanel from '../../shifts/ShiftHistoryPanel.tsx'
import ShiftSummary from '../../shifts/ShiftSummary.tsx'
import { shiftFigureRows, shiftFiguresOf, shiftRegisteredCash } from '../../shifts/shiftReportModel.ts'
import { EmptyState, OverflowMenu, Skeleton } from '../../shared/kit'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import { reportFileName } from './reportModel.ts'
import { exportMenuItems, type ReportViewProps } from './reportTypes.ts'

export default function ShiftReport(p: ReportViewProps) {
  const { filters, tr, view } = p
  const branchId = filters.branchId ? Number(filters.branchId) : undefined
  const depsKey = String(branchId ?? '')
  const state = useReportData<ShiftState>(() => fetchCurrentShift(branchId), depsKey)
  const shift = state.data?.shift ?? null

  const rows = useMemo(() => {
    if (!shift) return []
    const registered = shiftRegisteredCash(shift)
    return [
      { Section: tr('shift_registered_cash', 'Registered cash'), Line: tr('shift_registered_open', 'OPEN'), USD: registered.open.usd ?? '', KHR: registered.open.khr ?? '' },
      { Section: tr('shift_registered_cash', 'Registered cash'), Line: tr('shift_registered_end', 'END'), USD: registered.end.usd ?? '', KHR: registered.end.khr ?? '' },
      ...shiftFigureRows(shiftFiguresOf(shift)).map((row) => ({
        Section: tr('shift_report_figures', 'Business results'),
        Line: tr(row.key, row.key === 'credit_awaiting_payment' ? 'Credit' : row.key),
        USD: row.usd,
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
      count={shift?.shift_code}
      hint={{ label: tr('shift_report', 'Shift Report'), text: tr('shift_report_hint', 'Registered OPEN and END cash is report-only. Business results come from sales, COGS, profit, delivery, expenses, refunds, and positive Credit.') }}
      actions={shift ? (
        <div className="flex items-center gap-2">
          <ShiftHistoryPanel branchId={branchId} compact label={tr('shift_history', 'Shift history')} />
          <OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> })} />
        </div>
      ) : <ShiftHistoryPanel branchId={branchId} compact label={tr('shift_history', 'Shift history')} />}
      summary={shift ? `${shift.user_name || tr('shift_staff', 'Staff')} · ${shift.branch_name || tr('all_branches', 'All branches')}` : ''}
      error={state.error}
      onRetry={state.reload}
      retryLabel={tr('retry', 'Retry')}
    >
      {state.loading && !state.data ? <Skeleton rows={6} variant="text" />
        : shift ? <ShiftSummary shift={shift} detail className="report-shift-plain" />
          : <EmptyState icon={<Clock3 />} title={tr('shift_no_current', 'No current shift')} text={tr('shift_no_current_hint', 'Open a shift to see its registered cash and business results.')} />}
    </ReportFrame>
  )
}
