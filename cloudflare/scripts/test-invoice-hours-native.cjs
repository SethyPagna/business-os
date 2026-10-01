const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports
const app = h.load('routes/contacts.ts').default
const f = h.fixture()
const admin = { ...h.USER, role_code: 'admin', permissions: '{"all":true}' }
const get = async (route, params = {}) => {
  const response = await app.request(`${route}?${new URLSearchParams(params)}`, {}, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
;(async () => {
  try {
    h.setUser(admin)
    const dates = ['2026-09-01', '2026-09-01T01:59:59Z', '2026-09-01 02:00:00', '2026-09-01T04:00:59.999Z', '2026-09-01 04:01:00', '2026-09-02']
    for (const [i, timestamp] of dates.entries()) {
      f.raw.prepare("INSERT INTO supplier_invoices(id,source_branch,legacy_id,supplier_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row,imported_at) VALUES(?,'shop',?,'Hour Supplier',?,?,10,3,7,'Not Yet Paid','hour-fixture',?,'2026-10-01 00:00:00')").run([i + 1, i + 1, `H-${i}`, timestamp, i + 1])
      f.raw.prepare("INSERT INTO customer_receivables(id,legacy_id,customer_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row,imported_at) VALUES(?,?,'Hour Customer',?,?,10,3,7,'Not Yet Paid','hour-fixture',?,'2026-10-01 00:00:00')").run([i + 1, i + 1, `H-${i}`, timestamp, i + 1])
    }
    const day = { from: '2026-09-01', to: '2026-09-01', page_size: '2' }
    const exact = { ...day, createdFrom: '2026-09-01 02:00:00', createdTo: '2026-09-01 04:01:00' }
    for (const route of ['/suppliers/reports/ap-invoices', '/customers/reports/ar-invoices']) {
      const full = await get(route)
      assert.equal(full.status, 200)
      assert.equal(full.body.total_invoices, 6, 'initial all-time must retain the complete imported ledger')
      const dateOnly = await get(route, { ...day, page_size: '100' })
      assert.equal(dateOnly.body.total_invoices, 5)
      const narrowed = await get(route, exact)
      assert.equal(narrowed.status, 200)
      assert.equal(narrowed.body.total_invoices, 3, 'exact invoice clocks plus date-only unknown-time rows must share one cohort')
      assert.deepEqual(narrowed.body.totals, { invoices: 3, total_usd: 30, paid_usd: 9, outstanding_usd: 21, outstanding_count: 3 })
      const next = await get(route, { ...exact, page: '2' })
      assert.deepEqual([...narrowed.body.invoices, ...next.body.invoices].map(r => r.id).sort(), [1, 3, 4])
      const fullTime = await get(route, { ...day, page_size: '100', createdFrom: '2026-08-31 17:00:00', createdTo: '2026-09-01 17:00:00' })
      assert.deepEqual(fullTime.body.invoices, dateOnly.body.invoices)
      assert.deepEqual(fullTime.body.totals, dateOnly.body.totals)
      const acrossDays = await get(route, { ...exact, to: '2026-09-02', page_size: '100', createdTo: '2026-09-02 02:01:00' })
      assert.deepEqual(acrossDays.body.invoices.map(row => row.id).sort(), [1,3,4,5,6], 'continuous span includes intervening hours plus unknown-clock dates')
      assert.deepEqual(acrossDays.body.totals, { invoices: 5, total_usd: 50, paid_usd: 15, outstanding_usd: 35, outstanding_count: 5 })
      const offsets = await get(route, { ...day, createdFrom: '2026-09-01T09:00:00+07:00', createdTo: '2026-09-01T11:01:00+07:00' })
      assert.deepEqual(offsets.body.totals, narrowed.body.totals)
      for (const invalid of [
        { createdFrom: exact.createdFrom }, { createdFrom: 'bad', createdTo: exact.createdTo },
        { createdFrom: exact.createdTo, createdTo: exact.createdFrom },
        { createdFrom: '2026-02-30 02:00:00', createdTo: exact.createdTo },
        { createdFrom: exact.createdFrom, createdTo: exact.createdTo },
        { ...exact, from: '2026-02-30' }, { ...exact, from: '2026-09-02' },
        { ...exact, startTime: '09:00', endTime: '11:00' },
      ]) assert.equal((await get(route, invalid)).status, 400, JSON.stringify(invalid))
    }
    assert.equal((await get('/suppliers/reports/ap-invoices', { ...exact, branch: 'warehouse' })).body.total_invoices, 0)
    assert.equal((await get('/suppliers/reports/ap-invoices', { ...exact, supplier: 'Other' })).body.total_invoices, 0)
    assert.equal((await get('/customers/reports/ar-invoices', { ...exact, customer: 'Other' })).body.total_invoices, 0)
    assert.equal((await get('/customers/reports/ar-invoices', { ...exact, status: 'settled' })).body.total_invoices, 0)
    h.setUser({ ...h.USER, permissions: '{}' })
    assert.equal((await get('/suppliers/reports/ap-invoices', exact)).status, 403)
    assert.equal((await get('/customers/reports/ar-invoices', exact)).status, 403)
    console.log('PASS AP/AR real depth100 routes: unknown-clock inclusion, exact invoice timestamps, all-time/date-only, totals/paging/filters/permissions and invalid bounds')
  } finally { f.raw.db.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
