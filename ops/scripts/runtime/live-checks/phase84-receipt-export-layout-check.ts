/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-receipt-export-layout-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/phase84-receipt-export-layout-check-latest.json')

type ConsoleEntry = { type: string; text: string }
type ReceiptOverflowResult = {
  rootWidth: number
  rootScrollWidth: number
  overflowingLines: Array<{ text: string; width: number; scrollWidth: number }>
  overflowingChildren: Array<{ tag: string; className: string; text: string; width: number; scrollWidth: number }>
}
type Report = {
  generatedAt: string
  baseUrl: string
  ok: boolean
  consoleMessages: ConsoleEntry[]
  screenshots: string[]
  downloads: Array<{ fileName: string; path: string; width: number; height: number }>
  checks: Record<string, unknown>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitForAppSettled(page: Page): Promise<void> {
  await hydratePlaywrightPage(page)
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(450)
}

async function getReceiptOverflow(page: Page): Promise<ReceiptOverflowResult> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-receipt-export-root="true"]') as HTMLElement | null
    if (!root) throw new Error('Receipt export root was not rendered')
    const rootRect = root.getBoundingClientRect()
    const overflowingLines = Array.from(root.querySelectorAll('[data-receipt-line="true"]'))
      .map((node) => {
        const element = node as HTMLElement
        const rect = element.getBoundingClientRect()
        return {
          text: String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          width: Math.ceil(rect.width),
          scrollWidth: Math.ceil(element.scrollWidth),
        }
      })
      .filter((entry) => entry.scrollWidth > entry.width + 3)
    const overflowingChildren = Array.from(root.querySelectorAll('*'))
      .map((node) => {
        const element = node as HTMLElement
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || '').slice(0, 100),
          text: String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          width: Math.ceil(rect.width),
          scrollWidth: Math.ceil(element.scrollWidth),
        }
      })
      .filter((entry) => entry.scrollWidth > entry.width + 3)
      .slice(0, 8)
    return {
      rootWidth: Math.ceil(rootRect.width),
      rootScrollWidth: Math.ceil(root.scrollWidth),
      overflowingLines,
      overflowingChildren,
    }
  })
}

async function assertReceiptNotOverflowing(page: Page, label: string): Promise<ReceiptOverflowResult> {
  const result = await getReceiptOverflow(page)
  assert(result.rootScrollWidth <= result.rootWidth + 3, `${label} receipt root overflows: ${result.rootScrollWidth}px > ${result.rootWidth}px; children=${JSON.stringify(result.overflowingChildren)}`)
  assert(result.overflowingLines.length === 0, `${label} receipt lines overflow: ${JSON.stringify(result.overflowingLines.slice(0, 5))}`)
  assert(result.overflowingChildren.length === 0, `${label} receipt children overflow: ${JSON.stringify(result.overflowingChildren.slice(0, 5))}`)
  return result
}

async function screenshot(page: Page, name: string, report: Report, fullPage = false): Promise<string> {
  const target = path.join(REPORT_DIR, name)
  await page.screenshot({ path: target, fullPage })
  report.screenshots.push(target)
  return target
}

async function openReceiptPrintPreview(page: Page, report: Report): Promise<Page> {
  const popupPromise = page.waitForEvent('popup', { timeout: 15_000 })
  await page.getByRole('button', { name: /^Print$/i }).click({ timeout: 10_000 })
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded', { timeout: 15_000 })
  await popup.getByRole('button', { name: /Print \/ Save PDF/i }).waitFor({ state: 'visible', timeout: 15_000 })
  await popup.getByText(/Leang Cosmetic|Business OS/i).first().waitFor({ state: 'visible', timeout: 15_000 })
  await assertReceiptNotOverflowing(popup, 'print preview popup')
  await screenshot(popup, 'sales-reprint-print-preview.png', report, true)
  return popup
}

async function downloadReceiptImage(page: Page, report: Report): Promise<void> {
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await page.getByRole('button', { name: /^Image$/i }).click({ timeout: 10_000 })
  const download = await downloadPromise
  const target = path.join(REPORT_DIR, download.suggestedFilename())
  await download.saveAs(target)

  const imagePage = await page.context().newPage()
  await imagePage.goto(pathToFileURL(target).toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 })
  const size = await imagePage.locator('img').evaluate((img) => ({
    width: (img as HTMLImageElement).naturalWidth,
    height: (img as HTMLImageElement).naturalHeight,
  }))
  assert(size.width >= 240 && size.width <= 1200, `Downloaded receipt image has unexpected width ${size.width}px`)
  assert(size.height >= 240, `Downloaded receipt image is too short: ${size.height}px`)
  assert(size.height > size.width * 0.75, `Downloaded receipt image ratio looks collapsed: ${size.width}x${size.height}`)
  await screenshot(imagePage, 'sales-reprint-image-download.png', report, true)
  await imagePage.close()
  report.downloads.push({ fileName: download.suggestedFilename(), path: target, width: size.width, height: size.height })
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    ok: false,
    consoleMessages: [],
    screenshots: [],
    downloads: [],
    checks: {},
  }

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 }, acceptDownloads: true })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    attachConsoleCollector(page, report.consoleMessages, {
      ignoreConsole: (message) => /favicon\.ico|ResizeObserver loop|print\(\)|Blocked aria-hidden/i.test(String(message || '')),
    })

    await page.goto('/receipt-settings', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await waitForAppSettled(page)
    await page.getByText('Receipt Settings', { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: /Both/i }).first().click({ timeout: 10_000 })
    await page.getByText(/Name/i).first().waitFor({ state: 'visible', timeout: 10_000 })
    report.checks.receiptSettingsPreview = await assertReceiptNotOverflowing(page, 'receipt settings preview')
    await screenshot(page, 'receipt-settings-preview.png', report)

    await page.goto('/sales', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await waitForAppSettled(page)
    await page.getByText('Sales', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const reprintButtons = page.getByRole('button', { name: /reprint/i }).filter({ visible: true })
    assert(await reprintButtons.count() > 0, 'No visible Reprint button was rendered on Sales')
    await reprintButtons.first().click({ timeout: 10_000 })
    await page.getByText(/Receipt RCP|Receipt PRE|Receipt #/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText(/Name/i).first().waitFor({ state: 'visible', timeout: 10_000 })
    report.checks.salesReceiptModal = await assertReceiptNotOverflowing(page, 'sales receipt modal')
    await screenshot(page, 'sales-reprint-modal.png', report)

    const printPopup = await openReceiptPrintPreview(page, report)
    await printPopup.close().catch(() => {})
    await downloadReceiptImage(page, report)

    assert(report.consoleMessages.length === 0, `Console issues found: ${JSON.stringify(report.consoleMessages)}`)
    report.ok = true
  } finally {
    await browser.close().catch(() => {})
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(LATEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    screenshots: report.screenshots,
    downloads: report.downloads,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
