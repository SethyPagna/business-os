const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.resolve(__dirname, '../src')
const modules = new Map()
let user, dbReads = 0
const data = { revenue_usd: 20, line_sales_usd: 20, cost_usd: 7, profit_usd: 10, gross_profit_usd: 10,
  removal_loss_usd: 2, revenue_after_losses_usd: 18, profit_after_losses_usd: 8,
  delivery_actual_cost_usd: 3, delivery_margin_usd: 1, delivery_net_usd: 1 }
function load(file) {
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }; modules.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === '../lib/db') return { getDb: () => { dbReads++; return { prepare: () => ({ get: async () => ({}), all: async () => [] }) } } }
    if (name === '../lib/salesAnalytics') return { ...load(path.join(root, 'lib/salesAnalytics.ts')),
      getSalesTotals: async () => ({ ...data }), getBusinessSummaryPeriodRows: async () => [{ ...data }],
      getSalesTotalsAndPeriodSeries: async () => ({ totals: { ...data }, periodSeries: [] }),
      getProductSalesRanking: async () => [{ ...data }], getSalesGroupedTotals: async () => [{ ...data }],
      getBusinessSummarySalesRows: async () => [{ ...data, id: 1 }],
      getDeliveryContactTotals: async () => [{ actual_cost_usd: 3, margin_usd: 1, revenue_usd: 20 }] }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const reports = load(path.join(root, 'routes/reports.ts'))
const sales = load(path.join(root, 'routes/sales.ts'))
const { canViewAcquisitionCosts } = load(path.join(root, 'lib/acquisitionCostAccess.ts'))
const app = new Hono()
app.route('/reports', reports.default)
app.route('/sales', sales.default)
app.route('/compat', load(path.join(root, 'routes/compat.ts')).default)
const actor = (permissions = {}, role_permissions = {}, role_code = 'manager') => ({ id: 7, username: 'employee', role_code, permissions: JSON.stringify({ ...(permissions.sales ? { dashboard: true } : {}), ...permissions }), role_permissions: JSON.stringify(role_permissions) })
async function main() {
  for (const [who, expectedCost, admin] of [
    [actor({ sales: true }), false, false],
    [actor({ sales: true, product_cost_view: true }), true, false],
    [actor({ sales: true }, { product_cost_view: true }), true, false],
    [actor({ sales: true, product_cost_view: false }, { product_cost_view: true }), false, false],
    [actor({ sales: true, product_cost_edit: true }), false, false],
    [actor({ product_cost_view: false }, {}, 'admin'), true, true],
  ]) {
    user = who
    assert.equal(canViewAcquisitionCosts(user), expectedCost)
    for (const gate of [reports.gateTotals, sales.gateSalesReportMoney]) {
      const row = gate(data, admin, canViewAcquisitionCosts(user))
      assert.equal('cost_usd' in row, expectedCost)
      assert.equal('profit_usd' in row, expectedCost)
      assert.equal('revenue_after_losses_usd' in row, expectedCost)
      assert.equal('delivery_actual_cost_usd' in row, admin)
    }
    for (const url of ['/reports/overview', '/reports/periods?granularity=day', '/reports/grouped?by=branch', '/reports/grouped?by=product', '/reports/business-summary/sales', '/compat/analytics']) {
      const response = await app.request(url)
      assert.equal(response.status, 200, url)
      const body = await response.json()
      const row = body.sales?.totals || body.rows?.[0] || body.totals
      assert.ok(row, url)
      assert.equal('cost_usd' in row, expectedCost, url)
      if (url !== '/reports/grouped?by=product' && url !== '/reports/business-summary/sales') assert.equal('delivery_actual_cost_usd' in row, admin, url)
    }
    const courier = await (await app.request('/reports/grouped?by=courier')).json()
    assert.equal('actual_cost_usd' in courier.rows[0], admin)
  }
  // Cost-view never grants the underlying report/dashboard action.
  user = actor({ product_cost_view: true })
  for (const url of ['/reports/overview', '/reports/periods', '/reports/grouped?by=product', '/reports/business-summary/sales', '/compat/analytics', '/compat/dashboard/startup']) {
    dbReads = 0
    assert.equal((await app.request(url)).status, 403, url)
    assert.equal(dbReads, 0, url)
  }
  const compat = fs.readFileSync(path.join(root, 'routes/compat.ts'), 'utf8')
  assert.equal((compat.match(/dashboardAnalytics\(c.env, c.req.query\(\), isAdminControlUser\(c.get\('user'\)\), canViewAcquisitionCosts\(c.get\('user'\)\)\)/g) || []).length, 2)
  console.log('PASS explicit cost-view report grants, inherited grants, false overrides, edit-only denial, admins, delivery isolation, action authorization')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
