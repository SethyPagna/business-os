import { formatPriceNumber } from '../../utils/pricing.ts'

type AnyRecord = Record<string, any>
type MoneyFormatter = (value: number) => string
type Translator = (key: string, fallbackEn?: string, fallbackKm?: string) => string
type StockGetter = (product?: AnyRecord | null) => number
type BranchLabelGetter = (id: any, fallback?: any) => string

export type InventoryExportScope = {
  branchFilter: string
  brandFilter: string
  exportStamp: string
  filteredSummary: AnyRecord[]
  fmtUSD: MoneyFormatter
  getBranchLabel: BranchLabelGetter
  getStockQty: StockGetter
  inStockCount: number
  lowStockCount: number
  movFilter: string
  movementDateRangeLabel: string
  movementGroupMode: string
  movementMonthFilter: string
  movementSortDirection: string
  movementTimeMode: string
  movementYearFilter: string
  outStockCount: number
  returnStats?: AnyRecord | null
  search: string
  stockFilter: string
  tab: string
  taxDelivery: AnyRecord
  totalCOGS: number
  totalMembershipDiscounts: number
  totalProducts: number
  totalProfit: number
  totalQtySold: number
  totalRevenue: number
  totalStoreDiscounts: number
  totalValue: number
  tr: Translator
  visibleMovementGroups: AnyRecord[]
  visibleMovementQuantity: number
  visibleMovementRecordCount: number
}

type InventoryExportTools = {
  buildCSV: (rows: unknown[]) => string
  buildReportManifestRows: (rows: unknown[]) => AnyRecord[]
  buildReportPackageFiles: (options: AnyRecord) => AnyRecord[]
  buildStandaloneReportHtml: (options: AnyRecord) => string
  downloadCSV: (filename: string, rows: unknown[]) => void
  downloadXLSX: (filename: string, rows: unknown[]) => void
  downloadZipFilesAsync: (filename: string, files: AnyRecord[]) => Promise<void>
}

let inventoryExportToolsPromise: Promise<InventoryExportTools> | null = null

async function loadInventoryExportTools(): Promise<InventoryExportTools> {
  if (!inventoryExportToolsPromise) {
    inventoryExportToolsPromise = Promise.all([
      import('../../utils/csv'),
      import('../../utils/xlsxExport'),
      import('../../utils/exportReports'),
      import('../../utils/exportPackage'),
    ]).then(([csvUtils, xlsxUtils, reportUtils, packageUtils]) => ({
      ...csvUtils,
      ...xlsxUtils,
      ...reportUtils,
      ...packageUtils,
    }) as unknown as InventoryExportTools)
  }
  return inventoryExportToolsPromise
}

function priceCsv(value: unknown): string {
  return formatPriceNumber(value || 0)
}

function parseExportTimestamp(value: unknown): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalizedBase = raw.includes('T') ? raw : raw.replace(' ', 'T')
  let normalized = `${normalizedBase}Z`
  if (/Z$/i.test(normalizedBase)) normalized = normalizedBase
  else if (/[+-]\d{2}:\d{2}$/i.test(normalizedBase)) normalized = normalizedBase
  else if (/[+-]\d{4}$/i.test(normalizedBase)) normalized = normalizedBase.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
  else if (/[+-]\d{2}$/i.test(normalizedBase)) normalized = `${normalizedBase}:00`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getMovementActivityRows(groups: AnyRecord[]): AnyRecord[] {
  const map = new Map<string, AnyRecord>()
  groups.forEach((group) => {
    const key = String(group.movement_type || group.movementLabel || 'other')
    const current = map.get(key) || {
      name: group.movementLabel || key,
      groups: 0,
      quantity: 0,
      total_cost_usd: 0,
    }
    current.groups += 1
    current.quantity += Number(group.totalQuantity || 0)
    current.total_cost_usd += Number(group.totalCostUsd || 0)
    map.set(key, current)
  })
  return [...map.values()].sort((left, right) => right.quantity - left.quantity || right.groups - left.groups)
}

