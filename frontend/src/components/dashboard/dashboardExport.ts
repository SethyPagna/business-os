import { buildCSV, downloadZipFilesAsync } from '../../utils/csv.ts'
import { downloadXLSX } from '../../utils/xlsxExport.ts'
import { buildStandaloneReportHtml } from '../../utils/exportReports.tsx'
import { buildReportManifestRows, buildReportPackageFiles } from '../../utils/exportPackage.ts'
import { formatPriceNumber } from '../../utils/pricing.ts'
import { effectiveLowStockThreshold, type LowStockConfig } from '../../utils/lowStockSettings.ts'

type MetricMap = Record<string, number | undefined>
type Row = Record<string, unknown>

interface DashboardExportProduct extends Row {
  product_name?: string
  name?: string
  stock_quantity?: number
  low_stock_threshold?: number
  out_of_stock_threshold?: number
  qty_sold?: number
  revenue_usd?: number
}

interface DashboardExportCustomer extends Row {
  customer_name?: string
  sale_count?: number
  gross_revenue_usd?: number
  store_discount_usd?: number
  membership_discount_usd?: number
  total_refund_usd?: number
  net_revenue_usd?: number
}

interface DashboardExportSale extends Row {
  receipt_number?: string
  created_at?: string
  branch_name?: string
  customer_name?: string
  total?: number
  total_usd?: number
  total_khr?: number
}

interface DashboardExportAnalytics extends Row {
  totals?: MetricMap
  periodReturns?: MetricMap
  periodSupplierReturns?: MetricMap
  periodData?: Row[]
  byPayment?: Row[]
  byBranch?: Row[]
  topProducts?: DashboardExportProduct[]
  topProductsQty?: DashboardExportProduct[]
  topCustomers?: DashboardExportCustomer[]
}

interface DashboardExportSummary extends Row {
  product_count?: number
  in_stock_count?: number
  stock_value_usd?: number
  low_stock?: DashboardExportProduct[]
  out_of_stock?: DashboardExportProduct[]
  recent_sales?: DashboardExportSale[]
}

interface SummaryCard {
  label?: unknown
  value?: unknown
  sub?: unknown
}

export interface DashboardExportContext {
  activeChart: string
  analytics: DashboardExportAnalytics | null | undefined
  chartData: Row[]
  collectedExampleText: string
  collectedFormulaText: string
  exportStamp: string
  fmtUSD: (value: unknown) => string
  grossSalesLabel: string
  lowStockCount: number
  // Settings > Stock Alerts, so an exported "Threshold" column is the number
  // the row was actually judged by -- under 'All products' the per-product
  // column is not that number, and printing it would explain the colour with
  // a figure that did not decide it.
  lowStock: LowStockConfig
  netRevenueLabel: string
  outOfStockCount: number
  periodKpis: SummaryCard[]
  periodShort: string
  rangeLabel: string
  refundsLabel: string
  revenueExampleText: string
  revenueFormulaText: string
  summary: DashboardExportSummary | null | undefined
  topList: DashboardExportProduct[]
  topMode: string
  translateOr: (key: string, fallback: string) => string
  profitLabel: string
}

function priceCsv(value: unknown): string {
  return formatPriceNumber(value || 0)
}

function totals(ctx: DashboardExportContext): MetricMap {
  return ctx.analytics?.totals || {}
}

function periodReturns(ctx: DashboardExportContext): MetricMap {
  return ctx.analytics?.periodReturns || {}
}

function periodSupplierReturns(ctx: DashboardExportContext): MetricMap {
  return ctx.analytics?.periodSupplierReturns || {}
}

