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
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-product-scanning-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'product-scanning-actions.png')
const MANUAL_BARCODE_VALUE = '8991234567890'

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { method: string; status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
      if (/\/api\/(products|categories|units|branches|action-history)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    const productsRead = waitForRead(page, observedRequests, /\/api\/products\/search/i, 'Products search read')
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const productsStatus = await productsRead

    await page.getByRole('button', { name: /^Product$/i }).last().click()
    const addModal = page.locator('.fixed.inset-0').last()
    await addModal.getByRole('heading', { name: /Add Product/i }).waitFor({ state: 'visible', timeout: 20_000 })
    await addModal.locator('#product-barcode').waitFor({ state: 'visible', timeout: 10_000 })

    await addModal.getByRole('button', { name: /Scan barcode/i }).click()
    const scannerModal = page.locator('.fixed.inset-0').filter({ hasText: /Scan barcode|Manual entry/i }).last()
    await scannerModal.locator('#scanner-manual-value').waitFor({ state: 'visible', timeout: 20_000 })
    const manualEntryVisible = await scannerModal.getByText(/Manual entry/i).first().isVisible()
    await scannerModal.locator('#scanner-manual-value').fill(MANUAL_BARCODE_VALUE)
    await scannerModal.getByRole('button', { name: /Use value/i }).click()
    await scannerModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})

    const barcodeValue = await addModal.locator('#product-barcode').inputValue()
    assert(barcodeValue === MANUAL_BARCODE_VALUE, `Manual barcode value was not applied, got "${barcodeValue}"`)

    const mutatingProductRequests = observedRequests.filter((entry) => (
      /\/api\/products(\/\d+)?$/i.test(entry.url) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)
    ))
    assert(mutatingProductRequests.length === 0, `Non-destructive check unexpectedly sent mutations: ${JSON.stringify(mutatingProductRequests, null, 2)}`)

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
        addProductModalOpened: true,
        scannerModalOpened: true,
        manualEntryVisible,
        manualBarcodeApplied: true,
        mutatingProductRequests: mutatingProductRequests.length,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        productScanning: SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error: any) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
