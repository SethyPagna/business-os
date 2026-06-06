/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Locator, Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector, isIgnoredConsole, latestObservedStatus, readJson, waitForRead } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-filter-menu-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const PRODUCT_SCREENSHOT_PATH = path.join(REPORT_DIR, 'products-filter-menu.png')
const INVENTORY_SCREENSHOT_PATH = path.join(REPORT_DIR, 'inventory-filter-menu.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { method: string; status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}

type FilterMenuCheck = {
  page: string
  readStatus: number
  brandLabel: string
  hasBackLabel: boolean
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function openFilters(page: Page): Promise<Locator> {
  const filterButton = page.getByRole('button', { name: /Filters/i }).first()
  await filterButton.waitFor({ state: 'visible', timeout: 20_000 })
  await filterButton.click()
  const menu = page.locator('[data-filter-menu-section]').first()
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  return page.locator('[data-filter-menu-section]').first().locator('..')
}

async function readFilterMenu(page: Page, pageName: string, screenshotPath: string): Promise<FilterMenuCheck> {
  const brandLabelLocator = page.locator('[data-filter-menu-section-label="brand"]').first()
  await brandLabelLocator.waitFor({ state: 'visible', timeout: 10_000 })
  const brandLabel = (await brandLabelLocator.innerText()).trim()
  const menuText = (await page.locator('body').innerText()).trim()
  await page.screenshot({ path: screenshotPath, fullPage: false })
  return {
    page: pageName,
    readStatus: 200,
    brandLabel,
    hasBackLabel: /\bBack\b/i.test(menuText),
  }
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const observedRequests: ObservedRequest[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(products|inventory|branches|categories|units|action-history)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    const productRead = waitForRead(page, observedRequests, /\/api\/products\/search/i, 'Products search read')
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const productsStatus = await productRead
    await openFilters(page)
    const productCheck = await readFilterMenu(page, 'products', PRODUCT_SCREENSHOT_PATH)
    productCheck.readStatus = productsStatus
    await page.keyboard.press('Escape')

    await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Inventory', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const inventoryStatus = latestObservedStatus(observedRequests, /\/api\/inventory\/stats/i) || 200
    await openFilters(page)
    const inventoryCheck = await readFilterMenu(page, 'inventory', INVENTORY_SCREENSHOT_PATH)
    inventoryCheck.readStatus = inventoryStatus

    for (const check of [productCheck, inventoryCheck]) {
      assert(check.brandLabel.toLowerCase() !== 'back', `${check.page} brand filter rendered as Back`)
      assert(!check.hasBackLabel, `${check.page} filter menu still contains a visible Back label`)
    }

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    const report = {
      baseUrl: BASE_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      checks: {
        productCheck,
        inventoryCheck,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        products: PRODUCT_SCREENSHOT_PATH,
        inventory: INVENTORY_SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
