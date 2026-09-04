// Sales (each receipt) -- the per-sale profit list the user asked for in
// Part 581, over GET /api/reports/business-summary/sales walked newest-
// first in snapshot/cursor pages of 250. Cost / profit columns exist only
// when the server sent them (admin); a row opens a Fold with the receipt's
// full breakdown. The control-row search is sent to the server (`q`), so
// a search covers every matching receipt in the range, not only the loaded
// pages.
import { useMemo, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { getBusinessSummarySalesPage } from '../../../api/reportsTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import { Button, Fold, OverflowMenu } from '../../shared/kit'
import { getStatusLabel } from '../StatusBadge.tsx'
import ReceiptSheet from './ReceiptSheet.tsx'
import ReportFrame from './ReportFrame.tsx'
import ReportTable, { csvColumnsFor, type ReportColumn } from './ReportTable.tsx'
import { fmtInt, fmtPct, joinSummary, num, pct, reportFileName, reportQueryParams, round2, rowsToCsvObjects, type SortState, countLabel, REPORT_NOUNS } from './reportModel.ts'
import { exportMenuItems, rangeSubtitle, tableLabels, type ReportViewProps } from './reportTypes.ts'
import { usePagedReport } from './usePagedReport.ts'

export interface SaleRow {
  id: number
  receipt_number: string
  date: string
  business_date: string
  branch: string
  cashier: string
  customer: string
  customer_phone: string
  payment_method: string
  status: string
  gross_sales_usd: number
  store_discount_usd: number
  membership_discount_usd: number
  tax_usd: number
  delivery_usd: number
  refund_usd: number
  net_revenue_usd: number
  pending_revenue_usd: number
  collected_total_usd: number
  cost_usd?: number
  cost_before_floor_usd?: number
  gross_profit_usd?: number
  cost_missing_snapshot_lines?: number
}

const MONEY_KEYS: Array<keyof SaleRow> = [
  'gross_sales_usd', 'store_discount_usd', 'membership_discount_usd', 'tax_usd', 'delivery_usd', 'refund_usd', 'net_revenue_usd', 'pending_revenue_usd', 'collected_total_usd',
]

export function mapSaleRow(raw: unknown, index: number): SaleRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const row: SaleRow = {
    id: num(r.id) || index,
    receipt_number: String(r.receipt_number || ''),
    date: String(r.date || ''),
    business_date: String(r.business_date || ''),
    branch: String(r.branch || ''),
    cashier: String(r.cashier || ''),
    customer: String(r.customer || ''),
    customer_phone: String(r.customer_phone || ''),
    payment_method: String(r.payment_method || ''),
    status: String(r.status || ''),
    gross_sales_usd: 0, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, net_revenue_usd: 0, pending_revenue_usd: 0, collected_total_usd: 0,
  }
  for (const k of MONEY_KEYS) (row as unknown as Record<string, number>)[k] = num(r[k])
  // Admin-only keys: copied ONLY when present (never assigned as 0).
  if (typeof r.cost_usd === 'number') {
    row.cost_usd = num(r.cost_usd)
    row.cost_before_floor_usd = typeof r.cost_before_floor_usd === 'number' ? num(r.cost_before_floor_usd) : row.cost_usd
    row.gross_profit_usd = num(r.gross_profit_usd)
    row.cost_missing_snapshot_lines = num(r.cost_missing_snapshot_lines)
  }
  return row
}

export function sumSaleRows(rows: SaleRow[]): SaleRow {
  const out = mapSaleRow({}, 0)
  const allProfit = rows.length > 0 && rows.every((r) => typeof r.gross_profit_usd === 'number')
  let cost = 0
  let profit = 0
  let missing = 0
  for (const r of rows) {
    for (const k of MONEY_KEYS) (out as unknown as Record<string, number>)[k] += num(r[k])
    if (allProfit) {
      cost += num(r.cost_before_floor_usd ?? r.cost_usd)
      profit += num(r.gross_profit_usd) + num(r.cost_usd)
      missing += num(r.cost_missing_snapshot_lines)
    }
  }
  for (const k of MONEY_KEYS) (out as unknown as Record<string, number>)[k] = round2((out as unknown as Record<string, number>)[k])
  if (allProfit) {
    // Same aggregate floor as the canonical server totals. Flooring each
    // receipt before summing loses imported/restocked cost corrections.
    out.cost_before_floor_usd = round2(cost)
    out.cost_usd = round2(Math.max(0, cost))
    out.gross_profit_usd = round2(profit - Math.max(0, cost))
    out.cost_missing_snapshot_lines = missing
  }
  return out
}

