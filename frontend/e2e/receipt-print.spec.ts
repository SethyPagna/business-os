import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Frame, type Page, type TestInfo } from '@playwright/test'
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
 * The same day's follow-ups are pinned here too: the 80x50 card prints from the
 * top of the printer paper; the print document carries the app's Khmer font, so
 * it prints in the font the app measured with (a fallback font made receipts
 * longer than their page and clipped the card); a sale's Print -> All prints the
 * card and then the full receipt, one after the other; and with the card on,
 * Receipt Settings' test print prints the full receipt on roll paper.
 *
 * What is REAL here: the built app from dist, the /receipt-settings and /sales
 * pages, their Print controls, printReceipt(), the document it writes and the
 * delivery surface it picks. What is STUBBED: only the last step, the call that
 * would open the operating system's print dialog. Every realm (page, hidden
 * frame, preview popup) gets the stub, the call is counted, and the document
 * and its loaded fonts are snapshotted at the moment of the call.
 *
 * Geometry is measured in the document that printed, with print media
 * emulated, in mm (CSS px * 25.4 / 96). The "Measured" mode keeps the 4 mm top
 * margin, so the same instrument reading >= 3.5 mm there is the positive
 * control for the <= 1.5 mm reading in the default mode.
 *
 * The fixture server serves the saved settings the way production holds them
 * -- the retired `driverFormHeightsMm` list present, no `pageSizeMode` (so the
 * default mode applies), the 80x50 card on -- and keeps whatever the page
 * saves, per context (fixtureServer.mjs settingsScopes). Nothing is
 * intercepted: in Chromium any Playwright request interception, page.route on
 * the opener included, stalls the font loads of the window.open() +
 * document.write() preview window, which are the fonts checked here (an
 * iframe's document, and WebKit, load them either way).
 */

// Service workers are blocked so every request, the print documents' font
// loads included, goes straight to the fixture server.
test.use({ serviceWorkers: 'block' })

const EN = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>

/** Production's saved receipt_print_settings (23 Sep 2026), byte for byte. */
const PRODUCTION_PRINT_SETTINGS = '{"paperSize":"80mm","marginTop":"4","marginRight":"4","marginBottom":"4","marginLeft":"4","scale":"100","driverFormHeightsMm":[210,297,400,800]}'
/**
 * The receipt template: the 80x50 card on, as production has it
 * (sales_receipt_enabled, read 23 Sep 2026), so the settings preview and every
 * sale receipt hold BOTH renditions; and the bilingual receipt, whose Khmer
 * text needs the app's Khmer font in the print document.
 */
const RECEIPT_TEMPLATE = '{"sales_receipt_enabled":true,"receipt_language":"both"}'
const PX_TO_MM = 25.4 / 96
/** The face the receipt's Khmer stack resolves to (@fontsource, self-hosted). */
const KHMER_FONT = 'Noto Sans Khmer'
/** Allowed failed API responses: the same one returns-time-range.spec.ts tolerates. */
const TOLERATED_API_FAILURES = ['401 /api/auth/bootstrap']
const SURFACES = ['preview window', 'hidden frame'] as const
type Surface = typeof SURFACES[number]

type PrintCall = { via: 'print' | 'execCommand'; html: string; fonts: string[] }
type SettingsWrite = Record<string, unknown>

type Harness = {
  health: PageHealth
  /** This context's settings on the fixture server (settingsScopes). */
  scope: string
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
 * Each record keeps the font families the document had LOADED at that moment:
 * what the printer would have printed with.
 *
 * execCommand('print') returns true, which is what both Chromium and WebKit
 * return for a supported, executed print command (the spec asserts
 * queryCommandSupported('print') on the REAL prototype before stubbing it).
 */
async function stubPrinting(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    type Sink = Window & {
      __e2ePrints?: Array<{ via: string; html: string; fonts: string[] }>
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
      const faces = doc?.fonts ? Array.from(doc.fonts as unknown as Iterable<FontFace>) : []
      target.__e2ePrints.push({
        via,
        html: doc?.documentElement?.outerHTML ?? '',
        fonts: faces.filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')),
      })
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

async function openAdmin(page: Page, context: BrowserContext, surface: Surface | null, pathname: string): Promise<Harness> {
  const health = collectPageHealth(page)
  const scope = randomUUID()
  // The settings production holds, kept for this context by the fixture
  // server, and the sales fixture dated today (the Sales list opens on today).
  const seeded = await context.request.post(`${ADMIN_ORIGIN}/__e2e/settings?scope=${scope}`, {
    data: { receipt_print_settings: PRODUCTION_PRINT_SETTINGS, receipt_template: RECEIPT_TEMPLATE },
  })
  expect(seeded.ok(), 'the fixture server takes the seeded settings').toBe(true)
  await context.addCookies([
    { name: 'e2e_settings_scope', value: scope, url: ADMIN_ORIGIN },
    { name: 'e2e_sales_today', value: '1', url: ADMIN_ORIGIN },
  ])
  await stubPrinting(context)
  // cashier_a carries the admin session's permissions (fixtureServer.mjs SESSION_USERS), as in returns-time-range.spec.ts.
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, pathname)
  if (surface === 'hidden frame') {
    // What an installed iOS app, or a blocked popup, gets: no second window.
    await page.evaluate(() => { (window as Window & { __e2eBlockPopup?: boolean }).__e2eBlockPopup = true })
  }
  return { health, scope }
}

async function openPrintPanel(page: Page, context: BrowserContext, surface: Surface | null = null): Promise<Harness> {
  const harness = await openAdmin(page, context, surface, '/receipt-settings')
  await page.getByRole('button', { name: EN.receipt_print, exact: true }).click()
  await expect(page.getByRole('button', { name: EN.print_test_this_mode, exact: true })).toBeVisible()
  return harness
}

const modeCard = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
const widthField = (page: Page) => page.getByLabel(EN.print_driver_form_width, { exact: true })
const rollHint = (page: Page) => page.getByText(EN.receipt_preview_driver_hint, { exact: true })

/** Every receipt_print_settings the page saved, in order (its POST /api/settings bodies). */
async function savedPrintSettings(page: Page, harness: Harness): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`${ADMIN_ORIGIN}/__e2e/settings?scope=${harness.scope}`)
  const { writes } = await response.json() as { writes: SettingsWrite[] }
  return writes
    .map((write) => write.receipt_print_settings)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => JSON.parse(value) as Record<string, unknown>)
}

