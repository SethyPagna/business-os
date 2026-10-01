import assert from 'node:assert/strict'
import { STATS_PRESETS } from '../src/components/shared/statsStripPresets.ts'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required')

const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import ReportsHub from '/src/components/sales/ReportsHub.tsx'
  import '/src/styles/main.css'
  const lang = new URLSearchParams(location.search).get('lang') || 'en'
  document.body.className = lang === 'km' ? 'lang-km' : ''
  createRoot(document.getElementById('root')).render(<ReportsHub />)
`

const appContextSource = String.raw`
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  export function useApp() {
    const lang = new URLSearchParams(location.search).get('lang') || 'en'
    const words = lang === 'km' ? km : en
    return {
      t: (key) => words[key] || key,
      fmtUSD: (value) => '$' + Number(value || 0).toFixed(2), fmtKHR: (value) => Number(value || 0).toFixed(0) + '៛',
      khrToUsd: (value) => Number(value || 0) / 4000, usdToKhr: (value) => Number(value || 0) * 4000,
      getPermissionTier: () => 'admin', can: () => true, settings: { pos_payment_methods: ['Cash'] },
    }
  }
`

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address(); assert.ok(address && typeof address !== 'string')
      probe.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const appPort = await freePort()
const fixtureId = '\0reports-composed-fixture'
const contextId = '\0reports-composed-app-context'
const vite = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'reports-composed-native-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:reports-composed-fixture') return fixtureId
      if (id.endsWith('/AppContext.tsx') || id.endsWith('\\AppContext.tsx')) return contextId
      return null
    },
    load(id) { return id === fixtureId ? fixtureSource : id === contextId ? appContextSource : null },
    async transform(code, id) {
      if (id !== fixtureId && id !== contextId) return null
      const transformed = await transformWithEsbuild(code, id === fixtureId ? 'reports-composed-fixture.tsx' : 'reports-context.ts', { loader: id === fixtureId ? 'tsx' : 'ts', jsx: 'automatic' })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/reports-composed-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.addEventListener("error",e=>document.body.dataset.fixtureError=String(e.error&&e.error.stack||e.message));window.addEventListener("unhandledrejection",e=>document.body.dataset.fixtureError=String(e.reason&&e.reason.stack||e.reason))</script><script>window.fetch=async()=>new Response(JSON.stringify({sales:{totals:{},payment_methods:[],couriers:[]},returns:{totals:{count:0},by_reason:[]},expenses:{totals:{count:0},by_type:[]},branches:[]}),{status:200,headers:{"content-type":"application/json"}})</script><script type="module" src="/@id/virtual:reports-composed-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/reports-composed-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-reports-composed-browser-'))
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${appPort}/reports-composed-fixture?lang=en`], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  return waitForBrowser(read, 'composed ReportsHub fixture', timeoutMs)
}
async function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  assert.ok(socket && socket.readyState === WebSocket.OPEN)
  const id = ++nextId
  const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  socket.send(JSON.stringify({ id, method, params })); return reply
}
async function evaluate<T>(expression: string): Promise<T> {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text || 'Browser evaluation failed')
  return reply.result.value as T
}
async function navigate(width: number, lang: 'en' | 'km'): Promise<void> {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 400, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/reports-composed-fixture?lang=${lang}` })
  await waitFor(async () => await evaluate<boolean>('Boolean(document.querySelector(".reports-frame-header") && document.querySelector(".reports-frame-menu button"))') ? true : null)
  const error = await evaluate<string | null>('document.body.dataset.fixtureError || null')
  assert.equal(error, null, `${width}px ${lang} fixture has no runtime error`)
}

let exitCode = 0
try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.includes('/reports-composed-fixture'))?.webSocketDebuggerUrl || null
    } catch { return null }
  })
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => { socket!.addEventListener('open', () => resolve(), { once: true }); socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true }) })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (!reply.id) return
    const waiter = pending.get(reply.id); if (!waiter) return
    pending.delete(reply.id); reply.error ? waiter.reject(new Error(reply.error.message || 'CDP command failed')) : waiter.resolve(reply.result)
  })
  await send('Runtime.enable'); await send('Page.enable')

  for (const width of [320, 390]) for (const lang of ['en', 'km'] as const) {
    await navigate(width, lang)
    const geometry = await evaluate<any>(`(() => {
      const header = document.querySelector('.reports-frame-header').getBoundingClientRect()
      const row = document.querySelector('.reports-title-actions')
      const picker = row.querySelector('.reports-view-picker').getBoundingClientRect()
      const filter = row.children[1].getBoundingClientRect()
      const show = row.children[2].getBoundingClientRect()
      const menu = document.querySelector('.reports-frame-menu').getBoundingClientRect()
      const dots = document.querySelector('.reports-frame-menu .lucide-more-horizontal')
      const expected = row.clientWidth - filter.width - show.width - 12
      const selected = row.querySelector('[data-app-select-selected=true]')
      return { viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, pickerWidth: picker.width, expected, tops: [picker.top, filter.top, show.top, menu.top], heights: [picker.height, filter.height, show.height, menu.height], dotsTransform: getComputedStyle(dots).transform, selectedClient: selected.clientWidth, selectedScroll: selected.scrollWidth, selectedText: selected.textContent }
    })()`)
    assert.equal(geometry.page, geometry.viewport, `${width}px ${lang} has no page-level horizontal overflow`)
    assert.ok(Math.abs(geometry.pickerWidth - geometry.expected) <= 2, `${width}px ${lang} report selector consumes the full remaining toolbar width`)
    assert.ok(Math.max(...geometry.tops) - Math.min(...geometry.tops) <= 1, `${width}px ${lang} selector, Filter, Show and menu share one row`)
    assert.deepEqual(geometry.heights.map(Math.round), [40, 40, 40, 40], `${width}px ${lang} toolbar controls share the 40px height`)
    assert.notEqual(geometry.dotsTransform, 'none', `${width}px ${lang} overflow dots use the Reports vertical transform`)
    assert.ok(geometry.selectedText.trim().length > 0, `${width}px ${lang} selected report has an accessible visible label`)
    assert.ok(geometry.selectedScroll >= geometry.selectedClient, `${width}px ${lang} selected label remains horizontally reachable without ellipsis clipping`)

    const externalPresets = await evaluate<number>(`document.querySelectorAll('[data-reports-hub] .reports-mobile-preset').length`)
    assert.equal(externalPresets, STATS_PRESETS.length, `${width}px ${lang} renders exactly one canonical preset rail`)
    await evaluate(`document.querySelector('[data-date-range-trigger-values]').closest('button').click()`)
    const panel = await waitFor(async () => await evaluate<any>(`(() => { const p=document.querySelector('[data-date-time-range-panel]'); if(!p)return null; const r=p.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:p.clientHeight,scroll:p.scrollHeight,overflow:getComputedStyle(p).overflowY,innerPresets:p.querySelectorAll('[data-date-time-range-presets] button').length } })()`))
    assert.equal(panel.innerPresets, 0, `${width}px ${lang} picker does not duplicate external presets`)
    assert.ok(panel.left >= 7 && panel.right <= width - 7 && panel.top >= 7 && panel.bottom <= 393, `${width}px ${lang} portaled picker stays within viewport`)
    assert.equal(panel.overflow, 'auto')
    assert.ok(panel.scroll > panel.client, `${width}px ${lang} expanded picker is internally scrollable`)
    const point = await evaluate<any>(`(() => { const r=document.querySelector('[data-date-time-range-panel]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 1200 })
    await waitFor(async () => (await evaluate<number>(`document.querySelector('[data-date-time-range-panel]').scrollTop`)) > 0 ? true : null)
    assert.equal(await evaluate<boolean>(`(() => { const p=document.querySelector('[data-date-time-range-panel]'); const last=[...p.querySelectorAll('button')].at(-1); const a=p.getBoundingClientRect(),b=last.getBoundingClientRect(); return b.top>=a.top&&b.bottom<=a.bottom })()`), true, `${width}px ${lang} final picker control is reachable by native scroll`)
  }
  const screenshotDirectory = process.env.BUSINESS_OS_SCREENSHOTS_DIR
  if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true })
  for (const width of [360, 1280]) for (const lang of ['en', 'km'] as const) {
    await navigate(width, lang)
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await evaluate('document.fonts.ready')
    const words = JSON.parse(fs.readFileSync(path.join(root, 'src/lang', `${lang}.json`), 'utf8')) as Record<string, string>
    const trigger = await evaluate<any>(`(() => { const track = document.querySelector('[data-date-range-trigger-values]'); const [start,,end] = track.children; const a=start.getBoundingClientRect(),b=end.getBoundingClientRect(); return { text:track.textContent, startTop:a.top,endTop:b.top,page:document.documentElement.scrollWidth,viewport:innerWidth } })()`)
    assert.equal(trigger.page, trigger.viewport, `${width}px ${lang} page stays within the viewport`)
    assert.equal(trigger.startTop, trigger.endTop, `${width}px ${lang} date endpoints share one row`)
    assert.match(trigger.text, /\d{2}\/\d{2}\/\d{4}/)
    const rail = await evaluate<any>(`(() => { const rail=document.querySelector('.reports-mobile-presets'); rail.scrollLeft=rail.scrollWidth; const right=rail.scrollLeft; rail.scrollLeft=0; return {count:rail.children.length,right,left:rail.scrollLeft,wrap:getComputedStyle(rail).flexWrap,tops:[...rail.children].map(c=>c.getBoundingClientRect().top)} })()`)
    assert.equal(rail.count, STATS_PRESETS.length)
    assert.equal(rail.wrap, 'nowrap')
    assert.equal(new Set(rail.tops).size, 1)
    assert.equal(rail.left, 0)
    if (width === 360) assert.ok(rail.right > 0, `${lang} presets scroll both ways`)
    if (screenshotDirectory) {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(screenshotDirectory, `reports-${lang}-${width}x800-closed.png`), Buffer.from(shot.data, 'base64'))
    }
    await evaluate(`document.querySelector('[data-date-range-trigger-values]').closest('button').click()`)
    await waitFor(async () => await evaluate<boolean>(`Boolean(document.querySelector('[data-date-time-range-panel] input[placeholder="HH:MM"]'))`) ? true : null)
    const controls = await evaluate<any>(`(() => { const panel=document.querySelector('[data-date-time-range-panel]'); return { labels:[...panel.querySelectorAll('[data-temporal-input-label]')].map(label=>{const l=label.getBoundingClientRect(),input=label.parentElement.querySelector('input'),r=input.getBoundingClientRect();return {text:label.textContent,left:l.left,right:l.right,top:l.top,bottom:l.bottom,inputLeft:r.left,inputRight:r.right,inputTop:r.top,inputBottom:r.bottom,visible:label.scrollWidth<=label.clientWidth+1}}), weekdays:[...panel.querySelectorAll('[data-date-range-weekday]')].map(d=>({text:d.textContent,width:d.clientWidth,scroll:d.scrollWidth})),times:[...panel.querySelectorAll('input[placeholder="HH:MM"]')].map(input=>({value:input.value,type:input.type,mode:input.inputMode})) } })()`)
    assert.deepEqual(controls.labels.map((label: any) => label.text), [words.range_start, words.range_end, words.start_time, words.end_time])
    for (const label of controls.labels) {
      assert.ok(label.left >= label.inputLeft && label.right <= label.inputRight + 1 && label.top >= label.inputTop && label.bottom <= label.inputBottom, `${width}px ${lang} ${label.text} sits inside its input`)
      assert.ok(label.visible, `${width}px ${lang} ${label.text} remains fully readable`)
    }
    assert.deepEqual(controls.weekdays.map((day: any) => day.text), Array.from({length:7},(_,index)=>words[`date_weekday_${index+1}`]))
    for (const day of controls.weekdays) assert.ok(day.scroll <= day.width + 1, `${width}px ${lang} ${day.text} stays within its calendar column`)
    assert.deepEqual(controls.times, [{value:'00:00',type:'text',mode:'numeric'},{value:'23:59',type:'text',mode:'numeric'}])
    if (screenshotDirectory) {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(screenshotDirectory, `reports-${lang}-${width}x800-picker.png`), Buffer.from(shot.data, 'base64'))
    }
  }
  console.log('PASS composed ReportsHub toolbar and portaled date picker at 320/390 EN/KM')
} catch (error) {
  exitCode = 1
  console.error('FAIL composed ReportsHub toolbar')
  console.error(error)
}
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
