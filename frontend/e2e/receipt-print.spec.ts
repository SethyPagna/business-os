import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth, type PageHealth } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * receipt-print.spec.ts -- the receipt that actually reaches the printer.
 *
 * Owner report (23 Sep 2026): receipts printed with a blank band on top, and one
 * tap could print twice. The fix made 'driver-forms' ("Printer paper
 * (default)") the default mode: no `@page size`, `@page` margin 0, the receipt
 * at the printer's paper width (72 mm), and exactly one print call per tap on
 * both delivery surfaces in src/utils/printSurface.ts -- the preview window
 * (window.open) and the hidden frame (execCommand('print') first, print() only
 * when that returns false).
 *
 * What is REAL here: the built app from dist, the /receipt-settings page, the
 * "Test print this mode" button, printReceipt(), the document it writes and the
 * delivery surface it picks. What is STUBBED: only the last step, the call that
 * would open the operating system's print dialog. Every realm (page, hidden
 * frame, preview popup) gets the stub, the call is counted, and the document is
 * snapshotted at the moment of the call.
 *
 * Geometry is measured in the document that printed, with print media
 * emulated, in mm (CSS px * 25.4 / 96). The "Measured" mode keeps the 4 mm top
 * margin, so the same instrument reading >= 3.5 mm there is the positive
 * control for the <= 1.5 mm reading in the default mode.
 *
 * The saved settings are served the way production holds them: the retired
 * `driverFormHeightsMm` list present, no `pageSizeMode` (so the default mode
 * applies), and the settings endpoint keeps whatever the page last saved.
 */

// Service workers are blocked because every settings read and write below is
// intercepted with context.route, which a worker would bypass.
test.use({ serviceWorkers: 'block' })

const EN = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>

/** Production's saved receipt_print_settings (23 Sep 2026), byte for byte. */
const PRODUCTION_PRINT_SETTINGS = '{"paperSize":"80mm","marginTop":"4","marginRight":"4","marginBottom":"4","marginLeft":"4","scale":"100","driverFormHeightsMm":[210,297,400,800]}'
const SETTINGS_UPDATED_AT = '2026-09-23 00:00:00'
const PX_TO_MM = 25.4 / 96
/** Allowed failed API responses: the same one returns-time-range.spec.ts tolerates. */
const TOLERATED_API_FAILURES = ['401 /api/auth/bootstrap']

type PrintCall = { via: 'print' | 'execCommand'; html: string }
type SettingsWrite = Record<string, unknown>

type Harness = {
  health: PageHealth
  /** Every POST /api/settings body the page sent, in order. */
  writes: SettingsWrite[]
}

/**
 * Stub printing in every realm and count the calls in the admin page.
 *
 * Installed three ways, idempotently (window.__e2ePrintStubbed): as an init
 * script, which covers any realm the engine runs init scripts in; on the
 * window returned by window.open, and on an iframe's window the moment it is
 * appended, because a document.write()n about:blank realm is not guaranteed to
 * run init scripts in every engine. All three record into ONE sink, the admin
 * page's window.__e2ePrints, so a call is counted once wherever it happens.
 *
 * execCommand('print') returns true, which is what both Chromium and WebKit
 * return for a supported, executed print command (the spec asserts
 * queryCommandSupported('print') on the REAL prototype before stubbing it).
 */
