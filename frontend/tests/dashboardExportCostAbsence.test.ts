// R2 area review, finding 5 (13 Oct 2026): the Worker OMITS cost_usd / profit_usd for a caller
// without the cost grant and never sends 0 for "hidden". The Dashboard's own cards already leave
// the profit card out (aHasProfit); its exports wrote `|| 0` / priceCsv(undefined) instead, so a
// reader without the grant downloaded a "COGS 0.00 / Profit 0.00" file that reads as a period that
// broke even. The REAL export module runs here with only the browser sinks (xlsx download, zip
// download, report HTML) replaced by recorders.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const entry = new URL('../src/components/dashboard/dashboardExport.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const stubs: Record<string, string> = {
  'xlsxExport': 'export const downloadXLSX = (name, rows) => { (globalThis.__cap.xlsx ??= {})[name] = rows }',
  'csv': 'export const buildCSV = (rows) => rows\nexport const downloadZipFilesAsync = async (name, files) => { globalThis.__cap.zip = { name, files } }',
  'exportReports': 'export const buildStandaloneReportHtml = (options) => { globalThis.__cap.report = options; return "" }',
  'exportPackage': 'export const buildReportManifestRows = (entries) => entries.map((entry) => ({ Section: "Manifest", Metric: entry.metric, Value: entry.value }))\nexport const buildReportPackageFiles = (options) => options.csvFiles',
}
const bundled = await build({
  entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'browser-sinks',
    setup(b) {
      b.onResolve({ filter: /utils\/(xlsxExport|csv|exportReports|exportPackage)(\.tsx?)?$/ }, (args) => ({ path: args.path.match(/(xlsxExport|csv|exportReports|exportPackage)/)![1], namespace: 'sink' }))
      b.onLoad({ filter: /.*/, namespace: 'sink' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
    },
  }],
})
type Cap = { xlsx?: Record<string, Array<Record<string, unknown>>>; zip?: { name: string; files: Array<{ name: string; content: Array<Record<string, unknown>> }> }; report?: { charts: Array<{ title: string }> } }
const cap = (): Cap => (globalThis as unknown as { __cap: Cap }).__cap
const mod = { exports: {} as Record<string, (ctx: unknown) => unknown> }
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(mod, mod.exports, require)
const api = mod.exports

const period = (extra: Record<string, number>) => [{ date: '2026-10-05', gross_sales_usd: 50, discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, revenue_usd: 42, count: 2, ...extra }]
const totalsFor = (extra: Record<string, number>) => ({ tx_count: 2, gross_sales_usd: 50, revenue_usd: 42, discount_usd: 0, store_discount_usd: 0, tax_usd: 0, delivery_usd: 0, avg_order_usd: 21, ...extra })
const context = (costKeys: Record<string, number>) => {
  const rows = period(costKeys)
  return {
    activeChart: 'revenue', exportStamp: 'T', periodShort: '1d', rangeLabel: '2026-10-05', lowStockCount: 0, outOfStockCount: 0,
    lowStock: {}, collectedExampleText: '', collectedFormulaText: '', revenueExampleText: '', revenueFormulaText: '',
    grossSalesLabel: 'Gross', netRevenueLabel: 'Net', refundsLabel: 'Refunds', profitLabel: 'Profit', periodKpis: [], topList: [], topMode: 'revenue',
    fmtUSD: (value: unknown) => `$${(Number(value) || 0).toFixed(2)}`, translateOr: (_key: string, fallback: string) => fallback,
    chartData: rows,
    analytics: { totals: totalsFor(costKeys), periodData: rows, periodReturns: {}, periodSupplierReturns: {}, byPayment: [], byBranch: [], topProducts: [], topProductsQty: [], topCustomers: [] },
    summary: { product_count: 1, in_stock_count: 1, stock_value_usd: 10, low_stock: [], out_of_stock: [], recent_sales: [] },
  }
}
const costReader = context({ cost_usd: 12, profit_usd: 28 })
const plainReader = context({})
const run = async (name: string, ctx: unknown): Promise<Cap> => {
  ;(globalThis as unknown as { __cap: Cap }).__cap = {}
  await (api[name](ctx) as unknown)
  return cap()
}
const mentionsCost = (value: unknown) => /COGS|Profit|cost_usd|profit_usd/i.test(JSON.stringify(value))

let passed = 0
async function test(name: string, check: () => void | Promise<void>) { await check(); passed += 1; console.log(`PASS ${name}`) }

await test('control: a cost reader exports COGS and profit in every file', async () => {
  const kpi = (await run('exportDashboardKpis', costReader)).xlsx!['dashboard-kpi-T.xlsx']
  assert.ok(kpi.some((row) => row.Metric === 'COGS (USD)') && kpi.some((row) => row.Metric === 'Est. Profit (USD)'))
  const stats = (await run('exportDashboardStats', costReader)).xlsx!['dashboard-stats-T.xlsx']
  assert.ok(stats.some((row) => row.Metric === 'Estimated profit'))
  const chart = (await run('exportDashboardSalesChart', costReader)).xlsx!['dashboard-sales-T.xlsx']
  assert.deepEqual([chart[0].COGS_USD, chart[0].Profit_USD], [12, 28])
  const pkg = await run('exportDashboardPackage', costReader)
  assert.ok(pkg.report!.charts.some((entry) => entry.title === 'Revenue vs COGS vs Profit'))
  assert.ok(pkg.zip!.files.find((file) => file.name === 'dashboard-sales-T.csv')!.content.every((row) => 'COGS_USD' in row && 'Profit_USD' in row))
})

await test('a reader without the cost grant gets no COGS or profit row, column or chart in any export', async () => {
  for (const name of ['exportDashboardKpis', 'exportDashboardStats', 'exportDashboardFull', 'exportDashboardSalesChart']) {
    const files = (await run(name, plainReader)).xlsx!
    assert.equal(Object.keys(files).length, 1, name)
    assert.equal(mentionsCost(Object.values(files)[0]), false, `${name} must not mention COGS or profit`)
  }
  const kpi = (await run('exportDashboardKpis', plainReader)).xlsx!['dashboard-kpi-T.xlsx']
  assert.ok(kpi.some((row) => row.Metric === 'Revenue (USD)'), 'the money a reader may see is still exported')
  const pkg = await run('exportDashboardPackage', plainReader)
  assert.equal(pkg.report!.charts.some((entry) => entry.title === 'Revenue vs COGS vs Profit'), false)
  for (const file of pkg.zip!.files) assert.equal(mentionsCost(file.content), false, `${file.name} must not mention COGS or profit`)
})

await test('presence decides, not value: a cost reader with a genuinely zero window still exports 0', async () => {
  const kpi = (await run('exportDashboardKpis', context({ cost_usd: 0, profit_usd: 0 }))).xlsx!['dashboard-kpi-T.xlsx']
  assert.equal(kpi.find((row) => row.Metric === 'COGS (USD)')?.Value, '0.00')
})

console.log(`${passed} dashboard export cost-absence tests passed`)
