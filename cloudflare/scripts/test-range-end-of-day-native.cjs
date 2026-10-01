const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const original = path.join(__dirname, 'test-sales-export-preview-revenue-pure.cjs')
const source = fs.readFileSync(original, 'utf8')
const fixtureStart = source.indexOf('addSale({ id: 101')
if (fixtureStart < 0) throw new Error('Export fixture boundary missing')
const prefix = source.slice(0, fixtureStart).replace('const dbOverride = { getDb: (env) => env.DB }', "const dbOverride = { getDb: env => load('lib/db.ts').getDb(env) }")
const checks = String.raw`
const binding = {
  prepare(sql) { let values = []; return {
    bind(...next) { values = next; return this },
    async all() { return { success: true, results: db.db.prepare(sql).all(...values), meta: { changes: 0 } } },
    async run() { const info = db.db.prepare(sql).run(...values); return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } } },
  } },
  async batch(items) { return await Promise.all(items.map(item => item.all())) },
}
const dates = ['2026-09-30','2026-12-31','2024-02-29']
let nextId = 0
for (const date of dates) for (const stamp of [date+' 01:59:59',date+' 02:00:00',date+'T16:59:59.999Z',date+' 17:00:00',date+'T17:00:30.000Z',date+'T23:59:59+07:00',date+'T24:00:00+07:00']) {
  const id = ++nextId
  addSale({id,status:'completed',subtotal:id,total:id})
  addItem({id:100+id,saleId:id,productId:301,name:'A',total:id})
  run('UPDATE sales SET created_at=@stamp WHERE id=@id',{stamp,id})
}
USER.role_code = 'admin'
const get = async query => {
  const response = await app.request('http://local/export?' + new URLSearchParams(query), {}, {DB:binding}, executionCtx)
  return {status:response.status,body:await response.json()}
}
const ids = body => body.sales.map(row => Number(row.receipt_number.slice(5))).sort((a,b)=>a-b)
let failed = 0
async function check(name, fn) { try { await fn(); console.log('PASS '+name) } catch(error) { failed++;console.error('FAIL '+name,error) } }
;(async () => {
  for (let index=0;index<dates.length;index++) await check('continuous and recurring24 exclude exact next midnight '+dates[index], async () => {
    const date=dates[index], offset=index*7
    const recurring=await get({startDate:date,endDate:date,startTime:'09:00',endTime:'24:00',pageSize:'50'})
    assert.equal(recurring.status,200,JSON.stringify(recurring.body))
    assert.deepEqual(ids(recurring.body),[offset+2,offset+3,offset+6])
    assert.equal(recurring.body.total_matching,3)
    assert.equal(recurring.body.summary.net_revenue_usd,offset*3+11)
    assert.equal(recurring.body.by_product.reduce((n,row)=>n+row.revenue_usd,0),offset*3+11)
    const scope=load('lib/salesAnalytics.ts').whereActiveSales('s',{createdFrom:date+' 02:00:00',createdTo:date+' 17:00:00'})
    const continuous=await load('lib/db.ts').getDb({DB:binding}).prepare('SELECT s.id FROM sales s WHERE '+scope.sql+' ORDER BY s.id').all(scope.params)
    assert.deepEqual(continuous.map(row=>row.id),ids(recurring.body))
    const legacy=await get({startDate:date,endDate:date,pageSize:'50'})
    const full=await get({startDate:date,endDate:date,startTime:'00:00',endTime:'24:00',pageSize:'50'})
    assert.deepEqual(full.body,legacy.body)
  })
  await check('bad24 start or nonzero end minute/seconds fails closed',async()=>{
    for(const clocks of [{startTime:'24:00',endTime:'24:00'},{startTime:'09:00',endTime:'24:01'},{startTime:'09:00',endTime:'24:30'},{startTime:'09:00',endTime:'24:00:30'}]) assert.equal((await get({startDate:dates[0],endDate:dates[0],...clocks})).status,400,JSON.stringify(clocks))
  })
  await check('recurring24 within multiple dates never includes following-day midnight as overnight',async()=>{
    const result=await get({startDate:'2026-09-30',endDate:'2026-12-31',startTime:'09:00',endTime:'24:00',pageSize:'50'})
    assert.equal(result.status,200)
    assert.deepEqual(ids(result.body),[2,3,6,9,10,13])
    const first=await get({startDate:dates[0],endDate:dates[0],startTime:'09:00',endTime:'24:00',detailsOnly:'true',pageSize:'1'})
    assert.equal(first.status,200)
    const found=ids(first.body);let page=first.body
    while(page.has_more){const next=await get({startDate:dates[0],endDate:dates[0],startTime:'09:00',endTime:'24:00',detailsOnly:'true',pageSize:'1',snapshotMaxId:String(page.snapshot_max_id),afterCreatedAt:page.next_cursor.created_at,afterId:String(page.next_cursor.id)});assert.equal(next.status,200);found.push(...ids(next.body));page=next.body}
    assert.deepEqual(found.sort((a,b)=>a-b),[2,3,6])
  })
  await check('cost privacy and export denial remain enforced at24',async()=>{
    delete USER.role_code
    USER.permissions=JSON.stringify({sales:true,product_cost_view:false})
    const query={startDate:dates[0],endDate:dates[0],startTime:'09:00',endTime:'24:00'}
    const result=await get(query)
    assert.equal(result.status,200)
    assert.equal(result.body.summary.cogs_usd,undefined)
    assert.ok(result.body.sales.every(row=>row.cost_price_usd===undefined))
    USER.permissions=JSON.stringify({sales:true,'sales:export':false})
    assert.equal((await get(query)).status,403)
  })
  db.db.close()
  process.exitCode=failed?1:0
})().catch(error=>{console.error(error);process.exitCode=1})
`
const runner = new Module(original, module)
runner.filename = original
runner.paths = module.paths
runner._compile(prefix + checks, original)