async function printCalls(page: Page): Promise<PrintCall[]> {
  return page.evaluate(() => ((window as Window & { __e2ePrints?: PrintCall[] }).__e2ePrints || []).map((call) => ({ ...call })))
}

/**
 * Tap once, wait for the expected calls, then give an extra call time to show
 * up. Evidence first, so a red run still leaves the documents that printed.
 */
async function tapAndCollect(page: Page, testInfo: TestInfo, label: string, before: number, expected: number, tap: () => Promise<void>): Promise<PrintCall[]> {
  await tap()
  await expect.poll(async () => (await printCalls(page)).length, { message: 'the tap must reach its print calls', timeout: 30_000 }).toBeGreaterThanOrEqual(before + expected)
  // printSurface.ts waits up to 4 s for assets before printing; a duplicate
  // call (print() after a successful execCommand, or a second schedule) would
  // land well inside this window.
  await page.waitForTimeout(2_500)
  const calls = await printCalls(page)
  for (const [index, extra] of calls.slice(before).entries()) {
    const file = testInfo.outputPath(`printed-${label}-${index + 1}.html`)
    fs.writeFileSync(file, extra.html)
    await testInfo.attach(path.basename(file), { path: file, contentType: 'text/html' })
  }
  expect(calls.length, `exactly ${expected} print call(s) for one tap`).toBe(before + expected)
  return calls.slice(before)
}

/** Every `@page { ... }` body in the document as it was when print was called. */
function pageRules(html: string): string[] {
  return Array.from(html.matchAll(/@page\s*\{([^}]*)\}/g), (match) => match[1].replace(/\s+/g, ' ').trim())
}

/**
 * Receipt copies in the snapshot, counted as ELEMENTS in the parsed document:
 * Receipt.tsx renders exactly one [data-receipt-export-root] per receipt, and
 * the Test print button prints the live preview's receipt (a 0 here means it
 * fell back to PrintSettings' synthetic sample, which is a failure too). The
 * Receipt Settings preview names each root by its rendition ('card' = the
 * 80x50 card, 'full' = the full receipt); a sale's receipt view does not, so
 * its copies are told apart by their text (saleRenditions).
 *
 * Measured, not assumed: a text count is wrong twice over (the embedded
 * stylesheet names receipt attributes in selectors, and the receipt number also
 * sits in the non-printing toolbar), and data-receipt-high-contrast is no
 * marker either -- applyHighContrastBold stamps it on the print wrapper AND the
 * receipt root, so one receipt reads as two.
 */
