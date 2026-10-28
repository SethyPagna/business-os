import assert from 'node:assert/strict'
import { persistRefusedCheckoutDraft, releaseRefusedSaleCheckout } from '../src/utils/saleCheckoutRefusal.ts'
import { isSaleSnapshotRefusal, isTerminalSaleCreateRefusal, saleSubmitRefusalText } from '../src/api/saleSubmitErrors.ts'
import fs from 'node:fs'

const refusal={status:409,code:'sale_snapshot_too_large',proven_uncommitted:true,terminal_request_refused:true,client_request_id:'same-request'}
const orders=[{id:'order-a',checkoutRequestId:'same-request',checkoutPayload:{owner:'actor-a'},checkoutReviewRequestId:'same-request',cart:[{id:7,quantity:5}],amountPaidUsd:'90',paymentDetails:[{method:'ABA',amountUsd:'90',amountKhr:'2000'}],notes:'keep me'},
  {id:'order-b',checkoutRequestId:'other-request',checkoutPayload:{owner:'actor-b'},cart:[{id:8,quantity:2}],amountPaidUsd:'20',notes:'other draft'}]
let persisted:unknown
const options={error:refusal,requestId:'same-request',orderId:'order-a',orders,isCurrent:()=>true,owns:(payload:unknown)=>(payload as {owner:string}).owner==='actor-a',persist:(next:typeof orders)=>{persisted=JSON.parse(JSON.stringify(next));return true}}
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
for(const error of [
  {...refusal,terminal_request_refused:undefined},{...refusal,terminal_request_refused:false},
  {...refusal,terminal_request_refused:'true'},{...refusal,terminal_request_refused:1},
  {...refusal,client_request_id:undefined},{...refusal,client_request_id:'another-request'},
  {...refusal,client_request_id:123},
]){
  let writes=0
  assert.equal(isTerminalSaleCreateRefusal(error,options.requestId),false)
  assert.equal(releaseRefusedSaleCheckout({...options,error,persist:()=>{writes++;return true}}),null)
  assert.equal(writes,0)
}
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

const previous=JSON.stringify(orders), next=JSON.stringify(released)
const store=(value:string|null,blocked=false)=>({value,getItem(){return this.value},setItem(_key:string,newValue:string){if(blocked)throw new Error('quota');this.value=newValue}})
const persist=(local:ReturnType<typeof store>,session:ReturnType<typeof store>)=>persistRefusedCheckoutDraft({key:'orders',previous,next,local:()=>local,session:()=>session})
{
  const local=store(previous), session=store(previous)
  assert.equal(persist(local,session),true)
  assert.equal(local.value,next)
  assert.equal(session.value,next)
}
{
  const local=store(previous), session=store(previous,true)
  assert.equal(persist(local,session),false)
  assert.equal(local.value,previous,'failed session clear must leave preferred pending draft untouched')
  assert.equal(session.value,previous)
}
{
  const local=store(previous,true), session=store(previous)
  assert.equal(persist(local,session),false)
  assert.equal(local.value,previous)
  assert.equal(session.value,next)
}
for(const blockedKind of ['local','session'] as const){
  const local=store(blockedKind==='local'?null:previous,blockedKind==='local')
  const session=store(blockedKind==='session'?null:previous,blockedKind==='session')
  assert.equal(persist(local,session),true,'an absent readable mirror cannot resurrect a request')
}
for(const kind of ['local','session'] as const){
  const local=store(previous), session=store(previous)
  const divergent=JSON.stringify([...orders,{id:'unknown-order',checkoutRequestId:'unknown-request'}])
  const target=kind==='local'?local:session
  target.value=divergent
  assert.equal(persist(local,session),false)
  assert.equal(target.value,divergent)
  assert.equal((kind==='local'?session:local).value,previous)
}
assert.equal(persist(store(null),store(null)),false)
{
  const local=store(previous), session=store(previous)
  assert.equal(persistRefusedCheckoutDraft({key:'orders',previous,next,local:()=>local,session:()=>{throw new Error('blocked')}}),false)
  assert.equal(local.value,previous)
  session.getItem=()=>{throw new Error('unreadable')}
  assert.equal(persist(local,session),false)
  assert.equal(local.value,previous)
}
{
  const local=store(previous), session=store(previous)
  session.setItem=()=>{session.value=next;local.value='changed by another tab'}
  assert.equal(persist(local,session),false)
  assert.equal(local.value,'changed by another tab')
  assert.equal(session.value,next)
}
console.log('PASS session-first refusal persistence, both partial failures, readable-null fallback, divergent mirrors and inaccessible storage')
