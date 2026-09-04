// Grouped views -- Products, Customers, Cashiers, Payment methods, Hours,
// Days of week, Branches, Couriers -- one component over GET
// /api/reports/grouped?by=… Every "by X" row (except products/couriers) is
// a full canonical totals row, so the table's totals line equals the
// Overview for the same filters. A row opens a Fold with its own statement
// and, where the per-receipt list can be narrowed to it, a "View sales"
// drill.
import { useMemo, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import { getReportGrouped } from '../../../api/reportsTransport.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { Button, Fold, OverflowMenu } from '../../shared/kit'
import ReceiptSheet, { type ReceiptLine } from './ReceiptSheet.tsx'
import ReportFrame, { useReportData } from './ReportFrame.tsx'
import ReportTable, { csvColumnsFor, type ReportColumn } from './ReportTable.tsx'
import {
  BASIS_LABELS,
  basisValue,
  buildIncomeStatement,
  countLabel,
  fmtInt,
  fmtPct,
  fmtQty,
  hasProfit,
  hourRangeLabel,
  joinSummary,
  normalizeTotals,
  num,
  pct,
  REPORT_NOUNS,
  reportFileName,
  reportQueryParams,
  round2,
  rowsToCsvObjects,
  sumTotals,
  WEEKDAY_LABEL_KEYS,
  type ReportGroupBy,
  type ReportTotals,
  type SortState,
} from './reportModel.ts'
import { exportMenuItems, rangeSubtitle, tableLabels, type DrillPatch, type ReportViewProps, type Tr } from './reportTypes.ts'

export interface GroupRow extends ReportTotals {
  key: string
  label: string
  entity_id: number | null
}
export interface ProductRow {
  product_id: number | null
  product_name: string
  sale_count: number
  qty: number
  line_sales_usd: number
  cost_usd?: number
  profit_usd?: number
  margin_pct?: number | null
  cost_missing_snapshot_lines?: number
}
export interface CourierRow {
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

export function groupRowLabel(by: ReportGroupBy, row: { key: string; label: string }, tr: Tr): string {
  if (by === 'hour') return hourRangeLabel(row.label || row.key)
  if (by === 'weekday') {
    const def = WEEKDAY_LABEL_KEYS[Number(row.key)]
    return def ? tr(def.key, def.fallback) : row.key
  }
  if (!row.label) return by === 'customer' ? tr('walk_in', 'Walk-in') : by === 'branch' ? '—' : tr('unknown', 'Unknown')
  return row.label
}

/** How a grouped row narrows the per-receipt list (null = no drill). */
export function groupDrill(by: ReportGroupBy, row: GroupRow): DrillPatch | null {
  if (by === 'customer' || by === 'cashier') return row.label ? { search: row.label, view: 'sales' } : null
  if (by === 'payment_method') return row.label ? { paymentMethod: row.label, view: 'sales' } : null
  if (by === 'branch') return row.entity_id ? { branchId: String(row.entity_id), view: 'sales' } : null
  return null
}

function matches(label: string, search: string): boolean {
  return !search || label.toLowerCase().includes(search.toLowerCase())
}

export default function GroupedReport(p: ReportViewProps) {
  const { tr, fmtMoney, options, style, filters, view, search } = p
  const by: ReportGroupBy = view.groupedBy || 'customer'
  const params = useMemo(() => ({ ...reportQueryParams(filters, view), by, limit: 500 }), [filters, view, by])
  const depsKey = JSON.stringify(params)
  const state = useReportData<{ rows?: unknown[] }>(() => getReportGrouped(params) as Promise<{ rows?: unknown[] }>, depsKey)
  const raw = state.data?.rows || []
  const labels = tableLabels(tr)
  const title = tr(view.labelKey, view.fallback)
  const basisLabel = tr(BASIS_LABELS[options.basis].key, BASIS_LABELS[options.basis].fallback)
  const [sort, setSort] = useState<SortState | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const exportMenu = (onCsv: () => void, onPrint: () => void) => (
    <OverflowMenu label={tr('export', 'Export')} items={exportMenuItems(tr, onCsv, onPrint, { csv: <Download className="h-3.5 w-3.5" />, print: <Printer className="h-3.5 w-3.5" /> })} />
  )
  const printTitle = `${tr('reports', 'Reports')} · ${title}`
  const subtitle = rangeSubtitle(filters, tr)

  // ---- products ----
  const productRows = useMemo<ProductRow[]>(
    () =>
      by === 'product'
        ? raw
            .map((r) => {
              const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
              const row: ProductRow = { product_id: o.product_id == null ? null : num(o.product_id), product_name: String(o.product_name || ''), sale_count: num(o.sale_count), qty: num(o.qty), line_sales_usd: num(o.line_sales_usd) }
              if (typeof o.profit_usd === 'number') {
                row.cost_usd = num(o.cost_usd)
                row.profit_usd = num(o.profit_usd)
                row.margin_pct = typeof o.margin_pct === 'number' ? o.margin_pct : pct(row.profit_usd, row.line_sales_usd)
                row.cost_missing_snapshot_lines = num(o.cost_missing_snapshot_lines)
              }
              return row
            })
            .filter((r) => matches(r.product_name, search))
        : [],
    [by, raw, search],
  )
  // ---- couriers ----
  const courierRows = useMemo<CourierRow[]>(
    () =>
      by === 'courier'
        ? raw
            .map((r) => {
              const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
              return {
                delivery_contact_id: o.delivery_contact_id == null ? null : num(o.delivery_contact_id),
                delivery_contact_name: String(o.delivery_contact_name || ''),
                deliveries: num(o.deliveries),
                charged_fee_usd: num(o.charged_fee_usd),
                absorbed_fee_usd: num(o.absorbed_fee_usd),
                actual_cost_usd: num(o.actual_cost_usd),
                actual_cost_count: num(o.actual_cost_count),
                margin_usd: num(o.margin_usd),
                last_delivery_at: o.last_delivery_at == null ? null : String(o.last_delivery_at),
              }
            })
            .filter((r) => matches(r.delivery_contact_name, search))
        : [],
    [by, raw, search],
  )
  // ---- canonical groups ----
  const groupRows = useMemo<GroupRow[]>(
    () =>
      by !== 'product' && by !== 'courier'
        ? raw
            .map((r) => {
              const totals = normalizeTotals(r)
              if (!totals) return null
              const o = r as Record<string, unknown>
              return { ...totals, key: String(o.key ?? ''), label: String(o.label ?? ''), entity_id: o.entity_id == null ? null : num(o.entity_id) }
            })
            .filter((r): r is GroupRow => !!r)
            .filter((r) => matches(groupRowLabel(by, r, tr), search))
        : [],
    [by, raw, search, tr],
  )

  if (by === 'product') {
    const totalLine = round2(productRows.reduce((s, r) => s + r.line_sales_usd, 0))
    const totalQty = productRows.reduce((s, r) => s + r.qty, 0)
    const allProfit = productRows.length > 0 && productRows.every((r) => typeof r.profit_usd === 'number')
    const totalProfit = allProfit ? round2(productRows.reduce((s, r) => s + num(r.profit_usd), 0)) : null
    const columns: Array<ReportColumn<ProductRow>> = [
      { key: 'product_name', label: tr('rpt_product', 'Product'), primary: true, value: (r) => r.product_name || '—' },
      { key: 'sale_count', label: tr('sales', 'Sales'), kind: 'int', value: (r) => r.sale_count },
      { key: 'qty', label: tr('quantity', 'Quantity'), kind: 'qty', value: (r) => r.qty },
      { key: 'line_sales_usd', label: tr('rpt_line_sales', 'Line sales'), kind: 'money', value: (r) => r.line_sales_usd, emphasis: true },
      { key: 'share', label: tr('rpt_share', 'Share'), kind: 'pct', value: (r) => pct(r.line_sales_usd, totalLine), defaultVisible: false },
      ...(allProfit
        ? [
            { key: 'cost_usd', label: tr('cost', 'Cost'), kind: 'money', value: (r: ProductRow) => r.cost_usd ?? null, defaultVisible: false } as ReportColumn<ProductRow>,
            { key: 'profit_usd', label: tr('rpt_gross_profit', 'Gross profit'), kind: 'money', value: (r: ProductRow) => r.profit_usd ?? null } as ReportColumn<ProductRow>,
            { key: 'margin_pct', label: tr('rpt_margin', 'Margin'), kind: 'pct', value: (r: ProductRow) => r.margin_pct ?? null } as ReportColumn<ProductRow>,
          ]
        : []),
    ]
    const csv = () => rowsToCsvObjects(csvColumnsFor(columns, fmtMoney), productRows)
    const open = productRows.find((r) => String(r.product_id ?? r.product_name) === openKey) || null
    return (
      <ReportFrame
        title={title}
        count={productRows.length ? fmtInt(productRows.length) : undefined}
        hint={{ label: title, text: tr('rpt_hint_products', 'Line sales = item line totals after line discounts, before order-level discounts, over recognized sales only. Ranked by line sales; top 500.') }}
        actions={exportMenu(() => downloadCSV(reportFileName('products', filters, 'csv'), csv()), () => openPrintExport({ title: printTitle, subtitle, headers: columns.map((c) => c.label), rows: csv() }))}
        summary={productRows.length ? joinSummary([countLabel(productRows.length, REPORT_NOUNS.product, tr), `${fmtQty(totalQty)} ${tr('quantity', 'Quantity').toLowerCase()}`, `${tr('rpt_line_sales', 'Line sales')} ${fmtMoney(totalLine)}`, totalProfit != null ? `${tr('rpt_gross_profit', 'Gross profit')} ${fmtMoney(totalProfit)} (${fmtPct(pct(totalProfit, totalLine))})` : null]) : ''}
        error={state.error}
        onRetry={state.reload}
        retryLabel={tr('retry', 'Retry')}
      >
        <ReportTable
          surfaceKey="reports-products"
          columns={columns}
          rows={productRows}
          rowKey={(r) => String(r.product_id ?? r.product_name)}
          style={style}
          fmtMoney={fmtMoney}
          labels={labels}
          loading={state.loading}
          totalsRow={productRows.length > 1 ? { product_id: null, product_name: labels.total, sale_count: productRows.reduce((s, r) => s + r.sale_count, 0), qty: totalQty, line_sales_usd: totalLine, ...(allProfit ? { cost_usd: round2(productRows.reduce((s, r) => s + num(r.cost_usd), 0)), profit_usd: totalProfit ?? 0, margin_pct: pct(totalProfit ?? 0, totalLine) } : {}) } : null}
          sort={sort}
          onSortChange={setSort}
          selectedKey={openKey}
          onRowClick={(row, el) => {
            anchorRef.current = el
            const k = String(row.product_id ?? row.product_name)
            setOpenKey((cur) => (cur === k ? null : k))
          }}
          maxHeight="70vh"
        />
        <Fold open={!!open} onClose={() => setOpenKey(null)} anchorRef={anchorRef} title={open?.product_name || ''}>
          <div className="p-2">
            {open ? (
              <ReceiptSheet
                blocks={[{
                  key: 'p',
                  lines: [
                    { label: tr('sales', 'Sales'), value: fmtInt(open.sale_count), kind: 'info' },
                    { label: tr('quantity', 'Quantity'), value: fmtQty(open.qty), kind: 'info' },
                    { label: tr('rpt_line_sales', 'Line sales'), value: fmtMoney(open.line_sales_usd), kind: 'total' },
                    ...(typeof open.profit_usd === 'number'
                      ? ([
                          { label: tr('cogs', 'Cost of goods'), value: fmtMoney(num(open.cost_usd)), kind: 'sub' },
                          { label: tr('rpt_gross_profit', 'Gross profit'), value: `${fmtMoney(open.profit_usd)} (${fmtPct(open.margin_pct ?? null)})`, kind: 'total' },
                          ...(open.cost_missing_snapshot_lines ? [{ label: tr('rpt_missing_cost_lines', 'Lines without cost snapshot'), value: fmtInt(open.cost_missing_snapshot_lines), kind: 'info' as const }] : []),
                        ] as ReceiptLine[])
                      : []),
                  ],
                }]}
              />
            ) : null}
          </div>
        </Fold>
      </ReportFrame>
    )
  }

  if (by === 'courier') {
    const columns: Array<ReportColumn<CourierRow>> = [
      { key: 'name', label: tr('rpt_courier', 'Courier'), primary: true, value: (r) => r.delivery_contact_name || tr('unknown', 'Unknown') },
      { key: 'deliveries', label: tr('rpt_deliveries', 'Deliveries'), kind: 'int', value: (r) => r.deliveries },
      { key: 'charged_fee_usd', label: tr('rpt_delivery_charged', 'Charged to customers'), kind: 'money', value: (r) => r.charged_fee_usd },
      { key: 'absorbed_fee_usd', label: tr('rpt_store_delivery', 'Store-paid delivery'), kind: 'money', value: (r) => r.absorbed_fee_usd },
      { key: 'actual_cost_usd', label: tr('rpt_delivery_cost', 'Actual cost'), kind: 'money', value: (r) => r.actual_cost_usd },
      { key: 'actual_cost_count', label: tr('rpt_costed_deliveries', 'Costed deliveries'), kind: 'int', value: (r) => r.actual_cost_count, defaultVisible: false },
      { key: 'margin_usd', label: tr('rpt_delivery_margin', 'Delivery margin'), kind: 'money', value: (r) => r.margin_usd, emphasis: true },
      { key: 'last_delivery_at', label: tr('rpt_last_delivery', 'Last delivery'), kind: 'datetime', value: (r) => r.last_delivery_at, defaultVisible: false },
    ]
    const sum = (k: keyof CourierRow) => round2(courierRows.reduce((s, r) => s + num(r[k]), 0))
    const csv = () => rowsToCsvObjects(csvColumnsFor(columns, fmtMoney), courierRows)
    return (
      <ReportFrame
        title={title}
        count={courierRows.length ? fmtInt(courierRows.length) : undefined}
        hint={{ label: title, text: tr('rpt_hint_couriers', 'Delivery sales per courier: what customers were charged, what the store absorbed, the recorded actual cost (only deliveries with a cost recorded) and the resulting margin.') }}
        actions={exportMenu(() => downloadCSV(reportFileName('couriers', filters, 'csv'), csv()), () => openPrintExport({ title: printTitle, subtitle, headers: columns.map((c) => c.label), rows: csv() }))}
        summary={courierRows.length ? joinSummary([countLabel(sum('deliveries'), REPORT_NOUNS.delivery, tr), `${tr('rpt_delivery_charged', 'Charged to customers')} ${fmtMoney(sum('charged_fee_usd'))}`, `${tr('rpt_store_delivery', 'Store-paid delivery')} ${fmtMoney(sum('absorbed_fee_usd'))}`, `${tr('rpt_delivery_cost', 'Actual cost')} ${fmtMoney(sum('actual_cost_usd'))}`, `${tr('rpt_delivery_margin', 'Delivery margin')} ${fmtMoney(sum('margin_usd'))}`]) : ''}
        error={state.error}
        onRetry={state.reload}
        retryLabel={tr('retry', 'Retry')}
      >
        <ReportTable
          surfaceKey="reports-couriers"
          columns={columns}
          rows={courierRows}
          rowKey={(r) => String(r.delivery_contact_id ?? r.delivery_contact_name)}
          style={style}
          fmtMoney={fmtMoney}
          labels={labels}
          loading={state.loading}
          totalsRow={courierRows.length > 1 ? { delivery_contact_id: null, delivery_contact_name: labels.total, deliveries: sum('deliveries'), charged_fee_usd: sum('charged_fee_usd'), absorbed_fee_usd: sum('absorbed_fee_usd'), actual_cost_usd: sum('actual_cost_usd'), actual_cost_count: sum('actual_cost_count'), margin_usd: sum('margin_usd'), last_delivery_at: null } : null}
          sort={sort}
          onSortChange={setSort}
          maxHeight="70vh"
        />
      </ReportFrame>
    )
  }

  // ---- canonical groups (customer / cashier / payment / hour / weekday / branch) ----
  const totals = sumTotals(groupRows)
  const showProfit = groupRows.length > 0 && groupRows.every((r) => hasProfit(r))
  const totalBasis = basisValue(totals, options.basis)
  const columns: Array<ReportColumn<GroupRow>> = [
    { key: 'label', label: tr(view.labelKey, view.fallback), primary: true, value: (r) => groupRowLabel(by, r, tr), sortDir: 'asc' },
    { key: 'tx_count', label: tr('sales', 'Sales'), kind: 'int', value: (r) => r.tx_count },
    { key: 'gross_sales_usd', label: tr('gross_sales', 'Gross sales'), kind: 'money', value: (r) => r.gross_sales_usd, defaultVisible: options.basis === 'gross', emphasis: options.basis === 'gross' },
    // EVERY discount on the sales in the group -- lines included.
    { key: 'discounts', label: tr('discounts', 'Discounts'), kind: 'money', value: (r) => r.total_discount_usd, defaultVisible: false },
    { key: 'item_discounts', label: tr('rpt_item_discounts', 'Product discounts'), kind: 'money', value: (r) => r.item_discount_usd, defaultVisible: false },
    { key: 'refund_usd', label: tr('refunds', 'Refunds'), kind: 'money', value: (r) => r.refund_usd },
    { key: 'revenue_usd', label: tr('revenue', 'Revenue'), kind: 'money', value: (r) => r.revenue_usd, emphasis: options.basis === 'revenue' },
    { key: 'share', label: tr('rpt_share', 'Share'), kind: 'pct', value: (r) => pct(basisValue(r, options.basis), totalBasis) },
    { key: 'pending_revenue_usd', label: tr('rpt_pending_credit', 'Unpaid credit'), kind: 'money', value: (r) => r.pending_revenue_usd, defaultVisible: false },
    { key: 'collected_total_usd', label: tr('collected_total', 'Collected total'), kind: 'money', value: (r) => r.collected_total_usd, defaultVisible: options.basis === 'collected', emphasis: options.basis === 'collected' },
    { key: 'avg_order_usd', label: tr('avg_order', 'Avg order'), kind: 'money', value: (r) => r.avg_order_usd, defaultVisible: false },
    ...(showProfit
      ? [
          { key: 'cost_usd', label: tr('cost', 'Cost'), kind: 'money', value: (r: GroupRow) => r.cost_usd ?? null, defaultVisible: false } as ReportColumn<GroupRow>,
          { key: 'profit_usd', label: tr('rpt_gross_profit', 'Gross profit'), kind: 'money', value: (r: GroupRow) => r.profit_usd ?? null } as ReportColumn<GroupRow>,
          { key: 'margin_pct', label: tr('rpt_margin', 'Margin'), kind: 'pct', value: (r: GroupRow) => pct(num(r.profit_usd), basisValue(r, options.basis)) } as ReportColumn<GroupRow>,
        ]
      : []),
  ]
  const csv = () => rowsToCsvObjects(csvColumnsFor(columns, fmtMoney), groupRows)
  const open = groupRows.find((r) => r.key === openKey) || null
  const drill = open ? groupDrill(by, open) : null
  const statement = open ? buildIncomeStatement({ sales: open, profitMode: 'gross', khrToUsd: p.khrToUsd }) : []
  const clockOrder = by === 'hour' || by === 'weekday'
  return (
    <ReportFrame
      title={title}
      count={groupRows.length ? fmtInt(groupRows.length) : undefined}
      hint={{ label: title, text: tr('rpt_hint_grouped', 'Each row is the full revenue calculation for that group (same definition as the Overview), so the rows add up to the totals line. Share = the row’s basis figure as a percentage of the total.') }}
      actions={exportMenu(() => downloadCSV(reportFileName(view.id, filters, 'csv'), csv()), () => openPrintExport({ title: printTitle, subtitle, headers: columns.map((c) => c.label), rows: csv() }))}
      summary={groupRows.length ? joinSummary([countLabel(groupRows.length, REPORT_NOUNS[by], tr), countLabel(totals.tx_count, REPORT_NOUNS.sale, tr), `${basisLabel} ${fmtMoney(totalBasis)}`, totals.refund_usd ? `${tr('refunds', 'Refunds')} ${fmtMoney(totals.refund_usd)}` : null, hasProfit(totals) ? `${tr('rpt_gross_profit', 'Gross profit')} ${fmtMoney(totals.profit_usd)} (${fmtPct(pct(totals.profit_usd, totalBasis))})` : null]) : ''}
      error={state.error}
      onRetry={state.reload}
      retryLabel={tr('retry', 'Retry')}
    >
      <ReportTable
        surfaceKey={`reports-${view.id}-${options.basis}`}
        columns={columns}
        rows={groupRows}
        rowKey={(r) => r.key}
        style={style}
        fmtMoney={fmtMoney}
        labels={labels}
        loading={state.loading}
        totalsRow={groupRows.length > 1 ? { ...totals, key: '__totals', label: labels.total, entity_id: null } : null}
        sort={sort ?? (clockOrder ? { key: 'label', dir: 'asc' } : null)}
        onSortChange={setSort}
        selectedKey={openKey}
        onRowClick={(row, el) => {
          anchorRef.current = el
          setOpenKey((cur) => (cur === row.key ? null : row.key))
        }}
        maxHeight="70vh"
      />
      <Fold
        open={!!open}
        onClose={() => setOpenKey(null)}
        anchorRef={anchorRef}
        title={open ? groupRowLabel(by, open, tr) : ''}
        actions={
          drill ? (
            <Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => p.onDrill(drill)}>
              {tr('rpt_view_sales', 'View sales')}
            </Button>
          ) : null
        }
      >
        <div className="p-2">
          {open ? (
            <ReceiptSheet
              blocks={[
                { key: 'meta', lines: [{ label: tr('sales', 'Sales'), value: fmtInt(open.tx_count), kind: 'info' }, { label: tr('avg_order', 'Avg order'), value: fmtMoney(open.avg_order_usd), kind: 'info' }, { label: tr('rpt_share', 'Share'), value: fmtPct(pct(basisValue(open, options.basis), totalBasis)), kind: 'info' }] },
                ...(['revenue', 'collected', 'profit'] as const)
                  .filter((grp) => statement.some((l) => l.group === grp))
                  .map((grp) => ({
                    key: grp,
                    title: grp === 'revenue' ? tr('revenue', 'Revenue') : grp === 'collected' ? tr('rpt_collected_group', 'Collected') : tr('profit', 'Profit'),
                    lines: statement.filter((l) => l.group === grp).map((l) => ({ key: l.key, label: tr(l.labelKey, l.fallback), value: fmtMoney(l.usd), kind: l.kind })),
                  })),
              ]}
            />
          ) : null}
        </div>
      </Fold>
    </ReportFrame>
  )
}