async function receiptCopies(page: Page, html: string): Promise<{ frames: number; roots: number; renditions: string[]; texts: string[] }> {
  return page.evaluate((snapshot) => {
    const doc = new DOMParser().parseFromString(snapshot, 'text/html')
    const roots = Array.from(doc.querySelectorAll('.receipt-frame [data-receipt-export-root]'))
    return {
      frames: doc.querySelectorAll('.receipt-frame').length,
      roots: roots.length,
      renditions: roots.map((root) => root.getAttribute('data-receipt-rendition') || '(none)'),
      texts: roots.map((root) => (root.textContent || '').replace(/\s+/g, ' ').trim()),
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
  /** Content the receipt root cuts off (its scroll size beyond its box). */
  clippedMm: number
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
  const root = frame.querySelector('[data-receipt-export-root]') as HTMLElement | null
  const clippedPx = root ? Math.max(0, root.scrollHeight - root.clientHeight, root.scrollWidth - root.clientWidth) : Number.NaN
  return {
    printMedia: window.matchMedia('print').matches,
    frameWidthMm: frame.getBoundingClientRect().width * pxToMm,
    firstText,
    firstTextTopMm: firstTextTopPx * pxToMm,
    receiptFrames: document.querySelectorAll('.receipt-frame').length,
    receiptRoots: frame.querySelectorAll('[data-receipt-export-root]').length,
    clippedMm: clippedPx * pxToMm,
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

/**
 * One tap, one print call, through the surface under test; returns the call
 * and the geometry of the document that printed.
 */
async function printOnce(page: Page, testInfo: TestInfo, surface: Surface, label: string, before: number, tap: () => Promise<void>) {
  const popup = surface === 'preview window' ? page.waitForEvent('popup') : null
  const [call] = await tapAndCollect(page, testInfo, `${label}-${surface.replace(' ', '-')}`, before, 1, tap)
  const expectedVia = surface === 'preview window' ? 'print' : 'execCommand'
  expect(call.via, `the ${surface} prints through ${expectedVia}`).toBe(expectedVia)
  const target = popup ? await popup : await printFrame(page)
  const geometry = await geometryOf(popup ? (target as Page) : page, target)
  testInfo.annotations.push({ type: label, description: JSON.stringify(geometry) })
  return { call, geometry, target }
}

const tapTestPrint = (page: Page) => () => page.getByRole('button', { name: EN.print_test_this_mode, exact: true }).click()

/** Printed in the face it was measured with, and nothing cut off. */
function expectPrintedWhole(call: PrintCall, geometry: Geometry | null, what: string): void {
  expect(call.fonts, `${what}: the Khmer face is loaded in the print document when print is called`).toContain(KHMER_FONT)
  if (!geometry) return
  expect(geometry.clippedMm, `${what}: the receipt cuts nothing off`).toBeLessThanOrEqual(0.3)
}

/** Open the first sale's receipt from the Sales list; returns its Print menu. */
async function openSaleReceipt(page: Page) {
  // The row's Print action opens the sale's receipt (SalesListSurface.tsx).
  await page.getByRole('button', { name: EN.print, exact: true }).first().click()
  const printMenu = page.getByRole('button', { name: EN.print, exact: true })
  await expect(printMenu, 'the receipt view offers one Print menu').toHaveCount(1)
  return printMenu
}

/**
 * The sale receipt view's two renditions, as text: Receipt.tsx shows the 80x50
 * card first and the full receipt under it, and neither root is named.
 */
async function saleRenditions(page: Page): Promise<Record<'card' | 'full', string>> {
  const texts = await page.locator('[data-receipt-export-root="true"]')
    .evaluateAll((roots) => roots.map((root) => (root.textContent || '').replace(/\s+/g, ' ').trim()))
  expect(texts.length, 'the sale view shows the card and the full receipt').toBe(2)
  expect(texts[0], 'the two renditions differ, so their text tells them apart').not.toBe(texts[1])
  return { card: texts[0], full: texts[1] }
}

/** Which rendition one printed document holds: exactly one copy, matched by its text. */
async function printedRendition(page: Page, html: string, renditions: Record<'card' | 'full', string>): Promise<string> {
  const copies = await receiptCopies(page, html)
  expect({ frames: copies.frames, roots: copies.roots }, 'exactly one receipt copy').toEqual({ frames: 1, roots: 1 })
  const text = copies.texts[0]
  return text === renditions.card ? 'card' : text === renditions.full ? 'full' : `neither: ${text.slice(0, 80)}`
}

/** Pick one item of the sale receipt's Print menu (Receipt.tsx). */
const printMenuItem = (page: Page, printMenu: ReturnType<Page['getByRole']>, name: string) => async () => {
  await printMenu.click()
  await page.locator('[data-portal-menu-content]').getByRole('button', { name, exact: true }).click()
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

    // The panel describes what printing does in this mode: the printer paper's
    // width with the capped side margins, and the print dialog settings.
    await expect(page.getByText(EN.print_effective_dimensions.replace('{paper}', '72').replace('{content}', '70'), { exact: true })).toBeVisible()
    await expect(page.getByText(EN.print_driver_forms_dialog_note.replace('{width}', '72'), { exact: true })).toBeVisible()
    await expect(page.getByText(EN.print_driver_size_note, { exact: true })).toHaveCount(0)
    await expect(page.getByText(EN.print_margins_printer_paper, { exact: true })).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `no horizontal page scroll at ${width}px`).toBeLessThanOrEqual(0)
    await widthField(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`print-panel-${width}.png`) })
  }

  await widthField(page).fill('58')
  await expect.poll(async () => (await savedPrintSettings(page, harness)).at(-1)?.driverFormWidthMm, { message: 'typing 58 saves driverFormWidthMm "58"' }).toBe('58')
  expect((await savedPrintSettings(page, harness)).at(-1), 'the saved JSON drops the retired height list').not.toHaveProperty('driverFormHeightsMm')
  // The refresh that follows a save must not snap the field back.
  await page.waitForTimeout(1_000)
  await expect(widthField(page)).toHaveValue('58')

  await widthField(page).fill('72')
  await expect.poll(async () => (await savedPrintSettings(page, harness)).at(-1)?.driverFormWidthMm, { message: 'restoring 72 saves "72"' }).toBe('72')
  const saved = await savedPrintSettings(page, harness)
  expect(saved.at(-1)).not.toHaveProperty('driverFormHeightsMm')
  for (const each of saved) expect(each).not.toHaveProperty('driverFormHeightsMm')

  expectHealthy(harness)
})

