// Q13 "print waits for QR codes" (owner decision, 27 Sep 2026), in a real
// browser against the real Receipt and the real print pipeline. Substituted:
// the `qrcode` generator (so a test decides when a QR finishes or fails), the
// app context (formatters, the English pack, a notify() that records), and
// the OS print dialog (the hidden print frame's document is recorded instead).
//
//  a. Print tapped while a generated QR is still generating waits, says so,
//     and then prints WITH the QR -- never the grey placeholder.
//  b. A QR whose generation fails (after the one automatic retry) refuses the
//     print with the translated error; Retry on the tile then lets it print.
//  c. A payment QR slower than the old 5 s asset deadline is waited for and
//     printed visible.
//  d. A payment QR that errors is left out cleanly (no block, no broken
//     image) and the cashier is warned.
//  e. Cancel during the wait prints nothing and reports nothing.
//
// Each of a-d fails against 9acc25cf (the U-print lane before Q13).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build, type Plugin } from 'esbuild'
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
assert.ok(browserPath, 'A local Chromium or Edge executable is required for the receipt QR print gate test')

// The strings the cashier must see. Read from the pack, with the shipped
// English as the fallback, so a run against an older tree that lacks the keys
// still fails on behaviour rather than on a missing string.
const EN = JSON.parse(fs.readFileSync(path.join(root, 'src/lang/en.json'), 'utf8')) as Record<string, string>
const TEXT = {
  waiting: EN.receipt_qr_waiting || 'Waiting for QR codes...',
  generationFailed: EN.receipt_qr_generation_failed || 'A QR code could not be generated, so nothing was printed. Tap Retry on the QR code, then print again.',
  paymentOmitted: EN.receipt_payment_qr_omitted || 'Payment QR image could not be loaded — printed without it',
  retry: EN.retry || 'Retry',
  cancel: EN.cancel || 'Cancel',
}

// 1x1 PNG, a real image for both the fake QR generator and the payment QR.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`
const PAYMENT_QR_SLOW_MS = 6500

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import Receipt from './src/components/receipt/Receipt.tsx'
  import EN from './src/lang/en.json'

  const params = new URLSearchParams(location.search)
  const w = window
  w.__prints = []
  w.__alerts = []
  w.__toasts = []
  w.__qrCalls = 0
  w.__qrMode = params.get('qr') || 'ok'
  w.__qrReleases = []
  w.__qr = (url) => {
    w.__qrCalls += 1
    if (w.__qrMode === 'fail') return Promise.reject(new Error('fixture QR generation failure'))
    if (w.__qrMode === 'hold') return new Promise((resolve) => { w.__qrReleases.push(() => resolve(${JSON.stringify(PNG_DATA_URL)})) })
    return Promise.resolve(${JSON.stringify(PNG_DATA_URL)})
  }
  w.__releaseQr = () => { w.__qrMode = 'ok'; for (const release of w.__qrReleases.splice(0)) release() }
  w.alert = (message) => { w.__alerts.push(String(message)) }
  // No second window: Receipt prints through the hidden frame in this page,
  // which is the path an installed iOS app takes.
  w.open = () => null
  const record = (doc) => { w.__prints.push(doc?.documentElement?.outerHTML || '') }
  const stubFrame = (frame) => {
    const win = frame.contentWindow
    if (!win || win.__stubbed) return
    win.__stubbed = true
    const proto = win.Document.prototype
    const realExec = proto.execCommand
    proto.execCommand = function (command, ...rest) {
      if (String(command).toLowerCase() === 'print') { record(this); return true }
      return realExec.call(this, command, ...rest)
    }
    win.print = () => record(win.document)
  }
  const realAppend = Node.prototype.appendChild
  Node.prototype.appendChild = function (child) {
    const appended = realAppend.call(this, child)
    if (child instanceof HTMLIFrameElement) stubFrame(child)
    return appended
  }
  w.__app = {
    fmtUSD: (value) => '$' + Number(value || 0).toFixed(2),
    fmtKHR: (value) => Math.round(Number(value || 0)) + '៛',
    khrSymbol: '៛',
    t: (key) => EN[key],
    notify: (message, type) => { w.__toasts.push({ message: String(message), type: String(type || '') }) },
  }

  const scenario = params.get('scenario')
  const aba = params.get('aba')
  const template = scenario === 'payment'
    ? { sales_receipt_enabled: true, sales_receipt_aba_account_name: 'Fixture Shop', sales_receipt_aba_qr_image: '/aba.png?mode=' + aba + '&n=' + Date.now(), receipt_language: 'en' }
    : { show_qr_codes: true, qr_show_portal: true, qr_portal_url: 'https://shop.example/portal', qr_portal_label: 'Shop Online', receipt_language: 'en' }
  const settings = {
    business_name: 'Fixture Shop',
    receipt_template: JSON.stringify(template),
    receipt_print_settings: JSON.stringify({ paperSize: '80mm', pageSizeMode: 'measured', marginTop: '4', marginLeft: '4', marginRight: '4', marginBottom: '4', scale: '100' }),
  }
  const sale = {
    id: 1,
    receipt_number: 'R-QR-1',
    created_at: '2026-09-27T03:00:00Z',
    items: [{ product_name: 'Fixture item', quantity: 1, applied_price_usd: 2, total_usd: 2, price_usd: 2 }],
    subtotal_usd: 2,
    total_usd: 2,
    amount_paid_usd: 2,
    exchange_rate: 4100,
    payment_method: 'Cash',
  }
  createRoot(document.getElementById('root')).render(React.createElement(Receipt, { sale, settings, onClose: () => {} }))
  w.__mounted = true
