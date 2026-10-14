const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const file = path.join(root, 'src', 'routes', 'reports.ts')
const originalLoad = Module._load
const harmless = new Proxy(() => undefined, { get: () => harmless, apply: () => undefined })

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}
Module._load = function(request, parent, isMain) {
  if (request === '../lib/saleTotals') return { round2: (value) => Math.round(Number(value) * 100) / 100 }
  if (request === '../lib/auth') return { requireAuth: async (c, next) => {
    const role = c.req.header('x-admin') === '1' ? 'admin' : 'employee'
    c.set('user', { id: role === 'admin' ? 1 : 2, role, role_code: role,
      permissions: JSON.stringify({ product_cost_view: c.req.header('x-cost-view') === '1', ...(c.req.header('x-courier') === '1' ? { sales: true } : {}) }) })
    return next()
  } }
  if (request === '../lib/permissions') return {
    getActionTier: (_user, area) => area === 'sales' ? 'full' : 'none',
    isAdminControlUser: (user) => user.role === 'admin',
  }
  if (request === '../lib/db') return { getDb: () => ({}) }
  if (request === '../lib/acquisitionCostAccess' || request === '../lib/courierCostAccess' || request === '../lib/reportExport' || request === '../lib/reportProfitView') return originalLoad.call(this, request, parent, isMain)
  if (request === '../lib/salesAnalytics') return new Proxy({
    SALES_GROUP_KEYS: ['branch'], BUCKET_MONEY_PLACES: 4, reportMoneyDiagnostic: () => null,
    getSalesTotals: async () => ({ ...totals }), previousPeriodFilters: () => ({}),
    getSalesGroupedReport: async () => ({ rows: [{ key: 'main', label: 'Main', ...totals }], total_groups: 1, totals: { ...totals } }),
    getSalesOverviewBlocks: async () => ({ totals: { ...totals }, couriers: [{ ...courier }],
      paymentMethods: { rows: [{ key: 'cash', label: 'Cash', ...totals }], total_groups: 1, totals: { ...totals } } }),
    getProductSalesReport: async () => ({ rows: [{ product_id: 1, product_name: 'P', line_sales_usd: 20, ...productSensitive }], total_groups: 1,
      totals: { line_sales_usd: 20, ...productSensitive } }),
    getDeliveryContactTotals: async () => [{ ...courier }],
    getBusinessSummaryPeriodRows: async () => [{ period: '2026-09-13', ...totals }],
    getBusinessSummarySalesRows: async () => [{ id: 1, cursor_at: '2026-09-13 00:00:00', receipt_number: 'R1', revenue_usd: 20, net_revenue_usd: 21, delivery_usd: 2, ...saleSensitive }],
    readSalesReportSnapshot: async () => ({ sales: [{ id: 1 }], items: [], returns: [], returnItems: [] }),
    businessSummarySalesRowsFromSnapshot: () => [{ id: 1, cursor_at: '2026-09-13 00:00:00', receipt_number: 'R1', revenue_usd: 20, net_revenue_usd: 21, delivery_usd: 2, ...saleSensitive }],
    salesTotalsFromSnapshot: () => ({ ...totals }),
    whereActiveSales: () => ({ sql: '1=1', params: {} }),
  }, { get: (target, key) => key in target ? target[key] : harmless })
  if (request === '../lib/reportMoneyPrecision') return { ReportMoneyPrecisionError: class extends RangeError {}, reportMoneyHttpError: () => ({ status: 422, message: 'bad' }) }
  if (request.startsWith('../lib/') || request === '../index') return new Proxy({}, { get: () => harmless })
  return originalLoad.call(this, request, parent, isMain)
}

const reports = require(file)
Module._load = originalLoad

const sensitiveTotals = [
  'cost_usd','profit_usd','cost_missing_snapshot_lines','pending_cost_usd','pending_profit_usd',
  'unvalued_cost_usd','returned_cost_usd','returned_cost_shortfall_usd','delivery_actual_cost_usd',
  'delivery_actual_cost_count','delivery_margin_usd','delivery_net_usd','recognized_delivery_cost_usd',
  'pending_delivery_cost_usd','margin_pct',
  // P3-L5 (owner, Sep 14 2026): stock removed entirely, priced at COST. All
  // five leave by the cost/profit door -- including revenue_after_losses_usd,
  // because revenue_usd itself stays visible and the pair would hand a
  // non-admin the loss (and therefore the cost) by subtraction.
  'removal_loss_usd','removal_loss_qty','removal_loss_unvalued_rows',
  'revenue_after_losses_usd','profit_after_losses_usd',
  'money_precision_mode','money_complete','money_unknown_cost_lines','money_contributing_rows',
]
const totals = { revenue_usd: 20, recognized_delivery_usd: 3, pending_delivery_usd: 2 }
for (const [index, key] of sensitiveTotals.entries()) totals[key] = index + 0.125
Object.assign(totals, { money_precision_mode: 'canonical_v1', money_complete: false,
  money_unknown_cost_lines: 2, money_contributing_rows: 9 })
