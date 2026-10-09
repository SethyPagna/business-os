import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createHarness } from './mountedComponentHarness.ts'
const file = process.env.PRODUCT_FORM_AUTHORITY_SOURCE || new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url)
const source = fs.readFileSync(file, 'utf8')
const ast = ts.createSourceFile('ProductForm.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let refusal = '', warning = '', saveSource = ''
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveForm') saveSource = node.getText(ast)
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'canContinueSave') refusal = 'const '+node.getText(ast)
  if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith('saveAuthorityWarning === draftKey')) warning = node.expression.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(refusal && warning, 'actual authority refusal and inline warning must exist')
const harness = await createHarness()
const compile = (text: string) => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText
const container = document.createElement('div'); document.body.appendChild(container)
const root = createRoot(container)
let deny!: () => boolean, alive = true, currentKey = 'A', valid = false, popups = 0
const aliveRef = {get current(){return alive}}, currentFormDraftKeyRef = {get current(){return currentKey}}, saveInFlightRef = {current:true}
const packs = Object.fromEntries(['en','km'].map(lang=>[lang,JSON.parse(fs.readFileSync(new URL('../src/lang/'+lang+'.json',import.meta.url),'utf8'))]))
function Host({draftKey,lang}: {draftKey:string;lang:string}) {
 const [saveAuthorityWarning,setSaveAuthorityWarning]=React.useState<string|null>(null)
 const tr=(key:string)=>packs[lang][key]
 deny=new Function('isSaveAuthorityCurrent','saveInFlightRef','aliveRef','currentFormDraftKeyRef','draftKey','setSaveAuthorityWarning','alert','tr',compile(refusal)+';return canContinueSave')(()=>valid,saveInFlightRef,aliveRef,currentFormDraftKeyRef,draftKey,setSaveAuthorityWarning,()=>{popups++},tr)
 return new Function('React','saveAuthorityWarning','draftKey','tr', 'return '+compile('const view='+warning).replace(/^const view = /,'').trim().replace(/;$/,''))(React,saveAuthorityWarning,draftKey,tr)
}
try {
 for(const lang of ['en','km']) {
  alive=true;currentKey='A';valid=false
  await act(async()=>root.render(React.createElement(Host,{key:lang,draftKey:'A',lang})))
  valid=true
  await act(async()=>assert.equal(deny(),true,'current authority remains allowed'))
  assert.equal(container.textContent,'')
  valid=false
  await act(async()=>assert.equal(deny(),false))
  assert.equal(container.textContent,packs[lang].product_draft_authority_changed,'surviving invalid form visibly warns in '+lang)
  const stale=deny
  await act(async()=>root.render(React.createElement(Host,{key:lang+'B',draftKey:'B',lang})))
  currentKey='B';saveInFlightRef.current=true
  await act(async()=>assert.equal(stale(),false))
  assert.equal(container.textContent,'','old form cannot warn in new actor form')
  assert.equal(saveInFlightRef.current,true,'stale continuation cannot unlock replacement form save')
  alive=false
  await act(async()=>assert.equal(stale(),false))
  assert.equal(container.textContent,'')
 }

 for (const invalidation of ['key','unmount','actor']) for (const boundary of ['confirmation','response','failure']) {
  let finish!: () => void
  const wait=new Promise<void>(resolve=>{finish=resolve})
  let actorCurrent=true,writes=0,closes=0,clears=0,warnings=0,unlocks=0
  const live={current:true}, key={current:'A'}, inFlight={current:false}
  const scope: Record<string,unknown>={saving:false,saveInFlightRef:inFlight,imageUploading:false,imageUploadInFlightRef:{current:false},captureActorReadScope:()=>({}),draftKey:'A',draftScope:null,product:null,scopedWorkDraftKey:()=> 'A',productFormDraftBaseKey:()=> 'A',isActorReadScopeCurrent:()=>actorCurrent,aliveRef:live,currentFormDraftKeyRef:key,setSaveAuthorityWarning:()=>{warnings++},form:{name:'Rice'},isCreateMode:false,createSessionDuplicate:false,createVerdict:{kind:null},branches:[],omitUnauthorizedCatalogCosts:(v:unknown)=>v,normalizePriceValue:Number,parseNumericInput:(v:unknown)=>Number(v||0),normalizeInternalMoney:Number,canViewCosts:true,blindCostInputs:{usd:'',khr:''},showReceivedDate:false,canManageImages:true,imageListRef:{current:[]},imageList:[],initialForm:{image_gallery:[]},normalizeGallery:()=>[],savableImageList:[],canonicalizePersistedMediaPath:(v:unknown)=>v,ADMIN_MAX_PRODUCT_GALLERY_IMAGES:5,user:{id:1},askSaveConfirm:async()=>{if(boundary==='confirmation')await wait;return true},flushPendingWorkDraft:()=>{},readWorkDraft:()=>({data:'original'}),restoredLegacyDraftKeyRef:{current:null},setSaving:(v:boolean)=>{if(!v)unlocks++},onSave:async()=>{writes++;await wait;if(boundary==='failure')throw new Error('old actor failure')},clearUnchangedWorkDraft:()=>{clears++;return true},clearCurrentProductDraft:()=>{throw new Error('must not clear current form')},onClose:()=>{closes++},clearAfterSuccessfulProductSave:async(save:()=>Promise<void>,clear:()=>void,close:()=>void)=>{await save();clear();close()},alert:()=>{popups++},tr:(k:string)=>k,getErrorMessage:String,isScientificNotationBarcode:()=>false,isScientificNotationText:()=>false}
  const save=new Function(...Object.keys(scope),compile(saveSource)+';return saveForm')(...Object.values(scope))
  const pending=save();await new Promise<void>(resolve=>setImmediate(resolve))
  if(invalidation==='actor')actorCurrent=false
  if(invalidation==='unmount')live.current=false
  if(invalidation==='key')key.current='B'
  inFlight.current=true
  finish();await pending
  assert.equal(writes,boundary==='confirmation'?0:1,'late confirmation cannot submit replacement')
  assert.equal(closes,0,'old success cannot close replacement')
  assert.equal(clears,boundary==='response'?1:0,'success retains original draft CAS only')
  assert.equal(warnings,invalidation==='actor'&&boundary==='confirmation'?1:0)
  assert.equal(unlocks,invalidation==='actor'&&boundary!=='confirmation'?1:0)
  assert.equal(inFlight.current,invalidation!=='actor')
 }

 let wrapperSource='',baseKeySource=''
 function findWrapper(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='productFormDraftBaseKey')baseKeySource=node.getText(ast);if(ts.isFunctionDeclaration(node)&&node.name?.text==='ProductForm')wrapperSource=node.getText(ast);ts.forEachChild(node,findWrapper)}
 findWrapper(ast)
 let actorIdentity='actor-A',start!:()=>void,oldComplete!:()=>void,bodyMounts=0
 function Content(props:{product:{id:number}}){
  const [saving,setSaving]=React.useState(false),mutex=React.useRef(false),bodyAlive=React.useRef(true)
  React.useEffect(()=>{bodyMounts++;return()=>{bodyAlive.current=false}},[])
  start=()=>{mutex.current=true;setSaving(true)}
  oldComplete=()=>{if(bodyAlive.current){mutex.current=false;setSaving(false)}}
  return React.createElement('span',null,props.product.id+':'+saving+':'+mutex.current)
 }
 const Wrapper=new Function('React','ProductFormContent','scopedWorkDraftKey','productFormDraftBaseKey',compile(wrapperSource.replace('export default ',''))+';return ProductForm')(React,Content,(base:string)=>actorIdentity+base,new Function(compile(baseKeySource.replace('export ',''))+';return productFormDraftBaseKey')())
 await act(async()=>root.render(React.createElement(Wrapper,{product:{id:1}})))
 await act(async()=>start())
 const completeA=oldComplete
 assert.equal(container.textContent,'1:true:true')
 await act(async()=>root.render(React.createElement(Wrapper,{product:{id:2}})))
 assert.equal(container.textContent,'2:false:false','actual shared wrapper gives independent-key body fresh saving and mutex')
 await act(async()=>start())
 await act(async()=>completeA())
 assert.equal(container.textContent,'2:true:true','old completion cannot unlock active replacement')
 actorIdentity='actor-B'
 await act(async()=>root.render(React.createElement(Wrapper,{product:{id:2}})))
 assert.equal(container.textContent,'2:false:false','actual scoped identity also remounts body on account/server identity')
 assert.equal(bodyMounts,3)
 await act(async()=>root.render(React.createElement(Wrapper,{product:{id:2}})))
 assert.equal(bodyMounts,3,'same draft rerender keeps its body')
 await act(async()=>root.render(React.createElement(Wrapper,{product:{name:'Seed'},draftScope:'fast-stock-in-session-A'})))
 await act(async()=>start())
 await act(async()=>root.render(React.createElement(Wrapper,{product:{name:'Other seed'},draftScope:'fast-stock-in-session-B'})))
 assert.equal(container.textContent,'undefined:false:false','second caller create scope remounts into usable body')
 assert.equal(bodyMounts,5)
 assert.equal(popups,0,'authority refusal never opens a native popup')
 assert.match(source,/const isSaveAuthorityCurrent = \(\) => aliveRef\.current && currentFormDraftKeyRef\.current === draftKey/)
 assert.match(source,/if \(isSaveAuthorityCurrent\(\)\) alert\(getErrorMessage/,'old-actor failures cannot display stale popup')
 console.log('PASS actual refusal and mounted EN/KM warning preserve independent key/unmount/actor boundaries and actual wrapper remount usability')
} finally {await act(async()=>root.unmount());await harness.close()}
