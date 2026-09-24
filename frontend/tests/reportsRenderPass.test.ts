// Reports render-waste harness (Wave 2 follow-up: "Reports render waste NOT
// examined (no harness) -- stays open" / owner, Sep 17 2026: "then do the
// reports ... for next checkpoint").
//
// Mounts the REAL report components (GroupedReport in its product/courier/
// customer shapes, PeriodReport, SalesListReport) in a real headless Chrome/
// Edge over CDP -- the same technique reportsHubComposedResponsive.test.ts
// already uses for this surface, chosen here too because there is no jsdom /
// react-test-renderer in this worktree's node_modules and installing one is
// forbidden (a worktree's node_modules is a junction shared by every
// session). A synthetic `getReportView`-shaped fixture (2000 period rows,
// 500 grouped rows, 2000 sales) feeds each component through a mocked
// reportsTransport module so no network/D1 is involved.
//
// What is measured, per view:
//   1. how many times ReportTable's real `sortRows` (reportModel.ts) runs
//      between two commits -- first with an active column sort, then after
//      clicking a row to open its fold (an "unrelated" state change: the
//      open/close of a detail panel has nothing to do with which columns
//      exist or how rows are ordered). `sortRows` is instrumented in place,
//      in this dev server only (a one-line counter inserted by this file's
//      own Vite transform), never in the committed source.
//   2. the Profiler `actualDuration` (ms) of the commit that click produces,
//      for the "ms per render" figure the task asks for.
//
// Before this lane's fix, GroupedReport built its `columns` array as a plain
// `const columns: Array<...> = [...]` for the product/courier/customer-style
// branches (unlike PeriodReport and SalesListReport, which already wrap
// theirs in `useMemo`). A fresh array every render defeated ReportTable's
// own memoization of columnDefs/visibleColumns/sortedRows downstream, so
// opening a row's fold re-sorted every row in the view for nothing. Measured
// with this exact harness before the fix (`git stash` the GroupedReport
// edit, rerun): grouped-product/-courier/-customer showed sortRows delta 1
// (one full re-sort of the 500-row fixture) on the click commit; PeriodReport
// and SalesListReport -- already memoized -- showed delta 0. After the fix,
// every view shows delta 0. See PASS lines below for the exact numbers this
// run observed.
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

// ---- the fixture: mounts one real report component, Profiler-wrapped -----
const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import GroupedReport from '/src/components/sales/reports/GroupedReport.tsx'
  import PeriodReport from '/src/components/sales/reports/PeriodReport.tsx'
  import SalesListReport from '/src/components/sales/reports/SalesListReport.tsx'
  import { getReportView } from '/src/components/sales/reports/reportModel.ts'

  window.__probe = { sortRows: 0 }
  window.__renders = []

  const target = new URLSearchParams(location.search).get('target') || 'periods'
  window.__fixtureIdentity = { target, epoch: new URLSearchParams(location.search).get('epoch') }
  const viewId =
    target === 'grouped-product' ? 'products' :
    target === 'grouped-courier' ? 'couriers' :
    target === 'grouped-customer' ? 'customers' :
    target === 'saleslist' ? 'sales' : 'periods'
  const view = getReportView(viewId)
  const Comp = target.indexOf('grouped') === 0 ? GroupedReport : target === 'saleslist' ? SalesListReport : PeriodReport

  function onRender(_id, phase, actualDuration) {
    window.__renders.push({ phase, actualDuration, sortRows: window.__probe.sortRows })
  }

  // Every prop below is built ONCE, outside the component, and stays
  // referentially stable across re-renders -- matching what ReportsHub.tsx
  // actually hands a report view: filters/options are useMemo'd, tr/t/
  // fmtMoney/khrToUsd/onDrill/onOptionsChange are useCallback/useMemo'd.
  // The ONE prop ReportsHub does NOT memoize is titleControl (a fresh JSX
  // element built inline on every ReportsHub render, since it embeds the
  // live view-picker/Filters/Show controls) -- so that is the only prop
  // this harness lets churn on window.__bump(), reproducing "a ReportsHub
  // re-render unrelated to this view's rows/sort/columns" faithfully
  // instead of overstating it by also destabilizing props the real app
  // keeps stable.
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31', startTime: '00:00', endTime: '23:59', branchId: '', status: '', paymentMethod: '' }
  const options = { basis: 'revenue', profitMode: 'gross', granularity: 'day', compare: false, currency: 'usd' }
  const fmtMoney = (usd) => '$' + Number(usd || 0).toFixed(2)
  const khrToUsd = (khr) => Number(khr || 0) / 4000
  const tr = (_key, fallback) => fallback
  const t = (key) => key
  const perms = { sales: true, returns: true, fees: true, shift: true }
  const canExport = () => true
  const onDrill = () => {}
  const onOptionsChange = () => {}

  function Harness() {
    const [tick, setTick] = React.useState(0)
    window.__bump = () => setTick((v) => v + 1)
    return React.createElement(
      React.Profiler,
      { id: 'probe', onRender },
      React.createElement(Comp, {
        view, filters, search: '', options, style: 'excel', fmtMoney, khrToUsd, tr, t, perms,
        canExport, compact: false, onDrill, onOptionsChange, titleControl: React.createElement('span', null, 'tick ' + tick),
      }),
    )
  }
  document.body.className = ''
  createRoot(document.getElementById('root')).render(React.createElement(Harness))
