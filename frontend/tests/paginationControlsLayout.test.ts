import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

// Owner 14 Nov: every pager reads [Back] [item range "21-40 of 1,234"] [page / pages] [Next], on ONE row,
// and is mounted twice (<TopPager> above, plain below) from a single element. The REAL PaginationControls
// runs in headless Chrome in every layout, in English and Khmer, from 320px to desktop, with five-digit
// totals. PAGER_SCREENSHOT_DIR, when set, receives one screenshot per width and language.

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

const fixtureSource = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import PaginationControls, { TopPager } from '/src/components/shared/PaginationControls.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'

  window.__changes = []
  const layouts = [
    ['default', {}],
    ['compact', { compact: true }],
    ['compactPageInput', { compact: true, compactPageInput: true }],
    ['range', { compact: true, rangeAsPageSize: true }],
    ['rangeCentered', { compact: true, rangeAsPageSize: true, compactCentered: true }],
    ['centered', { layout: 'centered' }],
  ]
  function Page({ language, requested, total }) {
    const pack = language === 'km' ? km : en
    const t = (key) => pack[key] || key
    const [page, setPage] = useState(requested)
    return (
      <div style={{ padding: 8 }}>
        {layouts.map(([name, props]) => {
          const pager = (
            <PaginationControls
              {...props}
              page={page}
              pageSize={20}
              totalItems={total}
              label={t('products')}
              t={t}
              onPageChange={(next) => { window.__changes.push([name, next]); setPage(next) }}
            />
          )
          return (
            <section key={name} data-layout={name} style={{ marginBottom: 6 }}>
              <div data-pager="top"><TopPager>{pager}</TopPager></div>
              <div style={{ height: 6 }} />
              <div data-pager="bottom">{pager}</div>
            </section>
          )
        })}
      </div>
    )
  }
  window.__render = (language, requested, total) => {
    document.body.className = language === 'km' ? 'lang-km' : ''
    window.__changes = []
    window.__root?.unmount()
    window.__root = createRoot(document.getElementById('root'))
    window.__root.render(<Page key={language + requested + total} language={language} requested={requested} total={total} />)
  }
  window.__ready = true
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
const fixtureId = '\0bos-pager-fixture'
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'pager-fixture',
    enforce: 'pre',
    resolveId(id) { return id === 'virtual:bos-pager-fixture' ? fixtureId : null },
    load(id) { return id === fixtureId ? fixtureSource : null },
    async transform(code, id) {
      if (id !== fixtureId) return null
      const transformed = await transformWithEsbuild(code, 'pager-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/pager-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:bos-pager-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/pager-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-pager-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/pager-fixture`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: any }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const browserDiagnostics: string[] = []

function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  return waitForBrowser(read, 'pager fixture', timeoutMs)
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

const SCREENSHOT_DIR = process.env.PAGER_SCREENSHOT_DIR || ''
const measure = String.raw`(() => {
  const out = {}
  for (const section of document.querySelectorAll('[data-layout]')) {
    const name = section.getAttribute('data-layout')
    out[name] = {}
    for (const which of ['top', 'bottom']) {
      const host = section.querySelector('[data-pager="' + which + '"]')
      const controls = Array.from(host.querySelectorAll('button, input, [data-pager-range], [data-pager-page]'))
      const labelOf = (el) => el.tagName === 'INPUT' || el.hasAttribute('data-pager-page') ? 'page' : el.hasAttribute('data-pager-range') ? 'range' : (el.getAttribute('aria-label') || '')
      const rects = controls.map((el) => el.getBoundingClientRect())
      const tops = rects.map((r) => (r.top + r.bottom) / 2)
      const rowHeight = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
      out[name][which] = {
        order: controls.map(labelOf),
        rangeText: host.querySelector('[data-pager-range]')?.textContent?.trim() || '',
        oneRow: Math.max(...tops) - Math.min(...tops) < 6,
        rowHeight,
        hostHeight: host.getBoundingClientRect().height,
        overflow: Array.from(host.querySelectorAll('*')).some((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5),
        live: host.querySelectorAll('[aria-live]').length,
        clipped: Array.from(host.querySelectorAll('[data-pager-range], [data-pager-page]')).some((el) => el.scrollWidth > el.clientWidth + 1),
      }
    }
  }
  return out
})()`

let exitCode = 0
try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.includes('/pager-fixture'))?.webSocketDebuggerUrl || null
    } catch { return null }
  }, 60_000)
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (!reply.id && reply.method) {
      if (reply.method === 'Runtime.exceptionThrown') browserDiagnostics.push(`exception: ${JSON.stringify(reply.params?.exceptionDetails?.exception?.description || reply.params?.exceptionDetails?.text)}`)
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
  await waitFor(async () => await evaluate<boolean>('window.__ready === true') ? true : null, 60_000)

  const widths = [320, 360, 375, 412, 1280]
  for (const language of ['en', 'km']) for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: width < 700 })
    // Page 501 of 6,173 (123,456 items) is the widest range, total and page strings the app produces.
    await evaluate(`window.__render('${language}', 501, 123456)`)
    await waitFor(async () => await evaluate<boolean>(`document.querySelectorAll('[data-layout]').length === 6 && document.querySelectorAll('button').length >= 24`) ? true : null)
    const result = await evaluate<Record<string, Record<string, any>>>(measure)
    for (const [name, pair] of Object.entries(result)) for (const [which, m] of Object.entries(pair)) {
      const where = `${language} ${width}px ${name} ${which}`
      // The item range sits between Back and the page number; Next is last.
      const order = m.order as string[]
      const rangeIndex = order.indexOf('range'), pageIndex = order.indexOf('page'), nextIndex = order.length - 1
      assert.ok(rangeIndex > 0 && pageIndex > rangeIndex && nextIndex > pageIndex, `${where}: order is Back, range, page, Next (${JSON.stringify(order)})`)
      assert.match(m.rangeText as string, /^(Showing |កំពុងបង្ហាញ )?10,001-10,020 (of|នៃ) 123,456/, `${where}: the range reads "a-b of total" (${m.rangeText})`)
      assert.equal(m.oneRow, true, `${where}: one row (${JSON.stringify(m)})`)
      assert.equal(m.clipped, false, `${where}: the range and page text are fully visible, never clipped`)
      assert.equal(m.overflow, false, `${where}: nothing runs off the viewport`)
      assert.ok(m.rowHeight <= 48, `${where}: the row stays dense (${m.rowHeight}px)`)
      // Two mounts from one element: only the bottom one carries the polite live region.
      if (name === 'centered') assert.equal(m.live, which === 'top' ? 0 : 1, `${where}: one live region`)
    }
    if (SCREENSHOT_DIR) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `pager-${language}-${width}.png`), Buffer.from(shot.data, 'base64'))
    }
  }
  for (const language of ['en', 'km']) {
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true })
    await evaluate(`window.__render('${language}', 99999, 123456)`)
    await waitFor(async () => await evaluate<boolean>('document.querySelectorAll("[data-layout]").length === 6') ? true : null)
    await new Promise((resolve) => setTimeout(resolve, 300))
    // A requested page past the end is repaired ONCE per list, not once per mount, so no second request follows.
    const changes = await evaluate<Array<[string, number]>>('window.__changes')
    const perLayout = new Map<string, number>()
    for (const [name] of changes) perLayout.set(name, (perLayout.get(name) || 0) + 1)
    assert.equal(perLayout.size, 6, `${language} 360px: the clamp repair ran in every layout`)
    for (const [name, count] of perLayout) assert.equal(count, 1, `${language} 360px ${name}: the stale page is repaired by one mount only (${count})`)
  }
  console.log('PASS pager order, one row, single clamp repair, EN/KM, 320-1280px')
} catch (error) {
  exitCode = 1
  console.error('FAIL pagination controls layout')
  console.error(error, browserDiagnostics)
}
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
