// The report row detail float, driven for real (owner, Sep 22 2026: "when
// open open as a float , click outside/click close to close... current if i
// move it just auto close").
//
// A source-shape test can pin that no `mouseleave` listener exists, but the
// defect the owner hit was not a leave handler at all -- it was the shared
// kit `Fold`'s history effect being keyed on the caller's INLINE `onClose`.
// Every report view passes `onClose={() => setOpenRow(null)}`, a new function
// identity on every render of that view, and the app shell re-renders the
// page while it is being scrolled (App.tsx's `handleScroll` -> `setVisible`
// for the mobile header). Each of those re-renders tore the effect down --
// `history.back()` -- and pushed a fresh entry, so the traversal's `popstate`
// landed on the newly-registered listener and closed the panel. Nothing in
// the source says "close"; only running it shows it.
//
// So this file mounts the REAL GroupedReport in a real headless Chrome over
// CDP (the technique reportsRenderPass.test.ts / reportsHubComposedResponsive
// .test.ts already use for this surface -- there is no jsdom in this
// worktree's node_modules and installing one is forbidden), opens a row's
// float and then asserts the four halves of the owner's rule:
//
//   1. an unrelated re-render of the view does NOT close it   (the fix)
//   2. pointer movement over the page does NOT close it
//   3. a click outside DOES close it
//   4. the header X DOES close it
//
// Plus the readability half: the sheet inside that 448px float lays its
// blocks out as ONE column, not the three ~90px columns the viewport-keyed
// `md:`/`xl:` grid produced on a desktop window.
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
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required')

// `titleControl` is the one prop ReportsHub does not memoize (it embeds the
// live picker/Filters/Show controls), so bumping the tick reproduces exactly
// what a page-shell re-render hands this view: same rows, same filters, new
// element identity -- and, before the fix, a closed float.
const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import GroupedReport from '/src/components/sales/reports/GroupedReport.tsx'
  import { getReportView } from '/src/components/sales/reports/reportModel.ts'

  const view = getReportView('customers')
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31', startTime: '00:00', endTime: '23:59', branchId: '', status: '', paymentMethod: '' }
  const options = { basis: 'revenue', profitMode: 'gross', granularity: 'day', compare: false, currency: 'usd' }
  const fmtMoney = (usd) => '$' + Number(usd || 0).toFixed(2)
  const khrToUsd = (khr) => Number(khr || 0) / 4000
  const tr = (_key, fallback) => fallback
  const t = (key) => key

  function Harness() {
    const [tick, setTick] = React.useState(0)
    window.__bump = () => setTick((v) => v + 1)
    return React.createElement(GroupedReport, {
      view, filters, search: '', options, style: 'excel', fmtMoney, khrToUsd, tr, t,
      perms: { sales: true, returns: true, fees: true, shift: true },
      canExport: () => true, compact: false, onDrill: () => {}, onOptionsChange: () => {},
      titleControl: React.createElement('span', null, 'tick ' + tick),
    })
  }
  document.body.className = ''
  createRoot(document.getElementById('root')).render(React.createElement(Harness))
`

// Long labels on purpose: the float's header and the statement's label
// column are exactly where an ellipsis used to appear.
const transportSource = String.raw`
  export function getReportGrouped() {
    const rows = []
    for (let i = 0; i < 12; i++) {
      rows.push({ key: String(i), label: 'Customer ' + i + ' with a deliberately very long display name for the scroll check', entity_id: i, tx_count: (i % 6) + 1, gross_sales_usd: 20 + i, item_discount_usd: 0, total_discount_usd: 0, revenue_usd: 18 + i, refund_usd: 0, collected_total_usd: 18 + i, avg_order_usd: 9, pending_revenue_usd: 0 })
    }
    return Promise.resolve({ rows })
  }
  export function getReportOverview() { return Promise.resolve({}) }
  export function getReportPeriods() { return Promise.resolve({ rows: [] }) }
  export function getBusinessSummarySalesPage() { return Promise.resolve({ rows: [], has_more: false, snapshot_max_id: 0, next_cursor: null }) }
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
const fixtureId = '\0reports-float-fixture'
const transportId = '\0reports-float-transport'

const vite = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'reports-float-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:reports-float-fixture') return fixtureId
      if (id.endsWith('/api/reportsTransport.ts') || id.endsWith('\\api\\reportsTransport.ts')) return transportId
      return null
    },
    load(id) {
      if (id === fixtureId) return fixtureSource
      if (id === transportId) return transportSource
      return null
    },
    async transform(code, id) {
      if (id !== fixtureId && id !== transportId) return null
      const transformed = await transformWithEsbuild(code, id === fixtureId ? 'reports-float-fixture.tsx' : 'reports-float-transport.ts', { loader: id === fixtureId ? 'tsx' : 'ts', jsx: 'automatic' })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      server.middlewares.use('/reports-float-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head></head><body><div id="root"></div><script>window.addEventListener("error",e=>document.body.dataset.fixtureError=String(e.error&&e.error.stack||e.message));window.addEventListener("unhandledrejection",e=>document.body.dataset.fixtureError=String(e.reason&&e.reason.stack||e.reason))</script><script type="module" src="/@id/virtual:reports-float-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/reports-float-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-reports-float-browser-'))
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${appPort}/reports-float-fixture`], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { const value = await read(); if (value !== null) return value; await new Promise((resolve) => setTimeout(resolve, 50)) }
  throw new Error('Timed out waiting for the reports float fixture')
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
/** Two animation frames plus a macrotask: long enough for a queued history
 *  traversal to have dispatched its popstate, if one was queued. */
const settle = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))`
const floatOpen = `!!document.querySelector('[role="dialog"]')`