function getMovementVolumeRows(groups: AnyRecord[], movementTimeMode: string): AnyRecord[] {
  const map = new Map<string, AnyRecord>()
  groups.forEach((group) => {
    const raw = group.latest_at || group.items?.[0]?.created_at || ''
    const date = parseExportTimestamp(raw)
    if (!date) return
    const period = movementTimeMode === 'year'
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })
    const current = map.get(period) || { period, count: 0, quantity: 0, total_cost_usd: 0 }
    current.count += Number(group.items?.length || 0)
    current.quantity += Number(group.totalQuantity || 0)
    current.total_cost_usd += Number(group.totalCostUsd || 0)
    map.set(period, current)
  })
  return [...map.values()]
}

function getStockStatusRows(scope: InventoryExportScope): AnyRecord[] {
  return [
    { name: scope.tr('in_stock', 'In Stock'), value: scope.inStockCount },
    { name: scope.tr('low_stock', 'Low Stock'), value: scope.lowStockCount },
    { name: scope.tr('out_of_stock', 'Out of Stock'), value: scope.outStockCount },
  ]
}

function getTopStockValueRows(scope: InventoryExportScope): AnyRecord[] {
  return [...scope.filteredSummary]
    .sort((left, right) => Number(right.stock_value_usd || 0) - Number(left.stock_value_usd || 0))
    .slice(0, 10)
    .map((product) => ({
      Product: product.name || '',
      Stock_Value_USD: Number(product.stock_value_usd || 0),
      Stock_Qty: scope.getStockQty(product),
      Revenue_USD: Number(product.revenue_usd || 0),
      Brand: product.brand || '',
    }))
}

function getBranchComparisonRows(scope: InventoryExportScope): AnyRecord[] {
  const map = new Map<string, AnyRecord>()
  scope.filteredSummary.forEach((product) => {
    const cost = Number(product.purchase_price_usd || product.cost_price_usd || 0)
    if (!Array.isArray(product.branch_stock) || !product.branch_stock.length) return
    product.branch_stock.forEach((branchStock: AnyRecord) => {
      const key = String(branchStock.branch_id || branchStock.branch_name || '')
      if (!key) return
      const current = map.get(key) || {
        branch_name: branchStock.branch_name || scope.getBranchLabel(key, key),
        quantity: 0,
        stock_value_usd: 0,
        product_count: 0,
      }
      const quantity = Number(branchStock.quantity || 0)
      current.quantity += quantity
      current.stock_value_usd += quantity * cost
      if (quantity > 0) current.product_count += 1
      map.set(key, current)
    })
  })
  return [...map.values()].sort((left, right) => right.stock_value_usd - left.stock_value_usd || right.quantity - left.quantity)
}

function buildInventoryStatsRows(scope: InventoryExportScope): AnyRecord[] {
  return [
    { Section: 'Inventory Stats', Metric: 'View Tab', Value: scope.tab },
    { Section: 'Inventory Stats', Metric: 'Branch Filter', Value: scope.branchFilter === 'all' ? 'All branches' : scope.getBranchLabel(scope.branchFilter, scope.branchFilter) },
    { Section: 'Inventory Stats', Metric: 'Brand Filter', Value: scope.brandFilter === 'all' ? 'All brands' : scope.brandFilter },
    { Section: 'Inventory Stats', Metric: 'Stock Filter', Value: scope.stockFilter },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Date Range', Value: scope.movementDateRangeLabel },
    { Section: 'Inventory Stats', Metric: 'Search', Value: scope.search || '' },
    { Section: 'Inventory Stats', Metric: 'Movement Year Filter', Value: scope.movementYearFilter },
    { Section: 'Inventory Stats', Metric: 'Movement Month Filter', Value: scope.movementMonthFilter },
    { Section: 'Inventory Stats', Metric: 'Movement Type Filter', Value: scope.movFilter },
    { Section: 'Inventory Stats', Metric: 'Movement Group Mode', Value: scope.movementGroupMode },
    { Section: 'Inventory Stats', Metric: 'Movement Sort Direction', Value: scope.movementSortDirection },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Groups', Value: scope.visibleMovementGroups.length },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Records', Value: scope.visibleMovementRecordCount },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Quantity', Value: scope.visibleMovementQuantity },
    { Section: 'Inventory Stats', Metric: 'Visible Products', Value: scope.filteredSummary.length },
    { Section: 'Inventory Stats', Metric: 'Total Products', Value: scope.totalProducts },
    { Section: 'Inventory Stats', Metric: 'Low Stock Count', Value: scope.lowStockCount },
    { Section: 'Inventory Stats', Metric: 'Out Of Stock Count', Value: scope.outStockCount },
    { Section: 'Inventory Stats', Metric: 'Stock Value (USD)', Value: scope.totalValue.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Net Sold Qty', Value: scope.totalQtySold },
    { Section: 'Inventory Stats', Metric: 'Revenue (USD)', Value: scope.totalRevenue.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'COGS (USD)', Value: scope.totalCOGS.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Gross Profit (USD)', Value: scope.totalProfit.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Store Discounts (USD)', Value: scope.totalStoreDiscounts.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Membership Discounts (USD)', Value: scope.totalMembershipDiscounts.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Returns Count', Value: scope.returnStats?.count ?? 0 },
    { Section: 'Inventory Stats', Metric: 'Return Refunds (USD)', Value: Number(scope.returnStats?.refund_usd || 0).toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Tax Collected (USD)', Value: Number(scope.taxDelivery?.tax || 0).toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Delivery Fees (USD)', Value: Number(scope.taxDelivery?.delivery || 0).toFixed(2) },
  ]
}

