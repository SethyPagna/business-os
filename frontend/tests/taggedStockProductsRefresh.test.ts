import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium, webkit, expect } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url))
const component = 'src/components/products/Products.tsx'
const baseline = process.env.PRODUCTS_REFRESH_BASE
const before = baseline ? execFileSync('git', ['show', `${baseline}:frontend/${component}`], { cwd: root, encoding: 'utf8' }) : null
const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(readFileSync(resolve(root, `src/lang/${language}.json`), 'utf8'))]))
const actual = (path: string) => JSON.stringify(resolve(root, path).replaceAll('\\', '/'))
const seams: Record<string, string> = {
  context: `export * from ${actual('src/app/AppContextCore.tsx')};`,
  actor: `export * from ${actual('src/api/actorReadScope.ts')};export const captureActorReadScope=()=>({authority:window.actor});export const isActorReadScopeCurrent=s=>s.authority===window.actor;export const assertActorReadScope=s=>{if(s.authority!==window.actor)throw Error('actor changed')};export const assertActorSessionDispatchAllowed=assertActorReadScope;`,
  read: `export * from ${actual('src/api/productReadTransport.ts')};export const searchProducts=async()=>{window.reads++;if(window.readMode==='hold')return new Promise((resolve,reject)=>{window.resolveRead=()=>resolve(window.payload());window.rejectRead=()=>reject(Error('synthetic read failure'))});if(window.readMode==='fail'){await new Promise(done=>setTimeout(done,50));throw Error('synthetic read failure')}return window.payload()};export const getProductFilters=async()=>({brands:[],categories:[],suppliers:[],initials:[]});`,
  branches: `export * from ${actual('src/api/branchTransport.ts')};export const getBranches=async()=>[{id:1,name:'LC Store',is_active:1,is_default:1}];`,
  lookups: `export * from ${actual('src/api/lookupTransport.ts')};export const getCategories=async()=>[];export const getUnits=async()=>[];`,
  tagged: `export * from ${actual('src/api/damagedLotsTransport.ts')};export const getTaggedLots=async()=>{window.tagReads++;return {items:[{product_id:7,branch_id:1,product_name:'Refresh stock specimen',branch_name:'LC Store',condition_tag:'damaged',quantity:window.tagged,lot_count:1}]}};const write=async body=>{window.writes.push(body);window.tagged=0.2;if(window.kind==='dispose')window.physical=0.2;return {success:true,productId:body.productId,branchId:body.branchId,conditionTag:body.conditionTag,quantity:body.quantity}};export const restoreTaggedLot=write;export const disposeTaggedLot=write;`,
  search: `export * from ${actual('src/api/productSearchIndex.ts')};export const useProductSearchIndex=()=>0;export const productSearchRequest=query=>({params:{query}});`,
}
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Products from './${component}';import {AppContext,SyncContext,FALLBACK_APP_CONTEXT} from './src/app/AppContextCore.tsx';
const params=new URLSearchParams(location.search),p=${JSON.stringify(packs)}[params.get('lang')||'en'];window.actor=1;window.reads=0;window.tagReads=0;window.writes=[];window.notices=[];window.readMode='ok';window.physical=0.3;window.tagged=0.3;window.kind=params.get('kind')||'dispose';window.payload=()=>({items:[{id:7,name:'Refresh stock specimen',stock_quantity:window.physical,is_active:1,is_group:0,unit:'unit',selling_price_usd:1,branch_stock:[{branch_id:1,branch_name:'LC Store',quantity:window.physical}]}],total:1,pageSize:20,filters:{brands:[],categories:[],suppliers:[],initials:[]}});
window.fetch=async()=>new Response(JSON.stringify({items:[],entries:[],total:0}),{headers:{'Content-Type':'application/json'}});
const value={...FALLBACK_APP_CONTEXT,page:'products',user:{id:1,username:'admin',role_id:1,role:{permissions:{all:true}}},settings:{},language:params.get('lang')||'en',t:k=>p[k]||k,can:()=>true,getPermissionTier:()=> 'full',hasPermission:()=>true,notify:(...args)=>window.notices.push(args)};
function App(){const[sync,setSync]=React.useState(null);window.refresh=()=>setSync({channel:'inventory',ts:Date.now()});return <AppContext.Provider value={value}><SyncContext.Provider value={{syncChannel:sync,syncConnected:true,syncServerUnreachable:false}}><Products/></SyncContext.Provider></AppContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`
const matchers: Array<[RegExp, string]> = [
  [/\/AppContext(?:\.tsx)?$/, 'context'], [/\/actorReadScope\.ts$/, 'actor'], [/\/productReadTransport\.ts$/, 'read'],
  [/\/branchTransport\.ts$/, 'branches'], [/\/lookupTransport\.ts$/, 'lookups'], [/\/damagedLotsTransport\.ts$/, 'tagged'], [/\/productSearchIndex\.ts$/, 'search'],
]
const js = (await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' }, plugins: [{ name: 'products-refresh-seams', setup(b) {
  for (const [filter, name] of matchers) b.onResolve({ filter }, args => args.namespace === 'fixture' ? undefined : ({ path: name, namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: seams[args.path], loader: 'tsx', resolveDir: root }))
  if (before) b.onLoad({ filter: /[/\\]products[/\\]Products\.tsx$/ }, () => ({ contents: before, loader: 'tsx', resolveDir: resolve(root, 'src/components/products') }))
} }] })).outputFiles[0].text
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/app.js' ? js : '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/app.js"></script></body></html>')
})
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const address = server.address()
assert.ok(address && typeof address !== 'string')
type State = { reads: number; tagReads: number; writes: unknown[]; notices: Array<[string, string]>; actor: number; readMode: string; resolveRead: () => void; rejectRead: () => void; refresh: () => void }
try {
  for (const engine of [chromium, webkit]) {
    const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    const browser = await engine.launch({ headless: true, ...(engine === chromium && existsSync(chromePath) ? { executablePath: chromePath } : {}) })
    try {
      for (const language of ['en', 'km']) for (const kind of ['restore', 'dispose']) {
        const page = await browser.newPage({ viewport: { width: 375, height: 740 } })
        page.setDefaultTimeout(10000)
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        const url = `http://127.0.0.1:${address.port}/?lang=${language}&kind=${kind}`
        const label = packs[language][kind === 'dispose' ? 'stock_remove_entirely' : 'stock_tagged_restore']
        const ready = async () => {
          await page.goto(url)
          await expect(page.locator('[data-tagged-stock-row]').first()).toContainText('damaged')
        }
        const save = async () => {
          await page.locator('[data-tagged-stock-row]').first().getByRole('button', { name: label, exact: true }).click()
          const dialog = page.getByRole('dialog').last()
          await dialog.locator('input[type=number]').fill('0.1')
          await dialog.locator('input[type=text]').fill('Synthetic condition change')
          await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
        await ready()
        const reads = await page.evaluate(() => (window as unknown as State).reads)
        const tagReads = await page.evaluate(() => (window as unknown as State).tagReads)
        await page.evaluate(() => { (window as unknown as State).readMode = 'fail' })
        await save()
        await page.waitForFunction(n => (window as unknown as State).reads > n, reads)
        await page.waitForFunction(n => (window as unknown as State).tagReads > n, tagReads)
        if (before) {
          await expect(page.getByText('Refresh stock specimen', { exact: true })).toHaveCount(0)
          assert.equal(await page.evaluate(message => (window as unknown as State).notices.some(([text]) => text === message), packs[language].stock_tagged_refresh_failed), false)
          assert.equal(await page.evaluate(() => (window as unknown as State).writes.length), 1)
          assert.deepEqual(errors, [])
          console.log(`NEGATIVE CONTROL actual Products host ${engine.name()} ${language} ${kind}: confirmed write, tagged refresh succeeds, physical read failure clears rows silently`)
          await page.close()
          continue
        }
        await expect.poll(() => page.evaluate(message => (window as unknown as State).notices.some(([text]) => text === message), packs[language].stock_tagged_refresh_failed)).toBe(true)
        assert.equal(await page.evaluate(() => (window as unknown as State).writes.length), 1)
        assert.equal(await page.getByText('Refresh stock specimen', { exact: true }).count() > 0, true, 'failed reload preserves existing products')

        await ready()
        await page.evaluate(() => { const s = window as unknown as State; s.readMode = 'hold'; s.refresh() })
        await page.waitForFunction(() => typeof (window as unknown as State).resolveRead === 'function')
        const pendingReads = await page.evaluate(() => (window as unknown as State).reads)
        await save()
        await page.evaluate(() => { const s = window as unknown as State; s.readMode = 'fail'; s.resolveRead() })
        await page.waitForFunction(n => (window as unknown as State).reads > n, pendingReads)
        await expect.poll(() => page.evaluate(message => (window as unknown as State).notices.some(([text]) => text === message), packs[language].stock_tagged_refresh_failed)).toBe(true)

        await ready()
        await page.evaluate(() => { (window as unknown as State).readMode = 'hold' })
        await save()
        await page.waitForFunction(() => typeof (window as unknown as State).rejectRead === 'function')
        await page.evaluate(() => { const s = window as unknown as State; s.actor++; s.rejectRead() })
        await page.waitForTimeout(100)
        assert.equal(await page.evaluate(message => (window as unknown as State).notices.some(([text]) => text === message), packs[language].stock_tagged_refresh_failed), false, 'old actor gets no late refresh warning')
        assert.deepEqual(errors, [])
        console.log(`PASS actual Products host ${engine.name()} ${language} ${kind}: independent tagged success/physical failure, retained rows, trailing refresh failure, actor fence`)
        await page.close()
      }
    } finally { await browser.close() }
  }
} finally { await new Promise<void>(done => server.close(() => done())) }
