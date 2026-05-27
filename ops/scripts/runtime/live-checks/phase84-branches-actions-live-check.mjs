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
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-branches-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'branches-actions.png')

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
      if (/\/api\/(branches|transfers|action-history)/i.test(url)) observedRequests.push({ status: response.status(), url })
    })

    const branchesRead = waitForRead(page, observedRequests, /\/api\/branches(?:\?|$)/i, 'Branches read')
    await page.goto('/branches', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await Promise.race([
      page.getByText('Branches', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 }),
      page.getByText('Branch', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 }),
      page.locator('input[id^="branch-select-"]').first().waitFor({ state: 'visible', timeout: 20_000 }),
    ])
    const branchesStatus = await branchesRead

    const branchCount = await page.locator('input[id^="branch-select-"]').count()
    assert(branchCount > 0, 'No branch rows were rendered')

    await page.getByRole('button', { name: /Add Branch/i }).click()
    await page.locator('#branch-name').waitFor({ state: 'visible', timeout: 15_000 })
    await closeTopModal(page)

    await page.getByRole('button', { name: /^Edit$/i }).first().click()
    await page.locator('#branch-name').waitFor({ state: 'visible', timeout: 15_000 })
    await closeTopModal(page)

    await page.locator('input[id^="branch-select-"]').first().check()
    await page.getByRole('button', { name: /Delete \(/i }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('input[id^="branch-select-"]').first().uncheck()

    await page.getByRole('button', { name: /^Transfer$/i }).first().click()
    await page.locator('#transfer-from-branch').waitFor({ state: 'visible', timeout: 15_000 })
    const sourceBranch = await page.locator('#transfer-from-branch').evaluate((select) => (
      Array.from(select.options).find((option) => option.value)?.value || ''
    ))
    assert(sourceBranch, 'No transfer source branch option was available')
    const branchStockRead = waitForRead(page, observedRequests, new RegExp(`/api/branches/${sourceBranch}/stock`, 'i'), 'Transfer source stock read')
    await page.locator('#transfer-from-branch').selectOption(sourceBranch)
    const branchStockStatus = await branchStockRead
    await page.locator('#transfer-product-search').waitFor({ state: 'visible', timeout: 15_000 })
    const transferModal = page.locator('.fixed.inset-0').last()
    const transferButtonDisabled = await transferModal.locator('button.btn-primary').first().isDisabled()
    assert(transferButtonDisabled, 'Transfer submit should stay disabled until a product and quantity are selected')

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
        branchesPageVisible: true,
        branchesStatus,
        branchRows: branchCount,
        addBranchModalOpened: true,
        editBranchModalOpened: true,
        bulkDeleteButtonVisible: true,
        transferModalOpened: true,
        branchStockStatus,
        transferButtonDisabled,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        branches: SCREENSHOT_PATH,
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