`

// Only the two modules a test must control are replaced; everything else is
// the shipped code.
const substitutes: Plugin = {
  name: 'receipt-qr-gate-substitutes',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'fixture' }))
    pluginBuild.onResolve({ filter: /AppContext(\.tsx)?$/ }, () => ({ path: 'app-context', namespace: 'fixture' }))
    pluginBuild.onLoad({ filter: /^qrcode$/, namespace: 'fixture' }, () => ({
      contents: 'export function toDataURL(url) { return window.__qr(url) }\nexport default { toDataURL }',
      loader: 'js',
    }))
    pluginBuild.onLoad({ filter: /^app-context$/, namespace: 'fixture' }, () => ({
      contents: 'export function useApp() { return window.__app }',
      loader: 'js',
    }))
  },
}

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'receipt-qr-gate-fixture.tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  write: false,
  logLevel: 'silent',
  plugins: [substitutes],
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
})
const bundle = built.outputFiles[0].text
const pngBytes = Buffer.from(PNG_BASE64, 'base64')

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://fixture')
  if (url.pathname === '/fixture.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  if (url.pathname === '/aba.png') {
    const mode = url.searchParams.get('mode')
    if (mode === '404') {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('missing')
      return
    }
    const send = () => {
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      response.end(pngBytes)
    }
    if (mode === 'slow') setTimeout(send, PAYMENT_QR_SLOW_MS)
    else send()
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
})

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      const port = address.port
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

const appPort = await freePort()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(appPort, '127.0.0.1', () => resolve())
})

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-receipt-qr-gate-'))
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', () => resolve()))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string } }
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function waitFor<T>(read: () => Promise<T | null>, label: string, timeoutMs = 10_000): Promise<T> {
  return waitForBrowser(read, label, timeoutMs)
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

async function open(search: string): Promise<void> {
  await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/${search}` })
  await waitFor(async () => (await evaluate<boolean>('Boolean(window.__mounted && document.querySelector("[data-receipt-export-root]"))')) || null, `receipt mounted (${search})`)
}

const printCount = () => evaluate<number>('window.__prints.length')
const buttonNamed = (name: string) => `Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === ${JSON.stringify(name)})`

async function clickButton(name: string): Promise<void> {
  const clicked = await evaluate<boolean>(`(() => { const b = ${buttonNamed(name)}; if (!b || b.disabled) return false; b.click(); return true })()`)
  assert.ok(clicked, `button "${name}" is present and enabled`)
}

