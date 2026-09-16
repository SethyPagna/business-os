import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build, type Plugin } from 'esbuild'
import { finishBrowserTest, removeBrowserProfile } from './browserProfileTeardown.ts'

// Native-browser coverage for the composed StockChangeSection. This renders
// the real section, ProductNameRail, history model, batch-label formatter and
// Revert state machine. Only network/context and heavyweight inactive children
// are local fixture modules; no application or production API is contacted.

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the composed Stock Change regression')

const mockModules: Record<string, string> = {
  '../../AppContext': `
    const app = {
      can: () => true,
      notify: (message, type) => window.__notifications.push({ message, type: type || '' }),
      user: { id: 7, username: 'fixture-admin' },
    }
    export function useApp() { return app }
  `,
  '../../api/productReadTransport.ts': `
    export async function getStockLedger() {
      window.__readCalls += 1
      return {
        items: [window.__fixtureRow],
        total: 1,
        totalPages: 1,
        summary: { inCount: 0, outCount: 1, inQty: 0, outQty: 12, total: 1 },
      }
    }
  `,
  '../../api/inventoryWriteTransport.ts': `
    export async function revertStockMovement(id) {
      window.__revertCalls.push(id)
      return { success: true }
    }
    export async function editStockMovementReason() { return { success: true } }
  `,
  '../shared/Modal': `
    import React from 'react'
    export default function Modal({ title, children }) {
      return <section role="dialog" aria-label={title} data-fixture-modal="true"><h1>{title}</h1>{children}</section>
    }
  `,
  '../shared/DateTimeRangePicker': `import React from 'react'; export default function DateTimeRangePicker() { return <div data-fixture-control="date" /> }`,
  '../shared/FilterMenu': `import React from 'react'; export default function FilterMenu() { return <div data-fixture-control="filters" /> }`,
  '../shared/PaginationControls': `import React from 'react'; export default function PaginationControls() { return <div data-fixture-control="pager" /> }`,
  '../shared/SearchInput': `import React from 'react'; export default function SearchInput() { return <input data-fixture-control="search" /> }`,
  '../shared/ScanSearchButton': `import React from 'react'; export default function ScanSearchButton() { return <button data-fixture-control="scan">scan</button> }`,
  '../shared/InfoHint': `import React from 'react'; export default function InfoHint() { return <button data-info-hint="true">info</button> }`,
  './forms/StockAdjustModal': `export default function StockAdjustModal() { return null }`,
  '../inventory/FastStockInModal': `export default function FastStockInModal() { return null }`,
  '../shared/ExportRangeDialog': `export default function ExportRangeDialog() { return null }`,
  '../../api/branchTransport.ts': `export async function getBranches() { return [] }`,
  '../shared/SupplierPickerField.tsx': `export async function loadSupplierNames() { return [] }`,
}

