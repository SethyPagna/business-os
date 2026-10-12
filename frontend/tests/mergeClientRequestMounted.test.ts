import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, expect, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config.ts'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const component = 'src/components/products/useMergeStockChoice.tsx'
const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(readFileSync(resolve(root, `src/lang/${lang}.json`), 'utf8'))]))
const base = process.env.MERGE_CLIENT_BASE
const productsFile = 'src/components/products/Products.tsx'
const productsSource = process.env.MERGE_CLIENT_CALLER_BASE
  ? execFileSync('git', ['show', `${process.env.MERGE_CLIENT_CALLER_BASE}:frontend/${productsFile}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(resolve(root, productsFile), 'utf8')
const productsAst = ts.createSourceFile(productsFile, productsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let caller = ''
function findCaller(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(productsAst) === 'handleDuplicateKeepThis' && node.initializer && ts.isCallExpression(node.initializer)) {
    caller = node.initializer.arguments[0].getText(productsAst)
  }
  ts.forEachChild(node, findCaller)
}
findCaller(productsAst)
assert.ok(caller, 'mount the actual Products pair callback')
const modules = {
  app: `export const useApp=()=>({t:k=>window.pack[k]||k,user:{id:1,role:'admin',permissions:[]}});`,
  http: `export const cacheInvalidate=()=>{};export const route=(_c,fn)=>fn();export const apiFetch=(method,path,body)=>{if(method==='GET'){window.previews++;if(window.previewDeferred)return new Promise(r=>window.previewResolve=r);if(window.previewFail)return Promise.reject(Error('preview unavailable'));return Promise.resolve(window.preview)}const n=window.calls.length;window.calls.push(JSON.parse(JSON.stringify(body)));return new Promise((resolve,reject)=>window.pending[n]={resolve,reject})};`,
}
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{useMergeStockChoice}from'./${component}';import{resetActorReadSession,captureActorReadScope,isActorReadScopeCurrent}from'./src/api/actorReadScope.ts';import{setSyncServerUrl}from'./src/api/httpState.ts';
window.pack=${JSON.stringify(packs)}[new URLSearchParams(location.search).get('lang')||'en'];sessionStorage.setItem('businessos_user',JSON.stringify({id:1}));window.calls=[];window.pending=[];window.outcomes=[];window.failures=[];window.previews=0;window.preview={needsStockChoice:false};window.switchActor=id=>{sessionStorage.setItem('businessos_user',JSON.stringify({id}));resetActorReadSession()};
window.switchServer=setSyncServerUrl;window.ack=(i,override)=>window.pending[i].resolve(override||{success:true,keptId:window.calls[i].keepId,mergedId:window.calls[i].mergeId,operationId:'synthetic-op-'+i,actionHistoryId:i+1});window.fail=(i,error)=>window.pending[i].reject(Object.assign(Error(error.message||'synthetic failure'),error));
function App(){const{mergeWithChoice,mergeStockChoiceDialog}=useMergeStockChoice(k=>window.pack[k]);window.merge=mergeWithChoice;window.start=(k=1,l=2)=>{const p=mergeWithChoice({id:k,name:'Keeper'},{id:l,name:'Loser'});p.then(x=>window.outcomes.push(x),e=>{window.outcomes.push(e.code||e.message);window.failures.push(e.message)});return p};return <><h1>Synthetic pair merge</h1><button onClick={()=>window.start()}>Keep this</button>{mergeStockChoiceDialog}</>};createRoot(document.getElementById('root')).render(<App/>);`
const callerEntry = `window.ui=[];window.callerDone=false;
const dupResolverBusyKey=null;
const setDupResolverBusyKey=value=>window.ui.push(['busy',value]);
const mergeWithChoice=(...args)=>window.merge(...args);
const notify=(...args)=>window.ui.push(['notify',...args]);
const load=async()=>{window.ui.push(['load']);if(window.loadDeferred)await new Promise(resolve=>window.loadResolve=resolve)};
const refreshDuplicateClusters=async()=>window.ui.push(['refresh']);
const getErrorMessage=e=>e.message;const t=key=>window.pack[key];
window.keep=()=>(${caller})(1,{key:'1:2',members:[{id:1,name:'Keeper'},{id:2,name:'Loser'}]}).finally(()=>window.callerDone=true);`
const js = (await build({ stdin: { contents: entry + callerEntry, loader: 'tsx', resolveDir: root }, jsx: 'automatic', bundle: true, write: false, platform: 'browser', format: 'iife', plugins: [{ name: 'pair-host-seams', setup(b) {
  for (const [filter, key] of [[/\/AppContext(?:Core)?(?:\.tsx)?$/, 'app'], [/\/http\.ts$/, 'http']] as const) b.onResolve({ filter }, () => ({ path: key, namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path as keyof typeof modules], loader: 'tsx', resolveDir: root }))
  if (base) for (const file of [component, 'src/api/productWriteTransport.ts']) b.onLoad({ filter: new RegExp(file.split('/').pop()!.replace('.', '\.')+'$') }, () => ({ contents: execFileSync('git', ['show', `${base}:frontend/${file}`], { cwd: root, encoding: 'utf8' }), loader: file.endsWith('tsx')?'tsx':'ts', resolveDir: resolve(root, file.slice(0,file.lastIndexOf('/'))) }))
} }] })).outputFiles[0].text
const css = (await postcss([tailwindcss({ ...config, content: ['src/components/products/MergeStockChoiceDialog.tsx','src/components/shared/ConfirmDialog.tsx','src/components/shared/Modal.tsx'].map(file=>({raw:readFileSync(resolve(root,file),'utf8'),extension:'tsx'})) })]).process(readFileSync(resolve(root,'src/styles/main.css'),'utf8'),{from:resolve(root,'src/styles/main.css')})).css
const server = createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?js:`<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body><div id="root"></div><script src="/app.js"></script></body></html>`)})
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
const address=server.address();assert.ok(address&&typeof address!=='string')
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const state=(p:Page)=>p.evaluate(()=>({calls:(window as any).calls,previews:(window as any).previews,outcomes:(window as any).outcomes}))
async function start(p:Page,k=1,l=2){await p.evaluate(([k,l])=>{void(window as any).start(k,l)},[k,l])}
async function count(p:Page,n:number){await p.waitForFunction(n=>(window as any).calls.length===n,n)}
async function outcomes(p:Page,n:number){await p.waitForFunction(n=>(window as any).outcomes.length===n,n)}
async function ack(p:Page,n:number,value?:unknown){await p.evaluate(([n,value])=>(window as any).ack(n,value),[n,value])}
async function fail(p:Page,n:number,error:unknown){await p.evaluate(([n,error])=>(window as any).fail(n,error),[n,error])}
try {
  for(const lang of ['en','km']) for(const width of [375,1280]){
    const p=await browser.newPage({viewport:{width,height:800}});p.setDefaultTimeout(7000)
    const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message))
    const fresh=async()=>{await p.goto(`http://127.0.0.1:${address.port}/?lang=${lang}`,{waitUntil:'domcontentloaded',timeout:30000});await expect(p.getByRole('heading')).toHaveText('Synthetic pair merge');await expect(p.getByRole('button',{name:'Keep this'})).toBeVisible()}
    await fresh()
    await p.evaluate(()=>{const w=window as any;w.samePromise=w.start()===w.start()})
    await p.waitForFunction(()=>(window as any).calls.length>0)
    assert.equal((await state(p)).previews,1,'one preview for synchronous double click')
    assert.equal(await p.evaluate(()=>(window as any).samePromise),true,'same pair coalesces exact in-flight promise')
    assert.match((await state(p)).calls[0].client_request_id,/^product_merge_[\w-]+$/)
    await ack(p,0);await outcomes(p,2)
    assert.deepEqual((await state(p)).outcomes,['merged','merged'])

    await fresh();await p.evaluate(()=>{(window as any).preview={needsStockChoice:true,stockImpact:{productId:2,totalQuantity:.3,lotCount:0,branches:[]}}});await start(p)
    const dialog=p.getByRole('dialog');await expect(dialog).toBeVisible()
    await dialog.getByText(packs[lang].merge_stock_choice_merge,{exact:true}).click();await dialog.getByRole('button',{name:packs[lang].merge,exact:true}).click();await count(p,1)
    const frozen=(await state(p)).calls[0];assert.equal(frozen.stock,'merge')
    await fail(p,0,{code:'request_timeout',outcome:'unknown'});await outcomes(p,1)
    await start(p,1,3);await outcomes(p,2);assert.equal((await state(p)).outcomes[1],'write_outcome_unknown');assert.equal((await state(p)).calls.length,1)
    await start(p);await count(p,2);assert.deepEqual((await state(p)).calls[1],frozen);assert.equal((await state(p)).previews,1);await expect(dialog).toHaveCount(0)
    await ack(p,1,{success:true,keptId:99,mergedId:2,operationId:'wrong',actionHistoryId:1});await outcomes(p,3)
    await start(p);await count(p,3);assert.deepEqual((await state(p)).calls[2],frozen);await ack(p,2);await outcomes(p,4)
    assert.equal((await state(p)).outcomes[3],'merged')
    console.log(`PASS ${lang}/${width} double click, exact lost-ACK retry, blocked different pair, malformed identity`)

    await fresh();await p.evaluate(()=>{(window as any).preview={needsStockChoice:true,stockImpact:{productId:2,totalQuantity:.3,lotCount:0,branches:[]}}});await start(p);await dialog.getByText(packs[lang].merge_stock_choice_merge,{exact:true}).click();await dialog.getByRole('button',{name:packs[lang].merge,exact:true}).click();await count(p,1)
    const old=(await state(p)).calls[0];await fail(p,0,{status:409,code:'merge_conflict_retry'});await outcomes(p,1)
    await start(p);await dialog.getByText(packs[lang].merge_stock_choice_write_off,{exact:true}).click();await dialog.getByRole('button',{name:packs[lang].remove,exact:true}).click();await count(p,2)
    const corrected=(await state(p)).calls[1];assert.notEqual(corrected.client_request_id,old.client_request_id);assert.equal(corrected.stock,'write_off');await ack(p,1,{success:true,keptId:1,mergedId:2,stockDisposition:'write_off'});await outcomes(p,2)
    assert.equal((await state(p)).outcomes[1],'merged','legacy write-off response remains compatible')
    console.log(`PASS ${lang}/${width} known refusal permits changed choice with new key`)

    for (const [code,key,status] of [
      ['merge_request_conflict','resolve_refusal_request_conflict',409],
      ['merge_request_permission','resolve_refusal_permission',403],
      ['merge_request_budget','resolve_refusal_too_large',409],
    ] as const) {
      await fresh();await start(p);await count(p,1);await fail(p,0,{code,status});await outcomes(p,1)
      assert.equal(await p.evaluate(()=>(window as any).failures[0]),packs[lang][key])
    }
    console.log(`PASS ${lang}/${width} translated request, permission and budget refusals`)

    await fresh();await start(p);await count(p,1);const actor1=(await state(p)).calls[0];await fail(p,0,{status:503,code:'stock_transaction_outcome_unknown'});await outcomes(p,1)
    await p.evaluate(()=>(window as any).switchActor(2));await start(p);await count(p,2);assert.notEqual((await state(p)).calls[1].client_request_id,actor1.client_request_id);await ack(p,1);await outcomes(p,2)
    await fresh();await start(p);await count(p,1);await p.evaluate(()=>(window as any).switchActor(2));await ack(p,0);await outcomes(p,1);assert.notEqual((await state(p)).outcomes[0],'merged','stale completion cannot authorize new UI')
    await fresh();await p.evaluate(()=>{(window as any).previewDeferred=true});await start(p);await p.waitForFunction(()=>(window as any).previews===1);await p.evaluate(()=>{(window as any).switchActor(2);(window as any).previewResolve({needsStockChoice:false})});await outcomes(p,1);assert.equal((await state(p)).calls.length,0,'changed actor after preview never writes')
    await fresh();await p.evaluate(()=>{(window as any).preview={needsStockChoice:true,stockImpact:{productId:2,totalQuantity:.3,lotCount:0,branches:[]}}});await start(p);await dialog.getByText(packs[lang].merge_stock_choice_merge,{exact:true}).click();await p.evaluate(()=>(window as any).switchActor(2));await dialog.getByRole('button',{name:packs[lang].merge,exact:true}).click();await outcomes(p,1);assert.equal((await state(p)).calls.length,0,'changed actor at confirm never writes')
    console.log(`PASS ${lang}/${width} account switch, stale ACK, preview/confirmation actor fences`)
    await fresh();await start(p);await count(p,1);const firstServer=(await state(p)).calls[0]
    await fail(p,0,{status:503,code:'stock_transaction_outcome_unknown'});await outcomes(p,1)
    await p.evaluate(()=>(window as any).switchServer('https://other-server.invalid'));await start(p);await count(p,2)
    assert.notEqual((await state(p)).calls[1].client_request_id,firstServer.client_request_id)
    await ack(p,1);await outcomes(p,2)
    await fresh();await start(p);await count(p,1);await p.evaluate(()=>(window as any).switchServer('https://other-server.invalid'));await ack(p,0);await outcomes(p,1)
    assert.notEqual((await state(p)).outcomes[0],'merged','old-server ACK cannot authorize new-server UI')
    console.log(`PASS ${lang}/${width} server switch invalidates command and late ACK`)
    for (const authority of ['actor','server']) for (const settle of ['success','failure']) {
      await fresh();await p.evaluate(()=>{void(window as any).keep()});await count(p,1)
      await p.evaluate(authority=>{const w=window as any;if(authority==='actor')w.switchActor(2);else w.switchServer('https://other-server.invalid')},authority)
      if(settle==='success')await ack(p,0);else await fail(p,0,{status:409,code:'merge_request_conflict'})
      await p.waitForFunction(()=>(window as any).callerDone)
      assert.deepEqual(await p.evaluate(()=>(window as any).ui),[['busy','1:2']], 'stale Products caller cannot notify, refresh or clear new UI')
    }
    await fresh();await p.evaluate(()=>{const w=window as any;w.loadDeferred=true;void w.keep()});await count(p,1);await ack(p,0)
    await p.waitForFunction(()=>(window as any).loadResolve)
    const beforeSwitch=await p.evaluate(()=>(window as any).ui)
    await p.evaluate(()=>{const w=window as any;w.switchActor(2);w.loadResolve()});await p.waitForFunction(()=>(window as any).callerDone)
    assert.deepEqual(await p.evaluate(()=>(window as any).ui),beforeSwitch,'stale load continuation cannot refresh or unlock replacement UI')
    console.log(`PASS ${lang}/${width} actual Products success/failure/load caller actor and server fences`)
    await fresh();await p.evaluate(()=>{(window as any).previewFail=true});await start(p);await count(p,1);await fail(p,0,{status:400,code:'stock_choice_required',stockImpact:{productId:2,totalQuantity:.3,lotCount:0,branches:[]}});await dialog.getByText(packs[lang].merge_stock_choice_merge,{exact:true}).click();await dialog.getByRole('button',{name:packs[lang].merge,exact:true}).click();await count(p,2);assert.notEqual((await state(p)).calls[0].client_request_id,(await state(p)).calls[1].client_request_id);await ack(p,1);await outcomes(p,1)
    assert.deepEqual(errors,[])
    if(process.env.MERGE_CLIENT_SCREENSHOTS)await p.screenshot({path:resolve(process.env.MERGE_CLIENT_SCREENSHOTS,`merge-client-${lang}-${width}.png`)})
    console.log(`PASS ${lang}/${width} legacy preview refusal and unchanged modal choices`)
    await p.close()
  }
}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()))}