async function stubPrinting(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    type Sink = Window & {
      __e2ePrints?: Array<{ via: string; html: string }>
      __e2eBlockPopup?: boolean
      __e2eExecPrintSupported?: boolean | null
    }
    type Stubbable = Window & typeof globalThis & { __e2ePrintStubbed?: boolean }
    const sink = (): Sink => {
      try { return ((window.opener as Window | null) || window).top as Sink } catch { return window as Sink }
    }
    const record = (via: string, doc: Document | null | undefined) => {
      const target = sink()
      if (!target.__e2ePrints) target.__e2ePrints = []
      target.__e2ePrints.push({ via, html: doc?.documentElement?.outerHTML ?? '' })
    }
    const stub = (win: Stubbable | null | undefined) => {
      if (!win || win.__e2ePrintStubbed) return
      win.__e2ePrintStubbed = true
      const proto = win.Document.prototype
      const realExec = proto.execCommand
      if (win === (window as Window) && !(window.opener) && window.top === window) {
        try { (window as Sink).__e2eExecPrintSupported = proto.queryCommandSupported.call(win.document, 'print') } catch { (window as Sink).__e2eExecPrintSupported = null }
      }
      proto.execCommand = function execCommand(this: Document, command: string, ...rest: [boolean?, string?]) {
        if (String(command).toLowerCase() === 'print') { record('execCommand', this); return true }
        return realExec.call(this, command, ...rest)
      }
      win.print = () => { record('print', win.document) }
    }
    stub(window as Stubbable)
    const realOpen = window.open
    window.open = function open(this: Window, ...args: Parameters<typeof window.open>) {
      if (sink().__e2eBlockPopup) return null
      const opened = realOpen.apply(this, args)
      try { stub(opened as Stubbable | null) } catch { /* cross-origin: nothing of ours prints there */ }
      return opened
    }
    const realAppend = Node.prototype.appendChild
    Node.prototype.appendChild = function appendChild<T extends Node>(this: Node, child: T): T {
      const appended = realAppend.call(this, child) as T
      if (child instanceof HTMLIFrameElement) {
        try { stub(child.contentWindow as Stubbable | null) } catch { /* cross-origin frame */ }
      }
      return appended
    }
  })
}

/**
 * Loopback only, plus the settings endpoint served as production holds it and
 * kept stateful: a save changes what the next read returns, as D1 would.
 */
async function serveSettings(context: BrowserContext, writes: SettingsWrite[]): Promise<void> {
  let stored = PRODUCTION_PRINT_SETTINGS
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
    const method = request.method()
    if (url.pathname === '/api/settings/meta' && method === 'GET') {
      // cloudflare/src/routes/settings.ts GET /meta -> { updatedAt }.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: SETTINGS_UPDATED_AT }) })
    }
    if (url.pathname === '/api/settings' && method === 'POST') {
      const body = (request.postDataJSON() || {}) as SettingsWrite
      writes.push(body)
      if (typeof body.receipt_print_settings === 'string') stored = body.receipt_print_settings
      // settings.ts POST / -> { updatedAt, keys }.
      const keys = Object.keys(body).filter((key) => !['expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at'].includes(key))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: SETTINGS_UPDATED_AT, keys }) })
    }
    if (url.pathname === '/api/settings' && method === 'GET') {
      const response = await route.fetch()
      if (!response.ok()) return route.fulfill({ response })
      const json = await response.json() as Record<string, unknown>
      return route.fulfill({ response, json: { ...json, receipt_print_settings: stored, updatedAt: SETTINGS_UPDATED_AT } })
    }
    if ((url.pathname === '/api/auth/bootstrap' || url.pathname === '/api/auth/me') && method === 'GET') {
      const response = await route.fetch()
      if (!response.ok()) return route.fulfill({ response })
      const json = await response.json() as { settings?: Record<string, unknown> }
      return route.fulfill({ response, json: { ...json, settings: { ...(json.settings || {}), receipt_print_settings: stored } } })
    }
    return route.continue()
  })
}

async function openPrintPanel(page: Page, context: BrowserContext): Promise<Harness> {
  const health = collectPageHealth(page)
  const writes: SettingsWrite[] = []
  await stubPrinting(context)
  await serveSettings(context, writes)
  // cashier_a carries the admin session's permissions (fixtureServer.mjs SESSION_USERS), as in returns-time-range.spec.ts.
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, '/receipt-settings')
  await page.getByRole('button', { name: EN.receipt_print, exact: true }).click()
  await expect(page.getByRole('button', { name: EN.print_test_this_mode, exact: true })).toBeVisible()
  return { health, writes }
}

