import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beginKeyedAction, finishKeyedAction } from '../src/utils/actionGuards.ts'
import { withLoaderTimeout, beginTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import * as branchErrors from '../src/api/branchRuleErrors.ts'
import * as outcomes from '../src/utils/productCreateOutcome.ts'
const ts = createRequire(import.meta.url)('typescript')
const read = (file: string) => readFileSync(new URL(file, import.meta.url),'utf8')
function extract(source: string, name: string, dependencies: Record<string, unknown>): any {
  const tree = ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let found: any
  const visit = (node: any): void => { if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.text === name) found=node; if (!found) ts.forEachChild(node,visit) }
  visit(tree); assert(found, name)
  const declaration = ts.isVariableDeclaration(found) ? `const ${found.getText(tree)}` : found.getText(tree)
  const compiled = ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  return new Function(...Object.keys(dependencies),'exports',compiled+`;return ${name}`)(...Object.values(dependencies),{})
}
const row = { id: 41, section:'products', action_type:'create', entity_type:'product', status:'open' }
const approved = {success:true,data:{...row,status:'approved'}}
let source = read('../src/components/review/ReviewQueue.tsx')
if(process.env.PRODUCT_REVIEW_WRONG==='timeout_release') source=source.replace('await reconcile()','finishKeyedAction(actionRef, pendingId); await reconcile()')
const transport = read('../src/api/reviewQueueTransport.ts')
function deferred() { let resolve!: (value:any)=>void, reject!: (error:unknown)=>void; const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject} }
const flush=()=>new Promise(resolve=>setTimeout(resolve,0))
function fixture(send: () => Promise<unknown>, get: () => Promise<unknown> = async()=>({data:row})) {
  const effects={notices:[] as unknown[][],events:[] as string[],locks:{current:new Set<string>()},loads:0,busy:null as unknown}
  let version=1, currentPost=send, beforeDispatch: (()=>void)|undefined
  const captureActorReadScope=()=>({authority:String(version),channel:'review',revision:'0'})
  const assertActorReadScope=(scope:any)=>{if(scope.authority!==String(version))throw Object.assign(Error('Actor changed'),{code:'stale_read_scope'})}
  const cacheInvalidate=(key:string)=>effects.events.push('invalidate:'+key)
  const dependencies={
    route: async (_channel:string,run:()=>Promise<unknown>)=>{beforeDispatch?.();return run()},
    apiFetch:async(method:string,url:string)=>{effects.events.push(method+':'+url);return method==='POST'?currentPost():get()},
    cacheInvalidate,
    assertActorSessionDispatchAllowed:process.env.PRODUCT_REVIEW_WRONG==='skip_leaf_guard'?()=>{}:assertActorReadScope,
    assertActorReadScope:process.env.PRODUCT_REVIEW_WRONG==='skip_leaf_guard'?()=>{}:assertActorReadScope,
  }
  const approveProductCreatePendingAction=extract(transport,'approveProductCreatePendingAction',dependencies)
  const reconcileProductCreatePendingAction=extract(transport,'reconcileProductCreatePendingAction',dependencies)
  const productReviewEpochRef={current:0}
  const shared={canReview:true, actionRef:effects.locks, beginKeyedAction, finishKeyedAction, productReviewEpochRef,
    setBusyId:(value:any)=>{effects.busy=typeof value==='function'?value(effects.busy):value},
    approvePendingAction:()=>{effects.events.push('generic-POST');return currentPost()},
    approveProductCreatePendingAction,reconcileProductCreatePendingAction,cacheInvalidate,captureActorReadScope,
    isActorReadScopeCurrent:(scope:any)=>process.env.PRODUCT_REVIEW_WRONG==='skip_effect_guard'||scope.authority===String(version),
    withLoaderTimeout, REVIEW_MUTATION_TIMEOUT_MS:5,
    notify:(...args:unknown[])=>effects.notices.push(args), tr:(key:string)=>key, load:async()=>{effects.loads++}, ...branchErrors,...outcomes,
    ...(process.env.PRODUCT_REVIEW_WRONG==='weak_approval'?{isConfirmedProductCreateApproval:(_id:number,response:any)=>response?.success===true}:{}),
  }
  const handleProductCreateApprove=extract(source,'handleProductCreateApprove',shared)
  const run=extract(source,'handleApprove',{...shared,handleProductCreateApprove})
  return {run,effects,changeActor:()=>{version++},unmount:()=>{productReviewEpochRef.current++},beforeDispatch:(action:()=>void)=>{beforeDispatch=action},setPost:(action:()=>Promise<unknown>)=>{currentPost=action}}
}
let failed=0
async function check(name:string,fn:()=>Promise<void>|void) { try {await fn();console.log('PASS '+name)}catch(error){failed++;console.error('FAIL '+name,error)} }
await check('actual product approval requires same ID approved product-create response',async()=>{
  for(const response of [{success:true,data:row},{success:true,pending:true,data:approved.data},{success:true,pendingActionId:41},{success:true},
    {success:true,data:{...approved.data,id:42}},{success:true,data:{...approved.data,entity_type:'variant'}},{success:false,data:approved.data}]) {
    const f=fixture(async()=>response)
    await f.run(row)
    assert.equal(f.effects.notices.filter(item=>item[1]==='success').length,0,JSON.stringify(response))
    assert(f.effects.events.indexOf('invalidate:review')<f.effects.events.indexOf('GET:/api/review/41'))
    assert.equal(f.effects.notices[0][0],'product_create_approval_unconfirmed')
  }
  for(const response of [approved,{...approved,replayed:true}]){
    const f=fixture(async()=>response);await f.run(row)
    assert.deepEqual(f.effects.notices,[['pending_action_approved','success']]);assert.equal(f.effects.loads,1)
    assert.equal(f.effects.events.some(event=>event.startsWith('GET:')),false)
  }
})
await check('loader timeout retains physical guard while exact GET open does not prove completion',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise)
  await f.run(row);assert.equal(f.effects.busy,41);assert(f.effects.locks.current.has('41'))
  await f.run(row)
  assert.equal(f.effects.events.filter(event=>event.startsWith('POST:')).length,1)
  assert(f.effects.events.includes('GET:/api/review/41'));assert(f.effects.events.includes('invalidate:products'))
  pending.resolve(approved);await flush()
  assert.equal(f.effects.locks.current.size,0);assert.equal(f.effects.busy,null)
  assert.equal(f.effects.notices.filter(item=>item[1]==='success').length,1)
})
await check('unknown rejection reconciles exact approved/rejected/open/mismatch/missing/failed row without another POST',async()=>{
  for(const result of [{data:approved.data},{data:{...row,status:'rejected'}},{data:row},{data:{...approved.data,id:42}},null,Error('GET unavailable')] as any[]){
    const f=fixture(async()=>{throw Object.assign(Error('The product may have been created.'),{code:'product_create_outcome_unknown',status:503,outcome:'unknown',action:'refresh_before_create'})},async()=>{if(result instanceof Error)throw result;return result})
    await f.run(row)
    assert.equal(f.effects.events.filter(event=>event.startsWith('POST:')).length,1)
    assert.equal(f.effects.notices.filter(item=>item[1]==='success').length,result?.data===approved.data?1:0)
    if(result?.data?.status==='rejected')assert.deepEqual(f.effects.notices,[['pending_action_rejected','info']])
    assert(f.effects.events.indexOf('invalidate:review')<f.effects.events.indexOf('GET:/api/review/41'))
  }
})
await check('same row retry after settled failure stays keyed approval; no new create',async()=>{
  const f=fixture(async()=>{throw Error('lost acknowledgement')})
  await f.run(row);f.setPost(async()=>approved);await f.run(row)
  assert.deepEqual(f.effects.events.filter(event=>event.startsWith('POST:')),['POST:/api/review/41/approve','POST:/api/review/41/approve'])
  assert.equal(f.effects.notices.filter(item=>item[1]==='success').length,1)
})
await check('actor change before leaf dispatch sends zero POST and no callback effects',async()=>{
  const f=fixture(async()=>approved);f.beforeDispatch(f.changeActor)
  await f.run(row)
  assert.deepEqual(f.effects.events,[]);assert.deepEqual(f.effects.notices,[]);assert.equal(f.effects.loads,0)
})
await check('post-dispatch actor changes and unmount suppress old-owner effects even after late success',async()=>{
  for(const unmount of [false,true]){
    const pending=deferred(),f=fixture(()=>pending.promise)
    const run=f.run(row)
    await Promise.resolve();await Promise.resolve()
    if(unmount)f.unmount();else{f.changeActor();f.changeActor()}
    pending.resolve(approved);await run
    assert.deepEqual(f.effects.events,['POST:/api/review/41/approve']);assert.deepEqual(f.effects.notices,[]);assert.equal(f.effects.loads,0)
  }
})
await check('late open reconciliation cannot replace already-confirmed approval',async()=>{
  const pending=deferred(),readPending=deferred(),f=fixture(()=>pending.promise,()=>readPending.promise)
  const run=f.run(row);await new Promise(resolve=>setTimeout(resolve,10))
  pending.resolve(approved);await flush();readPending.resolve({data:row});await run
  assert.deepEqual(f.effects.notices,[['pending_action_approved','success']])
})
await check('inactive destination maps existing union locale key without claiming approval',async()=>{
  const f=fixture(async()=>{throw Object.assign(Error('Choose an active branch'),{code:'receiving_branch_inactive',status:409})})
  await f.run(row);assert.deepEqual(f.effects.notices,[['receiving_branch_inactive','error']])
})
await check('generic and branch approval paths retain existing response policy',async()=>{
  for(const other of [{...row,action_type:'update'},{...row,entity_type:'variant'},{...row,section:'branches',action_type:'update',entity_type:'branch'}]){
    const f=fixture(async()=>({success:true,data:{...other,status:'approved'}}));await f.run(other)
    assert.deepEqual(f.effects.events,['generic-POST']);assert.deepEqual(f.effects.notices,[['pending_action_approved','success']])
  }
})
await check('actual review load ignores response after actor authority changes',async()=>{
  const pending=deferred();let version=1;const effects: string[]=[]
  const run=extract(source,'load',{useCallback:(fn:any)=>fn,captureActorReadScope:()=>({authority:version}),isActorReadScopeCurrent:(scope:any)=>scope.authority===version,
    beginTrackedRequest,isTrackedRequestCurrent,loadRequestRef:{current:0},statusFilter:'open',sectionFilter:'',withLoaderTimeout,REVIEW_LOAD_TIMEOUT_MS:100,
    getPendingActionsRequest:()=>pending.promise,setLoading:()=>effects.push('loading'),setLoadError:()=>effects.push('error'),setRows:()=>effects.push('rows'),setHasLoadedOnce:()=>effects.push('loaded')})
  const result=run();effects.length=0;version++;pending.resolve({data:[row]});await result;assert.deepEqual(effects,[])
})
await check('approval ID is captured before mutable queue data changes',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise)
  const changing={...row}, run=f.run(changing)
  changing.id=99;pending.reject(Error('lost acknowledgement'));await run
  assert(f.effects.events.includes('GET:/api/review/41'))
  assert.equal(f.effects.events.some(event=>event.includes('/99')),false)
  assert.equal(f.effects.locks.current.size,0)
})
if(failed)process.exitCode=1
