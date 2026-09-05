import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = fs.readFileSync(path.join(root, 'src/components/sales/Sales.tsx'), 'utf8')
const start = source.indexOf('  const handleBulkStatusUpdate = async')
const end = source.indexOf('  const exportVisibleSales =', start)
const handler = ts.transpileModule(`${source.slice(start,end)}; return handleBulkStatusUpdate`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const selected = [{id:1,sale_status:'awaiting_payment',updated_at:'v1'},{id:2,sale_status:'completed',updated_at:'v2'}]
const storage = new Map<string,string>()
let calls: Record<string,unknown>[] = [], notices: string[] = [], selection: unknown, loads=0, historyLoads=0, reject=false
let statusPrompt: unknown
const frozen = {current:[] as unknown[]}
const context = {
  selectedSales:selected, canChangeSaleStatus:true, bulkStatusInFlightRef:{current:false}, bulkStatusSelectionRef:frozen, bulkStatusSaving:'',
  beginSingleAction:()=>true, finishSingleAction:()=>{}, setCancelPrompt:()=>{}, setStatusPrompt:(value:unknown)=>{statusPrompt=value},
  translateOr:(_key:string,fallback:string)=>fallback, getStatusLabel:(value:string)=>value, transitionMovesStock:()=>false, t:()=>'', setBulkStatusSaving:()=>{},
  updateSalesBulkStatus:async(payload:Record<string,unknown>)=>{calls.push(payload);if(reject)throw Error('stale');return {changedCount:1,unchangedCount:1}},
  setSelectedIds:(value:unknown)=>{selection=value}, loadSales:async()=>{loads++},actionHistory:{refreshServerItems:async()=>{historyLoads++}},
  notify:(value:string)=>{notices.push(value)},getErrorMessage:(error:Error)=>error.message,
  sessionStorage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},
  window:{dispatchEvent:()=>{}},CustomEvent:class { constructor(_name:string,_payload:unknown){} },crypto:globalThis.crypto,
  pendingBulkRequest:null as Record<string,unknown>|null,
  savePendingBulkRequest:(request:Record<string,unknown>|null)=>{
    context.pendingBulkRequest=request
    if(request) storage.set('pending',JSON.stringify(request)); else storage.delete('pending')
  },
}
const run = async(status:string,extra?:Record<string,unknown>|null,confirmed?:boolean,retryOriginal?:boolean) => new Function(...Object.keys(context),handler)(...Object.values(context))(status,extra,confirmed,retryOriginal)
await run('completed')
assert.ok(statusPrompt);assert.equal(calls.length,0)
selected[0].updated_at='background-refresh'
await run('completed',{skip_stock:true},true)
assert.equal(calls.length,1);assert.equal(calls[0].skip_stock,true)
assert.equal((calls[0].items as Array<{expected_updated_at:string}>)[0].expected_updated_at,'v1')
assert.equal(loads,1);assert.equal(historyLoads,1)
assert.ok(selection instanceof Set && selection.size===0)
assert.match(notices.at(-1)!,/Updated 1 sales; 1 unchanged/)
console.log('PASS confirmation freezes displayed states; one request retains skip; exact counts and one refresh')

reject=true;selection='retained';loads=0;historyLoads=0;calls=[]
await run('completed',{skip_stock:true},true)
const retryId=calls[0].client_request_id
const originalBody=JSON.stringify(calls[0])
// Normal reopen after websocket refresh must not create another request.
selected[0].sale_status='completed';selected[0].updated_at='committed-v3'
await run('awaiting_delivery')
assert.equal(calls.length,1)
// Simulate reload (only persisted original body survives), with no selection.
context.pendingBulkRequest=JSON.parse(storage.get('pending')!)
selected.splice(0)
await run('completed',null,true,true)
assert.equal(calls[1].client_request_id,retryId)
assert.equal(JSON.stringify(calls[1]),originalBody)
assert.equal(selection,'retained');assert.equal(loads,0);assert.equal(historyLoads,0)
console.log('PASS lost response + refreshed states + normal reopen + reload retain exact original request and id')

context.savePendingBulkRequest(null);calls=[];statusPrompt=null
selected.push(...Array.from({length:50},(_,id)=>({id:id+1,sale_status:'completed',updated_at:'v1'})))
await run('awaiting_delivery')
assert.equal(calls.length,0);assert.equal(statusPrompt,null);assert.match(notices.at(-1)!,/at most 25/)
selected.splice(25)
await run('awaiting_delivery')
assert.ok(statusPrompt);assert.equal(calls.length,0)
console.log('PASS 50-row selection blocked before confirmation; 25 rows can confirm; no silent chunking')

