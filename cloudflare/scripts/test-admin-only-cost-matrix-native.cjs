'use strict'
// Owner ruling, 15 Nov 2026: cost, profit, margin, stock value, removal loss and supplier loss/compensation are ADMIN ONLY, and the
// "View product costs" / "Edit product costs" grants no longer give a non-admin any of it. This runs the WHOLE Worker (workerd + D1)
// and asks each role for every cost-bearing read the Dashboard, the reports and Products offer:
//   admin                                    control: receives the cost keys (so the scan can see them)
//   manager (seed)                           none
//   employee (seed)                          none, and may open the Dashboard (owner, 15 Nov 2026)
//   employee + product_cost_view true        none: the grant is inert
//   manager + product_cost_edit true         none: the grant is inert
// A non-admin gets NO cost key at all: omitted, never zeroed. The role JSON is the real seed (lib/roleDefaults.ts).
// Run (from cloudflare/scripts): node test-admin-only-cost-matrix-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const H = require('./harness/al_money_native.cjs')

const seedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'roleDefaults.ts'), 'utf8')
const mod = { exports: {} }
new Function('module', 'exports', ts.transpileModule(seedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports)
const SEED = mod.exports.DEFAULT_ROLE_PERMISSIONS

// A key that names acquisition cost, profit, margin, stock value, removal loss or supplier loss/compensation (the courier cost too).
const COST_KEY = /(^|_)(cost|costs|cogs|profit|margin|purchase_price|stock_value|removal_loss|positive_value|total_value|compensation)(_|$)|^(supplier_)?loss_(usd|khr)$|revenue_after_losses|credit_open/i
const DATE = '2026-11-10'
const range = `startDate=${DATE}&endDate=${DATE}`
function costKeys(value, trail = '$', found = []) {
  if (Array.isArray(value)) value.forEach((item) => costKeys(item, `${trail}[]`, found))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (COST_KEY.test(key)) found.push(`${trail}.${key}`)
      costKeys(child, `${trail}.${key}`, found)
    }
  }
  return found
}

async function main() {
  const h = await H.startWorker()
  const failures = []
  const check = async (name, fn) => {
    try { await fn(); console.log('PASS ' + name) } catch (error) {
      failures.push(name)
      console.log('FAIL ' + name + '\n  ' + String((error && error.message) || error).split('\n').slice(0, 6).join('\n  '))
    }
  }
  try {
    await H.seedProduct(h, 801, 'Matrix Cream', 10, 100, 4)
    await h.db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(1,'Matrix Driver','012000801')").run()
    const sale = await H.createSale(h, { key: 'matrix-1', status: 'completed',
      lines: [{ productId: 801, quantity: 2, quote: { gross_usd: 20, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 20, total_khr: 80000 } }],
      paymentDetails: [{ method: 'Cash', amount_usd: 22, amount_khr: 0 }], label: 'matrix sale',
      extra: { is_delivery: true, delivery_contact_id: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 1.5 } })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    await h.db.prepare('UPDATE sales SET created_at=? WHERE id=?').bind(`${DATE} 03:00:00`, sale.body.id).run()
    // A supplier return in the window, with a loss and a compensation: periodSupplierReturns carries both.
    const returnColumns = (await h.all("SELECT name FROM pragma_table_info('returns')")).map((row) => row.name)
    const values = { id: 880001, return_number: 'RET-MATRIX-1', return_scope: 'supplier', status: 'completed', created_at: `${DATE} 04:00:00`, return_date: `${DATE} 04:00:00`,
      supplier_compensation_usd: 3, supplier_loss_usd: 5, total_refund_usd: 0, total_refund_khr: 0, branch_id: 1 }
    const columns = Object.keys(values).filter((key) => returnColumns.includes(key))
    await h.db.prepare(`INSERT INTO returns(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).bind(...columns.map((key) => values[key])).run()

    const cookies = {
      manager: await h.addEmployee(910, 'matrix_manager', SEED.manager),
      employee: await h.addEmployee(911, 'matrix_employee', SEED.employee),
      employeeViewGrant: await h.addEmployee(912, 'matrix_employee_view', { ...SEED.employee, product_cost_view: true }),
      // This arm does not discriminate on the READ matrix: under the old rule Edit product costs alone never opened a cost read either
      // (reads needed View product costs), so it is green against both rules. Cost ENTRY by a grant holder is refused in the cost-write
      // cases (test-role-matrix-server-refusals-native, the stock-session, returns and products cost-entry tests).
      managerEditGrant: await h.addEmployee(913, 'matrix_manager_edit', { ...SEED.manager, product_cost_edit: true }),
    }
    const ROUTES = [
      ['dashboard summary', `/api/dashboard?${range}`],
      ['dashboard analytics', `/api/analytics?${range}`],
      ['dashboard startup', `/api/dashboard/startup?${range}`],
      ['reports overview', `/api/reports/overview?${range}`],
      ['reports periods', `/api/reports/periods?granularity=day&${range}`],
      ['products list', '/api/products'],
    ]
    const read = async (cookie, url, label) => h.call('GET', H.fresh(url), undefined, label, cookie ? { cookie } : {})

    for (const [name, url] of ROUTES) {
      await check(`admin control: ${name} carries cost keys`, async () => {
        const res = await read(null, url, `admin ${name}`)
        assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200))
        assert.ok(costKeys(res.body).length > 0, 'the scan must see a cost key in the admin response, or it proves nothing')
      })
    }
    await check('admin control: the supplier loss and compensation are present on the analytics payload', async () => {
      const body = (await read(null, `/api/analytics?${range}`, 'admin analytics')).body
      assert.equal(body.periodSupplierReturns.loss_usd, 5)
      assert.equal(body.periodSupplierReturns.supplier_compensation_usd, 3)
      assert.equal(typeof body.totals.profit_usd, 'number')
      assert.equal((await read(null, `/api/dashboard?${range}`, 'admin summary')).body.stock_value_usd > 0, true)
    })
    for (const [who, cookie] of Object.entries(cookies)) {
      for (const [name, url] of ROUTES) {
        await check(`${who}: ${name} has no cost key at all`, async () => {
          const res = await read(cookie, url, `${who} ${name}`)
          if (name === 'products list' || url.startsWith('/api/reports')) assert.ok(res.status === 200 || res.status === 403, `status ${res.status}`)
          else assert.equal(res.status, 200, `${who} must be able to open the Dashboard: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`)
          assert.deepEqual(costKeys(res.body), [], 'omitted, never zeroed')
        })
      }
    }
    await check('employee (seed) may open the Dashboard but the supplier return keeps only its count', async () => {
      const body = (await read(cookies.employee, `/api/analytics?${range}`, 'employee analytics')).body
      assert.equal(body.periodSupplierReturns.return_count, 1)
      assert.ok(!('loss_usd' in body.periodSupplierReturns) && !('supplier_compensation_usd' in body.periodSupplierReturns))
      assert.ok(!('profit_usd' in body.totals) && !('cost_usd' in body.totals) && !('delivery_actual_cost_usd' in body.totals))
    })
  } finally { await h.mf.dispose() }
  console.log(failures.length ? `RED ${failures.length} failed` : 'GREEN admin-only cost matrix')
  if (failures.length) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exit(1) })
