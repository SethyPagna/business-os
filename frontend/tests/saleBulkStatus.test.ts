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
}
const run = new Function(...Object.keys(context),handler)(...Object.values(context)) as (status:string,extra?:Record<string,unknown>|null,confirmed?:boolean)=>Promise<void>
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
await run('completed',{skip_stock:true},true)
assert.equal(calls[1].client_request_id,retryId)
assert.equal(selection,'retained');assert.equal(loads,0);assert.equal(historyLoads,0)
console.log('PASS rejection retains selection; explicit retry reuses stable id without optimistic changes')

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
