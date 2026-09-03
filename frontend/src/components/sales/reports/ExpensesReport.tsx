// Expenses (the section the user renamed from "Fees") -- by day / by type /
// by label (GET /api/fees/report: totals, days, by_type, by_category) and
// the per-expense list (GET /api/reports/business-summary/expenses). Amounts
// are summed in BOTH currencies with no conversion (a fee is recorded in
// USD or KHR, never both); fmtMoney decides how the pair is shown.
import { useMemo, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { getFeesReport } from '../../../api/feesTransport.ts'
import { getBusinessSummaryExpensesPage } from '../../../api/reportsTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { fmtDateOnly } from '../../../utils/formatters.ts'
import { FEE_TYPE_OPTIONS } from '../../fees/FeeForm.tsx'
import { Button, Chip, Fold, OverflowMenu } from '../../shared/kit'
import ReceiptSheet from './ReceiptSheet.tsx'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import ReportTable, { csvColumnsFor, type ReportColumn } from './ReportTable.tsx'
import { fmtInt, joinSummary, num, pct, reportQueryParams, round2, rowsToCsvObjects, type SortState, countLabel, REPORT_NOUNS } from './reportModel.ts'
import { exportMenuItems, rangeSubtitle, tableLabels, type ReportViewProps, type Tr } from './reportTypes.ts'
import { usePagedReport } from './usePagedReport.ts'

interface Money { count: number; amount_usd: number; amount_khr: number }
interface DayRow extends Money { date: string }
interface TypeRow extends Money { fee_type: string }
interface CategoryRow extends Money { label: string; fee_type: string }
interface FeesReportResponse { totals?: Money; days?: DayRow[]; by_type?: TypeRow[]; by_category?: CategoryRow[] }
export interface ExpenseRow {
  id: number
  date: string
  created_at: string
  type: string
  label: string
  branch: string
  linked_sale_receipt_number: string
  notes: string
  amount_usd: number
  amount_khr: number
}
type Mode = 'days' | 'types' | 'labels' | 'each'

const MODES: Array<{ id: Mode; key: string; fallback: string }> = [
  { id: 'days', key: 'by_day', fallback: 'By day' },
  { id: 'types', key: 'by_type', fallback: 'By type' },
  { id: 'labels', key: 'by_category', fallback: 'By label' },
  { id: 'each', key: 'rpt_each_expense', fallback: 'Each expense' },
]

function money(raw: unknown): Money {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { count: num(r.count), amount_usd: num(r.amount_usd), amount_khr: num(r.amount_khr) }
}
export function mapExpenseRow(raw: unknown, index: number): ExpenseRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    id: num(r.id) || index + 1,
    date: String(r.date || ''),
    created_at: String(r.created_at || ''),
    type: String(r.type || ''),
    label: String(r.label || ''),
    branch: String(r.branch || ''),
    linked_sale_receipt_number: String(r.linked_sale_receipt_number || ''),
    notes: String(r.notes || ''),
    amount_usd: num(r.amount_usd),
    amount_khr: num(r.amount_khr),
  }
}
export function feeTypeLabel(type: string, tr: Tr): string {
  const def = FEE_TYPE_OPTIONS.find((o) => o.value === type)
  return def ? tr(def.labelKey, def.fallback) : type || tr('unknown', 'Unknown')
}
function sumMoney(rows: Money[]): Money {
  return { count: rows.reduce((s, r) => s + r.count, 0), amount_usd: round2(rows.reduce((s, r) => s + r.amount_usd, 0)), amount_khr: Math.round(rows.reduce((s, r) => s + r.amount_khr, 0)) }
}
function matches(text: string, search: string): boolean {
  return !search || text.toLowerCase().includes(search.toLowerCase())
}
function moneyColumns<Row extends Money>(tr: Tr, totalUsd: number): Array<ReportColumn<Row>> {
  return [
    { key: 'count', label: tr('rpt_count', 'Count'), kind: 'int', value: (r) => r.count },
    { key: 'amount', label: tr('amount', 'Amount'), kind: 'money', value: (r) => r.amount_usd, khr: (r) => r.amount_khr, emphasis: true },
    { key: 'share', label: tr('rpt_share', 'Share'), kind: 'pct', value: (r) => pct(r.amount_usd, totalUsd), defaultVisible: false },
  ]
}

