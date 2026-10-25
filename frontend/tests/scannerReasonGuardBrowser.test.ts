// Real-browser proof for the Reason-box gun guard (lane 6.0.940).
//
// Keys go in through the DevTools Input domain, which is what a USB gun is to the page: trusted keydown events
// whose `key` is whatever the layout makes of the physical key (here the Khmer layout's ៣) and whose `code` is the
// key itself (Digit3), with explicit timestamps so "4 ms apart" and "120 ms apart" mean the same on a loaded machine.
//
// Three pages in one fixture, all driven by the shipped hook:
//   hook     the hook beside an opted-in text field and a plain one (the contract),
//   session  the REAL stock-session float (FastStockInModal): its line's Reason box adds the line on Enter,
//   count    the REAL count-row editor (InventoryCheckCountEditor): its Reason box saves the issue on Enter.
//
// Run: node tests/scannerReasonGuardBrowser.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = String.raw`
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppContext } from '/src/app/AppContextCore.tsx'
import FastStockInModal from '/src/components/inventory/FastStockInModal.tsx'
import InventoryCheckCountEditor from '/src/components/inventory/InventoryCheckCountEditor.tsx'
import { useScannerWedge } from '/src/components/shared/useScannerWedge.ts'
import { SCAN_GUARD_PROPS } from '/src/utils/scannerWedge.ts'

const w = window
w.__notices = []
w.__scans = []
w.__submits = 0
const user = { id: 3, username: 'fixture', name: 'Fixture', role_code: 'admin', permissions: { all: true }, role_permissions: { all: true } }
const app = {
  t: (key) => key, language: 'en', user, authReady: true, settings: {}, can: () => true, hasPermission: () => true,
  getPermissionTier: () => 'full', notify: (message, kind) => w.__notices.push([message, kind]), usdSymbol: '$', khrSymbol: '៛',
  exchangeRate: 4100, canWriteToServer: true, fmtUSD: (value) => '$' + value, fmtKHR: (value) => String(value),
}
const PRODUCT = { id: 1, name: 'Gun fixture', stock_quantity: 10, selling_price_usd: 12, cost_price_usd: 4, branch_stock: [{ branch_id: 1, quantity: 10 }] }

// The contract: the search field, an opted-in text field, a plain text field and a quantity box.
function HookPage() {
  const searchRef = useRef(null)
  const [search, setSearch] = useState('')
  const [guarded, setGuarded] = useState('')
  const [plain, setPlain] = useState('')
  useScannerWedge({ enabled: true, searchRef, onScan: (code, origin) => { w.__scans.push({ code, origin }); setSearch(code) } })
  return (
    <main style={{ padding: 16 }}>
      <input id="search" ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} />
      <input id="guarded" type="text" value={guarded} onChange={(event) => setGuarded(event.target.value)} {...SCAN_GUARD_PROPS} />
      <input id="plain" type="text" value={plain} onChange={(event) => setPlain(event.target.value)} />
    </main>
  )
}

// The count row's editor, with the search box the page owns beside it.
function CountPage() {
  const searchRef = useRef(null)
  const [search, setSearch] = useState('')
  const [count, setCount] = useState('5')
  const [reason, setReason] = useState('')
  useScannerWedge({ enabled: true, searchRef, onScan: (code, origin) => { w.__scans.push({ code, origin }); setSearch(code) } })
  return (
    <main style={{ padding: 16 }}>
      <input id="search" ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} />
      <InventoryCheckCountEditor
        productName="Gun fixture" groupLabel="Issue: Gun fixture" countId="count-1" reasonId="reason-1" count={count} reason={reason}
        stock={5} canViewStock canViewCounts suggestions={[]} busy={false} failed={false} focus={null} t={(key) => key}
        onCount={setCount} onReason={setReason} onSubmit={() => { w.__submits += 1 }} onCancel={() => {}}
      />
    </main>
  )
}