function buildDashboardKpiRows(ctx: DashboardExportContext): Row[] {
  const metricTotals = totals(ctx)
  const returns = periodReturns(ctx)
  const supplierReturns = periodSupplierReturns(ctx)
  return [
    { Section: 'KPI', Metric: 'Period', Value: ctx.periodShort, Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Gross Sales (USD)', Value: priceCsv(metricTotals.gross_sales_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Revenue (USD)', Value: priceCsv(metricTotals.revenue_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Discounts (USD)', Value: priceCsv(metricTotals.discount_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Store Discounts (USD)', Value: priceCsv(metricTotals.store_discount_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Tax (USD)', Value: priceCsv(metricTotals.tax_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Delivery (USD)', Value: priceCsv(metricTotals.delivery_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Products', Value: ctx.summary?.product_count || 0, Period: 'current inventory' },
    { Section: 'KPI', Metric: 'Stock Value (USD)', Value: priceCsv(ctx.summary?.stock_value_usd), Period: 'current inventory' },
    { Section: 'KPI', Metric: 'COGS (USD)', Value: priceCsv(metricTotals.cost_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Est. Profit (USD)', Value: priceCsv(metricTotals.profit_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Transactions', Value: metricTotals.tx_count || 0, Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Avg Order (USD)', Value: priceCsv(metricTotals.avg_order_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Returns', Value: returns.return_count || 0, Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Refunded (USD)', Value: priceCsv(returns.refund_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Supplier Returns', Value: supplierReturns.return_count || 0, Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'Business Loss (USD)', Value: priceCsv(supplierReturns.loss_usd), Period: ctx.rangeLabel },
    { Section: 'KPI', Metric: 'In Stock', Value: ctx.summary?.in_stock_count || 0, Period: 'all-time' },
    { Section: 'KPI', Metric: 'Low Stock', Value: ctx.lowStockCount, Period: 'all-time' },
    { Section: 'KPI', Metric: 'Out Of Stock', Value: ctx.outOfStockCount, Period: 'all-time' },
  ]
}

function buildDashboardFormulaRows(ctx: DashboardExportContext): Row[] {
  const metricTotals = totals(ctx)
  const returns = periodReturns(ctx)
  return [
    { Section: 'Calculation', Metric: 'Selected Range', Formula: ctx.rangeLabel, Example: ctx.periodShort },
    { Section: 'Calculation', Metric: 'Net revenue', Formula: ctx.revenueFormulaText, Example: ctx.revenueExampleText },
    { Section: 'Calculation', Metric: 'Collected total', Formula: ctx.collectedFormulaText, Example: ctx.collectedExampleText },
    {
      Section: 'Calculation',
      Metric: 'Estimated profit',
      Formula: 'Profit = Net revenue - COGS',
      Example: `${ctx.fmtUSD(metricTotals.profit_usd)} = ${ctx.fmtUSD(metricTotals.revenue_usd)} - ${ctx.fmtUSD(metricTotals.cost_usd)}`,
    },
    {
      Section: 'Calculation',
      Metric: 'Average order',
      Formula: 'Average order = Net revenue / transaction count',
      Example: `${ctx.fmtUSD(metricTotals.avg_order_usd)} from ${metricTotals.tx_count || 0} transactions`,
    },
    {
      Section: 'Calculation',
      Metric: 'Returns effect',
      Formula: 'Returns decrease net revenue and loyalty points',
      Example: `${returns.return_count || 0} returns, ${ctx.fmtUSD(returns.refund_usd)} refunded`,
    },
  ]
}

function buildDashboardManifestEntries(ctx: DashboardExportContext): Row[] {
  return [
    { metric: 'Range Preset', value: ctx.periodShort },
    { metric: 'Date Range', value: ctx.rangeLabel },
    { metric: 'Active Chart Mode', value: ctx.activeChart },
    { metric: 'Top Ranking Mode', value: ctx.topMode },
    { metric: 'Visible Sales Periods', value: ctx.chartData.length },
    { metric: 'Payment Methods', value: ctx.analytics?.byPayment?.length || 0 },
    { metric: 'Visible Branches', value: ctx.analytics?.byBranch?.length || 0 },
    { metric: 'Low Stock Items', value: ctx.lowStockCount },
    { metric: 'Out Of Stock Items', value: ctx.outOfStockCount },
    { metric: 'Generated At', value: new Date().toISOString() },
  ]
}

function buildDashboardSalesRows(ctx: DashboardExportContext): Row[] {
  return (ctx.analytics?.periodData || []).map((d) => ({
    Period: d.date || d.period || '',
    Gross_Sales_USD: priceCsv(d.gross_sales_usd),
    Discounts_USD: priceCsv(d.discount_usd),
    Tax_USD: priceCsv(d.tax_usd),
    Delivery_USD: priceCsv(d.delivery_usd),
    Refund_USD: priceCsv(d.refund_usd),
    Revenue_USD: priceCsv(d.revenue_usd),
    COGS_USD: priceCsv(d.cost_usd),
    Profit_USD: priceCsv(d.profit_usd),
    Tx: d.count || 0,
  }))
}

function buildDashboardTopProductRows(products: DashboardExportProduct[] = []): Row[] {
  return products.map((p, i) => ({
    Rank: i + 1,
    Product: p.product_name || '',
    Revenue_USD: priceCsv(p.revenue_usd),
    Qty: p.qty_sold || 0,
  }))
}

function buildDashboardTopCustomerRows(ctx: DashboardExportContext): Row[] {
  return (ctx.analytics?.topCustomers || []).map((c, i) => ({
    Rank: i + 1,
    Customer: c.customer_name || '',
    Sales: c.sale_count || 0,
    Gross: priceCsv(c.gross_revenue_usd),
    Store_Discounts: priceCsv(c.store_discount_usd),
    Membership_Discounts: priceCsv(c.membership_discount_usd),
    Returns: priceCsv(c.total_refund_usd),
    Net: priceCsv(c.net_revenue_usd),
  }))
}

function buildDashboardPaymentRows(ctx: DashboardExportContext): Row[] {
  return (ctx.analytics?.byPayment || []).map((p) => ({
    Method: p.payment_method || '',
    Count: p.count || 0,
    Revenue: priceCsv(p.revenue_usd),
  }))
}

function buildDashboardBranchRows(ctx: DashboardExportContext): Row[] {
  return (ctx.analytics?.byBranch || []).map((b) => ({
    Branch: b.branch_name || '',
    Tx: b.count || 0,
    Revenue: priceCsv(b.revenue_usd),
  }))
}

function buildDashboardLowStockRows(ctx: DashboardExportContext): Row[] {
  return (ctx.summary?.low_stock || []).map((p) => ({
    Product: p.name || '',
    Stock: p.stock_quantity || 0,
    Threshold: effectiveLowStockThreshold(ctx.lowStock, p.low_stock_threshold),
  }))
}

function buildDashboardOutStockRows(ctx: DashboardExportContext): Row[] {
  return (ctx.summary?.out_of_stock || []).map((p) => ({
    Product: p.name || '',
    Stock: p.stock_quantity || 0,
    Threshold: p.out_of_stock_threshold || 0,
  }))
}

function buildDashboardRecentRows(ctx: DashboardExportContext): Row[] {
  return (ctx.summary?.recent_sales || []).map((sale) => ({
    Receipt: sale.receipt_number || '',
    Created_At: sale.created_at || '',
    Branch: sale.branch_name || '',
    Customer: sale.customer_name || '',
    Total_USD: priceCsv(sale.total_usd || sale.total),
    Total_KHR: priceCsv(sale.total_khr),
  }))
}

function hasDashboardExportData(ctx: DashboardExportContext): boolean {
  return !!ctx.analytics && !!ctx.summary
}

export function exportDashboardFull(ctx: DashboardExportContext): void {
  if (!hasDashboardExportData(ctx)) return
  const manifestRows = buildReportManifestRows(buildDashboardManifestEntries(ctx)).map((row) => ({
    Section: row.Section,
    Metric: row.Metric,
    Value: row.Value,
    Period: ctx.rangeLabel,
  }))
  const all: Row[] = [
    ...manifestRows,
    ...buildDashboardKpiRows(ctx),
    ...buildDashboardFormulaRows(ctx),
    ...buildDashboardSalesRows(ctx).map((row) => ({ Section: 'Period Sales', ...row })),
    ...buildDashboardTopProductRows(ctx.analytics?.topProducts || []).map((row) => ({ Section: 'Top Products (Rev)', ...row })),
    ...buildDashboardTopCustomerRows(ctx).map((row) => ({ Section: 'Top Customers', ...row })),
    ...buildDashboardPaymentRows(ctx).map((row) => ({ Section: 'Payments', ...row })),
    ...buildDashboardBranchRows(ctx).map((row) => ({ Section: 'Branches', ...row })),
    ...buildDashboardLowStockRows(ctx).map((row) => ({ Section: 'Low Stock', ...row })),
    ...buildDashboardOutStockRows(ctx).map((row) => ({ Section: 'Out Of Stock', ...row })),
  ]
  const keys = [...new Set(all.flatMap((row) => Object.keys(row)))]
  downloadXLSX(`dashboard-full-${ctx.exportStamp}.xlsx`, all.map((row) => Object.fromEntries(keys.map((key) => [key, row[key] ?? '']))))
}

export function exportDashboardStats(ctx: DashboardExportContext): void {
  if (!hasDashboardExportData(ctx)) return
  const rows = [
    ...buildReportManifestRows(buildDashboardManifestEntries(ctx)).map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: row.Value,
      Formula: '',
      Example: '',
    })),
    ...buildDashboardKpiRows(ctx).map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: row.Value,
      Formula: '',
      Example: row.Period || '',
    })),
    ...buildDashboardFormulaRows(ctx).map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: '',
      Formula: row.Formula,
      Example: row.Example,
    })),
  ]
  downloadXLSX(`dashboard-stats-${ctx.exportStamp}.xlsx`, rows)
}

