/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, closeTopModal, attachConsoleCollector } from './live-check-utils.mjs'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-contacts-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'contacts-delivery-tab.png')

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
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1366, height: 900 },
      acceptDownloads: true,
    })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages = []
    const observedRequests = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(customers|suppliers|delivery-contacts|action-history)/i.test(url)) {
        observedRequests.push({ status: response.status(), url })
      }
    })

    const customerRead = waitForRead(page, observedRequests, /\/api\/customers/i, 'Customers read')
    await page.goto('/contacts', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Contacts', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('#customer-search').waitFor({ state: 'visible', timeout: 20_000 })
    const customersStatus = await customerRead

    await page.locator('.btn-primary').filter({ visible: true }).last().click()
    await page.getByText(/Add Customer/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    await closeTopModal(page)

    const suppliersRead = waitForRead(page, observedRequests, /\/api\/suppliers/i, 'Suppliers read')
    await page.getByRole('button', { name: /^Suppliers$/i }).click()
    await page.locator('#supplier-search').waitFor({ state: 'visible', timeout: 20_000 })
    const suppliersStatus = await suppliersRead
    await page.locator('.btn-primary').filter({ visible: true }).last().click()
    await page.getByText(/Add Supplier/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    await closeTopModal(page)

    const deliveryRead = waitForRead(page, observedRequests, /\/api\/delivery-contacts/i, 'Delivery contacts read')
    await page.getByRole('button', { name: /^Delivery$/i }).click()
    await page.locator('#delivery-search').waitFor({ state: 'visible', timeout: 20_000 })
    const deliveryStatus = await deliveryRead
    await page.locator('.btn-primary').filter({ visible: true }).last().click()
    await page.getByText(/Add Delivery Contact/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    await closeTopModal(page)

    await page.getByRole('button', { name: /^Imports$/i }).click()
    await page.getByText(/Import All Contacts/i).first().waitFor({ state: 'visible', timeout: 15_000 })
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
        contactsPageVisible: true,
        customersStatus,
        suppliersStatus,
        deliveryStatus,
        customerAddModalOpened: true,
        supplierAddModalOpened: true,
        deliveryAddModalOpened: true,
        importsPickerOpened: true,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        contacts: SCREENSHOT_PATH,
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