const transport=fs.readFileSync(path.join(root,'src/api/salesTransport.ts'),'utf8')
assert.match(transport,/navigator.onLine === false/)
assert.match(transport,/route\('sales:bulkStatus',[^\n]*null, true\)/)
assert.doesNotMatch(source.slice(start,end),/pushAction|runConcurrentTasks|updateSaleStatus\(/)
const history=fs.readFileSync(path.join(root,'src/utils/actionHistory.ts'),'utf8')
assert.match(history,/expected_generation: payload.generation/)
assert.match(history,/navigator.onLine === false/)
for(const language of ['en','km']) {
  const labels=JSON.parse(fs.readFileSync(path.join(root,`src/lang/${language}.json`),'utf8'))
  for(const key of ['sale_bulk_status_result','sale_bulk_history_summary','sale_bulk_history_details']) assert.ok(labels[key])
}
console.log('PASS online-only transport, server replay generation, no duplicate closure/history, EN/KM strings')

// Execute actual transport and actual cache functions, with a warm history cache.
const http=fs.readFileSync(path.join(root,'src/api/http.ts'),'utf8')
const cacheCode=http.slice(http.indexOf('export function cacheGet('),http.indexOf('// Y18:'))
const cache=new Function(ts.transpileModule(`const _cache={}; const CACHE_TTL=20000; ${cacheCode.replace(/export /g,'')}; return {cacheGet,cacheSet,cacheInvalidate}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)()
cache.cacheSet('actionHistory:get:sales',[])
const transportCode=transport.slice(transport.indexOf('export async function updateSalesBulkStatus'),transport.indexOf('export function createSaleWithoutWriteDedupe'))
const write=new Function('route','apiFetch','cacheInvalidate','navigator',ts.transpileModule(`${transportCode.replace('export ','')}; return updateSalesBulkStatus`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(async(_key:string,fn:()=>unknown)=>fn(),async()=>({actionHistoryId:7}),cache.cacheInvalidate,{onLine:true})
await write({client_request_id:'test',items:[],target_status:'completed'})
assert.equal(cache.cacheGet('actionHistory:get:sales'),null)
console.log('PASS actual bulk transport invalidates warm actionHistory cache before resolving')

// Execute the production persistence hooks, not a signature-only test shim.
const persistenceSource=source.slice(source.indexOf('  const bulkRetryKey ='),source.indexOf('  const aliveRef ='))
const persistenceCode=ts.transpileModule(`${persistenceSource}; return {pendingBulkRequest,savePendingBulkRequest}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const mount=(actor:number,unavailable=false)=>new Function('user','useState','useRef','useMemo','sessionStorage',persistenceCode)(
  {id:actor},(initial:unknown)=>[initial,()=>{}],(initial:unknown)=>({current:initial}), (fn:()=>unknown)=>fn(),
  unavailable ? {getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}} : context.sessionStorage,
)
const persistedRequest=JSON.parse(originalBody)
mount(7).savePendingBulkRequest(persistedRequest)
assert.deepEqual(mount(7).pendingBulkRequest,persistedRequest)
assert.equal(mount(8).pendingBulkRequest,null)
mount(7).savePendingBulkRequest(null)
assert.equal(mount(7).pendingBulkRequest,null)
assert.equal(mount(7,true).pendingBulkRequest,null)
assert.doesNotThrow(()=>mount(7,true).savePendingBulkRequest(persistedRequest))
for(const language of ['en','km']) {
  const labels=JSON.parse(fs.readFileSync(path.join(root,`src/lang/${language}.json`),'utf8'))
  for(const key of ['sale_bulk_limit','sale_bulk_pending','sale_bulk_retry','sale_bulk_discard','sale_bulk_discard_warning']) assert.ok(labels[key])
}
assert.match(source,/handleBulkStatusUpdate\(pendingBulkRequest.target_status, null, true, true\)/)
assert.match(source,/window.confirm\(translateOr\('sale_bulk_discard_warning'/)
console.log('PASS real persistence hooks restore full request after remount, isolate actor, discard and tolerate storage failures; EN/KM retry UX')