export function exportDashboardKpis(ctx: DashboardExportContext): void {
  if (!hasDashboardExportData(ctx)) return
  downloadXLSX(`dashboard-kpi-${ctx.exportStamp}.xlsx`, buildDashboardKpiRows(ctx))
}

export function exportDashboardSalesChart(ctx: DashboardExportContext): void {
  const rows = ctx.chartData.map((d) => ({
    Period: d.date || d.period || '',
    Gross_Sales_USD: d.gross_sales_usd || 0,
    Discounts_USD: d.discount_usd || 0,
    Tax_USD: d.tax_usd || 0,
    Delivery_USD: d.delivery_usd || 0,
    Refund_USD: d.refund_usd || 0,
    Revenue_USD: d.revenue_usd || 0,
    COGS_USD: d.cost_usd || 0,
    Profit_USD: d.profit_usd || 0,
    Tx: d.count || 0,
  }))
  downloadXLSX(`dashboard-sales-${ctx.exportStamp}.xlsx`, rows)
}

export function exportDashboardTopProducts(ctx: DashboardExportContext): void {
  downloadXLSX(`dashboard-top-products-${ctx.exportStamp}.xlsx`, buildDashboardTopProductRows(ctx.topList))
}

export function exportDashboardTopCustomers(ctx: DashboardExportContext): void {
  if (!hasDashboardExportData(ctx)) return
  downloadXLSX(`dashboard-top-customers-${ctx.exportStamp}.xlsx`, buildDashboardTopCustomerRows(ctx))
}

