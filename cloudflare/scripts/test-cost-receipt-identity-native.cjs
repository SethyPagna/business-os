// Real migrated SQLite, D1Compat, stock-session planner/replay and batch route.
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

const api = loadStockSession()
const costs = loadStockSession('lib/catalogCostRecompute.ts')
const { getDb } = loadStockSession('lib/db.ts')
const batches = loadStockSession('lib/productBatches.ts')
function request(key, cost, extra = {}) {
  const body = receiveRequest(key, 1)
  Object.assign(body.items[0], { unit_cost_usd: cost, ...extra })
  if (cost === 0) body.items[0].free_goods = true
  return body
}
const productCost = f => f.sql.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd
const lotRows = f => f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all()
const payload = (f, r) => JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(r.actionHistoryId).undo_payload)
const snapshots = f => JSON.stringify({
  movements: f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all(),
  receipts: f.sql.prepare('SELECT request_json,receipt_json FROM stock_session_operations ORDER BY id').all(),
  history: f.sql.prepare('SELECT undo_payload,redo_payload FROM action_history ORDER BY id').all(),
  saleItems: f.sql.prepare('SELECT * FROM sale_items ORDER BY id').all(),
  allocations: f.sql.prepare('SELECT * FROM sale_item_batch_allocations ORDER BY id').all(),
})

