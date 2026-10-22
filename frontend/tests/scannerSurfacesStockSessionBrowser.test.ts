// The REAL Stock Session float in a real browser, driven by a scanner gun (lane 6.0.934).
//
// Qty, Cost and Price add the line on Enter, and a person is on one of them the
// moment a product is picked. A gun there used to type the barcode into the box
// and then add a line whose quantity was the barcode. The keys go in through the
// DevTools Input domain, which is what a USB gun is to the page: trusted keydown
// events whose `key` is whatever the layout makes of the physical key (here the
// Khmer layout's ៣) and whose `code` is the key itself (Digit3), with explicit
// timestamps so "4 ms apart" means the same on a loaded machine.
//
// The float is mounted whole (AppContext swapped for its core, the API answered
// by an empty JSON stub), so the hook, StockSessionLineEntry and FastStockInModal's
// own handlers are all the shipped ones. "A line was added" is read from the
// footer's Next button, which stays disabled until the session holds a line.
//
// Run: node tests/scannerSurfacesStockSessionBrowser.test.ts
import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = String.raw`
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppContext } from '/src/app/AppContextCore.tsx'
import FastStockInModal from '/src/components/inventory/FastStockInModal.tsx'

const w = window
w.__notices = []
const user = { id: 3, username: 'fixture', name: 'Fixture', role_code: 'admin', permissions: { all: true }, role_permissions: { all: true } }
const app = {
  t: (key) => key, language: 'en', user, authReady: true, settings: {}, can: () => true, hasPermission: () => true,
  getPermissionTier: () => 'full', notify: (message, kind) => w.__notices.push([message, kind]), usdSymbol: '$', khrSymbol: '៛',
  exchangeRate: 4100, canWriteToServer: true, fmtUSD: (value) => '$' + value, fmtKHR: (value) => String(value),
}
const PRODUCT = { id: 1, name: 'Gun fixture', stock_quantity: 10, selling_price_usd: 12, cost_price_usd: 4, branch_stock: [{ branch_id: 1, quantity: 10 }] }

function Host() {
  const [run, setRun] = useState({ id: 0, picked: true, mode: 'add' })
  w.__open = (options) => setRun((current) => ({ id: current.id + 1, ...options }))
  return (
    <AppContext.Provider value={app}>
      <FastStockInModal
        key={run.id}
        tr={(key, fallback) => fallback ?? key}
        notify={app.notify}
        onClose={() => {}}
        onDone={() => {}}
        initialMode={run.mode}
        initialProduct={run.picked ? PRODUCT : null}
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
// Its own dependency cache: node_modules/.vite is shared (a junction) with every other session's dev server, and one
// re-optimising it mid-run answers this page's imports with 504 Outdated Optimize Dep.
const cacheDir = join(tmpdir(), 'business-os-scanner-surfaces-934-vite')
const server = await createServer({
  root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, cacheDir, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'scanner-surfaces-stock-session-fixture', enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === 'virtual:scanner-surfaces-stock-session') return '\0scanner-surfaces-stock-session'
      if (source.startsWith('\0')) return null
      // The provider boots sync, sockets and the session; the float only needs the context it reads.
      // Not while Vite scans the app's own entries for dependencies: they import the provider's other exports.
      if ((options as { scan?: boolean } | undefined)?.scan) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && resolved.id.split('?')[0].replace(/\\/g, '/').toLowerCase() === srcAppContext) return resolve(root, 'src', 'app', 'AppContextCore.tsx')
      return null
    },
    async load(id) { if (id === '\0scanner-surfaces-stock-session') return (await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code },
    configureServer(app) {
      app.middlewares.use('/stock-session', async (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end(await app.transformIndexHtml('/stock-session', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:scanner-surfaces-stock-session"></script></body></html>'))
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
const CODE = '3348901729222'
const SEARCH = 'input[aria-label="Product or barcode"]'

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
  await page.goto(`http://127.0.0.1:${address.port}/stock-session`)
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 120000 })
    .catch((error: Error) => { throw new Error([error.message, ...problems].join('\n')) })

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
  const waitReady = (): Promise<unknown> => page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 120000 })
  // A float that crashed (a barcode that became a quantity) leaves no tree behind: reload so one red test cannot hide the next.
  async function openSession(options: { picked: boolean; mode?: string }): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      await page.evaluate((opts) => {
        localStorage.clear()
        ;(window as any).__notices.length = 0
        ;(window as any).__open({ mode: 'add', ...opts })
      }, options)
      try {
        await page.waitForSelector('[data-stock-session-entry]', { timeout: 8000 })
        break
      } catch (error) {
        if (attempt > 0) throw error
        await page.reload()
        await waitReady()
      }
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
  const bodyText = (): Promise<string> => page.evaluate(() => document.body.textContent || '')
  const lineAdded = async (): Promise<boolean> => !(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled())
  const searchValue = (): Promise<string> => page.inputValue(SEARCH)
  const notices = (): Promise<unknown[]> => page.evaluate(() => (window as any).__notices)
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

  for (const [mode, label] of [['add', 'Qty'], ['remove', 'Qty'], ['set', 'Set to']] as const) {
    await test(`${mode}: a gun burst into the picked line's ${label} box is put back, adds no line, and lands in the search`, async () => {
      await openSession({ picked: true, mode })
      assert.equal(await page.locator(SEARCH).count(), 0, 'a picked product replaces the search box')
      const field = `input[aria-label="${label}"]`
      await page.focus(field)
      await typeKeys(gun(CODE), 4)
      await page.waitForSelector(SEARCH, { timeout: 5000 })
      assert.equal(await searchValue(), CODE, 'the code arrives as ASCII digits although the layout typed Khmer ones')
      assert.equal(await lineAdded(), false, 'the Enter did not run the field\'s add')
      assert.ok(!(await bodyText()).includes('Gun fixture'), 'no line holds the picked product and the chip is gone')
      assert.deepEqual(await notices(), [['Barcode moved to search', 'info']])
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Product or barcode', 'focus is on the search, ready for the next scan')
    })
  }

  await test('add: a burst into Qty on the ASCII layout does not turn the barcode into the quantity', async () => {
    await openSession({ picked: true })
    await page.focus('input[aria-label="Qty"]')
    await typeKeys(gun(CODE, asciiDigit), 4)
    await page.waitForSelector(SEARCH, { timeout: 5000 })
    assert.equal(await searchValue(), CODE)
    assert.equal(await lineAdded(), false)
    assert.ok(!(await bodyText()).includes(CODE.slice(0, 6) + ' '), 'no quantity of 3348901729222 anywhere')
  })

  for (const label of ['Cost', 'Price']) {
    await test(`add: a burst into the ${label} box is put back and lands in the search`, async () => {
      await openSession({ picked: true })
      await page.focus(`input[aria-label="${label}"]`)
      await typeKeys(gun(CODE), 4)
      await page.waitForSelector(SEARCH, { timeout: 5000 })
      assert.equal(await searchValue(), CODE)
      assert.equal(await lineAdded(), false)
      assert.deepEqual(await notices(), [['Barcode moved to search', 'info']])
    })
  }

  await test('add: a burst into the Expiry date box is put back and lands in the search', async () => {
    await openSession({ picked: true })
    await page.focus('input[aria-label="Expiry"]')
    await typeKeys(gun(CODE), 4)
    await page.waitForSelector(SEARCH, { timeout: 5000 })
    assert.equal(await searchValue(), CODE)
    assert.equal(await lineAdded(), false)
  })

  await test('a picked line with nothing focused: the scan reopens the search with the code, and adds nothing', async () => {
    await openSession({ picked: true })
    await typeKeys(gun(CODE), 4)
    await page.waitForSelector(SEARCH, { timeout: 5000 })
    assert.equal(await searchValue(), CODE)
    assert.equal(await lineAdded(), false)
    assert.deepEqual(await notices(), [], 'nothing was moved out of a field, so no notice')
  })

  await test('no product picked, search focused: the burst replaces its text with the ASCII code', async () => {
    await openSession({ picked: false })
    await page.fill(SEARCH, 'serum')
    await page.focus(SEARCH)
    await typeKeys(gun(CODE), 4)
    await page.waitForFunction((value) => (document.querySelector('input[aria-label="Product or barcode"]') as HTMLInputElement | null)?.value === value, CODE, { timeout: 5000 })
    assert.equal(await lineAdded(), false)
  })

  await test('no product picked, nothing focused: the scan is no longer lost', async () => {
    await openSession({ picked: false })
    await typeKeys(gun(CODE), 4)
    await page.waitForFunction((value) => (document.querySelector('input[aria-label="Product or barcode"]') as HTMLInputElement | null)?.value === value, CODE, { timeout: 5000 })
  })

  await test('a person typing a quantity and pressing Enter still adds the line', async () => {
    await openSession({ picked: true })
    await page.fill('input[aria-label="Qty"]', '')
    await page.focus('input[aria-label="Qty"]')
    await typeKeys([asciiDigit('2'), asciiDigit('5')], 120)
    await typeKeys([ENTER], 120)
    await page.waitForFunction(() => !!document.body.textContent?.includes('Gun fixture'), null, { timeout: 5000 })
    assert.equal(await lineAdded(), true)
    assert.equal(await page.locator(SEARCH).count(), 1, 'the entry row is ready for the next product')
  })

  // Lane 6.0.945 (release review P3-2): a scan clears a picked item, so an item with typed values is kept instead.
  const FINISH_NOTICE = [['Add or clear this item first', 'warning']]
  for (const [mode, label] of [['add', 'Qty'], ['remove', 'Qty'], ['set', 'Set to']] as const) {
    await test(`${mode}: a scan with nothing focused keeps an item whose ${label} was typed, says why, and does not touch the search`, async () => {
      await openSession({ picked: true, mode })
      await page.fill(`input[aria-label="${label}"]`, '3')
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await typeKeys(gun(CODE), 4)
      await page.waitForTimeout(400)
      assert.equal(await page.locator(SEARCH).count(), 0, 'the picked item stays and the search stays hidden')
      assert.equal(await page.inputValue(`input[aria-label="${label}"]`), '3', 'what was typed is still there')
      assert.ok((await bodyText()).includes('Gun fixture'), 'the picked product is still shown')
      assert.equal(await lineAdded(), false)
      assert.deepEqual(await notices(), FINISH_NOTICE)
    })
  }

  await test('add: a burst typed into the typed Qty box is put back, the item is kept, and only the finish-first notice shows', async () => {
    await openSession({ picked: true })
    await page.fill('input[aria-label="Qty"]', '12')
    await page.focus('input[aria-label="Qty"]')
    await typeKeys(gun(CODE), 4)
    await page.waitForTimeout(400)
    assert.equal(await page.locator(SEARCH).count(), 0)
    assert.equal(await page.inputValue('input[aria-label="Qty"]'), '12', 'the barcode did not become the quantity')
    assert.equal(await lineAdded(), false)
    assert.deepEqual(await notices(), FINISH_NOTICE, 'no "moved to search": it did not move')
  })

  for (const label of ['Cost', 'Price']) {
    await test(`add: a changed ${label} keeps the item on a scan`, async () => {
      await openSession({ picked: true })
      await page.fill(`input[aria-label="${label}"]`, '7.25')
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await typeKeys(gun(CODE), 4)
      await page.waitForTimeout(400)
      assert.equal(await page.locator(SEARCH).count(), 0)
      assert.equal(await page.inputValue(`input[aria-label="${label}"]`), '7.25')
      assert.deepEqual(await notices(), FINISH_NOTICE)
    })
  }

  await test('add: typing the cost the product already has is not typing, so the scan still clears the item', async () => {
    await openSession({ picked: true })
    await page.fill('input[aria-label="Cost"]', '4.00')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await typeKeys(gun(CODE), 4)
    await page.waitForSelector(SEARCH, { timeout: 5000 })
    assert.equal(await searchValue(), CODE)
    assert.deepEqual(await notices(), [])
  })

  await test('add: after the X clears a typed item, the next scan fills the search', async () => {
    await openSession({ picked: true })
    await page.fill('input[aria-label="Qty"]', '12')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await typeKeys(gun(CODE), 4)
    await page.waitForTimeout(300)
    assert.deepEqual(await notices(), FINISH_NOTICE)
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.waitForSelector(SEARCH, { timeout: 5000 })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await typeKeys(gun(CODE), 4)
    await page.waitForFunction((value) => (document.querySelector('input[aria-label="Product or barcode"]') as HTMLInputElement | null)?.value === value, CODE, { timeout: 5000 })
  })

  await test('add: a clean item that the gun hits in a field still moves to the search, with the moved notice (the put-back is seen before the check)', async () => {
    await openSession({ picked: true })
    await page.focus('input[aria-label="Qty"]')
    await typeKeys(gun(CODE), 4)
    await page.waitForSelector(SEARCH, { timeout: 5000 })
    assert.equal(await searchValue(), CODE)
    assert.deepEqual(await notices(), [['Barcode moved to search', 'info']])
  })

  await test('the float renders and runs without a page error', async () => {
    assert.deepEqual(problems, [])
  })

  await page.close()
} finally {
  await browser?.close()
  await server.close()
}
if (failed > 0) process.exitCode = 1
process.exit(failed > 0 ? 1 : 0)
