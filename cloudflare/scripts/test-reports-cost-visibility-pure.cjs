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
  if (request === '../lib/salesAnalytics') return new Proxy({ SALES_GROUP_KEYS: [], reportMoneyDiagnostic: () => null }, { get: (target, key) => key in target ? target[key] : harmless })
  if (request === '../lib/reportMoneyPrecision') return { ReportMoneyPrecisionError: class extends RangeError {}, reportMoneyHttpError: harmless }
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
  'money_precision_mode','money_complete','money_unknown_cost_lines','money_contributing_rows',
]
const totals = { revenue_usd: 20, recognized_delivery_usd: 3, pending_delivery_usd: 2 }
for (const [index, key] of sensitiveTotals.entries()) totals[key] = index + 0.125
Object.assign(totals, { money_precision_mode: 'canonical_v1', money_complete: false,
  money_unknown_cost_lines: 2, money_contributing_rows: 9 })

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

const source = fs.readFileSync(file, 'utf8')
assert.match(source, /out\.sales = \{[\s\S]*totals: gateTotals\(totals[\s\S]*previous: previous \? gateTotals/)
assert.match(source, /periodRows\.map\(\(r\) => gateTotals/)
assert.match(source, /getSalesGroupedTotals[\s\S]*\.map\(\(r\) => gateTotals/)
assert.match(source, /getDeliveryContactTotals[\s\S]*\.map\(\(row\) => gateCourierRow/)
assert.match(source, /const adminColumns = isAdmin \? `, \$\{costCol\} AS cost_usd/,
  'business-summary sales rows select cost and derived profit only for admins')

console.log('PASS report totals/day/group/export gates hide actual and derived delivery costs for employees and retain them for admins')
