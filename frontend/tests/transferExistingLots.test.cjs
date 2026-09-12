const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../src/components/branches/TransferModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const moduleExports = {}
new Function('exports', 'require', compile(source))(moduleExports, name => name.includes('batchLabel') ? { batchDisplayLabel: lot => lot.received_at } : {})
const { positiveTransferLots, selectedTransferLot, packTransferLots } = moduleExports
const lot = (id, quantity, received_at = '2026-09-03') => ({ id, quantity, received_at, is_active: 1 })
const product = { id: 7, name: 'Tea', branch_quantity: 12 }
const lots = [lot(71, 5), lot(72, 7, '2026-09-05')]
assert.throws(() => selectedTransferLot(product, lots, undefined, 2), /pick_batch/)
assert.equal(selectedTransferLot(product, lots, 71, 5).batchId, 71, 'explicit earlier date is retained despite later date stock')
assert.throws(() => selectedTransferLot(product, lots, 71, 6), /quantity/)
assert.throws(() => selectedTransferLot({ ...product, branch_quantity: 3 }, lots, 71, 4), /quantity/)
assert.throws(() => selectedTransferLot(product, lots, 99, 1), /pick_batch/)
assert.deepEqual(positiveTransferLots([lot(1,0), lot(2,-1), {...lot(3,1),is_active:0},lot(4,1,null),lot(5,2)]).map(row=>row.id), [5])
const expanded = lots.map(row => selectedTransferLot(product, lots, row.id, row.quantity))
const packed = packTransferLots([...expanded, ...Array.from({length: 401}, (_,i) => ({ productId: i+100, quantity: 1, batchId: i+1000 }))])
assert.equal(packed.flat().length,403)
for (const chunk of packed) { assert.ok(chunk.length <= 200); assert.equal(new Set(chunk.map(row=>String(row.productId))).size,chunk.length) }
assert.deepEqual(packed.flat().filter(row=>row.productId===7).map(row=>row.batchId).sort(),[71,72])

