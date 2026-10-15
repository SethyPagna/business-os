const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-money-write-policy-native.cjs'), 'utf8')
  .replaceAll('\r\n', '\n').split(';(async () => {')[0]
if (!harnessBase.includes('const frontendWriter')) throw new Error('the product writer fixture anchor moved')
const checks = `
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error) }
}
const entries = id => raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id').all(id)
const overrides = id => raw.prepare("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id=? ORDER BY id").all(String(id))
const make = (name, usd, khr) => Number(raw.prepare('INSERT INTO products(name,cost_price_usd,cost_price_khr,selling_price_usd,is_active,updated_at) VALUES(?,?,?,10,1,NULL)').run(name, usd, khr).lastInsertRowid)
const apply = (id, updates, user = admin) => request(products, 'PUT', '/' + id, frontendWriter.buildProductBulkUpdatePayload(updates, row(id), user), user)
;(async () => {
  for (const [field, own, initial] of [['purchase_price_usd','cost_price_usd',5], ['purchase_price_khr','cost_price_khr',20000]]) {
    await check('relative bulk ' + own + ' uses canonical cost and reaches the real manual override writer', async () => {
      for (const mirror of [undefined, 0, 99]) {
        const id = make('S12 ' + own + ' ' + String(mirror), 5, 20000)
        const input = { id, cost_price_usd:5, cost_price_khr:20000, ...(mirror === undefined ? {} : {[field]:mirror}) }
        const [change] = frontendWriter.buildProductBulkPriceAdjustments([input], {direction:'increase',amount:1,fields:[field]})
        assert.equal(change.updates[field], initial + 1)
        const result = await apply(id, change.updates)
        assert.equal(result.status,200,JSON.stringify(result))
        assert.equal(row(id)[own],initial + 1,'actual catalog column changes')
        assert.equal(entries(id).length,1,'manual override proof written')
        assert.equal(entries(id)[0].previous_cost_usd,5)
        assert.equal(entries(id)[0].cost_usd,field === 'purchase_price_usd' ? 6 : 5)
        assert.equal(overrides(id).length,1)
        assert.equal(JSON.parse(overrides(id)[0].new_value)[own],initial + 1)
      }
    })
  }
  await check('relative unknown/redacted cost skips even with a positive mirror; proven zero moves with skip-zero enabled', async () => {
    const unknown = make('S12 Unknown',null,null)
    const redacted = make('S12 Redacted',7,28000)
    const hidden = [{id:unknown,cost_price_usd:null,purchase_price_usd:99}, {id:redacted}]
    assert.deepEqual(frontendWriter.buildProductBulkPriceAdjustments(hidden,{direction:'increase',amount:1,fields:['purchase_price_usd'],skipZeroPriced:true}),[])
    assert.equal(entries(unknown).length + entries(redacted).length,0)
    const zero = make('S12 Proven Zero',null,null)
    assert.equal((await request(products,'PUT','/' + zero,{cost_price_usd:0,cost_price_khr:0})).status,200)
    const [change] = frontendWriter.buildProductBulkPriceAdjustments([{id:zero,cost_price_usd:0,cost_price_khr:0}],{direction:'increase',amount:1,fields:['purchase_price_usd','purchase_price_khr'],skipZeroPriced:true})
    assert.equal((await apply(zero,change.updates)).status,200)
    assert.deepEqual([row(zero).cost_price_usd,row(zero).cost_price_khr],[1,1])
    assert.deepEqual(entries(zero).map(e=>[e.cost_usd,e.previous_cost_usd]),[[0,null],[1,0]])
  })
  await check('absolute clear stays NULL with audit/no entry; typed zero has its proof; KHR-only unknown USD has no false zero entry', async () => {
    for (const value of [null,'0']) {
      const id = make('S12 Absolute ' + String(value),5,20000)
      const updates = frontendWriter.buildProductBulkPricingUpdates({purchase_price_usd:value,purchase_price_khr:value})
      assert.equal((await apply(id,updates)).status,200)
      const expected = value === null ? null : 0
      assert.deepEqual([row(id).cost_price_usd,row(id).cost_price_khr],[expected,expected])
      assert.equal(entries(id).length,value === null ? 0 : 1)
      if (value !== null) assert.deepEqual([entries(id)[0].cost_usd,entries(id)[0].previous_cost_usd],[0,5])
      assert.equal(overrides(id).length,1)
    }
    const id = make('S12 KHR Only',null,null)
    assert.equal((await apply(id,frontendWriter.buildProductBulkPricingUpdates({purchase_price_khr:'8000'}))).status,200)
    assert.deepEqual([row(id).cost_price_usd,row(id).cost_price_khr],[null,8000])
    assert.equal(entries(id).length,0)
    assert.equal(overrides(id).length,1)
  })
  await check('bulk mapping preserves server raw-negative refusal, price rounding, permission denial and stale revision refusal', async () => {
    const id = make('S12 Guards',5,20000)
    const before = row(id)
    const negative = frontendWriter.buildProductBulkPricingUpdates({purchase_price_usd:'-0.00004'})
    assert.equal((await apply(id,negative)).status,400)
    assert.deepEqual(row(id),before)
    assert.equal((await apply(id,{purchase_price_usd:6},{...admin,tier:'none'})).status,403)
    assert.deepEqual(row(id),before)
    const stale = frontendWriter.buildProductBulkUpdatePayload({purchase_price_usd:6},{updated_at:'old revision'})
    raw.prepare("UPDATE products SET updated_at='new revision' WHERE id=?").run(id)
    assert.equal((await request(products,'PUT','/' + id,stale)).status,409)
    assert.equal(row(id).cost_price_usd,5)
    const prices = frontendWriter.buildProductBulkPricingUpdates({selling_price_usd:'1.23001',purchase_price_usd:'1.23455'})
    assert.equal((await apply(id,prices)).status,200)
    assert.equal(row(id).selling_price_usd,1.24)
    assert.equal(row(id).cost_price_usd,1.2346)
  })
  await check('reviewed bulk cost payload remains pending until real approval then creates the canonical override', async () => {
    const id = make('S12 Reviewed',5,20000)
    const pending = await apply(id,{purchase_price_usd:6},requester)
    assert.equal(pending.status,202,JSON.stringify(pending))
    assert.equal(row(id).cost_price_usd,5)
    assert.equal(entries(id).length,0)
    assert.equal((await request(reviews,'POST','/' + pending.body.pendingActionId + '/approve',{})).status,200)
    assert.equal(row(id).cost_price_usd,6)
    assert.equal(entries(id).length,1)
  })
  process.exitCode = failed ? 1 : 0
})().catch(error=>{console.error(error);process.exitCode=1})
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harnessBase + checks, __filename)
