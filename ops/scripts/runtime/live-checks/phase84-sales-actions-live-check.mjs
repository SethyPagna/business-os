/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, attachConsoleCollector } from './live-check-utils.mjs'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-sales-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'sales-actions.png')

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
      if (/\/api\/(sales|action-history)/i.test(url)) observedRequests.push({ status: response.status(), url })
    })

    const salesRead = waitForRead(page, observedRequests, /\/api\/sales/i, 'Sales read')
    await page.goto('/sales', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Sales', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const salesStatus = await salesRead

    const candidate = await page.evaluate(async () => {
      const rows = await window.api.getSales({ limit: 100 })
      const sales = Array.isArray(rows) ? rows : []
      const sale = sales.find((item) => !['returned', 'cancelled'].includes(String(item?.sale_status || 'completed')))
        || sales[0]
      return sale ? {
        id: Number(sale.id || 0),
        receipt: String(sale.receipt_number || ''),
        status: String(sale.sale_status || 'completed'),
      } : null
    })
    assert(candidate?.id && candidate?.receipt, 'No sale row was available for the Sales action UI check')

    await page.locator('#sales-search').fill(candidate.receipt)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.locator('tbody tr.table-row').first().waitFor({ state: 'visible', timeout: 20_000 })

    await page.locator('tbody tr.table-row input[type="checkbox"]').first().check()
    await page.getByRole('button', { name: /^Done$/i }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: /^Delivery$/i }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: /^Cancel$/i }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: /^Clear$/i }).click()

    await page.locator('tbody tr.table-row').first().click()
    await page.locator('#sale-membership-attach').waitFor({ state: 'visible', timeout: 20_000 })
    const statusControlVisible = !['returned', 'cancelled'].includes(candidate.status)
      ? await page.locator('#sale-status-select').isVisible()
      : true
    assert(statusControlVisible, 'Sale status control did not render for an editable sale')

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
        salesPageVisible: true,
        salesStatus,
        selectedSaleId: candidate.id,
        bulkStatusButtonsVisible: true,
        detailMembershipControlVisible: true,
        detailStatusControlVisible: statusControlVisible,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        sales: SCREENSHOT_PATH,
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
