import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the native first-click regression')

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { useIntentLoadedPortalMenu } from './src/components/shared/LazyPortalMenu.tsx'

  let resolveLoad
  let rejectLoad
  let attempts = 0
  const controlledLoader = () => {
    attempts += 1
    window.__attempts = attempts
    return new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject })
  }

  function LoadedMenu({ trigger, defaultOpen }) {
    return <div data-loaded="true">{trigger}{defaultOpen ? <div role="menu">Opened</div> : null}</div>
  }

  function Harness() {
    const { PortalMenu, openOnLoad, preload, requestOpen } = useIntentLoadedPortalMenu(controlledLoader)
    const direct = new URLSearchParams(location.search).has('direct')
    const trigger = <button id="trigger" type="button" {...(direct ? { onPointerEnter: preload, onFocus: preload, onClick: requestOpen } : {})}>Manage</button>
    if (!PortalMenu) {
      if (direct) return trigger
      return <div id="wrapper" data-token="original" onPointerEnter={preload} onFocus={preload} onClickCapture={requestOpen}>{trigger}</div>
    }
    return <PortalMenu trigger={trigger} defaultOpen={openOnLoad} />
  }

  window.__resolveLoad = () => resolveLoad?.(LoadedMenu)
  window.__rejectLoad = () => rejectLoad?.(new Error('fixture load failed'))
  createRoot(document.getElementById('root')).render(<Harness />)
`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'lazy-menu-native-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
})
const bundle = built.outputFiles[0].text

const server = http.createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
})

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      const port = address.port
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

const appPort = await freePort()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(appPort, '127.0.0.1', () => resolve())
})

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-lazy-menu-browser-'))
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', () => resolve()))

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

async function ready(): Promise<void> {
  await waitFor(async () => evaluate<boolean>('Boolean(document.querySelector("#trigger") && window.__resolveLoad)').then((ok) => ok ? true : null))
}

async function reload(): Promise<void> {
  await send('Page.reload', { ignoreCache: true })
  await ready()
}

async function navigate(search = ''): Promise<void> {
  await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/${search}` })
  await ready()
}

async function pointerPoint(): Promise<{ x: number; y: number }> {
  return evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('#trigger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
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
  await send('Page.enable')
  await ready()

  const point = await pointerPoint()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await waitFor(async () => (await evaluate<number>('window.__attempts || 0')) === 1 ? true : null)
  await evaluate('window.__resolveLoad()')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(await evaluate<string | null>('document.querySelector("#wrapper")?.dataset.token || null'), 'original', 'prefetch completion must not replace the pressed trigger')
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  await waitFor(async () => await evaluate<boolean>('Boolean(document.querySelector("[role=menu]"))') ? true : null)

  await navigate('?direct=1')
  const directPoint = await pointerPoint()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...directPoint })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...directPoint })
  await waitFor(async () => (await evaluate<number>('window.__attempts || 0')) === 1 ? true : null)
  await evaluate('window.__resolveLoad()')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector("#trigger"))'), true, 'direct ExportMenu-style prefetch must retain its pressed trigger')
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...directPoint })
  await waitFor(async () => await evaluate<boolean>('Boolean(document.querySelector("[role=menu]"))') ? true : null)

  await navigate()
  await evaluate('document.querySelector("#trigger").focus()')
  await waitFor(async () => (await evaluate<number>('window.__attempts || 0')) === 1 ? true : null)
  await evaluate('window.__resolveLoad()')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(await evaluate<string | null>('document.querySelector("#wrapper")?.dataset.token || null'), 'original', 'keyboard prefetch must keep the focused trigger mounted')
  assert.equal(await evaluate<string>('document.activeElement?.id || ""'), 'trigger')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
  await waitFor(async () => await evaluate<boolean>('Boolean(document.querySelector("[role=menu]"))') ? true : null)

  await reload()
  await evaluate('document.querySelector("#trigger").focus()')
  await waitFor(async () => (await evaluate<number>('window.__attempts || 0')) === 1 ? true : null)
  await evaluate('window.__rejectLoad()')
  await new Promise((resolve) => setTimeout(resolve, 25))
  await evaluate('document.querySelector("#trigger").click()')
  await waitFor(async () => (await evaluate<number>('window.__attempts || 0')) === 2 ? true : null)
  await evaluate('window.__resolveLoad()')
  await waitFor(async () => await evaluate<boolean>('Boolean(document.querySelector("[role=menu]"))') ? true : null)

  console.log('PASS lazy and export menu native first pointer, keyboard, and failed-import retry gestures')
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }))
  }
  const exitedCleanly = await Promise.race([
    browserExit.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!exitedCleanly) {
    if (process.platform === 'win32' && browser.pid) {
      spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      browser.kill()
    }
    await Promise.race([browserExit, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  }
  for (const waiter of pending.values()) waiter.reject(new Error('Browser closed'))
  pending.clear()
  socket?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 100))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