const modeCard = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const widthField = (page: Page) => page.getByLabel(EN.print_driver_form_width, { exact: true })
const rollHint = (page: Page) => page.getByText(EN.receipt_preview_driver_hint, { exact: true })

async function printCalls(page: Page): Promise<PrintCall[]> {
  return page.evaluate(() => ((window as Window & { __e2ePrints?: PrintCall[] }).__e2ePrints || []).map((call) => ({ ...call })))
}

/** Tap once, wait for the call, then give a second call time to show up. */
async function tapTestPrint(page: Page, before: number): Promise<PrintCall[]> {
  await page.getByRole('button', { name: EN.print_test_this_mode, exact: true }).click()
  await expect.poll(async () => (await printCalls(page)).length, { message: 'the tap must reach a print call', timeout: 20_000 }).toBeGreaterThan(before)
  // printSurface.ts waits up to 4 s for assets before printing; a duplicate
  // call (print() after a successful execCommand, or a second schedule) would
  // land well inside this window.
  await page.waitForTimeout(2_500)
  return printCalls(page)
}

/** Every `@page { ... }` body in the document as it was when print was called. */
function pageRules(html: string): string[] {
  return Array.from(html.matchAll(/@page\s*\{([^}]*)\}/g), (match) => match[1].replace(/\s+/g, ' ').trim())
}

/**
 * Receipt copies in the snapshot, counted as ELEMENTS in the parsed document:
 * Receipt.tsx renders exactly one [data-receipt-export-root] per receipt, and
 * the Test print button prints the live preview's receipt (a 0 here means it
 * fell back to PrintSettings' synthetic sample, which is a failure too).
 *
 * Measured, not assumed: a text count is wrong twice over (the embedded
 * stylesheet names receipt attributes in selectors, and the receipt number also
 * sits in the non-printing toolbar), and data-receipt-high-contrast is no
 * marker either -- applyHighContrastBold stamps it on the print wrapper AND the
 * receipt root, so one receipt reads as two.
 */
async function receiptCopies(page: Page, html: string): Promise<{ frames: number; roots: number }> {
  return page.evaluate((snapshot) => {
    const doc = new DOMParser().parseFromString(snapshot, 'text/html')
    return {
      frames: doc.querySelectorAll('.receipt-frame').length,
      roots: doc.querySelectorAll('.receipt-frame [data-receipt-export-root]').length,
    }
  }, html)
}

type Geometry = {
  printMedia: boolean
  frameWidthMm: number
  firstText: string
  firstTextTopMm: number
  receiptFrames: number
  receiptRoots: number
}

/** Runs inside the document that printed, with print media emulated. */
function measure(pxToMm: number): Geometry {
  const frame = document.querySelector('.receipt-frame') as HTMLElement | null
  if (!frame) throw new Error('no .receipt-frame in the printed document')
  const docTop = document.documentElement.getBoundingClientRect().top
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
  let firstText = ''
  let firstTextTopPx = Number.NaN
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.nodeValue?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    firstText = node.nodeValue.trim().slice(0, 40)
    firstTextTopPx = rect.top - docTop
    break
  }
  return {
    printMedia: window.matchMedia('print').matches,
    frameWidthMm: frame.getBoundingClientRect().width * pxToMm,
    firstText,
    firstTextTopMm: firstTextTopPx * pxToMm,
    receiptFrames: document.querySelectorAll('.receipt-frame').length,
    receiptRoots: frame.querySelectorAll('[data-receipt-export-root]').length,
  }
}

/** The hidden print frame is the one child frame holding a receipt document. */
async function printFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue
      if (await frame.locator('.receipt-frame').count().catch(() => 0)) { found = frame; return true }
    }
    return false
  }, { message: 'the hidden print frame must hold the receipt document' }).toBe(true)
  return found!
}

async function geometryOf(owner: Page, target: Page | Frame): Promise<Geometry> {
  await owner.emulateMedia({ media: 'print' })
  try {
    return await target.evaluate(measure, PX_TO_MM)
  } finally {
    await owner.emulateMedia({ media: null })
  }
}

