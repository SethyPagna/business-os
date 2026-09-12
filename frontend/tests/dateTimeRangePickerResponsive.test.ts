import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the responsive date-range regression')

const fixtureSource = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import DateTimeRangePicker from '/src/components/shared/DateTimeRangePicker.tsx'
  import StatsRangeRow from '/src/components/shared/StatsRangeRow.tsx'
  import '/src/styles/main.css'

  const words = {
    date_time_range: 'ជួរកាលបរិច្ឆេទ និងម៉ោង', range_start: 'ចាប់ផ្តើម', range_end: 'បញ្ចប់',
    start_time: 'ម៉ោងចាប់ផ្តើម', end_time: 'ម៉ោងបញ្ចប់', close: 'បិទ', clear: 'សម្អាត',
    previous: 'មុន', next: 'បន្ទាប់', month: 'ខែ', year: 'ឆ្នាំ', quick_range: 'ជួររហ័ស',
  }
  const t = (key) => words[key] || key

  function Harness() {
    const [range, setRange] = useState({ startDate: '2028-02-01', endDate: '2028-02-29', startTime: '00:00', endTime: '23:59' })
    return <main className="fixture-shell" style={{ width: '100%', padding: 12, overflowX: 'clip' }}>
      <div style={{ height: 132 }} />
      <div data-stats-fixture>
        <StatsRangeRow
          range={range}
          onRangeChange={setRange}
          t={t}
          showTime
          showPresets
          compactRange
          leading={<button type="button" style={{ width: 40, height: 40, flex: '0 0 40px' }}>S</button>}
          actions={<button type="button" style={{ width: 40, height: 40, flex: '0 0 40px' }}>M</button>}
        />
      </div>
      <div data-direct-fixture style={{ marginTop: 8 }}>
        <DateTimeRangePicker value={range} onChange={setRange} t={t} showTime={false}
          triggerClassName="flex w-full min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2" />
      </div>
    </main>
  }
  createRoot(document.getElementById('root')).render(<Harness />)
`

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
const virtualId = '\0bos-date-range-fixture'
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'date-range-native-fixture',
    enforce: 'pre',
    resolveId(id) { return id === 'virtual:bos-date-range-fixture' ? virtualId : null },
    load(id) { return id === virtualId ? fixtureSource : null },
    async transform(code, id) {
      if (id !== virtualId) return null
      const transformed = await transformWithEsbuild(code, 'date-range-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/date-range-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="lang-km"><div id="root"></div><script>window.addEventListener("error",function(event){document.body.dataset.fixtureError=String(event.error&&event.error.stack||event.message)});window.addEventListener("unhandledrejection",function(event){document.body.dataset.fixtureError=String(event.reason&&event.reason.stack||event.reason)})</script><script type="module" src="/@id/virtual:bos-date-range-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/date-range-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-date-range-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/date-range-fixture`,
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
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('Timed out waiting for native date-range fixture')
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
async function setViewport(width: number, height: number): Promise<void> {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
  await new Promise((resolve) => setTimeout(resolve, 80))
}

