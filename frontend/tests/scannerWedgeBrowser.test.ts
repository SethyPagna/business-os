// Real-browser proof for the scanner-gun hook (shared/useScannerWedge.ts).
//
// Keys go in through the DevTools Input domain, which is what a USB gun is to
// the page: trusted keydown events whose `key` is whatever the layout makes of
// the physical key (here the Khmer layout's ៣) and whose `code` is the key
// itself (Digit3). Their timestamps are set explicitly, so "4 ms apart" and
// "120 ms apart" mean the same thing on a loaded machine.
//
// Run: node tests/scannerWedgeBrowser.test.ts
import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = String.raw`
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useScannerWedge } from '/src/components/shared/useScannerWedge.ts'

const w = window
w.__scans = []
w.__qtyChanges = []
w.__enterKeydowns = 0
w.__clicks = 0
w.__adds = 0
document.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'Tab') w.__enterKeydowns += 1 })

function DialogSurface({ log }) {
  const ref = useRef(null)
  const [search, setSearch] = useState('')
  w.__dialogSearch = search
  useScannerWedge({ enabled: true, searchRef: ref, onScan: (code, origin) => { log.push({ surface: 'dialog', code, origin }); setSearch(code) } })
  return (
    <div role="dialog" aria-modal="true" aria-label="dialog" id="dialog">
      <input id="dialog-search" ref={ref} value={search} onChange={(event) => setSearch(event.target.value)} />
      <button id="dialog-button" type="button">dialog button</button>
    </div>
  )
}

// A second surface that is on screen beside the page, not above it: no dialog.
function PanelSurface({ log }) {
  const ref = useRef(null)
  const [search, setSearch] = useState('')
  w.__panelSearch = search
  useScannerWedge({ enabled: true, searchRef: ref, onScan: (code, origin) => { log.push({ surface: 'panel', code, origin }); setSearch(code) } })
  return <aside id="panel"><input id="panel-search" ref={ref} value={search} onChange={(event) => setSearch(event.target.value)} /></aside>
}

function Fixture() {
  const searchRef = useRef(null)
  const [search, setSearch] = useState('')
  const [qty, setQty] = useState('5')
  const [price, setPrice] = useState('2.50')
  const [unit, setUnit] = useState('pcs')
  const [note, setNote] = useState('')
  const [dialog, setDialog] = useState(false)
  const [panel, setPanel] = useState(false)
  const [enabled, setEnabled] = useState(true)
  w.__search = search
  w.__qty = qty
  w.__price = price
  w.__unit = unit
  w.__note = note
  w.__openDialog = (open) => setDialog(open)
  w.__openPanel = (open) => setPanel(open)
  w.__setEnabled = (value) => setEnabled(value)
  useScannerWedge({ enabled, searchRef, onScan: (code, origin) => { w.__scans.push({ surface: 'page', code, origin }); setSearch(code) } })
  return (
    <main style={{ padding: 16 }}>
      <input id="search" ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} />
      <input id="qty" type="number" value={qty} onChange={(event) => { w.__qtyChanges.push(event.target.value); setQty(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') w.__adds += 1 }} />
      <input id="price" type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') w.__adds += 1 }} />
      <select id="unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
        <option value="pcs">pcs</option>
        <option value="box">box</option>
        <option value="3 pack">3 pack</option>
      </select>
      <input id="note" value={note} onChange={(event) => setNote(event.target.value)} />
      <button id="add" type="button" onClick={() => { w.__clicks += 1 }}>add</button>
      {panel ? <PanelSurface log={w.__scans} /> : null}
      {dialog ? <DialogSurface log={w.__scans} /> : null}
    </main>
  )
}
createRoot(document.getElementById('root')).render(<Fixture />)
w.__ready = true
`

const server = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'scanner-wedge-fixture', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:scanner-wedge-fixture') return '\0scanner-wedge-fixture' },
    async load(id) { if (id === '\0scanner-wedge-fixture') return (await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code },
    configureServer(app) {
      app.middlewares.use('/scanner-wedge', async (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end(await app.transformIndexHtml('/scanner-wedge', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:scanner-wedge-fixture"></script></body></html>'))
      })
    },
  }],
})
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate))

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩']
type Key = { key: string; code: string; text?: string; vk: number }
const khmerDigit = (digit: string): Key => ({ key: KHMER_DIGITS[Number(digit)], code: `Digit${digit}`, text: KHMER_DIGITS[Number(digit)], vk: 48 + Number(digit) })
const asciiDigit = (digit: string): Key => ({ key: digit, code: `Digit${digit}`, text: digit, vk: 48 + Number(digit) })
const ENTER: Key = { key: 'Enter', code: 'Enter', text: '\r', vk: 13 }
const TAB: Key = { key: 'Tab', code: 'Tab', vk: 9 }