function expectHealthy(harness: Harness): void {
  expect(harness.health.pageErrors, 'uncaught page errors').toEqual([])
  expect(harness.health.consoleErrors, 'console.error from app code').toEqual([])
  expect(harness.health.failedApiResponses.filter((entry) => !TOLERATED_API_FAILURES.includes(entry)), 'failed API responses').toEqual([])
}

test('the print panel defaults to printer paper with one width field, and a width edit saves without the retired heights', async ({ page, context }, testInfo) => {
  const harness = await openPrintPanel(page, context)

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 })
    const card = modeCard(page, EN.print_page_size_mode_driver_forms)
    await expect(card).toHaveCount(1)
    await expect(card, 'Printer paper (default) is the selected mode').toHaveClass(/\bborder-blue-600\b/)
    await expect(modeCard(page, EN.print_page_size_mode_measured)).not.toHaveClass(/\bborder-blue-600\b/)

    await expect(widthField(page)).toHaveCount(1)
    await expect(widthField(page)).toHaveAttribute('id', 'print-driver-form-width')
    await expect(widthField(page)).toHaveValue('72')
    const label = page.locator('label[for="print-driver-form-width"]')
    await expect(label).toHaveText(EN.print_driver_form_width)
    const hint = page.getByRole('button', { name: EN.print_driver_forms_title, exact: true })
    await expect(hint).toBeVisible()
    const labelBox = await label.boundingBox()
    const hintBox = await hint.boundingBox()
    expect(labelBox && hintBox, 'label and info hint are both laid out').toBeTruthy()
    const labelMid = labelBox!.y + labelBox!.height / 2
    const hintMid = hintBox!.y + hintBox!.height / 2
    expect(Math.abs(labelMid - hintMid), 'the info hint sits on the label row').toBeLessThanOrEqual(6)
    expect(hintBox!.x, 'the info hint follows the label').toBeGreaterThan(labelBox!.x)

    await expect(page.getByText(/Form heights|Add height/i)).toHaveCount(0)
    await expect(rollHint(page)).toHaveCount(0)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `no horizontal page scroll at ${width}px`).toBeLessThanOrEqual(0)
    await widthField(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`print-panel-${width}.png`) })
  }

  const savedPrintSettings = () => harness.writes
    .map((write) => write.receipt_print_settings)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => JSON.parse(value) as Record<string, unknown>)

  await widthField(page).fill('58')
  await expect.poll(() => savedPrintSettings().at(-1)?.driverFormWidthMm, { message: 'typing 58 saves driverFormWidthMm "58"' }).toBe('58')
  expect(savedPrintSettings().at(-1), 'the saved JSON drops the retired height list').not.toHaveProperty('driverFormHeightsMm')
  // The refresh that follows a save must not snap the field back.
  await page.waitForTimeout(1_000)
  await expect(widthField(page)).toHaveValue('58')

  await widthField(page).fill('72')
  await expect.poll(() => savedPrintSettings().at(-1)?.driverFormWidthMm, { message: 'restoring 72 saves "72"' }).toBe('72')
  expect(savedPrintSettings().at(-1)).not.toHaveProperty('driverFormHeightsMm')
  for (const saved of savedPrintSettings()) expect(saved).not.toHaveProperty('driverFormHeightsMm')

  expectHealthy(harness)
})

