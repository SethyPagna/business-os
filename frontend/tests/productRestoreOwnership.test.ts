import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=fs.readFileSync(process.env.PRODUCT_RESTORE_SOURCE || new URL('../src/components/products/Products.tsx',import.meta.url),'utf8')
const ast=ts.createSourceFile('Products.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
function variable(name:string,required=true){let result='';function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)result='const '+node.getText(ast);ts.forEachChild(node,visit)}visit(ast);if(required)assert.ok(result,name);return result}
const compile=(text:string,scope:Record<string,unknown>,name:string)=>new Function(...Object.keys(scope),ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return '+name)(...Object.values(scope))
for(const later of ['open','open-close','stock','restore','authority','unmount','none']) {
 let resolve!:(rows:Array<{id:number}>)=>void
 const wait=new Promise<Array<{id:number}>>(done=>{resolve=done})
 let selected:{id:number}|null=null,modal:string|null=null,stock:unknown=null,handled=0,reparked=0,notices=0
 const productWorkIntentRef={current:{revision:0,modal:null as string|null,stockSession:false}},productSaveAuthorityRef={current:{revision:0}}
 let disposed=false
 const scope:Record<string,unknown>={productWorkIntentRef,productSaveAuthorityRef,captureMinimizedWorkRestoreScope:()=>({}),useCallback:(fn:unknown)=>fn,setModalState:(next:string|null)=>{modal=next},setStockSessionState:(next:unknown)=>{stock=next},setSelected:(next:{id:number})=>{selected=next},setFormInitialTab:()=>{},can:()=>true,canRestoreMinimizedWork:()=>true,reparkDeniedRestore:()=>{reparked++},notify:()=>{notices++},tr:(key:string)=>key,fetchProductsByIds:()=>wait,markRestoreHandled:()=>{handled++}}
 const modalSetter=variable('setModal',false),stockSetter=variable('setStockSession',false)
 const setModal=modalSetter?compile(modalSetter,scope,'setModal'):scope.setModalState,setStockSession=stockSetter?compile(stockSetter,scope,'setStockSession'):scope.setStockSessionState
 Object.assign(scope,{setModal,setStockSession})
 const open=compile(variable('openProductFormTab'),scope,'openProductFormTab')
 // Read disposal dynamically, exactly as the actual effect's lexical binding.
 const factory=ts.transpileModule(variable('restoreEdit'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return restoreEdit'
 const restore=new Function('scope','disposed', 'with(scope){'+factory+'}')(new Proxy(scope,{has:(target,key)=>key==='disposed'||key in target,get:(target,key)=>key==='disposed'?disposed:key===Symbol.unscopables?undefined:target[String(key)]}),false)
 const pending=restore({kind:'edit_product',payload:{productId:2}})
 await new Promise<void>(done=>setImmediate(done))
 if(later==='open'||later==='open-close'){open({id:1});if(later==='open-close')(setModal as (next:null)=>void)(null)}
 if(later==='stock')(setStockSession as (next:unknown)=>void)({mode:'add'})
 if(later==='restore'){scope.fetchProductsByIds=async()=>[{id:3}];await restore({kind:'edit_product',payload:{productId:3}})}
 if(later==='authority')productSaveAuthorityRef.current.revision++
 if(later==='unmount')disposed=true
 resolve([{id:2}]);await pending
 if(later==='none'){assert.equal((selected as {id:number}|null)?.id,2);assert.equal(modal,'form');assert.equal(handled,1);assert.equal(reparked,0)}
 else{assert.equal((selected as {id:number}|null)?.id,later==='restore'?3:later==='open'||later==='open-close'?1:undefined);assert.equal(modal,later==='open'||later==='restore'?'form':null);assert.equal(handled,later==='restore'?1:0);assert.equal(reparked,1);assert.equal(notices,0)}
 if(later==='stock')assert.deepEqual(stock,{mode:'add'})
}
console.log('PASS actual restoreEdit/open/modal/stock ordering preserves later work, parked draft, authority and unmount; unobstructed restore still opens')
