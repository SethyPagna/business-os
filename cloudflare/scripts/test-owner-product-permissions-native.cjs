'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const role = grants => ({ id: 21, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const admin = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
let h, failed = 0
function fixture(user) {
  if (!h) {
    h = createProductsRouteHarness({ user })
    const real = h.load('lib/permissions.ts')
    h.setActionTier((...args) => real.getActionTier(...args))
  }
  h.setUser(user)
  h.raw.db.exec(`DELETE FROM bulk_delete_jobs; DELETE FROM audit_logs; DELETE FROM product_cost_entries; DELETE FROM products; DELETE FROM branches;
    INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1);
    INSERT INTO products(id,name,barcode,selling_price_usd,stock_quantity,is_active) VALUES(1,'Gloss','8850000000011',5,0,1);
    INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('job-1','products','processing','x','[1]',1);`)
  return h
}
const cancelFlag = () => Number(h.raw.prepare("SELECT cancel_requested AS v FROM bulk_delete_jobs WHERE id='job-1'").get([]).v)
const count = () => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM products').get([]).n)
async function check(name, fn) { try { await fn(); console.log('PASS '+name) } catch(error) { failed++; console.error('FAIL '+name, error) } }
async function main() {
  await check('Products Partial reader cannot directly cancel an administrator bulk-delete job', async()=>{
    fixture(role({products:'review'}))
    const response=await h.request('POST','/bulk-delete-jobs/job-1/cancel')
    console.log('OBSERVED reader cancel',JSON.stringify(response),'cancel_requested',cancelFlag())
    assert.equal(response.status,403); assert.equal(cancelFlag(),0)
  })
  await check('Full Products with Bulk delete denied cannot cancel',async()=>{
    fixture(role({products:true,'products:bulk_delete':false}))
    const response=await h.request('POST','/bulk-delete-jobs/job-1/cancel')
    assert.equal(response.status,403); assert.equal(cancelFlag(),0)
  })
  await check('Full Products with Add product denied cannot create Variant',async()=>{
    fixture(role({products:true,'products:variant':true,'products:add':false}))
    const response=await h.request('POST','/variant',{name:'Gloss Rose',barcode:'8850000000099',selling_price_usd:5})
    console.log('OBSERVED Add-denied variant',JSON.stringify(response),'products',count())
    assert.equal(response.status,403); assert.equal(count(),1)
  })
  await check('Add product enabled with Variant denied cannot create',async()=>{
    fixture(role({products:true,'products:variant':false,'products:add':true}))
    assert.equal((await h.request('POST','/variant',{name:'Gloss Rose',barcode:'8850000000099'})).status,403);assert.equal(count(),1)
  })
  await check('normal Full and admin cancel and create still work',async()=>{
    for(const user of [role({products:true}),admin]){
      fixture(user)
      assert.equal((await h.request('POST','/bulk-delete-jobs/job-1/cancel')).status,200);assert.equal(cancelFlag(),1)
      const response=await h.request('POST','/variant',{name:'Gloss Rose',barcode:'8850000000099',selling_price_usd:5})
      assert.equal(response.status,200,JSON.stringify(response));assert.equal(count(),2)
    }
  })
  await check('all four existing catalog price guards remain enforced',async()=>{
    for(const grants of [{products:'view'},{products:true,'products:edit':false},{products:true,'products:price':false},{products:true,'products:manage_lookups':false}]){
      fixture(role(grants))
      for(const preview of [true,false]) assert.equal((await h.request('POST','/bulk-price-adjust',{direction:'increase',amount:1,fields:['selling_price_usd'],preview,client_request_id:'permission_price_0001'})).status,403,JSON.stringify(grants))
      assert.equal(h.raw.prepare('SELECT selling_price_usd AS price FROM products WHERE id=1').get([]).price,5)
      assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM audit_logs').get([]).n,0)
    }
  })
  if(failed)throw Error(failed+' owner permission schedules failed')
  console.log('owner product permission schedules PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
