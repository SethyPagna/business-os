const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const calls = []
let branch
function load(name) {
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname,'../../frontend/src/api',name),'utf8')
  new Function('exports','require','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module.exports, id => {
    if (id === './http.ts') return { route: (_key, online) => online(), apiFetch: async (_method,path,body) => { calls.push({path,body}); return { success:true } } }
    if (id === './requestIds.ts') return { ensureClientRequestId: body => ({...body,client_request_id:body.client_request_id || 'capability-test-key'}) }
    if (id === '../utils/deviceInfo.ts') return { getClientDeviceInfo: () => ({device_name:'fixture'}) }
    if (id === './branchTransport.ts') return branch
    if (id === '../utils/syncProblemLifecycle.ts') return { dispatchResolvedSyncError: () => {} }
    if (id === './query.ts' || id === './expectedUpdatedAt.ts') return {}
    throw new Error(`Unexpected dependency ${id}`)
  },module)
  return module.exports
}
async function main() {
  branch = load('branchTransport.ts')
  const inventory = load('inventoryWriteTransport.ts')
  const original = {productId:1,quantity:2,fromBranchId:1,toBranchId:2,reason:'restock'}
  for (const api of [branch.transferStock,branch.transferStockBulk,inventory.transferInventoryStock]) {
    for (const saved of [false,true]) {
      const body = {...original,items:[original],transfer_provenance_version:0,...(saved ? {client_request_id:'saved-key'} : {})}
      await api(body)
      assert.equal(calls.at(-1).body.transfer_provenance_version,1)
      assert.equal(body.transfer_provenance_version,0,'caller frozen body is not mutated')
      if(saved) assert.equal(calls.at(-1).body.client_request_id,'saved-key')
    }
  }
  const run = branch.prepareTransferRun(7,[{bulk:false,body:original},{bulk:true,body:{...original,items:[original]}}])
  for(const request of run.requests) assert.equal(request.body.transfer_provenance_version,1)
  const rows = new Map()
  const store = {getItem:key=>rows.get(key) ?? null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}
  branch.saveTransferRun(7,run,store)
  await branch.executeTransferRun(branch.loadTransferRun(7,store),next=>branch.saveTransferRun(7,next,store))
  const inv = inventory.prepareInventoryTransfer(7,original,{kind:'submit',original,productName:'Tea'})
  inventory.saveInventoryTransfer(7,inv,store)
  await inventory.executeInventoryTransfer(inventory.loadInventoryTransfer(7,store),next=>inventory.saveInventoryTransfer(7,next,store))
  assert(calls.every(call=>call.body.transfer_provenance_version===1))
  console.log('PASS direct/saved single/bulk/inventory requests and reloaded runs carry v1 capability without changing intent keys or caller bodies')
}
main().catch(error=>{console.error(error);process.exitCode=1})
