// Returns -- customer returns in the range (GET /api/returns/report for the
// by-day / by-reason / by-type breakdowns, GET /api/reports/business-summary/
// returns for the per-return list). Refunds are summed in BOTH currencies
// (Part 553): a return is recorded in USD or KHR, never converted, so every
// money cell carries usd + khr and fmtMoney decides how to show them.
import { useMemo, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { getBusinessSummaryReturnsPage } from '../../../api/reportsTransport.ts'
import { getReturnsReport } from '../../../api/returnsReadTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../../utils/formatters.ts'
import { Button, Chip, Fold, OverflowMenu } from '../../shared/kit'
import ReceiptSheet from './ReceiptSheet.tsx'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import ReportTable, { csvColumnsFor, type ReportColumn } from './ReportTable.tsx'
import { fmtInt, joinSummary, num, pct, reportQueryParams, round2, rowsToCsvObjects, type SortState, countLabel, REPORT_NOUNS } from './reportModel.ts'
import { exportMenuItems, rangeSubtitle, tableLabels, type ReportViewProps, type Tr } from './reportTypes.ts'
import { usePagedReport } from './usePagedReport.ts'

interface Money { count: number; refund_usd: number; refund_khr: number }
interface DayRow extends Money { date: string }
interface ReasonRow extends Money { reason: string }
interface TypeRow extends Money { return_type: string }
interface ReturnsReportResponse { totals?: Money; days?: DayRow[]; by_reason?: ReasonRow[]; by_type?: TypeRow[] }
export interface ReturnRow {
  id: number
  return_number: string
  date: string
  business_date: string
  sale_receipt_number: string
  party: string
  scope: string
  type: string
  reason: string
  status: string
  refund_usd: number
  refund_khr: number
}
type Mode = 'days' | 'reasons' | 'types' | 'each'

const MODES: Array<{ id: Mode; key: string; fallback: string }> = [
  { id: 'days', key: 'by_day', fallback: 'By day' },
  { id: 'reasons', key: 'by_reason', fallback: 'By reason' },
  { id: 'types', key: 'by_type', fallback: 'By type' },
  { id: 'each', key: 'rpt_each_return', fallback: 'Each return' },
]

function money(raw: unknown): Money {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { count: num(r.count), refund_usd: num(r.refund_usd), refund_khr: num(r.refund_khr) }
}
export function mapReturnRow(raw: unknown, index: number): ReturnRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    id: num(r.id) || index + 1,
    return_number: String(r.return_number || ''),
    date: String(r.date || ''),
    business_date: String(r.business_date || ''),
    sale_receipt_number: String(r.sale_receipt_number || ''),
    party: String(r.party || ''),
    scope: String(r.scope || 'customer'),
    type: String(r.type || ''),
    reason: String(r.reason || ''),
    status: String(r.status || ''),
    refund_usd: num(r.refund_usd),
    refund_khr: num(r.refund_khr),
  }
}
/** Raw enum-ish values ("store_credit") read as words; unknown values stay as stored. */
export function humanize(value: string): string {
  const s = String(value || '').trim().replace(/_/g, ' ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'
}
function sumMoney(rows: Money[]): Money {
  return { count: rows.reduce((s, r) => s + r.count, 0), refund_usd: round2(rows.reduce((s, r) => s + r.refund_usd, 0)), refund_khr: Math.round(rows.reduce((s, r) => s + r.refund_khr, 0)) }
}
function matches(text: string, search: string): boolean {
  return !search || text.toLowerCase().includes(search.toLowerCase())
}
function moneyColumns<Row extends Money>(tr: Tr, totalUsd: number): Array<ReportColumn<Row>> {
  return [
    { key: 'count', label: tr('rpt_count', 'Count'), kind: 'int', value: (r) => r.count },
    { key: 'refund', label: tr('refunds', 'Refunds'), kind: 'money', value: (r) => r.refund_usd, khr: (r) => r.refund_khr, emphasis: true },
    { key: 'share', label: tr('rpt_share', 'Share'), kind: 'pct', value: (r) => pct(r.refund_usd, totalUsd), defaultVisible: false },
  ]
}

export default function ReturnsReport(p: ReportViewProps) {
  const { tr, t, fmtMoney, style, filters, view, search } = p
  const [mode, setMode] = useState<Mode>('days')
  const params = useMemo(() => ({ ...reportQueryParams(filters, view), scope: 'customer' }), [filters, view])
  const depsKey = JSON.stringify(params)
  const state = useReportData<ReturnsReportResponse | null>(() => getReturnsReport(params) as Promise<ReturnsReportResponse | null>, depsKey, mode !== 'each')
  const paged = usePagedReport<ReturnRow>(
    (page) =>
      getBusinessSummaryReturnsPage({
        ...params,
        order: 'desc',
        pageSize: 250,
        snapshotMaxId: page.snapshotMaxId ?? '',
        afterCreatedAt: page.cursor && typeof page.cursor.created_at === 'string' ? page.cursor.created_at : '',
        afterId: page.cursor && page.cursor.id != null ? String(page.cursor.id) : '',
      }),
    depsKey,
    mode === 'each',
    mapReturnRow,
  )
  const labels = tableLabels(tr)
  const title = tr(view.labelKey, view.fallback)
  const [sort, setSort] = useState<SortState | null>(null)
  const [openRow, setOpenRow] = useState<ReturnRow | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  const days = useMemo<DayRow[]>(() => (state.data?.days || []).map((d) => ({ ...money(d), date: String(d.date || '') })).filter((d) => matches(fmtDateOnly(d.date), search)), [state.data, search])
  const reasons = useMemo<ReasonRow[]>(() => (state.data?.by_reason || []).map((d) => ({ ...money(d), reason: String(d.reason || '') })).filter((d) => matches(d.reason, search)), [state.data, search])
  const types = useMemo<TypeRow[]>(() => (state.data?.by_type || []).map((d) => ({ ...money(d), return_type: String(d.return_type || '') })).filter((d) => matches(humanize(d.return_type), search)), [state.data, search])
  const each = useMemo(() => paged.rows.filter((r) => matches(`${r.return_number} ${r.sale_receipt_number} ${r.party} ${r.reason} ${humanize(r.type)}`, search)), [paged.rows, search])

  const totals: Money = mode === 'each'
    ? { count: each.length, refund_usd: round2(each.reduce((s, r) => s + r.refund_usd, 0)), refund_khr: Math.round(each.reduce((s, r) => s + r.refund_khr, 0)) }
    : mode === 'days' ? sumMoney(days) : mode === 'reasons' ? sumMoney(reasons) : sumMoney(types)
  const serverTotals = state.data?.totals ? money(state.data.totals) : null
  const summary = joinSummary([
    countLabel(totals.count, REPORT_NOUNS.return, tr, mode === 'each' && paged.hasMore),
    `${tr('refunds', 'Refunds')} ${fmtMoney(totals.refund_usd, totals.refund_khr)}`,
    serverTotals && mode !== 'each' && search ? `${tr('rpt_of_total', 'of')} ${fmtInt(serverTotals.count)} · ${fmtMoney(serverTotals.refund_usd, serverTotals.refund_khr)}` : null,
  ])

  const dayColumns: Array<ReportColumn<DayRow>> = [
    { key: 'date', label: tr('date', 'Date'), kind: 'date', primary: true, value: (r) => r.date, sortDir: 'asc' },
    ...moneyColumns<DayRow>(tr, totals.refund_usd),
  ]
  const reasonColumns: Array<ReportColumn<ReasonRow>> = [
    { key: 'reason', label: tr('reason', 'Reason'), primary: true, value: (r) => r.reason || '—' },
    ...moneyColumns<ReasonRow>(tr, totals.refund_usd),
  ]
  const typeColumns: Array<ReportColumn<TypeRow>> = [
    { key: 'return_type', label: tr('type', 'Type'), primary: true, value: (r) => humanize(r.return_type) },
    ...moneyColumns<TypeRow>(tr, totals.refund_usd),
  ]
  const eachColumns: Array<ReportColumn<ReturnRow>> = [
    { key: 'return_number', label: tr('rpt_return_no', 'Return #'), primary: true, value: (r) => r.return_number },
    { key: 'date', label: tr('date', 'Date'), kind: 'datetime', value: (r) => r.date, sortDir: 'desc' },
    { key: 'sale_receipt_number', label: tr('receipt', 'Receipt'), value: (r) => r.sale_receipt_number },
    { key: 'party', label: tr('customer', 'Customer'), value: (r) => r.party || tr('walk_in', 'Walk-in') },
    { key: 'type', label: tr('type', 'Type'), value: (r) => humanize(r.type) },
    { key: 'reason', label: tr('reason', 'Reason'), value: (r) => r.reason },
    { key: 'status', label: tr('status', 'Status'), value: (r) => humanize(r.status), defaultVisible: false },
    { key: 'refund', label: tr('refunds', 'Refunds'), kind: 'money', value: (r) => r.refund_usd, khr: (r) => r.refund_khr, emphasis: true },
  ]

  const fileName = (ext: string) => `returns-report-${mode}-${filters.startDate || 'all'}_${filters.endDate || 'all'}.${ext}`
  const csvRows = () =>
    mode === 'days' ? rowsToCsvObjects(csvColumnsFor(dayColumns, fmtMoney), days)
      : mode === 'reasons' ? rowsToCsvObjects(csvColumnsFor(reasonColumns, fmtMoney), reasons)
        : mode === 'types' ? rowsToCsvObjects(csvColumnsFor(typeColumns, fmtMoney), types)
          : rowsToCsvObjects(csvColumnsFor(eachColumns, fmtMoney), each)
  const headers = () => (mode === 'days' ? dayColumns : mode === 'reasons' ? reasonColumns : mode === 'types' ? typeColumns : eachColumns).map((c) => c.label)
  const exportCsv = () => downloadCSV(fileName('csv'), csvRows())
  const exportPrint = () => openPrintExport({ title: `${tr('reports', 'Reports')} · ${title} · ${tr(MODES.find((m) => m.id === mode)!.key, MODES.find((m) => m.id === mode)!.fallback)}`, subtitle: rangeSubtitle(filters, tr), headers: headers(), rows: csvRows() })

  const loading = mode === 'each' ? paged.loading : state.loading
  const error = mode === 'each' ? paged.error : state.error
  const reload = mode === 'each' ? paged.reload : state.reload
  const common = { style, fmtMoney, labels, loading, sort, onSortChange: setSort, maxHeight: '70vh' as const }

  return (
    <ReportFrame
      title={title}
      count={totals.count ? `${fmtInt(totals.count)}${mode === 'each' && paged.hasMore ? '+' : ''}` : undefined}
      hint={{ label: title, text: tr('rpt_hint_returns', 'Customer returns that are not cancelled, by the return’s business date. Refunds are shown in the currency they were recorded in; the same refunds are already subtracted from Revenue.') }}
      actions={
        <>
          {MODES.map((m) => (
            <Chip key={m.id} selected={mode === m.id} onClick={() => { setMode(m.id); setSort(null); setOpenRow(null) }}>
              {tr(m.key, m.fallback)}
            </Chip>
          ))}
          <OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> })} />
        </>
      }
      summary={summary}
      error={error}
      onRetry={reload}
      retryLabel={tr('retry', 'Retry')}
    >
      {mode === 'days' ? <ReportTable surfaceKey="reports-returns-days" columns={dayColumns} rows={days} rowKey={(r) => r.date} totalsRow={days.length > 1 ? { ...totals, date: labels.total } : null} {...common} /> : null}
      {mode === 'reasons' ? <ReportTable surfaceKey="reports-returns-reasons" columns={reasonColumns} rows={reasons} rowKey={(r) => r.reason || '—'} totalsRow={reasons.length > 1 ? { ...totals, reason: labels.total } : null} {...common} /> : null}
      {mode === 'types' ? <ReportTable surfaceKey="reports-returns-types" columns={typeColumns} rows={types} rowKey={(r) => r.return_type || '—'} totalsRow={types.length > 1 ? { ...totals, return_type: labels.total } : null} {...common} /> : null}
      {mode === 'each' ? (
        <ReportTable
          surfaceKey="reports-returns-each"
          columns={eachColumns}
          rows={each}
          rowKey={(r) => `${r.id}:${r.return_number}`}
          totalsRow={each.length > 1 ? { ...mapReturnRow({}, -1), return_number: labels.total, refund_usd: totals.refund_usd, refund_khr: totals.refund_khr } : null}
          selectedKey={openRow ? `${openRow.id}:${openRow.return_number}` : null}
          onRowClick={(row, el) => {
            anchorRef.current = el
            setOpenRow((cur) => (cur && cur.id === row.id && cur.return_number === row.return_number ? null : row))
          }}
          footer={
            paged.hasMore ? (
              <div className="flex items-center gap-2 text-[length:var(--ui-size-meta)] text-[var(--ui-ink-3)]">
                <Button size="sm" variant="secondary" loading={paged.loadingMore} onClick={paged.loadMore}>{tr('load_more', 'Load more')}</Button>
                <span>{fmtInt(paged.rows.length)} {tr('rpt_loaded', 'loaded')}</span>
              </div>
            ) : null
          }
          {...common}
        />
      ) : null}
      <Fold open={!!openRow} onClose={() => setOpenRow(null)} anchorRef={anchorRef} title={openRow ? `${tr('rpt_return_no', 'Return #')} ${openRow.return_number}` : ''}>
        <div className="p-2">
          {openRow ? (
            <ReceiptSheet
              blocks={[{
                key: 'r',
                lines: [
                  { label: tr('date', 'Date'), value: fmtDateTime24(openRow.date), kind: 'info' },
                  { label: tr('receipt', 'Receipt'), value: openRow.sale_receipt_number || '—', kind: 'info' },
                  { label: tr('customer', 'Customer'), value: openRow.party || tr('walk_in', 'Walk-in'), kind: 'info' },
                  { label: tr('type', 'Type'), value: humanize(openRow.type), kind: 'info' },
                  { label: tr('reason', 'Reason'), value: openRow.reason || '—', kind: 'info' },
                  { label: tr('status', 'Status'), value: humanize(openRow.status), kind: 'info' },
                  { label: tr('refunds', 'Refunds'), value: fmtMoney(openRow.refund_usd, openRow.refund_khr), kind: 'total' },
                ],
              }]}
            />
          ) : null}
        </div>
      </Fold>
      <span hidden>{typeof t === 'function' ? '' : null}</span>
    </ReportFrame>
  )
}
