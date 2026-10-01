import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(readFileSync(join(root, 'src/lang', language + '.json'), 'utf8'))]))
const fixture = String.raw`
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import DateTimeRangePicker from '/src/components/shared/DateTimeRangePicker.tsx'
import {TimeEntryInput} from '/src/components/shared/DateEntryInput.tsx'
import en from '/src/lang/en.json'
import km from '/src/lang/km.json'
import '@fontsource/noto-sans-khmer/400.css'
import '/src/styles/main.css'
const language=new URLSearchParams(location.search).get('lang')||'en'
const t=key=>(language==='km'?km:en)[key]||key
document.body.className=language==='km'?'lang-km':''
function Fixture(){
 const [range,setRange]=useState({startDate:'2026-09-30',endDate:'2026-09-30',startTime:'09:00',endTime:'23:59'})
 const [strict,setStrict]=useState('09:00')
 window.__range=range
 window.__strict=strict
 return <main className="p-4 max-w-lg"><DateTimeRangePicker value={range} onChange={setRange} t={t} continuous/>
 <div className="mt-4"><TimeEntryInput value={strict} onChange={setStrict} t={t} ariaLabel="ordinary-clock" advanceOnCommit={false}/></div></main>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const baseline = process.env.END24_BASELINE === '1'
const server = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'date-range-end24', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:date-range-end24') return '\0date-range-end24' },
    async load(id) {
      if (id === '\0date-range-end24') return (await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code
      if (baseline && id.replaceAll('\\', '/').endsWith('/src/components/shared/DateEntryInput.tsx')) return execFileSync('git', ['show', '0c7e72dc4ea19b22325cd3b859329d40d4742aa8:frontend/src/components/shared/DateEntryInput.tsx'], { cwd: root, encoding: 'utf8' })
    },
    configureServer(app) { app.middlewares.use('/date-range-end24', async (_request, response) => { response.setHeader('content-type', 'text/html'); response.end(await app.transformIndexHtml('/date-range-end24', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:date-range-end24"></script></body></html>')) }) },
  }],
})
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(candidate => candidate && existsSync(candidate))
const screenshotDir = process.env.END24_SCREENSHOT_DIR
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true })
await server.listen()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const address = server.httpServer!.address() as { port: number }
  for (const width of [360, 1280]) for (const language of ['en', 'km']) {
    const pack = packs[language]
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    try {
      await page.goto(`http://127.0.0.1:${address.port}/date-range-end24?lang=${language}`)
      await page.getByRole('button', { name: pack.date_time_range, exact: true }).click()
      const start = page.getByLabel(pack.start_time, { exact: true }), end = page.getByLabel(pack.end_time, { exact: true })
      await end.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('2400'); await page.keyboard.press('Tab')
      await page.waitForFunction(() => (window as any).__range.endTime === '24:00', null, { timeout: 2000 })
      assert.equal(await end.inputValue(), '24:00')
      for (const invalid of ['2401', '2430']) {
        await end.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(invalid); await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => (window as any).__range.endTime), '24:00')
        assert.equal(await end.getAttribute('aria-invalid'), 'true')
      }
      await end.fill('24:00:30'); await end.press('Tab')
      assert.equal(await page.evaluate(() => (window as any).__range.endTime), '24:00')
      assert.equal(await end.getAttribute('aria-invalid'), 'true')
      await end.fill('2400'); await end.press('Tab')
      await start.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('2400'); await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => (window as any).__range.startTime), '09:00')
      assert.equal(await start.getAttribute('aria-invalid'), 'true')
      await start.fill('0900'); await start.press('Tab')
      await page.waitForFunction(label => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.getAttribute('aria-invalid') !== 'true', pack.start_time)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      const bounds = await end.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 800)
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `range-end24-${width}-${language}.png`) })
      await page.locator('[data-date-time-range-panel]').getByRole('button', { name: pack.close, exact: true }).click()
      const ordinary = page.getByLabel('ordinary-clock')
      await ordinary.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('2400'); await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => (window as any).__strict), '09:00')
      assert.equal(await ordinary.getAttribute('aria-invalid'), 'true')
      console.log(`PASS actual trusted keyboard end24 and start/ordinary rejection ${width}x800 ${language}`)
    } finally { await page.close() }
  }
} finally { await browser?.close(); await server.close() }
