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
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-product-page-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'product-page-actions.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { method: string; status: number; url: string }
type DeleteDialog = { type: string; message: string }
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




async function openFirstActionMenu(page: Page): Promise<number> {
  const actionButtons = page.getByRole('button', { name: /Open actions menu|Actions/i })
  const count = await actionButtons.count()
  assert(count > 0, 'No product row action buttons rendered')
  await actionButtons.first().click()
  await page.getByRole('button', { name: /^Delete$/i }).first().waitFor({ state: 'visible', timeout: 10_000 })
  return count
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
    const deleteDialogs: DeleteDialog[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(products|categories|units|branches|action-history)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })
    page.on('dialog', async (dialog) => {
      deleteDialogs.push({ type: dialog.type(), message: dialog.message() })
      await dialog.dismiss()
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
    const productNameVisible = await addModal.locator('#product-name').isVisible()
    const saveButtonVisible = await addModal.getByRole('button', { name: /^Save$/i }).isVisible()
    const cancelButton = addModal.getByRole('button', { name: /^Cancel$/i })
    assert(productNameVisible, 'Product name input did not render')
    assert(saveButtonVisible, 'Product save button did not render')
    await cancelButton.click()
    await addModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})

    const actionMenuCount = await openFirstActionMenu(page)
    await page.getByRole('button', { name: /^Delete$/i }).first().click()
    await page.waitForTimeout(500)
    assert(deleteDialogs.length === 1, 'Delete confirmation dialog was not shown and dismissed')

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
        productNameVisible,
        saveButtonVisible,
        actionMenuCount,
        deleteConfirmationDismissed: true,
        mutatingProductRequests: mutatingProductRequests.length,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      deleteDialogs,
      screenshots: {
        productPageActions: SCREENSHOT_PATH,
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
