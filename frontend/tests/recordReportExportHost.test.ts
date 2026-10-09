import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'
import * as XLSX from 'xlsx'
const root = path.resolve(import.meta.dirname, '..'), reportDir = path.join(root, 'src/components/sales/reports')
const packs = Object.fromEntries(['en', 'km'].map(l => [l, JSON.parse(fs.readFileSync(path.join(root, 'src/lang', l+'.json'), 'utf8'))]))
const before = Object.fromEntries(['ReturnsReport', 'ExpensesReport'].map(name => [name, execFileSync('git', ['show', `afd55b7806293593e74ed60c6634623090869212:frontend/src/components/sales/reports/${name}.tsx`], { cwd: root, encoding: 'utf8' })]))
const transportNames = [...new Set(['reportsTransport','returnsReadTransport','feesTransport'].flatMap(name => [...fs.readFileSync(path.join(root,'src/api',name+'.ts'),'utf8').matchAll(/^export (?:async )?(?:function|class) (\w+)/gm)].map(m=>m[1])))]
const fixture = String.raw`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Returns from '/src/components/sales/reports/ReturnsReport.tsx';import Expenses from '/src/components/sales/reports/ExpensesReport.tsx';
import OldReturns from '/src/components/sales/reports/OldReturnsReport.tsx';import OldExpenses from '/src/components/sales/reports/OldExpensesReport.tsx';
import{AppContext,FALLBACK_APP_CONTEXT}from'/src/app/AppContextCore.tsx';import{getReportView}from'/src/components/sales/reports/reportModel.ts';
import{makeReportMoneyFormatter}from'/src/utils/reportMoney.ts';import en from'/src/lang/en.json';import km from'/src/lang/km.json';
import'/src/styles/main.css';import'/src/components/sales/reports/reports-surface.css';import'@fontsource/noto-sans-khmer/400.css';
const params=new URLSearchParams(location.search),kind=params.get('kind')||'returns',language=params.get('lang')||'en',old=params.get('old')==='1';
window.__locale=language;const t=k=>(window.__locale==='km'?km:en)[k]||k,tr=(k,f)=>t(k)===k?f:t(k);document.body.className=language==='km'?'lang-km':'';
window.__calls=[];window.__files=[];window.__popups=[];window.__allow=true;window.__mode='ok';window.__held=[];
const anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href.startsWith('blob:')){const name=this.download;fetch(this.href).then(r=>r.arrayBuffer()).then(b=>window.__files.push({name,bytes:Array.from(new Uint8Array(b))}));return}return anchorClick.call(this)};
const nativeOpen=window.open.bind(window);window.open=(...args)=>{const win=nativeOpen(...args);if(win){win.print=()=>{};window.__popups.push(win)}return win};
const row=id=>({id,cursor_at:'2026-09-24T03:00:00.000Z',date:kind==='returns'?(id===1?'2026-09-24':id===2?'2026-09-24 03:00':'2026-09-24 03:00:00'):'2026-09-24',created_at:id===1?'2026-09-24':'2026-09-24 03:00',business_date:'2026-09-24',return_number:'000'+id,sale_receipt_number:'000receipt'+id,party:'សុខា',scope:'customer',type:kind==='returns'?'store_credit':'expense',reason:'return reason',status:'completed',refund_usd:.105,refund_khr:420,label:'Expense '+id,branch:'Long synthetic Shop សាខា',linked_sale_receipt_number:'000receipt'+id,notes:'notes',amount_usd:.105,amount_khr:7});
window.__fetch=async(query)=>{window.__calls.push(query);const data=Array.from({length:603},(_,i)=>row(603-i));
 if(query.intent==='export'&&window.__mode==='fail')throw Error('synthetic failure');
 if(query.intent==='export'&&window.__mode==='held')await new Promise(resolve=>window.__held.push(resolve));
 if(query.verifyOnly){if(window.__mode==='changed')throw{code:'report_export_changed'};return{export_version:1,export_token:'a'.repeat(64),snapshot_max_id:603,row_count:window.__mode==='empty'?0:603,verified:true}}
 const source=window.__mode==='empty'&&query.intent==='export'?[]:data,start=query.afterId?data.findIndex(r=>r.id===Number(query.afterId))+1:0,rows=source.slice(start,start+Number(query.pageSize||250)),more=start+rows.length<source.length;
 return{export_version:1,export_token:'a'.repeat(64),snapshot_max_id:603,row_count:source.length,totals:kind==='returns'?{count:source.length,refund_usd:source.length?63.32:0}:{count:source.length,amount_usd:source.length?63.32:0,amount_khr:source.length?4221:0},rows,has_more:more,next_cursor:more?{id:rows.at(-1).id,created_at:rows.at(-1).cursor_at}:null};};
window.__aggregate=async()=>({totals:{count:603,refund_usd:63.32,amount_usd:63.32,amount_khr:4221},days:[{date:'2026-09-24',count:603,refund_usd:63.32,amount_usd:63.32,amount_khr:4221}],by_reason:[],by_type:[],by_category:[]});
function Fixture(){const[search,setSearch]=useState(''),[raw,setRaw]=useState(''),[tick,setTick]=useState(0),[mounted,setMounted]=useState(true),[currency,setCurrency]=useState('both'),[branch,setBranch]=useState('');
 window.__search=value=>{setRaw(value);setSearch(value)};window.__raw=value=>setRaw(value);window.__rerender=()=>setTick(n=>n+1);window.__unmount=()=>setMounted(false);window.__currency=value=>setCurrency(value);window.__branch=value=>setBranch(value);window.__language=value=>{window.__locale=value;setTick(n=>n+1)};
 const fmtMoney=makeReportMoneyFormatter({displayCurrency:currency,fmtUSD:n=>'$'+Number(n).toFixed(2),fmtKHR:n=>Number(n).toFixed(0)+'៛',khrToUsd:n=>Number(n)/4000,usdToKhr:n=>Number(n)*4000});
 const p={view:getReportView(kind),filters:{startDate:'2026-09-24',endDate:'2026-09-24',branchId:branch,status:'',paymentMethod:''},search,exportScopeKey:raw,options:{basis:'revenue',currency},style:'excel',tr,t,fmtMoney,khrToUsd:n=>n/4000,canExport:()=>window.__allow,perms:{sales:true,returns:true,fees:true,shift:true},compact:false,onDrill:()=>{},onOptionsChange:()=>{}};
 const Component=kind==='returns'?(old?OldReturns:Returns):(old?OldExpenses:Expenses);
 return<AppContext.Provider value={{...FALLBACK_APP_CONTEXT,t,language:window.__locale,settings:{business_name:'Shop'},exchangeRate:4000,user:{id:1,permissions:{all:true}}}}><main data-reports-hub>{mounted?<Component {...p}/>:null}</main></AppContext.Provider>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const server = await createServer({ root, logLevel:'error', server:{host:'127.0.0.1',port:0,fs:{allow:[root,fs.realpathSync(path.join(root,'node_modules'))]}}, plugins:[{
 name:'actual-record-report-host', enforce:'pre', resolveId(id){if(id==='virtual:record-host')return'\0record-host';if(/Old(?:Returns|Expenses)Report\.tsx$/.test(id))return path.join(reportDir,path.basename(id)).replaceAll('\\','/');if(/(?:reportsTransport|returnsReadTransport|feesTransport)\.ts$/.test(id))return'\0record-transport'},
 async load(id){if(id==='\0record-host')return(await transformWithEsbuild(fixture,'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;
 if(id==='\0record-transport')return transportNames.map(name=>`export const ${name}=${['getBusinessSummaryReturnsPage','getBusinessSummaryExpensesPage','getBusinessSummarySalesPage'].includes(name)?'q=>window.__fetch(q)':['getReturnsReport','getFeesReport'].includes(name)?'q=>window.__aggregate(q)':'()=>{throw Error("Unexpected transport '+name+'")}'}`).join(';');
 for(const name of ['ReturnsReport','ExpensesReport'])if(id===path.join(reportDir,'Old'+name+'.tsx').replaceAll('\\','/'))return(await transformWithEsbuild(before[name],id,{loader:'tsx',jsx:'automatic'})).code;},
 configureServer(app){app.middlewares.use('/record-host',async(_req,res)=>{res.setHeader('content-type','text/html');res.end(await app.transformIndexHtml('/record-host','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:record-host"></script></body></html>'))})}
}] })
await server.listen();const address=server.httpServer!.address() as {port:number}
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync)
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})})
let worlds=0
try {
 for(const kind of ['returns','expenses'])for(const language of ['en','km'])for(const width of [360,1280]) {
  const pack=packs[language],page=await browser.newPage({viewport:{width,height:800}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const each=kind==='returns'?pack.rpt_each_return:pack.rpt_each_expense
  const menu=async()=>{await page.getByRole('button',{name:pack.export,exact:true}).click();await page.getByText(pack.export_csv,{exact:true}).click()}
  const prepare=async()=>{await menu();await page.getByRole('dialog').waitFor({timeout:15000})}
  try {
   await page.goto(`http://127.0.0.1:${address.port}/record-host?kind=${kind}&lang=${language}`);await page.getByRole('button',{name:each,exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===250)
   await prepare();assert.equal(await page.evaluate(()=>(window as any).__calls.filter((q:any)=>q.intent==='export').length),3)
   const dialog=page.getByRole('dialog');assert((await dialog.innerText()).includes('603'));assert((await dialog.innerText()).includes('24/09/2026'))
   for(const label of [pack.export_csv,pack.rpt_export_excel,pack.print])assert(await dialog.getByRole('button',{name:label,exact:true}).isVisible())
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
   await dialog.getByRole('button',{name:pack.export_csv,exact:true}).click();await page.waitForFunction(()=>(window as any).__files.length===1)
   const csv=await page.evaluate(()=>new TextDecoder().decode(new Uint8Array((window as any).__files[0].bytes)));assert.equal(csv.trim().split('\n').length,605)
   assert(csv.includes('63.32'));if(kind==='returns')assert(!csv.includes('420៛'));else assert(csv.includes('4221'))
   await dialog.getByRole('button',{name:pack.rpt_export_excel,exact:true}).click();await page.waitForFunction(()=>(window as any).__files.length===2)
   const bytes=await page.evaluate(()=>(window as any).__files[1].bytes),book=XLSX.read(Buffer.from(bytes),{type:'buffer',cellNF:true});const sheet=book.Sheets[book.SheetNames[0]]
   const cells=Object.values(sheet) as any[];assert(cells.some(c=>c?.t==='n'&&c.z?.includes('dd/mm/yyyy')));if(kind==='expenses'){assert(cells.some(c=>c?.v===`${pack.amount} (USD)`));assert(cells.some(c=>c?.v===`${pack.amount} (KHR)`))}
   await dialog.getByRole('button',{name:pack.print,exact:true}).click();await page.waitForFunction(()=>(window as any).__popups[0]?.document.querySelectorAll('tbody tr').length>=603)
   assert.equal(await page.evaluate(()=>(window as any).__popups[0].document.querySelectorAll('tbody tr').length),604,'603 records plus the exact totals row')
   await page.evaluate(()=>(window as any).__popups.forEach((p:any)=>p.close()))
   if(language==='en'&&width===360){
    await page.evaluate(()=>localStorage.setItem('businessos_user',JSON.stringify({id:2})))
    await dialog.getByRole('button',{name:pack.export_csv,exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).__files.length),2);await page.getByRole('dialog').waitFor({state:'hidden'})
    await page.evaluate(()=>(window as any).__rerender());await prepare()
    await page.evaluate(()=>(window as any).__raw('pending'));await page.getByRole('dialog').waitFor({state:'hidden'});await menu();assert.equal(await page.getByRole('dialog').count(),0)
    await page.evaluate(()=>(window as any).__search(''));await prepare();await dialog.getByRole('button',{name:pack.close,exact:true}).click()
    const search=kind==='returns'?'Store credit':pack.fee_type_expense;await page.evaluate(text=>(window as any).__search(text),search);await prepare();assert((await dialog.innerText()).includes('603'))
    await dialog.getByRole('button',{name:pack.close,exact:true}).click();await page.evaluate(()=>(window as any).__search('000receipt1'));await prepare();assert((await dialog.innerText()).includes('111'))
    await dialog.getByRole('button',{name:pack.close,exact:true}).click();await page.evaluate(()=>(window as any).__search(''))
    for(const mode of ['empty','fail','changed']){await page.evaluate(m=>(window as any).__mode=m,mode);await menu();await page.waitForTimeout(100);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>(window as any).__files.length),2)}
    for(const change of ['branch','currency','language','permission','unmount']){
     await page.evaluate(()=>{(window as any).__mode='held'});await menu();await page.waitForFunction(()=>(window as any).__held.length>0)
     await page.evaluate(change=>{const w=window as any;if(change==='branch')w.__branch('2');if(change==='currency')w.__currency('usd');if(change==='language')w.__language('km');if(change==='permission')w.__allow=false;if(change==='unmount')w.__unmount();w.__mode='ok';w.__held.splice(0).forEach((r:any)=>r())},change)
     await page.waitForTimeout(100);assert.equal(await page.getByRole('dialog').count(),0,change+' invalidates the late preparation');assert.equal(await page.evaluate(()=>(window as any).__files.length),2)
     if(change!=='unmount'){await page.evaluate(()=>{const w=window as any;w.__allow=true;w.__branch('');w.__currency('both');w.__language('en');w.__rerender()});await prepare();await dialog.getByRole('button',{name:pack.close,exact:true}).click()}
    }
   }
   assert.deepEqual(errors,[]);worlds++
  }finally{await page.close()}
 }
 for(const kind of ['returns','expenses']){const page=await browser.newPage();try{await page.goto(`http://127.0.0.1:${address.port}/record-host?kind=${kind}&old=1`);await page.getByRole('button',{name:kind==='returns'?'Each return':'Each expense',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===250);await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByText('Export CSV',{exact:true}).click();await page.waitForFunction(()=>(window as any).__files.length===1);const lines=await page.evaluate(()=>new TextDecoder().decode(new Uint8Array((window as any).__files[0].bytes)).trim().split('\n').length);assert.equal(lines,251,'exact old runtime exports only loaded250, no complete cohort');assert.equal(await page.getByRole('dialog').count(),0)}finally{await page.close()}}
 console.log(`PASS actual mounted Returns/Expenses ${worlds} Chromium EN/KM360/1280 worlds:603 complete CSV/XLSX/gesture print, translated/local search, exact USD/KHR, dates/viewport, stale authority/debounce/failure/permission; exact afd55 loaded250 runtime negatives`)
}finally{await browser.close();await server.close()}
