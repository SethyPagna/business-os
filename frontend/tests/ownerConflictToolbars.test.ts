import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import ts from 'typescript'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config.ts'
import { chromium, type Page } from '@playwright/test'

declare global { interface Window { calls: Array<{ kind: string; table?: string; includeDismissed?: boolean }>; setFixtureIdentity: (page: string, actor: number) => void } }
const root = process.env.OWNER_CONFLICT_FIXTURE_ROOT || path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(read(`src/lang/${lang}.json`))]))
// Execute the actual Products title-row JSX. The full catalog domain is outside
// this toolbar fixture; Contacts and Sidebar are mounted as their real parents.
const source = read('src/components/products/Products.tsx')
const parsed = ts.createSourceFile('Products.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let productTitle = ''
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(parsed) === 'aria-label' && p.getText(parsed).includes('product_sections'))) productTitle = node.getText(parsed)
  ts.forEachChild(node, visit)
}
visit(parsed)
assert.ok(productTitle, 'actual Products section-title row found')
const fixture = `
import React,{useRef} from 'react';import{createRoot}from'react-dom/client';
import Sidebar from './src/components/navigation/Sidebar.tsx';
import Contacts from './src/components/contacts/Contacts.tsx';
import ProductConflicts from './src/components/products/ProductDuplicatesTab.tsx';
import {useApp,setFixtureIdentity} from './src/AppContext.tsx';
import {useLayeredSectionNav} from './src/utils/sectionNavPreference.ts';
const q=new URLSearchParams(location.search),kind=q.get('kind')||'products';
localStorage.setItem('bos:hub:contacts:active','duplicates');window.setFixtureIdentity=setFixtureIdentity;
location.hash='#hub:'+kind+':duplicates';window.calls=[];
function ProductHost(){const {t,settings}=useApp();const layeredSectionNav=useLayeredSectionNav(settings?.ui_mobile_section_nav);const tr=(key,fallback)=>t(key)||fallback;const activeProductSection='duplicates';const setActiveProductSection=()=>{};const sectionPillsRef=useRef(null);
const productSectionTabs=[{id:'products',key:'products',label:'Products'},{id:'duplicates',key:'possible_duplicates',label:'Conflicts'}];
return <>{layeredSectionNav?null:${productTitle}}<ProductConflicts t={t} notify={()=>{}} canRemoveProduct={false} onMergeLeadingZero={()=>{}}/></>}
function Host(){const {user}=useApp();return <><Sidebar showQuickPreferences={false}/><main key={user.id} style={{padding:12,maxWidth:1000,marginTop:72}}>{kind==='contacts'?<Contacts/>:<ProductHost/>}</main></>}
createRoot(document.getElementById('root')).render(<Host/>);`
const app = `import React from'react';const q=new URLSearchParams(location.search),packs=${JSON.stringify(packs)};
const t=key=>{const value=packs[q.get('lang')||'en'][key]||key;return q.get('long')==='1'&&key==='product_dup_leading_zero'?value+' '+value+' '+value:value};
const value={page:q.get('kind')||'products',language:q.get('lang')||'en',t,user:{id:1,name:'Synthetic owner',role_code:'admin',permissions:'{"all":true}'},settings:{ui_mobile_section_nav:q.get('mode')||'pages'},navigateTo:()=>{},logout:()=>{},notify:()=>{},hasPermission:key=>key!=='contacts_suppliers'||q.get('supplier')!=='0',getPermissionTier:()=> 'full',can:()=>true,canAccessPage:()=>true};
let activePage=value.page,actor=1;export function setFixtureIdentity(page,id){activePage=page;actor=id;window.dispatchEvent(new Event('fixture-app'))}
const subscribe=fn=>{window.addEventListener('fixture-app',fn);return()=>window.removeEventListener('fixture-app',fn)};
export const useApp=()=>{React.useSyncExternalStore(subscribe,()=>activePage+':'+actor);return{...value,page:activePage,user:{...value.user,id:actor}}};export const useSync=()=>({});export const AppContext=React.createContext(value);export const FALLBACK_APP_CONTEXT=value;export const isBrokenLocalizedString=()=>false;` 
const productRead = `export * from ${JSON.stringify(path.join(root, 'src/api/productWriteTransport.ts'))};
export async function getPossiblySameProducts(){window.calls.push({kind:'products'});return{clusters:[{type:'barcode',value:'00123',severity:'leading_zero',products:[{id:1,name:'Synthetic rice',barcode:'00123',stock_quantity:1},{id:2,name:'Synthetic rice',barcode:'123',stock_quantity:1}]}]}};`
const contactRead = `export * from ${JSON.stringify(path.join(root, 'src/components/contacts/contactDuplicates.ts'))};
export async function getContactDuplicateClusters(table,opts){window.calls.push({kind:'contacts',table,...opts});return[]};
export async function getSaleLinkConflicts(opts){window.calls.push({kind:'links',...opts});return{mismatches:[],missing:[]}};`
const bundle = (await build({stdin:{contents:fixture,loader:'tsx',resolveDir:root},loader:{'.css':'empty'},bundle:true,format:'iife',write:false,plugins:[{name:'synthetic-read-boundaries',setup(b){
  b.onResolve({filter:/AppContext(?:Core)?(?:\.tsx)?$/},()=>({path:'app',namespace:'seam'}))
  b.onResolve({filter:/productWriteTransport\.ts$|(?:\/|^)contactDuplicates(?:\.ts)?$/},a=>a.namespace==='seam'?undefined:({path:a.path.includes('productWriteTransport')?'products':'contacts',namespace:'seam'}))
  b.onLoad({filter:/.*/,namespace:'seam'},a=>({contents:a.path==='app'?app:a.path==='products'?productRead:contactRead,loader:'tsx',resolveDir:root}))
}}]})).outputFiles[0].text
const files = ['src/components/products/Products.tsx','src/components/products/ProductDuplicatesTab.tsx','src/components/contacts/Contacts.tsx','src/components/contacts/DuplicatesTab.tsx','src/components/contacts/SaleLinkConflictsSection.tsx','src/components/shared/HubSectionNav.tsx','src/components/navigation/Sidebar.tsx','src/components/shared/FilterMenu.tsx','src/components/shared/PortalMenu.tsx','src/components/shared/AppSelect.tsx','src/components/shared/toolbarButtonStyles.ts']
const css = (await postcss([tailwindcss({...config,content:[{raw:files.map(read).join('\n')+fixture,extension:'tsx'}]})]).process(read('src/styles/main.css'),{from:path.join(root,'src/styles/main.css')})).css + read('src/components/navigation/nav-chrome.css')
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle);return}res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)})
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address!=='string')
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync)
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});let failed=0
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(error){failed++;console.error('FAIL '+label,error)}}
async function waitForRefresh(page:Page,name:string,timeout=5000){
  const refresh=page.getByRole('button',{name,exact:true})
  await refresh.waitFor({state:'visible',timeout})
  assert.equal(await refresh.count(),1,'exactly one live refresh after portal commit')
  return refresh
}
try {
  for(const kind of ['products','contacts'])for(const lang of ['en','km'])for(const width of [375,1280])for(const mode of width===375?['pages','sections']:['pages']){
    const page=await browser.newPage({viewport:{width,height:812}});page.setDefaultTimeout(5000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${address.port}/?kind=${kind}&lang=${lang}&mode=${mode}&long=1`);await page.waitForFunction(()=>window.calls?.length>0)
    const label=`${kind} ${lang} ${width} ${mode}`
    await check('title refresh '+label,async()=>{
      const button=await waitForRefresh(page,packs[lang].refresh);assert.equal(await button.count(),1,'one refresh across host and child')
      const host=page.locator(`[data-section-title-action-host="${kind}:duplicates"]`).filter({has:button});assert.equal(await host.count(),1,'refresh belongs to existing title slot')
      const geo=await host.evaluate(el=>{const title=el.previousElementSibling!;const a=title.getBoundingClientRect(),b=el.getBoundingClientRect();return{sameRow:Math.abs(a.top+a.height/2-b.top-b.height/2)<8,visible:b.left>=0&&b.right<=innerWidth,title:title.textContent,headings:document.querySelectorAll('h1,h2').length}})
      assert.equal(geo.sameRow,true,JSON.stringify(geo));assert.equal(geo.visible,true,JSON.stringify(geo));assert.equal(geo.headings,0,'no duplicate page heading')
      const before=await page.evaluate(()=>window.calls.length);await button.click();await page.waitForFunction(n=>window.calls.length>n,before);assert.deepEqual(errors,[])
      if(width===375&&mode==='pages'){
        await page.getByRole('button',{name:packs[lang].back,exact:true}).click()
        await page.waitForFunction(()=>!document.querySelector('[data-section-title-action-location="mobile"]'))
        assert.equal(await button.count(),0,'section action removed when page menu owns title')
        await page.getByRole('button',{name:packs[lang].close,exact:true}).first().click()
        await button.waitFor();assert.equal(await button.count(),1,'one current action after title returns')
      }
    })
    await check('scrolling toolbar '+label,async()=>{
      const row=page.locator('[data-conflict-toolbar]');assert.equal(await row.count(),1)
      const geometry=await row.evaluate(el=>{const children=Array.from(el.children).map(n=>n.getBoundingClientRect());return{wrap:getComputedStyle(el).flexWrap,overflow:getComputedStyle(el).overflowX,tops:children.map(b=>Math.round(b.top+b.height/2)),pageOverflow:document.documentElement.scrollWidth>innerWidth}})
      assert.equal(geometry.wrap,'nowrap');assert.ok(['auto','scroll'].includes(geometry.overflow));assert.ok(Math.max(...geometry.tops)-Math.min(...geometry.tops)<8,JSON.stringify(geometry));assert.equal(geometry.pageOverflow,false)
      if(kind==='products'){const select=page.getByRole('button',{name:packs[lang].type,exact:true});await select.click();await page.locator('[data-app-select-option="leading_zero"]').click();const scroll=await row.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));if(width===375)assert.ok(scroll.scroll>scroll.width,'long selected filter scrolls locally');await select.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape')}
      else{
        assert.equal(await page.getByText(packs[lang].duplicates_tab_hint.replace('{table}',packs[lang].customers.toLowerCase()),{exact:true}).count(),0)
        const options=page.getByRole('button',{name:packs[lang].options,exact:true}),filters=page.getByRole('button',{name:packs[lang].filters,exact:true});assert.equal(await options.count(),1);assert.equal(await filters.count(),1)
        await options.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:packs[lang].delivery_contacts_tab,exact:true}).last().click();await page.waitForFunction(()=>window.calls.some(c=>c.table==='delivery_contacts'))
        await options.click();await page.getByRole('button',{name:packs[lang].link_conflicts_section,exact:true}).last().click();await page.waitForFunction(()=>window.calls.some(c=>c.kind==='links'))
        await waitForRefresh(page,packs[lang].refresh);assert.equal(await options.count(),1);assert.equal(await filters.count(),1)
        const before=await page.evaluate(()=>window.calls.filter(c=>c.kind==='links').length);await page.getByRole('button',{name:packs[lang].refresh,exact:true}).click();await page.waitForFunction(n=>window.calls.filter(c=>c.kind==='links').length>n,before)
        await filters.click();await page.getByRole('option',{name:packs[lang].show_kept,exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.kind==='links'&&c.includeDismissed===true));await page.keyboard.press('Escape')
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[])
    });await page.close()
  }
  const page=await browser.newPage({viewport:{width:375,height:812}});await page.goto(`http://127.0.0.1:${address.port}/?kind=contacts&supplier=0`);await page.waitForFunction(()=>window.calls?.length>0)
  await check('supplier option privacy',async()=>{await page.getByRole('button',{name:packs.en.options,exact:true}).click();assert.equal(await page.getByRole('button',{name:packs.en.suppliers,exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.table==='suppliers')),false)});await page.close()
  const missingHost=await browser.newPage({viewport:{width:375,height:812}})
  await missingHost.goto(`http://127.0.0.1:${address.port}/?kind=contacts`);await missingHost.waitForFunction(()=>window.calls?.length>0)
  await check('missing title host fails committed refresh readiness',async()=>{
    await missingHost.getByRole('button',{name:packs.en.options,exact:true}).click()
    await missingHost.getByRole('button',{name:packs.en.link_conflicts_section,exact:true}).last().click()
    await missingHost.waitForFunction(()=>window.calls.some(c=>c.kind==='links'))
    await missingHost.evaluate(()=>document.querySelectorAll('[data-section-title-action-host]').forEach(host=>host.remove()))
    await assert.rejects(()=>waitForRefresh(missingHost,packs.en.refresh,300),/Timeout/,'a started request cannot conceal a missing title action')
  });await missingHost.close()
  for(const kind of ['products','contacts']){
    const page=await browser.newPage({viewport:{width:375,height:812}});page.setDefaultTimeout(5000);await page.goto(`http://127.0.0.1:${address.port}/?kind=${kind}`);await page.waitForFunction(()=>window.calls?.length>0)
    await check('title action lifecycle '+kind,async()=>{
      const refresh=page.getByRole('button',{name:packs.en.refresh,exact:true});await refresh.waitFor()
      await page.setViewportSize({width:1280,height:812});await page.waitForFunction(()=>document.querySelector('[data-section-title-action-location="sections"] button'))
      assert.equal(await refresh.count(),1,'resize moves one action to section title')
      const pageTop=await page.evaluate(()=>scrollY);await refresh.click();assert.equal(await page.evaluate(()=>scrollY),pageTop,'refresh does not scroll the page')
      await page.evaluate(()=>window.setFixtureIdentity('dashboard',1));await page.waitForFunction(()=>!document.querySelector('[data-section-title-action-host] button'))
      assert.equal(await refresh.count(),0,'retained body does not expose its old callback on another page')
      const before=await page.evaluate(()=>window.calls.length);await page.evaluate(k=>window.setFixtureIdentity(k,2),kind);await refresh.waitFor();await page.waitForFunction(n=>window.calls.length>n,before)
      assert.equal(await refresh.count(),1,'actor boundary remount attaches exactly one current action')
      await page.setViewportSize({width:375,height:812});await page.waitForFunction(()=>document.querySelector('[data-section-title-action-location="mobile"] button'))
      await page.evaluate(()=>{localStorage.setItem('bos:ui:mobile-section-nav','sections');window.dispatchEvent(new Event('bos:mobile-section-nav'))});await page.waitForFunction(()=>document.querySelector('[data-section-title-action-location="sections"] button'))
      assert.equal(await refresh.count(),1,'navigation mode migration has one live action')
    });await page.close()
  }
}finally{await browser.close();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))}
if(failed)process.exitCode=1