const fixturePlugin: Plugin = {
  name: 'stock-change-local-fixture',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => (
      Object.hasOwn(mockModules, args.path) ? { path: args.path, namespace: 'stock-change-mock' } : null
    ))
    builder.onLoad({ filter: /.*/, namespace: 'stock-change-mock' }, (args) => ({
      contents: mockModules[args.path],
      loader: 'tsx',
      resolveDir: root,
    }))
  },
}

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import StockChangeSection from './src/components/products/StockChangeSection.tsx'

  const km = new URLSearchParams(location.search).get('lang') === 'km'
  const copy = km ? {
    sale: 'ការលក់', revert: 'ត្រឡប់ការផ្លាស់ប្តូរ', confirm_revert: 'ត្រឡប់ការផ្លាស់ប្តូរនេះ?',
    cancel: 'បោះបង់', cashier_user: 'អ្នកប្រើ', branch: 'សាខា', reason: 'មូលហេតុ',
  } : {}
  window.__notifications = []
  window.__readCalls = 0
  window.__revertCalls = []
  window.__expected = km ? {
    name: 'ទឹកអប់ផ្កាកូជប្រភេទពិសេសសម្រាប់ខួបអនុស្សាវរីយ៍ដែលមានឈ្មោះវែងខ្លាំង ៩០មល '.repeat(8).trim(),
    actor: 'អ្នកគ្រប់គ្រងឃ្លាំងឈ្មោះវែង',
    branch: 'សាខាហាងគ្រឿងសម្អាងមេដែលមានឈ្មោះវែង',
    reason: 'កែតម្រូវស្តុកបន្ទាប់ពីការរាប់ជាក់ស្តែងនៅកន្លែងតាំងនិងឃ្លាំងទាំងមូល '.repeat(5).trim(),
    reference: 'ការលក់ 20260912-182000-លេខយោងវែង',
    revert: copy.revert,
  } : {
    name: 'Coach Floral Blush Eau De Parfum 90ml Limited Anniversary Presentation '.repeat(9).trim(),
    actor: 'warehouse-supervisor-account',
    branch: 'Shop Main Cosmetics Branch With Long Name',
    reason: 'Stock correction after complete physical recount of the display and reserve shelves '.repeat(7).trim(),
    reference: 'Sale 20260912-182000-VERY-LONG-REFERENCE',
    revert: 'Revert',
  }
  window.__fixtureRow = {
    id: 46890,
    product_id: 3263,
    product_name: window.__expected.name,
    barcode: '033864600783061234567890',
    unit: 'pcs',
    brand: 'Coach',
    category: 'Perfume',
    branch_name: window.__expected.branch,
    movement_type: 'adjustment',
    quantity: 12,
    signed_quantity: -12,
    reason: window.__expected.reason,
    reference_id: 98765,
    reference_kind: 'sale',
    reference_label: km ? '20260912-182000-លេខយោងវែង' : '20260912-182000-VERY-LONG-REFERENCE',
    user_name: window.__expected.actor,
    created_at: '2026-09-12T18:20:00+07:00',
    ledger_bucket: 'out',
    before_qty: 24,
    after_qty: 12,
    batch_id: 3263,
    batch_lot_code: '09032026',
    batch_received_at: '2026-09-03',
    batch_supplier_id: 20,
    batch_supplier_name: 'Fixture Supplier',
    unit_cost_usd: 4,
    total_cost_usd: 48,
  }
  document.documentElement.lang = km ? 'km' : 'en'
  document.body.className = km ? 'lang-km' : 'lang-en'
  const t = (key) => copy[key] || key
  createRoot(document.getElementById('root')).render(<StockChangeSection t={t} />)