function buildInventoryFormulaRows(scope: InventoryExportScope, stockStatusRows: AnyRecord[]): AnyRecord[] {
  return [
    {
      Section: 'Calculation',
      Metric: 'Visible stock value',
      Formula: 'Stock value = sum(stock quantity * unit cost)',
      Example: `${scope.fmtUSD(scope.totalValue)} across ${scope.filteredSummary.length} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Gross profit',
      Formula: 'Gross profit = revenue - COGS',
      Example: `${scope.fmtUSD(scope.totalProfit)} = ${scope.fmtUSD(scope.totalRevenue)} - ${scope.fmtUSD(scope.totalCOGS)}`,
    },
    {
      Section: 'Calculation',
      Metric: 'In-stock count',
      Formula: 'In stock = quantity greater than the low-stock threshold',
      Example: `${stockStatusRows[0]?.value || 0} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Low-stock count',
      Formula: 'Low stock = quantity above out-of-stock threshold and at or below low-stock threshold',
      Example: `${scope.lowStockCount} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Out-of-stock count',
      Formula: 'Out of stock = quantity at or below out-of-stock threshold',
      Example: `${scope.outStockCount} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Visible movement quantity',
      Formula: 'Visible movement quantity = sum(group quantities after filters/grouping)',
      Example: `${scope.visibleMovementQuantity} units across ${scope.visibleMovementRecordCount} records in ${scope.visibleMovementGroups.length} visible movement groups`,
    },
  ]
}

function buildMovementFilterRows(scope: InventoryExportScope): AnyRecord[] {
  return [
    { Section: 'Movement Filters', Metric: 'Branch Filter', Value: scope.branchFilter === 'all' ? 'All branches' : scope.getBranchLabel(scope.branchFilter, scope.branchFilter) },
    { Section: 'Movement Filters', Metric: 'Movement Type Filter', Value: scope.movFilter },
    { Section: 'Movement Filters', Metric: 'Year Filter', Value: scope.movementYearFilter },
    { Section: 'Movement Filters', Metric: 'Month Filter', Value: scope.movementMonthFilter },
    { Section: 'Movement Filters', Metric: 'Group Mode', Value: scope.movementGroupMode },
    { Section: 'Movement Filters', Metric: 'Sort Direction', Value: scope.movementSortDirection },
    { Section: 'Movement Filters', Metric: 'Search', Value: scope.search || '' },
    { Section: 'Movement Filters', Metric: 'Visible Movement Groups', Value: scope.visibleMovementGroups.length },
    { Section: 'Movement Filters', Metric: 'Visible Movement Records', Value: scope.visibleMovementRecordCount },
    { Section: 'Movement Filters', Metric: 'Visible Movement Quantity', Value: scope.visibleMovementQuantity },
  ]
}

