import { useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { useApp } from '../../../AppContext.tsx'
import { captureActorReadScope } from '../../../api/actorReadScope.ts'
import { getBusinessSummaryReturnsPage, getBusinessSummaryExpensesPage } from '../../../api/reportsTransport.ts'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import Modal from '../../shared/Modal.tsx'
import InfoHint from '../../shared/InfoHint.tsx'
import { toolbarIconButtonClassName } from '../../shared/toolbarButtonStyles.ts'
import { Button, Skeleton } from '../../shared/kit'
import ReportTable, { type ReportColumn } from './ReportTable.tsx'
import { useReportExport } from './salesListExport.ts'
import { ReportExportError } from './reportExportCollection.ts'
import { collectRecordExport, selectRecordExport, recordExportObjects, recordExportWorksheet, recordExportPrint,
  type RecordExportRow, type RecordExportKind, type RecordExportTotals, type RecordExportDocument } from './recordReportExport.ts'
import { fmtInt, countLabel, REPORT_NOUNS } from './reportModel.ts'
import { rangeSubtitle, tableLabels, type ReportViewProps } from './reportTypes.ts'
import type { QueryParams } from '../../../api/query.ts'

export function useRecordReportExporter<Row extends RecordExportRow>(p: ReportViewProps, kind: RecordExportKind, mode: string, query: QueryParams,
 columns: Array<ReportColumn<Row>>, totalsRow: (totals: RecordExportTotals) => Row, predicate: (row: Row) => boolean) {
  const { language, exchangeRate, settings, user } = (useApp() || {}) as {
    language?: string; exchangeRate?: number; settings?: { business_name?: unknown }
    user?: { id?: unknown; permissions?: unknown; role_permissions?: unknown }
  }
  const key = JSON.stringify({ kind, mode, query, view: p.view.id, search: p.search, immediateSearch: p.exportScopeKey,
    options: p.options, style: p.style, language, exchangeRate, business: settings?.business_name,
    actor: captureActorReadScope(`reports:${kind}`), user: [user?.id, user?.permissions, user?.role_permissions] })
  const exporter = useReportExport({ key, query, channel: `reports:${kind}`,
    canExport: () => p.canExport() && (p.exportScopeKey === undefined || p.exportScopeKey.trim() === p.search),
    collect: (params, current) => collectRecordExport(kind, params, kind === 'returns' ? getBusinessSummaryReturnsPage : getBusinessSummaryExpensesPage, current),
    document: result => {
      const selected = selectRecordExport(kind, result, row => predicate(row as Row))
      return { ...selected, totals: totalsRow(selected.totals), columns: columns as unknown as RecordExportDocument['columns'],
        title: `${p.tr('reports', 'Reports')} · ${p.tr(p.view.labelKey, p.view.fallback)}`, subtitle: rangeSubtitle(p.filters, p.tr),
        language: language || 'en', filename: `${kind}-report-each-${p.filters.startDate || 'all'}_${p.filters.endDate || 'all'}`, fmtMoney: p.fmtMoney,
        metadata: [String(settings?.business_name || ''), countLabel(selected.rowCount, kind === 'returns' ? REPORT_NOUNS.return : REPORT_NOUNS.expense, p.tr),
          `${p.tr('rpt_export_generated', 'Generated')}: ${fmtDateTime24(new Date().toISOString())} (UTC+7)`].filter(Boolean) }
    }, objects: document => recordExportObjects(document, true), worksheet: recordExportWorksheet, printInput: recordExportPrint,
  })
  const messages = {
    invalid: p.tr('rpt_export_invalid', 'The report could not be verified. Try again.'),
    empty: p.tr('no_data_to_export', 'No data to export'),
    large: p.tr('rpt_export_too_large', 'This report is too large to export. Narrow the dates or filters.'),
    changed: p.tr('rpt_export_changed', 'Report data changed. Prepare the export again.'),
    unavailable: p.tr('rpt_export_unavailable', 'This export is no longer available. Prepare it again.'),
  }
  return { ...exporter, errorMessage: exporter.error ? exporter.error instanceof ReportExportError ? messages[exporter.error.code] : p.tr('export_failed', 'Export failed') : null }
}
export default function RecordReportExport({ exporter, p, kind }: {
 exporter: ReturnType<typeof useRecordReportExporter>; p: ReportViewProps; kind: RecordExportKind
}) {
  const [limit, setLimit] = useState(250)
  const completed = exporter.document, tr = p.tr
  return <>
    {exporter.busy ? <div aria-busy="true" aria-label={tr('rpt_export_preparing', 'Preparing the complete report…')}><Skeleton rows={4} /></div> : null}
    {completed ? <Modal title={`${tr('rpt_export_preview', 'Export preview')} · ${countLabel(completed.rowCount, kind === 'returns' ? REPORT_NOUNS.return : REPORT_NOUNS.expense, tr)}`}
      onClose={exporter.close} size="xl" unsavedChanges="read-only" headerExtra={<span className="flex shrink-0 items-center">
        <InfoHint label={tr('rpt_export_preview', 'Export preview')} text={kind === 'returns'
          ? tr('rpt_export_money_note', 'Excel amounts are in USD. Preview and print use the selected currency.') : `${tr('currency', 'Currency')} · USD / KHR`} />
        <button type="button" className={toolbarIconButtonClassName} aria-label={tr('export_csv', 'Export CSV')} title={tr('export_csv', 'Export CSV')} onClick={exporter.csv}><Download className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={toolbarIconButtonClassName} aria-label={tr('rpt_export_excel', 'Export Excel')} title={tr('rpt_export_excel', 'Export Excel')} onClick={() => { void exporter.excel() }}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={toolbarIconButtonClassName} aria-label={tr('print', 'Print')} title={tr('print', 'Print')} onClick={exporter.print}><Printer className="h-4 w-4" aria-hidden="true" /></button>
      </span>}>
      <div data-reports-fold className="min-w-0">
        <p className="mb-2 text-xs">{[completed.subtitle, ...completed.metadata].join(' · ')}</p>
        <ReportTable surfaceKey={`reports-${kind}-export`} columns={completed.columns} rows={completed.rows.slice(0, limit)} rowKey={row => String(row.id)}
          style="excel" fmtMoney={completed.fmtMoney} labels={tableLabels(tr)} totalsRow={completed.totals} maxHeight="calc(50 * var(--app-vh))"
          footer={completed.rowCount > limit ? <Button size="sm" className="min-h-11 min-w-11" variant="secondary" onClick={() => setLimit(n => n + 250)}>{tr('load_more', 'Load more')} ({fmtInt(Math.min(limit, completed.rowCount))}/{fmtInt(completed.rowCount)})</Button> : null} />
      </div>
    </Modal> : null}
  </>
}
