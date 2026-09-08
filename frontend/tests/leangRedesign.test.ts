import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const source = app.slice(app.indexOf('function GlobalScrollControls('), app.indexOf('\nfunction formatSyncTimestamp'))
const compiled = ts.transpileModule(source + '\nresult = GlobalScrollControls;', { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
let visible = false, effect: (()=>void)|null = null, cleanup: (()=>void)|null = null
let target = { scrollTop: 0 }
const listeners = new Map<string,()=>void>()
let observe: (()=>void)|null = null, disconnected = false
const context: any = { result:null, React:{createElement: (...args: any[])=>args}, useState:()=>[visible,(v:boolean)=>{visible=v}], useEffect:(fn:()=>void)=>{effect=fn}, getScrollTarget:()=>target, getScrollToPosition:()=>0, ArrowUp:()=>null, ArrowDown:()=>null,
  window:{addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},document:{body:{}}, MutationObserver:class { constructor(fn:()=>void){observe=fn} observe(){} disconnect(){disconnected=true} } }
vm.runInNewContext(compiled,context)
assert.equal(context.result({mobileBottomNavVisible:false}),null,'hidden at top')
cleanup = effect!() as unknown as ()=>void
assert.equal(visible,false)
target.scrollTop=300; listeners.get('scroll')!();assert.equal(visible,true,'visible after scrolling')
assert.notEqual(context.result({mobileBottomNavVisible:false}),null)
target={scrollTop:0}; observe!(); assert.equal(visible,false,'hidden when navigating to an unscrolled page')
cleanup!();assert.equal(listeners.size,0);assert.equal(disconnected,true,'observer cleaned up')

const page=readFileSync(new URL('../src/components/catalog/PublicCatalogPage.tsx',import.meta.url),'utf8')
const start=page.indexOf('  useEffect(() => {',page.indexOf('// Once the widget'))
const end=page.indexOf('\n',page.indexOf('}, [configuredPortalLanguage, externalTranslateTarget, loading',start))
let callback: (()=>Promise<void>)|null=null, state='', reloads=0, tries=0
vm.runInNewContext(page.slice(start,end),{useEffect:(fn:()=>void)=>fn(),translateWidgetEnabled:true,externalTranslateTarget:'fr',translateReady:true,configuredPortalLanguage:'en',normalizedTranslateTarget:'fr',loading:false,window:{setTimeout:(fn:()=>Promise<void>)=>{callback=fn;return 1},clearTimeout:()=>{},location:{reload:()=>{reloads++}}},applyGoogleTranslateSelection:()=>{tries++},isPortalTranslateApplied:()=>false,sleep:async()=>{},setTranslateApplyState:(v:string)=>{state=v},setTranslateApplyMessage:()=>{},copy:(_:string,f:string)=>f,requestPortalTranslateReload:()=>{reloads++;return true}})
await callback!();assert.equal(tries,20);assert.equal(state,'failed');assert.equal(reloads,0,'stalled external translation never reloads the page')
const gate=page.match(/const pullToRefreshEnabled = (.+)/)![1]
assert.equal(vm.runInNewContext(gate,{productDetailView:{open:true},productGalleryView:{open:false},portalImageView:{open:false},bucketOpen:false,contactOpen:false,filePicker:{open:false},accountOpen:false,wishlistOpen:false}),false,'detail overlay disables page refresh')
console.log('PASS admin scroll lifecycle and stalled translation/detail refresh guards')
