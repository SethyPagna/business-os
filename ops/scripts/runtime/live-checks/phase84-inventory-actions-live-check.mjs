/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, closeTopModal, attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-inventory-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'inventory-actions.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}





async function openFirstProductDetail(page) {
  const firstRow = page.locator('tbody tr.table-row').first()
  await firstRow.waitFor({ state: 'visible', timeout: 20_000 })
  await firstRow.click()
  const detailModal = page.locator('.fixed.inset-0').last()
  await detailModal.getByRole('button', { name: /Adjust Stock/i }).waitFor({ state: 'visible', timeout: 15_000 })
  return detailModal
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
      if (/\/api\/(inventory|branches|action-history)/i.test(url)) observedRequests.push({ status: response.status(), url })
    })

    const inventoryProductsRead = waitForRead(page, observedRequests, /\/api\/inventory\/products\/search/i, 'Inventory products read')
    const branchesRead = waitForRead(page, observedRequests, /\/api\/branches(?:\?|$)/i, 'Inventory branch options read')
    await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Inventory', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const inventoryProductsStatus = await inventoryProductsRead
    const branchesStatus = await branchesRead

    const rowCount = await page.locator('tbody tr.table-row').count()
    assert(rowCount > 0, 'No inventory product rows were rendered')

    const reasonsRead = waitForRead(page, observedRequests, /\/api\/inventory\/reasons/i, 'Inventory reasons read')
    await page.getByRole('button', { name: /^Adjust$/i }).first().click()
    const adjustModal = page.locator('.fixed.inset-0').last()
    await adjustModal.locator('#inventory-adjust-quantity').waitFor({ state: 'visible', timeout: 15_000 })
    const adjustSaveEnabled = !(await adjustModal.locator('button.btn-primary').first().isDisabled())
    assert(adjustSaveEnabled, 'Adjust save button should be enabled for the default valid draft')
    const inventoryReasonsStatus = await reasonsRead
    await closeTopModal(page)

    const transferDetailModal = await openFirstProductDetail(page)
    await transferDetailModal.getByRole('button', { name: /^Transfer$/i }).click()
    const transferModal = page.locator('.fixed.inset-0').last()
    await transferModal.getByText(/Source branch/i).waitFor({ state: 'visible', timeout: 15_000 })
    await transferModal.getByText(/Destination branch/i).waitFor({ state: 'visible', timeout: 15_000 })
    const transferButtonVisible = await transferModal.getByRole('button', { name: /^Transfer$/i }).isVisible()
    assert(transferButtonVisible, 'Inventory transfer submit button did not render')
    await closeTopModal(page)

    const moveDetailModal = await openFirstProductDetail(page)
    await moveDetailModal.getByRole('button', { name: /Move Stock/i }).click()
    const moveModal = page.locator('.fixed.inset-0').last()
    await moveModal.getByText('Destination product row', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    await moveModal.getByRole('button', { name: /Quick-create row/i }).click()
    await moveModal.getByText(/Selling Price \(USD\)/i).waitFor({ state: 'visible', timeout: 15_000 })
    const moveButtonVisible = await moveModal.getByRole('button', { name: /Move stock/i }).last().isVisible()
    assert(moveButtonVisible, 'Inventory move submit button did not render')
    await closeTopModal(page)

    await page.locator('tbody tr.table-row input[type="checkbox"]').first().check()
    await page.getByRole('button', { name: /^Batch$/i }).click()
    const batchModal = page.locator('.fixed.inset-0').last()
    await batchModal.getByText(/Batch session/i).waitFor({ state: 'visible', timeout: 15_000 })
    await batchModal.getByRole('button', { name: /Apply changes/i }).waitFor({ state: 'visible', timeout: 15_000 })
    await batchModal.locator('select').first().selectOption('transfer')
    await batchModal.getByText(/Source branch/i).waitFor({ state: 'visible', timeout: 15_000 })
    await batchModal.locator('select').first().selectOption('move')
    await batchModal.getByText(/Destination row/i).waitFor({ state: 'visible', timeout: 15_000 })
    await closeTopModal(page)

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
        inventoryPageVisible: true,
        inventoryProductsStatus,
        branchesStatus,
        inventoryReasonsStatus,
        productRows: rowCount,
        adjustModalOpened: true,
        adjustSaveEnabled,
        transferModalOpened: true,
        transferButtonVisible,
        moveModalOpened: true,
        moveButtonVisible,
        batchModalOpened: true,
        batchTransferControlsVisible: true,
        batchMoveControlsVisible: true,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        inventory: SCREENSHOT_PATH,
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
