/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-product-categories-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'product-categories-actions.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}




async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`)
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages = []
    const observedRequests = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(products|categories|units|branches|action-history)/i.test(url)) {
        observedRequests.push({ status: response.status(), url })
      }
    })

    const productsRead = waitForRead(page, observedRequests, /\/api\/products\/search/i, 'Products search read')
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const productsStatus = await productsRead

    const categoriesRead = waitForRead(page, observedRequests, /\/api\/categories(?:\?|$)/i, 'Categories read')
    const lookupUsageRead = waitForRead(page, observedRequests, /\/api\/products\/lookups\/usage/i, 'Product lookup usage read')
    await page.getByRole('button', { name: /^Manage$/i }).first().click()
    await page.getByRole('button', { name: /^Categories$/i }).click()
    const modal = page.locator('.fixed.inset-0').last()
    await modal.getByRole('heading', { name: /Manage Categories/i }).waitFor({ state: 'visible', timeout: 20_000 })
    const categoriesStatus = await categoriesRead
    const lookupUsageStatus = await lookupUsageRead

    await modal.locator('#new-category-name').waitFor({ state: 'visible', timeout: 15_000 })
    await modal.locator('#new-category-color').waitFor({ state: 'visible', timeout: 15_000 })
    const addButtonVisible = await modal.getByRole('button', { name: /^Add$/i }).isVisible()
    assert(addButtonVisible, 'Category add button did not render')
    const categoryRows = await modal.locator('input[type="checkbox"]').count()
    assert(categoryRows > 0, 'Category modal did not render selectable rows or select-visible control')
    const deleteSelectedButtonVisible = await modal.getByRole('button', { name: /Delete selected/i }).isVisible()
    assert(deleteSelectedButtonVisible, 'Delete selected category button did not render')
    const editButtons = await modal.getByRole('button', { name: /^Edit$/i }).count()
    const deleteButtons = await modal.getByRole('button', { name: /^Delete$/i }).count()
    assert(editButtons + deleteButtons > 0, 'Category row edit/delete controls did not render')

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    const report = {
      baseUrl: BASE_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      checks: {
        productsPageVisible: true,
        productsStatus,
        categoriesStatus,
        lookupUsageStatus,
        categoriesModalOpened: true,
        addButtonVisible,
        categoryRows,
        deleteSelectedButtonVisible,
        editButtons,
        deleteButtons,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        productCategories: SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