function buildInventoryExportContextRows(scope: InventoryExportScope): AnyRecord[] {
  return [
    { Section: 'Export Context', Metric: 'Active Tab', Value: scope.tab },
    { Section: 'Export Context', Metric: 'Branch Filter', Value: scope.branchFilter === 'all' ? 'All branches' : scope.getBranchLabel(scope.branchFilter, scope.branchFilter) },
    { Section: 'Export Context', Metric: 'Brand Filter', Value: scope.brandFilter === 'all' ? 'All brands' : scope.brandFilter },
    { Section: 'Export Context', Metric: 'Stock Filter', Value: scope.stockFilter },
    { Section: 'Export Context', Metric: 'Movement Type Filter', Value: scope.movFilter },
    { Section: 'Export Context', Metric: 'Movement Date Range', Value: scope.movementDateRangeLabel },
    { Section: 'Export Context', Metric: 'Movement Group Mode', Value: scope.movementGroupMode },
    { Section: 'Export Context', Metric: 'Movement Sort Direction', Value: scope.movementSortDirection },
    { Section: 'Export Context', Metric: 'Year Filter', Value: scope.movementYearFilter },
    { Section: 'Export Context', Metric: 'Month Filter', Value: scope.movementMonthFilter },
    { Section: 'Export Context', Metric: 'Search', Value: scope.search || '' },
    { Section: 'Export Context', Metric: 'Visible Products', Value: scope.filteredSummary.length },
    { Section: 'Export Context', Metric: 'Visible Movement Groups', Value: scope.visibleMovementGroups.length },
    { Section: 'Export Context', Metric: 'Visible Movement Records', Value: scope.visibleMovementRecordCount },
    { Section: 'Export Context', Metric: 'Generated At', Value: new Date().toISOString() },
  ]
}

function buildMovementRows(groups: AnyRecord[]): AnyRecord[] {
  return groups.map((group) => ({
    Date: group.latest_at || '',
    Activity: group.movementLabel || '',
    Products: group.productSummary || '',
    Records: group.items?.length || 0,
    Qty: group.totalQuantity || 0,
    Total_Cost_USD: priceCsv(group.totalCostUsd || 0),
    Branch: group.branchSummary || '',
    Reason: group.reasonSummary || '',
    User: group.userSummary || '',
  }))
}

function buildInventoryProductRows(productsToExport: AnyRecord[], getStockQty: StockGetter): AnyRecord[] {
  return productsToExport.map((product) => ({
    Name: product.name || '',
    SKU: product.sku || '',
    Category: product.category || '',
    Brand: product.brand || '',
    Selling_Price_USD: priceCsv(product.selling_price_usd || 0),
    Selling_Price_KHR: priceCsv(product.selling_price_khr || 0),
    VIP_Price_USD: priceCsv(product.special_price_usd || 0),
    VIP_Price_KHR: priceCsv(product.special_price_khr || 0),
    Discount_Enabled: product.discount_enabled ? 'yes' : 'no',
    Discount_Type: product.discount_type || '',
    Discount_Percent: priceCsv(product.discount_percent || 0),
    Discount_Amount_USD: priceCsv(product.discount_amount_usd || 0),
    Discount_Amount_KHR: priceCsv(product.discount_amount_khr || 0),
    Discount_Label: product.discount_label || '',
    Discount_Badge_Color: product.discount_badge_color || '',
    Discount_Starts_At: product.discount_starts_at || '',
    Discount_Ends_At: product.discount_ends_at || '',
    Cost_Price_USD: priceCsv(product.purchase_price_usd || product.cost_price_usd || 0),
    Cost_Price_KHR: priceCsv(product.purchase_price_khr || product.cost_price_khr || 0),
    Stock_Qty: getStockQty(product),
    Sold_Qty: product.qty_sold || 0,
    Revenue_USD: priceCsv(product.revenue_usd || 0),
    COGS_USD: priceCsv(product.cogs_usd || 0),
    Profit_USD: priceCsv((product.revenue_usd || 0) - (product.cogs_usd || 0)),
    Stock_Value_USD: priceCsv(getStockQty(product) * (product.purchase_price_usd || product.cost_price_usd || 0)),
    Unit: product.unit || '',
    Supplier: product.supplier || '',
  }))
}

export async function exportInventoryMovementGroups(scope: InventoryExportScope, groups: AnyRecord[], filePrefix = 'inventory-movements'): Promise<void> {
  const { downloadXLSX } = await loadInventoryExportTools()
  downloadXLSX(`${filePrefix}-${scope.exportStamp}.xlsx`, buildMovementRows(groups))
}

export async function exportInventorySummary(scope: InventoryExportScope, productsToExport: AnyRecord[] = scope.filteredSummary, filePrefix = 'inventory'): Promise<void> {
  const { downloadXLSX } = await loadInventoryExportTools()
  downloadXLSX(`${filePrefix}-${scope.exportStamp}.xlsx`, buildInventoryProductRows(productsToExport, scope.getStockQty))
}