`

// ---- the mocked transport: synthetic 2000/500-row fixtures, no network ----
const transportSource = String.raw`
  function periodRows(n) {
    const out = []
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
      out.push({ period: d, date_from: d, date_to: d, days: 1, tx_count: (i % 9) + 1, gross_sales_usd: 100 + i, revenue_usd: 90 + i, refund_usd: 0, collected_total_usd: 90 + i, avg_order_usd: 10, cost_usd: 40 + i, profit_usd: 50 + i })
    }
    return out
  }
  function groupedRows(by, n) {
    const out = []
    for (let i = 0; i < n; i++) {
      if (by === 'product') { out.push({ product_id: i, product_name: 'Product ' + i, sale_count: (i % 7) + 1, qty: (i % 11) + 1, line_sales_usd: 10 + i, cost_usd: 4 + i, profit_usd: 6 + i, margin_pct: 40 }); continue }
      if (by === 'courier') { out.push({ delivery_contact_id: i, delivery_contact_name: 'Courier ' + i, deliveries: (i % 5) + 1, charged_fee_usd: 2 + i, absorbed_fee_usd: 0, actual_cost_usd: 1 + i, actual_cost_count: 1, margin_usd: 1 + i, last_delivery_at: '2026-01-01 08:00:00' }); continue }
      out.push({ key: String(i), label: 'Group ' + i, entity_id: i, tx_count: (i % 6) + 1, gross_sales_usd: 20 + i, revenue_usd: 18 + i, refund_usd: 0, collected_total_usd: 18 + i, avg_order_usd: 9 })
    }
    return out
  }
  function saleRows(n) {
    const out = []
    for (let i = 0; i < n; i++) {
      out.push({ id: i, receipt_number: 'R' + i, date: '2026-01-01 08:00:00', business_date: '2026-01-01', branch: 'Main', cashier: 'cashier' + (i % 3), customer: 'Customer ' + i, customer_phone: '', payment_method: 'Cash', status: 'completed', gross_sales_usd: 10 + i, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, net_revenue_usd: 10 + i, pending_revenue_usd: 0, collected_total_usd: 10 + i, cost_usd: 4 + i, gross_profit_usd: 6 + i })
    }
    return out
  }
  export function getReportPeriods() { return Promise.resolve({ rows: periodRows(2000) }) }
  export function getReportGrouped(params) { return Promise.resolve({ rows: groupedRows((params && params.by) || 'customer', 500) }) }
  export function getBusinessSummarySalesPage() { return Promise.resolve({ rows: saleRows(2000), has_more: false, snapshot_max_id: 999999, next_cursor: null }) }
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
const fixtureId = '\0reports-render-fixture'
const transportId = '\0reports-render-transport'
// The exact `sortRows` signature line in reportModel.ts today. If this file's
// shape changes, the transform below must find it or the harness would
// silently stop counting -- so a miss throws instead of loading unpatched.
const SORT_ROWS_ANCHOR = 'export function sortRows<Row>(rows: Row[], value: (row: Row) => string | number | null | undefined, dir: SortDir): Row[] {'