for (const surface of ['preview window', 'hidden frame'] as const) {
  test(`one tap prints one top-aligned 72 mm receipt through the ${surface}; Measured keeps its 4 mm top (positive control)`, async ({ page, context }, testInfo) => {
    const harness = await openPrintPanel(page, context)

    // The real engine's contract that the execCommand stub stands in for.
    expect(await page.evaluate(() => (window as Window & { __e2eExecPrintSupported?: boolean | null }).__e2eExecPrintSupported), 'this engine supports execCommand("print"), so it returns true').toBe(true)

    if (surface === 'hidden frame') {
      // What an installed iOS app, or a blocked popup, gets: no second window.
      await page.evaluate(() => { (window as Window & { __e2eBlockPopup?: boolean }).__e2eBlockPopup = true })
    }
    const expectedVia = surface === 'preview window' ? 'print' : 'execCommand'

    const printOnce = async (mode: string, before: number) => {
      const popup = surface === 'preview window' ? page.waitForEvent('popup') : null
      const calls = await tapTestPrint(page, before)
      // Evidence first, so a red run still leaves the documents that printed.
      for (const [index, extra] of calls.slice(before).entries()) {
        const file = testInfo.outputPath(`printed-${mode}-${surface.replace(' ', '-')}-${index + 1}.html`)
        fs.writeFileSync(file, extra.html)
        await testInfo.attach(path.basename(file), { path: file, contentType: 'text/html' })
      }
      expect(calls.length, 'exactly one print call for one tap').toBe(before + 1)
      const call = calls[before]
      expect(call.via, `the ${surface} prints through ${expectedVia}`).toBe(expectedVia)
      const target = popup ? await popup : await printFrame(page)
      const geometry = await geometryOf(popup ? (target as Page) : page, target)
      return { call, geometry, target }
    }

    // --- 'driver-forms', the default ------------------------------------------
    await expect(modeCard(page, EN.print_page_size_mode_driver_forms)).toHaveClass(/\bborder-blue-600\b/)
    const driverForms = await printOnce('driver-forms', 0)
    const rules = pageRules(driverForms.call.html)
    expect(rules.length, 'the printed document carries an @page rule').toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule, 'no @page rule declares a size').not.toMatch(/(^|;|\s)size\s*:/)
      expect(rule, 'the @page margin is 0').toMatch(/(^|;|\s)margin\s*:\s*0(mm|px)?\s*(;|$)/)
    }
    expect(await receiptCopies(page, driverForms.call.html), 'exactly one receipt copy in the printed document').toEqual({ frames: 1, roots: 1 })
    expect(driverForms.geometry.printMedia, 'print media is emulated on the printing document').toBe(true)
    expect(driverForms.geometry.receiptFrames).toBe(1)
    expect(driverForms.geometry.receiptRoots).toBe(1)
    expect(driverForms.geometry.frameWidthMm, 'the receipt prints at the 72 mm paper width').toBeGreaterThanOrEqual(71.5)
    expect(driverForms.geometry.frameWidthMm).toBeLessThanOrEqual(72.5)
    expect(driverForms.geometry.firstText, 'a visible first line was found').not.toBe('')
    expect(driverForms.geometry.firstTextTopMm, `driver-forms first text top (${driverForms.geometry.firstText})`).toBeLessThanOrEqual(1.5)
    testInfo.annotations.push({ type: 'driver-forms', description: JSON.stringify(driverForms.geometry) })
    if (surface === 'preview window') await (driverForms.target as Page).close()

    // --- positive control: 'measured' keeps the configured 4 mm top margin ------
    await modeCard(page, EN.print_page_size_mode_measured).click()
    await expect(modeCard(page, EN.print_page_size_mode_measured)).toHaveClass(/\bborder-blue-600\b/)
    await expect(rollHint(page), 'Measured shows the roll-paper hint').toBeVisible()
    await expect(widthField(page), 'Measured hides the width field').toHaveCount(0)
    const measured = await printOnce('measured', 1)
    expect(pageRules(measured.call.html).some((rule) => /(^|;|\s)size\s*:/.test(rule)), 'the @page size check can see a size (Measured declares one)').toBe(true)
    expect(await receiptCopies(page, measured.call.html)).toEqual({ frames: 1, roots: 1 })
    expect(measured.geometry.printMedia).toBe(true)
    expect(measured.geometry.firstTextTopMm, `measured first text top (${measured.geometry.firstText})`).toBeGreaterThanOrEqual(3.5)
    testInfo.annotations.push({ type: 'measured', description: JSON.stringify(measured.geometry) })

    expectHealthy(harness)
  })
}
