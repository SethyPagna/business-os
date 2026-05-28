/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-product-variant-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'product-variant-actions.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { status: number; url: string }
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




async function openFirstVariantModal(page: Page): Promise<number> {
  const actionButtons = page.getByRole('button', { name: /Open actions menu|Actions/i })
  const count = await actionButtons.count()
  assert(count > 0, 'No product row action buttons rendered')

  for (let index = 0; index < Math.min(count, 20); index += 1) {
    await actionButtons.nth(index).click()
    const addVariant = page.getByRole('button', { name: /Add Variant/i })
    if (await addVariant.count()) {
      await addVariant.first().click()
      return index
    }
    await page.keyboard.press('Escape').catch(() => {})
  }
  throw new Error('No visible product action menu exposed Add Variant')
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
        observedRequests.push({ status: response.status(), url })
      }
    })

    const productsRead = waitForRead(page, observedRequests, /\/api\/products\/search/i, 'Products search read')
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const productsStatus = await productsRead

    const openedActionIndex = await openFirstVariantModal(page)
    const modal = page.locator('.fixed.inset-0').last()
    await modal.getByRole('heading', { name: /Add Variant/i }).waitFor({ state: 'visible', timeout: 20_000 })

    const variantNameVisible = await modal.locator('#variant-form-name').isVisible()
    const skuVisible = await modal.locator('#variant-form-sku').isVisible()
    const barcodeVisible = await modal.locator('#variant-form-barcode').isVisible()
    const unitVisible = await modal.locator('#variant-form-unit').isVisible()
    const branchVisible = await modal.locator('#variant-form-branch').isVisible()
    const addVariantButtonVisible = await modal.getByRole('button', { name: /^Add Variant$/i }).isVisible()
    assert(variantNameVisible, 'Variant name input did not render')
    assert(addVariantButtonVisible, 'Add Variant submit button did not render')

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
        openedActionIndex,
        variantModalOpened: true,
        variantNameVisible,
        skuVisible,
        barcodeVisible,
        unitVisible,
        branchVisible,
        addVariantButtonVisible,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        productVariant: SCREENSHOT_PATH,
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