try {
  let target: string
  try {
    target = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
        const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
        return targets.find((item) => item.type === 'page' && item.url?.includes('/date-range-fixture'))?.webSocketDebuggerUrl || null
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
  try {
    await waitFor(async () => await evaluate<boolean>('Boolean(document.querySelector("[data-stats-range-controls]"))') ? true : null, COLD_START_TIMEOUT_MS)
  } catch (error) {
    const diagnostics = await evaluate(`JSON.stringify({ readyState: document.readyState, error: document.body.dataset.fixtureError, body: document.body.textContent, html: document.documentElement.outerHTML.slice(0, 1000), resources: performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize })) })`)
    throw new Error(`${error instanceof Error ? error.message : String(error)}; browser=${JSON.stringify(browserDiagnostics)}; page=${diagnostics}`)
  }

  for (const width of [320, 360, 390]) {
    await setViewport(width, 480)
    const geometry = await evaluate<{ viewport: number; body: number; buttonClient: number; buttonScroll: number; values: string }>(`(() => {
      const button = document.querySelector('[data-stats-fixture] [aria-label="ជួរកាលបរិច្ឆេទ និងម៉ោង"]')
      return { viewport: document.documentElement.clientWidth, body: document.documentElement.scrollWidth, buttonClient: button.clientWidth, buttonScroll: button.scrollWidth, values: button.querySelector('[data-date-range-trigger-values]').textContent }
    })()`)
    assert.equal(geometry.body, geometry.viewport, `${width}px page has no horizontal overflow`)
    assert.ok(geometry.buttonScroll <= geometry.buttonClient + 1, `${width}px action-heavy range trigger keeps all content inside its box`)
    for (const value of ['01/02/2028', '00:00', '29/02/2028', '23:59']) assert.ok(geometry.values.includes(value), `${width}px trigger keeps ${value} visible`)
  }

  await setViewport(320, 480)
  await evaluate(`document.querySelector('[data-stats-fixture] [aria-label="ជួរកាលបរិច្ឆេទ និងម៉ោង"]').click()`)
  const panel = await waitFor(async () => await evaluate<any>(`(() => {
    const panel = document.querySelector('[data-date-time-range-panel]')
    if (!panel) return null
    const rect = panel.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, overflowY: getComputedStyle(panel).overflowY, presetRail: Boolean(panel.querySelector('[data-date-time-range-presets]')) }
  })()`))
  assert.ok(panel.left >= 7 && panel.right <= 313, `portaled panel stays inside the 320px viewport and escapes the clipped 296px parent: ${JSON.stringify(panel)}`)
  assert.ok(panel.top >= 7 && panel.bottom <= 473, 'panel stays vertically inside the viewport')
  assert.equal(panel.overflowY, 'auto')
  assert.ok(panel.scrollHeight > panel.clientHeight, 'expanded time and calendar controls become an internal scroll surface on a short viewport')
  assert.equal(panel.presetRail, false, 'StatsRangeRow external presets suppress the duplicate picker rail')

  const navLabels = await evaluate<string[]>(`Array.from(document.querySelectorAll('[data-date-range-nav]'), (node) => node.getAttribute('aria-label'))`)
  assert.deepEqual(navLabels, ['មុន ឆ្នាំ', 'មុន ខែ', 'បន្ទាប់ ខែ', 'បន្ទាប់ ឆ្នាំ'])
  assert.equal(await evaluate<number>(`document.querySelectorAll('[aria-label^="2028-02-"]').length`), 29, 'leap February starts with 29 selectable days')
  await evaluate(`document.querySelector('[data-date-range-nav=next-year]').click()`)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[aria-label^="2029-02-"]').length`), 28, 'year navigation recomputes non-leap February')
  await evaluate(`document.querySelector('[data-date-range-nav=previous-year]').click()`)
  await waitFor(async () => await evaluate<boolean>(`Boolean(document.querySelector('[aria-label="2028-02-29"]'))`) ? true : null)
  await evaluate(`document.querySelector('[data-date-range-nav=previous-month]').click()`)
  await waitFor(async () => await evaluate<boolean>(`Boolean(document.querySelector('[aria-label="2028-01-31"]'))`) ? true : null)
  await evaluate(`document.querySelector('[data-date-range-nav=previous-month]').click()`)
  assert.equal(await evaluate<boolean>(`Boolean(document.querySelector('[aria-label="2027-12-31"]'))`), true, 'month navigation crosses the year boundary without losing the calendar')

  const panelPoint = await evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-date-time-range-panel]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...panelPoint, deltaX: 0, deltaY: 900 })
  await waitFor(async () => (await evaluate<number>(`document.querySelector('[data-date-time-range-panel]').scrollTop`)) > 0 ? true : null)
  const finalDayVisible = await evaluate<boolean>(`(() => {
    const panel = document.querySelector('[data-date-time-range-panel]').getBoundingClientRect()
    const day = document.querySelector('[aria-label="2027-12-31"]').getBoundingClientRect()
    return day.top >= panel.top && day.bottom <= panel.bottom
  })()`)
  assert.equal(finalDayVisible, true, 'the final day is visibly reachable after native panel scrolling')

  await evaluate(`document.querySelector('[data-date-time-range-panel] button[aria-label="បិទ"]').click(); document.querySelector('[data-direct-fixture] [aria-label="ជួរកាលបរិច្ឆេទ និងម៉ោង"]').click()`)
  await waitFor(async () => await evaluate<boolean>(`Boolean(document.querySelector('[data-date-time-range-panel] [data-date-time-range-presets]'))`) ? true : null)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-date-time-range-panel] [data-date-time-range-presets] button').length`), 6, 'direct callers retain the six picker presets by default')

  console.log('PASS native responsive date range keeps full values, scrolls in viewport, localizes month/year navigation, and preserves preset ownership')
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
  await vite.close()
  await new Promise((resolve) => setTimeout(resolve, 100))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
