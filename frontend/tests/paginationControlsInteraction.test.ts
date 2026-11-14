import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

// Interaction contract for the shared pager, on the REAL control in headless Chrome, EN and KM, in all six layouts. Each is
// mounted twice from ONE element (<TopPager> above, plain below), as every list does. Back goes to the previous page and Next to
// the next, from either mount; a typed page number keeps only its digits, Enter jumps there, and an oversized number lands on
// the last page. The layout test proves where things sit; this one proves they still work (a dead digit filter and a Back that
// moved forward both passed the layout test).

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

  const layouts = [
    ['default', {}],
    ['compact', { compact: true }],
    ['compactPageInput', { compact: true, compactPageInput: true }],
    ['range', { compact: true, rangeAsPageSize: true }],
    ['rangeCentered', { compact: true, rangeAsPageSize: true, compactCentered: true }],
    ['centered', { layout: 'centered' }],
  ]
  window.__labels = (language) => { const pack = language === 'km' ? km : en; return { back: pack.back, next: pack.next } }
  function Page({ language, requested, total }) {
    const pack = language === 'km' ? km : en
    const t = (key) => pack[key] || key
    const [page, setPage] = useState(requested)
    return (
      <div style={{ padding: 8 }}>
        {layouts.map(([name, props]) => {
          const pager = (
            <PaginationControls {...props} page={page} pageSize={20} totalItems={total} label={t('products')} t={t} onPageChange={setPage} />
          )
          return (
            <section key={name} data-layout={name} data-page={page} style={{ marginBottom: 6 }}>
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
const fixtureId = '\0bos-pager-interaction'
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'pager-interaction-fixture',
    enforce: 'pre',
    resolveId(id) { return id === 'virtual:bos-pager-interaction' ? fixtureId : null },
    load(id) { return id === fixtureId ? fixtureSource : null },
    async transform(code, id) {
      if (id !== fixtureId) return null
      const transformed = await transformWithEsbuild(code, 'pager-interaction.tsx', { loader: 'tsx', jsx: 'automatic' })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/pager-interaction', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:bos-pager-interaction"></script></body></html>'
        response.end(await server.transformIndexHtml('/pager-interaction', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-pager-interaction-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/pager-interaction`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: any }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const browserDiagnostics: string[] = []

function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  return waitForBrowser(read, 'pager interaction fixture', timeoutMs)
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

// CSS attribute selectors use single quotes so the JS expression strings stay free of escapes.
const find = (layout: string, which: string, selector: string) => `document.querySelector("[data-layout='${layout}'] [data-pager='${which}'] ${selector}")`
const pageOf = (layout: string) => evaluate<string>(`document.querySelector("[data-layout='${layout}']").getAttribute('data-page')`)
async function settle(layout: string, expected: string, what: string) {
  await waitFor(async () => (await pageOf(layout)) === expected ? true : null, 3000).catch(() => undefined)
  assert.equal(await pageOf(layout), expected, what)
}
async function pressEnter() {
  const cr = String.fromCharCode(13)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: cr })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
}
async function typeInto(layout: string, which: string, text: string): Promise<string> {
  await evaluate(`(() => { const el = ${find(layout, which, 'input')}; el.focus(); el.select() })()`)
  await send('Input.insertText', { text })
  return await evaluate<string>(`${find(layout, which, 'input')}.value`)
}

let exitCode = 0
try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.includes('/pager-interaction'))?.webSocketDebuggerUrl || null
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
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 800, deviceScaleFactor: 2, mobile: true })
  await waitFor(async () => await evaluate<boolean>('window.__ready === true') ? true : null, 60_000)

  const layoutNames = ['default', 'compact', 'compactPageInput', 'range', 'rangeCentered', 'centered']
  // The plain compact layout prints the page as text; every other layout has the page box.
  const withBox = layoutNames.filter((name) => name !== 'compact')
  for (const language of ['en', 'km']) {
    const labels = await evaluate<{ back: string; next: string }>(`window.__labels('${language}')`)
    assert.ok(labels.back && labels.next, `${language}: Back and Next have translated names`)
    await evaluate(`window.__render('${language}', 5, 123456)`)
    await waitFor(async () => await evaluate<boolean>(`document.querySelectorAll('[data-layout]').length === 6`) ? true : null)
    for (const name of layoutNames) {
      const button = (which: string, label: string) => find(name, which, `button[aria-label='${label}']`)
      const where = `${language} ${name}`
      assert.equal(await pageOf(name), '5', `${where}: starts on page 5`)
      await evaluate(`${button('top', labels.back)}.click()`)
      await settle(name, '4', `${where}: Back from the TOP pager goes to the previous page`)
      await evaluate(`${button('bottom', labels.next)}.click()`)
      await settle(name, '5', `${where}: Next from the BOTTOM pager goes forward`)
      await evaluate(`${button('top', labels.next)}.click()`)
      await settle(name, '6', `${where}: Next from the TOP pager goes forward`)
      await evaluate(`${button('bottom', labels.back)}.click()`)
      await settle(name, '5', `${where}: Back from the BOTTOM pager goes back`)
    }
    for (const name of withBox) {
      const where = `${language} ${name}`
      // Letters are dropped, the digit kept; Enter jumps; the other mount follows the single state.
      assert.equal(await typeInto(name, 'top', 'x7y'), '7', `${where}: the top page box keeps only the digit typed`)
      await pressEnter()
      await settle(name, '7', `${where}: Enter in the top box jumps to page 7`)
      assert.equal(await evaluate<string>(`${find(name, 'bottom', 'input')}.value`), '7', `${where}: the bottom box follows`)
      assert.equal(await typeInto(name, 'bottom', '31'), '31', `${where}: the bottom page box takes digits`)
      await pressEnter()
      await settle(name, '31', `${where}: Enter in the bottom box jumps to page 31`)
      await typeInto(name, 'top', '99999999')
      await pressEnter()
      await settle(name, '6173', `${where}: an oversized page lands on the last page`)
    }
  }
  console.log('PASS pager Back/Next from top and bottom, typed page numbers, EN/KM, all six layouts')
} catch (error) {
  exitCode = 1
  console.error('FAIL pagination controls interaction')
  console.error(error, browserDiagnostics)
}
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
