'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
let passed = 0
let failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
}
function fixture() {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.raw.db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);
    INSERT INTO products(id,name,barcode,is_active,stock_quantity) VALUES(1,'Twin','777',1,0),(2,'Twin','777',1,0);`)
  return h
}
function seed(h, ledger, id = 2, branch = 1, qty = 3) {
  if (ledger === 'cache') h.raw.prepare('UPDATE products SET stock_quantity=? WHERE id=?').run([qty,id])
  if (ledger === 'branch') h.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run([id,branch,qty])
  if (ledger === 'lot') {
    const batchId = id * 10 + branch
    h.raw.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active) VALUES(?,?,?,?,1)').run([batchId,id,`lot-${branch}`,branch])
    h.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run([batchId,branch,qty])
  }
  if (ledger === 'damaged') h.raw.prepare("INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining,reason) VALUES(?,?,?,?,'synthetic')").run([id,branch,qty,qty])
}
function digest(h) {
  return JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','damaged_stock_lots','inventory_movements','action_history','audit_logs','undo_snapshots'].map(table => [table,h.raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]))
}
const pair = (h, stock) => h.request('POST','/possible-duplicates/merge',{keepId:1,mergeId:2,...(stock ? {stock} : {})})
async function refused(h, send = () => pair(h)) {
  const before = digest(h)
  const result = await send()
  assert.equal(result.status,409,JSON.stringify(result))
  assert.equal(result.json.code,'product_has_stock',JSON.stringify(result))
  assert.equal(digest(h),before,'refusal preserves every stock/history row')
}
async function main() {
  for (const id of [1,2]) for (const stock of [undefined,'merge','write_off']) {
    await check(`cache-only ${id === 1 ? 'keeper' : 'source'}, choice ${stock || 'default'} refuses atomically`,async () => {
      const h=fixture();seed(h,'cache',id);await refused(h,()=>pair(h,stock))
    })
  }
  await check('lot-only write_off refuses instead of deleting3/reporting0',async () => {
    const h=fixture();seed(h,'lot');await refused(h,()=>pair(h,'write_off'))
  })
  await check('write_off cannot offset lot stock using another branch',async () => {
    const h=fixture();seed(h,'lot');seed(h,'branch',2,2);await refused(h,()=>pair(h,'write_off'))
  })
  for (const ledger of ['cache','branch','lot','damaged']) await check(`${ledger} negative or cancelling stock refuses`,async () => {
    const h=fixture()
    h.raw.db.exec('PRAGMA ignore_check_constraints=ON')
    if(ledger==='cache') seed(h,ledger,2,1,-3)
    else {seed(h,ledger,2,1,3);seed(h,ledger,2,2,-3)}
    await refused(h,()=>pair(h,'merge'))
  })
  for(const id of [1,2]) await check(`lot-only ${id===1?'keeper':'source'} cannot be disguised by the other product's branch stock`,async()=>{
    const h=fixture();seed(h,'lot',id);seed(h,'branch',id===1?2:1);seed(h,'cache',id===1?2:1)
    await refused(h,()=>pair(h,'merge'))
  })
  await check('lot-only ordinary merge refuses unexplained holdings',async()=>{const h=fixture();seed(h,'lot');await refused(h,()=>pair(h,'merge'))})
  for (const ledger of ['branch','damaged']) await check(`independent ${ledger}-only stock merges without losing its ledger`,async () => {
    const h=fixture();seed(h,ledger)
    const result=await pair(h,'merge')
    assert.equal(result.status,200,JSON.stringify(result))
    assert.equal(h.raw.prepare('SELECT is_active FROM products WHERE id=2').get().is_active,0)
    const query=ledger==='branch' ? 'SELECT SUM(quantity) n FROM branch_stock WHERE product_id=1' : 'SELECT SUM(quantity_remaining) n FROM damaged_stock_lots WHERE product_id=1'
    assert.equal(h.raw.prepare(query).get().n,3)
  })
  await check('legitimate branch/lot/cache write_off records all removed quantities',async () => {
    const h=fixture();seed(h,'branch');seed(h,'lot');seed(h,'cache')
    const result=await pair(h,'write_off');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.json.quantityWrittenOff,3)
    assert.equal(h.raw.prepare('SELECT SUM(quantity) n FROM inventory_movements').get().n,-3)
    assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM branch_batch_stock').get().n,0)
  })
  await check('healthy branch stock includes an untracked gap and a separate damaged pool',async () => {
    const h=fixture();seed(h,'branch',2,1,5);seed(h,'cache',2,1,5);seed(h,'lot');seed(h,'damaged',2,1,2)
    const result=await pair(h,'merge');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.json.quantityMoved,5)
    assert.equal(h.raw.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,5)
    assert.equal(h.raw.prepare('SELECT SUM(quantity) n FROM branch_batch_stock').get().n,3)
    assert.equal(h.raw.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots WHERE product_id=1').get().n,2)
  })
  await check('zero control merges',async () => {const h=fixture();assert.equal((await pair(h)).status,200)})
  for(const id of [1,2]) await check(`late cache-only anomaly on ${id===1?'keeper':'source'} is refused inside batch`,async () => {
    const h=fixture();const batch=h.raw.batch.bind(h.raw);let atWrite;let fired=false
    h.raw.batch=async items=>{
      if(!fired && items.some(item=>/merge_source_guard/.test(item.sql))) {fired=true;seed(h,'cache',id);atWrite=digest(h)}
      return batch(items)
    }
    const result=await pair(h)
    assert.ok(fired);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.json.code,'product_has_stock');assert.equal(digest(h),atWrite)
  })
  await check('identity edit fold refuses unexplained source cache',async () => {
    const h=fixture();h.raw.prepare("UPDATE products SET name='Other',barcode='999' WHERE id=2").run();seed(h,'cache')
    await refused(h,()=>h.request('PUT','/2',{name:'Twin',barcode:'777'}))
  })
  await check('automatic/catalog merge exposes the shared stock refusal',async () => {
    const h=fixture();seed(h,'cache');const before=digest(h)
    const result=await h.request('POST','/merge-duplicates',{})
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.json.mergedProducts,0)
    assert.ok(result.json.refusals.some(item=>item.code==='product_has_stock'),JSON.stringify(result));assert.equal(digest(h),before)
  })
  await check('reviewed group/bulk fold exposes the shared stock refusal',async () => {
    const h=fixture();seed(h,'cache')
    const group={group_key:'barcode:777',member_ids:[1,2]}
    const preview=await h.request('POST','/possible-duplicates/merge-batch/preview',{manifest_version:1,resolution_version:2,client_request_id:'stock_divergence_review',merge_groups:[group],remove_rows:[]})
    assert.equal(preview.status,200,JSON.stringify(preview))
    const review=preview.json
    const final=await h.request('POST',`/possible-duplicates/merge-batch/reviews/${review.review_id}/finalize`,{manifest_version:1,resolution_version:2,review_id:review.review_id,draft_digest:review.draft_digest,resolutions:[{group_key:group.group_key,keeper_id:1,barcode:{mode:'member',source_product_id:1},category_source_id:1,brand_source_id:1,unit_source_id:1}]})
    assert.equal(final.status,200,JSON.stringify(final))
    const before=digest(h)
    const result=await h.request('POST','/possible-duplicates/merge-batch',{review_id:review.review_id,manifest_digest:final.json.manifest_digest,client_request_id:review.review_id})
    assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.json.code,'product_has_stock');assert.equal(digest(h),before)
  })
  await check('redo propagates late independent stock refusal without changing the merge graph',async () => {
    const h=fixture();assert.equal((await pair(h)).status,200)
    const history=h.raw.prepare("SELECT id FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge' ORDER BY id DESC LIMIT 1").get()
    const app=h.load('routes/actionHistory.ts').default
    const run=async direction=>{
      const response=await app.request(`http://local/${history.id}/${direction}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({require_applied:true})},{DB:h.raw},{waitUntil(){},passThroughOnException(){}})
      return {status:response.status,json:await response.json()}
    }
    assert.equal((await run('undo')).status,200)
    const batch=h.raw.batch.bind(h.raw);let atWrite;let fired=false
    h.raw.batch=async items=>{if(!fired && items.some(item=>/merge_source_guard/.test(item.sql))) {fired=true;seed(h,'cache');atWrite=digest(h)}return batch(items)}
    const result=await run('redo');assert.ok(fired);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.json.code,'product_has_stock')
    assert.equal(digest(h),atWrite)
  })
  console.log(`${passed} passed, ${failed} failed`)
  if(failed) process.exitCode=1
}
main().catch(error=>{console.error(error);process.exitCode=1})