let failed = 0
function check(name: string, run: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(run)
    .then(() => { console.log(`PASS ${name}`) })
    .catch((error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) })
}

try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.includes('/reports-float-fixture'))?.webSocketDebuggerUrl || null
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

  await waitFor(async () => {
    const state = await evaluate<{ error: string | null; rows: number }>('({ error: document.body.dataset.fixtureError || null, rows: document.querySelectorAll("table tbody tr").length })')
    if (state.error) throw new Error(`fixture threw: ${state.error}`)
    return state.rows >= 12 ? true : null
  })

  const openRow = async () => {
    await evaluate(`(() => { document.querySelectorAll('table tbody tr')[2].click(); return true })()`)
    await evaluate(settle)
    return evaluate<boolean>(floatOpen)
  }

  await check('a row click opens the detail float', async () => {
    assert.equal(await openRow(), true, 'clicking a report row opens its detail float')
  })

  await check('an unrelated re-render of the view leaves the float open', async () => {
    // THE regression. Before the Fold fix this closed the panel every time.
    await evaluate('window.__bump()')
    await evaluate(settle)
    assert.equal(await evaluate<boolean>(floatOpen), true, 'a re-render of the owning view must not close an open float')
    await evaluate('window.__bump(); window.__bump()')
    await evaluate(settle)
    assert.equal(await evaluate<boolean>(floatOpen), true, 'repeated re-renders must not close it either')
  })

  await check('pointer movement over the page leaves the float open', async () => {
    await evaluate(`(() => {
      const row = document.querySelectorAll('table tbody tr')[7]
      for (const type of ['mousemove', 'mouseover', 'mouseout', 'mouseleave', 'pointermove', 'pointerleave']) {
        row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 40, clientY: 400 }))
        document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 600, clientY: 20 }))
      }
      return true
    })()`)
    await evaluate(settle)
    assert.equal(await evaluate<boolean>(floatOpen), true, 'no pointer gesture short of a press may close the float')
  })

  await check('the detail sheet inside the float is ONE column, not a squeezed grid', async () => {
    const layout = await evaluate<{ width: number; columns: string; blocks: number; minBlock: number }>(`(() => {
      const panel = document.querySelector('[role="dialog"]')
      const sheet = panel.querySelector('.report-receipt-body')
      const blocks = [...sheet.children]
      return {
        width: Math.round(panel.getBoundingClientRect().width),
        columns: getComputedStyle(sheet).gridTemplateColumns,
        blocks: blocks.length,
        minBlock: Math.round(Math.min(...blocks.map((b) => b.getBoundingClientRect().width))),
      }
    })()`)
    assert.ok(layout.blocks >= 2, `the statement renders its groups (${layout.blocks} blocks)`)
    assert.equal(layout.columns, 'none', `a float-hosted sheet stays a single tape (grid-template-columns: ${layout.columns})`)
    assert.ok(layout.minBlock > layout.width * 0.6, `every block fills the float's width (narrowest ${layout.minBlock}px in a ${layout.width}px panel)`)
  })

  await check('names inside the float scroll instead of ending in an ellipsis', async () => {
    const names = await evaluate<{ heading: string; scrollers: number; ellipsis: number }>(`(() => {
      const panel = document.querySelector('[role="dialog"]')
      const heading = getComputedStyle(panel.querySelector('h3')).textOverflow
      const cells = [...panel.querySelectorAll('.detail-scroll-text')]
      return {
        heading,
        scrollers: cells.length,
        ellipsis: cells.filter((c) => getComputedStyle(c).textOverflow === 'ellipsis').length,
      }
    })()`)
    assert.equal(names.heading, 'clip', 'the float header scrolls its long name instead of clipping it with an ellipsis')
    assert.ok(names.scrollers > 0, 'the float body uses the shared horizontal scroller')
    assert.equal(names.ellipsis, 0, 'no scroller falls back to an ellipsis')
  })

  await check('a click outside closes the float', async () => {
    await evaluate(`(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }))
      return true
    })()`)
    await evaluate(settle)
    assert.equal(await evaluate<boolean>(floatOpen), false, 'an outside press closes the float')
  })

  await check('the header X closes the float', async () => {
    assert.equal(await openRow(), true, 'the float re-opens for the close-button check')
    await evaluate(`(() => { document.querySelector('[role="dialog"] button[aria-label="Close"]').click(); return true })()`)
    await evaluate(settle)
    assert.equal(await evaluate<boolean>(floatOpen), false, 'the one close affordance in the header closes the float')
  })
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }))
  const exited = await Promise.race([browserExit.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])
  if (!exited) { if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); else browser.kill() }
  for (const waiter of pending.values()) waiter.reject(new Error('Browser closed'))
  pending.clear(); socket?.close(); await vite.close(); removeBrowserProfile(profile)
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nreports detail float: opens on a row, survives re-renders and pointer movement, closes on outside press and on the header X')
finishBrowserTest()
