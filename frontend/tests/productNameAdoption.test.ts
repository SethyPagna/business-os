import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { finishBrowserTest, removeBrowserProfile } from './browserProfileTeardown.ts'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const styles = await require('postcss')([require('tailwindcss')({
  content: [path.join(root, 'src/components/pos/ProductCard.tsx')],
})]).process('@tailwind base; @tailwind utilities;', { from: undefined })
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
  import ProductCard from './src/components/pos/ProductCard.tsx'
  window.__names = ['Short name', 'Natural product name with two readable lines',
    'Long product name with useful details and complete text '.repeat(20).trim(),
    'ផលិតផលថែរក្សាស្បែកសម្រាប់សម្រស់និងសុខភាព'.repeat(20),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(40)]
  window.__opens=[];window.__images=0
  createRoot(document.getElementById('root')).render(
    <div style={{width:'calc(100vw - 64px)',fontSize:18,lineHeight:'28px',fontWeight:700}}>
      {window.__names.map((name,index)=><div key={index} data-case={index}><ProductCard product={{id:index+1,name,selling_price_usd:1,quantity:20,unit:'pcs',tag_label:'tag'}} variants={[]} groupMeta={null} getStock={()=>20} lowStockConfig={{enabled:true,mode:'product',defaultThreshold:10}} promotionRules={[]} exchangeRate={4000} fmtUSD={String} fmtKHR={String} t={key=>key} copy={en=>en} onOpen={options=>window.__opens.push(options)} onOpenImage={()=>window.__images++}/></div>)}
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
    response.end(fs.readFileSync(path.join(root, 'node_modules/@fontsource/noto-sans-khmer/files/noto-sans-khmer-khmer-500-normal.woff2')))
    return
  }
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`<!doctype html><html><head><style>${styles.css}@font-face{font-family:FixtureKhmer;src:url(/khmer.woff2);font-weight:500}body{font-family:FixtureKhmer,Arial,sans-serif}.khmer-text{font-family:FixtureKhmer;line-height:1.6}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
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
  assert.equal(await evaluate('document.fonts.check("500 12px FixtureKhmer")'), true, 'bundled Khmer font loaded')
  for (const width of [320,390,1200]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
    const metrics = await evaluate<Array<{height:number;lineHeight:number;clientHeight:number;scrollHeight:number;weight:string;bar:string;overflow:boolean;copy:boolean;full:boolean;lines:number}>>(`Array.from(document.querySelectorAll('.product-name-rail'),(rail,index)=>{
      const text=rail.firstElementChild, style=getComputedStyle(rail)
      const range=document.createRange();range.selectNodeContents(text)
      window.getSelection().removeAllRanges();window.getSelection().addRange(range)
      return {height:rail.getBoundingClientRect().height, lineHeight:parseFloat(style.lineHeight), clientHeight:rail.clientHeight,scrollHeight:rail.scrollHeight,
        weight:style.fontWeight,bar:style.scrollbarWidth,overflow:rail.scrollWidth>rail.clientWidth,
        copy:window.getSelection().toString()===window.__names[index],
        full:text.textContent===window.__names[index],lines:new Set([...range.getClientRects()].map(r=>r.top)).size}
    })`)
    for(const [index,item] of metrics.entries()) {
      assert.ok(item.height<=2*item.lineHeight+0.5,'no more than two inherited lines with real card utilities')
      assert.ok(item.scrollHeight<=item.clientHeight+1,'no vertical spill')
      assert.equal(item.weight,'500','actual card medium font weight inherited')
      assert.equal(item.bar,'none','scrollbar hidden only on component')
      assert.equal(item.copy,true,`entire Unicode name selectable without CSS or ellipsis case ${index} width ${width}`)
      assert.equal(item.full,true)
      if(index===0) assert.equal(item.overflow,false,'short name needs no scrolling')
      if(index>=2) assert.equal(item.overflow,true,'all long names have reachable horizontal overflow')
    }
    assert.equal(metrics[0].lines,1,'short name remains one naturally wrapped line')
    if(width===320) assert.equal(metrics[1].lines,2,'ordinary name wraps into two lines before overflow')
    for (const index of [2,3,4]) {
      await evaluate(`document.querySelector('[data-case="${index}"] .product-name-rail').focus()`)
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35})
      const tail=await evaluate<{scroll:number;visible:boolean}>(`(()=>{
        const rail=document.activeElement,text=rail.firstElementChild.firstChild,range=document.createRange()
        range.setStart(text,text.length-1);range.setEnd(text,text.length)
        const r=range.getBoundingClientRect(),box=rail.getBoundingClientRect()
        return {scroll:rail.scrollLeft,visible:r.left>=box.left-1&&r.right<=box.right+1}
      })()`)
      assert.ok(tail.scroll>0,'keyboard End scrolls beyond initial two lines')
      assert.equal(tail.visible,true,'final character visible at horizontal end')
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36})
      assert.equal(await evaluate('document.activeElement.scrollLeft'),0)
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
      assert.ok(await evaluate('document.activeElement.scrollLeft>0'),'arrow key advances overflow')
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37})
      assert.equal(await evaluate('document.activeElement.scrollLeft'),0)
    }
  }

  assert.equal(await evaluate('window.__opens.length'),0,'scrolling never opens a product')
  await evaluate('document.querySelector(".product-name-rail").click()')
  assert.equal(await evaluate('window.__opens.length'),1,'name tap still opens the card once')
  assert.deepEqual(await evaluate('window.__opens[0]'),{groupProduct:false,inStock:true})
  await evaluate('document.querySelector("[data-case=\\\"0\\\"] button").click()')
  assert.equal(await evaluate('window.__images'),1,'image tap retains image action')
  assert.equal(await evaluate('window.__opens.length'),1,'image tap does not open product')
  await evaluate('document.querySelector("[data-case=\\\"0\\\"] [role=button]").focus()')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:String.fromCharCode(13),windowsVirtualKeyCode:13})
  assert.equal(await evaluate('window.__opens.length'),2,'card Enter action preserved')
  console.log('PASS actual ProductCard EN/KM name rail at320/390/1200 with card/image actions preserved')

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
