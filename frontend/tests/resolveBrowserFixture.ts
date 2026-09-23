// Shared plumbing for the conflict resolver's browser tests (resolveGrid,
// resolveModal): one Vite server that serves a virtual fixture module in a bare
// page, and one headless Chromium driven over CDP. Not a test file itself;
// the chain only runs *.test.ts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

export const CTRL = 2

const KEYS: Record<string, { code: string; keyCode: number }> = {
  ArrowRight: { code: 'ArrowRight', keyCode: 39 }, ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 }, ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  Home: { code: 'Home', keyCode: 36 }, End: { code: 'End', keyCode: 35 },
  Enter: { code: 'Enter', keyCode: 13 }, Escape: { code: 'Escape', keyCode: 27 },
  F2: { code: 'F2', keyCode: 113 }, ' ': { code: 'Space', keyCode: 32 }, Tab: { code: 'Tab', keyCode: 9 },
}

export type ResolveBrowser = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>
  evaluate: <T>(expression: string) => Promise<T>
  press: (key: string, modifiers?: number) => Promise<void>
  mouseClick: (selector: string, clickCount?: number) => Promise<void>
  waitFor: <T>(label: string, read: () => Promise<T | null>, timeoutMs?: number) => Promise<T>
  pause: (ms: number) => Promise<void>
  /** Loads the fixture at a size; `ready` is a page expression that turns true once it rendered. */
  open: (width: number, query: string, ready: string, height?: number) => Promise<void>
  /** Every element under `scope` with its own Khmer text has a Khmer line box and is not clipped. */
  khmerRoom: (label: string, scope: string, minChecked: number) => Promise<void>
  /** Runs the scenario, prints `pass` when it held, and always tears the browser down. */
  run: (pass: string, scenario: () => Promise<void>) => Promise<never>
}

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

