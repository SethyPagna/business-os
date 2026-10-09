import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ts from 'typescript'
const memory=new Map<string,string>()
Object.assign(globalThis,{localStorage:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value)},removeItem:(key:string)=>{memory.delete(key)}},sessionStorage:{getItem:()=>null},window:globalThis,document:{visibilityState:'visible',addEventListener:()=>{}},addEventListener:()=>{},dispatchEvent:()=>true})
;(globalThis as unknown as {location:unknown}).location={origin:'https://app.example'}
if(typeof globalThis.CustomEvent==='undefined')Object.assign(globalThis,{CustomEvent:class CustomEvent extends Event{detail:unknown;constructor(type:string,init:{detail:unknown}){super(type);this.detail=init.detail}}})
const root=path.resolve(import.meta.dirname,'../src/utils'),override=process.env.MINIMIZED_WORK_PROVENANCE_SOURCE
const bundle=await build({stdin:{contents:"export * from './minimizedWork.ts'",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:override?[{name:'previous-source-control',setup(b){b.onLoad({filter:/[\\/]minimizedWork\.ts$/},()=>({contents:fs.readFileSync(override,'utf8'),loader:'ts',resolveDir:root}))}}]:[]})
const module={exports:{} as Record<string,any>};new Function('exports','module','require',bundle.outputFiles[0].text)(module.exports,module,createRequire(import.meta.url))
const registry=module.exports
const {STORAGE_KEYS}=await import('../src/constants.ts')
const {readWorkDraft,writeWorkDraft,scopedWorkDraftKey}=await import('../src/utils/workDrafts.ts')
const products=fs.readFileSync(new URL('../src/components/products/Products.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('Products.tsx',products,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let restoreSource='';function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='restoreEdit')restoreSource='const '+node.getText(ast);ts.forEachChild(node,visit)}visit(ast);assert.ok(restoreSource)
function identity(actor:number,org:string,server='https://server-a.example'){memory.set(STORAGE_KEYS.USER,JSON.stringify({id:actor,organization_public_id:org}));memory.set(STORAGE_KEYS.SYNC_SERVER,server)}
for(const change of ['actor','server','organization','logout-newlogin','same-owner','newer-chip','newer-same-key-pending']){
 const org='origin-'+change;identity(11,org)
 const originalStore=scopedWorkDraftKey('minimized_work'),draftKey=scopedWorkDraftKey('product_401')
 writeWorkDraft(draftKey,{name:'PRIVATE ACTOR11',quantity:7});const draftBytes=memory.get(draftKey)
 registry.minimizeWork({key:'edit401',kind:'edit_product',pageId:'products',label:'PRIVATE ACTOR11',payload:{productId:401},draftKey})
 const original=registry.getMinimizedWork().find((entry:any)=>entry.key==='edit401')
 registry.dispatchRestore(original)
 let complete!:(rows:Array<{id:number}>)=>void;const wait=new Promise<Array<{id:number}>>(resolve=>{complete=resolve})
 const productWorkIntentRef={current:{revision:0,modal:null,stockSession:false}},productSaveAuthorityRef={current:{revision:0}}
 const scope={...registry,captureMinimizedWorkRestoreScope:registry.captureMinimizedWorkRestoreScope||(()=>undefined),productWorkIntentRef,productSaveAuthorityRef,disposed:false,can:()=>true,fetchProductsByIds:()=>wait,setSelected:()=>{throw new Error('stale restore must not open')},setFormInitialTab:()=>{},setModal:()=>{},notify:()=>{},tr:(key:string)=>key}
 const js=ts.transpileModule(restoreSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const restore=new Function(...Object.keys(scope),js+';return restoreEdit')(...Object.values(scope))
 const pending=restore(original)
 if(change==='actor')identity(22,org)
 if(change==='server')identity(11,org,'https://server-b.example')
 if(change==='organization')identity(11,org+'-other')
 if(change==='logout-newlogin'){memory.delete(STORAGE_KEYS.USER);registry.getMinimizedWork();identity(22,org+'-new')}
 productSaveAuthorityRef.current.revision++
 const currentStore=scopedWorkDraftKey('minimized_work')
 registry.getMinimizedWork()
 const currentDraft=scopedWorkDraftKey('product_402');writeWorkDraft(currentDraft,{name:'CURRENT'})
 registry.minimizeWork({key:'visible-current',kind:'add_product',pageId:'products',label:'CURRENT VISIBLE',draftKey:currentDraft})
 registry.minimizeWork({key:'pending402',kind:'edit_product',pageId:'products',label:'CURRENT PENDING',payload:{productId:402},draftKey:currentDraft})
 const newer=registry.getMinimizedWork().find((entry:any)=>entry.key==='pending402');registry.dispatchRestore(newer)
 if(change==='newer-chip')registry.minimizeWork({...original,label:'NEWER SAME KEY',payload:{productId:499}})
 if(change==='newer-same-key-pending')registry.dispatchRestore({...original,label:'NEWER PENDING SAME KEY'})
 let notifications=0;const unsubscribe=registry.subscribeMinimizedWork(()=>{notifications++})
 const currentBytes=memory.get(currentStore),currentEntries=JSON.stringify(registry.getMinimizedWork())
 complete([{id:401}]);await pending
 assert.equal(memory.get(draftKey),draftBytes,'original draft bytes preserved: '+change)
 const ownerEntries=readWorkDraft<Array<{key:string;label:string;draftKey:string;payload:{productId:number}}>>(originalStore)?.data||[]
 const ownerChip=ownerEntries.find(entry=>entry.key==='edit401')
 assert.ok(ownerChip,'original owner chip recoverable: '+change)
 assert.equal(ownerChip.label,change==='newer-chip'?'NEWER SAME KEY':'PRIVATE ACTOR11')
 assert.equal(ownerChip.draftKey,draftKey)
 assert.equal(registry.peekPendingRestore('edit_product')?.key,change==='newer-same-key-pending'?'edit401':'pending402','unrelated same-kind pending is preserved: '+change)
 if(change==='newer-same-key-pending')assert.equal(registry.peekPendingRestore('edit_product').label,'NEWER PENDING SAME KEY')
 if(change==='newer-chip')assert.equal(memory.get(currentStore),currentBytes,'newer original-owner chip is not overwritten')
 if(currentStore!==originalStore){assert.equal(memory.get(currentStore),currentBytes,'current persisted registry unchanged: '+change);assert.equal(JSON.stringify(registry.getMinimizedWork()),currentEntries);assert.equal(registry.getMinimizedWork().some((entry:any)=>entry.key==='edit401'),false,'private chip not stolen');assert.equal(notifications,0,'foreign-scope write does not notify current registry')}
 unsubscribe()
}
// Backward-compatible helper calls inherit dispatch provenance without an explicit token.
identity(11,'default-helper');const originalStore=scopedWorkDraftKey('minimized_work')
registry.minimizeWork({key:'old-default',kind:'add_product',pageId:'products',label:'OLD DEFAULT'})
const old=registry.getMinimizedWork()[0];registry.dispatchRestore(old)
identity(22,'default-helper');registry.getMinimizedWork();const currentStore=scopedWorkDraftKey('minimized_work'),before=memory.get(currentStore)
registry.reparkDeniedRestore(old)
registry.dispatchRestore(old)
assert.equal(registry.peekPendingRestore('add_product'),null,'stale DOM entry cannot dispatch into new owner')
assert.equal(memory.get(currentStore),before);assert.equal(readWorkDraft<any[]>(originalStore)?.data[0].key,'old-default')
console.log('PASS actual deferred restore + persisted registry preserves original actor/server/org chips and drafts, current registry and newer pending; default callers retain provenance')
