import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
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
assert.ok(browserPath, 'A local Chromium or Edge executable is required')

const sidebar = fs.readFileSync(path.join(root, 'src/components/navigation/Sidebar.tsx'), 'utf8')
assert.equal((sidebar.match(/getMobileSectionIcon/g) || []).length, 2, 'the icon map is imported and used only by the expanded section branch')
assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/components/shared/HubSectionNav.tsx'), 'utf8'), /getMobileSectionIcon|SectionIcon/, 'content-level hub navigation does not gain duplicate icons')

const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import Sidebar from '/src/components/navigation/Sidebar.tsx'
  import '/src/styles/main.css'

  createRoot(document.getElementById('root')).render(<Sidebar mobileHeaderVisible showQuickPreferences={false} />)
`

const contextSource = String.raw`
  import { useSyncExternalStore } from 'react'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'

  let language = 'en'
  const listeners = new Set()
  window.__sidebarNavigateCalls = []
  window.__setSidebarLanguage = (next) => { language = next; document.body.className = next === 'km' ? 'lang-km' : ''; listeners.forEach((listener) => listener()) }
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
  const readLanguage = () => language

  export function useApp() {
    const currentLanguage = useSyncExternalStore(subscribe, readLanguage, readLanguage)
    const pack = currentLanguage === 'km' ? km : en
    return {
      page: 'products',
      navigateTo: (page, anchor) => window.__sidebarNavigateCalls.push({ page, anchor }),
      user: { name: 'Admin', role_name: 'Administrator', avatar_path: null },
      logout: () => {},
      t: (key) => pack[key] || key,
      settings: { language: currentLanguage, ui_mobile_section_nav: 'pages', ui_nav_order: [], ui_mobile_pinned: [] },
      hasPermission: () => true,
      getPermissionTier: () => 'full',
      can: () => true,
      canAccessPage: () => true,
      syncUrl: null,
      syncConnected: false,
    }
  }
`

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const appPort = await freePort()
const fixtureId = '\0bos-mobile-section-fixture'
const contextId = '\0bos-mobile-section-context'
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'mobile-section-menu-fixture',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'virtual:bos-mobile-section-fixture') return fixtureId
      if (id === '../../AppContext.tsx' && importer?.replaceAll('\\', '/').endsWith('/components/navigation/Sidebar.tsx')) return contextId
      return null
    },
    load(id) {
      if (id === fixtureId) return fixtureSource
      if (id === contextId) return contextSource
      return null
    },
    async transform(code, id) {
      if (id !== fixtureId && id !== contextId) return null
      const transformed = await transformWithEsbuild(code, id === fixtureId ? 'mobile-section-fixture.tsx' : 'mobile-section-context.ts', {
        loader: id === fixtureId ? 'tsx' : 'ts', jsx: 'automatic',
      })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/mobile-section-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.addEventListener("error",function(event){document.body.dataset.fixtureError=String(event.error&&event.error.stack||event.message)});window.addEventListener("unhandledrejection",function(event){document.body.dataset.fixtureError=String(event.reason&&event.reason.stack||event.reason)})</script><script type="module" src="/@id/virtual:bos-mobile-section-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/mobile-section-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-mobile-section-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/mobile-section-fixture`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: any }
