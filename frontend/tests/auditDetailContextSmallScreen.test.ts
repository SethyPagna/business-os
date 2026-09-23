// The Audit Log detail float on a phone: the changed-field rows and the new
// recorded-context block, measured in a real engine at 375 px.
//
// The owner reads this on a phone, and the two things a source-shape test
// cannot see are exactly the two that break there: a long value (a receipt
// template runs to kilobytes) pushing the page sideways, and a "compact" row
// that is only compact on a desktop column. Measured here, not assumed:
// document scrollWidth against the viewport, and the height of every row.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { buildAuditFieldDiff } from '../src/utils/auditLogFieldDiff.ts'
import { closeBrowserFixture, closeCdpBrowser, removeBrowserProfile, waitForBrowser } from './browserProfileTeardown.ts'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the audit detail small-screen check')

// The three rows the verifier named, built by the REAL builder so the fixture
// cannot drift from what the float will show.
const LEGACY_RENAME = buildAuditFieldDiff(null, JSON.stringify({ from: 'Coke 330 ml', to: 'Coke Zero', rows: 1, scope: 'group' }))
const RENAME_PAIR = buildAuditFieldDiff(
  JSON.stringify({ payment_method: 'ABA', configured_methods: ['Cash', 'ABA'] }),
  JSON.stringify({ payment_method: 'ABA Bank', configured_methods: ['Cash', 'ABA Bank'] }),
)
const RENAME_CONTEXT = buildAuditFieldDiff(null, JSON.stringify({
  action: 'payment_method_replace', from: 'ABA', to: 'ABA Bank', scope: 'linked', linkedSales: 12, linkedDetails: 30,
}))
const LONG_VALUE = buildAuditFieldDiff(null, JSON.stringify({
  receipt_template: 'HEADER LINE OF A THERMAL RECEIPT TEMPLATE '.repeat(120),
  // A Khmer label and value: the line box has to have room for the subscripts.
  ឈ្មោះហាង: 'ហាងលក់គ្រឿងទេសនិងភេសជ្ជៈត្រជាក់',
}))
const ROWS = [...LEGACY_RENAME, ...RENAME_PAIR, ...RENAME_CONTEXT, ...LONG_VALUE]
assert.ok(ROWS.length >= 12, `expected the fixture rows, built ${ROWS.length}`)

const fixture = `
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import AuditFieldDiffLine from './src/components/utils-settings/AuditFieldDiffLine.tsx'
  window.__rows = ${JSON.stringify(ROWS)}
  createRoot(document.getElementById('root')).render(
    React.createElement('div', { style: { padding: '12px' } },
      window.__rows.map((row, index) => React.createElement(AuditFieldDiffLine, { key: index, row }))))
`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'audit-detail-context-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
})
const bundle = built.outputFiles[0].text

// The float's own classes come from Tailwind, which is not run here; what is
// measured is the layout the component's structure produces, plus the one
// rule the long block depends on (max-height + overflow), declared inline so
// the measurement is honest about what it is testing.
const css = String.raw`
  @font-face{font-family:FixtureKhmer;src:url(/khmer.woff2);font-weight:400}
  *{box-sizing:border-box}
  html,body{margin:0;max-width:100%}
  body{font-family:FixtureKhmer,Arial,sans-serif;font-size:12px;color:#1f2937}
  #root{padding:12px;max-width:100%}
  .flex{display:flex}
  .flex-wrap{flex-wrap:wrap}
  .items-baseline{align-items:baseline}
  .items-center{align-items:center}
  .gap-x-2{column-gap:8px}
  .gap-y-0.5{row-gap:2px}
  .gap-1{gap:4px}
  .text-xs{font-size:12px}
  .text-[11px]{font-size:11px}
  .leading-relaxed{line-height:1.625}
  .w-28{width:112px}
  .flex-shrink-0{flex-shrink:0}
  .min-w-0{min-width:0}
  .break-words{overflow-wrap:break-word;word-break:break-word}
  .max-h-40{max-height:160px}
  .overflow-auto{overflow:auto}
  .whitespace-pre-wrap{white-space:pre-wrap}
  .p-2{padding:8px}
  .mb-0.5{margin-bottom:2px}
  .line-through{text-decoration:line-through}
  .font-medium{font-weight:500}
  pre{margin:0}
  [data-audit-diff-row]{max-width:100%}
`


const server = http.createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
})

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
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(appPort, '127.0.0.1', resolve)
})

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-audit-detail-'))
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  return waitForBrowser(read, 'the audit detail small-screen fixture', timeoutMs)
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

let exitCode = 0
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

  await waitFor(async () => await evaluate(`document.querySelectorAll('[data-audit-diff-row]').length === ${ROWS.length}`) ? true : null)
  // The override is applied AFTER the page is up: applied before load it is
  // dropped by the navigation, and every row then measures at desktop width.
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 1, mobile: false })
  await waitFor(async () => await evaluate('window.innerWidth === 375') ? true : null)

  const page = await evaluate<{ scrollWidth: number; clientWidth: number }>(
    '({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })',
  )
  assert.ok(
    page.scrollWidth <= page.clientWidth + 1,
    `the detail rows push the page sideways at 375px: ${page.scrollWidth} > ${page.clientWidth}`,
  )

  const rows = await evaluate<Array<{ type: string; height: number; width: number; long: boolean; preScrolls: boolean; preHeight: number }>>(`
    Array.from(document.querySelectorAll('[data-audit-diff-row]'), (row) => {
      const rect = row.getBoundingClientRect()
      const pre = row.querySelector('pre')
      return {
        type: row.getAttribute('data-audit-diff-row'),
        height: Math.round(rect.height),
        width: Math.round(rect.width),
        long: !!pre,
        preScrolls: pre ? pre.scrollHeight > pre.clientHeight : false,
        preHeight: pre ? Math.round(pre.clientHeight) : 0,
      }
    })
  `)

  for (const row of rows) {
    assert.ok(row.width <= 375, `a row is wider than the phone: ${row.width}px`)
    if (row.long) {
      // The kilobyte template is scrollable inside its own block, not an
      // endless column of text.
      assert.ok(row.preHeight <= 160 + 1, `the long-value block is ${row.preHeight}px tall`)
      assert.ok(row.preScrolls, 'the long-value block must actually scroll its content')
    } else {
      // Compact: a short row is at most three wrapped lines even at 375px,
      // and Khmer keeps its vertical room (one line is never < 14px here).
      assert.ok(row.height <= 72, `a ${row.type} row is ${row.height}px tall at 375px`)
      assert.ok(row.height >= 14, `a ${row.type} row collapsed to ${row.height}px -- Khmer would clip`)
    }
  }

  const contextRows = rows.filter((row) => row.type === 'context')
  const changedRows = rows.filter((row) => row.type === 'changed')
  assert.ok(contextRows.length >= 8, `expected the context rows, found ${contextRows.length}`)
  assert.ok(changedRows.length >= 2, `expected the pair rows, found ${changedRows.length}`)
  assert.equal(rows.filter((row) => row.type === 'added').length, 0, 'no row here was added to anything')

  console.log(`PASS audit detail rows at 375px: ${rows.length} rows, page ${page.scrollWidth}/${page.clientWidth}px, tallest ${Math.max(...rows.map((row) => row.height))}px`)
} catch (error) {
  exitCode = 1
  console.error('FAIL audit detail small-screen fixture')
  console.error(error)
}

await closeBrowserFixture(
  exitCode,
  () => closeCdpBrowser(browser, browserExit, socket),
  () => new Promise<void>((resolve) => server.close(() => resolve())),
  () => removeBrowserProfile(profile),
)