export async function exportInventoryStats(scope: InventoryExportScope, filePrefix = 'inventory-stats'): Promise<void> {
  const { downloadXLSX } = await loadInventoryExportTools()
  const stockStatusRows = getStockStatusRows(scope)
  const rows = [
    ...buildInventoryExportContextRows(scope).map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: row.Value,
      Formula: '',
      Example: '',
    })),
    ...buildInventoryStatsRows(scope).map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: row.Value,
      Formula: '',
      Example: '',
    })),
    ...buildInventoryFormulaRows(scope, stockStatusRows).map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: '',
      Formula: row.Formula,
      Example: row.Example,
    })),
  ]
  downloadXLSX(`${filePrefix}-${scope.exportStamp}.xlsx`, rows)
}

export async function exportInventoryPackage(scope: InventoryExportScope, mode = scope.tab): Promise<void> {
  const {
    buildCSV,
    buildReportManifestRows,
    buildReportPackageFiles,
    buildStandaloneReportHtml,
    downloadZipFilesAsync,
  } = await loadInventoryExportTools()
  const stockStatusRows = getStockStatusRows(scope)
  const topStockValueRows = getTopStockValueRows(scope)
  const branchComparisonRows = getBranchComparisonRows(scope)
  const movementActivityRows = getMovementActivityRows(scope.visibleMovementGroups)
  const movementVolumeRows = getMovementVolumeRows(scope.visibleMovementGroups, scope.movementTimeMode)
  const movementRows = buildMovementRows(scope.visibleMovementGroups)
  const productRows = buildInventoryProductRows(scope.filteredSummary, scope.getStockQty)
  const statsRows = buildInventoryStatsRows(scope)
  const formulaRows = buildInventoryFormulaRows(scope, stockStatusRows)
  const contextRows = buildInventoryExportContextRows(scope)
  const manifestRows = buildReportManifestRows(contextRows.map((row) => ({
    metric: row.Metric,
    value: row.Value,
  })))
  const reportContent = buildStandaloneReportHtml({
    fileName: 'inventory-report.html',
    title: 'Inventory Report',
    subtitle: `${mode === 'movements' ? 'Movements' : 'Products'} | ${scope.movementDateRangeLabel}`,
    exportedAt: new Date().toISOString(),
    summaryCards: [
      { label: 'Visible Products', value: scope.filteredSummary.length, sub: `${scope.totalProducts} total products` },
      { label: 'Visible Movement Groups', value: scope.visibleMovementGroups.length, sub: scope.movementDateRangeLabel },
      { label: scope.tr('stock_value', 'Stock Value'), value: scope.fmtUSD(scope.totalValue), sub: `${scope.tr('gross_profit', 'Gross profit')} ${scope.fmtUSD(scope.totalProfit)}` },
      { label: scope.tr('revenue', 'Revenue'), value: scope.fmtUSD(scope.totalRevenue), sub: `${scope.tr('cogs', 'COGS')} ${scope.fmtUSD(scope.totalCOGS)}` },
      { label: scope.tr('low_stock', 'Low Stock'), value: scope.lowStockCount, sub: `${scope.tr('out_of_stock', 'Out of stock')} ${scope.outStockCount}` },
      { label: scope.tr('returns_count', 'Returns'), value: scope.returnStats?.count ?? 0, sub: `${scope.tr('total_refunded', 'Refunded')} ${scope.fmtUSD(scope.returnStats?.refund_usd || 0)}` },
    ],
    metadataGroups: [
      {
        title: 'Active Filters',
        subtitle: 'Visible inventory scope captured in this export',
        rows: [
          { label: 'View', value: mode },
          { label: 'Branch', value: scope.branchFilter === 'all' ? 'All branches' : scope.getBranchLabel(scope.branchFilter, scope.branchFilter) },
          { label: 'Brand', value: scope.brandFilter === 'all' ? 'All brands' : scope.brandFilter },
          { label: 'Stock status', value: scope.stockFilter },
          { label: 'Search', value: scope.search || 'None' },
        ],
      },
      {
        title: 'Movement Filters',
        subtitle: 'Grouping and date metadata for the visible movement set',
        rows: [
          { label: 'Date range', value: scope.movementDateRangeLabel },
          { label: 'Year filter', value: scope.movementYearFilter },
          { label: 'Month filter', value: scope.movementMonthFilter },
          { label: 'Activity type', value: scope.movFilter },
          { label: 'Group mode', value: scope.movementGroupMode },
          { label: 'Sort direction', value: scope.movementSortDirection },
        ],
      },
    ],
    charts: [
      {
        type: 'donut',
        title: 'Stock status distribution',
        subtitle: 'Visible products by current stock state',
        props: { data: stockStatusRows, valueKey: 'value' },
      },
      {
        type: 'bar',
        title: 'Top stock-value products',
        subtitle: 'Highest stock value in the visible set',
        props: { data: topStockValueRows.map((row) => ({ product_name: row.Product, stock_value_usd: row.Stock_Value_USD })), valueKey: 'stock_value_usd', labelKey: 'product_name', color: '#2563eb' },
      },
      {
        type: 'donut',
        title: 'Movement activity mix',
        subtitle: 'Visible movement groups by activity type',
        props: { data: movementActivityRows.map((row) => ({ name: row.name, value: row.quantity })), valueKey: 'value' },
      },
      {
        type: 'bar',
        title: 'Movement volume over time',
        subtitle: 'Visible movement quantity by period bucket',
        props: { data: movementVolumeRows, valueKey: 'quantity', labelKey: 'period', color: '#7c3aed', isCount: true },
      },
      ...(branchComparisonRows.length > 1 ? [{
        type: 'bar',
        title: 'Branch comparison',
        subtitle: 'Stock value by branch',
        props: { data: branchComparisonRows, valueKey: 'stock_value_usd', labelKey: 'branch_name', color: '#0891b2' },
      }] : []),
    ],
    tables: [
      { title: 'Inventory stats', subtitle: 'Core figures and active filters', rows: statsRows },
      { title: 'Inventory calculations', subtitle: 'Formula reference used in the visible summary', rows: formulaRows },
      { title: 'Top stock-value products', subtitle: 'Visible product leaders by stock value', rows: topStockValueRows, limit: 10 },
      { title: 'Movement activity mix', subtitle: 'Visible grouped movements by type', rows: movementActivityRows.map((row) => ({ Activity: row.name, Groups: row.groups, Quantity: row.quantity, Total_Cost_USD: row.total_cost_usd })), limit: 10 },
      { title: 'Movement volume timeline', subtitle: 'Visible movement quantity over the current time window', rows: movementVolumeRows, limit: 12 },
      ...(branchComparisonRows.length > 1 ? [{ title: 'Branch comparison', subtitle: 'Visible branch stock totals', rows: branchComparisonRows, limit: 10 }] : []),
    ],
    notes: [
      'Package includes raw CSV data, calculations, active filter metadata, and this self-contained HTML report.',
      'Single CSV exports remain available from the Export menu when you only need one dataset.',
    ],
  })
  const files = buildReportPackageFiles({
    baseName: 'inventory',
    exportStamp: scope.exportStamp,
    manifestRows,
    csvFiles: mode === 'movements'
      ? [
          { name: `inventory-export-context-${scope.exportStamp}.csv`, content: buildCSV(contextRows) },
          { name: `inventory-movement-filters-${scope.exportStamp}.csv`, content: buildCSV(buildMovementFilterRows(scope)) },
          { name: `inventory-movement-groups-${scope.exportStamp}.csv`, content: buildCSV(movementRows) },
          { name: `inventory-stats-${scope.exportStamp}.csv`, content: buildCSV(statsRows) },
          { name: `inventory-calculations-${scope.exportStamp}.csv`, content: buildCSV(formulaRows) },
          { name: `inventory-products-reference-${scope.exportStamp}.csv`, content: buildCSV(productRows) },
        ]
      : [
          { name: `inventory-export-context-${scope.exportStamp}.csv`, content: buildCSV(contextRows) },
          { name: `inventory-stats-${scope.exportStamp}.csv`, content: buildCSV(statsRows) },
          { name: `inventory-calculations-${scope.exportStamp}.csv`, content: buildCSV(formulaRows) },
          { name: `inventory-products-${scope.exportStamp}.csv`, content: buildCSV(productRows) },
          { name: `inventory-movement-reference-${scope.exportStamp}.csv`, content: buildCSV(movementRows) },
        ],
    reportFileName: 'inventory-report.html',
    reportContent,
  })
  await downloadZipFilesAsync(`inventory-report-${mode}-${scope.exportStamp}.zip`, files)
}