// open() hands back the id of the view it asked for, and w.__mounted becomes that id only once the view's own effects
// have run (children first, so the wedge listener is registered). The test waits for that, not for a selector: the
// previous case's view can have the very same selector, and a slow machine renders the swap late.
let viewSeq = 0
function Host() {
  const [view, setView] = useState({ id: 0, kind: 'hook' })
  w.__open = (options) => { viewSeq += 1; const id = viewSeq; setView({ id, ...options }); return id }
  React.useEffect(() => { w.__mounted = view.id }, [view.id])
  if (view.kind === 'hook') return <HookPage key={view.id} />
  if (view.kind === 'count') return <CountPage key={view.id} />
  return (
    <AppContext.Provider value={app}>
      <FastStockInModal
        key={view.id}
        tr={(key, fallback) => fallback ?? key}
        notify={app.notify}
        onClose={() => {}}
        onDone={() => {}}
        initialMode="add"
        initialProduct={PRODUCT}
        branchOptions={[{ value: '1', label: 'Fixture branch' }]}
        defaultBranchId="1"
        initialHeader={{ supplier: { supplierId: 4, supplierName: 'Fixture supplier' } }}
      />
    </AppContext.Provider>
  )
}
createRoot(document.getElementById('root')).render(<Host />)
w.__ready = true
`

const srcAppContext = resolve(root, 'src', 'AppContext.tsx').replace(/\\/g, '/').toLowerCase()
// Its own dependency cache, new for every run: node_modules/.vite is shared (a junction) with every other session's dev server,
// and a fixed temp name is shared by two runs of this file at once (another lane, a retry); the loser's page then gets
// "504 Outdated Optimize Dep" mid-test.
const cacheDir = mkdtempSync(join(tmpdir(), 'business-os-scanner-reason-guard-'))
const server = await createServer({
  root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, cacheDir, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'scanner-reason-guard-fixture', enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === 'virtual:scanner-reason-guard') return '\0scanner-reason-guard'
      if (source.startsWith('\0')) return null
      // The provider boots sync, sockets and the session; the float only needs the context it reads.
      if ((options as { scan?: boolean } | undefined)?.scan) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && resolved.id.split('?')[0].replace(/\\/g, '/').toLowerCase() === srcAppContext) return resolve(root, 'src', 'app', 'AppContextCore.tsx')
      return null
    },
    async load(id) { if (id === '\0scanner-reason-guard') return (await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code },
    configureServer(app) {
      app.middlewares.use('/reason-guard', async (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end(await app.transformIndexHtml('/reason-guard', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:scanner-reason-guard"></script></body></html>'))
      })
    },
  }],
})
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate))

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩']
type Key = { key: string; code: string; text?: string; vk: number }
const khmerDigit = (digit: string): Key => ({ key: KHMER_DIGITS[Number(digit)], code: `Digit${digit}`, text: KHMER_DIGITS[Number(digit)], vk: 48 + Number(digit) })
const asciiDigit = (digit: string): Key => ({ key: digit, code: `Digit${digit}`, text: digit, vk: 48 + Number(digit) })
const letter = (char: string): Key => ({ key: char, code: `Key${char.toUpperCase()}`, text: char, vk: char.toUpperCase().charCodeAt(0) })
const ENTER: Key = { key: 'Enter', code: 'Enter', text: '\r', vk: 13 }
const CODE = '3348901729222'
const SEARCH_SESSION = 'input[aria-label="Product or barcode"]'

await server.listen()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let failed = 0
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const address = server.httpServer!.address() as { port: number }
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`) })
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`))
  // Every transport gets an empty answer: no product search results, no lots, no saved reasons.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  const cdp = await page.context().newCDPSession(page)
  // The first load transforms the whole module graph cold; a loaded machine needs longer than Playwright's 30 s default.
  await page.goto(`http://127.0.0.1:${address.port}/reason-guard`, { timeout: 120000 })
  const waitReady = (): Promise<unknown> => page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 120000 })
  await waitReady().catch((error: Error) => { throw new Error([error.message, ...problems].join('\n')) })

  let clock = Date.now() / 1000
  async function typeKeys(keys: Key[], gapMs: number): Promise<void> {
    for (const key of keys) {
      clock += gapMs / 1000
      await cdp.send('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', key: key.key, code: key.code, text: key.text, unmodifiedText: key.text, windowsVirtualKeyCode: key.vk, timestamp: clock })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, timestamp: clock })
    }
    clock += 2 // a pause so the next action starts a fresh run
  }
  const gun = (code: string, layout: (digit: string) => Key = khmerDigit): Key[] => [...[...code].map(layout), ENTER]
  const open = async (kind: 'hook' | 'session' | 'count'): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      const id = await page.evaluate((view) => {
        localStorage.clear()
        const w = window as any
        w.__notices.length = 0
        w.__scans.length = 0
        w.__submits = 0
        return w.__open({ kind: view }) as number
      }, kind)
      try {
        await page.waitForFunction((want) => (window as any).__mounted === want, id, { timeout: 8000 })
        // The previous view is gone and this one is mounted: only now is a selector this view's element.
        await page.waitForSelector(kind === 'session' ? '[data-stock-session-entry]' : kind === 'count' ? '#reason-1' : '#guarded', { timeout: 8000 })
        break
      } catch (error) {
        if (attempt > 0) throw error
        await page.reload()
        await waitReady()
      }
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
  const scans = (): Promise<Array<{ code: string; origin: string }>> => page.evaluate(() => (window as any).__scans)
  const notices = (): Promise<unknown[]> => page.evaluate(() => (window as any).__notices)
  const submits = (): Promise<number> => page.evaluate(() => (window as any).__submits)
  const lineAdded = async (): Promise<boolean> => !(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled())
  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }

  // ---------------------------------------------------------------- the hook contract
  await test('hook: a burst into an opted-in text field puts it back, sends the code to search, and says it came from a field', async () => {
    await open('hook')
    await page.fill('#guarded', 'Shelf')
    await page.focus('#guarded')
    await typeKeys(gun(CODE), 4)
    await page.waitForFunction((value) => (document.querySelector('#search') as HTMLInputElement).value === value, CODE, { timeout: 5000 })
    assert.equal(await page.inputValue('#guarded'), 'Shelf', 'the field is exactly as it was before the burst')
    assert.deepEqual(await scans(), [{ code: CODE, origin: 'field' }], 'the code arrives as ASCII digits although the layout typed Khmer ones')
  })

  await test('hook: an opted-in field that was empty is empty again', async () => {
    await open('hook')
    await page.focus('#guarded')
    await typeKeys(gun(CODE, asciiDigit), 4)
    await page.waitForFunction((value) => (document.querySelector('#search') as HTMLInputElement).value === value, CODE, { timeout: 5000 })
    assert.equal(await page.inputValue('#guarded'), '')
  })

  await test('hook: a plain text field is left alone, exactly as before the opt-in existed', async () => {
    await open('hook')
    await page.fill('#plain', 'note ')
    await page.focus('#plain')
    await typeKeys(gun(CODE, asciiDigit), 4)
    assert.equal(await page.inputValue('#plain'), `note ${CODE}`, 'the person is typing there: the digits stay')
    assert.deepEqual(await scans(), [], 'and nothing moved to search')
    assert.equal(await page.inputValue('#search'), '')
  })

  await test('hook: a person typing into an opted-in field is untouched, however many digits', async () => {
    await open('hook')
    await page.focus('#guarded')
    // Enter in the same run, 120 ms after the last digit: typeKeys pauses 2 s at its end, so a separate Enter would be
    // a lone key whatever the gap threshold is, and this case could not tell 35 ms from 200 ms.
    await typeKeys([...[...CODE].map(asciiDigit), ENTER], 120)
    assert.equal(await page.inputValue('#guarded'), CODE, 'human speed is not a burst')
    assert.deepEqual(await scans(), [])
  })

  await test('hook: letters at gun speed are a burst too (a Code 128 label), a short run is not', async () => {
    await open('hook')
    await page.focus('#guarded')
    await typeKeys([...'AB12CD'].map((char) => (/\d/.test(char) ? asciiDigit(char) : letter(char.toLowerCase()))).concat(ENTER), 4)
    await page.waitForFunction(() => (document.querySelector('#search') as HTMLInputElement).value.length > 0, null, { timeout: 5000 })
    assert.equal(await page.inputValue('#guarded'), '')
    await typeKeys([asciiDigit('1'), asciiDigit('2'), asciiDigit('3'), ENTER], 4)
    assert.equal(await page.inputValue('#guarded'), '123', 'three fast keys are a quick typist, not a scan')
  })

  // ---------------------------------------------------------------- the stock-session float
  // The item is as picking it left it (Qty 1 and the catalogue cost and price): only the Reason is typed, and clearing keeps the
  // reason, so a scan may clear the item. With a typed Qty the item is kept instead (6.0.945), in the next case.
  await test('session: a burst into the line\'s Reason box leaves the reason as it was, adds no line, and lands in the search', async () => {
    await open('session')
    await page.fill('input[aria-label="Reason"]', 'Shelf')
    await page.focus('input[aria-label="Reason"]')
    await typeKeys(gun(CODE), 4)
    await page.waitForSelector(SEARCH_SESSION, { timeout: 5000 })
    assert.equal(await page.inputValue(SEARCH_SESSION), CODE, 'the code is in the search')
    assert.equal(await lineAdded(), false, 'the burst\'s Enter did not run the Reason box\'s add')
    assert.equal(await page.inputValue('input[aria-label="Reason"]'), 'Shelf', 'the Reason box is exactly as it was: no digit of the code stayed in it')
    assert.deepEqual(await notices(), [['Barcode moved to search', 'info']])
  })

  await test('session: the same burst into the Reason box of an item with a typed Qty puts the reason back, adds no line, and keeps the item (6.0.945)', async () => {
    await open('session')
    await page.fill('input[aria-label="Qty"]', '5')
    await page.fill('input[aria-label="Reason"]', 'Shelf')
    await page.focus('input[aria-label="Reason"]')
    await typeKeys(gun(CODE), 4)
    await page.waitForTimeout(400)
    assert.equal(await page.locator(SEARCH_SESSION).count(), 0, 'the typed item stays, so the search stays hidden')
    assert.equal(await lineAdded(), false, 'the burst\'s Enter did not run the Reason box\'s add')
    assert.equal(await page.inputValue('input[aria-label="Reason"]'), 'Shelf', 'no digit of the code stayed in the Reason box')
    assert.equal(await page.inputValue('input[aria-label="Qty"]'), '5', 'and the typed quantity is still there')
    assert.deepEqual(await notices(), [['Add or clear this item first', 'warning']])
  })

  await test('session: a person typing a reason and pressing Enter still adds the line', async () => {
    await open('session')
    await page.fill('input[aria-label="Qty"]', '5')
    await page.focus('input[aria-label="Reason"]')
    await typeKeys([letter('o'), letter('k'), ENTER], 120)
    await page.waitForFunction(() => !!document.body.textContent?.includes('Gun fixture'), null, { timeout: 5000 })
    assert.equal(await lineAdded(), true)
    assert.deepEqual(await notices(), [])
  })

  // ---------------------------------------------------------------- the count row's editor
  await test('count: a burst into the editor\'s Reason box leaves the reason as it was, saves nothing, and lands in the search', async () => {
    await open('count')
    await page.fill('#reason-1', 'Shelf')
    await page.focus('#reason-1')
    await typeKeys(gun(CODE), 4)
    await page.waitForFunction((value) => (document.querySelector('#search') as HTMLInputElement).value === value, CODE, { timeout: 5000 })
    assert.equal(await page.inputValue('#reason-1'), 'Shelf')
    assert.equal(await submits(), 0, 'the burst\'s Enter did not save the issue')
    assert.deepEqual(await scans(), [{ code: CODE, origin: 'field' }])
  })

  await test('count: a person typing a reason and pressing Enter still saves the issue', async () => {
    await open('count')
    await page.focus('#reason-1')
    await typeKeys([letter('o'), letter('k'), ENTER], 120)
    assert.equal(await page.inputValue('#reason-1'), 'ok')
    assert.equal(await submits(), 1)
    assert.deepEqual(await scans(), [])
  })

  await test('count: the Count box beside it is still guarded as before', async () => {
    await open('count')
    await page.focus('#count-1')
    await typeKeys(gun(CODE), 4)
    await page.waitForFunction((value) => (document.querySelector('#search') as HTMLInputElement).value === value, CODE, { timeout: 5000 })
    assert.equal(await page.inputValue('#count-1'), '5')
    assert.equal(await submits(), 0)
  })

  await test('the pages render and run without a page error', async () => {
    assert.deepEqual(problems, [])
  })

  await page.close()
} finally {
  await browser?.close()
  await server.close()
  rmSync(cacheDir, { recursive: true, force: true })
}
if (failed > 0) process.exitCode = 1
process.exit(failed > 0 ? 1 : 0)
