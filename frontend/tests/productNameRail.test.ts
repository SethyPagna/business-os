import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { finishBrowserTest, removeBrowserProfile } from './browserProfileTeardown.ts'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the native pagination regression')

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import ProductNameRail from './src/components/shared/ProductNameRail.tsx'
  window.__names = ['Short name', 'Natural product name with two readable lines',
    'Long product name with useful details and complete text '.repeat(20).trim(),
    'ផលិតផលថែរក្សាស្បែកសម្រាប់សម្រស់និងសុខភាព'.repeat(20),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(40)]
  createRoot(document.getElementById('root')).render(
    <div style={{width:'calc(100vw - 64px)',fontSize:18,lineHeight:'28px',fontWeight:700}}>
      {window.__names.map((name,index)=><div key={index} data-case={index}><ProductNameRail name={name}/></div>)}
    </div>)
`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'product-name-rail-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
})
const bundle = built.outputFiles[0].text

const server = http.createServer((request, response) => {
  if (request.url === '/khmer.woff2') {
    response.writeHead(200, { 'content-type': 'font/woff2' })
    response.end(fs.readFileSync(path.join(root, 'node_modules/@fontsource/noto-sans-khmer/files/noto-sans-khmer-khmer-700-normal.woff2')))
    return
  }
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><html><head><style>@font-face{font-family:FixtureKhmer;src:url(/khmer.woff2);font-weight:700}body{font-family:FixtureKhmer,Arial,sans-serif}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
})

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      probe.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const appPort = await freePort()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(appPort, '127.0.0.1', resolve)
})

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-product-name-rail-'))
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error('Timed out waiting for browser state')
}

async function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  assert.ok(socket && socket.readyState === WebSocket.OPEN)
  const id = ++nextId
  const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  socket.send(JSON.stringify({ id, method, params }))
  return reply
}

async function evaluate<T>(expression: string): Promise<T> {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text || 'Browser evaluation failed')
  return reply.result.value as T
}

try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.startsWith(`http://127.0.0.1:${appPort}/`))?.webSocketDebuggerUrl || null
    } catch { return null }
  })
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (!reply.id) return
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.error) waiter.reject(new Error(reply.error.message || 'CDP command failed'))
    else waiter.resolve(reply.result)
  })
  await send('Runtime.enable')

  await waitFor(async () => await evaluate('document.querySelectorAll(".product-name-rail").length === 5') ? true : null)
  await evaluate('document.fonts.ready.then(()=>true)')
  assert.equal(await evaluate('document.fonts.check("700 18px FixtureKhmer")'), true, 'bundled Khmer font loaded')
  const names = await evaluate<string[]>('window.__names')
  for (const width of [320,390,1200]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
    // No more nested column span: the rail IS the text node's direct
    // parent, so selecting/measuring reads straight off it.
    const metrics = await evaluate<Array<{height:number;clientHeight:number;scrollHeight:number;weight:string;copy:boolean;full:boolean;clipped:boolean;hasReveal:boolean;title:string|null}>>(`Array.from(document.querySelectorAll('.product-name-rail'),(rail,index)=>{
      const style=getComputedStyle(rail)
      const range=document.createRange();range.selectNodeContents(rail)
      window.getSelection().removeAllRanges();window.getSelection().addRange(range)
      return {height:rail.getBoundingClientRect().height, clientHeight:rail.clientHeight,scrollHeight:rail.scrollHeight,
        weight:style.fontWeight,
        copy:window.getSelection().toString()===window.__names[index],
        full:rail.textContent===window.__names[index],
        clipped:rail.scrollHeight>rail.clientHeight+1,
        hasReveal:rail.hasAttribute('data-reveal-text'),
        title:rail.getAttribute('title')}
    })`)
    for(const [index,item] of metrics.entries()) {
      assert.ok(item.height<=56.5,`no more than two inherited 28px lines (case ${index} width ${width})`)
      // scrollWidth never exceeds clientWidth here: word wrap keeps the box
      // inside its own column, unlike the old horizontal-scroll rail.
      assert.equal(item.weight,'700','parent font weight inherited')
      assert.equal(item.copy,true,`entire Unicode name selectable without CSS or ellipsis case ${index} width ${width}`)
      assert.equal(item.full,true,`full text stays in the DOM even when the clamp hides part of it (case ${index} width ${width})`)
      assert.equal(item.hasReveal,true,'every rail opts into the shared reveal controller, clipped or not')
      if(index===0) {
        assert.equal(item.clipped,false,'short one-line name is not clipped')
        assert.equal(item.title,null,'a name that fits carries no title -- nothing to reveal')
      }
      if(index>=2) {
        assert.equal(item.clipped,true,`long name case ${index} width ${width} must be clamped to two lines, not grown to fit`)
        assert.equal(item.title,names[index],'clipped names carry their own title as a native fallback')
      }
    }
    for (const index of [2,3,4]) {
      // Same clamped-name cases the old test scrolled to reach; the reveal
      // is now the shared hover float (textAffordances.ts), not local
      // keyboard scrolling -- there is nothing left inside the rail to pan.
      await evaluate(`document.querySelector('[data-case="${index}"] .product-name-rail').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`)
      await new Promise((resolve) => setTimeout(resolve, 600))
      const revealed = await evaluate<{open:boolean;text:string}>(`(()=>{const panel=document.querySelector('.text-affordance-float');return {open:!!panel && !panel.hasAttribute('hidden'), text:panel?.querySelector('.text-affordance-value')?.textContent || ''}})()`)
      assert.equal(revealed.open,true,`case ${index} width ${width}: hover opens the shared reveal float`)
      assert.equal(revealed.text,names[index],`case ${index} width ${width}: the float shows the complete, un-clamped name`)
      await evaluate(`document.querySelector('[data-case="${index}"] .product-name-rail').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`)
    }
  }
  console.log('PASS product name rail native 320/390/1200: natural two-line wrap and clamp, EN/KM/unbroken full text, shared hover reveal, selection and inherited weight')

} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }))
  const exitedCleanly = await Promise.race([browserExit.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])
  if (!exitedCleanly) {
    if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
    else browser.kill()
    await Promise.race([browserExit, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  }
  for (const waiter of pending.values()) waiter.reject(new Error('Browser closed'))
  pending.clear()
  socket?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 100))
  removeBrowserProfile(profile)
}
finishBrowserTest()