/** Print on the single-rendition receipt. */
async function tapPrint(): Promise<void> {
  await clickButton('Print')
}

/** Print the 80x50 card from the Print menu (the rendition that carries the payment QR). */
async function tapPrintCard(): Promise<void> {
  await clickButton('Print')
  await waitFor(async () => (await evaluate<boolean>(`Boolean(Array.from(document.querySelectorAll('[role="menuitem"], button')).find((el) => el.textContent?.trim() === '80 × 50 mm'))`)) || null, 'the Print menu offers the 80 × 50 mm card')
  await evaluate<void>(`Array.from(document.querySelectorAll('[role="menuitem"], button')).find((el) => el.textContent?.trim() === '80 × 50 mm').click()`)
}

type PrintedReceipt = { qrImages: Array<{ src: string | null }>; placeholders: number; paymentImages: Array<{ src: string | null; visibility: string }>; paymentBlocks: number }
async function lastPrint(): Promise<PrintedReceipt> {
  return evaluate<PrintedReceipt>(`(() => {
    const doc = new DOMParser().parseFromString(window.__prints[window.__prints.length - 1], 'text/html')
    return {
      qrImages: Array.from(doc.querySelectorAll('img[alt="Shop Online"]')).map((img) => ({ src: img.getAttribute('src') })),
      placeholders: doc.querySelectorAll('.animate-pulse').length,
      paymentImages: Array.from(doc.querySelectorAll('img[alt="ABA payment QR"]')).map((img) => ({ src: img.getAttribute('src'), visibility: img.style.visibility })),
      paymentBlocks: doc.querySelectorAll('[data-receipt-qr="payment"]').length,
    }
  })()`)
}

