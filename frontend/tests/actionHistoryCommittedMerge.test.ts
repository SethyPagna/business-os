import assert from 'node:assert/strict'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createRequire } from 'node:module'
import { createHarness, type MemoryNode } from './mountedComponentHarness.ts'

const ssr = (import.meta as {env?:{SSR?:boolean}}).env?.SSR
let useActionHistory: typeof import('../src/utils/actionHistory.ts').useActionHistory
if (ssr) ({useActionHistory} = await import('../src/utils/actionHistory.ts'))

export function ReceiptHost(props: Record<string, any>) {
  const history = useActionHistory({ scope:'products',user:props.user,notify:props.notify })
  const button=(name:string,action:()=>unknown)=>createElement('button',{'aria-label':name,onClick:action},name)
  return createElement('div',null,button('load',history.requestServerItems),button('push',()=>history.pushAction(props.entry)),
    button('undo',()=>history.undo()),button('redo',()=>history.redo()),button('check',()=>history.checkReceipt(91)),
    createElement('output',{'data-state':''},JSON.stringify({undo:history.canUndo,redo:history.canRedo,busy:history.busy,items:history.serverItems})))
}

if (!ssr) {
  const source=readFileSync(new URL('../src/utils/actionHistory.ts',import.meta.url),'utf8')
  const helper=source.match(/export function pendingGroupRedo[\s\S]*?\r?\n}/)?.[0]
  assert.ok(helper)
  const pendingGroupRedo=new Function(`${stripTypeScriptTypes(helper.replace('export ',''))};return pendingGroupRedo`)()
  const harness=await createHarness()
  const operation=`product-merge-group-${'a'.repeat(64)}`
  const descriptor={version:1 as const,history_id:91,group_operation_id:operation,expected_generation:1}
  const pointer={applier:'product.merge.group',merge_version:3,generation:1,operation_id:operation}
  const user={id:1,username:'owner',role_code:'cashier',role_permissions:{products:true}}
  let phase=0,mutations=0,failures=0
  const calls:{updates:unknown[][];redo:unknown[][]}={updates:[],redo:[]}
  const notices:string[]=[]
  const row=()=>({id:91,label:'Saved group',status:phase===0?'redoable':phase===1?'recorded':'undoable',reversible:phase!==1,
    server_replayable:phase!==1,redo_payload:{...pointer,generation:phase===0?1:2},...(phase===1?{pending_redo:descriptor}:{})})
  const refusal=()=>Object.assign(new Error('Redo was saved. Do not repeat the merge.'),{status:409,code:'merge_group_redo_committed',params:{...descriptor,committed:true}})
  const doubles={'api/actionHistoryTransport.ts':{
    getActionHistory:async()=>({items:[row()]}),getActionHistoryUsers:async()=>[],createActionHistory:async()=>({id:91}),
    updateActionHistory:async(...args:unknown[])=>{calls.updates.push(args);return {success:true}},
    undoActionHistory:async()=>({success:true,applied:false}),
    redoActionHistory:async(...args:unknown[])=>{calls.redo.push(args);if(phase===0){phase=1;throw refusal()}phase=2;return {success:true,applied:true,processed_children:0,item:row()}},
  }}
  const entry={label:'Group',undo:()=>{},redo:()=>{mutations++},redo_payload:pointer,undo_payload:pointer}
  const mount=()=>harness.mount({component:'../tests/actionHistoryCommittedMerge.test.ts',exportName:'ReceiptHost',props:{user,entry,notify:(s:string)=>notices.push(s)},app:{page:'products'},doubles})
  const press=(surface:any,name:string)=>surface.click(surface.find((node:MemoryNode)=>node.tagName==='BUTTON'&&node.getAttribute('aria-label')===name,name))
  const state=(surface:any)=>JSON.parse(surface.find((node:MemoryNode)=>node.getAttribute('data-state')!==null,'state').textContent)
  async function check(name:string,run:()=>Promise<void>){try{await run();console.log(`PASS ${name}`)}catch(error){failures++;console.error(`FAIL ${name}`,error)}}
  try {
    await check('committed live redo never marks failed or invokes closure; exact receipt survives reload',async()=>{
      let surface=await mount()
      await press(surface,'load');await press(surface,'push');await surface.waitFor(()=>state(surface).undo,'push')
      await press(surface,'undo');await surface.waitFor(()=>state(surface).redo,'undo')
      await press(surface,'redo');await surface.waitFor(()=>state(surface).items.some((item:any)=>item.pending_redo),'committed descriptor')
      assert.deepEqual(calls.updates,[]);assert.equal(mutations,0);assert.equal(state(surface).redo,false)
      assert.deepEqual(calls.redo[0],[91,{require_applied:true,expected_generation:1}])
      await surface.unmount();surface=await mount();await press(surface,'load')
      await surface.waitFor(()=>state(surface).items.some((item:any)=>item.pending_redo),'reloaded descriptor')
      await press(surface,'check');await surface.waitFor(()=>state(surface).items.some((item:any)=>item.status==='undoable'),'receipt checked')
      assert.deepEqual(calls.redo[1],[91,{require_applied:true,expected_generation:1}]);assert.equal(mutations,0);assert.deepEqual(calls.updates,[])
      await surface.unmount()
    })
    await check('malformed or foreign descriptors cannot become receipt requests',async()=>{
      for(const changed of [{...descriptor,history_id:92},{...descriptor,expected_generation:-1},{...descriptor,version:2},{...descriptor,extra:true}])assert.equal(pendingGroupRedo(changed,91),null)
      assert.deepEqual(pendingGroupRedo(descriptor,91),descriptor)
      assert.ok(notices.some(s=>s.includes('Redo was saved')))
    })
    await check('actor changed before receipt dispatch sends no request',async()=>{
      phase=1
      const surface=await mount();await press(surface,'load');await surface.waitFor(()=>state(surface).items.some((item:any)=>item.pending_redo),'pending')
      const previous=window.localStorage.getItem('businessos_user'),before=calls.redo.length
      window.localStorage.setItem('businessos_user',JSON.stringify({id:2,username:'other'}))
      try{await press(surface,'check');assert.equal(calls.redo.length,before)}finally{if(previous===null)window.localStorage.removeItem('businessos_user');else window.localStorage.setItem('businessos_user',previous);await surface.unmount()}
    })
    await check('real Bar shows a separate receipt check for recorded rows in both languages',async()=>{
      const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
      const {transformSync}=await import('esbuild')
      const code=transformSync(readFileSync(new URL('../src/components/shared/ActionHistoryBar.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code
      const mod={exports:{} as any}
      const shim=(id:string):unknown=>id.includes('LazyPortalMenu')?{__esModule:true,default:({content}:any)=>content({closeMenu:()=>{}})}:id.includes('AppSelect')||id.includes('history.js')?{__esModule:true,default:()=>null}:id.includes('formatters')?{fmtDateTime24:String}:require(id)
      new Function('require','module','exports',code)(shim,mod,mod.exports)
      for(const language of ['en','km']) {
        const pack=JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`,import.meta.url),'utf8'))
        const render=(pending:unknown,status='recorded',reversible=false)=>renderToStaticMarkup(React.createElement(mod.exports.default,{t:(key:string)=>pack[key],history:{undo:()=>{},redo:()=>{},checkReceipt:()=>{},serverItems:[{id:91,label:'Saved',status,reversible,server_replayable:false,pending_redo:pending}]}}))
        assert.ok(render(descriptor).includes(pack.history_check_saved_redo))
        assert.ok(!render({...descriptor,history_id:92}).includes(pack.history_check_saved_redo))
        assert.ok(!render({...descriptor,extra:true}).includes(pack.history_check_saved_redo))
        assert.ok(!render(descriptor,'undoable').includes(pack.history_check_saved_redo))
        assert.ok(!render(descriptor,'recorded',true).includes(pack.history_check_saved_redo))
      }
    })
  } finally {await harness.close()}
  if(failures)process.exitCode=1
}