`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'stock-change-composed-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  plugins: [fixturePlugin],
})
const bundle = built.outputFiles[0].text

const css = String.raw`
  @font-face{font-family:FixtureKhmer;src:url(/khmer.woff2);font-weight:400}
  @font-face{font-family:FixtureKhmer;src:url(/khmer-bold.woff2);font-weight:700}
  *{box-sizing:border-box}
  html,body,#root{width:100%;max-width:100%;margin:0;overflow-x:hidden}
  body{background:#f8fafc;color:#1f2937;font-family:FixtureKhmer,Arial,sans-serif}
  #root{padding:12px}
  #root>.space-y-3>:not(.mobile-cards-only):not([role=dialog]){display:none!important}
  .desktop-dense-only{display:none!important}
  .mobile-cards-only{display:block;width:100%;min-width:0;max-width:100%}
  .mobile-cards-only>div>div:first-child{font-size:12px;margin-bottom:6px}
  .mobile-cards-only button:has([data-stock-mobile-row]){display:block;width:100%;min-width:0;max-width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;text-align:left}
  [data-stock-mobile-row]{min-width:0;max-width:100%}
  [data-stock-mobile-row=primary]{display:flex;align-items:flex-start;gap:8px}
  [data-stock-mobile-row=primary]>div{display:flex;min-width:0;flex:1;align-items:flex-start;gap:8px}
  [data-stock-mobile-row=primary]>div>span:first-child{flex-shrink:0;font-size:12px;color:#9ca3af}
  [data-stock-mobile-product-name]{display:block;min-width:0;flex:1}
  [data-stock-mobile-product-name] .product-name-rail{font-size:13px;line-height:16px;font-weight:600}
  [data-stock-mobile-row=primary]>span:last-child{display:inline-flex;flex-shrink:0;gap:4px;padding:2px 8px;border-radius:8px;background:#fee2e2;color:#be123c;font-size:12px;white-space:nowrap}
  [data-stock-mobile-row=reference],[data-stock-mobile-row=metadata]{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;margin-top:4px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-inline:contain;white-space:nowrap;scrollbar-width:none}
  [data-stock-mobile-row=reference]{font-size:10px;color:#9ca3af}
  [data-stock-mobile-row=reference] [data-copyable-id]{flex-shrink:0;font-size:11px;font-weight:600;color:#4b5563;white-space:nowrap;word-break:normal}
  [data-stock-mobile-row=reference]>div{flex-shrink:0;font-family:'Courier New',monospace}
  [data-stock-mobile-row=metadata]{font-size:11px;color:#9ca3af}
  [data-stock-mobile-row=metadata]>span{flex-shrink:0}
  [data-stock-mobile-row=metadata]>span:first-child{font-weight:700;color:#4b5563}
  [data-stock-mobile-row=metadata]>span:nth-child(2){padding:2px 6px;border-radius:999px;background:#f3f4f6;color:#6b7280}
  [data-stock-mobile-row=reference]::-webkit-scrollbar,[data-stock-mobile-row=metadata]::-webkit-scrollbar{display:none;width:0;height:0}
  [role=dialog]{width:100%;max-width:100%;margin-top:12px;padding:12px;border:1px solid #d1d5db;border-radius:12px;background:#fff}
  [role=dialog] h1{overflow-wrap:anywhere;font-size:16px}
  [role=dialog] button{min-height:40px;margin:3px;padding:0 12px;border:1px solid #d1d5db;border-radius:10px;background:#fff}
`

const server = http.createServer((request, response) => {
  if (request.url === '/khmer.woff2' || request.url === '/khmer-bold.woff2') {
    const weight = request.url === '/khmer-bold.woff2' ? 700 : 400
    response.writeHead(200, { 'content-type': 'font/woff2' })
    response.end(fs.readFileSync(path.join(root, `node_modules/@fontsource/noto-sans-khmer/files/noto-sans-khmer-khmer-${weight}-normal.woff2`)))
    return
  }
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-stock-change-composed-'))
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/?lang=en`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const diagnostics: string[] = []

async function waitFor<T>(label: string, read: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
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
  let page = ''
  try { page = await evaluate<string>('document.body.innerText.slice(0,2000)') } catch { /* browser may not be ready */ }
  throw new Error(`${label} timed out after ${timeoutMs}ms; last=${lastError || 'no value'}; console=${diagnostics.join(' | ') || 'empty'}; page=${page || 'empty'}`)
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
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text || 'Browser evaluation failed')
  return reply.result.value as T
}

try {
  const target = await waitFor('Chromium debug target', async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page')?.webSocketDebuggerUrl || null
    } catch { return null }
  })
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply & { method?: string; params?: { args?: Array<{ value?: unknown; description?: string }> } }
    if (reply.method === 'Runtime.consoleAPICalled') {
      diagnostics.push((reply.params?.args || []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' '))
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
  await send('Page.enable')

  for (const lang of ['en', 'km'] as const) {
    for (const width of [320, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/?lang=${lang}&width=${width}` })
      await waitFor(`${lang}/${width} Stock Change card`, async () => {
        try {
          return await evaluate('document.querySelectorAll("[data-stock-mobile-row]").length === 3 && window.__readCalls > 0') ? true : null
        } catch { return null }
      })
      await evaluate('document.fonts.ready.then(()=>true)')

      const result = await evaluate<{
        rootOverflow: number
        cardOverflow: number
        bands: Array<{ name: string; client: number; scroll: number; bar: string; webkit: string; text: string }>
        name: { clientHeight: number; scrollHeight: number; clientWidth: number; scrollWidth: number; text: string; bar: string; webkit: string }
        actor: { text: string; weight: string }
        reference: string
        barcode: string
        receivedDate: string
        reason: string
        expected: Record<string, string>
      }>(`(()=>{
        const card=document.querySelector('.mobile-cards-only button:has([data-stock-mobile-row="primary"])')
        const bands=[...card.querySelectorAll('[data-stock-mobile-row]')]
        const name=card.querySelector('.product-name-rail')
        const metadata=card.querySelector('[data-stock-mobile-row="metadata"]')
        return {
          rootOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          cardOverflow:card.scrollWidth-card.clientWidth,
          bands:bands.map(node=>({name:node.dataset.stockMobileRow,client:node.clientWidth,scroll:node.scrollWidth,bar:getComputedStyle(node).scrollbarWidth,webkit:getComputedStyle(node,'::-webkit-scrollbar').display,text:node.textContent})),
          name:{clientHeight:name.clientHeight,scrollHeight:name.scrollHeight,clientWidth:name.clientWidth,scrollWidth:name.scrollWidth,text:name.textContent,bar:getComputedStyle(name).scrollbarWidth,webkit:getComputedStyle(name,'::-webkit-scrollbar').display},
          actor:{text:metadata.firstElementChild.textContent,weight:getComputedStyle(metadata.firstElementChild).fontWeight},
          reference:card.querySelector('[data-copyable-id]').textContent,
          barcode:card.querySelector('[data-stock-mobile-row="reference"]>div').textContent,
          receivedDate:metadata.children[1].textContent,
          reason:card.querySelector('[data-stock-mobile-reason]').textContent.replace(/^·\\s*/,''),
          expected:window.__expected,
        }
      })()`)

      assert.equal(result.rootOverflow, 0, `${lang}/${width}: page must not overflow horizontally`)
      assert.equal(result.cardOverflow, 0, `${lang}/${width}: card must contain its rails`)
      assert.deepEqual(result.bands.map((band) => band.name), ['primary', 'reference', 'metadata'])
      assert.equal(result.name.text, result.expected.name, `${lang}/${width}: full product name text stays in the DOM even though it is visually clamped`)
      assert.ok(result.name.clientHeight <= 32.5, `${lang}/${width}: name is at most two 16px lines`)
      // This fixture's name is many words too long for two lines at any
      // tested width, so it MUST still report a taller scrollHeight than its
      // clamped clientHeight -- that is line-clamp actually capping the box,
      // not a box that grew to fit. The word wrap keeps it inside its own
      // width, so there is no horizontal tail to speak of any more.
      assert.ok(result.name.scrollHeight > result.name.clientHeight + 1, `${lang}/${width}: the clamp is actually hiding a third+ line, not just measuring two`)
      assert.ok(result.name.scrollWidth <= result.name.clientWidth + 1, `${lang}/${width}: the name wraps inside its own width instead of overflowing sideways`)
      assert.equal(result.actor.text, result.expected.actor, `${lang}/${width}: recorded actor leads metadata`)
      assert.ok(Number(result.actor.weight) >= 700, `${lang}/${width}: actor is bold`)
      assert.equal(result.reference, result.expected.reference, `${lang}/${width}: localized exact reference retained`)
      assert.equal(result.barcode, '033864600783061234567890', `${lang}/${width}: barcode retained`)
      assert.equal(result.receivedDate, '03/09/2026', `${lang}/${width}: received-date provenance retained`)
      assert.equal(result.reason, result.expected.reason, `${lang}/${width}: full reason retained`)
      for (const band of result.bands.slice(1)) {
        assert.ok(band.scroll > band.client, `${lang}/${width}: ${band.name} has reachable overflow`)
        assert.equal(band.bar, 'none', `${lang}/${width}: ${band.name} Firefox scrollbar hidden`)
        assert.equal(band.webkit, 'none', `${lang}/${width}: ${band.name} WebKit scrollbar hidden`)
      }

      // The rail sits inside the card's own clickable <button>, so the shared
      // reveal (textAffordances.ts) only takes over hover/long-press here,
      // never the click that opens the detail dialog -- a real mouseover
      // (not a synthetic one the touch-compatibility guard would ignore)
      // after the controller's own HOVER_OPEN_DELAY_MS must open the float
      // with the complete, un-clamped name.
      await evaluate(`(()=>{document.querySelector('.product-name-rail').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))})()`)
      await new Promise((resolve) => setTimeout(resolve, 600))
      const revealedName = await evaluate<{ open: boolean; text: string }>(`(()=>{const panel=document.querySelector('.text-affordance-float');return {open:!!panel && !panel.hasAttribute('hidden'), text:panel?.querySelector('.text-affordance-value')?.textContent || ''}})()`)
      assert.equal(revealedName.open, true, `${lang}/${width}: hovering a clamped product name opens the shared reveal float`)
      assert.equal(revealedName.text, result.expected.name, `${lang}/${width}: the float shows the complete, un-clamped product name`)
      await evaluate(`(()=>{document.querySelector('.product-name-rail').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))})()`)

      const reasonTail = await evaluate<{ visible: boolean; scrollLeft: number; maxScroll: number; tailLeft: number; tailRight: number; boxLeft: number; boxRight: number }>(`(async()=>{const rail=document.querySelector('[data-stock-mobile-row="metadata"]'),text=document.querySelector('[data-stock-mobile-reason]').lastChild;rail.scrollLeft=rail.scrollWidth;await new Promise(requestAnimationFrame);const range=document.createRange();range.setStart(text,text.length-1);range.setEnd(text,text.length);const tail=range.getBoundingClientRect(),box=rail.getBoundingClientRect();return {visible:rail.scrollLeft>0&&tail.left>=box.left-1&&tail.right<=box.right+1,scrollLeft:rail.scrollLeft,maxScroll:rail.scrollWidth-rail.clientWidth,tailLeft:tail.left,tailRight:tail.right,boxLeft:box.left,boxRight:box.right}})()`)
      assert.equal(reasonTail.visible, true, `${lang}/${width}: horizontal pan reveals final reason character (${JSON.stringify(reasonTail)})`)

      if (lang === 'en' && width === 320) {
        await evaluate(`document.querySelector('.mobile-cards-only button:has([data-stock-mobile-row="primary"])').click()`)
        await waitFor('movement detail', async () => await evaluate('!!document.querySelector("[role=dialog]")') ? true : null)
        assert.equal(await evaluate('document.querySelectorAll("[role=dialog] [data-info-hint]").length'), 0, 'Revert detail has no redundant info control')
        assert.equal(await evaluate('document.querySelector("[role=dialog] button[aria-label=Revert]").textContent.includes("Revert")'), true, 'initial Revert text is visible')
        await evaluate('document.querySelector("[role=dialog] button[aria-label=Revert]").click()')
        assert.equal(await evaluate('window.__revertCalls.length'), 0, 'first Revert click only asks for confirmation')
        assert.equal(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Revert this change?")'), true, 'confirmation question is shown')
        assert.equal(await evaluate('document.querySelector("[role=dialog] button[aria-label=Revert]").textContent.includes("Revert")'), true, 'confirmed Revert control keeps visible text')
        const buttons = await evaluate<Array<{ text: string }>>(`[...document.querySelectorAll('[role=dialog] button')].map(button=>({text:button.textContent.trim()}))`)
        assert.ok(buttons.some((button) => button.text === 'Cancel'), 'confirmation remains cancellable')
        await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent.trim()==='Cancel').click()`)
        assert.equal(await evaluate('window.__revertCalls.length'), 0, 'cancel performs no revert request')
        await evaluate('document.querySelector("[role=dialog] button[aria-label=Revert]").click()')
        await evaluate('document.querySelector("[role=dialog] button[aria-label=Revert]").click()')
        await waitFor('confirmed revert mock', async () => await evaluate('window.__revertCalls.length === 1') ? true : null)
        assert.deepEqual(await evaluate('window.__revertCalls'), [46890], 'only confirmed Revert sends the selected movement id')
      }
    }
  }
  console.log('PASS composed StockChangeSection native 320/390 EN/KM: three bands, full tails, provenance, hidden bars, visible two-step Revert, zero page overflow')
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
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 100))
  removeBrowserProfile(profile)
}
finishBrowserTest()