export function exportDashboardPaymentMethods(ctx: DashboardExportContext): void {
  if (!hasDashboardExportData(ctx)) return
  downloadXLSX(`dashboard-payments-${ctx.exportStamp}.xlsx`, buildDashboardPaymentRows(ctx))
}

export function exportDashboardBranches(ctx: DashboardExportContext): void {
  if (!hasDashboardExportData(ctx)) return
  downloadXLSX(`dashboard-branches-${ctx.exportStamp}.xlsx`, buildDashboardBranchRows(ctx))
}

export async function exportDashboardPackage(ctx: DashboardExportContext): Promise<void> {
  if (!hasDashboardExportData(ctx)) return
  const salesRows = buildDashboardSalesRows(ctx)
  const topProductRows = buildDashboardTopProductRows(ctx.analytics?.topProducts || [])
  const topCustomerRows = buildDashboardTopCustomerRows(ctx)
  const paymentRows = buildDashboardPaymentRows(ctx)
  const branchRows = buildDashboardBranchRows(ctx)
  const lowRows = buildDashboardLowStockRows(ctx)
  const outRows = buildDashboardOutStockRows(ctx)
  const recentRows = buildDashboardRecentRows(ctx)
  const manifestRows = buildReportManifestRows(buildDashboardManifestEntries(ctx))
  const reportContent = buildStandaloneReportHtml({
    title: 'Dashboard Analytics Report',
    subtitle: `${ctx.periodShort} - ${ctx.rangeLabel}`,
    exportedAt: new Date().toISOString(),
    summaryCards: ctx.periodKpis.slice(0, 6).map((kpi) => ({
      label: String(kpi.label ?? ''),
      value: String(kpi.value ?? ''),
      sub: kpi.sub ? String(kpi.sub) : '',
    })),
    metadataGroups: [
      {
        title: 'Active Range',
        subtitle: 'Filters and export context for this package',
        rows: [
          { label: 'Range preset', value: ctx.periodShort },
          { label: 'Date range', value: ctx.rangeLabel },
          { label: 'Chart mode', value: ctx.activeChart },
          { label: 'Top ranking mode', value: ctx.topMode },
        ],
      },
      {
        title: 'Visible Data',
        subtitle: 'Counts for the exported data slices',
        rows: [
          { label: 'Sales periods', value: ctx.chartData.length },
          { label: 'Payment methods', value: paymentRows.length },
          { label: 'Branches', value: branchRows.length },
          { label: 'Low-stock items', value: ctx.lowStockCount },
          { label: 'Out-of-stock items', value: ctx.outOfStockCount },
        ],
      },
    ],
    charts: [
      {
        type: 'line',
        title: 'Revenue flow over time',
        subtitle: 'Gross sales, refunds, and net revenue',
        props: {
          data: ctx.chartData,
          lines: [
            { key: 'gross_sales_usd', color: '#0891b2', label: ctx.grossSalesLabel },
            { key: 'refund_usd', color: '#f97316', label: ctx.refundsLabel },
            { key: 'revenue_usd', color: '#2563eb', label: ctx.netRevenueLabel },
          ],
        },
      },
      {
        type: 'line',
        title: 'Revenue vs COGS vs Profit',
        subtitle: 'Visible period comparison',
        props: {
          data: ctx.chartData,
          lines: [
            { key: 'revenue_usd', color: '#2563eb', label: ctx.translateOr('revenue', 'Revenue') || 'Revenue' },
            { key: 'cost_usd', color: '#dc2626', label: ctx.translateOr('cogs', 'COGS') || 'COGS' },
            { key: 'profit_usd', color: '#16a34a', label: ctx.profitLabel },
          ],
        },
      },
      {
        type: 'bar',
        title: 'Sales count over time',
        subtitle: 'Number of receipts/sale records',
        props: { data: ctx.chartData, valueKey: 'count', labelKey: 'period', color: '#7c3aed', isCount: true },
      },
      {
        type: 'donut',
        title: 'Payment distribution',
        subtitle: 'Revenue share by payment method',
        props: { data: ctx.analytics?.byPayment || [], valueKey: 'revenue_usd' },
      },
      {
        type: 'bar',
        title: 'Branch performance',
        subtitle: 'Revenue by branch',
        props: { data: ctx.analytics?.byBranch || [], valueKey: 'revenue_usd', labelKey: 'branch_name', color: '#0891b2' },
      },
      {
        type: 'bar',
        title: 'Top products by revenue',
        subtitle: 'Current visible ranking',
        props: { data: ctx.analytics?.topProducts || [], valueKey: 'revenue_usd', labelKey: 'product_name', color: '#ea580c' },
      },
    ],
    tables: [
      { title: 'Top products', subtitle: 'Revenue leaders in the selected range', rows: topProductRows, limit: 10 },
      { title: 'Top customers', subtitle: 'Highest-value customers in the selected range', rows: topCustomerRows, limit: 10 },
      { title: 'Payment methods', subtitle: 'Count and revenue by payment type', rows: paymentRows },
      { title: 'Branch performance', subtitle: 'Transaction and revenue totals', rows: branchRows },
      { title: 'Low-stock summary', subtitle: 'Current low-stock items from all-time inventory state', rows: lowRows, limit: 12 },
      { title: 'Out-of-stock summary', subtitle: 'Current out-of-stock items from all-time inventory state', rows: outRows, limit: 12 },
      { title: 'Recent sales', subtitle: 'Latest receipts included in the dashboard summary', rows: recentRows, limit: 12 },
    ],
    notes: [
      ctx.revenueFormulaText,
      ctx.collectedFormulaText,
      'Package includes raw CSV exports, formulas, and this self-contained HTML report.',
    ],
  })
  const files = buildReportPackageFiles({
    baseName: 'dashboard',
    exportStamp: ctx.exportStamp,
    manifestRows,
    csvFiles: [
      { name: `dashboard-export-context-${ctx.exportStamp}.csv`, content: buildCSV(manifestRows) },
      { name: `dashboard-kpis-${ctx.exportStamp}.csv`, content: buildCSV(buildDashboardKpiRows(ctx)) },
      { name: `dashboard-calculations-${ctx.exportStamp}.csv`, content: buildCSV(buildDashboardFormulaRows(ctx)) },
      { name: `dashboard-sales-${ctx.exportStamp}.csv`, content: buildCSV(salesRows) },
      { name: `dashboard-top-products-${ctx.exportStamp}.csv`, content: buildCSV(topProductRows) },
      { name: `dashboard-top-customers-${ctx.exportStamp}.csv`, content: buildCSV(topCustomerRows) },
      { name: `dashboard-payments-${ctx.exportStamp}.csv`, content: buildCSV(paymentRows) },
      { name: `dashboard-branches-${ctx.exportStamp}.csv`, content: buildCSV(branchRows) },
      { name: `dashboard-low-stock-${ctx.exportStamp}.csv`, content: buildCSV(lowRows) },
      { name: `dashboard-out-of-stock-${ctx.exportStamp}.csv`, content: buildCSV(outRows) },
      { name: `dashboard-recent-sales-${ctx.exportStamp}.csv`, content: buildCSV(recentRows) },
    ],
    reportFileName: 'dashboard-report.html',
    reportContent,
  })
  await downloadZipFilesAsync(`dashboard-report-${ctx.exportStamp}.zip`, files)
}