const productSensitive = { cost_usd: 7, profit_usd: 13, cost_missing_snapshot_lines: 2, margin_pct: 65,
  money_precision_mode: 'canonical_v1', money_complete: false, money_unknown_cost_lines: 2, money_contributing_rows: 9 }
const saleSensitive = { cost_usd: 7, cost_before_floor_usd: 7, cost_missing_snapshot_lines: 2, gross_profit_usd: 13,
  money_precision_mode: 'canonical_v1', money_complete: false, money_unknown_cost_lines: 2, money_contributing_rows: 9 }

for (const input of [totals, JSON.parse(JSON.stringify(totals))]) {
  const employee = reports.gateTotals(input, false)
  assert.equal(employee.revenue_usd, 20)
  assert.equal(employee.recognized_delivery_usd, 3, 'customer-charged delivery remains ordinary report money')
  assert.equal(employee.pending_delivery_usd, 2)
  for (const key of sensitiveTotals) assert.equal(Object.hasOwn(employee, key), false, `${key} must be absent, not zero`)
}
const admin = reports.gateTotals(totals, true)
for (const key of sensitiveTotals.filter((key) => key !== 'margin_pct')) {
  assert.equal(Object.hasOwn(admin, key), true, `admin retains ${key}`)
}
assert.equal(Object.hasOwn(admin, 'margin_pct'), true)

// The kernel OMITS the removal-loss block when the window cannot be matched to
// stock movements (a payment-method/status filter, a grouped row). The gate
// must carry that absence through instead of printing "$0.00 of losses" for a
// question nobody asked -- the same absence-is-the-contract rule above.
{
  const noLosses = { revenue_usd: 20, cost_usd: 5, profit_usd: 15 }
  const adminNoLosses = reports.gateTotals(noLosses, true)
  for (const key of ['removal_loss_usd', 'removal_loss_qty', 'removal_loss_unvalued_rows',
    'revenue_after_losses_usd', 'profit_after_losses_usd']) {
    assert.equal(Object.hasOwn(adminNoLosses, key), false, `${key} stays absent when the kernel sent none`)
  }
  // ...and a real ZERO loss is still reported, so "no removals happened" and
  // "not applicable" stay distinguishable on the wire.
  const adminZero = reports.gateTotals({
    ...noLosses, removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0,
    revenue_after_losses_usd: 20, profit_after_losses_usd: 15,
  }, true)
  assert.equal(adminZero.removal_loss_usd, 0)
  assert.equal(adminZero.profit_after_losses_usd, 15)
}

// routes/reports.ts is not the only door these figures leave by. routes/sales.ts
// keeps its OWN non-admin gate, gateSalesReportMoney, and /api/sales/day-report
// reaches it with the removal block populated (getSalesDayReport carries it).
// A key added to one gate and not the other is a live leak, not a theoretical
// one -- this is exactly how it shipped broken once. Pin both.
{
  const salesSource = fs.readFileSync(path.join(root, 'src', 'routes', 'sales.ts'), 'utf8')
  const start = salesSource.indexOf('export function gateSalesReportMoney')
  assert.ok(start > 0, 'gateSalesReportMoney still exists in routes/sales.ts')
  const body = salesSource.slice(start, salesSource.indexOf('...publicRow}=row', start))
  for (const key of ['removal_loss_usd', 'removal_loss_qty', 'removal_loss_unvalued_rows',
    'revenue_after_losses_usd', 'profit_after_losses_usd']) {
    assert.ok(new RegExp(`\\b${key}\\b`).test(body), `routes/sales.ts gateSalesReportMoney must also strip ${key} for non-admins`)
  }
  // The control: a public key the gate deliberately does NOT strip fails the
  // same check, so a pattern that matched anything would be caught here.
  assert.equal(/\btx_count\b/.test(body), false,
    'the transaction count stays public -- the checks above discriminate')
}