let exitCode = 0
const results: string[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    results.push(`PASS ${name}`)
    console.log(`PASS ${name}`)
  } catch (error) {
    exitCode = 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>
      return targets.find((item) => item.type === 'page')?.webSocketDebuggerUrl || null
    } catch { return null }
  }, 'the browser debug target')
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
  await send('Page.enable')

  await check('a. Print before the QR is generated waits, then prints the QR (never the placeholder)', async () => {
    await open('?scenario=generated&qr=hold')
    await waitFor(async () => (await evaluate<number>('window.__qrCalls')) >= 1 || null, 'generation started')
    await tapPrint()
    // Generation is held: whatever the pipeline does, it must not print yet.
    await sleep(2500)
    assert.equal(await printCount(), 0, 'nothing may print while a QR is still generating')
    assert.ok(await evaluate<boolean>(`document.body.textContent.includes(${JSON.stringify(TEXT.waiting)})`), 'the busy control says it is waiting for QR codes')
    assert.ok(await evaluate<boolean>(`Boolean(${buttonNamed(TEXT.cancel)})`), 'Cancel is offered while waiting')
    await evaluate<void>('window.__releaseQr()')
    await waitFor(async () => (await printCount()) === 1 || null, 'the print once the QR is ready')
    const printed = await lastPrint()
    assert.equal(printed.placeholders, 0, 'no grey placeholder in the print')
    assert.equal(printed.qrImages.length, 1, 'the QR is in the print')
    assert.ok(printed.qrImages[0].src?.startsWith('data:image/png'), 'as the generated image')
    assert.deepEqual(await evaluate<string[]>('window.__alerts'), [])
  })

  await check('b. a QR that cannot be generated refuses the print with the error; Retry then prints it', async () => {
    await open('?scenario=generated&qr=fail')
    // Two generations: the first and the one automatic retry.
    await waitFor(async () => (await evaluate<number>('window.__qrCalls')) >= 2 || null, 'generation and its retry', 5000).catch(() => null)
    await sleep(300)
    await tapPrint()
    await sleep(2500)
    assert.equal(await printCount(), 0, 'a failed QR must not print (no grey box, no gap)')
    assert.deepEqual(await evaluate<string[]>('window.__alerts'), [TEXT.generationFailed], 'the cashier is told, in the pack language')
    assert.equal(await evaluate<number>('window.__qrCalls'), 2, 'generation is retried exactly once on its own')
    await evaluate<void>(`window.__qrMode = 'ok'`)
    await clickButton(TEXT.retry)
    await waitFor(async () => (await evaluate<boolean>('Boolean(document.querySelector(\'img[alt="Shop Online"]\'))')) || null, 'the QR after Retry')
    await tapPrint()
    await waitFor(async () => (await printCount()) === 1 || null, 'the print after Retry')
    const printed = await lastPrint()
    assert.equal(printed.placeholders, 0)
    assert.ok(printed.qrImages[0]?.src?.startsWith('data:image/png'), 'the retried QR is printed')
  })

  await check(`c. a payment QR slower than 5 s (${PAYMENT_QR_SLOW_MS} ms) is waited for and printed visible`, async () => {
    await open('?scenario=payment&aba=slow')
    const start = Date.now()
    await tapPrintCard()
    await waitFor(async () => (await printCount()) === 1 || null, 'the card print', 40_000)
    const elapsed = Date.now() - start
    const printed = await lastPrint()
    assert.equal(printed.paymentImages.length, 1, 'the payment QR is in the print')
    assert.ok(printed.paymentImages[0].src?.startsWith('data:image/png'), `the payment QR is embedded, not dropped (src=${String(printed.paymentImages[0].src).slice(0, 40)})`)
    assert.notEqual(printed.paymentImages[0].visibility, 'hidden', 'and visible')
    assert.ok(elapsed >= PAYMENT_QR_SLOW_MS - 500, `the print waited for it (${elapsed} ms)`)
    assert.deepEqual(await evaluate<unknown[]>('window.__toasts'), [], 'nothing to warn about')
  })

  await check('d. a payment QR that errors is left out cleanly, with the warning', async () => {
    await open('?scenario=payment&aba=404')
    await waitFor(async () => (await evaluate<boolean>(`(() => { const img = document.querySelector('img[alt="ABA payment QR"]'); return Boolean(img && img.complete && img.naturalWidth === 0) })()`)) || null, 'the payment QR image errored on screen')
    await tapPrintCard()
    await waitFor(async () => (await printCount()) === 1 || null, 'the card print', 20_000)
    const printed = await lastPrint()
    assert.equal(printed.paymentImages.length, 0, 'no payment QR image (no broken-image icon, no hidden gap)')
    assert.equal(printed.paymentBlocks, 0, 'its block is gone too')
    assert.deepEqual(await evaluate<unknown[]>('window.__toasts'), [{ message: TEXT.paymentOmitted, type: 'warning' }], 'the cashier is warned once')
    assert.deepEqual(await evaluate<string[]>('window.__alerts'), [])
  })

  await check('e. Cancel while waiting prints nothing and reports nothing', async () => {
    await open('?scenario=generated&qr=hold')
    await waitFor(async () => (await evaluate<number>('window.__qrCalls')) >= 1 || null, 'generation started')
    await tapPrint()
    await waitFor(async () => (await evaluate<boolean>(`Boolean(${buttonNamed(TEXT.cancel)})`)) || null, 'Cancel offered')
    await clickButton(TEXT.cancel)
    await waitFor(async () => (await evaluate<boolean>(`Boolean(${buttonNamed('Print')} && !${buttonNamed('Print')}.disabled)`)) || null, 'Print enabled again')
    await evaluate<void>('window.__releaseQr()')
    await sleep(1500)
    assert.equal(await printCount(), 0, 'a cancelled print never goes out, even once the QR is ready')
    assert.deepEqual(await evaluate<string[]>('window.__alerts'), [])
    assert.deepEqual(await evaluate<unknown[]>('window.__toasts'), [])
  })
} catch (error) {
  exitCode = 1
  console.error('FAIL receipt QR print gate harness')
  console.error(error)
}
console.log(`${results.length} of 5 receipt QR print gate checks passed`)
await closeBrowserFixture(exitCode, () => closeCdpBrowser(browser, browserExit, socket), () => server.close(), () => removeBrowserProfile(profile))
