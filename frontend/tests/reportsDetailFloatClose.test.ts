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
//   5. scrolling the list MOVES the float with its row but never carries it
//      off the screen (the clamp in Fold's `placeAnchored`)

//   6. pressing a DIFFERENT row while it is open RE-TARGETS it -- the panel
//      moves to the new row instead of keeping the old row's coordinates
//      (`anchorKey`; a ref mutation is invisible to React)
//   7. and the two weight/layout claims the source-shape sweep can only make
//      as regexes are MEASURED here: the totals block is the only thing
//      painting at 600 in the sheet, and the column ladder turns over where
//      the 60rem container query says it does. Each has its own in-run
//      control that must flip it red.
//
// Plus the readability half: the sheet inside that 448px float lays its
// blocks out as ONE column, not the three ~90px columns the viewport-keyed
// `md:`/`xl:` grid produced on a desktop window.
//
// WHY THE FIXTURE IMPORTS TWO STYLESHEETS, and what went wrong without them.
// The first version of this file mounted GroupedReport alone. `main.css` is
// imported by the app entry and `reports-surface.css` by ReportsHub.tsx --
// neither of which this fixture loads -- so the page ran with NO project CSS
// at all, and every readability assertion passed on a browser DEFAULT rather
// than on the rule it names: `text-overflow` is `clip` by default, an element
// with no `display: grid` reports `grid-template-columns: none` by default,
// and with no `.detail-scroll-text` rule nothing could ever compute to
// `ellipsis`. Four green checks, zero evidence. Both stylesheets are loaded
// now, and each readability probe is run a SECOND time with the pre-fix rule
// set injected over it, where it must go red -- the control that proves the
// instrument can still see a defect.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

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
  // The REAL stylesheets, both of them: main.css carries .detail-scroll-text,
  // the Khmer line boxes and --app-vh (which is what gives the report table
  // its own scroll container); reports-surface.css carries the --ui-* tokens,
  // .report-segment and the receipt sheet's container queries. Without them
  // this fixture measures browser defaults -- see the header comment.
  import '/src/styles/main.css'
  import '/src/components/sales/reports/reports-surface.css'
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
    const [style, setStyle] = React.useState('excel')
    window.__bump = () => setTick((v) => v + 1)
    // The report body in the RECEIPT style: the same ReceiptSheet the float
    // renders, but with 60 record cards and the totals block, which is what
    // the weight and column-ladder measurements need.
    window.__setStyle = (next) => setStyle(next)
    return React.createElement(GroupedReport, {
      view, filters, search: '', options, style, fmtMoney, khrToUsd, tr, t,
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
// 60 rows, not 12: the table takes its own scroll container from main.css
// (`--app-vh` -> max-height: calc(70 * 1vh)), and the scroll assertion needs
// a list that actually scrolls far enough to carry a row off the top.
const transportSource = String.raw`
  export function getReportGrouped() {
    const rows = []
    for (let i = 0; i < 60; i++) {
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
function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  return waitForBrowser(read, 'the reports float fixture', timeoutMs)
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

let exitCode = 0
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

  await check('re-targeting the open float at another row moves it to that row', async () => {
    // A caller mutates `anchorRef.current` and changes which row is open.
    // React cannot see a ref mutation, so before `anchorKey` joined the
    // placement effect's deps the effect never re-ran and the panel kept the
    // FIRST row's coordinates while showing the SECOND row's data.
    const before = await evaluate<{ panelTop: number; rowBottom: number }>(`(() => {
      const panel = document.querySelector('[role="dialog"]').getBoundingClientRect()
      const row = document.querySelectorAll('table tbody tr')[2].getBoundingClientRect()
      return { panelTop: Math.round(panel.top), rowBottom: Math.round(row.bottom) }
    })()`)
    await evaluate(`(() => { document.querySelectorAll('table tbody tr')[9].click(); return true })()`)
    await evaluate(settle)
    const after = await evaluate<{ open: boolean; panelTop: number; rowBottom: number }>(`(() => {
      const panel = document.querySelector('[role="dialog"]')
      const row = document.querySelectorAll('table tbody tr')[9].getBoundingClientRect()
      return { open: !!panel, panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : NaN, rowBottom: Math.round(row.bottom) }
    })()`)
    // CONTROL: the two rows are far enough apart that "followed the anchor"
    // and "kept the old position" cannot both be true.
    assert.ok(Math.abs(after.rowBottom - before.rowBottom) > 50, `the two rows are far apart (${before.rowBottom} -> ${after.rowBottom})`)
    assert.equal(after.open, true, 'pressing a DIFFERENT row re-targets the float instead of closing it')
    assert.ok(Math.abs(after.panelTop - (after.rowBottom + 8)) <= 2, `the panel sits under the new row (top ${after.panelTop}, row bottom ${after.rowBottom})`)
    assert.ok(Math.abs(after.panelTop - before.panelTop) > 50, `and actually moved (was ${before.panelTop}, now ${after.panelTop})`)
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

  // ONE probe, run twice: once against the shipped stylesheets and once with
  // the pre-fix rule set injected over them. A probe that cannot be made to
  // report the defect is not measuring anything.
  const readabilityProbe = `(() => {
    const panel = document.querySelector('[role="dialog"]')
    const sheet = panel.querySelector('.report-receipt-body')
    const blocks = [...sheet.children]
    const cells = [...panel.querySelectorAll('.detail-scroll-text')]
    return {
      width: Math.round(panel.getBoundingClientRect().width),
      columns: getComputedStyle(sheet).gridTemplateColumns,
      blocks: blocks.length,
      minBlock: Math.round(Math.min(...blocks.map((b) => b.getBoundingClientRect().width))),
      heading: getComputedStyle(panel.querySelector('h3')).textOverflow,
      scrollers: cells.length,
      ellipsis: cells.filter((c) => getComputedStyle(c).textOverflow === 'ellipsis').length,
      sheetRule: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes('report-receipt-sheet')) } catch { return false } }),
      scrollerRule: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes('detail-scroll-text')) } catch { return false } }),
    }
  })()`
  type Readability = { width: number; columns: string; blocks: number; minBlock: number; heading: string; scrollers: number; ellipsis: number; sheetRule: boolean; scrollerRule: boolean }

  // The pre-fix rule set, restated as CSS: the kit's `truncate` on the fold
  // heading and on every name cell, and the viewport-keyed `xl:grid-cols-3`
  // that made a 448px float draw three ~90px columns on a 1280px window.
  const legacyDefectCss = `
    [role="dialog"] h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-scroll-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-receipt-layout='cards'] > .report-receipt-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    [data-receipt-layout='cards'] > .report-receipt-body > * { max-width: none; }
  `
  const withLegacyDefect = `(() => {
    const style = document.createElement('style')
    style.id = 'legacy-defect'
    style.textContent = ${JSON.stringify(legacyDefectCss)}
    document.head.appendChild(style)
    return true
  })()`
  const withoutLegacyDefect = `(() => { document.getElementById('legacy-defect')?.remove(); return true })()`

  await check('the real stylesheets are loaded (the probe can see project CSS at all)', async () => {
    const state = await evaluate<Readability>(readabilityProbe)
    assert.equal(state.sheetRule, true, 'reports-surface.css is in the document')
    assert.equal(state.scrollerRule, true, 'main.css is in the document')
  })

  await check('the detail sheet inside the float is ONE column, not a squeezed grid', async () => {
    const layout = await evaluate<Readability>(readabilityProbe)
    assert.ok(layout.blocks >= 2, `the statement renders its groups (${layout.blocks} blocks)`)
    assert.equal(layout.columns, 'none', `a float-hosted sheet stays a single tape (grid-template-columns: ${layout.columns})`)
    assert.ok(layout.minBlock > layout.width * 0.6, `every block fills the float's width (narrowest ${layout.minBlock}px in a ${layout.width}px panel)`)
  })

  await check('names inside the float scroll instead of ending in an ellipsis', async () => {
    const names = await evaluate<Readability>(readabilityProbe)
    assert.equal(names.heading, 'clip', 'the float header scrolls its long name instead of clipping it with an ellipsis')
    assert.ok(names.scrollers > 0, 'the float body uses the shared horizontal scroller')
    assert.equal(names.ellipsis, 0, 'no scroller falls back to an ellipsis')
  })

  await check('NEGATIVE CONTROL: the same probe reports RED against the pre-fix rule set', async () => {
    await evaluate(withLegacyDefect)
    await evaluate(settle)
    const defective = await evaluate<Readability>(readabilityProbe)
    try {
      assert.notEqual(defective.columns, 'none', 'with the viewport-keyed grid restored the sheet must report a grid')
      assert.ok(defective.minBlock <= defective.width * 0.6, `with three columns in a ${defective.width}px float a block must be narrow again (measured ${defective.minBlock}px)`)
      assert.equal(defective.heading, 'ellipsis', 'with the kit truncate restored the heading must report an ellipsis')
      assert.ok(defective.ellipsis > 0, 'with truncate restored the name cells must report an ellipsis')
    } finally {
      await evaluate(withoutLegacyDefect)
      await evaluate(settle)
    }
    const repaired = await evaluate<Readability>(readabilityProbe)
    assert.equal(repaired.columns, 'none', 'removing the control returns the sheet to one tape')
    assert.equal(repaired.heading, 'clip', 'removing the control returns the heading to the scroller')
  })

  await check('scrolling the list moves the float but never off the screen', async () => {
    // THE second half of "if i move it, it disappears": the panel follows its
    // anchor on every scroll, so before the clamp a list scrolled to the end
    // put the panel at top -1596px in this fixture (-872px on a real report,
    // measured by the lane verifier) -- off-screen, X unreachable,
    // and a fixed element cannot be scrolled back into view.
    const scrolled = await evaluate<{ scrolledBy: number; open: boolean; top: number; bottom: number; unclampedTop: number; close: { top: number; bottom: number; left: number; right: number } | null; viewport: number }>(`(async () => {
      const table = document.querySelector('table')
      let node = table.parentElement
      let scroller = null
      while (node && !scroller) {
        const style = getComputedStyle(node)
        if (node.scrollHeight - node.clientHeight > 50 && /auto|scroll/.test(style.overflowY)) scroller = node
        node = node.parentElement
      }
      if (!scroller) { scroller = document.scrollingElement; }
      const before = scroller.scrollTop
      scroller.scrollTop = scroller.scrollHeight
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))))
      const panel = document.querySelector('[role="dialog"]')
      // Row 9: the re-target check above moved the anchor there.
      const anchor = document.querySelectorAll('table tbody tr')[9]
      const anchorRect = anchor.getBoundingClientRect()
      const panelRect = panel ? panel.getBoundingClientRect() : null
      const closeButton = panel ? panel.querySelector('button[aria-label="Close"]') : null
      const closeRect = closeButton ? closeButton.getBoundingClientRect() : null
      return {
        scrolledBy: Math.round(scroller.scrollTop - before),
        open: !!panel,
        top: panelRect ? Math.round(panelRect.top) : NaN,
        bottom: panelRect ? Math.round(panelRect.bottom) : NaN,
        // What the UNCLAMPED placement would have produced from the same rect.
        unclampedTop: Math.round(anchorRect.bottom + 8),
        close: closeRect ? { top: Math.round(closeRect.top), bottom: Math.round(closeRect.bottom), left: Math.round(closeRect.left), right: Math.round(closeRect.right) } : null,
        viewport: window.innerHeight,
      }
    })()`)
    // CONTROL, inside the same measurement: the anchor really did leave the
    // viewport, so the clamp assertion below is not passing because nothing
    // moved. Without the clamp this run would have placed the panel at
    // `unclampedTop`, which is above the top margin.
    assert.ok(scrolled.scrolledBy > 100, `the list actually scrolled (${scrolled.scrolledBy}px)`)
    assert.ok(scrolled.unclampedTop < 8, `the unclamped placement would have been off-screen (top ${scrolled.unclampedTop}px), so the clamp is what is being measured`)
    assert.equal(scrolled.open, true, 'scrolling the list never closes the float')
    assert.ok(scrolled.top >= 8, `the panel stays inside the viewport (top ${scrolled.top}px)`)
    assert.ok(scrolled.bottom <= scrolled.viewport, `and inside its bottom edge (bottom ${scrolled.bottom}px in a ${scrolled.viewport}px viewport)`)
    assert.ok(scrolled.close && scrolled.close.top >= 0 && scrolled.close.bottom <= scrolled.viewport, `the close button is reachable (${JSON.stringify(scrolled.close)})`)
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

  // -------------------------------------------------------------------------
  // The two claims reportsReadableRows can only make as regexes, measured.
  // -------------------------------------------------------------------------
  await check('the report body renders in the receipt style for the measured checks', async () => {
    await evaluate(`(() => { window.__setStyle('receipt'); return true })()`)
    await evaluate(settle)
    const blocks = await evaluate<number>(`document.querySelectorAll('.report-receipt-body > *').length`)
    assert.ok(blocks >= 60, `the receipt-style report body renders its record cards plus the totals block (${blocks})`)
  })

  /** Every element in the report body sheet that actually PAINTS at >=600,
   *  and whether it sits in the last block (the totals footer) or above it. */
  const weightProbe = `(() => {
    const body = document.querySelector('.report-receipt-body')
    const blocks = [...body.children]
    const last = blocks[blocks.length - 1]
    const bold = [...body.querySelectorAll('*')].filter((el) => {
      if (!el.textContent.trim()) return false
      return parseInt(getComputedStyle(el).fontWeight, 10) >= 600
    })
    return {
      blocks: blocks.length,
      boldTotal: bold.length,
      boldInLast: bold.filter((el) => last.contains(el)).length,
      boldOutsideLast: bold.filter((el) => !last.contains(el)).length,
      lastTitle: last.textContent.trim().slice(0, 16),
    }
  })()`
  type Weights = { blocks: number; boldTotal: number; boldInLast: number; boldOutsideLast: number; lastTitle: string }

  await check('the totals block is the ONLY thing painting at 600 in the sheet', async () => {
    // The owner's complaint was the weight, not the absence of it: "the
    // boldness, weight made it worse". One bold block per sheet, in the same
    // place the excel style bolds its <tfoot> row -- and the source regex in
    // reportsReadableRows cannot tell whether that is what PAINTS.
    const weights = await evaluate<Weights>(weightProbe)
    assert.ok(weights.boldInLast > 0, `the totals block carries the sheet's one bold cue (${weights.boldInLast} elements, block text "${weights.lastTitle}")`)
    assert.equal(weights.boldOutsideLast, 0, `nothing above the totals block paints at 600 (${weights.boldOutsideLast} of ${weights.boldTotal} in ${weights.blocks} blocks)`)
  })

  await check('CONTROL: the weight probe reports RED when the record cards are bold again', async () => {
    // If every `font-medium` in the sheet is pushed to 700, the probe has to
    // see it. A probe that returns 0 either way is measuring nothing.
    await evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'bold-cards-control'
      style.textContent = '.report-receipt-body .font-medium { font-weight: 700 }'
      document.head.appendChild(style)
      return true
    })()`)
    await evaluate(settle)
    let defective: Weights
    try {
      defective = await evaluate<Weights>(weightProbe)
    } finally {
      await evaluate(`(() => { document.getElementById('bold-cards-control')?.remove(); return true })()`)
      await evaluate(settle)
    }
    assert.ok(defective.boldOutsideLast > 10, `with the record cards bold again the probe must see them (${defective.boldOutsideLast})`)
    const repaired = await evaluate<Weights>(weightProbe)
    assert.equal(repaired.boldOutsideLast, 0, 'removing the control returns the sheet to one bold block')
  })

  /** Column tracks the sheet actually lays out at a GIVEN sheet width. The
   *  tier is a container query, so forcing the sheet's own inline size is
   *  what the rule answers -- no window resize needed. */
  const columnsAt = (width: number) => `(async () => {
    const sheet = document.querySelector('.report-receipt-sheet')
    sheet.style.width = '${width}px'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const body = sheet.querySelector('.report-receipt-body')
    const tracks = getComputedStyle(body).gridTemplateColumns
    return { measured: Math.round(sheet.getBoundingClientRect().width), tracks, columns: tracks === 'none' ? 1 : tracks.split(' ').length }
  })()`
  type Columns = { measured: number; tracks: string; columns: number }

  await check('the column ladder straddles 60rem where the stylesheet says it does', async () => {
    // 1008px is 63rem: above the 60rem tier that shipped, BELOW the 64rem one
    // it replaced. That is the whole repair -- at a 1053px sheet (a 1440px
    // window) the 64rem tier dropped back to two columns while a 1280px window
    // showed three.
    const wide = await evaluate<Columns>(columnsAt(1008))
    assert.equal(wide.measured, 1008, `the sheet really is 1008px wide (${wide.measured})`)
    assert.equal(wide.columns, 3, `a 1008px sheet lays out three cards (${wide.tracks})`)
    const mid = await evaluate<Columns>(columnsAt(900))
    assert.equal(mid.columns, 2, `a 900px sheet lays out two (${mid.tracks})`)
    const narrow = await evaluate<Columns>(columnsAt(500))
    assert.equal(narrow.columns, 1, `and a 500px sheet stays one tape (${narrow.tracks})`)
  })

  await check('CONTROL: the column probe reports the OLD ladder when 64rem is restored', async () => {
    // The pre-fix tier, restated: three columns only from 64rem. If the probe
    // still says 3 at 1008px with this injected, it is reading a constant.
    await evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'old-tier-control'
      style.textContent = "@container (min-width: 60rem) and (max-width: 63.999rem) { [data-receipt-layout='cards'] > .report-receipt-body { grid-template-columns: repeat(2, minmax(0, 1fr)) } }"
      document.head.appendChild(style)
      return true
    })()`)
    await evaluate(settle)
    let defective: Columns
    try {
      defective = await evaluate<Columns>(columnsAt(1008))
    } finally {
      await evaluate(`(() => { document.getElementById('old-tier-control')?.remove(); document.querySelector('.report-receipt-sheet').style.width = ''; return true })()`)
      await evaluate(settle)
    }
    assert.equal(defective.columns, 2, `with the 64rem tier restored a 1008px sheet falls back to two columns (${defective.tracks})`)
  })
} catch (error) {
  exitCode = 1
  console.error('FAIL reports detail float fixture')
  console.error(error)
}

if (failed) { console.error(`\n${failed} check(s) failed`); exitCode = 1 }
if (!exitCode) console.log('\nreports detail float: opens on a row, survives re-renders and pointer movement, closes on outside press and on the header X')
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