export default function SalesListReport(p: ReportViewProps) {
  const { tr, t, fmtMoney, options, style, filters, view, search } = p
  const base = useMemo(() => reportQueryParams(filters, view), [filters, view])
  const depsKey = JSON.stringify({ base, search })
  const paged = usePagedReport<SaleRow>(
    (page) =>
      getBusinessSummarySalesPage({
        ...base,
        q: search,
        order: 'desc',
        pageSize: 250,
        snapshotMaxId: page.snapshotMaxId ?? '',
        afterCreatedAt: page.cursor && typeof page.cursor.created_at === 'string' ? page.cursor.created_at : '',
        afterId: page.cursor && page.cursor.id != null ? String(page.cursor.id) : '',
      }),
    depsKey,
    true,
    mapSaleRow,
  )
  const rows = paged.rows
  const totals = useMemo(() => sumSaleRows(rows), [rows])
  const showProfit = rows.length > 0 && typeof totals.gross_profit_usd === 'number'
  const basisOf = (r: SaleRow) => (options.basis === 'gross' ? r.gross_sales_usd : options.basis === 'collected' ? r.collected_total_usd : r.net_revenue_usd)
  const basisLabel = options.basis === 'gross' ? tr('gross_sales', 'Gross sales') : options.basis === 'collected' ? tr('collected_total', 'Collected total') : tr('revenue', 'Revenue')

  const columns = useMemo<Array<ReportColumn<SaleRow>>>(() => {
    const list: Array<ReportColumn<SaleRow> | null> = [
      { key: 'receipt_number', label: tr('receipt', 'Receipt'), primary: true, value: (r) => r.receipt_number },
      { key: 'date', label: tr('date', 'Date'), kind: 'datetime', value: (r) => r.date, sortDir: 'desc' },
      { key: 'customer', label: tr('customer', 'Customer'), value: (r) => r.customer || tr('walk_in', 'Walk-in') },
      { key: 'customer_phone', label: tr('rpt_phone', 'Phone'), value: (r) => r.customer_phone, defaultVisible: false },
      { key: 'cashier', label: tr('cashier', 'Cashier'), value: (r) => r.cashier },
      { key: 'branch', label: tr('branch', 'Branch'), value: (r) => r.branch, defaultVisible: false },
      { key: 'payment_method', label: tr('payment_method', 'Payment method'), value: (r) => r.payment_method },
      { key: 'status', label: tr('status', 'Status'), value: (r) => getStatusLabel(r.status, t) },
      { key: 'gross_sales_usd', label: tr('gross_sales', 'Gross sales'), kind: 'money', value: (r) => r.gross_sales_usd, defaultVisible: options.basis === 'gross', emphasis: options.basis === 'gross' },
      { key: 'discounts', label: tr('discounts', 'Discounts'), kind: 'money', value: (r) => round2(r.store_discount_usd + r.membership_discount_usd), defaultVisible: false },
      { key: 'tax_usd', label: tr('tax', 'Tax'), kind: 'money', value: (r) => r.tax_usd, defaultVisible: false },
      { key: 'delivery_usd', label: tr('delivery', 'Delivery'), kind: 'money', value: (r) => r.delivery_usd, defaultVisible: false },
      { key: 'refund_usd', label: tr('refunds', 'Refunds'), kind: 'money', value: (r) => r.refund_usd },
      { key: 'net_revenue_usd', label: tr('revenue', 'Revenue'), kind: 'money', value: (r) => r.net_revenue_usd, emphasis: options.basis === 'revenue' },
      { key: 'pending_revenue_usd', label: tr('rpt_pending_credit', 'Not Paid'), kind: 'money', value: (r) => r.pending_revenue_usd, defaultVisible: false },
      { key: 'collected_total_usd', label: tr('collected_total', 'Collected total'), kind: 'money', value: (r) => r.collected_total_usd, defaultVisible: options.basis === 'collected', emphasis: options.basis === 'collected' },
      showProfit ? { key: 'cost_usd', label: tr('cost', 'Cost'), kind: 'money', value: (r) => r.cost_usd ?? null, defaultVisible: false } : null,
      showProfit ? { key: 'gross_profit_usd', label: tr('rpt_gross_profit', 'Gross profit'), kind: 'money', value: (r) => r.gross_profit_usd ?? null } : null,
      showProfit ? { key: 'margin_pct', label: tr('rpt_margin', 'Margin'), kind: 'pct', value: (r) => pct(num(r.gross_profit_usd), basisOf(r)) } : null,
    ]
    return list.filter((c): c is ReportColumn<SaleRow> => !!c)
  }, [tr, t, options.basis, showProfit]) // eslint-disable-line react-hooks/exhaustive-deps

  const [sort, setSort] = useState<SortState | null>(null)
  const [openRow, setOpenRow] = useState<SaleRow | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const labels = tableLabels(tr)

  const summary = rows.length
    ? joinSummary([
        countLabel(rows.length, REPORT_NOUNS.sale, tr, paged.hasMore),
        `${basisLabel} ${fmtMoney(basisOf(totals))}`,
        totals.refund_usd ? `${tr('refunds', 'Refunds')} ${fmtMoney(totals.refund_usd)}` : null,
        totals.pending_revenue_usd ? `${tr('rpt_pending_credit', 'Not Paid')} ${fmtMoney(totals.pending_revenue_usd)}` : null,
        showProfit ? `${tr('rpt_gross_profit', 'Gross profit')} ${fmtMoney(num(totals.gross_profit_usd))} (${fmtPct(pct(num(totals.gross_profit_usd), basisOf(totals)))})` : null,
      ])
    : ''

  const csv = () => rowsToCsvObjects(csvColumnsFor(columns, fmtMoney), rows)
  const exportCsv = () => downloadCSV(reportFileName('sales', filters, 'csv'), csv())
  const exportPrint = () => openPrintExport({ title: `${tr('reports', 'Reports')} · ${tr(view.labelKey, view.fallback)}`, subtitle: rangeSubtitle(filters, tr), headers: columns.map((c) => c.label), rows: csv() })

  const detailLines = (r: SaleRow) => [
    { key: 'date', label: tr('date', 'Date'), value: fmtDateTime24(r.date), kind: 'info' as const },
    { key: 'customer', label: tr('customer', 'Customer'), value: r.customer || tr('walk_in', 'Walk-in'), kind: 'info' as const },
    ...(r.customer_phone ? [{ key: 'phone', label: tr('rpt_phone', 'Phone'), value: r.customer_phone, kind: 'info' as const }] : []),
    { key: 'cashier', label: tr('cashier', 'Cashier'), value: r.cashier || '—', kind: 'info' as const },
    ...(r.branch ? [{ key: 'branch', label: tr('branch', 'Branch'), value: r.branch, kind: 'info' as const }] : []),
    { key: 'payment', label: tr('payment_method', 'Payment method'), value: r.payment_method || '—', kind: 'info' as const },
    { key: 'status', label: tr('status', 'Status'), value: getStatusLabel(r.status, t), kind: 'info' as const },
  ]
  const moneyLines = (r: SaleRow) => {
    const lines = [
      { key: 'gross', label: tr('gross_sales', 'Gross sales'), value: fmtMoney(r.gross_sales_usd), kind: 'add' as const },
      { key: 'store_disc', label: tr('rpt_store_discounts', 'Store discounts'), value: fmtMoney(r.store_discount_usd), kind: 'sub' as const },
      { key: 'member_disc', label: tr('rpt_membership_discounts', 'Membership discounts'), value: fmtMoney(r.membership_discount_usd), kind: 'sub' as const },
      { key: 'refund', label: tr('refunds', 'Refunds'), value: fmtMoney(r.refund_usd), kind: 'sub' as const },
      { key: 'revenue', label: tr('revenue', 'Revenue'), value: fmtMoney(r.net_revenue_usd), kind: 'total' as const },
      ...(r.pending_revenue_usd ? [{ key: 'pending', label: tr('rpt_pending_credit', 'Not Paid'), value: fmtMoney(r.pending_revenue_usd), kind: 'info' as const }] : []),
      { key: 'tax', label: tr('tax', 'Tax'), value: fmtMoney(r.tax_usd), kind: 'add' as const },
      { key: 'delivery', label: tr('rpt_delivery_charged', 'Delivery charged'), value: fmtMoney(r.delivery_usd), kind: 'add' as const },
      { key: 'collected', label: tr('collected_total', 'Collected total'), value: fmtMoney(r.collected_total_usd), kind: 'total' as const },
    ]
    if (typeof r.gross_profit_usd === 'number') {
      lines.push(
        { key: 'cost', label: tr('cogs', 'Cost of goods'), value: fmtMoney(num(r.cost_usd)), kind: 'sub' as const },
        { key: 'profit', label: tr('rpt_gross_profit', 'Gross profit'), value: `${fmtMoney(r.gross_profit_usd)} (${fmtPct(pct(r.gross_profit_usd, basisOf(r)))})`, kind: 'total' as const },
      )
      if (r.cost_missing_snapshot_lines) lines.push({ key: 'missing', label: tr('rpt_missing_cost_lines', 'Lines without cost snapshot'), value: fmtInt(r.cost_missing_snapshot_lines), kind: 'info' as const })
    }
    return lines
  }

  return (
    <ReportFrame
      title={tr(view.labelKey, view.fallback)}
      count={rows.length ? `${fmtInt(rows.length)}${paged.hasMore ? '+' : ''}` : undefined}
      hint={{ label: tr(view.labelKey, view.fallback), text: tr('rpt_hint_sales_list', 'One row per receipt, newest first, 250 at a time. Revenue per receipt = net sale minus its refunds (recognized sales only; cancelled and unpaid rows show 0).') }}
      actions={<OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, exportCsv, exportPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> })} />}
      summary={summary}
      error={paged.error}
      onRetry={paged.reload}
      retryLabel={tr('retry', 'Retry')}
    >
      <ReportTable
        surfaceKey={`reports-sales-${options.basis}`}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        style={style}
        fmtMoney={fmtMoney}
        labels={labels}
        loading={paged.loading}
        totalsRow={rows.length > 1 ? ({ ...totals, receipt_number: labels.total, status: '' } as SaleRow) : null}
        sort={sort}
        onSortChange={setSort}
        selectedKey={openRow ? String(openRow.id) : null}
        onRowClick={(row, el) => {
          anchorRef.current = el
          setOpenRow((cur) => (cur?.id === row.id ? null : row))
        }}
        maxHeight="70vh"
        footer={
          paged.hasMore ? (
            <div className="flex items-center gap-2 text-[length:var(--ui-size-meta)] text-[var(--ui-ink-3)]">
              <Button size="sm" variant="secondary" loading={paged.loadingMore} onClick={paged.loadMore}>
                {tr('load_more', 'Load more')}
              </Button>
              <span>{fmtInt(rows.length)} {tr('rpt_loaded', 'loaded')}</span>
            </div>
          ) : null
        }
      />
      <Fold open={!!openRow} onClose={() => setOpenRow(null)} anchorRef={anchorRef} title={openRow ? `${tr('receipt', 'Receipt')} ${openRow.receipt_number}` : ''}>
        <div className="p-2">
          {openRow ? (
            <ReceiptSheet
              blocks={[
                { key: 'who', lines: detailLines(openRow) },
                { key: 'money', title: tr('rpt_breakdown', 'Breakdown'), lines: moneyLines(openRow) },
              ]}
            />
          ) : null}
        </div>
      </Fold>
    </ReportFrame>
  )
}
