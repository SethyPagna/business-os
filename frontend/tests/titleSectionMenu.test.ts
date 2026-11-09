import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

// The real Sidebar in headless Chrome at 360x740: the mobile title is a button that expands the page's
// subpage titles inline, as plain text with no arrow or box, above a sticky row and a floating layer;
// the open one is marked by weight and colour, a pick navigates and collapses, a second tap on the
// title, Escape or an outside tap collapses. TITLE_MENU_SCREENSHOT_DIR, when set, receives one screenshot per case.

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

const sidebarSource = fs.readFileSync(path.join(root, 'src/components/navigation/Sidebar.tsx'), 'utf8')
assert.match(sidebarSource, /<SectionTitleMenu[\s\S]*sections=\{moreOpen \? \[\] : currentSections\.map/, 'the bar title is the section menu, fed the page\'s own destinations')

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
  window.__sidebarPage = 'products'
  window.__setSidebarPage = (next) => { window.__sidebarPage = next; version++; listeners.forEach((listener) => listener()) }
  window.__setSidebarLanguage = (next) => { language = next; document.body.className = next === 'km' ? 'lang-km' : ''; version++; listeners.forEach((listener) => listener()) }
  let version = 0
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
  const readVersion = () => version

  export function useApp() {
    useSyncExternalStore(subscribe, readVersion, readVersion)
    const pack = language === 'km' ? km : en
    return {
      page: window.__sidebarPage,
      navigateTo: (page, anchor) => window.__sidebarNavigateCalls.push({ page, anchor }),
      user: { name: 'Admin', role_name: 'Administrator', avatar_path: null },
      logout: () => {},
      t: (key) => pack[key] || key,
      settings: { language, ui_mobile_section_nav: 'pages', ui_nav_order: [], ui_mobile_pinned: [] },
      hasPermission: () => true,
      getPermissionTier: () => 'full',
      can: () => true,
      canAccessPage: () => true,
      syncUrl: null,
    }
  }

  export function useSync() {
    return { syncConnected: false, syncChannel: null, syncServerUnreachable: false }
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
const fixtureId = '\0bos-title-menu-fixture'
const contextId = '\0bos-title-menu-context'
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'title-menu-fixture',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'virtual:bos-title-menu-fixture') return fixtureId
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
      const transformed = await transformWithEsbuild(code, id === fixtureId ? 'title-menu-fixture.tsx' : 'title-menu-context.ts', {
        loader: id === fixtureId ? 'tsx' : 'ts', jsx: 'automatic',
      })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/title-menu-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.addEventListener("error",function(event){document.body.dataset.fixtureError=String(event.error&&event.error.stack||event.message)});window.addEventListener("unhandledrejection",function(event){document.body.dataset.fixtureError=String(event.reason&&event.reason.stack||event.reason)})</script><script type="module" src="/@id/virtual:bos-title-menu-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/title-menu-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-title-menu-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/title-menu-fixture`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: any }
const COLD_START_TIMEOUT_MS = 60_000
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const browserDiagnostics: string[] = []

function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  return waitForBrowser(read, 'title menu fixture', timeoutMs)
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
const menuOpen = async () => await evaluate<boolean>(`document.querySelector('[data-bos-title-menu-layer]') !== null`)

const SCREENSHOT_DIR = process.env.TITLE_MENU_SCREENSHOT_DIR || ''
const pages: Array<[string, string, string[], string]> = [
  ['products', 'hub:products:products', ['products', 'stock_changes', 'stock_in_sessions', 'duplicates'], 'products'],
  ['products', 'hub:products:stock_changes', ['products', 'stock_changes', 'stock_in_sessions', 'duplicates'], 'stock-changes'],
  ['sales', 'hub:sales:returns', ['sales', 'returns', 'fees', 'reports'], 'sales'],
  ['inventory', 'hub:inventory:sessions', ['products', 'sessions', 'issues'], 'inventory'],
]

async function openPage(page: string, anchor: string): Promise<void> {
  await evaluate(`(() => { history.replaceState(null, '', '/${anchor ? '#' + anchor : ''}'); window.__setSidebarPage('${page}'); window.dispatchEvent(new CustomEvent('bos:navigation', { detail: { page: '${page}', path: '/', anchor: '${anchor}' } })) })()`)
}

let exitCode = 0
try {
  let target: string
  try {
    target = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
        const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
        return targets.find((item) => item.type === 'page' && item.url?.includes('/title-menu-fixture'))?.webSocketDebuggerUrl || null
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
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true })
  await waitFor(async () => await evaluate<boolean>(`document.querySelector('[data-bos-mobile-header=inline]') !== null`) ? true : null, COLD_START_TIMEOUT_MS)

  // A sticky row and a floating layer that must not cover the menu.
  await evaluate(`(() => {
    const row = document.createElement('div'); row.id = 'fake-sticky'; row.style.cssText = 'position:sticky;top:64px;z-index:30;height:200px;background:#fee'; document.body.appendChild(row)
    const fab = document.createElement('button'); fab.id = 'fake-float'; fab.textContent = 'FAB'; fab.style.cssText = 'position:fixed;left:8px;top:90px;width:300px;height:300px;z-index:1100;background:#cfc'; document.body.appendChild(fab)
  })()`)

  for (const theme of ['light', 'dark']) for (const language of ['en', 'km']) {
    await evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
    await evaluate(`window.__setSidebarLanguage('${language}')`)
    for (const [page, anchor, ids, shotName] of pages) {
      await openPage(page, anchor)
      const trigger = `[data-bos-title-menu="${page}"]`
      await waitFor(async () => await evaluate<boolean>(`document.querySelector('${trigger}') !== null`) ? true : null)
      const barLine = await evaluate<string>(`getComputedStyle(document.querySelector('header')).borderBottomColor`)
      assert.notEqual(barLine, 'rgba(0, 0, 0, 0)', `${theme} ${language} ${page}: the closed bar keeps its divider`)
      const stickyBefore = await evaluate<number>(`document.getElementById('fake-sticky').getBoundingClientRect().top`)
      const closed = await evaluate<any>(`(() => { const b = document.querySelector('${trigger}'); return { tag: b.tagName, expanded: b.getAttribute('aria-expanded'), svg: b.querySelector('svg') !== null, list: document.querySelector('[data-bos-title-menu-layer]') !== null } })()`)
      assert.deepEqual(closed, { tag: 'BUTTON', expanded: 'false', svg: false, list: false }, `${language} ${page}: the title is a button with no arrow and the list starts collapsed`)

      await evaluate(`document.activeElement?.blur()`)
      await evaluate(`document.querySelector('${trigger}').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`)
      await waitFor(async () => await menuOpen() ? true : null)
      const open = await evaluate<any>(`(() => {
        const menu = document.getElementById('mobile-section-menu')
        const items = Array.from(menu.querySelectorAll('[data-bos-title-menu-item]'))
        const hit = (el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === el || el.contains(top) }
        const rect = menu.getBoundingClientRect()
        return {
          expanded: document.querySelector('${trigger}').getAttribute('aria-expanded'),
          ids: items.map((i) => i.getAttribute('data-bos-title-menu-item')),
          checked: items.filter((i) => i.getAttribute('aria-current') === 'page').map((i) => i.getAttribute('data-bos-title-menu-item')),
          reachable: items.every(hit),
          labels: items.map((i) => i.textContent.trim()),
          inside: rect.left >= 0 && rect.right <= document.documentElement.clientWidth && rect.bottom <= innerHeight,
          zMenu: Number(getComputedStyle(menu).zIndex),
          zSticky: Number(getComputedStyle(document.getElementById('fake-sticky')).zIndex),
          zFloat: Number(getComputedStyle(document.getElementById('fake-float')).zIndex),
          zHeader: Number(getComputedStyle(document.querySelector('header')).zIndex),
          plain: items.every((i) => !i.querySelector('svg')) && getComputedStyle(menu).boxShadow === 'none' && getComputedStyle(menu).borderTopWidth === '0px' && getComputedStyle(menu).borderRadius === '0px' && items.every((i) => getComputedStyle(i).backgroundColor === 'rgba(0, 0, 0, 0)'),
          weights: items.map((i) => Number(getComputedStyle(i.querySelector('span')).fontWeight)),
          flush: Math.abs(rect.top - document.querySelector('header').getBoundingClientRect().bottom) < 1 && rect.left === 0 && rect.right === document.documentElement.clientWidth,
          barLine: getComputedStyle(document.querySelector('header')).borderBottomColor,
          barBottom: document.querySelector('header').getBoundingClientRect().bottom,
          listLine: getComputedStyle(menu).borderBottomWidth + ' ' + getComputedStyle(menu).borderBottomColor,
          listTopLine: getComputedStyle(menu).borderTopWidth,
          listShadow: getComputedStyle(menu).boxShadow,
          listBg: getComputedStyle(menu).backgroundColor,
          barBg: getComputedStyle(document.querySelector('header')).backgroundColor,
          titleLeft: document.querySelector('${trigger} span').getBoundingClientRect().left,
          itemLeft: items[0].querySelector('span').getBoundingClientRect().left,
          pushed: document.getElementById('fake-sticky').getBoundingClientRect().top,
          noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
        }
      })()`)
      assert.equal(open.expanded, 'true')
      assert.equal(await evaluate<boolean>(`document.activeElement?.hasAttribute('data-bos-title-menu-item') === true`), false, `${language} ${page}: a tap does not draw a focus ring on an item`)
      assert.deepEqual(open.ids, ids, `${language} ${page}: the menu lists the page's sections in order`)
      assert.deepEqual(open.checked, [anchor.split(':')[2]], `${language} ${page}: only the open section is marked`);
      assert.equal(open.plain, true, `${language} ${page}: plain text, no icon, box, border, shadow or fill`);
      assert.equal(open.flush, true, `${language} ${page}: the list continues the bar directly beneath it`);
      assert.ok(open.weights.every((w: number, index: number) => index === ids.indexOf(anchor.split(':')[2]) || w < open.weights[ids.indexOf(anchor.split(':')[2])]), `${language} ${page}: the open section differs by weight (${JSON.stringify(open.weights)})`)
      assert.ok(open.labels.every((label: string) => label.length > 0 && !/^[a-z_]+$/.test(label)), `${language} ${page}: labels are translated`)
      assert.equal(open.reachable, true, `${language} ${page}: every item is the topmost element at its centre, over the sticky row and the float`)
      assert.equal(open.inside, true, `${language} ${page}: the list stays inside the viewport`)
      assert.ok(open.zMenu > open.zFloat && open.zMenu > open.zSticky && open.zMenu > open.zHeader, `${language} ${page}: menu z-index ${open.zMenu} is above sticky ${open.zSticky}, float ${open.zFloat}, header ${open.zHeader}`)
      assert.equal(open.barLine, 'rgba(0, 0, 0, 0)', `${theme} ${language} ${shotName}: no divider between the title row and the list`)
      assert.match(open.listLine, /^1px rgb/, `${theme} ${language} ${shotName}: the line is the list's bottom edge`)
      assert.equal(open.listTopLine, '0px')
      assert.equal(open.listShadow, 'none')
      assert.equal(open.listBg, open.barBg, `${theme} ${language} ${shotName}: list and bar share one background`)
      assert.ok(Math.abs(open.titleLeft - open.itemLeft) < 1, `${theme} ${language} ${shotName}: items align with the title text (${open.titleLeft} vs ${open.itemLeft})`)
      assert.equal(open.pushed, stickyBefore, `${theme} ${language} ${shotName}: the list floats and moves no page content`)
      assert.equal(open.noOverflow, true, `${language} ${page}: no horizontal overflow`)
      if (SCREENSHOT_DIR) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
        fs.writeFileSync(path.join(SCREENSHOT_DIR, `${shotName}-${language}-${theme}-360x740.png`), Buffer.from(shot.data, 'base64'))
      }

      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      assert.equal(await menuOpen(), false, `${language} ${page}: Escape collapses`)
      assert.equal(await evaluate<boolean>(`document.activeElement === document.querySelector('${trigger}')`), true, `${language} ${page}: Escape returns focus to the title`)

      await evaluate(`document.querySelector('${trigger}').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`)
      await waitFor(async () => await menuOpen() ? true : null)
      await evaluate(`document.querySelector('[data-bos-title-menu-layer] > div').click()`)
      assert.equal(await menuOpen(), false, `${language} ${page}: an outside tap collapses`)

      await evaluate(`document.querySelector('${trigger}').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`)
      await waitFor(async () => await menuOpen() ? true : null)
      await evaluate(`document.querySelector('${trigger}').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`)
      assert.equal(await menuOpen() || await evaluate<boolean>(`document.querySelector('${trigger}').getAttribute('aria-expanded') === 'true'`), false, `${language} ${page}: tapping the title again collapses`)
    }
  }

  await evaluate(`window.__sidebarNavigateCalls.length = 0`)
  await openPage('sales', 'hub:sales:sales')
  await evaluate(`document.querySelector('[data-bos-title-menu="sales"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))`)
  await waitFor(async () => await menuOpen() ? true : null)
  assert.equal(await evaluate<boolean>(`document.activeElement === document.querySelector('[data-bos-title-menu-item="sales"]')`), true, 'keyboard activation moves focus to the open subpage')
  await evaluate(`document.querySelector('[data-bos-title-menu-item="reports"]').click()`)
  assert.deepEqual(await evaluate(`window.__sidebarNavigateCalls`), [{ page: 'sales', anchor: 'hub:sales:reports' }], 'choosing a section navigates through the guarded route contract')
  assert.equal(await menuOpen(), false, 'choosing a section collapses the list')

  await openPage('dashboard', '')
  assert.equal(await evaluate<boolean>(`document.querySelector('[data-bos-title-menu]') === null`), true, 'a page without sections keeps a plain title')
  console.log('PASS mobile title expands the subpage titles above sticky rows and floats, EN/KM, 360x740')
} catch (error) {
  exitCode = 1
  console.error('FAIL mobile title sections menu')
  console.error(error, browserDiagnostics)
}
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
