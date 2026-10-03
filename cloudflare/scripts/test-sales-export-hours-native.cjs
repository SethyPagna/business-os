const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const original = path.join(__dirname, 'test-sales-export-preview-revenue-pure.cjs')
const source = fs.readFileSync(original, 'utf8')
const fixtureStart = source.indexOf('addSale({ id: 101')
if (fixtureStart < 0) throw new Error('Native Sales export fixture boundary is missing.')
const checks = `
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}
const fixtureRows = [
  [1,'2026-09-07 16:59:00','completed'], [2,'2026-09-07 17:00:00','completed'],
  [3,'2026-09-08 00:59:59','completed'], [4,'2026-09-08 02:00:00','completed'],
  [5,'2026-09-08T03:00:59.000Z','completed'], [6,'2026-09-08 03:01:00','completed'],
  [7,'2026-09-08 16:30:00','completed'], [8,'2026-09-08T17:00:00.000Z','completed'],
  [9,'2026-09-09 02:30:00','awaiting_payment'], [10,'2026-09-09T03:00:00.000Z','cancelled'],
  [11,'2026-09-09 17:00:00','completed'],
]
for (const [id, date, status] of fixtureRows) {
  addSale({ id, status, subtotal: id * 10, total: id * 10 })
  addItem({ id: 100 + id, saleId: id, productId: 301, name: 'Toner', total: id * 10 })
  run('UPDATE sales SET created_at=@date WHERE id=@id', {date,id})
  run('UPDATE sale_items SET cost_price_usd=2 WHERE sale_id=@id', {id})
}
run("INSERT INTO returns(id,return_number,sale_id,total_refund_usd,status,return_scope,created_at) VALUES(401,'HOUR-REFUND',4,5,'completed','customer','2026-09-12 01:00:00')")
USER.role_code = 'admin'
const get = async (params) => {
  const response = await app.request('http://local/export?' + new URLSearchParams(params), {}, { DB: db, TEST_USER: USER }, executionCtx)
  return { status: response.status, body: await response.json() }
}
const cohort = { startDate:'2026-09-08', endDate:'2026-09-09', startTime:'09:00', endTime:'10:00', pageSize:'50' }
const ids = (body) => body.sales.map(row => Number(row.receipt_number.replace('SALE-', '')))
const sum = (rows, key) => Math.round(rows.reduce((total,row)=>total+Number(row[key]||0),0)*100)/100
;(async () => {
  await check('recurring Cambodia hours apply identically to rows, count, frozen ceiling and money breakdowns', async () => {
    const result = await get(cohort)
    assert.equal(result.status,200,JSON.stringify(result.body))
    assert.deepEqual(ids(result.body),[4,5,9,10])
    assert.equal(result.body.snapshot_max_id,10)
    assert.equal(result.body.total_matching,4)
    assert.equal(result.body.summary.completed_transactions,2)
    assert.equal(result.body.summary.revenue_usd,180)
    assert.equal(result.body.summary.total_refunds_usd,5)
    assert.equal(result.body.summary.net_revenue_usd,175)
    assert.equal(result.body.summary.cogs_usd,6)
    assert.equal(sum(result.body.by_status,'revenue'),175)
    assert.equal(sum(result.body.by_product,'revenue_usd'),175)
    assert.equal(sum(result.body.by_product,'qty_sold'),3)
  })
  await check('overnight hours repeat within Cambodia dates and preserve UTC midnight boundaries', async () => {
    const result = await get({ ...cohort, startTime:'22:00', endTime:'02:00' })
    assert.equal(result.status,200,JSON.stringify(result.body))
    assert.deepEqual(ids(result.body),[2,7,8])
    assert.equal(result.body.summary.net_revenue_usd,170)
    assert.equal(sum(result.body.by_status,'revenue'),170)
    assert.equal(sum(result.body.by_product,'revenue_usd'),170)
  })
  await check('same minute endpoints include that full minute and date-only callers retain whole days', async () => {
    const minute = await get({ ...cohort, startTime:'10:00', endTime:'10:00' })
    assert.deepEqual(ids(minute.body),[5,10])
    const full = await get({startDate:cohort.startDate,endDate:cohort.endDate,pageSize:'50'})
    assert.deepEqual(ids(full.body),[2,3,4,5,6,7,8,9,10])
  })
  await check('cost-hidden actor keeps the same hour cohort and recognized money', async () => {
    delete USER.role_code
    const result = await get(cohort)
    assert.equal(result.status,200)
    assert.deepEqual(ids(result.body),[4,5,9,10])
    assert.equal(result.body.summary.net_revenue_usd,175)
    assert.equal(result.body.summary.cogs_usd,undefined)
    assert.ok(result.body.sales.every(row => row.cost_price_usd === undefined))
    USER.role_code = 'admin'
  })
  await check('incomplete and invalid supplied clock pairs refuse instead of widening the cohort', async () => {
    for (const clocks of [{startTime:'09:00'},{endTime:'10:00'},{startTime:'24:00',endTime:'10:00'},{startTime:'09:00',endTime:'25:00'}]) {
      const result = await get({startDate:cohort.startDate,endDate:cohort.endDate,...clocks})
      assert.equal(result.status,400,JSON.stringify(clocks))
      assert.equal(result.body.code,'invalid_time_range')
    }
  })
  await check('export action denial preserves the existing permission boundary', async () => {
    delete USER.role_code
    USER.permissions = JSON.stringify({sales:true,'sales:export':false})
    const result = await get(cohort)
    assert.equal(result.status,403)
    USER.permissions = JSON.stringify({sales:true})
    USER.role_code = 'admin'
  })
  await check('paged export retains the same hour mask and snapshot after a new matching sale', async () => {
    const first = await get({...cohort,detailsOnly:'true',pageSize:'1'})
    assert.deepEqual(ids(first.body),[4])
    addSale({id:12,status:'completed',subtotal:120,total:120})
    addItem({id:112,saleId:12,productId:301,name:'Toner',total:120})
    run("UPDATE sales SET created_at='2026-09-09 02:45:00' WHERE id=12")
    const found = ids(first.body)
    let page = first.body
    while(page.has_more) {
      const next = await get({...cohort,detailsOnly:'true',pageSize:'1',snapshotMaxId:String(page.snapshot_max_id),afterCreatedAt:page.next_cursor.created_at,afterId:String(page.next_cursor.id)})
      assert.equal(next.status,200)
      found.push(...ids(next.body)); page=next.body
    }
    assert.deepEqual(found,[4,5,9,10])
  })
  process.exitCode = failed ? 1 : 0
})().catch(error => { console.error(error); process.exitCode=1 })
`
const runner = new Module(original, module)
runner.filename = original
runner.paths = module.paths
runner._compile(source.slice(0, fixtureStart) + checks, original)