for (const surface of SURFACES) {
  test(`one tap prints one top-aligned 72 mm receipt through the ${surface}; Measured keeps its 4 mm top (positive control)`, async ({ page, context }, testInfo) => {
    const harness = await openPrintPanel(page, context, surface)

    // The real engine's contract that the execCommand stub stands in for.
    expect(await page.evaluate(() => (window as Window & { __e2eExecPrintSupported?: boolean | null }).__e2eExecPrintSupported), 'this engine supports execCommand("print"), so it returns true').toBe(true)

    // --- 'driver-forms', the default ------------------------------------------
    await expect(modeCard(page, EN.print_page_size_mode_driver_forms)).toHaveClass(/\bborder-blue-600\b/)
    const driverForms = await printOnce(page, testInfo, surface, 'driver-forms', 0, tapTestPrint(page))
    const rules = pageRules(driverForms.call.html)
    expect(rules.length, 'the printed document carries an @page rule').toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule, 'no @page rule declares a size').not.toMatch(/(^|;|\s)size\s*:/)
      expect(rule, 'the @page margin is 0').toMatch(/(^|;|\s)margin\s*:\s*0(mm|px)?\s*(;|$)/)
    }
    // With the card on, the roll's test print is the full receipt, not the card.
    expect(await receiptCopies(page, driverForms.call.html), 'exactly one receipt copy, the full receipt').toMatchObject({ frames: 1, roots: 1, renditions: ['full'] })
    expect(driverForms.geometry.printMedia, 'print media is emulated on the printing document').toBe(true)
    expect(driverForms.geometry.receiptFrames).toBe(1)
    expect(driverForms.geometry.receiptRoots).toBe(1)
    expect(driverForms.geometry.frameWidthMm, 'the receipt prints at the 72 mm paper width').toBeGreaterThanOrEqual(71.5)
    expect(driverForms.geometry.frameWidthMm).toBeLessThanOrEqual(72.5)
    expect(driverForms.geometry.firstText, 'a visible first line was found').not.toBe('')
    expect(driverForms.geometry.firstTextTopMm, `driver-forms first text top (${driverForms.geometry.firstText})`).toBeLessThanOrEqual(1.5)
    expectPrintedWhole(driverForms.call, driverForms.geometry, 'driver-forms')
    if (surface === 'preview window') await (driverForms.target as Page).close()

    // --- positive control: 'measured' keeps the configured 4 mm top margin ------
    await modeCard(page, EN.print_page_size_mode_measured).click()
    await expect(modeCard(page, EN.print_page_size_mode_measured)).toHaveClass(/\bborder-blue-600\b/)
    await expect(rollHint(page), 'Measured shows the roll-paper hint').toBeVisible()
    await expect(widthField(page), 'Measured hides the width field').toHaveCount(0)
    const measured = await printOnce(page, testInfo, surface, 'measured', 1, tapTestPrint(page))
    expect(pageRules(measured.call.html).some((rule) => /(^|;|\s)size\s*:/.test(rule)), 'the @page size check can see a size (Measured declares one)').toBe(true)
    expect(await receiptCopies(page, measured.call.html)).toMatchObject({ frames: 1, roots: 1, renditions: ['full'] })
    expect(measured.geometry.printMedia).toBe(true)
    expect(measured.geometry.firstTextTopMm, `measured first text top (${measured.geometry.firstText})`).toBeGreaterThanOrEqual(3.5)

    expectHealthy(harness)
  })

  test(`a sale's Print -> 80 x 50 mm prints the card from the top of the 72 mm printer paper through the ${surface}`, async ({ page, context }, testInfo) => {
    const harness = await openAdmin(page, context, surface, '/sales')
    const printMenu = await openSaleReceipt(page)
    const renditions = await saleRenditions(page)

    const card = await printOnce(page, testInfo, surface, 'card', 0, printMenuItem(page, printMenu, '80 × 50 mm'))
    expect(await printedRendition(page, card.call.html, renditions), 'the copy printed is the card').toBe('card')
    expect(card.geometry.printMedia).toBe(true)
    expect(card.geometry.frameWidthMm, 'the card prints at the 72 mm paper width').toBeGreaterThanOrEqual(71.5)
    expect(card.geometry.frameWidthMm).toBeLessThanOrEqual(72.5)
    expect(card.geometry.firstTextTopMm, `card first text top (${card.geometry.firstText})`).toBeLessThanOrEqual(1.5)
    expectPrintedWhole(card.call, card.geometry, 'card')

    expectHealthy(harness)
  })

  test(`a sale's Print -> All prints the card and then the full receipt, once each, through the ${surface}`, async ({ page, context }, testInfo) => {
    const harness = await openAdmin(page, context, surface, '/sales')
    const printMenu = await openSaleReceipt(page)
    const renditions = await saleRenditions(page)

    const calls = await tapAndCollect(page, testInfo, `all-${surface.replace(' ', '-')}`, 0, 2, printMenuItem(page, printMenu, EN.all))
    const expectedVia = surface === 'preview window' ? 'print' : 'execCommand'
    expect(calls.map((call) => call.via), `both print through the ${surface}`).toEqual([expectedVia, expectedVia])
    expect(await printedRendition(page, calls[0].html, renditions), 'first the card').toBe('card')
    expect(await printedRendition(page, calls[1].html, renditions), 'then the full receipt').toBe('full')
    for (const [index, call] of calls.entries()) {
      for (const rule of pageRules(call.html)) expect(rule, 'no @page rule declares a size').not.toMatch(/(^|;|\s)size\s*:/)
      expectPrintedWhole(call, null, index === 0 ? 'card' : 'full receipt')
    }
    // The document still open is the full receipt's (the card's was replaced or closed).
    const full = surface === 'preview window' ? context.pages().at(-1)! : await printFrame(page)
    const geometry = await geometryOf(surface === 'preview window' ? (full as Page) : page, full)
    expect(geometry.receiptRoots).toBe(1)
    expect(geometry.frameWidthMm, 'the full receipt prints at the 72 mm paper width').toBeGreaterThanOrEqual(71.5)
    expect(geometry.frameWidthMm).toBeLessThanOrEqual(72.5)
    expect(geometry.firstTextTopMm, `full receipt first text top (${geometry.firstText})`).toBeLessThanOrEqual(1.5)
    expectPrintedWhole(calls[1], geometry, 'full receipt')

    expectHealthy(harness)
  })
}
