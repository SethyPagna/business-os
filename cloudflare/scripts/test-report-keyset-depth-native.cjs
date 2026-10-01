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
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={fixture,app,executionCtx,setUser(value){currentUser=value},USER};', file)
const h = harness.exports

;(async () => {
  const f = h.fixture()
  h.setUser({ ...h.USER, permissions: '{"all":true}' })
  const sale = f.raw.prepare(`INSERT INTO sales(receipt_number,sale_status,total_usd,subtotal_usd,created_at,branch_id,payment_method,cashier_name)
    VALUES(@receipt,@status,10,10,@created,1,'Cash','Cashier')`)
  const item = f.raw.prepare('INSERT INTO sale_items(sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(@saleId,10,@name,1,10,4)')
  for (const [receipt, status, created, name] of [
    ['depth-active', 'completed', '2026-09-13 01:00:00', 'Depth search product'],
    ['depth-void', 'cancelled', '2026-09-13T01:00:00.000Z', 'Depth search product'],
    ['other-day', 'completed', '2026-09-14 01:00:00', 'Depth search product'],
    ['other-product', 'completed', '2026-09-13 01:00:00', 'Unrelated item'],
  ]) {
    const inserted = sale.run({ receipt, status, created })
    item.run({ saleId: Number(inserted.meta.last_row_id), name })
  }
  const urls = [
    '/stats?status=cancelled&search=depth',
    '/stats?search=depth&startDate=2026-09-13&endDate=2026-09-13',
    '/stats?search=depth&cashier=Cashier&paymentMethod=Cash&branchId=1&startDate=2026-09-13&endDate=2026-09-13&startTime=07:00&endTime=10:00',
    '/stats?search=no-such-product&cashier=nobody',
  ]
  const read = async url => {
    const response = await h.app.request(url, {}, { DB: f.route }, h.executionCtx)
    const body = await response.text()
    assert.equal(response.status, 200, `${url}: ${body}`)
    return JSON.parse(body)
  }
  f.raw.db.limits.exprDepth = 1000
  const reference = []
  for (const url of urls) reference.push(await read(url))
  assert.equal(reference[0].total_count, 1)
  assert.equal(reference[1].revenue_count, 1)
  assert.equal(reference[2].revenue_count, 1)
  assert.equal(reference[3].total_count, 0)
  f.raw.db.limits.exprDepth = 100
  for (let index = 0; index < urls.length; index++) assert.deepEqual(await read(urls[index]), reference[index])
  f.raw.db.close()
  console.log('PASS D1 depth100 report keyset reads preserve search/status/date/time/branch/money filters against depth1000 reference')
})().catch(error => { console.error(error); process.exitCode = 1 })
