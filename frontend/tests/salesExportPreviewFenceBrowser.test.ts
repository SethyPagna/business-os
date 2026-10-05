import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(readFileSync(join(root, 'src/lang', language + '.json'), 'utf8'))]))
const fixture = String.raw`
import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import ExportModal from '/src/components/sales/ExportModal.tsx'
import {AppContext,FALLBACK_APP_CONTEXT} from '/src/app/AppContextCore.tsx'
import en from '/src/lang/en.json'
import km from '/src/lang/km.json'
import '@fontsource/noto-sans-khmer/400.css'
import '/src/styles/main.css'
const language=new URLSearchParams(location.search).get('lang')||'en'
const t=key=>(language==='km'?km:en)[key]||key
document.body.className=language==='km'?'lang-km':''
window.__requests=[]
window.__notices=[]
window.api={getSalesExport(query){return new Promise((resolve,reject)=>window.__requests.push({query,resolve,reject}))}}
window.__finish=(index,amount)=>{const request=window.__requests[index];request.resolve({period:{start:request.query.startDate,end:request.query.endDate},summary:{net_revenue_usd:amount}})}
window.alert=()=>{throw new Error('native alert() must not be used')}
function Fixture(){
 const [user,setUser]=useState({id:1,organization_id:7,role_code:'admin'})
 const [open,setOpen]=useState(true)
 window.__changeActor=()=>setUser({id:2,organization_id:9,role_code:'viewer'})
 window.__unmount=()=>setOpen(false)
 return <AppContext.Provider value={{...FALLBACK_APP_CONTEXT,t,language,user,notify:message=>window.__notices.push(message)}}>{open?<ExportModal t={t} fmtUSD={amount=>'$'+amount} onClose={()=>setOpen(false)}/>:null}</AppContext.Provider>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const server = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'sales-export-preview-fence',
    resolveId(id) { if (id === 'virtual:sales-export-preview-fence') return '\0sales-export-preview-fence' },
    async load(id) { if (id === '\0sales-export-preview-fence') return (await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code },
    configureServer(app) { app.middlewares.use('/sales-export-preview-fence', async (_request, response) => { response.setHeader('content-type', 'text/html'); response.end(await app.transformIndexHtml('/sales-export-preview-fence', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:sales-export-preview-fence"></script></body></html>')) }) },
  }],
})
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(candidate => candidate && existsSync(candidate))
const screenshotDir = process.env.SALES_EXPORT_FENCE_SCREENSHOT_DIR
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true })
await server.listen()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const address = server.httpServer!.address() as { port: number }
  for (const width of [360, 1280]) for (const language of ['en', 'km']) {
    const pack = packs[language]
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    page.on('pageerror', error => console.error('Fixture page error:', error.message))
    page.on('console', message => { if (message.type() === 'error') console.error('Fixture console:', message.text()) })
    try {
      await page.goto(`http://127.0.0.1:${address.port}/sales-export-preview-fence?lang=${language}`)
      const trigger = page.getByRole('button', { name: pack.date_time_range, exact: true })
      await trigger.waitFor({ timeout: 15000 }).catch(async error => {
        console.error('Fixture body:', await page.locator('body').innerText())
        console.error('Fixture buttons:', await page.locator('button').allTextContents())
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'fixture-failure.png') })
        throw error
      })
      await trigger.click()
      await page.locator('[data-date-time-range-panel]').waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), pack.preview_summary)
      await page.keyboard.press('Space')
      await page.waitForFunction(() => (window as any).__requests.length === 1)
      assert.equal(await page.locator('fieldset').evaluate(element => (element as HTMLFieldSetElement).disabled), true)
      assert.equal(await page.locator('[data-date-time-range-panel]').count(), 1)
      const start = page.getByLabel(pack.start_time, { exact: true }), end = page.getByLabel(pack.end_time, { exact: true })
      assert.equal(await start.isDisabled(), false)
      await start.fill('09:00'); await start.press('Tab'); await end.fill('11:00'); await end.press('Tab')
      assert.equal(await start.inputValue(), '09:00'); assert.equal(await end.inputValue(), '11:00')
      assert.equal(await page.locator('fieldset').evaluate(element => (element as HTMLFieldSetElement).disabled), false)
      await page.locator('[data-date-time-range-panel]').getByRole('button', { name: pack.close, exact: true }).click()
      await page.getByRole('button', { name: pack.preview_summary, exact: true }).click()
      await page.waitForFunction(() => (window as any).__requests.length === 2)
      assert.deepEqual(await page.evaluate(() => (window as any).__requests.map((request: any) => [request.query.startTime, request.query.endTime])), [['00:00', '23:59'], ['09:00', '11:00']])
      if (language === 'en') {
        await page.evaluate(() => (window as any).__finish(0, 987.65))
        await page.waitForTimeout(80)
        assert.equal(await page.getByText('$987.65', { exact: true }).count(), 0)
        assert.equal(await page.locator('fieldset').evaluate(element => (element as HTMLFieldSetElement).disabled), true)
        await page.evaluate(() => (window as any).__finish(1, 123))
      } else {
        await page.evaluate(() => (window as any).__finish(1, 123))
        await page.getByText('$123', { exact: true }).waitFor()
        await page.evaluate(() => (window as any).__finish(0, 987.65))
      }
      await page.getByText('$123', { exact: true }).waitFor()
      await page.waitForTimeout(80)
      assert.equal(await page.getByText('$987.65', { exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => (window as any).__notices.length), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `sales-export-preview-fence-summary-${width}-${language}.png`) })
      await trigger.click()
      await page.locator('[data-date-time-range-panel]').waitFor()
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `sales-export-preview-fence-picker-${width}-${language}.png`) })
      await page.keyboard.press('Tab'); await page.keyboard.press('Space')
      await page.waitForFunction(() => (window as any).__requests.length === 3)
      await page.evaluate(() => (window as any).__changeActor())
      await page.waitForFunction(() => !document.body.textContent?.includes('$123'))
      await page.evaluate(() => (window as any).__finish(2, 987.65))
      await page.waitForTimeout(80)
      assert.equal(await page.getByText('$987.65', { exact: true }).count(), 0)
      await page.locator('[data-date-time-range-panel]').getByRole('button', { name: pack.close, exact: true }).click()
      await page.getByRole('button', { name: pack.preview_summary, exact: true }).click()
      await page.waitForFunction(() => (window as any).__requests.length === 4)
      await page.evaluate(() => (window as any).__unmount())
      await page.evaluate(() => (window as any).__finish(3, 987.65))
      await page.waitForTimeout(80)
      assert.equal(await page.getByText('$987.65', { exact: true }).count(), 0)
      console.log(`PASS trusted keyboard portal range mutation, ${language === 'en' ? 'old-first' : 'new-first'} completion, actor and unmount ${width}x800 ${language}`)
    } finally { await page.close() }
  }
} finally { await browser?.close(); await server.close() }
