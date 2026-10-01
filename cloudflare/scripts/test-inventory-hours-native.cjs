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
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,app,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports
h.setUser({ ...h.USER, permissions: '{"all":true}' })
const sales = h.app
const returns = h.load('routes/returns.ts').default
const transfers = h.load('routes/compat.ts').default
const f = h.fixture()
const get = async (app, url) => {
  const response = await app.request(url, {}, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}

async function main() {
  try {
    for (const [index, timestamp] of ['2026-09-04T16:59:59.000Z', '2026-09-04 17:00:00', '2026-09-05T03:00:00.000Z', '2026-09-05 16:59:59', '2026-09-05T17:00:00Z'].entries()) {
      f.raw.prepare("INSERT INTO sales(receipt_number,sale_status,subtotal_usd,total_usd,created_at,branch_id) VALUES(?,'completed',10,10,?,1)").run([`hour-sale-${index}`, timestamp])
      f.raw.prepare("INSERT INTO returns(return_number,total_refund_usd,created_at,branch_id,return_scope) VALUES(?,1,?,1,'customer')").run([`hour-return-${index}`, timestamp])
    }
    const dates = 'startDate=2026-09-05&endDate=2026-09-05'
    const narrow = `${dates}&createdFrom=2026-09-05%2002:00:00&createdTo=2026-09-05T04:00:00Z`
    const selected = await get(sales, `/stats-strip?${narrow}`)
    assert.equal(selected.status, 200, JSON.stringify(selected.body))
    assert.equal(selected.body.totals.tx_count, 1, 'continuous hours must filter recognized sales, not just activity cards')
    assert.deepEqual(selected.body.returns, { count: 1, refund_usd: 1 })
    assert.equal(selected.body.by_status.reduce((sum, row) => sum + row.count, 0), 1)
    const returnReport = await get(returns, `/report?${narrow}&scope=customer`)
    assert.equal(returnReport.status, 200, JSON.stringify(returnReport.body))
    assert.equal(returnReport.body.totals.count, 1)
    const exactPrimary = await get(sales, '/stats-strip?startDate=2026-09-06&endDate=2026-09-06&createdFrom=2026-09-05%2002:00:00&createdTo=2026-09-05%2004:00:00')
    assert.equal(exactPrimary.status, 200)
    assert.deepEqual(exactPrimary.body.totals, selected.body.totals, 'continuous endpoints are authoritative across every money/activity cohort, matching Returns')
    const full = await get(sales, `/stats-strip?${dates}`)
    const fullTimed = await get(sales, `/stats-strip?${dates}&createdFrom=2026-09-04T17:00:00Z&createdTo=2026-09-05%2017:00:00`)
    assert.equal(full.status, 200)
    assert.equal(fullTimed.status, 200)
    assert.deepEqual(fullTimed.body.totals, full.body.totals, 'Cambodia 00:00 through23:59 agrees with existing date-only full day')
    assert.deepEqual(fullTimed.body.returns, { count: 3, refund_usd: 3 })
    const recurring = await get(sales, `/stats-strip?${dates}&startTime=09:00&endTime=11:00`)
    assert.equal(recurring.status, 200)
    assert.equal(recurring.body.totals.tx_count, 1, 'existing Sales recurring hours retain semantics')
    for (const invalid of [
      'createdFrom=2026-09-05%2004:00:00',
      'createdFrom=2026-09-05%2004:00:00&createdTo=2026-09-05%2003:00:00',
      'createdFrom=2026-02-30%2004:00:00&createdTo=2026-03-01%2004:00:00',
      'createdFrom=2026-09-05%2002:00:00&createdTo=2026-09-05%2004:00:00&startTime=09:00&endTime=11:00',
    ]) assert.equal((await get(sales, `/stats-strip?${dates}&${invalid}`)).status, 400, invalid)
    f.raw.prepare("INSERT INTO branches(id,name,is_active) VALUES(2,'Warehouse',1)").run()
    for (const [index, timestamp] of ['2026-09-04 17:00:00', '2026-09-05T03:00:00Z', '2026-09-05 16:59:59'].entries()) {
      f.raw.prepare('INSERT INTO stock_transfers(product_id,quantity,from_branch_id,to_branch_id,created_at) VALUES(10,?,1,2,?)').run([index + 1, timestamp])
    }
    const transferWindow = await get(transfers, `/transfers?${dates}&startTime=09:00&endTime=11:00&page=1&pageSize=20`)
    assert.equal(transferWindow.status, 200, JSON.stringify(transferWindow.body))
    assert.equal(transferWindow.body.total, 1)
    const overnight = await get(transfers, `/transfers?${dates}&startTime=22:00&endTime=02:00&page=1&pageSize=20`)
    assert.equal(overnight.status, 200)
    assert.equal(overnight.body.total, 2, 'Branch transfers keep recurring overnight hours')
    h.setUser({ ...h.USER, permissions: '{}' })
    assert.equal((await get(sales, `/stats-strip?${narrow}`)).status, 403)
    assert.equal((await get(transfers, `/transfers?${dates}&startTime=09:00&endTime=11:00`)).status, 403)
    console.log('PASS Inventory continuous mixed sale/return cohorts, Cambodia00/23 boundaries, invalid ranges, date-only and recurring Sales/Branch parity')
  } finally { f.raw.db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
