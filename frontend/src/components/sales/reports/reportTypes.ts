// Shared React-side types for the Reports views (the pure model lives in
// reportModel.ts). Every view receives the same ReportViewProps from
// ReportsHub and renders inside a ReportFrame.
import { fmtDateOnly } from '../../../utils/formatters.ts'
import type { OverflowMenuItem } from '../../shared/kit'
import type { ReportTableLabels } from './ReportTable.tsx'
import type { ReportFilters, ReportOptions, ReportPermissions, ReportStyle, ReportViewDef, ReportViewId } from './reportModel.ts'

export type Tr = (key: string, fallback: string) => string

/** What a drill-down may narrow before switching view (all optional). */
export interface DrillPatch {
  startDate?: string
  endDate?: string
  search?: string
  paymentMethod?: string
  branchId?: string
  view?: ReportViewId
}

export interface ReportViewProps {
  view: ReportViewDef
  filters: ReportFilters
  /** Debounced control-row search (already trimmed). */
  search: string
  options: ReportOptions
  style: ReportStyle
  fmtMoney: (usd: number, khr?: number) => string
  khrToUsd: (khr: number) => number
  tr: Tr
  t: (key: string) => string
  perms: ReportPermissions
  compact: boolean
  onDrill: (patch: DrillPatch) => void
  onOptionsChange: (patch: Partial<ReportOptions>) => void
}

export function tableLabels(tr: Tr): ReportTableLabels {
  return {
    columns: tr('columns', 'Columns'),
    reset: tr('reset', 'Reset'),
    total: tr('total', 'Total'),
    empty: tr('no_data', 'No data found'),
    emptyText: tr('rpt_empty_hint', 'Nothing matches the selected dates and filters.'),
  }
}

/** "dd/mm/yyyy – dd/mm/yyyy" (or "all dates") for export subtitles and fold titles. */
export function rangeSubtitle(filters: { startDate: string; endDate: string; startTime?: string; endTime?: string }, tr: Tr): string {
  const dates = filters.startDate || filters.endDate ? `${filters.startDate ? fmtDateOnly(filters.startDate) : '…'} – ${filters.endDate ? fmtDateOnly(filters.endDate) : '…'}` : tr('rpt_all_dates', 'All dates')
  const times = filters.startTime && filters.endTime && !(filters.startTime === '00:00' && filters.endTime === '23:59') ? ` ${filters.startTime}–${filters.endTime}` : ''
  return `${dates}${times}`
}

export function exportMenuItems(tr: Tr, onCsv: () => void, onPrint: () => void, icons: { csv: OverflowMenuItem['icon']; print: OverflowMenuItem['icon'] }): OverflowMenuItem[] {
  return [
    { label: tr('export_csv', 'Export CSV'), icon: icons.csv, onSelect: onCsv },
    { label: tr('print', 'Print'), icon: icons.print, onSelect: onPrint },
  ]
}