async function main() {
  const f = fixture()
  const first = await api.commitStockSession(f.env, user, request('receipt-cost-three', 3))
  const firstRow = lotRows(f)[0]
  const secondBody = request('receipt-cost-five', 5)
  const second = await api.commitStockSession(f.env, user, secondBody)
  assert.notEqual(second.items[0].batchId, first.items[0].batchId)
  assert.deepEqual(lotRows(f)[0], firstRow, 'new-priced receipt must not edit the old lot')
  assert.equal(productCost(f), 4)
  const beforeReplay = snapshots(f)
  const retry = await api.commitStockSession(f.env, user, secondBody)
  assert.equal(retry.replayed, true)
  assert.equal(snapshots(f), beforeReplay)
  await api.replayStockSession(f.env, user, 'undo', second.actionHistoryId, 0, payload(f, second))
  assert.equal(productCost(f), 3)
  assert.equal(f.sql.prepare('SELECT purchase_price_usd c FROM products WHERE id=1').get().c,3)
  assert.deepEqual(lotRows(f)[0], firstRow)
  await api.replayStockSession(f.env, user, 'redo', second.actionHistoryId, 1, payload(f, second))
  assert.equal(productCost(f), 4)
  assert.equal(f.sql.prepare('SELECT purchase_price_usd c FROM products WHERE id=1').get().c,4)
  assert.equal(lotRows(f)[1].id, second.items[0].batchId)
  const third = await api.commitStockSession(f.env, user, request('receipt-three-again', 3))
  assert.equal(third.items[0].batchId, first.items[0].batchId)
  assert.equal(productCost(f), 4)
  const zero = await api.commitStockSession(f.env, user, request('receipt-zero-free', 0))
  assert.notEqual(zero.items[0].batchId, first.items[0].batchId)
  assert.equal(productCost(f), 4)
  const beforeRejected = snapshots(f)
  await assert.rejects(api.commitStockSession(f.env, user, request('receipt-wrong-picked', 5, { batch_id:first.items[0].batchId })), e => e.code === 'batch_cost_mismatch')
  assert.equal(snapshots(f), beforeRejected)
  console.log('PASS same-day3/5->4; repeat3 unchanged; explicit zero separate; mismatched picker fails; exact retry/undo/redo')

  const oldLots = lotRows(f)
  const historyBeforeOverride = snapshots(f)
  await costs.recordManualCostEntry(getDb(f.env), 1, {cost_price_usd:4,cost_price_khr:0}, {cost_price_usd:10}, {id:7,name:'Fixture'})
  await costs.recomputeCatalogCost(getDb(f.env), 1)
  assert.equal(productCost(f), 10)
  assert.equal(snapshots(f), historyBeforeOverride, 'manual catalog override leaves historical money records unchanged')
  const afterOverride = await api.commitStockSession(f.env, user, request('receipt-after-override', 3))
  assert.ok(afterOverride.items[0].batchId > Math.max(...oldLots.map(row => row.id)))
  assert.equal(productCost(f), 6.5)
  assert.deepEqual(lotRows(f).slice(0,oldLots.length), oldLots)
  const beforeSecond = productCost(f)
  const sameAfter = await api.commitStockSession(f.env, user, request('receipt-after-repeat', 3))
  assert.equal(sameAfter.items[0].batchId, afterOverride.items[0].batchId)
  assert.equal(productCost(f), beforeSecond)
  console.log('PASS override baseline forces fresh same-day lot; subsequent same-price receipt reuses only post-override lot')

  const wide = fixture()
  await api.commitStockSession(wide.env, user, request('wide-cost-two', 2))
  await api.commitStockSession(wide.env, user, request('wide-cost-ten', 10))
  assert.equal(productCost(wide), 6)
  const breakdown = await costs.getCatalogCostBreakdown(getDb(wide.env), 1)
  assert.equal(breakdown.result_usd, 6)
  assert.equal(breakdown.outlier_guard.fired, false)
  console.log('PASS SQL writer/JS breakdown agree2/10->6 without altering merge policy')

  const distinct = fixture()
  for (const [index, cost] of [3, 5, 7, 3].entries()) {
    await api.commitStockSession(distinct.env, user, request(`distinct-mean-${index}`, cost))
  }
  assert.equal(productCost(distinct), 5, '3/5 then7 averages all distinct receipt costs, never the previous mean')
  assert.equal((await costs.getCatalogCostBreakdown(getDb(distinct.env), 1)).result_usd, 5)
  assert.equal(lotRows(distinct).length, 3, 'repeated3 reuses its lot and cannot reweight the mean')
  console.log('PASS distinct3/5/7->5 and repeated3 retains5; not mean-of-means5.5')

  const legacy = fixture()
  const input = {productId:1,branchId:1,quantity:1,receivedDate:'2026-09-05',unitCostUsd:3,supplierName:'Fixture'}
  const a = await batches.receiveBatchStock(getDb(legacy.env), input)
  const b = await batches.receiveBatchStock(getDb(legacy.env), {...input,unitCostUsd:5})
  assert.notEqual(a.batchId,b.batchId)
  assert.equal((await batches.receiveBatchStock(getDb(legacy.env),input)).batchId,a.batchId)
  await assert.rejects(batches.receiveBatchStock(getDb(legacy.env),{...input,batchId:a.batchId,unitCostUsd:5}), /Selected batch price/)
  const replayBaseline = Math.max(...lotRows(legacy).map(row=>row.id))
  legacy.sql.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,baseline_batch_id,source) VALUES(1,10,?,'manual')").run(replayBaseline)
  await assert.rejects(batches.receiveBatchStock(getDb(legacy.env),{...input,batchId:a.batchId}), /Selected batch price/)
  assert.equal((await batches.receiveBatchStock(getDb(legacy.env),{...input,batchId:a.batchId,historicalReceiptReplay:true,preserveHistoricalUnitCost:true})).batchId,a.batchId)
  console.log('PASS shared manual/batch helper uses same guarded price identity')

  const reserved = fixture()
  const reservedInput = {productId:1,branchId:1,quantity:1,receivedDate:'2026-09-05',unitCostUsd:3,
    receiptCostPreimage:{batchExists:false,receivedCostUsd:null}}
  const reservedTarget = batches.resolveReceiptLotTarget([],'2026-09-05',3,0)
  const reservedPlan = batches.planReceiveBatchStock({...reservedInput,receiptLotTarget:reservedTarget,reservedBatchId:100})
  const repeatedPlan = batches.planReceiveBatchStock({...reservedInput,
    receiptLotTarget:{...reservedTarget,existingBatchId:100},receiptCostPreimage:{batchExists:true,receivedCostUsd:3}})
  await getDb(reserved.env).batch([...reservedPlan.statements,...repeatedPlan.statements,{sql:'DELETE FROM stock_session_guards'}])
  assert.equal(lotRows(reserved)[0].id,100)
  assert.equal(lotRows(reserved)[0].received_quantity,2)
  assert.equal(lotRows(reserved)[0].received_cost_usd,6)
  const reservedBefore = JSON.stringify({lots:lotRows(reserved),stock:reserved.sql.prepare('SELECT * FROM branch_stock').all()})
  const otherTarget = batches.resolveReceiptLotTarget(lotRows(reserved),'2026-09-05',5,0)
  const collision = batches.planReceiveBatchStock({...reservedInput,unitCostUsd:5,receiptLotTarget:otherTarget,reservedBatchId:100})
  await assert.rejects(getDb(reserved.env).batch([...collision.statements,{sql:'DELETE FROM stock_session_guards'}]))
  assert.equal(JSON.stringify({lots:lotRows(reserved),stock:reserved.sql.prepare('SELECT * FROM branch_stock').all()}),reservedBefore)
  for (const extra of [{reservedBatchId:0},{reservedBatchId:1.5},{reservedBatchId:101,receiptLotTarget:{...reservedTarget,existingBatchId:100}},
    {reservedBatchId:101,receiptLotTarget:{...reservedTarget,baselineBatchId:101}}, {reservedBatchId:101,batchId:100}]) {
    assert.throws(()=>batches.planReceiveBatchStock({...reservedInput,receiptLotTarget:reservedTarget,...extra}),/reservation/)
  }
  console.log('PASS internal reserved lot IDs support repeated chunk receipts and fail closed on identity collisions')

  const raced = fixture()
  const emptyHistory = snapshots(raced)
  raced.beforeCommit(sql => sql.exec("INSERT INTO product_cost_entries(product_id,cost_usd,baseline_batch_id,source) VALUES(1,7,99,'manual')"))
  await assert.rejects(api.commitStockSession(raced.env,user,request('baseline-race-cost',3)),e=>e.code==='stale_state')
  assert.equal(lotRows(raced).length,0)
  assert.equal(snapshots(raced),emptyHistory)
  console.log('PASS concurrent override baseline change refuses the entire receipt without durable stock/history')

  wide.sql.exec(`INSERT INTO sales(id) VALUES(1);
    INSERT INTO sale_items(id,sale_id,product_id,quantity,cost_price_usd,cost_price_khr) VALUES(1,1,1,1,10,0);
    INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,quantity) VALUES(1,2,1)`)
  const historyBeforePatch = snapshots(wide)
  const receivedBefore = wide.sql.prepare('SELECT id,received_quantity,received_cost_usd FROM product_batches ORDER BY id').all()
  const route = loadStockSession('routes/batches.ts') .default
  const deferred = []
  const dateFixture = fixture()
  for (const cost of [3,5]) await api.commitStockSession(dateFixture.env,user,request(`date-edit-${cost}`,cost))
  const originalDateLots = lotRows(dateFixture)
  const originalDateHistory = snapshots(dateFixture)
  for (const date of [originalDateLots[0].received_at.slice(0,10), '2026-09-08']) {
    for (const lot of originalDateLots) {
      const response = await route.request(`/${lot.id}`, {method:'PATCH',headers:{'content-type':'application/json'},
        body:JSON.stringify({received_at:date,unit_cost_usd:lot.unit_cost_usd})},dateFixture.env,{waitUntil(p){deferred.push(p)}})
      assert.equal(response.status,200,await response.text())
    }
    assert.deepEqual(lotRows(dateFixture).map(row=>row.batch_key),originalDateLots.map(row=>row.batch_key))
    assert.deepEqual(lotRows(dateFixture).map(row=>row.received_at),[date,date])
    assert.equal(productCost(dateFixture),4)
    assert.equal(snapshots(dateFixture),originalDateHistory)
  }
  const movedReceipt = request('moved-date-same-price',3,{received_date:'2026-09-08'})
  const movedResult = await api.commitStockSession(dateFixture.env,user,movedReceipt)
  assert.equal(movedResult.items[0].batchId,originalDateLots[0].id,'corrected display date still resolves same-priced lot by date and price')
  console.log('PASS both same-date priced lots accept unchanged/changed date PATCH without changing durable keys or history')
  const preCorrection = lotRows(wide)
  wide.failWhenSqlMatches(/UPDATE products SET/)
  const failedPatch = await route.request('/2', {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({unit_cost_usd:6})}, wide.env, {waitUntil(p){deferred.push(p)}})
  assert.equal(failedPatch.status,500)
  assert.deepEqual(lotRows(wide),preCorrection,'failure in catalog projection rolls back the lot correction too')
  assert.equal(productCost(wide),6)
  const patch = await route.request('/2', {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({unit_cost_usd:6})}, wide.env, {waitUntil(p){deferred.push(p)}})
  assert.equal(patch.status,200,await patch.text())
  await Promise.all(deferred)
  assert.equal(productCost(wide),4)
  assert.equal(snapshots(wide),historyBeforePatch)
  assert.deepEqual(wide.sql.prepare('SELECT id,received_quantity,received_cost_usd FROM product_batches ORDER BY id').all(),receivedBefore)
  const replacement = await api.commitStockSession(wide.env,user,request('corrected-key-receipt',10))
  assert.notEqual(replacement.items[0].batchId,2,'corrected lot keeps stable key; incoming old price gets another lot')
  console.log('PASS batch correction atomically recomputes catalog; original receipts/movements/history money unchanged')
}
async function nativeD1() {
  const fs = require('node:fs'), path = require('node:path')
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
    d1Databases:['DB'],compatibilityDate:'2026-08-01',log:new Log(LogLevel.ERROR)})
  try {
    const db = await mf.getD1Database('DB'), env = {DB:db}
    const dir = path.resolve(__dirname,'../migrations')
    for (const name of fs.readdirSync(dir).filter(n=>n.endsWith('.sql')).sort()) {
      const statements = split(fs.readFileSync(path.join(dir,name),'utf8'))
        .filter(sql=>!(name==='0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
      for (let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50).map(sql=>db.prepare(sql)))
    }
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)"),
      db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(1,'Serum','SER-1',2,0,1)"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)'),
    ])
    const readCost = async()=> (await db.prepare('SELECT cost_price_usd c FROM products WHERE id=1').first()).c
    const a = await api.commitStockSession(env,user,request('native-cost-three',3))
    const b = await api.commitStockSession(env,user,request('native-cost-five',5))
    assert.notEqual(a.items[0].batchId,b.items[0].batchId)
    assert.equal(await readCost(),4)
    const row = await db.prepare('SELECT undo_payload FROM action_history WHERE id=?').bind(b.actionHistoryId).first()
    await api.replayStockSession(env,user,'undo',b.actionHistoryId,0,JSON.parse(row.undo_payload))
    assert.equal(await readCost(),3)
    await api.replayStockSession(env,user,'redo',b.actionHistoryId,1,JSON.parse(row.undo_payload))
    assert.equal(await readCost(),4)
    assert.equal((await api.commitStockSession(env,user,request('native-cost-repeat',3))).items[0].batchId,a.items[0].batchId)
    assert.equal(await readCost(),4)
    await costs.recordManualCostEntry(getDb(env),1,{cost_price_usd:4,cost_price_khr:0},{cost_price_usd:10},{id:7,name:'Fixture'})
    await costs.recomputeCatalogCost(getDb(env),1)
    const c = await api.commitStockSession(env,user,request('native-override-new',2))
    assert.notEqual(c.items[0].batchId,a.items[0].batchId)
    assert.equal(await readCost(),6)
    assert.equal((await costs.getCatalogCostBreakdown(getDb(env),1)).result_usd,6)
    console.log('PASS actual workerd D1 same-day distinct/repeated prices, override, SQL/JS mean and undo/redo')
  } finally { await mf.dispose() }
}
main().then(nativeD1).catch(error => {console.error(error);process.exitCode=1})