const COLD_START_TIMEOUT_MS = 60_000
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const browserDiagnostics: string[] = []

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  // A read that THROWS is "not ready yet", not a failure. Every read here is a
  // `Runtime.evaluate` over a page that may still be navigating or compiling a
  // module, so a transient CDP error used to escape this loop and end the file
  // before a single assertion ran -- roughly one run in three under load. Only
  // the deadline ends the wait now; the last error travels with the timeout so
  // a persistent fault is still diagnosable rather than a bare "timed out".
  // Same shape as stockChangeComposedResponsive.test.ts, which already had it.
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null) return value
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out waiting for mobile section fixture; last=${lastError || 'no value'}`)
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
async function setViewport(width: number): Promise<void> {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: true })
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const owners = ['products', 'sales', 'branches', 'contacts', 'promotions', 'settings', 'review']

try {
  let target: string
  try {
    target = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
        const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
        return targets.find((item) => item.type === 'page' && item.url?.includes('/mobile-section-fixture'))?.webSocketDebuggerUrl || null
      } catch { return null }
    }, COLD_START_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; browser discovery failed (exit=${browser.exitCode ?? 'running'}, debugPort=${debugPort}, appPort=${appPort})`)
  }
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (!reply.id && reply.method) {
      if (reply.method === 'Runtime.exceptionThrown') browserDiagnostics.push(`exception: ${reply.params?.exceptionDetails?.text || 'unknown'}`)
      if (reply.method === 'Log.entryAdded') browserDiagnostics.push(`log: ${reply.params?.entry?.level || 'unknown'} ${reply.params?.entry?.text || ''}`)
      return
    }
    if (!reply.id) return
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.error) waiter.reject(new Error(reply.error.message || 'CDP command failed'))
    else waiter.resolve(reply.result)
  })
  await send('Runtime.enable')
  await send('Log.enable')
  await setViewport(320)
  try {
    await waitFor(async () => await evaluate<boolean>(`document.querySelector('[data-bos-mobile-header=inline]') !== null`) ? true : null, COLD_START_TIMEOUT_MS)
  } catch (error) {
    const diagnostics = await evaluate(`JSON.stringify({ readyState: document.readyState, error: document.body.dataset.fixtureError, body: document.body.textContent, html: document.documentElement.outerHTML.slice(0, 1000), resources: performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize })) })`)
    throw new Error(`${error instanceof Error ? error.message : String(error)}; browser=${JSON.stringify(browserDiagnostics)}; page=${diagnostics}`)
  }
  await evaluate(`document.querySelector('button[aria-controls="mobile-nav-layer"]').click()`)
  await waitFor(async () => await evaluate<boolean>(`document.querySelector('[data-bos-nav-layer=pages]') !== null`) ? true : null)

  for (const width of [320, 390]) {
    await setViewport(width)
    for (const language of ['en', 'km']) {
      await evaluate(`window.__setSidebarLanguage('${language}')`)
      for (const owner of owners) {
        const selector = `[data-bos-section^="${owner}:"]`
        const alreadyOpen = await evaluate<boolean>(`document.querySelector('${selector}') !== null`)
        if (!alreadyOpen) {
          await evaluate(`document.querySelector('[data-bos-nav-layer=pages] [data-bos-nav-id="${owner}"]').click()`)
          await waitFor(async () => await evaluate<boolean>(`document.querySelector('${selector}') !== null`) ? true : null)
        }
        const geometry = await evaluate<any>(`(() => {
          const buttons = Array.from(document.querySelectorAll('${selector}'))
          return {
            viewport: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            layerClient: document.querySelector('[data-bos-nav-layer=pages]').clientWidth,
            layerScroll: document.querySelector('[data-bos-nav-layer=pages]').scrollWidth,
            buttons: buttons.map((button) => {
              const icon = button.querySelector('svg')
              const label = button.querySelector('span')
              const iconRect = icon.getBoundingClientRect()
              const labelRect = label.getBoundingClientRect()
              const buttonRect = button.getBoundingClientRect()
              return { text: label.textContent.trim(), iconHidden: icon.getAttribute('aria-hidden'), iconAbove: iconRect.bottom <= labelRect.top + 0.5, labelFits: label.scrollWidth <= label.clientWidth + 1, left: buttonRect.left, right: buttonRect.right }
            }),
          }
        })()`)
        assert.equal(geometry.documentWidth, geometry.viewport, `${width}px ${language} ${owner}: document has no horizontal overflow`)
        assert.ok(geometry.layerScroll <= geometry.layerClient + 1, `${width}px ${language} ${owner}: page-selection layer has no horizontal overflow`)
        assert.ok(geometry.buttons.length > 0, `${owner} renders its permitted subpages`)
        for (const button of geometry.buttons) {
          assert.ok(button.text.length > 0, `${owner} exposes the complete translated title`)
          assert.equal(button.iconHidden, 'true', `${owner}:${button.text} decorative icon does not duplicate the accessible name`)
          assert.equal(button.iconAbove, true, `${owner}:${button.text} icon is above its title`)
          assert.equal(button.labelFits, true, `${owner}:${button.text} title wraps without clipping`)
          assert.ok(button.left >= 0 && button.right <= geometry.viewport + 0.5, `${owner}:${button.text} tile stays in the viewport`)
        }
      }
    }
  }

  assert.equal(await evaluate<number>(`window.__sidebarNavigateCalls.length`), 0, 'opening and switching groups never navigates or trips the dirty guard')
  await evaluate(`document.querySelector('[data-bos-nav-layer=pages] [data-bos-nav-id="sales"]').click()`)
  await waitFor(async () => await evaluate<boolean>(`document.querySelector('[data-bos-section="sales:returns"]') !== null`) ? true : null)
  await evaluate(`document.querySelector('[data-bos-section="sales:returns"]').click()`)
  assert.deepEqual(await evaluate(`window.__sidebarNavigateCalls`), [{ page: 'sales', anchor: 'hub:sales:returns' }], 'a subpage click retains the existing guarded route contract')
  console.log('PASS actual mobile Sidebar renders distinct icons above fully wrapping EN/KM subpage titles at 320/390 without overflow')
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }))
  const exited = await Promise.race([browserExit.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])
  if (!exited) {
    if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
    else browser.kill()
    await Promise.race([browserExit, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  }
  for (const waiter of pending.values()) waiter.reject(new Error('Browser closed'))
  pending.clear()
  socket?.close()
  await vite.close()
  removeBrowserProfile(profile)
}
finishBrowserTest()