export default function ExpensesReport(p: ReportViewProps) {
  const { tr, fmtMoney, style, filters, view, search } = p
  const [mode, setMode] = useState<Mode>('days')
  const params = useMemo(() => reportQueryParams(filters, view), [filters, view])
  const depsKey = JSON.stringify(params)
  const state = useReportData<FeesReportResponse | null>(() => getFeesReport(params) as Promise<FeesReportResponse | null>, depsKey, mode !== 'each')
  const paged = usePagedReport<ExpenseRow>(
    (page) =>
      getBusinessSummaryExpensesPage({
        ...params,
        order: 'desc',
        pageSize: 250,
        snapshotMaxId: page.snapshotMaxId ?? '',
        afterCreatedAt: page.cursor && typeof page.cursor.created_at === 'string' ? page.cursor.created_at : '',
        afterId: page.cursor && page.cursor.id != null ? String(page.cursor.id) : '',
      }),
    depsKey,
    mode === 'each',
    mapExpenseRow,
  )
  const labels = tableLabels(tr)
  const title = tr(view.labelKey, view.fallback)
  const [sort, setSort] = useState<SortState | null>(null)
  const [openRow, setOpenRow] = useState<ExpenseRow | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  const days = useMemo<DayRow[]>(() => (state.data?.days || []).map((d) => ({ ...money(d), date: String(d.date || '') })).filter((d) => matches(fmtDateOnly(d.date), search)), [state.data, search])
  const types = useMemo<TypeRow[]>(() => (state.data?.by_type || []).map((d) => ({ ...money(d), fee_type: String(d.fee_type || '') })).filter((d) => matches(feeTypeLabel(d.fee_type, tr), search)), [state.data, search, tr])
  const categories = useMemo<CategoryRow[]>(() => (state.data?.by_category || []).map((d) => ({ ...money(d), label: String(d.label || ''), fee_type: String(d.fee_type || '') })).filter((d) => matches(`${d.label} ${feeTypeLabel(d.fee_type, tr)}`, search)), [state.data, search, tr])
  const each = useMemo(() => paged.rows.filter((r) => matches(`${r.label} ${feeTypeLabel(r.type, tr)} ${r.notes} ${r.linked_sale_receipt_number} ${r.branch}`, search)), [paged.rows, search, tr])

  const totals: Money = mode === 'each'
    ? { count: each.length, amount_usd: round2(each.reduce((s, r) => s + r.amount_usd, 0)), amount_khr: Math.round(each.reduce((s, r) => s + r.amount_khr, 0)) }
    : mode === 'days' ? sumMoney(days) : mode === 'types' ? sumMoney(types) : sumMoney(categories)
  const serverTotals = state.data?.totals ? money(state.data.totals) : null
  const summary = joinSummary([
    countLabel(totals.count, REPORT_NOUNS.expense, tr, mode === 'each' && paged.hasMore),
    `${tr('amount', 'Amount')} ${fmtMoney(totals.amount_usd, totals.amount_khr)}`,
    serverTotals && mode !== 'each' && search ? `${tr('rpt_of_total', 'of')} ${fmtInt(serverTotals.count)} · ${fmtMoney(serverTotals.amount_usd, serverTotals.amount_khr)}` : null,
  ])

  const dayColumns: Array<ReportColumn<DayRow>> = [
    { key: 'date', label: tr('date', 'Date'), kind: 'date', primary: true, value: (r) => r.date, sortDir: 'asc' },
    ...moneyColumns<DayRow>(tr, totals.amount_usd),
  ]
  const typeColumns: Array<ReportColumn<TypeRow>> = [
    { key: 'fee_type', label: tr('type', 'Type'), primary: true, value: (r) => feeTypeLabel(r.fee_type, tr) },
    ...moneyColumns<TypeRow>(tr, totals.amount_usd),
  ]
  const categoryColumns: Array<ReportColumn<CategoryRow>> = [
    { key: 'label', label: tr('rpt_label', 'Label'), primary: true, value: (r) => r.label || '—' },
    { key: 'fee_type', label: tr('type', 'Type'), value: (r) => feeTypeLabel(r.fee_type, tr) },
    ...moneyColumns<CategoryRow>(tr, totals.amount_usd),
  ]
  const eachColumns: Array<ReportColumn<ExpenseRow>> = [
    { key: 'date', label: tr('date', 'Date'), kind: 'date', primary: true, value: (r) => r.date, sortDir: 'desc' },
    { key: 'label', label: tr('rpt_label', 'Label'), value: (r) => r.label || '—' },
    { key: 'type', label: tr('type', 'Type'), value: (r) => feeTypeLabel(r.type, tr) },
    { key: 'branch', label: tr('branch', 'Branch'), value: (r) => r.branch, defaultVisible: false },
    { key: 'linked_sale_receipt_number', label: tr('receipt', 'Receipt'), value: (r) => r.linked_sale_receipt_number, defaultVisible: false },
    { key: 'notes', label: tr('rpt_notes', 'Notes'), value: (r) => r.notes, defaultVisible: false },
    { key: 'amount', label: tr('amount', 'Amount'), kind: 'money', value: (r) => r.amount_usd, khr: (r) => r.amount_khr, emphasis: true },
  ]

  const fileName = (ext: string) => `expenses-report-${mode}-${filters.startDate || 'all'}_${filters.endDate || 'all'}.${ext}`
  const csvRows = () =>
    mode === 'days' ? rowsToCsvObjects(csvColumnsFor(dayColumns, fmtMoney), days)
      : mode === 'types' ? rowsToCsvObjects(csvColumnsFor(typeColumns, fmtMoney), types)
        : mode === 'labels' ? rowsToCsvObjects(csvColumnsFor(categoryColumns, fmtMoney), categories)
          : rowsToCsvObjects(csvColumnsFor(eachColumns, fmtMoney), each)
  const headers = () => (mode === 'days' ? dayColumns : mode === 'types' ? typeColumns : mode === 'labels' ? categoryColumns : eachColumns).map((c) => c.label)
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
      hint={{ label: title, text: tr('rpt_hint_expenses', 'Recorded expenses by their expense date, in the currency each was recorded in (no conversion). "Net after expenses" on the Overview subtracts this total from gross profit.') }}
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
      {mode === 'days' ? <ReportTable surfaceKey="reports-expenses-days" columns={dayColumns} rows={days} rowKey={(r) => r.date} totalsRow={days.length > 1 ? { ...totals, date: labels.total } : null} {...common} /> : null}
      {mode === 'types' ? <ReportTable surfaceKey="reports-expenses-types" columns={typeColumns} rows={types} rowKey={(r) => r.fee_type || '—'} totalsRow={types.length > 1 ? { ...totals, fee_type: labels.total } : null} {...common} /> : null}
      {mode === 'labels' ? <ReportTable surfaceKey="reports-expenses-labels" columns={categoryColumns} rows={categories} rowKey={(r) => `${r.fee_type}:${r.label}`} totalsRow={categories.length > 1 ? { ...totals, label: labels.total, fee_type: '' } : null} {...common} /> : null}
      {mode === 'each' ? (
        <ReportTable
          surfaceKey="reports-expenses-each"
          columns={eachColumns}
          rows={each}
          rowKey={(r) => String(r.id)}
          totalsRow={each.length > 1 ? { ...mapExpenseRow({}, -1), label: labels.total, amount_usd: totals.amount_usd, amount_khr: totals.amount_khr } : null}
          selectedKey={openRow ? String(openRow.id) : null}
          onRowClick={(row, el) => {
            anchorRef.current = el
            setOpenRow((cur) => (cur?.id === row.id ? null : row))
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
      <Fold open={!!openRow} onClose={() => setOpenRow(null)} anchorRef={anchorRef} title={openRow ? openRow.label || feeTypeLabel(openRow.type, tr) : ''}>
        <div className="p-2">
          {openRow ? (
            <ReceiptSheet
              blocks={[{
                key: 'e',
                lines: [
                  { label: tr('date', 'Date'), value: fmtDateOnly(openRow.date), kind: 'info' },
                  { label: tr('type', 'Type'), value: feeTypeLabel(openRow.type, tr), kind: 'info' },
                  ...(openRow.branch ? [{ label: tr('branch', 'Branch'), value: openRow.branch, kind: 'info' as const }] : []),
                  ...(openRow.linked_sale_receipt_number ? [{ label: tr('receipt', 'Receipt'), value: openRow.linked_sale_receipt_number, kind: 'info' as const }] : []),
                  ...(openRow.notes ? [{ label: tr('rpt_notes', 'Notes'), value: openRow.notes, kind: 'muted' as const }] : []),
                  { label: tr('amount', 'Amount'), value: fmtMoney(openRow.amount_usd, openRow.amount_khr), kind: 'total' },
                ],
              }]}
            />
          ) : null}
        </div>
      </Fold>
    </ReportFrame>
  )
}
