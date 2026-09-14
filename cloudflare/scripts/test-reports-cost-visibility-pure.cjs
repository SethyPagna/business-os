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
    c.set('user', { id: 1, role: c.req.header('x-admin') === '1' ? 'admin' : 'employee', permissions: {} })
    return next()
  } }
  if (request === '../lib/permissions') return {
    getActionTier: (_user, area) => area === 'sales' ? 'full' : 'none',
    isAdminControlUser: (user) => user.role === 'admin',
  }
  if (request === '../lib/db') return { getDb: () => ({}) }
  if (request === '../lib/salesAnalytics') return new Proxy({
    SALES_GROUP_KEYS: ['branch'], reportMoneyDiagnostic: () => null,
    getSalesTotals: async () => ({ ...totals }), previousPeriodFilters: () => ({}),
    getSalesGroupedTotals: async () => [{ key: 'main', label: 'Main', ...totals }],
    getProductSalesRanking: async () => [{ product_id: 1, product_name: 'P', line_sales_usd: 20, ...productSensitive }],
    getDeliveryContactTotals: async () => [{ ...courier }],
    getBusinessSummaryPeriodRows: async () => [{ period: '2026-09-13', ...totals }],
    getBusinessSummarySalesRows: async () => [{ id: 1, cursor_at: '2026-09-13 00:00:00', receipt_number: 'R1', revenue_usd: 20, ...saleSensitive }],
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

async function request(pathname, admin) {
  const response = await reports.default.request(`http://local${pathname}`, { headers: { 'x-admin': admin ? '1' : '0' } }, {})
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
  ]) {
    assertNoSensitive(pick(await request(pathname, false)), pathname)
    const adminBody = pick(await request(pathname, true))
    assert.match(JSON.stringify(adminBody), /"cost_usd"|"actual_cost_usd"/, `${pathname} admin retains sensitive detail`)
  }
  console.log('PASS mounted overview/day/group/export employee and admin payload parity')
})().catch((error) => { console.error(error); process.exitCode = 1 })

const source = fs.readFileSync(file, 'utf8')
assert.match(source, /out\.sales = \{[\s\S]*totals: gateTotals\(totals[\s\S]*previous: previous \? gateTotals/)
assert.match(source, /periodRows\.map\(\(r\) => gateTotals/)
assert.match(source, /getSalesGroupedTotals[\s\S]*\.map\(\(r\) => gateTotals/)
assert.match(source, /getDeliveryContactTotals[\s\S]*\.map\(\(row\) => gateCourierRow/)
assert.match(source, /const adminColumns = isAdmin \? `, \$\{costCol\} AS cost_usd/,
  'business-summary sales rows select cost and derived profit only for admins')

console.log('PASS report totals/day/group/export gates hide actual and derived delivery costs for employees and retain them for admins')