export async function launchResolveFixture(slug: string, fixtureSource: string): Promise<ResolveBrowser> {
  const root = path.resolve(import.meta.dirname, '..')
  const candidates = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const browserPath = candidates.find((candidate) => fs.existsSync(candidate))
  assert.ok(browserPath, 'A local Chromium or Edge executable is required')

  const appPort = await freePort()
  const moduleName = `virtual:${slug}`
  const fixtureId = `\0${slug}`
  const vite = await createServer({
    // node_modules may be a junction into another checkout; the Khmer font
    // files are served from wherever it really lives.
    root, logLevel: 'error', server: { host: '127.0.0.1', port: appPort, strictPort: true, fs: { allow: [root, fs.realpathSync(path.join(root, 'node_modules'))] } },
    plugins: [{
      name: slug, enforce: 'pre',
      resolveId(id) { return id === moduleName ? fixtureId : null },
      load(id) { return id === fixtureId ? fixtureSource : null },
      async transform(code, id) {
        if (id !== fixtureId) return null
        const transformed = await transformWithEsbuild(code, `${slug}.tsx`, { loader: 'tsx', jsx: 'automatic' })
        return { code: transformed.code, map: null }
      },
      configureServer(server) {
        server.middlewares.use(`/${slug}`, async (_request, response) => {
          response.setHeader('content-type', 'text/html; charset=utf-8')
          const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.addEventListener("error",e=>document.body.dataset.fixtureError=String(e.error&&e.error.stack||e.message));window.addEventListener("unhandledrejection",e=>document.body.dataset.fixtureError=String(e.reason&&e.reason.stack||e.reason))</script><script type="module" src="/@id/${moduleName}"></script></body></html>`
          response.end(await server.transformIndexHtml(`/${slug}`, html))
        })
      },
    }],
  })
  await vite.listen()

  const debugPort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `bos-${slug}-`))
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${appPort}/${slug}`], { stdio: 'ignore' })
  const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

  let socket: WebSocket | null = null
  let nextId = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const waitFor = <T>(label: string, read: () => Promise<T | null>, timeoutMs = 20_000): Promise<T> => waitForBrowser(read, `${slug}: ${label}`, timeoutMs)
  const send = async (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    assert.ok(socket && socket.readyState === WebSocket.OPEN)
    const id = ++nextId
    const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    socket.send(JSON.stringify({ id, method, params })); return reply
  }
  const evaluate = async <T>(expression: string): Promise<T> => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (reply.exceptionDetails) throw new Error(`${reply.exceptionDetails.exception?.description || reply.exceptionDetails.text}\n in: ${expression.slice(0, 160)}`)
    return reply.result.value as T
  }
  const press = async (key: string, modifiers = 0): Promise<void> => {
    const { code, keyCode } = KEYS[key]
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  const mouseClick = async (selector: string, clickCount = 1): Promise<void> => {
    const point = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 10) } })()`)
    assert.ok(point, `${selector} is on the page`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount })
  }
  const open = async (width: number, query: string, ready: string, height = 760): Promise<void> => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 || height < 640 })
    await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/${slug}?${query}` })
    // A page error is thrown, not swallowed, so a fixture that never renders
    // times out with the error that stopped it rather than "no value". The
    // first open pays Vite's cold transform (Tailwind over main.css, the
    // shared component tree), which under a loaded machine outlasts 20s.
    await waitFor(`${width}px ${query} renders`, async () => {
      const state = await evaluate<{ ready: boolean; error: string | null }>(`({ ready: Boolean(${ready}), error: document.body.dataset.fixtureError || null })`)
      if (state.error) throw new Error(state.error)
      return state.ready ? true : null
    }, 60_000)
    await evaluate('document.fonts.ready.then(() => true)')
    await pause(150)
    assert.equal(await evaluate<string | null>('document.body.dataset.fixtureError || null'), null, `${width}px ${query} fixture has no runtime error`)
  }
  const khmerRoom = async (label: string, scope: string, minChecked: number): Promise<void> => {
    const report = await evaluate<{ tight: string[]; clipped: string[]; checked: number }>(`(() => {
      const tight = []; const clipped = []; let checked = 0
      for (const node of document.querySelector(${JSON.stringify(scope)}).querySelectorAll('*')) {
        const own = [...node.childNodes].some((child) => child.nodeType === 3 && /[\\u1780-\\u17FF]/.test(child.textContent))
        if (!own || node.closest('.sr-only')) continue
        checked += 1
        const style = getComputedStyle(node)
        const size = parseFloat(style.fontSize)
        const line = style.lineHeight === 'normal' ? size * 1.6 : parseFloat(style.lineHeight)
        if (line < size * 1.5) tight.push(node.tagName + ' ' + node.className + ' ' + line + '/' + size)
        if (!node.classList.contains('product-name-rail') && style.overflowY !== 'visible' && node.scrollHeight > node.clientHeight + 1) clipped.push(node.tagName + ' ' + node.className)
      }
      return { tight, clipped, checked }
    })()`)
    assert.ok(report.checked >= minChecked, `${label}: the Khmer scan reached the text (${report.checked})`)
    assert.deepEqual(report.tight, [], `${label}: Khmer text gets a Khmer line height`)
    assert.deepEqual(report.clipped, [], `${label}: no Khmer text is clipped vertically`)
  }
  const run = async (pass: string, scenario: () => Promise<void>): Promise<never> => {
    let exitCode = 0
    try {
      const target = await waitFor('browser target', async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
          const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
          return targets.find((item) => item.type === 'page' && item.url?.includes(`/${slug}`))?.webSocketDebuggerUrl || null
        } catch { return null }
      }, 45_000)
      socket = new WebSocket(target)
      await new Promise<void>((resolve, reject) => { socket!.addEventListener('open', () => resolve(), { once: true }); socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true }) })
      socket.addEventListener('message', (event) => {
        const reply = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } }
        if (!reply.id) return
        const waiter = pending.get(reply.id); if (!waiter) return
        pending.delete(reply.id); reply.error ? waiter.reject(new Error(reply.error.message || 'CDP command failed')) : waiter.resolve(reply.result)
      })
      await send('Runtime.enable'); await send('Page.enable')
      // Headless windows are never focused; without this no focus event fires.
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await scenario()
      console.log(pass)
    } catch (error) {
      exitCode = 1
      console.error(`FAIL ${slug}`)
      console.error(error)
    }
    return await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
  }
  return { send, evaluate, press, mouseClick, waitFor, pause, open, khmerRoom, run }
}