// routes/compat.ts's /api/compat/analytics and /api/compat/dashboard/startup
// are a THIRD door for the same cost_usd/profit_usd/removal-loss block
// (getSalesTotals is their source too). F1 (Sep 15 2026): this endpoint used
// to run its OWN five-key-only strip (gateRemovalLosses) that never touched
// cost_usd / profit_usd, so any role holding only the 'dashboard' permission
// -- not 'reports' or 'sales' -- still received COGS and profit on the
// Dashboard. Pin that it reuses THIS gate instead of a second bespoke one, so
// the two surfaces cannot drift apart again.
{
  const compatSource = fs.readFileSync(path.join(root, 'src', 'routes', 'compat.ts'), 'utf8')
  assert.match(compatSource, /import \{ gateTotals \} from '\.\/reports'/,
    'routes/compat.ts must reuse reports.ts gateTotals, not a second bespoke gate')
  assert.match(compatSource, /totals: gateTotals\(/, 'dashboardAnalytics totals must be gated through gateTotals')
  assert.match(compatSource, /prevTotals: gateTotals\(/, 'dashboardAnalytics prevTotals must be gated through gateTotals')
  assert.equal(/function gateRemovalLosses/.test(compatSource), false,
    'the old five-key-only gate must be retired, not left beside gateTotals as a second door')
}

for (const input of [productSensitive, JSON.parse(JSON.stringify(productSensitive))]) {
  const employee = reports.gateProductRow({ line_sales_usd: 20, ...input }, false)
  for (const key of Object.keys(productSensitive)) assert.equal(Object.hasOwn(employee, key), false, `product ${key} hidden`)
}
for (const input of [saleSensitive, JSON.parse(JSON.stringify(saleSensitive))]) {
  const employee = reports.gateBusinessSummarySaleRow({ revenue_usd: 20, ...input }, false)
  for (const key of Object.keys(saleSensitive)) assert.equal(Object.hasOwn(employee, key), false, `sale ${key} hidden`)
  const adminSale = reports.gateBusinessSummarySaleRow({ revenue_usd: 20, ...input }, true)
  for (const key of Object.keys(saleSensitive)) assert.equal(Object.hasOwn(adminSale, key), true, `admin sale retains ${key}`)
}

const courier = {
  delivery_contact_name: 'Courier', deliveries: 4, charged_fee_usd: 5, absorbed_fee_usd: 1,
  actual_cost_usd: 3, actual_cost_count: 4, linked_expense_count: 2, linked_expense_usd: 2,
  linked_expense_khr: 8000, last_expense_at: '2026-09-13', margin_usd: 2,
}
for (const input of [courier, JSON.parse(JSON.stringify(courier))]) {
  const employee = reports.gateCourierRow(input, false)
  for (const key of ['actual_cost_usd','actual_cost_count','linked_expense_count','linked_expense_usd','linked_expense_khr','last_expense_at','margin_usd']) {
    assert.equal(Object.hasOwn(employee, key), false, `courier ${key} must be absent for employee`)
  }
  assert.equal(employee.charged_fee_usd, 5)
}
assert.deepEqual(reports.gateCourierRow(courier, true), courier)

// The courier's actual cost is its own permission (sales:view_courier_cost), independent of the product-cost grant:
// the six courier keys follow canViewCourier, every cost/profit key follows canViewCosts, and an administrator holds both.
{
  const courierKeys = ['delivery_actual_cost_usd', 'delivery_actual_cost_count', 'delivery_margin_usd', 'delivery_net_usd',
    'recognized_delivery_cost_usd', 'pending_delivery_cost_usd']
  const costKeys = sensitiveTotals.filter((key) => !courierKeys.includes(key))
  const courierOnly = reports.gateTotals(totals, false, false, 2, true)
  for (const key of courierKeys) assert.equal(Object.hasOwn(courierOnly, key), true, `courier permission alone retains ${key}`)
  for (const key of costKeys) assert.equal(Object.hasOwn(courierOnly, key), false, `courier permission alone never opens ${key}`)
  assert.equal(courierOnly.revenue_usd, 20)
  assert.equal(courierOnly.delivery_actual_cost_usd, Math.round(totals.delivery_actual_cost_usd * 100) / 100, 'the figure is the kernel figure at cents, not a restated one')
  const costOnly = reports.gateTotals(totals, false, true, 2, false)
  for (const key of courierKeys) assert.equal(Object.hasOwn(costOnly, key), false, `cost grant alone never opens ${key}`)
  assert.equal(costOnly.profit_excludes_delivery, true, 'a cost grant without the courier permission still gets goods profit')
  const both = reports.gateTotals(totals, false, true, 2, true)
  for (const key of sensitiveTotals) assert.equal(Object.hasOwn(both, key), true, `cost grant plus courier permission retains ${key}`)
  assert.equal(Object.hasOwn(both, 'profit_excludes_delivery'), false, 'both grants read the full profit')
  assert.deepEqual(both, reports.gateTotals(totals, true), 'both grants read what an administrator reads')
  assert.deepEqual(reports.gateTotals(totals, false, false, 2, false), reports.gateTotals(totals, false), 'neither grant: the public row')

  const receipt = { revenue_usd: 20, ...saleSensitive }
  assert.equal(reports.gateBusinessSummarySaleRow(receipt, false, true, true).gross_profit_usd, 13, 'both grants read the receipt profit with the courier cost in it')
  assert.equal(reports.gateBusinessSummarySaleRow({ ...receipt, net_revenue_usd: 21 }, false, true, false).gross_profit_usd, 14, 'a cost grant alone reads goods profit')
  assert.equal(Object.hasOwn(reports.gateBusinessSummarySaleRow(receipt, false, false, true), 'gross_profit_usd'), false, 'the courier permission alone opens no receipt profit')
  assert.deepEqual(reports.gateCourierRow(courier, true), courier, 'a non-administrator with the permission reads the courier report row')
}

async function request(pathname, admin, costView = false, courierView = false) {
  const response = await reports.default.request(`http://local${pathname}`, { headers: { 'x-admin': admin ? '1' : '0', 'x-cost-view': costView ? '1' : '0', 'x-courier': courierView ? '1' : '0' } }, {})
  assert.equal(response.status, 200, pathname)
  return response.json()
}
function assertNoSensitive(value, label) {
  const text = JSON.stringify(value)
  for (const key of [...sensitiveTotals, ...Object.keys(productSensitive), ...Object.keys(saleSensitive),
    'actual_cost_usd','linked_expense_usd','linked_expense_khr','margin_usd']) {
    assert.equal(text.includes(`"${key}"`), false, `${label} leaks ${key}`)
  }
}

;(async () => {
  for (const [pathname, pick] of [
    ['/overview', (body) => body.sales], ['/periods?granularity=day', (body) => body.rows],
    ['/grouped?by=branch', (body) => body.rows], ['/grouped?by=product', (body) => body.rows],
    ['/grouped?by=courier', (body) => body.rows], ['/business-summary/sales?pageSize=10', (body) => body.rows],
    ['/business-summary/sales?intent=export&pageSize=10', (body) => body.rows],
  ]) {
    assertNoSensitive(pick(await request(pathname, false)), pathname)
    const adminBody = pick(await request(pathname, true))
    assert.match(JSON.stringify(adminBody), /"cost_usd"|"actual_cost_usd"/, `${pathname} admin retains sensitive detail`)
  }
  for (const pathname of ['/business-summary/sales?pageSize=10', '/business-summary/sales?intent=export&pageSize=10']) {
    const denied = await request(pathname, false)
    const granted = await request(pathname, false, true)
    assert.equal(granted.is_admin, false, 'cost-view permission does not grant administrator control')
    assert.equal(granted.rows.length, 1)
    for (const key of Object.keys(saleSensitive)) {
      assert.equal(Object.hasOwn(denied.rows[0], key), false, `${pathname}: ungranted ${key} is absent`)
      // AL finding L4 (13 Oct 2026): a receipt's gross profit carries its
      // courier cost (fee - courier), so the cost viewer gets the goods profit
      // -- net revenue 21 less cost 7 = 14, not the 13 that included delivery.
      if (key === 'gross_profit_usd') continue
      assert.equal(granted.rows[0][key], saleSensitive[key], `${pathname}: explicit cost-view grant retains ${key}`)
    }
    assert.equal(granted.rows[0].gross_profit_usd, 14, `${pathname}: the cost viewer's receipt profit is goods only`)
    assert.equal(granted.rows[0].profit_excludes_delivery, true, `${pathname}: and says so`)
    assert.equal(Object.hasOwn(denied.rows[0], 'profit_excludes_delivery'), false, `${pathname}: no profit, no flag`)
    assert.equal((await request(pathname, true)).rows[0].gross_profit_usd, 13, `${pathname}: the administrator keeps the full receipt profit`)
    assert.equal(granted.rows[0].revenue_usd, denied.rows[0].revenue_usd, 'public revenue is unchanged by the grant')
    if (pathname.includes('intent=export')) {
      assertNoSensitive(denied.totals, 'export totals without cost authority')
      // Owner, 13 Oct 2026: the export's totals row is the exact sum of its
      // 4-place receipt rows, so it carries 4 places too (0.125, not 0.13).
      assert.equal(granted.totals.cost_usd, 0.125, 'authorized export totals carry the 4-place sum of the rows')
      assert.match(granted.export_token, /^[a-f0-9]{64}$/)
      assert.notEqual(granted.export_token, denied.export_token, 'actual export tokens bind the visible cost authority')
    }
  }
  // AL finding L4: the cost viewer's window totals carry no courier cost and a
  // goods profit (revenue 20 - cost 0.13 at cents), flagged, so the courier
  // cost cannot be read back as fee - (profit - revenue + cost).
  for (const [pathname, pick] of [['/overview', (body) => body.sales.totals], ['/periods?granularity=day', (body) => body.rows[0]],
    ['/grouped?by=branch', (body) => body.rows[0]]]) {
    const seen = pick(await request(pathname, false, true))
    for (const key of ['delivery_actual_cost_usd', 'delivery_margin_usd', 'delivery_net_usd', 'recognized_delivery_cost_usd', 'pending_delivery_cost_usd']) {
      assert.equal(Object.hasOwn(seen, key), false, `${pathname}: cost view never receives ${key}`)
    }
    assert.equal(seen.profit_excludes_delivery, true, `${pathname}: goods profit is flagged`)
    assert.equal(seen.profit_usd, Number((seen.revenue_usd - seen.cost_usd).toFixed(4)), `${pathname}: profit is revenue - cost`)
    const adminSeen = pick(await request(pathname, true))
    assert.equal(Object.hasOwn(adminSeen, 'profit_excludes_delivery'), false, `${pathname}: the administrator's profit is the full figure`)
  }
  // Mounted: the courier permission opens the courier keys on every report the L4 rule closed them on, and only those.
  const courierKeys = ['delivery_actual_cost_usd', 'delivery_margin_usd', 'delivery_net_usd', 'recognized_delivery_cost_usd', 'pending_delivery_cost_usd']
  for (const [pathname, pick] of [['/overview', (body) => body.sales.totals], ['/periods?granularity=day', (body) => body.rows[0]],
    ['/grouped?by=branch', (body) => body.rows[0]]]) {
    const courierOnly = pick(await request(pathname, false, false, true))
    for (const key of courierKeys) assert.equal(Object.hasOwn(courierOnly, key), true, `${pathname}: the courier permission reads ${key}`)
    for (const key of ['cost_usd', 'profit_usd', 'margin_pct', 'removal_loss_usd']) assert.equal(Object.hasOwn(courierOnly, key), false, `${pathname}: the courier permission never reads ${key}`)
    const both = pick(await request(pathname, false, true, true))
    for (const key of [...courierKeys, 'cost_usd', 'profit_usd']) assert.equal(Object.hasOwn(both, key), true, `${pathname}: cost grant plus courier permission reads ${key}`)
    assert.equal(Object.hasOwn(both, 'profit_excludes_delivery'), false, `${pathname}: the full profit is not flagged`)
  }
  for (const pathname of ['/overview', '/grouped?by=courier']) {
    const rows = (body) => body.sales ? body.sales.couriers : body.rows
    assert.equal(Object.hasOwn(rows(await request(pathname, false, false, true))[0], 'actual_cost_usd'), true, `${pathname}: the courier permission reads the courier row cost`)
    assert.equal(Object.hasOwn(rows(await request(pathname, false, true, false))[0], 'actual_cost_usd'), false, `${pathname}: a cost grant alone does not`)
  }
  console.log('PASS cost-view totals carry goods profit, flagged, and no courier cost (L4)')
  console.log('PASS mounted overview/day/group/export employee and admin payload parity')
  console.log('PASS report totals/day/group/export gates hide actual and derived delivery costs for employees and retain them for admins')
})().catch((error) => { console.error(error); process.exitCode = 1 })

const source = fs.readFileSync(file, 'utf8')
assert.match(source, /out\.sales = \{[\s\S]*totals: gateTotals\(totals[\s\S]*previous: previous \? gateTotals/)
assert.match(source, /periodRows\.map\(\(r\) => gateTotals/)
assert.match(source, /getSalesGroupedReport[\s\S]*\.map\(\(r\) => gateTotals/)
assert.match(source, /totals = gateTotals\(report\.totals/)
assert.match(source, /totals = gateProductRow\(report\.totals/)
assert.match(source, /getDeliveryContactTotals[\s\S]*\.map\(\(row\) => gateCourierRow/)