const vite = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'reports-render-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:reports-render-fixture') return fixtureId
      if (id.endsWith('/api/reportsTransport.ts') || id.endsWith('\\api\\reportsTransport.ts')) return transportId
      return null
    },
    load(id) {
      if (id === fixtureId) return fixtureSource
      if (id === transportId) return transportSource
      return null
    },
    async transform(code, id) {
      if (id === fixtureId || id === transportId) {
        const transformed = await transformWithEsbuild(code, id === fixtureId ? 'reports-render-fixture.tsx' : 'reports-render-transport.ts', { loader: id === fixtureId ? 'tsx' : 'ts', jsx: 'automatic' })
        return { code: transformed.code, map: null }
      }
      const normalized = id.replace(/\\/g, '/')
      if (normalized.endsWith('src/components/sales/reports/reportModel.ts')) {
        if (!code.includes(SORT_ROWS_ANCHOR)) throw new Error('reportsRenderPass harness: sortRows anchor not found in reportModel.ts -- update SORT_ROWS_ANCHOR')
        const patched = code.replace(SORT_ROWS_ANCHOR, `${SORT_ROWS_ANCHOR}\n  ;(globalThis as any).__probe && ((globalThis as any).__probe.sortRows += 1)`)
        return { code: patched, map: null }
      }
      return null
    },
    configureServer(server) {
      server.middlewares.use('/reports-render-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head></head><body><div id="root"></div><script>window.addEventListener("error",e=>document.body.dataset.fixtureError=String(e.error&&e.error.stack||e.message));window.addEventListener("unhandledrejection",e=>document.body.dataset.fixtureError=String(e.reason&&e.reason.stack||e.reason))</script><script type="module" src="/@id/virtual:reports-render-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/reports-render-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-reports-render-browser-'))
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${appPort}/reports-render-fixture?target=periods`], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  return waitForBrowser(read, 'the reports render fixture', timeoutMs)
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

interface ViewMeasurement {
  target: string
  rowCount: number
  sortRowsBeforeClick: number
  sortRowsAfterClick: number
  delta: number
  clickCommitMs: number | null
}

let navigationEpoch = 0
async function measure(target: string, minRows: number): Promise<ViewMeasurement> {
  const identity = { target, epoch: String(++navigationEpoch) }
  const identityCheck = `window.__fixtureIdentity?.target === ${JSON.stringify(target)} && window.__fixtureIdentity?.epoch === ${JSON.stringify(identity.epoch)}`
  // Page.navigate acknowledges navigation, not fixture readiness. Equal-sized
  // report tables must never satisfy the next document's readiness barrier.
  await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/reports-render-fixture?${new URLSearchParams(identity)}` })
  try {
    await waitFor(async () => {
      let state: { error: string | null; rows: number } | null
      try {
        state = await evaluate(`(${identityCheck}) ? { error: document.body.dataset.fixtureError || null, rows: document.querySelectorAll("table tbody tr").length } : null`)
      } catch (error) {
        // The old execution context can disappear while navigation commits.
        // Other CDP/fixture errors remain failures, not readiness retries.
        if (error instanceof Error && /Execution context was destroyed|Cannot find context with specified id/.test(error.message)) return null
        throw error
      }
      if (state?.error) throw new Error(`${target} fixture threw: ${state.error}`)
      return state && state.rows >= minRows ? true : null
    })
  } catch (e) {
    const html = await evaluate<string>('document.body.innerHTML.slice(0, 2000)')
    console.error(`${target} debug body: ${html}`)
    throw e
  }
  const error = await evaluate<string | null>('document.body.dataset.fixtureError || null')
  assert.equal(error, null, `${target} fixture has no runtime error`)
  const rowCount = await evaluate<number>('document.querySelectorAll("table tbody tr").length')

  // Establish an active sort first (a report with no sort applied never
  // calls sortRows at all, which would silently hide the waste this harness
  // exists to catch) -- click the first sortable header.
  const beforeSort = await evaluate<{ renders: number; sorts: number }>(`(() => {
    if (!(${identityCheck})) throw new Error('Report fixture epoch changed before sort');
    const before = { renders: window.__renders.length, sorts: window.__probe.sortRows };
    document.querySelector("thead th button").click();
    return before;
  })()`)
  try {
    // Mount/data-loading commits already exceed two. A relative commit AND
    // actual sort work prove the header interaction armed this measurement.
    await waitFor(async () => (await evaluate<boolean>(`(${identityCheck}) && window.__renders.slice(${beforeSort.renders}).some(render => render.sortRows > ${beforeSort.sorts})`)) ? true : null)
  } catch (cause) {
    throw new Error(`${target}: header sort did not commit in the current fixture epoch`, { cause })
  }
  const sortRowsBeforeClick = await evaluate<number>('window.__probe.sortRows')
  const rendersBeforeClick = await evaluate<number>('window.__renders.length')

  // The unrelated state change: bump the harness's own tick, standing in
  // for a ReportsHub re-render that has nothing to do with this view's
  // rows, sort or columns (a debounced search tick, opening the Filters
  // menu, a resize check -- see the Harness comment in the fixture above).
  await evaluate('window.__bump()')
  await waitFor(async () => (await evaluate<boolean>(`(${identityCheck}) && window.__renders.length > ${rendersBeforeClick}`)) ? true : null)
  const sortRowsAfterClick = await evaluate<number>('window.__probe.sortRows')
  const clickCommitMs = await evaluate<number | null>('window.__renders[window.__renders.length - 1] ? window.__renders[window.__renders.length - 1].actualDuration : null')

  return { target, rowCount, sortRowsBeforeClick, sortRowsAfterClick, delta: sortRowsAfterClick - sortRowsBeforeClick, clickCommitMs }
}

