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
const AUDIT_SCREENSHOT_PATH = path.join(REPORT_DIR, 'audit-filter-menu.png')
const LIBRARY_SELECT_SCREENSHOT_PATH = path.join(REPORT_DIR, 'library-select-menu.png')
const DASHBOARD_SELECT_SCREENSHOT_PATH = path.join(REPORT_DIR, 'dashboard-select-menu.png')
const POS_FILTER_SCREENSHOT_PATH = path.join(REPORT_DIR, 'pos-filter-panel.png')

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
  brandLabel: string | null
  hasBackLabel: boolean
  sectionLabels: string[]
  minSectionRadius: number
}

type SelectMenuCheck = {
  page: string
  label: string
  menuRadius: number
  minOptionRadius: number
  optionCount: number
}

type PosFilterPanelCheck = {
  page: string
  hasPanel: boolean
  rowCount: number
  minChipRadius: number
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

async function readFilterMenu(page: Page, pageName: string, screenshotPath: string, requireBrand = false): Promise<FilterMenuCheck> {
  const brandLabelLocator = page.locator('[data-filter-menu-section-label="brand"]').first()
  const sectionLabels = (await page.locator('[data-filter-menu-section-label]').allInnerTexts())
    .map((label) => label.trim())
    .filter(Boolean)
  if (requireBrand) await brandLabelLocator.waitFor({ state: 'visible', timeout: 10_000 })
  const brandLabel = await brandLabelLocator.count()
    ? (await brandLabelLocator.innerText()).trim()
    : null
  const sectionRadii = await page.locator('[data-filter-menu-section]').evaluateAll((nodes) => nodes.map((node) => {
    const value = window.getComputedStyle(node).borderRadius
    return Number.parseFloat(value || '0') || 0
  }))
  await page.screenshot({ path: screenshotPath, fullPage: false })
  return {
    page: pageName,
    readStatus: 200,
    brandLabel,
    hasBackLabel: sectionLabels.some((label) => /\bBack\b/i.test(label)),
    sectionLabels,
    minSectionRadius: Math.min(...sectionRadii),
  }
}

async function openSharedSelect(page: Page, selector: string, pageName: string, label: string, screenshotPath: string): Promise<SelectMenuCheck> {
  const trigger = page.locator(selector).first()
  await trigger.waitFor({ state: 'visible', timeout: 20_000 })
  await trigger.click()
  const menu = page.locator('[data-app-select-menu]').last()
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  const metrics = await menu.evaluate((node) => {
    const menuRadius = Number.parseFloat(window.getComputedStyle(node).borderRadius || '0') || 0
    const options = Array.from(node.querySelectorAll('[data-app-select-option]'))
    const optionRadii = options.map((option) => Number.parseFloat(window.getComputedStyle(option).borderRadius || '0') || 0)
    return {
      menuRadius,
      minOptionRadius: optionRadii.length ? Math.min(...optionRadii) : 0,
      optionCount: options.length,
    }
  })
  await page.screenshot({ path: screenshotPath, fullPage: false })
  await page.keyboard.press('Escape')
  return { page: pageName, label, ...metrics }
}

async function openDashboardCustomRange(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-bos-active-page="true"][data-bos-page-slot="dashboard"]')
    return Boolean(root && (root.textContent || '').match(/Range|Today|This Month|Custom/i))
  }, null, { timeout: 20_000 })
  const changed = await page.evaluate(() => {
    const root = document.querySelector('[data-bos-active-page="true"][data-bos-page-slot="dashboard"]') || document
    const buttons = Array.from(root.querySelectorAll('button'))
    const customButton = buttons.find((button) => (button.textContent || '').trim().toLowerCase() === 'custom')
    customButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return Boolean(customButton)
  })
  assert(changed, 'Dashboard Custom range button was not found')
  await page.locator('#dashboard-custom-start-date').waitFor({ state: 'visible', timeout: 10_000 })
}