await server.listen()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let failed = 0
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const address = server.httpServer!.address() as { port: number }
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const cdp = await page.context().newCDPSession(page)
  await page.goto(`http://127.0.0.1:${address.port}/scanner-wedge`)
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 120000 })

  // Each key is delivered `gapMs` after the last, by timestamp, not by waiting.
  let clock = Date.now() / 1000
  async function typeKeys(keys: Key[], gapMs: number): Promise<void> {
    for (const key of keys) {
      clock += gapMs / 1000
      await cdp.send('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', key: key.key, code: key.code, text: key.text, unmodifiedText: key.text, windowsVirtualKeyCode: key.vk, timestamp: clock })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, timestamp: clock })
    }
    clock += 2 // a pause so the next action starts a fresh run
  }
  const read = <T,>(name: string): Promise<T> => page.evaluate((field) => (window as any)[field], name)
  const reset = async () => {
    await page.evaluate(() => {
      const w = window as any
      w.__scans.length = 0; w.__qtyChanges.length = 0; w.__enterKeydowns = 0; w.__clicks = 0; w.__adds = 0
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    await page.fill('#search', '')
    await page.fill('#qty', '5')
    await page.fill('#price', '2.50')
    await page.selectOption('#unit', 'pcs')
    await page.fill('#note', '')
    await page.evaluate(() => {
      const w = window as any
      w.__scans.length = 0; w.__qtyChanges.length = 0; w.__enterKeydowns = 0; w.__clicks = 0; w.__adds = 0
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
  }
  const gun = (code: string, layout: (digit: string) => Key = khmerDigit, terminator: Key = ENTER): Key[] => [...[...code].map(layout), terminator]
  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await reset()
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }

  await test('the Khmer layout reports Khmer digits as key and the hook still delivers the ASCII code', async () => {
    await typeKeys(gun('3348901729222'), 4)
    await page.waitForFunction(() => (window as any).__search === '3348901729222', null, { timeout: 3000 })
    assert.deepEqual(await read('__scans'), [{ surface: 'page', code: '3348901729222', origin: 'idle' }])
  })

  await test('a scan with nothing focused is delivered to the search, and Enter reaches no handler', async () => {
    await typeKeys(gun('4006381333931', asciiDigit), 3)
    await page.waitForFunction(() => (window as any).__search === '4006381333931', null, { timeout: 3000 })
    assert.equal(await read('__enterKeydowns'), 0, 'the terminating Enter is stopped before any listener sees it')
  })

  await test('a focused button is not clicked by the scan\'s Enter', async () => {
    await page.focus('#add')
    await typeKeys(gun('3348901729222'), 4)
    await page.waitForFunction(() => (window as any).__search === '3348901729222', null, { timeout: 3000 })
    assert.equal(await read('__clicks'), 0)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'add', 'focus stays where it was')
  })

  await test('a burst into a focused quantity box restores it and fills the search', async () => {
    await page.focus('#qty')
    await typeKeys(gun('3348901729222', asciiDigit), 4)
    await page.waitForFunction(() => (window as any).__search === '3348901729222', null, { timeout: 3000 })
    assert.equal(await page.inputValue('#qty'), '5', 'the box shows the value from before the burst')
    assert.equal(await read('__qty'), '5', 'and so does the React state behind it, which an add would read')
    assert.equal(await read('__adds'), 0, 'the Enter did not run the field\'s add handler')
    assert.deepEqual(await read('__scans'), [{ surface: 'page', code: '3348901729222', origin: 'field' }])
  })

  await test('the same burst typed on the Khmer layout into a text-typed price box is put back too', async () => {
    await page.focus('#price')
    await typeKeys(gun('3348901729222', khmerDigit), 4)
    await page.waitForFunction(() => (window as any).__search === '3348901729222', null, { timeout: 3000 })
    assert.equal(await page.inputValue('#price'), '2.50')
    assert.equal(await read('__price'), '2.50')
    assert.equal(await read('__adds'), 0)
  })

  await test('a burst while a select has focus leaves the choice as it was', async () => {
    await page.focus('#unit')
    await typeKeys(gun('3348901729222', asciiDigit), 4)
    await page.waitForFunction(() => (window as any).__search === '3348901729222', null, { timeout: 3000 })
    assert.equal(await read('__unit'), 'pcs')
    assert.equal(await page.inputValue('#unit'), 'pcs')
  })

  await test('a burst into the search itself replaces what was there', async () => {
    await page.fill('#search', 'serum')
    await page.focus('#search')
    await page.evaluate(() => { (window as any).__scans.length = 0 })
    await typeKeys(gun('3348901729222'), 4)
    await page.waitForFunction(() => (window as any).__search === '3348901729222', null, { timeout: 3000 })
    assert.equal(await page.inputValue('#search'), '3348901729222')
    assert.deepEqual(await read('__scans'), [{ surface: 'page', code: '3348901729222', origin: 'search' }])
  })

  await test('Tab ends a scan the same way, and focus does not move on', async () => {
    await page.focus('#qty')
    await typeKeys(gun('5901234123457', asciiDigit, TAB), 4)
    await page.waitForFunction(() => (window as any).__search === '5901234123457', null, { timeout: 3000 })
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'qty', 'the Tab was cancelled')
    assert.equal(await read('__qty'), '5')
  })

  await test('typing at human speed into the quantity box is untouched', async () => {
    await page.focus('#qty')
    await page.fill('#qty', '')
    await typeKeys(gun('123456', asciiDigit), 120)
    assert.equal(await read('__qty'), '123456')
    assert.deepEqual(await read('__scans'), [])
    assert.equal(await read('__adds'), 1, 'a person\'s Enter still reaches the field')
  })

  await test('four fast characters and Enter are not a scan', async () => {
    await page.focus('#qty')
    await page.fill('#qty', '')
    await typeKeys(gun('1234', asciiDigit), 4)
    assert.equal(await read('__qty'), '1234')
    assert.deepEqual(await read('__scans'), [])
    assert.equal(await read('__adds'), 1)
  })

  await test('a burst into some other text field is left alone', async () => {
    await page.focus('#note')
    await typeKeys(gun('3348901729222', asciiDigit), 4)
    assert.equal(await read('__note'), '3348901729222')
    assert.deepEqual(await read('__scans'), [])
  })

  await test('a disabled surface hears nothing', async () => {
    await page.evaluate(() => (window as any).__setEnabled(false))
    await page.focus('#qty')
    await typeKeys(gun('3348901729222', asciiDigit), 4)
    assert.deepEqual(await read('__scans'), [])
    assert.equal(await read('__search'), '')
    await page.evaluate(() => (window as any).__setEnabled(true))
  })

  await test('a dialog above the page answers instead of the page behind it', async () => {
    await page.evaluate(() => (window as any).__openDialog(true))
    await page.waitForSelector('#dialog')
    await page.focus('#dialog-button')
    await typeKeys(gun('3348901729222'), 4)
    await page.waitForFunction(() => (window as any).__dialogSearch === '3348901729222', null, { timeout: 3000 })
    assert.equal(await read('__search'), '', 'the page behind the dialog is not touched')
    assert.deepEqual(await read('__scans'), [{ surface: 'dialog', code: '3348901729222', origin: 'idle' }])
    await page.evaluate(() => (window as any).__openDialog(false))
    await page.waitForFunction(() => !document.getElementById('dialog'))
  })

  await test('two surfaces on screen together: the one registered last answers, and the page hears nothing', async () => {
    await page.evaluate(() => (window as any).__openPanel(true))
    await page.waitForSelector('#panel')
    await typeKeys(gun('3348901729222'), 4)
    await page.waitForFunction(() => (window as any).__panelSearch === '3348901729222', null, { timeout: 3000 })
    assert.equal(await read('__search'), '')
    assert.deepEqual(await read('__scans'), [{ surface: 'panel', code: '3348901729222', origin: 'idle' }])
    await page.evaluate(() => (window as any).__openPanel(false))
    await page.waitForFunction(() => !document.getElementById('panel'))
    await typeKeys(gun('4006381333931'), 4)
    await page.waitForFunction(() => (window as any).__search === '4006381333931', null, { timeout: 3000 })
  })

  await test('a modal that owns no scanner covers the page: the scan is not routed behind it', async () => {
    await page.evaluate(() => {
      const modal = document.createElement('div')
      modal.id = 'foreign-modal'
      modal.setAttribute('role', 'dialog')
      modal.setAttribute('aria-modal', 'true')
      modal.innerHTML = '<input id="foreign-qty" type="number" value="7">'
      document.body.append(modal)
    })
    await page.focus('#foreign-qty')
    await typeKeys(gun('3348901729222', asciiDigit), 4)
    assert.equal(await read('__search'), '')
    assert.deepEqual(await read('__scans'), [])
    await page.evaluate(() => document.getElementById('foreign-modal')?.remove())
  })

  await page.close()
} finally {
  await browser?.close()
  await server.close()
}
if (failed > 0) process.exitCode = 1
process.exit(failed > 0 ? 1 : 0)
