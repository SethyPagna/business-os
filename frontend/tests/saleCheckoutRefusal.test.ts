import assert from 'node:assert/strict'
import { releaseRefusedSaleCheckout } from '../src/utils/saleCheckoutRefusal.ts'
import { isSaleSnapshotRefusal, saleSubmitRefusalText } from '../src/api/saleSubmitErrors.ts'
import fs from 'node:fs'

const refusal={status:409,code:'sale_snapshot_too_large',proven_uncommitted:true}
const orders=[{id:'order-a',checkoutRequestId:'same-request',checkoutPayload:{owner:'actor-a'},checkoutReviewRequestId:'same-request',cart:[{id:7,quantity:5}],amountPaidUsd:'90',paymentDetails:[{method:'ABA',amountUsd:'90',amountKhr:'2000'}],notes:'keep me'},
  {id:'order-b',checkoutRequestId:'other-request',checkoutPayload:{owner:'actor-b'},cart:[{id:8,quantity:2}],amountPaidUsd:'20',notes:'other draft'}]
let persisted:unknown
const options={error:refusal,requestId:'same-request',orderId:'order-a',orders,firstAttempt:true,isCurrent:()=>true,owns:(payload:unknown)=>(payload as {owner:string}).owner==='actor-a',persist:(next:typeof orders)=>{persisted=JSON.parse(JSON.stringify(next));return true}}
const released=releaseRefusedSaleCheckout(options)!
assert.ok(released)
assert.equal(released[0].checkoutRequestId,'')
assert.equal(released[0].checkoutPayload,undefined)
assert.deepEqual(released[0].cart,orders[0].cart)
assert.equal(released[0].amountPaidUsd,'90')
assert.equal(released[0].notes,'keep me')
assert.deepEqual(released[0].paymentDetails,orders[0].paymentDetails)
assert.equal(released[1],orders[1])
assert.equal(orders[0].checkoutRequestId,'same-request','original remains intact until the caller adopts persisted result')
assert.ok(persisted)
for(const error of [{...refusal,status:500},{...refusal,proven_uncommitted:false},{...refusal,proven_uncommitted:undefined},{...refusal,code:'loader_timeout'},new Error('Failed to fetch')]){
  assert.equal(releaseRefusedSaleCheckout({...options,error}),null)
  assert.equal(isSaleSnapshotRefusal(error),false)
}
assert.equal(releaseRefusedSaleCheckout({...options,requestId:'stale-request'}),null)
assert.equal(releaseRefusedSaleCheckout({...options,isCurrent:()=>false}),null)
assert.equal(releaseRefusedSaleCheckout({...options,owns:()=>false}),null)
assert.equal(releaseRefusedSaleCheckout({...options,firstAttempt:false}),null,'A pending earlier send is not disproved by a later refused attempt')
assert.equal(releaseRefusedSaleCheckout({...options,persist:()=>false}),null)
assert.equal(releaseRefusedSaleCheckout({...options,persist:()=>{throw new Error('storage full')}}),null)
let current=true
assert.equal(releaseRefusedSaleCheckout({...options,isCurrent:()=>current,persist:()=>{current=false;return true}}),null)
for(const language of ['en','km']){
  const pack=JSON.parse(fs.readFileSync(new URL(`../src/lang/${language}.json`,import.meta.url),'utf8'))
  assert.ok(pack.sale_snapshot_too_large)
  assert.equal(saleSubmitRefusalText(refusal,key=>pack[key]),pack.sale_snapshot_too_large)
}
console.log('PASS proven size refusal releases only the persisted matching checkout; basket/tender/notes and uncertain identities survive')
