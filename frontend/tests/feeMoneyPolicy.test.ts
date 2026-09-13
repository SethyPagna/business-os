import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { nativeChangeAmounts, MoneyPrecisionError } from '../src/utils/moneyPrecision.ts'
import { createFee, normalizeFeeCreateBody, prepareFeeCreatePayload, getPendingFeeCreate, pendingFeeCreateStorageKey, FeeCreatePendingRequestError, type FeePayload } from '../src/api/feesTransport.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, getSyncServerUrl, setSyncServerUrl } from '../src/api/http.ts'

const source = fs.readFileSync(new URL('../../cloudflare/src/routes/fees.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const functions = ['round2','toNumber','feeMoneyVersion','feeMoney'].map(name => {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))
  assert.ok(match)
  return stripTypeScriptTypes(match[0])
}).join('\n')
const backend = new Function('nativeChangeAmounts', `${functions}; return body => {const version=feeMoneyVersion(body); return { amount_usd:feeMoney(body,'usd',version),amount_khr:feeMoney(body,'khr',version)}}`)(nativeChangeAmounts)
const base: FeePayload = { fee_type:'expense', label:'Original', amount_usd:1, amount_khr:20.49, fee_date:'2026-09-13', branch_id:2, sale_id:null, delivery_contact_id:null, notes:null }
const legacy = normalizeFeeCreateBody(base)
assert.equal(legacy.amount_khr,20.49)
assert.equal(Object.hasOwn(legacy,'fee_money_version'),false)
for (const [usd,khr] of [['1.004999','20.499999'],['1.005','20.5'],['1.005001','20.500001'],['10.075','0'],['0','0.5'],['0.01','0.000000000000000000000001']]) {
  const input = {...base,fee_money_version:1,amount_usd:usd,amount_khr:khr} as unknown as FeePayload
  const normalized = normalizeFeeCreateBody(input)
  assert.deepEqual({amount_usd:normalized.amount_usd,amount_khr:normalized.amount_khr},backend(input),'actual frontend/backend helpers agree')
}
for (const field of ['amount_usd','amount_khr']) for (const value of [null,'',' ',true,{},NaN,Infinity,'-0.000000001','1e25','100000000000.0001']) {
  const input={...base,fee_money_version:1,[field]:value} as unknown as FeePayload
  assert.throws(()=>normalizeFeeCreateBody(input),MoneyPrecisionError)
  assert.throws(()=>backend(input))
}
for (const version of [0,2,null,'1',false]) {
  const input={...base,fee_money_version:version} as unknown as FeePayload
  assert.throws(()=>normalizeFeeCreateBody(input),MoneyPrecisionError)
  assert.throws(()=>backend(input))
}
assert.equal(normalizeFeeCreateBody({fee_money_version:1,amount_khr:20}).amount_usd,0)
assert.throws(()=>normalizeFeeCreateBody({fee_money_version:1,amount_usd:0.0049,amount_khr:0.49}),MoneyPrecisionError)

const items=new Map<string,string>()
const storage={getItem:(key:string)=>items.get(key)??null,setItem:(key:string,value:string)=>{items.set(key,value)},removeItem:(key:string)=>{items.delete(key)},clear:()=>items.clear(),key:(i:number)=>[...items.keys()][i]??null,get length(){return items.size}}
// Simulate a valid pre-upgrade pending envelope with a different property order.
const oldBody=Object.fromEntries(Object.entries(legacy).reverse())
const oldEnvelope=JSON.stringify({actor_id:'7',client_request_id:'legacy-frozen-0001',body:oldBody})
storage.setItem(pendingFeeCreateStorageKey(7),oldEnvelope)
assert.equal(JSON.stringify(getPendingFeeCreate(7,storage)?.body),JSON.stringify(oldBody),'read returns stored body, never normalized replacement')
assert.equal(storage.getItem(pendingFeeCreateStorageKey(7)),oldEnvelope,'read never rewrites storage')
const retry=prepareFeeCreatePayload(oldBody,7,storage)
assert.deepEqual(retry,{...oldBody,client_request_id:'legacy-frozen-0001'})
assert.throws(()=>prepareFeeCreatePayload({...base,fee_money_version:1},7,storage),FeeCreatePendingRequestError,'fresh policy cannot borrow old identity')
assert.equal(storage.getItem(pendingFeeCreateStorageKey(7)),oldEnvelope)
const capped = normalizeFeeCreateBody({...base,notes:'x'.repeat(1999)+' '+'end'})
assert.equal(capped.notes?.length,2000)
assert.ok(capped.notes?.endsWith(' '),'original trim-then-cap can leave trailing whitespace')
const cappedEnvelope=JSON.stringify({actor_id:'9',client_request_id:'legacy-capped-0001',body:capped})
storage.setItem(pendingFeeCreateStorageKey(9),cappedEnvelope)
assert.equal(JSON.stringify(getPendingFeeCreate(9,storage)?.body),JSON.stringify(capped),'valid capped legacy text is never re-normalized or rejected')
assert.deepEqual(prepareFeeCreatePayload(capped,9,storage),{...capped,client_request_id:'legacy-capped-0001'})
assert.equal(storage.getItem(pendingFeeCreateStorageKey(9)),cappedEnvelope)

const oldWindow=globalThis.window,oldFetch=globalThis.fetch,oldUrl=getSyncServerUrl()
const fixture=Object.assign(new EventTarget(),{sessionStorage:storage,localStorage:storage,location:{origin:'https://fee-policy.test',hostname:'fee-policy.test'},setTimeout})
try {
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:fixture})
  setSyncServerUrl('https://fee-policy.test')
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  const payload={...base,fee_money_version:1 as const,amount_usd:1.005,amount_khr:20.5}
  const attempts:string[]=[]
  globalThis.fetch=async (_input,init)=>{
    attempts.push(String(init?.body))
    assert.ok(getPendingFeeCreate(8),'persistence precedes network')
    throw new TypeError('Failed to fetch after the server may have committed')
  }
  await assert.rejects(createFee(payload,8),(error:any)=>error.outcome==='unknown')
  const pending=getPendingFeeCreate(8)!
  assert.equal(pending.body.fee_money_version,1)
  assert.equal(pending.body.amount_usd,1.01)
  assert.equal(pending.body.amount_khr,21)
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  globalThis.fetch=async (_input,init)=>{
    attempts.push(String(init?.body))
    return new Response(JSON.stringify({fee:{...pending.body,id:81,created_by:8,created_by_name:'Tester',created_at:'2026-09-13T01:00:00Z',updated_at:'2026-09-13T01:00:00Z'}}),{status:200,headers:{'Content-Type':'application/json'}})
  }
  const receipts=await Promise.all([createFee(pending.body,8),createFee(pending.body,8)])
  assert.equal(receipts[0].fee.id,81)
  assert.equal(receipts[1].fee.id,81)
  assert.equal(attempts.length,2,'double click shares the retry transport request')
  assert.equal(attempts[0],attempts[1],'version and frozen money survive exact lost-ack retry')
  assert.equal(getPendingFeeCreate(8),null)
  assert.equal(storage.getItem(pendingFeeCreateStorageKey(7)),oldEnvelope,'other legacy request remains untouched')
} finally {
  globalThis.fetch=oldFetch
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:oldWindow})
  setSyncServerUrl(oldUrl)
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
}
console.log('PASS fee policy actual helper parity, raw invalids, immutable legacy storage and v1 lost-ack/double-click transport')