function extract(start, end, context) {
  const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
  return new Function(...Object.keys(context), compile(`${body}; return ${start.match(/const (\w+)/)[1]}`))(...Object.values(context))
}
async function main() {
  let pending, notice
  const context = { savedRun:null,savingBulk:false,retryStorageError:'',fromBranch:'1',toBranch:'2',
    requireCanonicalTransferDirection:()=>true,requireTransferReason:()=>true,selectedEntries:[['7','2']],multiProducts:[product],
    finiteStockAvailable:Number,invalidQuantityText:'quantity',t:key=>key,notify:value=>notice=value,
    rowLots:{7:{branch:'1',authority:{},batches:lots}},selectedLots:{},isActorReadScopeCurrent:()=>true,selectedTransferLot,
    buildPendingTransfer:(scope,items)=>({scope,items}),setPendingTransfer:value=>pending=value }
  let submit = extract('const handleBulkTransfer =', '  /**\n   * The one write path', context)
  submit(); assert.equal(pending,undefined); assert.match(notice,/pick_batch/)
  context.selectedLots[7]=71; submit(); assert.equal(pending.items[0].batchId,71); assert.equal(pending.items[0].quantity,2)
  pending=undefined;context.rowLots[7].branch='2';submit();assert.equal(pending,undefined,'foreign branch lots cannot arm confirmation')
  let readable=true, branch={current:'1'}, generation={current:0}, errors=[]
  const expansionContext = {fromBranch:'1',lotIntentRef:generation,lotBranchRef:branch,aliveRef:{current:true},
    captureActorReadScope:()=>({}),assertActorReadScope:()=>{if(!readable)throw Error('stale')},isActorReadScopeCurrent:()=>readable,
    setPreparingLots:()=>{},withLoaderTimeout:fn=>fn(),getProductBatches:async(id,b)=>{assert.equal(b,1);return {batches:lots}},
    TRANSFER_STOCK_LOAD_TIMEOUT_MS:12000,positiveTransferLots,selectedTransferLot,t:key=>key,notify:error=>errors.push(error),getErrorMessage:(error)=>error.message }
  let expand = extract('const expandEntireBranchLots =', '  // Multi mode:', expansionContext)
  assert.deepEqual((await expand([{productId:7,quantity:12}],[product])).map(row=>row.batchId),[71,72])
  assert.equal(await expand([{productId:7,quantity:13}],[product]),null)
  assert.match(errors.at(-1),/stock_mismatch/)
  expansionContext.getProductBatches=async()=>({batches:[]})
  expand=extract('const expandEntireBranchLots =','  // Multi mode:',expansionContext)
  assert.equal(await expand([{productId:7,quantity:12}],[product]),null);assert.match(errors.at(-1),/no_batches/)
  expansionContext.getProductBatches=async()=>{throw Object.assign(Error('denied'),{status:403})}
  expand=extract('const expandEntireBranchLots =','  // Multi mode:',expansionContext)
  assert.equal(await expand([{productId:7,quantity:12}],[product]),null);assert.equal(errors.at(-1),'denied')
  let resolve; expansionContext.getProductBatches=()=>new Promise(done=>resolve=done)
  expand=extract('const expandEntireBranchLots =','  // Multi mode:',expansionContext)
  const late=expand([{productId:7,quantity:12}],[product]);branch.current='2';generation.current++;resolve({batches:lots})
  assert.equal(await late,null,'late branch result never opens confirmation')
  const transport = { exports: {} }; let requestId=0
  new Function('exports','require','module',compile(fs.readFileSync(path.join(__dirname,'../src/api/branchTransport.ts'),'utf8')))(transport.exports,name=> {
    if(name.includes('requestIds')) return {ensureClientRequestId:body=>({...body,client_request_id:`test-${++requestId}`})}
    if(name.includes('deviceInfo')) return {getClientDeviceInfo:()=>({device_name:'test'})}
    if(name.includes('syncProblemLifecycle')) return {dispatchResolvedSyncError:()=>{}}
    return {}
  },transport)
  const requests=packTransferLots(expanded).map(items=>({bulk:true,body:{fromBranchId:1,toBranchId:2,reason:'restock',items}}))
  let run=transport.exports.prepareTransferRun(9,requests), lost=false, applied=[]
  const bodies = new Map()
  const send=async request=>{
    const body=request.body, json=JSON.stringify(body)
    if(bodies.has(body.client_request_id)) assert.equal(json,bodies.get(body.client_request_id),'retry uses exact immutable lot payload')
    else { bodies.set(body.client_request_id,json); applied.push(body.items[0].batchId) }
    if(body.items[0].batchId===72 && !lost){lost=true;throw Error('lost committed response')}
    return {success:true,transferredCount:1}
  }
  await assert.rejects(transport.exports.executeTransferRun(run,next=>run=next,send),/lost/)
  assert.equal(run.next,1,'completed first lot checkpoint remains durable')
  requests[0].body.items[0].quantity=999
  run=JSON.parse(JSON.stringify(run))
  await transport.exports.executeTransferRun(run,next=>run=next,send)
  assert.deepEqual(applied,[71,72],'lost response never reapplies either existing lot')
  assert.match(source,/max=\{chosenLot \? Math\.min\(Number\(product\.branch_quantity\), Number\(chosenLot\.quantity\)\) : 0\}/)
  assert.match(source,/items: items\.map\(\(\{ productId, quantity, batchId \}\) => \(\{ productId, quantity, batchId \}\)\)/)
  assert.match(source,/value=\{chosenLot\?\.id \?\? ''\}/,'live row selector has no automatic default')
  console.log('PASS explicit existing transfer lots: selected/date/stock bounds, entire branch completeness, unique request packing, actual handlers and late branch reads')
}
main().catch(error=>{console.error(error);process.exitCode=1})
