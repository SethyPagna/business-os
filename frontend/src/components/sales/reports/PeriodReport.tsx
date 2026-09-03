// By period -- canonical totals per day / week / month (GET
// /api/reports/periods). The granularity chips ride the title row; a row
// opens a Fold with that period's own statement and a "View sales" drill
// that narrows the per-receipt list to the period.
import { useMemo, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { getReportPeriods } from '../../../api/reportsTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { fmtDateOnly } from '../../../utils/formatters.ts'
import { Button, Chip, Fold, OverflowMenu } from '../../shared/kit'
import ReceiptSheet from './ReceiptSheet.tsx'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import ReportTable, { csvColumnsFor, type ReportColumn } from './ReportTable.tsx'
import {
  BASIS_LABELS,
  basisValue,
  buildIncomeStatement,
  countLabel,
  fmtInt,
  fmtPct,
  hasProfit,
  joinSummary,
  normalizeTotals,
  num,
  pct,
  periodLabel,
  REPORT_NOUNS,
  reportFileName,
  reportQueryParams,
  rowsToCsvObjects,
  sumTotals,
  type ReportGranularity,
  type ReportTotals,
  type SortState,
} from './reportModel.ts'
import { exportMenuItems, rangeSubtitle, tableLabels, type ReportViewProps } from './reportTypes.ts'

export interface PeriodRow extends ReportTotals {
  period: string
  date_from: string
  date_to: string
  days: number
}

const GRANULARITIES: Array<{ id: ReportGranularity; key: string; fallback: string }> = [
  { id: 'day', key: 'day', fallback: 'Day' },
  { id: 'week', key: 'rpt_week', fallback: 'Week' },
  { id: 'month', key: 'month', fallback: 'Month' },
]

export default function PeriodReport(p: ReportViewProps) {
  const { tr, fmtMoney, options, style, filters, view } = p
  const g = options.granularity
  const params = useMemo(() => ({ ...reportQueryParams(filters, view), granularity: g }), [filters, view, g])
  const depsKey = JSON.stringify(params)
  const state = useReportData<{ rows?: unknown[] }>(() => getReportPeriods(params) as Promise<{ rows?: unknown[] }>, depsKey)

  const rows = useMemo<PeriodRow[]>(
    () =>
      (state.data?.rows || [])
        .map((raw) => {
          const totals = normalizeTotals(raw)
          if (!totals) return null
          const r = raw as Record<string, unknown>
          return { ...totals, period: String(r.period || ''), date_from: String(r.date_from || ''), date_to: String(r.date_to || ''), days: num(r.days) }
        })
        .filter((r): r is PeriodRow => !!r),
    [state.data],
  )
  const totals = useMemo(() => sumTotals(rows), [rows])
  const showProfit = rows.length > 0 && rows.every((r) => hasProfit(r))
  const basisLabel = tr(BASIS_LABELS[options.basis].key, BASIS_LABELS[options.basis].fallback)
  const fmtDate = (iso: string) => fmtDateOnly(iso)

  const columns = useMemo<Array<ReportColumn<PeriodRow>>>(() => {
    const list: Array<ReportColumn<PeriodRow> | null> = [
      { key: 'period', label: tr('period', 'Period'), primary: true, value: (r) => r.period, render: (r) => periodLabel(r, g, fmtDate), sortDir: 'asc' },
      g !== 'day' ? { key: 'days', label: tr('rpt_days', 'Days'), kind: 'int', value: (r) => r.days, defaultVisible: false } : null,
      { key: 'tx_count', label: tr('sales', 'Sales'), kind: 'int', value: (r) => r.tx_count },
      { key: 'gross_sales_usd', label: tr('gross_sales', 'Gross sales'), kind: 'money', value: (r) => r.gross_sales_usd, defaultVisible: options.basis === 'gross', emphasis: options.basis === 'gross' },
      { key: 'discounts', label: tr('discounts', 'Discounts'), kind: 'money', value: (r) => r.store_discount_usd + r.membership_discount_usd, defaultVisible: false },
      { key: 'refund_usd', label: tr('refunds', 'Refunds'), kind: 'money', value: (r) => r.refund_usd },
      { key: 'revenue_usd', label: tr('revenue', 'Revenue'), kind: 'money', value: (r) => r.revenue_usd, emphasis: options.basis === 'revenue' },
      { key: 'pending_revenue_usd', label: tr('rpt_pending_credit', 'Unpaid credit'), kind: 'money', value: (r) => r.pending_revenue_usd, defaultVisible: false },
      { key: 'collected_total_usd', label: tr('collected_total', 'Collected total'), kind: 'money', value: (r) => r.collected_total_usd, defaultVisible: options.basis === 'collected', emphasis: options.basis === 'collected' },
      { key: 'avg_order_usd', label: tr('avg_order', 'Avg order'), kind: 'money', value: (r) => r.avg_order_usd, defaultVisible: false },
      showProfit ? { key: 'cost_usd', label: tr('cost', 'Cost'), kind: 'money', value: (r) => r.cost_usd ?? null, defaultVisible: false } : null,
      showProfit ? { key: 'profit_usd', label: tr('rpt_gross_profit', 'Gross profit'), kind: 'money', value: (r) => r.profit_usd ?? null } : null,
      showProfit ? { key: 'margin_pct', label: tr('rpt_margin', 'Margin'), kind: 'pct', value: (r) => pct(num(r.profit_usd), basisValue(r, options.basis)) } : null,
    ]
    return list.filter((c): c is ReportColumn<PeriodRow> => !!c)
  }, [tr, g, options.basis, showProfit])

  const [sort, setSort] = useState<SortState | null>({ key: 'period', dir: 'asc' })
  const [openRow, setOpenRow] = useState<PeriodRow | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const labels = tableLabels(tr)

  const summary = rows.length
    ? joinSummary([
        countLabel(rows.length, REPORT_NOUNS[g], tr),
        countLabel(totals.tx_count, REPORT_NOUNS.sale, tr),
        `${basisLabel} ${fmtMoney(basisValue(totals, options.basis))}`,
        totals.refund_usd ? `${tr('refunds', 'Refunds')} ${fmtMoney(totals.refund_usd)}` : null,
        hasProfit(totals) ? `${tr('rpt_gross_profit', 'Gross profit')} ${fmtMoney(totals.profit_usd)} (${fmtPct(pct(totals.profit_usd, basisValue(totals, options.basis)))})` : null,
      ])
    : ''

  const csv = () => rowsToCsvObjects(csvColumnsFor(columns, fmtMoney).map((c, i) => (i === 0 ? { ...c, value: (r: PeriodRow) => periodLabel(r, g, fmtDate) } : c)), rows)
  const exportCsv = () => downloadCSV(reportFileName(`periods-${g}`, filters, 'csv'), csv())
  const exportPrint = () => openPrintExport({ title: `${tr('reports', 'Reports')} · ${tr(view.labelKey, view.fallback)}`, subtitle: rangeSubtitle(filters, tr), headers: columns.map((c) => c.label), rows: csv() })

  const openStatement = openRow
    ? buildIncomeStatement({ sales: openRow, profitMode: 'gross', khrToUsd: p.khrToUsd })
    : []

  return (
    <ReportFrame
      title={tr(view.labelKey, view.fallback)}
      count={rows.length ? fmtInt(rows.length) : undefined}
      hint={{ label: tr(view.labelKey, view.fallback), text: tr('rpt_hint_periods', 'One row per business day, week (Monday–Sunday) or month in the range. Same revenue definition as everywhere else; rows add up to the Overview.') }}
      actions={
        <>
          {GRANULARITIES.map((x) => (
            <Chip key={x.id} selected={g === x.id} onClick={() => p.onOptionsChange({ granularity: x.id })}>
              {tr(x.key, x.fallback)}
            </Chip>
          ))}
          <OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> })} />
        </>
      }
      summary={summary}
      error={state.error}
      onRetry={state.reload}
      retryLabel={tr('retry', 'Retry')}
    >
      <ReportTable
        surfaceKey={`reports-periods-${g}-${options.basis}`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.period}
        style={style}
        fmtMoney={fmtMoney}
        labels={labels}
        loading={state.loading}
        totalsRow={rows.length > 1 ? ({ ...totals, period: labels.total, date_from: '', date_to: '', days: rows.reduce((n, r) => n + r.days, 0) } as PeriodRow) : null}
        sort={sort}
        onSortChange={setSort}
        selectedKey={openRow?.period ?? null}
        onRowClick={(row, el) => {
          anchorRef.current = el
          setOpenRow((cur) => (cur?.period === row.period ? null : row))
        }}
        maxHeight="70vh"
      />
      <Fold
        open={!!openRow}
        onClose={() => setOpenRow(null)}
        anchorRef={anchorRef}
        title={openRow ? periodLabel(openRow, g, fmtDate) : ''}
        actions={
          openRow ? (
            <Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => p.onDrill({ startDate: openRow.date_from, endDate: openRow.date_to, view: 'sales' })}>
              {tr('rpt_view_sales', 'View sales')}
            </Button>
          ) : null
        }
      >
        <div className="p-2">
          {openRow ? (
            <ReceiptSheet
              blocks={[
                {
                  key: 'meta',
                  lines: [
                    { label: tr('sales', 'Sales'), value: fmtInt(openRow.tx_count), kind: 'info' },
                    { label: tr('avg_order', 'Avg order'), value: fmtMoney(openRow.avg_order_usd), kind: 'info' },
                  ],
                },
                ...(['revenue', 'collected', 'profit'] as const)
                  .filter((grp) => openStatement.some((l) => l.group === grp))
                  .map((grp) => ({
                    key: grp,
                    title: grp === 'revenue' ? tr('revenue', 'Revenue') : grp === 'collected' ? tr('rpt_collected_group', 'Collected') : tr('profit', 'Profit'),
                    lines: openStatement.filter((l) => l.group === grp).map((l) => ({ key: l.key, label: tr(l.labelKey, l.fallback), value: fmtMoney(l.usd), kind: l.kind })),
                  })),
              ]}
            />
          ) : null}
        </div>
      </Fold>
    </ReportFrame>
  )
}