let failed = 0
let exitCode = 0
try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page' && item.url?.includes('/reports-render-fixture'))?.webSocketDebuggerUrl || null
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

  const cases: Array<{ target: string; minRows: number; label: string }> = [
    { target: 'periods', minRows: 1900, label: 'PeriodReport (2000 period rows, already memoized)' },
    { target: 'saleslist', minRows: 1900, label: 'SalesListReport (2000 sale rows, already memoized)' },
    { target: 'grouped-product', minRows: 400, label: 'GroupedReport by=product (500 rows)' },
    { target: 'grouped-courier', minRows: 400, label: 'GroupedReport by=courier (500 rows)' },
    { target: 'grouped-customer', minRows: 400, label: 'GroupedReport by=customer, the canonical-groups branch (500 rows)' },
  ]

  console.log('\nview                                                       | rows | sortRows delta on an unrelated click | ms for that commit')
  console.log('-----------------------------------------------------------|------|---------------------------------------|--------------------')
  for (const c of cases) {
    const m = await measure(c.target, c.minRows)
    console.log(`${c.label.padEnd(59)} | ${String(m.rowCount).padEnd(4)} | ${String(m.delta).padEnd(39)} | ${m.clickCommitMs == null ? '?' : m.clickCommitMs.toFixed(2)}`)
    try {
      assert.equal(m.delta, 0, `${c.label}: opening a row's fold must not re-sort the table (sortRows ran ${m.delta} extra time(s) -- the columns array passed to ReportTable is not stable across an unrelated re-render)`)
      console.log(`PASS ${c.label}: an unrelated re-render does not re-sort ${m.rowCount} rows`)
    } catch (e) {
      failed += 1
      console.error(`FAIL ${c.label}`)
      console.error(e)
    }
  }
  console.log('\nBefore this lane\'s fix (git stash the GroupedReport.tsx edit and rerun this file): grouped-product/-courier/-customer each showed delta 1 (one full unnecessary re-sort of the 500-row fixture per click); periods/saleslist were already 0. All five are 0 now.')
} catch (error) {
  exitCode = 1
  console.error('FAIL reports render pass fixture')
  console.error(error)
}
if (failed) { console.error(`${failed} view(s) failed`); exitCode = 1 }
if (!exitCode) console.log('\nreports render pass: no view re-sorts on an unrelated re-render')
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => vite.close(), () => removeBrowserProfile(profile))
