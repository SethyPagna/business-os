// Overview ("All") -- the one-page income statement for the selected range:
//
//   Gross sales - discounts -> NET SALES - unpaid credit - refunds -> REVENUE
//   REVENUE + tax/delivery -> COLLECTED TOTAL
//   REVENUE - COGS + delivery collected - delivery paid -> GROSS PROFIT
//                  - operating expenses -> TOTAL PROFIT
//   Delivery: charged / actually paid / waived / net   (memo, no operator)
//   Awaiting payment (theoretical)                     (yellow, below the total)
//
// with the previous period beside it when "Compare" is on, and the breakdown
// folds (payments, couriers, returns by reason, expenses by type) under it.
// Every figure is a kernel figure from GET /api/reports/overview;
// buildIncomeStatement only arranges. The group order and labels come from the
// model (STATEMENT_GROUPS) so the two per-row statement folds in By period and
// the grouped views stay in step with this page.
import { Fragment, useMemo, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { getReportOverview } from '../../../api/reportsTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { fmtDateOnly } from '../../../utils/formatters.ts'
import InfoHint from '../../shared/InfoHint.tsx'
import { FEE_TYPE_OPTIONS } from '../../fees/FeeForm.tsx'
import { Chip, DenseTable, Fold, OverflowMenu, Skeleton } from '../../shared/kit'
import ReceiptSheet, { type ReceiptBlock } from './ReceiptSheet.tsx'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import ReportTable, { type ReportColumn } from './ReportTable.tsx'
import {
  BASIS_LABELS,
  basisValue,
  buildIncomeStatement,
  countLabel,
  delta,
  fmtInt,
  fmtPct,
  formatSignedPct,
  hasProfit,
  joinSummary,
  normalizeTotals,
  num,
  pct,
  receiptLineKind,
  REPORT_NOUNS,
  reportFileName,
  reportQueryParams,
  STATEMENT_GROUPS,
  isTheoreticalGroup,
  statementGroupLabel,
  statementNoteText,
  statementOperator,
  type StatementGroup,
  type StatementLine,
} from './reportModel.ts'
import { exportMenuItems, rangeSubtitle, tableLabels, type ReportViewProps } from './reportTypes.ts'

interface ReturnsTotals { count: number; refund_usd: number; refund_khr: number }
interface ExpenseTotals { count: number; amount_usd: number; amount_khr: number }
interface PaymentRow { key: string; payment_method: string; tx_count: number; revenue_usd: number; pending_revenue_usd: number; collected_usd: number }
interface CourierRow {
  delivery_contact_id: number | null
  delivery_contact_name: string
  deliveries: number
  charged_fee_usd: number
  absorbed_fee_usd: number
  actual_cost_usd: number
  actual_cost_count: number
  margin_usd: number
  last_delivery_at: string | null
}
interface ReasonRow { reason: string; count: number; refund_usd: number; refund_khr: number }
interface TypeRow { fee_type: string; count: number; amount_usd: number; amount_khr: number }
interface OverviewResponse {
  is_admin?: boolean
  previous_range?: { startDate: string; endDate: string } | null
  sales?: { totals: unknown; previous: unknown; payment_methods: PaymentRow[]; couriers: CourierRow[] }
  returns?: { totals: ReturnsTotals; previous: ReturnsTotals | null; by_reason: ReasonRow[] }
  expenses?: { totals: ExpenseTotals; previous: ExpenseTotals | null; by_type: TypeRow[] }
}
type Breakdown = 'payments' | 'couriers' | 'reasons' | 'types'

// The awaiting-payment block is highlighted and sits last. Its figures are
// theoretical: the owner ruled (Sep 4 2026, on the shift report) that unpaid
// money goes BELOW the final total and is labelled as unpaid, never mixed into
// the realised arithmetic. buildIncomeStatement emits it last and
// isTheoreticalGroup() -- in the model, so the two per-row statement folds tint
// the same block -- says how it looks.

export default function OverviewReport(p: ReportViewProps) {
  const { tr, t, fmtMoney, options, style, filters, view } = p
  const params = useMemo(() => ({ ...reportQueryParams(filters, view), compare: options.compare ? '1' : '' }), [filters, view, options.compare])
  const depsKey = JSON.stringify(params)
  const state = useReportData<OverviewResponse>(() => getReportOverview(params) as Promise<OverviewResponse>, depsKey)
  const data = state.data
  const compare = options.compare && !!data?.previous_range

  const sales = useMemo(() => normalizeTotals(data?.sales?.totals), [data])
  const prevSales = useMemo(() => (compare ? normalizeTotals(data?.sales?.previous) : null), [data, compare])
  const returns = data?.returns?.totals || null
  const prevReturns = compare ? data?.returns?.previous || null : null
  const expenses = data?.expenses?.totals || null
  const prevExpenses = compare ? data?.expenses?.previous || null : null

  const lines = useMemo(
    () =>
      buildIncomeStatement({
        sales,
        prevSales,
        expenses: expenses ? { usd: num(expenses.amount_usd), khr: num(expenses.amount_khr) } : null,
        prevExpenses: prevExpenses ? { usd: num(prevExpenses.amount_usd), khr: num(prevExpenses.amount_khr) } : null,
        profitMode: options.profitMode,
        khrToUsd: p.khrToUsd,
      }),
    [sales, prevSales, expenses, prevExpenses, options.profitMode, p.khrToUsd],
  )

  const basis = basisValue(sales, options.basis)
  const basisDelta = prevSales ? delta(basis, basisValue(prevSales, options.basis)) : null
  const profitLine = lines.find((l) => l.key === 'gross_profit') || null
  const netLine = lines.find((l) => l.key === 'net_result') || null
  const basisLabel = tr(BASIS_LABELS[options.basis].key, BASIS_LABELS[options.basis].fallback)

  const summary = sales
    ? joinSummary([
        countLabel(sales.tx_count, REPORT_NOUNS.sale, tr),
        `${basisLabel} ${fmtMoney(basis)}${basisDelta && basisDelta.pct != null ? ` (${formatSignedPct(basisDelta.pct)})` : ''}`,
        sales.refund_usd ? `${tr('refunds', 'Refunds')} ${fmtMoney(sales.refund_usd)}` : null,
        returns ? countLabel(returns.count, REPORT_NOUNS.return, tr) : null,
        expenses ? `${tr('fees', 'Expenses')} ${fmtMoney(num(expenses.amount_usd), num(expenses.amount_khr))}` : null,
        profitLine ? `${tr('rpt_gross_profit', 'Total Profit')} ${fmtMoney(profitLine.usd)} (${fmtPct(pct(profitLine.usd, basis))})` : null,
        netLine ? `${tr('rpt_total_profit', 'Final Profit')} ${fmtMoney(netLine.usd)}` : null,
        // The unpaid figures ride the summary too, always named as unpaid and
        // always after the realised ones -- never folded into any of them.
        sales.pending_revenue_usd ? `${tr('rpt_pending_credit', 'Not Paid')} ${fmtMoney(sales.pending_revenue_usd)}` : null,
      ])
    : !sales && (returns || expenses)
      ? joinSummary([
          returns ? `${countLabel(returns.count, REPORT_NOUNS.return, tr)} ${fmtMoney(num(returns.refund_usd), num(returns.refund_khr))}` : null,
          expenses ? `${countLabel(expenses.count, REPORT_NOUNS.expense, tr)} ${fmtMoney(num(expenses.amount_usd), num(expenses.amount_khr))}` : null,
        ])
      : ''
  const summaryNote = compare && data?.previous_range ? `${tr('rpt_vs_prev', 'vs')} ${fmtDateOnly(data.previous_range.startDate)} – ${fmtDateOnly(data.previous_range.endDate)}` : undefined

  const groupLabel = (g: StatementGroup) => statementGroupLabel(g, tr)
  const lineLabel = (l: StatementLine) => tr(l.labelKey, l.fallback)
  const changeOf = (l: StatementLine) => (l.prevUsd == null ? null : delta(l.usd, l.prevUsd))
  const noteText = (l: StatementLine) => (l.note ? statementNoteText(l.note, tr) : null)

  // ---- exports ----
  // The CSV and the print sheet carry the SAME rows as the screen, including
  // the operator and any "not available" / coverage note: a bridge exported as
  // bare numbers loses exactly the thing that makes it a bridge.
  const csvRows = () =>
    lines.map((l) => ({
      Group: groupLabel(l.group),
      Op: statementOperator(l.kind),
      Line: lineLabel(l),
      Amount_USD: l.usd,
      Note: noteText(l) || '',
      ...(compare ? { Previous_USD: l.prevUsd ?? '', Change_Pct: changeOf(l)?.pct ?? '' } : {}),
    }))
  const exportCsv = () => downloadCSV(reportFileName('overview', filters, 'csv'), csvRows())
  const exportPrint = () => {
    const headers = compare ? ['Group', 'Op', 'Line', 'Amount_USD', 'Note', 'Previous_USD', 'Change_Pct'] : ['Group', 'Op', 'Line', 'Amount_USD', 'Note']
    openPrintExport({ title: `${tr('reports', 'Reports')} · ${tr(view.labelKey, view.fallback)}`, subtitle: rangeSubtitle(filters, tr), headers, rows: csvRows() })
  }

  // ---- breakdown folds ----
  const [open, setOpen] = useState<Breakdown | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const chipRefs = useRef<Partial<Record<Breakdown, HTMLElement | null>>>({})
  const openFold = (id: Breakdown) => {
    anchorRef.current = chipRefs.current[id] || null
    setOpen((cur) => (cur === id ? null : id))
  }
  const payments = data?.sales?.payment_methods || []
  const couriers = data?.sales?.couriers || []
  const reasons = data?.returns?.by_reason || []
  const types = data?.expenses?.by_type || []
  const chips: Array<{ id: Breakdown; label: string; count: number }> = [
    data?.sales ? { id: 'payments', label: tr('rpt_payments', 'Payment methods'), count: payments.length } : null,
    data?.sales && couriers.length ? { id: 'couriers', label: tr('rpt_couriers', 'Couriers'), count: couriers.length } : null,
    data?.returns ? { id: 'reasons', label: tr('by_reason', 'By reason'), count: reasons.length } : null,
    data?.expenses ? { id: 'types', label: `${tr('fees', 'Expenses')} · ${tr('by_type', 'By type')}`, count: types.length } : null,
  ].filter((c): c is { id: Breakdown; label: string; count: number } => !!c)
  const labels = tableLabels(tr)
  const feeTypeLabel = (type: string) => {
    const def = FEE_TYPE_OPTIONS.find((o) => o.value === type)
    return def ? tr(def.labelKey, def.fallback) : type || tr('unknown', 'Unknown')
  }

  const paymentColumns: Array<ReportColumn<PaymentRow>> = [
    { key: 'payment_method', label: tr('payment_method', 'Payment method'), primary: true, value: (r) => r.payment_method || tr('unknown', 'Unknown') },
    { key: 'tx_count', label: tr('sales', 'Sales'), kind: 'int', value: (r) => r.tx_count },
    { key: 'revenue_usd', label: tr('revenue', 'Revenue'), kind: 'money', value: (r) => r.revenue_usd, emphasis: true },
    { key: 'pending_revenue_usd', label: tr('rpt_pending_credit', 'Not Paid'), kind: 'money', value: (r) => r.pending_revenue_usd, defaultVisible: false },
    { key: 'collected_usd', label: tr('collected_total', 'Collected total'), kind: 'money', value: (r) => r.collected_usd },
    { key: 'share', label: tr('rpt_share', 'Share'), kind: 'pct', value: (r) => pct(r.revenue_usd, payments.reduce((s, p) => s + p.revenue_usd, 0)), defaultVisible: false },
  ]
  const courierColumns: Array<ReportColumn<CourierRow>> = [
    { key: 'name', label: tr('rpt_courier', 'Courier'), primary: true, value: (r) => r.delivery_contact_name || tr('unknown', 'Unknown') },
    { key: 'deliveries', label: tr('rpt_deliveries', 'Deliveries'), kind: 'int', value: (r) => r.deliveries },
    { key: 'charged_fee_usd', label: tr('rpt_delivery_charged', 'Charged to customers'), kind: 'money', value: (r) => r.charged_fee_usd },
    { key: 'absorbed_fee_usd', label: tr('rpt_store_delivery', 'Store-paid delivery'), kind: 'money', value: (r) => r.absorbed_fee_usd },
    { key: 'actual_cost_usd', label: tr('rpt_delivery_cost', 'Actual cost'), kind: 'money', value: (r) => r.actual_cost_usd },
    { key: 'margin_usd', label: tr('rpt_delivery_margin', 'Delivery margin'), kind: 'money', value: (r) => r.margin_usd, emphasis: true },
    { key: 'last_delivery_at', label: tr('rpt_last_delivery', 'Last delivery'), kind: 'datetime', value: (r) => r.last_delivery_at, defaultVisible: false },
  ]
  const reasonColumns: Array<ReportColumn<ReasonRow>> = [
    { key: 'reason', label: tr('reason', 'Reason'), primary: true, value: (r) => r.reason || '—' },
    { key: 'count', label: tr('rpt_count', 'Count'), kind: 'int', value: (r) => r.count },
    { key: 'refund', label: tr('refunds', 'Refunds'), kind: 'money', value: (r) => r.refund_usd, khr: (r) => r.refund_khr, emphasis: true },
  ]
  const typeColumns: Array<ReportColumn<TypeRow>> = [
    { key: 'fee_type', label: tr('type', 'Type'), primary: true, value: (r) => feeTypeLabel(r.fee_type) },
    { key: 'count', label: tr('rpt_count', 'Count'), kind: 'int', value: (r) => r.count },
    { key: 'amount', label: tr('amount', 'Amount'), kind: 'money', value: (r) => r.amount_usd, khr: (r) => r.amount_khr, emphasis: true },
  ]

  const cols = compare ? 4 : 2
  const statementBody = state.loading && !data ? (
    <Skeleton rows={8} variant={style === 'receipt' ? 'text' : 'table'} />
  ) : lines.length === 0 ? null : style === 'receipt' ? (
    <ReceiptSheet
      centered={!p.compact}
      blocks={STATEMENT_GROUPS.filter((g) => lines.some((l) => l.group === g)).map<ReceiptBlock>((g) => ({
        key: g,
        title: groupLabel(g),
        highlight: isTheoreticalGroup(g),
        lines: lines
          .filter((l) => l.group === g)
          .map((l) => {
            const ch = changeOf(l)
            // The data note wins the slot: "no cost recorded on 812 lines"
            // outranks a percentage change on a figure that is not measured.
            const note = noteText(l) || (ch && ch.pct != null ? formatSignedPct(ch.pct) : undefined)
            return { key: l.key, label: lineLabel(l), value: fmtMoney(l.usd, l.khr), kind: receiptLineKind(l.kind), note }
          }),
      }))}
    />
  ) : (
    <DenseTable fit>
      <thead>
        <tr>
          <th>{tr('rpt_line', 'Line')}</th>
          <th className="!text-right">{tr('amount', 'Amount')}</th>
          {compare ? (
            <>
              <th className="!text-right">{tr('rpt_prev_period', 'Previous period')}</th>
              <th className="!text-right">{tr('rpt_change', 'Change')}</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {STATEMENT_GROUPS.filter((g) => lines.some((l) => l.group === g)).map((g) => {
          const highlight = isTheoreticalGroup(g)
          return (
            <Fragment key={g}>
              <tr className={highlight ? '' : '!bg-[var(--ui-surface-2)]'} data-statement-group={g}>
                <td colSpan={cols} className={['text-[length:var(--ui-size-meta)] font-medium', highlight ? 'text-[var(--ui-warn-ink)]' : 'text-[var(--ui-ink-2)]'].join(' ')}>
                  {groupLabel(g)}
                </td>
              </tr>
              {lines
                .filter((l) => l.group === g)
                .map((l) => {
                  const ch = changeOf(l)
                  const note = noteText(l)
                  return (
                    <tr key={l.key} className={l.kind === 'total' ? 'font-semibold' : ''} data-statement-group={g}>
                      <td>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 text-[var(--ui-ink-3)]">{statementOperator(l.kind)}</span>
                          {lineLabel(l)}
                          {l.hintKey ? <InfoHint text={tr(l.hintKey, l.hintFallback || '')} label={lineLabel(l)} /> : null}
                          {note ? <span className="text-[length:var(--ui-size-meta)] text-[var(--ui-ink-3)]">({note})</span> : null}
                        </span>
                      </td>
                      <td className="text-right whitespace-nowrap">{fmtMoney(l.usd, l.khr)}</td>
                      {compare ? (
                        <>
                          <td className="text-right whitespace-nowrap text-[var(--ui-ink-2)]">{l.prevUsd == null ? '—' : fmtMoney(l.prevUsd)}</td>
                          <td className="text-right whitespace-nowrap text-[var(--ui-ink-2)]">{ch ? (ch.pct == null ? fmtMoney(ch.abs) : `${fmtMoney(ch.abs)} (${formatSignedPct(ch.pct)})`) : '—'}</td>
                        </>
                      ) : null}
                    </tr>
                  )
                })}
            </Fragment>
          )
        })}
      </tbody>
    </DenseTable>
  )

  return (
    <ReportFrame
      title={tr(view.labelKey, view.fallback)}
      hint={{
        label: tr(view.labelKey, view.fallback),
        text: tr('rpt_hint_overview', 'Revenue = net sales of recognized sales minus refunds; tax and delivery are excluded. Cost and profit are visible to admins only.'),
      }}
      actions={<OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> })} />}
      summary={summary}
      summaryNote={summaryNote}
      error={state.error}
      onRetry={state.reload}
      retryLabel={tr('retry', 'Retry')}
    >
      <div className="reports-overview-statement">{statementBody}</div>
      {!state.loading && !state.error && !sales && !returns && !expenses ? <p className="text-[length:var(--ui-size-meta)] text-[var(--ui-ink-3)]">{labels.empty}</p> : null}
      {chips.length ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {chips.map((c) => (
            <span key={c.id} ref={(el) => { chipRefs.current[c.id] = el }}>
              <Chip selected={open === c.id} count={c.count} onClick={() => openFold(c.id)}>
                {c.label}
              </Chip>
            </span>
          ))}
        </div>
      ) : null}
      <Fold open={open != null} onClose={() => setOpen(null)} anchorRef={anchorRef} size="lg" title={chips.find((c) => c.id === open)?.label || ''}>
        <div className="p-2">
          {open === 'payments' ? <ReportTable surfaceKey="reports-overview-payments" columns={paymentColumns} rows={payments} rowKey={(r) => r.key} style={style} fmtMoney={fmtMoney} labels={labels} /> : null}
          {open === 'couriers' ? <ReportTable surfaceKey="reports-overview-couriers" columns={courierColumns} rows={couriers} rowKey={(r) => String(r.delivery_contact_id ?? r.delivery_contact_name)} style={style} fmtMoney={fmtMoney} labels={labels} /> : null}
          {open === 'reasons' ? <ReportTable surfaceKey="reports-overview-reasons" columns={reasonColumns} rows={reasons} rowKey={(r) => r.reason || '—'} style={style} fmtMoney={fmtMoney} labels={labels} /> : null}
          {open === 'types' ? <ReportTable surfaceKey="reports-overview-types" columns={typeColumns} rows={types} rowKey={(r) => r.fee_type || '—'} style={style} fmtMoney={fmtMoney} labels={labels} /> : null}
        </div>
      </Fold>
      {/* t is threaded for status labels in sibling views; keep the prop contract identical. */}
      <span hidden>{typeof t === 'function' ? '' : null}</span>
    </ReportFrame>
  )
}