async function readPosFilterPanel(page: Page): Promise<PosFilterPanelCheck> {
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-bos-active-page="true"][data-bos-page-slot="pos"]')
    return Boolean(root && (root.textContent || '').match(/Cart|Filters|Point of Sale/i))
  }, null, { timeout: 20_000 })
  const filterButton = page.getByRole('button', { name: /Filters/i }).first()
  await filterButton.waitFor({ state: 'visible', timeout: 20_000 })
  await filterButton.click()
  await page.getByText(/Stock Status/i).first().waitFor({ state: 'visible', timeout: 10_000 })
  const rowLocator = page.locator('[data-pos-filter-section]')
  const chipLocator = page.locator('[data-pos-filter-chip]')
  const rowCount = await rowLocator.count()
  const chipRadii = await chipLocator.evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(window.getComputedStyle(node).borderRadius || '0') || 0))
  await page.screenshot({ path: POS_FILTER_SCREENSHOT_PATH, fullPage: false })
  return {
    page: 'pos',
    hasPanel: rowCount > 0,
    rowCount,
    minChipRadius: chipRadii.length ? Math.min(...chipRadii) : 0,
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
    const productCheck = await readFilterMenu(page, 'products', PRODUCT_SCREENSHOT_PATH, true)
    productCheck.readStatus = productsStatus
    await page.keyboard.press('Escape')
    const productsPageSizeCheck = await openSharedSelect(page, 'button[aria-label*="per page"]', 'products', 'page size', path.join(REPORT_DIR, 'products-page-size-select.png'))

    await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Inventory', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const inventoryStatus = latestObservedStatus(observedRequests, /\/api\/inventory\/stats/i) || 200
    await openFilters(page)
    const inventoryCheck = await readFilterMenu(page, 'inventory', INVENTORY_SCREENSHOT_PATH, true)
    inventoryCheck.readStatus = inventoryStatus
    await page.keyboard.press('Escape')

    await page.goto('/audit-log', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Audit Log', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await openFilters(page)
    const auditCheck = await readFilterMenu(page, 'audit-log', AUDIT_SCREENSHOT_PATH)
    auditCheck.readStatus = latestObservedStatus(observedRequests, /\/api\/system\/audit-logs/i) || 200
    await page.keyboard.press('Escape')

    await page.goto('/files', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Library', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const librarySelectCheck = await openSharedSelect(page, '#library-media-type', 'library', 'media type', LIBRARY_SELECT_SCREENSHOT_PATH)

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Dashboard', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await openDashboardCustomRange(page)
    const dashboardSelectCheck = await openSharedSelect(page, '#dashboard-granularity', 'dashboard', 'granularity', DASHBOARD_SELECT_SCREENSHOT_PATH)

    await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    const posFilterPanelCheck = await readPosFilterPanel(page)

    for (const check of [productCheck, inventoryCheck, auditCheck]) {
      if (check.brandLabel != null) assert(check.brandLabel.toLowerCase() !== 'back', `${check.page} brand filter rendered as Back`)
      assert(!check.hasBackLabel, `${check.page} filter menu still contains a visible Back label`)
      assert(check.minSectionRadius >= 14, `${check.page} filter sections are not rounded enough (${check.minSectionRadius}px)`)
    }
    for (const check of [productsPageSizeCheck, librarySelectCheck, dashboardSelectCheck]) {
      assert(check.menuRadius >= 14, `${check.page} ${check.label} select menu is not rounded enough (${check.menuRadius}px)`)
      assert(check.minOptionRadius >= 10, `${check.page} ${check.label} select options are not rounded enough (${check.minOptionRadius}px)`)
      assert(check.optionCount >= 2, `${check.page} ${check.label} select rendered too few options`)
    }
    assert(posFilterPanelCheck.hasPanel, 'POS filter panel did not render compact filter rows')
    assert(posFilterPanelCheck.rowCount >= 2, `POS filter panel rendered too few compact rows (${posFilterPanelCheck.rowCount})`)
    assert(posFilterPanelCheck.minChipRadius >= 12, `POS filter chips are not rounded enough (${posFilterPanelCheck.minChipRadius}px)`)

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
        auditCheck,
        selectChecks: [productsPageSizeCheck, librarySelectCheck, dashboardSelectCheck],
        posFilterPanelCheck,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        products: PRODUCT_SCREENSHOT_PATH,
        inventory: INVENTORY_SCREENSHOT_PATH,
        audit: AUDIT_SCREENSHOT_PATH,
        librarySelect: LIBRARY_SELECT_SCREENSHOT_PATH,
        dashboardSelect: DASHBOARD_SELECT_SCREENSHOT_PATH,
        posFilterPanel: POS_FILTER_SCREENSHOT_PATH,
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
