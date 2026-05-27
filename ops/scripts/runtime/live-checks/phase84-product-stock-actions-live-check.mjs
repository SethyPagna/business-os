/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.mjs'
import { readJson, isIgnoredConsole, waitForRead, closeTopModal, attachConsoleCollector } from './live-check-utils.mjs'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-product-stock-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'product-stock-actions.png')

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
      if (/\/api\/(products|branches|categories|units|action-history)/i.test(url)) observedRequests.push({ status: response.status(), url })
    })

    const productsRead = waitForRead(page, observedRequests, /\/api\/products\/search/i, 'Products search read')
    const branchesRead = waitForRead(page, observedRequests, /\/api\/branches(?:\?|$)/i, 'Product branch options read')
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const productsStatus = await productsRead
    const branchesStatus = await branchesRead

    const firstRow = page.locator('tbody tr.table-row').first()
    await firstRow.waitFor({ state: 'visible', timeout: 20_000 })
    const rowCount = await page.locator('tbody tr.table-row').count()
    assert(rowCount > 0, 'No product rows were rendered')

    await page.locator('table thead input[type="checkbox"]').first().click()
    const stockBulkButton = page.getByRole('button', { name: /^Stock$/i })
    await stockBulkButton.waitFor({ state: 'visible', timeout: 10_000 })
    await stockBulkButton.click()
    await page.getByText(/Adjust stock for/i).waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByRole('button', { name: /Apply to \d+ products/i }).click()
    const bulkStockModal = page.locator('.fixed.inset-0').last()
    await bulkStockModal.getByText(/Add Stock to/i).waitFor({ state: 'visible', timeout: 15_000 })
    await bulkStockModal.getByText(/Quantity to Add/i).waitFor({ state: 'visible', timeout: 15_000 })
    const bulkAddButtonVisible = await bulkStockModal.getByRole('button', { name: /\+ .*Add/i }).isVisible()
    assert(bulkAddButtonVisible, 'Bulk add stock submit button did not render')
    await closeTopModal(page)

    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.locator('tbody tr.table-row').first().waitFor({ state: 'visible', timeout: 20_000 })
    await firstRow.click()
    const detailModal = page.locator('.fixed.inset-0').last()
    await detailModal.getByRole('button', { name: /^Adjust stock$/i }).click()
    const formModal = page.locator('.fixed.inset-0').last()
    await formModal.getByText(/Stock by Branch/i).waitFor({ state: 'visible', timeout: 15_000 })
    const branchRows = await formModal.locator('input[type="number"]').count()
    assert(branchRows > 0, 'Branch stock adjuster did not render quantity inputs')
    const applyBranchStockVisible = await formModal.getByRole('button', { name: /Save/i }).isVisible()
    assert(applyBranchStockVisible, 'Product form save button did not render after stock tab opened')

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
        branchesStatus,
        productRows: rowCount,
        bulkStockModalOpened: true,
        bulkAddButtonVisible,
        branchStockAdjusterOpened: true,
        branchStockInputs: branchRows,
        formSaveVisible: applyBranchStockVisible,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        products: SCREENSHOT_PATH,
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
